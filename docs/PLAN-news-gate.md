# PLAN: news gate loosening (2026-11-05)

Six approved options, built autonomously by five parallel builders. Every number below comes from
`research/news-gate-baseline.md` (read it first; it has the funnel, the 10-example spot checks and the
feed test). Decisions are logged in `docs/DECISIONS.md` ("2026-11-05: news gate loosening").

**Baseline (live, morning after the midterms):** ~15,650 markets -> ~4,575 airable -> 154 stories with news
-> ~76 on air. `news:none` 1,065 (586 never eligible, 479 eligible: 343 never searched, 129 searched
no-match, 7 stale hit). Search budget 6/90s, pool 120, retry 20 min; ~70% of searches are retries.
Sports/games 3 board + 6 desk. Wire window 24h parse / 48h archive / 48h match; search already airs
up to 96h.

**What the measurements say about priority:** option 1 is the big lever (+80 stories, 24% hit rate on
never-searched, 83% usable). Options 3 and 4 add little at current strictness (+5-10 and +4) and must stay
strict (looser event matching is 15% precision). Option 5 needs a guard (settled brackets fake +84-point
moves) and a conflict exclusion (4 of 49 candidates are war/Iran markets). Options 2 and 6 are bounded by
matcher quality, so both ship with quality floors. A fifth lever (race-result frame miss, ~+12% of a
never-searched sample, ~14/18 correct) is folded into builder C because it lives in the same gate.

---

## 0. Ground rules for every builder

- READ-ONLY on port 4180. Verify on a scratch copy of the repo (`cp -R` into the scratchpad) on port
  4210+ (`PORT=4210 npm start`), stop it by PID. Never `pkill`.
- A perf-fix workflow is concurrently editing `server/editorial/match.mjs`, `server/store.mjs`,
  `server/app.mjs`, `public/js/{director,overlay,cards,panels}.js` and the holograms. Builders C and E
  touch some of these: re-read the file immediately before every edit, make surgical edits (no
  reformatting, no moving code), keep each diff small, and re-run `npm run check` after every edit. If an
  edit fails to apply because the text moved, re-read and retry; never `git checkout` or `git stash`.
- `npm run check` after every change. Run the test script you own before you hand back.
- Every new knob goes in `server/config.mjs` (builder D owns it). Other builders read config with a
  default (`config.poll?.newsBudget ?? 14`) so they work before D lands.
- Every new field is optional on read. Missing `tier` means `'exact'`; missing `newsTier` means
  `'exact'`; missing `ageH` means compute from `publishedAt`. Nothing may throw on an old state shape.
- Builders do not edit `docs/DECISIONS.md` or `docs/ARCHITECTURE.md`; the integrator does, from the
  builders' hand-back notes. Each builder returns: files changed, knobs added, test output, and any
  decision it made beyond this plan.
- Editorial rules are non-negotiable (section 8).

---

## 1. Option 1: search more without loosening (builder A)

**Goal:** drain the 343 never-searched eligible stories within an hour of a restart, stop spending 70% of
the budget on retries, and keep yield >= 15%.

### Design
| Knob | Today | New | Where |
|---|---|---|---|
| Per-cycle budget `poll.newsBudget` | 6 | **14** | config (D), read in `ingest.mjs searchCycle` (A) |
| Short-board budget `poll.newsBudgetShort` | 8 | **20** | same |
| Cycle `poll.newsSearchSec` | 90 | 90 (unchanged) | |
| Pace between searches | 1.5s | 1.5s (unchanged; 14 x 1.5s = 21s of a 90s cycle) | ingest |
| 429 reaction | stop cycle + scheduler backoff | same, **plus** halve the budget for 30 min (`budgetScale` 0.5, log `news budget halved`); restore after 30 clean min | ingest |
| Pending pool cap | 120 (hard-coded in `rank.mjs newsGate`) | **400** (`limits.newsPool`) | rank (D) |
| No-match retry `retryMin` | 20 | **90**, doubling per consecutive miss, cap **360** (`poll.newsRetryMin`, `poll.newsRetryMaxMin`) | `newsdesk.searchTargets` (A) |
| Search-only refresh `refreshMin` | 60 | **120** | newsdesk (A) |
| Query cache TTL | 10 min (ingest passes 15) | **45 min** (`news.mjs TTL_MS` 30 min default, ingest passes 45) | news.mjs + ingest (A) |
| Query cache size | 300 | **1000** | news.mjs (A) |
| Persisted search entries (`data/news-search.json`) | 24h | **48h**, and no-match entries carry `misses` so a restart does not re-search them | newsdesk dump/load (A) |
| Save cadence | only on cycles that found something | **every cycle that searched anything** (so misses persist) | ingest (A) |

