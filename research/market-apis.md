# Prediction-market APIs: practical reference

Verified with live calls on **2026-11-04**. All of these are public, read-only and need **no auth**. Field names below are copied from real responses; sample responses are in `samples/`. Undocumented details drift, so re-check them with `curl` before relying on them.

## Polymarket

There are three hosts. You'll mostly use Gamma.

| Host | What it's for |
| --- | --- |
| `https://gamma-api.polymarket.com` | Catalog: events, markets, tags, prices, volumes, built-in price changes. `cache-control: public, max-age=300`. |
| `https://clob.polymarket.com` | Order book and **price history** (`/prices-history`). |
| `https://data-api.polymarket.com` | Trades, holders and positions (whale tracking). Not explored yet. |

### Events vs. markets
- An **event** is a story: "Fed Decision in December?". It holds one or more **markets**, each a yes/no question: "Will the Fed increase rates by 25 bps…?"
- In multi-outcome events (one market per candidate or bracket), `groupItemTitle` names the outcome.

### Useful queries
```bash
# What's hot: events by 24h volume
curl 'https://gamma-api.polymarket.com/events?active=true&closed=false&order=volume24hr&ascending=false&limit=100'
# Markets by 24h volume (each has oneDayPriceChange: the movers list for free)
curl 'https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=500'
# One event by slug, or by tag
curl 'https://gamma-api.polymarket.com/events?slug=which-party-will-win-the-senate-in-2026'
curl 'https://gamma-api.polymarket.com/events?tag_slug=midterms&active=true&closed=false&limit=100&offset=0'
# Price history for one outcome token (clobTokenIds[0] = YES). interval: 1h,6h,1d,1w,max; fidelity in minutes
curl 'https://clob.polymarket.com/prices-history?market=<clobTokenId>&interval=1d&fidelity=60'
#   → {"history":[{"t":1793721621,"p":0.705}, ...]}
```

### Market fields that matter
- **Price:**
  - `outcomePrices`: a **JSON string**, e.g. `"[\"0.83\", \"0.17\"]"`. Index 0 is YES. Parse it twice.
  - `outcomes`: also a JSON string.
  - `lastTradePrice`, `bestBid`, `bestAsk`, `spread`.
- **Movement:** `oneDayPriceChange`, `oneWeekPriceChange`, `oneMonthPriceChange`, `oneYearPriceChange`. These are absolute probability deltas, e.g. `0.64` = +64 points.
- **Size and attention:** `volume24hr`, `volume1wk`, `volume`, `liquidityNum`, `competitive`.
- **Identity:** `question`, `slug`, `groupItemTitle`, `description` (resolution rules), `endDate`, `image`/`icon`, `clobTokenIds` (a JSON string), `conditionId`.
- **Status:** `active`, `closed`, `archived`, `acceptingOrders`, `restricted`.
- **Events** carry `tags[]` with `label`/`slug`. Today's common labels: Politics, Geopolitics, Iran, Trump, Fed, Oil, Culture, Elections, plus lots of Sports/Esports/Crypto noise.

## Kalshi

Base URL: `https://api.elections.kalshi.com/trade-api/v2`. Despite the name, it covers **all** Kalshi markets, not just elections.

### Hierarchy
- A **series** is a recurring template, like "Trump approval up or down this week".
- An **event** is one instance of it.
- A **market** is one yes/no contract, often one strike or bracket.

### Useful queries
```bash
curl "$K/series?limit=1000"                         # ~15,700 series; fields: ticker,title,category,frequency,tags
curl "$K/events?status=open&limit=200&cursor=..."   # fields: event_ticker, series_ticker, title, sub_title, category, strike_period
curl "$K/markets?status=open&limit=1000&cursor=..." # paginate with cursor
curl "$K/markets?event_ticker=CONTROLH-2026"
curl "$K/markets?tickers=A,B,C"                     # batch by ticker
```

### Market fields that matter
- **Prices are dollar strings in 0–1** (e.g. `"0.83"`), in fields ending `_dollars`:
  - `last_price_dollars`, `previous_price_dollars`
  - `yes_bid_dollars` / `yes_ask_dollars`, `no_bid_dollars` / `no_ask_dollars`
  - `previous_yes_bid_dollars` / `previous_yes_ask_dollars`
- Movement = `last_price` − `previous_price`. The "previous" price is roughly the price a day earlier; verify that before relying on it.
- **Size:** `volume_24h_fp`, `volume_fp`, `open_interest_fp`, `notional_value_dollars`.
- **Text:** `title`, `yes_sub_title`, `no_sub_title`, `rules_primary`, `rules_secondary`.
- **Time and status:** `close_time`, `expected_expiration_time`, `status`, `result`.

### Series categories (2026-11-04 count)
| Category | Series |
| --- | --- |
| Sports | 4,086 |
| Entertainment | 2,600 |
| Elections | 2,424 |
| Politics | 2,305 |
| Financials | 1,127 |
| Economics | 866 |
| Climate and Weather | 501 |
| Mentions | 465 |
| Science and Technology | 388 |
| Crypto | 294 |
| Companies | 192 |
| World | 137 |
| Commodities | 108 |
| Health | 94 |
| Social | 48 |
| Transportation | 34 |

### Recurrence (`frequency`)
| Frequency | Series |
| --- | --- |
| one_off | 6,486 |
| custom | 6,252 |
| annual | 1,602 |
| monthly | 490 |
| daily | 367 |
| weekly | 355 |
| hourly | 80 |
| fifteen_min | 38 |

The ~1,330 hourly, daily, weekly and monthly series are in `samples/kalshi-recurring-series-2026-11-04.json`. They're the always-on content supply.

## Other sources worth knowing (not yet verified for PNN)
- **PredictIt:** `https://www.predictit.org/api/marketdata/all/`, the classic public JSON.
- **Manifold:** `https://api.manifold.markets/v0/markets`. Play money, but a very broad and fast range of topics.
- **Metaculus:** a forecasting platform, not a market, with a public API.
- **Election Betting Odds:** aggregates Betfair, Smarkets, PredictIt, Polymarket and Kalshi.
- **Headlines that explain "why it moved":** Google News RSS (`https://news.google.com/rss/search?q=...`) plus network RSS feeds. election_night's `server/sources/news.mjs` already does this.

## Politeness and terms
- Poll centrally (one server) and fan out to browsers over SSE. Never let browsers hit the exchanges directly.
- Gamma caches for 300s, so polling more often than every ~60s gains little. Use a slower full catalog sweep (5–15 min) plus faster polls on the ~100 "hot" markets.
- Back off on 429s and errors.
- Read each exchange's API and data terms before any **public** or commercial use.
