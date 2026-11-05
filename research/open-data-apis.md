# Open data APIs for PNN

Verified on 2026-11-05 by calling each endpoint with curl. The User-Agent was `PNN/0.1 (local news display)`, no key was used and no account was created. Data values below are what came back that day.

## 1. Summary

Twelve sources passed verification. All are keyless, return the real numbers, and can be polled politely from the one PNN server. They fall into three groups. **More markets:** PredictIt adds a third US real-money venue and Smarkets adds UK and EU politics. **Official context that markets resolve on:** the LMArena leaderboard, BLS CPI and jobs data, NY Fed rates, the Fed calendar, Launch Library, VoteHub polls, and Treasury debt and auction data. **Attention signals for the news gate:** Wikimedia pageviews, the Wikipedia featured feed and Google Trends. Most are small builds. Three caveats affect what goes live. PredictIt has no volume field, so it needs a "volume not published" flag and should be used mainly as a comparison line. The display terms for PredictIt, Smarkets and VoteHub were not readable from curl, so check them by hand before the stream goes public. Google Trends is unofficial and noisy, so use it as an internal signal only. No pick failed outright, but the Wikipedia featured feed works only on some days and needs a fallback.

## 2. Ranked picks (all passed)

| # | Name | What it adds on air | Access | Effort | Verified |
|---|------|---------------------|--------|--------|----------|
| 1 | PredictIt market data | Third venue on cross-venue lines and the exchange-disagreements segment (US politics) | keyless, 5 req/min | M | 2026-11-05 |
| 2 | Wikimedia Pageviews | "Wikipedia views 13x normal" badge, ranking boost, most-read card | keyless | M | 2026-11-05 |
| 3 | Wikipedia featured feed (In the news, most-read) | Curated non-exchange news items with entity links that make matching easier | keyless | S | 2026-11-05 |
| 4 | LMArena leaderboard (HF datasets-server) | AI leaderboard strip on "best AI model" markets, which resolve on this exact data | keyless | S | 2026-11-05 |
| 5 | BLS Public Data API v1 | "Last print" line on CPI, jobs and unemployment markets | keyless, 25 queries/day | S | 2026-11-05 |
| 6 | NY Fed reference rates (EFFR, SOFR) | Fed target band and effective rate on every Fed card | keyless | S | 2026-11-05 |
| 7 | Federal Reserve calendar JSON | Exact FOMC dates for the countdown, plus Fed-speaker chips | keyless | S | 2026-11-05 |
| 8 | Launch Library 2 (The Space Devs) | Launch calendar card, countdowns and slip detection for launch markets | keyless, 15 req/hour | M | 2026-11-05 |
| 9 | Smarkets public API v3 | UK, French and Irish politics markets, plus a fourth price on 2028 | keyless, 60/window | L | 2026-11-05 |
| 10 | VoteHub polls API | Latest-poll line on approval and generic-ballot markets | keyless | S | 2026-11-05 |
| 11 | Google Trends daily trending RSS | "What America is searching" trigger and boost (internal) | keyless, unofficial | S | 2026-11-05 |
| 12 | Treasury FiscalData debt + TreasuryDirect auctions | Debt-milestone card and weekly auction results | keyless | S | 2026-11-05 |

## 3. Per-pick details

### 1. PredictIt market data

- **Endpoint:** `GET https://www.predictit.org/api/marketdata/all/` (GET only, so HEAD returns 405).
- **Fields seen:** 145 markets and 527 contracts. Each market has `id`, `name`, `shortName`, `url`, `image`, `timeStamp` (2026-11-05T17:40, current) and `status`. Each contract has `name`, `status`, `lastTradePrice` (for example Vance 0.30 and Rubio 0.21 for the 2028 GOP nominee), `lastClosePrice`, and `bestBuyYesCost`, `bestBuyNoCost`, `bestSellYesCost` and `bestSellNoCost`. There is **no volume field.** Closed contracts have null best prices, so keep only `status == "Open"`.
- **Limits and terms:** the response header `X-Rate-Limit-Limit-Minute: 5` means 5 requests per minute, and data refreshes about once a minute, so poll every 2 to 3 minutes. The terms page is rendered by JavaScript and could not be read with curl. PredictIt has historically allowed non-commercial use with attribution. **Check this by hand before going public.**
- **PNN idea:** a third price on cross-venue lines ("Vance 30% on PredictIt vs 33% on Polymarket") and in the exchange-disagreements segment from commit 1a8fc1c. The day move is `lastTradePrice - lastClosePrice`.
- **Integration:** add a new `server/sources/predictit.mjs` that normalizes into the shared market shape with `source:'predictit'`, `volume24h:null` and a `volumeUnpublished` flag. The "always show size" rule means it should not lead a story by itself. Use it as a comparison line, or as a news-gated politics story that carries a "volume not published" tag. Matching to Polymarket and Kalshi markets can reuse the existing cross-venue matching.

