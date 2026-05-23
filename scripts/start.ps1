<#
.SYNOPSIS
  Launcher for the 3dprinter app. Pin this to the taskbar.

.DESCRIPTION
  Starts the helper service + Vite dev server (in dev mode) and opens the PWA in
  Edge app-mode so it looks like an installed app. In dev mode the helper's
  lifetime tracks the vite process (vite spawns and reaps it), so it stays alive
  the whole session and exits when vite stops — closing just the Edge window no
  longer kills it. (Standalone helper falls back to a generous heartbeat
  watchdog.)

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
  # Start-Process cannot launch .ps1 directly; prefer npm.cmd over the npm.ps1 shim.
  $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
  if (-not $npmCmd) { $npmCmd = Get-Command npm }
  Start-Process -FilePath $npmCmd.Source `
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
function Resolve-Browser {
  param([string]$Exe, [string[]]$Candidates)
  $cmd = Get-Command $Exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in $Candidates) { if (Test-Path $p) { return $p } }
  return $null
}

$edgePath = Resolve-Browser -Exe 'msedge.exe' -Candidates @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$chromePath = Resolve-Browser -Exe 'chrome.exe' -Candidates @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)

if ($edgePath) {
  Start-Process -FilePath $edgePath -ArgumentList '--app=http://127.0.0.1:5173/'
}
elseif ($chromePath) {
  Start-Process -FilePath $chromePath -ArgumentList '--app=http://127.0.0.1:5173/'
}
else {
  Write-Warning "[start] neither msedge.exe nor chrome.exe found — opening default browser"
  Start-Process 'http://127.0.0.1:5173/'
}

# Exit. Helper + Vite continue in the background. Closing just the Edge window
# leaves both running (the helper is tied to vite's lifetime, not the PWA tab,
# so AI lookups keep working when you reopen the window). To stop everything,
# kill the hidden vite process (Task Manager, or the install-shortcut "Stop"
# action) — the helper exits with it.
exit 0
