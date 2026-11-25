/**
 * Hermes Desktop Plugin: Nous Models & Pricing
 *
 * Statusbar chip opens a popup listing every Nous Portal model with current
 * pricing, original pricing and the discount percent. Per-row actions:
 *   - click a row  -> switch the FOCUSED chat's session model
 *   - "default"    -> pin the model as this profile's default (new sessions)
 *
 * No sidebar pane. No build step. No Python backend.
 * Fetches live data from the Nous Portal directly.
 */

import * as React from 'react'
import { jsx } from 'react/jsx-runtime'
import {
  host, Popover, PopoverContent, PopoverTrigger, STATUSBAR_AREAS, Codicon, haptic,
  surfaceModelSwitchConfirm
} from '@hermes/plugin-sdk'
const { useState, useEffect, useCallback } = React

// ---- Constants ----
const PANEL_W = 680
const ROW_H = 38
const BODY_H = 300
const PROVIDER = 'nous'

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
  return { urls: { catalog: 'https://nousresearch.github.io/hermes-agent/docs/api/model-catalog.json', models: 'https://inference-api.nousresearch.com/v1/models' } }
}

function processBundle(catalog, v1models) {
  const byId = new Map(v1models.data.map(m => [m.id, m]))
  const nous = catalog?.providers?.[PROVIDER]?.models
  const catalogRows = Array.isArray(nous) ? nous : []

  // derive tier from the :free counterpart OR literal $0 pricing on the
  // base ID itself (some models, e.g. stealth/ox-alpha, are simply listed
  // at 0 with no :free variant at all).
  const num0 = (x) => { const n = Number(x); return Number.isFinite(n) ? n === 0 : false }
  const isFree = (id) => byId.has(id + ':free') || (() => {
    const base = byId.get(id)
    return !!base && num0(base.pricing?.prompt) && num0(base.pricing?.completion)
  })()

  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null }
  const clampDisc = (d) => { if (d == null) return null; if (d < 0) return 0; if (d > 99) return 99; return d }

  const rows = catalogRows
    .map(m => {
      const id = typeof m === 'string' ? m : m.id
      const freeVar = id + ':free'
      const freeEntry = byId.get(freeVar)
      if (isFree(id)) {
        // A :free variant exists: the selectable ID is actually the :free one,
        // and the displayed pricing should come from that ($0) entry so the
        // Free badge and the submitted model stay consistent.
        // If there's no :free variant, the BASE id itself is free-priced
        // (e.g. stealth/ox-alpha): selectable id and pricing come from it.
        const v1 = freeEntry ?? byId.get(id)
        if (!v1) return null
        const selectable = freeEntry ? freeVar : id
        const inp = num(v1.pricing?.prompt)
        const out = num(v1.pricing?.completion)
        const origPrompt = num(v1.pricing?.original?.prompt)
        const origCompletion = num(v1.pricing?.original?.completion)
        let disc = null
        if (origPrompt != null && origPrompt > 0) {
          const base = byId.get(id)
          const baseInp = num(base?.pricing?.prompt)
          const baseOut = num(base?.pricing?.completion)
          if (baseInp != null && baseOut != null && baseOut > 0) {
            const avgOrig = (origPrompt + origCompletion) / 2
            const avgCur = (baseInp + baseOut) / 2
            disc = Math.round((1 - avgCur / avgOrig) * 100)
          }
        }
        return {
          id,
          selectableId: selectable,
          name: id.split('/').pop(),
          provider: id.split('/')[0],
          tier: 'free',
          badge: 'Free',
          input: inp,
          output: out,
          discount: clampDisc(disc),
          ctx: v1.context_length ?? null,
        }
      }

      const v1 = byId.get(id)
      if (!v1) return null
      const inp = num(v1.pricing?.prompt)
      const out = num(v1.pricing?.completion)
      const origPrompt = num(v1.pricing?.original?.prompt)
      const origCompletion = num(v1.pricing?.original?.completion)
      let disc = null
      if (inp != null && out != null && origPrompt != null && origCompletion != null && origPrompt > 0 && origCompletion > 0) {
        const avgOrig = (origPrompt + origCompletion) / 2
        const avgCur = (inp + out) / 2
        disc = Math.round((1 - avgCur / avgOrig) * 100)
      }
      return {
        id,
        selectableId: id,
        name: id.split('/').pop(),
        provider: id.split('/')[0],
        tier: 'std',
        badge: 'Std',
        input: inp,
        output: out,
        discount: clampDisc(disc),
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

  // Surface any :free model whose base isn't in the curated catalog. The
  // terminal lists all of /v1/models, but the catalog only carries a subset;
  // free models not in the catalog would otherwise never appear.
  const catalogBaseIds = new Set(rows.map(r => r.id))
  for (const m of v1models.data) {
    if (!m.id.endsWith(':free')) continue
    const base = m.id.slice(0, -':free'.length)
    if (catalogBaseIds.has(base)) continue
    rows.push({
      id: base,
      selectableId: m.id,
      name: base.split('/').pop(),
      provider: base.split('/')[0],
      tier: 'free',
      badge: 'Free',
      input: num(m.pricing?.prompt),
      output: num(m.pricing?.completion),
      discount: null,
      ctx: m.context_length ?? null,
    })
  }

  const freeCount = rows.filter(r => r.tier === 'free').length
  const discounts = rows.map(r => r.discount).filter(v => v != null)
  const avgDisc = discounts.length ? Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length) : 0

  return { models: rows, freeCount, total: rows.length, avgDiscount: avgDisc, fetchedAt: Date.now() }
}

// ---- Focused runtime id / profile name ----
// Use the focused tile when there is one; fall back to the primary active
// runtime. This is the same targeting rule used by the desktop model picker.
function readAtom(atom) {
  // host.state.* are readonly atoms: .get() returns the value. Never pass an
  // atom itself as session_id — the gateway keys sessions in a dict keyed by
  // that string and crashes with "unhashable type" on a non-string.
  try {
    const v = typeof atom?.get === 'function' ? atom.get() : atom
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

function getRuntimeId() {
  return readAtom(host.state.focusedSessionId) || readAtom(host.state.activeSessionId)
}

/** The profile whose config holds the default model: the focused chat's owner,
 *  else the gateway socket's own profile. */
function getProfileName() {
  return readAtom(host.state.focusedSessionProfile) || readAtom(host.state.profile) || 'default'
}

// The popup intentionally does not mark any row as "now": the composer model
// is sticky UI state and session.info events are asynchronous, so a possibly
// stale highlight is worse than a neutral list.

// ---- Switch the FOCUSED chat's session model ----
// The composer picker's own wire: `config.set key=model`, value
// `<model> --provider <id> --session`. The shared gateway turns that into its
// revision-fenced `session.mutate` model operation (it refuses `model` as a
// config write), so this stays the one supported door for a session switch.
function requestSessionSwitch(modelId, confirmExpensive) {
  const sid = getRuntimeId()
  if (!sid) throw new Error('Open a chat first — a session model needs a live session')
  const params = { session_id: sid, key: 'model', value: `${modelId} --provider ${PROVIDER} --session` }
  if (confirmExpensive) params.confirm_expensive_model = true
  return host.request('config.set', params)
}

// ---- Pin the PROFILE default ----
// `config.set key=model` can never write config.yaml on the shared gateway
// (and `--global` is not even a picker value the app translates), so the
// profile-default door is `profiles.configure` — the call the Bots editor and
// the settings model surfaces use. It honours the expensive/data-policy guard
// with the same `confirm_expensive_model` handshake.
function requestDefaultSwitch(modelId, confirmExpensive) {
  const params = { name: getProfileName(), model: modelId, provider: PROVIDER }
  if (confirmExpensive) params.confirm_expensive_model = true
  return host.request('profiles.configure', params)
}

/** Run one pick, routing a guarded (`confirm_required`) answer through the
 *  app's shared confirm dialog and resending only on a confirmed yes.
 *  Resolves the applied result, or null when declined/failed (the shared
 *  applier already toasted the failure). */
async function applyPick({ request, modelId, failureMessage }) {
  const first = await request(false)
  if (!first?.confirm_required) return first ?? { ok: true }

  const applied = await surfaceModelSwitchConfirm({
    confirmMessage: first.confirm_message,
    failureMessage,
    model: modelId,
    requestConfirmed: () => request(true),
  })
  return applied ? { ok: true, applied: true } : null
}

// ---- Sound via haptic (same mechanism the app uses for native tap feedback) ----
function tap() {
  try { haptic('tap') } catch {}
}

// ---- Format a compact price string ----
function fmtPrice(p) {
  if (p == null) return '—'
  if (p === 0) return 'free'
  if (p < 0.0001) return `$${(p * 1e6).toFixed(2)}/1M`
  if (p < 0.01) return `$${(p * 1e3).toFixed(2)}/K`
  return `$${p.toFixed(p < 1 ? 4 : 2)}`
}

// ---- Component: one model row ----
function ModelRow({ model, busy, onSetDefault, onSetSession }) {
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: `${ROW_H}px`,
    padding: '0 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    backgroundColor: 'transparent',
    transition: 'background-color 80ms',
    opacity: busy ? 0.6 : 1,
    pointerEvents: busy ? 'none' : 'auto',
  }
  const nameStyle = {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '13px',
    fontWeight: 400,
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
    onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = 'var(--chrome-action-hover, rgba(255,255,255,0.04))' },
    onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent' },
    onClick: async () => {
      tap()
      try {
        const res = await onSetSession(model.selectableId)
        if (!res) return // declined, or failed with its own toast
        if (res.deferred) {
          host.notify({ kind: 'info', message: `Session model -> ${model.selectableId} (applies next turn)` })
        }
      } catch (err) {
        host.notify({ kind: 'error', message: `Session model switch failed: ${err.message}` })
      }
    },
    title: `Set "${model.id}" as the focused chat's model`,
    children: [
      jsx('span', { style: model.tier === 'free' ? badgeFree : badgeStd, children: model.badge }),
      jsx('span', { style: nameStyle, children: model.name }),
      jsx('span', {
        style: { fontSize: '11px', color: 'var(--muted-foreground)', width: '90px', textAlign: 'right', flexShrink: 0 },
        children: model.ctx ? `${(model.ctx / 1024).toFixed(0)}k ctx` : '—'
      }),
      jsx('span', {
        style: { fontSize: '11px', color: 'var(--muted-foreground)', width: '64px', textAlign: 'right', flexShrink: 0 },
        children: fmtPrice(model.input)
      }),
      jsx('span', {
        style: { fontSize: '11px', color: 'var(--muted-foreground)', width: '64px', textAlign: 'right', flexShrink: 0 },
        children: fmtPrice(model.output)
      }),
      jsx('span', {
        style: { fontSize: '11px', width: '46px', textAlign: 'right', fontWeight: 600, color: model.discount ? 'var(--accent)' : 'var(--muted-foreground)', flexShrink: 0 },
        children: model.discount == null ? '—' : `-${model.discount}%`
      }),
      jsx('button', {
            style: {
              appearance: 'none', border: '1px solid var(--ui-stroke-secondary)', borderRadius: '4px',
              background: 'transparent', color: 'var(--ui-text-secondary)', fontSize: '10px',
              padding: '2px 8px', cursor: 'pointer', flexShrink: 0, lineHeight: '14px'
            },
            onClick: async (e) => {
              e.stopPropagation()
              tap()
              try {
                const res = await onSetDefault(model.id)
                if (!res) return // declined, or failed with its own toast
                host.notify({ kind: 'info', message: `Default model -> ${model.id} (new sessions)` })
              } catch (err) {
                host.notify({ kind: 'error', message: `Default model switch failed: ${err.message}` })
              }
            },
            title: `Set "${model.id}" as the profile default`,
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
  const [busyRow, setBusyRow] = useState(null)

  // The popup list is intentionally neutral: no stale "now" highlight.
  // The model switch actions remain available on every row.

  const load = useCallback(async () => {
    setError(null)
    try {
      const spec = buildModelBundle()
      const [catalog, v1] = await Promise.all([
        fetchJSON(spec.urls.catalog),
        fetchJSON(spec.urls.models),
      ])
      setBundle(processBundle(catalog, v1))
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

  // Actions
  const onSetDefault = useCallback(async (modelId) => {
    setBusyRow(modelId)
    try {
      return await applyPick({
        request: (confirm) => requestDefaultSwitch(modelId, confirm),
        modelId,
        failureMessage: 'Default model switch failed',
      })
    } finally {
      setBusyRow(null)
    }
  }, [])

  const onSetSession = useCallback(async (modelId) => {
    if (!getRuntimeId()) {
      host.notify({ kind: 'info', message: 'Open a chat first — no live session to switch' })
      return null
    }
    setBusyRow(modelId)
    try {
      return await applyPick({
        request: (confirm) => requestSessionSwitch(modelId, confirm),
        modelId,
        failureMessage: 'Session model switch failed',
      })
    } finally {
      setBusyRow(null)
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
        jsx(Codicon, { name: 'list-tree', size: '0.82rem', style: { color: 'var(--ui-text-tertiary)' } }),
        jsx('span', { children: 'Nous' }),
        ]
      })
    }),
    jsx(PopoverContent, {
      align: 'end', sideOffset: 6, style: contentStyle,
      // The composer restores focus to its editor on the next pointermove over
      // the chat area (composer/floating-target.ts), and Radix dismisses a
      // popover whose focus moved outside it — which is why the panel used to
      // vanish the instant the pointer left the chip, gap or no gap. Keep focus
      // where it is (the caret stays in the composer) and ignore focus loss:
      // an outside click, Escape, or a second click on the chip still close it.
      onOpenAutoFocus: (e) => e.preventDefault(),
      onFocusOutside: (e) => e.preventDefault(),
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
                  busy: busyRow === m.id,
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
