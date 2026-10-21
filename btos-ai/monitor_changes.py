"""What changed and how fresh is it - the Overview's "What changed" and "Data freshness" panels.

Reads the same files as app.py and turns each headline series into dated points, then:
  freshness()  per source: date of the latest observation vs how old it may be before it counts as stale
  changes(n)   series with an observation that arrived in the last n days: change vs the base before it,
               how unusual that change is (z-score vs the series' own past changes over the same horizon)
               and whether it is a record / 52-week high or low

"Arrived" is tracked in data/series_seen.json (series -> latest observation date + when it was first seen).
A series seen for the first time is back-dated to observation date + the source's usual publication lag,
so the first run does not flag everything as new. The local app and publish_site.py update the file; the
hosted copy only reads the published one.
"""
import datetime as dt
import json
import math
import threading
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
WS = HERE.parent
SEEN = HERE / "data" / "series_seen.json"
_lock = threading.Lock()

# source -> (tab, max age in days before stale, usual publication lag in days, cadence label)
SOURCES = {
    "Census BTOS": ("firms", 35, 18, "every 2 weeks"),
    "GenAI Adoption Tracker": ("workers", 200, 90, "quarterly survey"),
    "OpenRouter": ("tokens", 16, 1, "weekly"),
    "Ramp tokens": ("ramp", 21, 8, "weekly"),
    "Ramp AI Index adoption": ("rampadopt", 50, 15, "monthly"),
    "Silicon Data GPU prices": ("gpu", 5, 1, "daily"),
    "FRED credit & rates": ("credit", 6, 1, "daily"),
    "npm downloads": ("assistants", 6, 1, "daily"),
    "Lab ARR": ("arr", 120, 0, "irregular (disclosures)"),
    "AI assistant disclosures": ("assistants", 120, 0, "irregular (disclosures)"),
    "Hyperscaler capex (SEC)": ("hcapex", 140, 35, "quarterly"),
    "Circular financing deals": ("circular", 21, 0, "irregular (news)"),
    "OpenRouter model mix": ("tokenecon", 16, 1, "weekly"),
    "InferenceX margins": ("tokenecon", 75, 0, "monthly (as benchmark runs land)"),
}
IRREGULAR = {"Lab ARR", "AI assistant disclosures", "Circular financing deals"}


def _csv(rel, **kw):
    p = WS / rel
    return pd.read_csv(p, low_memory=False, **kw) if p.exists() else pd.DataFrame()


def _pts(dates, values):
    s = pd.Series(list(values), index=pd.to_datetime(list(dates))).astype(float)
    s = s[~s.index.duplicated(keep="last")].dropna().sort_index()
    return s


