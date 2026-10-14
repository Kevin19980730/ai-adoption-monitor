"""GenAI Adoption Tracker (genaiadoptiontracker.com) - worker-side genAI use.

Bick, Blandin & Deming's Real-Time Population Survey (RPS): US adults 18-64, quarterly waves
(Aug / Nov / Feb / May). The site's charts read ten CSVs from its root; we pull the same files.

    GenAI_All.csv               share using genAI: all adults (any) / employed (for work) / all (non-work)
                                x ever / last week / every day last week
    GenAI_Ind.csv, _Occ.csv     share of employed using genAI AT WORK, by industry / occupation
    GenAI_HoursShare_*.csv      % of total work hours spent using genAI
    GenAI_TimeSav_*.csv         time saved by genAI, % of total work hours
    GenAI_PC_Internet.csv       genAI vs PC vs internet adoption, by years since launch

All values on the site are percents; here they become fractions (0.452 = 45.2%).
The first wave (08/24) did not ask the hours / time-saving questions: the CSVs carry 0 with SE 0
there, which we treat as missing.
"""
import csv
import hashlib
import io
import urllib.request

import pandas as pd

BASE = "https://www.genaiadoptiontracker.com/"
FILES = ["GenAI_All", "GenAI_Ind", "GenAI_Occ", "GenAI_PC_Internet",
         "GenAI_HoursShare_All", "GenAI_HoursShare_Ind", "GenAI_HoursShare_Occ",
         "GenAI_TimeSav_All", "GenAI_TimeSav_Ind", "GenAI_TimeSav_Occ"]
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0 Safari/537.36"}

# tracker industry name (full or short) -> NAICS 2-digit sector, for the BTOS comparison
# order matters: "Other Services, Except Public Administration" and "Public Administration"
# must be caught before the bare "admin" key (Administrative and Support = 56)
IND_KEYS = [("other services", "81"), ("public admin", "92"),
            ("agri", "11"), ("ag.", "11"), ("mining", "21"), ("utilities", "22"),
            ("construction", "23"), ("manufactur", "31"), ("wholesale", "42"), ("retail", "44"),
            ("transport", "48"), ("information", "51"), ("financ", "52"), ("real estate", "53"),
            ("professional", "54"), ("management of", "55"), ("admin", "56"), ("educat", "61"),
            ("health", "62"), ("arts", "71"), ("accommodation", "72")]
MEASURE = {"GenAI_Ind": "Share of workers using genAI at work",
           "GenAI_Occ": "Share of workers using genAI at work",
           "GenAI_HoursShare_Ind": "Share of work hours using genAI",
           "GenAI_HoursShare_Occ": "Share of work hours using genAI",
           "GenAI_TimeSav_Ind": "Time saved by genAI (% of work hours)",
           "GenAI_TimeSav_Occ": "Time saved by genAI (% of work hours)",
           "GenAI_HoursShare_All": "Share of work hours using genAI",
           "GenAI_TimeSav_All": "Time saved by genAI (% of work hours)"}


def naics(name):
    n = name.lower()
    return next((code for key, code in IND_KEYS if key in n), "")


