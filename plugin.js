/**
 * Hermes Desktop Plugin: Nous Models & Pricing
 *
 * Statusbar chip shows a live model count. Click it → a popup panel
 * lists every Nous Portal model with current + original pricing, the
 * discount %, context length, and free/paid-tier badges.
 *
 * Each model row is CLICKABLE:
 *   - primary click sets it as the current SESSION model
 *   - a "default" button sets it as the profile default model
 *
 * Data is LIVE — the plugin fetches the public Nous endpoints directly
 * from the browser every 10 minutes (both endpoints allow CORS). No
 * pricing is baked into this file, so the plugin never needs
 * regenerating to show new prices:
 *
 *   - https://hermes-agent.nousresearch.com/docs/api/model-catalog.json
 *       (redirects to nousresearch.github.io — CORS-enabled) → model list
 *   - https://inference-api.nousresearch.com/v1/models  (CORS-enabled)
 *       → current + original pricing, context length, :free variants
 *
 * Free-tier detection: a catalog model is flagged Free when a matching
 * `:free` variant exists in /v1/models with $0 pricing.
 *
 * Model switching uses the gateway RPC that the app's own composer uses:
 *   host.request('config.set', { session_id, key: 'model',
 *     value: '<id> --provider <provider> [--global|--session]' })
 *
 * Self-contained: no Python backend, no config change, no gateway
 * restart — drop plugin.js into desktop-plugins/<id>/ and reload.
 *
 * Plain ESM loaded uncompiled: UI is jsx() calls, NOT JSX syntax; only
 * @hermes/plugin-sdk, react, react/jsx-runtime resolve.
 */
