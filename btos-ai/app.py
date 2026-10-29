"""AI Adoption Monitor - local web app (default http://127.0.0.1:8930).

One page over four sources, all read from files so it runs with no Claude:
  btos-ai/data/history.csv                 Census BTOS AI questions, every level (btos_ai.py)
  btos-ai/data/genai_tracker_history.csv   GenAI Adoption Tracker (RPS) worker survey
  btos-ai/static/sbu_2025-11_ai_technology.csv   Atlanta Fed SBU, one-off (Fed note)
  codex-user-trend/*.csv                   AI assistant user disclosures, Codex vs Claude Code npm,
                                           enterprise seat estimates (edited by hand)
  ramp-ai-index/*.csv                      Ramp AI Index business token volume / spend / prices, and the
                                           monthly share of businesses paying for AI + AI spend per employee
  bofa-capex-cycles/exhibit2_*.csv        BofA Exhibit 2 capex cycles, read from the PDF's vector chart
  credit-spreads/macro_daily.csv          ICE BofA BB / CCC HY OAS (FRED + Wayback history), US 10y real yield,
                                           term premium and nominal yield (FRED)
  global-population/                      world population by region / income / age + AI users per country
                                           (Microsoft AI Diffusion and national official sources); the
                                           "World population" tab frames its self-contained page at /population/
  ai-circular-financing/                  the AI Circular Financing app, mounted unchanged at /circular
                                           (its own app.py + data/); the "Circular financing" tab frames it

The weekly Windows task refreshes the BTOS/tracker files; "Update now" on the Data tab runs
the same btos_ai.py. Files are re-read whenever they change on disk.

    py -3.10 app.py            (PORT env var overrides 8930)

Hosted copy (Render, AAM_HOSTED=1, published by publish_site.py): read-only - no update job,
no candidate review (POSTs are refused and the unreviewed news candidates are not served).
"""
import csv
import datetime as dt
import json
import math
import os
import subprocess
import sys
import threading
from pathlib import Path

import pandas as pd
from flask import Flask, abort, jsonify, render_template, request, send_file
from werkzeug.middleware.dispatcher import DispatcherMiddleware

import btos_ai as B
import monitor_changes as MC

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
OUT = HERE / "output"
UT = HERE.parent / "codex-user-trend"
LOG = HERE / "update.log"

app = Flask(__name__)
HOSTED = os.environ.get("AAM_HOSTED") == "1"


def _mount_circular():
    """Serve ai-circular-financing/app.py at /circular (read-only when the monitor is hosted).
    Loaded by path under its own module name - both apps' files are called app.py."""
    import importlib.util
    path = HERE.parent / "ai-circular-financing" / "app.py"
    if not path.exists():
        return False
    if HOSTED:
        os.environ["ACF_HOSTED"] = "1"
    spec = importlib.util.spec_from_file_location("acf_app", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["acf_app"] = mod  # Flask finds its templates/static through sys.modules
    spec.loader.exec_module(mod)
    app.wsgi_app = DispatcherMiddleware(app.wsgi_app, {"/circular": mod.app.wsgi_app})
    return True


CIRCULAR = _mount_circular()
_cache = {}
_upd = {"running": False, "started": None, "finished": None, "rc": None}
_lock = threading.Lock()


# ---------------------------------------------------------------- loaders
def cached(key, paths, loader):
    stamp = tuple(p.stat().st_mtime if p.exists() else 0 for p in paths)
    hit = _cache.get(key)
    if hit and hit[0] == stamp:
        return hit[1]
    val = loader()
    _cache[key] = (stamp, val)
    return val


def code_of(r):
    lv = r["level"]
    if lv == "National":
        return "US"
    if lv == "Sector":
        return r["sector"]
    if lv == "Subsector":
        return r["subsector"]
    if lv == "Employment size":
        return r["size"]
    return f'{r["sector"]}|{r["size"]}'


def btos():
    def load():
        df = pd.read_csv(DATA / "history.csv", dtype={"sector": str, "subsector": str, "size": str})
        for c in ("sector", "subsector", "size"):
            df[c] = df[c].fillna("")
        df["code"] = [code_of(r) for r in df[["level", "sector", "subsector", "size"]].to_dict("records")]
        df["ver"] = df.version.map({B.V1: "v1", B.V2: "v2"})
        dates = (df[["smpdt", "ref_start", "ref_end", "published"]].drop_duplicates("smpdt")
                 .sort_values("smpdt").reset_index(drop=True))
        return df, dates
    return cached("btos", [DATA / "history.csv"], load)


def tracker():
    def load():
        p = DATA / "genai_tracker_history.csv"
        if not p.exists():
            return None
        gt = pd.read_csv(p, parse_dates=["wave"], dtype={"naics": str})
        gt["naics"] = gt["naics"].fillna("")
        return gt
    return cached("gt", [DATA / "genai_tracker_history.csv"], load)


def ut_csv(name):
    p = UT / name
    return cached("ut:" + name, [p], lambda: pd.read_csv(p) if p.exists() else pd.DataFrame())


def clean(v):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (pd.Timestamp, dt.date, dt.datetime)):
        return v.strftime("%Y-%m-%d")
    if hasattr(v, "item"):
        return clean(v.item())
    return v


def records(frame):
    return [{k: clean(v) for k, v in r.items()} for r in frame.to_dict("records")]


def nice_date(iso):
    d = dt.date.fromisoformat(str(iso)[:10])
    return f"{d.day} {d:%b %Y}"


def state():
    p = DATA / "state.json"
    return json.loads(p.read_text()) if p.exists() else {}


# ---------------------------------------------------------------- pages
@app.before_request
def read_only_when_hosted():
    if HOSTED and request.method not in ("GET", "HEAD"):
        abort(403)


@app.route("/healthz")
def healthz():
    return "ok"


@app.route("/")
def index():
    ver = int(max(f.stat().st_mtime for f in (HERE / "static").glob("app.*")))
    return render_template("index.html", ver=ver)


# ---------------------------------------------------------------- world population & AI users
# global-population/ builds one self-contained page (population_local.html, data embedded) plus its
# workbook; the "World population" tab frames the page, the overview reads pop_summary.json.
GP = HERE.parent / "global-population"


@app.route("/population/")
def population_page():
    p = GP / "population_local.html"
    if not p.exists():
        abort(404)
    return send_file(p, mimetype="text/html", max_age=0)


@app.route("/population/workbook")
def population_workbook():
    books = sorted(GP.glob("*_Global_population_2025.xlsx"))
    if not books:
        abort(404)
    return send_file(books[-1], as_attachment=True, download_name=books[-1].name, max_age=0)


def pop_summary():
    p = GP / "pop_summary.json"
    return cached("pop_summary", [p], lambda: json.load(open(p))) if p.exists() else None


