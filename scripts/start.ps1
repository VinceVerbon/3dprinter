<#
.SYNOPSIS
  Launcher for the 3dprinter app. Pin this to the taskbar.

.DESCRIPTION
  Starts the helper service + Vite dev server (in dev mode) and opens the PWA in
  Edge app-mode so it looks like an installed app. The helper has a heartbeat
  watchdog — closing the Edge window stops heartbeats and the helper self-exits
  within ~45 s.

  Re-running this while the app is already up is a no-op (we detect a live
  helper at /healthz and skip).

.PARAMETER Prod
  Use prebuilt app/dist instead of `npm run dev`. v0.1 only supports dev mode;
  this flag is reserved for future use.
#>
[CmdletBinding()]
param(
  [switch]$Prod
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $repoRoot 'app'
$helperEntry = Join-Path $repoRoot 'helper\index.mjs'

# --- 1. Sanity ---
foreach ($cmd in 'node','npm','claude') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "Missing required command on PATH: $cmd"
    exit 1
  }
}
if (-not (Test-Path $helperEntry)) {
  Write-Error "Helper entry not found: $helperEntry"
  exit 1
}
if (-not (Test-Path $appDir)) {
  Write-Error "App dir not found: $appDir"
  exit 1
}

# --- 2. Already running? ---
$helperUp = $false
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/healthz' -TimeoutSec 1 -ErrorAction Stop
  if ($r.ok) { $helperUp = $true; Write-Host "[start] helper already running" }
} catch { }

$viteUp = $false
try {
  $null = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
  $viteUp = $true; Write-Host "[start] vite dev server already running"
} catch { }

# --- 3. Spawn dev server (which auto-spawns the helper via vite plugin) ---
if (-not $viteUp) {
  Write-Host "[start] spawning npm run dev in $appDir"
  $npmCmd = (Get-Command npm).Source
  Start-Process -FilePath $npmCmd `
    -ArgumentList 'run','dev' `
    -WorkingDirectory $appDir `
    -WindowStyle Hidden `
    -PassThru | Out-Null
}
elseif (-not $helperUp) {
  # Vite is up but helper isn't (rare — usually means helper crashed). Spawn helper directly.
  Write-Host "[start] spawning helper directly (vite running but helper not)"
  Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList $helperEntry `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -PassThru | Out-Null
}

# --- 4. Wait for both to come up ---
$maxWait = 30
$start = Get-Date
while (((Get-Date) - $start).TotalSeconds -lt $maxWait) {
  $helperReady = $false
  $viteReady = $false
  try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:5174/healthz' -TimeoutSec 1; if ($r.ok) { $helperReady = $true } } catch { }
  try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -TimeoutSec 1 -UseBasicParsing; $viteReady = $true } catch { }
  if ($helperReady -and $viteReady) { break }
  Start-Sleep -Milliseconds 500
}

if (-not $helperReady) { Write-Warning "[start] helper not responding after ${maxWait}s; opening anyway" }
if (-not $viteReady) { Write-Warning "[start] vite dev server not responding after ${maxWait}s; opening anyway" }

# --- 5. Launch the PWA in Edge app-mode (fallback to Chrome) ---
$edge = Get-Command msedge.exe -ErrorAction SilentlyContinue
$chrome = Get-Command chrome.exe -ErrorAction SilentlyContinue
if ($edge) {
  Start-Process -FilePath $edge.Source -ArgumentList '--app=http://127.0.0.1:5173/'
}
elseif ($chrome) {
  Start-Process -FilePath $chrome.Source -ArgumentList '--app=http://127.0.0.1:5173/'
}
else {
  Write-Warning "[start] neither msedge.exe nor chrome.exe found — opening default browser"
  Start-Process 'http://127.0.0.1:5173/'
}

# Exit. Helper + Vite continue in the background. Closing the Edge window stops
# heartbeats; the helper auto-exits within ~45 s. Vite stays up until you stop
# it explicitly (Ctrl-C in its console — but it's hidden, so use Task Manager
# or the install-shortcut "Stop" action in v0.2).
exit 0