**Target order in `searchTargets`:** (1) pending never searched, rank order; (2) pending whose retry is
due, oldest due first; (3) aired search-only stories whose refresh is due. Sports/games stay unsearched.

**Second query (event-level, ties to option 3):** for a multi-outcome story whose lead-outcome query returns
no usable hit, run one more search on the event phrase ("next James Bond", "Fed December meeting") in the
same cycle, counted against the budget. A reads `copy.newsQueries?.(s) ?? [copy.newsQuery(s)]` (`import *
as copy`) so it works before D lands `newsQueries`. Hits from the event query are filtered by the same
`filterHeadlinesForStory` and arrive tagged `tier: 'event'` by C's matcher.

**Quality (the 11% wrong):** add a retail/listing outlet drop to `news.mjs badNewsSource`: outlets matching
`/\b(records?|vinyl|store|shop|merch|outlet|amazon|walmart|target|best buy|ebay|etsy|ticketmaster|
stubhub|fandango)\b/i` or domains of shops never air (the Blood Records case). The state-senate vs
US-Senate case goes to C (scope mismatch).

**Instrumentation (A):** `feeds.news` in state gains `{budget, scale, searched1h, found1h, pool,
neverSearched, retrying}`; `build.newsCoverage` (ingest `newsCoverage()`) gains `pool: {size,
neverSearched, retrying}` and `tiers: {exact, event, movingFirst}` (counts on air) and `movingFirstPct`.
Log line `news search` adds `never`, `retry`, `event` counts.

### Acceptance (A)
- Within 60 min of a restart on the scratch server: `pool.neverSearched` <= 10 (from 343).
- 24h search yield (found/searched) >= 15% (today 12.8% dominated by retries).
- `news:none` <= 900 within 2h (from 1,065).
- No Google 429 over a 2h soak; if one happens, the log shows `news budget halved` and the cycle recovers.
- `scripts/test-news-search.mjs` (new, A owns): unit tests for `searchTargets` ordering and backoff
  (misses 1/2/3 -> 90/180/360 min), the dump/load round trip with `misses`, the retail outlet drop, and
  `refineQuery`. No network.

---

## 2. Option 2: more news sources (builder B)

**Goal:** add the feeds that tested usable, with the politeness and filters that keep the wire clean.
Expected gain is small (+13 eligible stories measured) and it is bounded by matcher quality, so B ships
title filters and the matcher fixes go to C.

### Feeds to add (`server/wire-config.mjs feeds`) — every one must be re-verified with curl before it is
added: HTTP 200, parseable RSS/Atom, dated items, newest item <= 24h old. Drop any that fail today.

| Group | Feed id -> outlet | everySec | Notes |
|---|---|---|---|
| culture | `thr` The Hollywood Reporter, `billboard` Billboard, `indiewire` IndieWire, `rollingstone` Rolling Stone, `variety-film` Variety (film) | 300 | Billboard podcast/lede items need the filters below |
| tech/AI | `verge-ai` The Verge (AI), `ars` Ars Technica, `wired` Wired, `mit-tr` MIT Technology Review, `engadget` Engadget, `theinformation` The Information | 300 | `verge-ai` overlaps `verge`; keep both (dedupe by url already happens) |
| courts | `scotusblog` SCOTUSblog, `courthousenews` Courthouse News | 600 | category `courts` |
| politics | `politico-politics` Politico, `politico-congress` Politico, `rollcall` Roll Call, `nbc-politics` NBC News, `fox-politics` Fox News, `abc-politics` ABC News, `npr-politics` NPR, `semafor` Semafor | 180-300 | `politico-playbook` is sparse: skip |
| economy | `nyt-business` The New York Times, `fortune` Fortune, `businessinsider` Business Insider, `ft` Financial Times, `npr-econ` NPR, `cnbc-world` CNBC | 300 | nyt-business was the best single feed (13 stories) |
| science/space | `livescience` Live Science, `sciencedaily` ScienceDaily, `physorg` Phys.org, `spacenews` SpaceNews, `nasa-breaking` NASA | 600 | thin categories; cheap to carry |
| world/health | `guardian-us` The Guardian, `nyt-us` The New York Times, `nyt-world` The New York Times, `dw` DW, `france24` France 24, `kff` KFF Health News, `nyt-health` The New York Times | 300-600 | |

