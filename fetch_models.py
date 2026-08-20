#!/usr/bin/env python3
"""Build a static JSON bundle of Nous model data for the desktop plugin.

Fetches three sources:
  1. model-catalog.json  — curated Nous Portal model IDs (31 models)
  2. /v1/models          — per-model pricing + original pricing (for discount)
  3. /api/nous/recommended-models — free/paid tier recommendations

Writes bundle.json next to this script.
"""
from __future__ import annotations
import json, sys, urllib.request, urllib.error
from datetime import datetime, timezone

CATALOG_URL = "https://hermes-agent.nousresearch.com/docs/api/model-catalog.json"
PRICING_URL = "https://inference-api.nousresearch.com/v1/models"
RECOMMENDED_URL = "https://portal.nousresearch.com/api/nous/recommended-models"
USER_AGENT = "hermes-nous-models-plugin/0.1.0"


def fetch(url: str, timeout: float = 12.0) -> dict | list | None:
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        print(f"WARN: fetch {url} failed: {exc}", file=sys.stderr)
        return None


def fmt_price(token_price: str | float | None) -> str:
    """Format a per-token price string (e.g. '0.0000020000') as $X/1M."""
    if token_price is None:
        return "—"
    try:
        per_token = float(token_price)
    except (TypeError, ValueError):
        return "—"
    per_m = per_token * 1_000_000
    if per_m == 0:
        return "$0.00"
    if per_m < 0.01:
        return f"${per_m:.4f}"
    if per_m < 1:
        return f"${per_m:.2f}"
    return f"${per_m:.2f}"


def calc_discount(current: float | None, original: float | None) -> float | None:
    if current is None or original is None or original == 0:
        return None
    return round((1 - current / original) * 100, 1)


def base_id(model_id: str) -> str:
    """Strip :free/:US/:batch suffix from a model id to match catalog entries.

    e.g. 'openai/gpt-5.6-luna:free' -> 'openai/gpt-5.6-luna'
         'tencent/hy3:free'          -> 'tencent/hy3'
    """
    for suffix in (":free", ":US", ":batch"):
        if model_id.endswith(suffix):
            return model_id[: -len(suffix)]
    return model_id


