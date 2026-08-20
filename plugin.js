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
 * Data is LIVE — fetched from the public Nous endpoints directly from
 * the browser every 10 minutes (both allow CORS). No pricing is baked
 * into this file.
 *
 * IMPORTANT (Tailwind): plugin files load at RUNTIME, after the app's
 * Tailwind build-time scan, so arbitrary-value utility classes that
 * appear ONLY here (h-[320px], w-[52px], text-[0.8125rem], …) are NOT
 * compiled into the app CSS. Use inline `style={{}}` for every custom
 * dimension/size; reserve utility classes for standard ones (flex,
 * items-center, gap-2, rounded-md, truncate, …).
 *
 * Model switching uses the same `config.set` gateway RPC as the app's
 * own model picker:
 *   host.request('config.set', { session_id, key: 'model',
 *     value: '<id> --provider <provider> [--global|--session]' })
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

      const dIn = calcDiscount(pricing.prompt, original.prompt)
      const dOut = calcDiscount(pricing.completion, original.completion)
      let avg = null
      if (dIn != null && dOut != null) avg = Math.round(((dIn + dOut) / 2) * 10) / 10
      else if (dIn != null) avg = dIn
      else if (dOut != null) avg = dOut

      let name = mid.includes('/') ? mid.split('/')[1] : mid
      if (name.startsWith('~')) name = name.slice(1)

      return {
        id: mid,
        name,
        input_per_1m: formatPrice(pricing.prompt),
        output_per_1m: formatPrice(pricing.completion),
        input_original_per_1m: formatPrice(original.prompt),
        output_original_per_1m: formatPrice(original.completion),
        discount_avg_pct: avg,
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
  // scope: 'session' | 'global'
  const sessionId = host.state.focusedSessionId.get() || host.state.activeSessionId.get()
  const flag = scope === 'global' ? '--global' : '--session'
  const params = {
    key: 'model',
    value: `${model} --provider ${provider} ${flag}`
  }
  // Always pass the session id when we have one; the gateway applies a
  // session-scoped switch to that live session (deferring a mid-turn swap
  // to the next turn). `--global` persists to config.yaml regardless.
  if (sessionId) params.session_id = sessionId
  return host.request('config.set', params)
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const ROW_H = 28            // px, per row
const TIER_W = 52           // px
const PRICE_W = 52          // px
const DISC_W = 42           // px
const ACTION_W = 56         // px (hover "default" button)
const PANEL_W = 400         // px

function DiscountBadge({ pct }) {
  if (pct == null) return jsx('span', { children: '—' })
  const color = pct >= 50 ? 'var(--ui-accent)'
    : pct >= 20 ? 'var(--ui-text-secondary)'
    : 'var(--ui-text-tertiary)'
  return jsx('span', {
    style: { color, fontFamily: 'var(--font-mono)', fontSize: '12px' },
    children: `${Math.round(pct)}%`
  })
}

function TierBadge({ isFree }) {
  if (isFree) return jsx('span', {
    style: {
      display: 'inline-flex',
      height: '20px',
      minWidth: '28px',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '9999px',
      border: '1px solid rgba(52,211,153,0.4)',
      padding: '0 4px',
      fontSize: '10px',
      fontWeight: 500,
      color: '#fff',
      background: 'rgba(16,185,129,0.9)'
    },
    children: 'Free'
  })
  return jsx('span', {
    style: { fontSize: '10px', color: 'var(--ui-text-tertiary)' },
    children: 'Std'
  })
}

// ---------------------------------------------------------------------------
// Model row — clickable to switch model
// ---------------------------------------------------------------------------

function ModelRow({ model, isCurrent, onSwitch }) {
  return jsxs('div', {
    role: 'button',
    tabIndex: 0,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '5px 6px',
      borderRadius: '6px',
      cursor: 'pointer',
      height: `${ROW_H}px`,
      boxSizing: 'border-box'
    },
    className: cn(
      'group transition-colors',
      'hover:bg-(--chrome-action-hover)',
      isCurrent && 'bg-(--ui-accent)/8'
    ),
    'data-testid': `model-${model.id}`,
    onClick: () => onSwitch(model, 'session'),
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') onSwitch(model, 'session') },
    title: `Set as current session model: ${model.id}`,
    children: [
      jsx(TierBadge, { isFree: model.is_free }),

      // Name
      jsx('div', {
        style: { flex: '1 1 0%', minWidth: '0' },
        children: jsxs('div', {
          style: { display: 'flex', alignItems: 'center', gap: '4px' },
          children: [
            jsx('span', {
              style: {
                fontSize: '13px',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: isCurrent ? 'var(--ui-accent)' : undefined
              },
              children: model.name
            }),
            isCurrent ? jsx('span', {
              style: { fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ui-accent)', flexShrink: 0 },
              children: 'now'
            }) : null
          ]
        })
      }),

      // In/Out price
      jsx('div', {
        style: { width: `${PRICE_W}px`, textAlign: 'right', fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--ui-text-secondary)' },
        title: `in ${model.input_per_1m} / out ${model.output_per_1m}`,
        children: `${model.input_per_1m}/${model.output_per_1m}`
      }),

      // Discount
      jsx('div', {
        style: { width: `${DISC_W}px`, textAlign: 'right' },
        children: jsx(DiscountBadge, { pct: model.discount_avg_pct })
      }),

      // Hover "default" action
      jsx('button', {
        type: 'button',
        onClick: (e) => { e.stopPropagation(); onSwitch(model, 'global') },
        title: 'Set as default model (new sessions)',
        style: {
          width: `${ACTION_W}px`,
          flexShrink: 0,
          borderRadius: '4px',
          padding: '2px 4px',
          fontSize: '10px',
          fontWeight: 500,
          color: 'var(--ui-text-tertiary)',
          opacity: 0,
          transition: 'opacity 100ms'
        },
        className: 'group-hover:opacity-100 hover:bg-(--chrome-action-hover) hover:text-foreground',
        children: 'default'
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Popup panel content
// ---------------------------------------------------------------------------

function ModelsPanel() {
  const t = usePluginI18n(ID)
  const { data, isLoading, isError, refetch, isFetching } = useModels()

  const currentModel = useValue(host.state.model)

  const models = data?.models ?? []
  const stats = data?.stats ?? null

  const header = stats ? `${stats.total} models · ${stats.free} free` : ''

  const onSwitch = async (model, scope) => {
    haptic('tap')
    try {
      await setModel({ model: model.id, scope })
    } catch (err) {
      host.notify({ kind: 'error', message: `Could not switch to ${model.name} (${scope}): ${err?.message || err}` })
    }
  }

  const currentSlug = String(currentModel || '').toLowerCase()

  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '4px', width: `${PANEL_W}px` },
    children: [
      // Header
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '2px 2px 0' },
        children: [
          jsxs('div', {
            style: { minWidth: '0' },
            children: [
              jsx('div', { style: { fontSize: '14px', fontWeight: 600 }, children: t('title') }),
              jsx('div', {
                style: { fontSize: '10px', color: 'var(--ui-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                children: stats ? header : t('loading')
              })
            ]
          }),
          jsx('button', {
            type: 'button',
            onClick: () => { haptic('tap'); refetch() },
            disabled: isFetching,
            title: t('refreshTip'),
            style: {
              display: 'flex', height: '24px', width: '24px', flexShrink: 0,
              alignItems: 'center', justifyContent: 'center', borderRadius: '6px',
              color: 'var(--ui-text-secondary)', opacity: isFetching ? 0.5 : 1
            },
            className: 'hover:bg-(--chrome-action-hover) hover:text-foreground',
            children: isFetching ? '…' : '↻'
          })
        ]
      }),

      // Column headers
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 6px', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ui-text-tertiary)' },
        children: [
          jsx('div', { style: { width: `${TIER_W}px` } }),
          jsx('div', { style: { flex: '1 1 0%', minWidth: '0' } }),
          jsx('div', { style: { width: `${PRICE_W}px`, textAlign: 'right' }, children: 'In/Out' }),
          jsx('div', { style: { width: `${DISC_W}px`, textAlign: 'right' }, children: 'Disc' }),
          jsx('div', { style: { width: `${ACTION_W}px` } })
        ]
      }),

      // Body — fixed height + overflow-y:auto (inline style, not a Tailwind
      // arbitrary class, so the scroll actually works in the shipped CSS).
      jsx('div', {
        style: { height: '300px', overflowY: 'auto' },
        children: isLoading
          ? jsx('div', { style: { display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'var(--ui-text-tertiary)' }, children: t('loading') })
          : isError
            ? jsx('div', {
                style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--ui-text-tertiary)' },
                children: [
                  jsx('div', { children: t('error') }),
                  jsx('button', {
                    type: 'button',
                    onClick: () => refetch(),
                    style: { borderRadius: '6px', border: '1px solid var(--ui-stroke-secondary)', padding: '2px 8px', fontSize: '11px' },
                    className: 'hover:bg-(--chrome-action-hover)',
                    children: t('retry')
                  })
                ]
              })
            : models.length === 0
              ? jsx('div', { style: { padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--ui-text-tertiary)' }, children: t('empty') })
              : jsxs('div', {
                  style: { display: 'flex', flexDirection: 'column' },
                  children: models.map(m =>
                    jsx(ModelRow, {
                      key: m.id,
                      model: m,
                      isCurrent: currentSlug.includes(baseId(m.id).split('/')[1]) || currentSlug.includes(m.name),
                      onSwitch
                    })
                  )
                })
      }),

      // Footer
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--ui-stroke-secondary)', padding: '4px 2px 0', fontSize: '9px', color: 'var(--ui-text-tertiary)' },
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
          style: { display: 'flex', height: '100%', alignItems: 'center', gap: '4px', padding: '0 6px', fontSize: '11px', color: 'var(--ui-text-secondary)' },
          className: 'transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
          children: [
            jsx('span', { style: { color: 'var(--ui-accent)' }, children: '◈' }),
            jsx('span', { children: chipLabel })
          ]
        })
      }),
      jsx(PopoverContent, {
        align: 'end',
        side: 'top',
        sideOffset: 6,
        style: { width: 'auto', padding: '8px' },
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
