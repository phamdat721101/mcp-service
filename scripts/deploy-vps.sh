#!/usr/bin/env bash
# scripts/deploy-vps.sh — provision the sample paid MCP server on a VPS.
#
# Architecture
#   Buyer agent / Vercel gateway  --HTTPS-->  Caddy (443) --:3000-->  sample-mcp.mjs
#                                                  └ auto-LE cert for nip.io host
#
# Phases (idempotent, re-runnable):
#   1/8 ssh probe
#   2/8 system packages (Node 20 LTS + Caddy + build tools)
#   3/8 user dir + sample-mcp.mjs upload
#   4/8 npm install (n-payment SDK)
#   5/8 systemd unit (sample-mcp.service)
#   6/8 Caddyfile (auto Let's Encrypt against <ip-with-dashes>.nip.io)
#   7/8 firewall: open 80/443
#   8/8 healthcheck → print public URL
#
# Defaults
#   SSH_HOST=ubuntu@52.221.225.219
#   SSH_KEY=$HOME/Downloads/nim-claw.pem
#
# Usage
#   ./scripts/deploy-vps.sh                 # full deploy
#   ./scripts/deploy-vps.sh --restart       # just restart the service
#   ./scripts/deploy-vps.sh --logs          # tail journalctl

set -euo pipefail

SSH_HOST=${SSH_HOST:-ubuntu@52.221.225.219}
SSH_KEY=${SSH_KEY:-$HOME/Downloads/nim-claw.pem}
PORT=${PORT:-3000}

# Derive a free real-DNS host that points back to this IP (nip.io magic).
HOST_PART=${SSH_HOST##*@}
NIP_HOST="$(echo "$HOST_PART" | tr '.' '-').nip.io"
PUBLIC_URL="https://$NIP_HOST"

# ── pretty ─────────────────────────────────────────────────────────────────
GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; DIM=$'\033[2m'; RESET=$'\033[0m'
step() { printf '\n%s▶ %s%s\n' "$BLUE" "$1" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s⚠%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; exit 1; }
dim()  { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Single source of truth for ssh + scp.
remote() { ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SSH_HOST" "$@"; }

# Mode flags.
case "${1:-}" in
  --restart) remote 'sudo systemctl restart sample-mcp && sudo systemctl status sample-mcp --no-pager -n 5'; exit 0 ;;
  --logs)    remote 'sudo journalctl -u sample-mcp -n 50 --no-pager'; exit 0 ;;
  --status)  remote 'sudo systemctl status sample-mcp --no-pager -n 5 && echo --- && curl -fsS http://localhost:'"$PORT"'/health 2>/dev/null || echo "(no /health endpoint)"'; exit 0 ;;
  -h|--help) sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//' | head -n 30; exit 0 ;;
esac

# ── 1/8 ssh probe ──────────────────────────────────────────────────────────
step "1/8 ssh probe"
[[ -f "$SSH_KEY" ]] || fail "ssh key not found: $SSH_KEY"
chmod 600 "$SSH_KEY" 2>/dev/null || true
remote 'echo connected to $(hostname) running $(lsb_release -d 2>/dev/null | cut -f2)' \
  | sed 's/^/  /' || fail "ssh failed (check key + ip)"

# ── 2/8 system packages ────────────────────────────────────────────────────
step "2/8 system packages"
remote 'bash -se' <<'REMOTE'
set -euo pipefail
need_node=1; need_caddy=1
command -v node >/dev/null && [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -ge 20 ] && need_node=0
command -v caddy >/dev/null && need_caddy=0
if [ "$need_node$need_caddy" = "00" ]; then
  echo "  ✓ node $(node -v) · caddy $(caddy version | head -1)"
  exit 0
