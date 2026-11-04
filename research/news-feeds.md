# Breaking-news feeds and headline-to-market matching

Verified 2026-11-04 (~17:20 UTC). Every URL below was fetched with `curl -L -A "PNN/0.1 (local news display)"`. "Newest" is the age of the newest item at fetch time. Treat as a snapshot; re-`curl` before relying on anything. Terms of use were not read line by line for every site; the general position is that headline + link display with attribution is normal RSS use, but most publishers' ToS forbid republishing full text. PNN should show headline, outlet and time only, and link nothing commercial.

## 1. Verified working (fresh items, timestamps)

Format is RSS 2.0 unless noted. All have pubDate. "Desc" = has a description/summary. Cond = server sent ETag (E) and/or Last-Modified (LM); I only proved a 304 for Al Jazeera (LM). Guardian returned 200 on an ETag replay (weak ETag), so don't count on 304s; just poll politely.

### US politics
| Source | URL | Items | Newest | Desc | Cond |
|---|---|---|---|---|---|
| NYT Politics | https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml | 37 | 1m | y | - |
| NPR Politics | https://feeds.npr.org/1014/rss.xml | 10 | 1m | y | - |
| CBS Politics | https://www.cbsnews.com/latest/rss/politics | 30 | 1m | y | LM |
| NBC Politics | https://feeds.nbcnews.com/nbcnews/public/politics | 25 | 7m | y | - |
| CNBC Politics | https://www.cnbc.com/id/10000113/device/rss/rss.html | 30 | 4m | y | - |
| The Hill | https://thehill.com/feed/ | 100 | 6m | y | E,LM |
| WSJ Politics | https://feeds.content.dowjones.io/public/rss/socialpoliticsfeed | 21 | 3m | y | E |
| Bloomberg Politics | https://feeds.bloomberg.com/politics/news.rss | 20 | 1m | y | E |
| Fox Politics | https://moxie.foxnews.com/google-publisher/politics.xml | 25 | 74m | y | E |
| Politico | https://rss.politico.com/politics-news.xml | 30 | 12h (slow) | y | LM |
| Axios | https://api.axios.com/feed/ | 100 | 13m | y | LM |
| White House news | https://www.whitehouse.gov/news/feed/ | 30 | 19h | y | E,LM |
| BBC US & Canada | https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml | 20 | 0m | y | - |

(`whitehouse.gov/feed/` is 404; use `/news/feed/`. Slow but official: executive orders, proclamations, bill signings.)

### World
| Source | URL | Items | Newest | Notes |
|---|---|---|---|---|
| BBC World | https://feeds.bbci.co.uk/news/world/rss.xml | 23 | 0m | cache-control max-age=4s; very live |
| BBC Top | https://feeds.bbci.co.uk/news/rss.xml | 32 | 0m | |
| NYT World / Home | .../nyt/World.xml, .../nyt/HomePage.xml | 54 / 14 | 2m / 1m | |
| NPR World | https://feeds.npr.org/1004/rss.xml | 10 | 8m | |
| Guardian World / US | https://www.theguardian.com/world/rss, /us-news/rss | 45 / 33 | 8m / 14m | E |
| Al Jazeera | https://www.aljazeera.com/xml/rss/all.xml | 25 | 5m | E,LM; 304 verified |
| WSJ World | https://feeds.content.dowjones.io/public/rss/RSSWorldNews | 72 | 2m | E |
| DW | https://rss.dw.com/rdf/rss-en-all | 124 | 1m | RDF/RSS 1.0 (`dc:date`) |
| Sky News | https://feeds.skynews.com/feeds/rss/world.xml | 9 | 61m | E |
| Euronews | https://www.euronews.com/rss?format=mrss | 50 | 8m | E,LM |
| ABC News | https://abcnews.go.com/abcnews/topstories | 25 | 7m | |
| CBS | https://www.cbsnews.com/latest/rss/main | 30 | 1m | LM |
| NBC | https://feeds.nbcnews.com/nbcnews/public/news | 25 | 7m | |
| Fox latest | https://moxie.foxnews.com/google-publisher/latest.xml | 25 | 74m | E |
| Yahoo News | https://news.yahoo.com/rss/ | 14 | 9m | CDATA titles; redirects to yahoo.com/news |
| Google News Top / World / Nation | https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en ; .../headlines/section/topic/WORLD\|NATION?... | 38-70 | 0-2m | aggregated, titles end with " - Outlet"; link is a redirect (news.google.com/rss/articles/...) |

