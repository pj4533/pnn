# Financial data for PNN: big stock/bond moves tied to prediction markets

Verified by curl on 2026-11-05 (~09:50 ET, pre-open/early session) with `User-Agent: PNN/0.1 (local news display)`. Treat as a snapshot; re-curl before relying on it.

## 1. Free, no-key data sources

### Primary: Yahoo Finance chart API (unofficial)
- URL: `https://query1.finance.yahoo.com/v8/finance/chart/<SYM>?range=<r>&interval=<i>` (query2 works the same).
- No crumb, no cookie, no key needed for `/v8/finance/chart` (HTTP 200 with a generic UA). Response headers: `cache-control: public, max-age=10, stale-while-revalidate=20`, so the edge caches about 10s. No 429s seen in ~40 requests. Unofficial and ToS-grey (personal/display use), so keep it polite and keep a fallback.
- Fields, real NVDA `range=1d&interval=5m`: `meta.regularMarketPrice 190.76`, `meta.chartPreviousClose 200.13` (also `previousClose`), `meta.regularMarketChangePercent -4.682`, `fulldayChange -9.37`, `regularMarketDayHigh/Low`, `regularMarketVolume 32215284`, `fiftyTwoWeekHigh 243.37 / Low 164.27`, `longName`, `regularMarketTime` (epoch s), `currentTradingPeriod`. Series: `result[0].timestamp[]` + `indicators.quote[0].close[]` (nulls possible, filter them). Day change = `(regularMarketPrice - chartPreviousClose) / chartPreviousClose`. `meta.marketState` was absent; derive open/closed from `currentTradingPeriod.regular` start/end vs now (or `regularMarketTime` staleness).
- History: `range=1d&interval=5m` (intraday), `range=5d&interval=15m` (107 points for AAPL), `range=1mo&interval=1d` (24 points), `range=1y&interval=1d`. `validRanges` is listed in meta. Add `&includePrePost=true` for extended hours.
- Symbols verified (all returned data):
  - Stocks: `NVDA`, `AAPL`, `BRK-B` (583.62), and the usual MSFT, GOOGL, AMZN, META, AVGO, TSLA, JPM, LLY, V (same pattern).
  - Indices: `^GSPC` 7580.84 (-1.40%), `^NDX` 27523.40 (-3.21%), `^DJI` 53153.86 (-0.38%), `^VIX` 17.56 (+5.7%).
  - Yields: `^TNX` (10Y) 4.902, `^FVX` (5Y) 4.702, `^TYX` (30Y) 5.283. These are the yield in percent directly (the old x10 quirk is gone). Yield change is `price - chartPreviousClose` in points (4.902 - 4.894 = 0.008). `^IRX` is the 13-week bill. A 2Y symbol was not available (`2YY=F` returns no `close`), so get the 2Y from Treasury.gov (below).
  - Commodities and FX: `CL=F` WTI 89.69 (+1.78%), `GC=F` gold 4128.5 (+1.36%), `DX-Y.NYB` dollar index 101.697 (+0.13%), `BTC-USD`.
- Latency: roughly real-time to 15 min delayed. Yahoo's own page labels US equities delayed. Futures and index values update live. Treat it as "about 1 to 15 minutes" and show the "as of" time.
- Reliability: has broken before (crumb requirements on v7/v10 quote endpoints, sporadic 429s from datacenter IPs). Only `/v8/finance/chart` is crumb-free today. Batch is not supported on chart (one request per symbol), so about 30 symbols means 30 requests per sweep. Spread them (200ms apart) and cache.

### Fallback 1: US Treasury daily par yield curve (official, free, no key)
- XML: `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=YYYYMM` (Atom feed, verified). The CSV endpoint (`/resource-data/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&_format=csv`) returned nothing from my probe, so use the XML.
- Fields per entry: `d:NEW_DATE`, `d:BC_1MONTH`, `BC_2YEAR`, `BC_10YEAR`, `BC_30YEAR`, etc. Real values: 2026-11-02: 2Y 4.59 / 10Y 4.91 / 30Y 5.28. 11-03: 4.61 / 4.95 / 5.32. 11-04: 4.58 / 4.90 / 5.28.
- Daily end-of-day only (posts around 3:30 to 6 pm ET). It is the official source, so use it for "closing yields" and for the 2Y, and to sanity-check Yahoo's ^TNX. Fetch about once an hour after 4 pm ET, once a day otherwise. It is a good "official numbers" source under the "odds are not facts" philosophy.

