# Auckland's Best Punters

The club ledger. Nine members, $10 each a week into the tin, two members rostered
on to put it on. The site tracks every ticket and answers what the club actually
argues about:

1. **Whose turn is it?** — the rota cycles two names down a nine-name list every
   week, so the pairings shift and nobody is stuck with the same partner.
2. **Who's up?** — the ladder: profit, ROI, strike rate, form and hot streaks.
3. **What's in the tin?** — money paid in ($90 a week) against what the betting
   collected, and how close that gets the club to Fiji.
4. **Which sports pay?** — profit, ROI and strike rate per sport, ranked.
5. **How many legs is too many?** — profit by multi length (single → 6+ legs).

When a multi lands, the whole page stops and says so — once per person, so the
rest of the club still gets it when they next open the site.

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

Open `public/index.html` in a browser. It works straight off the disk, saving to
that browser's local storage — no server, no build.

> **Note on this machine:** it's Windows on ARM64, and Cloudflare's local runtime
> (`workerd`) has no ARM64 Windows build, so `wrangler dev` / `wrangler deploy`
> can't run here. Deploys happen in CI instead (below). Everything except the
> `/api/state` sync can be developed against the local file.

## Deploy to Cloudflare

Pushing to `main` deploys, via `.github/workflows/deploy.yml`. It needs two repo
secrets — **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID in the right sidebar |

The alternative, if you'd rather not hold a token: Cloudflare dashboard →
**Workers & Pages → Create → Import a repository**, point it at
`ensja540/aucklandsbestpunters`, leave the build command empty and the deploy
command as `npx wrangler deploy`. Cloudflare then builds on every push itself.

### The custom domain

**Workers & Pages → aucklandsbestpunters → Settings → Domains & Routes → Add
custom domain → `aucklandsbestpunters.co.nz`** (add `www.` too if you want it).
Cloudflare issues the certificate; nothing else to configure. The domain needs to
be on the same Cloudflare account — if it's registered elsewhere, add the site to
Cloudflare first and point the registrar at Cloudflare's nameservers.

### Turning on the shared ledger

Out of the box each browser keeps its own copy. To share one ledger:

1. **Storage & Databases → KV → Create namespace**, call it `LEDGER`, copy the id.
2. Uncomment the `kv_namespaces` block in `wrangler.jsonc` and paste the id in.
3. Optional lock: Worker → **Settings → Variables and Secrets → Add secret**
   `CLUB_CODE`. The site asks each device for it once.

Push, and both phones are on the same ledger.

### How the shared ledger works

Both punters' browsers hold a full copy and push to `/api/state`. The Worker merges
by bet id, newest edit winning, so two phones can post at once without clobbering
each other. Deletes are tombstones, which is what stops a deleted bet reappearing
from the other device.

If `CLUB_CODE` is set, the API returns 401 until the browser sends the right code —
the site prompts for it once and remembers it. Without KV bound, the site still works;
it just saves locally on each device.

## Entering bets

- **Odds, returns and profit are three views of one number.** Type into whichever
  you know — odds, what it pays, or what you'd win — and the other two fill
  themselves in. Change the stake afterwards and whichever you touched last holds
  while the rest re-work. Any amount is accepted; nothing is rounded to 50c.
- When a bet settles, **Waiting on a result** lists it with the payout prefilled.
  Change it to whatever actually landed and hit **Paid** — the amount decides the
  result: nothing is a loss, the stake back is a void, the full return is a win,
  and anything in between is a **partial**. The price you took is never rewritten.
- **Partials** cover a dead leg that shortened a multi, an each-way that only
  placed, a cash-out, or a bonus boost. The bet keeps its original odds and stores
  what actually came back. For strike rate a partial counts as a win if it beat the
  stake and a loss if it didn't — otherwise strike rate stops meaning anything.
- **A ticket can cover several codes.** Type each sport and press Enter to add it
  as a chip. A mixed multi splits its stake and its result evenly across the codes
  on it, so *profit by sport* still adds up to the club total while the ticket
  counts once against each sport's strike rate.
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
