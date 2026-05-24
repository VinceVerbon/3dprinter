# Welcome to Haspel

**Haspel** is a personal supplies database for 3D printing, built around the
**Bambu Lab P2S Combo with the AMS 2 Pro**. It keeps track of everything you buy
and use to keep the printer running — filament spools, replacement parts,
consumables, and empty spools — so you always know what you have, what it's good
for, and what you need to reorder.

It runs as a small app on your own PC. Your data lives locally on your machine;
nothing is uploaded to a cloud service.

## What you can do with it

- **Catalogue every filament** you own — brand, exact product name, colour,
  finish, how many spools you have and in what state, and a 1–5 star rating.
- **Look up the important printing facts automatically.** One click fetches the
  filament type, whether it's abrasive, whether it works with the AMS 2 Pro,
  drying temperature and time, and recommended print/bed temperatures.
- **See real colours.** Each filament shows a colour swatch — including
  multi-colour gradients for silk and galaxy filaments — resolved from the
  manufacturer where possible.
- **Bulk-add a whole order** by dragging the order's PDF receipt onto the app.
- **Print spool labels** that match the Bambu look, complete with an AMS
  compatibility badge, onto standard self-adhesive label sheets.
- **Track accessories** — nozzles, build plates, AMS parts, tools, glue,
  desiccant — with the same rating and stock counts.
- **Keep a shopping list** you can build from a built-in catalog of P2S parts and
  consumables, total it up, and print or save it as a PDF to take to the shop.
- **Count your empty spools** so you know how many you can reuse for refills.

## A few key ideas

A handful of concepts come up throughout the app. Knowing them up front makes the
rest of this guide easier to follow.

- **One record = one product.** A filament record describes a single
  *brand + product + colour* combination (effectively one SKU). If you own three
  identical spools of Bambu PLA Basic Black, that's **one record with a count of
  three**, not three records.
- **Two ways of counting the same spools.** Every filament's stock is described
  twice, from two angles that must add up to the same total:
  - **By state** — *sealed* (unopened), *open* (opened but not loaded), and
    *in use* (loaded in the printer/AMS).
  - **By packaging** — *on spool* (comes wound on its own reusable spool) versus
    *refill* (filament only, no spool). See
    [the Filaments chapter](02-filaments.md) for the full explanation.
- **The AMS 2 Pro matters.** Not every filament is safe to run through the AMS.
  Haspel flags compatibility on filament cards and prints it as a badge on
  labels, using rules specific to the P2S + AMS 2 Pro.
- **AI is optional and free by default.** The automatic look-ups use the Claude
  CLI that's already installed on your PC and signed in to your own
  subscription — there's no extra cost and no API key. You can switch to a
  different provider, or turn AI off entirely, in Settings.

## Who this is for

This guide is written for the person *using* Haspel day to day — adding
filaments, printing labels, keeping the shopping list current. You don't need to
know anything about the code or how it's built. Where a step needs a one-time
setup (installing the app, signing in to the AI), that's called out clearly.

The next chapter,
[Getting started](01-getting-started.md), walks you through installing and launching the app for the
first time.
