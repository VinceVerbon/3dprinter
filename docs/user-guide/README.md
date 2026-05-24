# Haspel — User Guide (source)

This folder holds the **end-user documentation** for Haspel, the 3D-printing
supplies tracker. The files here are the *source* — plain Markdown, one numbered
file per topic. They are written to be readable as-is on GitHub **and** to
assemble cleanly into a single printable PDF.

## How it's organised

The numeric prefixes set the order in which the topics are stitched together for
the PDF. Read them in order for a front-to-back manual, or jump to the one you
need:

| File | Topic |
|------|-------|
| `00-introduction.md` | What Haspel is, who it's for, key concepts |
| `01-getting-started.md` | Install, launch, the app lifecycle, demo data, where your data lives |
| `02-filaments.md` | The filament inventory — the heart of the app |
| `03-ai-and-providers.md` | AI usage lookup and choosing an AI backend |
| `04-colors-and-swatches.md` | Swatches, effects, colour families, fixing grey swatches |
| `05-importing-orders.md` | Bulk-adding filaments by dropping an order PDF |
| `06-labels.md` | Printing spool labels (and managing brand logos) |
| `07-accessories.md` | Tracking nozzles, plates, AMS parts, tools, etc. |
| `08-shopping-list.md` | Building a shopping list from the catalog or free text |
| `09-empty-spools.md` | The empty-spool counter |
| `10-filament-history.md` | The archive of removed filaments and how to restore them |
| `11-settings.md` | Full settings reference |
| `12-printers.md` | Adding and managing your printers + spec sheets |
| `13-troubleshooting.md` | Common problems and fixes |

## Building the PDF

The documentation is bundled into the production build as a single PDF + HTML.
From the repo root:

```powershell
# Build just the docs (writes into app/dist/docs/)
node scripts/build-docs.mjs

# Or build the whole production app AND bundle the docs in one step
.\scripts\build-prod.ps1
```

`build-docs.mjs` is a zero-dependency Node script. It concatenates the topic
files in order, adds a title page and a clickable table of contents, renders the
result to `Haspel-User-Guide.html`, then drives `msedge --headless
--print-to-pdf` (the same engine the app uses for label PDFs) to produce
`Haspel-User-Guide.pdf`. Both, plus a copy of the Markdown source, land in
`app/dist/docs/`.

## Editing rules

- **Keep to standard Markdown.** Headings (`#`/`##`/`###`), paragraphs, **bold**,
  *italic*, `inline code`, fenced code blocks, ordered/unordered lists (up to two
  levels of nesting), GitHub pipe tables, block quotes, horizontal rules, and
  links/images. Avoid raw HTML — the PDF converter is deliberately simple so the
  build stays dependency-free.
- **One `#` H1 per file**, at the top — it becomes a chapter in the PDF and an
  entry in the table of contents. Use `##` for sections within a chapter.
- **Update the docs in the same change as the feature.** Before any production
  build, re-read the topic files, fix anything stale, then build. See the
  "Production build — documentation" section in the repo `CLAUDE.md`.
