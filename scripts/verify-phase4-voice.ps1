[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$StartLocalSupabase,
  [switch]$RunProviderSmoke,
  [switch]$ConfirmProviderSmoke,
  [string]$ProviderUserId,
  [string]$ProviderLeadId
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$workerPath = Join-Path $repoRoot "backend-python"
$workerDockerfile = Join-Path $workerPath "Dockerfile"
$smokeStarter = Join-Path $PSScriptRoot "run-phase4-bolna-smoke.mjs"

function Assert-Path([string]$Path, [string]$Description) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "$Description is missing: $Path" }
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found."
  }
}

Assert-Path $workerDockerfile "Python worker Dockerfile"
Assert-Path $smokeStarter "Controlled Bolna smoke starter"
Require-Command "npm.cmd"

if ($CheckOnly) {
  Write-Host "Phase 4 verification plan is valid. No Docker, database, or provider action was performed."
  Write-Host "Worker: docker build -t salesengai-python-worker ./backend-python; docker run --rm salesengai-python-worker python -m unittest discover -s tests -v"
  Write-Host "Database: npx.cmd supabase db lint (requires a running local Supabase stack)"
  Write-Host "Provider: requires -RunProviderSmoke -ConfirmProviderSmoke -ProviderUserId <UUID> -ProviderLeadId <UUID>"
  exit 0
}

Require-Command "docker"
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker is installed but its daemon is unavailable." }

Push-Location $repoRoot
try {
  Write-Host "Building the Python worker image..."
  & docker build -t salesengai-python-worker ./backend-python
  if ($LASTEXITCODE -ne 0) { throw "Python worker image build failed." }

  Write-Host "Running Python Temporal worker tests..."
  & docker run --rm salesengai-python-worker python -m unittest discover -s tests -v
  if ($LASTEXITCODE -ne 0) { throw "Python Temporal worker tests failed." }

  if ($StartLocalSupabase) {
    Write-Host "Starting local Supabase..."
    & npx.cmd supabase start
    if ($LASTEXITCODE -ne 0) { throw "Could not start local Supabase." }
  }
  Write-Host "Running local Supabase database lint..."
  & npx.cmd supabase db lint
  if ($LASTEXITCODE -ne 0) { throw "Supabase database lint failed. Start the local stack with -StartLocalSupabase if needed." }

  if ($RunProviderSmoke) {
    if (-not $ConfirmProviderSmoke) { throw "Provider smoke is intentionally blocked. Re-run with -ConfirmProviderSmoke after selecting a consented test recipient." }
    if ($ProviderUserId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw "ProviderUserId must be a UUID." }
    if ($ProviderLeadId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw "ProviderLeadId must be a UUID." }
    Write-Warning "This will place one real Bolna call to the selected already-consented test lead and may incur provider charges."
    & node --experimental-strip-types scripts/run-phase4-bolna-smoke.mjs $ProviderUserId $ProviderLeadId
    if ($LASTEXITCODE -ne 0) { throw "Bolna smoke call could not be started." }
    Write-Host "Run the completion check separately after the provider reaches a terminal state:"
    Write-Host "node --experimental-strip-types scripts/complete-day6-live-call.mjs <local-execution-id>"
  }
} finally {
  Pop-Location
}