### Fallback 2: Stooq and FRED (both failed here)
- Stooq: `stooq.com/q/l/` returned "page does not exist", and `/q/d/l/` served a JavaScript proof-of-work challenge. Not usable from a plain server fetch. Drop it.
- FRED `fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10`: connection timed out twice (HTTP 000). It is normally keyless and daily with a one-day lag, so it is only a daily-history backup (DGS2, DGS10, DGS30, DCOILWTICO, and so on). Retry before relying on it.
- Not tested, deprioritized: Finnhub, Polygon, Alpha Vantage (all need keys; free tiers are 60/min, 5/min and 25/day), Nasdaq.com API (needs browser headers, brittle), CNBC quote API (undocumented), Google Finance (HTML scrape).

### Recommendation
- Primary: Yahoo `/v8/finance/chart` for stocks, indices, yields, oil, gold, dollar and VIX (one source, one parser, history included).
- Official cross-check and 2Y: Treasury.gov XML (daily).
- Backup if Yahoo breaks: a free Finnhub key (put it in `.env.local`) for quotes, or FRED for daily yield history. Design the module with a `quoteSource` interface so Yahoo can be swapped.

## 2. Related prediction markets (verified today)

### Polymarket (Gamma: `public-search?q=...&events_status=active`, `events?slug=...`)
| Event slug | 24h vol | Total vol | Pairs with |
|---|---|---|---|
| `largest-company-end-of-december-2026` | $105k | $9.6M | NVDA/AAPL/MSFT/GOOGL moves. Now Apple 63.25% (+8.4 pts 1d), NVIDIA 35% (-8.5 pts), Microsoft 1.75%. This is the best pairing |
| `largest-company-end-of-november-2026` | $35k | $63k | Same, monthly. Also `2nd-largest-...` and `3rd-largest-...` (end of Nov and Dec) |
| `fed-decision-in-december-20260729232808632` | $653k | $13.0M | Yield moves, index moves. Now 25 bps increase 76.5%, no change 21.5% (outcomePrices per market; label it "hike" in copy) |
| `another-fed-rate-hike-in-2026` | $29k | $1.4M | Yield and dollar moves |
| `how-many-fed-rate-cuts-in-2026` | $39k | $55M | Rates (long-dated, high volume) |
| `how-high-will-10-year-treasury-yield-go-before-2027` | $11k | $1.1M | 10Y moves. Also `how-low-will-10-year-...-before-2027` ($521k total) and `-in-november` variants (thin) |
| `how-low-will-5-year-treasury-yield-get-before-2027` / `...30-year...` / `how-high-will-2-year-...` | $10k / $3.8k / $1.8k | $460k / $271k / $37k | 5Y, 30Y, 2Y |
| `us-recession-by-end-of-2026` | $8.5k | $2.4M | Index drops, yield-curve moves |
| `spx-hit-dec-2026`, `spx-close-dec-2026` | $4.4k / $1.2k | $465k / $55k | S&P 500 moves |
| `spy-up-or-down-on-november-5-2026` | $5.3k | $5k | Daily SPY up/down. Daily series, but sports-style novelty; fine as a pairing for the index card only |
| `bitcoin-vs-gold-vs-sp-500-in-2026` | $5k | $989k | Index and gold moves |
| Earnings, e.g. `nvidia-nvda-q3-...` (gross margin, data-center revenue; end 2026-11-18), `*-quarterly-earnings-*-eps-MM-DD-2026` | tiny ($0 to $3k) | tiny | Single-stock earnings; only worth airing for the mega-caps (NVDA 11-18) |
| Tesla: `how-many-tesla-deliveries-in-q4-2026`, `tesla-and-spacex-merger-officially-announced-by-june-30` ($4.8k) | small | small | TSLA moves |

There is no usable Gamma tag for "stocks" (the tag list only returned `federal-government` for my keyword filters). Use `public-search` with queries, or explicit slugs from config. Do not count on tag IDs.

