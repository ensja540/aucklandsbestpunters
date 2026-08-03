/* app.js — wiring: state → screen. */

(() => {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const M = ABP;
  const filters = { period: 'all', punter: 'all', sport: 'all', type: 'all' };
  let view = 'dashboard';
  let betsFilter = 'all';
  let editing = null;
  let formPunter = 'p1';
  let formResult = 'pending';

  const punters = () => M.state.club.punters;
  const punter = id => punters().find(p => p.id === id) || punters()[0];
  const colorOf = id => Charts.css(id === 'p2' ? '--p2' : '--p1');
  const trackOf = id => Charts.css(id === 'p2' ? '--p2-track' : '--p1-track');
  const shownPunters = () => (filters.punter === 'all' ? punters() : punters().filter(p => p.id === filters.punter));

  /* ── the silk: each punter's identity mark, hue plus pattern ── */

  let silkN = 0;
  function silk(pid, size = 16) {
    const c = colorOf(pid);
    const h = Math.round(size * 27 / 24);
    const id = 'silk' + (++silkN);
    const body = `<path id="${id}" d="M8 1h8l7 4.5-3.2 6L16 9.3V26H8V9.3l-3.8 2.2L1 5.5Z"/>`;
    const stripes = pid === 'p2'
      ? `<g clip-path="url(#clip${id})">
           <path d="M-6 14 L14-6 M-2 26 L26-2 M6 30 L30 6" stroke="${Charts.css('--surface-1')}" stroke-width="3.4" fill="none"/>
         </g>`
      : '';
    return `<svg viewBox="0 0 24 27" width="${size}" height="${h}" aria-hidden="true" focusable="false">
      <defs><clipPath id="clip${id}">${body}</clipPath></defs>
      <g fill="${c}">${body}</g>${stripes}
    </svg>`;
  }

  const chip = pid => `${silk(pid, 14)}<span>${esc(punter(pid).name)}</span>`;

  /* ── selection ──────────────────────────────────────────── */

  const allBets = () => M.liveBets();
  const scoped = () => M.applyFilters(allBets(), filters);

  /* ── standings ──────────────────────────────────────────── */

  function renderStandings() {
    const bets = scoped();
    const sides = { p1: $('#sideA'), p2: $('#sideB') };
    const sums = {};

    punters().forEach(p => {
      const mine = bets.filter(b => b.punter === p.id);
      const s = M.summarise(mine);
      sums[p.id] = s;
      const run = M.formRun(mine, 12);
      const cells = run.map(b => {
        const cls = b.result === 'win' ? 'form-cell--win' : b.result === 'void' ? 'form-cell--void' : '';
        const style = b.result === 'win' ? ` style="background:${colorOf(p.id)}"` : '';
        const label = b.result === 'win' ? 'Won' : b.result === 'void' ? 'Void' : 'Lost';
        return `<i class="form-cell ${cls}"${style} title="${M.shortDate(b.date)} · ${esc(b.sport)} · ${label} ${M.money(M.profitOf(b), { sign: true })}"></i>`;
      }).join('');

      sides[p.id].innerHTML = `
        <div class="punter-id">${silk(p.id, 22)}<span class="punter-name">${esc(p.name)}</span></div>
        <div class="punter-pl ${s.profit >= 0 ? 'up' : 'down'}">${M.money(s.profit, { sign: true })}</div>
        <div class="punter-meta">
          <span>ROI <b>${M.pctSigned(s.roi)}</b></span>
          <span>Strike <b>${M.pct(s.strike, 0)}</b></span>
          <span>Turnover <b>${M.money(s.turnover, { whole: true })}</b></span>
          ${s.pending ? `<span>Live <b>${s.pending}</b></span>` : ''}
        </div>
        ${run.length ? `<div class="form-line"><span class="form-label">Form</span>${cells}</div>` : ''}`;
    });

    const club = M.summarise(bets);
    const gap = sums.p1.profit - sums.p2.profit;
    const leader = gap === 0 ? null : gap > 0 ? punters()[0] : punters()[1];
    const weeks = new Set(bets.map(b => M.weekStart(b.date))).size;

    if (!bets.length) {
      $('#verdictEyebrow').textContent = 'The ledger';
      $('#verdictHero').textContent = '—';
      $('#verdictSub').textContent = 'No bets in this slice yet.';
      $('#verdictFacts').innerHTML = '';
      return;
    }

    $('#verdictEyebrow').textContent = leader ? `${leader.name} leads by` : 'Dead heat';
    $('#verdictHero').innerHTML = leader ? M.money(Math.abs(gap)) : M.money(0);
    $('#verdictSub').textContent =
      `${club.settled} settled bet${club.settled === 1 ? '' : 's'} across ${weeks} week${weeks === 1 ? '' : 's'}` +
      (club.pending ? ` · ${club.pending} still running` : '');

    $('#verdictFacts').innerHTML = `
      <div><dt>Club net</dt><dd class="${club.profit >= 0 ? 'up' : 'down'}">${M.money(club.profit, { sign: true })}</dd></div>
      <div><dt>Club ROI</dt><dd class="${(club.roi || 0) >= 0 ? 'up' : 'down'}">${M.pctSigned(club.roi)}</dd></div>
      <div><dt>Strike rate</dt><dd>${M.pct(club.strike, 0)}</dd></div>
      <div><dt>Turnover</dt><dd>${M.money(club.turnover, { whole: true })}</dd></div>`;
  }

  /* ── running profit ─────────────────────────────────────── */

  function weekSeries(bets) {
    const dates = bets.map(b => b.date).sort();
    if (!dates.length) return { weeks: [], byWeek: {} };
    const weeks = M.weekRange(dates[0], dates[dates.length - 1]);
    const byWeek = {};
    weeks.forEach(w => { byWeek[w] = {}; punters().forEach(p => { byWeek[w][p.id] = { profit: 0, staked: 0, bets: 0 }; }); });
    bets.forEach(b => {
      const w = M.weekStart(b.date);
      if (!byWeek[w]) return;
      const cell = byWeek[w][b.punter];
      if (!cell) return;
      cell.profit += M.profitOf(b);
      cell.staked += b.stake;
      cell.bets++;
    });
    return { weeks, byWeek };
  }

  function renderCume(bets) {
    const { weeks, byWeek } = weekSeries(bets);
    const people = shownPunters();
    const series = people.map(p => {
      let run = 0;
      return {
        key: p.id, name: p.name, short: p.name.split(' ')[0], color: colorOf(p.id),
        values: weeks.map(w => (run += byWeek[w][p.id].profit))
      };
    });

    legend('#cumeLegend', people.map(p => ({ color: colorOf(p.id), label: p.name })), 'line');

    Charts.line($('#cumeChart'), {
      labels: weeks.map(M.shortDate),
      series,
      height: 288,
      labelRoom: 68,
      fmt: v => M.moneyShort(v),
      fmtFull: v => M.money(v, { sign: true }),
      tipTitle: i => 'Week of ' + M.shortDate(weeks[i]),
      aria: 'Cumulative profit by week',
      empty: 'No settled bets in this slice.'
    });

    table('#cumeTable', {
      head: ['Week', ...people.flatMap(p => [p.name + ' net', p.name + ' running'])],
      rows: (() => {
        const run = {}; people.forEach(p => (run[p.id] = 0));
        return weeks.map(w => [
          M.shortDate(w),
          ...people.flatMap(p => {
            const net = byWeek[w][p.id].profit;
            run[p.id] += net;
            return [signed(net), signed(run[p.id])];
          })
        ]);
      })()
    });
  }

  /* ── week by week ───────────────────────────────────────── */

  function renderWeekly(bets) {
    const { weeks, byWeek } = weekSeries(bets);
    const people = shownPunters();
    const tail = weeks.slice(-16);

    legend('#weeklyLegend', people.map(p => ({ color: colorOf(p.id), label: p.name })), 'square');

    Charts.groupedColumns($('#weeklyChart'), {
      series: people.map(p => ({ key: p.id, name: p.name, color: colorOf(p.id) })),
      groups: tail.map(w => ({
        label: 'Week of ' + M.shortDate(w),
        short: M.shortDate(w),
        values: Object.fromEntries(people.map(p => [p.id, byWeek[w][p.id].profit])),
        note: people.map(p => `${byWeek[w][p.id].bets} bets`).join(' · ')
      })),
      fmt: M.moneyShort,
      fmtFull: v => M.money(v, { sign: true }),
      aria: 'Net profit each week by punter',
      empty: 'No settled bets in this slice.'
    });

    table('#weeklyTable', {
      head: ['Week', ...people.flatMap(p => [p.name + ' net', p.name + ' bets'])],
      rows: weeks.slice().reverse().map(w => [
        M.shortDate(w),
        ...people.flatMap(p => [signed(byWeek[w][p.id].profit), String(byWeek[w][p.id].bets)])
      ])
    });
  }

  /* ── weekly outlay vs allowance ─────────────────────────── */

  function renderOutlay(bets) {
    const people = shownPunters();
    const thisWeek = M.weekStart(M.today());
    const { weeks, byWeek } = weekSeries(bets);

    $('#budgetLabel').textContent = M.money(punters()[0].budget, { whole: true });

    $('#outlayMeters').innerHTML = people.map(p => {
      const staked = allBets()
        .filter(b => b.punter === p.id && M.weekStart(b.date) === thisWeek)
        .reduce((sum, b) => sum + b.stake, 0);
      const budget = p.budget || 45;
      const share = budget ? staked / budget : 0;
      const over = staked > budget + 0.001;
      const fill = over ? Charts.css('--critical') : colorOf(p.id);
      const avg = weeks.length ? weeks.reduce((s, w) => s + byWeek[w][p.id].staked, 0) / weeks.length : 0;
      return `
        <div>
          <div class="meter-head">
            <span class="meter-who">${silk(p.id, 14)}${esc(p.name)}</span>
            <span class="meter-val">${M.money(staked)} of ${M.money(budget, { whole: true })}</span>
          </div>
          <div class="meter-track" style="background:${trackOf(p.id)}">
            <div class="meter-fill" style="width:${Math.min(100, share * 100).toFixed(1)}%;background:${fill}"></div>
          </div>
          <p class="meter-note">
            ${over ? `<span class="meter-flag">⚠ Over the allowance</span> by ${M.money(staked - budget)}`
                   : `<strong>${M.money(Math.max(0, budget - staked))}</strong> left this week`}
            · averages ${M.money(avg)} a week
          </p>
        </div>`;
    }).join('');

    table('#outlayTable', {
      head: ['Week', ...people.flatMap(p => [p.name + ' staked', p.name + ' net'])],
      rows: weeks.slice().reverse().slice(0, 10).map(w => [
        M.shortDate(w),
        ...people.flatMap(p => [M.money(byWeek[w][p.id].staked), signed(byWeek[w][p.id].profit)])
      ]),
      empty: 'No weeks in this slice.'
    });
  }

  /* ── profit by sport ────────────────────────────────────── */

  function sportRows(bets) {
    return M.summariseBy(bets.filter(M.isSettled), b => b.sport)
      .sort((a, b) => b.profit - a.profit);
  }

  function renderSport(bets) {
    const rows = sportRows(bets);
    const shown = rows.length > 10
      ? [...rows.slice(0, 9), foldRest(rows.slice(9), 'Other sports')]
      : rows;

    polarityLegend('#sportLegend');

    Charts.divergingBars($('#sportChart'), {
      rows: shown.map(r => ({
        label: r.key,
        value: r.profit,
        tip: Charts.tipRow(r.profit >= 0 ? Charts.css('--pos') : Charts.css('--neg'), 'Profit', signed(r.profit)) +
             Charts.tipRow(null, 'ROI', M.pctSigned(r.roi)) +
             Charts.tipRow(null, 'Strike rate', M.pct(r.strike, 0)) +
             Charts.tipRow(null, 'Bets', String(r.settled))
      })),
      colors: { pos: Charts.css('--pos'), neg: Charts.css('--neg') },
      fmt: M.moneyShort,
      fmtFull: v => M.money(v, { sign: true }),
      aria: 'Profit by sport',
      empty: 'No settled bets in this slice.'
    });

    table('#sportTable', {
      head: ['Sport', 'Bets', 'Turnover', 'Profit', 'ROI', 'Strike'],
      rows: rows.map(r => [r.key, String(r.settled), M.money(r.turnover), signed(r.profit), M.pctSigned(r.roi), M.pct(r.strike, 0)])
    });

    // full ledger, every sport, no folding
    $('#sportLedger').innerHTML = rows.length ? `
      <table>
        <thead><tr>
          <th>Sport</th><th>Bets</th><th>Won</th><th>Strike</th><th>Avg odds</th>
          <th>Turnover</th><th>Profit</th><th>ROI</th><th>Return per $1</th>
        </tr></thead>
        <tbody>${rows.map(r => {
          const worst = Math.min(...rows.map(x => x.roi ?? 0));
          const best = Math.max(...rows.map(x => x.roi ?? 0));
          const span = Math.max(Math.abs(worst), Math.abs(best)) || 1;
          const w = Math.min(100, Math.abs((r.roi || 0) / span) * 100);
          const c = (r.roi || 0) >= 0 ? Charts.css('--pos') : Charts.css('--neg');
          return `<tr>
            <td>${esc(r.key)}</td>
            <td>${r.settled}</td>
            <td>${r.wins}</td>
            <td>${M.pct(r.strike, 0)}</td>
            <td>${r.avgOdds ? r.avgOdds.toFixed(2) : '—'}</td>
            <td>${M.money(r.turnover)}</td>
            <td class="${r.profit >= 0 ? 'up' : 'down'}">${M.money(r.profit, { sign: true })}</td>
            <td class="${(r.roi || 0) >= 0 ? 'up' : 'down'}">${M.pctSigned(r.roi)}</td>
            <td><span class="roi-bar" style="width:${w.toFixed(0)}px;background:${c}"></span></td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot>${footRow(bets.filter(M.isSettled), 9, [
          ['', 'Total'], [1, s => String(s.settled)], [2, s => String(s.wins)], [3, s => M.pct(s.strike, 0)],
          [4, s => (s.avgOdds ? s.avgOdds.toFixed(2) : '—')], [5, s => M.money(s.turnover)],
          [6, s => M.money(s.profit, { sign: true })], [7, s => M.pctSigned(s.roi)], [8, () => '']
        ])}</tfoot>
      </table>` : '<p class="plot-empty">No settled bets in this slice.</p>';
  }

  function foldRest(rows, label) {
    const bets = rows.flatMap(r => r.bets);
    return { key: label, bets, ...M.summarise(bets) };
  }

  function footRow(bets, cols, cells) {
    const s = M.summarise(bets);
    const out = new Array(cols).fill('');
    cells.forEach(([i, fn]) => { out[i === '' ? 0 : i] = typeof fn === 'function' ? fn(s) : fn; });
    return `<tr>${out.map(v => `<td>${v}</td>`).join('')}</tr>`;
  }

  /* ── profit by multi length ─────────────────────────────── */

  function renderLegs(bets) {
    const buckets = ['1', '2', '3', '4', '5', '6+'];
    const map = new Map(M.summariseBy(bets.filter(M.isSettled), M.legBucket).map(r => [r.key, r]));
    const cols = buckets
      .map(k => ({ k, r: map.get(k) }))
      .filter(x => x.r && x.r.settled > 0);

    polarityLegend('#legsLegend');

    Charts.divergingColumns($('#legsChart'), {
      cols: cols.map(({ k, r }) => ({
        label: k === '1' ? 'Single' : k + ' legs',
        sub: r.settled + ' bet' + (r.settled === 1 ? '' : 's'),
        value: r.profit,
        tipTitle: k === '1' ? 'Singles' : k + '-leg multis',
        tip: Charts.tipRow(r.profit >= 0 ? Charts.css('--pos') : Charts.css('--neg'), 'Profit', signed(r.profit)) +
             Charts.tipRow(null, 'ROI', M.pctSigned(r.roi)) +
             Charts.tipRow(null, 'Strike rate', M.pct(r.strike, 0)) +
             Charts.tipRow(null, 'Turnover', M.money(r.turnover)) +
             Charts.tipRow(null, 'Avg odds', r.avgOdds ? r.avgOdds.toFixed(2) : '—')
      })),
      colors: { pos: Charts.css('--pos'), neg: Charts.css('--neg') },
      fmt: M.moneyShort,
      fmtFull: v => M.money(v, { sign: true }),
      height: 258,
      aria: 'Profit by number of legs',
      empty: 'No settled bets in this slice.'
    });

    table('#legsTable', {
      head: ['Length', 'Bets', 'Won', 'Strike', 'Avg odds', 'Turnover', 'Profit', 'ROI'],
      rows: cols.map(({ k, r }) => [
        k === '1' ? 'Single' : k + ' legs', String(r.settled), String(r.wins), M.pct(r.strike, 0),
        r.avgOdds ? r.avgOdds.toFixed(2) : '—', M.money(r.turnover), signed(r.profit), M.pctSigned(r.roi)
      ])
    });
  }

  /* ── head to head ───────────────────────────────────────── */

  function renderH2H(bets) {
    const people = punters();
    const { weeks, byWeek } = weekSeries(bets);
    const stats = {}, wonWeeks = {};
    people.forEach(p => { stats[p.id] = M.summarise(bets.filter(b => b.punter === p.id)); wonWeeks[p.id] = 0; });

    weeks.forEach(w => {
      const scores = people.map(p => ({ id: p.id, v: byWeek[w][p.id].profit, n: byWeek[w][p.id].bets }));
      if (scores.some(s => s.n === 0)) return;
      const top = Math.max(...scores.map(s => s.v));
      const leaders = scores.filter(s => s.v === top);
      if (leaders.length === 1) wonWeeks[leaders[0].id]++;
    });

    const ticket = b => b ? `${M.money(M.profitOf(b), { sign: true })} <span class="pill">${esc(b.sport)} @ ${b.odds.toFixed(2)}</span>` : '—';

    const rows = [
      ['Net profit', p => `<b class="${stats[p.id].profit >= 0 ? 'up' : 'down'}">${M.money(stats[p.id].profit, { sign: true })}</b>`],
      ['ROI', p => `<span class="${(stats[p.id].roi || 0) >= 0 ? 'up' : 'down'}">${M.pctSigned(stats[p.id].roi)}</span>`],
      ['Strike rate', p => M.pct(stats[p.id].strike, 0)],
      ['Bets settled', p => String(stats[p.id].settled)],
      ['Turnover', p => M.money(stats[p.id].turnover)],
      ['Average odds', p => stats[p.id].avgOdds ? stats[p.id].avgOdds.toFixed(2) : '—'],
      ['Weeks won', p => String(wonWeeks[p.id])],
      ['Longest win run', p => String(M.bestStreak(bets.filter(b => b.punter === p.id)))],
      ['Best ticket', p => ticket(stats[p.id].best)],
      ['Worst ticket', p => ticket(stats[p.id].worst)],
      ['Still running', p => stats[p.id].pending
        ? `${stats[p.id].pending} · ${M.money(stats[p.id].pendingStake)} out, ${M.money(stats[p.id].pendingReturn)} to come`
        : 'Nothing live']
    ];

    $('#h2hTable').innerHTML = bets.length ? `
      <table>
        <thead><tr><th></th>${people.map(p => `<th><span class="cell-who" style="justify-content:flex-end">${silk(p.id, 13)}${esc(p.name)}</span></th>`).join('')}</tr></thead>
        <tbody>${rows.map(([label, fn]) =>
          `<tr><td>${label}</td>${people.map(p => `<td>${fn(p)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>` : '<p class="plot-empty">No bets in this slice.</p>';
  }

  /* ── the honours board ──────────────────────────────────── */

  const AWARDS = [
    { tag: 'Most winning bets', icon: '🏆', kind: 'gold', high: true,
      value: bets => bets.filter(b => b.result === 'win').length,
      fmt: v => v + ' win' + (v === 1 ? '' : 's') },
    { tag: 'Biggest bag', icon: '💰', kind: 'gold', high: true,
      value: bets => bets.filter(b => b.result === 'win').reduce((s, b) => s + M.returned(b), 0),
      fmt: v => M.money(v), note: 'Total collected off winning tickets.' },
    { tag: 'Ticket of the season', icon: '🎯', kind: 'gold', high: true,
      value: bets => Math.max(0, ...bets.filter(M.isSettled).map(M.profitOf)),
      fmt: v => M.money(v, { sign: true }), note: 'Best single bet.' },
    { tag: 'Longest hot run', icon: '🔥', kind: 'gold', high: true,
      value: bets => M.longestRun(bets, 'win'),
      fmt: v => v + ' in a row' },
    { tag: 'Fewest winning bets', icon: '🥄', kind: 'spoon', high: false,
      value: bets => bets.filter(b => b.result === 'win').length,
      fmt: v => v + ' win' + (v === 1 ? '' : 's') },
    { tag: 'Smallest bag', icon: '🕳️', kind: 'spoon', high: false,
      value: bets => bets.filter(b => b.result === 'win').reduce((s, b) => s + M.returned(b), 0),
      fmt: v => M.money(v), note: 'Least collected off winning tickets.' },
    { tag: 'Stinker of the season', icon: '💀', kind: 'spoon', high: false,
      value: bets => Math.min(0, ...bets.filter(M.isSettled).map(M.profitOf)),
      fmt: v => M.money(v, { sign: true }), note: 'Worst single bet.' },
    { tag: 'Longest cold run', icon: '🧊', kind: 'spoon', high: false,
      value: bets => M.longestRun(bets, 'loss'),
      fmt: v => v + ' in a row' }
  ];

  function renderPrizes(bets) {
    const host = $('#prizes');
    const people = punters();
    if (!bets.length) { host.innerHTML = '<p class="plot-empty">Nothing to hand out yet.</p>'; return; }

    host.innerHTML = AWARDS.map(a => {
      const scores = people.map(p => ({ p, v: a.value(bets.filter(b => b.punter === p.id)) }));
      const target = a.high ? Math.max(...scores.map(s => s.v)) : Math.min(...scores.map(s => s.v));
      const holders = scores.filter(s => s.v === target);
      const tied = holders.length !== 1;
      const other = scores.find(s => s !== holders[0]);

      return `
        <div class="prize prize--${a.kind}${tied ? ' prize--tied' : ''}">
          <p class="prize-tag"><i>${a.icon}</i>${a.tag}</p>
          <span class="prize-value">${a.fmt(target)}</span>
          <span class="prize-holder">${tied
            ? 'Shared — nobody wants it settled like that'
            : silk(holders[0].p.id, 15) + esc(holders[0].p.name)}</span>
          ${!tied && other ? `<span class="prize-vs">${esc(other.p.name)} ${a.fmt(other.v)}</span>` : ''}
        </div>`;
    }).join('');
  }

  /* ── a multi lands: the whole page stops ────────────────── */

  const SEEN_KEY = 'abp:seen-wins';
  let celQueue = [];
  let celTimer = null;
  let celReturnFocus = null;

  const isBigWin = b => b.result === 'win' && b.legs > 1 && M.profitOf(b) > 0;

  function seenWins() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function markSeen(ids) {
    const all = [...seenWins(), ...ids];
    localStorage.setItem(SEEN_KEY, JSON.stringify(all.slice(-400)));
  }

  // Every punter gets the takeover the first time *they* see the win — the
  // seen-list is per device, so a win entered on one phone still lands on the other.
  function checkCelebrations() {
    const wins = allBets().filter(isBigWin);
    if (localStorage.getItem(SEEN_KEY) === null) {   // first run here: no backlog blast
      markSeen(wins.map(b => b.id));
      return;
    }
    const seen = seenWins();
    const fresh = wins.filter(b => !seen.has(b.id))
      .sort((a, b) => M.profitOf(b) - M.profitOf(a));
    if (!fresh.length) return;
    markSeen(fresh.map(b => b.id));
    celQueue = fresh;
    showCelebration();
  }

  function celebrate(bet) {           // used when you settle one yourself
    if (!bet || !isBigWin(bet)) return false;
    markSeen([bet.id]);
    celQueue = [bet];
    showCelebration();
    return true;
  }

  function showCelebration() {
    const bet = celQueue.shift();
    if (!bet) return;
    const p = punter(bet.punter);
    const hue = colorOf(bet.punter);
    const box = $('#cel');

    box.style.setProperty('--cel-hue', hue);
    $('#celSilk').innerHTML = silk(bet.punter, 46);
    $('#celEyebrow').textContent = `${bet.legs}-leg ${bet.sgm ? 'same-game multi' : 'multi'} · ${bet.sport}`;
    $('#celAmount').textContent = M.money(M.returned(bet));
    $('#celTitle').textContent = `${p.name} got there`;
    $('#celTicket').textContent =
      `${M.money(bet.stake)} at ${bet.odds.toFixed(2)} · ${M.money(M.profitOf(bet), { sign: true })} profit · ${M.shortDate(bet.date)}`;
    $('#celLegs').innerHTML = [
      bet.event ? esc(bet.event) : null,
      `${bet.legs} legs, all home`,
      bet.sgm ? 'Same-game multi' : null
    ].filter(Boolean).map(t => `<span class="cel-leg">${t}</span>`).join('');

    $('#celQueue').hidden = celQueue.length === 0;
    if (celQueue.length) $('#celQueue').textContent = `${celQueue.length} more win${celQueue.length === 1 ? '' : 's'} to go`;

    dropChips(hue);
    celReturnFocus = document.activeElement;
    box.hidden = false;
    $('#celClose').focus();

    clearTimeout(celTimer);
    celTimer = setTimeout(closeCelebration, 15000);
  }

  function dropChips(hue) {
    const fall = $('#celFall');
    fall.innerHTML = '';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tints = [hue, '#ffffff', hue];
    let html = '';
    for (let i = 0; i < 44; i++) {
      const dur = 2.6 + Math.random() * 3.4;
      html += `<i class="cel-chip" style="left:${(Math.random() * 100).toFixed(1)}%;
        background:${tints[i % tints.length]};
        opacity:${(0.5 + Math.random() * 0.5).toFixed(2)};
        animation-duration:${dur.toFixed(2)}s;
        animation-delay:${(Math.random() * 2.2).toFixed(2)}s;
        --spin:${Math.round(360 + Math.random() * 720)}deg"></i>`;
    }
    fall.innerHTML = html;
  }

  function closeCelebration() {
    clearTimeout(celTimer);
    $('#cel').hidden = true;
    $('#celFall').innerHTML = '';
    if (celQueue.length) { setTimeout(showCelebration, 420); return; }
    if (celReturnFocus && celReturnFocus.focus) celReturnFocus.focus();
  }

  /* ── bets table ─────────────────────────────────────────── */

  function renderBets() {
    const rows = scoped()
      .filter(b => betsFilter === 'all' || M.isLive(b))
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);

    const s = M.summarise(rows);
    $('#betsSub').textContent = rows.length
      ? `${rows.length} bet${rows.length === 1 ? '' : 's'} · ${M.money(s.staked)} staked · ${M.money(s.profit, { sign: true })} settled`
      : 'Nothing here yet.';

    const kind = b => b.legs === 1 ? 'Single' : `${b.legs} legs${b.sgm ? ' · SGM' : ''}`;
    const pill = b => ({
      win: '<span class="pill pill--win">Won</span>',
      loss: '<span class="pill pill--loss">Lost</span>',
      void: '<span class="pill">Void</span>',
      pending: '<span class="pill pill--pending">Pending</span>'
    })[b.result];

    $('#betsTable').innerHTML = rows.length ? `
      <table>
        <thead><tr>
          <th>Date</th><th>Punter</th><th>Sport</th><th>Bet</th><th>Stake</th><th>Odds</th>
          <th>Result</th><th>Return</th><th>Profit</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows.map(b => `
          <tr>
            <td title="${M.longDate(b.date)}">${M.shortDate(b.date)}</td>
            <td><span class="cell-who">${chip(b.punter)}</span></td>
            <td>${esc(b.sport)}${b.event ? `<br><span style="color:var(--muted);font-size:12px">${esc(b.event)}</span>` : ''}</td>
            <td>${kind(b)}</td>
            <td>${M.money(b.stake)}</td>
            <td>${b.odds.toFixed(2)}</td>
            <td>${pill(b)}</td>
            <td>${M.isLive(b) ? `<span style="color:var(--muted)">${M.money(b.stake * b.odds)} to come</span>` : M.money(M.returned(b))}</td>
            <td class="${M.isLive(b) ? '' : M.profitOf(b) >= 0 ? 'up' : 'down'}">${M.isLive(b) ? '—' : M.money(M.profitOf(b), { sign: true })}</td>
            <td>
              ${M.isLive(b)
                ? `<button class="rowbtn" data-settle="win" data-id="${b.id}">Won</button>
                   <button class="rowbtn" data-settle="loss" data-id="${b.id}">Lost</button>
                   <button class="rowbtn" data-settle="void" data-id="${b.id}">Void</button>`
                : `<button class="rowbtn" data-edit="${b.id}">Edit</button>
                   <button class="rowbtn" data-del="${b.id}">Delete</button>`}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="plot-empty">No bets match these filters.</p>';
  }

  /* ── small render helpers ───────────────────────────────── */

  const signed = v => `<span class="${v >= 0 ? 'up' : 'down'}">${M.money(v, { sign: true })}</span>`;

  function legend(sel, items, shape) {
    const host = $(sel);
    if (!host) return;
    host.innerHTML = items.length < 2 ? '' : items.map(i =>
      `<span class="legend-item"><i class="legend-key ${shape === 'square' ? 'legend-key--sq' : ''}" style="background:${i.color}"></i>${esc(i.label)}</span>`
    ).join('');
  }

  function polarityLegend(sel) {
    $(sel).innerHTML =
      `<span class="legend-item"><i class="legend-key legend-key--sq" style="background:${Charts.css('--pos')}"></i>In front</span>` +
      `<span class="legend-item"><i class="legend-key legend-key--sq" style="background:${Charts.css('--neg')}"></i>Behind</span>`;
  }

  function table(sel, { head, rows, empty = 'Nothing to show.' }) {
    const host = $(sel);
    if (!host) return;
    host.innerHTML = rows.length ? `
      <table>
        <thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>` : `<p class="plot-empty">${empty}</p>`;
  }

  /* ── filters ────────────────────────────────────────────── */

  function renderFilterOptions() {
    const pSel = $('#fPunter');
    pSel.innerHTML = '<option value="all">Both punters</option>' +
      punters().map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    pSel.value = filters.punter;

    const used = [...new Set(allBets().map(b => b.sport))].sort();
    const sSel = $('#fSport');
    sSel.innerHTML = '<option value="all">All sports</option>' +
      used.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    sSel.value = used.includes(filters.sport) ? filters.sport : 'all';
    filters.sport = sSel.value;

    $('#sportList').innerHTML = [...new Set([...used, ...M.SPORTS])]
      .map(s => `<option value="${esc(s)}"></option>`).join('');
  }

  /* ── render everything ──────────────────────────────────── */

  function render() {
    Charts.configure({ patterns: M.state.club.patterns, motion: M.state.club.motion });
    $('#wordmarkSilk').innerHTML = silk('p1', 24);
    renderFilterOptions();

    const bets = scoped();
    const total = allBets().length;

    $('#filterCount').textContent = total
      ? `${bets.length} of ${total} bet${total === 1 ? '' : 's'} in view`
      : '';

    renderStandings();

    if (view === 'dashboard') {
      renderCume(bets);
      renderWeekly(bets);
      renderOutlay(bets);
      renderSport(bets);
      renderLegs(bets);
      renderPrizes(bets);
      renderH2H(bets);
    }
    if (view === 'bets') renderBets();
    if (view === 'settings') renderSettings();

    const showEmpty = view !== 'settings' && bets.length === 0;
    const note = $('#emptyNote');
    note.hidden = !showEmpty;
    if (showEmpty) {
      note.innerHTML = total === 0
        ? `Nothing on the ledger yet. <button class="linklike" id="emptyAdd">Add your first bet</button>
           or <button class="linklike" id="emptySample">load a sample season</button> to see how it looks.`
        : `No bets match these filters. <button class="linklike" id="emptyReset">Clear the filters</button>
           or <button class="linklike" id="emptyAdd">add a bet</button>.`;
    }
    $('#view-dashboard').hidden = view !== 'dashboard' || showEmpty;
  }

  function renderSettings() {
    const [a, b] = punters();
    $('#sNameA').value = a.name;
    $('#sBudgetA').value = a.budget;
    $('#sNameB').value = b.name;
    $('#sBudgetB').value = b.budget;
    $('#sPatterns').checked = !!M.state.club.patterns;
    $('#sMotion').checked = !!M.state.club.motion;
    $('#dNote').textContent = `${allBets().length} bets stored in this browser.`;
  }

  /* ── bet form ───────────────────────────────────────────── */

  function renderFormPunters() {
    $('#bPunter').innerHTML = punters().map(p =>
      `<button type="button" class="seg-btn ${p.id === formPunter ? 'is-on' : ''}" data-punter="${p.id}">${silk(p.id, 13)}${esc(p.name)}</button>`
    ).join('');
  }

  function updatePotential() {
    const stake = Number($('#bStake').value) || 0;
    const odds = Number($('#bOdds').value) || 0;
    const ret = stake * odds;
    $('#bPotential').textContent = stake && odds
      ? `Returns ${M.money(ret)} · profit ${M.money(ret - stake, { sign: true })}`
      : '';
  }

  function resetForm() {
    editing = null;
    formResult = 'pending';
    $('#bId').value = '';
    $('#bDate').value = M.today();
    $('#bSport').value = '';
    $('#bEvent').value = '';
    $('#bLegs').value = 1;
    $('#bStake').value = 10;
    $('#bOdds').value = '2.00';
    $('#bSgm').checked = false;
    $('#formTitle').textContent = 'Add a bet';
    $('#bSubmit').textContent = 'Add bet';
    $('#bCancel').hidden = true;
    syncResultButtons();
    updatePotential();
  }

  function syncResultButtons() {
    $$('#bResult .seg-btn').forEach(btn => btn.classList.toggle('is-on', btn.dataset.result === formResult));
  }

  function loadIntoForm(id) {
    const b = allBets().find(x => x.id === id);
    if (!b) return;
    editing = id;
    formPunter = b.punter;
    formResult = b.result;
    $('#bId').value = b.id;
    $('#bDate').value = b.date;
    $('#bSport').value = b.sport;
    $('#bEvent').value = b.event;
    $('#bLegs').value = b.legs;
    $('#bStake').value = b.stake;
    $('#bOdds').value = b.odds;
    $('#bSgm').checked = b.sgm;
    $('#formTitle').textContent = 'Edit bet';
    $('#bSubmit').textContent = 'Save changes';
    $('#bCancel').hidden = false;
    renderFormPunters();
    syncResultButtons();
    updatePotential();
    switchView('bets');
    if ($('#bDate').scrollIntoView) $('#bDate').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ── chrome ─────────────────────────────────────────────── */

  function switchView(next) {
    view = next;
    $$('.tab').forEach(t => {
      const on = t.dataset.view === next;
      t.classList.toggle('is-on', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    $('#view-bets').hidden = next !== 'bets';
    $('#view-settings').hidden = next !== 'settings';
    $('#filterbar').hidden = next === 'settings';
    $('#standings').hidden = next === 'settings';
    render();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function applyTheme(mode) {
    if (mode) document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('abp:theme', mode || '');
    $('#themeGlyph').textContent = mode === 'dark' ? '◑' : mode === 'light' ? '◐' : '◐';
  }

  function currentThemeIsDark() {
    const set = document.documentElement.getAttribute('data-theme');
    if (set) return set === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function syncStatus(status) {
    const stamp = $('#footStamp');
    const map = {
      idle: 'Shared ledger · synced',
      syncing: 'Syncing…',
      offline: 'Offline · saved on this device',
      locked: 'Locked · enter the club code',
      off: 'Saved on this device'
    };
    stamp.textContent = map[status] || '';
    if (status === 'locked') {
      stamp.innerHTML = 'Locked · <button class="linklike" id="unlockBtn">enter the club code</button>';
      $('#unlockBtn').onclick = async () => {
        const code = window.prompt('Club code');
        if (code === null) return;
        M.sync.setPass(code.trim());
        M.sync.setStatus('idle');
        if (await M.sync.pull()) { toast('Ledger unlocked'); render(); }
      };
    }
  }

  /* ── events ─────────────────────────────────────────────── */

  function wire() {
    $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

    $('#themeBtn').addEventListener('click', () => {
      applyTheme(currentThemeIsDark() ? 'light' : 'dark');
      render();
    });

    ['fPeriod', 'fPunter', 'fSport', 'fType'].forEach(id => {
      $('#' + id).addEventListener('change', e => {
        filters[id.slice(1).toLowerCase()] = e.target.value;
        render();
      });
    });

    $('#resetFilters').addEventListener('click', () => {
      Object.assign(filters, { period: 'all', punter: 'all', sport: 'all', type: 'all' });
      $('#fPeriod').value = 'all'; $('#fPunter').value = 'all'; $('#fSport').value = 'all'; $('#fType').value = 'all';
      render();
    });

    // chart / table toggles
    $$('.card .seg-btn[data-mode]').forEach(btn => btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      card.querySelectorAll('.seg-btn[data-mode]').forEach(b => b.classList.toggle('is-on', b === btn));
      const asTable = btn.dataset.mode === 'table';
      card.querySelector('.plot').hidden = asTable;
      const legendEl = card.querySelector('.legend');
      if (legendEl) legendEl.hidden = asTable;
      card.querySelector('.tablewrap').hidden = !asTable;
      if (!asTable) Charts.refreshAll(card);
    }));

    $$('.seg-btn[data-bets]').forEach(btn => btn.addEventListener('click', () => {
      $$('.seg-btn[data-bets]').forEach(b => b.classList.toggle('is-on', b === btn));
      betsFilter = btn.dataset.bets;
      renderBets();
    }));

    // bet form
    $('#bPunter').addEventListener('click', e => {
      const btn = e.target.closest('[data-punter]');
      if (!btn) return;
      formPunter = btn.dataset.punter;
      renderFormPunters();
    });

    $('#bResult').addEventListener('click', e => {
      const btn = e.target.closest('[data-result]');
      if (!btn) return;
      formResult = btn.dataset.result;
      syncResultButtons();
    });

    ['bStake', 'bOdds'].forEach(id => $('#' + id).addEventListener('input', updatePotential));

    $('#betForm').addEventListener('submit', e => {
      e.preventDefault();
      const payload = {
        date: $('#bDate').value,
        punter: formPunter,
        sport: $('#bSport').value.trim() || 'Other',
        event: $('#bEvent').value.trim(),
        legs: Number($('#bLegs').value) || 1,
        sgm: $('#bSgm').checked && Number($('#bLegs').value) > 1,
        stake: Number($('#bStake').value),
        odds: Number($('#bOdds').value),
        result: formResult
      };
      if (!payload.date || !(payload.stake > 0) || !(payload.odds >= 1.01)) {
        toast('Check the date, stake and odds');
        return;
      }
      const saved = editing ? M.updateBet(editing, payload) : M.addBet(payload);
      const wasEditing = !!editing;
      resetForm();
      renderFormPunters();
      render();
      if (!celebrate(saved)) toast(wasEditing ? 'Bet updated' : 'Bet added');
    });

    $('#bCancel').addEventListener('click', () => { resetForm(); renderFormPunters(); });

    // row actions
    $('#betsTable').addEventListener('click', e => {
      const settle = e.target.closest('[data-settle]');
      if (settle) {
        const bet = M.updateBet(settle.dataset.id, { result: settle.dataset.settle });
        render();
        if (!celebrate(bet)) toast('Bet settled');
        return;
      }
      const edit = e.target.closest('[data-edit]');
      if (edit) { loadIntoForm(edit.dataset.edit); return; }
      const del = e.target.closest('[data-del]');
      if (del && window.confirm('Delete this bet? It comes off every chart.')) { M.removeBet(del.dataset.del); render(); toast('Bet deleted'); }
    });

    // empty-state actions (delegated — the note is re-rendered)
    $('#emptyNote').addEventListener('click', e => {
      if (e.target.id === 'emptyAdd') switchView('bets');
      if (e.target.id === 'emptyReset') $('#resetFilters').click();
      if (e.target.id === 'emptySample') loadSample();
    });

    // settings
    $('#clubForm').addEventListener('submit', e => {
      e.preventDefault();
      M.setClub({
        punters: [
          { id: 'p1', name: $('#sNameA').value.trim() || 'Punter 1', budget: Number($('#sBudgetA').value) || 0 },
          { id: 'p2', name: $('#sNameB').value.trim() || 'Punter 2', budget: Number($('#sBudgetB').value) || 0 }
        ]
      });
      renderFormPunters();
      render();
      toast('Club saved');
    });

    $('#sPatterns').addEventListener('change', e => { M.setClub({ patterns: e.target.checked }); render(); });
    $('#sMotion').addEventListener('change', e => { M.setClub({ motion: e.target.checked }); render(); });

    // data
    $('#dExportJson').addEventListener('click', () => {
      download(`abp-backup-${M.today()}.json`, JSON.stringify({ club: M.state.club, bets: M.liveBets() }, null, 2), 'application/json');
      toast('Backup downloaded');
    });
    $('#dExportCsv').addEventListener('click', () => {
      download(`abp-bets-${M.today()}.csv`, M.toCsv(), 'text/csv');
      toast('CSV downloaded');
    });
    $('#dImport').addEventListener('click', () => $('#dFile').click());
    $('#dFile').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const txt = await file.text();
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(txt);
          const added = M.mergeBets(data.bets || []);
          if (data.club) M.setClub(data.club); else M.save();
          toast(`Imported ${added} bet${added === 1 ? '' : 's'}`);
        } else {
          const added = M.mergeBets(M.parseCsv(txt));
          M.save();
          toast(`Imported ${added} bet${added === 1 ? '' : 's'}`);
        }
        render();
      } catch (err) {
        toast('Could not read that file');
        console.error(err);
      }
      e.target.value = '';
    });
    $('#dSample').addEventListener('click', loadSample);
    $('#dClear').addEventListener('click', () => {
      if (window.confirm('Clear every bet? Export a backup first if you want to keep them.')) {
        M.clearBets(); render(); toast('Ledger cleared');
      }
    });

    // celebration
    $('#celClose').addEventListener('click', closeCelebration);
    $('#cel').addEventListener('click', e => { if (e.target.id === 'cel') closeCelebration(); });

    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      Charts.tip.hide();
      if (!$('#cel').hidden) closeCelebration();
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!document.documentElement.getAttribute('data-theme')) render();
    });
  }

  function loadSample() {
    if (allBets().length && !window.confirm('Add a 14-week sample season on top of your bets?')) return;
    M.mergeBets(M.sampleSeason());
    M.save();
    switchView('dashboard');
    render();
    // Don't blast a season's worth of takeovers — show the best one, bank the rest.
    const wins = allBets().filter(isBigWin).sort((a, b) => M.profitOf(b) - M.profitOf(a));
    markSeen(wins.map(b => b.id));
    if (wins.length) { celQueue = [wins[0]]; showCelebration(); }
    else toast('Sample season loaded');
  }

  /* ── boot ───────────────────────────────────────────────── */

  function init() {
    applyTheme(localStorage.getItem('abp:theme') || '');
    M.load();
    M.sync.onStatus = syncStatus;
    syncStatus(M.sync.enabled ? 'syncing' : 'off');
    wire();
    resetForm();
    renderFormPunters();
    render();
    checkCelebrations();
    if (M.sync.enabled) {
      M.sync.pull().then(ok => { if (ok) { render(); checkCelebrations(); } });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
