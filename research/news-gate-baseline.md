# News gate baseline and loosening potential (2026-11-05)

Read-only measurement. Method: the server modules were copied to a scratch dir and used as a library (never port 4180 except one `GET /api/health`). Live markets were fetched once (Polymarket 3,773 + Kalshi 11,909 = 15,682), classified and run through the real `buildStories` with the real `newsdesk` (wire archive `data/news-archive.json` + `data/news-search.json`). The scratch run reproduces live health: airable 4,563 (live 4,565), `news:none` 1,065 (live 1,058-1,065), sportsGames 29 (live 28). Search tests used real Google News RSS queries, 1.5s apart, 150 queries. The scratch copy included the other workflow's uncommitted `match.mjs` edits as of the copy time. Caveat: snapshot is the morning after the midterms, so election-result headlines are unusually plentiful (elections are 274 of the 1,065 no-news stories and 59 of the 150-story sample); hit rates for election stories are inflated vs a normal day.

## 0. What the code does today (the knobs)

| Knob | Where | Today |
|---|---|---|
| Search budget | `ingest.mjs searchCycle`, `config.poll.newsBudget` | 6 searches / 90s cycle (8 if board short), 1.5s apart |
| Pending pool | `rank.mjs newsGate` | best 120 by rank, only stories that `qualifies()` (vol >= $5K elections/politics, $2K other; not decay; not near-certain) |
| Retry | `newsdesk.searchTargets` | re-search a no-match story every 20 min, refresh search-only aired stories hourly; SG never searched |
| Search cache | `news.mjs` TTL 10 min (ingest passes 15 min); persisted search hits 24h | |
| Wire window | `wire-config maxItemAgeHours: 24` at parse, archive `ARCHIVE_HOURS = 48`, `newsdesk.compute maxAgeMs: 48h` | wire headline <= 48h |
| Search window | `compute()` keeps search items <= 7d, but `matchStoryNews` hard-caps age at `min(maxAgeMs, 96h)` | search headlines up to 96h ALREADY air |
| Freshness rank | `rank.mjs newsFactor` | <=2h 1.35, <=6h 1.2, <=12h 1.1, <=24h 1.0, <=48h 0.8, <=96h 0.65, else 0.5 (+10% per extra outlet) |
| Age label | UI `ago()` on news lines | already shown |
| SG caps | `SG_BOARD_MAX = 3`, desk 6, closing <= 2, movers <= 2 | wire-only, headline <= 24h |

## (a) Funnel: the 1,065 no-news stories (non-sports)

Unit is a "story" = one event (what the gate drops), not a market.

| Bucket | Stories | Note |
|---|---:|---|
| Never eligible (`qualifies()` false) | 586 | 468 under the volume floor, 69 deadline-decay, 49 near-certain |
| Eligible, never searched, outside the 120 pool | 321 | rank > 120: starved |
| Eligible, never searched, inside the pool | 22 | queued |
| Searched, nothing relevant found | 129 | retried every 20 min |
| Searched, hit stored but lookup empty (aged/recheck) | 7 | |
| Eligible total | 479 | of which 343 (72%) never searched |

Caveat: "searched" comes from the persisted `news-search.json` (268 entries/24h; it is only saved on cycles that found something), so the live in-memory set may be slightly larger. Cross-check from `logs/pnn.log`: 958 searches in 3.2h with 123 found (12.8%); with about 268 unique stories searched that is roughly 3.6 searches per story, i.e. about 70% of the search budget goes to re-searching known no-match stories while 343 eligible stories are never searched.

Per category (no-news, non-SG):

| Category | Unqualified | Searched no match | Searched hit/empty | Never (in pool) | Never (outside pool) | Total |
|---|---:|---:|---:|---:|---:|---:|
| economy | 142 | 36 | 2 | 9 | 68 | 257 |
| elections | 128 | 23 | 0 | 3 | 120 | 274 |
| politics | 120 | 29 | 2 | 4 | 33 | 188 |
| culture | 84 | 18 | 3 | 4 | 43 | 152 |
| tech | 58 | 15 | 0 | 0 | 29 | 102 |
| geopolitics | 18 | 6 | 0 | 2 | 10 | 36 |
| world | 19 | 2 | 0 | 0 | 8 | 29 |
| weather | 7 | 0 | 0 | 0 | 4 | 11 |
| science | 5 | 0 | 0 | 0 | 3 | 8 |
| health | 5 | 0 | 0 | 0 | 2 | 7 |
| courts | 0 | 0 | 0 | 0 | 1 | 1 |

