// PNN configuration. Everything editorial-tunable lives here (DECISIONS D4/D5).
// Patterns are case-insensitive RegExps tested against market title + event title (+ outcome).

const re = (s) => new RegExp(s, 'i');

export default {
  port: Number(process.env.PORT || 4180),
  userAgent: 'PNN/0.1 (Pre News Network; local broadcast display)',

  // Poll schedule. Each source runs independently with jitter and exponential backoff on error.
  poll: {
    polymarketSec: 300,    // Gamma caches /events for ~300s; polling faster just refetches the cache
    kalshiSec: 180,
    newsSec: 600,          // refresh headlines for the top N stories
    newsTopN: 10,
    newsMax: 2,            // headlines per story
    // Per-story Google News search (news gate build 2026-11-05, PLAN-news-gate.md section 1; read by ingest/newsdesk).
    newsSearchSec: 90,     // search cycle
    newsBudget: 14,        // searches per cycle (was 6)
    newsBudgetShort: 20,   // when the board is short of stories (was 8)
    newsRetryMin: 90,      // no-match retry, doubling per consecutive miss (was 20)
    newsRetryMaxMin: 360,  // retry cap
    newsRefreshMin: 120,   // aired search-only stories refresh (was 60)
    newsCacheMin: 45,      // query cache TTL (was 10-15)
    historySec: 600,       // Polymarket price history for the top N story leads
    historyTopN: 8,
    history: { interval: '1d', fidelity: 30 },
    jitter: 0.15,          // +/- fraction of the interval
    backoffMaxSec: 1800,   // cap for exponential backoff
    simTickSec: 15,
  },

  // Source-specific knobs.
  sources: {
    polymarket: {
      // The main poll is the top 300 events by 24h volume, mostly elections; events 300..800 refresh every 15 min
      // (deepEvents/deepSec). A slower per-tag sweep adds the top
      // events of each of these Gamma tag slugs (each verified with curl on 2026-11-04 to return active events).
      tagSweepSec: 900,
      tagLimit: 100,        // events per tag (was 50; the tail below #50 still trades $5K+ a day)
      deepEvents: 800,      // the main poll takes events 0..300 by 24h volume; events 300..800 refresh every deepSec
      deepSec: 900,
      tagPaceMs: 350,       // gap between tag requests (Gamma caches 300s; stop early on 429/5xx)
      tagSlugs: [
        'economy', 'fed', 'economic-policy', 'finance', 'business', 'commodities', 'inflation', 'ipos', 'earnings',
        'tech', 'ai', 'openai', 'big-tech', 'science', 'space', 'climate-science', 'health',
        'pop-culture', 'movies', 'music', 'awards', 'oscars', 'celebrities', 'tv', 'video-games',
        'weather', 'climate', 'earthquakes', 'pandemics', 'courts', 'scotus', 'epstein', 'world', 'geopolitics',
        'tariffs', 'elon-musk', 'global-rates', 'macro-indicators', 'box-office', 'spotify', 'gta-vi',
        // Sports and games (2026-11-05): futures, championships, awards, coach/manager moves, release dates only. Slugs that
        // are mostly per-game events (nba, nfl, epl...) get a tiny limit: the champion/MVP futures are the top by 24h volume
        // and per-game events are discarded at parse time (sportsGaming.preDrop).
        'nba-finals', 'nfl-team-futures', 'super-bowl', 'stanley-cup', 'ballon-dor', 'world-cup', 'champions-league', 'serie-a',
        'mvp', 'rookie', 'mlb', 'cfb-awards', 'college-football', 'golf', 'game-awards', 'lol', 'cs2',
        { slug: 'nba', limit: 8 }, { slug: 'nfl', limit: 8 }, { slug: 'nhl', limit: 6 }, { slug: 'soccer', limit: 8 },
        { slug: 'epl', limit: 6 }, { slug: 'la-liga', limit: 6 }, { slug: 'bundesliga', limit: 6 }, { slug: 'ncaa-basketball', limit: 6 },
      ],
    },
    kalshi: {
      // Kalshi's sports category is ~4,000 mostly per-game series, so the generic sweep skips it. These futures, award and
      // release series are fetched by series_ticker instead (verified open 2026-11-05). Entries are a ticker or
      // [ticker, tag]; the tag ('video games') marks non-sports series so filter.mjs files them under 'games'.
      sportsSec: 900,
      sportsPaceMs: 450,
      sportsSeries: [
        'KXNBA', 'KXNBAMVP', 'KXNFLMVP', 'KXNFLNFCCHAMP', 'KXNFLAFCCHAMP', 'KXSB', 'KXNHL', 'KXMLBNLMVP', 'KXMLBALMVP',
        'KXPREMIERLEAGUE', 'KXUCL', 'KXLALIGA', 'KXBUNDESLIGA', 'KXSERIEA', 'KXHEISMAN', 'KXBALLONDOR', 'KXNFLNEXTCOACHOUT',
        ['KXGAMEAWARDS', 'video games'], ['KXGTA6', 'video games'], ['KXPS6', 'video games'], ['KXGAMERELEASE', 'video games'],
      ],
    },
  },

  // A feed is "stale" in /api/health when its last success is older than staleFactor x its interval.
  staleFactor: 3,

  // PNN's own observed price samples (store.recordPrices).
  samples: {
    keepHours: 24,
    maxPerMarket: 1000,
    minVolume24h: 1000,    // skip dead markets (~9k Polymarket markets, ~1.8k above this) to bound memory
    refreshSec: 300,       // a moved price is always recorded; record an unchanged price at least this often so windows have a baseline
  },

  categories: {
    // PNN categories that may air.
    include: ['politics', 'elections', 'geopolitics', 'economy', 'courts', 'tech', 'science', 'health', 'culture', 'weather', 'world'],
    // Categories that never air (D5).
    exclude: ['sports', 'esports', 'games', 'crypto', 'mentions', 'promo', 'novelty'],
    // Fallback when nothing maps. Unmapped markets are kept as 'world' only if no exclude rule hits.
    fallback: 'world',
    // Raw source tag / category label (lowercased) -> PNN category. First match in tag order wins,
    // but any tag mapping to an excluded category excludes the market.
    tagMap: {
      // Polymarket tag labels
      'politics': 'politics', 'us politics': 'politics', 'trump': 'politics', 'trump presidency': 'politics',
      'congress': 'politics', 'senate': 'elections', 'house': 'elections', 'midterms': 'elections',
      'elections': 'elections', 'election': 'elections', 'us election': 'elections', 'global elections': 'elections',
      'world elections': 'elections', 'primaries': 'elections', 'mayoral elections': 'elections',
      'geopolitics': 'geopolitics', 'world': 'world', 'iran': 'geopolitics', 'israel': 'geopolitics',
      'ukraine': 'geopolitics', 'russia': 'geopolitics', 'china': 'geopolitics', 'middle east': 'geopolitics',
      'foreign policy': 'geopolitics', 'trade': 'economy', 'tariffs': 'economy', 'trade war': 'economy',
      'fed': 'economy', 'fed rates': 'economy', 'economy': 'economy', 'economics': 'economy', 'inflation': 'economy',
      'oil': 'economy', 'commodities': 'economy', 'gas prices': 'economy', 'ipos': 'economy', 'ipo': 'economy',
      'stocks': 'economy', 'business': 'economy', 'finance': 'economy', 'financials': 'economy', 'companies': 'economy',
      'interest rates': 'economy', 'recession': 'economy', 'jobs': 'economy', 'gdp': 'economy',
      'courts': 'courts', 'scotus': 'courts', 'supreme court': 'courts', 'legal': 'courts', 'law': 'courts',
      'tech': 'tech', 'technology': 'tech', 'ai': 'tech', 'big tech': 'tech', 'openai': 'tech',
      'science': 'science', 'space': 'science', 'science and technology': 'tech', 'aliens': 'science',
      'health': 'health', 'pandemic': 'health', 'vaccines': 'health',
      'culture': 'culture', 'pop culture': 'culture', 'entertainment': 'culture', 'movies': 'culture',
      'music': 'culture', 'awards': 'culture', 'oscars': 'culture', 'celebrities': 'culture', 'tv': 'culture',
      'weather': 'weather', 'climate': 'weather', 'climate and weather': 'weather', 'hurricanes': 'weather',
      'transportation': 'world', 'social': 'world',
      // Added in the variety pass (Polymarket tag labels/slugs and Kalshi categories seen live 2026-11-04)
      'economic policy': 'economy', 'economic-policy': 'economy', 'earnings': 'economy', 'equities': 'economy',
      'macro indicators': 'economy', 'housing': 'economy', 'treasuries': 'economy', 'fed chair': 'economy',
      'derivatives': 'economy', 'banks': 'economy', 'jerome powell': 'economy', 'powell': 'economy',
      'gpt-5': 'tech', 'gpt': 'tech', 'anthropic': 'tech', 'google': 'tech', 'apple': 'tech', 'nvidia': 'tech',
      'tesla': 'tech', 'meta': 'tech', 'microsoft': 'tech', 'spacex': 'science', 'nasa': 'science',
      // 'climate & science' is Polymarket's catch-all (IPOs, pandemics, moon landings): left unmapped on purpose.
      'global temp': 'weather', 'natural disasters': 'weather', 'pandemics': 'health',
      'earthquakes': 'weather', 'video games': 'games', 'video-games': 'games', 'gaming': 'games', 'gta vi': 'games',
      'gta 6': 'games', 'game awards': 'games', 'game-awards': 'games', 'golden joystick awards': 'games', 'spotify': 'culture', 'billboard': 'culture', 'box office': 'culture', 'grammys': 'culture',
      'emmys': 'culture', 'golden globes': 'culture', 'the game awards': 'games', 'netflix': 'culture', 'youtube': 'culture',
      'taylor swift': 'culture', 'religion': 'culture', 'pope': 'culture', 'time person of the year': 'culture',
      'measles': 'health', 'fda': 'health', 'rfk jr': 'health', 'bird flu': 'health', 'medicine': 'health',
      'epstein': 'courts', 'crime': 'courts', 'trials': 'courts', 'justice': 'courts', 'doj': 'courts',
      // Kalshi categories
      'world': 'world',
      // Noise (excluded)
      'sports': 'sports', 'nfl': 'sports', 'nba': 'sports', 'mlb': 'sports', 'nhl': 'sports', 'soccer': 'sports',
      'football': 'sports', 'basketball': 'sports', 'baseball': 'sports', 'hockey': 'sports', 'tennis': 'sports',
      'golf': 'sports', 'ufc': 'sports', 'mma': 'sports', 'boxing': 'sports', 'f1': 'sports', 'formula 1': 'sports',
      'cricket': 'sports', 'ncaa': 'sports', 'cfb': 'sports', 'college football': 'sports', 'cbb': 'sports',
      'champions league': 'sports', 'ucl': 'sports', 'epl': 'sports', 'premier league': 'sports', 'la liga': 'sports',
      'olympics': 'sports', 'games': 'sports', 'chess': 'novelty',
      'esports': 'esports', 'league of legends': 'esports', 'counter-strike': 'esports', 'cs2': 'esports',
      'dota 2': 'esports', 'valorant': 'esports', 'lol': 'esports', 'dota-2': 'esports', 'counter-strike 2': 'esports',
      'mvp': 'sports', 'rookie': 'sports', 'ballon d\'or': 'sports', 'ballon-dor': 'sports', 'super bowl': 'sports', 'stanley cup': 'sports',
      'nba finals': 'sports', 'world cup': 'sports', 'heisman': 'sports', 'cfb awards': 'sports', 'serie a': 'sports', 'bundesliga': 'sports',
      'mls': 'sports', 'ligue 1': 'sports', 'pro football': 'sports', 'pro basketball': 'sports', 'atp': 'sports', 'wta': 'sports',
      'crypto': 'crypto', 'crypto prices': 'crypto', 'bitcoin': 'crypto', 'ethereum': 'crypto', 'solana': 'crypto',
      'xrp': 'crypto', 'memecoins': 'crypto', 'up or down': 'crypto', 'hit price': 'crypto',
      'mentions': 'mentions', 'mention markets': 'mentions', 'tweet markets': 'mentions', 'elon tweets': 'mentions',
      // Multi-leg parlays/combos (Polymarket 'Blue tsunami', Kalshi mixed combos). 'senate combos'/'house combos'
      // stay: Kalshi uses them for legitimate seat-count markets.
      'parlays': 'novelty', 'parlay': 'novelty', 'mixed combos': 'novelty', 'midterm combos': 'novelty',
      'rewards': 'promo', 'earn': 'promo', 'earn 4%': 'promo', 'hide from new': 'promo',
    },
    // Title patterns that mark noise regardless of tags.
    excludePatterns: [
      { category: 'mentions', re: re('\\b(tweets?|posts?|truth social posts?)\\b.*\\b(how many|\\d+\\s*[-–]\\s*\\d+|or more|between)\\b') },
      { category: 'mentions', re: re('\\b(how many|number of) (tweets|posts)\\b') },
      { category: 'mentions', re: re('\\bwill .{1,60}\\b(say|mention)\\b') },
      { category: 'mentions', re: re('\\bmention(s|ed)?\\b') },
      { category: 'crypto', re: re('\\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|dogecoin|doge)\\b.*\\b(above|below|between|reach|hit|dip|price|up or down)\\b') },
      { category: 'crypto', re: re('\\bup or down\\b') },
      { category: 'sports', re: re('\\bvs\\.?\\s') },
      { category: 'sports', re: re('\\b(super bowl|world series|stanley cup|nba finals|champions league|premier league|grand slam|wimbledon|masters|ufc \\d+|grand prix)\\b') },
      { category: 'esports', re: re('\\b(lol|cs2|dota|valorant|esports?)\\b') },
      { category: 'promo', re: re('\\b(earn \\d+%|rewards?|airdrop|promo)\\b') },
      { category: 'novelty', re: re('\\b(combo|parlay)\\b') },
      // View-count and search-rank novelty ("# of views of next MrBeast video", "Taylor Swift daily view count")
      // Daily index coin-flips ("S&P 500 Daily Up/Down"), the stock-market twin of crypto "up or down".
      { category: 'novelty', re: re('\\bdaily up\\s*/\\s*down\\b') },
      // Photo-count series (Kalshi KXTRUMPPHOTO: "Number of distinct days with a Getty Images editorial photo of Trump ...")
      { category: 'novelty', re: re('\\bGetty Images\\b|\\bdistinct days\\b|\\bphotographed this (week|month)\\b|\\beditorial photo\\b') },
      { category: 'novelty', re: re('#\\s*of views|\\bview count\\b|\\bviews? (of|on) .{0,40}video\\b') },   // Kalshi multi-leg combos (e.g. "LA Mayor - CA Governor Combo")
    ],
  },

  // DECISIONS D4: exclude ALL war, violence and death. Non-violent geopolitics stays.
  sensitive: {
    mode: 'exclude',
    excludePatterns: [
      re('\\binva(de|des|ded|sion|sions)\\b'), re('\\binvad'),
      re('\\bairspace\\b'), // closures track military escalation (user policy D4)
      re('\\bsuspend\\w*\\b.{0,40}\\bflights?\\b'), re('\\bben gurion\\b'), // airline suspensions over conflict ("Major airlines suspend Ben Gurion flights by…")
      re('(?<!meteor |asteroid |lightning )\\bstrikes? (on|against|in)\\b'), re('\\bairstrikes?\\b'), re('\\bdrone strikes?\\b'), re('\\bmilitary strikes?\\b'),
      re('\\battack(s|ed|ing)?\\b'),
      re('\\bcease-?fire\\b'), re('\\btruce\\b'), re('\\barmistice\\b'),
      re('\\bblockade\\b'),
      re('\\bmilitar(y|ily)\\b'), re('\\bmissiles?\\b'), re('\\btroops?\\b'), re('\\bboots on the ground\\b'),
      re('\\bwar\\b(?! machine)'), re('\\bwars\\b'), re('\\bwarfare\\b'), re('\\bcivil war\\b'),
      re('\\bhostages?\\b'), re('\\bbomb(s|ing|ed)?\\b'), re('\\bshell(ing|ed)\\b'),
      re('\\bregime (fall|falls|collapse|collapses|change)\\b'), re('\\bcoup\\b'),
      re('\\bassassinat'), re('\\bkill(s|ed|ing)?\\b'), re('\\bmurder'), re('\\bshot (dead|and killed)\\b'), re('\\bshooting\\b'),
      re('\\bdies?\\b'), re('\\bdied\\b'), re('\\bdeaths?\\b'), re('\\bdead\\b'), re('\\bcasualt'), re('\\bfatalit'),
      re('\\bnuclear (weapon|bomb|strike|test|war|detonation)s?\\b'), re('\\bnuke'),
      re('\\bterror(ism|ist|ists)?\\b'), re('\\bgenocide\\b'), re('\\bmassacre\\b'),
      re('\\bannex(es|ed|ation)?\\b'), re('\\boccup(y|ies|ation)\\b'),
      re('\\bdeclares? war\\b'), re('\\barmed conflict\\b'), re('\\brecaptur'),
    ],
    // Attached news headlines (wire, search, flash, moving-first context) must pass excludePatterns above PLUS these
    // headline-only words (QUEUED-FIXES 16: "Putin, Rezaei meet as Turkey probes deadly Iran border fire" aired).
    // Headline-only because they are too broad for market titles ("deadliest hurricane season" markets stay).
    headlinePatterns: [
      re('\\bdead(ly|liest|lier)\\b'), re('\\bfatal(ly|ities)?\\b'), re('\\bslain\\b'), re('\\bslaying'),
      re('\\bstabb(ed|ing)\\b'), re('\\bgun(man|men|fire|shots?|point)\\b'),
      re('\\bkidnap'), re('\\babduct'), re('\\bexecutions?\\b'), re('\\bmanslaughter\\b'), re('\\bsuicide\\b'),
      re('\\bbeheaded\\b'), re('\\bcorpses?\\b'), re('\\bdeath toll\\b'), re('\\bwounded\\b'),
      re('\\bdrones?\\b.{0,30}\\b(hit|struck|downed|shot)\\b'),
      re('\\brap(e|ed|ist)\\b'), re('\\bgunned\\b'), re('\\bairstrike'),
      // military strikes / attacks by a state or armed force ("Russia intensifies Ukraine strikes"); labour strikes stay
      re('\\b(russia|russian|ukraine|ukrainian|israel|israeli|iran|iranian|gaza|lebanon|syria|syrian|yemen|houthi|kyiv|moscow|military|missile|drone|air|naval|artillery|rocket|retaliatory|cross-border|border)\\s+(strikes?|attacks?|raids?|offensive|bombardments?|shelling|barrages?)\\b'),
      re('\\b(strikes?|attacks?|shelling|bombardments?|raids?)\\s+(on|in|against)\\s+(russia|ukraine|kyiv|israel|iran|gaza|lebanon|syria|yemen|tehran|beirut)\\b'),
    ],
    // Benign idioms neutralised before the headline test, so "trade war" / "dead heat" headlines still back markets.
    headlineBenign: re('\\b(trade|price|tariff|culture|bidding|streaming|console|talent|turf|flame|format|patent|currency|chip|subsidy|fare|pricing) wars?\\b|\\bwar (chest|room)s?\\b|\\bdead heat\\b|\\bdeadlock\\w*|\\battack ads?\\b|\\bpanic attack\\b|\\bheart attack\\b'),
  },

  // Market-level noise filters (editorial/filter.mjs).
  filter: {
    minVolume24h: 1000,
    // Pool widening (2026-11-04): a market outside these categories may air from a lower daily floor when the question
    // itself is big (lifetime volume or liquidity), so long-running questions that are quiet today still qualify.
    // They carry the THIN flag (thinVolume) and rank lower. Elections/politics already have 900+ events: they keep 1000.
    lowVolume24h: 200,
    lowVolumeTotal: 25_000,
    lowVolumeLiquidity: 10_000,   // Polymarket order-book depth, or Kalshi open interest
    lowFloorExcludeCategories: ['elections', 'politics'],
    lowFloorPriceBand: [0.02, 0.98],  // a pinned market on the low floor is not a story
    expiredGraceHours: 48,
    // Kalshi series recurrence that never airs (and is not even held in memory by the Kalshi sweep).
    // Weekly/monthly stay on: kalshi.mjs gives a market listed < 24h ago no change1d, so a fresh bracket is never
    // a fake 90-point mover (the reason daily/weekly used to be off).
    excludeFrequencies: ['fifteen_min', 'hourly'],
    // Daily series air only from these Kalshi categories (gas, oil, CPI, rates, indexes); other daily series
    // (temperature, approval trackers) need dailyMinVolume on the market itself.
    dailyCategories: ['economics', 'financials', 'commodities', 'companies', 'entertainment'], // daily charts/box office/Spotify are entertainment content the user wants
    dailyMinVolume: 50_000,
    // Daily city-temperature brackets ("Highest temperature in Warsaw on November 5?") on either exchange are
    // novelty unless a market carries real money.
    dailyWeatherMinVolume: 50_000,
    // Kalshi cumulative strike ladders (Above $4.00 / Above $4.02 / ...) air as ONE yes/no story on the rung nearest
    // 50% (rank.mjs pickLine), so gas, diesel, oil, CPI and margin ladders reach the air. true drops them all again.
    dropLadders: false,
    // Ladders that are data-vendor trivia rather than news (card-spend and point-of-sale indexes) stay off.
    ladderExcludePatterns: [
      re('\\b(credit card spend|point of sale|array index|sector trends?|card spend|foot traffic)\\b'),
    ],
  },

  // SPORTS AND VIDEO GAMES (2026-11-05, news-driven PNN). Sports/gaming air only as news-driven futures: championships,
  // MVP/awards, coach/manager moves, retirements/transfers, release dates, Game of the Year, esports majors. The filter
  // files kept markets under category 'sports' or 'games' (esports -> 'games') and adds `kind`, so rank.mjs/newsdesk.mjs
  // can gate them on a matching headline. Set enabled:false to restore the old blanket exclusion.
  sportsGaming: {
    enabled: true,
    // Dropped at Gamma parse time (never held in memory): per-game events carry 230-300 markets each.
    preDrop: [
      re('^.+ vs\\.? .+'), re('\\(BO\\d\\)'), re('Exact Score|More Markets'), re('^(LoL|Dota 2|Counter-Strike|Valorant|CS2):'),
    ],
    // Micro markets that never air: spreads, totals, props, per-game / per-map / live in-game bets, per-player stat lines.
    drop: [
      re('^.+ vs\\.? .+$'), re('\\(BO\\d\\)'), re('\\bvs\\.?\\s'),
      re('Exact Score|More Markets|Both Teams|BTTS|Spread|Over\\s?/?\\s?Under|\\bO/U\\b|Total (Goals|Points|Maps|Games|Sets|Runs|Kills)'),
      re('\\b(moneyline|parlay|anytime|first (goal|basket|touchdown|blood|team)|(1st|2nd|3rd|4th|first|second) (half|quarter|period|inning)|halftime show|half-?time)\\b'),
      re('Regular Season (Passing|Rushing|Receiving)'), re('\\d[\\d,]*\\+ (Receiving|Rushing|Passing)'), re('\\d[\\d,]*\\+ (Points|ATP Points)'),
      re('Players? to Record|Per Game|Fantasy|Most (Kills|Banned|Clean Sheets|Assists)|Top (Scorer|Goalscorer)|Points Per'),
      re('Win Total|Team to Finish|Exact Matchup|Day Winner|Who Will .* Fight Next|Wins? on \\d{4}-\\d{2}-\\d{2}'),
      re('\\b(beats?|defeats?)\\b.{0,30}\\b(on|in) (game|round|set|map)\\b'),
      re('Streamer Awards|Sports Illustrated|run an ad|Album|Radio|Steam Weekly|valuation|Songs on|Featured on|First Week Sales'),
      re('^(LoL|Dota 2|Counter-Strike|Valorant|CS2):'), re('Make Grand Finals|Western team|Roster Change|Tier 1 event|Group [A-Z] Winner|\\b(2nd|3rd|4th) Place\\b'),
      re('Playoffs?: Team to|Team to (Make|Qualify|Advance|Reach)|Teams? relegated|Top \\d Finishers|Qualify for'),
    ],
    // Kalshi ticker families that are micro markets (tested on the event ticker).
    dropTickers: re('(1H|2H|1Q|2Q|3Q|4Q|SPREAD|TOTAL|BTTS|FTTS|H2H|MAP|GAMES?|TEAMTOTAL|CORNERS|FIRSTGOAL|SCORE|SET\\d?|PTS|BLK|FFPTS|RSHYDS\\w*|RECYDS\\w*|PODIUM|TOP5|VIEWER)(-|$)|^KS:(KXLOL(DRAGON|TOWERS|FBLOOD|FBARON|FDRAGON|MBC|PENTA|SHORTGAME|TOTAL)|KXCS2(GAME|MAP|SPREAD|TOTALMAPS)|KXTWITCH|KXSTREAM|KXMRBEAST|KXNATHANS|KX4MINMILE)'),
    // Polymarket tags that mark prop / fantasy / weekly events (unless the event is also under nfl-team-futures).
    dropTags: ['props', 'season-stats', 'fantasy-football', 'nfl-weekly', 'nfl-gameday'],
    keepTags: ['nfl-team-futures'],
    // Allowed kinds, tested on "event • market • outcome" after the drop list. First match names the kind.
    keep: [
      { kind: 'coach', re: re('\\bout as .{0,50}\\b(manager|coach)\\b|\\bnext (head )?(coach|manager)\\b|\\b(coach|manager) (out|fired|sacked|hired|exit)|\\bcoach out\\b|\\bhead coach\\b.{0,40}\\b(2026|2027)\\b') },
      { kind: 'transfer', re: re('\\b(retire|retirement|retires|transfer|traded?|signs? with|shutdown|shut down)\\b.{0,60}\\b(2026|2027)\\b') },
      { kind: 'award', re: re('game of the year|\\bmvp\\b|most valuable player|rookie of the year|cy young|heisman|ballon d.?or|\\b\\w+ of the year\\b|sports personality|golden (boot|ball|glove)|\\b(hart|vezina|norris|calder|lady byng|art ross|rocket richard) (memorial )?trophy|most improved|sixth man') },
      { kind: 'release', re: re('\\bgta (6|vi)\\b|grand theft auto|\\bps6\\b|playstation 6|\\bswitch 2\\b|metacritic|\\bvideo games? released\\b') },
      { kind: 'esports', re: re('(worlds 20\\d\\d|\\bmsi\\b|\\biem\\b|\\bpgl\\b|\\bblast\\b|esl pro league|the international|\\bmajor\\b|esports world cup|\\bvct\\b).{0,40}\\b(winner|champion|finals mvp|winning region)\\b') },
      { kind: 'championship', re: re('\\b(champion|champions|championship|national champion|conference champion|division winner)\\b|(super bowl|world series|stanley cup|nba finals|world cup|ryder cup|pennant).{0,40}\\b(winner|champion|mvp)\\b|(2026|2027|2026-27).{0,30}\\bwinner\\b|\\bwinner\\b.{0,30}\\b(2026|2027)\\b|league phase winner|\\b(masters|us open|open championship|pga championship|grand prix|grand slam|wimbledon|australian open|french open|roland garros|ncaa tournament|march madness)\\b.{0,30}\\bwinner\\b') },
    ],
  },

  // STOCK AND BOND MOVES (QUEUED-FIXES item 12, research/financial-data.md; server/finance.mjs + sources/finance.mjs).
  // Yahoo /v8/finance/chart is the quote source (no key; one request per symbol, spaced), Treasury.gov XML gives the
  // official daily curve and the 2Y. A move airs (state.finance.moves) only when it crosses its threshold AND a wire
  // headline matches AND at least one paired prediction market from `pairings` is well traded; otherwise ticker only.
  finance: {
    enabled: true,
    userAgent: 'PNN/0.1 (local news display)',
    spacingMs: 220,                 // gap between Yahoo requests in a sweep (~30 symbols)
    // Sweep cadence by US market hours (ET): regular 9:30-16:00 weekdays, extended 4:00-9:30 and 16:00-20:00,
    // overnight/weekends only the futures/FX in `overnightSymbols`.
    cadenceSec: { regular: 60, extended: 300, overnight: 1800 },
    overnightSymbols: ['CL=F', 'GC=F', 'DX-Y.NYB'],
    historyTtlSec: 1200,            // 5d/15m and 1mo/1d sparkline history, fetched only for symbols that are big
    treasurySec: 3600,              // Treasury.gov daily curve (hourly is plenty: it posts once a day ~3:30-6pm ET)
    pairingTtlSec: 300,             // paired prediction-market events fetched by slug/series (hourly S&P lines go stale fast)
    maxMoves: 3,                    // rank.mjs rankFinanceMoves keeps the strongest few
    marketsPerMove: 3,
    minPairVolume: { polymarket: 1000, kalshi: 500 },   // per paired market, 24h (USD / contracts): well-traded only
    headlineHours: { open: 6, closed: 16 },             // wire archive window for the "In the news" headline
    // Big-move thresholds: stocks/indices/commodities in % (day), yields in points (day). `swing` = move within 60 min.
    thresholds: {
      top5: { day: 2, swing: 2 }, stock: { day: 3, swing: 2 }, index: { day: 1.5 }, ndx: { day: 2 }, vix: { day: 15 },
      yield: { day: 0.10, swing: 0.07 }, oil: { day: 3 }, gold: { day: 2 }, dollar: { day: 1 },
    },
    // Hysteresis: a live move re-airs only when it grows 1.5x or after 4h; it leaves when it shrinks under 80% of threshold.
    hysteresis: { grow: 1.5, reairHours: 4, exit: 0.8 },
    // Watchlist (user, 2026-11-05: top ~20 mega-caps, indices incl. VIX, Treasury 2Y/5Y/10Y/30Y, oil, gold, dollar).
    // `strong` aliases name the thing outright; `broad` ones (sector words, "stocks") need a market/move word too.
    watchlist: [
      { symbol: 'NVDA', name: 'NVIDIA', kind: 'stock', tier: 'top5', company: 'nvidia', strong: ['nvidia', 'nvda', 'jensen huang'], broad: ['chipmakers?', 'chip stocks', 'chip selloff', 'chip sell-off', 'ai stocks', 'ai trade', 'semiconductors?'], pair: ['lcDec', 'lcNov'] },
      { symbol: 'AAPL', name: 'Apple', kind: 'stock', tier: 'top5', company: 'apple', strong: ['apple', 'aapl', 'tim cook', 'iphone'], pair: ['lcDec', 'lcNov'] },
      { symbol: 'MSFT', name: 'Microsoft', kind: 'stock', tier: 'top5', company: 'microsoft', strong: ['microsoft', 'msft', 'satya nadella'], pair: ['lcDec', 'lcNov'] },
      { symbol: 'GOOGL', name: 'Alphabet', kind: 'stock', tier: 'top5', company: 'alphabet|google', strong: ['alphabet', 'googl', 'google'], pair: ['lcDec', 'lcNov'] },
      { symbol: 'AMZN', name: 'Amazon', kind: 'stock', tier: 'top5', company: 'amazon', strong: ['amazon', 'amzn', 'andy jassy'], pair: ['lcDec', 'lcNov'] },
      { symbol: 'META', name: 'Meta', kind: 'stock', company: 'meta', strong: ['meta platforms', 'zuckerberg', '(?<!\\w)meta(?! ?data)'], pair: ['lcDec'] },
      { symbol: 'AVGO', name: 'Broadcom', kind: 'stock', company: 'broadcom', strong: ['broadcom', 'avgo'], broad: ['chipmakers?', 'chip stocks'], pair: ['lcDec'] },
      { symbol: 'TSLA', name: 'Tesla', kind: 'stock', company: 'tesla', strong: ['tesla', 'tsla'], broad: ['musk.s stocks', 'musk stocks'], pair: ['lcDec'] },
      { symbol: 'TSM', name: 'TSMC', kind: 'stock', company: 'tsmc|taiwan semiconductor', strong: ['tsmc', 'taiwan semiconductor'], broad: ['chipmakers?'], pair: [] },
      { symbol: 'BRK-B', name: 'Berkshire Hathaway', kind: 'stock', company: 'berkshire', strong: ['berkshire', 'buffett'], pair: [] },
      { symbol: 'LLY', name: 'Eli Lilly', kind: 'stock', company: 'lilly', strong: ['eli lilly', 'lilly'], pair: [] },
      { symbol: 'JPM', name: 'JPMorgan', kind: 'stock', company: 'jpmorgan', strong: ['jpmorgan', 'jamie dimon'], broad: ['bank stocks'], pair: [] },
      { symbol: 'WMT', name: 'Walmart', kind: 'stock', company: 'walmart', strong: ['walmart'], pair: [] },
      { symbol: 'V', name: 'Visa', kind: 'stock', company: 'visa', strong: ['visa inc', 'visa shares', 'visa stock', 'visa earnings'], pair: [] },
      { symbol: 'ORCL', name: 'Oracle', kind: 'stock', company: 'oracle', strong: ['oracle', 'larry ellison'], pair: [] },
      { symbol: 'MA', name: 'Mastercard', kind: 'stock', company: 'mastercard', strong: ['mastercard'], pair: [] },
      { symbol: 'NFLX', name: 'Netflix', kind: 'stock', company: 'netflix', strong: ['netflix'], pair: [] },
      { symbol: 'XOM', name: 'Exxon Mobil', kind: 'stock', company: 'exxon', strong: ['exxon'], pair: [] },
      { symbol: 'COST', name: 'Costco', kind: 'stock', company: 'costco', strong: ['costco'], pair: [] },
      { symbol: 'PLTR', name: 'Palantir', kind: 'stock', company: 'palantir', strong: ['palantir'], pair: [] },
      { symbol: '^GSPC', name: 'S&P 500', kind: 'index', tier: 'index', strong: ['s&p 500', 's&p', 'spx'], broad: ['stocks', 'stock market', 'wall street', 'equities', 'dow'], pair: ['kInxu', 'kInxy', 'pmRecession'] },
      { symbol: '^NDX', name: 'Nasdaq-100', kind: 'index', tier: 'ndx', strong: ['nasdaq'], broad: ['tech stocks', 'chip stocks', 'chipmakers?', 'ai stocks', 'ai trade', 'stocks', 'wall street'], pair: ['kNdxU', 'kNdx', 'lcDecLeader'] },
      { symbol: '^DJI', name: 'Dow', kind: 'index', tier: 'index', strong: ['dow jones', 'the dow', 'dow'], broad: ['blue.chips?', 'stocks', 'wall street'], pair: ['kInxu', 'pmRecession', 'kRecession'] },
      { symbol: '^VIX', name: 'VIX volatility index', kind: 'index', tier: 'vix', strong: ['vix', 'fear gauge', 'volatility index'], broad: ['volatility', 'selloff', 'sell-off', 'stocks', 'wall street'], pair: ['kInxu', 'pmRecession'] },
      { symbol: '^FVX', name: '5-year Treasury yield', short: '5-year yield', kind: 'yield', tier: 'yield', treasury: 'BC_5YEAR', strong: ['5-year', 'five-year'], broad: ['treasur(y|ys|ies)', 'yields?', 'bonds?', 'rates'], pair: ['pmFedDec', 'kFedDecision', 'pmHike2026'] },
      { symbol: '^TNX', name: '10-year Treasury yield', short: '10-year yield', kind: 'yield', tier: 'yield', treasury: 'BC_10YEAR', strong: ['10-year', 'ten-year', 'treasury yields?', 'treasurys'], broad: ['treasur(y|ies)', 'yields?', 'bonds?', 'rates'], pair: ['kUst10', 'pm10yHigh', 'pmFedDec'] },
      { symbol: '^TYX', name: '30-year Treasury yield', short: '30-year yield', kind: 'yield', tier: 'yield', treasury: 'BC_30YEAR', strong: ['30-year', 'long bond'], broad: ['treasur(y|ys|ies)', 'yields?', 'bonds?'], pair: ['pmFedDec', 'kFedRate', 'pmHike2026'] },
      // 2Y: Yahoo has no 2Y series, so it comes from Treasury.gov (daily close vs the previous close).
      { symbol: 'UST2Y', name: '2-year Treasury yield', short: '2-year yield', kind: 'yield', tier: 'yield', treasury: 'BC_2YEAR', source: 'treasury', strong: ['2-year', 'two-year'], broad: ['treasur(y|ys|ies)', 'yields?', 'fed'], pair: ['pmFedDec', 'kFedDecision', 'pmHike2026'] },
      { symbol: 'CL=F', name: 'WTI oil', kind: 'commodity', tier: 'oil', unit: '$', strong: ['crude', 'wti', 'opec', 'brent', 'oil prices?', 'oil futures'], broad: ['(?<!olive )oil'], pair: ['kWti'] },
      { symbol: 'GC=F', name: 'Gold', kind: 'commodity', tier: 'gold', unit: '$', strong: ['gold prices?', 'gold futures', 'bullion', 'precious metals'], broad: ['gold'], pair: ['pmGoldBest'] },
      { symbol: 'DX-Y.NYB', name: 'Dollar index', short: 'Dollar', kind: 'commodity', tier: 'dollar', strong: ['dollar index', 'greenback', 'u\\.?s\\. dollar'], broad: ['dollar'], pair: ['pmFedDec', 'pmHike2026'] },
    ],
    // EXPLICIT pairing table: move -> prediction markets (user 2026-11-05: well-traded pairings only, no thin single-stock
    // earnings). pick: 'company' (the move's company outcome, then the leader), 'leader' (highest %), 'line' (ladder rung
    // nearest 50% on the soonest event), 'topvol' (busiest market), 'single'. phrase: a noun phrase that reads after
    // "N% chance of" ({o} = cleaned outcome, {when} = from the Kalshi event date). Verified by curl 2026-11-05.
    pairings: {
      lcDec: { source: 'polymarket', slug: 'largest-company-end-of-december-2026', pick: 'company', phrase: "{o} being the world's largest company at the end of December" },
      lcDecLeader: { source: 'polymarket', slug: 'largest-company-end-of-december-2026', pick: 'leader', phrase: "{o} being the world's largest company at the end of December" },
      lcNov: { source: 'polymarket', slug: 'largest-company-end-of-november-2026', pick: 'company', phrase: "{o} being the world's largest company at the end of November" },
      pmFedDec: { source: 'polymarket', slug: 'fed-decision-in-december-20260729232808632', pick: 'leader', phrase: '{fed} at the December meeting' },
      pmHike2026: { source: 'polymarket', slug: 'another-fed-rate-hike-in-2026', pick: 'single', phrase: 'another Fed rate hike in 2026' },
      pm10yHigh: { source: 'polymarket', slug: 'how-high-will-10-year-treasury-yield-go-before-2027', pick: 'topvol', phrase: 'the 10-year yield hitting {o} before 2027' },
      pmRecession: { source: 'polymarket', slug: 'us-recession-by-end-of-2026', pick: 'single', phrase: 'a US recession by the end of 2026' },
      pmGoldBest: { source: 'polymarket', slug: 'bitcoin-vs-gold-vs-sp-500-in-2026', pick: 'outcome', outcome: 'gold', phrase: 'gold beating bitcoin and the S&P 500 in 2026' },
      kInxu: { source: 'kalshi', series: 'KXINXU', pick: 'line', phrase: 'the S&P 500 at {o} {when}' },
      kInxy: { source: 'kalshi', series: 'KXINXY', pick: 'leader', phrase: 'the S&P 500 ending 2026 {o}' },
      kNdxU: { source: 'kalshi', series: 'KXNASDAQ100U', pick: 'line', phrase: 'the Nasdaq-100 at {o} {when}' },
      kNdx: { source: 'kalshi', series: 'KXNASDAQ100', pick: 'leader', phrase: 'the Nasdaq-100 closing {o} {when}' },
      kUst10: { source: 'kalshi', series: 'KXUST10A', pick: 'line', phrase: 'the 10-year yield at {o} {when}' },
      k10y550: { source: 'kalshi', series: 'KX10YR550PCT', pick: 'single', phrase: 'the 10-year yield hitting 5.50%' },
      kWti: { source: 'kalshi', series: 'KXWTI', pick: 'line', phrase: 'WTI oil {o} {when}' },
      kFedDecision: { source: 'kalshi', series: 'KXFEDDECISION', pick: 'leader', phrase: '{fed} at the {month} meeting' },
      kFedRate: { source: 'kalshi', series: 'KXFED', pick: 'topvol', phrase: 'the Fed funds rate {o} after the {month} meeting' },
      kRecession: { source: 'kalshi', series: 'KXRECSSNBER', pick: 'single', phrase: 'a US recession starting in 2026', event: 'KXRECSSNBER-26' },
    },
  },

  thinVolume: 25_000,       // USD 24h volume below this is flagged "thin"

  breaking: {
    points: 0.08,           // absolute probability move that counts as breaking
    minutes: 60,            // within this window of PNN's own samples
    minVolume: 50_000,      // 24h volume floor
    cooldownMin: 90,        // per market
  },

  limits: {
    stories: 30,
    movers: 20,
    closing: 12,
    closingDays: 7,
    marketsPerStory: 5,
    alerts: 10,
    deskStories: 16,        // stories per desk (was 12; the plan's >= 110 on air needs 30 + 5x16 + 8)
    // News gate (PLAN-news-gate.md, 2026-11-05).
    newsPool: 400,          // pending (search queue) cap; was a hard-coded 120
    sgBoard: 4,             // sports & games on the 30-story board (was 3)
    sgDesk: 8,              // SPORTS & GAMES desk (was 6)
    sgClosing: 3,           // sports & games in THIS WEEK (was 2)
    sgMovers: 3,            // sports & games in the ticker (was 2)
    sgMinScore: 3.3,        // match-score floor on news[0] for sports & games (the measured wrong matches all scored < 3.3)
    sgPerHeadBoard: 1,      // one headline backs at most 1 sports/games story on the board (2 on the desk)
    topStaleH: 48,          // the top 6 skips a story whose news is older than this while a fresher one of its category qualifies
  },

  // MARKETS MOVING FIRST · NO HEADLINE YET (PLAN-news-gate.md section 5). A big, well-traded move with no headline yet
  // airs in a capped, labelled share of slots. Both prices inside the band and not closing within 6h: no settled-bracket
  // artifacts. Conflict and sports/games never air without a headline to frame them (D4).
  movingFirst: {
    enabled: true,
    points: 0.05, minVolume: 10_000,          // |change1d| >= 5 pts on >= $10K event volume (or a hot 1h move)
    strongPoints: 0.08, strongVolume: 25_000, // the strong tier ranks at 1.0 x score, the rest at 0.9
    priceBand: [0.04, 0.96],                  // yesPrice AND prior (yesPrice - move) inside the band
    minHoursToClose: 6,
    share: 0.15, boardMax: 4, topMax: 1, deskMax: 2, closingMax: 1, moversMax: 3,
    excludeCategories: ['geopolitics', 'sports', 'games', 'esports'],
    excludePatterns: [
      re('\\b(iran\\w*|russia\\w*|ukrain\\w*|israel\\w*|gaza|hamas|hezbollah|houthis?|taiwan strait|north korea\\w*|nuclear|cease-?fire|strikes?|troops?|missiles?|war|wars|military|invasion|invade\\w*|sanctions?|nato|kremlin|putin|zelensk\\w*|netanyahu|khamenei)\\b'),
    ],
  },

  sim: {
    eventsFile: 'research/samples/polymarket-events-top20-2026-11-04.json',
    marketsFile: 'research/samples/polymarket-markets-top100-2026-11-04.json',
    jitterMarkets: 5,       // markets nudged per tick
    jitterPoints: 0.025,    // max nudge
    jumpEveryTicks: 8,      // roughly how often a big move happens
    jumpPoints: [0.10, 0.16],
  },
};
