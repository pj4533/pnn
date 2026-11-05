# PNN architecture and module contract

Every module was built in parallel against this contract. If you change a shape, update this file.

```
exchanges ──► server/sources/*  ──► Market[] (normalized)
                                       │
                         server/editorial/filter  (drop noise/sensitive, categorize)
                                       │
           server/store history ──► server/editorial/rank  ──► Story[]
                                       │            └─ copy.mjs (headline/dek/lines)
                                       ├─ breaking.mjs ──► Alert[]
                                       └─ newsdesk (wire archive 48h + Google News search: a news item for every on-air story)
                                       │
                server/store  ──SSE──►  public/ (broadcast UI)
```

- `server/ingest.mjs` owns the schedule and ties the stages together.
- `server/store.mjs` owns state, price history and SSE fan-out.

## Shapes (plain JS objects)

### Market: every source normalizes to this
```js
{
  id: 'pm:<marketId>' | 'ks:<ticker>',
  source: 'polymarket' | 'kalshi',
  title: string,            // the yes/no question, human readable
  outcome: string|null,     // outcome name in a multi-outcome event (groupItemTitle / yes_sub_title), else null
  eventId: 'pm:<eventId>' | 'ks:<event_ticker>',
  eventTitle: string,
  category: string,         // normalized PNN category, see config.categories ('politics','geopolitics','economy',...)
  tags: string[],           // raw source tags/category labels, lowercase
  yesPrice: number,         // 0..1
  change1d: number|null,    // absolute prob delta over ~24h, e.g. 0.07 = +7 points
  change1w: number|null,
  // Attached by ingest from PNN's OWN samples (store.motion) before ranking; null when not sampled or too short:
  change1h?: number|null,   // price now minus ~60 min ago; null unless samples span >= 30 min
  change15m?: number|null,  // same over ~15 min; null unless samples span >= 10 min
  flatMin?: number|null,    // minutes since the price was last >= 1.5 pts from now (lower bound: capped at the observed span)
  volume24h: number,        // USD (Kalshi: contracts ≈ $; note in code)
  volumeTotal: number,
  liquidity: number|null,
  closesAt: string|null,    // ISO
  url: string,              // public page on the exchange
  tokenId: string|null,     // Polymarket YES clobTokenId (for price history), else null
  updatedAt: string,        // ISO, when we fetched it
  // Kalshi strike-ladder rungs only (tag 'kalshi:ladder'):
  strike?: number,          // the rung's threshold (floor_strike / cap_strike)
  strikeDir?: 'above'|'below',
  eventSub?: string|null,   // event date line, e.g. "On Nov 9, 2026"
}
```

### Story: one per event, ranked
```js
{
  id: eventId,
  eventTitle, category,
  sources: ['polymarket', ...],
  lead: Market,             // the market that carries the story (biggest meaningful move, or the favorite)
  markets: Market[],        // up to 5 outcomes for the board, sorted by yesPrice desc
  score: number,
  kind: 'mover' | 'favorite' | 'closing',   // why it's on air
  headline: string,         // plain English, attributed to bettors, no jargon
  short: string,            // number-free headline for cards that show the big % separately (copy.shortHeadline)
  dek: string,              // one supporting sentence, e.g. the runner-up / weekly change
  thin: boolean,            // true if volume24h below config.thinVolume (a strike ladder uses the whole event's volume)
  ladder: boolean,          // non-exclusive group: aired as one yes/no line, never as a race
  ladderKind?: 'strike'|'date',   // 'strike': lead is the rung nearest 50% (the line)
  rungs?: [{id, label, yesPrice, change1d, lead}],   // strike ladders: the line and its neighbor rungs, low to high
  history: [{t: epochSec, p: 0..1}] | null,   // lead market price history for sparkline
  news: [{title, source, outlet, url, publishedAt, via: 'wire'|'search', score, tier: 'exact'|'event', about: 'race'|'question'|null, ageH}],  // 1–3 matching headlines; news[0] is the accompanying item (every on-air story has one except moving-first, see newsdesk); missing tier = 'exact', missing ageH = from publishedAt
  newsTier: 'exact'|'event'|'none-moving-first',   // missing => 'exact' (rank.mjs newsGate, from news[0].tier)
  movingFirst: {points /* signed 0..1 */, volume24h, strong, since: 'today'|'past hour', line} | null,  // MARKETS MOVING FIRST: no headline yet; line = copy.movingFirstLine ("No headline yet · up 9 points today on $42K traded"; the client drops the "No headline yet · " lead because its kicker says it)
  visual: {                 // hint for the 3D scene, set by rank.mjs
    type: 'outcomes' | 'dial' | 'ribbon' | 'globe' | 'countdown',
    region: {name, lat, lon} | null,   // inferred from keywords (country/state/city) when there is one
    theme: 'politics'|'economy'|'courts'|'tech'|'science'|'health'|'culture'|'weather'|'world',
  },
}
```