def series():
    """[{id, name, source, fmt, delta, up_good, s (date-indexed pd.Series)}]
    delta: rel = % change, pp = share 0-1 in percentage points, pp100 = value already in % (pp),
    bp = rate in % shown in basis points, x = ratio change."""
    out = []

    def add(id_, name, source, s, fmt, delta, up_good=True):
        if s is not None and len(s):
            out.append({"id": id_, "name": name, "source": source, "s": s, "fmt": fmt, "delta": delta, "up_good": up_good})

    # Census BTOS, national, new wording only
    b = _csv("btos-ai/data/history.csv")
    if not b.empty:
        n = b[(b.level == "National") & (b.answer == "Yes") & b.version.str.startswith("v2")]
        for q, nm in ((7, "US firms using AI (BTOS)"), (24, "US firms expecting to use AI in 6 months (BTOS)")):
            g = n[n.qid == q]
            add(f"btos{q}", nm, "Census BTOS", _pts(g.ref_end, g.estimate), "share", "pp")
    t = _csv("btos-ai/data/genai_tracker_history.csv")
    if not t.empty:
        w = t[(t.dimension == "National") & (t.measure == "Share Using GenAI")]
        for cat, nm in (("Employed - For Work", "Workers using genAI at work"), ("All adults - Any", "US adults using genAI")):
            g = w[w.category == cat]
            add("rps_" + cat[:8], nm, "GenAI Adoption Tracker", _pts(g.wave, g["mean"]), "share", "pp")
    o = _csv("openrouter_data/openrouter_weekly_totals.csv")
    if not o.empty:
        o = o[o.partial == 0]
        add("openrouter", "OpenRouter tokens per week", "OpenRouter",
            _pts(pd.to_datetime(o.week) + pd.Timedelta(days=6), o.total_tokens), "tokens", "rel")
    r = _csv("ramp-ai-index/ramp_token_weekly.csv")
    if not r.empty:
        v = r[r.metric == "token_volume"].groupby("week_end").value.sum()
        sp = r[r.metric == "token_spend"].groupby("week_end").value.sum()
        an = r[(r.metric == "token_volume") & (r.maker == "anthropic")].groupby("week_end").value.sum()
        add("ramp_tok", "Business tokens per week (Ramp)", "Ramp tokens", _pts(v.index, v.values), "tokens", "rel")
        add("ramp_spend", "Business token spend per week (Ramp)", "Ramp tokens", _pts(sp.index, sp.values), "usd", "rel")
        px = (sp / v * 1e6).replace([math.inf], math.nan)
        add("ramp_px", "Blended price paid per M tokens (Ramp)", "Ramp tokens", _pts(px.index, px.values), "per_m", "rel", up_good=False)
        sh = (an / v).reindex(v.index).fillna(0)
        add("ramp_anth", "Anthropic share of business tokens (Ramp)", "Ramp tokens", _pts(sh.index, sh.values), "share", "pp")
    osh = _csv("openrouter_data/openrouter_open_share.csv")
    if not osh.empty:
        add("or_open_tok", "Open-weights share of OpenRouter tokens", "OpenRouter model mix", _pts(osh.as_of, osh.open_token_share), "share", "pp")
        add("or_open_spend", "Open-weights share of OpenRouter spend (cache-adj.)", "OpenRouter model mix",
            _pts(osh.as_of, pd.to_numeric(osh.open_spend_share_cached, errors="coerce")), "share", "pp")
        add("or_px", "OpenRouter blended price per M tokens (cache-adj.)", "OpenRouter model mix",
            _pts(osh.as_of, pd.to_numeric(osh.price_cached_per_m, errors="coerce")), "per_m", "rel", up_good=False)
        add("or_io", "OpenRouter input tokens per output token", "OpenRouter model mix",
            _pts(osh.as_of, pd.to_numeric(osh.prompt_per_completion, errors="coerce")), "x", "x")
    im = _csv("inference-margin/inference_margin_monthly.csv")
    if not im.empty:
        g = im[(im.model == "DeepSeek-V4-Pro") & (im.hardware == "b300") & (im.tier_tps == 50)]
        add("im_dsv4_b300", "DeepSeek V4 Pro gross margin on B300 (60% util.)", "InferenceX margins", _pts(g.as_of, g.gm_at_60), "share", "pp")
    a = _csv("ramp-ai-index/ramp_adoption_monthly.csv")
    if not a.empty:
        me = pd.to_datetime(a.month) + pd.offsets.MonthEnd(0)
        for grp, key, nm in (("overall", "All", "US businesses paying for AI (Ramp)"),
                             ("vendor", "OpenAI", "Businesses paying OpenAI (Ramp)"),
                             ("vendor", "Anthropic", "Businesses paying Anthropic (Ramp)")):
            m = (a.group == grp) & (a.key == key)
            add(f"rampad_{key}", nm, "Ramp AI Index adoption", _pts(me[m], a.adoption_pct[m]), "pct100", "pp100")
    pe = _csv("ramp-ai-index/ramp_spend_per_employee.csv")
    if not pe.empty:
        g = pe[pe.dimension == "all"]
        add("ramp_pepm", "Median AI spend per employee per month (Ramp)", "Ramp AI Index adoption",
            _pts(pd.to_datetime(g.month) + pd.offsets.MonthEnd(0), g.median_pepm), "usd_small", "rel")
    sd = _csv("silicon-data/silicon_index_daily.csv")
    if not sd.empty:
        for idx, nm in (("SDH100RT", "H100 rental, neo-cloud ($/GPU-hr)"), ("SDB200RT", "B200 rental, neo-cloud ($/GPU-hr)"),
                        ("SDA100RT", "A100 rental, neo-cloud ($/GPU-hr)"), ("SDLLMTK", "LLM token expenditure index ($/M tokens)")):
            g = sd[sd["index"] == idx]
            add("sd_" + idx, nm, "Silicon Data GPU prices", _pts(g.date, g.value), "usd_hr" if idx != "SDLLMTK" else "per_m", "rel")
    hy = _csv("credit-spreads/macro_daily.csv")
    if not hy.empty:
        w = hy.pivot_table(index="date", columns="series", values="value", aggfunc="last")
        for sid, nm, good in (("BAMLH0A1HYBB", "BB high-yield spread", False), ("BAMLH0A3HYC", "CCC high-yield spread", False),
                              ("DFII10", "US 10-year real yield", None), ("THREEFYTP10", "US 10-year term premium", None),
                              ("DGS10", "US 10-year Treasury yield", None)):
            if sid in w:
                c = w[sid].dropna()
                add("hy_" + sid, nm, "FRED credit & rates", _pts(c.index, c.values), "pct100", "bp", good)
        if {"BAMLH0A1HYBB", "BAMLH0A3HYC"} <= set(w):
            both = w[["BAMLH0A1HYBB", "BAMLH0A3HYC"]].dropna()
            q = both.BAMLH0A3HYC / both.BAMLH0A1HYBB
            add("hy_ratio", "CCC ÷ BB spread ratio", "FRED credit & rates", _pts(q.index, q.values), "x", "x", False)
    nd = _csv("codex-user-trend/cli_npm_daily.csv")
    if not nd.empty:
        nd = nd.sort_values("day")
        for col, nm in (("claude_code_downloads", "Claude Code npm downloads/day (7-day avg)"),
                        ("codex_installs_corrected", "Codex npm installs/day (7-day avg, corrected)")):
            m = nd[col].rolling(7, min_periods=7).mean()
            add("npm_" + col[:6], nm, "npm downloads", _pts(nd.day, m), "count", "rel")
    ar = _csv("ai-lab-arr/arr_points.csv")
    if not ar.empty:
        ar = ar[ar.kind == "run_rate"]
        for co in ("Anthropic", "OpenAI"):
            g = ar[ar.company == co]
            add("arr_" + co, f"{co} run-rate ARR", "Lab ARR", _pts(g.date, g.value_usd), "usd", "rel")
    ca = _csv("codex-user-trend/consumer_assistants.csv")
    if not ca.empty:
        for (prod, met), g in ca.groupby(["product", "metric"]):
            if len(g) >= 2:
                add(f"ca_{prod}_{met}", f"{prod} {str(met).lower()} users", "AI assistant disclosures", _pts(g.date, g.users_m), "users_m", "rel")
    cx = _csv("codex-user-trend/codex_users.csv")
    if not cx.empty:
        g = cx[cx.series.str.startswith("Milestone")]
        add("codex", "Codex + ChatGPT Work active users", "AI assistant disclosures", _pts(g.date, g.users_m), "users_m", "rel")
    hq = _csv("bofa-capex-cycles/firsthand/hyperscalers_quarterly_inputs.csv")
    if not hq.empty:
        tk = [c for c in ("MSFT", "GOOGL", "AMZN", "META", "ORCL") if c in hq]
        full = hq.dropna(subset=tk)
        qe = pd.PeriodIndex(full.cal_quarter, freq="Q").end_time.normalize()
        add("capex_q", "Big-5 hyperscaler capex per quarter", "Hyperscaler capex (SEC)", _pts(qe, full[tk].sum(axis=1) * 1e9), "usd", "rel")
    cd = _csv("ai-circular-financing/data/circular_deals.csv")
    if not cd.empty:
        g = cd[cd.in_totals == 1].groupby("date").usd_bn.sum().sort_index().cumsum()
        add("circular", "Circular-financing deals tracked (cumulative $)", "Circular financing deals", _pts(g.index, g.values * 1e9), "usd", "rel")
    return out