"Matched but rejected as weak" (late gates in `matchStoryNews`: frame / lead / geo / question miss):
- Wire archive: only 21 of 1,065 stories (2%) (frame miss 14, lead miss 4, asset/question 7, geo 1).
- Google search sample (n=150, never-searched): 24 stories (16%) had a candidate headline killed by a late gate: frame miss 18, lead miss 2, geo miss 2, question miss 4. 14 of the 18 frame-miss rejects were election "margin of victory / vote percent" markets where the headline is the race result ("Democrat Amy Acton wins Ohio's race for governor" vs "Ohio Governor margin of victory"). My read: about 14 of the 24 would be correct to air (race-result headlines on race-result markets), about 4 are rightly rejected (Florida state-House story on FL-12, Shah story on AZ-6, Indonesia GDP on Japan GDP, liner schedules on Suez transits). This is a fifth lever beyond the six options: treat margin/vote-percent/winner-bracket frame words (margin, least, percent, vote, victory) as non-frame for race-result markets. Worth about 12% of an unsearched sample.

Also, no-news SG stories: 29 (wire-only, no search path exists for SG).

## (b) Option 1: search more (150 never-searched, real searches, current strictness, 96h cap)

- 36 of 150 found a relevant-scored headline: 24% (95% CI about 17-31%). Google always returned 10 raw items; zero hits are relevance failures, not empty results.
- By category: elections 22/59 (37%), tech 5/16 (31%), culture 5/19 (26%), geopolitics 1/6, world 1/2, politics 1/12 (8%), economy 1/34 (3%). Non-election: 14/91 (15%).
- Extrapolated to the 343 never-searched eligible stories using per-category rates: about 80 extra stories (range 58-106). Compare the 12.8% yield the queue gets now from the already-ranked top 120.
- Cost: 343 searches. At 4/min that is 86 min for one sweep; about 3x budget (about 18/cycle) clears it in about 30 min. Raising the retry interval for no-match stories (20 min to 60+ min with backoff) frees most of today's budget. Pool cap 120 is the real blocker (321 of 343 are outside it).
- Spot check, 10 of the 36 (honest verdicts):
  1. CO-04 Laubacher <- USA Today "Live Colorado House results: Boebert vs. Laubacher" (3h): good.
  2. Josh O'Connor next Bond <- Deadline "Brosnan endorses Callum Turner as next Bond; Josh O'Connor reacts" (38h): good.
  3. Texas Senate margin Talarico <- BBC "Talarico first Democrat to win Texas Senate seat since 1988" (27h): good.
  4. Chinese AI #1 <- Business Insider "Chinese AI models tumble down rankings after a crucial change to testing" (55h): good.
  5. Home Depot beats earnings <- Yahoo Finance "Will Home Depot beat estimates again in its next earnings report?" (49h): ok (preview).
  6. Tennessee Senate margin Hagerty <- WATE "US, House 2026 election results for East Tennessee and Kentucky" (40h): weak (regional roundup).
  7. Michigan Senate margin El-Sayed <- The Times "Michigan Senate race polls: who will win" (11h): weak (pre-result piece).
  8. Iran nuclear deal <- NYT "More Iranians call for nuclear weapons after war with U.S." (43h): wrong topic (also war wording).
  9. Ebenezer Rotten Tomatoes score <- Yahoo "Taika Waititi slams critics after Klara and the Sun debuts to 24% RT" (74h): wrong (different film).
  10. Alabama Senate margin Moore <- Alabama Political Reporter "Democrats flip two Alabama Senate seats as District 10 remains close" (26h): wrong (state senate).
  Also wrong: Hunger Games album first-week units <- a record-label store listing (Blood Records). My grading of all 36: good 22, ok 8, weak 2, wrong 4 (about 83% usable, 11% wrong). The wrong ones are caught by no existing rule; a label-store / listing outlet filter and a state-senate vs US-Senate check would remove them.

## (c) Option 3: event-level news backs all outcomes

