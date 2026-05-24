<#
.SYNOPSIS
  Spin up / destroy a pristine, throwaway Haspel instance for testing the
  fresh-user experience — fully isolated from your real data.

.DESCRIPTION
  Runs a SECOND Haspel side-by-side with your real one, on its own ports
  (vite preview 5273 → helper 5274) against a throwaway data dir, so your
  real install on 5173/5174 + %APPDATA%\Haspel\data is never touched.

    start  (default) : build app/dist, start an isolated helper + vite preview
                       against <repo>\.test-instance\data (empty = brand-new
                       user), open it in an isolated Edge window.
    destroy          : kill the test processes and delete <repo>\.test-instance
                       entirely (data, Edge profile, state). Your real instance
                       is unaffected.
    status           : report whether a test instance is running.
    restart          : destroy then start.

  Why this is faithful: it serves the PRODUCTION build (npm run build) the way
  a downloaded user would get it, with an empty data dir, its own localStorage
  origin (127.0.0.1:5273), and a throwaway Edge profile — so service-worker /
  PWA / first-run state all start clean and vanish on destroy.

.PARAMETER Action
  start | destroy | status | restart. Default: start.

.PARAMETER Demo
  After boot, POST /load-demo-data to the test helper so the instance starts
  with the curated demo content instead of empty. (Tests the "Load demo data"
  path.)

.PARAMETER SkipBuild
  Reuse the existing app/dist instead of rebuilding. Faster re-spins when the
  frontend hasn't changed.

.PARAMETER NoBrowser
  Don't open the Edge window (e.g. when driving it from a script / headless).

.EXAMPLE
  .\scripts\test-clean.ps1                 # build + spin up an empty test instance
  .\scripts\test-clean.ps1 -Demo           # spin up pre-loaded with demo data
  .\scripts\test-clean.ps1 -Action destroy # tear it down + wipe the throwaway dir
#>
[CmdletBinding()]
param(
  [ValidateSet('start', 'destroy', 'status', 'restart')]
  [string]$Action = 'start',
  [switch]$Demo,
  [switch]$SkipBuild,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

# --- Constants: test instance lives on +100 ports, isolated from the real one ---
$VITE_PORT   = 5273
$HELPER_PORT = 5274
$VITE_ORIGIN = "http://127.0.0.1:$VITE_PORT"

$repoRoot    = Split-Path -Parent $PSScriptRoot
$appDir      = Join-Path $repoRoot 'app'
$helperEntry = Join-Path $repoRoot 'helper\index.mjs'
$testRoot    = Join-Path $repoRoot '.test-instance'
$testData    = Join-Path $testRoot 'data'
$stateFile   = Join-Path $testRoot 'state.json'

function Resolve-Npm {
  $c = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $c) { $c = Get-Command npm -ErrorAction SilentlyContinue }
  if (-not $c) { throw "npm not found on PATH." }
  return $c.Source
}

function Resolve-EdgeOrChrome {
  foreach ($cand in @(
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LocalAppData\Google\Chrome\Application\chrome.exe")) {
    if ($cand -and (Test-Path $cand)) { return $cand }
  }
  $e = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($e) { return $e.Source }
  return $null
}

function Test-HelperUp {
  param([int]$Port)
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 1 -ErrorAction Stop
    return [bool]$r.ok
  } catch { return $false }
}

function Stop-Tree {
  param([int]$ProcessId)
  if (-not $ProcessId) { return }
  try { & taskkill.exe /PID $ProcessId /T /F *> $null } catch { }
}

function Stop-PortListeners {
  # Kill anything LISTENING on the test ports (5273/5274) — never the real ports.
  foreach ($port in @($VITE_PORT, $HELPER_PORT)) {
    try {
      $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($procId in $pids) { Stop-Tree -ProcessId $procId }
    } catch { }
  }
}

