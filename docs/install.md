# Install — Haspel

Haspel ships as a **native Windows app** (Tauri). For most people there's nothing
to build — just run the installer.

## Install the app (end users)

**Prerequisites:** Windows 10/11. WebView2 runtime (preinstalled on Windows 11;
on Windows 10 it usually arrives via Edge / Windows Update).

1. Get a release build:
   - `Haspel_<version>_x64_en-US.msi` — per-machine (asks for admin), or
   - `Haspel_<version>_x64-setup.exe` — per-user (no admin).
2. Run it and launch **Haspel** from the Start menu (or its desktop shortcut).

That's it. The app starts its own background helper automatically — **no
PowerShell, no terminal, no tray icon**. Closing the window stops everything.

- **Your data** lives at `%APPDATA%\Haspel\data\` and **survives reinstalls**.
- **Uninstall** from Windows "Apps" (or the bundled `uninstall.exe`); your data
  directory is left intact.

### AI filament lookup (optional)

The AI features work through a configurable backend — open **Settings → AI
provider**:

- **Claude CLI** (default) — uses your own Claude Pro/Max subscription via the
  locally-installed `claude` CLI (`claude --version`). No API key, no extra cost.
- **Anthropic / OpenAI / Gemini / OpenRouter** — paste an API key (stored only in
  your per-install `settings.json`).
- **None** — manual entry only; the AI buttons are hidden.

If no provider is configured/available, the rest of the app works fine — you just
fill filament details by hand.

## Build from source (developers)

**Prerequisites:** Node 22+, npm, Rust (`rustup`, stable-msvc) + VS Build Tools
(C++ workload), WebView2. See `docs/tauri-packaging.md` for the full setup.

```powershell
git clone https://github.com/VinceVerbon/3dprinter.git
cd 3dprinter/app
npm install

# Build the installer (sidecar + .msi/.exe):
npm run app:build      # → src-tauri/target/release/bundle/{msi,nsis}/

# Or run it in dev:
npm run dev            # Vite on :5173, auto-spawns the helper on :5174
npm run app:dev        # the Tauri window against the live dev server
```

`scripts/start.ps1` is the legacy dev/PWA launcher (opens the dev build in an Edge
`--app` window). It's a developer convenience only — the installed native app does
not use it.

## Troubleshooting

- **Data shows "helper unreachable / Failed to fetch":** the background helper
  isn't responding. Close and relaunch Haspel — it spawns a fresh helper on
  startup. (Don't run a dev instance and the installed app at the same time — both
  use port `127.0.0.1:5174`.)
- **Check the helper directly:**
  ```powershell
  Invoke-RestMethod http://127.0.0.1:5174/healthz
  ```
- **AI lookup fails:** confirm a provider in Settings → AI provider. For the Claude
  CLI option, `claude --version` must work and you must be logged in
  (`claude` Pro/Max session). Use **Test connection** in Settings.
- **Where's my data?** Settings shows the resolved data directory
  (`%APPDATA%\Haspel\data\`). To start fresh, close the app and clear that folder.