def fetch_all():
    out = {}
    for f in FILES:
        req = urllib.request.Request(BASE + f + ".csv", headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
        if body.lstrip()[:1] == b"<":
            raise RuntimeError(f"{f}.csv returned HTML, not CSV")
        out[f] = body.decode("utf-8-sig")
    return out


def digest(raw):
    return hashlib.sha256("".join(raw[f] for f in FILES).encode()).hexdigest()[:16]


def wave(s):
    m, y = s.strip().split("/")
    return pd.Timestamp(year=2000 + int(y), month=int(m), day=1)


def _grid(text):
    """Multi-row header CSV -> (list of column-path tuples, list of data rows)."""
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    hdr, data = [], []
    for r in rows:
        first = r[0].strip()
        if data or (first[:2].isdigit() and "/" in first):
            data.append(r)
        elif not (first == "Survey Date" and not any(c.strip() for c in r[1:])):
            filled, last = [], ""
            for c in r:
                last = c.strip() or last
                filled.append(last)
            hdr.append(filled)
    ncol = max(len(r) for r in rows)
    cols = [tuple(h[i] if i < len(h) else "" for h in hdr) for i in range(ncol)]
    return cols, data


def _num(v):
    try:
        return float(v) / 100
    except (TypeError, ValueError):
        return None


def tidy(raw):
    """All tracker CSVs (except PC/Internet) -> long rows."""
    recs = []
    # national breakdown: Sample / genAI Use / Frequency / Statistic
    cols, data = _grid(raw["GenAI_All"])
    for r in data:
        w = wave(r[0])
        for i in range(1, len(r), 2):
            sample, use, freq = cols[i][:3]  # header rows: Sample / genAI Use / Frequency / Statistic
            recs.append({"file": "GenAI_All", "dimension": "National",
                         "category": f"{sample} adults - {use}" if sample == "All" else f"{sample} - {use}",
                         "measure": freq, "wave": w,
                         "mean": _num(r[i]), "se": _num(r[i + 1]) if i + 1 < len(r) else None})
    for f in ("GenAI_HoursShare_All", "GenAI_TimeSav_All"):
        _, data = _grid(raw[f])
        for r in data:
            recs.append({"file": f, "dimension": "National", "category": "Employed",
                         "measure": MEASURE[f], "wave": wave(r[0]),
                         "mean": _num(r[1]), "se": _num(r[2])})
    occ_full = None
    for f in ("GenAI_Ind", "GenAI_Occ", "GenAI_HoursShare_Ind", "GenAI_HoursShare_Occ",
              "GenAI_TimeSav_Ind", "GenAI_TimeSav_Occ"):
        cols, data = _grid(raw[f])
        names = [cols[i][0] for i in range(1, len(cols), 2)]
        if f == "GenAI_Occ":
            occ_full = names
        dim = "Industry" if f.endswith("Ind") else "Occupation"
        for r in data:
            w = wave(r[0])
            for k, i in enumerate(range(1, len(r), 2)):
                recs.append({"file": f, "dimension": dim, "category": names[k], "pos": k,
                             "measure": MEASURE[f], "wave": w,
                             "mean": _num(r[i]), "se": _num(r[i + 1]) if i + 1 < len(r) else None})
    df = pd.DataFrame(recs)
    # hours / time-saving files use short labels; put every row on the full labels
    ind_full = {naics(c): c for c in df[df.file == "GenAI_Ind"].category.unique()}
    is_ind = df.dimension == "Industry"
    df.loc[is_ind, "category"] = df.loc[is_ind, "category"].map(lambda c: ind_full.get(naics(c), c))
    is_occ = (df.dimension == "Occupation") & (df.file != "GenAI_Occ")
    if occ_full and df.loc[is_occ, "pos"].max() < len(occ_full):
        df.loc[is_occ, "category"] = df.loc[is_occ, "pos"].astype(int).map(lambda k: occ_full[k])
    df["naics"] = df.category.map(naics).where(df.dimension == "Industry", "")
    # first wave never asked hours / time saving: 0 with SE 0 is "not asked", not zero
    blank = (df["mean"] == 0) & (df["se"].fillna(0) == 0)
    df.loc[blank, ["mean", "se"]] = None
    return df.drop(columns=["pos"]).dropna(subset=["mean"]).reset_index(drop=True)


def pc_internet(raw):
    d = pd.read_csv(io.StringIO(raw["GenAI_PC_Internet"]))
    names = {"year": "Years since mass-market launch", "ai_all_rps": "GenAI - all adults (RPS)",
             "pc_all_cps": "PC - all adults (CPS)", "internet_all_cps": "Internet - all adults (CPS)",
             "internet_all_itu": "Internet - all (ITU)", "ai_atwork_rps": "GenAI - at work (RPS)",
             "pc_atwork_cps": "PC - at work (CPS)", "ai_athome_rps": "GenAI - at home (RPS)",
             "pc_athome_cps": "PC - at home (CPS)"}
    for c in d.columns[1:]:
        d[c] = d[c] / 100
    return d.rename(columns=names)