### 2. Wikimedia Pageviews

- **Endpoints:** `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/{Y}/{M}/{D}` and `.../per-article/en.wikipedia/all-access/user/{Title}/daily/{YYYYMMDD}/{YYYYMMDD}`.
- **Fields seen:** the top list has `items[0].articles[]` with `article`, `views` and `rank`. For 2026-11-04: Main_Page 4,594,041, Abdul_El-Sayed 1,413,749, then James_Talarico and Gina_Hinojosa. The per-article series has `items[]` with `timestamp` and `views`. Jon_Ossoff from 10-28 to 11-04 went from about 16.6k to 46.5k a day, then 611,863 on election day.
- **Limits and terms:** very generous rate limits, CC data, and a descriptive UA is required (the PNN UA is fine). The top list covers the previous day.
- **PNN idea:** an attention badge on a card ("Wikipedia views 13x normal"), a ranking boost in `rank.mjs` when a subject's views rise well above their 7-day median, and a "Most read yesterday" card limited to subjects that have a live market.
- **Integration:** a new `server/sources/wikimedia.mjs` that fetches daily per on-air or candidate subject and caches for hours. It needs a cached mapping from subject to Wikipedia title (Wikipedia search or Wikidata). Filter out `Main_Page`, `Special:` and `Wikipedia:` entries. This is a ranking signal, not a news item, so it does not satisfy the news gate by itself. It can trigger a news search for that subject.

### 3. Wikipedia featured feed (In the news, most-read)

- **Endpoint:** `https://en.wikipedia.org/api/rest_v1/feed/featured/{Y}/{M}/{D}`. Fallback: `https://en.wikipedia.org/w/api.php?action=parse&page=Template:In_the_news&prop=text&format=json&formatversion=2`.
- **Fields seen (11/05):** keys `dyk`, `image`, `mostread`, `news`, `onthisday` and `tfa`. There were 5 `news[]` stories, each with HTML `story` text and `links[].titles.canonical` (2026_United_States_elections, Democratic_Party_(United_States), United_States_House_of_Representatives, United_States_Senate), and 46 `mostread` articles. **On 11/04 there was no `news` key at all**, so this source works only on some days.
- **Limits and terms:** polite use, poll hourly. CC BY-SA, so credit Wikipedia.
- **PNN idea:** an editor-curated, non-exchange news item for the matcher. Its canonical links work well as matching keys. It can also give an "official record" companion line.
- **Integration:** `news.mjs` currently blocks Wikipedia as both a REFERENCE_OUTLET and a SCRAPER_OUTLET, so this needs its own source path that feeds the wire and matcher directly. Strip the HTML. If today's feed has no `news`, try yesterday, then the Template:In_the_news parse. **Run every item through the death and war filter**, because ITN regularly carries obituaries and conflict items.

### 4. LMArena leaderboard (Hugging Face datasets-server)

- **Endpoint:** `https://datasets-server.huggingface.co/first-rows?dataset=lmarena-ai/leaderboard-dataset&config=text&split=latest`. Use `/rows?...&offset=N&length=100` to get more than the first 100 rows.
- **Fields seen:** `model_name`, `organization`, `license`, `rating`, `rating_lower`, `rating_upper`, `vote_count`, `rank`, `category` and `leaderboard_publish_date`. Overall top 3: Gemini 4 Carbon (High) 1540.04, Gemini 4 Argon (High) 1528.58 and Claude Opus 5.5 (High) 1515.80. Publish date 2026-10-28.
- **Limits and terms:** generous anonymous limits, and the dataset updates on an irregular schedule, so poll daily. The license is CC-BY-4.0, so credit LMArena.
- **PNN idea:** an AI LEADERBOARD strip on "best AI model end of month" cards: "#1 Gemini 4 Carbon 1540; Claude Opus 5.5 third, 24 points back". Those markets resolve on this leaderboard. Comparing snapshots and finding that #1 changed gives a news item that unlocks those markets.
- **Integration:** a small `server/sources/lmarena.mjs` with a daily fetch, filtered to `category == "overall"`. Collapse style suffixes such as "(High)" when grouping by organization. A change at #1 can go out as a synthetic news item, attributed to LMArena.