@app.route("/api/meta")
def meta():
    df, dates = btos()
    gt = tracker()
    ents = {}
    for lv in B.LEVELS:
        e = df[(df.level == lv) & (df.answer == "Yes") & (df.qid == 7)]
        last = e[e.ver == "v2"].sort_values("smpdt").drop_duplicates("code", keep="last").set_index("code").estimate
        u = e.drop_duplicates("code")[["code", "label", "sector", "subsector", "size"]].sort_values(["sector", "subsector", "size"])
        ents[lv] = [{"code": r["code"], "label": r["label"], "sector": r["sector"],
                     "latest": clean(last.get(r["code"]))} for r in u.to_dict("records")]
    v2 = df[df.ver == "v2"].smpdt.max()
    row = dates[dates.smpdt == v2].iloc[0]
    st = state()
    return jsonify({
        "levels": B.LEVELS, "entities": ents, "sectors": B.SECTOR, "sizes": B.SIZE,
        "btos_last": int(v2), "btos_ref_end": clean(row.ref_end), "btos_published": clean(row.published),
        "v2_start": int(df[df.ver == "v2"].smpdt.min()), "v1_end": int(df[df.ver == "v1"].smpdt.max()),
        "tracker_wave": clean(gt.wave.max()) if gt is not None else None,
        "state": st, "workbook": st.get("workbook", "").replace("\\", "/").split("/")[-1],
        "hosted": HOSTED,
        "pending": 0 if HOSTED else sum(1 for c in load_candidates() if c.get("status") == "new"),
        "arr_pending": 0 if HOSTED else sum(1 for c in (json.loads(ARR_CANDS.read_text(encoding="utf-8-sig")) if ARR_CANDS.exists() else [])
                           if c.get("status") == "new"),
    })


def ma4(s):
    return s.rolling(4, min_periods=4).mean()


@app.route("/api/btos/series")
def btos_series():
    df, dates = btos()
    q = int(request.args.get("q", 7))
    keys = [k for k in request.args.get("keys", "National:US").split(",") if ":" in k][:3]
    ref = dates.set_index("smpdt").ref_end.to_dict()
    out = []
    for key in keys:
        lv, code = key.split(":", 1)
        s = df[(df.level == lv) & (df.code == code) & (df.qid == q) & (df.answer == "Yes")]
        if s.empty:
            continue
        item = {"key": key, "level": lv, "code": code, "label": s.label.iloc[0]}
        for ver in ("v1", "v2"):
            t = s[s.ver == ver].sort_values("smpdt")
            m = ma4(t.estimate.reset_index(drop=True))
            item[ver] = [{"smpdt": int(r.smpdt), "date": clean(ref.get(r.smpdt)), "y": clean(r.estimate),
                          "se": clean(r.se), "ma": clean(m.iloc[i]), "flag": clean(r.flag)}
                         for i, r in enumerate(t.itertuples())]
        out.append(item)
    return jsonify({"q": q, "series": out, "v2_start": int(df[df.ver == "v2"].smpdt.min()),
                    "v2_start_date": clean(dates.set_index("smpdt").ref_start.get(int(df[df.ver == "v2"].smpdt.min()))),
                    "v1_end_date": clean(ref.get(int(df[df.ver == "v1"].smpdt.max())))})


@app.route("/api/btos/rank")
def btos_rank():
    df, dates = btos()
    lv = request.args.get("level", "Sector")
    q = int(request.args.get("q", 7))
    sector = request.args.get("sector", "")
    s = df[(df.level == lv) & (df.qid == q) & (df.answer == "Yes")]
    if sector and lv in ("Subsector", "Sector x Employment size"):
        s = s[s.sector == sector]
    v2 = s[s.ver == "v2"]
    periods = sorted(v2.smpdt.unique())
    if not periods:
        return jsonify({"rows": []})
    last, prev = periods[-1], periods[-2] if len(periods) > 1 else None
    tail4 = periods[-4:]
    v1last = s[s.ver == "v1"].smpdt.max()
    g = lambda p: v2[v2.smpdt == p].set_index("code")
    cur, pr = g(last), g(prev) if prev else None
    m4 = v2[v2.smpdt.isin(tail4)].groupby("code").estimate.agg(["mean", "count"])
    old = s[(s.ver == "v1") & (s.smpdt == v1last)].set_index("code").estimate
    rows = []
    for code, r in s.drop_duplicates("code").set_index("code").iterrows():
        e = cur.estimate.get(code) if code in cur.index else None
        rows.append({"code": code, "label": r.label, "y": clean(e),
                     "se": clean(cur.se.get(code)) if code in cur.index else None,
                     "prev": clean(pr.estimate.get(code)) if pr is not None and code in pr.index else None,
                     "ma4": clean(m4.at[code, "mean"]) if code in m4.index and m4.at[code, "count"] == 4 else None,
                     "v1": clean(old.get(code))})
    ref = dates.set_index("smpdt").ref_end.to_dict()
    return jsonify({"level": lv, "q": q, "last": int(last), "last_date": clean(ref.get(last)),
                    "prev": int(prev) if prev else None, "v1_end": clean(v1last), "rows": rows})


@app.route("/api/workers")
def workers():
    gt = tracker()
    pcp = DATA / "genai_pc_internet.csv"
    pc = records(pd.read_csv(pcp)) if pcp.exists() else []
    return jsonify({"rows": records(gt) if gt is not None else [], "pc": pc})


@app.route("/api/firmworker")
def firmworker():
    df, dates = btos()
    gt = tracker()
    y = df[(df.level == "Sector") & (df.answer == "Yes") & (df.ver == "v2")]
    last = y.smpdt.max()
    cur = y[(y.smpdt == last) & (y.qid == 7)].set_index("sector")
    exp = y[(y.smpdt == last) & (y.qid == 24)].set_index("sector")
    rows = []
    if gt is not None:
        ind = gt[gt.dimension == "Industry"]
        wl = ind.wave.max()
        t = ind[ind.wave == wl].pivot_table(index="naics", columns="measure", values=["mean", "se"], aggfunc="first")
        for code, name in B.SECTOR.items():
            if code == "XX":
                continue
            gv = lambda col, meas: clean(t.at[code, (col, meas)]) if code in t.index and (col, meas) in t.columns else None
            rows.append({"naics": code, "sector": name,
                         "firm": clean(cur.estimate.get(code)), "firm_se": clean(cur.se.get(code)),
                         "firm_exp": clean(exp.estimate.get(code)),
                         "worker": gv("mean", "Share of workers using genAI at work"),
                         "worker_se": gv("se", "Share of workers using genAI at work"),
                         "hours": gv("mean", "Share of work hours using genAI"),
                         "saved": gv("mean", "Time saved by genAI (% of work hours)")})
    both = [r for r in rows if r["firm"] is not None and r["worker"] is not None]
    rho = None
    if len(both) > 4:
        f = pd.DataFrame(both)
        rho = clean(f.firm.rank().corr(f.worker.rank()))
    ref = dates.set_index("smpdt").ref_end.to_dict()
    return jsonify({"rows": rows, "rho": rho, "btos": int(last), "btos_date": clean(ref.get(last)),
                    "wave": clean(gt.wave.max()) if gt is not None else None})


@app.route("/api/fed")
def fed():
    df, dates = btos()
    gt = tracker()
    T = B.fed_tables(df.drop(columns=["code", "ver"]), gt, dates)
    out = {k: {"columns": list(map(str, v.columns)), "rows": records(v)} for k, v in T.items()
           if isinstance(v, pd.DataFrame)}
    m = T["meta"]
    out["meta"] = {"last": m["last"], "first4": m["first4"], "wave": clean(m["wave"]), "url": B.FED_URL}
    return jsonify(out)


