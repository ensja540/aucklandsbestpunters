/* data.js — state, storage, sync and every number the ledger reports.
   Nothing in here touches the DOM. */

const ABP = (() => {
  'use strict';

  const KEY = 'abp:v1';
  const KEY_PASS = 'abp:pass';

  const SPORTS = ['NRL', 'Football', 'NBA', 'Rugby Union', 'AFL', 'Cricket', 'Tennis',
                  'Horse racing', 'Harness', 'Greyhounds', 'UFC', 'NFL', 'Golf', 'Esports'];

  // The club. Slot fixes each member's colour for good — it never follows their
  // rank on the ladder, so a filter can't repaint anyone.
  const FOUNDING = [
    { id: 'm1', name: 'Matt Byrne' },
    { id: 'm2', name: 'David Wood' },
    { id: 'm3', name: 'James Stevenson-Wright' },
    { id: 'm4', name: 'Sam Moses' },
    { id: 'm5', name: 'Dylan Ryan' },
    { id: 'm6', name: 'Kevin McCormick' },
    { id: 'm7', name: 'Rory O’Brien', title: 'Club president' },
    { id: 'm8', name: 'Jack Ensor' },
    { id: 'm9', name: 'Michael Mayhew' }
  ];

  const WEEKLY_IN = 10;          // what each member tips in every week

  const DEFAULT_STATE = () => ({
    club: {
      members: FOUNDING.map((m, i) => ({ ...m, budget: WEEKLY_IN, slot: i })),
      goals: [
        { id: 'g1', emoji: '🌴', name: 'Fiji', target: 4500 }
      ],
      // The batting order. Two members put the club's money on each week and the
      // pointer walks two places along, so with nine of us the pairs shift every
      // week: Jack & James, Rory & Kevin, … Dylan & Jack, James & Rory, and on.
      rota: ['m8', 'm3', 'm7', 'm6', 'm4', 'm9', 'm2', 'm1', 'm5'],
      rotaSize: 2,
      // Anchor: the week the order starts back at the top. David & Matt had the
      // week of 3 Aug 2026, which puts Dylan & Jack up next.
      rotaStart: '2026-07-13',
      patterns: false,
      motion: true
    },
    bets: [],
    rev: 0
  });

  let state = DEFAULT_STATE();
  const listeners = [];

  /* ── formatting ─────────────────────────────────────────── */

  const MINUS = '−';

  function money(v, opts = {}) {
    const n = Math.abs(v);
    const s = '$' + n.toLocaleString('en-NZ', {
      minimumFractionDigits: opts.whole ? 0 : 2,
      maximumFractionDigits: opts.whole ? 0 : 2
    });
    if (v < -0.004) return MINUS + s;
    return opts.sign ? '+' + s : s;
  }

  function moneyShort(v) {
    const n = Math.abs(v);
    const sign = v < 0 ? MINUS : '';
    if (n >= 1000) return sign + '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return sign + '$' + Math.round(n);
  }

  function pct(v, digits = 1) {
    if (v === null || !isFinite(v)) return '—';
    return (v * 100).toFixed(digits) + '%';
  }

  function pctSigned(v, digits = 1) {
    if (v === null || !isFinite(v)) return '—';
    const s = Math.abs(v * 100).toFixed(digits) + '%';
    return (v < 0 ? MINUS : '+') + s;
  }

  function shortDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  }

  function longDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ── dates & weeks (Monday start) ────────────────────────── */

  function isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function today() { return isoDate(new Date()); }

  function weekStart(iso) {
    const d = new Date(iso + 'T00:00:00');
    const back = (d.getDay() + 6) % 7;          // Monday = 0
    d.setDate(d.getDate() - back);
    return isoDate(d);
  }

  function addWeeks(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n * 7);
    return isoDate(d);
  }

  function weekRange(from, to) {
    const out = [];
    let w = weekStart(from);
    const end = weekStart(to);
    let guard = 0;
    while (w <= end && guard++ < 600) { out.push(w); w = addWeeks(w, 1); }
    return out;
  }

  /* ── bet maths ───────────────────────────────────────────── */

  const isSettled = b => b.result === 'win' || b.result === 'loss' || b.result === 'void';
  const isLive = b => b.result === 'pending';

  function returned(b) {
    if (b.result === 'win') return b.stake * b.odds;
    if (b.result === 'void') return b.stake;
    return 0;
  }

  // Void bets return the stake, so they are neither profit nor turnover.
  function profitOf(b) { return isSettled(b) ? returned(b) - b.stake : 0; }
  function turnoverOf(b) { return b.result === 'void' ? 0 : b.stake; }
  // Every leg count stands on its own until they get silly, so a 9-leg roughie
  // doesn't get buried in with the 6-leggers.
  const LEG_FOLD = 12;
  function legBucket(b) { return b.legs >= LEG_FOLD ? LEG_FOLD + '+' : String(b.legs); }
  function legBucketOrder(key) { return parseInt(key, 10); }
  function typeOf(b) { return b.legs > 1 ? (b.sgm ? 'sgm' : 'multi') : 'single'; }

  /* ── aggregate ───────────────────────────────────────────── */

  function summarise(bets) {
    const s = {
      bets: bets.length, settled: 0, pending: 0, wins: 0, losses: 0, voids: 0,
      staked: 0, turnover: 0, profit: 0, pendingStake: 0, pendingReturn: 0,
      roi: null, strike: null, avgOdds: null, avgStake: null, best: null, worst: null
    };
    let oddsSum = 0, oddsN = 0;
    for (const b of bets) {
      s.staked += b.stake;
      if (isLive(b)) {
        s.pending++; s.pendingStake += b.stake; s.pendingReturn += b.stake * b.odds;
        continue;
      }
      s.settled++;
      s.turnover += turnoverOf(b);
      const p = profitOf(b);
      s.profit += p;
      if (b.result === 'win') { s.wins++; oddsSum += b.odds; oddsN++; }
      else if (b.result === 'loss') { s.losses++; oddsSum += b.odds; oddsN++; }
      else s.voids++;
      if (!s.best || p > profitOf(s.best)) s.best = b;
      if (!s.worst || p < profitOf(s.worst)) s.worst = b;
    }
    if (s.turnover > 0) s.roi = s.profit / s.turnover;
    if (s.wins + s.losses > 0) s.strike = s.wins / (s.wins + s.losses);
    if (oddsN > 0) s.avgOdds = oddsSum / oddsN;
    if (s.settled > 0) s.avgStake = s.staked / s.bets;
    return s;
  }

  function groupBy(bets, keyFn) {
    const map = new Map();
    for (const b of bets) {
      const k = keyFn(b);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(b);
    }
    return map;
  }

  // `list` goes on last on purpose: summarise() has its own numeric `bets`
  // count, and spreading it after would quietly turn the list into a number.
  function summariseBy(bets, keyFn) {
    const out = [];
    for (const [key, list] of groupBy(bets, keyFn)) out.push({ key, ...summarise(list), list });
    return out;
  }

  /* ── per-sport, with mixed multis split ──────────────────
     A four-leg ticket across NRL and NBA puts half its stake and half its
     result on each, so the sport rows still add up to the club total. The
     ticket itself counts once on each sport, which is what you want for
     strike rate: "how do NRL legs go for us". */

  function sportsOf(b) { return b.sports && b.sports.length ? b.sports : [b.sport || 'Other']; }

  function sportBreakdown(bets) {
    const map = new Map();
    for (const b of bets) {
      if (!isSettled(b)) continue;
      const list = sportsOf(b);
      const share = 1 / list.length;
      for (const s of list) {
        if (!map.has(s)) {
          map.set(s, { key: s, settled: 0, wins: 0, losses: 0, voids: 0, mixed: 0,
                       staked: 0, turnover: 0, profit: 0, returned: 0, oddsSum: 0, oddsN: 0, list: [] });
        }
        const r = map.get(s);
        r.settled++;
        r.list.push(b);
        if (list.length > 1) r.mixed++;
        r.staked += b.stake * share;
        r.turnover += turnoverOf(b) * share;
        r.profit += profitOf(b) * share;
        r.returned += returned(b) * share;
        if (b.result === 'win') { r.wins++; r.oddsSum += b.odds; r.oddsN++; }
        else if (b.result === 'loss') { r.losses++; r.oddsSum += b.odds; r.oddsN++; }
        else r.voids++;
      }
    }
    return [...map.values()].map(r => ({
      ...r,
      roi: r.turnover > 0 ? r.profit / r.turnover : null,
      strike: r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : null,
      avgOdds: r.oddsN > 0 ? r.oddsSum / r.oddsN : null
    }));
  }

  // Longest run of one result, oldest → newest. Voids don't break a run.
  function longestRun(bets, result) {
    const settled = bets.filter(b => b.result === 'win' || b.result === 'loss')
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let best = 0, run = 0;
    for (const b of settled) {
      run = b.result === result ? run + 1 : 0;
      if (run > best) best = run;
    }
    return best;
  }

  const bestStreak = bets => longestRun(bets, 'win');

  function formRun(bets, n = 12) {
    return bets.filter(isSettled)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .slice(-n);
  }

  /* ── whose turn it is ────────────────────────────────────
     One turn per week, repeating. Turn 0 lands on rotaStart (or the week
     the club's first bet went on, if nobody has set one). */

  function weeksBetween(fromIso, toIso) {
    const a = new Date(weekStart(fromIso) + 'T00:00:00');
    const b = new Date(weekStart(toIso) + 'T00:00:00');
    return Math.round((b - a) / (7 * 24 * 3600 * 1000));
  }

  function rotaOrigin() {
    if (state.club.rotaStart) return weekStart(state.club.rotaStart);
    const first = liveBets().map(b => b.date).sort()[0];
    return weekStart(first || today());
  }

  const rotaOrder = () =>
    (state.club.rota || []).filter(id => state.club.members.some(m => m.id === id));

  // The pointer walks `rotaSize` places along the order every week and wraps.
  // With an odd roster that means the pairings change every week, which is the
  // whole point — nobody gets stuck with the same partner.
  function turnIndex(weekIso) {
    const order = rotaOrder();
    if (!order.length) return -1;
    const size = Math.max(1, state.club.rotaSize || 2);
    const n = weeksBetween(rotaOrigin(), weekIso);
    return (((n * size) % order.length) + order.length) % order.length;
  }

  function turnFor(weekIso) {
    const order = rotaOrder();
    const p = turnIndex(weekIso);
    if (p < 0) return { index: -1, ids: [], week: weekStart(weekIso) };
    const size = Math.min(Math.max(1, state.club.rotaSize || 2), order.length);
    const ids = [];
    for (let i = 0; i < size; i++) ids.push(order[(p + i) % order.length]);
    return { index: p, ids, week: weekStart(weekIso) };
  }

  // Which week offset puts `pos` at the front, so "whose turn is it" is settable.
  function weekOffsetFor(pos) {
    const order = rotaOrder();
    const size = Math.max(1, state.club.rotaSize || 2);
    for (let w = 0; w < order.length; w++) if ((w * size) % order.length === pos) return w;
    return 0;
  }

  function upcomingTurns(count = 5, fromIso = today()) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const week = addWeeks(weekStart(fromIso), i);
      out.push(turnFor(week));
    }
    return out;
  }

  /* ── the club bank ───────────────────────────────────────
     Everyone tips in every week whether they back a winner or not, so the
     bank is contributions plus whatever the betting did to them. */

  function weeklyIn() {
    return state.club.members.reduce((sum, m) => sum + (m.budget ?? WEEKLY_IN), 0);
  }

  function bankSeries(bets) {
    const dates = bets.map(b => b.date).sort();
    if (!dates.length) return { weeks: [], rows: [], now: { weeks: 0, contributions: 0, winnings: 0, staked: 0, profit: 0, bank: 0 } };

    const weeks = weekRange(dates[0], today());
    const perWeek = weeklyIn();
    const byWeek = {};
    weeks.forEach(w => (byWeek[w] = { staked: 0, returned: 0, profit: 0, bets: 0 }));
    bets.forEach(b => {
      const cell = byWeek[weekStart(b.date)];
      if (!cell) return;
      cell.bets++;
      if (isSettled(b)) {
        cell.staked += turnoverOf(b);
        cell.returned += b.result === 'void' ? 0 : returned(b);
        cell.profit += profitOf(b);
      }
    });

    let contributions = 0, winnings = 0, staked = 0, profit = 0;
    const rows = weeks.map((w, i) => {
      contributions += perWeek;
      winnings += byWeek[w].returned;
      staked += byWeek[w].staked;
      profit += byWeek[w].profit;
      return { week: w, index: i, contributions, winnings, staked, profit, bank: contributions + profit, bets: byWeek[w].bets };
    });

    return { weeks, rows, now: rows[rows.length - 1] || { contributions: 0, winnings: 0, staked: 0, profit: 0, bank: 0 } };
  }

  /* ── filtering ───────────────────────────────────────────── */

  function applyFilters(bets, f) {
    let out = bets;
    if (f.punter && f.punter !== 'all') out = out.filter(b => b.punter === f.punter);
    if (f.sport && f.sport !== 'all') out = out.filter(b => sportsOf(b).includes(f.sport));
    if (f.type && f.type !== 'all') out = out.filter(b => typeOf(b) === f.type);
    if (f.period && f.period !== 'all') {
      const weeks = parseInt(f.period, 10);
      const from = addWeeks(weekStart(today()), -(weeks - 1));
      out = out.filter(b => b.date >= from);
    }
    return out;
  }

  /* ── storage ─────────────────────────────────────────────── */

  function memberIds() { return new Set(state.club.members.map(m => m.id)); }

  // A multi can span sports, so `sports` is the truth and `sport` is just the
  // first one, kept so older bets and the CSV column still work.
  function cleanSports(b) {
    const raw = Array.isArray(b.sports) ? b.sports : String(b.sport || '').split(/[;|+]/);
    const out = [...new Set(raw.map(s => String(s).trim()).filter(Boolean))].slice(0, 8);
    return out.length ? out : ['Other'];
  }

  function normalise(b) {
    const who = String(b.punter || '');
    const sports = cleanSports(b);
    return {
      id: b.id || uid(),
      date: b.date,
      punter: memberIds().has(who) ? who : (state.club.members[0] || { id: 'm1' }).id,
      sports,
      sport: sports[0],
      event: (b.event || '').trim(),
      legs: Math.max(1, Math.round(Number(b.legs) || 1)),   // no upper limit — go nuts
      sgm: !!b.sgm,
      stake: Math.round((Number(b.stake) || 0) * 100) / 100,
      odds: Math.round((Number(b.odds) || 1) * 100) / 100,
      result: ['win', 'loss', 'void', 'pending'].includes(b.result) ? b.result : 'pending',
      updatedAt: b.updatedAt || Date.now(),
      deleted: !!b.deleted
    };
  }

  function uid() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = {
          club: { ...DEFAULT_STATE().club, ...(parsed.club || {}) },
          bets: (parsed.bets || []).map(normalise),
          rev: parsed.rev || 0
        };
      }
    } catch (err) {
      console.warn('Could not read saved bets:', err);
    }
    return state;
  }

  function save({ push = true } = {}) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save bets:', err);
    }
    listeners.forEach(fn => fn(state));
    if (push) sync.queuePush();
  }

  const onChange = fn => listeners.push(fn);

  /* ── mutations ───────────────────────────────────────────── */

  function liveBets() { return state.bets.filter(b => !b.deleted); }

  function addBet(b) {
    const bet = normalise({ ...b, id: uid(), updatedAt: Date.now() });
    state.bets.push(bet);
    save();
    return bet;
  }

  function updateBet(id, patch) {
    const i = state.bets.findIndex(b => b.id === id);
    if (i < 0) return null;
    state.bets[i] = normalise({ ...state.bets[i], ...patch, id, updatedAt: Date.now() });
    save();
    return state.bets[i];
  }

  function removeBet(id) {
    const i = state.bets.findIndex(b => b.id === id);
    if (i < 0) return;
    state.bets[i] = { ...state.bets[i], deleted: true, updatedAt: Date.now() };
    save();
  }

  function setClub(patch) {
    state.club = { ...state.club, ...patch };
    save();
  }

  function clearBets() {
    state.bets = state.bets.map(b => ({ ...b, deleted: true, updatedAt: Date.now() }));
    save();
  }

  function replaceAll(next) {
    state = {
      club: { ...DEFAULT_STATE().club, ...(next.club || {}) },
      bets: (next.bets || []).map(normalise),
      rev: state.rev
    };
    save();
  }

  function mergeBets(incoming) {
    const byId = new Map(state.bets.map(b => [b.id, b]));
    let changed = 0;
    for (const raw of incoming) {
      const b = normalise(raw);
      const mine = byId.get(b.id);
      if (!mine || (b.updatedAt || 0) > (mine.updatedAt || 0)) { byId.set(b.id, b); changed++; }
    }
    state.bets = [...byId.values()];
    return changed;
  }

  /* ── import / export ─────────────────────────────────────── */

  const CSV_COLS = ['date', 'punter', 'sport', 'event', 'legs', 'sgm', 'stake', 'odds', 'result'];

  function toCsv() {
    const names = Object.fromEntries(state.club.members.map(m => [m.id, m.name]));
    const head = ['date', 'punter', 'sport', 'event', 'legs', 'sgm', 'stake', 'odds', 'result', 'returned', 'profit'];
    const esc = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = liveBets()
      .slice().sort((a, b) => a.date.localeCompare(b.date))
      .map(b => [b.date, names[b.punter] || b.punter, sportsOf(b).join('; '), b.event, b.legs, b.sgm ? 'yes' : 'no',
                 b.stake.toFixed(2), b.odds.toFixed(2), b.result,
                 returned(b).toFixed(2), profitOf(b).toFixed(2)].map(esc).join(','));
    return [head.join(','), ...rows].join('\n');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];

    const head = rows[0].map(h => h.trim().toLowerCase());
    const idx = Object.fromEntries(CSV_COLS.map(c => [c, head.indexOf(c)]));
    if (idx.date < 0 || idx.stake < 0 || idx.odds < 0) throw new Error('CSV needs at least date, stake and odds columns.');

    // Match on full name, first name, or the raw member id.
    const names = {};
    state.club.members.forEach(m => {
      names[m.name.toLowerCase()] = m.id;
      names[m.name.toLowerCase().split(' ')[0]] = names[m.name.toLowerCase().split(' ')[0]] || m.id;
      names[m.id] = m.id;
    });
    const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');

    return rows.slice(1).filter(r => r.some(v => v.trim())).map(r => {
      const who = get(r, 'punter').toLowerCase();
      return normalise({
        id: uid(),
        date: get(r, 'date'),
        punter: names[who] || '',
        sport: get(r, 'sport') || 'Other',
        event: get(r, 'event'),
        legs: get(r, 'legs') || 1,
        sgm: /^(y|yes|true|1)$/i.test(get(r, 'sgm')),
        stake: get(r, 'stake'),
        odds: get(r, 'odds'),
        result: (get(r, 'result') || 'pending').toLowerCase()
      });
    });
  }

  /* ── sample season ───────────────────────────────────────── */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // A fixed seed so the sample season tells the same story every time.
  function sampleSeason(weeks = 12) {
    const rnd = mulberry32(20260803);
    const pick = arr => arr[Math.floor(rnd() * arr.length)];

    // Each member punts differently: their sports, their taste in legs, and a
    // small edge (or leak) per sport.
    const STYLES = [
      { sports: ['NRL', 'NRL', 'NRL', 'Rugby Union', 'Rugby Union', 'Cricket'], legs: [1, 1, 1, 2, 2, 3],
        edge: { NRL: 0.07, 'Rugby Union': 0.04, Cricket: -0.02 } },
      { sports: ['Football', 'Football', 'Football', 'NBA', 'Tennis'], legs: [1, 2, 2, 3, 3],
        edge: { Football: 0.03, NBA: -0.04, Tennis: 0.01 } },
      { sports: ['NBA', 'NBA', 'NFL', 'Football', 'UFC'], legs: [2, 3, 4, 4, 5],
        edge: { NBA: -0.02, NFL: -0.05, Football: -0.06, UFC: 0.02 } },
      { sports: ['Horse racing', 'Harness', 'Greyhounds', 'Horse racing'], legs: [1, 1, 2, 2],
        edge: { 'Horse racing': -0.03, Harness: 0.02, Greyhounds: -0.07 } },
      { sports: ['Rugby Union', 'NRL', 'AFL', 'Cricket', 'Golf'], legs: [1, 2, 2, 3, 4],
        edge: { 'Rugby Union': 0.05, NRL: -0.03, AFL: 0.01, Cricket: 0.03, Golf: -0.08 } },
      { sports: ['NRL', 'AFL', 'AFL', 'Football', 'Esports'], legs: [2, 3, 4, 4, 5],
        edge: { NRL: -0.05, AFL: 0.04, Football: -0.02, Esports: 0.06 } },
      { sports: ['Cricket', 'Tennis', 'Golf', 'Rugby Union', 'NBA'], legs: [1, 1, 2, 2, 3],
        edge: { Cricket: 0.05, Tennis: 0.04, Golf: 0.02, 'Rugby Union': -0.01, NBA: -0.03 } },
      { sports: ['NRL', 'NBA', 'Football', 'UFC', 'Horse racing'], legs: [2, 3, 3, 4, 6],
        edge: { NRL: 0.02, NBA: 0.03, Football: -0.05, UFC: -0.06, 'Horse racing': -0.09 } },
      { sports: ['Football', 'Tennis', 'NFL', 'NBA', 'Esports'], legs: [2, 4, 4, 5, 6],
        edge: { Football: -0.04, Tennis: -0.02, NFL: 0.01, NBA: -0.03, Esports: -0.05 } }
    ];

    const events = {
      NRL: ['Warriors v Storm', 'Broncos v Panthers', 'Roosters v Souths', 'Sharks v Raiders'],
      NBA: ['Celtics v Nuggets', 'Thunder v Mavs', 'Knicks v Heat', 'Lakers v Suns'],
      Football: ['Arsenal v Spurs', 'Liverpool v City', 'Auckland FC v Victory', 'Chelsea v Villa'],
      'Rugby Union': ['Blues v Crusaders', 'ABs v Springboks', 'Chiefs v Hurricanes'],
      AFL: ['Cats v Pies', 'Lions v Swans'],
      Cricket: ['Black Caps v Aus', 'Aces v Stags'],
      'Horse racing': ['Ellerslie R6', 'Te Rapa R4', 'Trentham R7'],
      Harness: ['Alexandra Park R5', 'Addington R8'],
      Greyhounds: ['Manukau R3', 'Addington R11'],
      NFL: ['Chiefs v Bills', '49ers v Eagles'],
      Golf: ['The Open — top 10 finish', 'US PGA outright'],
      Esports: ['CS2 major — quarters', 'LoL Worlds'],
      Tennis: ['Djokovic v Alcaraz', 'Sinner v Zverev'],
      UFC: ['Main card — Volkanovski', 'Prelims parlay']
    };

    const bets = [];
    const start = addWeeks(weekStart(today()), -(weeks - 1));
    const roster = state.club.members.length ? state.club.members : DEFAULT_STATE().club.members;

    for (let w = 0; w < weeks; w++) {
      const monday = addWeeks(start, w);
      for (let mi = 0; mi < roster.length; mi++) {
        const member = roster[mi];
        const pid = member.id;
        const prof = STYLES[mi % STYLES.length];
        const budget = member.budget || 45;
        if (rnd() < 0.08) continue;                       // someone always sits a week out
        let left = budget;
        const count = 2 + Math.floor(rnd() * 2);           // 2–3 tickets off a $10 week
        for (let i = 0; i < count && left >= 2; i++) {
          const last = i === count - 1;
          const stake = last ? Math.max(2, Math.round(left))
                             : Math.max(2, Math.round((left / (count - i)) * (0.6 + rnd() * 0.9)));
          if (stake > left) continue;
          left -= stake;

          const legs = pick(prof.legs);
          const sport = pick(prof.sports);
          const base = legs === 1 ? 1.55 + rnd() * 1.15
                     : legs === 2 ? 2.9 + rnd() * 2.4
                     : legs === 3 ? 5.0 + rnd() * 5.5
                     : legs === 4 ? 9 + rnd() * 12
                     : legs === 5 ? 18 + rnd() * 22
                     : 30 + rnd() * 45;
          const odds = Math.round(base * 100) / 100;

          // True chance sits under 1/odds — the bookie's margin, widened on longer multis.
          const margin = 0.96 - (legs - 1) * 0.02 + (prof.edge[sport] || 0);
          const chance = Math.max(0.01, Math.min(0.92, (1 / odds) * Math.max(0.5, margin)));

          const roll = rnd();
          const d = new Date(monday + 'T00:00:00');
          d.setDate(d.getDate() + Math.floor(rnd() * 7));
          const date = isoDate(d) > today() ? today() : isoDate(d);

          let result = roll < chance ? 'win' : 'loss';
          if (rnd() < 0.022) result = 'void';
          if (weekStart(date) === weekStart(today()) && rnd() < 0.5) result = 'pending';

          // multis often stray across codes
          const sports = [sport];
          if (legs > 1 && rnd() < 0.38) {
            const second = pick(prof.sports);
            if (second !== sport) sports.push(second);
          }

          bets.push(normalise({
            id: uid(), date, punter: pid, sports,
            event: pick(events[sport] || ['—']),
            legs, sgm: legs > 1 && rnd() < 0.3,
            stake, odds, result
          }));
        }
      }
    }
    return bets.sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ── shared sync (Cloudflare Worker) ─────────────────────── */

  const sync = {
    enabled: location.protocol === 'http:' || location.protocol === 'https:',
    status: 'off',              // off | idle | syncing | offline | locked
    onStatus: null,
    timer: null,

    pass() { return localStorage.getItem(KEY_PASS) || ''; },
    setPass(v) { localStorage.setItem(KEY_PASS, v || ''); },

    setStatus(s, detail) {
      this.status = s;
      if (this.onStatus) this.onStatus(s, detail);
    },

    async req(method, body) {
      const res = await fetch('/api/state', {
        method,
        headers: { 'content-type': 'application/json', 'x-abp-key': this.pass() },
        body: body ? JSON.stringify(body) : undefined
      });
      if (res.status === 401) { this.setStatus('locked'); throw new Error('locked'); }
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    },

    async pull() {
      if (!this.enabled) return false;
      try {
        this.setStatus('syncing');
        const remote = await this.req('GET');
        if (remote && Array.isArray(remote.bets)) {
          const changed = mergeBets(remote.bets);
          if (remote.club && (remote.rev || 0) >= (state.rev || 0)) state.club = { ...state.club, ...remote.club };
          state.rev = remote.rev || 0;
          save({ push: changed > 0 });
        }
        this.setStatus('idle');
        return true;
      } catch (err) {
        if (this.status !== 'locked') this.setStatus('offline', err.message);
        return false;
      }
    },

    queuePush() {
      if (!this.enabled || this.status === 'locked') return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.push(), 900);
    },

    async push() {
      if (!this.enabled) return;
      try {
        this.setStatus('syncing');
        const out = await this.req('PUT', { bets: state.bets, club: state.club, rev: state.rev });
        state.rev = out.rev || state.rev;
        localStorage.setItem(KEY, JSON.stringify(state));
        this.setStatus('idle');
      } catch (err) {
        if (this.status !== 'locked') this.setStatus('offline', err.message);
      }
    }
  };

  return {
    SPORTS, MINUS,
    get state() { return state; },
    load, save, onChange,
    liveBets, addBet, updateBet, removeBet, setClub, clearBets, replaceAll, mergeBets,
    normalise, uid,
    money, moneyShort, pct, pctSigned, shortDate, longDate,
    isoDate, today, weekStart, addWeeks, weekRange,
    isSettled, isLive, returned, profitOf, turnoverOf, legBucket, legBucketOrder, typeOf, sportsOf, sportBreakdown,
    summarise, summariseBy, groupBy, bestStreak, longestRun, formRun, applyFilters,
    weeklyIn, bankSeries, WEEKLY_IN,
    turnFor, turnIndex, upcomingTurns, rotaOrigin, rotaOrder, weekOffsetFor, weeksBetween,
    toCsv, parseCsv, sampleSeason, sync
  };
})();

window.ABP = ABP;
