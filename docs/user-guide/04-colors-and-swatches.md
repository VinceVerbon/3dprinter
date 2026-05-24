# Colours and swatches

Every filament carries a **swatch** — the little colour chip you see on its card
and on its printed label. Haspel can resolve the real colour from the
manufacturer, or you can set it by hand. This chapter covers both, plus how
colours are grouped for filtering.

## What a swatch is

A swatch is made of:

- **One to five colour stops.** A single solid colour uses one stop. Multi-colour
  filaments — silk rainbows, galaxy, marble, dual-colour — use several stops,
  shown as a gradient.
- **Effects** — matte, silk, sparkle, marble, metallic, glow, multicolor,
  translucent, transparent. These describe the *finish* and can change how the
  swatch is drawn.

## Setting a colour by hand

In the filament form, the **Swatch (1–5 stops)** picker lets you add, remove, and
edit colour stops. Add a second stop and the filament is automatically treated as
multi-colour. The **Effects** picker below it lets you tag the finish.

This is always available, even with AI turned off.

## Letting Haspel resolve the colour

When an AI provider is configured, Haspel can look up the real colour for you:

- **For Bambu Lab filaments**, it consults the official Bambu colour references,
  so an exact SKU match comes back with the precise hex value — and multi-colour
  products (PLA Silk Multi-Color, Galaxy, Marble, Dual Color) come back with all
  their visible stops.
- **For other brands**, it resolves from the model's knowledge of the product,
  optionally with a web look-up on the Claude CLI backend. These are good in
  practice but lower confidence than Bambu.

Resolved swatches are cached, so the same product never costs a look-up twice.

### Fixing grey swatches in bulk

Filaments that have never had a colour resolved show a plain **grey** placeholder.
When any exist, a **Refresh swatches (N)** button appears at the top of the
Filaments page. Click it and Haspel resolves the real colour for every grey
filament, showing live progress (`Resolving swatches… 3/13`). The button
disappears once nothing is grey.

This only touches filaments still on the grey placeholder — it never overwrites a
colour you've already set or that was resolved before.

## How colours are grouped (the colour filter)

The colour filter on the Filaments page groups every swatch into one of these
families:

**Red · Orange · Yellow · Green · Cyan · Blue · Purple · Pink · Brown · Black ·
Gray · White · Multicolor**

Haspel works out the family automatically from the swatch's colour values. A few
things worth knowing:

- A filament matches a family if **any** of its stops falls into it, so a
  two-tone spool can show up under more than one colour — except multi-colour
  ones.
- **Multicolor** is its own family. A filament lands there if it's tagged with the
  multicolor effect *or* has two or more distinct colour stops — and when it does,
  it shows up *only* under Multicolor, not under its individual colours, to keep
  the other families clean.
- Only families that exist in your current data appear as filter buttons.

## Tips

- Set supplier identifiers (especially the **SKU** for Bambu) before resolving —
  an exact SKU gives the highest-confidence colour.
- If a resolved colour looks wrong, just edit the stops by hand; manual values are
  never overwritten by the bulk refresh.
- Multi-colour swatches render as a gradient on both the card and the label, so a
  galaxy or silk-rainbow spool is easy to spot at a glance.