### 5. BLS Public Data API v1

- **Endpoint:** `https://api.bls.gov/publicAPI/v1/timeseries/data/{series}`, or a POST with `{"seriesid":[...]}` for several series in one query. Series: CUUR0000SA0 (CPI-U), LNS14000000 (unemployment rate) and CES0000000001 (nonfarm payrolls).
- **Fields seen:** `status: REQUEST_SUCCEEDED` and `Results.series[0].data[]` with `year`, `period`, `value`, `latest` and `footnotes`. September 2026 values: unemployment 4.2 (August 4.1), CPI index 336.940 (August 334.980), payrolls 159044 thousand (preliminary).
- **Limits and terms:** v1 allows 25 queries a day per IP, 25 series per query and 10 years of data, with no calculations. Public domain, so cite BLS.
- **PNN idea:** a "Last print" line on CPI, jobs and unemployment cards ("Unemployment 4.2% in September, up 0.1"). Compute year-over-year CPI from the index values. A new print counts as a news item for the gate.
- **Integration:** `server/sources/bls.mjs` makes one POST a day plus one on known release mornings, with heavy caching. The release calendar (.ics) is blocked to scripts, so hardcode release dates in config.

### 6. NY Fed reference rates

- **Endpoints:** `https://markets.newyorkfed.org/api/rates/unsecured/effr/last/2.json` and `.../secured/sofr/last/2.json`.
- **Fields seen:** `refRates[]` with `effectiveDate`, `percentRate`, `targetRateFrom`, `targetRateTo`, percentiles and `volumeInBillions`. EFFR on 2026-11-04 was 3.88, with a target of 3.75 to 4.00. SOFR was 3.94 (3.97 on 11-03).
- **Limits and terms:** no key and no published limit. Data is daily, so poll hourly at most. Public, credit the NY Fed.
- **PNN idea:** a context strip on every Fed card: "Fed target 3.75-4.00%, effective rate 3.88%". When the band changes, that is the official confirmation after a decision. It is never a call.
- **Integration:** add it to `server/finance.mjs` alongside the Treasury yield XML, and attach it to Fed markets (pmFedDec, kFedDecision) as context. It is not a news item.

### 7. Federal Reserve calendar JSON

- **Endpoint:** `https://www.federalreserve.gov/json/calendar.json`. It starts with a UTF-8 BOM, so decode as utf-8-sig.
- **Fields seen:** 2610 events with `month`, `days` (a string), `time`, `type`, `title` and `description` (HTML-escaped). FOMC entries: Minutes on 2026-11-18 at 2:00 p.m. (for the Oct 27-28 meeting), Press Conference on 2026-12-09 at 2:30 p.m., and Minutes on 2026-12-30.
- **Limits and terms:** public domain, poll daily. This is the JSON the Fed site itself uses, not a documented API, so the schema could change.
- **PNN idea:** exact FOMC dates for the Next Big Decision countdown, and a "Fed speakers this week" chip on Fed cards.
- **Integration:** `calendar.mjs` currently infers dates from market `closesAt`. Use this file as the source of truth for FOMC events. Times are Eastern, so convert carefully. The Fed press RSS is already a wire (`fed`), so this adds the missing calendar.

### 8. Launch Library 2 (The Space Devs)

- **Endpoint:** `https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=10&mode=normal`. Remaining quota is at `/2.3.0/api-throttle/`.
- **Fields seen:** `count` 478, and `results[]` with `name`, `net` (ISO), `status.abbrev`, `launch_service_provider.name`, `pad.location.name`, `mission`, `image.image_url` and `last_updated`. Examples: Ceres-2 NET 2026-11-06T23:35Z (Go), and Falcon 9 USSF-432.
- **Limits and terms:** 15 requests per hour per IP (confirmed through the throttle endpoint), so poll every 10 to 15 minutes. Credit The Space Devs. The terms page was not read.
- **PNN idea:** a LAUNCH CALENDAR card and countdown chips paired with SpaceX, Starship and Blue Origin timing markets. When `net` moves between polls, that is a slip story ("Starship flight slips 2 days"). Use the images in the hologram.
- **Integration:** `server/sources/launches.mjs` runs on a slow timer. A slip or status change becomes a news-equivalent item for the gate on launch markets only. Many payloads are military or Chinese government (USSF, Yaogan), so show only vehicle, time and status for those.

