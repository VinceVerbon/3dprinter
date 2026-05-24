# Settings

The **Settings** page collects the app-wide preferences, the AI configuration, and
the data tools. Open it from the **Settings** entry in the top navigation.
Settings save as you change them.

## General

- **Default filament brand** — the brand pre-filled when you add a new filament.
  Set it to whatever you buy most (e.g. *Bambu Lab*) to save typing.

## AI provider

This whole section is covered in detail in [AI and providers](03-ai-and-providers.md). In short:

- **Backend** — choose **Claude CLI** (default, free, no key), an **API key**
  provider (Anthropic / OpenAI / Gemini / OpenRouter), or **None** to disable AI.
- **API key** — appears for the API providers; stored only on this PC, or
  supplied via an environment variable.
- **Model per task** — pick the model for filament enrichment, swatch resolution,
  and order import independently.
- **Show AI lookup buttons** — hide or show the look-up buttons without changing
  the backend.
- **Test connection** — probe the chosen backend and report success or the exact
  error, without ever showing your key.

## Data

- **Where your data lives** — shows the exact folder on this PC where your
  inventory is stored, and (separately) the read-only catalog folder shipped with
  the app. See [Getting started](01-getting-started.md) for the per-platform paths and backup advice.
- **Load demo data** — populates your lists with a few example filaments and an
  accessory so you can explore the app. It **skips lists you've already filled
  in**, so it's safe on a fresh install. Tick **"Also overwrite files I've already
  populated"** only if you want to replace your current data with the examples.

## What's stored where

- **Your settings** (including any API key) live in your per-install data folder,
  never in the app's code, and are never shared or committed.
- Environment variables for API keys, if you set them, take precedence over the
  stored value — useful if you prefer not to keep a key in a file at all.
