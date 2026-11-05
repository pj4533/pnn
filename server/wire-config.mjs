// PNN news wire config: feeds, poll intervals, breaking-detection thresholds and headline filters.
// Used by server/sources/wire.mjs. Feed list and intervals follow research/news-feeds.md §3 (verified 2026-11-04).
//
// Feed fields:
//   id        unique feed id (also the item `source`)
//   outlet    display name; items from feeds with the same outlet are ONE outlet for corroboration
//   url, kind 'rss' (RSS 2.0 / RDF / Atom, auto-detected) | 'nws' (api.weather.gov GeoJSON)
//   category  PNN-ish desk hint: general | politics | world | economy | markets | tech | science | health | culture | courts | weather | sports | games
//   skipFilters  string[] of filter group names (below) this feed bypasses; sports and gaming feeds skip 'sports'
//                (sensitive, crime, gossip and noise still apply)
//   everySec  poll interval (jittered +/- jitter, first poll staggered across the interval)
//   aggregator true: re-lists other outlets (Google News). Never counts as independent corroboration
//   official  true: a government source. Items matching officialPattern fire on their own (still need a market match)
//   officialPattern RegExp; omitted = every item is high signal

const re = (s) => new RegExp(s, 'i');
// A fluff pattern fires only when the title has none of these news verbs ("Netflix announces podcast", "X wins Emmy for ... interview").
const FLUFF_OK = 'announces?|announced|wins?|won|named|names|sets?|cancel(s|led)|delays?|delayed|renews?|confirms?|launch(es|ed)?|casts?|signs?|picks? up|orders?';
const fluffRe = (p) => new RegExp(`^(?!.*\\b(?:${FLUFF_OK})\\b)(?:.*?)(?:${p})`, 'i');

