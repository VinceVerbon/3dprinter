# Getting started

This chapter covers installing Haspel, launching it, what happens while it runs,
and where your data is kept. Most of this is a one-time setup — after that,
starting the app is a single click.

## What you need

- **Windows 10 or 11.**
- **Microsoft Edge** (or Google Chrome) — the app opens in a clean, app-style
  window using one of these.
- **Node.js 22 or newer** — the small background service that saves your data and
  runs look-ups is built on Node.
- **The Claude CLI**, signed in — *only* if you want the free AI look-ups. This is
  optional; you can run Haspel with AI turned off, or with a different provider.
  See [AI and providers](03-ai-and-providers.md).

## Installing (one time)

The app is installed from its repository. In a PowerShell window:

```powershell
# 1. Get the app
git clone https://github.com/VinceVerbon/3dprinter.git
cd 3dprinter\app
npm install

# 2. Create a desktop shortcut
cd ..
.\scripts\install-shortcut.ps1
```

That creates a **Haspel** shortcut on your Desktop. Right-click it and choose
**Pin to taskbar** so it's always one click away.

## Launching

Click the **Haspel** shortcut (Desktop or taskbar). Behind the scenes it:

1. Starts the background service.
2. Waits until everything is ready.
3. Opens Haspel in its own window — no address bar, no browser tabs, so it looks
   and feels like a normal desktop app.

When you're done, just **close the window**. The background service notices the
app is gone and shuts itself down automatically a short time later. There's no
tray icon to hunt for and nothing to stop by hand.

## First run — loading example data

A fresh install starts empty. If you'd like some example content to explore the
interface before entering your own, open **Settings** and use **Load demo
data**. It adds a handful of example filaments and an accessory.

- It's safe to click on a fresh install — it **skips any list you've already
  filled in**, so it won't overwrite real data.
- If you later want to replace what you have with the examples, tick **"Also
  overwrite files I've already populated"** first.

To start over clean, you can clear the lists from within the app (remove
filaments, etc.) — removed filaments are kept in [History](10-filament-history.md) so nothing is truly
lost.

## Where your data is stored

Everything you enter — filaments, accessories, shopping list, empty-spool count,
settings — is saved as files **on your own PC**, separately for each install:

| Platform | Location |
|----------|----------|
| Windows | `%APPDATA%\Haspel\data\` |
| macOS | `~/Library/Application Support/Haspel/data/` |
| Linux | `~/.local/share/haspel/data/` |

You can see the exact path at any time on the **Settings** page, under **Data**.

The built-in catalog of P2S replacement parts and consumables is shipped *with*
the app and is read-only — it's separate from your own data and never changes
when you edit your lists.

Because your data is plain files in a stable location, it survives app updates.
Back it up by copying that folder.

## Using it from your phone

Haspel runs a local web address while it's open, so you can view it from a phone
or tablet **on the same Wi-Fi** — handy for checking the shopping list in a shop
or your filament stock at the printer. On your phone's browser go to:

```
http://<your-pc-ip>:5173/
```

Replace `<your-pc-ip>` with your PC's local IP address (for example
`192.168.1.20`). The PC must be on and Haspel must be open for this to work.

For a fully offline checklist, the [Shopping list](08-shopping-list.md) and other printable pages
can be saved as a PDF instead.
