# Nous Models & Pricing — Hermes Desktop Plugin

A Hermes desktop plugin that displays the Nous Portal model catalog with
live pricing, original pricing, current discount percentages, context
lengths, and free/paid-tier badges — viewable in the Hermes desktop app
alongside your conversation.

## What it shows

A right-side pane listing all 31 Nous Portal models with per-model:

| Column | Meaning |
|--------|---------|
| Tier badge | Free (green), Paid (accent), or Standard |
| Name | Model name, with `★ recommended` tag for paid-tier picks |
| In / Out | Current price per 1M input/output tokens (USD) |
| Original | Pre-discount price per 1M input/output tokens |
| Disc. | Average input+output discount percentage |
| Ctx | Context window (e.g. `1.1M`, `262K`) |

A statusbar chip (right side) shows total model count and free count.

Bottom stats bar: average discount across all models, last fetch time,
and data sources.

## Data sources

- **Model catalog**: [`model-catalog.json`](https://hermes-agent.nousresearch.com/docs/api/model-catalog.json) — curated Nous Portal model IDs
- **Pricing**: [`/v1/models`](https://inference-api.nousresearch.com/v1/models) — per-model pricing + original pricing (for discount calculation)
- **Tier recommendations**: [`/api/nous/recommended-models`](https://portal.nousresearch.com/api/nous/recommended-models) — free/paid tier assignments

## Refresh workflow

```bash
cd /home/joshua/dev/nous-models-plugin
python3 fetch_models.py      # re-fetch all data → fetch_models.json
python3 generate_plugin.py   # embed updated data → plugin.js
cp plugin.js ~/.hermes/desktop-plugins/nous-models/plugin.js
# Then in Hermes Desktop: ⌘K → "Reload desktop plugins"
```

## Install

The plugin is already installed:

```bash
~/.hermes/desktop-plugins/nous-models/plugin.js
```

The Hermes desktop app watches `~/.hermes/desktop-plugins/` and hot-reloads
when files change. After copying, reload plugins from ⌘K if it doesn't
appear within a few seconds.

## Dev

```bash
git clone ...  # or use the local repo
python3 fetch_models.py      # fetch data
python3 generate_plugin.py   # build plugin.js
```

Requires Python 3.11+ (stdlib only, no pip deps).

## Publish to GitHub

```bash
# From /home/joshua/dev/nous-models-plugin:
git remote add origin <your-repo-url>
git push -u origin master
```
