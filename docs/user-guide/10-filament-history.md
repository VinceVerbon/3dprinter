# Filament history

Removing a filament from your active list **doesn't throw it away**. Haspel keeps
the full record — colour, AI info, stock, purchase details — in a **history**
archive, so you can bring back a filament you used before without re-entering it.

## Opening the archive

When you have removed filaments, a **History (N)** button appears at the top of
the [Filaments](02-filaments.md) page, where **N** is how many are archived. Click it to open
the archive. Each entry shows the filament as it was when you removed it, newest
first.

## Restoring a filament

Click **Restore** on an archived entry to put it back in your active inventory. It
comes back exactly as it was — same colour, AI data, stock counts, and purchase
details. (In the rare case its original identifier is somehow back in use, Haspel
quietly assigns a fresh one so nothing clashes.)

This is handy when you rebuy a filament you'd removed: restore it, then bump the
counts, rather than building the record from scratch.

## Deleting permanently

If you're sure you'll never want an entry back, you can remove it from the archive
for good:

- **Delete one** — each entry has a permanent delete with a two-step confirm, so
  you can't wipe it by a single accidental click.
- **Clear all history** — empties the entire archive at once.

Permanent deletion can't be undone, so it's deliberately a little harder than
restoring.

## Where it's stored

The archive is part of your local data (in the same per-install data folder as
everything else — see [Getting started](01-getting-started.md)). It's specific to your machine and is
included if you back up that folder.
