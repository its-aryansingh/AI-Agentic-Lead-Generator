# scripts/deploy.ps1
#
# Launch-readiness orchestrator. Bundles the manual steps from Section
# 3 of COORDINATION.md (apply migrations, deploy scraper, env check)
# behind one command with confirmation prompts.
#
# Modes:
#   pre-flight   Check CLIs + env vars + repo state (read-only)
#   migrations   supabase db push
#   scraper      cd scraper && fly deploy
#   verify       curl the deployed /api/health and pretty-print
#   all          pre-flight → migrations → scraper → verify (with prompts)
#
# Usage:
#   pwsh ./scripts/deploy.ps1 pre-flight
#   pwsh ./scripts/deploy.ps1 migrations
#   pwsh ./scripts/deploy.ps1 scraper
#   pwsh ./scripts/deploy.ps1 verify -HealthUrl https://<prod>.vercel.app/api/health
#   pwsh ./scripts/deploy.ps1 all -Yes        # non-interactive (skip prompts)
#   pwsh ./scripts/deploy.ps1 all -DryRun     # print plan, don't execute

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("pre-flight", "migrations", "scraper", "verify", "all")]
    [string]$Mode = "pre-flight",

    [string]$HealthUrl,
    [switch]$Yes,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# ---- helpers ------------------------------------------------------------

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "── $msg ──" -ForegroundColor Cyan
}