def main() -> int:
    print("Fetching model catalog…", file=sys.stderr)
    catalog = fetch(CATALOG_URL)
    if not catalog or "providers" not in catalog:
        print("ERROR: model catalog unavailable", file=sys.stderr)
        return 1

    nous_models = catalog["providers"].get("nous", {}).get("models", [])
    print(f"  → {len(nous_models)} Nous models in catalog", file=sys.stderr)

    print("Fetching /v1/models pricing…", file=sys.stderr)
    pricing_data = fetch(PRICING_URL)
    if not pricing_data:
        print("ERROR: pricing endpoint unavailable", file=sys.stderr)
        return 1
    all_models = pricing_data.get("data", pricing_data)
    print(f"  → {len(all_models)} models with pricing", file=sys.stderr)

    # Index by id
    by_id: dict[str, dict] = {}
    for m in all_models:
        mid = m.get("id", "")
        if mid:
            by_id[mid] = m

    print("Fetching recommended-models (tier info)…", file=sys.stderr)
    recommended = fetch(RECOMMENDED_URL) or {}
    raw_free_ids = {m["modelName"] for m in recommended.get("freeRecommendedModels", []) if m.get("modelName")}
    raw_paid_ids = {m["modelName"] for m in recommended.get("paidRecommendedModels", []) if m.get("modelName")}
    # Normalize to base ids (strip :free suffix for matching against catalog)
    free_ids = {base_id(mid) for mid in raw_free_ids}
    paid_ids = {base_id(mid) for mid in raw_paid_ids}
    # Build display map: base_id -> display name from recommended list
    display_name_map: dict[str, str] = {}
    for entry in recommended.get("freeRecommendedModels", []):
        name = entry.get("modelName", "")
        base = base_id(name)
        if base and entry.get("displayName"):
            display_name_map[base] = entry["displayName"]
    for entry in recommended.get("paidRecommendedModels", []):
        name = entry.get("modelName", "")
        base = base_id(name)
        if base and entry.get("displayName"):
            display_name_map[base] = entry["displayName"]
    print(f"  → {len(free_ids)} free, {len(paid_ids)} paid recommended (after base-id match)", file=sys.stderr)

    # Build the processed list
    rows = []
    for entry in nous_models:
        mid = entry.get("id", "")
        if not mid:
            continue
        pm = by_id.get(mid, {})
        pricing = pm.get("pricing", {}) if isinstance(pm, dict) else {}
        original = pricing.get("original", {}) if isinstance(pricing, dict) else {}

        prompt_cur = pricing.get("prompt") if isinstance(pricing, dict) else None
        completion_cur = pricing.get("completion") if isinstance(pricing, dict) else None
        prompt_orig = original.get("prompt") if isinstance(original, dict) else None
        completion_orig = original.get("completion") if isinstance(original, dict) else None

        # Convert per-token strings to floats
        prompt_cur_f = float(prompt_cur) if isinstance(prompt_cur, str) else prompt_cur
        completion_cur_f = float(completion_cur) if isinstance(completion_cur, str) else completion_cur
        prompt_orig_f = float(prompt_orig) if isinstance(prompt_orig, str) else prompt_orig
        completion_orig_f = float(completion_orig) if isinstance(completion_orig, str) else completion_orig

        d_in = calc_discount(prompt_cur_f, prompt_orig_f)
        d_out = calc_discount(completion_cur_f, completion_orig_f)
        avg_discount = None
        if d_in is not None and d_out is not None:
            avg_discount = round((d_in + d_out) / 2, 1)
        elif d_in is not None:
            avg_discount = d_in
        elif d_out is not None:
            avg_discount = d_out

        # Human-readable name
        name = mid
        if "/" in mid:
            name = mid.split("/", 1)[1]
        if name.startswith("~"):
            name = name[1:]
        # Prefer Portal display name when available
        display = display_name_map.get(mid) or display_name_map.get(mid.replace(":free", ""))
        if display:
            name = display

        context = pm.get("context_length") if isinstance(pm, dict) else None
        if isinstance(context, int):
            ctx_str = f"{context / 1_000_000:.1f}M" if context >= 1_000_000 else f"{context / 1_000:.0f}K"
        else:
            ctx_str = "—"

        rows.append({
            "id": mid,
            "name": name,
            "input_per_1m": fmt_price(prompt_cur),
            "output_per_1m": fmt_price(completion_cur),
            "input_original_per_1m": fmt_price(prompt_orig),
            "output_original_per_1m": fmt_price(completion_orig),
            "discount_input_pct": d_in,
            "discount_output_pct": d_out,
            "discount_avg_pct": avg_discount,
            "context_length": ctx_str,
            "is_free": mid in free_ids,
            "is_paid_recommended": mid in paid_ids,
        })

    # Sort: free first, discounted desc, name asc
    rows.sort(key=lambda r: (
        0 if r["is_free"] else 1,
        -(r["discount_avg_pct"] or -1),
        r["name"].lower(),
    ))

    stats = {
        "total": len(rows),
        "free": sum(1 for r in rows if r["is_free"]),
        "paid_recommended": sum(1 for r in rows if r["is_paid_recommended"]),
        "with_pricing": sum(1 for r in rows if r["input_per_1m"] != "—"),
        "avg_discount_pct": round(
            sum(r["discount_avg_pct"] for r in rows if r["discount_avg_pct"] is not None) /
            max(1, sum(1 for r in rows if r["discount_avg_pct"] is not None)), 1
        ) if any(r["discount_avg_pct"] is not None for r in rows) else None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }

    bundle = {"stats": stats, "models": rows}
    out_path = __file__.replace(".py", ".json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(bundle, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"\nWrote {out_path}", file=sys.stderr)
    print(f"  {stats['total']} models, {stats['free']} free, "
          f"{stats['paid_recommended']} paid-recommended, "
          f"{stats['with_pricing']} with pricing",
          file=sys.stderr)
    if stats["avg_discount_pct"] is not None:
        print(f"  avg discount: {stats['avg_discount_pct']}%", file=sys.stderr)

    if rows:
        print("\nSample (first 5):", file=sys.stderr)
        for r in rows[:5]:
            disc = f"{r['discount_avg_pct']}%" if r['discount_avg_pct'] is not None else "—"
            print(f"  {r['name']:30s}  in={r['input_per_1m']:>8s}  out={r['output_per_1m']:>8s}  "
                  f"orig_in={r['input_original_per_1m']:>8s}  orig_out={r['output_original_per_1m']:>8s}  "
                  f"disc={disc:>6s}  free={r['is_free']}  paid={r['is_paid_recommended']}",
                  file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
