# Printers

The **Printers** page is where you tell Haspel which machines you own. Adding your
printers gives you a tidy spec sheet for each one and lets the rest of the app
adapt to your hardware — for example, AMS-compatibility badges on labels make
sense only once Haspel knows whether your printer has an AMS.

## The first-run prompt

On a fresh install, the first time you open Haspel it asks **"Add your 3D
printer?"**. You can:

- **Add a printer** — jumps straight to the add form.
- **Not now** — dismiss for this session (it may ask again next time).
- **Don't ask again** — never prompt again (you can still add printers any time
  from the Printers page).

## Adding a printer

Open **Printers** and click **Add printer** (or **Add your first printer** on an
empty list). The form has:

- **Prefill from a known model** — pick your model from the built-in catalog
  (65 models across Bambu Lab, Original Prusa, Creality, Anycubic, Elegoo,
  FlashForge, Sovol, QIDI, UltiMaker, Voron and AnkerMake). This fills in the
  specs automatically. Everything stays editable afterwards, and you can skip the
  picker entirely and type it all in by hand if your printer isn't listed.
- **Brand** and **Model** (required), an optional **Nickname** (e.g. "Workshop
  P2S"), and the technology (FDM by default).
- **Specifications** — build volume (X × Y × Z, where Z is the build height), max
  hotend and bed temperatures, filament diameter, default and available nozzle
  sizes, an AMS / multi-material type and slot count (leave the type blank for
  "none"), and a free list of common accessories.
- **Links** — the model's detail page and the brand store.

Click **Add printer** to save. The **first printer you add becomes the active
one** automatically.

## The spec view

Click any printer card to open its spec sheet: build volume and height, max
hotend/bed temperatures, enclosure and heated-chamber status, filament diameter,
nozzle options, AMS/multi-material details, common accessories, and links to the
model page and brand store. From here you can **Edit**, **Remove**, or **Set
active**.

> Specs prefilled from the catalog are a *reference*, gathered from manufacturer
> sources. Some values are intentionally left blank where a model has no single
> stock figure (for example, a Voron's hotend/bed limits depend on the build).
> Adjust anything to match your actual machine.

## Multiple printers and the active printer

You can add as many printers as you own. One is marked **active** (shown with a
green badge) — that's the one Haspel treats as your default. Use **Set active** on
a card or in the spec view to switch. Removing the active printer promotes another
to active automatically.

When **any** of your printers has an AMS / multi-material unit, Haspel knows to
keep AMS-related features relevant; if none of them do, those bits can stay out of
the way.

## Editing and removing

- **Edit** — the pencil/Edit button reopens the form with the current values.
- **Remove** — asks for confirmation, then deletes the printer. (Printers aren't
  archived like filaments are, so removing one is permanent.)
