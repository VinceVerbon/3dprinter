# Install — 3D Printer Supplies

One-time setup, ~2 minutes.

## Prerequisites

- Windows 10/11
- Node 22+ (`node --version`)
- npm
- Microsoft Edge (or Chrome) for the installable PWA
- Anthropic Claude Code CLI (`claude --version`) — used by the helper for AI filament lookup. Auth is via your Pro/Max subscription; no API key needed.

## First-time setup

```powershell
# 1. Clone (uses the github SSH alias on the local workstation)
git clone https://github.com/VinceVerbon/3dprinter.git <repo-dir>
cd <repo-dir>\app
npm install

# 2. Create the desktop shortcut + (optionally) pin it to the taskbar
cd ..
.\scripts\install-shortcut.ps1
```

Right-click the new "3D Printer Supplies" desktop shortcut → **Pin to taskbar**.

## Running

Click the desktop or taskbar shortcut. It:

1. Starts the Vite dev server (auto-spawns the Node helper as a child process).
2. Waits for both ports to be listening.
3. Opens the app in Edge app-mode (looks like a real installed app — no browser chrome).

Close the Edge window to stop using the app. The helper exits automatically within ~45 s once the heartbeat from the app stops. The Vite dev server stays running until you stop it explicitly (find `node.exe` in Task Manager, or close the Edge dev tools — see "Known limitations" below).

## Known limitations (v0.1)

- The Vite dev server keeps running after you close the app window. To stop it: Task Manager → end the `node.exe` process running on port 5173. (v0.2 will wire it to the heartbeat watchdog too.)
- The shortcut runs `npm run dev` — true production-build mode (`app/dist`) is not supported yet.
- AI filament lookup needs `claude` on PATH and an active Claude Code subscription session. If `claude` isn't installed or isn't logged in, the Lookup AI button fails silently with an error message in the form.

## Troubleshooting

```powershell
# Helper alive?
Invoke-RestMethod http://127.0.0.1:5174/healthz

# Vite alive?
(Invoke-WebRequest http://127.0.0.1:5173/ -UseBasicParsing).StatusCode

# Stop everything (fallback)
Get-Process node | Where-Object { $_.MainWindowTitle -eq '' } | Stop-Process

# Re-run the launcher with verbose console output
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```
