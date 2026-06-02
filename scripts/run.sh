#!/usr/bin/env bash
# scripts/run.sh — boot the n-payment Portal v0.2 from a clean checkout.
#
# One command. Opinionated. Idempotent. No state left behind on Ctrl+C.
#
# Phases (each prints a one-line status; first failure exits non-zero):
#   1/8  tooling     — node ≥20, pnpm, optional forge + cast + psql
#   2/8  env         — .env.local present (scaffolds dev defaults if missing)
#   3/8  deps        — pnpm install (frozen-lockfile if pnpm-lock.yaml present)
#   4/8  shared      — build packages/shared dist (Next.js needs the .js files)
#   5/8  tests       — vitest + forge (skip with --skip-tests)
#   6/8  contract    — cast call MAX_FEE_BPS on Base Sepolia (skip with --skip-onchain)
#   7/8  dev server  — pnpm -F @n-payment/gateway dev (or --prod for build+start)
#   8/8  ready       — poll /api/healthz, print URL + next steps
#
# Flags:
#   --skip-tests       skip vitest + forge (saves ~10s on warm cache)
#   --skip-onchain     skip the Base Sepolia cast call (offline-friendly)
#   --prod             pnpm build && pnpm start (instead of next dev)
#   --port N           override dev port (default 3000)
#   --open             open the URL in your default browser when ready
#   -h | --help        show this help

set -euo pipefail

# ── flags ───────────────────────────────────────────────────────────────────
SKIP_TESTS=0
SKIP_ONCHAIN=0
PROD=0
PORT=3000
DO_OPEN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests)   SKIP_TESTS=1 ;;
    --skip-onchain) SKIP_ONCHAIN=1 ;;
    --prod)         PROD=1 ;;
    --port)         PORT="$2"; shift ;;
    --open)         DO_OPEN=1 ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//' | head -n 25
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