### Alert: a breaking move observed by PNN itself
```js
{ id, at: ISO, storyId, marketId, headline, line, from: 0..1, to: 0..1, minutes: number, source }
```

### State: what the browser receives
```js
{
  generatedAt: ISO,
  sim: boolean,
  feeds: { polymarket: Feed, kalshi: Feed, news: Feed },   // Feed = {ok, lastOk: ISO|null, lastError: string|null, count}
  stories: Story[],      // ranked, ~top 30
  movers: Market[],      // top 20 by |change1d| weighted by volume (faded when flat, boosted by a 1h move), one per event; caps: <= 6 per category (boardCat), <= 2 per story family, strong ($10K+, 3+ pts) first, caps relax only when short
  closing: Story[],      // markets that resolve within 7 days ("what the markets expect this week"), up to 8, <= 3 per category
  desks: Desk[],        // category desks for the rotating DESK segment (variety), see below
  alerts: Alert[],       // the last ~10 alerts (the UI must NOT replay these on connect; only `alert` events trigger full-screen)
  flashes: Flash[],      // the last ~10 NEWS MEETS MARKETS flashes (same rule: never replayed; only `flash` events pop up). Shape: Wire contract below
  wire: [{title, outlet, publishedAt, category, url}],   // newest ~30 wire headlines (≤ 3h), for the NEWS WIRE crawl
}
// feeds also has `wire`: {ok, lastOk, lastError, count (= feeds ok), feedsOk, feedsTotal, lastPoll, items, clustersFired, clustersMatched, flashesMade, lastFlashAt}
// A story that a flash is boosting carries `flash: {id, headline, credit, newsAt, url}` and `tags: ['news']`, leads `stories`, and its news[0] is the flash headline ({..., flash: true})
```

### Desk: one category's best stories, for the rotating desk segment
```js
{ id: 'economy'|'tech'|'world'|'culture'|'politics',
  title: 'ECONOMY DESK' | 'TECH & SCIENCE' | 'WORLD DESK' | 'CULTURE DESK' | 'POLITICS DESK',
  categories: string[],   // PNN categories folded into it, e.g. tech = tech+science+health; world = geopolitics+world; culture = culture+weather; politics = politics+courts (elections stays on TOP STORIES)
  stories: Story[] }      // up to 12 best by score (config.limits.deskStories; the client pages 4 at a time), <= 2 per family (1 per ladder family), fully built (headline, markets, visual, news/history as available); desks with < 2 stories are omitted
```

## Module exports

