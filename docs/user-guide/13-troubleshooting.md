# Troubleshooting

Common questions and fixes. Most issues come down to one of three things: the AI
backend isn't set up, the print dialog is reshaping the labels, or the stock
numbers don't balance.

## The app window opens but nothing loads ("helper unreachable" / "Failed to fetch")

The background service that holds your data hasn't answered. Give it a second on a
cold start; if it still shows a connection error:

1. Close the window completely.
2. Wait a few seconds.
3. Launch Haspel again — it starts a fresh background service on startup.

The most common cause is **running two copies at once**: if you also have a
developer/dev-server copy of Haspel open, close it — both use the same local port
(`127.0.0.1:5174`), so only one can serve at a time.

## "Lookup AI" or a colour refresh fails ("Failed to fetch", or an error message)

This is almost always the AI backend:

- **Using Claude CLI?** Make sure the `claude` command is installed and signed in
  (`claude /login`). An expired session is the most common cause.
- **Using an API key?** Open **Settings → AI provider** and click **Test
  connection**. It'll tell you exactly what's wrong (bad key, no quota, no
  network). Re-enter the key if needed.
- **No AI set up?** Set the backend to **None** in Settings to hide the buttons
  and enter details by hand — or configure a provider. See
  [AI and providers](03-ai-and-providers.md).

Your existing data is never lost when a look-up fails — it just keeps what it had.

## The Save button on a filament does nothing

Check the **packaging balance** indicator near the stock counts. The two ways of
counting your spools must add up to the same total — `on spool + refill` must
equal `sealed + open + in use`. When they don't, the indicator is **amber** and
Save is disabled. Adjust the numbers until it turns **green**, then save. See
[Filaments](02-filaments.md).

## The "Add a printer" button doesn't do anything

Make sure you're on the current version. Adding a printer opens a form with the
brand, model, and spec fields (and a "prefill from a known model" picker). If the
form doesn't appear, close and relaunch Haspel. See [Printers](12-printers.md).

## My printed labels are shifted or the wrong size

Use **Download PDF** rather than Browser print, and print the PDF at **100% /
actual size**. The Download PDF path is built to bypass the browser print dialog's
margins, which are the usual cause of shifted or shrunk labels.

If you must use **Browser print**, set the dialog's **Margins** to **None** first.

If the labels are close but not quite aligned to your sheet, open **Adjust
dimensions** in the print panel and nudge the margins. If Decadry sheets keep
peeling, switch to the **Avery Zweckform 6138** preset and sheets. See
[Printing labels](06-labels.md).

## A filament's colour is just grey

Grey is the placeholder for a colour that's never been resolved. If you have an AI
provider configured, click **Refresh swatches** at the top of the Filaments page
to resolve all grey ones at once — or set the colour by hand in the filament form.
See [Colours and swatches](04-colors-and-swatches.md).

## I can't find my data / I want to back it up

Open **Settings → Data**; it shows the exact folder where your inventory is
stored (`%APPDATA%\Haspel\data\` on Windows). Copy that folder to back everything
up. It lives outside the app's program files, so it survives updates and
reinstalls. See [Getting started](01-getting-started.md).

## I removed a filament by mistake

It's not gone — open **History (N)** on the Filaments page and **Restore** it. See
[Filament history](10-filament-history.md).

## How do I stop the app?

Just close the window — the background service stops with it. There's nothing to
stop manually and no tray icon.

## How do I update Haspel?

Install the new version (run the newer installer). Your data folder is separate
from the app, so updating never touches your inventory.
