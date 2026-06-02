#!/usr/bin/env bash
# scripts/check.sh — full-stack smoke check for n-payment Portal v0.2.
#
# Verifies, in order: tooling → env → unit tests → build → on-chain contract →
# live Supabase. Prints PASS/FAIL per step; non-zero exit on first failure.
#
# Usage:
#   ./scripts/check.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; DIM='\033[2m'; RESET='\033[0m'
step() { echo -e "\n${BLUE}▶ $1${RESET}"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; exit 1; }
dim()  { echo -e "  ${DIM}$1${RESET}"; }

# ── 1/6 tooling ──────────────────────────────────────────────────────────────
step "1/6 tooling"
for tool in node pnpm forge cast curl jq; do
  command -v "$tool" >/dev/null 2>&1 || fail "missing: $tool"
done
PSQL="${PSQL:-$(command -v psql || echo /usr/local/opt/libpq/bin/psql)}"
[ -x "$PSQL" ] || warn "psql not found; DB step will skip"
ok "node $(node -v)  pnpm $(pnpm -v)  forge $(forge -V | head -1 | awk '{print $2}')"

# ── 2/6 env ──────────────────────────────────────────────────────────────────
step "2/6 env"
[ -f .env.local ] || fail ".env.local missing — copy .env.example and fill in"
set -a; source .env.local; set +a
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL missing"
[ -n "${DEPLOYER_PK:-}" ]  || fail "DEPLOYER_PK missing"
ok ".env.local loaded"

# ── 3/6 unit tests ───────────────────────────────────────────────────────────
step "3/6 unit tests"
pnpm -s test > /tmp/np-test.log 2>&1 || { tail -30 /tmp/np-test.log; fail "vitest"; }
PASS_VITEST=$(grep -Eo '[0-9]+ passed' /tmp/np-test.log | awk '{s+=$1} END {print s}')
ok "vitest: ${PASS_VITEST:-?} passed"

(cd packages/contracts && forge test 2>&1) > /tmp/np-forge.log || { tail -30 /tmp/np-forge.log; fail "forge"; }
PASS_FORGE=$(grep -Eo '[0-9]+ passed' /tmp/np-forge.log | tail -1 | awk '{print $1}')
ok "forge: ${PASS_FORGE:-?} passed"

# ── 4/6 build ────────────────────────────────────────────────────────────────
step "4/6 build"
pnpm -s build > /tmp/np-build.log 2>&1 || { tail -30 /tmp/np-build.log; fail "build"; }
ok "build green"

# ── 5/6 contract on-chain (Base Sepolia) ─────────────────────────────────────
step "5/6 contract on-chain (Base Sepolia)"
RPC="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
ADDR=$(grep -Eo "feeSplit: '0x[0-9a-fA-F]{40}'" packages/shared/src/contracts.ts \
  | grep -v '0x0000000000000000000000000000000000000000' \
  | head -1 \
  | sed -E "s/feeSplit: '(0x[0-9a-fA-F]{40})'/\1/")
[ -n "$ADDR" ] || fail "no deployed feeSplit found in shared/contracts.ts"
MAX_FEE=$(cast call "$ADDR" "MAX_FEE_BPS()(uint16)" --rpc-url "$RPC" 2>/dev/null || true)
[ "$MAX_FEE" = "100" ] || fail "MAX_FEE_BPS expected 100, got '${MAX_FEE:-empty}'"
ok "X402FeeSplitFacilitator @ $ADDR  MAX_FEE_BPS=$MAX_FEE"

# ── 6/6 database (best-effort) ───────────────────────────────────────────────
step "6/6 database"
if [ -x "$PSQL" ]; then
  DB_URL_CLEAN=$(echo "$DATABASE_URL" | sed -E 's/[?&]pgbouncer=true//; s/\?$//')
  TABLE_COUNT=$(PGSSLMODE=require "$PSQL" "$DB_URL_CLEAN" -At -c "
    select count(*) from pg_tables
    where schemaname='public'
      and tablename in ('publishers','billing_accounts','mcp_servers','paid_tools',
                        'sponsor_wallets','audit_entries','reputation','rate_limit_buckets',
                        'verified_nonces','yield_positions');" 2>/dev/null || echo 0)
  if [ "$TABLE_COUNT" -ge 9 ]; then
    ok "supabase reachable; $TABLE_COUNT tables present (10 expected after 0002)"
  else
    warn "expected ≥9 tables, got $TABLE_COUNT — run migrations 0001 + 0002"
  fi
else
  warn "psql not available — DB check skipped"
fi

echo
echo -e "${GREEN}n-payment Portal v0.2 smoke check passed.${RESET}"
echo -e "  Next: ${DIM}pnpm -F @n-payment/gateway dev${RESET} → http://localhost:3000"