@app.route("/api/assistants")
def assistants():
    return jsonify({
        "consumer": records(ut_csv("consumer_assistants.csv").fillna("")),
        "codex": records(ut_csv("codex_users.csv").fillna("")),
        "npm": records(ut_csv("cli_npm_monthly.csv")),
        "npm_daily": records(ut_csv("cli_npm_daily.csv")),
        "npm_notes": records(ut_csv("cli_npm_notes.csv").fillna("")),
        "seats": records(ut_csv("enterprise_seats_oct2026.csv")),
        "candidates": [] if HOSTED else [c for c in load_candidates() if c.get("status") == "new"],
    })


# ---------------------------------------------------------------- OpenRouter tokens
ORD = HERE.parent / "openrouter_data"
# model author -> lab origin by maker (unknown authors fall into "Other / unclassified").
# tngtech = TNG Technology Consulting (Germany); its Chimera models are merges of DeepSeek weights.
ORIGIN = {
    **dict.fromkeys(["openai", "anthropic", "google", "x-ai", "meta-llama", "nvidia", "mistralai", "microsoft", "amazon",
                     "cohere", "arcee-ai", "poolside", "tngtech", "perplexity", "inception", "ibm-granite", "ai21", "nousresearch",
                     "allenai", "liquid", "inflection", "reka", "writer"], "US & other Western labs"),
    **dict.fromkeys(["deepseek", "qwen", "z-ai", "moonshotai", "minimax", "xiaomi", "tencent", "stepfun", "baidu",
                     "bytedance", "bytedance-seed", "meituan", "thudm", "inclusionai", "kwaipilot", "alibaba", "ant",
                     "01-ai", "zhipu", "sensetime", "iflytek"], "Chinese labs"),
    **dict.fromkeys(["stealth", "openrouter"], "Stealth / unannounced models"),
}


def or_csv(name, **kw):
    p = ORD / name
    return cached("or:" + name, [p], lambda: pd.read_csv(p, **kw) if p.exists() else pd.DataFrame())


@app.route("/api/openrouter")
def openrouter():
    tot = or_csv("openrouter_weekly_totals.csv")
    mod = or_csv("openrouter_weekly_model_tokens.csv")
    apps = or_csv("openrouter_top_apps.csv")
    if tot.empty:
        return jsonify({"totals": []})
    full = tot[tot.partial == 0]
    origin = []
    if not mod.empty:
        m = mod[mod.partial == 0].copy()
        m["origin"] = [("Models outside the named top 9" if mo == "Others" else ORIGIN.get(str(a), "Other / unclassified"))
                       for mo, a in zip(m.model, m.author)]
        g = m.groupby(["week", "origin"]).tokens.sum().unstack(fill_value=0)
        origin = [{"week": w, **{k: int(v) for k, v in r.items()}} for w, r in g.iterrows()]
        last = full.week.max()
        lw = m[m.week == last].sort_values("tokens", ascending=False)
        prevw = sorted(m.week.unique())
        prev = prevw[prevw.index(last) - 1] if last in prevw and prevw.index(last) > 0 else None
        pm = m[m.week == prev].set_index("model").tokens if prev else pd.Series(dtype=float)
        top = [{"model": r.model, "author": r.author if isinstance(r.author, str) else "", "tokens": int(r.tokens),
                "prev": clean(pm.get(r.model)), "origin": r.origin} for r in lw.itertuples()]
    else:
        top, last, prev = [], None, None
    app_rows, snap = [], None
    if not apps.empty:
        snap = apps.snapshot.max()
        a = apps[(apps.snapshot == snap) & (apps.period == "week")].sort_values("rank")
        app_rows = records(a.fillna(""))
    req = or_csv("openrouter_weekly_requests.csv")
    return jsonify({"totals": records(tot.fillna("")), "origin": origin, "top": top, "top_week": last,
                    "prev_week": prev, "apps": app_rows, "apps_snapshot": snap,
                    "requests": records(req.fillna("")) if not req.empty else []})


# ---------------------------------------------------------------- Silicon Data GPU rental indices
SDD = HERE.parent / "silicon-data"
SD_META = {  # index -> label, unit, segment (mirrors silicon_update.INDEX; silicon_indices.json, written each run, wins)
    "SDH100RT": ("H100", "USD / GPU-hour", "Neo-cloud"), "SDB200RT": ("B200", "USD / GPU-hour", "Neo-cloud"),
    "SDA100RT": ("A100", "USD / GPU-hour", "Neo-cloud"), "H200": ("H200", "USD / GPU-hour", "Neo-cloud"),
    "B300": ("B300", "USD / GPU-hour", "Neo-cloud"), "MI300X": ("MI300X", "USD / GPU-hour", "Neo-cloud"),
    "SDLLMTK": ("LLM Token Expenditure Index", "USD / M tokens", "Index"),
    "LLM-OPEN": ("Open LLM Token Expenditure Index", "USD / M tokens", "Index"),
    "LLM-PROP": ("Proprietary LLM Token Expenditure Index", "USD / M tokens", "Index"),
    "GDDR6": ("GDDR6 RAM Index", "USD / GB", "Memory"),
    "H100-HYP": ("H100", "USD / GPU-hour", "Hyperscaler"), "A100-HYP": ("A100", "USD / GPU-hour", "Hyperscaler"),
    "B200-HYP": ("B200", "USD / GPU-hour", "Hyperscaler"),
}


def sd_meta():
    p = SDD / "silicon_indices.json"
    if not p.exists():
        return SD_META
    j = cached("sd:meta", [p], lambda: json.loads(p.read_text(encoding="utf-8")))
    return {**SD_META, **{k: (v["label"], v["unit"], v["segment"]) for k, v in j.items()}}
# the workbook's "Implied Revenue / GW / Year": 6.5 kW per 8-GPU server -> 1e6/(6.5/8) GPUs per GW, 8,760 h
GPUS_PER_GW = 1_000_000 / (6.5 / 8)


def sd_csv(name):
    p = SDD / name
    return cached("sd:" + name, [p], lambda: pd.read_csv(p) if p.exists() else pd.DataFrame())


@app.route("/api/silicon")
def silicon():
    d = sd_csv("silicon_index_daily.csv")
    if d.empty:
        return jsonify({"series": {}, "latest": []})
    d = d.sort_values("date")
    series, latest, meta = {}, [], sd_meta()
    for idx, g in d.groupby("index"):
        lab, unit, seg = meta.get(idx, (idx, "", ""))
        series[idx] = {"label": lab, "unit": unit, "segment": seg,
                       "points": [[r.date, float(r.value), "site" if str(r.source).startswith("silicondata") else "workbook"]
                                  for r in g.itertuples()]}
        s = g.set_index(pd.to_datetime(g.date)).value.astype(float)
        last_d, last_v = s.index[-1], float(s.iloc[-1])

        def back(days):
            prior = s[s.index <= last_d - pd.Timedelta(days=days)]
            return float(prior.iloc[-1]) if len(prior) and (last_d - prior.index[-1]).days <= days + 4 else None
        ytd = s[s.index <= pd.Timestamp(year=last_d.year - 1, month=12, day=31)]
        latest.append({"index": idx, "label": lab, "unit": unit, "segment": seg, "date": last_d.strftime("%Y-%m-%d"),
                       "value": last_v, "d7": back(7), "d30": back(30), "d365": back(365),
                       "ytd_base": float(ytd.iloc[-1]) if len(ytd) else None, "n": int(len(s)),
                       "first": s.index[0].strftime("%Y-%m-%d"),
                       "rev_per_gw_bn": last_v * GPUS_PER_GW * 8760 / 1e9 if unit == "USD / GPU-hour" else None})
    chk = sd_csv("silicon_checks.csv")
    return jsonify({"series": series, "latest": latest, "checks": records(chk.tail(20)) if not chk.empty else [],
                    "gpus_per_gw": GPUS_PER_GW})