export default {
  userAgent: 'PNN/0.1 (Pre News Network; local broadcast display)',
  jitter: 0.2,
  timeoutMs: 15_000,
  maxBodyBytes: 3_000_000,
  backoff: { baseSec: 60, maxSec: 600 },     // per host, x2 per consecutive 429/5xx/network failure
  ring: { maxItems: 1500, maxAgeHours: 6 },
  // Older items are dropped at parse time. 72h (was 24h; news-gate option 4). Items older than ring.maxAgeHours never cluster
  // (breaking needs a fresh item): wire.mjs keeps them in a backlog that feeds wire.items() and so the 72h news archive.
  maxItemAgeHours: 72,
  maxFutureMin: 10,                            // items dated further in the future are dropped

  // NEWS MEETS MARKETS integration (server/newsroom.mjs)
  flash: {
    boostMin: 10,          // a flash-matched story leads the board for this long ("worked in")
    maxFlashes: 10,        // state.flashes cap
    wireItems: 30,         // state.wire: newest headlines for the crawl
    crawlMaxAgeHours: 3,   // older headlines never reach the crawl
    matchTimeoutMs: 30_000,
    minScore: 11,          // best match score needed to air (match.mjs's own floor is 9; live "'Beef' creator sets Netflix projects" -> an Oscars market at 8.8)
    otherEventRel: 0.8,    // a row from another event than the lead's needs >= this share of the lead's score
    simFirstSec: 40,       // SIM: first canned breaking cluster
    simEverySec: 180,      // SIM: then one every N seconds
  },

  breaking: {
    clusterWindowMin: 45,      // an item joins a cluster only if within this window of the cluster's items
    // Similarity of an item to a cluster's core tokens, IDF-weighted over the ring (see wire.mjs similarity()).
    // Plain Jaccard >= 0.5 almost never matched real cross-outlet headlines in testing (2026-11-04), and plain 0.3
    // glued unrelated "Democrats sweep midterms" stories together, hence the weighting plus a rare-token requirement.
    jaccard: 0.3,              // weighted Jaccard to join a cluster (also used for near-duplicate refire suppression)
    overlap: 0.3,              // ...or weighted overlap coefficient >= this with >= overlapMinRare shared rare tokens
    overlapMinShared: 2,
    overlapMinRare: 2,
    corroborateMin: 15,        // >= 2 independent outlets within this many minutes fires
    strongOutlets: 3,          // >= this many independent outlets inside the cluster window also fires
    markerPlusOther: true,     // BREAKING / JUST IN marker + 1 other outlet fires
    freshMin: 40,              // only fire when the newest item in the cluster is at most this old
    refireHours: 6,            // never re-fire the same (or a near-duplicate) cluster within this many hours
  },

  feeds: [
    // general / world
    { id: 'bbc-world', outlet: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'world', everySec: 60 },
    { id: 'bbc-top', outlet: 'BBC', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: 'general', everySec: 60 },
    { id: 'bbc-us', outlet: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', category: 'politics', everySec: 120 },
    { id: 'nyt-home', outlet: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', category: 'general', everySec: 90 },
    { id: 'nyt-politics', outlet: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', category: 'politics', everySec: 90 },
    { id: 'npr-news', outlet: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', category: 'general', everySec: 90 },
    { id: 'cbs-main', outlet: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/main', category: 'general', everySec: 90 },
    { id: 'aljazeera', outlet: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world', everySec: 90 },
    { id: 'guardian-world', outlet: 'The Guardian', url: 'https://www.theguardian.com/world/rss', category: 'world', everySec: 120 },
    { id: 'google-top', outlet: 'Google News', url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', category: 'general', everySec: 120, aggregator: true },
    { id: 'ap-bsky', outlet: 'AP', url: 'https://bsky.app/profile/apnews.com/rss', category: 'general', everySec: 120 },
    // politics
    { id: 'thehill', outlet: 'The Hill', url: 'https://thehill.com/feed/', category: 'politics', everySec: 120 },
    { id: 'axios', outlet: 'Axios', url: 'https://api.axios.com/feed/', category: 'politics', everySec: 120 },
    { id: 'bloomberg-politics', outlet: 'Bloomberg', url: 'https://feeds.bloomberg.com/politics/news.rss', category: 'politics', everySec: 120 },
    // markets / economy
    // mw_realtimeheadlines (research §3 #12) is frozen at 2025 items as of 2026-11-04; top stories is live.
    { id: 'mw-top', outlet: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'markets', everySec: 90 },
    { id: 'bloomberg-markets', outlet: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss', category: 'markets', everySec: 90 },
    { id: 'wsj-markets', outlet: 'The Wall Street Journal', url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain', category: 'markets', everySec: 120 },
    { id: 'cnbc-top', outlet: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'economy', everySec: 120 },
    { id: 'cnbc-economy', outlet: 'CNBC', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', category: 'economy', everySec: 120 },
    // official
    { id: 'fed', outlet: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: 'economy', everySec: 120, official: true,
      officialPattern: re('\\b(fomc|federal open market|monetary policy|federal funds|discount rate|statement|minutes|chair)\\b') },
    { id: 'bea', outlet: 'BEA', url: 'https://apps.bea.gov/rss/rss.xml', category: 'economy', everySec: 300, official: true,
      officialPattern: re('\\b(gdp|gross domestic product|personal income|pce|outlays|trade in goods|international trade|current account|corporate profits)\\b') },
    { id: 'whitehouse', outlet: 'White House', url: 'https://www.whitehouse.gov/news/feed/', category: 'politics', everySec: 600, official: true,
      officialPattern: re('\\b(executive order|proclamation|signs?|signed|nominat\\w*|veto\\w*|pardon\\w*)\\b') },
    { id: 'sec', outlet: 'SEC', url: 'https://www.sec.gov/news/pressreleases.rss', category: 'economy', everySec: 600, official: true,
      officialPattern: re('\\b(approv\\w*|etf|chair\\w*|adopts?|final rule)\\b') },
    // tech / science / health / culture
    { id: 'techcrunch', outlet: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'tech', everySec: 180 },
    { id: 'verge', outlet: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'tech', everySec: 180 },
    { id: 'nasa', outlet: 'NASA', url: 'https://www.nasa.gov/feed/', category: 'science', everySec: 600 },
    { id: 'spacecom', outlet: 'Space.com', url: 'https://www.space.com/feeds/all', category: 'science', everySec: 600 },
    { id: 'nyt-science', outlet: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', category: 'science', everySec: 600 },
    { id: 'stat', outlet: 'STAT', url: 'https://www.statnews.com/feed/', category: 'health', everySec: 600 },
    { id: 'variety', outlet: 'Variety', url: 'https://variety.com/feed/', category: 'culture', everySec: 300 },
    { id: 'deadline', outlet: 'Deadline', url: 'https://deadline.com/feed/', category: 'culture', everySec: 300 },
    // sports (2026-11-05 news-driven PNN: sports headlines drive futures/awards/coach markets; verified by curl).
    // They skip the blanket 'sports' filter; sensitive/crime/gossip/noise still apply. Only the matcher decides whether
    // a headline ever reaches air (it needs a kept sports market).
    { id: 'espn-top', outlet: 'ESPN', url: 'https://www.espn.com/espn/rss/news', category: 'sports', everySec: 120, skipFilters: ['sports'] },
    { id: 'espn-nfl', outlet: 'ESPN', url: 'https://www.espn.com/espn/rss/nfl/news', category: 'sports', everySec: 180, skipFilters: ['sports'] },
    { id: 'bbc-sport', outlet: 'BBC', url: 'https://feeds.bbci.co.uk/sport/rss.xml', category: 'sports', everySec: 120, skipFilters: ['sports'] },
    { id: 'bbc-football', outlet: 'BBC', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', category: 'sports', everySec: 180, skipFilters: ['sports'] },
    { id: 'cbs-sports', outlet: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/', category: 'sports', everySec: 180, skipFilters: ['sports'] },
    { id: 'yahoo-sports', outlet: 'Yahoo Sports', url: 'https://sports.yahoo.com/rss/', category: 'sports', everySec: 120, skipFilters: ['sports'] },
    { id: 'guardian-sport', outlet: 'The Guardian', url: 'https://www.theguardian.com/sport/rss', category: 'sports', everySec: 180, skipFilters: ['sports'] },
    { id: 'sky-sports', outlet: 'Sky Sports', url: 'https://www.skysports.com/rss/12040', category: 'sports', everySec: 180, skipFilters: ['sports'] },
    // video games and esports (300s+; pcgamer's feed is 1.6MB, so 600s). Dead/blocked: Kotaku (stale), Dot Esports (Cloudflare).
    { id: 'ign', outlet: 'IGN', url: 'https://www.ign.com/rss/v2/articles/feed', category: 'games', everySec: 300, skipFilters: ['sports'] },
    { id: 'gamespot', outlet: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/', category: 'games', everySec: 300, skipFilters: ['sports'] },
    { id: 'polygon', outlet: 'Polygon', url: 'https://www.polygon.com/feed/', category: 'games', everySec: 300, skipFilters: ['sports'] },
    { id: 'vgc', outlet: 'Video Games Chronicle', url: 'https://www.videogameschronicle.com/feed/', category: 'games', everySec: 300, skipFilters: ['sports'] },
    { id: 'pcgamer', outlet: 'PC Gamer', url: 'https://www.pcgamer.com/rss/', category: 'games', everySec: 600, skipFilters: ['sports'] },
    { id: 'hltv', outlet: 'HLTV', url: 'https://www.hltv.org/rss/news', category: 'games', everySec: 300, skipFilters: ['sports'] },
    // ---- added 2026-11-05 (news-gate option 2). Each one re-verified by curl that day: HTTP 200, parseable, dated, newest item < 7h old.
    // Politeness: every new feed is >= 180s, no host gets another feed under 180s. Dead/unusable, do NOT add: EW (403), Vulture (404),
    // Lawfare (403), VentureBeat (429), WaPo (502), Yahoo Finance (404), BLS (404), USA Today politics (0 items), CNN politics (stale),
    // Calculated Risk (stale), Politico Playbook (sparse). bea and sec above are stale today; left alone.
    // culture
    { id: 'thr', outlet: 'The Hollywood Reporter', url: 'https://www.hollywoodreporter.com/feed/', category: 'culture', everySec: 300 },
    { id: 'billboard', outlet: 'Billboard', url: 'https://www.billboard.com/feed/', category: 'culture', everySec: 300 },
    { id: 'indiewire', outlet: 'IndieWire', url: 'https://www.indiewire.com/feed/', category: 'culture', everySec: 300 },
    { id: 'rollingstone', outlet: 'Rolling Stone', url: 'https://www.rollingstone.com/feed/', category: 'culture', everySec: 300 },
    { id: 'variety-film', outlet: 'Variety', url: 'https://variety.com/v/film/feed/', category: 'culture', everySec: 300 },
    // tech / AI
    { id: 'verge-ai', outlet: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', category: 'tech', everySec: 300 },
    { id: 'ars', outlet: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'tech', everySec: 300 },
    { id: 'wired', outlet: 'Wired', url: 'https://www.wired.com/feed/rss', category: 'tech', everySec: 300 },
    { id: 'mit-tr', outlet: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', category: 'tech', everySec: 300 },
    { id: 'engadget', outlet: 'Engadget', url: 'https://www.engadget.com/rss.xml', category: 'tech', everySec: 300 },
    { id: 'theinformation', outlet: 'The Information', url: 'https://www.theinformation.com/feed', category: 'tech', everySec: 300 },
    // courts
    { id: 'scotusblog', outlet: 'SCOTUSblog', url: 'https://www.scotusblog.com/feed/', category: 'courts', everySec: 600 },
    { id: 'courthousenews', outlet: 'Courthouse News', url: 'https://www.courthousenews.com/feed/', category: 'courts', everySec: 600 },
    // politics
    { id: 'politico-politics', outlet: 'Politico', url: 'https://rss.politico.com/politics-news.xml', category: 'politics', everySec: 300 },
    { id: 'politico-congress', outlet: 'Politico', url: 'https://rss.politico.com/congress.xml', category: 'politics', everySec: 180 },
    { id: 'rollcall', outlet: 'Roll Call', url: 'https://rollcall.com/feed/', category: 'politics', everySec: 300 },
    { id: 'nbc-politics', outlet: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/politics', category: 'politics', everySec: 300 },
    { id: 'fox-politics', outlet: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/politics.xml', category: 'politics', everySec: 300 },
    { id: 'abc-politics', outlet: 'ABC News', url: 'https://abcnews.go.com/abcnews/politicsheadlines', category: 'politics', everySec: 300 },
    { id: 'npr-politics', outlet: 'NPR', url: 'https://feeds.npr.org/1014/rss.xml', category: 'politics', everySec: 300 },
    { id: 'semafor', outlet: 'Semafor', url: 'https://www.semafor.com/rss.xml', category: 'politics', everySec: 300 },
    // economy
    { id: 'nyt-business', outlet: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', category: 'economy', everySec: 300 },
    { id: 'fortune', outlet: 'Fortune', url: 'https://fortune.com/feed/', category: 'economy', everySec: 300 },
    { id: 'businessinsider', outlet: 'Business Insider', url: 'https://feeds.businessinsider.com/custom/all', category: 'economy', everySec: 300 },
    { id: 'ft', outlet: 'Financial Times', url: 'https://www.ft.com/rss/home', category: 'economy', everySec: 300 },
    { id: 'npr-econ', outlet: 'NPR', url: 'https://feeds.npr.org/1017/rss.xml', category: 'economy', everySec: 300 },
    { id: 'cnbc-world', outlet: 'CNBC', url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', category: 'economy', everySec: 300 },
    // science / space (thin categories; cheap to carry)
    { id: 'livescience', outlet: 'Live Science', url: 'https://www.livescience.com/feeds/all', category: 'science', everySec: 600 },
    { id: 'sciencedaily', outlet: 'ScienceDaily', url: 'https://www.sciencedaily.com/rss/top.xml', category: 'science', everySec: 600 },
    { id: 'physorg', outlet: 'Phys.org', url: 'https://phys.org/rss-feed/', category: 'science', everySec: 600 },
    { id: 'spacenews', outlet: 'SpaceNews', url: 'https://spacenews.com/feed/', category: 'science', everySec: 600 },
    { id: 'nasa-breaking', outlet: 'NASA', url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', category: 'science', everySec: 600 },
    // world / health
    { id: 'guardian-us', outlet: 'The Guardian', url: 'https://www.theguardian.com/us-news/rss', category: 'politics', everySec: 300 },
    { id: 'nyt-us', outlet: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml', category: 'politics', everySec: 300 },
    { id: 'nyt-world', outlet: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', category: 'world', everySec: 300 },
    { id: 'dw', outlet: 'DW', url: 'https://rss.dw.com/rdf/rss-en-all', category: 'world', everySec: 300 },
    { id: 'france24', outlet: 'France 24', url: 'https://www.france24.com/en/rss', category: 'world', everySec: 300 },
    { id: 'kff', outlet: 'KFF Health News', url: 'https://kffhealthnews.org/feed/', category: 'health', everySec: 600 },
    { id: 'nyt-health', outlet: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Health.xml', category: 'health', everySec: 600 },
    // weather (official; only Extreme alerts of these event types are high signal on their own)
    { id: 'nws', outlet: 'National Weather Service', url: 'https://api.weather.gov/alerts/active?severity=Extreme,Severe&status=actual', kind: 'nws',
      category: 'weather', everySec: 120, official: true },
  ],

  // NWS: only these event types become wire items (most Flood/Wind warnings are local noise).
  nwsEvents: re('^(hurricane (warning|watch)|tropical storm warning|storm surge warning|tornado emergency|extreme wind warning|blizzard warning|tsunami warning|ice storm warning)$'),

  // BREAKING / JUST IN markers (title or start of description).
  markers: re('^\\s*(breaking( news)?|just in|developing|live updates?|alert|flash)\\b|\\b(breaking|live updates?)\\s*[:|-]'),

  // Filter groups judged on the headline alone (the description of a podcast item or a review often says "interview" or "review").
  titleOnlyFilters: ['fluff', 'junk'],

  // Headline filters. Tested against title + description (except titleOnlyFilters).
  filters: {
    // Sensitive policy (DECISIONS D4): everything about war, violence or death is excluded.
    sensitive: [
      re('\\binva(de|des|ded|ding|sion|sions)\\b'), re('\\bair ?strikes?\\b'), re('\\bdrone (strike|attack)s?\\b'), re('\\bmilitary strikes?\\b'),
      re('(?<!meteor |asteroid |lightning |labor |labour |union |general |workers.? )\\bstrikes? (on|against|in|hit)\\b'),
      re('\\battack(s|ed|ing|er|ers)?\\b'), re('\\bcease-?fire\\b'), re('\\btruce\\b'), re('\\barmistice\\b'), re('\\bblockade\\b'),
      re('\\bmilitar(y|ily)\\b'), re('\\bmissiles?\\b'), re('\\btroops?\\b'), re('\\bsoldiers?\\b'), re('\\barmy\\b'), re('\\bnavy\\b'),
      re('\\bwar\\b(?! machine| chest)'), re('\\bwars\\b'), re('\\bwarfare\\b'), re('\\bwartime\\b'), re('\\bfrontline\\b'), re('\\bweapons?\\b'),
      re('\\bhostages?\\b'), re('\\bbomb(s|ing|ings|ed|er)?\\b'), re('\\bshell(ing|ed)\\b'), re('\\bexplosions?\\b'), re('\\bblast\\b'),
      re('\\bgunfire\\b'), re('\\bgunm(a|e)n\\b'), re('\\bshoot(ing|ings|er)\\b'), re('\\bshot\\b'), re('\\bstabb(ing|ed)\\b'),
      re('\\bregime (fall|falls|collapse|collapses|change)\\b'), re('\\bcoup\\b'), re('\\binsurgen'), re('\\bmilitia'), re('\\brebels?\\b'),
      re('\\bassassinat'), re('\\bkill(s|ed|ing|ings|er)?\\b'), re('\\bmurder'), re('\\bmanslaughter\\b'), re('\\bhomicide\\b'),
      re('\\bdies?\\b'), re('\\bdied\\b'), re('\\bdying\\b'), re('\\bdeaths?\\b'), re('\\bdead\\b'), re('\\bdeadly\\b'), re('\\bcasualt'), re('\\bfatal'),
      re('\\bobituar'), re('\\bfuneral\\b'), re('\\bsuicide\\b'), re('\\bbodies\\b'), re('\\bdeath toll\\b'), re('\\bwounded\\b'), re('\\binjured\\b'),
      re('\\bnuclear (weapon|bomb|strike|test|war|detonation|arsenal)s?\\b'), re('\\bnukes?\\b'),
      re('\\bterror(ism|ist|ists)?\\b'), re('\\bgenocide\\b'), re('\\bmassacre\\b'), re('\\batrocit'), re('\\bwar crimes?\\b'),
      re('\\bannex(es|ed|ation)?\\b'), re('\\boccup(y|ies|ied|ation)\\b'), re('\\barmed conflict\\b'), re('\\brecaptur'),
      re('\\b(gaza|hamas|hezbollah|houthis?|idf|west bank)\\b'),
      // parity with news.mjs SENSITIVE_TITLE (every attached headline must pass the D4 patterns), plus border-violence wording
      re('\\b(corpses?|beheaded|beheading|slain|slaying|shot dead)\\b'), re('\\b(border|cross-?border) (fire|clashes|skirmish\\w*|shelling)\\b'), re('\\bfirefight'),
    ],
    sports: [
      re('\\b(nfl|nba|wnba|mlb|nhl|mls|ncaa|ufc|wwe|pga|lpga|nascar|f1|formula 1|fifa|uefa|premier league|la liga|serie a|bundesliga|champions league|atp|wta|atp finals|grand prix|ryder cup|test match|six nations|davis cup|tour de france|djokovic|alcaraz|sinner|nadal|federer|lebron|mahomes|ohtani)\\b'),
      re('\\b(super bowl|world series|stanley cup|march madness|grand slam|wimbledon|us open tennis|olympics?|world cup)\\b'),
      re('\\b(quarterback|touchdown|playoffs?|halftime|head coach|coach|innings?|home run|hat-?trick|transfer window|draft pick|free agent|matchday)\\b'),
      re('\\b(linebacker|wide receiver|running back|tight end|cornerback|safety [A-Z]|pitcher|shortstop|goalkeeper|striker|point guard|power forward|offensive line|defensive end|kicker|punter|rookie|mvp|all-star|season-ending|injured reserve|trade deadline|preseason|postseason)\\b'),
      // team nicknames (NFL / NBA / MLB / NHL) — headlines like "Detroit Lions linebacker…"
      re('\\b(49ers|bears|bengals|bills|broncos|browns|buccaneers|cardinals|chargers|chiefs|colts|commanders|cowboys|dolphins|eagles|falcons|jaguars|lions|packers|panthers|patriots|raiders|rams|ravens|saints|seahawks|steelers|texans|titans|vikings|celtics|knicks|lakers|warriors|bucks|nuggets|76ers|sixers|mavericks|thunder|timberwolves|yankees|dodgers|mets|red sox|cubs|astros|phillies|braves|blue jays|maple leafs|bruins|oilers)\\b'),
      re('\\b(vs\\.?|v\\.)\\s+[A-Z]'), re('\\b(score|scores|beat|beats|defeat|defeats|rout|routs)\\s+\\d'), re('\\b\\d+-\\d+ (win|loss|victory|defeat)\\b'),
    ],
    gossip: [
      re('\\b(kardashians?|jenner|bieber|royal baby|red carpet|dating rumou?rs?|split from|engaged to|divorce|wedding|bikini|outfit|horoscopes?|zodiac)\\b'),
      re('\\b(reality star|influencer|tiktok star|celebrity feud|baby bump)\\b'),
    ],
    crime: [
      re('\\b(arrest(ed|s)?|charged with|suspect(s|ed)?|police (say|said)|indicted for|sentenced to|jailed|prison for|robbery|burglar\\w*|kidnap\\w*|abduct\\w*|rape|sexual assault|sex abuse|abuse case|trafficking|carjack\\w*|manhunt|fugitive|fraud scheme)\\b'),
    ],
    // Fluff (news-gate option 2): podcast, playlist, review, interview, recap, live-blog and listicle titles that the bigger
    // entertainment pools surfaced as false matches. Each pattern is dropped unless the title also carries a news verb.
    fluff: [
      fluffRe('\\bpodcasts?\\b|\\bplaylists?\\b|\\bwhat to (watch|stream|read|expect)\\b|\\bbest of\\b|\\bgift guides?\\b|\\bquiz\\b|\\brecaps?\\b|\\blive ?blog\\b|\\bphotos?\\b|\\bin photos\\b'),
      fluffRe('\\b(film |tv |movie |album |book |game |concert )?reviews?\\s*[:|\u2013\u2014-]|\\breviews?\\s*$|^reviews?\\b'),
      fluffRe('\\binterviews?\\s*[:|\u2013\u2014-]|^interview\\b|\\b(an )?interview with\\b'),
      fluffRe('\\branked\\s*[:|\u2013\u2014-]|\\branked\\s*$|\\b(every|all) .{0,40} ranked\\b|\\branking (every|all|the) \\b|\\bpower rankings?\\b'),
    ],
    // Site-title junk that a search or feed can return in place of a headline ("Federal Reserve Board - Home").
    junk: [
      re('^\\s*(home|homepage|home page|calendar|news|latest news|press releases?|sign in|log ?in|menu)\\s*$'),
      re('\\s[-|\u2013\u2014:]\\s*(home|homepage|home page|official site|official website)\\s*$'),
      re('^\\s*(home|homepage)\\s*[-|\u2013\u2014:]\\s'),
    ],
    // Service / non-news items.
    noise: [
      re('^\\s*(opinion|op-ed|analysis|review|podcast|newsletter|quiz|crossword|wordle|connections|puzzle|watch|video|photos?|in pictures|the morning|letters?)\\s*[:|-]'),
      re('\\b(best .{0,40} to buy|deals? of the day|promo codes?|coupon|sale ends|how to watch|live stream|recipe|horoscope|crossword|wordle|spelling bee|connections hints?)\\b'),
      re('\\b\\d+ (things|ways|tips) (to|you|for)\\b'),
    ],
  },
};
