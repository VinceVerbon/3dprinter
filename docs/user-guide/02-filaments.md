# Filaments

The **Filaments** page is the heart of Haspel. It lists every filament you own,
how much of each you have, what colour it is, and — once looked up — how to print
with it. It's the page the app opens on.

Each row is a **card**. Click a card to open its full **detail view**; use the
small **Edit** (pencil) and **Remove** buttons on the card for quick actions.

## The filament record

One record describes a single **brand + product + colour**. If you own several
identical spools, that's *one* record with a higher count — not several records.

### Identity

| Field | What it's for |
|-------|---------------|
| **Brand** | e.g. *Bambu Lab*, *SUNLU*, *Real Filament*. Defaults to your preferred brand (set in Settings). |
| **Product name** | The exact name on the label, e.g. *PLA Basic*, *PETG HF*. Keep it clean — no weight or "refill" text (those are tracked separately). |
| **Variant / colour name** | The human colour or finish, e.g. *Sunset Orange*, *Galaxy Black*. Optional. |

There are also optional **supplier identifiers** — SKU, product URL, colour code,
RFID UID, EAN/barcode. You don't have to fill these in, but the more you provide,
the more accurate the automatic colour and spec look-ups become. The order
importer fills many of them in for you.

### Counting your stock

Every filament's stock is described from **two angles**, and the two must add up
to the same number. The form shows a running total and won't let you save until
they match.

**By state** — how the spools are stored right now:

- **Sealed** — unopened, in reserve.
- **Open** — opened but not currently loaded (e.g. sitting in a drybox).
- **In use** — currently loaded in the printer or AMS.

**By packaging** — how the filament physically comes:

- **On spool** — wound on its own reusable spool.
- **Refill** — filament only, no spool (you mount it on a spool you already have).

> **Why two?** The *state* tells you what's ready to print; the *packaging* tells
> you how many reusable spools you'll free up as you use them, and feeds the empty
> spool planning. Both describe the *same* physical filament, so
> `on spool + refill` must equal `sealed + open + in use`. The total indicator
> turns **green** when they balance and **amber** when they don't — adjust the
> numbers until it's green, then save.

If you're editing older data created before packaging was tracked, Haspel assumes
everything is "on spool" so your records start balanced.

### The rest

- **Spool weight (g)** — grams of filament per spool (1000 for most Bambu spools,
  500 for some supports). Used for label specs.
- **Rating** — your own 1–5 star score. Click a star to set it, click again or use
  the clear button to reset. (On a card the stars are read-only — edit the rating
  through the form.)
- **Notes** — free text for anything else.
- **AI usage info** — the look-up results; see [AI and providers](03-ai-and-providers.md).
- **Swatch & effects** — the colour; see [Colours and swatches](04-colors-and-swatches.md).

## Adding a filament

1. Click **Add filament** (top right).
2. Fill in at least **Brand** and **Product name**.
3. Pick the colour and effects, set the stock counts so the total balances, and
   add a rating if you like.
4. Optionally click **Lookup AI** to fetch the printing facts (needs an AI
   provider — see [AI and providers](03-ai-and-providers.md)).
5. Click **Save filament**.

To add many filaments at once from a purchase, use **Import order** instead — see
[Importing orders](05-importing-orders.md).

## Editing and removing

- **Edit** — click the pencil on a card, or **Edit** inside the detail view. The
  edit form opens at the top of the page and Haspel scrolls up to it, so it's
  clear you're editing. Change anything and **Save**.
- **Remove** — click the remove button on a card. The filament leaves your active
  list but is **kept in History**, so you can restore it later. See
  [Filament history](10-filament-history.md).

## The detail view

Click anywhere on a card (except a button) to open the detail view. It shows
everything about that filament: identity and all supplier IDs, the full AI block
(P2S + AMS 2 Pro compatibility, drying schedule, print and bed temperatures,
annealability, usage notes), purchase details, and the stock broken down by state
and packaging. A **Re-lookup** button refreshes the AI data and saves it.

## Finding things — filters

When you have a lot of filaments, the filter row narrows the list. Only filters
that actually apply to your data are shown.

- **Type** — PLA, PETG, ABS, TPU, etc. (comes from the AI look-up).
- **Effect** — matte, silk, sparkle, marble, metallic, glow, multicolor,
  translucent, transparent.
- **Colour** — click a colour family (Red, Orange, … plus **Multicolor**) to show
  only filaments of that colour. See [Colours and swatches](04-colors-and-swatches.md) for how colours are
  grouped.

Click **clear** (or **all**) to reset. The heading shows how many filaments match
out of your total.

## Batch tools

A few buttons appear at the top of the page only when there's something for them
to do:

- **Fill missing AI (N)** — runs the AI look-up for every filament that doesn't
  have one yet, one after another, with live progress. Failures are counted
  separately so one bad look-up doesn't stop the rest.
- **Refresh swatches (N)** — finds filaments still showing the plain grey
  placeholder colour and resolves their real colour. See
  [Colours and swatches](04-colors-and-swatches.md).
- **History (N)** — opens the archive of removed filaments. See
  [Filament history](10-filament-history.md).
- **Import order** — drop a PDF receipt to bulk-add filaments. See
  [Importing orders](05-importing-orders.md).
