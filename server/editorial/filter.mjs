// PNN editorial filter: decides whether a normalized Market may air and which PNN category it belongs to.
//
// classify(market, config, {now}) -> { keep: boolean, category: string, reason: string }
//   reason is 'ok' for kept markets, otherwise a short drop code for logs, e.g.
//   'no-price', 'dead-volume', 'sensitive', 'excluded:sports', 'title:crypto', 'not-included:other'.
//
// Config keys read (all optional, defaults below):
//   config.categories.include        string[]  categories that may air (empty/missing = anything not excluded)
//   config.categories.exclude        string[]  categories that never air
//   config.categories.tagMap         {tag: category} | [[tag, category], ...]   raw tag (lowercase) -> category
//   config.categories.excludePatterns [{category, re}]  title/event/outcome noise patterns (RegExp or string)
//   config.categories.fallback       string    category when nothing maps (default 'world')
//   config.sensitive.mode            'exclude' | 'allow'  (default 'exclude', DECISIONS D4)
//   config.sensitive.excludePatterns (RegExp|string)[]
//   config.sensitive.excludeTags     string[]  raw tags that mark a market sensitive (default: military tags)
//   config.filter.minVolume24h       number    dead-market floor in USD/contracts (default 1000)
//   config.filter.lowVolume24h / lowVolumeTotal / lowVolumeLiquidity / lowFloorExcludeCategories / lowFloorPriceBand
//                                    lower floor (default 200) for non-election/politics markets whose lifetime volume
//                                    (>= 25000) or liquidity (>= 10000) is big and whose price is in the band (0.02-0.98)
//   config.filter.dropLadders        boolean   drop Kalshi strike ladders entirely (default false: rank airs the line)
//   config.filter.ladderExcludePatterns (RegExp|string)[]  ladders that never air (vendor index trivia)
//   config.filter.expiredGraceHours  number    drop quiet, pinned (<=5% or >=95%) markets whose closesAt passed more
//                                              than this long ago (default 48)
//
// Notes / deliberate calls:
//   - Promo tags ("Earn 3.25%", "Rewards 20, 4.5, 50", "Hide From New") decorate real events such as the
//     Balance of Power market, so they are IGNORED for categorization instead of excluding the market.
//     Promo-looking titles are still dropped via excludePatterns.
//   - When no tag maps, the category is inferred from title keywords before falling back.