# ---------------------------------------------------------------- HY credit spreads + US 10y rates (FRED)
CSD = HERE.parent / "credit-spreads"
HY_META = {"BAMLH0A1HYBB": ("BB", "ICE BofA BB US High Yield OAS"),
           "BAMLH0A3HYC": ("CCC & lower", "ICE BofA CCC & Lower US High Yield OAS")}
RATE_META = {"DFII10": ("Real yield", "10-year real yield (TIPS)"),
             "THREEFYTP10": ("Term premium", "10-year term premium (Kim-Wright)"),
             "DGS10": ("Nominal", "10-year Treasury yield")}


def hy_frame():
    p = CSD / "macro_daily.csv"
    return cached("hy", [p], lambda: pd.read_csv(p) if p.exists() else pd.DataFrame())


def _hy_stats(s):
    """s: date-indexed % series -> latest, bp changes, percentile ranks."""
    last_d, last_v = s.index[-1], float(s.iloc[-1])

    def back(days):
        prior = s[s.index <= last_d - pd.Timedelta(days=days)]
        return float(prior.iloc[-1]) if len(prior) else None
    ytd = s[s.index <= pd.Timestamp(year=last_d.year - 1, month=12, day=31)]
    since10 = s[s.index >= "2010-01-01"]
    return {"date": last_d.strftime("%Y-%m-%d"), "value": last_v, "d7": back(7), "d30": back(30), "d365": back(365),
            "ytd_base": float(ytd.iloc[-1]) if len(ytd) else None,
            "pctile_all": float((s <= last_v).mean()), "pctile_2010": float((since10 <= last_v).mean()),
            "min": float(s.min()), "min_date": s.idxmin().strftime("%Y-%m-%d"),
            "max": float(s.max()), "max_date": s.idxmax().strftime("%Y-%m-%d"),
            "first": s.index[0].strftime("%Y-%m-%d"), "n": int(len(s))}


@app.route("/api/spreads")
def spreads():
    d = hy_frame()
    if d.empty:
        return jsonify({"series": {}, "stats": {}})
    w = d.pivot_table(index="date", columns="series", values="value", aggfunc="last").sort_index()
    w.index = pd.to_datetime(w.index)
    series, stats = {}, {}
    for sid, (short, label) in HY_META.items():
        if sid in w:
            s = w[sid].dropna()
            series[sid] = {"label": label, "short": short, "points": [[i.strftime("%Y-%m-%d"), float(v)] for i, v in s.items()]}
            stats[sid] = {"label": label, "short": short, **_hy_stats(s)}
    if set(HY_META) <= set(w):
        both = w[list(HY_META)].dropna()
        gap = both["BAMLH0A3HYC"] - both["BAMLH0A1HYBB"]
        ratio = both["BAMLH0A3HYC"] / both["BAMLH0A1HYBB"]
        series["gap"] = {"label": "CCC minus BB", "points": [[i.strftime("%Y-%m-%d"), float(v)] for i, v in gap.items()]}
        series["ratio"] = {"label": "CCC ÷ BB", "points": [[i.strftime("%Y-%m-%d"), float(v)] for i, v in ratio.items()]}
        stats["gap"] = {"label": "CCC minus BB", "short": "CCC − BB", **_hy_stats(gap)}
        stats["ratio"] = {"label": "CCC ÷ BB", "short": "CCC ÷ BB", **_hy_stats(ratio)}
    for sid, (short, label) in RATE_META.items():
        if sid in w:
            s = w[sid].dropna()
            series[sid] = {"label": label, "short": short, "points": [[i.strftime("%Y-%m-%d"), float(v)] for i, v in s.items()]}
            stats[sid] = {"label": label, "short": short, **_hy_stats(s)}
    if {"DGS10", "DFII10"} <= set(w):
        be = (w["DGS10"] - w["DFII10"]).dropna()  # breakeven inflation = nominal - real
        series["breakeven"] = {"label": "10-year breakeven inflation (nominal − real)", "short": "Breakeven",
                               "points": [[i.strftime("%Y-%m-%d"), float(v)] for i, v in be.items()]}
        stats["breakeven"] = {"label": "10-year breakeven inflation (nominal − real)", "short": "Breakeven", **_hy_stats(be)}
    chk = CSD / "spreads_checks.csv"
    return jsonify({"series": series, "stats": stats,
                    "checks": records(pd.read_csv(chk).tail(20)) if chk.exists() else []})


# ---------------------------------------------------------------- BofA Exhibit 2: capex cycles as % of GDP
BCD = HERE.parent / "bofa-capex-cycles"


@app.route("/api/capex-cycles")
def capex_cycles():
    p = BCD / "exhibit2_points.csv"
    d = cached("bc", [p], lambda: pd.read_csv(p) if p.exists() else pd.DataFrame())
    if d.empty:
        return jsonify({"series": []})
    out = []
    for key, g in d.groupby("series", sort=False):
        out.append({"key": key, "label": g.label.iloc[0],
                    "points": [[float(r.position), float(r.value_pct_gdp), None if pd.isna(r.year) else int(r.year)]
                               for r in g.itertuples()]})
    books = sorted(BCD.glob("*_BofA Exhibit 2*.xlsx"), key=lambda b: b.stat().st_mtime)
    fh, ext = BCD / "firsthand" / "firsthand_vs_vector.csv", BCD / "firsthand" / "hyperscalers_firsthand_extended.csv"
    fhd = cached("bcfh", [fh], lambda: pd.read_csv(fh) if fh.exists() else pd.DataFrame())
    exd = cached("bcex", [ext], lambda: pd.read_csv(ext) if ext.exists() else pd.DataFrame())
    check = []
    for key, g in (fhd.groupby("series", sort=False) if not fhd.empty else []):
        a = g.diff_pp.abs()
        check.append({"key": key, "n": int(len(g)), "max": float(a.max()), "mean": float(a.mean()),
                      "rmse": float((g.diff_pp ** 2).mean() ** 0.5), "source": g.firsthand_source.iloc[0]})
    qi, of = BCD / "firsthand" / "hyperscalers_quarterly_inputs.csv", BCD / "firsthand" / "oracle_fiscal_quarters.csv"
    qid = cached("bcqi", [qi], lambda: pd.read_csv(qi) if qi.exists() else pd.DataFrame())
    ofd = cached("bcof", [of], lambda: pd.read_csv(of) if of.exists() else pd.DataFrame())
    npp, e7 = BCD / "firsthand" / "neocloud_periods.csv", BCD / "firsthand" / "hyperscalers_expanded_ttm.csv"
    npd = cached("bcnp", [npp], lambda: pd.read_csv(npp) if npp.exists() else pd.DataFrame())
    ngp = BCD / "firsthand" / "neocloud_guidance.csv"
    ngd = cached("bcng", [ngp], lambda: pd.read_csv(ngp) if ngp.exists() else pd.DataFrame())
    e7d = cached("bce7", [e7], lambda: pd.read_csv(e7) if e7.exists() else pd.DataFrame())
    rp = BCD / "firsthand" / "hyperscalers_rpo_quarterly.csv"
    rpd = cached("bcrpo", [rp], lambda: pd.read_csv(rp) if rp.exists() else pd.DataFrame())
    cp = BCD / "firsthand" / "hyperscalers_cip_quarterly.csv"
    cpd = cached("bccip", [cp], lambda: pd.read_csv(cp) if cp.exists() else pd.DataFrame())
    pq = BCD / "firsthand" / "hyperscalers_partial_quarters.csv"
    pqd = cached("bcpq", [pq], lambda: pd.read_csv(pq) if pq.exists() else pd.DataFrame())
    return jsonify({"series": out, "xlsx": books[-1].name if books else None, "check": check,
                    "quarterly": records(qid) if not qid.empty else [], "oracle_fiscal": records(ofd) if not ofd.empty else [],
                    "neo_periods": records(npd) if not npd.empty else [], "expanded7": records(e7d) if not e7d.empty else [],
                    "detail": records(fhd) if not fhd.empty else [], "rpo": records(rpd) if not rpd.empty else [],
                    "cip": records(cpd) if not cpd.empty else [], "neo_guidance": records(ngd) if not ngd.empty else [],
                    "partial": records(pqd) if not pqd.empty else [],
                    "extended": records(exd) if not exd.empty else []})


