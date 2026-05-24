# AI and providers

Haspel can fill in the facts that matter for printing — automatically. This
chapter explains what the AI look-ups do, how to choose (or turn off) the AI
backend, and what each provider needs.

## What the AI look-ups do

There are three places the app uses AI, each a separate task:

1. **Filament enrichment** ("Lookup AI") — given a filament's brand and name, it
   returns:
   - **Type** (PLA, PETG, ABS, TPU, …) and whether it's **abrasive** (abrasive
     filaments wear out brass nozzles — you want a hardened nozzle).
   - **P2S + AMS 2 Pro compatibility**, including whether a hardened nozzle is
     required, with notes.
   - **Drying** — temperature, hours, and whether desiccant is recommended.
   - **Print and bed temperature** ranges.
   - **Annealability** — whether the part can be heat-treated for strength.
   - A short **usage notes** paragraph.
2. **Swatch / colour resolution** — figures out the real colour(s) of a filament.
   See [Colours and swatches](04-colors-and-swatches.md).
3. **Order PDF import** — reads a purchase receipt and extracts the line items.
   See [Importing orders](05-importing-orders.md).

Results are **cached**, so looking up the same filament again is instant and
doesn't cost anything. A **Re-lookup** button forces a fresh fetch when you want
one.

## Choosing a provider

Open **Settings → AI provider → Backend** and pick one:

| Backend | What it uses | Key needed? | Cost |
|---------|--------------|-------------|------|
| **Claude CLI** *(default)* | The `claude` command-line tool already on your PC, signed in to your own Claude subscription | No | None beyond your subscription |
| **Anthropic API key** | Anthropic's API directly | Yes (`sk-ant-…`) | Billed per use |
| **OpenAI API key** | OpenAI's API | Yes (`sk-…`) | Billed per use |
| **Google Gemini API key** | Google's Gemini API | Yes (`AIza…`) | Billed per use |
| **OpenRouter API key** | OpenRouter (many models behind one key) | Yes (`sk-or-…`) | Billed per use |
| **None** | Nothing — manual entry only | No | None |

**Claude CLI is the recommended default.** It uses the Claude subscription you're
already paying for, needs no API key, and stores nothing extra. It also has live
web access, which makes colour and order look-ups more accurate. It just requires
the `claude` CLI installed and logged in (`claude /login`).

### Using an API key

If you pick one of the **API key** backends, an **API key** field appears. The key
is stored only in your local settings file on this PC and is never committed or
shared. If you'd rather not store it in a file, set the matching environment
variable instead — it takes precedence over the stored value:

- Anthropic → `ANTHROPIC_API_KEY`
- OpenAI → `OPENAI_API_KEY`
- Gemini → `GEMINI_API_KEY`
- OpenRouter → `OPENROUTER_API_KEY`

> **Two things to know about API providers:** colour and order look-ups run from
> the model's training knowledge only (no live web browsing), so colours can be
> lower-confidence than with the Claude CLI. And because order import sends the
> PDF to the model, the model you choose **must support PDF / image input**.

### Turning AI off

Choose **None** to hide every AI button. You can still enter every field by hand
and pick colours with the manual picker. This is the right choice if you don't
have any AI backend set up and prefer to keep everything manual.

You can also keep a provider configured but hide the look-up buttons with the
**"Show AI lookup buttons"** checkbox.

## Picking a model

For each task you can choose which model does the work:

- **Claude backends** show a curated dropdown — **Sonnet** (the fast, capable
  default), **Opus** (smartest, slower), or **Haiku** (fastest, cheapest).
- **Other providers** show a free-text box; type the model name (e.g. `gpt-4o`,
  `gemini-2.0-flash`). The provider's default is shown as a placeholder if you
  leave it blank.

A good default is the fast model for everything; switch a specific task to a
smarter model if you find its results need it.

## Testing the connection

After choosing a backend (and entering a key if needed), click **Test
connection**. Haspel does a tiny probe — checking the CLI is present, or sending a
one-word ping to the API — and reports success or the exact error inline. It
never displays your key. Use this to confirm everything is wired up before you
rely on the look-ups.

Changing the provider takes effect immediately — there's no need to restart the
app.

## When a look-up fails

If a look-up fails (CLI not logged in, no internet, bad key, quota exhausted), the
app shows the error rather than guessing. Your existing data is never overwritten
with a failure — for example, an order import keeps the colour it already inferred
rather than reverting to grey. Fix the underlying issue (log in again, check the
key) and re-run the look-up.
