/**
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
import { cn, host, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

// ── Bundled model data ────────────────────────────────────────────────────
const MODEL_BUNDLE = JSON.parse(`{
  "stats": {
    "total": 31,
    "free": 2,
    "paid_recommended": 6,
    "with_pricing": 31,
    "avg_discount_pct": 23.9,
    "fetched_at": "2026-08-20T17:11:04.723873+00:00"
  },
  "models": [
    {
      "id": "stepfun/step-3.7-flash",
      "name": "stepfun/step-3.7-flash:free",
      "input_per_1m": "$0.16",
      "output_per_1m": "$0.92",
      "input_original_per_1m": "$0.20",
      "output_original_per_1m": "$1.15",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "262K",
      "is_free": true,
      "is_paid_recommended": true
    },
    {
      "id": "tencent/hy3",
      "name": "tencent/hy3:free",
      "input_per_1m": "$0.11",
      "output_per_1m": "$0.42",
      "input_original_per_1m": "$0.13",
      "output_original_per_1m": "$0.53",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "262K",
      "is_free": true,
      "is_paid_recommended": true
    },
    {
      "id": "openai/gpt-5.6-luna-pro",
      "name": "gpt-5.6-luna-pro",
      "input_per_1m": "$0.20",
      "output_per_1m": "$1.20",
      "input_original_per_1m": "$1.00",
      "output_original_per_1m": "$6.00",
      "discount_input_pct": 80.0,
      "discount_output_pct": 80.0,
      "discount_avg_pct": 80.0,
      "context_length": "1.1M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "openai/gpt-5.6-luna",
      "name": "OpenAI: GPT-5.6 Luna",
      "input_per_1m": "$0.20",
      "output_per_1m": "$1.20",
      "input_original_per_1m": "$1.00",
      "output_original_per_1m": "$6.00",
      "discount_input_pct": 80.0,
      "discount_output_pct": 80.0,
      "discount_avg_pct": 80.0,
      "context_length": "1.1M",
      "is_free": false,
      "is_paid_recommended": true
    },
    {
      "id": "anthropic/claude-fable-5",
      "name": "claude-fable-5",
      "input_per_1m": "$8.00",
      "output_per_1m": "$40.00",
      "input_original_per_1m": "$10.00",
      "output_original_per_1m": "$50.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "anthropic/claude-haiku-4.5",
      "name": "claude-haiku-4.5",
      "input_per_1m": "$0.80",
      "output_per_1m": "$4.00",
      "input_original_per_1m": "$1.00",
      "output_original_per_1m": "$5.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "410K",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "anthropic/claude-opus-4.8",
      "name": "claude-opus-4.8",
      "input_per_1m": "$4.00",
      "output_per_1m": "$20.00",
      "input_original_per_1m": "$5.00",
      "output_original_per_1m": "$25.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "anthropic/claude-opus-5",
      "name": "claude-opus-5",
      "input_per_1m": "$4.00",
      "output_per_1m": "$20.00",
      "input_original_per_1m": "$5.00",
      "output_original_per_1m": "$25.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "anthropic/claude-sonnet-5",
      "name": "claude-sonnet-5",
      "input_per_1m": "$1.60",
      "output_per_1m": "$8.00",
      "input_original_per_1m": "$2.00",
      "output_original_per_1m": "$10.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "deepseek/deepseek-v4-flash",
      "name": "deepseek-v4-flash",
      "input_per_1m": "$0.07",
      "output_per_1m": "$0.13",
      "input_original_per_1m": "$0.08",
      "output_original_per_1m": "$0.16",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "deepseek/deepseek-v4-flash-0731",
      "name": "deepseek-v4-flash-0731",
      "input_per_1m": "$0.11",
      "output_per_1m": "$0.22",
      "input_original_per_1m": "$0.14",
      "output_original_per_1m": "$0.28",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.3M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "deepseek/deepseek-v4-pro",
      "name": "deepseek-v4-pro",
      "input_per_1m": "$1.28",
      "output_per_1m": "$2.56",
      "input_original_per_1m": "$1.60",
      "output_original_per_1m": "$3.20",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "deepseek/deepseek-v4-pro-0813",
      "name": "deepseek-v4-pro-0813",
      "input_per_1m": "$0.95",
      "output_per_1m": "$2.85",
      "input_original_per_1m": "$1.19",
      "output_original_per_1m": "$3.56",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "sakana/fugu-ultra",
      "name": "fugu-ultra",
      "input_per_1m": "$4.00",
      "output_per_1m": "$24.00",
      "input_original_per_1m": "$5.00",
      "output_original_per_1m": "$30.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "google/gemini-3.1-pro-preview",
      "name": "gemini-3.1-pro-preview",
      "input_per_1m": "$1.60",
      "output_per_1m": "$9.60",
      "input_original_per_1m": "$2.00",
      "output_original_per_1m": "$12.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "google/gemini-3.7-flash",
      "name": "gemini-3.7-flash",
      "input_per_1m": "$0.30",
      "output_per_1m": "$1.50",
      "input_original_per_1m": "$0.38",
      "output_original_per_1m": "$1.88",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "z-ai/glm-5.1",
      "name": "glm-5.1",
      "input_per_1m": "$0.77",
      "output_per_1m": "$2.43",
      "input_original_per_1m": "$0.97",
      "output_original_per_1m": "$3.04",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "205K",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "openai/gpt-5.4-mini",
      "name": "gpt-5.4-mini",
      "input_per_1m": "$0.60",
      "output_per_1m": "$3.60",
      "input_original_per_1m": "$0.75",
      "output_original_per_1m": "$4.50",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "400K",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "openai/gpt-5.5",
      "name": "gpt-5.5",
      "input_per_1m": "$4.00",
      "output_per_1m": "$24.00",
      "input_original_per_1m": "$5.00",
      "output_original_per_1m": "$30.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.1M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "openai/gpt-5.5-pro",
      "name": "gpt-5.5-pro",
      "input_per_1m": "$24.00",
      "output_per_1m": "$144.00",
      "input_original_per_1m": "$30.00",
      "output_original_per_1m": "$180.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.1M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "openai/gpt-5.6-sol-pro",
      "name": "gpt-5.6-sol-pro",
      "input_per_1m": "$2.00",
      "output_per_1m": "$12.00",
      "input_original_per_1m": "$2.50",
      "output_original_per_1m": "$15.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.1M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "openai/gpt-5.6-terra-pro",
      "name": "gpt-5.6-terra-pro",
      "input_per_1m": "$2.00",
      "output_per_1m": "$12.00",
      "input_original_per_1m": "$2.50",
      "output_original_per_1m": "$15.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.1M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "x-ai/grok-4.6",
      "name": "grok-4.6",
      "input_per_1m": "$1.60",
      "output_per_1m": "$4.80",
      "input_original_per_1m": "$2.00",
      "output_original_per_1m": "$6.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "500K",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "moonshotai/kimi-k3",
      "name": "kimi-k3",
      "input_per_1m": "$2.40",
      "output_per_1m": "$12.00",
      "input_original_per_1m": "$3.00",
      "output_original_per_1m": "$15.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "xiaomi/mimo-v2.5-pro",
      "name": "mimo-v2.5-pro",
      "input_per_1m": "$0.35",
      "output_per_1m": "$0.70",
      "input_original_per_1m": "$0.43",
      "output_original_per_1m": "$0.87",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.1M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "minimax/minimax-m3",
      "name": "minimax-m3",
      "input_per_1m": "$0.24",
      "output_per_1m": "$0.96",
      "input_original_per_1m": "$0.30",
      "output_original_per_1m": "$1.20",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "nvidia/nemotron-3-super-120b-a12b",
      "name": "nemotron-3-super-120b-a12b",
      "input_per_1m": "$0.07",
      "output_per_1m": "$0.32",
      "input_original_per_1m": "$0.08",
      "output_original_per_1m": "$0.40",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "openai/gpt-5.6-sol",
      "name": "OpenAI: GPT-5.6 Sol",
      "input_per_1m": "$4.00",
      "output_per_1m": "$24.00",
      "input_original_per_1m": "$5.00",
      "output_original_per_1m": "$30.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.1M",
      "is_free": false,
      "is_paid_recommended": true
    },
    {
      "id": "openai/gpt-5.6-terra",
      "name": "OpenAI: GPT-5.6 Terra",
      "input_per_1m": "$2.00",
      "output_per_1m": "$12.00",
      "input_original_per_1m": "$2.50",
      "output_original_per_1m": "$15.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.1M",
      "is_free": false,
      "is_paid_recommended": true
    },
    {
      "id": "qwen/qwen3.8-max",
      "name": "qwen3.8-max",
      "input_per_1m": "$1.60",
      "output_per_1m": "$4.80",
      "input_original_per_1m": "$2.00",
      "output_original_per_1m": "$6.00",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": false
    },
    {
      "id": "z-ai/glm-5.2",
      "name": "z-ai/glm-5.2:US",
      "input_per_1m": "$0.77",
      "output_per_1m": "$2.43",
      "input_original_per_1m": "$0.97",
      "output_original_per_1m": "$3.04",
      "discount_input_pct": 20.0,
      "discount_output_pct": 20.0,
      "discount_avg_pct": 20.0,
      "context_length": "1.0M",
      "is_free": false,
      "is_paid_recommended": true
    }
  ]
}`)

// ── IDs ───────────────────────────────────────────────────────────────────
const ID = 'nous-models'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function DiscountBadge({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return jsx('span', { children: '—' })
  const color = pct >= 50 ? 'var(--ui-accent)'
    : pct >= 20 ? 'var(--ui-text-secondary)'
    : 'var(--ui-text-tertiary)'
  return jsx('span', {
    className: 'font-mono text-xs',
    style: { color },
    children: `${Math.round(pct)}%`
  })
}

function TierBadge({ isFree, isPaid }: { isFree: boolean; isPaid: boolean }) {
  if (isFree) return jsx('span', {
    className: cn(
      'inline-flex h-5 min-w-[28px] items-center justify-center rounded-full border',
      'px-1 text-[0.65rem] font-medium text-white',
      'bg-emerald-500/90 border-emerald-400/40'
    ),
    children: 'Free'
  })
  if (isPaid) return jsx('span', {
    className: cn(
      'inline-flex h-5 min-w-[36px] items-center justify-center rounded-full border',
      'px-1.5 text-[0.65rem] font-medium text-(--ui-accent)',
      'bg-(--ui-accent)/10 border-(--ui-accent)/30'
    ),
    children: 'Paid'
  })
  return jsx('span', {
    className: 'text-(--ui-text-tertiary) text-[0.65rem]',
    children: 'Standard'
  })
}

// ── Column header ──────────────────────────────────────────────────────────

function ColHeader({ label, width }: { label: string; width?: number }) {
  return jsx('div', {
    className: 'flex items-center gap-1 text-(--ui-text-tertiary) text-[0.65rem] uppercase tracking-wide',
    style: width != null ? { width } : undefined,
    children: label
  })
}

// ── Model row ──────────────────────────────────────────────────────────────

interface RowProps {
  model: (typeof MODEL_BUNDLE)['models'][number]
}

function ModelRow({ model }: RowProps) {
  return jsxs('div', {
    className: cn(
      'flex items-center gap-3 px-2 py-1.5 rounded-md',
      'hover:bg-(--chrome-action-hover) transition-colors cursor-default'
    ),
    'data-testid': `model-${model.id}`,
    children: [
      // Tier badge
      jsx(TierBadge, { isFree: model.is_free, isPaid: model.is_paid_recommended }),

      // Name
      jsx('div', {
        className: 'min-w-0 flex-1',
        children: jsxs('div', {
          className: 'text-sm font-medium truncate',
          children: [model.name, model.is_paid_recommended
            ? jsx('span', { className: 'ml-1.5 text-(--ui-text-tertiary) text-[0.65rem] font-normal', children: '★ recommended' })
            : null]
        })

      }),

      // Input price
      jsx('div', {
        className: 'w-[72px] text-right text-sm tabular-nums text-(--ui-text-secondary)',
        children: model.input_per_1m
      }),

      // Output price
      jsx('div', {
        className: 'w-[72px] text-right text-sm tabular-nums text-(--ui-text-secondary)',
        children: model.output_per_1m
      }),

      // Original prices (smaller, tertiary)
      jsx('div', {
        className: 'w-[80px] text-right text-[0.65rem] tabular-nums text-(--ui-text-tertiary) opacity-60',
        children: `${model.input_original_per_1m} / ${model.output_original_per_1m}`
      }),

      // Discount
      jsx('div', {
        className: 'w-[52px] text-right',
        children: jsx(DiscountBadge, { pct: model.discount_avg_pct })
      }),

      // Context
      jsx('div', {
        className: 'w-[48px] text-right text-sm tabular-nums text-(--ui-text-tertiary)',
        children: model.context_length
      }),
    ]
  })
}

// ── Pane ───────────────────────────────────────────────────────────────────

function NousModelsPane() {
  const t = usePluginI18n(ID)
  const bundle = MODEL_BUNDLE as (typeof MODEL_BUNDLE) | null
  const models = (bundle?.models ?? []) as (typeof MODEL_BUNDLE)['models']
  const stats = bundle?.stats as typeof bundle['stats'] | null

  return jsxs('div', {
    className: 'flex h-full flex-col text-sm',
    children: [
      // Header
      jsxs('div', {
        className: 'flex items-center gap-3 px-3 py-2 border-b border-(--ui-stroke-secondary)',
        children: [
          jsx('div', { className: 'font-medium text-lg', children: t('paneTitle') }),
          jsx('span', { className: 'text-(--ui-text-tertiary) text-[0.65rem]', children: stats ? `${stats.total} models · ${stats.free} free · ${stats.paid_recommended} paid` : '' }),
        ]
      }),

      // Column headers
      jsxs('div', {
        className: 'flex items-center gap-3 px-2 py-1.5 text-(--ui-text-tertiary) text-[0.65rem] uppercase tracking-wide border-b border-(--ui-stroke-secondary)',
        children: [
          jsx('div', { className: 'w-[72px]' }),
          jsx('div', { className: 'min-w-0 flex-1' }),
          jsx('div', { className: 'w-[72px] text-right' }),
          jsx('div', { className: 'w-[72px] text-right' }),
          jsx('div', { className: 'w-[80px] text-right', children: 'Original ($/1M)' }),
          jsx('div', { className: 'w-[52px] text-right', children: 'Disc.' }),
          jsx('div', { className: 'w-[48px] text-right', children: 'Ctx' }),
        ]
      }),

      // Scrollable rows
      jsxs('div', {
        className: 'flex-1 overflow-auto',
        children: models.length === 0
          ? jsx('div', { className: 'flex-1 flex items-center justify-center text-(--ui-text-tertiary) text-sm', children: t('empty') })
          : models.map((m) => jsx(ModelRow, { key: m.id, model: m }))
      }),

      // Footer / stats
      stats ? jsxs('div', {
        className: 'flex items-center gap-4 px-3 py-2 border-t border-(--ui-stroke-secondary) text-(--ui-text-tertiary) text-[0.65rem]',
        children: [
          jsx('span', { children: `Avg discount: ${fmtNum(stats.avg_discount_pct)}%` }),
          jsx('span', { children: `Updated: ${new Date(stats.fetched_at).toLocaleString()}` }),
          jsx('span', { className: 'ml-auto', children: 'Sources: model-catalog · /v1/models · /api/nous/recommended-models' }),
        ]
      }) : null,
    ]
  })
}

// ── Statusbar chip (compact model count) ───────────────────────────────────

function ModelsChip() {
  const t = usePluginI18n(ID)
  const bundle = MODEL_BUNDLE as (typeof MODEL_BUNDLE) | null
  const stats = bundle?.stats as typeof bundle['stats'] | null

  return jsx('div', {
    className: cn(
      'inline-flex h-5 items-center gap-1 px-1.5 text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
      'transition-colors text-[0.6875rem] cursor-default'
    ),
    children: stats
      ? [jsx('span', { className: 'text-(--ui-accent)', children: stats.total }),
         jsx('span', { children: `/${stats.free} free` })]
      : t('chipLoading')
  })
}

// ── Registration ───────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Nous Models & Pricing',
  register(ctx) {
    ctx.i18n.register({
      en: {
        paneTitle: 'Nous Models',
        empty: 'No models loaded',
        chipLoading: '…',
        free: 'Free',
        paid: 'Paid',
        standard: 'Standard',
        discount: 'Disc.',
        ctx: 'Ctx',
        input: 'In',
        output: 'Out',
      }
    })

    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Nous Models',
      data: { placement: 'right', width: '420px' },
      render: () => jsx(NousModelsPane, {})
    })

    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 140,
      render: () => jsx(ModelsChip, {})
    })
  }
}