Current logic: multi-outcome stories need the lead outcome named (`oOk`) and the "lead miss" gate rejects other-outcome headlines unless it is a race. Measured by switching the gate off (and separately "any outcome named"):
- Wire: 139 multi-outcome no-news stories (114 eligible). Gate off gains 4 stories (2 eligible): Fed "number of rate hikes 2026" <- Bloomberg "September Fed rate hike was a mistake, Miran says" (ok); Anthropic IPO lead bank <- MarketWatch "An Anthropic IPO when the AI trade is this turbulent?" (ok); next Supreme Court justice <- NYT "Alito will not retire immediately" (ok); Israel next-government mandate <- Al Jazeera "Joint List will back Eisenkot" (good). "Any outcome + frame" adds nothing more.
- Search sample, 36 multi-outcome stories: strict 12 hits; gate off +2; any-outcome +3; a query built from the event title instead of the lead outcome +1; union 16 (+4, i.e. +2.7% of the 150). Examples: Nvidia "3rd largest company" <- 24/7 Wall St "Nvidia took back the world's biggest company title from Apple" (ok), AZ-05 House <- KTAR "Mark Lamb moves ahead in race for AZ-5" (good), Oscars doc nominations <- Variety "Oscar Predictions: Documentary Feature" 67h (ok, stale), DWTS 3rd place <- Us Weekly "Grammy Night songs and dances revealed" (weak).
- Loosening further (`e - eOut >= 1`, any outcome or frame) yields 59 stories but precision is about 15% (Fed "April hike" <- Fed enforcement-action press release, Oscars best actress <- "Is this the gayest Oscar season ever?", DWTS <- Rings of Power interview). Do not do that.
- Net: event-level backing is cheap and safe but small: about +4 on the wire pool and +1-3% on search. Count: about +5-10 stories overall.

## (d) Option 4: 72h window

- Where: wire only. Search already airs headlines up to 96h (`ageCap = min(maxAgeMs, 96h)`), so for search nothing to change. For wire the limits are `maxItemAgeHours` 24, `ARCHIVE_HOURS` 48 and `compute maxAgeMs` 48h; all three must move.
- Wire pool measured: archive+current feeds, 48h = 1,809 items vs 72h = 1,873 (+64, a lower bound: fast feeds only keep their latest 10-50 items, so a real 72h archive would be larger). Stories gained from the wire pool: 4 (1 eligible), all one Space.com Starship piece (52h): ok/weak.
- Search sample (best-hit age, current 96h): <=24h 12 stories, <=48h 29, <=72h 34, <=96h 36. So 48h to 72h adds 5/150 (3.3%), 72-96h adds 2 (already live). By top-hit: 12 within 24h, 17 in 24-48h, 5 in 48-72h, 2 in 72-96h.
- Honest labels: `ago()` already prints age; `newsFactor` already decays 24-48h to 0.8 and 48-96h to 0.65. Recommend the "fresher ranks higher" part is already in place.
- Net: about +1% on wire, 0 on search. Low value; do it cheaply (archive and parse caps) but do not expect volume.

## (e) Option 5: big moves with no headline (MARKETS MOVING FIRST)

Counts are non-SG no-news stories (event has a market meeting the move and money). Guarded = price and prior price both within 4-96%, not deadline-decay, not closing in under 6h (removes settled/resolved brackets, which otherwise look like +84 or -84 point "moves").
- Unguarded: >=8 pts and >=$25K: 14 stories; guarded 10 (2 sensitive, 8 Kalshi).
- Guarded >=5 pts and >=$10K: 49 stories (4 sensitive; Kalshi 34; politics 15, elections 11, economy 8, culture 8, tech 4, geopolitics 3). >=5/$25K: 17. >=10/$25K: 7. >=3/$10K: 71.
- For comparison: stories WITH news that meet 5 pts/$10K: 32 of 154. Target 15-20% of about 72 aired = 11-14 slots. 49 candidates supports it at 5 pts/$10K; the strict 8 pts/$25K from the brief gives only 10 and would not fill the share.
- Spot check of the unguarded 14 (verdicts): WTI $115 by Dec 31 18% -10 $78K: good; US gas this week 60% -23 $62K: good; Pattinson next Bond 17% +8 $38K: on-brand pre-news; President impeached before 2028 63% -12 $31K: good; House popular margin 14-16% 17% -9 $43K: ok; Fed Apr 2027 hike 4% -19: noise (far-dated, tiny price); Texas turnout 3% -84 and FL-24 99% +84: artifacts (settled bracket); Michigan margin 7+ 95% +17 and Luna FL-13 1% -11: settling after the result, not news; Trump insults Paxton by Oct 31 45% +40: stale deadline; Ukraine Uspenivka and Russia cities: sensitive (D4). So about 5 of 14 are real pre-news stories without the guard; the guard drops the artifacts but 4 sensitive war/Iran markets still need the D4 policy ("ask the user") before they can lead.
- Sensitive: the existing filter lets some Iran/Russia/Ukraine markets through as airable; they show up in this pool.