import {
  cn,
  haptic,
  host,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  STATUSBAR_AREAS,
  usePluginI18n,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'nous-models'
const PROVIDER = 'nous'

const CATALOG_URL = 'https://hermes-agent.nousresearch.com/docs/api/model-catalog.json'
const PRICING_URL = 'https://inference-api.nousresearch.com/v1/models'

// ---------------------------------------------------------------------------
// Data fetching — live from the public Nous endpoints (React Query)
// ---------------------------------------------------------------------------

function formatPrice(tokenPrice) {
  if (tokenPrice == null) return '—'
  const perM = Number(tokenPrice) * 1_000_000
  if (!isFinite(perM)) return '—'
  if (perM === 0) return '$0.00'
  if (perM < 0.01) return `$${perM.toFixed(4)}`
  if (perM < 1) return `$${perM.toFixed(2)}`
  return `$${perM.toFixed(2)}`
}

function calcDiscount(cur, orig) {
  if (cur == null || orig == null) return null
  const c = Number(cur), o = Number(orig)
  if (!isFinite(c) || !isFinite(o) || o === 0) return null
  return Math.round((1 - c / o) * 100 * 10) / 10
}

function contextStr(n) {
  if (typeof n !== 'number') return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function baseId(id) {
  for (const s of [':free', ':US', ':batch']) {
    if (id.endsWith(s)) return id.slice(0, -s.length)
  }
  return id
}

async function fetchModels() {
  const [catResp, priceResp] = await Promise.all([
    fetch(CATALOG_URL, { headers: { Accept: 'application/json' } }),
    fetch(PRICING_URL, { headers: { Accept: 'application/json' } })
  ])
  if (!catResp.ok) throw new Error(`catalog HTTP ${catResp.status}`)
  if (!priceResp.ok) throw new Error(`pricing HTTP ${priceResp.status}`)

  const [catalog, pricingData] = await Promise.all([catResp.json(), priceResp.json()])

  const catalogModels = catalog?.providers?.nous?.models ?? []
  const allModels = pricingData?.data ?? pricingData ?? []

  const byId = new Map()
  const freeVariantIds = new Set()
  for (const m of allModels) {
    const mid = m && m.id
    if (!mid) continue
    byId.set(mid, m)
    if (mid.endsWith(':free')) freeVariantIds.add(baseId(mid))
  }

  const rows = catalogModels
    .filter(e => e && e.id)
    .map(e => {
      const mid = e.id
      const pm = byId.get(mid) || {}
      const pricing = (pm && pm.pricing) || {}
      const original = (pricing && pricing.original) || {}

      const promptCur = pricing.prompt
      const compCur = pricing.completion
      const promptOrig = original.prompt
      const compOrig = original.completion

      const dIn = calcDiscount(promptCur, promptOrig)
      const dOut = calcDiscount(compCur, compOrig)
      let avg = null
      if (dIn != null && dOut != null) avg = Math.round(((dIn + dOut) / 2) * 10) / 10
      else if (dIn != null) avg = dIn
      else if (dOut != null) avg = dOut

      let name = mid.includes('/') ? mid.split('/')[1] : mid
      if (name.startsWith('~')) name = name.slice(1)

      return {
        id: mid,
        name,
        input_per_1m: formatPrice(promptCur),
        output_per_1m: formatPrice(compCur),
        input_original_per_1m: formatPrice(promptOrig),
        output_original_per_1m: formatPrice(compOrig),
        discount_avg_pct: avg,
        context_length: contextStr(pm.context_length),
        is_free: freeVariantIds.has(mid)
      }
    })

  rows.sort((a, b) => {
    if (a.is_free !== b.is_free) return a.is_free ? -1 : 1
    const da = a.discount_avg_pct ?? -1
    const db = b.discount_avg_pct ?? -1
    if (db !== da) return db - da
    return a.name.localeCompare(b.name)
  })

  const withDisc = rows.filter(r => r.discount_avg_pct != null).map(r => r.discount_avg_pct)
  const stats = {
    total: rows.length,
    free: rows.filter(r => r.is_free).length,
    avg_discount_pct: withDisc.length ? Math.round((withDisc.reduce((a, b) => a + b, 0) / withDisc.length) * 10) / 10 : null,
    fetched_at: new Date().toISOString()
  }

  return { stats, models: rows }
}

function useModels() {
  return useQuery({
    queryKey: [ID, 'models'],
    queryFn: fetchModels,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 2
  })
}

// ---------------------------------------------------------------------------
// Model switching — mirrors the app's composer (use-model-controls.ts)
// ---------------------------------------------------------------------------

async function setModel({ model, provider = PROVIDER, scope }) {
  // scope: 'session' | 'global'  (global = profile default for new sessions)
  const sessionId = host.state.activeSessionId.get()
  const flag = scope === 'global' ? '--global' : '--session'
  const params = {
    key: 'model',
    value: `${model} --provider ${provider} ${flag}`
  }
  if (scope === 'session' && sessionId) params.session_id = sessionId
  return host.request('config.set', params)
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function DiscountBadge({ pct }) {
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

function TierBadge({ isFree }) {
  if (isFree) return jsx('span', {
    className: cn(
      'inline-flex h-5 min-w-[28px] items-center justify-center rounded-full border px-1',
      'text-[0.65rem] font-medium text-white bg-emerald-500/90 border-emerald-400/40'
    ),
    children: 'Free'
  })
  return jsx('span', {
    className: 'text-(--ui-text-tertiary) text-[0.65rem]',
    children: 'Std'
  })
}

// ---------------------------------------------------------------------------
// Model row — clickable to switch model
// ---------------------------------------------------------------------------

function ModelRow({ model, isCurrent, onSwitch }) {
  return jsxs('div', {
    className: cn(
      'group flex items-center gap-2 px-1.5 py-1.5 rounded-md transition-colors',
      'hover:bg-(--chrome-action-hover) cursor-pointer',
      isCurrent && 'bg-(--ui-accent)/8'
    ),
    'data-testid': `model-${model.id}`,
    onClick: () => onSwitch(model, 'session'),
    title: `Set as current session model: ${model.id}`,
    children: [
      jsx(TierBadge, { isFree: model.is_free }),
      jsx('div', {
        className: 'min-w-0 flex-1',
        children: jsxs('div', {
          className: 'flex items-center gap-1',
          children: [
            jsx('span', {
              className: cn('truncate text-[0.8125rem] font-medium', isCurrent && 'text-(--ui-accent)'),
              children: model.name
            }),
            isCurrent ? jsx('span', {
              className: 'shrink-0 text-[0.6rem] uppercase tracking-wide text-(--ui-accent)',
              children: 'now'
            }) : null
          ]
        })
      }),
      jsx('div', {
        className: 'w-[52px] text-right text-[0.75rem] tabular-nums text-(--ui-text-secondary)',
        title: `in ${model.input_per_1m} / out ${model.output_per_1m}`,
        children: `${model.input_per_1m}/${model.output_per_1m}`
      }),
      jsx('div', {
        className: 'w-[42px] text-right',
        children: jsx(DiscountBadge, { pct: model.discount_avg_pct })
      }),
      // Hover actions: set as default
      jsx('button', {
        type: 'button',
        onClick: (e) => { e.stopPropagation(); onSwitch(model, 'global') },
        title: 'Set as default model (new sessions)',
        className: cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-medium opacity-0 transition-opacity',
          'group-hover:opacity-100 hover:bg-(--chrome-action-hover) hover:text-foreground',
          'text-(--ui-text-tertiary)'
        ),
        children: 'default'
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Popup panel content
// ---------------------------------------------------------------------------

function ModelsPanel({ setStatus }) {
  const t = usePluginI18n(ID)
  const { data, isLoading, isError, refetch, isFetching } = useModels()

  // Current model from host state (reactive).
  const currentModel = useValue(host.state.model)

  const models = data?.models ?? []
  const stats = data?.stats ?? null

  const header = stats ? `${stats.total} models · ${stats.free} free` : ''

  const onSwitch = async (model, scope) => {
    haptic('tap')
    try {
      await setModel({ model: model.id, scope })
      const label = scope === 'global' ? 'Default model' : 'Session model'
      host.notify({
        kind: 'success',
        message: `${label} → ${model.name}`
      })
    } catch (err) {
      host.notify({
        kind: 'error',
        message: `Could not switch to ${model.name} (${scope})`
      })
    }
  }

  // A model is "current" if its short name appears in the active model slug.
  const currentSlug = String(currentModel || '').toLowerCase()

  return jsxs('div', {
    className: 'flex w-[400px] flex-col gap-1',
    children: [
      // Header row: title + stats + refresh button
      jsxs('div', {
        className: 'flex items-center justify-between gap-2 px-1 pt-1',
        children: [
          jsxs('div', {
            className: 'min-w-0',
            children: [
              jsx('div', { className: 'text-sm font-semibold', children: t('title') }),
              jsx('div', {
                className: 'truncate text-[0.65rem] text-(--ui-text-tertiary)',
                children: stats ? header : t('loading')
              })
            ]
          }),
          jsx('button', {
            type: 'button',
            onClick: () => { haptic('tap'); refetch() },
            disabled: isFetching,
            title: t('refreshTip'),
            className: cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
              'text-(--ui-text-secondary) transition-colors',
              'hover:bg-(--chrome-action-hover) hover:text-foreground',
              'disabled:opacity-50'
            ),
            children: isFetching ? '…' : '↻'
          })
        ]
      }),

      // Column headers
      jsxs('div', {
        className: 'flex items-center gap-2 px-1.5 pb-0.5 text-[0.6rem] uppercase tracking-wide text-(--ui-text-tertiary)',
        children: [
          jsx('div', { className: 'w-[52px]' }),
          jsx('div', { className: 'min-w-0 flex-1' }),
          jsx('div', { className: 'w-[52px] text-right', children: 'In/Out' }),
          jsx('div', { className: 'w-[42px] text-right', children: 'Disc' }),
          jsx('div', { className: 'w-[52px]' })
        ]
      }),

      // Body — fixed height so ScrollArea scrolls internally
      jsx('div', {
        className: 'h-[320px]',
        children: isLoading
          ? jsx('div', { className: 'flex h-full items-center justify-center text-[0.75rem] text-(--ui-text-tertiary)', children: t('loading') })
          : isError
            ? jsx('div', {
                className: 'flex flex-col items-center justify-center gap-1 p-3 text-center text-[0.75rem] text-(--ui-text-tertiary)',
                children: [
                  jsx('div', { children: t('error') }),
                  jsx('button', {
                    type: 'button',
                    onClick: () => refetch(),
                    className: cn(
                      'rounded-md border border-(--ui-stroke-secondary) px-2 py-0.5 text-[0.7rem]',
                      'hover:bg-(--chrome-action-hover)'
                    ),
                    children: t('retry')
                  })
                ]
              })
            : jsx(ScrollArea, {
                className: 'h-full',
                children: models.length === 0
                  ? jsx('div', { className: 'p-3 text-center text-[0.75rem] text-(--ui-text-tertiary)', children: t('empty') })
                  : jsxs('div', {
                      className: 'flex flex-col',
                      children: models.map(m =>
                        jsx(ModelRow, {
                          key: m.id,
                          model: m,
                          isCurrent: currentSlug.includes(baseId(m.id).split('/')[1]) || currentSlug.includes(m.name),
                          onSwitch
                        })
                      )
                    })
              })
      }),

      // Footer
      jsxs('div', {
        className: 'flex items-center justify-between border-t border-(--ui-stroke-secondary) px-1 pt-1 text-[0.6rem] text-(--ui-text-tertiary)',
        children: [
          jsx('span', {
            children: stats && stats.avg_discount_pct != null ? `Avg discount ${Math.round(stats.avg_discount_pct)}%` : ''
          }),
          jsx('span', { children: 'click model → session · hover "default" → new sessions' })
        ]
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Statusbar chip — opens the popup on click
// ---------------------------------------------------------------------------

function ModelsChip() {
  const t = usePluginI18n(ID)
  const { data } = useModels()
  const stats = data?.stats ?? null
  const chipLabel = stats ? `${stats.total} models` : 'Nous'

  return jsx(Popover, {
    children: [
      jsx(PopoverTrigger, {
        asChild: true,
        children: jsx('button', {
          type: 'button',
          title: t('chipTip'),
          className: cn(
            'flex h-full items-center gap-1 px-1.5 text-[0.6875rem] transition-colors',
            'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'
          ),
          children: [
            jsx('span', { className: 'text-(--ui-accent)', children: '◈' }),
            jsx('span', { children: chipLabel })
          ]
        })
      }),
      jsx(PopoverContent, {
        align: 'end',
        side: 'top',
        sideOffset: 6,
        className: 'w-auto p-2',
        children: jsx(ModelsPanel, {})
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export default {
  id: ID,
  name: 'Nous Models & Pricing',
  register(ctx) {
    ctx.i18n.register({
      en: {
        title: 'Nous Models',
        loading: 'Loading…',
        empty: 'No models available',
        error: 'Could not load models — check your connection.',
        retry: 'Retry',
        refreshTip: 'Refresh prices',
        chipTip: 'Nous models & pricing — click to view or switch'
      }
    })

    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 140,
      render: () => jsx(ModelsChip, {})
    })
  }
}
