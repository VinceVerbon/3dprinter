# Printing labels

Haspel prints tidy **spool labels** modelled on the Bambu look: the brand
logo, the material name, a colour swatch with the variant name, a spec table
(material, print and bed temperature, diameter, weight, drying schedule), the
article number — and a clear **AMS compatibility badge**. You print them onto
standard self-adhesive label sheets.

Open the feature from the **Labels** entry in the top navigation.

## Choosing what to print

The Labels page lists your filaments as compact rows with a checkbox each. To
build a print run:

- **Tick** the filaments you want a label for. The header shows how many are
  selected.
- Narrow the list first with the **Brand** and **AMS** filters if you like (the
  AMS filter shows only compatible — or only incompatible — filaments).
- Use **Select all visible** / **Clear selection** to tick or untick everything
  currently shown.
- Click the **eye** icon on any row to **preview** that single label at actual
  size before committing.

## The AMS badge

Each label carries a prominent **AMS** chip showing whether the filament is safe
to run through the AMS 2 Pro:

- **Green check** — compatible.
- **Red crossed-out X** — not compatible (run it from an external spool instead).

Haspel decides this with rules specific to the P2S + AMS 2 Pro:

- **Bambu-branded** filaments follow their stated AMS compatibility. The only
  AMS-safe TPU is Bambu's *"TPU for AMS"*.
- **Non-Bambu TPU** is never treated as AMS-safe.
- **Non-Bambu stiff / reinforced** materials (PA, PA-CF, PC, PLA-CF) are treated
  as incompatible.
- **Non-Bambu PLA, PLA+, PETG, ABS, ASA** (including matte/silk/sparkle finishes)
  are treated as compatible.

The preview shows the exact reason the badge was chosen, so you can sanity-check
it.

## Printing

Click **Print** (it shows the number selected) to open the print panel.

### Pick a sheet format

Choose your label sheet from **Sheet format**. Two presets ship:

| Preset | Label size | Layout |
|--------|-----------|--------|
| **Decadry 105×70 mm** | 105 × 70 mm | 8 labels per A4 sheet (2 × 4) |
| **Avery Zweckform 6138** | 105 × 74 mm | Borderless, on A4 |

The Avery preset was added because the Decadry sheets can adhere poorly — if your
labels keep peeling, try the Avery sheets and preset.

### Fine-tune the dimensions (optional)

If your sheets don't line up perfectly, click **Adjust dimensions**. Every
measurement is exposed as a number you can override — paper size, columns × rows,
label width and height, all four margins, the gaps between labels, and the corner
radius. The preset value shows as a placeholder; type a different number to
override just that one. **Reset to preset** clears all your overrides. Your tweaks
are remembered for next time.

### Start position

A **position picker** lets you choose which slot on the sheet the first label
lands on. This means a part-used sheet — say one with the first three labels
already peeled off — doesn't waste blank labels: just start at slot 4. The panel
tells you how many sheets the run will use.

### Download PDF vs Browser print

Two buttons finish the job:

- **Download PDF** *(recommended)* — Haspel renders the sheet to a PDF for you and
  downloads it. This is the reliable path: it bypasses the browser's print dialog
  entirely, so the labels can't be shrunk or shifted by the dialog's default
  margins. Open the PDF and print it at 100% / actual size.
- **Browser print** — prints straight from the browser. This only lines up
  correctly if you set the print dialog's **Margins** to **None**. Use it only if
  you know your way around the print dialog; otherwise prefer Download PDF.

The PDF takes a few seconds to render — that's normal.

## Brand logos

The logo printed on each label comes from the **Brand logos** manager. Open it
from the **Brand logos** button on the Labels page.

It lists every brand in your inventory. For each one you can set the logo in any
of four ways:

- **Auto-fetch** — Haspel tries to find the logo automatically (it checks a logo
  service, then the supplier's website icon).
- **Upload** — provide your own image file (PNG, SVG, JPEG, or WebP, up to 1 MB).
- **Paste URL** — under **Paste URL instead**, give a link to a logo image; it's
  downloaded and embedded so it can't break later.
- **Text only** — skip the image and print the brand name as a styled wordmark.

If no logo is set for a brand, labels fall back to the text wordmark — so a label
always prints *something* even before you've configured logos. Use **Reset** to
clear a brand's setting.
