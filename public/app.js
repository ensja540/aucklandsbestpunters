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
  let formResult = 'pending';
  let ladderSort = 'order';   // squad order by default — it isn't a leaderboard

  const members = () => M.state.club.members;
  const member = id => members().find(m => m.id === id) || members()[0] || { id: 'm1', name: 'Member', slot: 0 };
  const firstName = m => m.name.split(' ')[0];

  /* ── identity: hue is fixed per member, pattern is the second channel ──
     Eight hues, so a tenth member reuses a hue — the silk's stripe keeps
     them apart, and no chart ever puts more than four in colour at once. */

  const SLOTS = 8;
  const slotOf = m => (typeof m.slot === 'number' ? m.slot : members().indexOf(m));
  const hueVar = m => '--s' + (slotOf(m) % SLOTS + 1);
  const colorOf = id => Charts.css(hueVar(member(id)));
  const stripedOf = id => slotOf(member(id)) >= SLOTS;

  let silkN = 0;
  function silk(pid, size = 16) {
    const c = colorOf(pid);
    const h = Math.round(size * 27 / 24);
    const id = 'silk' + (++silkN);
    const body = `<path id="${id}" d="M8 1h8l7 4.5-3.2 6L16 9.3V26H8V9.3l-3.8 2.2L1 5.5Z"/>`;
    const stripes = stripedOf(pid)
      ? `<g clip-path="url(#clip${id})">
           <path d="M-6 14 L14-6 M-2 26 L26-2 M6 30 L30 6" stroke="${Charts.css('--surface-1')}" stroke-width="3.4" fill="none"/>
         </g>`
      : '';
    return `<svg viewBox="0 0 24 27" width="${size}" height="${h}" aria-hidden="true" focusable="false" class="silk">
      <defs><clipPath id="clip${id}">${body}</clipPath></defs>
      <g fill="${c}">${body}</g>${stripes}
    </svg>`;
  }

  const chip = pid => `${silk(pid, 14)}<span>${esc(firstName(member(pid)))}</span>`;

  // "NRL + NBA" for a ticket that strayed across codes.
  const sportLabel = b => M.sportsOf(b).join(' + ');

  /* ── selection ──────────────────────────────────────────── */

  const allBets = () => M.liveBets();
  const scoped = () => M.applyFilters(allBets(), filters);
  const shownMembers = () => (filters.punter === 'all' ? members() : members().filter(m => m.id === filters.punter));

  const signed = v => `<span class="${v >= 0 ? 'up' : 'down'}">${M.money(v, { sign: true })}</span>`;

  /* ── the scoreboard ─────────────────────────────────────── */

  function standingsRows(bets) {
    return members()
      .map(m => {
        const mine = bets.filter(b => b.punter === m.id);
        return { m, mine, ...M.summarise(mine), hot: M.longestRun(mine.slice(-6), 'win'), form: M.formRun(mine, 8) };
      })
      .sort((a, b) => {
        if (ladderSort === 'roi') return (b.roi ?? -9) - (a.roi ?? -9);
        if (ladderSort === 'strike') return (b.strike ?? -9) - (a.strike ?? -9);
        if (ladderSort === 'bets') return b.settled - a.settled;
        if (ladderSort === 'turnover') return b.turnover - a.turnover;
        if (ladderSort === 'profit') return b.profit - a.profit;
        const order = M.rotaOrder();
        const pos = m => (order.indexOf(m.id) + 1 || 99);
        return pos(a.m) - pos(b.m);
      });
  }

  // One club, one number: what's in the tin. Nobody "leads".
  function renderScoreboard(bets) {
    const club = M.summarise(bets);
    const weeks = new Set(bets.map(b => M.weekStart(b.date))).size;
    const { rows } = M.bankSeries(allBets());
    const now = rows.length ? rows[rows.length - 1] : null;
    const playing = members().filter(m => bets.some(b => b.punter === m.id)).length;

    const live = allBets().filter(M.isLive).length;
    const cta = $('#settleCta');
    cta.hidden = live === 0;
    cta.textContent = live ? `Settle ${live} open bet${live === 1 ? '' : 's'}` : '';

    if (!now) {
      $('#verdictEyebrow').textContent = 'In the tin';
      $('#verdictHero').textContent = M.money(0);
      $('#verdictSub').textContent = 'Nothing on the board yet. First bet gets us started.';
      $('#verdictFacts').innerHTML = '';
      return;
    }

    const goal = (M.state.club.goals || [])[0];
    const share = goal && goal.target ? Math.min(1, now.bank / goal.target) : null;

    $('#verdictEyebrow').textContent = 'In the tin';
    $('#verdictHero').textContent = M.money(now.bank);
    $('#verdictSub').textContent =
      `${club.settled} settled bet${club.settled === 1 ? '' : 's'} from ${playing} of us across ${weeks} week${weeks === 1 ? '' : 's'}` +
      (club.pending ? ` · ${club.pending} still running` : '');

    $('#verdictFacts').innerHTML = `
      <div><dt>Paid in</dt><dd>${M.money(now.contributions, { whole: true })}</dd></div>
      <div><dt>Betting P/L</dt><dd class="${club.profit >= 0 ? 'up' : 'down'}">${M.money(club.profit, { sign: true })}</dd></div>
      <div><dt>Club ROI</dt><dd class="${(club.roi || 0) >= 0 ? 'up' : 'down'}">${M.pctSigned(club.roi)}</dd></div>
      <div><dt>Strike rate</dt><dd>${M.pct(club.strike, 0)}</dd></div>
      ${goal ? `<div><dt>${esc(goal.emoji || '')} ${esc(goal.name || 'Goal')}</dt><dd>${M.pct(share, 0)}</dd></div>` : ''}`;
  }

  function renderLadder(bets) {
    const rows = standingsRows(bets);
    const any = rows.some(r => r.bets > 0);
    if (!any) { $('#ladder').innerHTML = '<p class="plot-empty">No bets in this slice.</p>'; return; }

    const club = M.summarise(bets);

    const head = [
      ['Member', 'name'], ['Profit', 'profit'], ['ROI', 'roi'],
      ['Strike', 'strike'], ['Bets', 'bets'], ['Turnover', 'turnover'], ['Form', 'form']
    ];

    $('#ladder').innerHTML = `
      <table class="ladder">
        <thead><tr>${head.map(([label, key]) =>
          `<th${['profit', 'roi', 'strike', 'bets', 'turnover'].includes(key)
            ? ` class="sortable${ladderSort === key ? ' is-sorted' : ''}" data-sort="${key}" role="button" tabindex="0"`
            : ''}>${label}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r, i) => {
          const on = filters.punter === r.m.id;
          const cells = r.form.map(b => {
            const cls = b.result === 'win' ? 'form-cell--win' : b.result === 'void' ? 'form-cell--void' : '';
            const style = b.result === 'win' ? ` style="background:${colorOf(r.m.id)}"` : '';
            return `<i class="form-cell ${cls}"${style} title="${M.shortDate(b.date)} ${esc(sportLabel(b))} ${M.money(M.profitOf(b), { sign: true })}"></i>`;
          }).join('');
          return `<tr class="ladder-row${on ? ' is-picked' : ''}" data-pick="${r.m.id}" tabindex="0">
            <td>
              <span class="cell-who">${silk(r.m.id, 16)}
                <b>${esc(r.m.name)}</b>
                ${r.m.title ? `<span class="tag">${esc(r.m.title)}</span>` : ''}
                ${r.hot >= 3 ? `<span class="tag tag--hot">🔥 ${r.hot} in a row</span>` : ''}
              </span>
            </td>
            <td class="${r.profit >= 0 ? 'up' : 'down'}"><b>${M.money(r.profit, { sign: true })}</b></td>
            <td class="${(r.roi || 0) >= 0 ? 'up' : 'down'}">${M.pctSigned(r.roi)}</td>
            <td>${M.pct(r.strike, 0)}</td>
            <td>${r.settled}${r.pending ? `<span class="live-dot" title="${r.pending} still running"></span>` : ''}</td>
            <td>${M.money(r.turnover, { whole: true })}</td>
            <td><span class="form-line">${cells || '<span class="muted-note">—</span>'}</span></td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr>
          <td>The club</td>
          <td class="${club.profit >= 0 ? 'up' : 'down'}">${M.money(club.profit, { sign: true })}</td>
          <td class="${(club.roi || 0) >= 0 ? 'up' : 'down'}">${M.pctSigned(club.roi)}</td>
          <td>${M.pct(club.strike, 0)}</td>
          <td>${club.settled}</td>
          <td>${M.money(club.turnover, { whole: true })}</td>
          <td></td>
        </tr></tfoot>
      </table>`;
  }

  /* ── whose turn it is ───────────────────────────────────── */

  function turnNames(ids) {
    if (!ids.length) return '<span class="muted-note">Nobody rostered</span>';
    return ids.map(id => `<span class="turn-who">${silk(id, 20)}<b>${esc(member(id).name)}</b></span>`)
      .join('<span class="turn-amp">&amp;</span>');
  }

  function renderSigns() {
    const thisWeek = M.weekStart(M.today());
    const now = M.turnFor(thisWeek);
    const next = M.turnFor(M.addWeeks(thisWeek, 1));

    const placed = allBets().filter(b => M.weekStart(b.date) === thisWeek);
    const byTurn = placed.filter(b => now.ids.includes(b.punter));
    const pool = M.weeklyIn();

    $('#signNowBody').innerHTML = turnNames(now.ids);
    $('#signNowFoot').innerHTML = now.ids.length
      ? (byTurn.length
          ? `${byTurn.length} bet${byTurn.length === 1 ? '' : 's'} on · ${M.money(byTurn.reduce((s, b) => s + b.stake, 0))} of the ${M.money(pool, { whole: true })} pool`
          : `${M.money(pool, { whole: true })} in the pool, nothing on yet · <button class="linklike" data-goto="bets">put it on</button>`)
      : 'Set the rota under Club.';

    $('#signNextBody').innerHTML = turnNames(next.ids);
    $('#signNextFoot').textContent = 'Week of ' + M.longDate(M.addWeeks(thisWeek, 1)).replace(/^\w+, /, '');

    // The pointer walks the list, so the schedule is a run of weeks, not a fixed
    // set of pairs — show what's actually coming.
    $('#rotaList').innerHTML = M.upcomingTurns(6).map((t, i) => `
      <li class="rota-item${i === 0 ? ' is-now' : ''}${i === 1 ? ' is-next' : ''}">
        <span class="rota-week">${i === 0 ? 'This week' : M.shortDate(t.week)}</span>
        <span class="rota-silks">${t.ids.map(id => silk(id, 13)).join('')}</span>
        <span class="rota-names">${t.ids.map(id => esc(firstName(member(id)))).join(' & ') || '—'}</span>
      </li>`).join('') || '<li class="muted-note">No rota set.</li>';
  }

  /* ── the club bank ──────────────────────────────────────── */

  function renderBank() {
    // The bank is a club-wide fact: it ignores the member and sport filters,
    // otherwise "money in" would stop matching what everyone actually paid.
    const bets = M.applyFilters(allBets(), { period: filters.period });
    const { rows } = M.bankSeries(bets);
    const perWeek = M.weeklyIn();

    $('#bankSub').textContent =
      `${members().length} members × ${M.money(members()[0]?.budget ?? M.WEEKLY_IN, { whole: true })} a week = ${M.money(perWeek, { whole: true })} in the tin, every week.`;

    if (!rows.length) {
      $('#bankFigs').innerHTML = '';
      $('#bankLegend').innerHTML = '';
      Charts.line($('#bankChart'), { labels: [], series: [], empty: 'No bets yet — nothing to bank.' });
      $('#bankTable').innerHTML = '';
      return;
    }

    const now = rows[rows.length - 1];
    const ahead = now.bank - now.contributions;

    $('#bankFigs').innerHTML = `
      <div class="bank-fig bank-fig--lead">
        <dt>In the tin</dt>
        <dd>${M.money(now.bank)}</dd>
        <p class="${ahead >= 0 ? 'up' : 'down'}">${M.money(ahead, { sign: true })} on the ${M.money(now.contributions, { whole: true })} paid in</p>
      </div>
      <div class="bank-fig"><dt>Money in</dt><dd>${M.money(now.contributions, { whole: true })}</dd><p>${rows.length} weeks × ${M.money(perWeek, { whole: true })}</p></div>
      <div class="bank-fig"><dt>Collected</dt><dd>${M.money(now.winnings)}</dd><p>off ${M.money(now.staked)} staked</p></div>`;

    const C = {
      bank: Charts.css('--s1'),
      won: Charts.css('--s2'),
      inn: Charts.css('--axis')
    };

    legend('#bankLegend', [
      { color: C.bank, label: 'In the tin' },
      { color: C.won, label: 'Collected off winning bets' },
      { color: C.inn, label: `Paid in (${M.money(perWeek, { whole: true })} a week)` }
    ], 'line');

    Charts.line($('#bankChart'), {
      labels: rows.map(r => M.shortDate(r.week)),
      series: [
        { key: 'in', name: 'Paid in', short: 'Paid in', color: C.inn, reference: true, values: rows.map(r => r.contributions) },
        { key: 'won', name: 'Collected', short: 'Collected', color: C.won, values: rows.map(r => r.winnings) },
        { key: 'bank', name: 'In the tin', short: 'In the tin', color: C.bank, lead: true, values: rows.map(r => r.bank) }
      ],
      height: 320,
      labelRoom: 84,
      fmt: v => M.moneyShort(v),
      fmtFull: v => M.money(v),
      tipTitle: i => 'Week of ' + M.shortDate(rows[i].week),
      aria: 'Club bank, money paid in and winnings collected, by week',
      empty: 'No bets yet — nothing to bank.'
    });

    table('#bankTable', {
      head: ['Week', 'Paid in', 'Staked', 'Collected', 'Betting P/L', 'In the tin'],
      rows: rows.slice().reverse().map(r => [
        M.shortDate(r.week), M.money(r.contributions, { whole: true }), M.money(r.staked),
        M.money(r.winnings), signed(r.profit), `<b>${M.money(r.bank)}</b>`
      ])
    });
  }

  /* ── club aspirations ───────────────────────────────────── */

  function renderGoals() {
    const { rows } = M.bankSeries(allBets());
    const bank = rows.length ? rows[rows.length - 1].bank : 0;
    const perWeek = M.weeklyIn();
    const goals = M.state.club.goals || [];
    const host = $('#goals');

    if (!goals.length) {
      host.innerHTML = `<p class="plot-empty">No aspirations set. Add one under <button class="linklike" data-goto="settings">Club</button>.</p>`;
      return;
    }

    // Earlier goals get funded first — the bank fills them in order.
    let left = bank;
    host.innerHTML = goals.map(g => {
      const target = Math.max(1, g.target || 0);
      const put = Math.max(0, Math.min(target, left));
      left -= put;
      const share = put / target;
      const short = target - put;
      // Weekly growth blends what everyone pays in with how the betting is going.
      const growth = rows.length >= 2 ? (rows[rows.length - 1].bank - rows[0].bank) / rows.length : perWeek;
      const rate = Math.max(growth, 0);
      const weeksOut = short > 0 && rate > 0 ? Math.ceil(short / rate) : null;
      const done = share >= 1;

      return `
        <div class="goal${done ? ' goal--done' : ''}">
          <div class="goal-head">
            <span class="goal-name"><i>${esc(g.emoji || '🎯')}</i>${esc(g.name)}</span>
            <span class="goal-num">${M.money(put, { whole: true })} <span class="muted-note">of ${M.money(target, { whole: true })}</span></span>
          </div>
          <div class="goal-track">
            <div class="goal-fill" style="width:${(share * 100).toFixed(1)}%"></div>
          </div>
          <p class="goal-note">${done
            ? '<b>Funded.</b> Book it.'
            : `${M.money(short, { whole: true })} to go` +
              (weeksOut ? ` · about ${weeksOut} week${weeksOut === 1 ? '' : 's'} at ${M.money(rate)} a week` : ' · nothing going in yet')}</p>
        </div>`;
    }).join('');
  }

  /* ── running profit ─────────────────────────────────────── */

  function weekSeries(bets) {
    const dates = bets.map(b => b.date).sort();
    if (!dates.length) return { weeks: [], byWeek: {} };
    const weeks = M.weekRange(dates[0], dates[dates.length - 1]);
    const byWeek = {};
    weeks.forEach(w => {
      byWeek[w] = {};
      members().forEach(m => { byWeek[w][m.id] = { profit: 0, staked: 0, bets: 0 }; });
    });
    bets.forEach(b => {
      const cell = byWeek[M.weekStart(b.date)]?.[b.punter];
      if (!cell) return;
      cell.profit += M.profitOf(b);
      cell.staked += b.stake;
      cell.bets++;
    });
    return { weeks, byWeek };
  }

  const FOCUS_MAX = 3;   // never more than a handful of hues on one plot

  function renderCume(bets) {
    const { weeks, byWeek } = weekSeries(bets);
    const running = {};
    members().forEach(m => (running[m.id] = weeks.reduce((acc, w) => {
      acc.push((acc.length ? acc[acc.length - 1] : 0) + byWeek[w][m.id].profit);
      return acc;
    }, [])));

    const active = members().filter(m => bets.some(b => b.punter === m.id));

    // The club's line is the story. Individual lines sit behind it as context,
    // and picking a member brings just that one forward.
    const clubLine = weeks.map((w, i) =>
      active.reduce((sum, m) => sum + (running[m.id][i] || 0), 0));
    const picked = filters.punter !== 'all' ? active.filter(m => m.id === filters.punter) : [];
    const isPicked = id => picked.some(m => m.id === id);

    $('#cumeSub').textContent = filters.punter !== 'all'
      ? `${member(filters.punter).name}'s running profit, with the club's total behind it.`
      : 'The club\'s running profit, with everyone\'s own line behind it. Tap a name in the squad to follow one.';

    legend('#cumeLegend', [
      { color: Charts.css('--s1'), label: 'The club' },
      ...picked.map(m => ({ color: colorOf(m.id), label: m.name }))
    ], 'line', active.length ? 'Members' : null);

    Charts.line($('#cumeChart'), {
      labels: weeks.map(M.shortDate),
      series: [
        ...active.map(m => ({
          key: m.id, name: m.name, short: firstName(m),
          color: colorOf(m.id), muted: !isPicked(m.id), values: running[m.id]
        })),
        { key: 'club', name: 'The club', short: 'Club', color: Charts.css('--s1'), lead: true, values: clubLine }
      ],
      height: 300,
      labelRoom: 76,
      fmt: v => M.moneyShort(v),
      fmtFull: v => M.money(v, { sign: true }),
      tipTitle: i => 'Week of ' + M.shortDate(weeks[i]),
      aria: 'Cumulative profit by week and member',
      empty: 'No settled bets in this slice.'
    });

    table('#cumeTable', {
      head: ['Week', 'The club', ...active.map(m => firstName(m))],
      rows: weeks.map((w, i) => [
        M.shortDate(w), `<b>${signed(clubLine[i])}</b>`,
        ...active.map(m => signed(running[m.id][i]))
      ])
    });
  }

  /* ── form grid ──────────────────────────────────────────── */

  function renderGrid(bets) {
    const { weeks, byWeek } = weekSeries(bets);
    const active = members().filter(m => bets.some(b => b.punter === m.id));
    const colors = { pos: Charts.css('--pos'), neg: Charts.css('--neg'), mid: Charts.css('--mid') };

    const rows = active.map(m => ({
      label: m.name,
      id: m.id,
      values: weeks.map(w => (byWeek[w][m.id].bets ? byWeek[w][m.id].profit : null)),
      notes: weeks.map(w => (byWeek[w][m.id].bets ? String(byWeek[w][m.id].bets) : ''))
    }));

    const max = Math.max(1, ...rows.flatMap(r => r.values.map(v => Math.abs(v || 0))));
    Charts.scaleLegend($('#gridLegend'), { max, colors, fmt: v => M.moneyShort(v) });

    Charts.heatmap($('#gridChart'), {
      rows,
      cols: weeks.map(w => ({ label: 'Week of ' + M.shortDate(w), short: M.shortDate(w) })),
      colors,
      rowLabel: r => firstName(member(r.id)),
      fmtFull: v => M.money(v, { sign: true }),
      aria: 'Weekly profit by member',
      empty: 'No settled bets in this slice.'
    });

    table('#gridTable', {
      head: ['Member', ...weeks.map(M.shortDate)],
      rows: rows.map(r => [esc(r.label), ...r.values.map(v => (v === null ? '—' : signed(v)))])
    });
  }

  /* ── weekly outlay ──────────────────────────────────────── */

  function renderOutlay() {
    const thisWeek = M.weekStart(M.today());
    const people = shownMembers();
    $('#budgetLabel').textContent = M.money(members()[0]?.budget ?? 45, { whole: true });

    const week = allBets().filter(b => M.weekStart(b.date) === thisWeek);
    const clubStaked = week.reduce((s, b) => s + b.stake, 0);
    const clubBudget = members().reduce((s, m) => s + (m.budget || 0), 0);

    $('#outlayMeters').innerHTML = `
      <div class="meter-club">
        <div class="meter-head">
          <span class="meter-who">Club pool, week of ${M.shortDate(thisWeek)}</span>
          <span class="meter-val">${M.money(clubStaked)} of ${M.money(clubBudget, { whole: true })}</span>
        </div>
        <div class="meter-track" style="background:var(--grid)">
          <div class="meter-fill" style="width:${Math.min(100, clubBudget ? clubStaked / clubBudget * 100 : 0).toFixed(1)}%;background:var(--ink-2)"></div>
        </div>
      </div>
      <div class="meter-list">
      ${people.map(m => {
        const staked = week.filter(b => b.punter === m.id).reduce((s, b) => s + b.stake, 0);
        const budget = m.budget || 45;
        const over = staked > budget + 0.001;
        const fill = over ? Charts.css('--critical') : colorOf(m.id);
        return `
          <div class="meter-row">
            <span class="meter-who">${silk(m.id, 13)}${esc(firstName(m))}</span>
            <span class="meter-track" style="background:var(--grid)">
              <span class="meter-fill" style="width:${Math.min(100, staked / budget * 100).toFixed(1)}%;background:${fill}"></span>
            </span>
            <span class="meter-val">${M.money(staked)}${over ? ' <span class="meter-flag">⚠ over</span>' : ''}</span>
          </div>`;
      }).join('')}
      </div>`;
  }

  /* ── profit by sport ────────────────────────────────────── */

  // The tail rows are already split across codes, so fold the split numbers
  // rather than re-summarising the tickets (which would double-count mixed ones).
  function foldRest(rows, label) {
    const acc = { key: label, settled: 0, wins: 0, losses: 0, voids: 0, mixed: 0,
                  staked: 0, turnover: 0, profit: 0, returned: 0, oddsSum: 0, oddsN: 0, list: [] };
    rows.forEach(r => {
      ['settled', 'wins', 'losses', 'voids', 'mixed', 'staked', 'turnover', 'profit', 'returned', 'oddsSum', 'oddsN']
        .forEach(k => (acc[k] += r[k] || 0));
      acc.list.push(...r.list);
    });
    acc.roi = acc.turnover > 0 ? acc.profit / acc.turnover : null;
    acc.strike = acc.wins + acc.losses > 0 ? acc.wins / (acc.wins + acc.losses) : null;
    acc.avgOdds = acc.oddsN > 0 ? acc.oddsSum / acc.oddsN : null;
    return acc;
  }

  function renderSport(bets) {
    const rows = M.sportBreakdown(bets).sort((a, b) => b.profit - a.profit);
    const shown = rows.length > 10 ? [...rows.slice(0, 9), foldRest(rows.slice(9), 'Other sports')] : rows;
    const mixed = bets.filter(b => M.isSettled(b) && M.sportsOf(b).length > 1).length;
    $('[data-chart="sport"] .card-sub').textContent = mixed
      ? `Which codes are paying for the trip. ${mixed} mixed ticket${mixed === 1 ? '' : 's'} split across their codes.`
      : 'Which codes are paying for the trip.';

    polarityLegend('#sportLegend');

    Charts.divergingBars($('#sportChart'), {
      rows: shown.map(r => ({
        label: r.key,
        value: r.profit,
        tip: Charts.tipRow(r.profit >= 0 ? Charts.css('--pos') : Charts.css('--neg'), 'Profit', M.money(r.profit, { sign: true })) +
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

    const span = Math.max(...rows.map(r => Math.abs(r.roi || 0)), 0.01);
    $('#sportLedger').innerHTML = rows.length ? `
      <table>
        <thead><tr>
          <th>Sport</th><th>Tickets</th><th>Won</th><th>Strike</th><th>Avg odds</th>
          <th>Turnover</th><th>Profit</th><th>ROI</th><th>Best at it</th>
        </tr></thead>
        <tbody>${rows.map(r => {
          const per = M.summariseBy(r.list, b => b.punter).sort((a, b) => b.profit - a.profit)[0];
          const w = Math.min(100, Math.abs((r.roi || 0) / span) * 100);
          const c = (r.roi || 0) >= 0 ? Charts.css('--pos') : Charts.css('--neg');
          return `<tr>
            <td>${esc(r.key)}</td>
            <td>${r.settled}</td>
            <td>${r.wins}</td>
            <td>${M.pct(r.strike, 0)}</td>
            <td>${r.avgOdds ? r.avgOdds.toFixed(2) : '—'}</td>
            <td>${M.money(r.turnover)}</td>
            <td class="${r.profit >= 0 ? 'up' : 'down'}">${M.money(r.profit, { sign: true })}
              <span class="roi-bar" style="width:${w.toFixed(0)}px;background:${c}"></span></td>
            <td class="${(r.roi || 0) >= 0 ? 'up' : 'down'}">${M.pctSigned(r.roi)}</td>
            <td>${per ? `<span class="cell-who">${chip(per.key)} ${M.money(per.profit, { sign: true })}</span>` : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : '<p class="plot-empty">No settled bets in this slice.</p>';
  }

  /* ── profit by multi length ─────────────────────────────── */

  function renderLegs(bets) {
    // Columns follow whatever's actually been bet, however long the ticket got.
    const cols = M.summariseBy(bets.filter(M.isSettled), M.legBucket)
      .filter(r => r.settled > 0)
      .sort((a, b) => M.legBucketOrder(a.key) - M.legBucketOrder(b.key))
      .map(r => ({ k: r.key, r }));

    polarityLegend('#legsLegend');

    Charts.divergingColumns($('#legsChart'), {
      cols: cols.map(({ k, r }) => ({
        label: k === '1' ? 'Single' : k + ' legs',
        sub: r.settled + ' bet' + (r.settled === 1 ? '' : 's'),
        value: r.profit,
        tipTitle: k === '1' ? 'Singles' : k.endsWith('+') ? `${k} legs` : `${k}-leg multis`,
        tip: Charts.tipRow(r.profit >= 0 ? Charts.css('--pos') : Charts.css('--neg'), 'Profit', M.money(r.profit, { sign: true })) +
             Charts.tipRow(null, 'ROI', M.pctSigned(r.roi)) +
             Charts.tipRow(null, 'Strike rate', M.pct(r.strike, 0)) +
             Charts.tipRow(null, 'Turnover', M.money(r.turnover)) +
             Charts.tipRow(null, 'Avg odds', r.avgOdds ? r.avgOdds.toFixed(2) : '—')
      })),
      colors: { pos: Charts.css('--pos'), neg: Charts.css('--neg') },
      fmt: M.moneyShort,
      fmtFull: v => M.money(v, { sign: true }),
      height: 262,
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

  /* ── the honours board ──────────────────────────────────── */

  const AWARDS = [
    { tag: 'Most winning bets', icon: '🏆', kind: 'gold', high: true, min: 1,
      value: b => b.filter(x => x.result === 'win').length, fmt: v => v + ' win' + (v === 1 ? '' : 's') },
    { tag: 'Biggest bag', icon: '💰', kind: 'gold', high: true, min: 1,
      value: b => b.filter(x => x.result === 'win').reduce((s, x) => s + M.returned(x), 0), fmt: v => M.money(v) },
    { tag: 'Ticket of the season', icon: '🎯', kind: 'gold', high: true, min: 1,
      value: b => Math.max(0, ...b.filter(M.isSettled).map(M.profitOf)), fmt: v => M.money(v, { sign: true }) },
    { tag: 'Longest hot run', icon: '🔥', kind: 'gold', high: true, min: 1,
      value: b => M.longestRun(b, 'win'), fmt: v => v + ' in a row' },
    { tag: 'Best strike rate', icon: '🎖️', kind: 'gold', high: true, min: 8,
      value: b => { const s = M.summarise(b); return s.strike ?? 0; }, fmt: v => M.pct(v, 0) },
    { tag: 'Fewest winning bets', icon: '🥄', kind: 'spoon', high: false, min: 1,
      value: b => b.filter(x => x.result === 'win').length, fmt: v => v + ' win' + (v === 1 ? '' : 's') },
    { tag: 'Smallest bag', icon: '🕳️', kind: 'spoon', high: false, min: 1,
      value: b => b.filter(x => x.result === 'win').reduce((s, x) => s + M.returned(x), 0), fmt: v => M.money(v) },
    { tag: 'Stinker of the season', icon: '💀', kind: 'spoon', high: false, min: 1,
      value: b => Math.min(0, ...b.filter(M.isSettled).map(M.profitOf)), fmt: v => M.money(v, { sign: true }) },
    { tag: 'Longest cold run', icon: '🧊', kind: 'spoon', high: true, min: 1,
      value: b => M.longestRun(b, 'loss'), fmt: v => v + ' in a row' },
    { tag: 'Deepest hole', icon: '⛏️', kind: 'spoon', high: false, min: 1,
      value: b => M.summarise(b).profit, fmt: v => M.money(v, { sign: true }) }
  ];

  function renderPrizes(bets) {
    const host = $('#prizes');
    const pool = members().map(m => ({ m, mine: bets.filter(b => b.punter === m.id) }))
      .filter(x => x.mine.length > 0);
    if (!pool.length) { host.innerHTML = '<p class="plot-empty">Nothing to hand out yet.</p>'; return; }

    host.innerHTML = AWARDS.map(a => {
      const eligible = pool.filter(x => x.mine.filter(M.isSettled).length >= (a.min || 1));
      if (!eligible.length) return '';
      const scores = eligible.map(x => ({ m: x.m, v: a.value(x.mine) }));
      const target = a.high ? Math.max(...scores.map(s => s.v)) : Math.min(...scores.map(s => s.v));
      const holders = scores.filter(s => s.v === target);
      const runnerUp = scores.filter(s => s.v !== target)
        .sort((x, y) => (a.high ? y.v - x.v : x.v - y.v))[0];

      return `
        <div class="prize prize--${a.kind}">
          <p class="prize-tag"><i>${a.icon}</i>${a.tag}</p>
          <span class="prize-value">${a.fmt(target)}</span>
          <span class="prize-holder">${holders.length > 2
            ? `${holders.length} members tied`
            : holders.map(h => `${silk(h.m.id, 15)}${esc(firstName(h.m))}`).join(' & ')}</span>
          ${runnerUp ? `<span class="prize-vs">next: ${esc(firstName(runnerUp.m))} ${a.fmt(runnerUp.v)}</span>` : ''}
        </div>`;
    }).join('');
  }

  /* ── the full book ──────────────────────────────────────── */

  function renderBook(bets) {
    const rows = standingsRows(bets).filter(r => r.bets > 0);
    if (!rows.length) { $('#bookTable').innerHTML = '<p class="plot-empty">No bets in this slice.</p>'; return; }

    const ticket = b => b ? `${M.money(M.profitOf(b), { sign: true })} <span class="pill">${esc(sportLabel(b))} @ ${b.odds.toFixed(2)}</span>` : '—';
    const favourite = mine => {
      const counts = new Map();
      mine.forEach(b => M.sportsOf(b).forEach(s => counts.set(s, (counts.get(s) || 0) + 1)));
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return top ? `${esc(top[0])} <span class="muted-note">${top[1]}</span>` : '—';
    };

    $('#bookTable').innerHTML = `
      <table>
        <thead><tr>
          <th>Member</th><th>Bets</th><th>Won</th><th>Strike</th><th>Avg odds</th><th>Avg stake</th>
          <th>Turnover</th><th>Profit</th><th>ROI</th><th>Best ticket</th><th>Worst ticket</th><th>Go-to sport</th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td><span class="cell-who">${silk(r.m.id, 14)}<b>${esc(r.m.name)}</b></span></td>
            <td>${r.settled}</td>
            <td>${r.wins}</td>
            <td>${M.pct(r.strike, 0)}</td>
            <td>${r.avgOdds ? r.avgOdds.toFixed(2) : '—'}</td>
            <td>${r.avgStake ? M.money(r.avgStake) : '—'}</td>
            <td>${M.money(r.turnover)}</td>
            <td class="${r.profit >= 0 ? 'up' : 'down'}"><b>${M.money(r.profit, { sign: true })}</b></td>
            <td class="${(r.roi || 0) >= 0 ? 'up' : 'down'}">${M.pctSigned(r.roi)}</td>
            <td>${ticket(r.best)}</td>
            <td>${ticket(r.worst)}</td>
            <td>${favourite(r.mine)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  /* ── the ticker ─────────────────────────────────────────── */

  function renderTicker() {
    const recent = allBets().filter(M.isSettled)
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt)
      .slice(0, 14);
    const host = $('#ticker');
    if (recent.length < 4) { host.hidden = true; return; }
    host.hidden = false;

    const item = b => {
      const p = M.profitOf(b);
      const kind = b.legs === 1 ? 'single' : `${b.legs}-leg`;
      return `<span class="tick">
        ${silk(b.punter, 12)}
        <b>${esc(firstName(member(b.punter)))}</b>
        <span class="tick-what">${esc(sportLabel(b))} ${kind}</span>
        <span class="${p >= 0 ? 'up' : 'down'}">${M.money(p, { sign: true })}</span>
      </span>`;
    };
    const strip = recent.map(item).join('<span class="tick-sep">•</span>');
    // duplicated so the scroll never shows a gap
    $('#tickerTrack').innerHTML = `<span class="ticker-run">${strip}</span><span class="ticker-run" aria-hidden="true">${strip}</span>`;
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
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seenWins(), ...ids].slice(-600)));
  }

  // Everyone gets the takeover the first time *they* see the win — the
  // seen-list is per device, so a win posted on one phone still lands on the rest.
  function checkCelebrations() {
    const wins = allBets().filter(isBigWin);
    if (localStorage.getItem(SEEN_KEY) === null) { markSeen(wins.map(b => b.id)); return; }
    const seen = seenWins();
    const fresh = wins.filter(b => !seen.has(b.id)).sort((a, b) => M.profitOf(b) - M.profitOf(a));
    if (!fresh.length) return;
    markSeen(fresh.map(b => b.id));
    celQueue = fresh.slice(0, 4);
    showCelebration();
  }

  function celebrate(bet) {
    if (!bet || !isBigWin(bet)) return false;
    markSeen([bet.id]);
    celQueue = [bet];
    showCelebration();
    return true;
  }

  function showCelebration() {
    const bet = celQueue.shift();
    if (!bet) return;
    const who = member(bet.punter);
    const hue = colorOf(bet.punter);
    const box = $('#cel');

    box.style.setProperty('--cel-hue', hue);
    $('#celSilk').innerHTML = silk(bet.punter, 48);
    $('#celEyebrow').textContent = `${bet.legs}-leg ${bet.sgm ? 'same-game multi' : 'multi'} · ${sportLabel(bet)}`;
    $('#celAmount').textContent = M.money(M.returned(bet));
    $('#celTitle').textContent = `${who.name} got there`;
    $('#celTicket').textContent =
      `${M.money(bet.stake)} at ${bet.odds.toFixed(2)} · ${M.money(M.profitOf(bet), { sign: true })} profit · ${M.shortDate(bet.date)}`;
    $('#celLegs').innerHTML = [
      bet.event || null,
      `${bet.legs} legs, all home`,
      bet.sgm ? 'Same-game multi' : null
    ].filter(Boolean).map(t => `<span class="cel-leg">${esc(t)}</span>`).join('');

    $('#celQueue').hidden = celQueue.length === 0;
    if (celQueue.length) $('#celQueue').textContent = `${celQueue.length} more to go`;

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
      html += `<i class="cel-chip" style="left:${(Math.random() * 100).toFixed(1)}%;
        background:${tints[i % tints.length]};
        opacity:${(0.5 + Math.random() * 0.5).toFixed(2)};
        animation-duration:${(2.6 + Math.random() * 3.4).toFixed(2)}s;
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

  /* ── waiting on a result ────────────────────────────────── */

  function renderPending() {
    const rows = allBets().filter(M.isLive)
      .sort((a, b) => a.date.localeCompare(b.date));
    const card = $('#pendingCard');
    card.hidden = rows.length === 0;
    if (!rows.length) return;

    $('#pendingTable').innerHTML = `
      <table>
        <thead><tr>
          <th>Date</th><th>Member</th><th>Bet</th><th>Stake</th><th>Odds</th><th>Paid</th><th>Result</th>
        </tr></thead>
        <tbody>${rows.map(b => `
          <tr>
            <td>${M.shortDate(b.date)}</td>
            <td><span class="cell-who">${chip(b.punter)}</span></td>
            <td>${esc(sportLabel(b))} · ${b.legs === 1 ? 'single' : b.legs + ' legs'}
              ${b.event ? `<br><span class="muted-note">${esc(b.event)}</span>` : ''}</td>
            <td>${M.money(b.stake)}</td>
            <td>${b.odds.toFixed(2)}</td>
            <td><input class="paid-input" type="number" min="0" step="any" inputmode="decimal"
                  value="${(b.stake * b.odds).toFixed(2)}" data-paid="${b.id}" aria-label="What it paid"></td>
            <td>
              <button class="rowbtn rowbtn--win" data-cash="${b.id}">Collected</button>
              <button class="rowbtn" data-settle="loss" data-id="${b.id}">Lost</button>
              <button class="rowbtn" data-settle="void" data-id="${b.id}">Void</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // "Collected $x" is the honest way in: the payout is what people remember,
  // so the odds get recalculated from it rather than the other way round.
  function cashIn(id) {
    const bet = allBets().find(b => b.id === id);
    const input = $(`[data-paid="${id}"]`);
    if (!bet || !input) return;
    const paid = Number(input.value);
    if (!(paid > 0)) { toast('Enter what it paid'); return; }
    const odds = Math.max(0.0001, Math.round((paid / bet.stake) * 10000) / 10000);
    const saved = M.updateBet(id, { result: 'win', odds });
    render();
    if (!celebrate(saved)) toast(`Collected ${M.money(paid)}`);
  }

  /* ── bets table ─────────────────────────────────────────── */

  function renderBets() {
    renderPending();
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
          <th>Date</th><th>Member</th><th>Sport</th><th>Bet</th><th>Stake</th><th>Odds</th>
          <th>Result</th><th>Return</th><th>Profit</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows.map(b => `
          <tr>
            <td title="${M.longDate(b.date)}">${M.shortDate(b.date)}</td>
            <td><span class="cell-who">${chip(b.punter)}</span></td>
            <td>${esc(sportLabel(b))}${b.event ? `<br><span class="muted-note">${esc(b.event)}</span>` : ''}</td>
            <td>${kind(b)}</td>
            <td>${M.money(b.stake)}</td>
            <td>${b.odds.toFixed(2)}</td>
            <td>${pill(b)}</td>
            <td>${M.isLive(b) ? `<span class="muted-note">${M.money(b.stake * b.odds)} to come</span>` : M.money(M.returned(b))}</td>
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

  function legend(sel, items, shape, fieldLabel) {
    const host = $(sel);
    if (!host) return;
    const parts = items.map(i =>
      `<span class="legend-item"><i class="legend-key ${shape === 'square' ? 'legend-key--sq' : ''}" style="background:${i.color}"></i>${esc(i.label)}</span>`);
    if (fieldLabel) parts.push(`<span class="legend-item"><i class="legend-key legend-key--field"></i>${esc(fieldLabel)}</span>`);
    host.innerHTML = parts.length > 1 ? parts.join('') : '';
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
    pSel.innerHTML = '<option value="all">Whole club</option>' +
      members().map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    pSel.value = filters.punter;

    const used = [...new Set(allBets().flatMap(M.sportsOf))].sort();
    const sSel = $('#fSport');
    sSel.innerHTML = '<option value="all">All sports</option>' +
      used.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    sSel.value = used.includes(filters.sport) ? filters.sport : 'all';
    filters.sport = sSel.value;

    $('#sportList').innerHTML = [...new Set([...used, ...M.SPORTS])]
      .map(s => `<option value="${esc(s)}"></option>`).join('');

    const bSel = $('#bPunter');
    const keep = bSel.value;
    bSel.innerHTML = members().map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    bSel.value = members().some(m => m.id === keep) ? keep : (members()[0]?.id || '');
  }

  /* ── render ─────────────────────────────────────────────── */

  function render() {
    Charts.configure({ patterns: M.state.club.patterns, motion: M.state.club.motion });
    $('#wordmarkSilk').innerHTML = silk(members()[0]?.id || 'm1', 24);
    renderFilterOptions();
    renderTicker();

    const bets = scoped();
    const total = allBets().length;
    $('#filterCount').textContent = total ? `${bets.length} of ${total} bet${total === 1 ? '' : 's'} in view` : '';

    renderScoreboard(bets);
    renderSigns();

    if (view === 'dashboard') {
      renderLadder(bets);
      renderBank();
      renderGoals();
      renderCume(bets);
      renderGrid(bets);
      renderSport(bets);
      renderLegs(bets);
      renderPrizes(bets);
      renderOutlay();
      renderBook(bets);
    }
    if (view === 'bets') renderBets();
    if (view === 'settings') renderSettings();

    const showEmpty = view !== 'settings' && bets.length === 0;
    const note = $('#emptyNote');
    note.hidden = !showEmpty;
    if (showEmpty) {
      note.innerHTML = total === 0
        ? `Nothing on the ledger yet. <button class="linklike" id="emptyAdd">Add the first bet</button>
           or <button class="linklike" id="emptySample">load a sample season</button> to see how it looks.`
        : `No bets match these filters. <button class="linklike" id="emptyReset">Clear the filters</button>
           or <button class="linklike" id="emptyAdd">add a bet</button>.`;
    }
    $('#view-dashboard').hidden = view !== 'dashboard' || showEmpty;
  }

  function renderSettings() {
    $('#memberRows').innerHTML = members().map(m => `
      <div class="member-row" data-id="${m.id}">
        <span class="member-silk">${silk(m.id, 18)}</span>
        <input class="member-name" value="${esc(m.name)}" maxlength="30" aria-label="Member name">
        <input class="member-title" value="${esc(m.title || '')}" maxlength="24" placeholder="Title (optional)" aria-label="Title">
        <input class="member-budget" type="number" min="0" step="5" value="${m.budget ?? 45}" aria-label="Weekly allowance">
        <button type="button" class="rowbtn" data-drop="${m.id}">Remove</button>
      </div>`).join('');
    $('#goalRows').innerHTML = (M.state.club.goals || []).map(g => `
      <div class="goal-row" data-id="${g.id}">
        <input class="goal-emoji" value="${esc(g.emoji || '🎯')}" maxlength="4" aria-label="Emoji">
        <input class="goal-name" value="${esc(g.name)}" maxlength="40" placeholder="Trip to Fiji" aria-label="Aspiration">
        <input class="goal-target" type="number" min="0" step="50" value="${g.target || 0}" aria-label="Target">
        <button type="button" class="rowbtn" data-dropgoal="${g.id}">Remove</button>
      </div>`).join('') || '<p class="muted-note">No aspirations yet.</p>';

    // rota editor — order plus who's up this week
    const order = M.rotaOrder();
    const thisWeek = M.weekStart(M.today());
    const nowIdx = M.turnIndex(thisWeek);
    const size = M.state.club.rotaSize || 2;

    $('#sThisTurn').innerHTML = order.map((id, i) => {
      const pair = [];
      for (let k = 0; k < size; k++) pair.push(firstName(member(order[(i + k) % order.length])));
      return `<option value="${i}"${i === nowIdx ? ' selected' : ''}>${esc(pair.join(' & '))}</option>`;
    }).join('');

    $('#rotaEdit').innerHTML = order.map((id, i) => `
      <li class="rota-edit-row">
        <span class="cell-who">${silk(id, 15)}${esc(member(id).name)}</span>
        <span>
          <button type="button" class="rowbtn" data-move="up" data-pos="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="rowbtn" data-move="down" data-pos="${i}" ${i === order.length - 1 ? 'disabled' : ''}>↓</button>
        </span>
      </li>`).join('');

    $('#sPatterns').checked = !!M.state.club.patterns;
    $('#sMotion').checked = !!M.state.club.motion;
    $('#dNote').textContent = `${allBets().length} bets stored in this browser.`;
  }

  /* ── bet form ───────────────────────────────────────────── */

  /* ── the sport chips ────────────────────────────────────── */

  let formSports = [];

  function renderChips() {
    $('#chipList').innerHTML = formSports.map(s =>
      `<span class="chip">${esc(s)}<button type="button" class="chip-x" data-drop-sport="${esc(s)}" aria-label="Remove ${esc(s)}">×</button></span>`
    ).join('');
    $('#bSport').placeholder = formSports.length ? 'Another code…' : 'NRL, then Enter';
  }

  function addSport(raw) {
    const name = (raw || '').trim();
    if (!name) return;
    const match = [...new Set([...allBets().flatMap(M.sportsOf), ...M.SPORTS])]
      .find(s => s.toLowerCase() === name.toLowerCase());
    const value = match || name;
    if (!formSports.some(s => s.toLowerCase() === value.toLowerCase())) formSports.push(value);
    $('#bSport').value = '';
    renderChips();
  }

  /* ── price: odds, returns and profit are three views of one number ──
     Type into whichever you know and the other two follow. Whichever you
     touched last stays put when the stake changes. */

  let priceAnchor = 'odds';

  const numOf = sel => Number($(sel).value);
  const formOdds = () => numOf('#bOdds');

  function setIf(sel, value, write) {
    if (write) $(sel).value = value;
  }

  function recalcPrice(source) {
    if (source && source !== 'stake') priceAnchor = source;
    const anchor = !source || source === 'stake' ? priceAnchor : source;

    const stake = numOf('#bStake');
    let odds = numOf('#bOdds');

    if (anchor === 'return' && stake > 0) {
      const ret = numOf('#bReturn');
      if (ret > 0) odds = ret / stake;
    } else if (anchor === 'profit' && stake > 0) {
      const profit = numOf('#bProfit');
      if (profit + stake > 0) odds = (profit + stake) / stake;
    }

    if (!(stake > 0) || !(odds > 0)) { $('#bPotential').innerHTML = ''; return; }

    const ret = stake * odds;
    setIf('#bOdds', +odds.toFixed(4), source !== 'odds');
    setIf('#bReturn', ret.toFixed(2), source !== 'return');
    setIf('#bProfit', (ret - stake).toFixed(2), source !== 'profit');
    updatePotential();
  }

  // Live off whatever is typed — no rounding, no minimum, no "enter a valid value".
  // Live off whatever is typed — no rounding, no minimum, no "enter a valid value".
  function updatePotential() {
    const stake = numOf('#bStake');
    const odds = formOdds();
    const box = $('#bPotential');

    if (!(stake > 0) || !(odds > 1)) { box.innerHTML = ''; return; }

    const ret = stake * odds;
    const profit = ret - stake;
    box.innerHTML =
      `<span class="pot-line">${M.money(stake)} at ${odds.toFixed(2)}</span>` +
      `<span class="pot-line">Returns <b>${M.money(ret)}</b></span>` +
      `<span class="pot-line">Profit <b class="${profit >= 0 ? 'up' : 'down'}">${M.money(profit, { sign: true })}</b></span>`;
  }

  function setPriceMode() {          // reset the form back to odds-led
    priceAnchor = 'odds';
    recalcPrice('odds');
  }

  function resetForm() {
    editing = null;
    formResult = 'pending';
    $('#bId').value = '';
    $('#bDate').value = M.today();
    $('#bSport').value = '';
    formSports = [];
    renderChips();
    $('#bEvent').value = '';
    $('#bLegs').value = 1;
    $('#bStake').value = 10;
    $('#bOdds').value = '2.00';
    $('#bSgm').checked = false;
    $('#formTitle').textContent = 'Add a bet';
    $('#bSubmit').textContent = 'Add bet';
    $('#bCancel').hidden = true;
    syncResultButtons();
    setPriceMode('odds');
  }

  function syncResultButtons() {
    $$('#bResult .seg-btn').forEach(btn => btn.classList.toggle('is-on', btn.dataset.result === formResult));
  }

  function loadIntoForm(id) {
    const b = allBets().find(x => x.id === id);
    if (!b) return;
    editing = id;
    formResult = b.result;
    $('#bId').value = b.id;
    $('#bPunter').value = b.punter;
    $('#bDate').value = b.date;
    $('#bSport').value = '';
    formSports = [...M.sportsOf(b)];
    renderChips();
    $('#bEvent').value = b.event;
    $('#bLegs').value = b.legs;
    $('#bStake').value = b.stake;
    $('#bOdds').value = b.odds;
    $('#bSgm').checked = b.sgm;
    $('#formTitle').textContent = 'Edit bet';
    $('#bSubmit').textContent = 'Save changes';
    $('#bCancel').hidden = false;
    syncResultButtons();
    setPriceMode('odds');
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
    $('#scoreboard').hidden = next === 'settings';
    $('#signs').hidden = next === 'settings';
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
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('abp:theme', mode);
    $('#themeGlyph').textContent = mode === 'dark' ? '◑' : '◐';
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

    // any [data-goto] jumps to a view
    document.addEventListener('click', e => {
      const go = e.target.closest('[data-goto]');
      if (go) switchView(go.dataset.goto);
    });

    $('#themeBtn').addEventListener('click', () => {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
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
      ['fPeriod', 'fPunter', 'fSport', 'fType'].forEach(id => ($('#' + id).value = 'all'));
      render();
    });

    // ladder: pick a member, or re-sort
    $('#ladder').addEventListener('click', e => {
      const sortEl = e.target.closest('[data-sort]');
      if (sortEl) { ladderSort = sortEl.dataset.sort; render(); return; }
      const row = e.target.closest('[data-pick]');
      if (!row) return;
      filters.punter = filters.punter === row.dataset.pick ? 'all' : row.dataset.pick;
      render();
    });
    $('#ladder').addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const target = e.target.closest('[data-pick], [data-sort]');
      if (!target) return;
      e.preventDefault();
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

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

    $('#bResult').addEventListener('click', e => {
      const btn = e.target.closest('[data-result]');
      if (!btn) return;
      formResult = btn.dataset.result;
      syncResultButtons();
    });

    // whichever of the four you type into, the rest follow
    const priceFields = { bStake: 'stake', bOdds: 'odds', bReturn: 'return', bProfit: 'profit' };
    Object.entries(priceFields).forEach(([id, key]) =>
      $('#' + id).addEventListener('input', () => recalcPrice(key)));

    // sport chips: Enter or comma commits, × removes
    $('#bSport').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSport(e.target.value); }
      if (e.key === 'Backspace' && !e.target.value && formSports.length) { formSports.pop(); renderChips(); }
    });
    $('#bSport').addEventListener('change', e => addSport(e.target.value));   // datalist pick
    $('#bSport').addEventListener('blur', e => addSport(e.target.value));
    $('#chipList').addEventListener('click', e => {
      const x = e.target.closest('[data-drop-sport]');
      if (!x) return;
      formSports = formSports.filter(s => s !== x.dataset.dropSport);
      renderChips();
    });

    $('#betForm').addEventListener('submit', e => {
      e.preventDefault();
      addSport($('#bSport').value);          // catch a code typed but not entered
      const legs = Number($('#bLegs').value) || 1;
      const payload = {
        date: $('#bDate').value,
        punter: $('#bPunter').value,
        sports: formSports.length ? formSports : ['Other'],
        event: $('#bEvent').value.trim(),
        legs,
        sgm: $('#bSgm').checked && legs > 1,
        stake: Number($('#bStake').value),
        odds: formOdds(),
        result: formResult
      };
      if (!payload.date || !(payload.stake > 0) || !(payload.odds >= 1.01)) {
        toast('Check the date, stake and odds');
        return;
      }
      const saved = editing ? M.updateBet(editing, payload) : M.addBet(payload);
      const wasEditing = !!editing;
      resetForm();
      render();
      if (!celebrate(saved)) toast(wasEditing ? 'Bet updated' : 'Bet added');
    });

    $('#bCancel').addEventListener('click', resetForm);

    $('#pendingTable').addEventListener('click', e => {
      const cash = e.target.closest('[data-cash]');
      if (cash) { cashIn(cash.dataset.cash); return; }
      const settle = e.target.closest('[data-settle]');
      if (settle) {
        M.updateBet(settle.dataset.id, { result: settle.dataset.settle });
        render();
        toast(settle.dataset.settle === 'void' ? 'Marked void' : 'Bad luck');
      }
    });
    $('#pendingTable').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.dataset.paid) { e.preventDefault(); cashIn(e.target.dataset.paid); }
    });

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
      if (del && window.confirm('Delete this bet? It comes off every chart.')) {
        M.removeBet(del.dataset.del); render(); toast('Bet deleted');
      }
    });

    $('#emptyNote').addEventListener('click', e => {
      if (e.target.id === 'emptyAdd') switchView('bets');
      if (e.target.id === 'emptyReset') $('#resetFilters').click();
      if (e.target.id === 'emptySample') loadSample();
    });

    // club
    $('#clubForm').addEventListener('submit', e => {
      e.preventDefault();
      const rows = $$('#memberRows .member-row');
      const next = rows.map((row, i) => {
        const id = row.dataset.id;
        const existing = members().find(m => m.id === id);
        return {
          id,
          name: row.querySelector('.member-name').value.trim() || `Member ${i + 1}`,
          title: row.querySelector('.member-title').value.trim(),
          budget: Number(row.querySelector('.member-budget').value) || 0,
          slot: existing && typeof existing.slot === 'number' ? existing.slot : i
        };
      });
      if (!next.length) { toast('Keep at least one member'); return; }
      M.setClub({ members: next });
      render();
      toast('Club saved');
    });

    $('#memberRows').addEventListener('click', e => {
      const drop = e.target.closest('[data-drop]');
      if (!drop) return;
      const id = drop.dataset.drop;
      const held = allBets().filter(b => b.punter === id).length;
      if (held && !window.confirm(`${member(id).name} has ${held} bets on the ledger. Remove them from the club anyway? The bets stay.`)) return;
      M.setClub({ members: members().filter(m => m.id !== id) });
      render();
    });

    $('#addMember').addEventListener('click', () => {
      const used = new Set(members().map(m => m.id));
      let n = members().length + 1;
      while (used.has('m' + n)) n++;
      const slots = members().map(m => (typeof m.slot === 'number' ? m.slot : 0));
      M.setClub({ members: [...members(), { id: 'm' + n, name: `Member ${n}`, budget: 45, slot: Math.max(-1, ...slots) + 1 }] });
      render();
    });

    // rota
    $('#sThisTurn').addEventListener('change', e => {
      const pos = Number(e.target.value) || 0;
      const back = M.weekOffsetFor(pos);
      M.setClub({ rotaStart: M.addWeeks(M.weekStart(M.today()), -back) });
      render();
      toast('Rota set');
    });

    $('#rotaEdit').addEventListener('click', e => {
      const btn = e.target.closest('[data-move]');
      if (!btn) return;
      const order = [...M.rotaOrder()];
      const i = Number(btn.dataset.pos);
      const j = btn.dataset.move === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      M.setClub({ rota: order });
      render();
    });

    // aspirations
    $('#goalForm').addEventListener('submit', e => {
      e.preventDefault();
      const goals = $$('#goalRows .goal-row').map(row => ({
        id: row.dataset.id,
        emoji: row.querySelector('.goal-emoji').value.trim() || '🎯',
        name: row.querySelector('.goal-name').value.trim() || 'Aspiration',
        target: Number(row.querySelector('.goal-target').value) || 0
      }));
      M.setClub({ goals });
      render();
      toast('Aspirations saved');
    });

    $('#goalRows').addEventListener('click', e => {
      const drop = e.target.closest('[data-dropgoal]');
      if (!drop) return;
      M.setClub({ goals: (M.state.club.goals || []).filter(g => g.id !== drop.dataset.dropgoal) });
      render();
    });

    $('#addGoal').addEventListener('click', () => {
      const goals = M.state.club.goals || [];
      M.setClub({ goals: [...goals, { id: 'g' + (Date.now().toString(36)), emoji: '🎯', name: '', target: 1000 }] });
      render();
    });

    $('#goals').addEventListener('click', e => {
      if (e.target.dataset.goto) switchView(e.target.dataset.goto);
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
        let added;
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(txt);
          if (data.club && Array.isArray(data.club.members)) M.setClub(data.club);
          added = M.mergeBets(data.bets || []);
        } else {
          added = M.mergeBets(M.parseCsv(txt));
        }
        M.save();
        toast(`Imported ${added} bet${added === 1 ? '' : 's'}`);
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

    $('#celClose').addEventListener('click', closeCelebration);
    $('#cel').addEventListener('click', e => { if (e.target.id === 'cel') closeCelebration(); });

    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      Charts.tip.hide();
      if (!$('#cel').hidden) closeCelebration();
    });
  }

  function loadSample() {
    if (allBets().length && !window.confirm('Add a sample season on top of the ledger?')) return;
    M.mergeBets(M.sampleSeason());
    M.save();
    switchView('dashboard');
    // Don't blast a season's worth of takeovers — show the best one, bank the rest.
    const wins = allBets().filter(isBigWin).sort((a, b) => M.profitOf(b) - M.profitOf(a));
    markSeen(wins.map(b => b.id));
    if (wins.length) { celQueue = [wins[0]]; showCelebration(); }
    else toast('Sample season loaded');
  }

  /* ── boot ───────────────────────────────────────────────── */

  function init() {
    const saved = localStorage.getItem('abp:theme');
    applyTheme(saved === 'light' ? 'light' : 'dark');   // scoreboards are dark
    M.load();
    M.sync.onStatus = syncStatus;
    syncStatus(M.sync.enabled ? 'syncing' : 'off');
    wire();
    resetForm();
    render();
    checkCelebrations();
    if (M.sync.enabled) {
      M.sync.pull().then(ok => { if (ok) { render(); checkCelebrations(); } });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
