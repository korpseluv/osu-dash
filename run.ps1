<#
Installer/updater for osu-dash (Windows PowerShell)
Logs to startup.log. Interactive prompts with Yes/No.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$LogFile = "startup.log"
$MarkerFile = ".osu-dash-installed"

function Write-Info([string]$m){ Write-Host "[INFO] " -NoNewline; Write-Host $m -ForegroundColor Cyan }
function Write-Ok([string]$m){ Write-Host "[OK] " -NoNewline; Write-Host $m -ForegroundColor Green }
function Write-Err([string]$m){ Write-Host "[ERROR] " -NoNewline; Write-Host $m -ForegroundColor Red }

function Run-Log([string]$title, [scriptblock]$script){
  Write-Info $title
  "--- $(Get-Date -Format o) - $title" | Out-File -FilePath $LogFile -Append
  try {
    & $script *>&1 | Out-File -FilePath $LogFile -Append
    Write-Ok $title
  } catch {
    "--- FAILURE: $title" | Out-File -FilePath $LogFile -Append
    Write-Err "$title failed. See $LogFile for details."
    throw
  }
}

function Prompt-YesNo([string]$prompt){
  Write-Host "`n$prompt" -ForegroundColor Yellow
  while ($true) {
    $k = Read-Host "Type Y or N"
    if ($k -match '^[yY]') { return $true }
    if ($k -match '^[nN]') { return $false }
  }
}

if (-not (Test-Path $LogFile)) { New-Item -Path $LogFile -ItemType File -Force | Out-Null }

Write-Info "Starting installer — logging to $LogFile"

# Determine Node target from package.json engines or .nvmrc
$TargetNode = ""
if (Test-Path package.json) {
  try { $p = Get-Content package.json -Raw | ConvertFrom-Json; $TargetNode = $p.engines.node }
  catch { }
}
if (-not $TargetNode -and (Test-Path .nvmrc)) { $TargetNode = Get-Content .nvmrc -Raw }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Info "Node not found on PATH"
  if (Prompt-YesNo "Install Node via nvm-windows or download installer?") {
    Write-Info "Please install Node.js (https://nodejs.org/) or nvm-windows and re-run this script."; exit 1
  } else { Write-Err "Node required — aborting"; exit 1 }
} else {
  $CurrentNode = (& node -v).TrimStart('v')
  Write-Info "Current Node: $CurrentNode"
}

if (-not (Test-Path $MarkerFile)) {
  if (Test-Path package-lock.json) { Run-Log "Installing dependencies (clean)" { npm ci } }
  else { Run-Log "Installing dependencies" { npm install } }

  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Run-Log "Installing pm2 globally" { npm install -g pm2 }
  }

  if (Test-Path ecosystem.config.cjs -or Test-Path ecosystem.config.js) {
    Run-Log "Starting app via pm2" { pm2 start ecosystem.config.cjs --update-env }
    Run-Log "Saving pm2 process list" { pm2 save }
  }

  "installed_at: $(Get-Date -Format o)`nnode: $((node -v) -as [string])`nlog: $LogFile" | Out-File -FilePath $MarkerFile -Encoding utf8
  Write-Ok "Initial setup complete"
} else { Write-Ok "Initial setup already performed; skipping installs." }

# Always check updates
$old = git rev-parse HEAD
Run-Log "Fetching updates" { git fetch --all --prune }
Run-Log "Pulling latest changes" { git pull }
$new = git rev-parse HEAD
if ($old -ne $new) {
  Write-Ok "Repository updated from $old to $new"
  $changed = git diff --name-only $old $new
  Add-Content -Path $LogFile -Value $changed
  if ($changed -match "package(-lock)?\.json|pnpm-lock.yaml|yarn.lock") { Run-Log "Dependencies changed: running npm ci" { npm ci } }
  if (Get-Command pm2 -ErrorAction SilentlyContinue) { Run-Log "Reloading application via pm2" { pm2 reload ecosystem.config.cjs --update-env } }
} else { Write-Info "No updates found." }

Write-Ok "Done — see $LogFile for full output"