# ---------------------------------------------------------------- arrival tracking
def _load_seen():
    try:
        return json.loads(SEEN.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def first_seen(ser, write=True, now=None):
    """Series id -> datetime its latest observation was first seen; updates SEEN when write=True."""
    now = now or dt.datetime.now()
    with _lock:
        seen, out, dirty = _load_seen(), {}, False
        for x in ser:
            last = x["s"].index[-1].strftime("%Y-%m-%d")
            rec = seen.get(x["id"])
            if rec is None or rec.get("last") != last:
                if rec is None:  # never tracked: assume it arrived after the usual publication lag
                    when = min(now, x["s"].index[-1].to_pydatetime() + dt.timedelta(days=SOURCES[x["source"]][2]))
                else:
                    when = now
                rec = {"last": last, "seen": when.isoformat(timespec="seconds")}
                seen[x["id"]], dirty = rec, True
            out[x["id"]] = dt.datetime.fromisoformat(rec["seen"])
        if write and dirty:
            SEEN.parent.mkdir(exist_ok=True)
            tmp = SEEN.with_suffix(".tmp")
            tmp.write_text(json.dumps(seen, indent=1), encoding="utf-8")
            tmp.replace(SEEN)
    return out


# ---------------------------------------------------------------- change maths
def _chg(kind, new, old):
    if old is None or new is None:
        return None
    if kind == "rel":
        return new / old - 1 if old > 0 and new > 0 else None
    if kind == "pp":
        return (new - old) * 100
    if kind == "bp":
        return (new - old) * 100
    return new - old  # pp100, x


def _base(s, when):
    prior = s[s.index <= when]
    return (prior.index[-1], float(prior.iloc[-1])) if len(prior) else (None, None)


def _z(s, kind, horizon, now_chg):
    """How unusual is now_chg vs this series' own changes over the same horizon (last 3 years)?"""
    if now_chg is None or len(s) < 30:
        return None
    hist = s[s.index >= s.index[-1] - pd.Timedelta(days=3 * 365)].iloc[:-1]
    ch = []
    for d, v in hist.items():
        bd, bv = _base(s, d - horizon)
        if bd is not None and (d - horizon - bd).days <= max(7, horizon.days):
            c = _chg(kind, float(v), bv)
            if c is not None:
                ch.append(math.log1p(c) if kind == "rel" else c)
    if len(ch) < 20:
        return None
    m = sum(ch) / len(ch)
    sd = (sum((c - m) ** 2 for c in ch) / (len(ch) - 1)) ** 0.5
    x = math.log1p(now_chg) if kind == "rel" else now_chg
    return (x - m) / sd if sd > 0 else None


def _routine(s):
    """A trending series sets records most periods; those are not news."""
    hits = sum(1 for i in range(max(1, len(s) - 6), len(s)) if s.iloc[i] > s.iloc[:i].max() or s.iloc[i] < s.iloc[:i].min())
    return hits >= 3


def _extreme(s):
    last, prev = float(s.iloc[-1]), s.iloc[:-1]
    if len(prev) >= 12 and _routine(s):
        return None
    if len(prev) >= 12:
        if last > prev.max():
            return "record high"
        if last < prev.min():
            return "record low"
    yr = prev[prev.index >= s.index[-1] - pd.Timedelta(days=365)]
    if len(yr) >= 20 and prev.index[0] < s.index[-1] - pd.Timedelta(days=365):
        if last > yr.max():
            return "52-week high"
        if last < yr.min():
            return "52-week low"
    return None


def changes(days=7, write=True, now=None):
    now = now or dt.datetime.now()
    ser = series()
    seen = first_seen(ser, write=write, now=now)
    cut = now - dt.timedelta(days=days)
    items = []
    for x in ser:
        s = x["s"]
        if seen[x["id"]] < cut:
            continue
        gaps = s.index.to_series().diff().dt.days.dropna()
        gap = int(gaps.tail(20).median()) if len(gaps) else days
        horizon = pd.Timedelta(days=max(days, gap))
        last_d, last_v = s.index[-1], float(s.iloc[-1])
        bd, bv = _base(s, last_d - horizon) if gap < days else (s.index[-2], float(s.iloc[-2])) if len(s) > 1 else (None, None)
        c = _chg(x["delta"], last_v, bv)
        z = _z(s, x["delta"], last_d - bd, c) if bd is not None else None
        ext = _extreme(s)
        score = (3 if ext and ext.startswith("record") else 1.5 if ext else 0) + (abs(z) if z is not None else 1.2)  # sparse series (disclosures): every new point is news
        items.append({"id": x["id"], "name": x["name"], "source": x["source"], "tab": SOURCES[x["source"]][0],
                      "fmt": x["fmt"], "delta": x["delta"], "up_good": x["up_good"],
                      "date": last_d.strftime("%Y-%m-%d"), "value": last_v,
                      "base_date": bd.strftime("%Y-%m-%d") if bd is not None else None, "base": bv,
                      "change": c, "z": z, "extreme": ext, "seen": seen[x["id"]].isoformat(timespec="minutes"),
                      "score": score})
    items.sort(key=lambda i: -i["score"])
    return {"days": days, "since": cut.strftime("%Y-%m-%d"), "items": items, "n_series": len(ser)}


def freshness(now=None):
    today = (now or dt.datetime.now()).date()
    ser = series()
    by = {}
    for x in ser:
        d = x["s"].index[-1].date()
        if x["source"] not in by or d > by[x["source"]]:
            by[x["source"]] = d
    rows = []
    for src, (tab, max_age, lag, cadence) in SOURCES.items():
        d = by.get(src)
        age = (today - d).days if d else None
        status = "missing" if d is None else "stale" if age > max_age else "due" if age > max_age * 0.8 and src not in IRREGULAR else "ok"
        rows.append({"source": src, "tab": tab, "latest": d.isoformat() if d else None, "age": age,
                     "max_age": max_age, "cadence": cadence, "status": status})
    return rows


if __name__ == "__main__":  # refresh series_seen.json (publish_site.py runs this before copying)
    r = changes(7)
    print(f"{len(r['items'])} of {r['n_series']} series have new data since {r['since']}")
    for f in freshness():
        if f["status"] != "ok":
            print(f"  {f['status']}: {f['source']} (latest {f['latest']}, {f['age']} days old, limit {f['max_age']})")
