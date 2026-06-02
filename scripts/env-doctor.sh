#!/usr/bin/env bash
# scripts/env-doctor.sh — verify which envs are missing / obsolete in .env.local.
#
# Truth source: actual `process.env.X` references in apps/gateway/src/. Each
# var is classified:
#   ✓ set        — has a real value
#   ⚠ optional   — blank/missing but only matters for a specific feature
#   ✗ required   — blank/missing AND blocks the demo from working
#   ⛔ obsolete  — present in .env.local but no longer used (v0.1 leftover)
#
# Exit codes: 0 if all required set, 1 otherwise.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${1:-.env.local}"
[[ -f "$ENV_FILE" ]] || { echo "missing: $ENV_FILE" >&2; exit 2; }

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[1;33m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

# Read a key's value from the env file. Returns "" if absent or blank.
val() {
  local k="$1"
  local line
  line=$(grep -E "^${k}=" "$ENV_FILE" 2>/dev/null | tail -1 || true)
  [[ -z "$line" ]] && return 0
  printf '%s' "${line#*=}"
}

has() { [[ -n "$(val "$1")" ]]; }
is_stub() {
  local v
  v="$(val "$1")"
  [[ -z "$v" ]] && return 1
  case "$v" in
    dev-*|*change-me*|http://127.0.0.1*|http://localhost*) return 0 ;;
  esac
  return 1
}
present_blank() { grep -qE "^${1}=$" "$ENV_FILE"; }

REQUIRED_FAIL=0
print_row() {
  local mark="$1"; local color="$2"; local key="$3"; local hint="$4"
  printf '  %s%s%s  %-36s %s%s%s\n' "$color" "$mark" "$RESET" "$key" "$DIM" "$hint" "$RESET"
}

# ── REQUIRED — demo cannot work without these ────────────────────────────────
echo
printf '%sRequired%s — demo cannot run without these\n' "$BOLD" "$RESET"
declare -a REQ=(
  'DATABASE_URL|Postgres connection string (Supabase pgbouncer pool URL works)'
  'SESSION_SECRET|HMAC secret for session cookies — any random ≥32-byte string (also reads SUPABASE_JWT_SECRET for back-compat)'
  'DEMO_BUYER_PK|0x-prefixed testnet private key signed for demo "Run paid call"'
  'SPONSOR_PK_BASE_SEPOLIA|0x-prefixed sponsor key that submits FeeSplit.settle on Base Sepolia'
)
for entry in "${REQ[@]}"; do
  key="${entry%%|*}"; hint="${entry#*|}"
  # SESSION_SECRET back-compat — also accept SUPABASE_JWT_SECRET if SESSION_SECRET is unset.
  effective_key="$key"
  if [[ "$key" == "SESSION_SECRET" ]] && ! has SESSION_SECRET && has SUPABASE_JWT_SECRET; then
    effective_key="SUPABASE_JWT_SECRET"
  fi
  if ! has "$effective_key"; then
    print_row "✗" "$RED" "$key" "$hint"
    REQUIRED_FAIL=1
  elif is_stub "$effective_key"; then
    print_row "✗" "$RED" "$key" "stub value — replace with real one ($hint)"
    REQUIRED_FAIL=1
  else
    print_row "✓" "$GREEN" "$key" "set${effective_key:+ ($effective_key)}"
  fi
done

# ── OPTIONAL — feature-specific or has working defaults ──────────────────────
echo
printf '%sOptional%s — feature-gated or has a default\n' "$BOLD" "$RESET"
declare -a OPT=(
  'NEXT_PUBLIC_APP_DOMAIN|defaults to req URL host; set for production cookie domain'
  'DEPLOYER_PK|only needed for forge-script contract deploys'
  'BASE_SEPOLIA_RPC_URL|defaults to https://sepolia.base.org'
  'FLARE_COSTON2_RPC_URL|defaults to coston2-api.flare.network'
  'GOAT_TESTNET3_RPC_URL|defaults to rpc.testnet3.goat.network'
  'SPONSOR_PK_FLARE_COSTON2|only required when demo runs against Flare'
  'SPONSOR_PK_GOAT_TESTNET3|only required when demo runs against GOAT'
  'GATEWAY_FEE_RECEIVER_BASE_SEPOLIA|set after contract deploy; defaults to publisher'
  'GATEWAY_FEE_RECEIVER_FLARE_COSTON2|set after Flare deploy'
  'GATEWAY_FEE_RECEIVER_GOAT_TESTNET3|set after GOAT deploy'
  'AAVE_AUTO_YIELD|"true" enables daily Aave sweep cron; defaults true'
  'CRON_BEARER|protects /api/cron/* — leave blank for local dev'
)
for entry in "${OPT[@]}"; do
  key="${entry%%|*}"; hint="${entry#*|}"
  if ! has "$key"; then       print_row "⚠" "$YELLOW" "$key" "$hint"
  elif is_stub "$key"; then   print_row "⚠" "$YELLOW" "$key" "stub — fine for dev, replace before prod"
  else                        print_row "✓" "$GREEN" "$key" "set"
  fi
done

# ── OBSOLETE — leftovers from v0.1 that should be removed ────────────────────
echo
printf '%sObsolete%s — left over from v0.1, should be removed\n' "$BOLD" "$RESET"
declare -a OBS=(
  'NEXT_PUBLIC_PRIVY_APP_ID|v0.2 uses SIWE-only auth, Privy removed'
  'PRIVY_APP_SECRET|see above'
  'MORPH_HOODI_RPC_URL|Morph not supported in v0.2'
  'OPS_FACILITATOR_BEARER|apps/facilitator deleted in v0.2'
  'FACILITATOR_URL|apps/facilitator deleted in v0.2'
  'STRIPE_SECRET_KEY|Stripe not wired in v0.2'
  'STRIPE_WEBHOOK_SECRET|see above'
  'UPSTASH_REDIS_REST_TOKEN|Upstash replaced by Postgres rate_limit_buckets'
  'NEXT_PUBLIC_SUPABASE_URL|v0.2 uses DATABASE_URL only — Supabase JS client removed'
  'NEXT_PUBLIC_SUPABASE_ANON_KEY|see above'
  'SUPABASE_SERVICE_ROLE_KEY|see above'
)
OBSOLETE_FOUND=0
for entry in "${OBS[@]}"; do
  key="${entry%%|*}"; hint="${entry#*|}"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    print_row "⛔" "$YELLOW" "$key" "$hint"
    OBSOLETE_FOUND=1
  fi
done
[[ "$OBSOLETE_FOUND" -eq 0 ]] && printf '  %s(none)%s\n' "$DIM" "$RESET"

# ── verdict ──────────────────────────────────────────────────────────────────
echo
if [[ "$REQUIRED_FAIL" -eq 1 ]]; then
  printf '%s✗ env not ready%s — fill the required keys above, then re-run.\n' "$RED" "$RESET"
  echo
  printf '%sQuick paste block to append to .env.local (replace each = with the real value):%s\n' "$DIM" "$RESET"
  for entry in "${REQ[@]}"; do
    key="${entry%%|*}"
    if ! has "$key" || is_stub "$key"; then echo "$key="; fi
  done
  exit 1
else
  printf '%s✓ env is sufficient to run the full demo.%s\n' "$GREEN" "$RESET"
  [[ "$OBSOLETE_FOUND" -eq 1 ]] && printf '  %sclean up obsolete keys above to keep .env.local tidy.%s\n' "$DIM" "$RESET"
  exit 0
fi
