/**
 * Hermes Desktop Plugin: Nous Models & Pricing
 *
 * Statusbar chip shows a live model count. Click it -> a popup panel
 * lists every Nous Portal model with current + original pricing, the
 * discount percent, and a "now" tag for the active model.
 *
 * No sidebar pane. No build step. No Python backend.
 * Fetches live data from the Nous Portal directly.
 */

import * as React from 'react'
import { jsx } from 'react/jsx-runtime'
import { host, Popover, PopoverContent, PopoverTrigger, STATUSBAR_AREAS, haptic, atom, computed, useValue } from '@hermes/plugin-sdk'
const { useState, useEffect, useCallback, useMemo } = React

// ---- Constants ----
const PANEL_W = 680
const ROW_H = 38
const BODY_H = 300

// ---- API helpers ----
async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.json()
}

function buildModelBundle() {
  // These two public endpoints together give us everything we need:
  //   model-catalog.json -> curated Nous Portal model IDs + provider display info
  //   /v1/models -> current pricing, original pricing, context_length, :free variants
  return { urls: { catalog: 'https://hermes-agent.nousresearch.com/docs/api/model-catalog.json', models: 'https://inference-api.nousresearch.com/v1/models' } }
}

function processBundle(catalog, v1models) {
  const byId = new Map(v1models.data.map(m => [m.id, m]))
  const catalogIds = new Set((catalog.models || []).map(m => m.id))

  // derive tier from the :free counterpart
  const isFree = (id) => byId.has(id + ':free')

  const rows = (catalog.models || [])
    .map(m => {
      const v1 = byId.get(m.id)
      if (!v1) return null
      const inp = v1.pricing?.prompt ?? null
      const out = v1.pricing?.completion ?? null
      const orig = v1.original_pricing ?? null
      let disc = null
      if (inp != null && orig?.prompt != null && orig.prompt > 0) {
        disc = Math.round((1 - inp / orig.prompt) * 100)
        if (disc < 0) disc = 0
        if (disc > 99) disc = 99
      }
      return {
        id: m.id,
        name: m.name || m.id.split('/').pop(),
        provider: m.provider || m.id.split('/')[0],
        tier: isFree(m.id) ? 'free' : 'std',
        badge: isFree(m.id) ? 'Free' : 'Std',
        input: inp,
        output: out,
        discount: disc,
        ctx: v1.context_length ?? null,
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.tier === 'free' && b.tier !== 'free') return -1
      if (a.tier !== 'free' && b.tier === 'free') return 1
      if (a.discount == null && b.discount == null) return 0
      if (a.discount == null) return 1
      if (b.discount == null) return -1
      return (b.discount ?? 0) - (a.discount ?? 0)
    })

  const freeCount = rows.filter(r => r.tier === 'free').length
  const discounts = rows.map(r => r.discount).filter(v => v != null)
  const avgDisc = discounts.length ? Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length) : 0

  return { models: rows, freeCount, total: rows.length, avgDiscount: avgDisc, fetchedAt: Date.now() }
}

// ---- Focused session id from the desktop SDK ----
function getFocusedSessionId() {
  try {
    const raw = host.state.activeSessionId?.get?.() ?? host.state.activeSessionId ?? null
    if (raw) return String(raw).trim()
  } catch {}
  return null
}

// ---- Format a compact price string ----
function fmtPrice(p) {
  if (p == null) return '—'
  if (p === 0) return 'free'
  if (p < 0.0001) return `$${(p * 1e6).toFixed(2)}/1M`
  if (p < 0.01) return `$${(p * 1e3).toFixed(2)}/K`
  return `$${p.toFixed(p < 1 ? 4 : 2)}`
}

// ---- Switch model via gateway RPC (same path the app's own picker uses) ----
async function setModel({ model, scope = 'session' }) {
  const provider = 'nous'
  const sid = getFocusedSessionId()
  if (!sid) throw new Error('no focused session — open a chat and try again')
  const rawValue = scope === 'global'
    ? `${model} --provider ${provider} --global`
    : `${model} --provider ${provider} --session`
  const res = await host.request('config.set', {
    session_id: sid,
    key: 'model',
    value: rawValue,
  })
  // config.set returns { value, deferred? } on success
  return res
}

// ---- Sound via haptic (same mechanism the app uses for native tap feedback) ----
function tap() {
  try { haptic('tap') } catch {}
}

