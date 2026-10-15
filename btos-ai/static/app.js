/* AI Adoption Monitor - front end. Plain SVG charts, no external libraries (runs offline). */
"use strict";
const $ = s => document.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const SLOT = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];
const ENTITY_COLOR = {OpenAI: "var(--s1)", Google: "var(--s2)", Meta: "var(--s3)", Anthropic: "var(--s4)"};
const api = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });

const T = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, s.length > 7 ? +s.slice(8, 10) : 15);
const fmtDate = ms => { const d = new Date(ms); return d.getUTCDate() + " " + MON[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
const fmtMonth = ms => { const d = new Date(ms); return MON[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
const pct = (v, d = 1) => v == null ? "–" : (v * 100).toFixed(d) + "%";
const pp = v => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "pp";
const usersM = v => v == null ? "–" : v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + "B" : (v >= 10 ? Math.round(v) : v) + "M";
const perDay = v => v == null ? "–" : v >= 1e6 ? (+(v / 1e6).toFixed(2)) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "K" : String(Math.round(v));

function el(tag, attrs, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function h(tag, attrs, parent, text) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) { if (k === "class") e.className = attrs[k]; else if (attrs[k] != null) e.setAttribute(k, attrs[k]); }
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || mag * 10;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/* ---------------------------------------------------------------- tooltip */
const TIP = $("#tip");
function tipShow(nodes, cx, cy) {
  TIP.replaceChildren(...nodes); TIP.hidden = false;
  const w = TIP.offsetWidth, hgt = TIP.offsetHeight, vw = innerWidth;
  let x = cx + 14, y = cy - hgt - 12;
  if (x + w > vw - 8) x = cx - w - 14;
  if (y < 8) y = cy + 16;
  TIP.style.left = Math.max(8, x) + "px"; TIP.style.top = y + "px";
}
function tipHide() { TIP.hidden = true; }
function tipTitle(t) { return h("div", {class: "tt"}, null, t); }
function tipRow(color, value, label, dash) {
  const r = h("div", {class: "row"});
  if (color) { const k = h("i", {class: "k" + (dash ? " dash" : "")}, r); k.style.borderTopColor = color; }
  h("b", null, r, value); h("span", null, r, label);
  return r;
}

/* ---------------------------------------------------------------- legend + table */
function legend(id, items) {
  const L = document.getElementById(id); if (!L) return;
  L.replaceChildren();
  if (items.length < 2) return;
  items.forEach(it => {
    const s = h("span", null, L);
    const i = h("i", {class: it.kind || (it.dash ? "dash" : "")}, s);
    if (it.kind === "dot") i.style.background = it.color; else i.style.borderTopColor = it.color;
    s.appendChild(document.createTextNode(it.name));
  });
}
function table(host, cols, rows) {
  const wrap = h("div", {class: "tbl-view"});
  const t = h("table", null, wrap), th = h("tr", null, h("thead", null, t)), tb = h("tbody", null, t);
  cols.forEach(c => h("th", {class: c.n ? "n" : ""}, th, c.label));
  rows.forEach(r => {
    const tr = h("tr", null, tb);
    cols.forEach(c => {
      const td = h("td", {class: c.n ? "n" : ""}, tr);
      const v = c.get ? c.get(r) : r[c.key];
      if (v instanceof Node) td.appendChild(v); else td.textContent = c.fmt ? c.fmt(v, r) : (v == null ? "–" : v);
    });
  });
  host.replaceChildren(wrap);
}

/* chart cards keep a draw function + table function so the Table button can toggle */
const VIEWS = {};
function view(id, draw, tbl) {
  VIEWS[id] = {draw, tbl, mode: VIEWS[id] ? VIEWS[id].mode : "chart"};
  render(id);
}
function render(id) {
  const v = VIEWS[id], host = document.getElementById(id);
  if (!v || !host) return;
  host.classList.remove("loading");
  if (v.mode === "table") v.tbl(host); else v.draw(host);
  const b = document.querySelector(`.tbl-toggle[data-for="${id}"]`);
  if (b) { b.textContent = v.mode === "table" ? "Chart" : "Table"; b.setAttribute("aria-pressed", v.mode === "table"); }
}
document.addEventListener("click", e => {
  const b = e.target.closest(".tbl-toggle"); if (!b) return;
  const v = VIEWS[b.dataset.for]; if (!v) return;
  v.mode = v.mode === "table" ? "chart" : "table"; render(b.dataset.for);
});
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => Object.keys(VIEWS).forEach(id => { if (VIEWS[id].mode === "chart" && document.getElementById(id).offsetParent) render(id); }), 150); });

/* ---------------------------------------------------------------- line chart
   series: [{name, color, dash, points:[{x, y, lo, hi, hollow, note}], endLabel}]
   opt: {height, xType:'time'|'num', yFmt, xFmt, log, yMin, yMax, mode:'cross'|'near', marks:[{x0,x1,label}|{x,label}], band:true} */
function lineChart(host, series, opt) {
  host.replaceChildren();
  const W = Math.max(300, host.clientWidth || 900), H = opt.height || 320;
  const narrow = W < 480;
  const M = {l: 50, r: opt.endLabels === false ? 16 : (narrow ? 16 : W < 700 ? 140 : 178), t: 14, b: 30};
  const svg = el("svg", {viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opt.aria || "line chart"}, host);
  const pts = series.flatMap(s => s.points.filter(p => p.y != null));
  if (!pts.length) { el("text", {x: W / 2, y: H / 2, "text-anchor": "middle"}, svg, "No data for this selection"); return; }
  let x0 = opt.x0 ?? Math.min(...pts.map(p => p.x)), x1 = opt.x1 ?? Math.max(...pts.map(p => p.x));
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const ys = pts.flatMap(p => [p.y, opt.band ? p.lo : null, opt.band ? p.hi : null]).filter(v => v != null);
  let y0 = opt.yMin ?? (opt.log ? Math.min(...ys) / 1.4 : 0), y1 = opt.yMax ?? Math.max(...ys) * 1.08;
  const log = !!opt.log;
  const X = v => M.l + (v - x0) / (x1 - x0) * (W - M.l - M.r);
  const Y = v => { const a = log ? Math.log10(Math.max(v, y0)) : v, lo = log ? Math.log10(y0) : y0, hi = log ? Math.log10(y1) : y1; return H - M.b - (a - lo) / (hi - lo) * (H - M.t - M.b); };
  // marks (bands / vertical lines) first
  (opt.marks || []).forEach(m => {
    if (m.x0 != null) {
      const a = X(Math.max(m.x0, x0)), b = X(Math.min(m.x1, x1));
      if (b > a) { el("rect", {x: a, y: M.t, width: b - a, height: H - M.t - M.b, fill: "var(--band)"}, svg); if (m.label && b - a > 40) el("text", {x: a + 4, y: M.t + 12}, svg, m.label); }
    } else if (m.x != null && m.x >= x0 && m.x <= x1) {
      el("line", {x1: X(m.x), x2: X(m.x), y1: M.t, y2: H - M.b, stroke: "var(--axis)", "stroke-dasharray": "3 3"}, svg);
      if (m.label) el("text", {x: X(m.x) + 4, y: M.t + 12}, svg, m.label);
    }
  });
  // y grid
  let ticks;
  if (log) { ticks = []; for (let e = Math.floor(Math.log10(y0)); e <= Math.ceil(Math.log10(y1)); e++) [1, 2, 5].forEach(m => { const v = m * 10 ** e; if (v >= y0 && v <= y1) ticks.push(v); }); if (ticks.length > 8) ticks = ticks.filter(v => /^1/.test(String(v))); }
  else ticks = niceTicks(y0, y1, H < 260 ? 4 : 5);
  ticks.forEach(v => {
    el("line", {x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), stroke: "var(--grid)"}, svg);
    el("text", {x: M.l - 8, y: Y(v) + 4, "text-anchor": "end"}, svg, opt.yFmt(v, true));
  });
  el("line", {x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, stroke: "var(--axis)"}, svg);
  // x ticks
  if (opt.xType === "num") {
    (opt.xTicks || niceTicks(x0, x1, 6).map(v => ({x: v, label: opt.xFmt ? opt.xFmt(v) : v}))).forEach(t => { if (t.x >= x0 && t.x <= x1) el("text", {x: X(t.x), y: H - M.b + 18, "text-anchor": "middle"}, svg, t.label); });
  } else {
    const months = (x1 - x0) / 2.63e9, every = months > 60 ? 12 : months > 30 ? 6 : months > 14 ? 3 : months > 7 ? 2 : 1;
    const step = narrow ? every * 2 : every;
    const d0 = new Date(x0);
    for (let k = 0; k < 400; k++) {
      const m = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k, 1); if (m > x1) break; if (m < x0) continue;
      const mo = new Date(m).getUTCMonth(); if (mo % step) continue;
      if (step >= 12 && (x1 - x0) / 3.156e10 > (narrow ? 8 : 16) && new Date(m).getUTCFullYear() % 5) continue;
      el("line", {x1: X(m), x2: X(m), y1: H - M.b, y2: H - M.b + 4, stroke: "var(--axis)"}, svg);
      el("text", {x: X(m), y: H - M.b + 18, "text-anchor": "middle"}, svg, step >= 12 || mo === 0 ? (step >= 12 ? String(new Date(m).getUTCFullYear()) : MON[mo] + " '" + String(new Date(m).getUTCFullYear()).slice(2)) : MON[mo]);
    }
  }
  // bands, lines, markers
  series.forEach(s => {
    if (opt.band) {
      let seg = [];
      const flush = () => { if (seg.length > 1) { const up = seg.map(p => `${X(p.x).toFixed(1)},${Y(p.hi).toFixed(1)}`), dn = seg.slice().reverse().map(p => `${X(p.x).toFixed(1)},${Y(p.lo).toFixed(1)}`); el("polygon", {points: up.concat(dn).join(" "), fill: s.color, "fill-opacity": 0.13}, svg); } seg = []; };
      s.points.forEach(p => { if (p.y != null && p.lo != null && p.hi != null) seg.push(p); else flush(); }); flush();
    }
    let d = "", pen = false;
    s.points.forEach(p => { if (p.y == null) { pen = false; return; } d += (pen ? "L" : "M") + X(p.x).toFixed(1) + "," + Y(p.y).toFixed(1); pen = true; });
    el("path", {d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": s.dash ? "5 4" : null}, svg);
    if (s.markers !== false) s.points.forEach(p => { if (p.y == null) return;
      el("circle", {cx: X(p.x), cy: Y(p.y), r: s.points.length > 40 ? 0 : s.points.length > 15 ? 2.5 : 3.5, fill: p.hollow ? "var(--surface)" : s.color, stroke: p.hollow ? s.color : "var(--surface)", "stroke-width": p.hollow ? 2 : 1.5}, svg); });
  });
  // end labels with simple collision relaxation
  if (!narrow && opt.endLabels !== false) {
    const labs = series.filter(s => s.endLabel !== false).map(s => { const last = [...s.points].reverse().find(p => p.y != null); return last ? {s, y: Y(last.y), x: X(last.x), px: last.x, v: last.y} : null; }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 15) labs[i].y = labs[i - 1].y + 15;
    labs.forEach(l => {
      el("line", {x1: W - M.r + 8, x2: W - M.r + 20, y1: l.y, y2: l.y, stroke: l.s.color, "stroke-width": 2, "stroke-dasharray": l.s.dash ? "3 2" : null}, svg);
      const t = el("text", {x: W - M.r + 25, y: l.y + 4, class: "lab"}, svg);
      el("tspan", {class: "lab-strong"}, t, opt.yFmt(l.v) + " ");
      // a series that stopped well before the others says when its last value is from
      const stale = opt.xType !== "num" && x1 - l.px > 90 * 864e5 ? ` (${MON[new Date(l.px).getUTCMonth()]} '${String(new Date(l.px).getUTCFullYear()).slice(2)})` : "";
      const nm = (l.s.short || l.s.name) + stale, room = Math.floor((M.r - 25 - 36) / 5.8);
      el("tspan", null, t, nm.length > room ? nm.slice(0, room - 1) + "…" : nm);
    });
  }
  // hover layer
  const hl = el("g", {visibility: "hidden"}, svg);
  const vline = el("line", {y1: M.t, y2: H - M.b, stroke: "var(--axis)"}, hl);
  const dots = [];
  const all = series.flatMap(s => s.points.filter(p => p.y != null).map(p => ({s, p, px: X(p.x), py: Y(p.y)})));
  const xs = [...new Set(all.map(a => a.p.x))].sort((a, b) => a - b);
  const hit = el("rect", {x: M.l, y: 0, width: W - M.l - M.r + 4, height: H, fill: "transparent"}, svg);
  function move(ev) {
    const r = svg.getBoundingClientRect(); if (!r.width) return;
    const sx = (ev.clientX - r.left) / r.width * W, sy = (ev.clientY - r.top) / r.height * H;
    dots.forEach(d => d.remove()); dots.length = 0;
    let rows = [], title, ax;
    if (opt.mode === "near") {
      let best = null, bd = 1e9; all.forEach(a => { const dd = Math.hypot(a.px - sx, (a.py - sy) * 0.6); if (dd < bd) { bd = dd; best = a; } });
      if (!best || bd > 60) { hl.setAttribute("visibility", "hidden"); tipHide(); return; }
      ax = best.px; title = opt.xFmt ? opt.xFmt(best.p.x) : fmtDate(best.p.x);
      rows = [best]; } else {
      let bx = xs[0]; xs.forEach(x => { if (Math.abs(X(x) - sx) < Math.abs(X(bx) - sx)) bx = x; });
      ax = X(bx); title = opt.xFmt ? opt.xFmt(bx) : (opt.title ? opt.title(bx) : fmtDate(bx));
      rows = all.filter(a => a.p.x === bx).sort((a, b) => b.p.y - a.p.y);
    }
    vline.setAttribute("x1", ax); vline.setAttribute("x2", ax); hl.setAttribute("visibility", "visible");
    rows.forEach(a => dots.push(el("circle", {cx: a.px, cy: a.py, r: 5, fill: a.s.color, stroke: "var(--surface)", "stroke-width": 2}, hl)));
    const nodes = [tipTitle(title)];
    rows.forEach(a => { nodes.push(tipRow(a.s.color, opt.yFmt(a.p.y), a.s.name + (a.p.lo != null && opt.band ? `  (95%: ${opt.yFmt(a.p.lo)}–${opt.yFmt(a.p.hi)})` : ""), a.s.dash)); if (a.p.note) nodes.push(h("div", {class: "extra"}, null, a.p.note)); });
    tipShow(nodes, ev.clientX, ev.clientY);
  }
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerleave", () => { hl.setAttribute("visibility", "hidden"); dots.forEach(d => d.remove()); tipHide(); });
}

/* ---------------------------------------------------------------- horizontal bars
   rows: [{key, label, value, lo, hi, tick, color, note}]  opt: {fmt, onClick, tickLabel, max} */
function hbar(host, rows, opt) {
  host.replaceChildren();
  const W = Math.max(300, host.clientWidth || 900), narrow = W < 600, rowH = 24;
  const labW = Math.min(narrow ? 140 : 330, W * 0.42);
  const M = {l: labW + 12, r: 70, t: 22, b: 8}, H = M.t + M.b + rows.length * rowH;
  const svg = el("svg", {viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opt.aria || "bar chart"}, host);
  const vals = rows.flatMap(r => [r.value, r.hi, r.tick]).filter(v => v != null);
  const max = opt.max ?? Math.max(...vals, 0.01) * 1.05;
  const X = v => M.l + v / max * (W - M.l - M.r);
  niceTicks(0, max, narrow ? 3 : 5).forEach(v => { el("line", {x1: X(v), x2: X(v), y1: M.t - 4, y2: H - M.b, stroke: "var(--grid)"}, svg); el("text", {x: X(v), y: 12, "text-anchor": "middle"}, svg, opt.fmt(v, true)); });
  rows.forEach((r, i) => {
    const y = M.t + i * rowH, cy = y + rowH / 2;
    const name = r.label.length > (narrow ? 20 : 48) ? r.label.slice(0, narrow ? 19 : 47) + "…" : r.label;
    el("text", {x: M.l - 8, y: cy + 4, "text-anchor": "end", class: r.bold ? "lab-strong" : "rowlab"}, svg, name);
    const g = el("g", null, svg);
    if (r.value != null) {
      const w = Math.max(X(r.value) - M.l, 1);
      el("path", {class: "bar", d: `M${M.l},${y + 4} h${Math.max(w - 3, 0)} a3,3 0 0 1 3,3 v${rowH - 14} a3,3 0 0 1 -3,3 h${-Math.max(w - 3, 0)} z`, fill: r.color || "var(--s1)"}, g);
      if (r.lo != null && r.hi != null) { el("line", {x1: X(r.lo), x2: X(r.hi), y1: cy, y2: cy, stroke: "var(--ink-2)", "stroke-width": 1.2}, g); [r.lo, r.hi].forEach(v => el("line", {x1: X(v), x2: X(v), y1: cy - 4, y2: cy + 4, stroke: "var(--ink-2)", "stroke-width": 1.2}, g)); }
      if (r.tick != null) el("line", {x1: X(r.tick), x2: X(r.tick), y1: y + 2, y2: y + rowH - 2, stroke: "var(--ink)", "stroke-width": 2}, g);
      el("text", {x: Math.max(X(r.hi ?? r.value), X(r.tick ?? 0)) + 6, y: cy + 4, class: "val"}, g, opt.fmt(r.value));
    } else el("text", {x: M.l + 4, y: cy + 4, class: "val"}, g, "suppressed");
    const hit = el("rect", {x: 0, y, width: W, height: rowH, fill: "transparent", class: opt.onClick ? "hitbar" : ""}, svg);
    hit.addEventListener("pointermove", ev => {
      g.querySelector(".bar")?.classList.add("hover");
      const nodes = [tipTitle(r.label), tipRow(r.color || "var(--s1)", opt.fmt(r.value), opt.valueLabel || "")];
      if (r.lo != null) nodes.push(h("div", {class: "extra"}, null, `95% interval ${opt.fmt(r.lo)} – ${opt.fmt(r.hi)}`));
      if (r.tick != null) nodes.push(h("div", {class: "extra"}, null, `${opt.tickLabel || "Tick"}: ${opt.fmt(r.tick)}`));
      if (r.note) nodes.push(h("div", {class: "extra"}, null, r.note));
      tipShow(nodes, ev.clientX, ev.clientY);
    });
    hit.addEventListener("pointerleave", () => { g.querySelector(".bar")?.classList.remove("hover"); tipHide(); });
    if (opt.onClick) hit.addEventListener("click", () => opt.onClick(r));
  });
}

/* ---------------------------------------------------------------- scatter */
function scatter(host, ptsIn, opt) {
  host.replaceChildren();
  const pts = ptsIn.filter(p => p.x != null && p.y != null);
  const W = Math.max(300, host.clientWidth || 900), H = Math.min(520, Math.max(340, W * 0.55)), narrow = W < 600;
  const M = {l: 54, r: 20, t: 14, b: 44};
  const svg = el("svg", {viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opt.aria}, host);
  const xmax = Math.max(...pts.map(p => p.x)) * 1.1, ymax = Math.min(1, Math.max(...pts.map(p => p.y)) * 1.08);
  const ymin = Math.max(0, Math.min(...pts.map(p => p.y)) - 0.08);
  const X = v => M.l + v / xmax * (W - M.l - M.r), Y = v => H - M.b - (v - ymin) / (ymax - ymin) * (H - M.t - M.b);
  niceTicks(ymin, ymax, 5).forEach(v => { el("line", {x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), stroke: "var(--grid)"}, svg); el("text", {x: M.l - 8, y: Y(v) + 4, "text-anchor": "end"}, svg, pct(v, 0)); });
  niceTicks(0, xmax, 6).forEach(v => { el("line", {x1: X(v), x2: X(v), y1: M.t, y2: H - M.b, stroke: "var(--grid)"}, svg); el("text", {x: X(v), y: H - M.b + 16, "text-anchor": "middle"}, svg, pct(v, 0)); });
  el("text", {x: (M.l + W - M.r) / 2, y: H - 6, "text-anchor": "middle", class: "lab"}, svg, opt.xLabel);
  el("text", {x: 14, y: (M.t + H - M.b) / 2, "text-anchor": "middle", class: "lab", transform: `rotate(-90 14 ${(M.t + H - M.b) / 2})`}, svg, opt.yLabel);
  const placed = [];
  pts.forEach(p => {
    el("circle", {cx: X(p.x), cy: Y(p.y), r: 6, fill: "var(--s1)", stroke: "var(--surface)", "stroke-width": 2}, svg);
    if (narrow) return;
    const lx = X(p.x) + 9, ly = Y(p.y) + 4, w = p.short.length * 6.3;
    if (placed.some(q => Math.abs(q.y - ly) < 13 && lx < q.x + q.w && lx + w > q.x)) return;
    placed.push({x: lx, y: ly, w}); el("text", {x: lx, y: ly, class: "lab"}, svg, p.short);
  });
  pts.forEach(p => {
    const hit = el("circle", {cx: X(p.x), cy: Y(p.y), r: 14, fill: "transparent"}, svg);
    hit.addEventListener("pointermove", ev => tipShow([tipTitle(p.label), tipRow("var(--s1)", pct(p.x), opt.xLabel), tipRow(null, pct(p.y), opt.yLabel)].concat(p.extra || []), ev.clientX, ev.clientY));
    hit.addEventListener("pointerleave", tipHide);
  });
}

