param(
  [string]$App = "",
  [string]$CodexBin = "",
  [string]$LauncherName = "",
  [switch]$Relaunch
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Fail([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

try {
  $nodeVersion = (& node -v 2>$null)
} catch {
  Fail "Node.js 22+ is required. Install it from https://nodejs.org/"
}

if (-not $nodeVersion) {
  Fail "Node.js 22+ is required. Install it from https://nodejs.org/"
}

$major = [int](($nodeVersion -replace '^v','').Split('.')[0])
if ($major -lt 22) {
  Fail "Node.js 22+ is required. Current version: $nodeVersion"
}

Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
Write-Host "Running environment check..."
& node "$Root\bin\chatgpt-usage.js" doctor
Write-Host ""

$args = @("$Root\bin\chatgpt-usage.js", "install")
if ($App) { $args += @("--app", $App) }
if ($CodexBin) { $args += @("--codex-bin", $CodexBin) }
if ($LauncherName) { $args += @("--launcher-name", $LauncherName) }
if ($Relaunch) { $args += "--relaunch" }

& node @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Installation complete." -ForegroundColor Green
Write-Host "Close ChatGPT/Codex completely, then launch the '(Usage)' shortcut from the Start menu."