// ---- Component: one model row ----
function ModelRow({ model, isCurrent, onSetDefault, onSetSession }) {
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: `${ROW_H}px`,
    padding: '0 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    backgroundColor: isCurrent ? 'var(--ui-accent-muted, rgba(59,130,246,0.12))' : 'transparent',
    transition: 'background-color 80ms',
  }
  const nameStyle = {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '13px',
    fontWeight: isCurrent ? 600 : 400,
    color: 'var(--foreground)',
  }
  const badgeBase = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '18px',
    padding: '0 6px',
    borderRadius: '9999px',
    fontSize: '10px',
    fontWeight: 700,
    lineHeight: 1,
    flexShrink: 0,
  }
  const badgeFree = { ...badgeBase, backgroundColor: 'rgba(34,197,94,0.15)', color: '#16a34a' }
  const badgeStd  = { ...badgeBase, backgroundColor: 'rgba(148,163,184,0.15)', color: '#94a3b8' }

  return jsx('div', {
    style: rowStyle,
    onMouseEnter: (e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'var(--chrome-action-hover, rgba(255,255,255,0.04))' },
    onMouseLeave: (e) => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'transparent' },
    onClick: async () => {
      tap()
      try {
        await onSetSession(model.id)
      } catch (err) {
        host.notify({ kind: 'error', message: `Session model switch failed: ${err.message}` })
      }
    },
    title: `Set "${model.id}" as current session model`,
    children: [
      jsx('span', { style: model.tier === 'free' ? badgeFree : badgeStd, children: model.badge }),
      jsx('span', { style: nameStyle, children: model.name }),
      jsx('span', {
        style: { fontSize: '11px', color: 'var(--muted-foreground)', width: '90px', textAlign: 'right', flexShrink: 0 },
        children: model.ctx ? `${(model.ctx / 1024).toFixed(0)}k ctx` : '—'
      }),
      jsx('span', {
        style: { fontSize: '11px', color: 'var(--muted-foreground)', width: '64px', textAlign: 'right', flexShrink: 0 },
        children: model.input == null ? '—' : `$${model.input.toFixed(2)}`
      }),
      jsx('span', {
        style: { fontSize: '11px', color: 'var(--muted-foreground)', width: '64px', textAlign: 'right', flexShrink: 0 },
        children: model.output == null ? '—' : `$${model.output.toFixed(2)}`
      }),
      jsx('span', {
        style: { fontSize: '11px', width: '46px', textAlign: 'right', fontWeight: 600, color: model.discount ? 'var(--accent)' : 'var(--muted-foreground)', flexShrink: 0 },
        children: model.discount == null ? '—' : `-${model.discount}%`
      }),
      isCurrent
        ? jsx('span', {
            style: { fontSize: '10px', padding: '0 6px', borderRadius: '4px', backgroundColor: 'var(--accent)', color: 'var(--accent-fg, #fff)', fontWeight: 700, height: '18px', lineHeight: '18px', flexShrink: 0 },
            children: 'now'
          })
        : jsx('button', {
            style: {
              appearance: 'none', border: '1px solid var(--ui-stroke-secondary)', borderRadius: '4px',
              background: 'transparent', color: 'var(--ui-text-secondary)', fontSize: '10px',
              padding: '2px 8px', cursor: 'pointer', flexShrink: 0, lineHeight: '14px'
            },
            onClick: async (e) => {
              e.stopPropagation()
              tap()
              try {
                await onSetDefault(model.id)
              } catch (err) {
                host.notify({ kind: 'error', message: `Default model switch failed: ${err.message}` })
              }
            },
            title: `Set "${model.id}" as profile default`,
            children: 'default'
          }),
    ]
  })
}