### 9. Smarkets public API v3

- **Endpoints:** `https://api.smarkets.com/v3/events/?type_domain=politics&type_scope=single_event&state=upcoming&limit=200`, then `/v3/events/{id}/markets/`, `/v3/markets/{id}/contracts/`, `/v3/markets/{id}/quotes/` and `/v3/markets/{id}/volumes/`.
- **Fields seen:** events include the 2027 French Presidential Election, Next General Election - Most Seats (44131545), Next Prime Minister, Next Fianna Fail Leader, the NI Assembly and the 2028 Presidential Winner (44136686). Market 83064432 had contracts (Labour, Conservative, Green, Advance UK and others) and quotes priced in basis points of 10000 (Labour bid 3597, offer 3623, so about 36%), with volume 285420.
- **Limits and terms:** header `x-ratelimit-limit: 60`. Stay at 1 request per second or slower and cache for at least 60 seconds. Display terms were not verified. It is a licensed UK betting exchange, so keep the wording neutral and never use referral links.
- **PNN idea:** international politics stories that Polymarket and Kalshi barely cover (next UK PM, UK most seats, France 2027, Irish and NI politics), paired with the BBC, Guardian, DW and France 24 wires already configured.
- **Integration:** `server/sources/smarkets.mjs` uses a fan-out of about 4 calls per market, so sweep a curated list of event ids slowly. The price is the mid of best bid and best offer. Many books are tiny, so apply a volume floor and the existing thin-market flag. This is the largest build on the list.

### 10. VoteHub polls API

- **Endpoints:** `https://api.votehub.com/polls?poll_type=approval&subject=Trump` and `?poll_type=generic-ballot`.
- **Fields seen:** `pollster`, `start_date`, `end_date`, `sample_size`, `population` and `answers[].choice/pct`. Approval: 1028 polls, newest RMG Research ending 2026-10-06, n=2000, approve 43 and disapprove 56. Generic ballot: 548 polls, newest Ipsos ending 2026-11-02, n=1212, Dem 52 and Rep 44.
- **Limits and terms:** undocumented. The response is about 480KB, so fetch once or twice an hour. No license page was found and the docs page returned 403 to curl, so check the terms before launch and cite VoteHub.
- **PNN idea:** a poll line on approval and Congress-control cards: "Latest poll: Trump approval 43% (RMG Research, Oct 6)". A server-side 30-day average is easy to add. This replaces the dead 538 CSV.
- **Integration:** context only, attached to approval and control markets. The newest approval poll was a month old, so always show the poll date and hide the line when the newest poll is too old (for example over 21 days).

### 11. Google Trends daily trending RSS

- **Endpoint:** `https://trends.google.com/trending/rss?geo=US`.
- **Fields seen:** about 10 items, each with `title`, `ht:approx_traffic` (500+, 1000+), `pubDate`, `ht:picture`, and several `ht:news_item_title` and `ht:news_item_source` entries. The sample was mostly sports and trivia (a Tom Brady card, a college basketball picks article) with local sources.
- **Limits and terms:** unofficial, with no SLA or documented terms, and it can break without notice. Poll every 15 to 30 minutes.
- **PNN idea:** an internal signal. When a trending query matches a market subject, boost the market or run the news search for it. Do not show it on screen.
- **Integration:** parse it with the RSS code in `wire.mjs`, but send it to a signals path, not the wire. Do not treat bundled headlines as news items, because they include gambling-pick content. The existing SPORTS & GAMES caps still apply to anything it boosts.

### 12. Treasury FiscalData debt to the penny and TreasuryDirect auctions

