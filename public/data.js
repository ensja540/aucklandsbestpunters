/* data.js — state, storage, sync and every number the ledger reports.
   Nothing in here touches the DOM. */

const ABP = (() => {
  'use strict';

  const KEY = 'abp:v1';
  const KEY_PASS = 'abp:pass';

  const SPORTS = ['NRL', 'Football', 'NBA', 'Rugby Union', 'AFL', 'Cricket', 'Tennis',
                  'Horse racing', 'Harness', 'Greyhounds', 'UFC', 'NFL', 'Golf', 'Esports'];

  const DEFAULT_STATE = () => ({
    club: {
      punters: [
        { id: 'p1', name: 'Punter 1', budget: 45 },
        { id: 'p2', name: 'Punter 2', budget: 45 }
      ],
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
  function legBucket(b) { return b.legs >= 6 ? '6+' : String(b.legs); }
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

  function summariseBy(bets, keyFn) {
    const out = [];
    for (const [key, list] of groupBy(bets, keyFn)) out.push({ key, bets: list, ...summarise(list) });
    return out;
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

  /* ── filtering ───────────────────────────────────────────── */

  function applyFilters(bets, f) {
    let out = bets;
    if (f.punter && f.punter !== 'all') out = out.filter(b => b.punter === f.punter);
    if (f.sport && f.sport !== 'all') out = out.filter(b => b.sport === f.sport);
    if (f.type && f.type !== 'all') out = out.filter(b => typeOf(b) === f.type);
    if (f.period && f.period !== 'all') {
      const weeks = parseInt(f.period, 10);
      const from = addWeeks(weekStart(today()), -(weeks - 1));
      out = out.filter(b => b.date >= from);
    }
    return out;
  }

  /* ── storage ─────────────────────────────────────────────── */

  function normalise(b) {
    return {
      id: b.id || uid(),
      date: b.date,
      punter: b.punter === 'p2' ? 'p2' : 'p1',
      sport: (b.sport || 'Other').trim(),
      event: (b.event || '').trim(),
      legs: Math.max(1, Math.round(Number(b.legs) || 1)),
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
    const names = Object.fromEntries(state.club.punters.map(p => [p.id, p.name]));
    const head = ['date', 'punter', 'sport', 'event', 'legs', 'sgm', 'stake', 'odds', 'result', 'returned', 'profit'];
    const esc = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = liveBets()
      .slice().sort((a, b) => a.date.localeCompare(b.date))
      .map(b => [b.date, names[b.punter] || b.punter, b.sport, b.event, b.legs, b.sgm ? 'yes' : 'no',
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

    const names = Object.fromEntries(state.club.punters.map(p => [p.name.toLowerCase(), p.id]));
    const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');

    return rows.slice(1).filter(r => r.some(v => v.trim())).map(r => {
      const who = get(r, 'punter').toLowerCase();
      return normalise({
        id: uid(),
        date: get(r, 'date'),
        punter: names[who] || (who === 'p2' ? 'p2' : 'p1'),
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
  function sampleSeason(weeks = 14) {
    const rnd = mulberry32(20260803);
    const pick = arr => arr[Math.floor(rnd() * arr.length)];

    const profile = {
      p1: { sports: ['NRL', 'NRL', 'NRL', 'Rugby Union', 'Rugby Union', 'Football', 'NBA', 'Cricket', 'Horse racing'],
            legs: [1, 1, 1, 2, 2, 2, 3, 3, 4], edge: { NRL: 0.06, 'Rugby Union': 0.03, Football: -0.02, NBA: -0.05, Cricket: 0.0, 'Horse racing': -0.08 } },
      p2: { sports: ['NBA', 'NBA', 'Football', 'Football', 'NRL', 'AFL', 'Tennis', 'UFC', 'Horse racing'],
            legs: [1, 2, 3, 3, 4, 4, 4, 5, 6], edge: { NBA: 0.04, Football: -0.03, NRL: -0.06, AFL: 0.02, Tennis: 0.05, UFC: -0.04, 'Horse racing': -0.10 } }
    };

    const events = {
      NRL: ['Warriors v Storm', 'Broncos v Panthers', 'Roosters v Souths', 'Sharks v Raiders'],
      NBA: ['Celtics v Nuggets', 'Thunder v Mavs', 'Knicks v Heat', 'Lakers v Suns'],
      Football: ['Arsenal v Spurs', 'Liverpool v City', 'Auckland FC v Victory', 'Chelsea v Villa'],
      'Rugby Union': ['Blues v Crusaders', 'ABs v Springboks', 'Chiefs v Hurricanes'],
      AFL: ['Cats v Pies', 'Lions v Swans'],
      Cricket: ['Black Caps v Aus', 'Aces v Stags'],
      Tennis: ['Djokovic v Alcaraz', 'Sinner v Zverev'],
      UFC: ['Main card — Volkanovski'],
      'Horse racing': ['Ellerslie R6', 'Te Rapa R4', 'Trentham R7']
    };

    const bets = [];
    const start = addWeeks(weekStart(today()), -(weeks - 1));

    for (let w = 0; w < weeks; w++) {
      const monday = addWeeks(start, w);
      for (const pid of ['p1', 'p2']) {
        const prof = profile[pid];
        const budget = 45;
        let left = budget;
        const count = 4 + Math.floor(rnd() * 3);           // 4–6 tickets a week
        for (let i = 0; i < count && left >= 3; i++) {
          const last = i === count - 1;
          const stake = last ? Math.max(3, Math.round(left))
                             : Math.max(3, Math.round((left / (count - i)) * (0.6 + rnd() * 0.9)));
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
          const margin = 0.96 - (legs - 1) * 0.025 + (prof.edge[sport] || 0);
          const chance = Math.max(0.01, Math.min(0.92, (1 / odds) * Math.max(0.5, margin)));

          const roll = rnd();
          const d = new Date(monday + 'T00:00:00');
          d.setDate(d.getDate() + Math.floor(rnd() * 7));
          const date = isoDate(d) > today() ? today() : isoDate(d);

          let result = roll < chance ? 'win' : 'loss';
          if (rnd() < 0.022) result = 'void';
          if (weekStart(date) === weekStart(today()) && rnd() < 0.5) result = 'pending';

          bets.push(normalise({
            id: uid(), date, punter: pid, sport,
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
    isSettled, isLive, returned, profitOf, turnoverOf, legBucket, typeOf,
    summarise, summariseBy, groupBy, bestStreak, longestRun, formRun, applyFilters,
    toCsv, parseCsv, sampleSeason, sync
  };
})();

window.ABP = ABP;
