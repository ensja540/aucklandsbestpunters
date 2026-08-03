/**
 * Auckland's Best Punters — Cloudflare Worker.
 *
 *  /api/state   GET  → the shared ledger
 *               PUT  → merge a device's ledger into the shared one
 *  everything else → static files from /public
 *
 * Bets merge per id, newest updatedAt wins, so two phones can both post
 * without one clobbering the other. Deleted bets stay as tombstones.
 */

const STATE_KEY = 'state:v1';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/state') {
      return withCors(await handleState(request, env));
    }
    if (url.pathname === '/api/health') {
      return json({ ok: true, kv: !!env.LEDGER, locked: !!env.CLUB_CODE });
    }
    return env.ASSETS.fetch(request);
  }
};

async function handleState(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  if (!env.LEDGER) {
    return json({ error: 'No KV namespace bound. Run: npx wrangler kv namespace create LEDGER' }, 501);
  }
  if (env.CLUB_CODE && request.headers.get('x-abp-key') !== env.CLUB_CODE) {
    return json({ error: 'Wrong club code' }, 401);
  }

  const stored = (await env.LEDGER.get(STATE_KEY, 'json')) || { bets: [], club: null, rev: 0 };

  if (request.method === 'GET') return json(stored);

  if (request.method === 'PUT') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Body must be JSON' }, 400);
    }

    const merged = mergeBets(stored.bets || [], Array.isArray(body.bets) ? body.bets : []);
    const next = {
      bets: merged,
      club: body.club || stored.club,
      rev: (stored.rev || 0) + 1,
      updatedAt: new Date().toISOString()
    };
    await env.LEDGER.put(STATE_KEY, JSON.stringify(next));
    return json({ rev: next.rev, count: merged.length, updatedAt: next.updatedAt });
  }

  return json({ error: 'Use GET or PUT' }, 405);
}

function mergeBets(mine, theirs) {
  const byId = new Map();
  for (const b of mine) if (b && b.id) byId.set(b.id, b);
  for (const b of theirs) {
    if (!b || !b.id) continue;
    const held = byId.get(b.id);
    if (!held || (b.updatedAt || 0) > (held.updatedAt || 0)) byId.set(b.id, clean(b));
  }
  return [...byId.values()];
}

// Only fields the ledger knows about, so a bad client can't bloat KV.
function clean(b) {
  return {
    id: String(b.id).slice(0, 40),
    date: String(b.date || '').slice(0, 10),
    punter: String(b.punter || '').slice(0, 24),
    sport: String(b.sport || 'Other').slice(0, 40),
    event: String(b.event || '').slice(0, 80),
    legs: Math.max(1, Math.min(30, Math.round(Number(b.legs) || 1))),
    sgm: !!b.sgm,
    stake: round2(b.stake),
    odds: round2(b.odds),
    result: ['win', 'loss', 'void', 'pending'].includes(b.result) ? b.result : 'pending',
    updatedAt: Number(b.updatedAt) || Date.now(),
    deleted: !!b.deleted
  };
}

const round2 = v => Math.round((Number(v) || 0) * 100) / 100;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function withCors(res) {
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-headers', 'content-type, x-abp-key');
  h.set('access-control-allow-methods', 'GET, PUT, OPTIONS');
  return new Response(res.body, { status: res.status, headers: h });
}