- **Endpoints:** `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=2` (use `curl -g` or encode the brackets) and `https://www.treasurydirect.gov/TA_WS/securities/auctioned?format=json&type=Note&days=30`.
- **Fields seen:** debt `record_date` 2026-11-04, `tot_pub_debt_out_amt` 40550230047609.15, up about $2.83B from 11-03. The latest Note auction was 7-Year, `highYield` 4.894, `bidToCoverRatio` 2.46, `offeringAmount` 44000000000. **`auctionDate` is missing on these rows**, so use `competitiveAuctionCloseDate` (2026-10-29), `announcementDate` (2026-10-22) or `issueDate` (2026-11-02). Many other fields are empty strings.
- **Limits and terms:** public domain, light polling (debt a few times a day, auctions hourly on auction days).
- **PNN idea:** a "US debt passes $40.55 trillion, up $2.8B in a day" card for shutdown and debt-ceiling stories, and a weekly auction beat ("7-year auction clears at 4.894%, bid-to-cover 2.46") paired with the ^TNX and ^TYX tiles and the pm10yHigh and kUst10 markets.
- **Integration:** add it to `server/finance.mjs`. It does not overlap the Treasury yield-curve XML already used there. These are context lines and cards for rate and debt markets that already have a news match.

## 4. Picks that failed verification

None of the twelve failed. Partial issues:

- **Wikipedia featured feed:** the `news` key was missing on 2026-11-04 and present on 11-05. It passes only with the fallback.
- **TreasuryDirect:** `auctionDate` is missing, but the other date fields work (see pick 12).
- **PredictIt, Smarkets, VoteHub, Launch Library:** the data checks passed, but the terms of use could not be confirmed from curl.

## 5. Honorable mentions (verified by scouts, not top picks)

- **NOAA SWPC space weather** (`services.swpc.noaa.gov/products/noaa-scales.json`, `alerts.json`, Kp index): keyless and live. A G3+ storm would make a strong Kp-meter card and breaking alert, but market pairing is weak.
- **Federal Register API:** keyless official confirmation of executive orders, tariffs and rules. It overlaps the White House wire, so add it later for EO-count and tariff markets.
- **Epoch AI `notable_ai_models.csv`:** keyless and CC-BY. It gives model release dates for "will X release by" markets and would go well with LMArena on an AI desk.
- **Hugging Face trending models and daily papers:** a keyless signal of AI attention, for open-model release markets.
- **openFDA drugsfda:** keyless and CC0. It confirms an approval about a day afterward and has no PDUFA dates.
- **Bluesky getTrends:** keyless, with categories and trending or cooling status. The API is unspecced. Show topic text only.
- **GDELT DOC 2.0:** keyless coverage-volume timelines, strictly limited to 1 request per 5 seconds, and noisy. Skip conflict themes.
- **Frankfurter FX (ECB rates):** keyless, for "yen weakest since" context. Daily only.
- **ECB SDMX:** keyless ECB policy rate for ECB decision markets. The latest value was not actually read yet.
- **NOAA CPC ONI, GISS GISTEMP and Mauna Loa CO2:** keyless monthly data that "hottest year" and El Nino markets resolve on. Context lines only.
- **Oyez:** unofficial, keyless dates for when SCOTUS cases were argued and decided. Best-effort.
- **EIA v2 weekly gasoline price:** instant self-serve key, which is allowed. It is the number gas-price markets resolve on. The Today in Energy RSS needs no key.
- **Steam GetMostPlayedGames and featuredcategories:** keyless context for game-release markets in the SPORTS & GAMES slice.
- **Wikidata wbsearchentities and SPARQL:** a keyless alias table to improve matcher recall and map subjects to Wikipedia titles for pageviews. SPARQL is flaky, so cache the results.
- **SEC data.sec.gov submissions:** keyless hooks for 8-K items and S-1 filings. The SEC wants a contact UA, which conflicts with the no-email rule.
- **OpenFEC:** instant api.data.gov key. Fundraising context for 2028, low priority for now.
- **Already integrated, so skip:** the Fed press RSS (wire `fed`), NWS alerts (wire `nws`) and the Treasury daily yield curve XML (`finance.mjs`).
- **Gray area, user decision:** the Nasdaq earnings and IPO calendar JSON and the CBOE VIX JSON. Both are keyless but unofficial, and their terms forbid redistribution.

## 6. Rejected or gated (do not re-propose)