| File | Exports |
|---|---|
| `server/config.mjs` | `default` config object: port, poll intervals, categories (include/exclude lists, tag→category map), `sensitive`, `thinVolume`, `breaking: {points, minutes, minVolume}`, limits |
| `server/log.mjs` | `log(level, msg, fields)`. Writes JSON lines to stdout and `logs/pnn.log` |
| `server/http.mjs` | `getJSON(url, {timeoutMs, etagKey})`, `getText(url, opts)`. Handles timeouts, ETag/304, per-host backoff on 429/5xx (`HttpError` with `.status`) |
| `server/sources/polymarket.mjs` | `fetchPolymarket()` → `Market[]` (top 300 every 300s plus events 300–800 every ~15 min by volume, merged with the cached tag sweep); `sweepPolymarketTags({tags, limit, paceMs})` → `Market[]` (per-tag breadth sweep, cached); `mergedPolymarket()`; `polymarketTagCache()`; `parsePolymarketEvents(eventsJson, now)` → `Market[]` (pure, used by SIM); `fetchPriceHistory(tokenId, {interval, fidelity})` → `[{t,p}]` |
| `server/sources/kalshi.mjs` | `fetchKalshi()` → `Market[]` (full sweep at most every 20 min, else re-fetch the 40-event hot set); `parseKalshiMarkets(eventsOrMarketsJson, seriesByTicker, now)` → `Market[]` (pure); `fetchKalshiHistory(marketId)` → `[{t,p}]` (hourly candlesticks, 24h). Adds structural tags `freq:<frequency>`, `kalshi:ladder`, `group:<event_ticker>`; ladder rungs stay grouped under their event with `strike`/`strikeDir`/`eventSub` |
| `server/sources/news.mjs` | `fetchHeadlines(query, {max})` → `[{title, source, url, publishedAt}]`, Google News RSS, cached ~10 min per query |
| `server/editorial/filter.mjs` | `classify(market, config, {now}?)` → `{keep: bool, category, reason}`. Also drops `recurring:<freq>` (config.filter.excludeFrequencies; daily only outside config.filter.dailyCategories), `daily-weather`, `ladder-noise` (config.filter.ladderExcludePatterns) and, only if config.filter.dropLadders, `ladder` |
| `server/editorial/copy.mjs` | `pct(p)`, `pts(delta)`, `marketLine(m)`, `storyHeadline(story)`, `storyDek(story)`, `alertCopy(market, from, to, minutes)`, `newsQuery(story)` |
| `server/editorial/rank.mjs` | `buildStories(markets, config, {now})` → `{stories, movers, closing, stats, aliases}` (filters with `classify`, groups by event, scores, merges the same race across exchanges, damps repeated story families, fills headline/dek via copy). `aliases` maps a merged-away event id to the aired story id. Movers carry `storyId`, `line`, `thin` |
| `server/editorial/breaking.mjs` | `detectBreaking(markets, historyStore, config, {now})` → `Alert[]` (uses PNN's own observed price samples, dedupes per market per cooldown) |
| `server/store.mjs` | `createStore()` → `{getState(), setState(partial), recordPrices(markets), history(marketId), motion(marketId, nowSec) → {change1h, change15m, flatMin}, addAlerts(alerts), addFlash(flash) → flash\|null, subscribe(res), feeds}` |
| `server/newsdesk.mjs` | `createNewsdesk({getArchive, getMarkets})` → `{lookup(story), newsFor(story), setSearch(id, items), searchTargets(pending, aired), stats()}`: which headline goes with which story (matchStoryNews, strict) |
| `server/newsroom.mjs` | `startNewsroom(store, config, {sim, getMarkets, getAliases, rebuild})` → `{applyBoosts(stories, markets, extraPools), newsFor(story, news), stats(), stop()}`. Runs the wire, wire → match → flash → `store.addFlash`, boosts, `state.wire`, `feeds.wire`; SIM uses a canned wire |
| `server/ingest.mjs` | `startIngest(store, config, {sim})`: the schedules, SIM replay and news attach |
| `public/js/scene/index.js` | `createScene(canvas, {stageRect}?)` → `{showStory(story, segmentName), showAlert(alert), clearAlert(), setTicker(markets), resize(w,h), setStageRect({x0,x1,y0,y1}), dispose()}`. `showStory(null, 'movers')` draws the movers field from `setTicker` data. It owns the WebGL canvas only and draws no text that the 2D overlays already show |
| `public/js/main.js` and the other `public/js/*.js` files | SSE client, director, overlays, chyron, ticker and alerts. They call the scene API above on each segment change and alert |
| `server/app.mjs` / `server/index.mjs` | HTTP: `/` static `public/`, `/api/state`, `/api/events` (SSE: `state` full snapshot on each update, `alert` per new alert, `flash` per new flash, `ping` every 20s), `/api/health`, `POST /api/client-log` |
| `public/js/flash.js` | `createFlashes(root, {onStart, onEnd(f, {cut}), onClick})` → `{markSeen(list), enqueue(flash), pause(on), cut(), showing}`: the NEWS MEETS MARKETS side takeover |
| `public/js/cards.js` | `segmentCard(seg, now)` → HTML for one full-screen story card (DESK, BIGGEST MOVERS, THIS WEEK; one story per card, 8s each, the 3D shows the same story as `focus`); `pointsText(delta, when)` |

## Editorial rules the code enforces (from CLAUDE.md)
- Copy always attributes to bettors ("Bettors give…") and never says "will".
- Percentages are rounded and moves are phrased as "up 7 points today". Never show ¢, YES/NO or bps.
- Each story shows its source exchange, the time it was updated and the 24h volume. Thin markets are flagged.
- Sensitive filter: everything about war, violence or death is excluded (DECISIONS D4).
- Decay damping: if a "by <date>" market drifts toward 0 as the deadline nears, that isn't news, so it gets a reduced score.

## Runtime/ops

- **Ports and modes:** one Node (>=24) process serves the UI, API and SSE on `PORT` (default 4180). `npm start` runs live; `npm run sim` (`SIM=1`) replays saved samples from `research/samples/` with no network, ticking every 15s (`poll.simTickSec`) and firing a breaking alert about every 2 minutes. SIM has no Kalshi data (the saved sample has no markets), so its Kalshi feed shows not OK. Use another port with `PORT=4181 npm start`.
- **Polling cadence** (`config.poll`, each source jittered ±15% with exponential backoff up to 30 min):
  - Polymarket every 300s (top 300 every 300s plus events 300–800 every ~15 min events by volume), plus a per-tag sweep every ~15 min (`config.sources.polymarket.tagSlugs`, 41 tags × 100 events, 350ms apart) whose cached result merges into each poll.
  - Kalshi every 180s. It is a hot-set refresh (the 40 busiest events, one per poll). A full sweep (up to 150 pages, 400ms apart) runs at most every 20 minutes. The first Kalshi data takes about 50s after a cold start.
  - News for every on-air story (`server/newsdesk.mjs`, news-gate build 2026-11-05, `docs/PLAN-news-gate.md`): wire archive first (72h; the wire keeps a 72h backlog beside its 6h breaking ring), else a strict Google News search (up to 14 per cycle, 20 while the board is short, 1.5s apart; an event-phrase second query only when the lead query finds nothing; a 429 halves the budget for 30 min). Stories with no match wait in a pending pool (400, never-searched first, moving-first first among those) and retry after 90/180/360 min (misses persist 48h in `data/news-search.json`). Event-level headlines (`tier: 'event'`) back every outcome of their event, labelled on screen. A big, well-traded move with no headline can air as MARKETS MOVING FIRST (`config.movingFirst`: >= 5 pts on >= $10K, price band 4-96%, not closing within 6h, no geopolitics/sports/conflict wording; <= 4 board, never #1, <= 1 top 6, <= 2 per desk). Every attached headline passes the D4 sensitive patterns (`news.mjs sensitiveHeadline`, `match.mjs headlineReject`, `rank.mjs headlineBlocked`) and the site-title junk filter. Sports & games: 4 board / 8 desk / 3 week / 3 ticker, score floor 3.3. Stories with no match and no moving-first qualification never air. Sports/games need a sports/gaming wire headline <= 24h old. Health: `newsCoverage` ({onAir, withNews, pct, pending, viaWire, viaSearch, medianNewsAgeH, sportsGames, pool: {size, neverSearched, retrying}, tiers: {exact, event, movingFirst}, movingFirstPct}); `build.newsDropped` ({none, sportsGames, sgScore, movingFirstCapped, headlinesBlocked}); `feeds.news` ({budget, scale, searched1h, found1h, pool, neverSearched, retrying}).
  - Price history every 600s for the top 8 leads. When the lineup changes, news and history for new top stories are fetched right away, at most once every 2 minutes.
  - A rebuild (filter, rank, copy) runs after every poll. Over about 39k markets it takes about 160ms.
- **SSE:** `/api/events` sends `state` (full snapshot on each update), `alert` (per new alert), `flash` (per new NEWS MEETS MARKETS flash) and `ping` (every 20s). The browser watchdog counts `ping` and reconnects after 3 minutes of silence. Browsers never call the exchanges.
- **Logs:** JSON lines go to `logs/pnn.log` (gitignored; `LOG_DIR` and `LOG_FILE` override). Debug lines go to the file only. info goes to stdout, warn and error to stderr. Browser errors and heartbeats arrive through `POST /api/client-log`.
- **Health** (`GET /api/health`, `npm run health`): each feed reports `ok`, `stale`, `ageSec`, `staleAfterSec`, `lastError` and `count`. A feed is stale when its last success is older than `staleFactor` (3) times its interval. Top-level `ok` is true when Polymarket OR Kalshi is healthy; news being down does not fail it. It also reports `stories`, `movers`, `closing`, `alerts`, `clients`, `sampledMarkets` and `uptimeSec`.
- **Watching live:** `npm run watch` tails the log for warnings, errors, breaking alerts and backoffs, and checks health every 30s.
- **Restarting:** stop by PID (the `server start` log line includes it), never `pkill`.

### Wire contract (news meets markets)

Wired in through `server/newsroom.mjs` (started by `ingest.mjs`; see DECISIONS "2026-11-04: news wire" → Integration). Feeds, intervals, thresholds and headline filters live in `server/wire-config.mjs`. Shared text helpers (tokenizer, Jaccard) live in `server/editorial/text.mjs`. Live check: `node scripts/test-wire.mjs [--top N] [--no-search] [--kalshi] [--no-probes] [--probe-search]`.

```
news feeds ──► sources/wire.mjs (ring + clusters) ──'breaking'──► editorial/match.mjs ──► editorial/flash.mjs ──► state.flashes / SSE `flash`
                                                                    (local Market[] index, then live search)
```

| File | Exports |
|---|---|
| `server/sources/wire.mjs` | `createWire(overrides?)` → `{start(), stop(), pollAll()→status[], detect({now})→Cluster[], items({limit, since, category})→WireItem[], clusters({limit, minOutlets})→Cluster[], status(), on('breaking'\|'items', fn)→unsubscribe, off()}`. Also the pure `parseFeedXml(xml)`, `parseNws(json, eventRe)`, `normalizeItems(...)` and `fireReason(cluster, cfg, now)` |
| `server/editorial/match.mjs` | `await matchMarkets(cluster, marketIndex, {search=true, config, now, limit=6, perEvent=2, searchWaitMs=0})` → `[{market, score, why, origin:'index'\|'search'}]`, best first, `[]` when nothing is relevant. Also `searchPolymarket(q)`, `searchKalshi(q)`, `analyzeCluster`, `TOPICS` |
| `server/editorial/flash.mjs` | `buildFlash(cluster, matches, {now, priceAt?, storyId?, max=3})` → `Flash \| null`; `marketDataLine(market, sinceNews?)` |

```js
// WireItem: one headline
{ id, title, url, source /* feed id */, outlet, category, publishedAt /* ISO */, official: boolean, aggregator: boolean, marker: boolean, seenAt }

// Cluster: one story across outlets (emitted on 'breaking' at most once per 6h, near-duplicates suppressed)
{ id: 'wc:<hash>', title /* best representative */, url, outlets: string[], independentOutlets: number,
  items: WireItem[], firstSeen, lastSeen, official: boolean, marker: boolean, category,
  reason: 'corroborated' | 'strong' | 'marker' | 'official', firedAt }

// Flash: NEWS MEETS MARKETS
{ id: 'flash:<clusterId>', kind: 'flash', at /* ISO built */, newsAt /* ISO first seen on the wire */,
  headline /* the outlet's headline, verbatim */, credit /* "BBC, The Hill and 2 others" */, outlets, url, category, official,
  markets: [{ id, label, yesPrice, change1d, changeSinceNews? /* needs opts.priceAt */, source, volume24h, volumeText, thin, url, closesAt, updatedAt, eventId, line }], // 1–3, one row per outcome across exchanges
  line /* lead market data line: "The Fed increases rates by a quarter point in December: 78%, up 4 points today" */,
  storyId? /* via opts.storyId(eventId) */, cluster }
```

**Breaking fires** (per cluster, only while its newest item is ≤ 40 min old): an official item (Fed FOMC/monetary items, BEA GDP/PCE/trade, White House orders and signings, SEC approvals/rules, NWS *Extreme* hurricane/tornado-emergency-type alerts); ≥ 3 independent outlets in the 45-min window; a BREAKING/JUST IN marker plus 1 other outlet; or ≥ 2 independent outlets within 15 min. Google News items never count as independent. Headlines about war/violence/death (D4), sports, gossip, crime and service pieces are dropped before clustering.

**Integration** (done in `server/newsroom.mjs`; the match index is every airable market on both exchanges, plus an on-air bar: best score ≥ 11, other-event rows ≥ 80% of the lead, no dead 0/100 rows):
- `wire.on('breaking', async c => { const m = await matchMarkets(c, allMarkets, {config}); const f = buildFlash(c, m, {priceAt, storyId}); if (f) { store.addFlash(f); sse('flash', f) } })`. Most clusters have no market and produce no flash. That's expected.
- State fields: `wire: [{title, outlet, publishedAt, category}]` (the latest ~30 from `wire.items({limit: 30})`, for a headline crawl) and `flashes: Flash[]` (the last ~10). Like alerts, the UI must not replay `flashes` on connect; only the SSE `flash` event triggers the on-air takeover.
- Health: add `wire` to feeds, computed from `wire.status()` (`ok` when most feeds are ok).

## Watchability contract (2026-11-04, docs/PLAN-watchability.md)

### New Story fields (set by rank.mjs unless noted)
```js
swing: { from, to, delta, flipped, shape: 'swing'|'longshot'|'slipping' } | null
  // from = price ~24h ago (lead.yesPrice - change1d, or history[0].p), to = now. Set when |delta| >= 0.10 on real volume,
  // or a >= 5-point move in the last hour. longshot = from < 0.25 and rising; slipping = from > 0.6 and falling; else swing.
  // flipped = crossed 0.5.
settling: boolean        // >=95% or <=5% after a big move today: airs ONCE (as a swing card), then leaves the rotation
exchanges: [{ source, yesPrice, volume24h }] | null   // when the story is priced on both exchanges
agree: 'agree' | 'disagree' | null                    // |Kalshi - Polymarket| < 0.05 => agree; >= 0.05 => disagree
newsMarks: [{ t: epochSec, title, outlet }]           // wire headlines matched to this story (newsroom.mjs), for replay markers
```

### New State fields (ingest/newsroom)
```js
sotd: { id, title, credit, headline, leadStoryId,
        markets: [{ storyId, label, yesPrice, change1d, source }] } | null   // Story of the Day: one multi-market card
countdown: [{ id, title, at: ISO, storyId|null, label, yesPrice, change1d, source }]  // next 3 scheduled decisions
```

### New SSE events (each also kept as the last ~10 in state: moves, listed, money)
```js
'move':   { id, at, storyId, marketId, short, yesPrice, change1h, kind: 'move'|'still' }  // ON THE MOVE corner pop
'listed': { id, at, storyId|null, marketId, title, yesPrice, source, volume24h }          // JUST LISTED corner pop
'money':  { id, at, storyId, marketId, label, amount, price, source, largestToday, countToday } // MONEY MOVING
```
- **Server pacing:** `move` at most one per 3 min globally, with a 30-min per-story cooldown. `listed` and `money` at most one per 10 min each.
- **Client pacing:** a corner-pop queue with at least 60s between pops. Pops pause during BREAKING and NEWS MEETS MARKETS.
- **Copy rules:** no "bet" or "wager", no "Bettors", never "will". MONEY MOVING reads "$30,000 traded on <outcome> at 91%". Prices between 5% and 95% only. Never show trader names.

## Living environment (public/js/scene/env/, 2026-11-04)

`world.js` is a thin facade (same API: accent, accent2, alert, setTheme, setAlert, shockwave, tick, dispose; new: env, attachPost, resize(pxW,pxH), setQuality, event). It builds a shared `ctx` (`env/common.js`: alert/accent uniforms, flash, fogCol, sunDir, res in drawing-buffer px, guardRect/guardAmt, shared noiseTex, quality) and six modules, each `create*(scene, ctx) -> { setParams(p), update(dt,t,camera), setQuality(0|1|2), dispose() }`:
- `sky.js` dome + 1024x384 lat-long RT (clouds, nebula, aurora) refreshed at 8/15/30 Hz; `sun.js` billboard with stripe/eclipse/ring/twin/moon weights, writes `ctx.sunDir`; `terrain.js` 3 vertex-shader ranges (ridge/dune/canyon/wave) + instanced skyline, `pulse()`; `grid.js` square/hex/polar/dots floor with 4 pulse rings, `pulse()`, `shockwave()`, `setPolarOrigin()`; `particles.js` stars, dust, weather (rain/snow/embers/fireflies/motes), `shootingStar()`, `comet()`; `atmos.js` fog planes, haze band, lightning `strike()` (drives `ctx.flash`).
- `moods.js`: DEFAULTS (= the original look), 9 MOODS (partial overrides; hex colors, weight groups), WANDER amplitudes, `resolveMood`, `blendParams` (in-place lerp, no allocation).
- `director.js`: holds a mood 3-6 min, cross-fades 40-90 s (smootherstep) to a weighted-random mood that differs in 2+ of sun/terrain/grid, wanders params on 37-211 s periods, schedules shooting stars/comets/lightning/grid pulses/terrain sweeps, and pushes bloom (`post.setBloom`) and colour grade (`post.setGrade`). Events via `world.event` / `scene.envEvent`: `story` (pulse + polar origin), `alert` (freeze timeline, red pulse), `alertClear` (+30 s hold), `flash` (pulses, sweep, star, bloom kick), `mover {dir}` (green/red tint, 30 s decay).
- Debug: `?mood=<name>` pins, `?envfast=1` (20x director time), `?moodfast=1` (~10 s hold + ~10 s blend), `?envquality=0|1|2`. `window.__pnnScene.world.env` (`setMood(name,{transition})`, `next()`, `getState()`); `api.env` / `api.envQ` report state.
- FPS guard (index.js, 5 s checks): fps < 50 drops env quality first, then < 48 drops pixel ratio; env quality steps back up after 6 checks > 58 fps, at most once per 60 s.
- Rules: phases accumulate in JS and wrap (no shader uses absolute time), constant loop bounds, no render-target reallocation, every object exists at createWorld so warmup compiles it, background stays under the bloom threshold except the sun core and lightning, GUARD dims the stage rect, the alert red mix is applied last everywhere.

## Scenes and director (public/js/scene/scenes/, 2026-11-05)

- `registry.js`: `SCENES` (lazy imports) and static `META` { id, title, family, weight, similar, hasLayer, morph }. Modules are prefetched on idle.
- `common.js`: the per-scene ctx (shared uniforms through `ctx.common()`, GLSL `COMMON`/`finish()` = alertMix × guard × fade, `track`, `backdrop`, `layer`, `anchor`, `gpgpu`).
- Scene module: `create(ctx)` returns { update, setIntensity, enter, exit, ripple, shockwave?, event?, setQuality, morphPoints?, grade, cameraBias, dispose? }. Geometry stays out of |z|<80, 0<y<80 near the station line.
- `director.js`: two slots (cur/next), prepare → compileAsync → warm draw → beat-synced transition → dispose 2 frames later, with a leak check against the renderer.info baseline. `getState()` feeds `npm run health`.
- `transitions.js`: 8 fullscreen transition materials, which sample tRA/tRB (half-res HalfFloat RTs owned by post). Every transition and the morph cloud is compiled in `world.warm()` at boot.
- Pipeline (`post.js`): BackdropPass (director: layer RTs, then stage or transition) → RenderPass(main scene, clear=false, clearDepth=true) → bloom → final → output. Holograms always draw on top.
- `world.js` is a facade over the director. Its surface is unchanged, plus `beat(info)`, `warm()` and `setStageRect()`.
- Flags: `?scene=<id>` pins a scene, `?scenefast=1` sets 12-20 s holds, `?trans=<type>` forces a transition and `?fpsguard=0` holds quality fixed. Legacy `?mood=` maps to outrunClassic.
- Overlay: `pnn:beat` makes the next card swap use `beat beat-<type>` with `--beat-dur` and `--beat-at`.
- Test pages: `scenes/test-<id>.html` (standalone with a mock ctx) and `js/scene/harness.html` (keys b beat, f flash, q quality).
