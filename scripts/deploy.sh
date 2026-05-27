#!/usr/bin/env bash
# scripts/deploy.sh
#
# POSIX twin of deploy.ps1. Same modes, same flags.
#
# Usage:
#   ./scripts/deploy.sh pre-flight
#   ./scripts/deploy.sh migrations
#   ./scripts/deploy.sh scraper
#   ./scripts/deploy.sh verify --health-url https://<prod>.vercel.app/api/health
#   ./scripts/deploy.sh all --yes              # skip confirmation prompts
#   ./scripts/deploy.sh all --dry-run          # print plan without executing

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
repo_root=$(cd -- "$script_dir/.." >/dev/null 2>&1 && pwd)
cd "$repo_root"

mode="pre-flight"
health_url=""
yes_flag=0
dry_run=0

# Parse args.
if [[ $# -gt 0 && ! "$1" =~ ^-- ]]; then
  mode="$1"
  shift
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --health-url) health_url="${2:-}"; shift 2 ;;
    --yes|-y) yes_flag=1; shift ;;
    --dry-run|-n) dry_run=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

case "$mode" in
  pre-flight|migrations|scraper|verify|all) ;;
  *) echo "unknown mode: $mode (use pre-flight|migrations|scraper|verify|all)" >&2; exit 1 ;;
esac

# ----- helpers --------------------------------------------------------------

c_cyan='\033[36m'; c_green='\033[32m'; c_yellow='\033[33m'; c_red='\033[31m'; c_dim='\033[90m'; c_reset='\033[0m'

step() { printf '\n%b── %s ──%b\n' "$c_cyan" "$1" "$c_reset"; }
ok()    { printf '  %b✓%b %s\n' "$c_green" "$c_reset" "$1"; }
miss()  { printf '  %b✗%b %s\n' "$c_red" "$c_reset" "$1"; }
warn()  { printf '  %b⚠%b %s\n' "$c_yellow" "$c_reset" "$1"; }
mockd() { printf '  %b·%b %s\n' "$c_dim" "$c_reset" "$1"; }

cli_exists() { command -v "$1" >/dev/null 2>&1; }
env_set()    { local v="${!1:-}"; [[ -n "$v" ]]; }

confirm_or_abort() {
  if [[ "$yes_flag" -eq 1 ]]; then return 0; fi
  printf '\n%b%s%b [y/N] ' "$c_yellow" "$1" "$c_reset"
  local ans=""
  read -r ans || true
  case "${ans:-}" in
    y|Y|yes|YES) return 0 ;;
    *) printf '%bAborted.%b\n' "$c_red" "$c_reset"; return 1 ;;
  esac
}

run_or_dry() {
  local label="$1"; shift
  if [[ "$dry_run" -eq 1 ]]; then
    printf '  %b[dry-run]%b would: %s\n' "$c_dim" "$c_reset" "$label"
    return 0
  fi
  printf '  %brunning:%b %s\n' "$c_green" "$c_reset" "$label"
  "$@"
}

# ----- mode implementations -------------------------------------------------

invoke_preflight() {
  step "Pre-flight checks"
  local missing=()
  for cli in supabase flyctl git npm; do
    if cli_exists "$cli"; then ok "$cli"; else miss "$cli  — install per their docs"; missing+=("$cli"); fi
  done

  step "Required env vars (server-side, for production)"
  for e in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
            ANTHROPIC_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET CRON_SECRET; do
    if env_set "$e"; then ok "$e"; else warn "$e  — required in Vercel prod env"; fi
  done

  step "Optional env vars (mock fallback if unset)"
  for e in BRAVE_SEARCH_KEY INNGEST_EVENT_KEY INNGEST_SIGNING_KEY SCRAPER_URL SCRAPER_KEY \
            WHATSAPP_API_URL WHATSAPP_API_KEY WHATSAPP_FROM \
            HUBSPOT_API_KEY ZOHO_REFRESH_TOKEN \
            RAZORPAY_KEY_ID STRIPE_SECRET_KEY; do
    if env_set "$e"; then ok "$e (real)"; else mockd "$e (mock)"; fi
  done

  step "Repo state"
  if [[ -z "$(git status --porcelain 2>/dev/null)" ]]; then
    ok "working tree clean"
  else
    warn "uncommitted changes:"
    git status --porcelain
  fi

  step "Schema version"
  local latest
  latest=$(ls supabase/migrations/*.sql 2>/dev/null | sort -r | head -n 1 || true)
  if [[ -n "$latest" ]]; then
    ok "latest: $(basename "$latest")"
    local total
    total=$(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
    printf '  total : %s migrations\n' "$total"
  else
    miss "no migrations found"
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    printf '\n%bInstall the missing CLIs before running deploy steps.%b\n' "$c_red" "$c_reset"
    return 1
  fi
  return 0
}

invoke_migrations() {
  step "Apply Supabase migrations"
  confirm_or_abort "About to run 'supabase db push' against the LINKED project. Proceed?" || return 0
  run_or_dry "supabase db push" supabase db push
  ok "migrations applied"
}

invoke_scraper() {
  step "Deploy Playwright scraper to Fly.io"
  if [[ ! -d "$repo_root/scraper" ]]; then
    miss "scraper/ directory not found"
    return 0
  fi
  confirm_or_abort "About to run 'fly deploy' from scraper/. Proceed?" || return 0
  pushd "$repo_root/scraper" >/dev/null
  run_or_dry "fly deploy" flyctl deploy
  popd >/dev/null
  ok "scraper deployed"
}

invoke_verify() {
  step "Verify deployed /api/health"
  if [[ -z "$health_url" ]]; then
    miss "--health-url required (e.g. https://<prod>.vercel.app/api/health)"
    return 0
  fi
  if [[ "$dry_run" -eq 1 ]]; then
    printf '  %b[dry-run]%b would: curl %s\n' "$c_dim" "$c_reset" "$health_url"
    return 0
  fi
  local resp body status
  if ! resp=$(curl -sS --max-time 15 -w '\n%{http_code}' "$health_url"); then
    miss "probe failed (network)"
    return 0
  fi
  body=$(printf '%s' "$resp" | sed '$d')
  status=$(printf '%s' "$resp" | tail -n 1)
  printf '%s\n' "$body"
  if [[ "$status" == "200" ]]; then ok "/api/health 200"; else miss "/api/health $status — investigate"; fi
}

# ----- dispatch -------------------------------------------------------------

case "$mode" in
  pre-flight) invoke_preflight || true ;;
  migrations) invoke_migrations ;;
  scraper)    invoke_scraper ;;
  verify)     invoke_verify ;;
  all)
    if ! invoke_preflight; then
      printf '\n%bPre-flight failed; aborting all. Fix and re-run.%b\n' "$c_red" "$c_reset"
      exit 1
    fi
    invoke_migrations
    invoke_scraper
    if [[ -n "$health_url" ]]; then
      invoke_verify
    else
      printf '\n%bSkipping verify — pass --health-url to run it.%b\n' "$c_yellow" "$c_reset"
    fi
    ;;
esac
