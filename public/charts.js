/* charts.js — hand-rolled SVG charts.
   House rules: thin marks, 4px rounded data-end, 2px surface gaps, hairline
   solid grid, one axis per plot, legend for 2+ series, table twin for every
   chart, tooltip enhances but never gates a value. */

const Charts = (() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  let uidN = 0;
  const uid = () => 'c' + (++uidN);

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let opts = { patterns: false, motion: true };
  function configure(o) { opts = { ...opts, ...o }; }
  const animate = () => opts.motion && !reduceMotion();

  /* ── element helpers ─────────────────────────────────────── */

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function text(parent, x, y, str, attrs = {}) {
    const t = el('text', {
      x, y,
      'font-size': attrs.size || 11,
      'font-weight': attrs.weight || 400,
      fill: attrs.fill || css('--muted'),
      'text-anchor': attrs.anchor || 'start',
      'dominant-baseline': attrs.baseline || 'auto',
      'font-variant-numeric': 'tabular-nums',
      ...attrs.extra
    }, parent);
    t.textContent = str;
    return t;
  }

  /* ── ticks ───────────────────────────────────────────────── */

  function niceTicks(min, max, count = 5) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  /* ── marks ───────────────────────────────────────────────── */

  // A bar with its data end rounded and its baseline end square.
  function barPath(x, y, w, h, r, side) {
    r = Math.max(0, Math.min(r, w / 2, h));
    if (h <= 0.5) return `M${x} ${y}h${w}`;
    switch (side) {
      case 'top':
        return `M${x} ${y + h} V${y + r} q0 ${-r} ${r} ${-r} h${w - 2 * r} q${r} 0 ${r} ${r} V${y + h} Z`;
      case 'bottom':
        return `M${x} ${y} V${y + h - r} q0 ${r} ${r} ${r} h${w - 2 * r} q${r} 0 ${r} ${-r} V${y} Z`;
      case 'right':
        return `M${x} ${y} H${x + w - r} q${r} 0 ${r} ${r} v${h - 2 * r} q0 ${r} ${-r} ${r} H${x} Z`;
      case 'left':
        return `M${x + w} ${y} H${x + r} q${-r} 0 ${-r} ${r} v${h - 2 * r} q0 ${r} ${r} ${r} H${x + w} Z`;
    }
  }

  function defsFor(svg, colors) {
    if (!opts.patterns) return {};
    const defs = el('defs', {}, svg);
    const map = {};
    colors.forEach((c, i) => {
      const id = uid();
      const p = el('pattern', {
        id, width: 7, height: 7, patternUnits: 'userSpaceOnUse',
        patternTransform: `rotate(${i % 2 ? 135 : 45})`
      }, defs);
      el('rect', { width: 7, height: 7, fill: c }, p);
      el('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: css('--surface-1'), 'stroke-width': 2.4, opacity: 0.9 }, p);
      map[c] = `url(#${id})`;
    });
    return map;
  }

  /* ── tooltip ─────────────────────────────────────────────── */

  const tipEl = () => document.getElementById('tip');

  const tip = {
    show(html, x, y) {
      const t = tipEl();
      if (!t) return;
      t.innerHTML = html;
      t.hidden = false;
      const r = t.getBoundingClientRect();
      let left = x + 14, top = y - r.height - 12;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
      if (top < 8) top = y + 18;
      t.style.left = Math.max(8, left) + 'px';
      t.style.top = top + 'px';
    },
    hide() { const t = tipEl(); if (t) t.hidden = true; }
  };

  function tipRow(color, label, value) {
    const key = color ? `<i class="tip-key" style="background:${color}"></i>` : '';
    return `<div class="tip-row"><span>${key}${label}</span><var>${value}</var></div>`;
  }

  /* ── responsive mount ────────────────────────────────────── */

  const drawers = new WeakMap();
  const ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const fn = drawers.get(e.target);
      if (fn && e.contentRect.width > 0) fn(e.contentRect.width);
    }
  });

  function mount(host, draw) {
    host.innerHTML = '';
    drawers.set(host, draw);
    ro.observe(host);
    const w = host.clientWidth;
    if (w > 0) draw(w);
  }

  function emptyState(host, msg) {
    host.innerHTML = `<p class="plot-empty">${msg}</p>`;
    drawers.delete(host);
    return null;
  }

  /* ── 1. multi-series line (running profit) ───────────────── */

  function line(host, cfg) {
    const { series, labels, fmt = String, fmtFull = fmt, tipTitle = i => labels[i] } = cfg;
    if (!labels.length || !series.length) return emptyState(host, cfg.empty || 'Nothing to plot yet.');

    mount(host, width => {
      host.innerHTML = '';
      const H = cfg.height || 268;
      const padR = cfg.labelRoom ?? 62;
      const m = { t: 14, r: padR, b: 26, l: 52 };
      const w = Math.max(240, width);
      const iw = w - m.l - m.r, ih = H - m.t - m.b;

      const svg = el('svg', { viewBox: `0 0 ${w} ${H}`, height: H, role: 'img', 'aria-label': cfg.aria || 'Line chart' }, host);
      const flat = series.flatMap(s => s.values.filter(v => v !== null));
      const ticks = niceTicks(Math.min(0, ...flat), Math.max(0, ...flat), 5);
      const yMin = ticks[0], yMax = ticks[ticks.length - 1];
      const X = i => m.l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
      const Y = v => m.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

      // grid + y axis
      ticks.forEach(t => {
        const y = Y(t);
        el('line', {
          x1: m.l, x2: m.l + iw, y1: y, y2: y,
          stroke: t === 0 ? css('--axis') : css('--grid'), 'stroke-width': 1
        }, svg);
        text(svg, m.l - 10, y + 3.5, fmt(t), { anchor: 'end' });
      });

      // x labels — thin them out so they never collide
      const every = Math.ceil(labels.length / Math.max(3, Math.floor(iw / 74)));
      labels.forEach((lab, i) => {
        if (i % every && i !== labels.length - 1) return;
        text(svg, X(i), H - 8, lab, { anchor: i === labels.length - 1 ? 'end' : 'middle' });
      });

      // series
      series.forEach((s, si) => {
        const pts = s.values.map((v, i) => (v === null ? null : [X(i), Y(v)])).filter(Boolean);
        if (!pts.length) return;
        const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');

        el('path', {
          d: `${d} L${pts[pts.length - 1][0]} ${Y(yMin)} L${pts[0][0]} ${Y(yMin)} Z`,
          fill: s.color, opacity: 0.08
        }, svg);

        const path = el('path', {
          d, fill: 'none', stroke: s.color, 'stroke-width': 2,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round',
          class: animate() ? 'anim-draw' : ''
        }, svg);
        if (animate()) {
          const len = path.getTotalLength();
          path.style.setProperty('--len', len);
          path.style.animationDelay = si * 110 + 'ms';
        }

        const last = pts[pts.length - 1];
        el('circle', { cx: last[0], cy: last[1], r: 4.5, fill: s.color, stroke: css('--surface-1'), 'stroke-width': 2 }, svg);
        // direct end label — identity from the dot, never coloured text
        text(svg, last[0] + 9, last[1] + 4, s.short ?? s.name, { size: 11.5, weight: 600, fill: css('--ink') });
      });

      // crosshair + hover/keyboard readout
      const cross = el('line', { y1: m.t, y2: m.t + ih, stroke: css('--axis'), 'stroke-width': 1, opacity: 0 }, svg);
      const dots = series.map(s => el('circle', { r: 4.5, fill: s.color, stroke: css('--surface-1'), 'stroke-width': 2, opacity: 0 }, svg));
      let active = -1;

      function focusIdx(i, clientX, clientY) {
        if (i < 0 || i >= labels.length) return;
        active = i;
        const x = X(i);
        cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', 1);
        let rows = '';
        series.forEach((s, si) => {
          const v = s.values[i];
          if (v === null || v === undefined) { dots[si].setAttribute('opacity', 0); return; }
          dots[si].setAttribute('cx', x); dots[si].setAttribute('cy', Y(v)); dots[si].setAttribute('opacity', 1);
          rows += tipRow(s.color, s.name, fmtFull(v));
        });
        const box = host.getBoundingClientRect();
        tip.show(`<b>${tipTitle(i)}</b>${rows}`,
          clientX ?? box.left + x, clientY ?? box.top + m.t + 20);
      }

      function clear() {
        active = -1;
        cross.setAttribute('opacity', 0);
        dots.forEach(d => d.setAttribute('opacity', 0));
        tip.hide();
      }

      const overlay = el('rect', {
        x: m.l - 6, y: m.t, width: iw + 12, height: ih, class: 'hit',
        tabindex: 0, role: 'application', 'aria-label': (cfg.aria || 'Chart') + ' — use arrow keys to read each week'
      }, svg);
      overlay.addEventListener('pointermove', ev => {
        const box = svg.getBoundingClientRect();
        const px = ((ev.clientX - box.left) / box.width) * w;
        const i = Math.round(((px - m.l) / (iw || 1)) * (labels.length - 1));
        focusIdx(Math.max(0, Math.min(labels.length - 1, i)), ev.clientX, ev.clientY);
      });
      overlay.addEventListener('pointerleave', clear);
      overlay.addEventListener('blur', clear);
      overlay.addEventListener('keydown', ev => {
        if (ev.key === 'ArrowRight') { focusIdx(Math.min(labels.length - 1, active < 0 ? 0 : active + 1)); ev.preventDefault(); }
        if (ev.key === 'ArrowLeft') { focusIdx(Math.max(0, active < 0 ? labels.length - 1 : active - 1)); ev.preventDefault(); }
        if (ev.key === 'Escape') clear();
      });
    });
  }

  /* ── 2. grouped columns around zero (week by week) ───────── */

  function groupedColumns(host, cfg) {
    const { groups, series, fmt = String, fmtFull = fmt } = cfg;
    if (!groups.length) return emptyState(host, cfg.empty || 'Nothing to plot yet.');

    mount(host, width => {
      host.innerHTML = '';
      const H = cfg.height || 238;
      const m = { t: 12, r: 6, b: 26, l: 50 };
      const w = Math.max(240, width);
      const iw = w - m.l - m.r, ih = H - m.t - m.b;

      const svg = el('svg', { viewBox: `0 0 ${w} ${H}`, height: H, role: 'img', 'aria-label': cfg.aria || 'Column chart' }, host);
      const pats = defsFor(svg, series.map(s => s.color));

      const flat = groups.flatMap(g => series.map(s => g.values[s.key] || 0));
      const ticks = niceTicks(Math.min(0, ...flat), Math.max(0, ...flat), 4);
      const yMin = ticks[0], yMax = ticks[ticks.length - 1];
      const Y = v => m.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
      const zero = Y(0);

      ticks.forEach(t => {
        const y = Y(t);
        el('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: t === 0 ? css('--axis') : css('--grid'), 'stroke-width': 1 }, svg);
        text(svg, m.l - 9, y + 3.5, fmt(t), { anchor: 'end' });
      });

      const band = iw / groups.length;
      const gap = 2;                                   // surface gap between neighbours
      const barW = Math.min(24, Math.max(4, (band * 0.72 - gap * (series.length - 1)) / series.length));
      const every = Math.ceil(groups.length / Math.max(3, Math.floor(iw / 62)));

      groups.forEach((g, gi) => {
        const cx = m.l + band * gi + band / 2;
        const total = series.length * barW + (series.length - 1) * gap;
        series.forEach((s, si) => {
          const v = g.values[s.key] || 0;
          const x = cx - total / 2 + si * (barW + gap);
          const y = v >= 0 ? Y(v) : zero;
          const h = Math.abs(Y(v) - zero);
          const node = el('path', {
            d: barPath(x, y, barW, h, 4, v >= 0 ? 'top' : 'bottom'),
            fill: pats[s.color] || s.color,
            class: 'mark' + (animate() ? ' anim-rise' : '')
          }, svg);
          if (animate()) {
            node.style.setProperty('--oy', zero + 'px');
            node.style.animationDelay = (gi * 26 + si * 40) + 'ms';
          }

          const hit = el('rect', { x: x - 3, y: m.t, width: barW + 6, height: ih, class: 'hit' }, svg);
          hit.addEventListener('pointerenter', ev => tip.show(
            `<b>${g.label}</b>` + series.map(ss => tipRow(ss.color, ss.name, fmtFull(g.values[ss.key] || 0))).join('') +
            (g.note ? `<div class="tip-row"><span>${g.note}</span></div>` : ''),
            ev.clientX, ev.clientY));
          hit.addEventListener('pointerleave', tip.hide);
        });
        if (!(gi % every)) text(svg, cx, H - 8, g.short || g.label, { anchor: 'middle' });
      });
    });
  }

  /* ── 3. diverging horizontal bars (profit by sport) ──────── */

  function divergingBars(host, cfg) {
    const { rows, fmt = String, fmtFull = fmt, colors } = cfg;
    if (!rows.length) return emptyState(host, cfg.empty || 'Nothing to plot yet.');

    mount(host, width => {
      host.innerHTML = '';
      const rowH = 30, barH = Math.min(18, rowH - 12);
      const m = { t: 8, r: 8, b: 24, l: Math.min(112, Math.max(78, width * 0.24)) };
      const w = Math.max(260, width);
      const H = m.t + rows.length * rowH + m.b;
      const iw = w - m.l - m.r;

      const svg = el('svg', { viewBox: `0 0 ${w} ${H}`, height: H, role: 'img', 'aria-label': cfg.aria || 'Bar chart' }, host);
      const pats = defsFor(svg, [colors.pos, colors.neg]);

      const vals = rows.map(r => r.value);
      const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
      const xMin = ticks[0], xMax = ticks[ticks.length - 1];
      const X = v => m.l + ((v - xMin) / (xMax - xMin || 1)) * iw;
      const zero = X(0);

      ticks.forEach(t => {
        const x = X(t);
        el('line', { x1: x, x2: x, y1: m.t, y2: m.t + rows.length * rowH, stroke: t === 0 ? css('--axis') : css('--grid'), 'stroke-width': 1 }, svg);
        text(svg, x, H - 8, fmt(t), { anchor: 'middle' });
      });

      rows.forEach((r, i) => {
        const y = m.t + i * rowH + (rowH - barH) / 2;
        const pos = r.value >= 0;
        const x = pos ? zero : X(r.value);
        const bw = Math.max(1.5, Math.abs(X(r.value) - zero));
        const color = pos ? colors.pos : colors.neg;

        const node = el('path', {
          d: barPath(x, y, bw, barH, 4, pos ? 'right' : 'left'),
          fill: pats[color] || color, class: 'mark' + (animate() ? ' anim-fade' : '')
        }, svg);
        if (animate()) node.style.animationDelay = i * 34 + 'ms';

        text(svg, m.l - 10, y + barH / 2 + 4, r.label, { anchor: 'end', fill: css('--ink-2'), size: 12 });
        // value rides the tip of the bar, outside the fill so it can never be clipped
        text(svg, pos ? X(r.value) + 8 : X(r.value) - 8, y + barH / 2 + 4, fmtFull(r.value),
          { anchor: pos ? 'start' : 'end', fill: css('--ink'), size: 11.5, weight: 600 });

        const hit = el('rect', { x: m.l, y: m.t + i * rowH, width: iw, height: rowH, class: 'hit' }, svg);
        hit.addEventListener('pointerenter', ev => tip.show(
          `<b>${r.label}</b>` + (r.tip || tipRow(color, 'Profit', fmtFull(r.value))), ev.clientX, ev.clientY));
        hit.addEventListener('pointerleave', tip.hide);
      });
    });
  }

  /* ── 4. diverging columns (profit by multi length) ───────── */

  function divergingColumns(host, cfg) {
    const { cols, fmt = String, fmtFull = fmt, colors } = cfg;
    if (!cols.length) return emptyState(host, cfg.empty || 'Nothing to plot yet.');

    mount(host, width => {
      host.innerHTML = '';
      const H = cfg.height || 238;
      const m = { t: 16, r: 8, b: 42, l: 50 };
      const w = Math.max(240, width);
      const iw = w - m.l - m.r, ih = H - m.t - m.b;

      const svg = el('svg', { viewBox: `0 0 ${w} ${H}`, height: H, role: 'img', 'aria-label': cfg.aria || 'Column chart' }, host);
      const pats = defsFor(svg, [colors.pos, colors.neg]);

      const vals = cols.map(c => c.value);
      const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
      const yMin = ticks[0], yMax = ticks[ticks.length - 1];
      const Y = v => m.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
      const zero = Y(0);

      ticks.forEach(t => {
        const y = Y(t);
        el('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: t === 0 ? css('--axis') : css('--grid'), 'stroke-width': 1 }, svg);
        text(svg, m.l - 9, y + 3.5, fmt(t), { anchor: 'end' });
      });

      const band = iw / cols.length;
      const barW = Math.min(24, band * 0.5);

      cols.forEach((c, i) => {
        const cx = m.l + band * i + band / 2;
        const pos = c.value >= 0;
        const y = pos ? Y(c.value) : zero;
        const h = Math.abs(Y(c.value) - zero);
        const color = pos ? colors.pos : colors.neg;

        const node = el('path', {
          d: barPath(cx - barW / 2, y, barW, h, 4, pos ? 'top' : 'bottom'),
          fill: pats[color] || color, class: 'mark' + (animate() ? ' anim-rise' : '')
        }, svg);
        if (animate()) { node.style.setProperty('--oy', zero + 'px'); node.style.animationDelay = i * 45 + 'ms'; }

        text(svg, cx, pos ? y - 8 : y + h + 14, fmtFull(c.value),
          { anchor: 'middle', fill: css('--ink'), size: 11.5, weight: 600 });
        text(svg, cx, H - 22, c.label, { anchor: 'middle', fill: css('--ink-2'), size: 12 });
        if (c.sub) text(svg, cx, H - 8, c.sub, { anchor: 'middle', size: 10.5 });

        const hit = el('rect', { x: cx - band / 2, y: m.t, width: band, height: ih, class: 'hit' }, svg);
        hit.addEventListener('pointerenter', ev => tip.show(
          `<b>${c.tipTitle || c.label}</b>` + (c.tip || tipRow(color, 'Profit', fmtFull(c.value))), ev.clientX, ev.clientY));
        hit.addEventListener('pointerleave', tip.hide);
      });
    });
  }

  /* ── 5. sparkline (stat tiles) ───────────────────────────── */

  function sparkline(values, color, w = 86, h = 24) {
    if (!values.length) return '';
    const min = Math.min(0, ...values), max = Math.max(0, ...values);
    const X = i => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
    const Y = v => h - ((v - min) / (max - min || 1)) * h;
    const d = values.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
    const zero = Y(0).toFixed(1);
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" style="overflow:visible">
      <line x1="0" x2="${w}" y1="${zero}" y2="${zero}" stroke="${css('--grid')}" stroke-width="1"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${X(values.length - 1).toFixed(1)}" cy="${Y(values[values.length - 1]).toFixed(1)}" r="3"
        fill="${color}" stroke="${css('--surface-1')}" stroke-width="2"/>
    </svg>`;
  }

  /* ── redraw everything (theme / settings change) ─────────── */

  function refreshAll(root = document) {
    root.querySelectorAll('.plot').forEach(p => {
      const fn = drawers.get(p);
      if (fn && p.clientWidth) fn(p.clientWidth);
    });
  }

  return { configure, line, groupedColumns, divergingBars, divergingColumns, sparkline, tip, tipRow, refreshAll, css, niceTicks };
})();

window.Charts = Charts;