### Kalshi (`https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=...&status=open`, `markets?series_ticker=...`)
| Series | Cadence | Notes |
|---|---|---|
| `KXINXU` (S&P 500 above X at 10am, 11am ... 4pm EST) | hourly, 200 open markets | Best intraday index pairing; 10am market 24h volume about 39.6k contracts on the top strike |
| `INX` / `INXB` (S&P 500 range) | daily | Same family, range buckets |
| `KXNASDAQ100` (4pm range) and `KXNASDAQ100U` (hourly above/below) | daily/hourly | Nasdaq-100 pairing |
| `KXINXY` / `INXY` / `KXINXMINY` / `NASDAQ100Y` | annual | "S&P close end of 2026", year-end ranges |
| `KXUST10A` (UST 10Y weekly/daily threshold), `KX10YR550PCT` ("10Y yield hits 5.50%"), `KXUST10`/`KXUST2` (monthly, none open today), `KX10Y2Y` (10Y-2Y spread) | daily/monthly | 10Y pairing. Verified: "Will the 10Y yield be above 4.99% on Nov 6?" last 5%, 15 markets, small volume (about 700 contracts per strike) |
| `KXFEDDECISION-26DEC`, `KXFED-26DEC` | per meeting | Fed decision and funds-rate level |
| `KXRECSSNBER-26` / `-27` | annual | Recession |
| `KXWTI` | daily, 70 open | Oil pairing; high volume (16k contracts on the near-money strike) |
| `KXTESLADELIVERIES`/`KXTESLA`, `KXNVDAA`/`KXTSLA`/`KXAAPLA` (company KPI), `KXCEONVDA`, `KXAAPLCEOCHANGE`, `KXNEWROLECEOAPPLE` | one-offs | Company-specific events; sparse |
| `KXGDP`, `KXCPI` | monthly/quarterly | Macro; pair with yield moves on release days |
| `KXBTC` | hourly | Crypto (noise by default per CLAUDE.md) |
- There is no Kalshi "largest company" series (probed `KXLARGESTCOMPANY`, empty). Polymarket owns that.
- Kalshi quirk: `volume_24h_fp`/`last_price_dollars` string fields are in dollars and contract counts. Existing `server/sources/kalshi.mjs` presumably handles this already.

### Best stock/bond to prediction-market pairings
1. NVDA (or AAPL/MSFT/GOOGL) +/- 3% -> Polymarket "Largest Company end of December 2026" (and November): "Apple 63%, up 8 points today; NVIDIA 35%, down 8.5". Strongest and most liquid pairing.
2. 10Y/2Y yield up or down 0.10 points or more -> Polymarket "Fed Decision in December" (hike 76.5%) and "Another Fed rate hike in 2026".
3. 10Y yield move -> Polymarket "How high/low will 10-year yield go before 2027" and Kalshi `KXUST10A`/`KX10YR550PCT` threshold odds.
4. S&P 500 down 1.5% or more -> Kalshi `KXINXU` hourly / `INX` daily ("S&P above 7,600 at 4pm: 38%") plus `KXINXY` year-end.
5. S&P 500 or Nasdaq-100 plunge -> Polymarket "US recession by end of 2026" and Kalshi `KXRECSSNBER-26`.
6. Nasdaq-100 -3% -> Kalshi `KXNASDAQ100`/`KXNASDAQ100U` ranges, plus the largest-company market.
7. Oil +/- 3% -> Kalshi `KXWTI` threshold odds (liquid), plus Fed/inflation markets if the story is inflation.
8. Hot CPI or jobs day yield spike -> Kalshi `KXCPI`, `KXFED-26DEC`, Polymarket Fed December.
9. TSLA move -> Polymarket Tesla deliveries Q4 and Tesla/SpaceX merger; Kalshi `KXTESLA*`.
10. NVDA earnings (11-18) -> Polymarket NVDA Q3 gross margin / data-center revenue markets (thin, show only with a thin-market flag).

## 3. News pairing

`server/wire-config.mjs` already polls: `mw-top` (MarketWatch top stories, 90s; the real-time MarketWatch feed is frozen), `bloomberg-markets` (90s), `wsj-markets` (120s), `cnbc-top` and `cnbc-economy` (120s), plus `fed`, `bea`, `sec` official feeds (category economy), Bloomberg politics, and Google News. No new feed is strictly needed.

How to match a big move to a headline (reuse `server/editorial/match.mjs` and `text.mjs` tokenizer):
- Build an alias table per ticker: `NVDA` -> `nvidia`, `jensen huang`, `nvda`; `AAPL` -> `apple`, `iphone`, `tim cook`; `^GSPC` -> `s&p 500`, `stocks`, `wall street`, `dow`; `^TNX` -> `treasury`, `yields`, `10-year`, `bond`; `CL=F` -> `oil`, `crude`, `wti`, `opec`.
- On a threshold crossing, search the wire ring (last 6h, markets/economy/tech categories first) for items whose tokens hit an alias and score by recency plus words like `falls, slides, tumbles, jumps, surges, selloff, rally`. Take the best headline, fire a "stock move + headline" candidate, and then look up the related prediction-market rows via an explicit pairing table (section 2) rather than free-text match. Fall back to `match.mjs` free-text for single-stock stories.
- Index and yield moves are often broad ("Stocks tumble as Treasury yields jump"). Match them to the best markets/economy headline in the last 90 minutes, preferring items with at least 2 outlets (the wire already clusters).
- Rule: no headline, no air. If a headline is not found within about 30 minutes of the move, show it only as a ticker segment (no card), and say nothing causal. Never claim the headline caused the move; show it as "In the news:".

