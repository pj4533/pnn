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