@app.route("/download-capex/<path:name>")
def download_capex(name):
    p = (BCD / name).resolve()
    if p.parent != BCD.resolve() or not p.exists() or p.suffix != ".xlsx":
        abort(404)
    return send_file(p, as_attachment=True)


# ---------------------------------------------------------------- Ramp AI Index: business token volume / spend / price
RPD = HERE.parent / "ramp-ai-index"
RAMP_MAKERS = {"anthropic": "Anthropic", "openai": "OpenAI", "google": "Google", "xai": "xAI"}


def rp_csv(name):
    p = RPD / name
    return cached("rp:" + name, [p], lambda: pd.read_csv(p) if p.exists() else pd.DataFrame())


@app.route("/api/ramp")
def ramp():
    v = rp_csv("ramp_token_weekly.csv")
    if v.empty:
        return jsonify({"weeks": []})
    v = v.assign(grp=v.maker.map(RAMP_MAKERS).fillna("Other makers"))
    piv = v.pivot_table(index="week", columns=["metric", "grp"], values="value", aggfunc="sum", fill_value=0).sort_index()
    weeks = list(piv.index)
    makers = list(RAMP_MAKERS.values()) + ["Other makers"]
    by = {m: {g: [float(x) for x in piv[(m, g)]] if (m, g) in piv else [0.0] * len(weeks) for g in makers}
          for m in ("token_volume", "token_spend")}
    # top models in the latest week vs four weeks earlier
    last = weeks[-1]
    prior = weeks[-5] if len(weeks) >= 5 else None
    mp = v.pivot_table(index=["model", "label", "maker"], columns=["metric", "week"], values="value", aggfunc="sum")
    top = []
    for (model, label, maker), r in mp.iterrows():
        tok = r.get(("token_volume", last))
        if pd.isna(tok) or tok <= 0:
            continue
        spend = r.get(("token_spend", last))
        tok4 = r.get(("token_volume", prior)) if prior else None
        top.append({"model": model, "label": label, "maker": RAMP_MAKERS.get(maker, maker or "–"),
                    "tokens": float(tok), "spend": clean(spend), "tokens_4w": clean(tok4)})
    top.sort(key=lambda r: -r["tokens"])
    # list prices actually paid, by token type (trailing 7 days, USD per million tokens)
    p = rp_csv("ramp_token_prices_daily.csv")
    prices = {}
    if not p.empty:
        pv = p.pivot_table(index=["date", "maker"], columns="token_type", values=["cost_usd_7d", "tokens_7d"], aggfunc="sum")
        for (d, mk), r in pv.iterrows():
            c, t = r["cost_usd_7d"], r["tokens_7d"]
            cached_t = t["all_tokens"] - t["output"] - t["uncached_input"]
            cached_c = c["all_tokens"] - c["output"] - c["uncached_input"]
            row = prices.setdefault(RAMP_MAKERS.get(mk, mk), [])
            per_m = lambda cc, tt: float(cc / tt * 1e6) if tt and tt > 0 else None
            row.append([d, per_m(c["all_tokens"], t["all_tokens"]), per_m(c["output"], t["output"]),
                        per_m(c["uncached_input"], t["uncached_input"]), per_m(cached_c, cached_t),
                        float(cached_t / (t["all_tokens"] - t["output"])) if t["all_tokens"] > t["output"] else None])
    return jsonify({"weeks": weeks, "makers": makers, "by": by, "top": top[:25], "last": last, "prior": prior,
                    "n_models": len(top), "prices": prices,
                    "price_cols": ["blended", "output", "uncached_input", "cached_input", "cached_share_of_input"]})


@app.route("/api/ramp-adoption")
def ramp_adoption():
    """Ramp AI Index proper: share of Ramp's businesses paying for AI tools, monthly, plus AI spend per employee."""
    a = rp_csv("ramp_adoption_monthly.csv")
    if a.empty:
        return jsonify({"groups": {}})
    groups = {}
    for (grp, key), g in a.sort_values("month").groupby(["group", "key"]):
        groups.setdefault(grp, {})[key] = [[r.month, r.adoption_pct, clean(r.n_firms), clean(r.ai_firms), r.note if isinstance(r.note, str) else ""]
                                           for r in g.itertuples()]
    pe = rp_csv("ramp_spend_per_employee.csv")
    spend = {}
    for (dim, key), g in (pe.sort_values("month").groupby(["dimension", "key"]) if not pe.empty else []):
        spend.setdefault(dim, {})[key] = records(g.drop(columns=["dimension", "key"]))
    return jsonify({"groups": groups, "spend": spend, "last": a.month.max()})


# ---------------------------------------------------------------- token economics (fin, "AI Semiconductor Endgame IV")
IMD = HERE.parent / "inference-margin"
# OpenRouter app categories -> bucket (an app with any agent category counts as an agent)
APP_AGENT = {"cli-agent", "personal-agent", "cloud-agent"}
APP_CODING = {"ide-extension", "programming-app", "native-app-builder"}


def im_csv(name):
    p = IMD / name
    return cached("im:" + name, [p], lambda: pd.read_csv(p) if p.exists() else pd.DataFrame())


