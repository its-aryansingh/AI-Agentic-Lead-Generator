# scripts/coord-push.ps1
#
# Take your local edits to coordination files (COORDINATION.md log
# entries, plan.md updates, etc.) and push them to the private team
# repo so teammates pick them up via coord-pull.
#
# Usage:
#   pwsh ./scripts/coord-push.ps1                       # interactive commit message
#   pwsh ./scripts/coord-push.ps1 -Message "<msg>"      # non-interactive

[CmdletBinding()]
param(
    [string]$Message
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$coordDir = Join-Path $repoRoot ".coord"
$manifestPath = Join-Path $PSScriptRoot "coord-manifest.txt"

if (-not (Test-Path $coordDir)) {
    Write-Error ".coord/ not found — run pwsh ./scripts/coord-init.ps1 first."
    exit 1
}

# Fast-forward .coord first so we push a clean change on top of latest.
Write-Host "Refreshing .coord/ ..." -ForegroundColor Cyan
git -C $coordDir pull --ff-only

# Mirror manifest entries from the working tree INTO .coord/.
$changed = @()
foreach ($line in (Get-Content $manifestPath)) {
    $entry = $line.Trim()
    if (-not $entry -or $entry.StartsWith("#")) { continue }
    $src = Join-Path $repoRoot $entry
    $dst = Join-Path $coordDir $entry
    if (-not (Test-Path $src)) { continue }
    $dstParent = Split-Path -Parent $dst
    if ($dstParent -and -not (Test-Path $dstParent)) {
        New-Item -ItemType Directory -Force -Path $dstParent | Out-Null
    }
    if ((Get-Item $src).PSIsContainer) {
        Copy-Item -Recurse -Force $src $dstParent
    } else {
        Copy-Item -Force $src $dst
    }
    $changed += $entry
}

# Stage + commit + push from inside .coord/.
git -C $coordDir add -A
$diff = git -C $coordDir diff --cached --shortstat
if (-not $diff) {
    Write-Host "Nothing to push — coord is already up to date." -ForegroundColor Yellow
    exit 0
}

if (-not $Message) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $authorName = (git config user.name 2>$null) ?? "team"
    $defaultMsg = "coord sync from $authorName @ $stamp"
    Write-Host "Commit message (default: '$defaultMsg'):" -ForegroundColor Cyan
    $entered = Read-Host "msg"
    if ([string]::IsNullOrWhiteSpace($entered)) { $Message = $defaultMsg } else { $Message = $entered }
}

git -C $coordDir commit -m $Message
git -C $coordDir push

Write-Host ""
Write-Host "Pushed:" -ForegroundColor Cyan
foreach ($f in $changed) { Write-Host "  $f" }
Write-Host "Teammates pull with: pwsh ./scripts/coord-pull.ps1"