## 4. Design proposal

Thresholds ("big move", config in `server/config.mjs`, per-class):
- Mega-cap (top ~20 by market cap list in config): day move of +/-3% or more (+/-2% for the top 5: NVDA, MSFT, AAPL, GOOGL, AMZN, since they move the largest-company markets). Also fire on an intraday swing of 2% or more in 60 minutes.
- Indices (S&P 500, Nasdaq-100, Dow): +/-1.5% day (Nasdaq-100 +/-2%). Today's NDX -3.2% and NVDA -4.7% both qualify, S&P -1.4% almost does.
- Yields (2Y, 10Y, 30Y): 0.10 points or more in a day (0.07 intraday). Copy: "10-year Treasury yield rises to 4.90%, up 0.12 points today". Never "bps".
- Oil, gold, dollar: +/-3% / +/-2% / +/-1%; default off for gold and dollar, on for oil (tied to the liquid `KXWTI`).
- Hysteresis: a symbol can air again only after the move grows by another 1.5 times or after 4 hours, so it does not spam.

Polling cadence (single server poller, browsers get state over SSE as now):
- Market hours (9:30 to 16:00 ET, weekdays): full sweep of about 30 symbols every 60s with 200ms spacing (about 0.5 req/s), plus intraday series (5m, 1d) refreshed every 5 min only for symbols currently "big". Pre/post hours (4:00 to 20:00 ET): every 5 min. Overnight and weekends: every 30 min for futures and oil only (or stop). Treasury.gov XML hourly after 4 pm ET.
- Reuse the existing back-off on 429/5xx (x2 up to 10 min per host). Cache the 5d/15m and 1mo/1d history for 15 to 30 min per symbol. One UA string, no cookies. Do not fetch in the browser.
- Market closed: keep the last close and label it "Closed" with the as-of time. After-hours news about stocks should say "after hours" only if includePrePost is on, otherwise use "at the close".

On screen:
- New card kind `markets` (extends `segmentCard` in `public/js/cards.js`): symbol and plain name, big price, "down 4.7% today", a sparkline of 5d/15m (and a 1-month toggle in the second half of the 8s card), day range and 52-week range, then a "PREDICTION MARKETS" strip with 1 to 3 linked rows from the pairing table in normal PNN shape (`%`, "up 8 points today", source line, 24h volume, thin-market flag), then the headline row "In the news: ... (CNBC, 40 min ago)". The 3D scene already supports per-story holograms. Use `ribbon.js` for the sparkline hologram and a `dial` for a yield.
- Ticker segment: a slim crawl ("S&P 500 7,581 -1.4% | Nasdaq-100 -3.2% | 10Y 4.90% | NVDA -4.7% ..."), always on, small footprint, only symbols over half the "big" threshold highlighted. Same minimum font size rule (.7vw, never truncate).
- Mixed stream: markets cards at a modest rate (at most 1 per 5 to 6 cards, max 2 per 10 minutes, none while a breaking alert is up). Eligible only when a threshold fires, a headline is attached and at least one paired prediction market exists (otherwise ticker only). A mover can be elevated into the NEWS MEETS MARKETS flash when its headline is a high-signal wire cluster.
- Copy: "Apple climbs to 63% to be the world's largest company at year end, up 8 points today" next to "NVIDIA falls 4.7% to $190.76". Odds are not facts; keep the standing disclaimer. Stock prices are data, not odds, so label the exchange and delay ("Prices delayed up to 15 min").
- Sensitive and editorial: do not give investment advice, and no "buy", "sell" or "crash" framing. Say "falls", "drops". Tickers and company names are fine, with no affiliate or brokerage links.

News-driven rule: a markets card needs (a) threshold fire, (b) wire headline match from the existing feeds, and (c) at least one paired prediction market. If any is missing, the move shows only in the ticker. This keeps it consistent with "every on-air market carries a matching news item".

Suggested implementation plan (not done; no code edited): `server/sources/quotes.mjs` (Yahoo chart + Treasury XML, sparkline, state), `server/editorial/finance.mjs` (thresholds, hysteresis, pairing table, alias map), wire into `server/newsroom.mjs`, add `markets` kind to `public/js/cards.js` and the ticker, and add `node scripts/test-finance.mjs` with saved samples under `research/samples/`.

## Open questions for the user
- OK to rely on an unofficial Yahoo endpoint (with Treasury.gov and an optional Finnhub free key as fallback)?
- Which watchlist: top 20 by market cap, or also include oil, gold and the dollar?
- Should single-stock earnings markets appear (thin), or only the largest-company and macro pairings?