const DEFAULT_EXCLUDE = ['sports', 'esports', 'games', 'crypto', 'mentions', 'promo'];
const DEFAULT_TAG_MAP = {
  politics: 'politics', elections: 'elections', election: 'elections', midterms: 'elections',
  geopolitics: 'geopolitics', world: 'world', economy: 'economy', fed: 'economy', economics: 'economy',
  financials: 'economy', commodities: 'economy', courts: 'courts', tech: 'tech', 'science and technology': 'tech',
  science: 'science', health: 'health', culture: 'culture', 'pop culture': 'culture', entertainment: 'culture',
  'climate and weather': 'weather', weather: 'weather',
  sports: 'sports', soccer: 'sports', tennis: 'sports', games: 'sports', esports: 'esports', crypto: 'crypto',
  'crypto prices': 'crypto', bitcoin: 'crypto', mentions: 'mentions',
};
const DEFAULT_SENSITIVE_TAGS = ['military', 'military action', 'military actions', 'military strikes', 'war', 'warfare'];
const PROMO_TAG = /^(earn\b|rewards?\b|hide[ -]from[ -]new|promo|airdrop)/i; // tags only: never drops the market, just ignored for category
// Always-on noise checks, applied even if config.categories.excludePatterns is missing.
const BUILTIN_NOISE = [
  { category: 'crypto', re: /\b(bitcoin|btc|ethereum|eth|solana|xrp|dogecoin)\b.*\b(above|below|between|reach|hit|dip|price)\b/i },
  { category: 'crypto', re: /\bup or down\b/i },
  { category: 'mentions', re: /#\s*(of\s+)?tweets|\btweets? (this|next) week\b|\bhow many (tweets|posts)\b/i },
  // Multi-leg combos: "Democrats hold 240 or more seats ... AND hold 54 or more seats ..." (capital AND is Kalshi's leg joiner).
  { category: 'novelty', re: /\b(hold|win|wins|holds)\b[^•]*\sAND\s[^•]*\b(hold|win|wins|holds)\b/ },
  { category: 'sports', re: /\b(o\/u \d|spread:|total sets|set \d winner|game \d winner|\(bo\d\)|win on \d{4}-\d{2}-\d{2})/i },
];

// "Highest temperature in Warsaw on November 5?", "NYC high temp today", "Will it rain in Seattle on Nov 6?"
const DAILY_WEATHER = /\b(highest|lowest|high|low|max(imum)?|min(imum)?) temp(erature)?\b.*\b(on|today|tomorrow)\b|\b(rain|snow)\b.*\bon (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w* \d/i;

// Title keyword -> category, used only when tags do not map. Order matters (first match wins).
const TITLE_CATEGORIES = [
  ['weather', /\b(temperature|high temp|rainfall|\brain\b|snow(fall)?|hurricane|tornado|heat ?wave|°f|degrees)\b/i],
  ['courts', /\b(supreme court|scotus|justice \w+|alito|sotomayor|indict\w*|convict\w*|sentenc\w*|trial|lawsuit|ruling|court)\b/i],
  ['economy', /\b(fed|fomc|interest rates?|rate (cut|hike)|bps|cpi|inflation|gdp|recession|unemployment|jobs report|payrolls|oil|crude|wti|brent|gas prices?|tariffs?|ipo|stocks?|s&p|nasdaq|dow|treasury|yields?|market cap|trade deficit|hormuz)\b/i],
  ['health', /\b(covid|measles|vaccines?|fda|flu|bird flu|h5n1|ozempic|wegovy|cdc|pandemic|outbreak)\b/i],
  ['tech', /\b(ai|openai|anthropic|chatgpt|gpt-?\d|gemini|nvidia|apple|google|microsoft|meta|tesla|spacex|starship|iphone|chips?|semiconductor|gpu)\b/i],
  ['science', /\b(aliens?|ufo|uap|nasa|moon|mars|asteroid|comet|space)\b/i],
  ['culture', /\b(oscars?|grammys?|emmys?|golden globes?|billboard|album|box office|movie|film|netflix|spotify|time person of the year|pope|taylor swift|celebrity)\b/i],
  ['elections', /\b(election|elections|senate|house seat|governor|mayor(al)?|nominee|nomination|primary|ballot|electoral|midterms?|balance of power)\b/i],
  ['geopolitics', /\b(putin|russia|ukraine|zelensky|xi jinping|china|taiwan|iran|israel|netanyahu|nato|north korea|kim jong|prime minister|parliament|chancellor|eu\b|european union)\b/i],
  ['politics', /\b(trump|biden|vance|congress|democrats?|republicans?|gop|white house|executive order|impeach\w*|approval rating|cabinet|shutdown|president)\b/i],
];

// A broad tag ('world', 'geopolitics', 'climate & science', 'culture') can hide a story that clearly belongs to a
// specific desk: "Bank of Japan Decision in December?" (tagged world), "Measles cases in U.S." (tagged weather),
// "Human moon landing in 2026?" (tagged tech). These title cues re-home a market only from the broad categories.
const TITLE_OVERRIDES = [
  ['economy', /\b(central bank|bank of (japan|england|canada|russia|mexico|brazil|korea|israel)|reserve bank|national bank decision|ecb|boj|rate (cut|hike)s?|interest rates?|inflation|cpi|gdp|recession|treasury yield|ipo|market cap)\b/i,
    ['world', 'geopolitics', 'weather', 'science', 'culture']],
  ['health', /\b(measles|pandemic|outbreak|bird flu|h5n1|covid|vaccines?|fda|cdc|plague)\b/i, ['world', 'weather', 'science', 'culture', 'tech']],
  ['science', /\b(moon landing|on the moon|mars|asteroid|meteor|comet|nasa|aliens?|ufos?|uaps?)\b/i, ['tech', 'culture', 'weather', 'world']],
  // US cabinet / administration personnel are domestic politics, not World ("Hegseth out as Secretary of Defense").
  ['politics', /\b(secretary of (defense|war|state|the treasury|homeland security|labor|commerce|health)|attorney general|press secretary|fbi director|cabinet|hegseth|white house)\b/i, ['geopolitics', 'world']],
  // House/Senate seat counts and district races tagged plain politics belong to elections (board quotas, desks).
  ['elections', /\b(senate seats?|house seats?|house race|senate race|governor race)\b/i, ['politics']],
  ['elections', /\b[A-Z]{2}-\d{2}\b/, ['politics']],  // district codes like NC-03 (case-sensitive on purpose)
];

const toRe = (p) => (p instanceof RegExp ? p : new RegExp(String(p), 'i'));
const normTag = (t) => String(t || '').toLowerCase().trim();

function tagMapEntries(config) {
  const tm = config?.categories?.tagMap;
  if (!tm) return Object.entries(DEFAULT_TAG_MAP);
  if (Array.isArray(tm)) return tm.map((e) => (Array.isArray(e) ? e : [e.tag ?? e.match, e.category]));
  return Object.entries(tm);
}

// Memoize the compiled config per config object (classify runs on every market every poll).
const compiled = new WeakMap();
function compile(config) {
  const key = config && typeof config === 'object' ? config : compiled;
  if (compiled.has(key)) return compiled.get(key);
  const cats = config?.categories || {};
  const map = new Map();
  for (const [k, v] of tagMapEntries(config)) if (k && v) map.set(normTag(k), String(v).toLowerCase());
  const noise = [...(cats.excludePatterns || []).map((p) => ({ category: p.category || 'noise', re: toRe(p.re ?? p) })), ...BUILTIN_NOISE];
  const sens = config?.sensitive || {};
  const c = {
    include: (cats.include || []).map((s) => String(s).toLowerCase()),
    exclude: new Set((cats.exclude || DEFAULT_EXCLUDE).map((s) => String(s).toLowerCase())),
    fallback: cats.fallback || 'world',
    map,
    noise,
    sensitiveMode: sens.mode || 'exclude',
    sensitiveRes: (sens.excludePatterns || []).map(toRe),
    sensitiveTags: new Set((sens.excludeTags || DEFAULT_SENSITIVE_TAGS).map(normTag)),
    minVolume: config?.filter?.minVolume24h ?? 1000,
    lowVolume: config?.filter?.lowVolume24h ?? 200,
    lowTotal: config?.filter?.lowVolumeTotal ?? 25_000,
    lowLiquidity: config?.filter?.lowVolumeLiquidity ?? 10_000,
    lowExclude: new Set((config?.filter?.lowFloorExcludeCategories ?? ['elections', 'politics']).map(normTag)),
    lowBand: config?.filter?.lowFloorPriceBand ?? [0.02, 0.98],
    excludeFreq: new Set((config?.filter?.excludeFrequencies ?? ['fifteen_min', 'hourly']).map(normTag)),
    dailyCats: new Set((config?.filter?.dailyCategories ?? ['economics', 'financials', 'commodities', 'companies']).map(normTag)),
    dailyMinVolume: config?.filter?.dailyMinVolume ?? 50_000,
    dailyWeatherMinVolume: config?.filter?.dailyWeatherMinVolume ?? 50_000,
    dropLadders: config?.filter?.dropLadders ?? false,
    ladderNoise: (config?.filter?.ladderExcludePatterns || []).map(toRe),
    expiredGraceMs: (config?.filter?.expiredGraceHours ?? 48) * 3_600_000,
  };
  compiled.set(key, c);
  return c;
}

function lookupTag(c, tag) {
  const t = normTag(tag);
  return c.map.get(t) ?? c.map.get(t.replace(/-/g, ' ')) ?? null;
}

export function inferCategoryFromText(text, fallback = 'world') {
  for (const [cat, re] of TITLE_CATEGORIES) if (re.test(text)) return cat;
  return fallback;
}

export function classify(market, config = {}, { now = Date.now() } = {}) {
  const c = compile(config);
  const m = market || {};
  const text = [m.title, m.eventTitle, m.outcome].filter(Boolean).join(' • ');
  const tags = (m.tags || []).map(normTag).filter((t) => t && !PROMO_TAG.test(t));

  // 1. Tags: first mapped tag (in tag order) gives the category; any excluded mapping excludes.
  let category = null;
  for (const t of tags) {
    const cat = lookupTag(c, t);
    if (!cat) continue;
    if (c.exclude.has(cat)) return { keep: false, category: cat, reason: `excluded:${cat}` };
    if (!category) category = cat;
  }
  // 2. Title fallback.
  if (!category) category = inferCategoryFromText(text, c.fallback);
  else for (const [cat, re, from] of TITLE_OVERRIDES) if (from.includes(category) && re.test(text)) { category = cat; break; }

  // 2b. Kalshi combo tickers (KXMEGATSUNAMICOMBO-..., KX...COMBO-...).
  if (/^ks:[A-Z0-9]*COMBO/i.test(String(m.id || '')) || /^ks:[A-Z0-9]*COMBO/i.test(String(m.eventId || ''))) return { keep: false, category: 'novelty', reason: 'title:novelty' };

  // 3. Title noise patterns (sports/esports/crypto brackets/mentions/promo).
  for (const p of c.noise) {
    if (p.re.test(text)) return { keep: false, category: p.category, reason: `title:${p.category}` };
  }

  // 3b. Structural noise from source tags: short-cycle recurring series (daily temperature, daily oil close,
  // hourly approval...) whose 'previous price' is just the listing price, and cumulative strike ladders.
  for (const t of tags) {
    if (t.startsWith('freq:') && c.excludeFreq.has(t.slice(5))) return { keep: false, category, reason: `recurring:${t.slice(5)}` };
    if (t === 'kalshi:ladder' && c.dropLadders) return { keep: false, category, reason: 'ladder' };
    if (t === 'kalshi:ladder' && c.ladderNoise.some((re) => re.test(text) || tags.some((x) => re.test(x)))) return { keep: false, category, reason: 'ladder-noise' };
  }
  // 3c. Daily series air only from economy-type Kalshi categories (gas, oil, CPI, indexes), or on real money.
  // Daily city-temperature brackets on either exchange are novelty unless a market carries real money.
  const vol = Number(m.volume24h) || 0;
  if (tags.includes('freq:daily') && !tags.some((t) => c.dailyCats.has(t)) && vol < c.dailyMinVolume) {
    return { keep: false, category, reason: 'recurring:daily' };
  }
  if (category === 'weather' && DAILY_WEATHER.test(text) && vol < c.dailyWeatherMinVolume) {
    return { keep: false, category, reason: 'daily-weather' };
  }

  // 4. Sensitive (DECISIONS D4).
  if (c.sensitiveMode === 'exclude') {
    if (tags.some((t) => c.sensitiveTags.has(t) || c.sensitiveTags.has(t.replace(/-/g, ' ')))) return { keep: false, category, reason: 'sensitive:tag' };
    if (c.sensitiveRes.some((re) => re.test(text))) return { keep: false, category, reason: 'sensitive' };
  }

  // 5. Data sanity.
  if (m.yesPrice == null || !Number.isFinite(m.yesPrice)) return { keep: false, category, reason: 'no-price' };
  if (!(Number(m.volume24h) >= c.minVolume)) {
    // Low floor (pool widening): non-election/politics markets with a big lifetime volume or liquidity may air from
    // lowVolume24h; they are THIN by definition (thinVolume) and rank lower. Daily/recurring noise was dropped above.
    const big = (Number(m.volumeTotal) || 0) >= c.lowTotal || (Number(m.liquidity) || 0) >= c.lowLiquidity;
    const inBand = m.yesPrice >= c.lowBand[0] && m.yesPrice <= c.lowBand[1];
    if (!(Number(m.volume24h) >= c.lowVolume && big && inBand && !c.lowExclude.has(category))) return { keep: false, category, reason: 'dead-volume' };
  }
  // Past its close date by more than the grace period: awaiting resolution, not news.
  const closes = m.closesAt ? Date.parse(m.closesAt) : NaN;
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  // Exchange end dates are unreliable (Polymarket's LA mayor market "ended" in June but trades heavily), so only drop
  // a past-close market when it is also quiet and pinned near 0 or 100.
  const quiet = m.change1d == null || Math.abs(m.change1d) < 0.02;
  const pinned = m.yesPrice <= 0.05 || m.yesPrice >= 0.95;
  if (Number.isFinite(closes) && nowMs - closes > c.expiredGraceMs && quiet && pinned) return { keep: false, category, reason: 'expired' };

  // 6. Category allow-list.
  if (c.exclude.has(category)) return { keep: false, category, reason: `excluded:${category}` };
  if (c.include.length && !c.include.includes(category)) return { keep: false, category, reason: `not-included:${category}` };

  return { keep: true, category, reason: 'ok' };
}

export default { classify, inferCategoryFromText };