fi
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -yqq curl gnupg ca-certificates debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if [ "$need_node" = 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -yqq nodejs build-essential >/dev/null
fi
if [ "$need_caddy" = 1 ]; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -yqq caddy >/dev/null
fi
echo "  ✓ node $(node -v) · caddy $(caddy version | head -1)"
REMOTE
ok "node + caddy ready"

# ── 3/8 sample-mcp source ──────────────────────────────────────────────────
step "3/8 sample-mcp source"
remote 'mkdir -p ~/sample-mcp'
scp -i "$SSH_KEY" -q scripts/sample-mcp.mjs "$SSH_HOST":~/sample-mcp/server.mjs
remote 'bash -se' <<'REMOTE'
cat > ~/sample-mcp/package.json <<'JSON'
{
  "name": "sample-mcp",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "main": "./server.mjs",
  "dependencies": { "n-payment": "0.19.0" }
}
JSON
REMOTE
ok "uploaded ~/sample-mcp/{server.mjs,package.json}"

# ── 4/8 npm install ────────────────────────────────────────────────────────
step "4/8 npm install"
remote 'cd ~/sample-mcp && npm install --omit=dev --no-audit --no-fund --silent' >/dev/null
ok "n-payment@0.19.0 installed on remote"

# ── 5/8 systemd unit ───────────────────────────────────────────────────────
step "5/8 systemd unit"
remote 'sudo bash -se' <<REMOTE
cat > /etc/systemd/system/sample-mcp.service <<'UNIT'
[Unit]
Description=n-payment sample paid MCP server
After=network.target

[Service]
ExecStart=/usr/bin/node /home/ubuntu/sample-mcp/server.mjs
Environment=PORT=$PORT
Environment=NODE_ENV=production
WorkingDirectory=/home/ubuntu/sample-mcp
User=ubuntu
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now sample-mcp.service >/dev/null 2>&1 || true
systemctl restart sample-mcp.service
sleep 1
systemctl is-active sample-mcp.service
REMOTE
ok "sample-mcp.service active on :$PORT"

# ── 6/8 Caddyfile ──────────────────────────────────────────────────────────
step "6/8 Caddyfile (auto-HTTPS for $NIP_HOST)"
remote 'sudo bash -se' <<REMOTE
cat > /etc/caddy/Caddyfile <<CADDY
$NIP_HOST {
  encode zstd gzip
  reverse_proxy localhost:$PORT
}

# Optional plain-HTTP redirect catch-all on the IP.
:80 {
  redir https://$NIP_HOST{uri} 308
}
CADDY
systemctl reload caddy 2>/dev/null || systemctl restart caddy
REMOTE
ok "caddy reloaded → $NIP_HOST"

# ── 7/8 firewall ───────────────────────────────────────────────────────────
step "7/8 firewall (80/443)"
remote 'sudo bash -se' <<'REMOTE'
if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  echo "  ✓ ufw 80,443 allowed"
else
  echo "  ⚠ ufw not active — assuming AWS SG allows 80/443 inbound"
fi
REMOTE

# ── 8/8 healthcheck ────────────────────────────────────────────────────────
step "8/8 healthcheck (HTTPS via Let's Encrypt — first issue can take ~30s)"
for i in $(seq 1 30); do
  # Any HTTP response over HTTPS = cert + reverse proxy + service all up.
  CODE=$(curl -sI -o /dev/null -w '%{http_code}' -m 4 "$PUBLIC_URL" 2>/dev/null || echo 000)
  if [[ "$CODE" =~ ^[1-5][0-9][0-9]$ ]]; then
    ok "$PUBLIC_URL up (HTTP $CODE over TLS)"
    break
  fi
  sleep 2
  if [[ "$i" -eq 30 ]]; then
    remote 'sudo journalctl -u caddy -n 20 --no-pager'
    fail "no HTTPS response in 60s — check Caddy logs above"
  fi
done

# Validate it's actually an MCP server (initialize round-trip).
PROTO=$(curl -fsS -m 6 -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  "$PUBLIC_URL" 2>/dev/null | sed -n 's/.*"protocolVersion":"\([^"]*\)".*/\1/p')
if [[ -n "$PROTO" ]]; then
  ok "MCP initialize → protocolVersion=$PROTO"
else
  warn "MCP initialize did not return protocolVersion — service is up but JSON-RPC may be misconfigured"
fi

cat <<EOF

${GREEN}Sample paid MCP is live.${RESET}

  ${DIM}Public URL:${RESET}  $PUBLIC_URL
  ${DIM}MCP path:${RESET}    POST $PUBLIC_URL/  (JSON-RPC)
  ${DIM}Logs:${RESET}        ./scripts/deploy-vps.sh --logs
  ${DIM}Restart:${RESET}     ./scripts/deploy-vps.sh --restart

  Set this in your Vercel env so the publish form pre-fills it:
    ${YELLOW}NEXT_PUBLIC_DEMO_PUBLISHER_ORIGIN=$PUBLIC_URL${RESET}
EOF