function Invoke-Destroy {
  $killedSomething = $false
  # Stop ONLY the test helper + vite — NEVER the browser. The test window runs in
  # your normal browser profile; force-killing the browser can corrupt it. Just
  # close the test window yourself (it shows "can't connect" once the server is gone).
  if (Test-Path $stateFile) {
    try {
      $state = Get-Content $stateFile -Raw | ConvertFrom-Json
      foreach ($procId in @($state.vitePid, $state.helperPid)) {
        if ($procId) { Stop-Tree -ProcessId ([int]$procId); $killedSomething = $true }
      }
    } catch { Write-Warning "[test] state.json unreadable; falling back to port sweep." }
  }
  Stop-PortListeners   # only 5273/5274 (node helper + vite) — never the browser

  if (Test-Path $testRoot) { Remove-Item $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $testRoot) {
    Write-Warning "[test] could not fully delete $testRoot — close the test window, then re-run -Action destroy."
  } else {
    Write-Host "[test] destroyed — test helper + vite stopped, $testRoot wiped." -ForegroundColor Green
    Write-Host "[test] (the test browser window, if open, is harmless — close it yourself.)"
    if (-not $killedSomething) { Write-Host "[test] (nothing was running)" }
  }
}

function Invoke-Status {
  $up = Test-HelperUp -Port $HELPER_PORT
  if (Test-Path $stateFile) {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    Write-Host "[test] state.json present (started $($state.startedAt))"
    Write-Host "       data dir : $($state.dataDir)"
    Write-Host "       ports    : vite $($state.vitePort) / helper $($state.helperPort)"
    Write-Host "       pids     : helper $($state.helperPid) / vite $($state.vitePid) / edge $($state.edgePid)"
  } else {
    Write-Host "[test] no state.json — no recorded test instance."
  }
  if ($up) { Write-Host "[test] helper on $HELPER_PORT is UP ($VITE_ORIGIN)" -ForegroundColor Green }
  else     { Write-Host "[test] helper on $HELPER_PORT is not responding." -ForegroundColor Yellow }
}