// ---- Component: main popup body ----
function NousPopup() {
  const [open, setOpen] = useState(false)
  const [bundle, setBundle] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const currentModelRaw = useValue(host.state.model) ?? ''

  const load = useCallback(async () => {
    setError(null)
    try {
      const spec = buildModelBundle()
      const [catalog, v1] = await Promise.all([
        fetchJSON(spec.urls.catalog),
        fetchJSON(spec.urls.models),
      ])
      const processed = processBundle(catalog, v1)
      setBundle(processed)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { if (open) { void load() } }, [open, load])

  // Refresh every 10 minutes while open
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => { setRefreshing(true); void load().finally(() => setRefreshing(false)) }, 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [open, load])

  // Exact current-model match: strip any trailing flags off the stored value.
  function getCurrentModelSlug() {
    const raw = String(currentModelRaw || '').trim()
    const firstSpace = raw.search(/\s/)
    const base = firstSpace >= 0 ? raw.slice(0, firstSpace) : raw
    return base.toLowerCase()
  }
  const currentSlug = getCurrentModelSlug()

  // Actions
  const onSetDefault = useCallback(async (modelId) => {
    const res = await setModel({ model: modelId, scope: 'global' })
    if (res?.deferred) {
      host.notify({ kind: 'info', message: `Default model -> ${modelId} (applies to new sessions)` })
    }
  }, [])
  const onSetSession = useCallback(async (modelId) => {
    const res = await setModel({ model: modelId, scope: 'session' })
    if (res?.deferred) {
      host.notify({ kind: 'info', message: `Session model -> ${modelId} (applies next turn)` })
    }
  }, [])

  const contentStyle = {
    width: `${PANEL_W}px`,
    maxWidth: '95vw',
    backgroundColor: 'var(--card, var(--background))',
    border: '1px solid var(--ui-stroke-secondary)',
    borderRadius: '8px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    overflow: 'hidden',
  }

  const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid var(--ui-stroke-secondary)',
    gap: '8px',
  }
  const titleStyle = { fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', letterSpacing: '0.02em' }
  const countChipStyle = { fontSize: '10px', padding: '2px 8px', borderRadius: '9999px', backgroundColor: 'var(--ui-stroke-secondary)', color: 'var(--ui-text-secondary)' }
  const refreshBtnStyle = { appearance: 'none', border: '1px solid var(--ui-stroke-secondary)', borderRadius: '4px', background: 'transparent', color: refreshing ? 'var(--accent)' : 'var(--ui-text-secondary)', cursor: 'pointer', fontSize: '11px', padding: '2px 8px', lineHeight: '16px', opacity: refreshing ? 0.7 : 1, transition: 'opacity 100ms' }
  const footerStyle = { padding: '6px 14px', borderTop: '1px solid var(--ui-stroke-secondary)', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--muted-foreground)' }
  const scrollBodyStyle = { height: `${BODY_H}px`, overflowY: 'auto', padding: '6px' }
  const colHeadStyle = { display: 'flex', alignItems: 'center', height: '22px', padding: '0 12px', fontSize: '10px', fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--ui-stroke-secondary)', marginBottom: '2px' }
  const colSpacer = { flex: '0 0 40px' }

  return jsx(Popover, { open, onOpenChange: setOpen, children: [
    jsx(PopoverTrigger, { asChild: true, children:
      jsx('button', {
        id: 'nous-models-chip',
        onClick: () => tap(),
        style: {
          appearance: 'none', border: 'none', background: 'transparent',
          color: 'var(--ui-text-secondary)', cursor: 'pointer',
          fontSize: '11px', lineHeight: '20px', height: '20px',
          padding: '0 8px', borderRadius: '4px',
          transition: 'background-color 100ms, color 100ms',
          display: 'inline-flex', alignItems: 'center', gap: '4px',
        },
        title: 'Nous Models & Pricing — click to open',
        children: [
          jsx('span', { children: bundle ? `${bundle.total}/${bundle.freeCount}` : '...' }),
          refreshing ? jsx('span', { style: { fontSize: '8px' }, children: '↻' }) : null,
        ]
      })
    }),
    jsx(PopoverContent, {
      align: 'end', sideOffset: 6, style: contentStyle,
      onOpenAutoFocus: (e) => e.preventDefault(),
      children: [
        jsx('div', { style: headerStyle, children: [
          jsx('span', { style: titleStyle, children: 'Nous Portal Models' }),
          jsx('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } , children: [
            jsx('span', { style: countChipStyle, children: bundle ? `${bundle.total} models / ${bundle.freeCount} free` : 'loading…' }),
            jsx('button', { style: refreshBtnStyle, onClick: () => { setRefreshing(true); void load().finally(() => setRefreshing(false)) }, disabled: refreshing, children: refreshing ? 'refreshing…' : 'refresh' }),
          ]}),
        ]}),

        // Column headers
        jsx('div', { style: { ...colHeadStyle, display: 'flex', gap: '8px', padding: '0 12px' }, children: [
          jsx('span', { style: { width: '36px', textAlign: 'center' }, children: 'Tier' }),
          jsx('span', { style: { flex: 1 }, children: 'Name' }),
          jsx('span', { style: { width: '70px', textAlign: 'center' }, children: 'Context' }),
          jsx('span', { style: { width: '62px', textAlign: 'right' }, children: 'In $/1M' }),
          jsx('span', { style: { width: '62px', textAlign: 'right' }, children: 'Out $/1M' }),
          jsx('span', { style: { width: '46px', textAlign: 'right' }, children: 'Disc.' }),
          jsx('span', { style: colSpacer }),
        ]}),

        error
          ? jsx('div', { style: { ...scrollBodyStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--destructive, #ef4444)', fontSize: '12px', padding: '24px' }, children: `Failed to load: ${error}` })
          : !bundle
            ? jsx('div', { style: { ...scrollBodyStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)', fontSize: '12px' }, children: 'Loading models…' })
            : jsx('div', { style: scrollBodyStyle, children: bundle.models.map(m =>
                jsx(ModelRow, {
                  key: m.id,
                  model: m,
                  isCurrent: m.id === currentSlug,
                  onSetDefault,
                  onSetSession,
                })
              )
            }),

        jsx('div', { style: footerStyle, children: [
          jsx('span', { children: `avg discount: ${bundle ? bundle.avgDiscount : '—'}%` }),
          jsx('span', { children: bundle ? new Date(bundle.fetchedAt).toLocaleTimeString() : '' }),
        ]}),
      ]
    }),
  ] })
}

// ---- Register: statusbar chip only (no sidebar pane) ----
export default {
  id: 'nous-models',
  name: 'Nous Models & Pricing',
  register(ctx) {
    ctx.register({
      id: 'nous-models-statusbar-chip',
      area: STATUSBAR_AREAS.right,
      order: 100,
      render: () => jsx(NousPopup, {}),
    })
  },
}