@app.route("/api/tokenecon")
def tokenecon():
    """Four tests of the 'token-economics equilibrium': usage vs price (Ramp + OpenRouter), open-weights share of
    tokens vs spend, open-model inference margin per GPU, and agentic intensity."""
    out = {}
    # 1. usage vs price - Ramp: only models with both billed spend and tokens that week (same sample for both)
    v = rp_csv("ramp_token_weekly.csv")
    if not v.empty:
        pv = v.pivot_table(index=["week", "model"], columns="metric", values="value", aggfunc="sum").dropna()
        pv = pv[(pv.token_spend > 0) & (pv.token_volume > 0)].groupby(level="week").sum()
        out["ramp"] = [[w, float(r.token_volume), float(r.token_spend)] for w, r in pv.iterrows()]
    osh = or_csv("openrouter_open_share.csv")
    if not osh.empty:
        out["openrouter"] = records(osh.fillna(""))
    # 3. inference margin per GPU
    im = im_csv("inference_margin_monthly.csv")
    if not im.empty:
        out["margin"] = records(im.fillna(""))
        ip = im_csv("inference_prices.csv")
        out["margin_prices"] = records(ip.fillna("")) if not ip.empty else []
    # 4. agentic intensity: tokens per request (weekly totals) + top public apps by category
    tot, req = or_csv("openrouter_weekly_totals.csv"), or_csv("openrouter_weekly_requests.csv")
    if not tot.empty and not req.empty:
        j = tot[tot.partial == 0].merge(req[req.partial == 0], on="week")
        out["tpr"] = [[r.week, float(r.total_tokens) / float(r.total_requests)] for r in j.itertuples() if r.total_requests]
    apps = or_csv("openrouter_top_apps.csv")
    if not apps.empty:
        a = apps[apps.period == "week"].copy()
        cats = a.categories.fillna("").astype(str).str.split("|")
        a["bucket"] = ["Agents" if set(c) & APP_AGENT else "Coding tools" if set(c) & APP_CODING else "Chat & other" for c in cats]
        a["tokens"] = pd.to_numeric(a.tokens, errors="coerce").fillna(0)
        g = a.groupby(["snapshot", "bucket"]).tokens.sum().unstack(fill_value=0)
        out["apps"] = [{"snapshot": s, **{k: float(x) for k, x in r.items()}, "n": int((a.snapshot == s).sum())} for s, r in g.iterrows()]
        last = a.snapshot.max()
        out["apps_last"] = records(a[a.snapshot == last].sort_values("rank")[["rank", "app", "tokens", "requests", "categories", "bucket"]].fillna(""))
        out["apps_snapshot"] = last
    return jsonify(out)


# ---------------------------------------------------------------- price of thought (Epoch AI replication + update)
POT = HERE.parent / "epoch-price-of-thought" / "data" / "results.json"


@app.route("/api/pot")
def pot():
    """Epoch AI 'The plunging price of thought' replicated from its own data, then extended with Epoch
    Benchmarking Hub scores of later models at estimated cost (../epoch-price-of-thought/pot_update.py)."""
    if not POT.exists():
        return jsonify({})
    return jsonify(cached("pot", [POT], lambda: json.loads(POT.read_text(encoding="utf-8"))))


# ---------------------------------------------------------------- OpenAI & Anthropic ARR
ARD = HERE.parent / "ai-lab-arr"
ARR_CANDS = ARD / "arr_candidates.json"


def ar_csv(name):
    p = ARD / name
    return cached("ar:" + name, [p], lambda: pd.read_csv(p) if p.exists() else pd.DataFrame())


def _loglin(pts, when):
    """ARR at a date by log-linear interpolation between the run-rate points around it."""
    pts = sorted(pts)
    before = [p for p in pts if p[0] <= when]
    after = [p for p in pts if p[0] >= when]
    if not before or not after:
        return None
    (d0, v0), (d1, v1) = before[-1], after[0]
    if d1 == d0:
        return v0
    f = (when - d0).days / (d1 - d0).days
    return math.exp(math.log(v0) + f * (math.log(v1) - math.log(v0)))


@app.route("/api/arr")
def arr():
    p = ar_csv("arr_points.csv")
    if p.empty:
        return jsonify({"points": []})
    p = p.fillna("")
    rr = p[p.kind == "run_rate"].copy()
    rr["d"] = pd.to_datetime(rr.date)
    stats = {}
    series = {co: [(r.d.to_pydatetime(), float(r.value_usd)) for r in g.sort_values("d").itertuples()]
              for co, g in rr.groupby("company")}
    for co, pts in series.items():
        last_d, last_v = pts[-1]
        yago = _loglin(pts, last_d - dt.timedelta(days=365))
        dec25 = _loglin(pts, dt.datetime(2025, 12, 31))
        recent = [x for x in pts if x[0] >= last_d - dt.timedelta(days=183)]
        dbl = None
        if len(recent) >= 2 and recent[-1][1] > recent[0][1]:
            yrs = (recent[-1][0] - recent[0][0]).days / 365.25
            dbl = 12 * yrs * math.log(2) / math.log(recent[-1][1] / recent[0][1]) if yrs > 0 else None
        stats[co] = {"date": last_d.strftime("%Y-%m-%d"), "value": last_v, "yago": yago, "dec25": dec25,
                     "doubling_months": dbl, "n": len(pts)}
    # when did Anthropic's run-rate pass OpenAI's? (log-linear on both series, daily grid)
    cross = None
    if {"Anthropic", "OpenAI"} <= set(series):
        a, o = series["Anthropic"], series["OpenAI"]
        start, end = max(a[0][0], o[0][0]), min(a[-1][0], o[-1][0])
        day, prev = start, None
        while day <= end:
            va, vo = _loglin(a, day), _loglin(o, day)
            if va and vo:
                if prev is not None and prev <= 0 < va - vo:
                    cross = day.strftime("%Y-%m-%d")
                prev = va - vo
            day += dt.timedelta(days=1)
        both = min(a[-1][0], o[-1][0])
        stats["ratio"] = {"date": both.strftime("%Y-%m-%d"), "value": _loglin(a, both) / _loglin(o, both)}
    land = ar_csv("arr_landscape.csv")
    cands = json.loads(ARR_CANDS.read_text(encoding="utf-8-sig")) if ARR_CANDS.exists() else []
    return jsonify({"points": records(p), "stats": stats, "crossover": cross,
                    "landscape": records(land.fillna("")) if not land.empty else [],
                    "candidates": [] if HOSTED else [c for c in cands if c.get("status") == "new"],
                    "trend": {k: (records(t.where(t.notna(), None)) if not t.empty else [])
                              for k, t in (("metrics", ar_csv("arr_trend_metrics.csv")), ("quarterly", ar_csv("arr_trend_quarterly.csv")),
                                           ("monthly", ar_csv("arr_trend_monthly.csv")))}})


