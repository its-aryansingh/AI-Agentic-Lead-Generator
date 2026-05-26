# scripts/coord-init.ps1
#
# First-run setup of the private team-coordination companion repo.
# After running, the working tree contains COORDINATION.md, CLAUDE.md,
# plan.md, etc. — synced from a PRIVATE GitHub repo that you control.
# These files are gitignored in this (public) repo, so they never leak.
#
# Usage:
#   pwsh ./scripts/coord-init.ps1                            # interactive prompt
#   pwsh ./scripts/coord-init.ps1 -RepoUrl <git@github.com:owner/repo.git>
#   pwsh ./scripts/coord-init.ps1 -RepoUrl <url> -Force      # re-clone if .coord/ exists
#
# Idempotent: re-running upgrades to the latest coord without re-prompting.

[CmdletBinding()]
param(
    [string]$RepoUrl,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$coordDir = Join-Path $repoRoot ".coord"
$manifestPath = Join-Path $PSScriptRoot "coord-manifest.txt"

if (-not (Test-Path $manifestPath)) {
    Write-Error "Missing scripts/coord-manifest.txt — cannot determine which files to sync."
    exit 1
}

# Resolve the private repo URL: arg → existing remote → prompt → cache.
$urlCachePath = Join-Path $repoRoot ".coord-url"
if (-not $RepoUrl) {
    if (Test-Path (Join-Path $coordDir ".git")) {
        $RepoUrl = (git -C $coordDir remote get-url origin 2>$null).Trim()
    }
    if (-not $RepoUrl -and (Test-Path $urlCachePath)) {
        $RepoUrl = (Get-Content $urlCachePath -Raw).Trim()
    }
    if (-not $RepoUrl) {
        Write-Host "Private coord repo URL (e.g. git@github.com:your-org/leadgenai-coord.git):" -ForegroundColor Cyan
        $RepoUrl = (Read-Host "URL").Trim()
    }
}
if (-not $RepoUrl) {
    Write-Error "No private repo URL provided."
    exit 1
}

# Clone / refresh .coord/
if ($Force -and (Test-Path $coordDir)) {
    Write-Host "[-Force] Removing existing .coord/" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $coordDir
}
if (-not (Test-Path $coordDir)) {
    Write-Host "Cloning $RepoUrl -> .coord/" -ForegroundColor Cyan
    git clone --depth=1 $RepoUrl $coordDir
    if ($LASTEXITCODE -ne 0) {
        Write-Error "git clone failed. Check the URL and your GitHub access."
        exit 1
    }
} else {
    Write-Host ".coord/ already exists — pulling latest" -ForegroundColor Cyan
    git -C $coordDir pull --ff-only
}

# Cache the URL so future runs don't re-prompt.
$RepoUrl | Out-File -FilePath $urlCachePath -Encoding utf8 -NoNewline

# Apply the manifest: copy each entry from .coord/ to the working tree.
$copied = 0; $skipped = 0
foreach ($line in (Get-Content $manifestPath)) {
    $entry = $line.Trim()
    if (-not $entry -or $entry.StartsWith("#")) { continue }
    $src = Join-Path $coordDir $entry
    $dst = Join-Path $repoRoot $entry
    if (-not (Test-Path $src)) {
        Write-Host "  skip   $entry (not in private repo)" -ForegroundColor DarkGray
        $skipped++
        continue
    }
    $dstParent = Split-Path -Parent $dst
    if ($dstParent -and -not (Test-Path $dstParent)) {
        New-Item -ItemType Directory -Force -Path $dstParent | Out-Null
    }
    if ((Get-Item $src).PSIsContainer) {
        Copy-Item -Recurse -Force $src $dstParent
    } else {
        Copy-Item -Force $src $dst
    }
    Write-Host "  copy   $entry" -ForegroundColor Green
    $copied++
}

# Activate the .githooks/ dir if it was synced in.
if (Test-Path (Join-Path $repoRoot ".githooks")) {
    git config core.hooksPath .githooks | Out-Null
    Write-Host "  hooks  core.hooksPath = .githooks" -ForegroundColor Green
}

Write-Host ""
Write-Host "Coordination synced — $copied file(s)/dir(s) copied, $skipped skipped." -ForegroundColor Cyan
Write-Host "Next:"
Write-Host "  - Read COORDINATION.md before any agent work"
Write-Host "  - pwsh ./scripts/coord-pull.ps1   to fetch teammate updates"
Write-Host "  - pwsh ./scripts/coord-push.ps1   to share your edits with the team"