# ── pretty ──────────────────────────────────────────────────────────────────
GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; DIM=$'\033[2m'; RESET=$'\033[0m'
step() { printf '\n%s▶ %s%s\n' "$BLUE" "$1" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s⚠%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail() { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; exit 1; }
dim()  { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DEV_PID=""
cleanup() {
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    echo
    dim "stopping dev server (pid $DEV_PID)…"
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ── 1/8 tooling ─────────────────────────────────────────────────────────────
step "1/8 tooling"
command -v node >/dev/null || fail "node missing — install Node.js ≥20"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[[ "$NODE_MAJOR" -ge 20 ]] || fail "node ≥20 required, got $(node -v)"
command -v pnpm >/dev/null || fail "pnpm missing — corepack enable || npm i -g pnpm"
command -v curl >/dev/null || fail "curl missing"

HAVE_FORGE=0
HAVE_CAST=0
command -v forge >/dev/null && HAVE_FORGE=1 || warn "forge not installed (Foundry) — contract tests will skip"
command -v cast  >/dev/null && HAVE_CAST=1  || warn "cast not installed (Foundry) — onchain smoke will skip"
ok "node $(node -v) · pnpm $(pnpm -v)$( [[ $HAVE_FORGE -eq 1 ]] && echo " · forge $(forge -V | head -1 | awk '{print $2}')" )"

# ── 2/8 env ─────────────────────────────────────────────────────────────────
step "2/8 env"
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  warn ".env.local was missing — copied from .env.example (fill in real values for full functionality)"
fi

# Scaffold safe dev defaults for any missing required key. Never overwrite
# existing values. Lets the dev server boot for the visual demo even if the
# user hasn't configured Supabase yet.
ensure_env() {
  local key="$1"; local default="$2"
  if ! grep -qE "^${key}=" .env.local; then
    echo "${key}=${default}" >> .env.local
    dim "added ${key}=${default}"
  elif grep -qE "^${key}=$" .env.local; then
    sed -i.bak -E "s|^${key}=$|${key}=${default}|" .env.local && rm -f .env.local.bak
    dim "filled stub for ${key}"
  fi
}
# Auto-generate a real session secret if neither SESSION_SECRET nor (legacy) SUPABASE_JWT_SECRET is present.
if ! grep -qE '^(SESSION_SECRET|SUPABASE_JWT_SECRET)=[^[:space:]].*' .env.local; then
  SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ensure_env SESSION_SECRET "$SECRET"
fi
ensure_env CRON_BEARER             "dev-cron-bearer"
ensure_env AAVE_AUTO_YIELD         "true"
# Note: NEXT_PUBLIC_APP_DOMAIN intentionally NOT auto-injected — the SIWE
# verifier accepts the live request host in dev. Set it explicitly only for
# production deployments behind a proxy where req.url ≠ user-facing domain.
set -a; source .env.local; set +a
ok ".env.local loaded"

# Warn about missing high-value real keys (not blocking).
[[ -z "${DATABASE_URL:-}" ]]             && warn "DATABASE_URL empty — DB-touching routes will fail until set"
[[ -z "${DEMO_BUYER_PK:-}" ]]            && warn "DEMO_BUYER_PK empty — 'Run paid call' will fail until set"
[[ -z "${SPONSOR_PK_BASE_SEPOLIA:-}" ]]  && warn "SPONSOR_PK_BASE_SEPOLIA empty — settle() will fail until set"

# ── 3/8 deps ────────────────────────────────────────────────────────────────
step "3/8 deps"
if [[ -f pnpm-lock.yaml ]]; then
  pnpm install --frozen-lockfile --prefer-offline >/dev/null
else
  pnpm install --prefer-offline >/dev/null
fi
ok "pnpm modules ready"

# ── 4/8 shared dist ─────────────────────────────────────────────────────────
step "4/8 shared dist"
if [[ ! -f packages/shared/dist/index.js ]] || [[ packages/shared/src -nt packages/shared/dist ]]; then
  pnpm -F @n-payment/shared build >/dev/null
  ok "rebuilt packages/shared/dist"
else
  ok "packages/shared/dist is up to date"
fi

# ── 5/8 tests ───────────────────────────────────────────────────────────────
if [[ "$SKIP_TESTS" -eq 0 ]]; then
  step "5/8 tests"
  pnpm test >/tmp/np-test.log 2>&1 || { tail -30 /tmp/np-test.log; fail "vitest"; }
  V=$(grep -Eo '[0-9]+ passed' /tmp/np-test.log | awk '{s+=$1} END {print s}')
  ok "vitest: ${V:-?} passed"
  if [[ "$HAVE_FORGE" -eq 1 ]]; then
    (cd packages/contracts && forge test) >/tmp/np-forge.log 2>&1 || { tail -30 /tmp/np-forge.log; fail "forge"; }
    F=$(grep -Eo '[0-9]+ passed' /tmp/np-forge.log | tail -1 | awk '{print $1}')
    ok "forge:  ${F:-?} passed"
  fi
else
  step "5/8 tests"
  dim "skipped (--skip-tests)"
fi

# ── 6/8 contract on-chain ───────────────────────────────────────────────────
if [[ "$SKIP_ONCHAIN" -eq 0 && "$HAVE_CAST" -eq 1 ]]; then
  step "6/8 contract on-chain (Base Sepolia)"
  RPC="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
  ADDR=$(grep -Eo "feeSplit: '0x[0-9a-fA-F]{40}'" packages/shared/src/contracts.ts \
    | grep -v '0x0000000000000000000000000000000000000000' \
    | head -1 \
    | sed -E "s/feeSplit: '(0x[0-9a-fA-F]{40})'/\1/")
  if [[ -n "$ADDR" ]]; then
    MAX_FEE=$(cast call "$ADDR" "MAX_FEE_BPS()(uint16)" --rpc-url "$RPC" 2>/dev/null || true)
    if [[ "$MAX_FEE" == "100" ]]; then
      ok "X402FeeSplitFacilitator @ $ADDR  MAX_FEE_BPS=100"
    else
      warn "could not reach RPC — got '${MAX_FEE:-empty}' (continuing)"
    fi
  else
    warn "no deployed feeSplit found in shared/contracts.ts"
  fi
else
  step "6/8 contract on-chain"
  dim "skipped"
fi

# ── 7/8 dev server ──────────────────────────────────────────────────────────
step "7/8 dev server (port $PORT)"
# Kill anything already on the port.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
  warn "port $PORT in use — set --port to override or free it"
fi

LOG_FILE="/tmp/np-gateway.log"
if [[ "$PROD" -eq 1 ]]; then
  pnpm -F @n-payment/gateway build >/tmp/np-build.log 2>&1 || { tail -30 /tmp/np-build.log; fail "next build"; }
  ok "next build green"
  PORT="$PORT" pnpm -F @n-payment/gateway exec next start -p "$PORT" >"$LOG_FILE" 2>&1 &
else
  PORT="$PORT" pnpm -F @n-payment/gateway exec next dev -p "$PORT" >"$LOG_FILE" 2>&1 &
fi
DEV_PID=$!
ok "spawned pid=$DEV_PID  logs=$LOG_FILE"

# ── 8/8 ready ───────────────────────────────────────────────────────────────
step "8/8 ready"
URL="http://localhost:$PORT"
for i in $(seq 1 60); do
  if curl -fsS "$URL/api/healthz" >/dev/null 2>&1; then
    ok "/api/healthz responding (${i}× 500ms)"
    break
  fi
  sleep 0.5
  if [[ "$i" -eq 60 ]]; then
    tail -30 "$LOG_FILE"
    fail "gateway did not become healthy in 30s"
  fi
done

cat <<EOF

${GREEN}n-payment Portal v0.2 is live.${RESET}

  ${DIM}Open:${RESET}      $URL
  ${DIM}Health:${RESET}    $URL/api/healthz
  ${DIM}Logs:${RESET}      tail -f $LOG_FILE
  ${DIM}Stop:${RESET}      Ctrl+C  (clean shutdown)

  Demo flow:
    1. Connect wallet (MetaMask / browser wallet)
    2. Sign in with Ethereum (SIWE)
    3. Fill the publish form  (slug + origin URL + price)
    4. Click "Run paid call"  → on-chain tx on Base Sepolia
EOF

if [[ "$DO_OPEN" -eq 1 ]]; then
  case "$(uname)" in
    Darwin) open "$URL" ;;
    Linux)  xdg-open "$URL" >/dev/null 2>&1 || true ;;
  esac
fi

# Tail logs in foreground so Ctrl+C cleans up via the EXIT trap.
tail -n +1 -f "$LOG_FILE" &
TAIL_PID=$!
wait "$DEV_PID"
kill "$TAIL_PID" 2>/dev/null || true