Never add (tested dead/unusable): EW, Vulture, Lawfare, VentureBeat, WaPo, Yahoo Finance, BLS, USA Today
politics, CNN politics, Calculated Risk. Note `bea` and `sec` are stale today; leave them.

**Politeness:** total feeds ~50 -> ~85. With the intervals above that is about 20 requests/min across
distinct hosts; the per-host backoff in `wire.mjs` stays. No host gets more than one feed at < 180s.

**Filters (`wire-config.mjs filters`, applied at parse):** add a `fluff` group dropping titles matching
podcast / playlist / "what to watch" / "best of" / "review:" / "interview:" / "gift guide" / "ranked" /
"quiz" / "recap" / "live blog" / "photos" unless the title also carries a marker like "announces",
"wins", "named", "sets", "cancels", "delays". Verify with `node scripts/test-wire.mjs --no-search` that
the fired-cluster rate does not change by more than 20% and that no existing good headline from the
baseline spot checks is dropped.

**Window (option 4, B's part):** `maxItemAgeHours` 24 -> **72**. Items older than 72h are dropped at
parse. The ring stays at 6h.

### Acceptance (B)
- `/api/health` on the scratch server: `feeds.wire.feedsTotal` >= 80, `feedsOk/feedsTotal` >= 0.9 after
  15 min, no feed in a permanent backoff.
- `node scripts/test-wire.mjs --no-search --top 20` runs clean; items per poll grows but the `fluff`
  group accounts for < 15% of drops.
- Archive after 2h holds items from >= 70 distinct feed ids.
- B hands back the verified feed list with newest-item age per feed.

---

## 3. Option 3: event-level news backs every outcome (builder C)

**Goal:** a headline clearly about the event (the race, the meeting, the field) backs every outcome of
that event, labelled honestly as event-level, without the junk that looser matching admits.

### Matcher (`server/editorial/match.mjs matchStoryNews`)
Today the "lead miss" gate rejects a multi-outcome non-race headline that does not name the lead outcome
(or two outcomes). New rule, in that gate's place:

- Keep **exact** as it is: `leadHit`, or `oHits >= 2`, or a race (`T.race`), or lead geo -> `tier: 'exact'`.
- Admit as **event** tier when none of the above holds but the headline is unambiguously about the event:
  - `pRuns >= 1 && fHits >= 2` (the event's proper-noun subject run plus two frame words:
    "Fed ... rate ... December"), or
  - `oHits >= 1 && fHits >= 1` (a rival outcome named plus the event's frame: "Brosnan endorses Callum
    Turner as next Bond" on the Josh O'Connor market), or
  - an official-source item (`it.official`) whose topic matches the event (Fed press item on a Fed market).
- Never admit on `e - eOut >= 1` alone or on an outcome name without the frame (measured 15% precision).
- Event-tier results carry `tier: 'event'`, `about: T.race ? 'race' : 'question'`, and score x 0.85.
  Exact results carry `tier: 'exact'`.
- `max` candidates per story stay 3; an exact hit always outranks an event hit of similar age.

**Fifth lever (race-result frame miss):** for single-outcome election markets about margin / vote share /
turnout brackets (`MARGIN_RE` in rank.mjs, or `percent|margin|turnout|least \d+%` in the title), a
headline that reports the race result ("X wins Ohio's race for governor", "first Democrat to win Texas
Senate seat since 1988") is the story even though it lacks the frame words. Treat the words `margin,
least, percent, vote, victory, turnout` as non-frame for those markets when the headline names the race
(state or district + office) and a result verb (`wins|won|flips|defeats|concedes|projected|called`).
Tier `'exact'`.

**Matcher weak spots exposed by bigger pools (must be fixed before B's feeds land broadly):**
- Central banks are geo entities: Bank of Canada / Bank of England / ECB / BoJ / RBA / SNB must not
  cross-match (`geoMiss` or a `BANK_RE` set in `scopeMismatch`).
- Multi-word proper-noun runs match as a whole or not at all: "Red Rocks" must not match "Red Lantern";
  a single common token of a run (`red`, `new`, `big`) never counts as a subject hit.
- "Google" alone must not match "Year in Search" / "Google Doodle" style markets: a brand that is the
  frame, not the subject, needs a second frame word.
- US Senate / House / Governor stories reject state-legislature headlines: `state senate|state house|
  statehouse|legislature|assembly|district \d+ remains` in the headline is a scope mismatch for a federal or
  gubernatorial market.
- Podcast / lede items: a headline that is a podcast episode or a round-up ("Pop Stars podcast",
  "election results for East Tennessee and Kentucky") should not be the item when a cleaner one exists
  (score x 0.6 for `podcast|episode|roundup|results for .* and .*|live updates` unless `official`).

**`server/newsroom.mjs` (C):** `ARCHIVE_HOURS` 48 -> **72** (option 4). `newsFor(story, news)` passes
`tier`/`about`/`ageH` through untouched. Flash-boosted stories keep `tier: 'exact'`.

### Regression cases (`scripts/test-match.mjs`, new, C owns, no network; headlines and markets from
the baseline report):
Must now match (event): Fed "number of rate hikes 2026" <- "September Fed rate hike was a mistake, Miran
says"; next Supreme Court justice <- "Alito will not retire immediately"; Josh O'Connor next Bond <-
"Brosnan endorses Callum Turner as next Bond"; Israel next-government mandate <- "Joint List will back
Eisenkot"; AZ-05 House <- "Mark Lamb moves ahead in race for AZ-5".
Must now match (fifth lever, exact): Ohio Governor margin <- "Democrat Amy Acton wins Ohio's race for
governor"; Texas Senate margin Talarico <- "Talarico first Democrat to win Texas Senate seat since 1988".
Must stay rejected: Fed April hike <- Fed enforcement-action release; Oscars best actress <- "Is this the
gayest Oscar season ever?"; DWTS <- Rings of Power interview; Bank of Canada decision <- "Bank of England
raises rates"; Mt. Joy at Red Rocks <- "Raise the Red Lantern review"; Bad Bunny Year in Search <-
"Google will block search access for schools"; Alabama US Senate margin <- "Democrats flip two Alabama
Senate seats as District 10 remains close"; Iran nuclear deal <- "More Iranians call for nuclear weapons
after war" (sensitive wording); Ebenezer RT score <- "Klara and the Sun debuts to 24% RT"; Hunger Games
album units <- a record-store listing (outlet drop is A's; C's test uses a cleaned outlet and checks the
title still fails on frame). All existing cases in `scripts/test-editorial.mjs` still pass.

### Acceptance (C)
- `node scripts/test-match.mjs` and `node scripts/test-editorial.mjs` pass.
- On the scratch server after 2h: event-tier stories on air between 3 and 15; a 20-sample grade of
  event-tier lines by the reviewer is >= 80% good/ok.
- `PNN_MATCH_DEBUG=1 node scripts/test-wire.mjs --no-search --top 30` shows no new "wrong" matches
  among the 30 (reviewer grades).

---

## 4. Option 4: 48-72h freshness with honest age labels (B, C, A, D, E)

Search already airs up to 96h; the wire is capped three times. All three move to 72h: parse
`maxItemAgeHours` 72 (B), `ARCHIVE_HOURS` 72 (C), `newsdesk compute maxAgeMs` 72h (A). The matcher's own
96h hard cap stays. Sports/games keep their wire-only 24h rule (sports news is high-frequency; measured
quality of older SG headlines is poor).

**Ranking (D, `rank.mjs newsFactor`):** fresher ranks higher, with a steeper tail now that older items
are admitted: <= 2h 1.35, <= 6h 1.2, <= 12h 1.1, <= 24h 1.0, <= 48h **0.85**, <= 72h **0.7**, <= 96h
**0.55**, older 0.4. Outlet bonus unchanged (+10% per extra outlet in 24h, max +40%). Event tier x 0.9 on
top. In `selectBoard`, the top 6 never carries a story whose news is older than 48h while a fresher
qualifying story of the same category exists (apply in `orderTop`'s `ok` predicate).

**Age on the wire (A):** every News item gets `ageH` (hours, one decimal, at build time). The client still
recomputes from `publishedAt` when `ageH` is missing.

**Labels (E, `public/js/util.js ago()` and `newsMeta`):** honest ages, never vague: < 60 min "42 min
ago"; < 24h "5 hr ago"; 24-47h "1 day ago"; 48-71h "2 days ago"; 72-96h "3 days ago". Items >= 48h get
class `old` on `.bc-nl-s` (muted amber, not pink) so an older item reads as older on screen. Never
"yesterday"/"recently".

### Acceptance (option 4)
- Median on-air news age <= 24h; share of on-air stories whose news[0] is > 48h old <= 20%.
- Fixture shows one 2-day-old item rendering "2 days ago" in the muted style at 1920x1080, 1512x945,
  2000x810 with an empty fitReport.

---

## 5. Option 5: MARKETS MOVING FIRST · NO HEADLINE YET (D server, E client)

**Goal:** the on-brand "pre-news" story: a big, well-traded move with no headline yet airs in a capped,
clearly labelled share of slots. Measured: 49 guarded candidates at 5 pts / $10K (10 at 8 pts / $25K, too
few to fill the share); unguarded lists are polluted by settled brackets; 4 candidates are war markets.

### Selection (`rank.mjs newsGate`, D) and config (`config.movingFirst`, D)
```js
movingFirst: {
  enabled: true,
  points: 0.05, minVolume: 10_000,          // |change1d| >= 5 pts on >= $10K event volume
  strongPoints: 0.08, strongVolume: 25_000, // "strong" tier ranks first
  priceBand: [0.04, 0.96],                  // yesPrice AND prior (yesPrice - change1d) inside the band: no settled brackets
  minHoursToClose: 6,                       // not resolving within 6h
  share: 0.15, boardMax: 4, topMax: 1, deskMax: 2, closingMax: 1, moversMax: 3,
  excludeCategories: ['geopolitics', 'sports', 'games', 'esports'],
  excludePatterns: [ /* D4 belt and braces: iran|russia|ukraine|israel|gaza|hamas|hezbollah|houthi|taiwan strait|north korea|nuclear|ceasefire|strike|troops|missile|war\b */ ],
}
```
A story with no news item qualifies for moving-first when: `qualifies()` is true, not `isDecay`, not
`nearCertain`, lead `|change1d| >= points` (or `hotNow`), `_evVol >= minVolume`, both prices in the band,
`closesAt` > now + 6h, category not excluded, no excluded pattern in event/market/outcome text, not a
ladder far rung (strike ladders: the line only). Ordered by `weightedMove(lead) * log10(10 + evVol)`,
strong tier first.

The story gets `newsTier: 'none-moving-first'`, `news: []`, `movingFirst: {points: change1d (signed),
volume24h: evVol, strong, since: change1h-based ? 'past hour' : 'today'}`, `newsScore` **0.9** (strong
**1.0**), and joins `ranked` on that value. Caps in `selectBoard` / `buildDesks` / closing / movers:
board <= `boardMax` (4 of 30), top 6 <= `topMax` (1) and **never #1**, each desk <= `deskMax` (2 of 12),
THIS WEEK <= 1, movers <= 3 of 20. Overflow candidates are counted in `stats.dropped['news:moving-first-
capped']` and stay in `pending` for search (they are the best search targets: A's `searchTargets` puts
pending stories with `movingFirst` set first within the never-searched group).

On-air share target: 11-15 of ~100 slots (10-20%). When a headline later arrives for a moving-first story
it flips to `exact`/`event` on the next rebuild with no special handling (a "news caught up" moment is a
follow-up, not in this plan).

**Copy (D, `copy.mjs`):** headline/dek unchanged (they already lead with data and change). Add
`movingFirstLine(story)` -> "No headline yet · up 9 points today on $42,000 traded" (points via `pts()`,
money via `money()`; "past hour" when the move is the 1h one). Never a cause, never "will", never
"Bettors".

**Client (E):** `newsTier === 'none-moving-first'` renders the news block as a distinct kicker
"MARKETS MOVING FIRST" + "NO HEADLINE YET" with the `movingFirstLine` under it, in the amber accent
(`--amber`, not magenta), same `.bc-newsline` geometry so nothing shifts. Minis show "MOVING FIRST ·
no headline yet · up 9 pts". The chyron tag for a moving-first lead card reads "MOVING FIRST". The 3D
scene needs nothing. Fixture gains two moving-first stories (one strong, one ordinary).

### Acceptance (option 5)
- On the scratch server after 1h: moving-first stories on air between 8 and 15 (`newsCoverage.tiers.
  movingFirst`), `movingFirstPct` 0.10-0.20, none at board #1, <= 1 in the top 6.
- Reviewer grades the full moving-first list: 0 settled-bracket artifacts (a +80-point "move" at 1%/99%),
  0 war/conflict markets, 0 sports/games, 0 deadline-decay.
- `scripts/test-editorial.mjs` (D) gains cases: settled bracket excluded, war market excluded, caps hold,
  never #1, flips to `exact` once `newsLookup` returns an item.

---

## 6. Option 6: sports & games caps (D)

Measured: 15 news-matched SG stories are off air; 5 good, 10 weak/wrong; wrong ones scored < 3.3; one
GTA VI headline backs 5 stories. Raise modestly and add a quality floor at the same time.

| Cap | Today | New | Where |
|---|---|---|---|
| Board `SG_BOARD_MAX` | 3 | **4** (`limits.sgBoard`) | rank selectBoard |
| SPORTS & GAMES desk | 6 | **8** (`DESKS[sports].max`, `limits.sgDesk`) | rank buildDesks |
| THIS WEEK | 2 | **3** | rank closing |
| Movers | 2 | **3** | rank movers |
| SG match score floor | none (matcher 3) | **3.3** on `news[0].score` for SG stories (`limits.sgMinScore`) | rank newsGate |
| Per-headline cap, SG | 2 board / 2 desk | **1 on the board, 2 on the desk** | rank |
| Lead story | never SG | never SG (unchanged) | |

No search path for SG (decision: Google sports results are dominated by betting-odds pieces that the
independence rule drops; not worth the budget). The 29 headline-less SG stories stay off air.

### Acceptance (option 6)
- Board SG <= 4, desk <= 8; the four baseline "wrong" cases (Barcelona <- team of the week, Faker <-
  World Series MVP, Messi <- Ronaldo-vs-Messi numbers, Giants <- Jonathan Taylor rumor) are excluded by
  the floor in a `test-editorial.mjs` case.
- No two board SG stories share a headline.

---

## 7. State / SSE contract changes (integrator updates ARCHITECTURE.md from this)

```js
// Story (rank.mjs newsGate sets newsTier; newsdesk sets the item fields)
newsTier: 'exact' | 'event' | 'none-moving-first',   // missing => 'exact'
news: [{ title, source, outlet, url, publishedAt, via: 'wire'|'search', score,
         tier: 'exact'|'event',            // from matchStoryNews; missing => 'exact'
         about: 'race'|'question'|null,    // event tier only: what the headline is about
         ageH: number }],                  // hours old at build time, 1 decimal
movingFirst: { points: number /* signed, e.g. 0.09 */, volume24h: number, strong: boolean, since: 'today'|'past hour' } | null,
// Market in state.movers: carries newsTier and movingFirst like its story
// Desk: unchanged shape; stories inside carry the fields above
// State.feeds.news: + { budget, scale, searched1h, found1h, pool, neverSearched, retrying }
// Health build.newsCoverage: + { tiers: {exact, event, movingFirst}, movingFirstPct, pool: {size, neverSearched, retrying} }
// Health build.newsDropped: + { movingFirstCapped }
// stats.dropped: + 'news:moving-first-capped', 'news:sg-score'
```
No new SSE event types. `state` carries everything; `?fixture=1` sample (E) shows every tier.

Client labels (E):
| newsTier / item | Kicker | Second line |
|---|---|---|
| exact | IN THE NEWS | outlet · age |
| event, about race | IN THE NEWS · ABOUT THE RACE | outlet · age |
| event, about question | IN THE NEWS · ABOUT THIS QUESTION | outlet · age |
| none-moving-first | MARKETS MOVING FIRST · NO HEADLINE YET | "up 9 points today on $42,000 traded" |
| any, age >= 48h | as above | age in muted amber ("2 days ago") |

---

## 8. Guardrails (apply to every builder; the reviewer checks them)

- **Odds are not facts.** Every line still reads as a probability with a %, "odds" or "chance" tied to
  the subject. No "X will…", no "X is expected to…", no "Bettors". Moving-first copy states a move and
  the absence of a headline; it never implies a cause or a prediction.
- **Sensitive (D4):** no war, violence or death. Moving-first excludes `geopolitics` outright and any
  text matching the conflict pattern, because there is no headline to frame it. The news item never
  carries graphic wording (existing `SENSITIVE_TITLE`). Builders must not loosen `config.sensitive`.
- **Independence:** no exchange, sportsbook, social or retail outlet as the news item (A extends the
  retail drop). New feeds are independent newsrooms only.
- **Source, time, size** stay on every card; the thin flag stays.
- **Event-level quality bar:** a headline backs other outcomes only when it names the event's own subject
  plus its frame, or a rival outcome plus the frame, or comes from an official source on that event. It
  is labelled as event-level on screen. Never admit on a shared common word.
- **Moving-first cap and label:** <= 15-20% of on-air slots, never the lead story, at most 1 in the top
  6, always labelled "NO HEADLINE YET". Settled brackets, decay, near-certain and closing-within-6h are
  excluded by the price band and time guard.
- **Sports/games:** never lead; a score floor goes with the raised caps; no search path.
- **Plain English, no ellipsis truncation, min font .7vw, `scrollWidth <= clientWidth`.** Layouts verified at
  1920x1080, 1512x945 and 2000x810.
- **Politeness:** no feed faster than 60s, no host more than one feed under 180s, Google search paced
  1.5s with the halving rule on 429.

---

## 9. File ownership (no overlaps)

| Builder | Owns (edit) | Reads only | New files |
|---|---|---|---|
| **A** news-search coverage | `server/sources/news.mjs`, `server/newsdesk.mjs`, `server/ingest.mjs` (news/search parts: `searchCycle`, `refreshNews`, `newsCoverage`, `enrich`, save/load), `server/store.mjs` only if a feeds-news field needs it | `server/editorial/copy.mjs` (uses `newsQueries` when present), `config.poll.*` | `scripts/test-news-search.mjs` |
| **B** feeds | `server/wire-config.mjs`, `server/sources/wire.mjs` | `scripts/test-wire.mjs` (run it; edit only if a new flag is needed) | none |
| **C** matching | `server/editorial/match.mjs`, `server/newsroom.mjs` | `server/newsdesk.mjs` (A copies `tier/about` from results) | `scripts/test-match.mjs` |
| **D** gate / ranking / caps / moving-first | `server/editorial/rank.mjs`, `server/config.mjs`, `server/editorial/copy.mjs` (`movingFirstLine`, `newsQueries`), `scripts/test-editorial.mjs` | `server/ingest.mjs` | none |
| **E** client | `public/js/cards.js`, `public/js/panels.js`, `public/js/chyron.js`, `public/js/util.js` (`ago`, `newsMeta`, `newsLineHtml`), `public/js/director.js` and `public/js/overlay.js` only if a tag must change, `public/css/cards.css`, `public/css/panels.css`, `public/css/chyron.css`, `public/css/theme.css` (`--amber` if missing), `public/dev/state.sample.json` | `docs/ARCHITECTURE.md` shapes | none |
| **Integrator** | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (one block from the hand-backs), `CLAUDE.md` commands line if a test script is added | everything | none |

Cross-builder contracts (so nobody waits on anybody):
- C -> A: `matchStoryNews` results carry `tier` and `about`; A's `toNews` copies `tier: r.tier || 'exact'`,
  `about: r.about || null`, and sets `ageH`.
- D -> A: `copy.newsQueries(story) -> string[]` (lead query first, event query second, deduped); A calls
  it through `copy.newsQueries?.(s) ?? [copy.newsQuery(s)]`.
- D -> A: `limits.newsPool`, `poll.newsBudget`, `poll.newsBudgetShort`, `poll.newsRetryMin`,
  `poll.newsRetryMaxMin`, `poll.newsRefreshMin`, `poll.newsCacheMin`; A reads each with the default in
  section 1.
- D -> E: `newsTier`, `movingFirst`, `news[i].tier/about/ageH`; E defaults every missing field.
- A -> D: `enrich.newsLookup(story)` unchanged shape plus `items[i].tier`; D reads `items[0].tier` to set
  `newsTier`.
- B -> C: feed `category` values stay within the existing set (`courts` is already a PNN category).

---

## 10. Acceptance criteria (whole feature, measured on the scratch server after a 2h soak)

| Metric | Baseline | Target |
|---|---|---|
| Stories on air (`newsCoverage.onAir`) | ~76 | **>= 110** (board 30 full, each of 5 desks >= 10, SG desk <= 8) |
| `newsDropped.none` | 1,065 | **<= 900** |
| Pool never searched | 343 | **<= 10** after 60 min |
| Search yield (found/searched, 24h) | 12.8% | **>= 15%** |
| Relevance spot check, 30 random on-air news lines (reviewer grades good/ok/weak/wrong) | 83% usable on search sample | **>= 85% good+ok, <= 7% wrong** |
| Event-tier on air / grade on 20 | 0 | **3-15 / >= 80% good+ok** |
| Moving-first on air / share | 0 | **8-15 / 10-20%**, never #1, <= 1 in top 6, 0 war, 0 artifacts |
| SG on air | 7 | **<= 12** (4 board + 8 desk), 0 of the four baseline wrong cases |
| Median news age / share > 48h | ~? / 0 (capped) | **<= 24h / <= 20%** |
| Wire feeds ok | 50/50 | **>= 80 total, >= 90% ok** |
| Google 429s in 2h | 0 | **0** (or one, followed by `news budget halved`) |
| `build.newsMs` | today's value from health | **<= 2x baseline** (pool 400 and 72h archive cost lookups) |
| `npm run check`, all test scripts | pass | **pass** |
| fitReport at 1920x1080, 1512x945, 2000x810 with `?fixture=1` | empty | **empty**, no overlap, no ellipsis |

---

## 11. Verification steps (integrator, after all five hand back)

1. `cp -R /Users/pj4533/Developer/pnn <scratchpad>/pnn-verify && cd there && npm run check && node
   scripts/test-editorial.mjs && node scripts/test-match.mjs && node scripts/test-news-search.mjs && node
   scripts/test-sources.mjs`.
2. `PORT=4210 npm start` in the scratch copy (record the PID from the `server start` log line). Wait 15
   min, then `curl -s localhost:4210/api/health` and check `feeds.wire`, `feeds.news`,
   `build.newsCoverage` (pool draining, tiers), `build.newsDropped`.
3. After 60 min: pool `neverSearched` <= 10; after 2h: the table in section 10. Save the health JSON and
   the `news search` log lines to `research/news-gate-after.md` (the one report file this feature writes).
4. Reviewer pass (a separate agent, read-only): `curl localhost:4210/api/state`, sample 30 on-air stories,
   all moving-first stories, 20 event-tier stories and every SG story; grade each line good/ok/weak/wrong
   against the guardrails in section 8; list every wrong one with the headline and the market.
5. UI: open `http://localhost:4210/?fixture=1` in headless WebKit/Playwright at the three resolutions;
   confirm the moving-first kicker, an event-tier kicker and a "2 days ago" item render; `window.__pnn`
   fitReport is empty; no console errors. Then open the live scratch UI and screenshot one of each tier.
6. Stop the scratch server by PID. Update `docs/ARCHITECTURE.md` (section 7 shapes, runtime notes:
   budget 14, pool 400, retry 90 min with backoff, 72h wire, moving-first caps, SG caps) and append the
   builders' decisions to `docs/DECISIONS.md`.
7. Hand the user: on-air count before/after, the four grade rates, the moving-first list, the feed list,
   and the wrong-match list.

Order of landing if conflicts force a sequence: D (config + contract) -> C (matcher) -> A (search) -> B
(feeds) -> E (client). All five can be built in parallel; only the final rebase needs that order.
