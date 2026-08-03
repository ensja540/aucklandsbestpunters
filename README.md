# Auckland's Best Punters

A two-punter club ledger. Each punter has a weekly allowance ($45 by default); the
site tracks every ticket and answers the three questions the club actually argues about:

1. **Who's up?** — running profit, ROI, strike rate, weeks won, head to head.
2. **Which sports pay?** — profit, ROI and strike rate per sport, ranked.
3. **How many legs is too many?** — profit by multi length (single → 6+ legs).

No build step, no framework, no dependencies. Plain HTML, CSS and JavaScript.

## Layout

```
public/          the site
  index.html
  styles.css
  data.js        state, storage, sync, every calculation
  charts.js      hand-rolled SVG charts
  app.js         wiring: state → screen
src/worker.js    Cloudflare Worker: /api/state + static assets
wrangler.jsonc   Worker config
```

## Run it locally

Open `public/index.html` in a browser — it works straight off the disk, saving to
that browser's local storage. To run it the way it runs in production:

```bash
npx wrangler dev
```

## Deploy to Cloudflare

```bash
npx wrangler kv namespace create LEDGER   # paste the id into wrangler.jsonc
npx wrangler secret put CLUB_CODE         # the shared code you and your mate type once
npx wrangler deploy
```

Then in the Cloudflare dashboard: **Workers & Pages → aucklandsbestpunters →
Settings → Domains & Routes → Add custom domain → `aucklandsbestpunters.co.nz`**
(and `www.` if you want it). Cloudflare issues the certificate itself, so nothing
else to configure.

### How the shared ledger works

Both punters' browsers hold a full copy and push to `/api/state`. The Worker merges
by bet id, newest edit winning, so two phones can post at once without clobbering
each other. Deletes are tombstones, which is what stops a deleted bet reappearing
from the other device.

If `CLUB_CODE` is set, the API returns 401 until the browser sends the right code —
the site prompts for it once and remembers it. Without KV bound, the site still works;
it just saves locally on each device.

## Entering bets

- **Odds are decimal** (2.50, not 6/4 or −150).
- **Legs** is the number of selections on the ticket: 1 is a single, 4 is a four-leg multi.
  Tick *same-game multi* for an SGM.
- Leave a bet **pending** until it settles, then hit Won / Lost / Void in the bet
  history. Pending bets stay out of profit, ROI and strike rate — they show as
  "still running".
- **Void** returns the stake: no profit, and it doesn't count as turnover.

ROI is profit ÷ turnover. Strike rate is wins ÷ (wins + losses), so voids don't
flatter it.

## Importing history

Settings → Import takes a `.json` backup or a `.csv` with these columns:

```
date,punter,sport,event,legs,sgm,stake,odds,result
2026-07-19,Jack,NRL,Warriors v Storm,3,no,15,6.40,win
```

`date` must be `YYYY-MM-DD`. `punter` matches a punter's name (or `p1`/`p2`).
`result` is `win`, `loss`, `void` or `pending`. Only date, stake and odds are required.

## Design notes

Chart colours are validated against the surfaces they render on — the two punter
hues clear colourblind separation in both light and dark themes, profit/loss uses a
blue↔red diverging pair rather than green/red, and every chart has a table twin so no
value is locked behind a hover. Settings → *high-contrast patterns* adds a second,
colour-free channel.