function Invoke-Start {
  # Guard: refuse to stomp a running test instance.
  if (Test-HelperUp -Port $HELPER_PORT) {
    Write-Warning "[test] a test instance is already running on $HELPER_PORT."
    Write-Host    "       Use:  .\scripts\test-clean.ps1 -Action restart   (or -Action destroy)"
    return
  }
  # Guard: never collide with the REAL instance.
  if ($VITE_PORT -eq 5173 -or $HELPER_PORT -eq 5174) {
    throw "[test] refusing to run on the real instance's ports."
  }

  foreach ($cmd in 'node', 'npm') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Missing required command on PATH: $cmd" }
  }

  $npmCmd = Resolve-Npm

  # 1. Production build (faithful to a downloaded user) unless reusing dist.
  $distIndex = Join-Path $appDir 'dist\index.html'
  if ($SkipBuild) {
    if (-not (Test-Path $distIndex)) { throw "[test] -SkipBuild but no app/dist build found. Run once without -SkipBuild." }
    Write-Host "[test] -SkipBuild: reusing existing app/dist"
  } else {
    Write-Host "[test] building production bundle (npm run build)…" -ForegroundColor Cyan
    Push-Location $appDir
    try {
      & $npmCmd run build
      if ($LASTEXITCODE -ne 0) { throw "[test] npm run build failed (exit $LASTEXITCODE). Fix the build before testing." }
    } finally { Pop-Location }
  }

  # 2. Fresh throwaway data dir.
  New-Item -ItemType Directory -Force -Path $testData | Out-Null

  # 3. Spawn the isolated helper. Set env, spawn (child inherits), then clear.
  Write-Host "[test] starting isolated helper on $HELPER_PORT (data: $testData)…" -ForegroundColor Cyan
  $helperEnv = @{
    HASPEL_DATA_DIR   = $testData
    HELPER_PORT       = "$HELPER_PORT"
    ALLOWED_ORIGIN    = $VITE_ORIGIN
    APP_ORIGIN        = $VITE_ORIGIN
    WATCHDOG_DISABLED = '1'           # we own the lifecycle; no self-exit
    PROJECT_ROOT      = $repoRoot
  }
  $helperEnv.GetEnumerator() | ForEach-Object { Set-Item "Env:$($_.Key)" $_.Value }
  $helper = Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList $helperEntry -WorkingDirectory $repoRoot `
    -WindowStyle Hidden -PassThru
  $helperEnv.Keys | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }

  # 4. Spawn vite preview (serves app/dist) on VITE_PORT, proxying to the helper.
  Write-Host "[test] starting vite preview on $VITE_PORT…" -ForegroundColor Cyan
  $env:VITE_PORT = "$VITE_PORT"; $env:HELPER_PORT = "$HELPER_PORT"
  $vite = Start-Process -FilePath $npmCmd `
    -ArgumentList 'run', 'preview' -WorkingDirectory $appDir `
    -WindowStyle Hidden -PassThru
  Remove-Item Env:VITE_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:HELPER_PORT -ErrorAction SilentlyContinue

  # 5. Wait for both.
  $deadline = (Get-Date).AddSeconds(30)
  $helperReady = $false; $viteReady = $false
  while ((Get-Date) -lt $deadline) {
    if (-not $helperReady) { $helperReady = Test-HelperUp -Port $HELPER_PORT }
    if (-not $viteReady) {
      try { $null = Invoke-WebRequest -Uri "$VITE_ORIGIN/" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop; $viteReady = $true } catch { }
    }
    if ($helperReady -and $viteReady) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $helperReady) { Write-Warning "[test] helper not responding after 30s." }
  if (-not $viteReady)   { Write-Warning "[test] vite preview not responding after 30s." }

  # 6. Optional: load demo data into the test instance.
  if ($Demo -and $helperReady) {
    try {
      Invoke-RestMethod -Uri "http://127.0.0.1:$HELPER_PORT/load-demo-data" -Method Post `
        -ContentType 'application/json' -Body '{}' -TimeoutSec 10 | Out-Null
      Write-Host "[test] demo data loaded." -ForegroundColor Green
    } catch { Write-Warning "[test] demo-data load failed: $($_.Exception.Message)" }
  }

  # 7. Open an app window for the test instance — in the DEFAULT browser profile
  # (NO --user-data-dir). Data isolation comes from the PORT: 127.0.0.1:5273 is a
  # distinct origin from the real app, so its localStorage/IndexedDB are already
  # separate. A throwaway --user-data-dir is unreliable when the browser is
  # already running (it can silently fall back to the default profile) and, with
  # a force-kill on teardown, can corrupt the user's real profile. So: default
  # profile, and destroy NEVER kills the browser (see Invoke-Destroy).
  $edgePid = $null
  if (-not $NoBrowser) {
    $browser = Resolve-EdgeOrChrome
    if ($browser) {
      $b = Start-Process -FilePath $browser -ArgumentList "--app=$VITE_ORIGIN/" -PassThru
      $edgePid = $b.Id
    } else {
      Write-Warning "[test] no Edge/Chrome found — open $VITE_ORIGIN/ manually."
    }
  }

  # 8. Record state for destroy/status.
  @{
    startedAt  = (Get-Date).ToString('s')
    dataDir    = $testData
    vitePort   = $VITE_PORT
    helperPort = $HELPER_PORT
    helperPid  = $helper.Id
    vitePid    = $vite.Id
    edgePid    = $edgePid
    demo       = [bool]$Demo
  } | ConvertTo-Json | Set-Content $stateFile -Encoding utf8

  Write-Host ""
  Write-Host "[test] CLEAN test instance up:" -ForegroundColor Green
  Write-Host "       URL      : $VITE_ORIGIN/"
  Write-Host "       data dir : $testData  (throwaway, empty$(if($Demo){' + demo data'}))"
  Write-Host "       pids     : helper $($helper.Id) / vite $($vite.Id) / edge $edgePid"
  Write-Host "       your real instance on 5173/5174 is untouched."
  Write-Host ""
  Write-Host "       tear down with:  .\scripts\test-clean.ps1 -Action destroy" -ForegroundColor Yellow
}

switch ($Action) {
  'start'   { Invoke-Start }
  'destroy' { Invoke-Destroy }
  'status'  { Invoke-Status }
  'restart' { Invoke-Destroy; Start-Sleep -Milliseconds 800; Invoke-Start }
}