### Business / economy / markets
| Source | URL | Items | Newest | Notes |
|---|---|---|---|---|
| Bloomberg Markets | https://feeds.bloomberg.com/markets/news.rss | 20 | 1m | E; headline + short desc; free, no UA trouble |
| Bloomberg Tech | https://feeds.bloomberg.com/technology/news.rss | 20 | 2m | E |
| MarketWatch realtime | https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines | 10 | 1m | E; fast |
| MarketWatch top | https://feeds.content.dowjones.io/public/rss/mw_topstories | 10 | 2m | E |
| WSJ Markets / US Business | .../RSSMarketsMain, .../WSJcomUSBusiness | 61 / 85 | 2m / 1m | E |
| CNBC Top / Economy / Finance / Markets | https://www.cnbc.com/id/{100003114,20910258,10000664,15839069}/device/rss/rss.html | 30 each | 3-34m | |
| FT home | https://www.ft.com/rss/home | 13 | 10m | E; headlines only, paywalled links |
| NYT Business | .../nyt/Business.xml | 50 | 1m | |
| NPR Business | https://feeds.npr.org/1006/rss.xml | 10 | 7m | |
| BBC Business | https://feeds.bbci.co.uk/news/business/rss.xml | 45 | 0m | |
| Guardian Business | https://www.theguardian.com/business/rss | 20 | 9m | E |
| CBS MoneyWatch | https://www.cbsnews.com/latest/rss/moneywatch | 30 | 2m | |
| Google News Business | .../topic/BUSINESS?... | 61 | 2m | |
| **Federal Reserve** press (all) | https://www.federalreserve.gov/feeds/press_all.xml | 20 | FOMC statement dated Oct 29 | E,LM; pubDate in CDATA; BOM at start. Official, high signal |
| Fed monetary policy | https://www.federalreserve.gov/feeds/press_monetary.xml | 15 | | E,LM |
| **BEA** | https://apps.bea.gov/rss/rss.xml (same as www.bea.gov/rss/rss.xml) | 49 | 4h | E,LM; GDP, PCE, trade releases |
| SEC press releases | https://www.sec.gov/news/pressreleases.rss | 25 | 56m | E,LM; SEC wants a UA with contact info for heavy use, so poll rarely |

### Tech / AI
| Source | URL | Items | Newest | Notes |
|---|---|---|---|---|
| TechCrunch | https://techcrunch.com/feed/ | 20 | 4m | E,LM |
| The Verge | https://www.theverge.com/rss/index.xml | 10 | 8m | Atom, E |
| Ars Technica | https://feeds.arstechnica.com/arstechnica/index | 20 | 75m | LM |
| Hacker News (hnrss) | https://hnrss.org/frontpage | 20 | 10m | third-party; LM; okay, but a hobby service |
| Hacker News Firebase | https://hacker-news.firebaseio.com/v0/topstories.json then /v0/item/{id}.json | 500 ids | live | official, no key, no stated limit; needs 1 call per item (use top 30 only). Algolia `hn.algolia.com/api/v1/search_by_date` returned 400 with my params, untested otherwise |
| NYT Tech / NPR Tech / BBC Tech / Guardian Tech | .../Technology.xml, feeds.npr.org/1019, bbci tech, theguardian.com/technology/rss | 15-36 | 3-9m | |
| Google News Tech | .../topic/TECHNOLOGY?... | 60 | 1m | |

### Science / space / health
| Source | URL | Items | Newest | Notes |
|---|---|---|---|---|
| NASA | https://www.nasa.gov/feed/ (= /news-release/feed/) | 10 | 31m | E,LM |
| SpaceNews | https://spacenews.com/feed/ | 13 | 24h | E,LM |
| Space.com | https://www.space.com/feeds/all | 50 | 24m | |
| ScienceDaily | https://www.sciencedaily.com/rss/top.xml | 60 | 4h | slow (4.9s response) |
| NYT Science / BBC Sci / Guardian Sci / Google News Science | .../Science.xml, bbci science_and_environment, theguardian.com/science/rss | 27-60 | 0-6m | |
| NYT Health / NPR Health / BBC Health / Google News Health | .../Health.xml, feeds.npr.org/1128, bbci health | 10-57 | 0-6m | |
| STAT News | https://www.statnews.com/feed/ | 20 | 14m | E,LM |
| FDA press releases | https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml | 20 | 51h | E,LM; slow but official |
| CDC | https://tools.cdc.gov/api/v2/resources/media/132608.rss | 1844 | 43 days | stale/huge; skip |

