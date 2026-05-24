# Getting started

This chapter covers installing Haspel, launching it, what happens while it runs,
and where your data is kept. After the one-time install, starting the app is a
single click.

## What you need

- **Windows 10 or 11.**
- **WebView2** — the system component Haspel draws its window with. It's
  preinstalled on Windows 11 and usually already present on Windows 10 (it comes
  with Microsoft Edge / Windows Update).
- **The Claude CLI**, signed in — *only* if you want the free AI look-ups. This is
  optional; you can run Haspel with AI turned off, or with a different provider.
  See [AI and providers](03-ai-and-providers.md).

## Installing (one time)

Haspel is a normal Windows app. Run the installer:

- **`Haspel_<version>_x64_en-US.msi`** — installs for all users (asks for admin), or
- **`Haspel_<version>_x64-setup.exe`** — installs just for you (no admin needed).

The installer adds **Haspel** to your Start menu (and a desktop shortcut). That's
it — there's nothing to clone, no command line, and no separate "start" script.

> Building from source instead? See `docs/install.md`.

## Launching

Click **Haspel** in the Start menu (or pin it to the taskbar). It opens in its own
clean window — no address bar, no browser tabs — and starts its small background
service automatically.

When you're done, just **close the window**; the background service stops with it.
There's no tray icon to hunt for and nothing to stop by hand.

> Only run one copy at a time — if you also have a developer/dev-server copy
> running, close it first, since both use the same local port.

## First run

A fresh install starts empty, so Haspel helps you set up:

- **"Add your 3D printer?"** — on first launch Haspel offers to add a printer.
  Adding the machines you own unlocks a spec sheet and makes labels and
  compatibility adapt to your hardware. You can pick a known model to fill the
  specs automatically. Not ready? Choose **Not now**, or **Don't ask again** to
  stop the prompt for good. See [Printers](12-printers.md).
- **Load demo data** — in **Settings**, **Load demo data** adds a few example
  filaments and an accessory so you can explore before entering your own. It
  **skips lists you've already filled in**; tick "Also overwrite…" only if you
  want to replace real data with the examples.

Removed filaments aren't truly lost — they're kept in
[History](10-filament-history.md) and can be restored.

## Where your data is stored

Everything you enter — filaments, accessories, printers, shopping list,
empty-spool count, settings — is saved as files **on your own PC**, separately for
each install:

| Platform | Location |
|----------|----------|
| Windows | `%APPDATA%\Haspel\data\` |
| macOS | `~/Library/Application Support/Haspel/data/` |
| Linux | `~/.local/share/haspel/data/` |

You can see the exact path any time on the **Settings** page, under **Data**.

The built-in catalog (replacement parts, consumables, and a 65-model printer
reference) ships *with* the app and is read-only — separate from your own data,
and never changed when you edit your lists.

Because your data is plain files in a stable location, it **survives app updates
and reinstalls**. Back it up by copying that folder.

## Offline checklists

Going to a shop? The [Shopping list](08-shopping-list.md) and other printable
pages can be saved as a PDF to take with you — no need to keep the app open.
