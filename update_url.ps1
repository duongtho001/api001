$ErrorActionPreference = "Continue"
$dir = $env:MYDIR
if (-not $dir) { $dir = (Get-Location).Path }

$appJs = Join-Path $dir "app.js"

if (-not (Test-Path $appJs)) {
    Write-Host "  ERROR: app.js not found at $appJs" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Update API URL & Push to GitHub" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# Read current URL
$content = [System.IO.File]::ReadAllText($appJs, [System.Text.Encoding]::UTF8)
$match = [regex]::Match($content, "const API_URL = '([^']+)'")
if ($match.Success) {
    Write-Host "  Current URL: $($match.Groups[1].Value)" -ForegroundColor Yellow
} else {
    Write-Host "  WARNING: Could not find current API_URL" -ForegroundColor Red
}

Write-Host ""
$newUrl = Read-Host "  Paste new tunnel URL (or press Enter to skip)"

if ([string]::IsNullOrWhiteSpace($newUrl)) {
    Write-Host "  Skipped - no URL change" -ForegroundColor Gray
} else {
    # Remove trailing slash
    $newUrl = $newUrl.TrimEnd('/')
    
    # Replace URL in app.js
    $newContent = $content -replace "const API_URL = '[^']+'", "const API_URL = '$newUrl'"
    [System.IO.File]::WriteAllText($appJs, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host "  Updated: $newUrl" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Pushing to GitHub..." -ForegroundColor Cyan

Set-Location $dir
git add -A
git commit -m "Update API URL $(Get-Date -Format 'HH:mm dd/MM')"
git push origin main 2>&1 | ForEach-Object { Write-Host "  $_" }

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  Trying 'master' branch..." -ForegroundColor Yellow
    git push origin master 2>&1 | ForEach-Object { Write-Host "  $_" }
}

Write-Host ""
Write-Host "  DONE!" -ForegroundColor Green