function Test-CliExists([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Test-EnvSet([string]$name) {
    $val = [Environment]::GetEnvironmentVariable($name)
    return -not [string]::IsNullOrWhiteSpace($val)
}

function Confirm-OrAbort([string]$prompt) {
    if ($Yes) { return $true }
    Write-Host ""
    Write-Host "$prompt [y/N]" -ForegroundColor Yellow -NoNewline
    $answer = (Read-Host).Trim().ToLower()
    if ($answer -ne "y" -and $answer -ne "yes") {
        Write-Host "Aborted." -ForegroundColor Red
        return $false
    }
    return $true
}

function Invoke-OrDryRun([string]$label, [scriptblock]$action) {
    if ($DryRun) {
        Write-Host "  [dry-run] would: $label" -ForegroundColor DarkGray
        return
    }
    Write-Host "  running: $label" -ForegroundColor Green
    & $action
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "Step failed (exit $LASTEXITCODE): $label"
    }
}

# ---- mode implementations -----------------------------------------------

function Invoke-PreFlight() {
    Write-Step "Pre-flight checks"

    $required = @(
        @{ Name = "supabase";  Hint = "https://supabase.com/docs/guides/cli (npm i -g supabase)" },
        @{ Name = "flyctl";    Hint = "https://fly.io/docs/flyctl/install/" },
        @{ Name = "git";       Hint = "https://git-scm.com" },
        @{ Name = "npm";       Hint = "bundled with Node 20+" }
    )
    $missing = @()
    foreach ($cli in $required) {
        if (Test-CliExists $cli.Name) {
            Write-Host "  ✓ $($cli.Name)" -ForegroundColor Green
        } else {
            Write-Host "  ✗ $($cli.Name)  — install: $($cli.Hint)" -ForegroundColor Red
            $missing += $cli.Name
        }
    }

    Write-Step "Required env vars (server-side, for production)"
    $envChecks = @(
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "CRON_SECRET"
    )
    foreach ($e in $envChecks) {
        if (Test-EnvSet $e) {
            Write-Host "  ✓ $e" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ $e  — required in Vercel prod env" -ForegroundColor Yellow
        }
    }

    Write-Step "Optional env vars (mock fallback if unset)"
    $optionalChecks = @(
        "BRAVE_SEARCH_KEY",
        "INNGEST_EVENT_KEY",
        "INNGEST_SIGNING_KEY",
        "SCRAPER_URL",
        "SCRAPER_KEY",
        "WHATSAPP_API_URL",
        "WHATSAPP_API_KEY",
        "WHATSAPP_FROM",
        "HUBSPOT_API_KEY",
        "ZOHO_REFRESH_TOKEN",
        "RAZORPAY_KEY_ID",
        "STRIPE_SECRET_KEY"
    )
    foreach ($e in $optionalChecks) {
        if (Test-EnvSet $e) {
            Write-Host "  ✓ $e (real)" -ForegroundColor Green
        } else {
            Write-Host "  · $e (mock)" -ForegroundColor DarkGray
        }
    }

    Write-Step "Repo state"
    $gitStatus = git status --porcelain 2>$null
    if ([string]::IsNullOrWhiteSpace($gitStatus)) {
        Write-Host "  ✓ working tree clean" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ uncommitted changes:" -ForegroundColor Yellow
        Write-Host $gitStatus
    }

    Write-Step "Schema version"
    $migrations = Get-ChildItem (Join-Path $repoRoot "supabase/migrations") -Filter "*.sql" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    if ($migrations.Count -gt 0) {
        Write-Host "  latest: $($migrations[0].Name)" -ForegroundColor Green
        Write-Host "  total : $($migrations.Count) migrations"
    } else {
        Write-Host "  ✗ no migrations found" -ForegroundColor Red
    }

    if ($missing.Count -gt 0) {
        Write-Host ""
        Write-Host "Install the missing CLIs before running deploy steps." -ForegroundColor Red
        return $false
    }
    return $true
}

function Invoke-Migrations() {
    Write-Step "Apply Supabase migrations"
    if (-not (Confirm-OrAbort "About to run 'supabase db push' against the LINKED project. Proceed?")) {
        return
    }
    Invoke-OrDryRun "supabase db push" { supabase db push }
    Write-Host "  ✓ migrations applied" -ForegroundColor Green
}

function Invoke-Scraper() {
    Write-Step "Deploy Playwright scraper to Fly.io"
    $scraperDir = Join-Path $repoRoot "scraper"
    if (-not (Test-Path $scraperDir)) {
        Write-Host "  ✗ scraper/ directory not found" -ForegroundColor Red
        return
    }
    if (-not (Confirm-OrAbort "About to run 'fly deploy' from scraper/. Proceed?")) {
        return
    }
    Push-Location $scraperDir
    try {
        Invoke-OrDryRun "fly deploy" { flyctl deploy }
    } finally {
        Pop-Location
    }
    Write-Host "  ✓ scraper deployed" -ForegroundColor Green
}

function Invoke-Verify() {
    Write-Step "Verify deployed /api/health"
    if (-not $HealthUrl) {
        Write-Host "  ✗ -HealthUrl required (e.g. https://<prod>.vercel.app/api/health)" -ForegroundColor Red
        return
    }
    if ($DryRun) {
        Write-Host "  [dry-run] would: curl $HealthUrl" -ForegroundColor DarkGray
        return
    }
    try {
        $resp = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 15
        $resp | ConvertTo-Json -Depth 4
        if ($resp.ok) {
            Write-Host "  ✓ /api/health reports ok=true" -ForegroundColor Green
        } else {
            Write-Host "  ✗ /api/health reports ok=false — investigate" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ✗ probe failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# ---- dispatch -----------------------------------------------------------

switch ($Mode) {
    "pre-flight" {
        [void](Invoke-PreFlight)
    }
    "migrations" {
        Invoke-Migrations
    }
    "scraper" {
        Invoke-Scraper
    }
    "verify" {
        Invoke-Verify
    }
    "all" {
        $ok = Invoke-PreFlight
        if (-not $ok) {
            Write-Host ""
            Write-Host "Pre-flight failed; aborting 'all'. Fix the issues and re-run." -ForegroundColor Red
            exit 1
        }
        Invoke-Migrations
        Invoke-Scraper
        if ($HealthUrl) { Invoke-Verify }
        else {
            Write-Host ""
            Write-Host "Skipping verify — pass -HealthUrl to run it." -ForegroundColor Yellow
        }
    }
}
