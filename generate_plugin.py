#!/usr/bin/env python3
"""Generate plugin.js (plain JS) with model data embedded as a JSON.parse string.

Reads fetch_models.json (produced by fetch_models.py) and writes
plugin.js — all TypeScript annotations stripped.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUNDLE_PATH = HERE / "fetch_models.json"
OUT_PATH = HERE / "plugin.js"


def main() -> int:
    if not BUNDLE_PATH.exists():
        print(f"ERROR: {BUNDLE_PATH} not found — run fetch_models.py first", file=sys.stderr)
        return 1

    bundle = json.loads(BUNDLE_PATH.read_text(encoding="utf-8"))
    data_json = json.dumps(bundle, indent=2, ensure_ascii=False)

    # Escape backticks and backslashes for JS template literal embedding
    escaped = data_json.replace("\\", "\\\\").replace("`", "\\`")

    # Plain JS — no TypeScript annotations
    plugin_js = f'''/**
 * Hermes Desktop Plugin: Nous Provider Models & Pricing
 *
 * Shows the Nous Portal model catalog with live pricing, original
 * pricing, current discount, context length, and free/paid-tier badges.
 *
 * Data is bundled at build time from fetch_models.json (produced by
 * fetch_models.py). To refresh: run fetch_models.py, then reload the
 * desktop plugins from ⌘K.
 *
 * Sources:
 *   - model-catalog.json   (https://hermes-agent.nousresearch.com/docs/api/model-catalog.json)
 *   - /v1/models           (https://inference-api.nousresearch.com/v1/models)
 *   - /api/nous/recommended-models (https://portal.nousresearch.com/api/nous/recommended-models)
 */
import {{ cn, host, usePluginI18n, useValue }} from '@hermes/plugin-sdk'
import {{ jsx, jsxs }} from 'react/jsx-runtime'

// ── Bundled model data ────────────────────────────────────────────────────
const MODEL_BUNDLE = JSON.parse(`{escaped}`)

// ── IDs ───────────────────────────────────────────────────────────────────
const ID = 'nous-models'

// ── Helpers ────────────────────────────────────────────────────────────────

function DiscountBadge({{ pct }}) {{
  if (pct == null) return jsx('span', {{ children: '—' }})
  const color = pct >= 50 ? 'var(--ui-accent)'
    : pct >= 20 ? 'var(--ui-text-secondary)'
    : 'var(--ui-text-tertiary)'
  return jsx('span', {{
    className: 'font-mono text-xs',
    style: {{ color }},
    children: `${{Math.round(pct)}}%`
  }})
}}

function TierBadge({{ isFree, isPaid }}) {{
  if (isFree) return jsx('span', {{
    className: cn(
      'inline-flex h-5 min-w-[28px] items-center justify-center rounded-full border',
      'px-1 text-[0.65rem] font-medium text-white',
      'bg-emerald-500/90 border-emerald-400/40'
    ),
    children: 'Free'
  }})
  if (isPaid) return jsx('span', {{
    className: cn(
      'inline-flex h-5 min-w-[36px] items-center justify-center rounded-full border',
      'px-1.5 text-[0.65rem] font-medium text-(--ui-accent)',
      'bg-(--ui-accent)/10 border-(--ui-accent)/30'
    ),
    children: 'Paid'
  }})
  return jsx('span', {{
    className: 'text-(--ui-text-tertiary) text-[0.65rem]',
    children: 'Standard'
  }})
}}

// ── Model row ──────────────────────────────────────────────────────────────

function ModelRow({{ model }}) {{
  return jsxs('div', {{
    className: cn(
      'flex items-center gap-3 px-2 py-1.5 rounded-md',
      'hover:bg-(--chrome-action-hover) transition-colors cursor-default'
    ),
    'data-testid': `model-${{model.id}}`,
    children: [
      // Tier badge
      jsx(TierBadge, {{ isFree: model.is_free, isPaid: model.is_paid_recommended }}),

      // Name + recommended tag
      jsx('div', {{
        className: 'min-w-0 flex-1',
        children: jsxs('div', {{
          className: 'text-sm font-medium truncate',
          children: [
            model.name,
            model.is_paid_recommended
              ? jsx('span', {{ className: 'ml-1.5 text-(--ui-text-tertiary) text-[0.65rem] font-normal', children: '★ recommended' }})
              : null,
          ]
        }})
      }}),

      // Input price
      jsx('div', {{
        className: 'w-[72px] text-right text-sm tabular-nums text-(--ui-text-secondary)',
        children: model.input_per_1m
      }}),

      // Output price
      jsx('div', {{
        className: 'w-[72px] text-right text-sm tabular-nums text-(--ui-text-secondary)',
        children: model.output_per_1m
      }}),

      // Original prices (smaller, tertiary)
      jsx('div', {{
        className: 'w-[80px] text-right text-[0.65rem] tabular-nums text-(--ui-text-tertiary) opacity-60',
        children: `${{model.input_original_per_1m}} / ${{model.output_original_per_1m}}`
      }}),

      // Discount badge
      jsx('div', {{
        className: 'w-[52px] text-right',
        children: jsx(DiscountBadge, {{ pct: model.discount_avg_pct }})
      }}),

      // Context
      jsx('div', {{
        className: 'w-[48px] text-right text-sm tabular-nums text-(--ui-text-tertiary)',
        children: model.context_length
      }}),
    ]
  }})
}}

// ── Pane ───────────────────────────────────────────────────────────────────

function NousModelsPane() {{
  const t = usePluginI18n(ID)
  const bundle = MODEL_BUNDLE
  const models = bundle?.models ?? []
  const stats = bundle?.stats

  return jsxs('div', {{
    className: 'flex h-full flex-col text-sm',
    children: [
      // Header
      jsxs('div', {{
        className: 'flex items-center gap-3 px-3 py-2 border-b border-(--ui-stroke-secondary)',
        children: [
          jsx('div', {{ className: 'font-medium text-lg', children: t('paneTitle') }}),
          jsx('span', {{ className: 'text-(--ui-text-tertiary) text-[0.65rem]',
            children: stats ? `${{stats.total}} models · ${{stats.free}} free · ${{stats.paid_recommended}} paid` : '' }}),
        ]
      }}),

      // Column headers
      jsxs('div', {{
        className: 'flex items-center gap-3 px-2 py-1.5 text-(--ui-text-tertiary) text-[0.65rem] uppercase tracking-wide border-b border-(--ui-stroke-secondary)',
        children: [
          jsx('div', {{ className: 'w-[72px]' }}),
          jsx('div', {{ className: 'min-w-0 flex-1' }}),
          jsx('div', {{ className: 'w-[72px] text-right' }}),
          jsx('div', {{ className: 'w-[72px] text-right' }}),
          jsx('div', {{ className: 'w-[80px] text-right', children: 'Original ($/1M)' }}),
          jsx('div', {{ className: 'w-[52px] text-right', children: 'Disc.' }}),
          jsx('div', {{ className: 'w-[48px] text-right', children: 'Ctx' }}),
        ]
      }}),

      // Scrollable rows
      jsxs('div', {{
        className: 'flex-1 overflow-auto',
        children: models.length === 0
          ? jsx('div', {{ className: 'flex-1 flex items-center justify-center text-(--ui-text-tertiary) text-sm', children: t('empty') }})
          : models.map((m) => jsx(ModelRow, {{ key: m.id, model: m }}))
      }}),

      // Footer / stats
      stats ? jsxs('div', {{
        className: 'flex items-center gap-4 px-3 py-2 border-t border-(--ui-stroke-secondary) text-(--ui-text-tertiary) text-[0.65rem]',
        children: [
          jsx('span', {{ children: `Avg discount: ${{Math.round(stats.avg_discount_pct)}}%` }}),
          jsx('span', {{ children: `Updated: ${{new Date(stats.fetched_at).toLocaleString()}}` }}),
          jsx('span', {{ className: 'ml-auto text-(--ui-text-quaternary)',
            children: 'Sources: model-catalog · /v1/models · /api/nous/recommended-models' }}),
        ]
      }}) : null,
    ]
  }})
}}

// ── Statusbar chip (compact model count) ───────────────────────────────────

function ModelsChip() {{
  const t = usePluginI18n(ID)
  const bundle = MODEL_BUNDLE
  const stats = bundle?.stats

  return jsx('div', {{
    className: cn(
      'inline-flex h-5 items-center gap-1 px-1.5 text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
      'transition-colors text-[0.6875rem] cursor-default'
    ),
    children: stats
      ? [jsx('span', {{ className: 'text-(--ui-accent)', children: stats.total }}),
         jsx('span', {{ children: `/${{stats.free}} free` }})]
      : t('chipLoading')
  }})
}}

// ── Registration ───────────────────────────────────────────────────────────

export default {{
  id: ID,
  name: 'Nous Models & Pricing',
  register(ctx) {{
    ctx.i18n.register({{
      en: {{
        paneTitle: 'Nous Models',
        empty: 'No models loaded',
        chipLoading: '…',
      }}
    }})

    ctx.register({{
      id: 'pane',
      area: 'panes',
      title: 'Nous Models',
      data: {{ placement: 'right', width: '420px' }},
      render: () => jsx(NousModelsPane, {{}})
    }})

    ctx.register({{
      id: 'chip',
      area: 'statusBar.right',
      order: 140,
      render: () => jsx(ModelsChip, {{}})
    }})
  }}
}}
'''

    OUT_PATH.write_text(plugin_js, encoding="utf-8")
    print(f"Wrote {OUT_PATH}")
    print(f"  {bundle['stats']['total']} models embedded (plain JS, no TS)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
