/* Clickable raw-source links under every chart built from a third-party website.
   Key = chart container id; value = [label, url] pairs. Charts from hand-kept / internal files are left out.
   check_sources.py tests that every URL here still answers. */
(() => {  /* own scope: app.js already declares globals such as SD */
const CEN = "https://www.census.gov/hfp/btos/downloads/";
const GT = "https://www.genaiadoptiontracker.com/";
const RAMP = "https://ramp.com/data/ai-index/chart-data/";
const ORR = "https://openrouter.ai/api/frontend/v1/rankings/";
const SD = "https://www.silicondata.com/products/silicon-index";
const SEC = "https://data.sec.gov/api/xbrl/companyfacts/CIK";
const FRED = "https://fred.stlouisfed.org/series/";
const NPM = "https://api.npmjs.org/downloads/range/last-year/";
const FED_NOTE = ["Fed FEDS Note (Allen 2026)", "https://www.federalreserve.gov/econres/notes/feds-notes/monitoring-ai-adoption-in-the-u-s-economy-20260403.html"];
const BEA_Q = ["BEA NIPA quarterly (NipaDataQ.txt, GDP A191RC)", "https://apps.bea.gov/national/Release/TXT/NipaDataQ.txt"];
const SEC5 = [["SEC XBRL MSFT", SEC + "0000789019.json"], ["GOOGL", SEC + "0001652044.json"], ["AMZN", SEC + "0001018724.json"],
              ["META", SEC + "0001326801.json"], ["ORCL", SEC + "0001341439.json"]];
const SEC_FILINGS = [["EDGAR filings MSFT", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000789019&type=10-&dateb=&owner=include&count=40"],
                     ["GOOGL", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001652044&type=10-&dateb=&owner=include&count=40"],
                     ["AMZN", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001018724&type=10-&dateb=&owner=include&count=40"],
                     ["META", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001326801&type=10-&dateb=&owner=include&count=40"],
                     ["ORCL", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001341439&type=10-&dateb=&owner=include&count=40"]];
const OR_CHART = ["OpenRouter weekly tokens (model-rankings-chart)", ORR + "model-rankings-chart"];
const OR_REQ = ["OpenRouter weekly requests", ORR + "model-rankings-chart?metric=requests"];
const OR_APPS = ["OpenRouter top apps", ORR + "apps"];
const OR_MODELS = ["OpenRouter model list & prices", "https://openrouter.ai/api/v1/models"];
const RP_PAGE = "https://ramp.com/data/ai-index";  /* adoption datasets sit in the page payload, no separate endpoint */
const RP_VOL = ["Ramp tokenVolumes", RAMP + "tokenVolumes"], RP_PX = ["Ramp tokenPrices", RAMP + "tokenPrices"];
const DBX = [["Databricks AI Index (chart data embedded in page)", "https://developers.databricks.com/ai-index"]];
const MENLO = [["Menlo, 2026 State of Enterprise AI", "https://menlovc.com/perspective/2026-the-state-of-enterprise-ai/"]];
const AEI = [["Anthropic Economic Index dataset (Hugging Face)", "https://huggingface.co/datasets/Anthropic/EconomicIndex/tree/main"]];

const SOURCES = {
  "c-ov-token": [["Silicon Data index hub (LLM Token Expenditure + B200 cards)", SD]],
  "c-firm-series": [["Census BTOS National.xlsx", CEN + "National.xlsx"], ["AI Core Questions.xlsx (old wording)", CEN + "AI%20Core%20Questions.xlsx"]],
  "c-firm-rank": [["Census BTOS Sector.xlsx", CEN + "Sector.xlsx"], ["Subsector.xlsx", CEN + "Subsector.xlsx"],
                  ["Employment Size Class.xlsx", CEN + "Employment%20Size%20Class.xlsx"], ["Sector by Employment Size Class.xlsx", CEN + "Sector%20by%20Employment%20Size%20Class.xlsx"]],
  "c-w-nat": [["GenAI tracker GenAI_All.csv", GT + "GenAI_All.csv"]],
  "c-w-hours": [["GenAI_HoursShare_All.csv", GT + "GenAI_HoursShare_All.csv"], ["GenAI_TimeSav_All.csv", GT + "GenAI_TimeSav_All.csv"]],
  "c-w-rank": [["GenAI_Ind.csv", GT + "GenAI_Ind.csv"], ["GenAI_Occ.csv", GT + "GenAI_Occ.csv"]],
  "c-w-pc": [["GenAI_PC_Internet.csv", GT + "GenAI_PC_Internet.csv"]],
  "c-cmp": [["Census BTOS Sector.xlsx", CEN + "Sector.xlsx"], ["GenAI_Ind.csv", GT + "GenAI_Ind.csv"]],
  "c-fed2": [["Census BTOS National.xlsx", CEN + "National.xlsx"], FED_NOTE],
  "c-fed3": [["Census BTOS Employment Size Class.xlsx", CEN + "Employment%20Size%20Class.xlsx"], FED_NOTE],
  "c-fed4": [["Census BTOS Sector.xlsx", CEN + "Sector.xlsx"], FED_NOTE],
  "c-a-codex": [["npm @openai/codex downloads", NPM + "@openai/codex"]],
  "c-a-npm": [["npm @openai/codex", NPM + "@openai/codex"], ["@anthropic-ai/claude-code", NPM + "@anthropic-ai/claude-code"], ["@muse-code/sdk", NPM + "@muse-code/sdk"]],
  "c-a-npmd": [["npm @openai/codex", NPM + "@openai/codex"], ["@anthropic-ai/claude-code", NPM + "@anthropic-ai/claude-code"], ["@muse-code/sdk", NPM + "@muse-code/sdk"]],
  "c-tok-total": [OR_CHART],
  "c-tok-req": [OR_REQ],
  "c-tok-tpr": [OR_CHART, OR_REQ],
  "c-tok-co": [["OpenRouter author pages, e.g. Anthropic", "https://openrouter.ai/anthropic"], ["OpenAI", "https://openrouter.ai/openai"], ["Google", "https://openrouter.ai/google"], ["Meta", "https://openrouter.ai/meta-llama"], ["author list", "https://openrouter.ai/api/v1/models"]],
  "c-tok-rev": [["OpenRouter per-model activity (model page, Activity tab)", "https://openrouter.ai/models"], OR_MODELS],
  "c-tok-origin": [OR_CHART],
  "c-tok-top": [OR_CHART],
  "c-tok-apps": [OR_APPS],
  "c-rp-main": [RP_VOL],
  "c-rp-px": [RP_PX],
  "c-rp-cache": [RP_PX],
  "c-rp-top": [RP_VOL],
  "c-ra-main": [["Ramp AI Index page (data embedded in page)", RP_PAGE]],
  "c-ra-vendor": [["Ramp AI Index page (data embedded in page)", RP_PAGE]],
  "c-ra-split": [["Ramp AI Index page (data embedded in page)", RP_PAGE]],
  "c-ra-pepm": [["Ramp AI Index page (data embedded in page)", RP_PAGE]],
  "c-ra-cut": [["Ramp AI Index page (data embedded in page)", RP_PAGE]],
  "c-ra-state": [["Ramp AI Index page (data embedded in page)", RP_PAGE]],
  "c-dbx-mix": DBX, "c-dbx-prov": DBX, "c-dbx-ow": DBX, "c-dbx-spend": DBX, "c-dbx-tw": DBX, "c-dbx-code": DBX, "c-dbx-top": DBX,
  "c-mv-api": [...MENLO, ["2025 Mid-Year LLM Market Update", "https://menlovc.com/perspective/2025-mid-year-llm-market-update/"]],
  "c-mv-spend": MENLO, "c-mv-cat": MENLO, "c-mv-tier": MENLO, "c-mv-app": MENLO,
  "c-aei-auto": AEI, "c-aei-use": AEI, "c-aei-occ": AEI, "c-aei-collab": AEI, "c-aei-time": AEI, "c-aei-task": AEI, "c-aei-req": AEI,
  "c-te-idx": [RP_VOL, RP_PX, OR_CHART],
  "c-te-el": [RP_VOL, RP_PX, OR_CHART],
  "c-te-open": [OR_CHART, OR_MODELS],
  "c-te-m": [["SemiAnalysis InferenceX API", "https://inferencex.semianalysis.com/api/v1/availability"], OR_MODELS],
  "c-te-tpr": [OR_CHART, OR_REQ],
  "c-te-app": [OR_APPS],
  "c-pot-rec": [["Epoch benchmark_data.zip", "https://epoch.ai/data/benchmark_data.zip"], OR_MODELS],
  "c-pot-sota": [["Epoch benchmark_data.zip", "https://epoch.ai/data/benchmark_data.zip"], OR_MODELS],
  "c-pot-roll": [["Epoch benchmark_data.zip", "https://epoch.ai/data/benchmark_data.zip"], OR_MODELS],
  "c-pot-new": [OR_MODELS],
  "c-gpu-price": [["Silicon Data index hub (H100 / A100 / H200 / B200 / B300 / MI300X cards)", SD]],
  "c-gpu-token": [["Silicon Data index hub (LLM Token Expenditure + B200 cards)", SD]],
  "c-gpu-hyp": [["Silicon Data hub (hyperscaler cards)", SD]],
  "c-gpu-llm": [["Silicon Data index hub (LLM Token Expenditure, open / proprietary cards)", SD]],
  "c-gpu-ram": [["Silicon Data hub (GDDR6 card)", SD]],
  "c-cx-fh": [...SEC5, BEA_Q],
  "c-cx-own": [...SEC5, BEA_Q],
  "c-cx-q": [...SEC5, ["CoreWeave", SEC + "0001769628.json"]],
  "c-cx-rpo": SEC_FILINGS,
  "c-cx-cip": SEC_FILINGS,
  "c-rates": [["FRED DFII10", FRED + "DFII10"], ["THREEFYTP10", FRED + "THREEFYTP10"], ["DGS10", FRED + "DGS10"]],
  "c-hy": [["FRED BAMLH0A1HYBB", FRED + "BAMLH0A1HYBB"], ["BAMLH0A3HYC", FRED + "BAMLH0A3HYC"]],
  "c-hy-gap": [["FRED BAMLH0A1HYBB", FRED + "BAMLH0A1HYBB"], ["BAMLH0A3HYC", FRED + "BAMLH0A3HYC"]],
  "c-hy-ratio": [["FRED BAMLH0A1HYBB", FRED + "BAMLH0A1HYBB"], ["BAMLH0A3HYC", FRED + "BAMLH0A3HYC"]],
};

(function addSourceLinks() {
  for (const [id, links] of Object.entries(SOURCES)) {
    const el = document.getElementById(id);
    if (!el || el.nextElementSibling?.classList.contains("src-links")) continue;
    const p = document.createElement("p");
    p.className = "src-links small muted";
    p.appendChild(document.createTextNode("Raw source: "));
    links.forEach(([label, url], i) => {
      if (i) p.appendChild(document.createTextNode(" · "));
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = label + " ↗";
      p.appendChild(a);
    });
    el.after(p);
  }
})();
})();