function spark(values, color) {
  const v = values.filter(x => x != null); if (v.length < 2) return null;
  const W = 240, H = 34, lo = Math.min(...v), hi = Math.max(...v);
  const svg = el("svg", {viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true"});
  const d = v.map((y, i) => (i ? "L" : "M") + (i / (v.length - 1) * (W - 6) + 3).toFixed(1) + "," + (H - 4 - (y - lo) / ((hi - lo) || 1) * (H - 8)).toFixed(1)).join("");
  el("path", {d, fill: "none", stroke: color, "stroke-width": 2, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round"}, svg);
  return svg;
}

/* ================================================================ state + tabs */
let META = null;
const loaded = {};
function showTab(name) {
  if (!document.getElementById("tab-" + name)) name = "overview";
  document.querySelectorAll(".tab").forEach(s => s.hidden = s.id !== "tab-" + name);
  document.querySelectorAll(".tabs a").forEach(a => a.setAttribute("aria-selected", a.dataset.tab === name));
  const cur = document.querySelector(`.tabs a[data-tab="${name}"]`); if (cur) cur.scrollIntoView({block: "nearest", inline: "nearest"});
  if (!loaded[name]) { loaded[name] = true; LOADERS[name](); }
  else Object.keys(VIEWS).forEach(id => { const n = document.getElementById(id); if (n && n.closest(".tab").id === "tab-" + name && VIEWS[id].mode === "chart") render(id); });
}
addEventListener("hashchange", () => showTab(location.hash.slice(1)));
$("#themeBtn").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("aam-theme", next); } catch (e) {}
});

/* ================================================================ overview */
async function loadOverview() {
  const d = await api("/api/overview");
  const host = $("#tiles"); host.replaceChildren();
  const link = {btos7: "#firms", btos24: "#firms", ChatGPT: "#assistants", "Gemini app": "#assistants", codex: "#assistants", openrouter: "#tokens", ramp: "#ramp", silicon: "#gpu", capex: "#capex", hy_BAMLH0A1HYBB: "#credit", hy_BAMLH0A3HYC: "#credit", hy_DFII10: "#credit", hy_THREEFYTP10: "#credit", arr_Anthropic: "#arr", arr_OpenAI: "#arr"};
  d.tiles.forEach(t => {
    const a = h("a", {class: "tile", href: link[t.id] || "#workers"}, host);
    h("div", {class: "t"}, a, t.title);
    h("div", {class: "v"}, a, t.unit === "users_m" ? usersM(t.value) : t.unit === "tokens" ? tok(t.value) : t.unit === "usd_hr" ? usd(t.value) + "/hr" : t.unit === "usd" ? bn(t.value) : t.unit === "oas" ? t.value.toFixed(2) + "%" : pct(t.value));
    if (t.prev != null && t.unit === "oas") {
      const b = Math.round((t.value - t.prev) * 100), dd = h("div", {class: "d"}, a);
      /* wider spread = more credit stress, so a rise is shown in the "down" colour */
      h("span", {class: b > 0 ? "down" : b < 0 ? "up" : ""}, dd, b ? (b > 0 ? "▲ +" : "▼ −") + Math.abs(b) + "bp" : "● unchanged");
      dd.appendChild(document.createTextNode(" " + t.delta_label));
    } else if (t.prev != null && t.unit === "usd") {
      const dd = h("div", {class: "d"}, a); h("span", {class: "up"}, dd, `▲ ${(t.value / t.prev).toFixed(1)}×`); dd.appendChild(document.createTextNode(" " + t.delta_label));
    } else if (t.prev != null && (t.unit === "tokens" || t.unit === "usd_hr")) {
      const g = t.value / t.prev - 1, dd = h("div", {class: "d"}, a);
      h("span", {class: g >= 0 ? "up" : "down"}, dd, (g >= 0 ? "▲ " : "▼ ") + (Math.abs(g) * 100).toFixed(1) + "%");
      dd.appendChild(document.createTextNode(" " + t.delta_label));
    } else if (t.prev != null) {
      const dlt = (t.value - t.prev) * 100, dd = h("div", {class: "d"}, a), flat = Math.abs(dlt) < 0.05;
      h("span", {class: flat ? "" : dlt > 0 ? "up" : "down"}, dd, flat ? "● unchanged" : (dlt > 0 ? "▲ " : "▼ ") + pp(dlt));
      dd.appendChild(document.createTextNode(" " + t.delta_label));
    }
    h("div", {class: "s"}, a, t.date + " · " + t.source);
    const sp = spark(t.spark, "var(--s1)"); if (sp) a.appendChild(sp);
  });
}

/* ================================================================ firms */
const FIRM = {sel: [{key: "National:US", slot: 0}, {key: "Sector:54", slot: 1}, {key: "Sector:44", slot: 2}]};
const QLABEL = {7: "used AI in the last 2 weeks", 24: "expect to use AI in the next 6 months"};
function entityLabel(key) {
  const [lv, code] = key.split(":");
  const e = (META.entities[lv] || []).find(x => x.code === code);
  const short = {National: "", Sector: "", Subsector: "", "Employment size": "", "Sector x Employment size": ""}[lv];
  return e ? e.label : short + code;
}
function fillLevelSelect(sel, withNational) {
  sel.replaceChildren();
  META.levels.filter(l => withNational || l !== "National").forEach(l => h("option", {value: l}, sel, l));
}
function chips() {
  const host = $("#chips"); host.replaceChildren();
  FIRM.sel.forEach(s => {
    const c = h("span", {class: "chip"}, host);
    const k = h("i", {class: "key"}, c); k.style.borderTopColor = SLOT[s.slot];
    c.appendChild(document.createTextNode(entityLabel(s.key)));
    const b = h("button", {type: "button", "aria-label": "Remove " + entityLabel(s.key), title: "Remove"}, c, "×");
    b.addEventListener("click", () => { FIRM.sel = FIRM.sel.filter(x => x !== s); drawFirmSeries(); drawFirmRank(); });
  });
}
function addEntity(key) {
  if (FIRM.sel.some(s => s.key === key)) return;
  if (FIRM.sel.length >= 3) FIRM.sel.shift();
  const used = FIRM.sel.map(s => s.slot), slot = [0, 1, 2].find(i => !used.includes(i));
  FIRM.sel.push({key, slot});
  drawFirmSeries(); drawFirmRank();
}
async function drawFirmSeries() {
  chips();
  const q = $("#f-q").value, smooth = $("#f-smooth").value === "ma", band = $("#f-se").checked && !smooth;
  $("#fs-title").textContent = "Share of firms that " + QLABEL[q];
  $("#fs-sub").textContent = (smooth ? "4-period moving average within each wording. " : "Each fortnight. ") + "Dashed = old wording (goods or services), solid = new wording (any business function).";
  const host = $("#c-firm-series"); host.classList.add("loading");
  const d = await api(`/api/btos/series?q=${q}&keys=${encodeURIComponent(FIRM.sel.map(s => s.key).join(","))}`);
  const series = [], lg = [];
  d.series.forEach(it => {
    const slot = FIRM.sel.find(s => s.key === it.key).slot, color = SLOT[slot];
    const mk = arr => arr.map(p => { const y = smooth ? p.ma : p.y; return {x: T(p.date), y, lo: !smooth && p.se != null && y != null ? Math.max(0, y - 1.96 * p.se) : null, hi: !smooth && p.se != null && y != null ? y + 1.96 * p.se : null}; });
    series.push({name: it.label + " (old wording)", short: it.label, color, dash: true, points: mk(it.v1), endLabel: false});
    series.push({name: it.label, short: it.label.length > 18 ? it.label.slice(0, 17) + "…" : it.label, color, points: mk(it.v2)});
    lg.push({name: it.label, color});
  });
  // the chips above the chart are the legend (colour key + name)
  const marks = [{x0: T(d.v1_end_date), x1: T(d.v2_start_date), label: "no data"}, {x: T(d.v2_start_date), label: "question reworded"}];
  view("c-firm-series",
    hst => lineChart(hst, series, {height: 340, yFmt: v => pct(v, v < 0.1 ? 1 : 0), band, marks, aria: "Share of firms using AI over time", title: x => "Fortnight ending " + fmtDate(x)}),
    hst => { const rows = []; d.series.forEach(it => ["v1", "v2"].forEach(v => it[v].forEach(p => rows.push({e: it.label, v: v === "v1" ? "old" : "new", ...p})))); rows.sort((a, b) => b.smpdt - a.smpdt);
      table(hst, [{label: "Series", key: "e"}, {label: "Wording", key: "v"}, {label: "Period", key: "smpdt"}, {label: "Ref. end", key: "date"}, {label: "Share", key: "y", n: 1, fmt: v => pct(v)}, {label: "SE", key: "se", n: 1, fmt: v => pct(v, 2)}, {label: "MA4", key: "ma", n: 1, fmt: v => pct(v)}], rows); });
}
async function drawFirmRank() {
  const lv = $("#r-level").value, q = $("#f-q").value, sec = $("#r-sector").value;
  $("#r-sector-wrap").hidden = !(lv === "Subsector" || lv === "Sector x Employment size");
  const host = $("#c-firm-rank"); host.classList.add("loading");
  const d = await api(`/api/btos/rank?level=${encodeURIComponent(lv)}&q=${q}&sector=${$("#r-sector-wrap").hidden ? "" : sec}`);
  $("#fr-title").textContent = `${lv}: share of firms that ${QLABEL[q]}`;
  $("#fr-sub").textContent = `Fortnight ending ${fmtDate(T(d.last_date))} (period ${d.last}). ${d.rows.length} rows.`;
  const sort = $("#r-sort").value;
  const rows = d.rows.map(r => {
    const key = lv + ":" + r.code, s = FIRM.sel.find(x => x.key === key);
    return {key, label: (lv === "Subsector" || lv === "Sector" ? r.code + " " : "") + r.label, value: r.y, lo: r.y != null && r.se != null ? Math.max(0, r.y - 1.96 * r.se) : null, hi: r.y != null && r.se != null ? r.y + 1.96 * r.se : null, tick: r.prev, color: s ? SLOT[s.slot] : "var(--neutral-bar)", bold: !!s,
      chg: r.y != null && r.prev != null ? r.y - r.prev : null, note: `Prior fortnight ${pct(r.prev)} · last 4 avg ${pct(r.ma4)} · old wording (last) ${pct(r.v1)}`, raw: r};
  });
  rows.sort((a, b) => sort === "label" ? a.label.localeCompare(b.label) : sort === "chg" ? (b.chg ?? -9) - (a.chg ?? -9) : (b.value ?? -1) - (a.value ?? -1));
  view("c-firm-rank",
    hst => hbar(hst, rows, {fmt: v => pct(v, v != null && v < 0.1 ? 1 : 0), tickLabel: "Prior fortnight", valueLabel: "latest fortnight", onClick: r => addEntity(r.key), aria: "Ranking"}),
    hst => table(hst, [{label: "Code", get: r => r.raw.code}, {label: "Name", get: r => r.raw.label}, {label: "Latest", n: 1, get: r => pct(r.value)}, {label: "SE", n: 1, get: r => pct(r.raw.se, 2)}, {label: "Prior", n: 1, get: r => pct(r.raw.prev)}, {label: "Δ", n: 1, get: r => pp(r.chg == null ? null : r.chg * 100)}, {label: "Last 4 avg", n: 1, get: r => pct(r.raw.ma4)}, {label: "Old wording (last)", n: 1, get: r => pct(r.raw.v1)}], rows));
}
function loadFirms() {
  fillLevelSelect($("#pick-level"), true); fillLevelSelect($("#r-level"), false);
  $("#pick-level").value = "Sector"; $("#r-level").value = "Sector";
  const rs = $("#r-sector"); Object.entries(META.sectors).forEach(([c, n]) => h("option", {value: c}, rs, c + " " + n)); rs.value = "54";
  const fillList = () => { const dl = $("#pick-list"); dl.replaceChildren(); (META.entities[$("#pick-level").value] || []).forEach(e => h("option", {value: e.code + " — " + e.label}, dl)); $("#pick-entity").value = ""; };
  fillList();
  $("#pick-level").addEventListener("change", fillList);
  const add = () => { const v = $("#pick-entity").value.trim(); if (!v) return; const lv = $("#pick-level").value;
    const code = v.split(" — ")[0].trim(); const e = (META.entities[lv] || []).find(x => x.code === code || x.label.toLowerCase() === v.toLowerCase());
    if (e) { addEntity(lv + ":" + e.code); $("#pick-entity").value = ""; } };
  $("#pick-add").addEventListener("click", add);
  $("#pick-entity").addEventListener("keydown", e => { if (e.key === "Enter") add(); });
  ["#f-q", "#f-smooth", "#f-se"].forEach(s => $(s).addEventListener("change", () => { drawFirmSeries(); if (s === "#f-q") drawFirmRank(); }));
  ["#r-level", "#r-sector", "#r-sort"].forEach(s => $(s).addEventListener("change", drawFirmRank));
  drawFirmSeries(); drawFirmRank();
}

/* ================================================================ workers */
let WK = null;
const wave = r => T(r.wave);
function drawWorkers() {
  const freq = $("#w-freq").value, nat = WK.rows.filter(r => r.dimension === "National");
  const cats = [["All adults - Any", "All adults, any use", "var(--s1)", "Any use"], ["Employed - For Work", "Workers, for their job", "var(--s2)", "At work"], ["All adults - Non-Work", "All adults, outside work", "var(--s3)", "Outside work"]];
  const S = cats.map(([c, n, col, sh]) => ({name: n, short: sh, color: col, points: nat.filter(r => r.category === c && r.measure === freq).sort((a, b) => wave(a) - wave(b)).map(r => ({x: wave(r), y: r.mean, lo: r.mean - 1.96 * r.se, hi: r.mean + 1.96 * r.se}))}));
  legend("lg-w-nat", S.map(s => ({name: s.name, color: s.color})));
  view("c-w-nat", hst => lineChart(hst, S, {height: 290, yFmt: v => pct(v, 0), band: true, title: x => fmtMonth(x) + " survey", yMin: 0}),
    hst => table(hst, [{label: "Survey", key: "w"}].concat(S.map(s => ({label: s.name, n: 1, key: s.name, fmt: v => pct(v)}))), S[0].points.map((p, i) => Object.assign({w: fmtMonth(p.x)}, ...S.map(s => ({[s.name]: s.points[i]?.y}))))));
  const hrs = [["Share of work hours using genAI", "Work hours spent using genAI", "var(--s1)", "Using genAI"], ["Time saved by genAI (% of work hours)", "Time saved (share of work hours)", "var(--s2)", "Time saved"]];
  const S2 = hrs.map(([m, n, col, sh]) => ({name: n, short: sh, color: col, points: nat.filter(r => r.measure === m).sort((a, b) => wave(a) - wave(b)).map(r => ({x: wave(r), y: r.mean, lo: r.mean - 1.96 * r.se, hi: r.mean + 1.96 * r.se}))}));
  legend("lg-w-hours", S2.map(s => ({name: s.name, color: s.color})));
  view("c-w-hours", hst => lineChart(hst, S2, {height: 290, yFmt: v => pct(v, 1), band: true, yMin: 0, title: x => fmtMonth(x) + " survey"}),
    hst => table(hst, [{label: "Survey", key: "w"}].concat(S2.map(s => ({label: s.name, n: 1, key: s.name, fmt: v => pct(v)}))), S2[0].points.map((p, i) => Object.assign({w: fmtMonth(p.x)}, ...S2.map(s => ({[s.name]: s.points[i]?.y}))))));
  drawWorkerRank(); drawPC();
}
function drawWorkerRank() {
  const dim = $("#wr-dim").value, meas = $("#wr-meas").value, w = $("#wr-wave").value;
  const rows = WK.rows.filter(r => r.dimension === dim && r.measure === meas);
  const cur = rows.filter(r => r.wave === w);
  const yago = new Date(T(w)); yago.setUTCFullYear(yago.getUTCFullYear() - 1);
  const ya = Object.fromEntries(rows.filter(r => Math.abs(T(r.wave) - yago) < 20 * 864e5).map(r => [r.category, r.mean]));
  $("#wr-title").textContent = `${meas} — by ${dim.toLowerCase()}`;
  $("#wr-sub").textContent = `${fmtMonth(T(w))} survey, ${cur.length} groups`;
  const data = cur.map(r => ({key: r.category, label: (r.naics ? r.naics + " " : "") + r.category.replace(/ Occupations?$/i, ""), value: r.mean, lo: Math.max(0, r.mean - 1.96 * r.se), hi: r.mean + 1.96 * r.se, tick: ya[r.category] ?? null, color: "var(--s1)", raw: r})).sort((a, b) => b.value - a.value);
  view("c-w-rank", hst => hbar(hst, data, {fmt: v => pct(v, meas.startsWith("Share of workers") ? 0 : 1), tickLabel: "A year earlier", valueLabel: fmtMonth(T(w))}),
    hst => table(hst, [{label: dim, get: r => r.label}, {label: fmtMonth(T(w)), n: 1, get: r => pct(r.value)}, {label: "SE", n: 1, get: r => pct(r.raw.se, 2)}, {label: "Year earlier", n: 1, get: r => pct(r.tick)}, {label: "Δ", n: 1, get: r => r.tick == null ? "–" : pp((r.value - r.tick) * 100)}], data));
}
function drawPC() {
  const who = $("#pc-who").value, pc = WK.pc;
  const sets = {all: [["GenAI - all adults (RPS)", "GenAI"], ["PC - all adults (CPS)", "Personal computer"], ["Internet - all adults (CPS)", "Internet"]],
    work: [["GenAI - at work (RPS)", "GenAI at work"], ["PC - at work (CPS)", "PC at work"]], home: [["GenAI - at home (RPS)", "GenAI at home"], ["PC - at home (CPS)", "PC at home"]]}[who];
  const S = sets.map(([k, n], i) => ({name: n, short: n.replace("Personal computer", "PC"), color: SLOT[i], points: pc.filter(r => r[k] != null).map(r => ({x: r["Years since mass-market launch"], y: r[k]}))}));
  legend("lg-w-pc", S.map(s => ({name: s.name, color: s.color})));
  view("c-w-pc", hst => lineChart(hst, S, {height: 280, xType: "num", xFmt: v => "year " + v, yFmt: v => pct(v, 0), yMin: 0, mode: "cross"}),
    hst => table(hst, [{label: "Years since launch", key: "Years since mass-market launch"}].concat(sets.map(([k, n]) => ({label: n, key: k, n: 1, fmt: v => pct(v)}))), pc));
}
async function loadWorkers() {
  WK = await api("/api/workers");
  const waves = [...new Set(WK.rows.filter(r => r.dimension === "Industry").map(r => r.wave))].sort().reverse();
  const ws = $("#wr-wave"); waves.forEach(w => h("option", {value: w}, ws, fmtMonth(T(w))));
  $("#w-freq").addEventListener("change", drawWorkers);
  ["#wr-dim", "#wr-meas", "#wr-wave"].forEach(s => $(s).addEventListener("change", drawWorkerRank));
  $("#pc-who").addEventListener("change", drawPC);
  drawWorkers();
}

/* ================================================================ compare */
async function loadCompare() {
  const d = await api("/api/firmworker");
  $("#cmp-sub").textContent = `BTOS fortnight ending ${fmtDate(T(d.btos_date))} vs GenAI Adoption Tracker ${fmtMonth(T(d.wave))} survey · Spearman rank correlation across sectors: ${d.rho == null ? "–" : d.rho.toFixed(2)}`;
  const SHORT = {"11": "Agriculture", "21": "Mining", "22": "Utilities", "23": "Construction", "31": "Manufacturing", "42": "Wholesale", "44": "Retail", "48": "Transport & warehousing",
    "51": "Information", "52": "Finance", "53": "Real estate", "54": "Professional services", "55": "Management of cos.", "56": "Admin & support", "61": "Education", "62": "Health care",
    "71": "Arts & recreation", "72": "Accommodation & food", "81": "Other services"};
  const pts = d.rows.map(r => ({x: r.firm, y: r.worker, label: r.naics + " " + r.sector, short: SHORT[r.naics] || r.sector.slice(0, 20),
    extra: [h("div", {class: "extra"}, null, `Firms expecting AI in 6m ${pct(r.firm_exp)} · work hours with genAI ${pct(r.hours)} · time saved ${pct(r.saved)}`)]}));
  view("c-cmp", hst => scatter(hst, pts, {xLabel: "Firms using AI (BTOS)", yLabel: "Workers using genAI at work (RPS)", aria: "Firms vs workers scatter"}),
    hst => table(hst, [{label: "NAICS", key: "naics"}, {label: "Sector", key: "sector"}, {label: "Firms using AI", key: "firm", n: 1, fmt: v => pct(v)}, {label: "Firms expecting (6m)", key: "firm_exp", n: 1, fmt: v => pct(v)}, {label: "Workers using genAI at work", key: "worker", n: 1, fmt: v => pct(v)}, {label: "Work hours with genAI", key: "hours", n: 1, fmt: v => pct(v)}, {label: "Time saved", key: "saved", n: 1, fmt: v => pct(v)}, {label: "Worker ÷ firm", n: 1, get: r => r.firm && r.worker ? (r.worker / r.firm).toFixed(2) : "–"}], [...d.rows].sort((a, b) => (b.firm ?? -1) - (a.firm ?? -1))));
}

/* ================================================================ fed */
function fedTable(id, t, fmts) {
  table(document.getElementById(id), t.columns.map(c => ({label: c, key: c, n: !!fmts[c] || typeof t.rows[0]?.[c] === "number", fmt: fmts[c] || (v => typeof v === "number" ? pct(v) : (v ?? "–"))})), t.rows);
}
async function loadFed() {
  const d = await api("/api/fed");
  $("#fed-link").href = d.meta.url;
  fedTable("fed-t1", d.t1, {});
  const chk = d.check;
  table($("#fed-check"), [{label: "Metric", key: "Metric"}, {label: "This app", key: "This workbook", n: 1, fmt: v => pct(v)}, {label: "Fed note", key: "Fed note", n: 1, fmt: v => pct(v)}, {label: "Diff", key: "Diff (pp)", n: 1, fmt: v => pp(v)},
    {label: "Match", get: r => { const ok = r["Diff (pp)"] != null && Math.abs(r["Diff (pp)"]) <= 1; return h("span", {class: ok ? "ok" : "bad"}, null, ok ? "✓ within 1pp" : "✗ off"); }}], chk.rows);
  if (d.t2) fedTable("fed-t2", d.t2, {"YoY chg (pp)": v => pp(v), "YoY % chg": v => v == null ? "–" : (v * 100).toFixed(0) + "%"});
  fedTable("fed-t3", d.t3, {});
  fedTable("fed-t4", d.t4, {"RPS YoY (pp)": v => pp(v)});
  if (d.sbu) {
    const rows = d.sbu.rows, techs = [...new Set(rows.map(r => r.technology))], cohorts = [...new Set(rows.map(r => r.cohort))];
    const piv = cohorts.map(c => Object.assign({cohort: c, n: rows.find(r => r.cohort === c).n}, ...rows.filter(r => r.cohort === c).map(r => ({[r.technology]: r.currently_using}))));
    table($("#fed-sbu"), [{label: "Cohort", key: "cohort"}, {label: "N", key: "n", n: 1}].concat(techs.map(t => ({label: t, key: t, n: 1, fmt: v => pct(v, 0)}))), piv);
  }
  const ts = d.ts.rows;
  const mk = (col, ver) => ts.filter(r => r.version === ver).map(r => ({x: T(r["ref end"]), y: r[col]}));
  const fig = (id, cols, names, h0) => {
    const S = []; cols.forEach((c, i) => { S.push({name: names[i] + " (old)", short: names[i], color: SLOT[i], dash: true, points: mk(c, "v1 old"), endLabel: false, markers: false}); S.push({name: names[i], short: names[i], color: SLOT[i], points: mk(c, "v2 new"), markers: false}); });
    legend("lg-" + id, cols.map((c, i) => ({name: names[i], color: SLOT[i]})));
    view("c-" + id, hst => lineChart(hst, S, {height: h0, yFmt: v => pct(v, 0), yMin: 0, title: x => "MA4 to " + fmtDate(x)}),
      hst => table(hst, [{label: "Wording", key: "version"}, {label: "Ref. end", key: "ref end"}].concat(cols.map((c, i) => ({label: names[i], key: c, n: 1, fmt: v => pct(v)}))), [...ts].reverse()));
  };
  fig("fed2", ["US: AI use", "US: expected 6m"], ["Using AI", "Expect to use, 6m"], 300);
  fig("fed3", ["Size 1-49", "Size 50-99", "Size 100-249", "Size 250+"], ["1–49", "50–99", "100–249", "250+"], 280);
  fig("fed4", ["Professional services", "Finance and insurance", "Health care and social assistance", "Manufacturing", "Retail trade"], ["Professional", "Finance", "Health care", "Manufacturing", "Retail"], 280);
}

/* ================================================================ assistants */
let AS = null;
function drawAssist() {
  const log = $("#a-scale").value === "log";
  const prods = [["ChatGPT", "ChatGPT (weekly)", ENTITY_COLOR.OpenAI], ["Gemini app", "Gemini app (monthly)", ENTITY_COLOR.Google], ["Meta AI", "Meta AI (monthly)", ENTITY_COLOR.Meta]];
  // Anthropic has never published a Claude user count; the series appears once one is added from the review queue
  const cl = AS.consumer.filter(r => r.product === "Claude");
  if (cl.length) prods.push(["Claude", `Claude (${cl[cl.length - 1].metric.toLowerCase()})`, ENTITY_COLOR.Anthropic]);
  const S = prods.map(([p, n, col]) => ({name: n, short: p, color: col, points: AS.consumer.filter(r => r.product === p).sort((a, b) => a.date.localeCompare(b.date)).map(r => ({x: T(r.date), y: r.users_m, hollow: r.flag === "court", note: r.what_was_said + " — " + r.who}))}));
  legend("lg-a-cons", S.map(s => ({name: s.name, color: s.color})));
  view("c-a-cons", hst => lineChart(hst, S, {height: 340, yFmt: usersM, log, yMin: log ? 50 : 0, mode: "near"}),
    hst => table(hst, [{label: "Date", key: "date"}, {label: "Product", key: "product"}, {label: "Users", key: "users_m", n: 1, fmt: usersM}, {label: "Metric", key: "metric"}, {label: "What was said", key: "what_was_said"}], [...AS.consumer].reverse()));
  const cx = AS.codex.sort((a, b) => a.date.localeCompare(b.date));
  const defs = [...new Set(cx.map(r => r.series))];
  const S2 = defs.map((d, i) => ({name: d.replace("Codex WAU (OpenAI-stated)", "Weekly users, Codex only").replace("Milestone posts (active users)", "Milestone posts, Codex + ChatGPT Work"), short: i ? "Milestones" : "Weekly", color: ENTITY_COLOR.OpenAI, dash: i > 0, points: cx.filter(r => r.series === d).map(r => ({x: T(r.date), y: r.users_m, note: r.metric_as_stated + " — " + r.who}))}));
  legend("lg-a-codex", S2.map(s => ({name: s.name, color: s.color, dash: s.dash})));
  view("c-a-codex", hst => lineChart(hst, S2, {height: 280, yFmt: v => usersM(v), mode: "near"}),
    hst => table(hst, [{label: "Date", key: "date"}, {label: "Users", key: "users_m", n: 1, fmt: usersM}, {label: "Scope", key: "scope"}, {label: "As stated", key: "metric_as_stated"}, {label: "Who", key: "who"}], [...cx].reverse()));
  const nlog = $("#npm-scale").value === "log", notes = Object.fromEntries(AS.npm_notes.map(n => [n.month, n.note]));
  const S3 = [["codex_installs_per_day_corrected", "Codex CLI", ENTITY_COLOR.OpenAI], ["claude_code_downloads_per_day", "Claude Code", ENTITY_COLOR.Anthropic]].map(([k, n, col]) => ({name: n, color: col, points: AS.npm.map(r => ({x: T(r.month), y: r[k], note: notes[r.month] || null}))}));
  legend("lg-a-npm", S3.map(s => ({name: s.name, color: s.color})));
  view("c-a-npm", hst => lineChart(hst, S3, {height: 280, yFmt: perDay, log: nlog, yMin: nlog ? 1000 : 0, title: x => fmtMonth(x)}),
    hst => table(hst, [{label: "Month", key: "month"}, {label: "Codex / day", key: "codex_installs_per_day_corrected", n: 1, fmt: perDay}, {label: "Claude Code / day", key: "claude_code_downloads_per_day", n: 1, fmt: perDay}, {label: "Note", get: r => notes[r.month] || ""}], AS.npm));
  const seats = AS.seats.filter(r => r.low_m != null && r.high_m != null && r.estimate_m < 100);
  const colorOf = n => /Microsoft|GitHub/.test(n) ? "var(--neutral-bar)" : /OpenAI/.test(n) ? ENTITY_COLOR.OpenAI : /Google|Gemini/.test(n) ? ENTITY_COLOR.Google : /Anthropic/.test(n) ? ENTITY_COLOR.Anthropic : "var(--neutral-bar)";
  const rows = seats.map(r => ({label: r.company_product, value: r.estimate_m, lo: r.low_m, hi: r.high_m, tick: r.last_disclosed_m, color: colorOf(r.company_product), note: r.basis + (r.last_disclosed_date ? ` (last disclosed ${r.last_disclosed_date})` : "")})).sort((a, b) => b.value - a.value);
  view("c-a-seats", hst => hbar(hst, rows, {fmt: v => v == null ? "–" : v + "M", tickLabel: "Last disclosed", valueLabel: "estimated seats, Oct 2026"}),
    hst => table(hst, [{label: "Product", key: "company_product"}, {label: "Estimate", key: "estimate_m", n: 1, fmt: v => v + "M"}, {label: "Range", n: 1, get: r => r.low_m != null ? `${r.low_m}–${r.high_m}M` : "–"}, {label: "Last disclosed", n: 1, get: r => r.last_disclosed_m ? `${r.last_disclosed_m}M (${r.last_disclosed_date})` : "never"}, {label: "Basis", key: "basis"}], AS.seats));
  const bundled = AS.seats.filter(r => !(r.low_m != null && r.high_m != null && r.estimate_m < 100));
  table($("#a-bundled"), [{label: "Bundled or other entitlement", key: "company_product"}, {label: "Seats", key: "estimate_m", n: 1, fmt: v => v + "M"}, {label: "Basis", key: "basis"}], bundled);
  const list = [...AS.consumer.map(r => ({date: r.date, product: r.product, users: r.users_m, what: r.what_was_said, who: r.who, url: r.source_url})),
    ...AS.codex.map(r => ({date: r.date, product: "Codex", users: r.users_m, what: r.metric_as_stated, who: r.who, url: r.source_url}))].sort((a, b) => b.date.localeCompare(a.date));
  table($("#a-list"), [{label: "Date", key: "date"}, {label: "Product", key: "product"}, {label: "Users", key: "users", n: 1, fmt: usersM}, {label: "What was said", key: "what"},
    {label: "Source", get: r => { const a = h("a", {href: r.url, target: "_blank", rel: "noopener noreferrer"}, null, r.who); return a; }}], list);
}
function renderReview() {
  const box = $("#a-review"), list = $("#a-review-list");
  const cands = AS.candidates || [];
  box.hidden = !cands.length; list.replaceChildren();
  const prods = ["ChatGPT", "Gemini app", "Meta AI", "Codex", "Claude"], metrics = ["Weekly", "Monthly", "Daily"];
  cands.forEach(c => {
    const row = h("div", {class: "rv"}, list);
    const hl = h("div", {class: "hl"}, row);
    h("a", {href: c.link, target: "_blank", rel: "noopener noreferrer"}, hl, c.title);
    if (c.new_high) h("span", {class: "tag"}, hl, "▲ new high");
    h("div", {class: "meta"}, row, `${c.source || "news"} · ${c.date} · found ${c.found}`);
    const f = h("div", {class: "fields"}, row);
    const fld = (label, el) => { const l = h("label", null, f, label); l.appendChild(el); return el; };
    const date = fld("Date", h("input", {class: "w-date", value: c.date}));
    const prod = fld("Product", h("select")); prods.forEach(p => h("option", {value: p}, prod, p)); prod.value = c.product;
    const users = fld("Users (millions)", h("input", {class: "w-num", value: c.users_m}));
    const met = fld("Metric", h("select")); metrics.forEach(m => h("option", {value: m}, met, m)); met.value = c.metric.replace("?", "");
    const what = fld("What was said", h("input", {class: "w-text", value: c.title}));
    const who = fld("Who / source", h("input", {class: "w-text", value: c.source || ""}));
    const add = h("button", {class: "btn small", type: "button"}, f, "Add");
    const dis = h("button", {class: "btn small ghost", type: "button"}, f, "Dismiss");
    const act = async (action) => {
      add.disabled = dis.disabled = true;
      const r = await fetch(`/api/candidates/${c.id}/${action}`, {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({date: date.value, product: prod.value, users_m: users.value, metric: met.value, what: what.value, who: who.value, url: c.link})});
      const j = await r.json();
      if (!r.ok) { alert(j.error || "Could not save"); add.disabled = dis.disabled = false; return; }
      AS = await api("/api/assistants"); META.pending = (AS.candidates || []).length; badge(); drawAssist(); renderReview();
    };
    add.addEventListener("click", () => act("add")); dis.addEventListener("click", () => act("dismiss"));
  });
}
function badge() {
  [["assistants", "pending"], ["arr", "arr_pending"]].forEach(([tab, key]) => {
    const a = document.querySelector(`.tabs a[data-tab="${tab}"]`); if (!a) return;
    a.querySelector(".badge")?.remove();
    if (META && META[key] > 0) h("span", {class: "badge", title: META[key] + " headline(s) to review"}, a, String(META[key]));
  });
}
async function loadAssistants() {
  AS = await api("/api/assistants");
  renderReview();
  $("#a-scale").addEventListener("change", drawAssist); $("#npm-scale").addEventListener("change", drawAssist);
  drawAssist();
}

/* ================================================================ tokens (OpenRouter) */
let OR = null;
const tok = v => v == null ? "–" : v >= 1e15 ? (v / 1e15).toFixed(2) + "Q" : v >= 1e12 ? (v / 1e12).toFixed(v >= 1e14 || Number.isInteger(+(v / 1e12).toFixed(6)) ? 0 : 1) + "T" : (v / 1e9).toFixed(0) + "B";
const ORIGIN_COLOR = {"US & other Western labs": "var(--s1)", "Chinese labs": "var(--s2)", "Stealth / unannounced models": "var(--s3)", "Models outside the named top 9": "var(--ink-2)", "Other / unclassified": "var(--s5)"};
function drawTokens() {
  const tot = OR.totals.map(r => ({...r, t: T(r.week)}));
  const full = tot.filter(r => !r.partial), cur = tot.filter(r => r.partial && T(r.week) > T(full[full.length - 1].week));
  const last = full[full.length - 1], prev = full[full.length - 2], m4 = full[full.length - 5], first = full[0];
  const host = $("#tok-tiles"); host.replaceChildren();
  const tile = (title, value, sub, note, sp) => { const a = h("div", {class: "tile"}, host); h("div", {class: "t"}, a, title); h("div", {class: "v"}, a, value);
    if (sub) { const dd = h("div", {class: "d"}, a); dd.appendChild(sub); } h("div", {class: "s"}, a, note); if (sp) { const s = spark(sp, "var(--s1)"); if (s) a.appendChild(s); } };
  const chg = (a, b, lbl) => { const f = document.createDocumentFragment(), g = a / b - 1; h("span", {class: g >= 0 ? "up" : "down"}, f, (g >= 0 ? "▲ " : "▼ ") + (Math.abs(g) * 100).toFixed(1) + "%"); f.appendChild(document.createTextNode(" " + lbl)); return f; };
  tile("Tokens, last full week", tok(last.total_tokens), chg(last.total_tokens, prev.total_tokens, "vs prior week"), `Week of ${fmtDate(T(last.week))} · OpenRouter, all models`, full.slice(-26).map(r => r.total_tokens));
  tile("Growth over 4 weeks", ((last.total_tokens / m4.total_tokens - 1) * 100).toFixed(0) + "%", null, `${tok(m4.total_tokens)} → ${tok(last.total_tokens)} per week`);
  tile(`Growth since ${fmtMonth(T(first.week))}`, (last.total_tokens / first.total_tokens).toFixed(0) + "×", null, `${tok(first.total_tokens)} → ${tok(last.total_tokens)} per week`);
  tile("Annualised run rate", tok(last.total_tokens * 52) + " tokens", null, "Last full week × 52");
  const rqL = (OR.requests || []).filter(r => !r.partial).slice(-2).map(r => +r.total_requests);
  if (rqL.length === 2) tile("Requests, last full week", (rqL[1] / 1e9).toFixed(2) + "B", chg(rqL[1], rqL[0], "vs prior week"), `Week of ${fmtDate(T(last.week))} · OpenRouter, all models`, null);
  const tprL = (OR.requests || []).some(r => r.week === last.week) ? last.total_tokens / +OR.requests.find(r => r.week === last.week).total_requests : null;
  if (tprL != null) tile("Tokens per request, last full week", Math.round(tprL).toLocaleString(), null, "Week tokens ÷ week requests");
  if (cur.length) { const c = cur[0], days = Math.max(1, Math.min(7, Math.floor((Date.now() - T(c.week)) / 864e5))); /* whole UTC days elapsed = days with data */ tile("This week so far", tok(c.total_tokens), null, `Week of ${fmtDate(T(c.week))}, ${days} day(s) of data · on pace for ~${tok(c.total_tokens / days * 7)}`); }

  const log = $("#tok-scale").value === "log";
  // the in-progress week is its own dashed hollow stub, so the line (and its end label) stops at the last full week
  const S = [{name: "Weekly tokens", short: "Total", color: "var(--s1)", points: full.map(r => ({x: r.t, y: r.total_tokens, note: r.source.startsWith("Aug") ? "From the Aug-2026 author-share pull" : null}))}];
  if (cur.length) S.push({name: "This week so far (incomplete)", color: "var(--s1)", dash: true, endLabel: false, points: [{x: T(last.week), y: last.total_tokens}, ...cur.map(r => ({x: r.t, y: r.total_tokens, hollow: true, note: "Week still in progress"}))]});
  view("c-tok-total", hst => lineChart(hst, S, {height: 320, yFmt: tok, log, yMin: log ? 1e12 : 0, title: x => "Week of " + fmtDate(x)}),
    hst => table(hst, [{label: "Week of", key: "week"}, {label: "Total tokens", key: "total_tokens", n: 1, fmt: tok}, {label: "Named top-9 models", key: "named_tokens", n: 1, fmt: v => v === "" ? "–" : tok(v)}, {label: "Other models", key: "others_tokens", n: 1, fmt: v => v === "" ? "–" : tok(v)}, {label: "Status", get: r => r.partial ? "partial" : "full"}, {label: "Source", key: "source"}], [...OR.totals].reverse()));

  // requests and tokens per request: full weeks only, and only where the requests series has the week
  const cnt = v => v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(0) + "M" : Math.round(v).toLocaleString();
  const rqFull = (OR.requests || []).filter(r => !r.partial).map(r => ({week: r.week, t: T(r.week), requests: +r.total_requests}));
  const rqBy = Object.fromEntries(rqFull.map(r => [r.week, r.requests]));
  const tpr = full.filter(r => rqBy[r.week]).map(r => ({week: r.week, t: r.t, requests: rqBy[r.week], tokens: r.total_tokens, perReq: r.total_tokens / rqBy[r.week]}));
  view("c-tok-req", hst => lineChart(hst, [{name: "Requests per week", short: "Requests", color: "var(--s1)", points: rqFull.map(r => ({x: r.t, y: r.requests}))}], {height: 260, yFmt: cnt, yMin: 0, title: x => "Week of " + fmtDate(x)}),
    hst => table(hst, [{label: "Week of", key: "week"}, {label: "Requests", key: "requests", n: 1, fmt: cnt}], [...rqFull].reverse()));
  view("c-tok-tpr", hst => lineChart(hst, [{name: "Tokens per request", short: "Tokens / request", color: "var(--s2)", points: tpr.map(r => ({x: r.t, y: r.perReq}))}], {height: 260, yFmt: v => cnt(v), yMin: 0, title: x => "Week of " + fmtDate(x)}),
    hst => table(hst, [{label: "Week of", key: "week"}, {label: "Tokens", key: "tokens", n: 1, fmt: tok}, {label: "Requests", key: "requests", n: 1, fmt: cnt}, {label: "Tokens per request", key: "perReq", n: 1, fmt: v => Math.round(v).toLocaleString()}], [...tpr].reverse()));

  const groups = Object.keys(ORIGIN_COLOR).filter(g => OR.origin.some(r => r[g] > 0));
  const shares = OR.origin.map(r => { const s = groups.reduce((a, g) => a + (r[g] || 0), 0); return {week: r.week, ...Object.fromEntries(groups.map(g => [g, (r[g] || 0) / s]))}; });
  const S2 = groups.map(g => ({name: g, short: g.replace(" & other Western labs", " & Western").replace(" / unannounced models", "").replace("Models outside the named top 9", "Not named"), color: ORIGIN_COLOR[g], dash: g.startsWith("Outside"), points: shares.map(r => ({x: T(r.week), y: r[g]}))}));
  legend("lg-tok-origin", S2.map(s => ({name: s.name, color: s.color, dash: s.dash})));
  view("c-tok-origin", hst => lineChart(hst, S2, {height: 300, yFmt: v => pct(v, 0), yMin: 0, yMax: 1, title: x => "Week of " + fmtDate(x)}),
    hst => table(hst, [{label: "Week of", key: "week"}].concat(groups.map(g => ({label: g, key: g, n: 1, fmt: v => pct(v)}))), [...shares].reverse()));

  $("#tok-top-title").textContent = `Top 9 models, week of ${fmtDate(T(OR.top_week))}`;
  const top = OR.top.filter(r => r.model !== "Others").map(r => ({label: r.model.split("/")[1] || r.model, value: r.tokens, tick: r.prev, color: ORIGIN_COLOR[r.origin] || "var(--s1)", note: `${r.model} · ${r.origin} · ${tok(r.tokens)} (${pct(r.tokens / last.total_tokens)} of all tokens)` + (r.prev ? ` · week before ${tok(r.prev)}` : " · new in the top 9")}));
  const usedOrigins = [...new Set(OR.top.filter(r => r.model !== "Others").map(r => r.origin))];
  legend("lg-tok-top", usedOrigins.length > 1 ? usedOrigins.map(o => ({name: o, color: ORIGIN_COLOR[o], kind: "dot"})) : []);
  view("c-tok-top", hst => hbar(hst, top, {fmt: tok, tickLabel: "Week before", valueLabel: "tokens that week"}),
    hst => table(hst, [{label: "Model", get: r => r.model}, {label: "Lab origin", key: "origin"}, {label: "Tokens", key: "tokens", n: 1, fmt: tok}, {label: "Share of total", n: 1, get: r => pct(r.tokens / last.total_tokens)}, {label: "Week before", key: "prev", n: 1, fmt: tok}], OR.top));

  $("#tok-apps-sub").textContent = `Snapshot ${OR.apps_snapshot || "–"}. Ranks skip numbers because private apps are ranked but not named.`;
  const apps = OR.apps.slice(0, 15).map(r => ({label: `#${r.rank} ${r.app}`, value: +r.tokens, color: "var(--s1)", note: `${(+r.requests).toLocaleString()} requests · ${String(r.categories || "").replace(/\|/g, ", ") || "no category"}`}));
  view("c-tok-apps", hst => hbar(hst, apps, {fmt: tok, valueLabel: "tokens, last 7 days"}),
    hst => table(hst, [{label: "Rank", key: "rank", n: 1}, {label: "App", key: "app"}, {label: "Tokens", key: "tokens", n: 1, fmt: v => tok(+v)}, {label: "Requests", key: "requests", n: 1, fmt: v => (+v).toLocaleString()}, {label: "Categories", get: r => String(r.categories || "").replace(/\|/g, ", ")}], OR.apps));
}
async function loadTokens() {
  OR = await api("/api/openrouter");
  if (!OR.totals.length) { $("#tok-tiles").textContent = "No OpenRouter data yet - run the weekly update."; return; }
  $("#tok-scale").addEventListener("change", drawTokens);
  drawTokens();
}

/* ================================================================ Lab ARR (OpenAI & Anthropic) */
let AR = null;
const bn = v => v == null || v === "" ? "–" : v >= 1e12 ? "$" + (v / 1e12).toFixed(2) + "T" : v >= 1e9 ? "$" + (v / 1e9).toFixed(v >= 1e11 ? 0 : 1).replace(/\.0$/, "") + "B" : "$" + Math.round(v / 1e6) + "M";
const LAB_COLOR = {OpenAI: ENTITY_COLOR.OpenAI, Anthropic: ENTITY_COLOR.Anthropic};
function drawArr() {
  const st = AR.stats, host = $("#arr-tiles"); host.replaceChildren();
  ["Anthropic", "OpenAI"].forEach(co => { const s = st[co]; if (!s) return;
    const a = h("div", {class: "tile"}, host); h("div", {class: "t"}, a, `${co} run-rate ARR`); h("div", {class: "v"}, a, bn(s.value));
    const dd = h("div", {class: "d"}, a);
    if (s.yago) { h("span", {class: "up"}, dd, `▲ ${(s.value / s.yago).toFixed(1)}×`); dd.appendChild(document.createTextNode(" vs a year earlier")); }
    h("div", {class: "s"}, a, `${fmtDate(T(s.date))} · ${s.dec25 ? (s.value / s.dec25).toFixed(1) + "× since end-2025 · " : ""}doubling every ~${s.doubling_months ? s.doubling_months.toFixed(1) : "–"} months (last 6 months)`);
    const sp = spark(AR.points.filter(p => p.company === co && p.kind === "run_rate").map(p => p.value_usd), LAB_COLOR[co]); if (sp) a.appendChild(sp); });
  if (st.ratio) { const a = h("div", {class: "tile"}, host); h("div", {class: "t"}, a, "Anthropic ÷ OpenAI"); h("div", {class: "v"}, a, st.ratio.value.toFixed(2) + "×");
    h("div", {class: "s"}, a, `On ${fmtDate(T(st.ratio.date))} (last date both have data; log-interpolated)` + (AR.crossover ? ` · Anthropic passed OpenAI around ${fmtMonth(T(AR.crossover))}` : "")); }
  if (st.Anthropic && st.OpenAI) { const a = h("div", {class: "tile"}, host); h("div", {class: "t"}, a, "Combined, latest each"); h("div", {class: "v"}, a, bn(st.Anthropic.value + st.OpenAI.value)); h("div", {class: "s"}, a, "Sum of each lab's latest reported run-rate (dates differ)"); }

  const log = $("#arr-scale").value === "log", showX = $("#arr-extrap").checked;
  const S = [];
  ["OpenAI", "Anthropic"].forEach(co => {
    const pts = AR.points.filter(p => p.company === co && p.kind === "run_rate").sort((a, b) => a.date.localeCompare(b.date));
    const solid = r => /Confident/i.test(r.confidence) || /Company disclosure/i.test(r.source_type);
    S.push({name: co, color: LAB_COLOR[co], points: pts.map(r => ({x: T(r.date), y: r.value_usd, hollow: !solid(r),
      note: [r.label, r.confidence || "no rating", r.source_type, r.report_date ? "reported " + r.report_date : "", r.note].filter(Boolean).join(" · ")}))});
    const ex = AR.points.find(p => p.company === co && p.kind === "extrapolation");
    if (showX && ex && pts.length) S.push({name: co + " year-end extrapolation", short: co + " 2026E", color: LAB_COLOR[co], dash: true, endLabel: false,
      points: [{x: T(pts[pts.length - 1].date), y: pts[pts.length - 1].value_usd}, {x: T(ex.date), y: ex.value_usd, hollow: true, note: ex.note}]});
  });
  legend("lg-arr", [{name: "OpenAI", color: LAB_COLOR.OpenAI}, {name: "Anthropic", color: LAB_COLOR.Anthropic}].concat(showX ? [{name: "Workbook year-end extrapolation", color: "var(--ink-2)", dash: true}] : []));
  view("c-arr", hst => lineChart(hst, S, {height: 360, yFmt: bn, log, yMin: log ? 2e7 : 0, mode: "near"}),
    hst => table(hst, [{label: "Date", key: "date"}, {label: "Company", key: "company"}, {label: "Run-rate", key: "value_usd", n: 1, fmt: bn}, {label: "Type", key: "rev_type"}, {label: "Confidence", key: "confidence"}, {label: "Source type", key: "source_type"}, {label: "Reported", key: "report_date"},
      {label: "Source", get: r => r.source1 ? h("a", {href: r.source1, target: "_blank", rel: "noopener noreferrer"}, null, (r.source1.match(/\/\/(?:www\.)?([^/]+)/) || [, "link"])[1]) : (r.note || "–")}, {label: "Quote", get: r => (r.quote || "").slice(0, 220)}],
      AR.points.filter(p => p.kind === "run_rate").sort((a, b) => b.date.localeCompare(a.date))));

  const land = [...AR.landscape].sort((a, b) => b.arr_musd - a.arr_musd).slice(0, 20);
  const lc = n => /^OpenAI/.test(n) ? LAB_COLOR.OpenAI : /^Anthropic/.test(n) ? LAB_COLOR.Anthropic : "var(--neutral-bar)";
  view("c-arr-land", hst => hbar(hst, land.map(r => ({label: r.name, value: r.arr_musd * 1e6, color: lc(r.name), note: `${r.date}` + (r.share !== "" ? ` · ${pct(+r.share)} of listed total` : "") + (r.gross_margin !== "" ? ` · gross margin ${typeof r.gross_margin === "number" ? pct(r.gross_margin, 0) : r.gross_margin}` : "")})), {fmt: bn, valueLabel: "ARR"}),
    hst => table(hst, [{label: "Lab / product", key: "name"}, {label: "As of", key: "date"}, {label: "ARR", key: "arr_musd", n: 1, fmt: v => bn(v * 1e6)}, {label: "Share", key: "share", n: 1, fmt: v => v === "" ? "–" : pct(+v)}, {label: "Gross margin", get: r => r.gross_margin === "" ? "–" : typeof r.gross_margin === "number" ? pct(r.gross_margin, 0) : r.gross_margin}], [...AR.landscape].sort((a, b) => b.arr_musd - a.arr_musd)));

  table($("#arr-other"), [{label: "Date", key: "date"}, {label: "Company", key: "company"}, {label: "Measure", get: r => r.kind === "recognized" ? `Recognised revenue (${(r.period_type || "period").toLowerCase()})` : `Segment ARR`}, {label: "Value", key: "value_usd", n: 1, fmt: bn}, {label: "What", get: r => r.label}],
    AR.points.filter(p => p.kind === "recognized" || p.kind === "segment").sort((a, b) => b.date.localeCompare(a.date)));
  table($("#arr-gw"), [{label: "Date", key: "date"}, {label: "Company", key: "company"}, {label: "Run-rate", key: "value_usd", n: 1, fmt: bn}, {label: "Compute (GW)", key: "compute_gw", n: 1}, {label: "Inference (GW)", key: "inference_gw", n: 1}, {label: "Inference revenue / GW", key: "inference_rev_per_gw_bn", n: 1, fmt: v => v === "" ? "–" : "$" + (+v).toFixed(1) + "B"}],
    AR.points.filter(p => p.compute_gw !== "" && p.kind === "run_rate").sort((a, b) => b.date.localeCompare(a.date)));
}
function renderArrReview() {
  const box = $("#arr-review"), list = $("#arr-review-list"), cands = AR.candidates || [];
  box.hidden = !cands.length; list.replaceChildren();
  cands.forEach(c => {
    const row = h("div", {class: "rv"}, list), hl = h("div", {class: "hl"}, row);
    h("a", {href: c.link, target: "_blank", rel: "noopener noreferrer"}, hl, c.title);
    if (c.new_high) h("span", {class: "tag"}, hl, "▲ new high");
    h("div", {class: "meta"}, row, `${c.source || "news"} · ${c.date} · found ${c.found}`);
    const f = h("div", {class: "fields"}, row), fld = (l, e) => { h("label", null, f, l).appendChild(e); return e; };
    const date = fld("Date of the figure", h("input", {class: "w-date", value: c.date}));
    const co = fld("Company", h("select")); ["Anthropic", "OpenAI"].forEach(x => h("option", {value: x}, co, x)); co.value = c.company;
    const val = fld("Run-rate ($ billion)", h("input", {class: "w-num", value: c.value_usd / 1e9}));
    const conf = fld("Confidence", h("select")); ["Likely", "Confident", "Speculative"].forEach(x => h("option", {value: x}, conf, x));
    const q = fld("Quote / note", h("input", {class: "w-text", value: c.title}));
    const add = h("button", {class: "btn small", type: "button"}, f, "Add"), dis = h("button", {class: "btn small ghost", type: "button"}, f, "Dismiss");
    const act = async action => { add.disabled = dis.disabled = true;
      const r = await fetch(`/api/arr-candidates/${c.id}/${action}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({date: date.value, company: co.value, value_bn: val.value, confidence: conf.value, quote: q.value})});
      const j = await r.json(); if (!r.ok) { alert(j.error || "Could not save"); add.disabled = dis.disabled = false; return; }
      AR = await api("/api/arr"); renderArrReview(); drawArr(); META.arr_pending = (AR.candidates || []).length; badge(); };
    add.addEventListener("click", () => act("add")); dis.addEventListener("click", () => act("dismiss"));
  });
}
/* the Research workbook's "ARR Trend Analysis" sheet: key metrics + Q/Q and M/M tables */
function drawArrTrend() {
  const TR = AR.trend || {};
  if (!(TR.quarterly || []).length) { $("#arr-trend-metrics").textContent = "No ARR Trend Analysis sheet imported yet."; return; }
  const bn = v => v == null ? "–" : "$" + (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)) + "B";
  const pc = v => v == null ? "–" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(v * 100 >= 100 || v * 100 <= -100 ? 0 : 1) + "%";
  const mfmt = (name, v) => v == null || v === "" ? "–" : /\(\$B\)/.test(name) ? bn(+v) : /date|exceeds/i.test(name) ? fmtDate(T(String(v).slice(0, 10))) : /yoy/i.test(name) ? (+v + 1).toFixed(1) + "× (" + pc(+v) + ")" : pc(+v);
  table($("#arr-trend-metrics"), [{label: "Key metric", key: "metric"}, {label: "Anthropic", n: 1, get: r => mfmt(r.metric, r.anthropic)},
    {label: "OpenAI", n: 1, get: r => mfmt(r.metric, r.openai)}, {label: "Combined", n: 1, get: r => mfmt(r.metric, r.combined)}], TR.metrics);
  const freq = $("#arr-tr-freq").value, meas = $("#arr-tr-meas").value, D = TR[freq];
  const qx = r => T(r.date);
  const lab = r => freq === "quarterly" ? r.period : fmtMonth(T(r.date));
  const COL = {anthropic: ENTITY_COLOR.Anthropic, openai: ENTITY_COLOR.OpenAI, combined: "var(--ink-2)"};
  let S, f;
  if (meas === "share") { S = [{name: "Anthropic share of Anthropic + OpenAI ARR", color: COL.anthropic, points: D.map(r => ({x: qx(r), y: r.anthropic_share, note: lab(r)}))}]; f = v => pct(v, 0); }
  else if (meas === "ratio") { S = [{name: "Anthropic ARR ÷ OpenAI ARR", color: COL.anthropic, points: D.map(r => ({x: qx(r), y: r.anthropic_to_openai, note: lab(r)}))}]; f = v => v.toFixed(2) + "×"; }
  else {
    const key = {arr: "_bn", add: "_add_bn", growth: "_growth"}[meas];
    S = [["anthropic", "Anthropic"], ["openai", "OpenAI"]].map(([k, nm]) => ({name: nm, color: COL[k], points: D.map(r => ({x: qx(r), y: r[k + key], note: lab(r)}))}));
    if (meas !== "add") S.push({name: "Combined", color: COL.combined, dash: true, points: D.map(r => ({x: qx(r), y: r["combined" + (meas === "arr" ? "_bn" : "_growth")], note: lab(r)}))});
    f = meas === "growth" ? (v => pct(v, 0)) : bn;
  }
  legend("lg-arr-trend", S.map(s => ({name: s.name, color: s.color, dash: s.dash})));
  const log = meas === "arr" && $("#arr-scale").value === "log";
  view("c-arr-trend", hst => lineChart(hst, S, {height: 320, yFmt: f, log, yMin: log ? null : meas === "growth" ? null : 0, mode: "cross",
      title: x => { const r = D.find(d => qx(d) === x); return r ? lab(r) : fmtDate(x); }}),
    hst => table(hst, [{label: freq === "quarterly" ? "Quarter" : "Month", get: lab}, {label: "Anthropic", n: 1, get: r => bn(r.anthropic_bn)}, {label: "Δ $", n: 1, get: r => bn(r.anthropic_add_bn)}, {label: "Δ %", n: 1, get: r => pc(r.anthropic_growth)},
      {label: "OpenAI", n: 1, get: r => bn(r.openai_bn)}, {label: "Δ $", n: 1, get: r => bn(r.openai_add_bn)}, {label: "Δ %", n: 1, get: r => pc(r.openai_growth)},
      {label: "Combined", n: 1, get: r => bn(r.combined_bn)}, {label: "Δ %", n: 1, get: r => pc(r.combined_growth)}, {label: "Anthropic share", n: 1, get: r => pct(r.anthropic_share, 0)},
      {label: "A ÷ O", n: 1, get: r => r.anthropic_to_openai == null ? "–" : r.anthropic_to_openai.toFixed(2) + "×"}], [...D].reverse()));
}
async function loadArr() {
  AR = await api("/api/arr");
  if (!AR.points.length) { $("#arr-tiles").textContent = "No ARR data yet - run ai-lab-arr/arr_update.py."; return; }
  ["#arr-scale", "#arr-extrap"].forEach(s => $(s).addEventListener("change", drawArr));
  ["#arr-tr-freq", "#arr-tr-meas", "#arr-scale"].forEach(s => $(s).addEventListener("change", drawArrTrend));
  renderArrReview(); drawArr(); drawArrTrend();
}

/* ================================================================ GPU prices (Silicon Data) */
let SD = null;
const usd = v => v == null ? "–" : "$" + v.toFixed(2);
const GPU_ORDER = [["SDH100RT", "var(--s1)"], ["SDB200RT", "var(--s2)"], ["SDA100RT", "var(--s3)"], ["H200", "var(--s4)"], ["B300", "var(--s5)"], ["MI300X", "var(--s6)"]];
const chgPct = (a, b) => a == null || b == null || !b ? null : a / b - 1;
function drawGpu() {
  const L = Object.fromEntries(SD.latest.map(r => [r.index, r]));
  const host = $("#gpu-tiles"); host.replaceChildren();
  const tile = (r, extra) => {
    const a = h("div", {class: "tile"}, host);
    h("div", {class: "t"}, a, r.segment === "Index" ? r.label : `${r.label} rental, ${r.segment.toLowerCase()}`);
    h("div", {class: "v"}, a, r.unit.startsWith("USD / GPU") ? usd(r.value) + "/hr" : usd(r.value));
    const g = chgPct(r.value, r.d7);
    if (g != null) { const dd = h("div", {class: "d"}, a); h("span", {class: g >= 0 ? "up" : "down"}, dd, (g >= 0 ? "▲ " : "▼ ") + (Math.abs(g) * 100).toFixed(1) + "%"); dd.appendChild(document.createTextNode(" vs a week earlier" + (r.ytd_base ? ` · ${((r.value / r.ytd_base - 1) * 100).toFixed(0)}% YTD` : ""))); }
    h("div", {class: "s"}, a, `${fmtDate(T(r.date))} · ${r.unit}` + (extra || ""));
    const sp = spark(SD.series[r.index].points.slice(-90).map(p => p[1]), "var(--s1)"); if (sp) a.appendChild(sp);
  };
  ["SDH100RT", "SDB200RT", "SDA100RT", "SDLLMTK"].forEach(k => L[k] && tile(L[k], L[k].rev_per_gw_bn ? ` · ≈ $${L[k].rev_per_gw_bn.toFixed(1)}B / GW / yr` : ""));

  const days = +$("#gpu-range").value, end = Math.max(...SD.latest.map(r => T(r.date))), start = days ? end - days * 864e5 : null;
  const S = GPU_ORDER.filter(([k]) => SD.series[k]).map(([k, col]) => ({name: SD.series[k].label, color: col,
    points: SD.series[k].points.filter(p => !start || T(p[0]) >= start).map(p => ({x: T(p[0]), y: p[1], note: p[2] === "site" ? "from silicondata.com" : null}))}))
    .filter(s => s.points.length);
  legend("lg-gpu-price", S.map(s => ({name: s.name, color: s.color})));
  view("c-gpu-price", hst => lineChart(hst, S, {height: 340, yFmt: v => "$" + v.toFixed(2), yMin: 0, mode: "cross", title: x => fmtDate(x)}),
    hst => { const dates = [...new Set(S.flatMap(s => s.points.map(p => p.x)))].sort((a, b) => b - a);
      const look = Object.fromEntries(S.map(s => [s.name, Object.fromEntries(s.points.map(p => [p.x, p.y]))]));
      table(hst, [{label: "Date", get: r => new Date(r).toISOString().slice(0, 10)}].concat(S.map(s => ({label: s.name, n: 1, get: r => usd(look[s.name][r])}))), dates); });

  // token index vs B200, both rebased to 100 at the token index start
  const tk = SD.series.SDLLMTK, b2 = SD.series.SDB200RT;
  if (tk && b2) {
    const t0 = tk.points[0][0], base = s => (s.points.find(p => p[0] >= t0) || s.points[0])[1];
    const tb = base(tk), bb = base(b2);
    const S2 = [{name: "LLM Token Expenditure Index", short: "Token cost", color: "var(--s1)", points: tk.points.map(p => ({x: T(p[0]), y: p[1] / tb * 100, note: `$${p[1].toFixed(2)} per M tokens`}))},
      {name: "B200 rental (neo-cloud)", short: "B200 rental", color: "var(--s2)", points: b2.points.filter(p => p[0] >= t0).map(p => ({x: T(p[0]), y: p[1] / bb * 100, note: `$${p[1].toFixed(2)} per GPU-hour`}))}];
    legend("lg-gpu-token", S2.map(s => ({name: s.name, color: s.color})));
    view("c-gpu-token", hst => lineChart(hst, S2, {height: 280, yFmt: v => v.toFixed(0), mode: "cross", title: x => fmtDate(x)}),
      hst => { const bm = Object.fromEntries(b2.points.map(p => [p[0], p[1]])); table(hst, [{label: "Date", key: 0}, {label: "Token index ($/M)", n: 1, get: r => usd(r[1])}, {label: "Token, rebased", n: 1, get: r => (r[1] / tb * 100).toFixed(1)}, {label: "B200 ($/hr)", n: 1, get: r => usd(bm[r[0]])}, {label: "B200, rebased", n: 1, get: r => bm[r[0]] ? (bm[r[0]] / bb * 100).toFixed(1) : "–"}], [...tk.points].reverse()); });
  }

  const hyp = [];
  [["H100-HYP", "SDH100RT"], ["A100-HYP", "SDA100RT"], ["B200-HYP", "SDB200RT"]].forEach(([hk, nk]) => {
    if (!SD.series[hk]) return;
    const neo = Object.fromEntries((SD.series[nk]?.points || []).map(p => [p[0], p[1]]));
    SD.series[hk].points.forEach(p => hyp.push({gpu: SD.series[hk].label, date: p[0], hyp: p[1], neo: neo[p[0]] ?? null}));
  });
  hyp.sort((a, b) => b.date.localeCompare(a.date) || a.gpu.localeCompare(b.gpu));
  table($("#gpu-hyp"), [{label: "Date", key: "date"}, {label: "GPU", key: "gpu"}, {label: "Hyperscaler", key: "hyp", n: 1, fmt: usd}, {label: "Neo-cloud", key: "neo", n: 1, fmt: usd}, {label: "Premium", n: 1, get: r => r.neo ? (r.hyp / r.neo).toFixed(2) + "×" : "–"}], hyp);

  const order = ["SDH100RT", "SDB200RT", "SDA100RT", "H200", "B300", "MI300X", "SDLLMTK", "H100-HYP", "A100-HYP", "B200-HYP"];
  const rows = order.map(k => L[k]).filter(Boolean);
  const pc = v => v == null ? "–" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%";
  table($("#gpu-latest"), [{label: "Index", get: r => r.label + (r.segment === "Index" ? "" : ` (${r.segment})`)}, {label: "Ticker", get: r => /^SD/.test(r.index) ? r.index : "–"}, {label: "Latest", n: 1, get: r => usd(r.value)}, {label: "Unit", key: "unit"}, {label: "As of", key: "date"},
    {label: "7 days", n: 1, get: r => pc(chgPct(r.value, r.d7))}, {label: "30 days", n: 1, get: r => pc(chgPct(r.value, r.d30))}, {label: "1 year", n: 1, get: r => pc(chgPct(r.value, r.d365))}, {label: "YTD", n: 1, get: r => pc(chgPct(r.value, r.ytd_base))},
    {label: "Implied revenue / GW / yr", n: 1, get: r => r.rev_per_gw_bn ? "$" + r.rev_per_gw_bn.toFixed(1) + "B" : "–"}, {label: "Since", key: "first"}], rows);
  const ck = $("#gpu-checks"); ck.replaceChildren();
  if (SD.checks.length) { h("h3", null, ck, "Data checks flagged (Silicon Data's 7-day change disagrees with our stored value)"); const box = h("div", {class: "tblwrap"}, ck);
    table(box, [{label: "Checked", key: "checked"}, {label: "Index", key: "index"}, {label: "Date", key: "date"}, {label: "Issue", key: "issue"}], SD.checks); }
}
async function loadGpu() {
  SD = await api("/api/silicon");
  if (!SD.latest.length) { $("#gpu-tiles").textContent = "No Silicon Data yet - run silicon-data/silicon_update.py."; return; }
  $("#gpu-range").addEventListener("change", drawGpu);
  drawGpu();
}

/* ================================================================ Ramp AI Index (business tokens) */
let RP = null;
const RP_COL = {Anthropic: "var(--s4)", OpenAI: "var(--s1)", Google: "var(--s2)", xAI: "var(--s3)", "Other makers": "var(--s5)"};
const tokN = v => v == null ? "–" : v >= 1e12 ? (v / 1e12).toFixed(v >= 1e13 ? 1 : 2) + "T" : v >= 1e9 ? (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + "B" : v >= 1e6 ? (v / 1e6).toFixed(0) + "M" : Math.round(v).toLocaleString();
const usdN = v => v == null ? "–" : v >= 1e6 ? "$" + (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(0) + "K" : "$" + v.toFixed(0);
const perM = v => v == null ? "–" : "$" + (v >= 10 ? v.toFixed(1) : v.toFixed(2));
const sum = a => a.reduce((x, y) => x + y, 0);
function drawRamp() {
  const W = RP.weeks, n = W.length, V = RP.by.token_volume, S = RP.by.token_spend;
  const totV = W.map((_, i) => sum(RP.makers.map(m => V[m][i]))), totS = W.map((_, i) => sum(RP.makers.map(m => S[m][i])));
  const host = $("#rp-tiles"); host.replaceChildren();
  const tile = (title, val, now, before, sub, series, upGood = true) => {
    const a = h("div", {class: "tile"}, host); h("div", {class: "t"}, a, title); h("div", {class: "v"}, a, val);
    if (before) { const g = now / before - 1, dd = h("div", {class: "d"}, a); h("span", {class: (g >= 0) === upGood ? "up" : "down"}, dd, (g >= 0 ? "▲ " : "▼ ") + (Math.abs(g) * 100).toFixed(1) + "%"); dd.appendChild(document.createTextNode(" vs 4 weeks earlier")); }
    h("div", {class: "s"}, a, sub); const sp = spark(series.slice(-26), "var(--s1)"); if (sp) a.appendChild(sp);
  };
  const wk = `Week of ${fmtDate(T(W[n - 1]))}`;
  tile("Tokens per week", tokN(totV[n - 1]), totV[n - 1], totV[n - 5], wk, totV);
  tile("Token spend per week", usdN(totS[n - 1]), totS[n - 1], totS[n - 5], wk, totS);
  const bl = W.map((_, i) => totV[i] ? totS[i] / totV[i] * 1e6 : null);
  tile("Blended price paid", perM(bl[n - 1]) + " / M", bl[n - 1], bl[n - 5], wk + " · spend ÷ tokens", bl, false);
  const sh = W.map((_, i) => totV[i] ? V.Anthropic[i] / totV[i] : null);
  {
    const a = h("div", {class: "tile"}, host); h("div", {class: "t"}, a, "Anthropic share of tokens"); h("div", {class: "v"}, a, pct(sh[n - 1]));
    const dd = h("div", {class: "d"}, a), dl = (sh[n - 1] - sh[n - 5]) * 100;
    h("span", {class: dl >= 0 ? "up" : "down"}, dd, (dl >= 0 ? "▲ " : "▼ ") + pp(dl));
    dd.appendChild(document.createTextNode(` vs 4 weeks earlier · OpenAI ${pct(V.OpenAI[n - 1] / totV[n - 1])}`));
    h("div", {class: "s"}, a, wk); const sp = spark(sh.slice(-26), "var(--s1)"); if (sp) a.appendChild(sp);
  }

  // main chart: volume / spend / blended price by maker, levels or shares
  const metric = $("#rp-metric").value, share = $("#rp-mode").value === "share" && metric !== "price";
  const rg = +$("#rp-range").value, i0 = rg ? Math.max(0, n - rg) : 0;
  $("#rp-mode").disabled = metric === "price";
  const src = metric === "token_spend" ? S : V, tot = metric === "token_spend" ? totS : totV;
  const val = (m, i) => metric === "price" ? (V[m][i] > 0 && S[m][i] > 0 ? S[m][i] / V[m][i] * 1e6 : null)  /* weeks with tokens but no billed spend: no price */ : share ? src[m][i] / tot[i] : (src[m][i] || null);
  const fmt = metric === "price" ? perM : share ? (v => pct(v, v < 0.1 ? 1 : 0)) : metric === "token_spend" ? usdN : tokN;
  const series = RP.makers.map(m => ({name: m, color: RP_COL[m], markers: false, points: W.slice(i0).map((w, k) => ({x: T(w), y: val(m, i0 + k)}))}));
  if (!share) series.unshift({name: metric === "price" ? "All makers (blended)" : "Total", short: metric === "price" ? "Blended" : "Total", color: "var(--ink)", markers: false,
    points: W.slice(i0).map((w, k) => ({x: T(w), y: metric === "price" ? bl[i0 + k] : tot[i0 + k]}))});
  $("#rp-main-title").textContent = (metric === "price" ? "Blended price paid per million tokens" : (share ? "Share of weekly " : "Weekly ") + (metric === "token_spend" ? "token spend" : "token volume")) + " by model maker";
  legend("lg-rp-main", series.map(s => ({name: s.name, color: s.color})));
  const log = $("#rp-scale").value === "log" && !share;
  view("c-rp-main", hst => lineChart(hst, series, {height: 360, yFmt: fmt, log, yMin: share ? 0 : null, yMax: share ? 1 : null, mode: "cross", title: x => "Week of " + fmtDate(x)}),
    hst => table(hst, [{label: "Week", get: k => W[k]}].concat(series.map(s => ({label: s.name, n: 1, get: k => fmt(s.points[k - i0].y)}))), W.map((_, k) => k).slice(i0).reverse()));

  // price paid by token type (trailing 7 days)
  const P = RP.prices[$("#rp-px-maker").value] || [];
  const PC = [["Output", 2, "var(--s2)"], ["Uncached input", 3, "var(--s1)"], ["Blended (all tokens)", 1, "var(--ink)"], ["Cached input", 4, "var(--s3)"]];
  const PS = PC.map(([nm, j, col]) => ({name: nm, color: col, markers: false, points: P.map(r => ({x: T(r[0]), y: r[j]}))}));
  legend("lg-rp-px", PS.map(s => ({name: s.name, color: s.color})));
  view("c-rp-px", hst => lineChart(hst, PS, {height: 300, yFmt: perM, log: true, mode: "cross", title: x => "7 days to " + fmtDate(x)}),
    hst => table(hst, [{label: "7 days to", key: 0}].concat(PC.map(([nm, j]) => ({label: nm, n: 1, get: r => perM(r[j])}))), [...P].reverse()));
  const CS = Object.keys(RP.prices).map(m => ({name: m, color: RP_COL[m] || "var(--s5)", markers: false, points: RP.prices[m].map(r => ({x: T(r[0]), y: r[5]}))}));
  legend("lg-rp-cache", CS.map(s => ({name: s.name, color: s.color})));
  view("c-rp-cache", hst => lineChart(hst, CS, {height: 300, yFmt: v => pct(v, 0), yMin: 0, yMax: 1, mode: "cross", title: x => "7 days to " + fmtDate(x)}),
    hst => {
      const d = [...new Set(CS.flatMap(s => s.points.map(p => p.x)))].sort((a, b) => b - a), L = Object.fromEntries(CS.map(s => [s.name, Object.fromEntries(s.points.map(p => [p.x, p.y]))]));
      table(hst, [{label: "7 days to", get: x => new Date(x).toISOString().slice(0, 10)}].concat(CS.map(s => ({label: s.name, n: 1, get: x => pct(L[s.name][x])}))), d);
    });

  // top models in the latest week
  const top = RP.top.slice(0, 20), tv = totV[n - 1], tvPrior = totV[n - 5];
  $("#rp-top-title").textContent = `Top ${top.length} of ${RP.n_models} models by tokens, week of ${fmtDate(T(RP.last))}`;
  $("#rp-top-sub").textContent = `Bar = share of the week's tokens. Tick = the same model's share four weeks earlier (week of ${fmtDate(T(RP.prior))}). Colour = model maker.`;
  const grp = m => RP_COL[m] ? m : "Other makers";
  legend("lg-rp-top", RP.makers.filter(m => top.some(r => grp(r.maker) === m)).map(m => ({name: m, color: RP_COL[m], kind: "dot"})));
  const ppm = r => r.spend && r.tokens ? r.spend / r.tokens * 1e6 : null;
  const rows = top.map(r => ({key: r.model, label: r.label, value: r.tokens / tv, tick: r.tokens_4w ? r.tokens_4w / tvPrior : null, color: RP_COL[grp(r.maker)],
    note: `${r.maker} · ${tokN(r.tokens)} tokens · ${usdN(r.spend)} · ${perM(ppm(r))} per M`}));
  view("c-rp-top", hst => hbar(hst, rows, {fmt: v => pct(v, v < 0.01 ? 2 : 1), tickLabel: "4 weeks earlier", valueLabel: "share of tokens"}),
    hst => table(hst, [{label: "Model", key: "label"}, {label: "Maker", key: "maker"}, {label: "Tokens", n: 1, get: r => tokN(r.tokens)}, {label: "Share", n: 1, get: r => pct(r.tokens / tv, 2)},
      {label: "Spend", n: 1, get: r => usdN(r.spend)}, {label: "$ / M tokens", n: 1, get: r => perM(ppm(r))},
      {label: "Tokens vs 4 wks", n: 1, get: r => r.tokens_4w ? ((r.tokens / r.tokens_4w - 1) * 100).toFixed(0) + "%" : "new"}], RP.top));
}
async function loadRamp() {
  RP = await api("/api/ramp");
  if (!RP.weeks.length) { $("#rp-tiles").textContent = "No Ramp data yet - run ramp-ai-index/ramp_update.py."; return; }
  const sel = $("#rp-px-maker"); Object.keys(RP.prices).forEach(m => h("option", {value: m}, sel, m));
  ["#rp-metric", "#rp-mode", "#rp-scale", "#rp-range", "#rp-px-maker"].forEach(id => $(id).addEventListener("change", drawRamp));
  drawRamp();
}

/* ================================================================ BofA Exhibit 2: capex cycles */
const CX_COL = {rail: "#1f3a7a", og70s: "#c41230", telecom: "#e66100", shale: "#269e00", hyperLA: "#33b5f0", hyper: "#00808f"};
const CX_SHORT = {rail: "Railroads", og70s: "O&G 70s-80s", telecom: "Telecoms", shale: "Shale", hyperLA: "Hyperscalers (LA)", hyper: "Hyperscalers"};
/* railroads are drawn left of the axis break at 1/4 scale: 1919 sits 10 years before 1970 */
const cxPos = (k, p) => k === "rail" ? 1960 - (1919 - p) / 4 : p;
/* BofA: every post-1970 point is drawn three quarters before the end of its four-quarter window (half a year before the start of its final quarter): position P = the four quarters ending P+0.75 */
const cxQ = p => { const e = p + 0.5, y = Math.floor(e + 1e-9); return `TTM to Q${Math.round((e - y) * 4) + 1} ${y}`; };
const cxPosOfQ = q => +q.slice(0, 4) + (+q.slice(-1) - 1) / 4 - 0.5;  /* "2026Q2" -> chart position */
/* hyperscaler capex by company, calendar quarters (SEC filings; Oracle calendarised) */
let CXQ = null;
const CXQ_TK = [["AMZN", "Amazon", "var(--s1)"], ["GOOGL", "Alphabet", "var(--s2)"], ["MSFT", "Microsoft", "var(--s3)"], ["META", "Meta", "var(--s4)"], ["ORCL", "Oracle (calendarised)", "var(--s5)"]];
const CXQ_NEO = [["CoreWeave", "CoreWeave", "var(--s6)"], ["Nebius", "Nebius", "#d6a700"], ["SpaceX AI", "SpaceX AI segment", "#8a5cd6"]];
const NEO_KEY = {CoreWeave: "coreweave_bn", Nebius: "nebius_bn", "SpaceX AI": "spacex_ai_bn"};
/* CoreWeave / Nebius / SpaceX AI: single-quarter periods only (multi-quarter FY / 9M / H2 periods are not split) */
const neoQ = (comp, q) => { const r = (CXQ.neo_periods || []).find(p => p.company === comp && p.first_quarter === q && p.last_quarter === q); return r ? r.capex_bn : null; };
function drawCxQ() {
  const Q = CXQ.quarterly, n = Q.length, mode = $("#cxq-mode").value;
  const tot = Q.map(r => CXQ_TK.reduce((a, [k]) => a + r[k], 0));
  const ttm = (arr, i) => i >= 3 ? arr[i] + arr[i - 1] + arr[i - 2] + arr[i - 3] : null;
  const qx = q => +q.slice(0, 4) + (+q.slice(-1) - 1) / 4 + 0.125;
  const val = (k, i) => {
    const s = Q.map(r => r[k]);
    if (mode === "q") return s[i];
    if (mode === "ttm") return ttm(s, i);
    if (mode === "share") { const t = ttm(tot, i); return t ? ttm(s, i) / t : null; }
    return i >= 4 && s[i - 4] > 0 ? s[i] / s[i - 4] - 1 : null;
  };
  const fmt = mode === "share" || mode === "yoy" ? (v => pct(v, 0)) : (v => "$" + v.toFixed(v >= 100 ? 0 : 1) + "bn");
  const S = CXQ_TK.map(([k, nm, col]) => ({name: nm, color: col, points: Q.map((r, i) => ({x: qx(r.cal_quarter), y: val(k, i), note: r.cal_quarter}))}));
  const E7 = Object.fromEntries((CXQ.expanded7 || []).map(r => [r.ttm_ending, r]));
  CXQ_NEO.forEach(([comp, nm, col]) => {
    const key = NEO_KEY[comp];
    const pts = Q.map((r, i) => {
      const q = r.cal_quarter, v = neoQ(comp, q);
      if (mode === "q") return {x: qx(q), y: v, note: q};
      if (mode === "ttm") return {x: qx(q), y: E7[q] ? E7[q][key] : null, note: `TTM to ${q}`};
      if (mode === "share") return {x: qx(q), y: E7[q] ? E7[q][key] / E7[q].total_bn : null, note: `TTM to ${q}, share of the eight`};
      const y0 = Q[i - 4] ? neoQ(comp, Q[i - 4].cal_quarter) : null;
      return {x: qx(q), y: v != null && y0 ? v / y0 - 1 : null, note: q};
    });
    S.push({name: nm, color: col, dash: true, points: pts});
  });
  if (mode === "ttm") S.unshift({name: "Total, eight (with CoreWeave, Nebius and SpaceX AI)", short: "Total, eight", color: "var(--ink-2)", dash: true,
    points: Q.map(r => ({x: qx(r.cal_quarter), y: E7[r.cal_quarter] ? E7[r.cal_quarter].total_bn : null, note: `TTM to ${r.cal_quarter}`}))});
  if (mode === "share") S.forEach(s => { if (!s.dash) s.points.forEach((p, i) => { const q = Q[i].cal_quarter; p.y = E7[q] ? ttm(Q.map(r => r[CXQ_TK.find(t => t[1] === s.name)[0]]), i) / E7[q].total_bn : null; }); });  /* share of all eight, only where the eight-name TTM exists */
  if (mode === "q" || mode === "ttm") S.unshift({name: "Total, five companies", short: "Total", color: "var(--ink)", points: Q.map((r, i) => ({x: qx(r.cal_quarter), y: mode === "q" ? tot[i] : ttm(tot, i), note: r.cal_quarter}))});
  legend("lg-cx-q", S.map(s => ({name: s.name, color: s.color})));
  const qt = x => { const y = Math.floor(x), q = Math.floor((x - y) * 4) + 1; return `Q${q} ${y}`; };
  view("c-cx-q", hst => lineChart(hst, S, {height: 340, xType: "num", yMin: mode === "yoy" ? null : 0, yFmt: fmt, mode: "cross", xFmt: qt,
      xTicks: [2020, 2021, 2022, 2023, 2024, 2025, 2026].map(y => ({x: y + 0.125, label: "Q1 " + y}))}),
    hst => table(hst, [{label: "Quarter", key: "cal_quarter"}].concat(CXQ_TK.map(([k, nm]) => ({label: nm, n: 1, get: r => "$" + r[k].toFixed(2)})),
      CXQ_NEO.map(([comp, nm]) => ({label: nm, n: 1, get: r => { const v = neoQ(comp, r.cal_quarter); if (v != null) return "$" + v.toFixed(2);
        const p = (CXQ.neo_periods || []).find(x => x.company === comp && x.last_quarter === r.cal_quarter); return p ? `$${p.capex_bn.toFixed(2)} (${p.period})` : "–"; }})),
      [{label: "Total", n: 1, get: r => "$" + CXQ_TK.reduce((a, [k]) => a + r[k], 0).toFixed(1)}, {label: "GDP (SAAR, $bn)", n: 1, get: r => Math.round(r.gdp_saar_bn).toLocaleString()},
       {label: "TTM % of GDP", n: 1, get: r => { const i = Q.indexOf(r), t = ttm(tot, i); return t ? (t / ((Q[i].gdp_saar_bn + Q[i - 1].gdp_saar_bn + Q[i - 2].gdp_saar_bn + Q[i - 3].gdp_saar_bn) / 4) * 100).toFixed(2) + "%" : "–"; }}]), [...Q].reverse()));
  // tiles: latest quarter, y/y, TTM
  const host = $("#cx-q-tiles"); host.replaceChildren();
  const last = Q[n - 1], yago = Q[n - 5];
  const tile = (t, v, dlt, s) => { const a = h("div", {class: "tile"}, host); h("div", {class: "t"}, a, t); h("div", {class: "v"}, a, v); if (dlt != null) { const dd = h("div", {class: "d"}, a); h("span", {class: dlt >= 0 ? "up" : "down"}, dd, (dlt >= 0 ? "▲ " : "▼ ") + (Math.abs(dlt) * 100).toFixed(0) + "%"); dd.appendChild(document.createTextNode(" vs a year earlier")); } h("div", {class: "s"}, a, s); };
  tile(`Five hyperscalers, ${last.cal_quarter}`, "$" + tot[n - 1].toFixed(0) + "bn", yago ? tot[n - 1] / tot[n - 5] - 1 : null, "capex in the quarter · SEC filings");
  CXQ_TK.forEach(([k, nm]) => tile(nm, "$" + last[k].toFixed(1) + "bn", yago && yago[k] > 0 ? last[k] / yago[k] - 1 : null, `${last.cal_quarter} capex`));
  CXQ_NEO.forEach(([comp, nm]) => { const v = neoQ(comp, last.cal_quarter), v0 = yago ? neoQ(comp, yago.cal_quarter) : null;
    if (v != null) tile(nm, "$" + v.toFixed(1) + "bn", v0 ? v / v0 - 1 : null, `${last.cal_quarter} capex`); });
  const e7 = (CXQ.expanded7 || []).slice(-1)[0];
  if (e7) tile(`Eight names, TTM to ${e7.ttm_ending}`, `${e7.total_pct.toFixed(2)}% of GDP`, null, `$${Math.round(e7.total_bn)}bn: the five + CoreWeave $${e7.coreweave_bn.toFixed(1)}bn + Nebius $${e7.nebius_bn.toFixed(1)}bn + SpaceX AI $${e7.spacex_ai_bn.toFixed(1)}bn`);
  table($("#cx-of"), [{label: "Fiscal quarter ends", key: "fiscal_quarter_end"}, {label: "Oracle capex ($bn)", n: 1, get: r => "$" + r.capex_bn.toFixed(2)}], [...CXQ.oracle_fiscal].reverse());
}
/* Capex cycles (Macro) and Hyperscaler capex (Infrastructure) are drawn from one API call */
let CAPEX_ONCE = null;
async function capexTab() {
  CAPEX_ONCE = CAPEX_ONCE || loadCapex();
  await CAPEX_ONCE;
  Object.keys(VIEWS).forEach(id => { const n = document.getElementById(id); if (n && n.offsetParent && VIEWS[id].mode === "chart") render(id); });
}
async function loadCapex() {
  const d = await api("/api/capex-cycles");
  if (!d.series.length) { $("#cx-tiles").textContent = "No data - run bofa-capex-cycles/extract_pdf.py."; return; }
  const S = d.series, by = Object.fromEntries(S.map(s => [s.key, s]));
  const fx = v => v.toFixed(2) + "%";
  /* First-hand rebuild in the same shape as d.series: points [true calendar position, value, label].
     Annual series = calendar-year steps (Y..Y+1); hyperscalers = TTM at the real quarter end, from the TTM to 2022Q1
     (BofA's first point) to the latest filing; the expanded line adds CoreWeave, Nebius and SpaceX AI. */
  const qEnd = q => +q.slice(0, 4) + +q.slice(-1) / 4;
  const FHS = [];
  ["rail", "og70s", "telecom", "shale"].forEach(k => {
    const rowsK = (d.detail || []).filter(r => r.series === k).map(r => [+r.period, r.firsthand_pct]).sort((a, b) => a[0] - b[0]);
    if (!rowsK.length) return;
    const pts = k === "rail" ? rowsK.map(([y, v]) => [y, v, String(y)]) : rowsK.flatMap(([y, v]) => [[y, v, String(y)], [y + 1, v, String(y)]]);
    FHS.push({key: k, label: by[k] ? by[k].label : k, points: pts});
  });
  FHS.push({key: "hyper", label: "Five hyperscalers (first-hand)", points: (d.extended || []).filter(r => r.ttm_ending >= "2022Q1").map(r => [qEnd(r.ttm_ending), r.pct, `TTM to ${r.ttm_ending}`])});
  if ((d.expanded7 || []).length) FHS.push({key: "exp", label: "Five + CoreWeave + Nebius + SpaceX AI (first-hand)", points: d.expanded7.map(r => [qEnd(r.ttm_ending), r.total_pct, `TTM to ${r.ttm_ending}`])});
  const colOf = k => k === "exp" ? "#8a5cd6" : CX_COL[k];
  const shortOf = (k, fh) => k === "exp" ? "Eight names" : fh && k === "hyper" ? "Five (first-hand)" : CX_SHORT[k];
  const renderMain = (SS, fhMode) => {
    /* BofA data re-dated to the true period end (+0.75 year) unless the PDF placement is asked for; railroads have no shift */
    const shift = !fhMode && $("#cx-date").value === "end" ? 0.75 : 0, trueDates = fhMode || shift > 0;
    $("#cx-date").disabled = fhMode;
    const series = SS.map(s => ({name: s.label, short: shortOf(s.key, fhMode), color: colOf(s.key), markers: s.key === "exp", dash: s.key === "exp",
      points: s.points.map(p => ({x: s.key === "rail" ? cxPos("rail", p[0]) : p[0] + shift, y: p[1],
        note: fhMode ? p[2] : s.key === "rail" ? null : p[2] != null ? `${p[2]} annual value` : cxQ(p[0])}))}));
    legend("lg-cx", series.map(s => ({name: s.name, color: s.color, dash: s.dash})));
    const ticks = [{x: 1955, label: "1899"}, {x: 1960, label: "1919"}, {x: 1965, label: "//"}].concat([1970, 1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025].map(y => ({x: y, label: String(y)})));
    const title = x => x < 1965 ? String(Math.round((x - 1960) * 4 + 1919)) : trueDates ? (x > 2020 ? `Four quarters to Q${Math.round((x % 1) * 4) || 4} ${Math.round((x % 1) * 4) ? Math.floor(x) : Math.floor(x) - 1}` : String(Math.floor(x))) : x > 2020 ? cxQ(x) : "Drawn at " + x.toFixed(2);
    view("c-cx", hst => lineChart(hst, series, {height: 380, xType: "num", xTicks: ticks, x0: 1954.5, x1: trueDates ? 2027 : 2026, yMin: 0, yMax: 3, yFmt: (v, t) => t ? v.toFixed(1) + "%" : fx(v), mode: "near", xFmt: title}),
      hst => table(hst, [{label: "Series", key: "label"}, {label: fhMode ? "Year / four quarters to" : "Year / chart point", get: r => r.year ?? cxQ(r.pos)}, {label: "% of US GDP", n: 1, get: r => fx(r.v)}],
        fhMode ? SS.flatMap(s => s.points.filter((p, i, a) => i === a.findIndex(q => q[2] === p[2])).map(p => ({label: s.label, year: p[2], v: p[1]})))
        : SS.flatMap(s => s.key === "rail" ? s.points.map(p => ({label: s.label, year: p[0], v: p[1]}))
          : s.key.startsWith("hyper") ? s.points.map(p => ({label: s.label, pos: p[0], v: p[1]}))
          : s.points.filter((p, i, a) => i === a.findIndex(q => q[2] === p[2])).map(p => ({label: s.label, year: p[2], v: p[1]})))));

    const hyperStart = (SS.find(s => s.key === "hyper") || {points: [[0]]}).points[0][0];
    const al = SS.map(s => ({name: s.label, short: shortOf(s.key, fhMode), color: colOf(s.key), markers: s.key === "exp", dash: s.key === "exp",
      points: s.points.map(p => ({x: p[0] - (s.key === "exp" ? hyperStart : s.points[0][0]), y: p[1], note: fhMode ? p[2] : s.key === "rail" ? String(p[0]) : p[2] != null ? String(p[2]) : cxQ(p[0])}))}));
    legend("lg-cx-al", al.map(s => ({name: s.name, color: s.color, dash: s.dash})));
    view("c-cx-al", hst => lineChart(hst, al, {height: 340, xType: "num", x0: 0, x1: 22, yMin: 0, yMax: 3, yFmt: (v, t) => t ? v.toFixed(1) + "%" : fx(v), mode: "near", xFmt: v => `Year ${(+v).toFixed(v % 1 ? 2 : 0)} of the cycle`}),
      hst => table(hst, [{label: "Series", key: "s"}, {label: "Years since start", n: 1, get: r => r.x.toFixed(2)}, {label: "% of US GDP", n: 1, get: r => fx(r.y)}],
        al.flatMap(s => s.points.map(p => ({s: s.name, x: p.x, y: p.y})))));

    // summary: one row per cycle
    const rws = SS.map(s => {
      const P = s.points, pk = P.reduce((a, b) => b[1] > a[1] ? b : a);
      const lab = p => fhMode ? p[2] : s.key === "rail" ? String(p[0]) : p[2] != null ? String(p[2]) : cxQ(p[0]);
      return {key: s.key, label: s.label, start: lab(P[0]), end: lab(P[P.length - 1]), v0: P[0][1], peak: pk[1], pkAt: lab(pk), last: P[P.length - 1][1],
        yrs: fhMode || s.key === "rail" ? pk[0] - P[0][0] : (pk[2] ?? pk[0]) - (P[0][2] ?? P[0][0])};
    });
    table($("#cx-sum"), [{label: "Cycle", key: "label"}, {label: "From", key: "start"}, {label: "To", key: "end"}, {label: "Start", n: 1, get: r => fx(r.v0)},
      {label: "Peak", n: 1, get: r => fx(r.peak)}, {label: "Peak at", key: "pkAt"}, {label: "Years to peak", n: 1, get: r => r.yrs.toFixed(r.yrs % 1 ? 2 : 0)},
      {label: "Last", n: 1, get: r => fx(r.last)}, {label: "Peak ÷ start", n: 1, get: r => (r.peak / r.v0).toFixed(1) + "×"},
      {label: "Peak to last", n: 1, get: r => r.last < r.peak ? "−" + Math.round((1 - r.last / r.peak) * 100) + "%" : "still rising"}], rws);
    $("#cx-src-note").textContent = fhMode
      ? "First-hand rebuild: NBER tables, BEA Fixed Assets and GDP, SEC filings and SpaceX's prospectus - no BofA input. Annual series are calendar-year steps; hyperscalers are the four quarters to each real quarter end. BofA's lease-adjusted line can't be rebuilt; the dashed line adds CoreWeave, Nebius and SpaceX AI instead."
      : shift ? "BofA's exhibit values (PDF vector), re-dated: each post-1970 point moved to the true end of the period it measures (+3 quarters), so BofA's last hyperscaler point sits at Q1 2026. Railroads are unchanged. Switch Dating to see the placement in the original PDF."
      : "BofA's exhibit exactly as drawn in the PDF: each post-1970 point sits three quarters before the end of its four-quarter window (half a year before the start of its final quarter).";
    return rws;
  };
  const rows = renderMain(S, false);
  const rerenderMain = () => renderMain($("#cx-src").value === "fh" ? FHS : S, $("#cx-src").value === "fh");
  $("#cx-src").addEventListener("change", rerenderMain);
  $("#cx-date").addEventListener("change", rerenderMain);

  const host = $("#cx-tiles"); host.replaceChildren();
  const hy = rows.find(r => r.key === "hyper"), hla = rows.find(r => r.key === "hyperLA");
  const prior = rows.filter(r => !r.key.startsWith("hyper")).sort((a, b) => b.peak - a.peak);
  const tile = (t, v, d, s) => { const a = h("div", {class: "tile"}, host); h("div", {class: "t"}, a, t); h("div", {class: "v"}, a, v); if (d) h("div", {class: "d"}, a, d); h("div", {class: "s"}, a, s); };
  const xl = (d.extended || []).slice(-1)[0];
  tile("Hyperscaler capex, % of US GDP", fx(hy.last), `${(hy.last / hy.v0).toFixed(1)}× in four years`, `${hy.end} (BofA) · lease-adjusted ${fx(hla.last)}`);
  if (xl) tile(`First-hand, TTM to ${xl.ttm_ending}`, fx(xl.pct), `$${Math.round(xl.capex_bn)}bn of capex · ${(xl.pct >= prior[1].peak ? "above" : "below")} the O&G 1981 peak`, "SEC filings of the five ÷ BEA GDP, one quarter past BofA");
  const x7 = (d.expanded7 || []).slice(-1)[0];
  if (x7) tile(`+ CoreWeave + Nebius + SpaceX AI, TTM to ${x7.ttm_ending}`, fx(x7.total_pct), `$${Math.round(x7.total_bn)}bn · ${Math.abs(Math.round((x7.total_pct - prior[1].peak) * 100)) === 0 ? "level with" : x7.total_pct > prior[1].peak ? "above" : "below"} the O&G 1981 peak (${fx(prior[1].peak)})`, "eight names, SEC filings + SpaceX prospectus ÷ BEA GDP");
  prior.forEach(r => tile(`${CX_SHORT[r.key]} peak`, fx(r.peak), (hla.last >= r.peak ? "▲ hyperscalers (LA) already above" : "▼ hyperscalers still below") + ` by ${Math.abs(Math.round((hla.last - r.peak) * 100))}bp`, `${r.pkAt} · ${r.yrs} years after ${r.start}`));
  // first-hand check: table per panel + hyperscaler line, BofA vs first-hand extended
  const VERD = {rail: "Exact", og70s: "Exact", shale: "Exact", telecom: "Exact", hyper: "Matches"};
  const chk = (d.check || []).map(c => ({...c, label: by[c.key] ? by[c.key].label : c.key, verdict: VERD[c.key] || ""}));
  chk.push({key: "hyperLA", label: by.hyperLA ? by.hyperLA.label : "Hyperscalers (lease adjusted)", n: null, max: null, mean: null, rmse: null, verdict: "Not reproducible",
    source: "BofA's lease adjustment is 1–2.5× the finance-lease additions the companies tag; finance + principal repayments or operating-lease additions don't fit either. Treat it as BofA's own estimate."});
  const pp3 = v => v == null ? "–" : v.toFixed(3) + "pp";
  table($("#cx-fh"), [{label: "Panel", key: "label"}, {label: "First-hand definition", key: "source"}, {label: "Points", n: 1, get: r => r.n ?? "–"},
    {label: "Max |diff|", n: 1, get: r => pp3(r.max)}, {label: "Mean |diff|", n: 1, get: r => pp3(r.mean)}, {label: "Verdict", key: "verdict"}], chk);
  if (by.hyper && (d.extended || []).length) {
    const FH = [{name: "BofA exhibit (PDF vector)", color: CX_COL.hyper, points: by.hyper.points.map(p => ({x: p[0] + 0.75, y: p[1], note: cxQ(p[0])}))},
      {name: "First-hand: SEC capex of the five ÷ BEA GDP", short: "First-hand", color: "var(--s2)", dash: true,
       points: d.extended.map(r => ({x: cxPosOfQ(r.ttm_ending) + 0.75, y: r.pct, note: `TTM to ${r.ttm_ending}: $${Math.round(r.capex_bn)}bn`}))}];
    if ((d.expanded7 || []).length) FH.push({name: "Eight: the five + CoreWeave + Nebius + SpaceX AI (where reported periods allow)", short: "Eight names", color: "#8a5cd6",
       points: d.expanded7.map(r => ({x: cxPosOfQ(r.ttm_ending) + 0.75, y: r.total_pct, note: `TTM to ${r.ttm_ending}: $${Math.round(r.total_bn)}bn`}))});
    legend("lg-cx-fh", FH.map(s => ({name: s.name, color: s.color, dash: s.dash})));
    const qlab = x => { const y = Math.floor(x - 0.25 + 1e-9), q = Math.round((x - 0.25 - y) * 4) + 1; return `Four quarters to Q${q} ${y}`; };
    view("c-cx-fh", hst => lineChart(hst, FH, {height: 300, xType: "num", yMin: 0, yFmt: (v, t) => t ? v.toFixed(1) + "%" : fx(v), mode: "cross", xFmt: qlab,
        xTicks: [2021, 2022, 2023, 2024, 2025, 2026, 2027].map(y => ({x: y + 0.25, label: "Q1 " + y}))}),
      hst => table(hst, [{label: "Series", key: "s"}, {label: "Four quarters to", key: "q"}, {label: "BofA (PDF)", n: 1, get: r => r.v == null ? "–" : fx(r.v)}, {label: "First-hand", n: 1, get: r => fx(r.f)}, {label: "Diff", n: 1, get: r => r.v == null ? "–" : (r.v - r.f >= 0 ? "+" : "−") + Math.abs(r.v - r.f).toFixed(3) + "pp"}],
        d.extended.map(r => { const m = by.hyper.points.find(p => Math.abs(cxPosOfQ(r.ttm_ending) - p[0]) < 0.01); return {s: "Hyperscalers", q: r.ttm_ending, v: m ? m[1] : null, f: r.pct}; }).reverse()));
  }
  if ((d.quarterly || []).length) { CXQ = d; drawCxQ(); $("#cxq-mode").addEventListener("change", drawCxQ); }
  if ((d.extended || []).length) {
    const drawOwn = () => {
      const pctMode = $("#cx-own-mode").value === "pct", qx = q => +q.slice(0, 4) + (+q.slice(-1) - 1) / 4 + 0.125;
      const f = pctMode ? (v, t) => t ? v.toFixed(1) + "%" : fx(v) : v => "$" + Math.round(v) + "bn";
      const S = [{name: "Five hyperscalers", color: CX_COL.hyper, markers: false, points: d.extended.map(r => ({x: qx(r.ttm_ending), y: pctMode ? r.pct : r.capex_bn, note: `TTM to ${r.ttm_ending}: $${Math.round(r.capex_bn)}bn, ${fx(r.pct)} of GDP`}))},
        {name: "Five + CoreWeave + Nebius + SpaceX AI", short: "Eight names", color: "#8a5cd6", dash: true, points: (d.expanded7 || []).map(r => ({x: qx(r.ttm_ending), y: pctMode ? r.total_pct : r.total_bn,
          note: `TTM to ${r.ttm_ending}: $${Math.round(r.total_bn)}bn (CoreWeave $${r.coreweave_bn.toFixed(1)}bn, Nebius $${r.nebius_bn.toFixed(1)}bn, SpaceX AI $${r.spacex_ai_bn.toFixed(1)}bn), ${fx(r.total_pct)} of GDP`}))}];
      const marks = [];
      if (pctMode) prior.forEach(r => S.push({name: `${CX_SHORT[r.key]} peak ${r.pkAt}`, short: `${CX_SHORT[r.key]} ${r.pkAt}`, color: CX_COL[r.key], dash: true, markers: false,
        points: [{x: qx(d.extended[0].ttm_ending), y: r.peak}, {x: qx(d.extended[d.extended.length - 1].ttm_ending), y: r.peak}]}));
      legend("lg-cx-own", S.map(s => ({name: s.name, color: s.color, dash: s.dash})));
      const y0 = +d.extended[0].ttm_ending.slice(0, 4);
      view("c-cx-own", hst => lineChart(hst, S, {height: 360, xType: "num", yMin: 0, yMax: pctMode ? 2.5 : null, yFmt: f, mode: "near", xFmt: x => { const y = Math.floor(x), q = Math.floor((x - y) * 4) + 1; return `Four quarters to Q${q} ${y}`; },
          xTicks: Array.from({length: 8}, (_, i) => y0 + i).map(y => ({x: y + 0.125, label: "Q1 " + y}))}),
        hst => { const E7 = Object.fromEntries((d.expanded7 || []).map(r => [r.ttm_ending, r]));
          table(hst, [{label: "Four quarters to", key: "ttm_ending"}, {label: "Five ($bn)", n: 1, get: r => Math.round(r.capex_bn)}, {label: "Five, % GDP", n: 1, get: r => fx(r.pct)},
            {label: "CoreWeave ($bn)", n: 1, get: r => E7[r.ttm_ending] ? E7[r.ttm_ending].coreweave_bn.toFixed(1) : "–"}, {label: "Nebius ($bn)", n: 1, get: r => E7[r.ttm_ending] ? E7[r.ttm_ending].nebius_bn.toFixed(1) : "–"}, {label: "SpaceX AI ($bn)", n: 1, get: r => E7[r.ttm_ending] ? E7[r.ttm_ending].spacex_ai_bn.toFixed(1) : "–"},
            {label: "Eight ($bn)", n: 1, get: r => E7[r.ttm_ending] ? Math.round(E7[r.ttm_ending].total_bn) : "–"}, {label: "Eight, % GDP", n: 1, get: r => E7[r.ttm_ending] ? fx(E7[r.ttm_ending].total_pct) : "–"}], [...d.extended].reverse()); });
    };
    drawOwn();
    $("#cx-own-mode").addEventListener("change", drawOwn);
  }
  if (d.xlsx) $("#cx-xlsx").href = "/download-capex/" + encodeURIComponent(d.xlsx);
}

/* ================================================================ credit spreads */
let HY = null;
const NBER = [["2001-03-01", "2001-11-30"], ["2007-12-01", "2009-06-30"], ["2020-02-01", "2020-04-30"]];
const bp = v => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v * 100)) + "bp";
const ord = v => { const n = Math.round(v * 100), s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({1: "st", 2: "nd", 3: "rd"})[n % 10] || "th"; return n + s; };
function hyPts(key, start) {
  // long ranges: keep the last close of each week so the chart stays light
  const pts = HY.series[key].points.filter(p => !start || T(p[0]) >= start);
  const thin = pts.length > 1500 ? pts.filter((p, i) => i === pts.length - 1 || new Date(T(pts[i + 1][0])).getUTCDay() < new Date(T(p[0])).getUTCDay()) : pts;
  return thin.map(p => ({x: T(p[0]), y: p[1]}));
}
function median(a) { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
function drawCredit() {
  const st = HY.stats, host = $("#hy-tiles"); host.replaceChildren();
  [["DFII10", "10-year real yield"], ["THREEFYTP10", "10-year term premium"], ["BAMLH0A1HYBB", "BB spread (OAS)"], ["BAMLH0A3HYC", "CCC & lower spread (OAS)"], ["gap", "CCC minus BB"]].forEach(([k, title]) => {
    const r = st[k]; if (!r) return;
    const a = h("div", {class: "tile"}, host);
    h("div", {class: "t"}, a, title);
    h("div", {class: "v"}, a, k === "gap" ? r.value.toFixed(2) + "pp" : r.value.toFixed(2) + "%");
    if (r.d7 != null) { const g = r.value - r.d7, dd = h("div", {class: "d"}, a); h("span", {class: g > 0.004 ? "down" : g < -0.004 ? "up" : ""}, dd, (g > 0.004 ? "▲ " : g < -0.004 ? "▼ " : "● ") + bp(g)); dd.appendChild(document.createTextNode(` vs a week earlier · ${bp(r.value - r.d365)} vs a year`)); }
    h("div", {class: "s"}, a, `${fmtDate(T(r.date))} · ${ord(r.pctile_all)} percentile since ${r.first.slice(0, 4)} (${ord(r.pctile_2010)} since 2010)`);
    const sp = spark(HY.series[k].points.slice(-260).map(p => p[1]), "var(--s1)"); if (sp) a.appendChild(sp);
  });

  const marks = NBER.map(([a, b]) => ({x0: T(a), x1: T(b), label: "Recession"}));
  if (HY.series.DFII10) {
    const rd = +$("#rt-range").value, rend = Math.max(...["DFII10", "DGS10"].filter(k => st[k]).map(k => T(st[k].date))), rstart = rd ? rend - rd * 864e5 : T("2003-01-01");
    const R = [["DGS10", "var(--ink-2)", $("#rt-nominal").checked], ["DFII10", "var(--s1)", true], ["THREEFYTP10", "var(--s2)", true], ["breakeven", "var(--s3)", $("#rt-be").checked]]
      .filter(([k, , on]) => on && HY.series[k]).map(([k, col]) => ({name: HY.series[k].label, short: HY.series[k].short, color: col, dash: k === "DGS10", markers: false, points: hyPts(k, rstart)}));
    legend("lg-rates", R.map(s => ({name: s.name, color: s.color, dash: s.dash})));
    const lo = Math.min(0, ...R.flatMap(s => s.points.map(p => p.y)));
    view("c-rates", hst => lineChart(hst, R, {height: 340, yFmt: (v, tick) => tick ? +v.toFixed(1) + "%" : v.toFixed(2) + "%", yMin: Math.floor(lo), mode: "cross", title: x => fmtDate(x), marks}),
      hst => { const L = Object.fromEntries(R.map(s => [s.short, Object.fromEntries(s.points.map(p => [p.x, p.y]))])), dates = [...new Set(R.flatMap(s => s.points.map(p => p.x)))].sort((a, b) => b - a);
        table(hst, [{label: "Date", get: x => new Date(x).toISOString().slice(0, 10)}].concat(R.map(s => ({label: s.short, n: 1, get: x => L[s.short][x] == null ? "–" : L[s.short][x].toFixed(2) + "%"}))), dates); });
  }
  const days = +$("#hy-range").value, end = T(st.BAMLH0A3HYC.date), start = days ? end - days * 864e5 : null;
  const S = [["BAMLH0A3HYC", "var(--s2)"], ["BAMLH0A1HYBB", "var(--s1)"]].filter(([k]) => HY.series[k]).map(([k, col]) => ({name: HY.series[k].label, short: HY.series[k].short, color: col, markers: false, points: hyPts(k, start)}));
  legend("lg-hy", S.map(s => ({name: s.name, color: s.color})));
  const log = $("#hy-scale").value === "log";
  view("c-hy", hst => lineChart(hst, S, {height: 360, yFmt: (v, tick) => tick ? +v.toFixed(1) + "%" : v.toFixed(2) + "%", log, yMin: log ? null : 0, mode: "cross", title: x => fmtDate(x), marks}),
    hst => { const L = Object.fromEntries(S.map(s => [s.short, Object.fromEntries(s.points.map(p => [p.x, p.y]))])), dates = [...new Set(S.flatMap(s => s.points.map(p => p.x)))].sort((a, b) => b - a);
      table(hst, [{label: "Date", get: r => new Date(r).toISOString().slice(0, 10)}].concat(S.map(s => ({label: s.short + " OAS", n: 1, get: r => L[s.short][r] == null ? "–" : L[s.short][r].toFixed(2) + "%"})), [{label: "CCC − BB", n: 1, get: r => L["CCC & lower"][r] != null && L.BB[r] != null ? (L["CCC & lower"][r] - L.BB[r]).toFixed(2) + "pp" : "–"}]), dates); });

  [["gap", "c-hy-gap", v => v.toFixed(1) + "pp", "var(--s3)"], ["ratio", "c-hy-ratio", v => v.toFixed(1) + "×", "var(--s4)"]].forEach(([k, id, f, col]) => {
    if (!HY.series[k]) return;
    const pts = hyPts(k, start), med = median(HY.series[k].points.map(p => p[1]));
    const S2 = [{name: HY.series[k].label, color: col, markers: false, points: pts},
      {name: "Median since 1996", short: "1996+ median", color: "var(--axis)", dash: true, markers: false, points: [{x: pts[0].x, y: med}, {x: pts[pts.length - 1].x, y: med}]}];
    view(id, hst => lineChart(hst, S2, {height: 260, yFmt: (v, tick) => tick ? f(v) : (k === "gap" ? v.toFixed(2) + "pp" : v.toFixed(2) + "×"), yMin: 0, mode: "cross", title: x => fmtDate(x), marks}),
      hst => table(hst, [{label: "Date", get: r => new Date(r.x).toISOString().slice(0, 10)}, {label: HY.series[k].label, n: 1, get: r => f(r.y)}], [...pts].reverse()));
  });

  const rows = ["DFII10", "THREEFYTP10", "DGS10", "breakeven", "BAMLH0A1HYBB", "BAMLH0A3HYC", "gap", "ratio"].map(k => st[k] && {k, ...st[k]}).filter(Boolean);
  const fv = r => r.k === "ratio" ? r.value.toFixed(2) + "×" : r.value.toFixed(2) + (r.k === "gap" ? "pp" : "%");
  const fx = (r, v) => r.k === "ratio" ? v.toFixed(2) + "×" : v.toFixed(2) + (r.k === "gap" ? "pp" : "%");
  const ch = (r, b) => b == null ? "–" : r.k === "ratio" ? (r.value - b >= 0 ? "+" : "−") + Math.abs(r.value - b).toFixed(2) + "×" : bp(r.value - b);
  table($("#hy-latest"), [{label: "Series", get: r => r.label + (/^[A-Z0-9]+$/.test(r.k) ? ` (${r.k})` : "")}, {label: "Latest", n: 1, get: fv}, {label: "As of", key: "date"},
    {label: "1 week", n: 1, get: r => ch(r, r.d7)}, {label: "1 month", n: 1, get: r => ch(r, r.d30)}, {label: "1 year", n: 1, get: r => ch(r, r.d365)}, {label: "YTD", n: 1, get: r => ch(r, r.ytd_base)},
    {label: "Pctile, full history", n: 1, get: r => ord(r.pctile_all) + " (" + r.first.slice(0, 4) + "+)"}, {label: "Pctile since 2010", n: 1, get: r => ord(r.pctile_2010)},
    {label: "Low", n: 1, get: r => `${fx(r, r.min)} (${r.min_date.slice(0, 7)})`}, {label: "High", n: 1, get: r => `${fx(r, r.max)} (${r.max_date.slice(0, 7)})`}], rows);
  const ck = $("#hy-checks"); ck.replaceChildren();
  if (HY.checks.length) { h("h3", null, ck, "Revisions found (FRED now reports a different value for a stored day; FRED's value was kept)"); const box = h("div", {class: "tblwrap"}, ck);
    table(box, [{label: "Checked", key: "checked"}, {label: "Series", key: "series"}, {label: "Date", key: "date"}, {label: "Stored", key: "stored", n: 1}, {label: "FRED", key: "fred", n: 1}], HY.checks); }
}
async function loadCredit() {
  HY = await api("/api/spreads");
  if (!HY.stats.BAMLH0A3HYC) { $("#hy-tiles").textContent = "No spread data yet - run credit-spreads/spreads_update.py."; return; }
  $("#hy-range").addEventListener("change", drawCredit);
  $("#hy-scale").addEventListener("change", drawCredit);
  ["#rt-range", "#rt-nominal", "#rt-be"].forEach(id => $(id).addEventListener("change", drawCredit));
  drawCredit();
}

/* ================================================================ data */
let poll = null;
async function refreshStatus(d) {
  d = d || await api("/api/update");
  const st = d.state || {}, kv = $("#d-state"); kv.replaceChildren();
  [["Latest BTOS period", st.latest_smpdt + (st.published ? ` (published ${st.published})` : "")], ["Tracker data", META.tracker_wave ? fmtMonth(T(META.tracker_wave)) + " survey" : "–"], ["Workbook built", (st.built || "–").replace("T", " ")],
   ["Update job", d.running ? "running since " + d.started.replace("T", " ") : d.finished ? `finished ${d.finished.replace("T", " ")} (exit ${d.rc})` : "idle"]].forEach(([k, v]) => { h("dt", null, kv, k); h("dd", null, kv, v); });
  $("#d-log").textContent = (d.log || []).join("\n");
  $("#d-run").disabled = $("#d-force").disabled = d.running;
  const fl = $("#d-files"); fl.replaceChildren();
  (d.workbooks || []).forEach((w, i) => { const li = h("li", null, fl); h("a", {href: "/download/" + encodeURIComponent(w)}, li, w); if (!i) li.appendChild(document.createTextNode("  (latest)")); });
  [["history.csv", "BTOS AI history, long format (all levels, answers, SEs)"], ["tracker.csv", "GenAI Adoption Tracker history, long format"]].forEach(([f, n]) => { const li = h("li", null, fl); h("a", {href: "/download/" + f}, li, n); });
  if (d.running && !poll) poll = setInterval(refreshStatus, 3000);
  if (!d.running && poll) { clearInterval(poll); poll = null; if (d.rc === 0) setTimeout(() => location.reload(), 800); }
}
function loadData() {
  const go = force => fetch(`/api/update${force ? "?force=1" : ""}`, {method: "POST"}).then(r => r.json()).then(refreshStatus);
  $("#d-run").addEventListener("click", () => go(false));
  $("#d-force").addEventListener("click", () => go(true));
  refreshStatus();
}

const LOADERS = {overview: loadOverview, firms: loadFirms, workers: loadWorkers, compare: loadCompare, fed: loadFed, assistants: loadAssistants, tokens: loadTokens, gpu: loadGpu, credit: loadCredit, capex: capexTab, hcapex: capexTab, ramp: loadRamp, arr: loadArr, data: loadData};
async function boot(again) {
  META = await api("/api/meta");
  document.body.classList.toggle("hosted", !!META.hosted);
  $("#asof").textContent = `BTOS to ${fmtDate(T(META.btos_ref_end))} · tracker ${META.tracker_wave ? fmtMonth(T(META.tracker_wave)) : "–"}`;
  badge();
  if (!again) showTab(location.hash.slice(1) || "overview");
}
boot().catch(e => { document.querySelector("main").prepend(h("p", {class: "bad"}, null, "Could not load data: " + e.message)); });
