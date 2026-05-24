# Importing orders

Rather than typing in each spool after a purchase, you can **drop the order's PDF
receipt** onto Haspel and let it add everything at once. It reads the line items,
shows you a preview to check and edit, and then adds or updates your filaments.

This works best with receipts from **Bambu Lab EU**, **123-3d.nl**, and
**Amazon NL**, but any reasonably structured PDF invoice can work.

> Order import uses AI to read the PDF, so it needs an AI provider configured. See
> [AI and providers](03-ai-and-providers.md). On an API-key provider, the model you choose must support
> PDF input.

## How to import

1. On the **Filaments** page, click **Import order**.
2. **Drag the PDF onto the drop zone** (or click it to browse for the file). PDFs
   up to 10 MB are accepted.
3. Wait while Haspel reads it. It extracts the vendor, order reference, date, and
   each line item — including SKU, colour variant, and unit price where the
   receipt shows them.
4. The **review** screen opens with everything it found.

## Reviewing before you commit

Nothing is saved until you confirm. On the review screen you can:

- **Check each line** — product, colour, quantity, price.
- **Edit** anything the extraction got wrong or left blank.
- **Drop lines** you don't want to import.

The importer also handles non-filament lines — **accessories and consumables**
from the same order can be brought in too.

When you're happy, confirm to apply.

## What happens on apply

For each line, Haspel decides whether it's something you already own:

- **Already in your inventory** (matched by SKU, or failing that by brand + name +
  variant) → it **increases the count** on the existing record rather than adding
  a duplicate.
- **New** → it **creates a new filament** with the full purchase details (date,
  price, source, order reference) attached.

Two things are filled in automatically:

- **Packaging split.** A line whose name mentions *refill* / *(Bijvullen)* is
  recorded as a **refill**; everything else is recorded as **on spool**. The stock
  counts are set so the record balances.
- **Clean product names.** Retailer names are often cluttered — e.g.
  `"PLA Matte 1 kg refill (Bijvullen)"` — so Haspel normalises them to the clean
  product name (`"PLA Matte"`) and moves the packaging/weight information into the
  proper fields.

## Colours after import

Colour is resolved in two passes so you're never left looking at grey:

1. **Immediately** — a sensible colour is inferred from the receipt as the review
   opens, at no extra cost.
2. **After import** — Haspel resolves the precise colour for each newly created
   filament in the background and updates the swatch. If that step can't run, the
   first-pass colour stays put.

To do a bigger batch later, the **Refresh swatches** button on the Filaments page
re-resolves anything still grey — see [Colours and swatches](04-colors-and-swatches.md).

## Re-importing safely

If you import the same order twice (for example after a hiccup), Haspel re-checks
each line against your *current* inventory at the moment you apply, so it merges
into existing records instead of creating twins. It's safe to re-run an import.
