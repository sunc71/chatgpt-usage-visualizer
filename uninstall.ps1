param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

try {
  & node "$Root\bin\chatgpt-usage.js" uninstall
  exit $LASTEXITCODE
} catch {
  Write-Host "Uninstall failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
