# watch-commit.ps1
# Auto-commit watcher — runs as a background VS Code task.
# Polls git status every 45 seconds. If uncommitted changes exist,
# stages and commits them automatically. post-commit hook then auto-pushes.
#
# Skips: node_modules, .next, .git, build artifacts, lock file-only changes.
# Never commits: .env.local, secrets.

param(
    [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot),
    [int]$IntervalSeconds = 45
)

Set-Location $ProjectPath

$ignoreOnlyPatterns = @(
    "^[AMD ]. package-lock\.json$",
    "^[AMD ]. yarn\.lock$",
    "^[AMD ]. pnpm-lock\.yaml$",
    "^[AMD ]. \.next[/\\]",
    "^[AMD ]. tsconfig\.tsbuildinfo$"
)

function Get-MeaningfulStatus {
    $lines = git status --porcelain 2>$null
    if (-not $lines) { return $null }
    $meaningful = $lines | Where-Object {
        $line = $_.Trim()
        foreach ($pat in $ignoreOnlyPatterns) {
            if ($line -match $pat) { return $false }
        }
        return $true
    }
    return $meaningful
}

function Get-CommitMessage {
    param([string[]]$StatusLines)
    $added    = ($StatusLines | Where-Object { $_ -match "^A" }).Count
    $modified = ($StatusLines | Where-Object { $_ -match "^.M" }).Count
    $deleted  = ($StatusLines | Where-Object { $_ -match "^.D" }).Count
    $total    = $StatusLines.Count
    $time     = Get-Date -Format "HH:mm"

    # Sample up to 3 filenames for the message
    $names = $StatusLines | ForEach-Object { ($_ -split "\s+", 2)[1] } | Select-Object -First 3
    $nameStr = ($names | ForEach-Object { Split-Path -Leaf $_ }) -join ", "
    if ($total -gt 3) { $nameStr += " +$($total - 3) more" }

    $parts = @()
    if ($added    -gt 0) { $parts += "$added added" }
    if ($modified -gt 0) { $parts += "$modified modified" }
    if ($deleted  -gt 0) { $parts += "$deleted deleted" }
    $summary = $parts -join ", "

    return "auto: $nameStr [$summary] $time"
}

Write-Host ""
Write-Host "  Auto-commit watcher active — polling every ${IntervalSeconds}s"
Write-Host "  Project: $ProjectPath"
Write-Host "  Every commit auto-pushes via .githooks/post-commit"
Write-Host ""

while ($true) {
    Start-Sleep -Seconds $IntervalSeconds

    # Skip if another git operation is running
    if (Test-Path "$ProjectPath\.git\index.lock") { continue }

    $meaningful = Get-MeaningfulStatus
    if (-not $meaningful) { continue }

    # Exclude .env.local from staging (pre-commit hook also guards this)
    git add -A -- ':!.env.local' ':!*.key' ':!*.pem' 2>$null

    # Only commit if there's something staged
    $staged = git diff --cached --name-only 2>$null
    if (-not $staged) { continue }

    $msg = Get-CommitMessage -StatusLines $meaningful
    $result = git commit -m $msg 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ $msg"
    } else {
        # Pre-commit hook may have blocked it — log but don't crash
        Write-Host "  ⚠ auto-commit blocked: $($result | Select-Object -Last 2)"
        git reset HEAD 2>$null  # unstage so we retry next cycle
    }
}
