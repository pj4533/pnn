# PNN: Pre News Network

A 24-hour, broadcast-style news channel that reports **what prediction markets are pricing** about current affairs, in plain English and with independent editorial judgment. It spun out of `~/Developer/election_night` (Nov 3, 2026).

**New here? Read `docs/HANDOFF.md` first.** It covers the origin, the goal, what to reuse, a suggested MVP and the open questions for the user.

## Status

The MVP is built: live Polymarket and Kalshi feeds, editorial filter and ranking, news attach, SSE, a 2D overlay broadcast with a 3D scene, breaking alerts, and a SIM mode. Read `docs/ARCHITECTURE.md` (module contract, shapes, runtime/ops) and `docs/DECISIONS.md` (user-settled D1-D5 plus "Calls made during build") before changing anything. Code lives in `server/`, `public/` and `scripts/`.

## Layout

- `docs/HANDOFF.md`: origin and original plan. `docs/ARCHITECTURE.md`: contract and ops. `docs/DECISIONS.md`: decisions.
- `server/` (sources, editorial, ingest, store, http), `public/` (broadcast UI, `js/scene/` 3D), `scripts/` (tests, watch).
- `research/`:
  - `prediction-market-news-landscape.md`: who already reports on market odds (mostly exchange-funded), how accurate markets are, the critiques, and the gap PNN fills.
  - `market-apis.md`: Polymarket (Gamma, CLOB price history) and Kalshi (series, events, markets) endpoints and fields, verified 2026-11-04.
  - `market-snapshot-2026-11-04.md`: what was trading and moving that day. It's the evidence that there's 24/7 content.
  - `notes/`: sourced research notes behind the landscape report.
  - `samples/`: real API responses for building parsers offline.

## Editorial rules (non-negotiable)

- **News drives the markets:** every on-air market carries an accompanying news item; markets without matching news don't air. What people are reporting on is what we use the markets to predict (user directive, 2026-11-05). Sports and video games air only off a fresh sports/gaming wire headline, as a small slice (SPORTS & GAMES desk, max 3 on the board, never the lead).
- **Odds are not facts.** Lead with the data and how it changed, and don't repeat "Bettors" (the user asked for this on 2026-11-04). Write "Fed December hike odds rise to 80%, up 7 points today" or "Ossoff climbs to 29% for the 2028 Democratic nomination". Every line must still read as a probability, with a %, "odds" or "chance" tied to the subject. Never write "X will…" or "X is expected to…". Attribution comes from the frame: the source line on each story and the standing "Odds are not facts" disclaimer.
- **Always show the source, time and size:** which exchange, when it was updated, and the 24h volume. Flag thin markets.
- **Never present a market as a call.** Use official sources for what actually happened.
- **Plain English.** Prices become percentages and moves become "up 12 points today". No jargon (¢, YES/NO tokens, bps) on screen.
- **Stay independent.** No affiliate links, referral codes or sponsored embeds.
- **Filter the noise:** per-game sports and esports bets (matchups, spreads, props), crypto price brackets, promo markets and novelty markets like tweet counts are off. Sports/games futures (champions, awards, coaches, transfers, game releases) are allowed but news-gated. Keep categories in config.
- **Sensitive markets** (war, death, assassination) need an explicit policy. Ask the user before showing them.

## Data rules

- One server polls; browsers get state over SSE. Browsers never call the exchanges directly.
- Be polite: Gamma caches for 300s. Do a slow full sweep plus faster polling of the "hot" set, and back off on errors and 429s.
- Normalize every source into one market shape so the UI doesn't care whether data came from Kalshi or Polymarket.
- Treat API details as a snapshot. `curl` an endpoint before relying on it.
- Never commit API keys (Claude API, etc.). Keep them in `.env.local`, which is gitignored.

## User preferences (carried over from Election Night)

- **Ship fast.** Get a working version on screen, then iterate. Quick tested fixes beat polish.
- **Text:** never truncate with an ellipsis. Minimum font size is .7vw. High contrast. Check text fits by verifying `scrollWidth <= clientWidth`.
- **Layout:** test at 1920×1080, 1512×945 and 2000×810. Nothing should overlap.
- **Interesting content only:** no boring or dead content on screen. Follow the narrative, so whatever's moving most leads.
- **Live ops:** when it's running, watch the logs and fix bugs proactively without waiting to be asked.
- **Process:** restart servers by PID, never `pkill`.
- **Agents:** subagents and dynamic workflows are welcome for parallel work.
- **Build checks:** always build or run after changes to check for errors.

## Commands

- `npm start`: live server on http://localhost:4180 (`PORT` overrides). On the LAN (e.g. an iPad): http://<your-mac-ip>:4180 or http://<hostname>.local:4180. Use landscape; Add to Home Screen gives a full-screen app.
- `npm run sim`: replay saved samples, no network (no Kalshi data in SIM).
- `npm run check`: `node --check` over server and client JS. Run after every change.
- `npm run health`: `curl localhost:4180/api/health`. It includes `moments` (corner-pop detectors), `build.dead` (dead-content drops), `sotd` and `countdown`.
- `npm run watch` (`scripts/watch.sh`): live-ops watcher for warnings, alerts and health.
- `node scripts/test-sources.mjs`, `node scripts/test-editorial.mjs`: source parser and editorial rule tests.
- `node scripts/test-match.mjs`, `node scripts/test-news-search.mjs`, `node scripts/test-wire-filters.mjs`: news matcher (exact/event tiers, scope, D4 headline filter), search coverage/backoff, and wire feed/filter tests (all offline).
- `node scripts/test-wire.mjs [--top N] [--no-search] [--kalshi]`: live news-wire poll + clustering + news-to-market matching + probes (never touches the server).
- `node scripts/news-unlock.mjs --baseline [--dir DIR]` then `--feeds feeds.json [--dir DIR] [--refresh]`: news-unlock scout. Rebuilds the board offline, lists the stories the news gate drops (`gated.json`), and shows which candidate feeds (`[{name,url,category}]`, each fetched once and cached 6h) would unlock them. DIR defaults to `data/unlock` (gitignored); never touches the server.
- UI: `/?fixture=1` (static fixture with a fake wire, an alert at 5s and a NEWS MEETS MARKETS flash at 12s; `&alerts=1`, `&noscene=1`, `&flash=1` flash at 2s and no alert, `&hold=1` keeps the flash up 60s). Logs: `logs/pnn.log` (`flash`, `wire breaking`, `wire no market`, `wire weak match`).
- UI keys: 1 to 7 force top, focus, movers, week, desk, Story of the Day and countdown. With `?fixture=1`, `window.__pnnFakePop('move'|'still'|'money'|'listed')` fakes corner pops; on live, use `window.__pnn.pops.show(type, ev)`. `?fast=1` runs the clock 10x.
