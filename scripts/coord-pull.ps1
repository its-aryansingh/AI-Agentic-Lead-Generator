# scripts/coord-pull.ps1
#
# Fetch the latest team coordination from the private companion repo
# and copy the manifest files into the working tree. Run before any
# agent work so you have everyone else's latest claims and log entries.
#
# Usage:
#   pwsh ./scripts/coord-pull.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$coordDir = Join-Path $repoRoot ".coord"
$manifestPath = Join-Path $PSScriptRoot "coord-manifest.txt"

if (-not (Test-Path $coordDir)) {
    Write-Error ".coord/ not found — run pwsh ./scripts/coord-init.ps1 first."
    exit 1
}
if (-not (Test-Path $manifestPath)) {
    Write-Error "Missing scripts/coord-manifest.txt."
    exit 1
}

Write-Host "Pulling .coord/ ..." -ForegroundColor Cyan
git -C $coordDir pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Error "git pull failed in .coord/ — resolve manually."
    exit 1
}

$copied = 0; $skipped = 0
foreach ($line in (Get-Content $manifestPath)) {
    $entry = $line.Trim()
    if (-not $entry -or $entry.StartsWith("#")) { continue }
    $src = Join-Path $coordDir $entry
    $dst = Join-Path $repoRoot $entry
    if (-not (Test-Path $src)) {
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
    Write-Host "  pull   $entry" -ForegroundColor Green
    $copied++
}

Write-Host "Pulled — $copied file(s)/dir(s), $skipped skipped." -ForegroundColor Cyan