**Markets**
- Metaculus: the free token hides community forecasts. Removed already.
- Manifold: play money.
- Betfair Exchange: requires an app key, login and account approval, and has a Cloudflare challenge.
- ForecastEx / IBKR: requires an IBKR account and gateway. No public price endpoint.
- Robinhood prediction markets: no public API, and it duplicates Kalshi and ForecastEx anyway.
- Crypto.com: no open event-contract data.
- Novig, Probable, Drift BET, Hedgehog: unreachable or no API.
- Azuro, SX Bet: per-game sports only, which is banned.
- Opinion.trade: keyless but probably by oversight. Mostly crypto and novelty markets, thin volume.
- Myriad: 18 thin markets with stale-looking politics prices that would produce false disagreements.
- Limitless: mostly crypto up/down and per-game sports.
- Jupiter prediction API: a mirror of Polymarket and Kalshi, not an independent venue.
- Predscope, Pinax, Predexon and x402 resellers: paid or 404, and resellers of data we already have.
- Good Judgment, Hypermind, Insight Prediction: no open numbers and not real-money.

**Government and economics**
- FRED: keyless CSV timed out repeatedly, and the API needs a key. BLS, NY Fed and Treasury cover the same series.
- GovTrack: Cloudflare challenge.
- Congress.gov: 403 without a key (untested with one).
- BLS release calendar ICS and RSS: Akamai blocks them. Hardcode the dates instead.
- BEA: the ICS returns HTML and the API needs a registered key.
- Census API: needs a key.
- Senate.gov roll-call XML: WAF block.
- House Clerk roll-call XML: no vote data was confirmed.
- supremecourt.gov RSS: 404 at the guessed URL.
- govinfo laws RSS: titles only and low value.
- FHFA mortgage data: no API found.
- CME FedWatch: blocks IPs for scraping, and its terms forbid scripts.
- Stooq CSV: 404, gone.
- SEC www.sec.gov feeds (8-K Atom, company_tickers, efts): blocked without a contact UA.
- Alpha Vantage: demo key only, and the free tier is capped at about 25 requests a day.
- Nasdaq insider trades: 404.
- FINRA: OAuth client credentials.
- CFTC COT: works but has low news value (not a rejection, just skipped).
- CoinGecko: crypto prices sit too close to the crypto-bracket ban. Context only at most.

**Science and AI**
- OpenAlex: shared daily budget per IP and an email-gated upgrade.
- NASA api.nasa.gov DEMO_KEY: returned 500 errors and allows 10 requests an hour.
- NASA EONET: disaster-framed with no market pairing.
- Open Notify: empty responses.
- NCEI Climate at a Glance JSON: returns HTML.
- CPC ENSO JSON: 404.
- Papers With Code: shut down.
- Epoch ai_models.csv and the benchmark zip: return HTML.
- USGS quakes: fine technically, but needs the sensitive-content policy (casualties).

**Attention and culture**
- Bluesky searchPosts: 403.
- Box Office Mojo: IMDb forbids automated data mining.
- The Numbers: scrape-only.
- TMDB: needs a key. It is instant self-serve, so it could be revisited under the clarification.
- YouTube Data API: needs a key and quota, and has no keyless trending data.
- Billboard: HTML only, and the terms forbid scraping.
- kworb: scrapes Spotify, so the legal basis is unclear.
- Reddit .json: bot wall. The official API needs OAuth.
- Reddit RSS: works, but the terms are risky for a public stream.
- MusicBrainz: busy errors, and it wants a contact UA.
- Twitch: OAuth.
- Rotten Tomatoes: no API, and scraping is against the terms.
- Lemmy: niche user content.
- Spotify API and charts: OAuth or login.
- Deezer charts: works, but the terms limit commercial use. Low priority.
- Mastodon trends and Hacker News: work, but are niche and tech-skewed. Low priority.
- Wikimedia EventStreams: heavy for little gain.

**Events and news**
- 538 polls CSV: dead since 2025.
- Silver Bulletin: behind a paywall.
- OpenElections: historical data only.
- NewsData.io and Currents: need keys, with delayed free tiers.
- TheSportsDB: only a shared test key that could be revoked.
- ESPN odds payload: sportsbook and affiliate content. Scores and headlines only, if ESPN is used at all, and its terms are risky.
- GDELT GEO, event and GKG themes: conflict coding.
- Wikipedia Deaths feed and death items in ITN: sensitive content.
- Nager.Date holidays: works but low value.