### Culture / entertainment
| Source | URL | Items | Newest | Notes |
|---|---|---|---|---|
| Variety | https://variety.com/feed/ | 10 | 2m | E,LM |
| Hollywood Reporter | https://www.hollywoodreporter.com/feed/ | 10 | 24m | E,LM |
| Deadline | https://deadline.com/feed/ | 12 | 12m | E,LM |
| Billboard | https://www.billboard.com/feed/ | 10 | 12m | E,LM |
| NYT Arts / BBC Ent / Guardian Culture / Google News Ent | .../Arts.xml, bbci entertainment_and_arts, theguardian.com/culture/rss | 20-70 | 0-1m | |

### Weather / natural events (JSON/Atom, official, free)
| Source | URL | Notes |
|---|---|---|
| NWS alerts (JSON) | https://api.weather.gov/alerts/active?severity=Extreme,Severe&status=actual | 47 alerts now, GeoJSON, `updated` field, `properties.event/headline/sent/areaDesc`, ETag. Requires a UA (we send one; NWS asks for contact info but generic worked). Filter to event types like Hurricane/Tornado Emergency/Blizzard/Extreme Wind; most Flood/Wind warnings are local noise |
| NWS alerts (Atom) | https://api.weather.gov/alerts/active.atom | 352 entries, 5m fresh, 1.4 MB, avoid |
| USGS M4.5+ day | https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson | 6 quakes, newest 9h ago, LM. `significant_day` returned empty today. Fine for "major quake" only; sensitive-content policy applies if casualties are involved |

### Social
| Source | URL | Notes |
|---|---|---|
| Bluesky AP profile RSS | https://bsky.app/profile/apnews.com/rss | works, 30 items, 9m, RSS with pubDate; this is the only working AP route. Works for any handle (try reuters.com, nytimes.com, wsj.com, cnn.com, axios.com) |
| Mastodon hashtag | https://mastodon.social/tags/breakingnews.rss | 20 items, 12m; low signal and unmoderated, skip |
| Reddit r/worldnews RSS | https://www.reddit.com/r/worldnews/.rss | 25 items, 0m, works with our UA; `.json` is 403 and old.reddit 302. Reddit's API terms restrict commercial use and require registration; rumors and war content, so treat as optional/low-trust |

## 2. Dead, blocked or unusable