@app.route("/api/arr-candidates/<cid>/<action>", methods=["POST"])
def arr_candidate(cid, action):
    if action not in ("add", "dismiss"):
        abort(404)
    with _lock:
        cands = json.loads(ARR_CANDS.read_text(encoding="utf-8-sig")) if ARR_CANDS.exists() else []
        c = next((x for x in cands if x["id"] == cid), None)
        if c is None:
            abort(404)
        if action == "add":
            f = request.get_json(force=True) or {}
            try:
                date = dt.date.fromisoformat(str(f.get("date", c["date"]))[:10]).isoformat()
                value = float(f.get("value_bn", c["value_usd"] / 1e9)) * 1e9
            except ValueError:
                return jsonify({"error": "date must be YYYY-MM-DD and value a number ($ billion)"}), 400
            co = f.get("company", c["company"])
            if co not in ("Anthropic", "OpenAI"):
                return jsonify({"error": "company must be Anthropic or OpenAI"}), 400
            row = {"company": co, "date": date, "value_usd": value, "kind": "run_rate",
                   "label": f"{dt.date.fromisoformat(date):%b %Y} {value/1e9:g}B (news)", "scope": "Full company",
                   "rev_type": "Annualized run rate", "period_type": "", "confidence": f.get("confidence", "Likely"),
                   "source_type": "Media report", "report_date": c["date"], "source1": c.get("link", ""), "source2": "",
                   "quote": (f.get("quote") or c["title"]).strip()[:600], "compute_gw": "", "inference_gw": "",
                   "inference_rev_per_gw_bn": "", "origin": "news scan, added in the app", "note": f.get("note", "")}
            adds = ARD / "arr_additions.csv"
            new = not adds.exists()
            with open(adds, "a", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=list(row))
                if new:
                    w.writeheader()
                w.writerow(row)
            subprocess.call([sys.executable, str(ARD / "arr_update.py"), "--no-scan"], cwd=ARD,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        c["status"] = "added" if action == "add" else "dismissed"
        c["decided"] = dt.date.today().isoformat()
        ARR_CANDS.write_text(json.dumps(cands, indent=1, ensure_ascii=False), encoding="utf-8")
    _cache.pop("ar:arr_points.csv", None)
    return jsonify({"ok": True, "status": c["status"]})


# ---------------------------------------------------------------- disclosure review queue
CAND = UT / "candidates.json"
CONSUMER_COLS = ["date", "users_m", "product", "metric", "what_was_said", "who", "source_url", "flag"]
CODEX_COLS = ["date", "users_m", "series", "metric_as_stated", "scope", "who", "source_url"]


def load_candidates():
    return json.loads(CAND.read_text(encoding="utf-8-sig")) if CAND.exists() else []


def save_candidates(c):
    tmp = CAND.with_suffix(".tmp")
    tmp.write_text(json.dumps(c, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, CAND)


def append_row(name, cols, row):
    """Add one row to a codex-user-trend CSV, keeping it sorted by date."""
    p = UT / name
    df = pd.read_csv(p, dtype=str).fillna("") if p.exists() else pd.DataFrame(columns=cols)
    df = pd.concat([df, pd.DataFrame([{c: row.get(c, "") for c in cols}])], ignore_index=True)
    df = df.sort_values("date", kind="stable")
    tmp = p.with_suffix(".tmp")
    df[cols].to_csv(tmp, index=False, encoding="utf-8")
    os.replace(tmp, p)


@app.route("/api/candidates/<cid>/<action>", methods=["POST"])
def candidate(cid, action):
    if action not in ("add", "dismiss"):
        abort(404)
    with _lock:
        cands = load_candidates()
        c = next((x for x in cands if x["id"] == cid), None)
        if c is None:
            abort(404)
        if action == "add":
            f = request.get_json(force=True) or {}
            try:
                users = float(f.get("users_m", c["users_m"]))
                date = dt.date.fromisoformat(str(f.get("date", c["date"]))[:10]).isoformat()
            except ValueError:
                return jsonify({"error": "date must be YYYY-MM-DD and users a number (millions)"}), 400
            prod = f.get("product", c["product"])
            what = (f.get("what") or c["title"]).strip()
            who = (f.get("who") or c.get("source") or "").strip()
            url = (f.get("url") or c.get("link") or "").strip()
            metric = (f.get("metric") or c["metric"]).rstrip("?")
            if prod == "Codex":
                series = f.get("series") or ("Milestone posts (active users)" if date >= "2026-07-01"
                                              else "Codex WAU (OpenAI-stated)")
                append_row("codex_users.csv", CODEX_COLS, {
                    "date": date, "users_m": users, "series": series, "metric_as_stated": what,
                    "scope": "Codex + ChatGPT Work" if series.startswith("Milestone") else "Codex",
                    "who": who, "source_url": url})
            else:
                append_row("consumer_assistants.csv", CONSUMER_COLS, {
                    "date": date, "users_m": users, "product": prod, "metric": metric,
                    "what_was_said": what, "who": who, "source_url": url, "flag": ""})
        c["status"] = "added" if action == "add" else "dismissed"
        c["decided"] = dt.date.today().isoformat()
        save_candidates(cands)
    _cache.pop("ut:consumer_assistants.csv", None)
    _cache.pop("ut:codex_users.csv", None)
    return jsonify({"ok": True, "status": c["status"]})


@app.route("/api/overview")
def overview():
    df, dates = btos()
    gt = tracker()
    nat = df[(df.level == "National") & (df.answer == "Yes") & (df.ver == "v2")].sort_values("smpdt")
    ref = dates.set_index("smpdt").ref_end.to_dict()
    tiles = []
    for q, title in ((7, "US firms using AI"), (24, "US firms expecting to use AI within 6 months")):
        s = nat[nat.qid == q]
        tiles.append({"id": f"btos{q}", "title": title, "value": clean(s.estimate.iloc[-1]),
                      "prev": clean(s.estimate.iloc[-2]), "delta_label": "vs prior fortnight",
                      "date": f"Fortnight ending {nice_date(clean(ref.get(s.smpdt.iloc[-1])))}",
                      "source": "Census BTOS, any business function",
                      "spark": [clean(v) for v in s.estimate]})
    if gt is not None:
        nw = gt[gt.dimension == "National"]
        for cat, meas, title in (("Employed - For Work", "Share Using GenAI", "Workers using genAI at work"),
                                 ("All adults - Any", "Share Using GenAI", "US adults (18-64) using genAI"),
                                 (None, "Share of work hours using genAI", "Work hours spent using genAI")):
            s = nw[(nw.measure == meas) & ((nw.category == cat) if cat else True)].sort_values("wave")
            if s.empty:
                continue
            yago = s[s.wave == s.wave.iloc[-1] - pd.DateOffset(years=1)]["mean"]
            tiles.append({"id": meas[:12], "title": title, "value": clean(s["mean"].iloc[-1]),
                          "prev": clean(yago.iloc[0]) if len(yago) else None, "delta_label": "vs a year earlier",
                          "date": f"{s.wave.iloc[-1]:%b %Y} survey", "source": "GenAI Adoption Tracker (RPS)",
                          "spark": [clean(v) for v in s["mean"]]})
    con = ut_csv("consumer_assistants.csv")
    if not con.empty:
        for prod in ("ChatGPT", "Gemini app"):
            s = con[con["product"] == prod].sort_values("date")
            if len(s):
                r = s.iloc[-1]
                coll = " (collective count)" if "collective" in str(r.what_was_said).lower() else ""
                tiles.append({"id": prod, "title": f"{prod} {r.metric.lower()} users{coll}", "value": float(r.users_m),
                              "unit": "users_m", "date": nice_date(r.date),
                              "source": r.who, "spark": [float(v) for v in s.users_m]})
    cx = ut_csv("codex_users.csv")
    if not cx.empty:
        r = cx.sort_values("date").iloc[-1]
        tiles.append({"id": "codex", "title": "Codex + ChatGPT Work active users", "value": float(r.users_m),
                      "unit": "users_m", "date": nice_date(r.date),
                      "source": r.who, "spark": [float(v) for v in cx.sort_values("date").users_m]})
    arp = ar_csv("arr_points.csv")
    if not arp.empty:
        rr = arp[arp.kind == "run_rate"].sort_values("date")
        for co in ("Anthropic", "OpenAI"):
            g = rr[rr.company == co]
            if len(g):
                pts = [(pd.Timestamp(d).to_pydatetime(), float(v)) for d, v in zip(g.date, g.value_usd)]
                yago = _loglin(pts, pts[-1][0] - dt.timedelta(days=365))
                tiles.append({"id": "arr_" + co, "title": f"{co} run-rate ARR", "value": pts[-1][1], "prev": yago,
                              "delta_label": "vs a year earlier", "unit": "usd", "date": nice_date(g.date.iloc[-1]),
                              "source": "Research workbook + approved news", "spark": [p[1] for p in pts]})
    ra = rp_csv("ramp_adoption_monthly.csv")
    if not ra.empty:
        s = ra[ra.group == "overall"].sort_values("month")
        if len(s) > 12:
            tiles.append({"id": "rampadopt", "title": "US businesses paying for AI tools (Ramp)", "value": float(s.adoption_pct.iloc[-1]) / 100,
                          "prev": float(s.adoption_pct.iloc[-13]) / 100, "delta_label": "vs a year earlier",
                          "date": f"{pd.Timestamp(s.month.iloc[-1]):%b %Y}", "source": "Ramp AI Index, card and bill-pay data",
                          "spark": [float(v) / 100 for v in s.adoption_pct]})
    rv = rp_csv("ramp_token_weekly.csv")
    if not rv.empty:
        t = rv[rv.metric == "token_volume"].groupby("week").value.sum().sort_index()
        if len(t) > 5:
            tiles.append({"id": "ramp", "title": "Business tokens per week (Ramp sample)", "value": float(t.iloc[-1]),
                          "prev": float(t.iloc[-5]), "delta_label": "vs 4 weeks earlier", "unit": "tokens",
                          "date": f"Week of {nice_date(t.index[-1])}", "source": "Ramp AI Index, Token Spend Management firms",
                          "spark": [float(x) for x in t.tail(26)]})
    hy = hy_frame()
    if not hy.empty:
        tile_meta = [(sid, f"{short} high-yield spread (OAS)", "ICE BofA via FRED") for sid, (short, _) in HY_META.items()] + \
                    [("DFII10", "US 10-year real yield", "FRED, TIPS"), ("THREEFYTP10", "US 10-year term premium", "FRED, Kim-Wright model")]
        for sid, title, src in tile_meta:
            g = hy[hy.series == sid].sort_values("date")
            if len(g) > 8:
                s = g.set_index(pd.to_datetime(g.date)).value.astype(float)
                wk = s[s.index <= s.index[-1] - pd.Timedelta(days=7)]
                tiles.append({"id": "hy_" + sid, "title": title, "value": float(s.iloc[-1]),
                              "prev": float(wk.iloc[-1]) if len(wk) else None, "delta_label": "vs a week earlier",
                              "unit": "oas", "date": f"{nice_date(g.date.iloc[-1])} · {sid}",
                              "source": f"{src} · {(s <= s.iloc[-1]).mean() * 100:.0f}th pctile since {s.index[0].year}",
                              "spark": [float(v) for v in s.tail(260)]})
    ps = pop_summary()
    if ps:
        tiles.append({"id": "pop_ms", "title": "AI users worldwide (Microsoft, ages 15-64)", "value": ps["ms_users"] / 1e6,
                      "unit": "users_m", "date": f"{ps['ms_period']} · {ps['ms_users'] / ps.get('ms_pop_15_64', ps['pop_15_64']) * 100:.1f}% of 15-64s",
                      "source": f"Microsoft AI Diffusion × World Bank population, {ps['ms_economies']} economies", "spark": []})
        tiles.append({"id": "pop_best", "title": "AI users worldwide (best available)", "value": ps["best_users"] / 1e6,
                      "unit": "users_m", "date": f"{ps['nat_economies']} national official figures + Microsoft elsewhere",
                      "source": f"National sources count {ps['nat_users'] / ps['nat_ms_same']:.1f}× Microsoft for the same economies",
                      "spark": []})
    ort = or_csv("openrouter_weekly_totals.csv")
    if not ort.empty:
        f = ort[ort.partial == 0].sort_values("week")
        if len(f) > 1:
            tiles.append({"id": "openrouter", "title": "OpenRouter tokens per week", "value": float(f.total_tokens.iloc[-1]),
                          "prev": float(f.total_tokens.iloc[-2]), "delta_label": "vs prior week", "unit": "tokens",
                          "date": f"Week of {nice_date(f.week.iloc[-1])}", "source": "openrouter.ai/rankings, all models",
                          "spark": [float(v) for v in f.total_tokens.tail(26)]})
    return jsonify({"tiles": tiles})


@app.route("/api/changes")
def changes():
    """What arrived in the last N days, ranked by how unusual it is (monitor_changes.py)."""
    days = min(max(int(request.args.get("days", 7)), 1), 90)
    return jsonify(MC.changes(days, write=not HOSTED))


@app.route("/api/freshness")
def freshness():
    return jsonify({"rows": MC.freshness(), "pending": 0 if HOSTED else
                    sum(1 for c in load_candidates() if c.get("status") == "new")
                    + sum(1 for c in (json.loads(ARR_CANDS.read_text(encoding="utf-8-sig")) if ARR_CANDS.exists() else [])
                          if c.get("status") == "new")})


# ---------------------------------------------------------------- data / update
def _run_update(force):
    cmd = [sys.executable, str(HERE / "weekly_update.py")] + (["--force"] if force else [])
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  update started from the web app\n")
        fh.flush()
        rc = subprocess.call(cmd, cwd=HERE, stdout=fh, stderr=subprocess.STDOUT, env=env,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    with _lock:
        _upd.update(running=False, finished=dt.datetime.now().isoformat(timespec="seconds"), rc=rc)
    _cache.clear()


@app.route("/api/update", methods=["GET", "POST"])
def update():
    if request.method == "POST":
        with _lock:
            if not _upd["running"]:
                _upd.update(running=True, started=dt.datetime.now().isoformat(timespec="seconds"),
                            finished=None, rc=None)
                threading.Thread(target=_run_update, args=(request.args.get("force") == "1",),
                                 daemon=True).start()
    tail = [] if HOSTED or not LOG.exists() else LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]
    files = sorted(OUT.glob("*.xlsx"), reverse=True)
    return jsonify({**_upd, "log": tail, "state": state(),
                    "workbooks": [f.name for f in files]})


@app.route("/download/<path:name>")
def download(name):
    if name == "history.csv":
        return send_file(DATA / "history.csv", as_attachment=True,
                         download_name=f"{state().get('published', '').replace('-', '')}_BTOS AI history.csv")
    if name == "tracker.csv":
        return send_file(DATA / "genai_tracker_history.csv", as_attachment=True,
                         download_name="GenAI Adoption Tracker history.csv")
    p = (OUT / name).resolve()
    if p.parent != OUT.resolve() or not p.exists() or p.suffix != ".xlsx":
        abort(404)
    return send_file(p, as_attachment=True)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8930))
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