## (f) Option 2: more feeds

Already in the wire: Variety, Deadline, Space.com, NASA, The Verge (full feed), Axios, TechCrunch, NYT Politics/Science/Home, The Hill, Bloomberg, CNBC, STAT. Not yet: THR, Billboard, SCOTUSblog, Politico, Verge AI (a subset of Verge).

Tested 76 candidate URLs plus the 50 existing feeds (all existing return 200; bea and sec are stale). Working and fresh: THR (10 items, newest 0.3h), Billboard (10, 0h), IndieWire, Rolling Stone, Variety Film, Collider, Screen Rant, Pitchfork (30 items, 190h), SpaceNews (13 items, thin), Ars Technica, Live Science, ScienceDaily, NASA breaking, Phys.org, SCOTUSblog (25 items, 4 in 24h), Courthouse News, Above the Law, Verge AI (10), Wired, MIT Tech Review, Engadget, 9to5Mac, OpenAI (1,360 items, 12 in 72h), The Information, Politico politics (30 items, 2 in 24h), Politico congress (28 in 72h, best), Politico Playbook (3 in 72h), Roll Call, Fox politics, NBC politics, ABC politics, NPR politics, Semafor (271 items), Newsweek, FT, Fortune, Business Insider, CNBC world, DW, France 24, Guardian US/business/tech/culture/film/sci, BBC ent/tech/sci/biz/pol, NYT business/tech/arts/US/world/health, NPR tech/econ/arts/health, KFF, CBS politics/world/money/tech/ent. Dead or unusable: EW 403, Vulture 404, Lawfare 403, VentureBeat 429, WaPo 502, Yahoo Finance 404, BLS 404 (wrong URL), USA Today politics (0 items), CNN politics (undated/stale), Calculated Risk (stale since last year). Politico `playbook` is sparse.

Coverage: new feeds' items <=48h merged with the baseline pool, count of no-news stories whose winning headline is from the new feed (qualifying = would enter the board/desk pool):

| Group | Items | Stories gained | Eligible |
|---|---:|---:|---:|
| Entertainment (THR, Billboard, IndieWire, EW alt, RS, VF, Collider...) | 146 | 5 | 2 |
| Science / space | 162 | 1 | 0 |
| Courts | 44 | 0 | 0 |
| Tech / AI | 173 | 14 | 1 |
| Politics (Politico x3, Roll Call, Fox, NBC, ABC, NPR, Semafor...) | 273 | 11 | 6 |
| Economy / business | 126 | 21 | 4 |
| World / health | 103 | 1 | 0 |
| ALL new feeds | 1,027 | 44 | 13 |
| User-named set only (THR, Billboard, SCOTUSblog, Politico x3, Verge AI, Variety Film, SpaceNews, Ars, Wired) | 131 | 6 | 1 |

Best individual feeds (stories gained / eligible): nyt-business 13/4, fox-politics 4/3, mit-tech-review 1/1, politico-congress 1/1, nbc-politics 3/1, guardian-us 2/1, nyt-us 2/1, guardian-culture 1/1, billboard 3/0.
- Why so small: courts has 1 no-news story, science 8; markets in those categories are few. The gains are in politics and economy, which Google search finds anyway (the Kansas/Aaron Ford/El-Sayed pieces are also search hits).
- Spot check of 10 gained headlines: good: Aaron Ford (Politico "flips Nevada governorship"), Kansas Hamilton margin (NYT "How Kansas Democrats laid the groundwork"), Texas data-center moratorium (MIT TR "Texas was the new epicenter... might be kaput"), BoE rate hike 2026 (NYT "Bank of England raises rates for first time in three years"), Ro Khanna 2028 (NBC "draft campaign"). Weak: gas price brackets (NYT "High gas prices boost sales of hybrids for Toyota"), Tesla/SpaceX merger (NYT "stocks tumble after Musk-backed candidates lose"), Musk net worth (Guardian "Musk's midterm spending was a flop"). Wrong: Bank of Canada decision <- BoE hike; Mt. Joy at Red Rocks <- Guardian "Raise the Red Lantern review"; Bad Bunny Year in Search <- CBS "Google will block search access for schools that ban AI"; Blues Traveler at Red Rocks <- Billboard "Doja Cat tweaks Paint the Town Red lyrics"; DWTS Harry Shum <- Billboard pop-stars podcast; ECB December decision <- CBS "French blood banks hit by cyberattack"; Gemini Pro <- 9to5Mac iPhone 18 leak. Overall about half of the gains are usable. Bigger pools expose matcher weak spots (geo mismatch BoC/BoE, "Red Rocks" vs "Red Lantern", "Google" vs "Year in Search", podcast/lede items); fix those before adding broad feeds.
- Combined (72h window + all new feeds + event-level gate off): 61 stories gained, 21 eligible, with the same precision issues. Pure additive coverage of options 2+3+4 is therefore about +20 eligible stories before quality filtering.

