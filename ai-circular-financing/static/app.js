/* AI Circular Financing - front end (vanilla JS + SVG, no external libraries). */
'use strict';
(function () {
  // ------------------------------------------------------------ helpers --
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const NS = 'http://www.w3.org/2000/svg';
  // true on the GitHub Pages copy (export_site.py): data comes from data.json, no editing
  const STATIC = !!window.ACF_STATIC;
  const READONLY = STATIC || !!window.ACF_HOSTED;  // GitHub Pages build or Render copy
  const BASE = window.ACF_BASE || '';  // '/circular' when mounted inside the AI Adoption Monitor

  function svg(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, attrs) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = [].concat(arguments[i]);
      for (const c of kids) {
        if (c == null || c === false) continue;
        e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      }
    }
    return e;
  }
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const trimZeros = s => (s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  function fmtBn(v) {
    if (v == null || isNaN(v)) return 'n/d';
    const a = Math.abs(v);
    if (a >= 1000) return '$' + trimZeros((v / 1000).toFixed(a >= 10000 ? 1 : 2)) + 'tn';
    if (a >= 100) return '$' + Math.round(v) + 'bn';
    if (a >= 1) return '$' + trimZeros(v.toFixed(1)) + 'bn';
    if (a > 0) return '$' + Math.round(v * 1000) + 'm';
    return '$0';
  }
  const fmtPct = v => (v == null ? 'n/d' : trimZeros(v.toFixed(1)) + '%');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(s) {
    if (!s) return '';
    const p = s.split('-');
    return (p[2] ? +p[2] + ' ' : '') + MONTHS[+p[1] - 1] + ' ' + p[0];
  }
  const fmtMonth = s => (s ? MONTHS[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4) : '');
  function niceMax(v) {
    if (v <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v) return m * e;
    return 10 * e;
  }
  function ticks(max, n) {
    const raw = max / (n || 4);
    const e = Math.pow(10, Math.floor(Math.log10(raw)));
    let step = e;
    for (const m of [1, 2, 2.5, 5, 10]) { if (m * e >= raw) { step = m * e; break; } }
    const out = [];
    for (let v = 0; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  const isDark = () => getComputedStyle(document.documentElement).colorScheme.indexOf('dark') >= 0;
  function domain(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function withRetry(fn, host) {
    // hidden/background panes report width 0 at load - try again shortly
    if (!S.data) return false;
    if (host.clientWidth > 0) return true;
    fn._tries = (fn._tries || 0) + 1;
    if (fn._tries < 40) setTimeout(fn, 150);
    return false;
  }

  // ------------------------------------------------------------- model --
  const GROUPS = [
    { id: 'g1', label: 'Equity & credit', long: 'Equity & credit (investments, loans)', types: ['investment', 'credit'] },
    { id: 'g2', label: 'Purchases', long: 'Purchase commitments (compute, chips, cloud, licences)', types: ['purchase', 'licensing', 'revenue_share'] },
    { id: 'g3', label: 'Backstops & warrants', long: 'Backstops, guarantees & warrants', types: ['backstop', 'stock_grant'] },
  ];
  const GROUP = Object.fromEntries(GROUPS.map(g => [g.id, g]));
  const groupOf = t => (GROUPS.find(g => g.types.indexOf(t) >= 0) || GROUPS[1]).id;
  const TYPE_LABEL = {
    investment: 'equity', credit: 'loan / credit', backstop: 'backstop / guarantee',
    stock_grant: 'warrants / shares', purchase: 'purchase commitment', licensing: 'licence / acqui-hire',
    revenue_share: 'revenue share',
  };
  const CAT_LABEL = {
    investor_is_counterparty: 'Investor is also supplier / customer',
    supplier_finances_customer: 'Supplier finances customer',
    customer_finances_supplier: 'Customer finances supplier',
    reciprocal_commercial: 'Reciprocal commercial',
  };
  const ROLE_LABEL = {
    lab: 'AI lab', chips: 'chips & hardware', cloud: 'hyperscaler / cloud', neocloud: 'neocloud',
    investor: 'strategic investor', datacenter: 'data-centre developer', energy: 'power & energy',
    financial: 'financial investor', other: 'other',
  };
  const MID_ORDER = ['Nvidia', 'Microsoft', 'Oracle', 'SoftBank', 'Amazon', 'Google', 'Broadcom', 'Meta', 'AMD',
    'Intel', 'Micron', 'SK hynix', 'Samsung', 'Cisco', 'MGX', 'G42', 'Salesforce', 'Dell'];
  const SUPERSEDED = /superseded|cancel|stall|lapsed|terminat|withdr|abandon|replaced|collapsed|scrapped/i;

  const S = {
    data: null, deals: [], legs: [], allLegs: [], roles: new Map(), layerMap: new Map(),
    f: { period: 'all', from: '2023-01-01', to: '', company: '', g: { g1: true, g2: true, g3: true }, cat: '', live: false, firm: false },
    tl: { m: 'usd', c: 'q' }, rs: 'from', sort: { key: 'date', dir: -1 }, q: '',
  };
  const roleOf = n => S.roles.get(n) || 'other';
  const isSuperseded = d => SUPERSEDED.test(d.status || '');

  function periodRange(p) {
    const today = S.data.meta.today;
    const back = days => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
    switch (p) {
      case '2023': return ['2023-01-01', '2023-12-31'];
      case '2024': return ['2024-01-01', '2024-12-31'];
      case '2025': return ['2025-01-01', '2025-12-31'];
      case '2026': return ['2026-01-01', today];
      case 'bbg': return ['2023-01-01', '2025-10-07'];
      case 'postbbg': return ['2025-10-08', today];
      case '90d': return [back(90), today];
      case 'custom': return [S.f.from || '2023-01-01', S.f.to || today];
      default: return ['2023-01-01', today];
    }
  }

  function applyFilters() {
    const f = S.f;
    const [from, to] = periodRange(f.period);
    f.from = from; f.to = to;
    const touches = l => !f.company || l.from === f.company || l.to === f.company;
    S.deals = S.data.deals.filter(d =>
      d.date >= from && d.date <= to &&
      (!f.cat || d.bis_category === f.cat) &&
      (!f.live || !isSuperseded(d)) &&
      (!f.firm || d.confidence === 'high') &&
      d.legs.some(l => f.g[groupOf(l.type)] && touches(l)));
    S.legs = [];
    for (const d of S.deals) {
      if (!d.in_totals) continue;
      for (const l of d.legs) {
        const g = groupOf(l.type);
        if (!f.g[g] || !touches(l)) continue;
        S.legs.push({ from: l.from, to: l.to, type: l.type, usd: l.usd_bn, note: l.note, g: g, deal: d });
      }
    }
  }

  // ------------------------------------------------------------ tooltip --
  const tip = $('#tip');
  function showTip(evt, build) {
    tip.textContent = '';
    build(tip);
    tip.hidden = false;
    let x, y;
    if (evt && evt.clientX != null && evt.type.indexOf('focus') < 0) { x = evt.clientX; y = evt.clientY; }
    else { const r = evt.target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + tw > window.innerWidth - 8) left = x - tw - 14;
    if (top + th > window.innerHeight - 8) top = y - th - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  function tipRow(parent, key, value, swatchClass) {
    const k = h('span', { class: 'k' });
    if (swatchClass) k.appendChild(h('span', { class: 'key-line ' + swatchClass }));
    k.appendChild(document.createTextNode(key));
    parent.appendChild(h('div', { class: 't-row' }, k, h('span', { class: 'v', text: value })));
  }

  // ----------------------------------------------------------- KPI row --
  function renderKpis() {
    const box = $('#kpis');
    box.textContent = '';
    const summed = S.deals.filter(d => d.in_totals);
    const headline = summed.reduce((a, d) => a + (d.headline_usd_bn || 0), 0);
    const nd = summed.filter(d => d.headline_usd_bn == null).length;
    const soft = summed.filter(d => d.confidence !== 'high' || /conditional|reported|up to|loi|mou/i.test(d.status + ' ' + d.headline_note))
      .reduce((a, d) => a + (d.headline_usd_bn || 0), 0);
    const ents = new Set();
    S.deals.forEach(d => d.legs.forEach(l => { ents.add(l.from); ents.add(l.to); }));
    const top = summed.slice().sort((a, b) => (b.headline_usd_bn || 0) - (a.headline_usd_bn || 0))[0];
    const tile = (cls, label, value, note) => box.appendChild(h('div', { class: 'tile ' + (cls || '') },
      h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value }), h('div', { class: 'note', text: note })));
    tile('hero', 'Headline value of circular deals announced', fmtBn(headline),
      fmtDate(S.f.from) + ' to ' + fmtDate(S.f.to) + ' · each deal counted once at its headline value');
    tile('', 'Deals tracked', String(summed.length), nd + ' with no disclosed value');
    tile('', 'Companies involved', String(ents.size), 'across all flows shown');
    tile('', 'Conditional or press-only', headline ? Math.round(100 * soft / headline) + '%' : 'n/d',
      'of headline value: “up to”, LOI / MOU or unconfirmed reports');
    tile('', 'Largest deal', top ? fmtBn(top.headline_usd_bn) : 'n/d', top ? top.deal + ' (' + fmtMonth(top.date) + ')' : '');
  }

  // ------------------------------------------------------- network map --
  function renderWeb() {
    const host = $('#webChart');
    if (!withRetry(renderWeb, host)) return;
    const W = host.clientWidth;
    host.textContent = '';
    $('#webLegend').textContent = '';
    GROUPS.forEach(g => {
      if (!S.f.g[g.id]) return;
      $('#webLegend').appendChild(h('span', null, h('span', { class: 'key-line bg-' + g.id }), g.long));
    });
    $('#webLegend').appendChild(h('span', { text: 'Line width = disclosed $ value (hairline = not disclosed) · circle size = total flows in + out' }));
    const legs = S.legs;
    if (!legs.length) { host.appendChild(h('div', { class: 'empty', text: 'No deals match these filters.' })); $('#webFoot').textContent = ''; renderWebTable([]); return; }

    // nodes + stats
    const nodes = new Map();
    const node = n => {
      if (!nodes.has(n)) nodes.set(n, { name: n, role: roleOf(n), out: { g1: 0, g2: 0, g3: 0 }, in: { g1: 0, g2: 0, g3: 0 }, deals: new Set(), nbr: new Map() });
      return nodes.get(n);
    };
    for (const l of legs) {
      const a = node(l.from), b = node(l.to), v = l.usd || 0;
      a.out[l.g] += v; b.in[l.g] += v;
      a.deals.add(l.deal.id); b.deals.add(l.deal.id);
      a.nbr.set(b.name, (a.nbr.get(b.name) || 0) + v + 1);
      b.nbr.set(a.name, (b.nbr.get(a.name) || 0) + v + 1);
    }
    for (const n of nodes.values()) { n.gross = sum(n.out) + sum(n.in); n.score = n.gross + 4 * n.deals.size; }
    const maxNodes = W < 640 ? 16 : W < 1000 ? 26 : 38;
    const ranked = Array.from(nodes.values()).sort((a, b) => b.score - a.score);
    const shown = ranked.slice(0, maxNodes);
    if (S.f.company && nodes.has(S.f.company) && shown.indexOf(nodes.get(S.f.company)) < 0) shown.push(nodes.get(S.f.company));
    const shownSet = new Set(shown.map(n => n.name));

    // edges aggregated per (from, to, flow group)
    const E = new Map();
    for (const l of legs) {
      if (!shownSet.has(l.from) || !shownSet.has(l.to) || l.from === l.to) continue;
      const k = l.from + '\u0001' + l.to + '\u0001' + l.g;
      let e = E.get(k);
      if (!e) { e = { from: l.from, to: l.to, g: l.g, usd: 0, nd: 0, legs: [] }; E.set(k, e); }
      if (l.usd != null) e.usd += l.usd; else e.nd++;
      e.legs.push(l);
    }
    const edges = Array.from(E.values());

    // rings: labs inside; chips / hyperscalers / strategic investors in the middle; the rest outside
    const ring0 = [], ring1 = [], ring2 = [];
    for (const n of shown) {
      if (n.role === 'lab' && ring0.length < 4) ring0.push(n);
      else if (['chips', 'cloud', 'investor'].indexOf(n.role) >= 0 && ring1.length < 13) ring1.push(n);
      else ring2.push(n);
    }
    const H = Math.round(Math.max(460, Math.min(820, W * 0.7)));
    const cx = W / 2, cy = H / 2;
    const padX = W < 640 ? 64 : 118, padY = 34;
    const RX = W / 2 - padX, RY = H / 2 - padY;
    const R = [[0.27, 0.27], [0.62, 0.64], [1, 1]];
    const pos = new Map();
    const place = (n, ring, ang) => {
      n.ring = ring; n.ang = ang;
      pos.set(n.name, [cx + Math.cos(ang) * RX * R[ring][0], cy + Math.sin(ang) * RY * R[ring][1]]);
    };
    const TAU = Math.PI * 2, TOP = -Math.PI / 2;
    // ring 0
    if (ring0.length === 1) { ring0[0].ring = 0; ring0[0].ang = TOP; pos.set(ring0[0].name, [cx, cy]); }
    else ring0.forEach((n, i) => place(n, 0, TOP - Math.PI / 6 + i * TAU / ring0.length));
    // ring 1: stable order for the majors
    ring1.sort((a, b) => {
      const ia = MID_ORDER.indexOf(a.name), ib = MID_ORDER.indexOf(b.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.score - a.score;
    });
    ring1.forEach((n, i) => place(n, 1, TOP + i * TAU / ring1.length));
    // ring 2: barycentre of placed neighbours, then even slots with best rotation
    const angOf = n => {
      let sx = 0, sy = 0;
      for (const [m, w] of n.nbr) {
        const p = pos.get(m);
        if (!p) continue;
        sx += (p[0] - cx) / RX * w; sy += (p[1] - cy) / RY * w;
      }
      return sx || sy ? Math.atan2(sy, sx) : TOP;
    };
    ring2.forEach(n => { n.want = angOf(n); });
    ring2.sort((a, b) => a.want - b.want);
    if (ring2.length) {
      const step = TAU / ring2.length;
      let best = 0, bestCost = Infinity;
      for (let k = 0; k < 48; k++) {
        const base = -Math.PI + k * TAU / 48;
        let cost = 0;
        ring2.forEach((n, i) => { let d = Math.abs(base + i * step - n.want) % TAU; if (d > Math.PI) d = TAU - d; cost += d * d; });
        if (cost < bestCost) { bestCost = cost; best = base; }
      }
      ring2.forEach((n, i) => place(n, 2, best + i * step));
    }

    const maxGross = Math.max.apply(null, shown.map(n => n.gross).concat([1]));
    const rad = n => 4 + 20 * Math.sqrt(n.gross / maxGross);
    const maxE = Math.max.apply(null, edges.map(e => e.usd).concat([1]));
    const wOf = e => (e.usd > 0 ? 1.5 + 10 * Math.sqrt(e.usd / maxE) : 1.1);

    const root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Network of circular AI deals' }, host);
    svg('ellipse', { class: 'ring-guide', cx: cx, cy: cy, rx: RX * R[1][0], ry: RY * R[1][1] }, root);
    svg('ellipse', { class: 'ring-guide', cx: cx, cy: cy, rx: RX * R[2][0], ry: RY * R[2][1] }, root);
    const gEdges = svg('g', null, root), gHits = svg('g', null, root), gNodes = svg('g', null, root);

    edges.sort((a, b) => b.usd - a.usd);
    const nodeEls = new Map();
    const edgeEls = [];
    for (const e of edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      const ra = rad(nodes.get(e.from)), rb = rad(nodes.get(e.to));
      const dx = b[0] - a[0], dy = b[1] - a[1], dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist, ny = dx / dist;
      const bend = 0.14 + (e.g === 'g1' ? 0 : e.g === 'g2' ? 0.06 : 0.11);
      const c = [(a[0] + b[0]) / 2 + nx * dist * bend, (a[1] + b[1]) / 2 + ny * dist * bend];
      const u0 = unit(c[0] - a[0], c[1] - a[1]), u1 = unit(c[0] - b[0], c[1] - b[1]);
      const w = wOf(e), al = Math.max(7, w * 1.25 + 4);
      const p0 = [a[0] + u0[0] * (ra + 2), a[1] + u0[1] * (ra + 2)];
      const tipPt = [b[0] + u1[0] * (rb + 3), b[1] + u1[1] * (rb + 3)];
      const p1 = [tipPt[0] + u1[0] * al * 0.8, tipPt[1] + u1[1] * al * 0.8];
      const d = 'M' + p0[0].toFixed(1) + ',' + p0[1].toFixed(1) + ' Q' + c[0].toFixed(1) + ',' + c[1].toFixed(1) + ' ' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1);
      const grp = svg('g', { class: 'web-edge s-' + e.g + (e.usd > 0 ? '' : ' nd') }, gEdges);
      svg('path', { d: d, 'stroke-width': w.toFixed(2) }, grp);
      // arrowhead
      const px = -u1[1], py = u1[0], hw = Math.max(4, w * 0.85 + 2.5);
      const base = [tipPt[0] + u1[0] * al, tipPt[1] + u1[1] * al];
      svg('path', {
        class: 'f-' + e.g, stroke: 'none',
        d: 'M' + tipPt[0].toFixed(1) + ',' + tipPt[1].toFixed(1) + ' L' + (base[0] + px * hw).toFixed(1) + ',' + (base[1] + py * hw).toFixed(1) +
          ' L' + (base[0] - px * hw).toFixed(1) + ',' + (base[1] - py * hw).toFixed(1) + 'Z',
      }, grp);
      const hit = svg('path', { class: 'web-edge-hit', d: d, 'stroke-width': Math.max(12, w + 8) }, gHits);
      e.el = grp;
      edgeEls.push(e);
      const on = evt => {
        root.classList.add('dim'); grp.classList.add('hl');
        [e.from, e.to].forEach(n => nodeEls.get(n) && nodeEls.get(n).classList.add('hl'));
        showTip(evt, t => edgeTip(t, e));
      };
      hit.addEventListener('pointermove', on);
      hit.addEventListener('pointerleave', clearHl);
    }
    function clearHl() {
      root.classList.remove('dim');
      $$('.hl', root).forEach(x => x.classList.remove('hl'));
      hideTip();
    }

    for (const n of shown) {
      const p = pos.get(n.name), r = rad(n);
      const g = svg('g', { class: 'web-node' + (S.f.company === n.name ? ' sel' : ''), tabindex: 0, role: 'button', 'aria-label': n.name + ', ' + fmtBn(n.gross) + ' of flows' }, gNodes);
      svg('circle', { class: 'hitc', cx: p[0], cy: p[1], r: Math.max(12, r + 4), fill: 'transparent' }, g);
      svg('circle', { class: 'n', cx: p[0], cy: p[1], r: r }, g);
      // label outward from the centre
      let lx, ly, anchor;
      if (n.ring === 0 && ring0.length === 1) { lx = p[0]; ly = p[1] + r + 15; anchor = 'middle'; }
      else {
        const ca = Math.cos(n.ang), sa = Math.sin(n.ang);
        const off = r + 6;
        lx = p[0] + ca * off; ly = p[1] + sa * off + 4;
        anchor = ca > 0.3 ? 'start' : ca < -0.3 ? 'end' : 'middle';
        if (anchor === 'middle') ly = p[1] + (sa > 0 ? off + 11 : -off - 3);
        if (n.ring === 0) { lx = p[0]; ly = p[1] + r + 15; anchor = 'middle'; }
      }
      const t = svg('text', { x: lx.toFixed(1), y: ly.toFixed(1), 'text-anchor': anchor, class: n.ring === 2 && n.gross < maxGross * 0.02 ? 'sm' : null }, g);
      t.textContent = n.name;
      nodeEls.set(n.name, g);
      const on = evt => {
        root.classList.add('dim'); g.classList.add('hl');
        for (const e of edgeEls) if (e.from === n.name || e.to === n.name) {
          e.el.classList.add('hl');
          const other = e.from === n.name ? e.to : e.from;
          nodeEls.get(other) && nodeEls.get(other).classList.add('hl');
        }
        showTip(evt, tt => nodeTip(tt, n));
      };
      g.addEventListener('pointermove', on);
      g.addEventListener('focus', on);
      g.addEventListener('pointerleave', clearHl);
      g.addEventListener('blur', clearHl);
      const pick = () => { hideTip(); setCompany(S.f.company === n.name ? '' : n.name); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
    }
    const hidden = ranked.length - shown.length;
    $('#webFoot').textContent = (hidden > 0 ? hidden + ' smaller companies are not drawn (see the deal table). ' : '') +
      (S.f.company ? 'Showing only flows that involve ' + S.f.company + ' — click it again to clear.' : '');
    renderWebTable(edges);
  }
  function unit(x, y) { const d = Math.hypot(x, y) || 1; return [x / d, y / d]; }

  function nodeTip(t, n) {
    t.appendChild(h('div', { class: 't-head', text: n.name + ' · ' + (ROLE_LABEL[n.role] || n.role) }));
    const out = sum(n.out), inn = sum(n.in);
    tipRow(t, 'Commits / pays out', fmtBn(out));
    GROUPS.forEach(g => { if (n.out[g.id]) tipRow(t, ' ' + g.label, fmtBn(n.out[g.id]), 'bg-' + g.id); });
    tipRow(t, 'Receives', fmtBn(inn));
    GROUPS.forEach(g => { if (n.in[g.id]) tipRow(t, ' ' + g.label, fmtBn(n.in[g.id]), 'bg-' + g.id); });
    tipRow(t, 'Deals', String(n.deals.size));
    t.appendChild(h('div', { class: 't-sub', text: S.f.company === n.name ? 'Click to clear the company filter' : 'Click to filter the page to ' + n.name }));
  }
  function edgeTip(t, e) {
    t.appendChild(h('div', { class: 't-head', text: e.from + ' → ' + e.to }));
    tipRow(t, GROUP[e.g].long, e.usd > 0 ? fmtBn(e.usd) + (e.nd ? ' + n/d' : '') : 'not disclosed', 'bg-' + e.g);
    const ul = h('ul');
    e.legs.slice().sort((a, b) => (b.usd || 0) - (a.usd || 0)).slice(0, 7).forEach(l => {
      ul.appendChild(h('li', { text: fmtMonth(l.deal.date) + ' · ' + l.deal.deal + ' · ' + (TYPE_LABEL[l.type] || l.type) + ' ' + fmtBn(l.usd) }));
    });
    t.appendChild(ul);
    if (e.legs.length > 7) t.appendChild(h('div', { class: 't-sub', text: '+' + (e.legs.length - 7) + ' more in the deal table' }));
  }
  function renderWebTable(edges) {
    const box = $('#webTable');
    box.textContent = '';
    const tbl = h('table', { class: 'data' });
    tbl.appendChild(h('thead', null, h('tr', null, h('th', { text: 'From' }), h('th', { text: 'To' }), h('th', { text: 'Flow type' }),
      h('th', { class: 'num', text: 'Disclosed $' }), h('th', { class: 'num', text: 'Flows' }))));
    const tb = h('tbody');
    edges.slice().sort((a, b) => b.usd - a.usd).forEach(e => tb.appendChild(h('tr', null,
      h('td', { text: e.from }), h('td', { text: e.to }),
      h('td', null, h('span', { class: 'chip' }, h('span', { class: 'key-rect bg-' + e.g }), GROUP[e.g].label)),
      h('td', { class: 'num', text: e.usd > 0 ? fmtBn(e.usd) : 'n/d' }), h('td', { class: 'num', text: String(e.legs.length) }))));
    tbl.appendChild(tb);
    box.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
  }

  // --------------------------------------------------- five-layer cake --
  const LAYERS = [
    { id: 'capital', label: 'Capital', sub: 'SoftBank, MGX, private credit — above the cake' },
    { id: 'applications', label: 'Applications', sub: 'AI products, robots, data tools' },
    { id: 'models', label: 'Models', sub: 'AI labs' },
    { id: 'infrastructure', label: 'Infrastructure', sub: 'hyperscalers, neoclouds, data centres' },
    { id: 'chips', label: 'Chips', sub: 'GPUs, custom silicon, memory, networking' },
    { id: 'energy', label: 'Energy', sub: 'power and powered sites' },
  ];
  const LAYER_IDX = Object.fromEntries(LAYERS.map((l, i) => [l.id, i]));
  const LAYER_LABEL = Object.fromEntries(LAYERS.map(l => [l.id, l.label]));
  const layerOf = n => (S.layerMap.get(n) in LAYER_IDX ? S.layerMap.get(n) : 'applications');

  function cakeModel() {
    const L = {};
    LAYERS.forEach(l => { L[l.id] = { out: 0, in: 0, within: 0, withinN: 0, cos: new Map() }; });
    const A = new Map();
    for (const l of S.legs) {
      const a = layerOf(l.from), b = layerOf(l.to), v = l.usd || 0;
      L[a].cos.set(l.from, (L[a].cos.get(l.from) || 0) + v + 0.001);
      L[b].cos.set(l.to, (L[b].cos.get(l.to) || 0) + v + 0.001);
      if (a === b) { L[a].within += v; L[a].withinN++; continue; }
      L[a].out += v; L[b].in += v;
      const k = a + '|' + b + '|' + l.g;
      let e = A.get(k);
      if (!e) { e = { a: a, b: b, g: l.g, usd: 0, nd: 0, legs: [] }; A.set(k, e); }
      if (l.usd != null) e.usd += l.usd; else e.nd++;
      e.legs.push(l);
    }
    return { L: L, arrows: Array.from(A.values()) };
  }

  function renderCake() {
    const host = $('#cakeChart');
    if (!withRetry(renderCake, host)) return;
    const W = host.clientWidth;
    host.textContent = '';
    const lg = $('#cakeLegend');
    lg.textContent = '';
    GROUPS.forEach(g => { if (S.f.g[g.id]) lg.appendChild(h('span', null, h('span', { class: 'key-line bg-' + g.id }), g.long + (g.id === 'g2' ? ' (left)' : ' (right)'))); });
    lg.appendChild(h('span', { text: 'Arrow width = disclosed $ value' }));
    const M = cakeModel();
    renderCakeTable(M);
    if (!S.legs.length) { host.appendChild(h('div', { class: 'empty', text: 'No deals match these filters.' })); $('#cakeFoot').textContent = ''; return; }

    const narrow = W < 720;
    const side = narrow ? Math.max(64, Math.round(W * 0.17)) : Math.min(250, Math.round(W * 0.24));
    const bx0 = side, bx1 = W - side;
    const top = 28, bandH = narrow ? 72 : 80, gap = 10;
    const yC = i => top + i * (bandH + gap) + bandH / 2;
    const H = top + LAYERS.length * (bandH + gap) + 4;
    const root = svg('svg', { width: W, height: H, role: 'img', 'aria-label': 'Circular flows between the five layers of AI' }, host);
    const hd1 = svg('text', { class: 'lbl', x: side / 2, y: 16, 'text-anchor': 'middle' }, root);
    hd1.textContent = narrow ? 'Purchases' : 'Purchases (compute, chips, cloud)';
    const hd2 = svg('text', { class: 'lbl', x: W - side / 2, y: 16, 'text-anchor': 'middle' }, root);
    hd2.textContent = narrow ? 'Capital' : 'Investment, loans & backstops';

    // bands
    const charW = 6.4;
    LAYERS.forEach((ly, i) => {
      const y0 = yC(i) - bandH / 2, st = M.L[ly.id];
      svg('rect', { x: bx0, y: y0, width: bx1 - bx0, height: bandH, rx: 10, fill: ly.id === 'capital' ? 'var(--surface)' : 'var(--surface-2)', stroke: 'var(--grid)', 'stroke-width': 1 }, root);
      const t1 = svg('text', { class: 'lbl-strong', x: bx0 + 12, y: y0 + 20 }, root);
      t1.textContent = ly.label;
      const flowTxt = (st.out || st.in) ? 'out ' + fmtBn(st.out) + ' · in ' + fmtBn(st.in) : '';
      const t2 = svg('text', { class: 'val', x: bx1 - 12, y: y0 + 20, 'text-anchor': 'end' }, root);
      t2.textContent = flowTxt;
      const t3 = svg('text', { class: 'tick', x: bx0 + 12, y: y0 + 37 }, root);
      t3.textContent = ly.sub;
      if (st.within > 0) {
        const t4 = svg('text', { class: 'tick', x: bx1 - 12, y: y0 + 37, 'text-anchor': 'end' }, root);
        t4.textContent = '↺ ' + fmtBn(st.within) + ' within the layer';
      }
      // companies, biggest first, as many as fit
      const cos = Array.from(st.cos.entries()).sort((a, b) => b[1] - a[1]).map(c => c[0]);
      const room = (bx1 - bx0 - 24) / charW;
      let txt = '', shown = 0;
      for (const c of cos) {
        const next = txt ? txt + ' · ' + c : c;
        if (next.length + 8 > room) break;
        txt = next; shown++;
      }
      if (cos.length > shown) txt += (txt ? '  ' : '') + '+' + (cos.length - shown);
      const t5 = svg('text', { class: 'lbl', x: bx0 + 12, y: y0 + 58 }, root);
      t5.textContent = txt || 'no flows in this selection';
      if (!txt) t5.setAttribute('class', 'tick');
    });

    // arrows: purchases on the left, capital (equity, credit, backstops, warrants) on the right
    const arrows = M.arrows.filter(e => S.f.g[e.g]);
    const maxU = Math.max.apply(null, arrows.map(e => e.usd).concat([1]));
    const wOf = e => (e.usd > 0 ? 1.5 + 11 * Math.sqrt(e.usd / maxU) : 1.2);
    const sideOf = e => (e.g === 'g2' ? 'L' : 'R');
    // spread endpoints vertically within each band edge
    const ends = {};
    arrows.forEach(e => {
      [['a', e.a], ['b', e.b]].forEach(([role, ly]) => {
        const k = sideOf(e) + ly;
        (ends[k] = ends[k] || []).push({ e: e, role: role, other: LAYER_IDX[role === 'a' ? e.b : e.a] });
      });
    });
    Object.values(ends).forEach(list => {
      list.sort((p, q) => p.other - q.other);
      const n = list.length, step = Math.min(11, (bandH - 26) / Math.max(1, n));
      list.forEach((p, j) => { p.e['y' + p.role] = (j - (n - 1) / 2) * step; });
    });
    // lane distance grows with the number of layers crossed
    const lanes = {};
    arrows.slice().sort((p, q) => b2(p) - b2(q) || q.usd - p.usd).forEach(e => {
      const k = sideOf(e) + Math.abs(LAYER_IDX[e.a] - LAYER_IDX[e.b]);
      lanes[k] = (lanes[k] || 0) + 1;
      e.lane = lanes[k] - 1;
    });
    function b2(e) { return Math.abs(LAYER_IDX[e.a] - LAYER_IDX[e.b]); }
    const gArr = svg('g', null, root), gHit = svg('g', null, root);
    const labelled = { L: 0, R: 0 }, placed = [];
    arrows.sort((p, q) => q.usd - p.usd).forEach(e => {
      const s = sideOf(e), ia = LAYER_IDX[e.a], ib = LAYER_IDX[e.b];
      const span = Math.abs(ia - ib);
      const d = Math.min(side - 12, 16 + 26 * (span - 1) + 9 * e.lane + (narrow ? 0 : 8));
      const x0 = s === 'L' ? bx0 : bx1, dir = s === 'L' ? -1 : 1;
      const ya = yC(ia) + e.ya, yb = yC(ib) + e.yb;
      const w = wOf(e), al = Math.max(7, w + 4);
      const xEnd = x0 + dir * (al - 1);
      const path = 'M' + x0 + ',' + ya.toFixed(1) + ' C' + (x0 + dir * d) + ',' + ya.toFixed(1) + ' ' + (x0 + dir * d) + ',' + yb.toFixed(1) + ' ' + xEnd + ',' + yb.toFixed(1);
      const g = svg('g', { class: 'cake-arrow' + (e.usd > 0 ? '' : ' nd') }, gArr);
      svg('path', { d: path, fill: 'none', class: 's-' + e.g, 'stroke-width': w.toFixed(2), 'stroke-linecap': 'butt' }, g);
      const hw = Math.max(4, w * 0.8 + 2.5);
      svg('path', { class: 'f-' + e.g, d: 'M' + x0 + ',' + yb.toFixed(1) + ' L' + (x0 + dir * al) + ',' + (yb - hw).toFixed(1) + ' L' + (x0 + dir * al) + ',' + (yb + hw).toFixed(1) + 'Z' }, g);
      if (e.usd > 0 && labelled[s] < (narrow ? 2 : 6) && e.usd >= maxU * 0.03) {
        // label just outside the arrow's outermost point; skip if it would collide
        const txt = fmtBn(e.usd), tw = txt.length * 6.6 + 4;
        const apex = x0 + dir * (0.75 * d + w / 2 + 5);
        const cands = [(ya + yb) / 2, (ya + yb) / 2 - 14, (ya + yb) / 2 + 14];
        for (const cy of cands) {
          const rx0 = s === 'L' ? apex - tw : apex, box = [rx0, cy - 10, rx0 + tw, cy + 4];
          if (box[0] < 0 || box[2] > W) continue;
          if (placed.some(p => box[0] < p[2] && p[0] < box[2] && box[1] < p[3] && p[1] < box[3])) continue;
          placed.push(box);
          labelled[s]++;
          const t = svg('text', { class: 'val', x: apex.toFixed(1), y: (cy).toFixed(1), 'text-anchor': s === 'L' ? 'end' : 'start' }, g);
          t.textContent = txt;
          break;
        }
      }
      const hit = svg('path', { d: path, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(12, w + 8), tabindex: 0 }, gHit);
      const on = evt => {
        root.classList.add('dim'); g.classList.add('hl');
        showTip(evt, t => {
          t.appendChild(h('div', { class: 't-head', text: LAYER_LABEL[e.a] + ' → ' + LAYER_LABEL[e.b] }));
          tipRow(t, GROUP[e.g].long, e.usd > 0 ? fmtBn(e.usd) + (e.nd ? ' + n/d' : '') : 'not disclosed', 'bg-' + e.g);
          const ul = h('ul');
          e.legs.slice().sort((p, q) => (q.usd || 0) - (p.usd || 0)).slice(0, 6)
            .forEach(l => ul.appendChild(h('li', { text: l.from + ' → ' + l.to + ' · ' + (TYPE_LABEL[l.type] || l.type) + ' ' + fmtBn(l.usd) + ' (' + fmtMonth(l.deal.date) + ')' })));
          t.appendChild(ul);
          if (e.legs.length > 6) t.appendChild(h('div', { class: 't-sub', text: '+' + (e.legs.length - 6) + ' more flows' }));
        });
      };
      const off = () => { root.classList.remove('dim'); g.classList.remove('hl'); hideTip(); };
      hit.addEventListener('pointermove', on); hit.addEventListener('focus', on);
      hit.addEventListener('pointerleave', off); hit.addEventListener('blur', off);
    });

    // loops: capital one way and purchases the other between the same two layers
    const val = (a, b, gs) => arrows.filter(e => e.a === a && e.b === b && gs.indexOf(e.g) >= 0).reduce((s, e) => s + e.usd, 0);
    const loops = [];
    for (let i = 0; i < LAYERS.length; i++) for (let j = 0; j < LAYERS.length; j++) {
      if (i === j) continue;
      const a = LAYERS[i].id, b = LAYERS[j].id;
      const cap = val(a, b, ['g1', 'g3']), back = val(b, a, ['g2']);
      if (cap > 0 && back > 0) loops.push({ a: a, b: b, cap: cap, back: back });
    }
    loops.sort((p, q) => Math.min(q.cap, q.back) - Math.min(p.cap, p.back));
    $('#cakeFoot').textContent = loops.length
      ? 'Biggest loops: ' + loops.slice(0, 3).map(l => LAYER_LABEL[l.a] + ' put ' + fmtBn(l.cap) + ' into ' + LAYER_LABEL[l.b] + ', which committed ' + fmtBn(l.back) + ' of purchases back').join('; ') + '. Disclosed values only; a deal’s two legs both count.'
      : 'No two-way loops between layers in this selection.';
  }

  function renderCakeTable(M) {
    const box = $('#cakeTable');
    box.textContent = '';
    const tbl = h('table', { class: 'data' });
    tbl.appendChild(h('thead', null, h('tr', null, h('th', { text: 'From layer' }), h('th', { text: 'To layer' }), h('th', { text: 'Flow type' }),
      h('th', { class: 'num', text: 'Disclosed $' }), h('th', { class: 'num', text: 'Flows' }), h('th', { text: 'Largest' }))));
    const tb = h('tbody');
    M.arrows.filter(e => S.f.g[e.g]).sort((p, q) => q.usd - p.usd).forEach(e => {
      const big = e.legs.slice().sort((p, q) => (q.usd || 0) - (p.usd || 0))[0];
      tb.appendChild(h('tr', null, h('td', { text: LAYER_LABEL[e.a] }), h('td', { text: LAYER_LABEL[e.b] }),
        h('td', null, h('span', { class: 'chip' }, h('span', { class: 'key-rect bg-' + e.g }), GROUP[e.g].label)),
        h('td', { class: 'num', text: e.usd > 0 ? fmtBn(e.usd) : 'n/d' }), h('td', { class: 'num', text: String(e.legs.length) }),
        h('td', { text: big ? big.from + ' → ' + big.to + ' (' + fmtBn(big.usd) + ')' : '' })));
    });
    LAYERS.forEach(l => {
      if (M.L[l.id].withinN) tb.appendChild(h('tr', null, h('td', { text: l.label }), h('td', { text: l.label + ' (within)' }), h('td', { text: 'all types' }),
        h('td', { class: 'num', text: fmtBn(M.L[l.id].within) }), h('td', { class: 'num', text: String(M.L[l.id].withinN) }), h('td', { text: '' })));
    });
    tbl.appendChild(tb);
    box.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
  }

  // ---------------------------------------------------------- timeline --
  function qIndex(s) { return (+s.slice(0, 4)) * 4 + Math.floor((+s.slice(5, 7) - 1) / 3); }
  function qLabel(q, short) { const y = Math.floor(q / 4), k = q % 4 + 1; return short ? 'Q' + k + " '" + String(y).slice(2) : 'Q' + k + ' ' + y; }

  function renderTimeline() {
    const host = $('#tlChart');
    if (!withRetry(renderTimeline, host)) return;
    const W = host.clientWidth;
    host.textContent = '';
    $('#tlLegend').textContent = '';
    GROUPS.forEach(g => { if (S.f.g[g.id]) $('#tlLegend').appendChild(h('span', null, h('span', { class: 'key-rect bg-' + g.id }), g.long)); });
    const q0 = qIndex(S.f.from), q1 = qIndex(S.f.to), todayQ = qIndex(S.data.meta.today);
    const B = [];
    for (let q = q0; q <= q1; q++) B.push({ q: q, usd: { g1: 0, g2: 0, g3: 0 }, n: { g1: 0, g2: 0, g3: 0 }, deals: new Map() });
    for (const l of S.legs) {
      const b = B[qIndex(l.deal.date) - q0];
      if (!b) continue;
      b.usd[l.g] += l.usd || 0; b.n[l.g] += 1;
      b.deals.set(l.deal.id, l.deal);
    }
    const key = S.tl.m;
    const rows = B.map(b => ({ q: b.q, v: Object.assign({}, b[key]), deals: Array.from(b.deals.values()) }));
    if (S.tl.c === 'cum') { const acc = { g1: 0, g2: 0, g3: 0 }; rows.forEach(r => { GROUPS.forEach(g => { acc[g.id] += r.v[g.id]; r.v[g.id] = acc[g.id]; }); }); }
    const totals = rows.map(r => sum(r.v));
    // description
    const tot = { g1: 0, g2: 0, g3: 0 };
    S.legs.forEach(l => { tot[l.g] += l.usd || 0; });
    const all = sum(tot);
    $('#tlDesc').textContent = (all ? 'Of ' + fmtBn(all) + ' in disclosed flows, ' + GROUPS.filter(g => S.f.g[g.id]).map(g => Math.round(100 * tot[g.id] / all) + '% ' + g.label.toLowerCase()).join(', ') + '. ' : '') +
      'Both sides of a deal count here: an investment and the purchase commitment that comes with it are two flows. Flows with no disclosed value appear only in the flow count.';
    if (!S.legs.length) { host.appendChild(h('div', { class: 'empty', text: 'No deals match these filters.' })); renderTlTable(rows); return; }

    const H = 300, axisB = 26, left = 52, right = 10, top = 18;
    const ymax = niceMax(Math.max.apply(null, totals.concat([key === 'usd' ? 1 : 1])));
    const y = v => top + (H - top) * (1 - v / ymax);
    const band = (W - left - right) / rows.length;
    const bw = Math.max(3, Math.min(24, band * 0.62));
    const root = svg('svg', { width: W, height: H + axisB, role: 'img', 'aria-label': 'Circular flows by quarter' }, host);
    const tk = ticks(ymax, 4);
    tk.forEach(v => {
      svg('line', { class: v === 0 ? 'baseline' : 'gridline', x1: left, x2: W - right, y1: y(v).toFixed(1), y2: y(v).toFixed(1) }, root);
      const t = svg('text', { class: 'tick', x: left - 6, y: (y(v) + 4).toFixed(1), 'text-anchor': 'end' }, root);
      t.textContent = key === 'usd' ? fmtBn(v).replace('$0', '0') : String(v);
    });
    const hover = svg('rect', { class: 'col-hover', x: 0, y: top, width: 0, height: H - top, opacity: 0 }, root);
    const yearSeen = new Set();
    let maxI = totals.indexOf(Math.max.apply(null, totals));
    rows.forEach((r, i) => {
      const xc = left + band * i + band / 2;
      // x labels: every quarter when wide, else first quarter of each year
      const showQ = band >= 44;
      const yr = Math.floor(r.q / 4);
      if (showQ || !yearSeen.has(yr)) {
        yearSeen.add(yr);
        const t = svg('text', { class: 'tick', x: xc.toFixed(1), y: H + 16, 'text-anchor': 'middle' }, root);
        t.textContent = showQ ? qLabel(r.q, true) + (r.q === todayQ ? '*' : '') : String(yr);
      }
      let base = H;
      const present = GROUPS.filter(g => S.f.g[g.id] && r.v[g.id] > 0);
      present.forEach((g, j) => {
        const hgt = H - y(r.v[g.id]);
        const gap = j > 0 ? 2 : 0;
        const y0 = base - hgt, yb = base - gap;
        const isTop = j === present.length - 1;
        if (yb - y0 > 0.5) svg('path', { class: 'f-' + g.id, d: barPath(xc - bw / 2, y0, bw, yb - y0, isTop ? 4 : 0) }, root);
        base -= hgt;
      });
      if ((i === maxI || i === rows.length - 1) && totals[i] > 0 && (S.tl.c === 'q' ? i === maxI : i === rows.length - 1)) {
        const t = svg('text', { class: 'val', x: xc.toFixed(1), y: (y(totals[i]) - 6).toFixed(1), 'text-anchor': 'middle' }, root);
        t.textContent = key === 'usd' ? fmtBn(totals[i]) : String(totals[i]);
      }
      const hit = svg('rect', { class: 'hit', x: (left + band * i).toFixed(1), y: top, width: band.toFixed(1), height: H - top, tabindex: 0 }, root);
      const on = evt => {
        hover.setAttribute('x', (left + band * i).toFixed(1)); hover.setAttribute('width', band.toFixed(1)); hover.setAttribute('opacity', 1);
        showTip(evt, t => {
          t.appendChild(h('div', { class: 't-head', text: qLabel(r.q) + (r.q === todayQ ? ' (to date)' : '') + (S.tl.c === 'cum' ? ' · cumulative' : '') }));
          GROUPS.forEach(g => { if (S.f.g[g.id]) tipRow(t, g.label, key === 'usd' ? fmtBn(r.v[g.id]) : String(r.v[g.id]), 'bg-' + g.id); });
          tipRow(t, 'Total', key === 'usd' ? fmtBn(totals[i]) : String(totals[i]));
          if (S.tl.c === 'q' && r.deals.length) {
            const ul = h('ul');
            r.deals.slice().sort((a, b) => (b.headline_usd_bn || 0) - (a.headline_usd_bn || 0)).slice(0, 5)
              .forEach(d => ul.appendChild(h('li', { text: d.deal + ' (' + fmtBn(d.headline_usd_bn) + ')' })));
            t.appendChild(h('div', { class: 't-sub', text: r.deals.length + ' deal' + (r.deals.length > 1 ? 's' : '') + ', largest:' }));
            t.appendChild(ul);
          }
        });
      };
      hit.addEventListener('pointermove', on);
      hit.addEventListener('focus', on);
      const off = () => { hover.setAttribute('opacity', 0); hideTip(); };
      hit.addEventListener('pointerleave', off);
      hit.addEventListener('blur', off);
    });
    // keep hover band behind bars
    root.insertBefore(hover, root.firstChild);
    renderTlTable(rows);
  }
  function barPath(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    if (r <= 0) return 'M' + x + ',' + y + 'h' + w + 'v' + hgt + 'h' + -w + 'Z';
    return 'M' + x + ',' + (y + hgt) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hgt) + 'Z';
  }
  function hbarPath(x, y, w, hgt, r, roundRight) {
    // horizontal bar with the data end rounded (right end, or left end when roundRight is false)
    r = Math.min(r, hgt / 2, w);
    if (r <= 0 || w <= 0) return 'M' + x + ',' + y + 'h' + Math.max(0, w) + 'v' + hgt + 'h' + -Math.max(0, w) + 'Z';
    if (roundRight) return 'M' + x + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hgt - r) + 'Q' + (x + w) + ',' + (y + hgt) + ' ' + (x + w - r) + ',' + (y + hgt) + 'H' + x + 'Z';
    return 'M' + (x + w) + ',' + y + 'H' + (x + r) + 'Q' + x + ',' + y + ' ' + x + ',' + (y + r) + 'V' + (y + hgt - r) + 'Q' + x + ',' + (y + hgt) + ' ' + (x + r) + ',' + (y + hgt) + 'H' + (x + w) + 'Z';
  }
  function renderTlTable(rows) {
    const box = $('#tlTable');
    box.textContent = '';
    const usd = S.tl.m === 'usd';
    const tbl = h('table', { class: 'data' });
    tbl.appendChild(h('thead', null, h('tr', null, h('th', { text: 'Quarter' }),
      GROUPS.map(g => h('th', { class: 'num', text: g.label })), h('th', { class: 'num', text: 'Total' }), h('th', { class: 'num', text: 'Deals' }))));
    const tb = h('tbody');
    rows.forEach(r => tb.appendChild(h('tr', null, h('td', { text: qLabel(r.q) }),
      GROUPS.map(g => h('td', { class: 'num', text: usd ? fmtBn(r.v[g.id]) : String(r.v[g.id]) })),
      h('td', { class: 'num', text: usd ? fmtBn(sum(r.v)) : String(sum(r.v)) }), h('td', { class: 'num', text: String(r.deals.length) }))));
    tbl.appendChild(tb);
    box.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
  }

  // ------------------------------------------------- exposure butterfly --
  function renderExposure() {
    const host = $('#exChart');
    if (!withRetry(renderExposure, host)) return;
    const W = host.clientWidth;
    host.textContent = '';
    $('#exLegend').textContent = '';
    GROUPS.forEach(g => { if (S.f.g[g.id]) $('#exLegend').appendChild(h('span', null, h('span', { class: 'key-rect bg-' + g.id }), g.label)); });
    const M = new Map();
    const get = n => { if (!M.has(n)) M.set(n, { name: n, out: { g1: 0, g2: 0, g3: 0 }, in: { g1: 0, g2: 0, g3: 0 } }); return M.get(n); };
    for (const l of S.legs) { if (l.usd == null) continue; get(l.from).out[l.g] += l.usd; get(l.to).in[l.g] += l.usd; }
    const rows = Array.from(M.values()).map(r => Object.assign(r, { o: sum(r.out), i: sum(r.in) }))
      .sort((a, b) => (b.o + b.i) - (a.o + a.i)).slice(0, W < 560 ? 10 : 15);
    if (!rows.length) { host.appendChild(h('div', { class: 'empty', text: 'No disclosed flows match these filters.' })); renderExTable([]); return; }
    const labelW = W < 560 ? 92 : 112, valW = 50, rowH = 26, bh = 14, top = 26;
    const side = (W - labelW) / 2 - valW;
    const max = Math.max.apply(null, rows.map(r => Math.max(r.o, r.i)).concat([1]));
    const sx = v => side * v / max;
    const cxL = (W - labelW) / 2, cxR = cxL + labelW;
    const H = top + rows.length * rowH + 4;
    const root = svg('svg', { width: W, height: H, role: 'img', 'aria-label': 'Flows out of and into each company' }, host);
    const hd1 = svg('text', { class: 'lbl', x: cxL - 2, y: 14, 'text-anchor': 'end' }, root); hd1.textContent = '← Commits / pays out';
    const hd2 = svg('text', { class: 'lbl', x: cxR + 2, y: 14 }, root); hd2.textContent = 'Receives →';
    svg('line', { class: 'baseline', x1: cxL, x2: cxL, y1: top - 4, y2: H }, root);
    svg('line', { class: 'baseline', x1: cxR, x2: cxR, y1: top - 4, y2: H }, root);
    rows.forEach((r, i) => {
      const yc = top + i * rowH + rowH / 2;
      const nm = svg('text', { class: S.f.company === r.name ? 'lbl-strong' : 'lbl', x: (cxL + cxR) / 2, y: yc + 4, 'text-anchor': 'middle' }, root);
      nm.textContent = r.name.length > 16 && W < 560 ? r.name.slice(0, 15) + '…' : r.name;
      [['out', -1], ['in', 1]].forEach(([dir, sgn]) => {
        let acc = 0;
        const present = GROUPS.filter(g => S.f.g[g.id] && r[dir][g.id] > 0);
        present.forEach((g, j) => {
          const w = sx(r[dir][g.id]);
          const gap = j > 0 ? 2 : 0;
          const isEnd = j === present.length - 1;
          let x, ww = Math.max(0.5, w - gap);
          if (sgn > 0) x = cxR + acc + gap; else x = cxL - acc - w;
          const p = svg('path', { class: 'f-' + g.id, d: hbarPath(x, yc - bh / 2, ww, bh, isEnd ? 4 : 0, sgn > 0) }, root);
          const hit = svg('rect', { class: 'hit', x: x - 1, y: yc - rowH / 2, width: ww + 2, height: rowH, tabindex: 0 }, root);
          const on = evt => {
            p.classList.add('mark-hover');
            showTip(evt, t => {
              t.appendChild(h('div', { class: 't-head', text: r.name + (dir === 'out' ? ' · commits / pays out' : ' · receives') }));
              GROUPS.forEach(gg => { if (r[dir][gg.id]) tipRow(t, gg.label, fmtBn(r[dir][gg.id]), 'bg-' + gg.id); });
              tipRow(t, 'Total', fmtBn(dir === 'out' ? r.o : r.i));
            });
          };
          const off = () => { p.classList.remove('mark-hover'); hideTip(); };
          hit.addEventListener('pointermove', on); hit.addEventListener('focus', on);
          hit.addEventListener('pointerleave', off); hit.addEventListener('blur', off);
          acc += w;
        });
        const tot = dir === 'out' ? r.o : r.i;
        if (tot > 0) {
          const t = svg('text', { class: 'val', x: sgn > 0 ? cxR + acc + 5 : cxL - acc - 5, y: yc + 4, 'text-anchor': sgn > 0 ? 'start' : 'end' }, root);
          t.textContent = fmtBn(tot);
        }
      });
    });
    renderExTable(rows);
  }
  function renderExTable(rows) {
    const box = $('#exTable');
    box.textContent = '';
    const tbl = h('table', { class: 'data' });
    tbl.appendChild(h('thead', null, h('tr', null, h('th', { text: 'Company' }),
      GROUPS.map(g => h('th', { class: 'num', text: 'Out: ' + g.label })), h('th', { class: 'num', text: 'Out total' }),
      GROUPS.map(g => h('th', { class: 'num', text: 'In: ' + g.label })), h('th', { class: 'num', text: 'In total' }))));
    const tb = h('tbody');
    rows.forEach(r => tb.appendChild(h('tr', null, h('td', { text: r.name }),
      GROUPS.map(g => h('td', { class: 'num', text: fmtBn(r.out[g.id]) })), h('td', { class: 'num', text: fmtBn(r.o) }),
      GROUPS.map(g => h('td', { class: 'num', text: fmtBn(r.in[g.id]) })), h('td', { class: 'num', text: fmtBn(r.i) }))));
    tbl.appendChild(tb);
    box.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
  }

  // ------------------------------------------ deal size vs revenue ----
  function revFor(company, date) {
    // revenue of the fiscal year containing the deal date; latest reported year if that one isn't out yet
    const rows = (S.data.revenue || {})[company];
    if (!rows || !rows.length) return null;
    for (const r of rows) if (r[0] >= date) return { fye: r[0], v: r[1], basis: r[2] };
    const r = rows[rows.length - 1];
    return { fye: r[0], v: r[1], basis: r[2] };
  }
  const fyLabel = fye => 'FY' + fye.slice(0, 4) + (fye.slice(5, 7) === '12' ? '' : ' (to ' + MONTHS[+fye.slice(5, 7) - 1] + ')');
  function fmtPctBig(v) {
    if (v == null || !isFinite(v)) return 'n/a';
    if (v >= 100) return Math.round(v).toLocaleString('en-US') + '%';
    if (v >= 10) return Math.round(v) + '%';
    return trimZeros(v.toFixed(1)) + '%';
  }
  function legPct(l, who) {
    if (l.usd == null) return null;
    const r = revFor(who === 'from' ? l.from : l.to, l.deal.date);
    return r && r.v > 0 ? { pct: 100 * l.usd / r.v, rev: r } : null;
  }

  function renderRevShare() {
    const host = $('#rsChart');
    if (!withRetry(renderRevShare, host)) return;
    const W = host.clientWidth;
    host.textContent = '';
    const who = S.rs;
    const lg = $('#rsLegend');
    lg.textContent = '';
    GROUPS.forEach(g => { if (S.f.g[g.id]) lg.appendChild(h('span', null, h('span', { class: 'key-rect bg-' + g.id }), g.label)); });
    lg.appendChild(h('span', { text: 'Log scale · the darker line marks 100% = one full year of revenue' }));
    const all = S.legs.map(l => Object.assign({ l: l }, legPct(l, who) || {})).filter(x => x.pct != null);
    const rows = all.slice().sort((a, b) => b.pct - a.pct).slice(0, W < 560 ? 10 : 18);
    renderRsTable(all, who);
    const missing = new Set(S.legs.filter(l => l.usd != null && !legPct(l, who)).map(l => (who === 'from' ? l.from : l.to)));
    $('#rsFoot').textContent = 'Revenue = the company’s fiscal year in which the deal was announced (the latest reported year for deals in a year not yet reported). Public companies: FactSet. OpenAI, Anthropic and SpaceX/xAI: figures from their IPO filings and investor disclosures as reported in the press. Multi-year contracts are compared with a single year of revenue. ' +
      (missing.size ? 'No revenue on file (left out): ' + Array.from(missing).sort().join(', ') + '.' : '');
    if (!rows.length) { host.appendChild(h('div', { class: 'empty', text: 'No disclosed flows with revenue on file in this selection.' })); return; }
    const narrow = W < 640;
    const labelW = narrow ? 0 : Math.min(330, Math.round(W * 0.4));
    const left = labelW + 8, right = 64, rowH = narrow ? 44 : 28, bh = 14, top = 22;
    const lo = 1, hi = Math.pow(10, Math.ceil(Math.log10(Math.max(rows[0].pct, 200))));
    const x = v => left + (W - left - right) * (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
    const H = top + rows.length * rowH + 6;
    const root = svg('svg', { width: W, height: H, role: 'img', 'aria-label': 'Deal size as a percentage of annual revenue' }, host);
    for (let v = lo; v <= hi; v *= 10) {
      svg('line', { class: v === 100 ? 'baseline' : 'gridline', x1: x(v), x2: x(v), y1: top - 4, y2: H, 'stroke-width': v === 100 ? 1.5 : 1, style: v === 100 ? 'stroke: var(--ink-2)' : null }, root);
      const t = svg('text', { class: 'tick', x: x(v), y: 12, 'text-anchor': 'middle' }, root);
      t.textContent = v.toLocaleString('en-US') + '%';
    }
    rows.forEach((r, i) => {
      const l = r.l, yc = top + i * rowH + (narrow ? 30 : rowH / 2);
      const company = who === 'from' ? l.from : l.to;
      const name = l.from + ' → ' + l.to + ' · ' + fmtBn(l.usd);
      const lab = svg('text', { class: 'lbl', x: narrow ? left : labelW, y: narrow ? yc - 13 : yc + 4, 'text-anchor': narrow ? 'start' : 'end' }, root);
      lab.textContent = name.length > 44 && !narrow ? name.slice(0, 43) + '…' : name;
      const w = Math.max(1, x(r.pct) - left);
      const p = svg('path', { class: 'f-' + l.g, d: hbarPath(left, yc - bh / 2, w, bh, 4, true) }, root);
      const vt = svg('text', { class: 'val', x: left + w + 6, y: yc + 4 }, root);
      vt.textContent = fmtPctBig(r.pct);
      const hit = svg('rect', { class: 'hit', x: 0, y: yc - rowH / 2, width: W, height: rowH, tabindex: 0 }, root);
      const on = evt => {
        p.classList.add('mark-hover');
        showTip(evt, t => {
          t.appendChild(h('div', { class: 't-head', text: l.deal.deal }));
          tipRow(t, l.from + ' → ' + l.to + ' (' + (TYPE_LABEL[l.type] || l.type) + ')', fmtBn(l.usd), 'bg-' + l.g);
          tipRow(t, company + ' revenue, ' + fyLabel(r.rev.fye), fmtBn(r.rev.v));
          tipRow(t, 'Deal as % of that revenue', fmtPctBig(r.pct));
          const other = legPct(l, who === 'from' ? 'to' : 'from');
          if (other) tipRow(t, (who === 'from' ? l.to : l.from) + ' (other side)', fmtPctBig(other.pct));
          t.appendChild(h('div', { class: 't-sub', text: 'Announced ' + fmtDate(l.deal.date) + (l.deal.headline_note ? ' · ' + l.deal.headline_note : '') }));
        });
      };
      const off = () => { p.classList.remove('mark-hover'); hideTip(); };
      hit.addEventListener('pointermove', on); hit.addEventListener('focus', on);
      hit.addEventListener('pointerleave', off); hit.addEventListener('blur', off);
    });
  }
  function renderRsTable(all, who) {
    const box = $('#rsTable');
    box.textContent = '';
    const tbl = h('table', { class: 'data' });
    tbl.appendChild(h('thead', null, h('tr', null, h('th', { text: 'Announced' }), h('th', { text: 'Flow' }), h('th', { class: 'num', text: '$' }),
      h('th', { text: 'Payer revenue' }), h('th', { class: 'num', text: '% of payer' }), h('th', { text: 'Recipient revenue' }), h('th', { class: 'num', text: '% of recipient' }))));
    const tb = h('tbody');
    all.slice().sort((a, b) => b.pct - a.pct).forEach(r => {
      const l = r.l, pf = legPct(l, 'from'), pt = legPct(l, 'to');
      tb.appendChild(h('tr', null, h('td', { class: 'date', text: fmtDate(l.deal.date) }), h('td', { text: l.from + ' → ' + l.to + ' (' + (TYPE_LABEL[l.type] || l.type) + ')' }),
        h('td', { class: 'num', text: fmtBn(l.usd) }),
        h('td', { text: pf ? fmtBn(pf.rev.v) + ' ' + fyLabel(pf.rev.fye) : 'n/a' }), h('td', { class: 'num', text: pf ? fmtPctBig(pf.pct) : 'n/a' }),
        h('td', { text: pt ? fmtBn(pt.rev.v) + ' ' + fyLabel(pt.rev.fye) : 'n/a' }), h('td', { class: 'num', text: pt ? fmtPctBig(pt.pct) : 'n/a' })));
    });
    tbl.appendChild(tb);
    box.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
  }

  // --------------------------------------------- headline vs actual ----
  function hvaRows() {
    return (S.data.hva || []).filter(r =>
      (!r.announced || (r.announced >= S.f.from && r.announced <= S.f.to)) &&
      (!S.f.company || (r.parties || []).indexOf(S.f.company) >= 0 || (r.deal || '').indexOf(S.f.company) >= 0))
      .sort((a, b) => (b.headline_usd_bn || 0) - (a.headline_usd_bn || 0));
  }
  function renderHva() {
    const host = $('#hvaChart');
    if (!withRetry(renderHva, host)) return;
    const W = host.clientWidth;
    host.textContent = '';
    const lg = $('#hvaLegend');
    lg.textContent = '';
    const k1 = h('span'), k2 = h('span');
    const s1 = svg('svg', { width: 14, height: 14 }); svg('circle', { cx: 7, cy: 7, r: 5, fill: 'var(--surface)', stroke: 'var(--hl-light)', 'stroke-width': 2.5 }, s1);
    const s2 = svg('svg', { width: 14, height: 14 }); svg('circle', { cx: 7, cy: 7, r: 5, fill: 'var(--hl-dark)' }, s2);
    k1.appendChild(s1); k1.appendChild(document.createTextNode('Headline when announced'));
    k2.appendChild(s2); k2.appendChild(document.createTextNode('Invested, drawn or deployed so far'));
    lg.appendChild(k1); lg.appendChild(k2);
    lg.appendChild(h('span', { text: 'Follows the period and company filters' }));
    const rows = hvaRows();
    if (!rows.length) { host.appendChild(h('div', { class: 'empty', text: 'No tracked mega deals in this selection.' })); renderHvaTable(rows); return; }
    const narrow = W < 560;
    const labelW = narrow ? 0 : Math.min(210, W * 0.36);
    const left = labelW + 8, right = 16;
    const rowH = narrow ? 50 : 38, top = 8;
    const max = niceMax(Math.max.apply(null, rows.map(r => Math.max(r.headline_usd_bn || 0, r.actual_usd_bn || 0)).concat([1])));
    const x = v => left + (W - left - right) * v / max;
    const H = top + rows.length * rowH + 24;
    const root = svg('svg', { width: W, height: H, role: 'img', 'aria-label': 'Headline versus actual for the largest deals' }, host);
    ticks(max, narrow ? 3 : 5).forEach(v => {
      svg('line', { class: v === 0 ? 'baseline' : 'gridline', x1: x(v), x2: x(v), y1: top, y2: H - 22 }, root);
      const t = svg('text', { class: 'tick', x: x(v), y: H - 6, 'text-anchor': 'middle' }, root);
      t.textContent = fmtBn(v).replace('$0', '0');
    });
    rows.forEach((r, i) => {
      const yc = top + i * rowH + (narrow ? 32 : rowH / 2);
      const lab = svg('text', { class: 'lbl', x: narrow ? left : labelW, y: narrow ? yc - 14 : yc + 4, 'text-anchor': narrow ? 'start' : 'end' }, root);
      lab.textContent = r.deal.length > 34 && !narrow ? r.deal.slice(0, 33) + '…' : r.deal;
      const hx = r.headline_usd_bn != null ? x(r.headline_usd_bn) : null;
      const ax = r.actual_usd_bn != null ? x(r.actual_usd_bn) : null;
      if (hx != null && ax != null) svg('line', { x1: ax, x2: hx, y1: yc, y2: yc, stroke: 'var(--axis)', 'stroke-width': 2 }, root);
      if (hx != null) svg('circle', { cx: hx, cy: yc, r: 5.5, fill: 'var(--surface)', stroke: 'var(--hl-light)', 'stroke-width': 2.5 }, root);
      if (ax != null) svg('circle', { cx: ax, cy: yc, r: 5.5, fill: 'var(--hl-dark)', stroke: 'var(--surface)', 'stroke-width': 2 }, root);
      const lx = Math.max(hx || 0, ax || 0) + 10;
      const vt = svg('text', { class: 'val', x: lx, y: yc + 4 }, root);
      vt.textContent = (r.actual_usd_bn != null ? fmtBn(r.actual_usd_bn) : 'n/d') + ' of ' + fmtBn(r.headline_usd_bn);
      if (lx + 90 > W) { vt.setAttribute('x', Math.max(hx || 0, ax || 0) - 10); vt.setAttribute('text-anchor', 'end'); vt.setAttribute('y', yc - 9); }
      const hit = svg('rect', { class: 'hit', x: 0, y: yc - rowH / 2, width: W, height: rowH, tabindex: 0 }, root);
      const on = evt => showTip(evt, t => {
        t.appendChild(h('div', { class: 't-head', text: r.deal }));
        tipRow(t, 'Announced ' + fmtDate(r.announced), fmtBn(r.headline_usd_bn));
        tipRow(t, 'So far' + (r.asof ? ' (as of ' + fmtMonth(r.asof) + ')' : ''), r.actual_usd_bn != null ? fmtBn(r.actual_usd_bn) : 'not disclosed');
        if (r.actual_label) t.appendChild(h('div', { class: 't-sub', text: r.actual_label }));
        if (r.status) t.appendChild(h('div', { class: 't-sub', text: 'Status: ' + r.status }));
      });
      hit.addEventListener('pointermove', on); hit.addEventListener('focus', on);
      hit.addEventListener('pointerleave', hideTip); hit.addEventListener('blur', hideTip);
    });
    renderHvaTable(rows);
  }
  function renderHvaTable(rows) {
    const box = $('#hvaTable');
    box.textContent = '';
    const tbl = h('table', { class: 'data' });
    tbl.appendChild(h('thead', null, h('tr', null, h('th', { text: 'Deal' }), h('th', { text: 'Announced' }), h('th', { class: 'num', text: 'Headline' }),
      h('th', { class: 'num', text: 'So far' }), h('th', { text: 'What happened' }), h('th', { text: 'Sources' }))));
    const tb = h('tbody');
    rows.forEach(r => tb.appendChild(h('tr', null, h('td', { text: r.deal }), h('td', { class: 'date', text: fmtDate(r.announced) }),
      h('td', { class: 'num', text: fmtBn(r.headline_usd_bn) }), h('td', { class: 'num', text: r.actual_usd_bn != null ? fmtBn(r.actual_usd_bn) : 'n/d' }),
      h('td', null, r.actual_label || '', r.status ? h('div', { class: 'deal-note', text: r.status + (r.asof ? ' · as of ' + fmtMonth(r.asof) : '') }) : null),
      h('td', { class: 'srcs' }, (r.sources || []).map(u => h('a', { href: u, target: '_blank', rel: 'noopener', text: domain(u) }))))));
    tbl.appendChild(tb);
    box.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
  }

  function revNote(l, d) {
    if (l.usd_bn == null) return null;
    const x = { from: l.from, to: l.to, usd: l.usd_bn, deal: d };
    const parts = [['from', l.from], ['to', l.to]].map(([w, n]) => { const p = legPct(x, w); return p ? n + ' ' + fmtPctBig(p.pct) : null; }).filter(Boolean);
    return parts.length ? h('span', { class: 'deal-note', title: 'Flow as % of annual revenue (fiscal year of the deal)', text: '= ' + parts.join(' · ') + ' of revenue' }) : null;
  }

  // -------------------------------------------------------- deal table --
  function renderTable() {
    const tbl = $('#dealTable');
    tbl.textContent = '';
    const q = S.q.trim().toLowerCase();
    let rows = S.deals;
    if (q) rows = rows.filter(d => (d.deal + ' ' + d.headline_note + ' ' + d.status + ' ' + d.bis_category + ' ' +
      d.legs.map(l => l.from + ' ' + l.to + ' ' + l.type + ' ' + l.note).join(' ') + ' ' + d.sources.join(' ')).toLowerCase().indexOf(q) >= 0);
    const k = S.sort.key, dir = S.sort.dir;
    rows = rows.slice().sort((a, b) => {
      let va, vb;
      if (k === 'value') { va = a.headline_usd_bn; vb = b.headline_usd_bn; if (va == null) return 1; if (vb == null) return -1; }
      else if (k === 'deal') { va = a.deal.toLowerCase(); vb = b.deal.toLowerCase(); }
      else { va = a.date; vb = b.date; }
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    $('#tblCount').textContent = 'Showing ' + rows.length + ' of ' + S.data.deals.length + ' deals';
    const th = (label, key, cls) => {
      const e = h('th', { class: (cls || '') + (key ? ' sortable' : ''), scope: 'col', text: label });
      if (key) {
        e.setAttribute('aria-sort', S.sort.key === key ? (S.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
        e.tabIndex = 0;
        const go = () => { S.sort = { key: key, dir: S.sort.key === key ? -S.sort.dir : (key === 'deal' ? 1 : -1) }; renderTable(); };
        e.addEventListener('click', go);
        e.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
      }
      return e;
    };
    tbl.appendChild(h('thead', null, h('tr', null, th('Announced', 'date'), th('Deal', 'deal'), th('Flows'),
      th('Headline', 'value', 'num'), th('Circularity'), th('Confidence'), th('Sources'))));
    const tb = h('tbody');
    rows.forEach(d => {
      const badges = [];
      if (isSuperseded(d)) badges.push(h('span', { class: 'badge warn', text: d.status }));
      else if (/conditional|reported/i.test(d.status)) badges.push(h('span', { class: 'badge', text: d.status }));
      if (!d.in_totals) badges.push(h('span', { class: 'badge', title: 'Umbrella or duplicate entry - shown but not added to totals', text: 'not summed' }));
      const flows = d.legs.map(l => h('div', { class: 'flow' },
        h('span', { class: 'who', text: l.from + ' → ' + l.to }),
        h('span', { class: 'chip' }, h('span', { class: 'key-rect bg-' + groupOf(l.type) }), TYPE_LABEL[l.type] || l.type),
        h('span', { class: 'amt', text: fmtBn(l.usd_bn) }),
        revNote(l, d),
        l.note ? h('span', { class: 'deal-note', text: l.note }) : null));
      tb.appendChild(h('tr', { class: isSuperseded(d) ? 'superseded' : null },
        h('td', { class: 'date', text: fmtDate(d.date) }),
        h('td', null, h('div', null, d.deal, ' ', badges), d.headline_note ? h('div', { class: 'deal-note', text: d.headline_note }) : null),
        h('td', null, flows),
        h('td', { class: 'num', text: fmtBn(d.headline_usd_bn) }),
        h('td', { text: CAT_LABEL[d.bis_category] || d.bis_category }),
        h('td', { text: d.confidence }),
        h('td', { class: 'srcs' }, d.sources.map(u => h('a', { href: u, target: '_blank', rel: 'noopener', text: domain(u) })))));
    });
    tbl.appendChild(tb);
  }

  // ------------------------------------------------------- BIS panel ----
  function renderBis() {
    const bis = S.data.bis || {};
    const host = $('#bisSplit');
    if (!withRetry(renderBis, host)) return;
    const W = host.clientWidth;
    host.textContent = '';
    const split = (bis.split || []).filter(s => s.pct != null);
    const fill = ['var(--accent)', 'var(--deemph)', 'var(--deemph-2)'];
    const names = ['From AI firms that also buy from or sell to the target (circular)', 'From other AI firms, no commercial link', 'From everyone else'];
    if (split.length) {
      const top = 22, bh = 30;
      const root = svg('svg', { width: W, height: top + bh + 56, role: 'img', 'aria-label': 'Who invests in AI firms' }, host);
      const t0 = svg('text', { class: 'lbl-strong', x: 0, y: 14 }, root);
      t0.textContent = 'Who invested in AI firms, 2021–25 (share of incoming investment by value)';
      let x = 0;
      const total = split.reduce((a, s) => a + s.pct, 0);
      split.forEach((s, i) => {
        const w = W * s.pct / total;
        const ww = Math.max(0.5, w - (i < split.length - 1 ? 2 : 0));
        const r = svg('path', { d: hbarPath(x, top, ww, bh, i === split.length - 1 ? 4 : 0, true), fill: fill[i] || 'var(--deemph-2)' }, root);
        const label = fmtPct(s.pct);
        const tx = svg('text', { x: x + 8, y: top + bh / 2 + 4, class: 'val' }, root);
        tx.textContent = label;
        tx.setAttribute('style', 'fill:' + (i === 0 ? '#ffffff' : 'var(--ink)') + ';font-weight:600');
        const hit = svg('rect', { class: 'hit', x: x, y: top, width: ww, height: bh, tabindex: 0 }, root);
        const on = evt => { r.classList.add('mark-hover'); showTip(evt, t => { t.appendChild(h('div', { class: 't-head', text: names[i] || s.label })); tipRow(t, 'Share of incoming investment', fmtPct(s.pct)); }); };
        const off = () => { r.classList.remove('mark-hover'); hideTip(); };
        hit.addEventListener('pointermove', on); hit.addEventListener('focus', on); hit.addEventListener('pointerleave', off); hit.addEventListener('blur', off);
        x += w;
      });
      // bracket over the AI-to-AI part
      const aiW = W * (split[0].pct + (split[1] ? split[1].pct : 0)) / total;
      svg('path', { d: 'M1,' + (top + bh + 8) + 'v6H' + (aiW - 3) + 'v-6', fill: 'none', stroke: 'var(--axis)', 'stroke-width': 1 }, root);
      const bt = svg('text', { class: 'lbl', x: aiW / 2, y: top + bh + 30, 'text-anchor': 'middle' }, root);
      bt.textContent = fmtPct(split[0].pct + (split[1] ? split[1].pct : 0)) + ' came from other AI firms';
      const lgd = h('div', { class: 'legend' });
      split.forEach((s, i) => lgd.appendChild(h('span', null, h('span', { class: 'key-rect', style: 'background:' + fill[i] }), names[i] || s.label)));
      host.appendChild(lgd);
    }
    const g3 = bis.graph3 || {};
    const stats = $('#bisStats');
    stats.textContent = '';
    const stat = (v, label) => stats.appendChild(h('div', { class: 'tile' }, h('div', { class: 'value', text: fmtPct(v) }), h('div', { class: 'label', text: label })));
    stat(g3['AI firms as targets'], 'of investment into AI firms came from other AI firms (by value)');
    stat(g3['Disclosed deal value'], 'of AI-to-AI investment value was between firms that also trade with each other');
    stat(g3['Deal count'], 'of AI-to-AI deals by count had that commercial link: the big deals are the circular ones');
    stat(g3['AI firms as investors'], 'of AI firms’ own outgoing investment (by value) went to other AI firms');
    // heatmap
    const heat = $('#bisHeat');
    heat.textContent = '';
    const g4 = bis.graph4 || [];
    const layers = ['Compute', 'Infrastructure', 'Data tools', 'Models', 'Applications'];
    const M = {};
    g4.forEach(r => { M[r.source + '|' + r.target] = r.count; });
    const max = Math.max.apply(null, g4.map(r => r.count).concat([1]));
    const ramp = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
    const dark = isDark();
    const tbl = h('table', { class: 'heat' });
    tbl.appendChild(h('thead', null, h('tr', null, h('th', { class: 'rowh', text: 'Investor ↓ · target →' }), layers.map(l => h('th', { text: l })))));
    const tb = h('tbody');
    layers.forEach(src => {
      const tr = h('tr', null, h('th', { class: 'rowh', text: src }));
      layers.forEach(tgt => {
        const v = M[src + '|' + tgt];
        const td = h('td', { class: 'cell', tabindex: 0, text: v ? String(v) : '–' });
        if (v) {
          let idx = Math.round((ramp.length - 1) * v / max);
          if (dark) idx = ramp.length - 1 - idx;
          td.style.background = ramp[idx];
          const lightBg = idx < 6;
          td.style.color = lightBg ? '#0b0b0b' : '#ffffff';
        } else { td.style.background = 'var(--surface-2)'; td.style.color = 'var(--muted)'; }
        const on = evt => showTip(evt, t => { t.appendChild(h('div', { class: 't-head', text: src + ' → ' + tgt })); tipRow(t, 'Circular investments', v ? String(v) : '0'); });
        td.addEventListener('pointermove', on); td.addEventListener('focus', on); td.addEventListener('pointerleave', hideTip); td.addEventListener('blur', hideTip);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    heat.appendChild(h('div', { style: 'overflow-x:auto' }, tbl));
    heat.appendChild(h('div', { class: 'foot', text: 'Stronger shading = more circular investments. Infrastructure firms investing in model makers is the single largest cell. External dataset (2021–25): not affected by the filters above.' }));
    // table view
    const box = $('#bisTable');
    box.textContent = '';
    const t2 = h('table', { class: 'data' });
    t2.appendChild(h('thead', null, h('tr', null, h('th', { text: 'Measure' }), h('th', { class: 'num', text: 'Value' }))));
    const b2 = h('tbody');
    split.forEach((s, i) => b2.appendChild(h('tr', null, h('td', { text: names[i] || s.label }), h('td', { class: 'num', text: fmtPct(s.pct) }))));
    Object.keys(g3).forEach(k => b2.appendChild(h('tr', null, h('td', { text: 'Graph 3: ' + k }), h('td', { class: 'num', text: fmtPct(g3[k]) }))));
    g4.forEach(r => b2.appendChild(h('tr', null, h('td', { text: 'Graph 4: ' + r.source + ' → ' + r.target }), h('td', { class: 'num', text: String(r.count) }))));
    t2.appendChild(b2);
    box.appendChild(h('div', { class: 'tbl-wrap' }, t2));
  }

  // ----------------------------------------------------- FT / Sona map --
  function renderSona() {
    const sona = S.data.sona || {};
    $('#sonaDesc').textContent = 'Sona Asset Management’s deal map, published with FT Alphaville’s “Joining the dots between big AI” (18 Sep 2026): 176 deals worth $3.6tn among 202 entities in the 3½ years to August 2026, covering equity, debt, leases and purchase commitments, with financial investors and M&A included. About 120 of the 176 carry Sona’s “high circularity” flag. The totals below are commitments made and received per entity, as published in the chart (' + (sona.entities || []).length + ' entities, ' + (sona.links || 0) + ' links). External dataset: not affected by the filters above.';
    const ents = (sona.entities || []).filter(e => (e.made_bn || 0) + (e.received_bn || 0) > 0)
      .sort((a, b) => ((b.made_bn || 0) + (b.received_bn || 0)) - ((a.made_bn || 0) + (a.received_bn || 0))).slice(0, 40);
    const max = Math.max.apply(null, ents.map(e => Math.max(e.made_bn || 0, e.received_bn || 0)).concat([1]));
    const tbl = $('#sonaTable');
    tbl.textContent = '';
    tbl.appendChild(h('thead', null, h('tr', null, h('th', { text: 'Entity' }), h('th', { text: 'Commitments made' }), h('th', { text: 'Commitments received' }))));
    const tb = h('tbody');
    const cell = v => h('td', null, h('div', { class: 'bar-cell' }, h('i', { style: 'width:' + (v ? Math.max(2, 140 * v / max) : 0) + 'px' }), h('b', { text: v ? fmtBn(v) : 'undisclosed' })));
    ents.forEach(e => tb.appendChild(h('tr', null, h('td', { text: e.name }), cell(e.made_bn), cell(e.received_bn))));
    tbl.appendChild(tb);
    const dt = $('#sonaDeals');
    dt.textContent = '';
    dt.appendChild(h('thead', null, h('tr', null, h('th', { text: 'Lab' }), h('th', { text: 'Date' }), h('th', { text: 'From' }), h('th', { text: 'To' }),
      h('th', { class: 'num', text: 'Value' }), h('th', { text: 'Type' }), h('th', { text: 'Description' }), h('th', { text: 'Sona note' }))));
    const b2 = h('tbody');
    (sona.lab_deals || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(r => b2.appendChild(h('tr', null,
      h('td', { text: r.lab }), h('td', { class: 'date', text: fmtDate(r.date) }), h('td', { text: r.from }), h('td', { text: r.to }),
      h('td', { class: 'num', text: r.value_label }), h('td', { text: r.type }), h('td', { text: r.description }), h('td', { class: 'deal-note', text: r.notes }))));
    dt.appendChild(b2);
  }

  // ------------------------------------------------------ Nortel line ---
  function renderNortel() {
    const host = $('#ntChart');
    if (!withRetry(renderNortel, host)) return;
    const W = host.clientWidth;
    host.textContent = '';
    const pts = S.data.nortel || [];
    if (!pts.length) { host.appendChild(h('div', { class: 'empty', text: 'Nortel series not available (run scripts/fetch_sources.py).' })); return; }
    const H = 260, axisB = 24, left = 52, right = 16, top = 16;
    const t0 = Date.parse(pts[0].date), t1 = Date.parse(pts[pts.length - 1].date);
    const max = niceMax(Math.max.apply(null, pts.map(p => p.bn)));
    const x = d => left + (W - left - right) * (Date.parse(d) - t0) / (t1 - t0);
    const y = v => top + (H - top) * (1 - v / max);
    const root = svg('svg', { width: W, height: H + axisB, role: 'img', 'aria-label': 'Nortel market capitalisation 1996 to 2015' }, host);
    ticks(max, 4).forEach(v => {
      svg('line', { class: v === 0 ? 'baseline' : 'gridline', x1: left, x2: W - right, y1: y(v), y2: y(v) }, root);
      const t = svg('text', { class: 'tick', x: left - 6, y: y(v) + 4, 'text-anchor': 'end' }, root);
      t.textContent = v === 0 ? '0' : '$' + v + 'bn';
    });
    for (let yr = 1996; yr <= 2015; yr += (W < 640 ? 4 : 2)) {
      const t = svg('text', { class: 'tick', x: x(yr + '-01-01'), y: H + 16, 'text-anchor': 'middle' }, root);
      t.textContent = String(yr);
    }
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p.date).toFixed(1) + ',' + y(p.bn).toFixed(1)).join('');
    svg('path', { d: line + 'L' + x(pts[pts.length - 1].date).toFixed(1) + ',' + y(0) + 'L' + x(pts[0].date).toFixed(1) + ',' + y(0) + 'Z', fill: 'var(--g1)', opacity: 0.1 }, root);
    svg('path', { d: line, fill: 'none', stroke: 'var(--g1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, root);
    const peak = pts.reduce((a, b) => (b.bn > a.bn ? b : a));
    const ch11 = pts.find(p => p.date >= '2009-01-14') || pts[pts.length - 1];
    [[peak, '$' + Math.round(peak.bn) + 'bn peak, ' + fmtMonth(peak.date), 'start'], [ch11, 'Chapter 11, Jan 2009', 'start']].forEach(([p, txt, anc]) => {
      svg('circle', { cx: x(p.date), cy: y(p.bn), r: 4.5, fill: 'var(--g1)', stroke: 'var(--surface)', 'stroke-width': 2 }, root);
      const t = svg('text', { class: 'val', x: x(p.date) + 9, y: y(p.bn) + (p === peak ? 4 : -10), 'text-anchor': anc }, root);
      t.textContent = txt;
    });
    // crosshair
    const cross = svg('line', { x1: 0, x2: 0, y1: top, y2: H, stroke: 'var(--axis)', 'stroke-width': 1, opacity: 0 }, root);
    const dot = svg('circle', { r: 4.5, fill: 'var(--g1)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 }, root);
    const hit = svg('rect', { class: 'hit', x: left, y: top, width: W - left - right, height: H - top }, root);
    hit.addEventListener('pointermove', evt => {
      const r = root.getBoundingClientRect();
      const px = evt.clientX - r.left;
      const t = t0 + (t1 - t0) * (px - left) / (W - left - right);
      let best = pts[0];
      for (const p of pts) if (Math.abs(Date.parse(p.date) - t) < Math.abs(Date.parse(best.date) - t)) best = p;
      cross.setAttribute('x1', x(best.date)); cross.setAttribute('x2', x(best.date)); cross.setAttribute('opacity', 1);
      dot.setAttribute('cx', x(best.date)); dot.setAttribute('cy', y(best.bn)); dot.setAttribute('opacity', 1);
      showTip(evt, tt => { tt.appendChild(h('div', { class: 't-head', text: fmtDate(best.date) })); tipRow(tt, 'Nortel market value', fmtBn(best.bn), 'bg-g1'); });
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); hideTip(); });
    // table view: year-end values
    const box = $('#ntTable');
    box.textContent = '';
    const tbl = h('table', { class: 'data' });
    tbl.appendChild(h('thead', null, h('tr', null, h('th', { text: 'Year end' }), h('th', { class: 'num', text: 'Market value' }))));
    const tb = h('tbody');
    const byYear = {};
    pts.forEach(p => { byYear[p.date.slice(0, 4)] = p; });
    Object.keys(byYear).forEach(yr => tb.appendChild(h('tr', null, h('td', { text: fmtDate(byYear[yr].date) }), h('td', { class: 'num', text: fmtBn(byYear[yr].bn) }))));
    tbl.appendChild(tb);
    box.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
  }

  // ----------------------------------------------------- candidates -----
  function renderCandidates() {
    const c = S.data.candidates || { items: [] };
    const items = (c.items || []).filter(i => !i.state || i.state === 'new');
    const card = $('#candidatesCard');
    card.hidden = !items.length;
    const box = $('#candidates');
    box.textContent = '';
    items.slice(0, 25).forEach(it => {
      box.appendChild(h('div', { class: 'cand' },
        h('div', { class: 'ct' },
          h('a', { href: it.url, target: '_blank', rel: 'noopener', text: it.title }),
          h('div', { class: 'cm', text: [it.source, it.date ? fmtDate(it.date) : '', it.why].filter(Boolean).join(' · ') })),
        h('button', { class: 'btn small', type: 'button', text: 'Add as deal', onclick: () => openDealForm(it) }),
        h('button', { class: 'btn small', type: 'button', text: 'Dismiss', onclick: () => dismissCandidate(it.id) })));
    });
    if (items.length > 25) box.appendChild(h('div', { class: 'foot', text: '+' + (items.length - 25) + ' more' }));
  }
  async function dismissCandidate(id) {
    await fetch(BASE + '/api/candidates/' + encodeURIComponent(id) + '/dismiss', { method: 'POST' });
    await load(true);
  }

  // -------------------------------------------------------- add deal ----
  const dlg = $('#dealDialog');
  let currentCandidate = null;
  function legRow(v) {
    v = v || {};
    const sel = h('select', { name: 'type', 'aria-label': 'Flow type' },
      Object.keys(TYPE_LABEL).map(t => h('option', { value: t, text: TYPE_LABEL[t] })));
    sel.value = v.type || 'investment';
    const row = h('div', { class: 'leg-row' },
      h('input', { name: 'from', list: 'entityList', placeholder: 'From', 'aria-label': 'From', value: v.from || '' }),
      h('input', { name: 'to', list: 'entityList', placeholder: 'To', 'aria-label': 'To', value: v.to || '' }),
      sel,
      h('input', { name: 'usd_bn', inputmode: 'decimal', placeholder: '$bn', 'aria-label': 'Amount in $bn', value: v.usd_bn || '' }),
      h('input', { name: 'note', placeholder: 'Note (optional)', 'aria-label': 'Note', value: v.note || '' }),
      h('button', { class: 'btn small', type: 'button', text: '×', 'aria-label': 'Remove flow', onclick: () => row.remove() }));
    return row;
  }
  function openDealForm(cand) {
    currentCandidate = cand || null;
    const f = $('#dealForm');
    f.reset();
    $('#formErrors').textContent = '';
    $('#legRows').textContent = '';
    $('#legRows').appendChild(legRow({ type: 'investment' }));
    $('#legRows').appendChild(legRow({ type: 'purchase' }));
    f.elements.date.value = cand && cand.date ? cand.date : S.data.meta.today;
    if (cand) { f.elements.deal.value = cand.title || ''; f.elements.sources.value = cand.url || ''; f.elements.confidence.value = 'medium'; }
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  async function saveDeal(ev) {
    ev.preventDefault();
    const f = $('#dealForm');
    const legs = $$('.leg-row', $('#legRows')).map(r => ({
      from: r.querySelector('[name=from]').value, to: r.querySelector('[name=to]').value,
      type: r.querySelector('[name=type]').value, usd_bn: r.querySelector('[name=usd_bn]').value, note: r.querySelector('[name=note]').value,
    }));
    const body = {
      deal: f.elements.deal.value, date: f.elements.date.value, headline_usd_bn: f.elements.headline_usd_bn.value,
      headline_note: f.elements.headline_note.value, bis_category: f.elements.bis_category.value, status: f.elements.status.value,
      confidence: f.elements.confidence.value, sources: f.elements.sources.value, legs: legs,
      candidate_id: currentCandidate ? currentCandidate.id : null,
    };
    const res = await fetch(BASE + '/api/deals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({ ok: false, errors: ['server error'] }));
    if (!out.ok) { $('#formErrors').textContent = (out.errors || ['could not save']).join('; '); return; }
    dlg.close();
    await load(true);
  }

  // ------------------------------------------------------------ method --
  function renderMethod() {
    const box = $('#methodBody');
    box.textContent = '';
    const nSrc = new Set();
    S.data.deals.forEach(d => d.sources.forEach(u => nSrc.add(domain(u))));
    const p = t => h('p', { text: t });
    const li = t => h('li', { text: t });
    box.appendChild(h('h3', { text: 'What counts as circular' }));
    box.appendChild(p('The BIS (Bulletin 137) defines three ways AI firms finance each other in a loop. This table tags every deal with one of them, plus a fourth for two-way trade with no financing:'));
    box.appendChild(h('ul', null,
      li('Investor is also supplier / customer: one firm both finances another and does business with it (Amazon funds Anthropic, Anthropic trains on AWS Trainium).'),
      li('Supplier finances customer: vendor financing, where a chip or cloud supplier provides equity, loans, capacity backstops, leasebacks or residual-value guarantees to a buyer of its products (Nvidia and the neoclouds).'),
      li('Customer finances supplier: the buyer prepays, signs forward compute contracts or takes equity or warrants to secure supply (OpenAI’s AMD warrants, Google’s lease backstops for TeraWulf and Cipher).'),
      li('Reciprocal commercial: goods or services flow both ways without a financing leg.')));
    box.appendChild(h('h3', { text: 'How the numbers are built' }));
    box.appendChild(h('ul', null,
      li('One row per flow (a “leg”): money one way, chips, compute or services the other. A deal’s legs share its date, headline and sources.'),
      li('Values are headline amounts as announced, in US$ billions. “Up to” deals carry the maximum; multi-year contracts carry the total contract value; non-US$ amounts use the exchange rate on the announcement date. Undisclosed values are n/d: they count in deal and flow counts but not in $ totals.'),
      li('The headline tile counts each deal once at its headline value. The timeline and the exposure chart count every disclosed leg, so an investment and the purchase commitment that comes with it are two flows.'),
      li('Umbrella programmes (for example Stargate’s $500bn plan) and round totals that duplicate their parts stay in the table, tagged “not summed”, and are left out of every total.'),
      li('Deals later superseded, cancelled or stalled stay in the history because they were announced; tick “Live deals only” to drop them. “Confirmed only” keeps company-confirmed deals and drops press reports citing people familiar with the matter.'),
      li('Headline vs actual uses company filings and statements for the amount invested, drawn or deployed to date.')));
    box.appendChild(h('h3', { text: 'Sources' }));
    const a = (u, t) => h('a', { href: u, target: '_blank', rel: 'noopener', text: t });
    box.appendChild(h('ul', null,
      h('li', null, a('https://www.bloomberg.com/news/features/2025-10-07/openai-s-nvidia-amd-deals-boost-1-trillion-ai-boom-with-circular-deals', 'Bloomberg, “OpenAI, Nvidia Fuel $1 Trillion AI Market With Web of Circular Deals” (7 Oct 2025)'),
        ' — paywalled; its web is reconstructed here from the public announcements it drew on. Choose the period “To 7 Oct 2025” to see the web as it stood then.'),
      h('li', null, a('https://www.ft.com/content/87875b20-4081-4511-9afe-4ee389409742', 'FT Alphaville, “Is circular financing in AI a problem?” (1 Oct 2026)'), ' and ',
        a('https://www.bis.org/publications/bulletin-137-circular-relationships-among-ai-firms', 'BIS Bulletin 137'), ' (data workbook in data/sources).'),
      h('li', null, a('https://www.ft.com/content/8475dc9b-b2d4-4e10-a6b6-12796b11758a', 'FT Alphaville, “Joining the dots between big AI” (18 Sep 2026)'), ' with Sona Asset Management data, and ',
        a('https://www.ft.com/content/9a6947bf-9d4e-4489-80b9-2178ea657a67', '“Nvidia’s $200bn balance sheet-as-a-service” (26 Aug 2026)'), '.'),
      li('Per-deal sources (' + nSrc.size + ' sites): company press releases and SEC filings first, then Reuters, Bloomberg, CNBC, the FT, the WSJ and The Information. Each row links its own.')));
    box.appendChild(h('h3', { text: 'Keeping it current' }));
    if (READONLY) {
      box.appendChild(p('This website is rebuilt every day from the local deal table; new deals are reviewed by hand before they are added. Last build: ' + fmtDate(S.data.meta.published || S.data.meta.today) + '.'));
      box.appendChild(h('p', { class: 'foot', text: 'Not investment advice.' }));
      return;
    }
    box.appendChild(h('ul', null,
      li('Add a deal with the Add deal button, or edit data/circular_deals.csv in Excel (one row per flow); the page re-reads the file on every load.'),
      li('A daily scan (scripts/scan_news.py, Windows task “AI Circular Financing News Scan”) puts possible new deals at the top of this page for review.'),
      li('scripts/fetch_sources.py refreshes the FT/Sona chart data and the BIS workbook.')));
    box.appendChild(h('p', { class: 'foot', text: 'Deal file last saved ' + (S.data.meta.deals_file_updated || 'n/a').replace('T', ' ') + '. Not investment advice.' }));
  }

  // ------------------------------------------------------- controls -----
  function setCompany(name) {
    S.f.company = name;
    $('#fCompany').value = name;
    rerender();
  }
  function fillCompanySelect() {
    const sel = $('#fCompany');
    const cur = S.f.company;
    sel.textContent = '';
    sel.appendChild(h('option', { value: '', text: 'All companies' }));
    const cnt = new Map();
    S.data.deals.forEach(d => { const seen = new Set(); d.legs.forEach(l => { seen.add(l.from); seen.add(l.to); }); seen.forEach(n => cnt.set(n, (cnt.get(n) || 0) + 1)); });
    Array.from(cnt.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .forEach(([n, c]) => sel.appendChild(h('option', { value: n, text: n + ' (' + c + ')' })));
    sel.value = cur;
    const dl = $('#entityList');
    dl.textContent = '';
    Array.from(cnt.keys()).sort().forEach(n => dl.appendChild(h('option', { value: n })));
  }
  function bindControls() {
    $('#fPeriod').addEventListener('change', e => {
      S.f.period = e.target.value;
      $('#customDates').hidden = S.f.period !== 'custom';
      if (S.f.period === 'custom') { $('#fFrom').value = S.f.from; $('#fTo').value = S.f.to; }
      rerender();
    });
    $('#fFrom').addEventListener('change', e => { S.f.from = e.target.value; rerender(); });
    $('#fTo').addEventListener('change', e => { S.f.to = e.target.value; rerender(); });
    $('#fCompany').addEventListener('change', e => { S.f.company = e.target.value; rerender(); });
    ['g1', 'g2', 'g3'].forEach(g => $('#f' + g.toUpperCase()).addEventListener('change', e => { S.f.g[g] = e.target.checked; rerender(); }));
    $('#fCat').addEventListener('change', e => { S.f.cat = e.target.value; rerender(); });
    $('#fLive').addEventListener('change', e => { S.f.live = e.target.checked; rerender(); });
    $('#fFirm').addEventListener('change', e => { S.f.firm = e.target.checked; rerender(); });
    $('#fReset').addEventListener('click', () => {
      S.f = { period: 'all', from: '2023-01-01', to: '', company: '', g: { g1: true, g2: true, g3: true }, cat: '', live: false, firm: false };
      $('#fPeriod').value = 'all'; $('#customDates').hidden = true; $('#fCompany').value = ''; $('#fCat').value = '';
      ['#fG1', '#fG2', '#fG3'].forEach(s => { $(s).checked = true; }); $('#fLive').checked = false; $('#fFirm').checked = false;
      rerender();
    });
    $$('[data-tl-m]').forEach(b => b.addEventListener('click', () => { S.tl.m = b.dataset.tlM; $$('[data-tl-m]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderTimeline(); }));
    $$('[data-rs]').forEach(b => b.addEventListener('click', () => { S.rs = b.dataset.rs; $$('[data-rs]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderRevShare(); }));
    $$('[data-tl-c]').forEach(b => b.addEventListener('click', () => { S.tl.c = b.dataset.tlC; $$('[data-tl-c]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderTimeline(); }));
    const TV = { web: '#webTable', cake: '#cakeTable', revshare: '#rsTable', timeline: '#tlTable', exposure: '#exTable', hva: '#hvaTable', bis: '#bisTable', telecom: '#ntTable' };
    $$('[data-tablev]').forEach(b => b.addEventListener('click', () => {
      const box = $(TV[b.dataset.tablev]);
      box.hidden = !box.hidden;
      b.textContent = box.hidden ? 'Table view' : 'Hide table';
    }));
    $('#tblSearch').addEventListener('input', e => { S.q = e.target.value; renderTable(); });
    $('#addDealBtn').addEventListener('click', () => openDealForm(null));
    $('#addLegBtn').addEventListener('click', () => $('#legRows').appendChild(legRow({})));
    $('#dlgCancel').addEventListener('click', () => dlg.close());
    $('#dealForm').addEventListener('submit', saveDeal);
    $('#themeBtn').addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('acf-theme', next); } catch (e) { /* storage blocked */ }
      renderAll();
    });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
    let rt = null, lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth < 50) return;  // frame on a hidden monitor tab
      if (Math.abs(window.innerWidth - lastW) < 8) return;
      lastW = window.innerWidth;
      clearTimeout(rt); rt = setTimeout(renderAll, 160);
    });
  }

  function renderAll() {
    if (!S.data) return;
    renderKpis(); renderWeb(); renderCake(); renderTimeline(); renderTable(); renderExposure(); renderHva(); renderRevShare(); renderBis(); renderSona(); renderNortel();
  }
  function rerender() {
    hideTip();
    applyFilters();
    renderAll();
  }

  async function load(keepFrame) {
    if (keepFrame) $('#main').classList.add('loading');
    const res = await fetch(STATIC ? 'data.json' : BASE + '/api/data', { cache: 'no-store' });
    S.data = await res.json();
    S.roles = new Map((S.data.entities || []).map(e => [e.name, e.role]));
    S.layerMap = new Map((S.data.entities || []).map(e => [e.name, e.layer]));
    (S.data.hva || []).forEach(r => { r.parties = r.parties || []; });
    $('#asof').textContent = 'Data to ' + fmtDate(S.data.meta.last_date || '') + ' · today ' + fmtDate(S.data.meta.today);
    fillCompanySelect();
    applyFilters();
    renderAll();
    renderCandidates();
    renderMethod();
    $('#main').classList.remove('loading');
  }

  if (READONLY) $('#addDealBtn').hidden = true;
  // the monitor calls this when its Theme button is pressed
  window.ACF_setTheme = t => { document.documentElement.setAttribute('data-theme', t); renderAll(); };
  bindControls();
  load(false).catch(err => {
    $('#kpis').appendChild(h('div', { class: 'tile' }, h('div', { class: 'label', text: 'Could not load data' }), h('div', { class: 'note', text: String(err) })));
  });
})();