| Source | Result |
|---|---|
| AP (apnews.com/hub/ap-top-news.rss, /rss) | 403 Cloudflare challenge. No free AP RSS. Use Bluesky `@apnews.com` RSS or Google News `q=site:apnews.com` |
| feedx.net AP mirror | 200 but newest item is 56 days old, dead |
| Reuters (feeds.reuters.com) | DNS dead (curl 000). reutersagency.com 404 page. No free Reuters. Use Bluesky or Google News `site:reuters.com` |
| CNN rss.cnn.com | 200 but newest item ~2.2 years old (frozen). Dead; use Google News `site:cnn.com` if wanted |
| Washington Post feeds.washingtonpost.com | 502 Bad Gateway on both tries, dead/unreliable |
| BLS (bls_latest.rss, cpi.rss, empsit.rss) | 403 for generic UA and for browser-ish UA. BLS requires a registered/contact UA, which we won't do. Substitute: BEA, Fed, and calendar-driven logic; or Google News for "CPI report" |
| Politico politicopicks.xml | 403 Cloudflare. `politics-news.xml` works but is slow (12h old) |
| Treasury press release RSS | 404 |
| SCOTUS supremecourt.gov/rss/slipopinion.xml | 200 but items dated 2003-2005 (it's a sample XSLT page). Dead |
| Bing News RSS | `format=rss` returns 1 stale result (60,000 min old) or an HTML page; unusable |
| Yahoo Finance rssindex | 404 |
| Guardian Content API | `api-key=test` returns 401. Needs free key (register at open-platform.theguardian.com; 5000 req/day, 12/s non-commercial). Unnecessary since Guardian RSS works |
| GDELT DOC 2.0 | Works but returns 429 "one every 5 seconds"; with a 10s wait it answered 429 once too (first call). Rate limit is strict; see below |
| CDC RSS | stale (see above) |

### GDELT detail
`https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=artlist&format=json&timespan=1h&sort=datedesc` is free and needs no key, but it is limited to 1 request per 5 seconds. Both of my calls (one after a 10.8 s wait, one after 6 s) came back 429 "Please limit requests to one every 5 seconds", so I never got an article list and could not verify freshness. Treat as unverified and optional; at most use it as a slow cross-check of how many outlets cover a topic (`mode=timelinevol`), one call per 10+ s.

## 3. Recommended starter set (22 feeds)

Poll interval is per feed, with random jitter (+/-20%) and a staggered start spread across the interval. Send `If-None-Match`/`If-Modified-Since` whenever a validator was returned; back off x2 up to 10 min on 429/5xx. Most of these publishers set `Cache-Control: max-age` of 4 s (BBC) to 300 s (NYT), so 60-120 s is polite.

| # | Feed | Category | Interval |
|---|---|---|---|
| 1 | BBC World | world | 60s |
| 2 | BBC Top Stories | general | 60s |
| 3 | NYT HomePage | general | 90s |
| 4 | NYT Politics | politics | 90s |
| 5 | NPR News (1001) | general/politics | 90s |
| 6 | CBS main | general | 90s |
| 7 | Al Jazeera all | world | 90s |
| 8 | Guardian World | world | 120s |
| 9 | Google News Top (US) | general, cross-check | 120s |
| 10 | The Hill | politics | 120s |
| 11 | Axios | politics/business/tech | 120s |
| 12 | MarketWatch realtime | markets | 60s |
| 13 | Bloomberg Markets | markets | 90s |
| 14 | WSJ Markets | markets | 120s |
| 15 | CNBC Top (and Economy) | business | 120s |
| 16 | **Federal Reserve press_all** | official | 120s (60s on FOMC days) |
| 17 | **BEA** | official | 300s (60s on release mornings 8:30 ET) |
| 18 | TechCrunch | tech/AI | 180s |
| 19 | The Verge | tech/AI | 180s |
| 20 | NASA + Space.com | space | 600s |
| 21 | NYT Science + STAT News | science/health | 600s |
| 22 | Variety + Deadline | entertainment | 300s |
| 23 | NWS alerts (Extreme/Severe) | weather | 120s |
| 24 | Bluesky `@apnews.com` RSS | AP substitute | 120s |
| opt | White House news, SEC press, Hacker News | official/tech | 600s |

That is about 27 HTTP calls/2 min. Total bandwidth is small (most feeds are 10-200 KB), but cap Axios (1 MB) and NWS (300 KB) at 120 s with conditional GET.

## 4. Detecting "breaking"

Score each story cluster and fire when the score clears a threshold. No single signal is reliable.

1. **Normalize** each item: lowercase title, strip " - Outlet" suffix (Google News), strip punctuation and stop words, keep numerals and proper nouns.
2. **Cluster** by title similarity (token Jaccard >= 0.5, or TF-IDF cosine >= 0.6 on title+description) within a sliding window of 45 min. A cluster is a story.
3. **Corroboration:** number of distinct outlets in the cluster. >= 2 distinct outlets within 15 min is the main trigger; >= 3 is strong. Weight independent wires (BBC, NYT, WSJ, Bloomberg, NPR, Al Jazeera) over syndicators (Yahoo, Google News, which only re-list other outlets, so don't count them as independent).
4. **Velocity:** items per minute joining the cluster.
5. **Markers:** title or description starting with "BREAKING", "JUST IN", "Live updates", "Developing", "Alert", "Flash". One of these from a wire plus 1 other outlet is enough to fire.
6. **Official source = high signal by itself:** Fed press release (FOMC statement, rate decision), BEA release (GDP, PCE), SEC (enforcement), White House proclamations/signings, NWS Extreme alerts. These skip corroboration but still need market matching to be shown.
7. **Surprise:** scheduled releases (CPI, jobs, FOMC, earnings) are not breaking, but they are the most market-relevant news; keep an economic calendar in config and treat "release time +/- 5 min" as hot.
8. **Suppress:** sports, celebrity gossip, crime, and war/death content per the sensitive policy (keyword filter on title before matching), anything in a cluster already shown in the last 6 hours unless the score doubles.

## 5. Matching a headline to prediction markets

### Polymarket: public search exists and works (no key)
`GET https://gamma-api.polymarket.com/public-search?q=<text>&limit_per_type=5&events_status=active`

- Response: `{events:[...], tags:[...], profiles:[...], hasMore, pagination:{hasMore,totalResults}}`. Each event has `id, slug, title, active, closed, endDate, markets[]` (the market array carries outcome prices and volume).
- Handy params that worked: `limit_per_type`, `events_status=active`, `search_tags=false`, `search_profiles=false`. `keep_closed_markets=0` is accepted. Set `search_tags=false&search_profiles=false` to cut payload.
- Latency about 0.35-0.5 s. Still returns some closed events (e.g. old "next Fed rate change"), so filter `closed=false && active=true` and `endDate >= now` client-side, then rank by 24h volume.
- Not search: `/markets?search=fed` and `/events?q=fed` / `/events?title=fed` both **ignore the parameter** and return unrelated old events. Don't use them.
- Quality check: "federal reserve" returned Warsh Fed-chair confirmation events; "Nvidia earnings" returned "Will Nvidia (NVDA) beat quarterly earnings?" (ends 2026-11-17); "fed rate cut" returned the Fed rate cut and "How many Fed rate cuts in 2026?" events. Keyword queries of 2-4 words give good results; full headlines are noisier.

### Kalshi: official API has no search; an undocumented one does
- `GET /trade-api/v2/events?search=` and `?title=` are **ignored** (returns the default list). `/trade-api/v2/search` and `/trade-api/v2/search/series` are 404.
- The site's own search endpoint works with no auth: `GET https://api.elections.kalshi.com/v1/search/series?query=<text>&status=open&page_size=5`. Returns `total_results_count`, `current_page[]`, `next_cursor`, `suggested_pages`. Each hit has `event_ticker, event_title, series_ticker, category, recent_volume, total_volume, search_score, markets[]` (with `yes_bid` in cents). "fed" gave 217 results with `KXFEDDECISION` first; "Nvidia earnings" gave earnings-mention and headcount markets (note: many are novelty "what will X say" markets, which our filters should drop).
- Caveat: it is an undocumented internal path (`v1`), so it may change or be rate limited. Wrap it with a fallback to the documented route: cache the full open series/events list (`/trade-api/v2/series?category=...`, `/events?status=open`) and match locally.

### Recommended approach (hybrid)
1. **Entity and keyword extraction** from the story cluster title: proper-noun phrases (people, orgs, countries, tickers), plus a topic dictionary (Fed/FOMC/rates, CPI/inflation, jobs, GDP, tariffs, shutdown, Supreme Court, Ukraine, Iran, China, Nvidia/OpenAI/etc.). Do this with regex + a small alias table first; an LLM call (Claude Haiku-class) is an optional step to emit 1-3 search queries and a category.
2. **Local index first:** PNN already sweeps Polymarket and Kalshi into one normalized market list. Match entities against market titles/event titles in memory (BM25 or token overlap). It's free, instant, and already filtered by our noise rules.
3. **Live search as fallback** when the local index has no hit with enough volume: call Polymarket `public-search` and Kalshi `v1/search/series` with the 1-3 queries, normalize results, apply the noise filter, and add them to the index.
4. **Score** match = entity overlap + recency of market `endDate` (soonest relevant) + 24h volume; discard thin markets (flag as thin if volume is low) and require at least one named entity or topic-dictionary hit, to avoid junk matches like "Fed" matching "federation".
5. **Display** with the editorial rules: "Bettors give X a 72% chance", source, updated time, 24h volume.
6. Cache search results 5 minutes (Gamma caches 300s anyway). Both endpoints answer in under 0.5 s, so on-demand lookup at the moment of a break is fine.

## 6. Caveats
- Timestamps use the publisher's clock. Items dated in the future or older than 24h should be dropped.
- Google News links are redirects and not the outlet's URL; use the title text and the `<source>` tag for the outlet name.
- Several outlets (CNBC, Fox, NYT) repeat the same stories across their section feeds, so de-dup by link/GUID before clustering.
- Most of the 200-OK feeds have no ETag/Last-Modified (BBC, NYT, NPR, CNBC, NBC); there we just poll at >= 60 s.
- Terms: no feed here is licensed for republishing full articles. PNN should show only headline, outlet and time as an attributed pointer, and shouldn't scrape article pages. Reddit and GDELT have explicit rate or usage limits, Bloomberg, WSJ, FT and NYT feeds are free to read but their ToS reserve rights. Stop and re-check if any publisher sends a cease or 403.