## (g) Option 6: sports and games beyond the caps

- Live SG stories 51 (after the news gate): 22 have a wire headline <= 24h; 29 have none (dropped; no search path for SG). Aired now: 7 (board 2, desk 6, overlapping). So 15 news-matched SG stories (12 distinct headlines; one GTA VI "40 new screenshots" piece backs 5 stories) are off air.
- Graded (all 22): good 9 (e.g. LIV Golf "Is this the end of the road for LIV Golf?", Wembanyama MVP "pulls off something not seen since 1974", Rahm "T-2 after bogey-free opening round in Abu Dhabi", Ronaldo "Retires after fallout with coach", Como Champions League, PS6 "Sony getting serious about the PS6"); weak 9 (49ers sign a Georgia DL on a title market, Man City title <- referee appointment, Bournemouth <- Europa League live blog, GTA VI screenshots on PC-month/Online/postponed/on-time questions, Duke <- a player on a magazine cover); wrong 4 (Barcelona La Liga <- "Champions League team of the week", Faker Finals MVP <- World Series MVP piece, Messi MLS MVP <- "Ronaldo vs Messi by the numbers", Giants NFC champion <- Jonathan Taylor trade rumor).
- Net: raising the caps (3 board / 6 desk) would admit about 5 good stories now and about 10 weak/wrong ones. It needs a min score or per-headline cap (the wrong ones all scored < 3.3; GTA is 5 stories on one headline) at the same time. Without a search path for SG, 29 SG stories can never air.

## Summary table (eligible no-news stories = about 479; today 154 stories have news, about 72 on air)

| Option | Measured potential | Quality | Cost |
|---|---|---|---|
| 1 Search more | +~80 (58-106) of 343 never-searched (24% hit rate; elections 37%, economy 3%) | 83% usable, 11% wrong | 343 searches; budget x3 and no-match retry backoff; pool cap 120 is the blocker |
| 5th lever: frame-miss on race-result markets | about +12% of a never-searched sample (18/150), ~14 of 18 correct | high for race results | matcher tweak (other workflow owns match.mjs) |
| 2 More feeds | +13 eligible, +31 non-eligible (44 total); user-named set only +1 eligible | about 50% usable | 1 request per feed per 2-5 min; fix matcher geo/lede weak spots first |
| 3 Event-level | wire +4, search +1-3% (about +5-10 overall); looser versions are junk (15% precision) | ok | flip the lead-miss gate only |
| 4 72h window | wire +4 stories (lower bound), search 0 (already 96h) | ok/weak | 3 constants (maxItemAgeHours, ARCHIVE_HOURS, compute maxAgeMs) |
| 5 Markets moving first | 49 guarded candidates (5 pts, $10K); 10 at 8 pts/$25K; 4 sensitive | about 5 of 14 unguarded real; guard needed | needs D4 call on war markets |
| 6 SG caps | 15 news-matched stories off air, about 5 good | 41% good | raise with a score floor and per-headline cap; SG search path is the real gap |

Scratch artifacts (not in repo): `/private/tmp/claude-501/-Users-pj4533-Developer-pnn/f05ad053-70e1-4145-9aaf-0291a1702e0d/scratchpad/repo/` (a2.mjs funnel, b.mjs search sample, a4.mjs/c.mjs/e2.mjs/a3.mjs/feeds.mjs option tests; JSON outputs next to it as a2.json, b.json, b2.json, feeds.json, a4.json, c.json, e2.json).
