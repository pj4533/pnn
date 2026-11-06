// News-to-market matcher: given a news cluster (server/sources/wire.mjs), find the prediction markets that price it.
//
// await matchMarkets(cluster, marketIndex, opts?) -> [{market, score, why}] best first (empty when nothing is relevant)
//   cluster      {title, items:[{title}], category?}  (a wire Cluster; a bare {title} works too)
//   marketIndex  Market[] (docs/ARCHITECTURE.md contract) PNN already holds; raw or filtered, both fine
//   opts.search  true (default) | false   live search fallback (Polymarket public-search + Kalshi v1 search)
//                when the local index has no strong hit
//   opts.config  PNN config for filter.classify (default: server/config.mjs)
//   opts.now     epoch ms
//   opts.limit   max results (default 6), at most opts.perEvent (default 2) outcomes per event
//   opts.searchWaitMs  how long a live search may wait for its rate-limit slot (default 0 = skip when busy)
//
// Scoring (see DECISIONS "2026-11-04: news wire"):
//   - Topic dictionary (Fed/FOMC/Powell -> Fed rates, CPI/inflation, Banxico, Putin/Kremlin, SCOTUS + justices,
//     OpenAI/GPT, Google/Gemini, Anthropic/Claude, SpaceX/Starship, Oscars, Billboard, hurricanes by name,
//     country -> leader ...). A topic counts when it hits BOTH the news and the market text.
//   - Content-token overlap weighted by IDF over the market index (event-level document frequency), so a word that
//     appears in many markets ("Trump", "election", "2026") counts little and a rare one ("Talarico") counts a lot.
//   - A match needs >= 2 independent signals (topic hits + shared distinctive tokens; tokens a topic already
//     covers do not count twice) and at least one of them must be a topic or a rare token. One shared word
//     ("Texas") never matches on its own.
//   - Boosts: 24h volume (log), closes within 30 days; markets pinned near 0/100 are damped.
//   - Every candidate goes through filter.classify, so noise and sensitive markets never match.
import { classify } from './filter.mjs';
import { tokens, tokenSet } from './text.mjs';
import { log } from '../log.mjs';
import { badNewsSource, looksCut, nonLatin, learnWords } from '../sources/news.mjs';
import * as newsSrc from '../sources/news.mjs';
import wireConfig from '../wire-config.mjs';
import pnnConfig from '../config.mjs';

// Sensitive headlines (DECISIONS D4, QUEUED-FIXES 16): every attached headline (wire, search, flash, Story of the Day)
// passes the same war / violence / death patterns as the markets (config.sensitive) and the wire parse (wire-config
// filters.sensitive). news.mjs badNewsSource applies them too; this is the matcher's own guard so no path skips it.
const SENSITIVE_HEAD = [...(wireConfig?.filters?.sensitive || []), ...(pnnConfig?.sensitive?.excludePatterns || []), /\bdeadly\b|\bfatal\w*\b|\bgunfire\b|\bwounded\b/i]
  .map((r) => (r instanceof RegExp ? r : new RegExp(r, 'i')));
// A site's own page title from a search hit ("Federal Reserve Board - Home", "Calendar") is not a headline.
const SITE_TITLE = /^(home|home ?page|calendar|news|newsroom|latest news|press releases?|login|sign in|contact( us)?|about( us)?|search|sitemap|untitled|welcome|page not found|access denied)$|\s[-|–—:]\s*(home|home ?page|official (web)?site|welcome|calendar|newsroom)$/i;
// Non-news items (2026-11-05 news unlock audit): a careers-page job title ("Procurement Operations Manager - OpenAI"), a
// deal ad ("Get GPT, Claude, Gemini ... for $39.99 for life", "Project Professional 2024 drops to $40") or a quote page
// ("Gold Dec 26 (GC=F) stock price, news, quote and history", "USOIL|WTI|Price:89.865|Chg%:+1.824") is not a headline.
const JOB_ROLE = '(manager|engineer|lead|director|specialist|analyst|coordinator|intern|internship|recruiter|scientist|researcher|designer|counsel|architect|representative|associate|administrator|strategist|partner|technician)';
const JOB_TITLE = new RegExp(`^(?:(?:[A-Z][\\w&/+.'-]*|&),?\\s+){0,6}${JOB_ROLE}(?:,\\s*[A-Z][\\w&/ +.'-]{0,40})?(?:\\s+[-\u2013\u2014|@]\\s+[A-Z][\\w&. ]{1,40})?$`, 'i');
const JOB_NEWS_VERB = /\b(names?|named|hires?|hired|appoints?|appointed|picks?|taps?|tapped|promotes?|promoted|says?|said|joins?|joined|leaves?|left|quits?|resigns?|fires?|fired|ousts?|ousted|to|is|was|will|after|as|for|on)\b/i;
const DEAL_AD = /\$\d[\d.,]*\b.*\bfor life\b|\bfor life\b.*\$\d|\blifetime (licen[cs]e|subscription|access|deal)\b|\blowest price (ever|yet|of the year)\b|\ball-time low price\b|\b\d{1,2}% off\b|\$\d{1,4}\.99\b|\bdeal alert\b|\bdrops? to \$\d{1,3}(\.\d\d)?(?![\d,.])|\bcoupon\b|\bpromo code\b/i;
const QUOTE_PAGE = /\bstock price,? news,? quote\b|\bquote (and|&) history\b|\(\w{1,6}=F\)|^[A-Z0-9]{2,10}\s*\|[^|]*\|\s*price\s*:|\|\s*chg%?\s*:/i;
/** 'job' | 'deal' | 'quote' | null: an item that is not news at all (see JOB_TITLE / DEAL_AD / QUOTE_PAGE). */
export function nonNewsItem(title) {
  const t = String(title || '').trim();
  if (!t) return null;
  if (QUOTE_PAGE.test(t)) return 'quote';
  if (DEAL_AD.test(t)) return 'deal';
  if (t.split(/\s+/).length <= 12 && JOB_TITLE.test(t) && !JOB_NEWS_VERB.test(t.replace(/\s[-\u2013\u2014|@]\s.*$/, ''))) return 'job';
  return null;
}
/** Why a headline may never be attached to a story or flash ('sensitive' | 'site-title' | 'non-news' | null). */
export function headlineReject(it) {
  const t = String((typeof it === 'string' ? it : it?.title) || '').trim();
  if (!t) return 'empty';
  const b = pnnConfig?.sensitive?.headlineBenign;   // "trade war", "dead heat": figures of speech, not D4 content
  const tb = b ? t.replace(new RegExp(b.source || b, 'gi'), ' ') : t;
  if (newsSrc.sensitiveHeadline?.(t) || SENSITIVE_HEAD.some((re) => re.test(tb))) return 'sensitive';
  if (nonNewsItem(t)) return 'non-news';
  if (SITE_TITLE.test(t) || t.split(/\s+/).length < 2 || (typeof it === 'object' && newsSrc.junkTitle?.(it))) return 'site-title';
  return null;
}

const DAY = 86_400_000;

// ---------- topic dictionary ----------
// news: RegExp on the news text; market: RegExp on market text; covers: tokens (text.mjs tokens) the topic
// already accounts for; query: live-search query; w: weight.
const T = (key, news, market, covers, query, w = 5, group = key) => ({ key, news, market, covers: new Set(covers), query, w, group });
export const TOPICS = [
  T('fed-rates', /\b(Fed|FED|Federal Reserve|FOMC|Powell|Warsh|Hassett|Waller|Bowman)\b/,
    /\b(fed|federal reserve|fomc|fed chair)\b/i, ['fed', 'powell', 'warsh', 'hassett', 'waller', 'bowman'], 'fed rate', 6),
  // Generic rate words: context only (weight 2, half a signal), so "Bank of Mexico cuts rates" never pulls Fed markets
  // on its own and "Fed signals December hike" gets credit for "hike".
  T('rates', /\b(rate (cut|hike)s?|interest rates?|cuts? rates|raises? rates|hikes? rates|holds? rates|rates steady|basis points?|quarter point|half point)\b/i,
    /\b(rates?|bps|cut|hike|increase|decrease|no change)\b/i, ['rate', 'cut', 'hike', 'bps', 'increase', 'decrease', 'steady', 'hold'], null, 2),
  T('inflation', /\b(CPI|inflation|consumer prices?|PCE)\b/i, /\b(cpi|inflation|pce)\b/i, ['cpi', 'inflation', 'consumer', 'price', 'pce'], 'inflation', 6),
  T('jobs', /\b(jobs report|payrolls?|unemployment|jobless)\b/i, /\b(unemployment|payrolls?|jobs report|jobless)\b/i, ['job', 'payroll', 'unemployment', 'jobless'], 'unemployment rate', 6),
  T('gdp', /\b(GDP|gross domestic product|recession)\b/i, /\b(gdp|recession)\b/i, ['gdp', 'gross', 'domestic', 'product', 'recession'], 'gdp', 6),
  T('tariffs', /\btariffs?\b/i, /\btariffs?\b/i, ['tariff'], 'tariffs', 5),
  T('shutdown', /\b(government shutdown|shutdown)\b/i, /\bshutdown\b/i, ['shutdown', 'government'], 'government shutdown', 6),
  T('banxico', /\b(Bank of Mexico|Banxico)\b/i, /\b(bank of mexico|banxico)\b/i, ['bank', 'mexico', 'banxico'], 'bank of mexico', 7),
  T('boe', /\bBank of England\b|\bBoE\b/, /\bbank of england\b/i, ['bank', 'england', 'boe'], 'bank of england', 7),
  T('boj', /\bBank of Japan\b|\bBoJ\b/, /\bbank of japan\b/i, ['bank', 'japan', 'boj'], 'bank of japan', 7),
  T('ecb', /\b(ECB|European Central Bank|Lagarde)\b/, /\b(ecb|european central bank)\b/i, ['ecb', 'european', 'central', 'bank', 'lagarde'], 'ecb', 7),
  T('oil', /\b(oil|crude|brent|WTI|OPEC)\b/i, /\b(oil|wti|brent|crude|opec)\b/i, ['oil', 'crude', 'brent', 'wti', 'opec', 'barrel'], 'oil price', 5),
  T('gold', /\bgold\b/i, /\bgold\b/i, ['gold', 'ounce'], 'gold price', 5),
  T('putin', /\b(Putin|Kremlin)\b/, /\bputin\b/i, ['putin', 'kremlin'], 'putin', 6),
  T('scotus', /\b(Supreme Court|SCOTUS|Chief Justice|Justices?\s+(Roberts|Thomas|Alito|Sotomayor|Kagan|Gorsuch|Kavanaugh|Barrett|Jackson))\b/i,
    /\b(supreme court|scotus|(?<!department of )justice(?! (dept|department)\b)|roberts|alito|sotomayor|kagan|gorsuch|kavanaugh|barrett)\b/i,
    ['scotus', 'justice', 'chief', 'roberts', 'thomas', 'alito', 'sotomayor', 'kagan', 'gorsuch', 'kavanaugh', 'barrett', 'court'], 'supreme court', 6),
  T('openai', /\b(OpenAI|ChatGPT|GPT-?\d[\w.]*|Sam Altman|Altman)\b/i, /\b(openai|chatgpt|gpt-?\d|altman)\b/i, ['openai', 'chatgpt', 'altman', 'sam', 'gpt'], 'openai', 7),
  T('google-ai', /\b(Gemini|DeepMind|Google|Alphabet)\b/, /\b(google|gemini|alphabet|deepmind)\b/i, ['google', 'gemini', 'alphabet', 'deepmind'], 'google gemini', 5),
  T('anthropic', /\b(Anthropic|Claude)\b/, /\b(anthropic|claude)\b/i, ['anthropic', 'claude'], 'anthropic', 7),
  T('nvidia', /\bNvidia\b/i, /\b(nvidia|nvda)\b/i, ['nvidia', 'nvda'], 'nvidia', 6),
  T('tesla', /\b(Tesla|Musk)\b/, /\b(tesla|musk|tsla)\b/i, ['tesla', 'musk', 'elon', 'tsla'], 'tesla', 4, 'musk'),
  T('spacex', /\b(SpaceX|Starship|Falcon 9)\b/i, /\b(spacex|starship)\b/i, ['spacex', 'starship', 'falcon'], 'spacex starship', 6, 'musk'),
  T('oscars', /\b(Oscars?|Academy Awards?)\b/i, /\b(oscars?|academy awards?)\b/i, ['oscar', 'academy', 'award'], 'oscars', 7),
  T('grammys', /\bGrammys?\b/i, /\bgrammys?\b/i, ['grammy'], 'grammys', 7),
  T('emmys', /\bEmmys?\b/i, /\bemmys?\b/i, ['emmy'], 'emmys', 7),
  T('billboard', /\b(Billboard|Hot 100)\b/i, /\b(billboard|hot 100)\b/i, ['billboard', 'hot', '100'], 'billboard hot 100', 6),
  T('box-office', /\bbox office\b/i, /\bbox office\b|\bopening weekend\b/i, ['box', 'office', 'opening', 'weekend'], 'box office', 6),
  T('time-poy', /\bperson of the year\b/i, /\bperson of the year\b/i, ['person'], 'time person of the year', 7),
  T('pope', /\b(Pope|Vatican)\b/, /\b(pope|vatican)\b/i, ['pope', 'vatican'], 'pope', 6),
  T('epstein', /\bEpstein\b/, /\bepstein\b/i, ['epstein'], 'epstein', 6),
  T('measles', /\b(measles|bird flu|H5N1)\b/i, /\b(measles|bird flu|h5n1)\b/i, ['measle', 'measles', 'bird', 'flu', 'h5n1'], 'measles', 6),
  T('aliens', /\b(UFOs?|UAPs?|aliens?|extraterrestrial)\b/i, /\b(ufos?|uaps?|aliens?)\b/i, ['ufo', 'uap', 'alien'], 'aliens', 6),
  T('leaves-office', /\b(steps? down|stepping down|resign\w*|ousted|ouster|out as|leaves? office|impeach\w*|removed from office|no-confidence|confidence vote)\b/i,
    /\b(out as|out by|resign\w*|leaves? office|step down|removed|impeach\w*|no-confidence|ousted)\b/i, ['out', 'resign', 'resignation', 'step', 'leave', 'office', 'ousted', 'impeach', 'impeachment', 'removed'], null, 4),
  T('ai', /\b(AI|artificial intelligence)\b/, /\b(ai|artificial intelligence)\b/i, ['ai'], null, 3),
  // Video games (news-gated 'games' category, 2026-11-05).
  T('gta', /\b(GTA ?(6|VI)|Grand Theft Auto)\b/i, /\b(gta|grand theft auto)\b/i, ['gta', 'grand', 'theft', 'auto', 'vi', '6'], 'gta 6', 7),
  T('game-awards', /\b(The Game Awards|Game of the Year|GOTY|Golden Joysticks?)\b/i, /\b(game awards|game of the year|golden joystick)\b/i, ['game', 'award', 'goty', 'golden', 'joystick'], 'game of the year', 7),
  T('ps6', /\b(PS6|PlayStation 6)\b/i, /\b(ps6|playstation 6)\b/i, ['ps6', 'playstation'], 'playstation 6', 7),
  // country -> leader (low weight: a country name alone is never enough)
  T('uk-leader', /\b(UK|U\.K\.|Britain|British|Starmer|Downing Street|Burnham)\b/, /\b(uk|britain|british|starmer|burnham|prime minister of the united kingdom)\b/i, ['uk', 'starmer', 'burnham', 'downingstreet'], null, 3),
  T('france-leader', /\b(France|French|Macron|Élysée|Elysee)\b/, /\b(france|french|macron)\b/i, ['france', 'french', 'macron'], null, 3),
  T('germany-leader', /\b(Germany|German|Merz|Bundestag)\b/, /\b(germany|german|merz)\b/i, ['germany', 'german', 'merz', 'bundestag'], null, 3),
  T('canada-leader', /\b(Canada|Canadian|Carney|Poilievre)\b/, /\b(canada|canadian|carney|poilievre)\b/i, ['canada', 'canadian', 'carney', 'poilievre'], null, 3),
  T('japan-leader', /\b(Japan|Japanese|Takaichi|Ishiba)\b/, /\b(japan|japanese|takaichi|ishiba)\b/i, ['japan', 'japanese', 'takaichi', 'ishiba'], null, 3),
  T('israel-leader', /\b(Israel|Israeli|Netanyahu|Knesset|Herzog)\b/, /\b(israel|israeli|netanyahu|knesset)\b/i, ['israel', 'israeli', 'netanyahu', 'knesset', 'herzog'], null, 3),
  T('ukraine-leader', /\b(Ukraine|Ukrainian|Zelensky[iy]?)\b/, /\b(ukraine|zelensky[iy]?)\b/i, ['ukraine', 'ukrainian', 'zelensky', 'zelenskiy', 'zelenskyy'], null, 3),
  T('china-leader', /\b(China|Chinese|Xi Jinping|Beijing)\b/, /\b(china|chinese|xi jinping|xi)\b/i, ['china', 'chinese', 'xi', 'jinping', 'beijing'], null, 3),
  T('venezuela', /\b(Venezuela|Maduro|Machado)\b/, /\b(venezuela|maduro|machado)\b/i, ['venezuela', 'maduro', 'machado'], null, 4),
  T('argentina', /\b(Argentina|Milei)\b/, /\b(argentina|milei)\b/i, ['argentina', 'milei'], null, 4),
  T('brazil', /\b(Brazil|Lula|Bolsonaro)\b/, /\b(brazil|lula|bolsonaro)\b/i, ['brazil', 'lula', 'bolsonaro'], null, 4),
  T('iran-leader', /\b(Iran|Iranian|Khamenei|Tehran)\b/, /\b(iran|khamenei)\b/i, ['iran', 'iranian', 'khamenei', 'tehran'], null, 3),
];

// Hurricanes / tropical storms by name: "Hurricane Melissa" -> market text must contain "melissa".
function dynamicTopics(text) {
  const out = [];
  for (const m of text.matchAll(/\b(?:Hurricane|Tropical Storm|Typhoon|Cyclone)\s+([A-Z][a-z]+)\b/g)) {
    const name = m[1].toLowerCase();
    if (out.some((t) => t.key === `storm:${name}`)) continue;
    out.push(T(`storm:${name}`, /./, new RegExp(`\\b${name}\\b`, 'i'), [name, 'hurricane', 'storm', 'tropical'], `hurricane ${name}`, 7));
  }
  return out;
}

// Words that carry no matching signal even when rare in the index.
const WEAK = new Set(['candidate', 'backed', 'senator', 'governor', 'lawmaker', 'trump', 'biden', 'vance', 'us', 'american', 'america', 'democrat', 'republican', 'gop', 'president', 'say', 'says', 'win', 'won', 'wins', 'lose', 'lost', 'race', 'vote', 'voter', 'poll', 'call', 'result',
  'leader', 'party', 'state', 'government', 'official', 'people', 'time', 'end', 'high', 'low', 'rise', 'fall', 'jump', 'drop',
  'deal', 'move', 'record', 'major', 'world', 'country', 'nation', 'public', 'bill', 'law', 'plan', 'group', 'talk', 'meeting',
  'next', 'former', 'top', 'help', 'push', 'face', 'seek', 'run', 'back', 'amid', 'over', 'after', 'reveal', 'hit', 'take',
  'november', 'december', 'october', 'january', '2026', '2027', '2028', 'month', 'end', 'live', 'night', 'stock', 'share', 'market']);

// ---------- geography (local story on a national market, wrong country) ----------
// [canonical, alternation]: countries (and their demonyms) plus US states. A story that names one of these needs the
// headline to name it too ("Canada's GDP" never takes "Czech retail sales"); a national story (no state, "national",
// "US average") never takes a headline about one state or county ("Fairfield gas prices ... state average").
const STATES = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'west virginia', 'wisconsin', 'wyoming'];
const COUNTRIES = [['canada', 'canadian|carney|ottawa|toronto|poilievre'], ['mexico', 'mexican|sheinbaum|banxico'], ['france', 'french|macron|paris|le pen|mélenchon|melenchon'], ['germany', 'german|merz|berlin|bundestag'], ['italy', 'italian'], ['spain', 'spanish|madrid|sánchez|sanchez'], ['portugal', 'portuguese'],
  ['uk', 'britain|british|england|english|scotland|scottish|wales|welsh|u\\.k\\.|starmer|london|downing street|westminster'], ['ireland', 'irish'], ['netherlands', 'dutch'], ['belgium', 'belgian'], ['switzerland', 'swiss'], ['austria', 'austrian'], ['poland', 'polish'],
  ['czech', 'czechia|czech republic'], ['hungary', 'hungarian'], ['romania', 'romanian'], ['bulgaria', 'bulgarian'], ['greece', 'greek'], ['turkey', 'turkish|türkiye|turkiye|erdogan|erdoğan|ankara'], ['sweden', 'swedish'], ['norway', 'norwegian'],
  ['denmark', 'danish'], ['finland', 'finnish'], ['russia', 'russian|putin|kremlin|moscow'], ['ukraine', 'ukrainian|zelensky|zelenskyy|zelenskiy|kyiv|kiev'], ['israel', 'israeli|netanyahu|knesset|jerusalem|tel aviv|herzog'], ['iran', 'iranian|tehran|khamenei'], ['iraq', 'iraqi'], ['syria', 'syrian'], ['saudi', 'saudi arabia'],
  ['egypt', 'egyptian'], ['nigeria', 'nigerian'], ['kenya', 'kenyan'], ['south africa', 'south african'], ['ethiopia', 'ethiopian'], ['china', 'chinese|beijing|xi jinping'], ['japan', 'japanese|tokyo|takaichi|ishiba'], ['korea', 'korean|south korea|north korea'],
  ['taiwan', 'taiwanese'], ['india', 'indian|modi|delhi|mumbai'], ['pakistan', 'pakistani'], ['bangladesh', 'bangladeshi'], ['indonesia', 'indonesian'], ['philippines', 'philippine|filipino'], ['vietnam', 'vietnamese'], ['thailand', 'thai'],
  ['malaysia', 'malaysian'], ['singapore', 'singaporean'], ['australia', 'australian'], ['new zealand', 'kiwi|luxon|wellington|auckland'], ['brazil', 'brazilian|lula|bolsonaro'], ['argentina', 'argentine|argentinian|milei'], ['chile', 'chilean'], ['colombia', 'colombian'],
  ['peru', 'peruvian'], ['venezuela', 'venezuelan|maduro|machado|caracas'], ['cuba', 'cuban'], ['haiti', 'haitian'], ['hong kong', 'hongkong'], ['uae', 'united arab emirates|emirati|abu dhabi|dubai'], ['qatar', 'qatari|doha'], ['europe', 'european|eurozone|euro area']];
const GEO = [...STATES.map((n) => [n, n, 'state']), ...COUNTRIES.map(([n, alt]) => [n, `${n}|${alt}`, 'country'])]
  .map(([name, alt, kind]) => ({ name, kind, re: new RegExp(`(?<![a-z])(?:${alt})(?![a-z])`, 'i'), prim: new RegExp(`(?<![a-z])${name}(?![a-z])`, 'i') }));
export function geoNames(text, primaryOnly = false) {
  const t = String(text || '');
  const out = new Set();
  for (const g of GEO) if ((primaryOnly ? g.prim : g.re).test(t)) out.add(g.name);
  // "US" / "U.S." only count as a country when the text is not about a state; the national check below handles it
  return out;
}
const STATE_SET = new Set(STATES);
const NATIONAL_RE = /\b(national|nationwide|united states|american|across the (country|nation)|us average|u\.s\.|average us|us 30-year|us imports?|us exports?)\b/i;
const NATIONAL_STORY = { test: (t) => NATIONAL_RE.test(t) || /\bUS\b/.test(t) };
const NATIONAL_HEAD = /\b(national|nationwide|united states|american|americans|u\.s\.|us|across the (country|nation)|aaa|federal|washington|nation)\b/i;
const LOCAL_HEAD = /\b(county|counties|township|borough|parish|village of|statewide|state average|state's average|local|neighborhood|school district|city council|mayor|town of|city of)\b/i;
const DISTRICT = /\b[A-Z]{2}-\d{1,2}\b/;
// Central banks are places of their own (2026-11-05 news-gate build): a Bank of England hike is not Bank of Canada news.
// A story that names one bank never takes a headline that names only other banks.
const BANKS = [['fed', /\b(fed|federal reserve|fomc|powell|warsh)\b/i], ['boc', /\bbank of canada\b|\bboc\b/i], ['boe', /\bbank of england\b|\bboe\b/i],
  ['ecb', /\b(european central bank|ecb|lagarde)\b/i], ['boj', /\b(bank of japan|boj)\b/i], ['rba', /\b(reserve bank of australia|rba)\b/i],
  ['snb', /\b(swiss national bank|snb)\b/i], ['rbnz', /\b(reserve bank of new zealand|rbnz)\b/i], ['banxico', /\b(banxico|bank of mexico)\b/i],
  ['pboc', /\b(people'?s bank of china|pboc)\b/i], ['rbi', /\b(reserve bank of india|rbi)\b/i], ['riksbank', /\briksbank\b/i], ['norges', /\bnorges bank\b/i]];
const banksIn = (t) => new Set(BANKS.filter(([, re]) => re.test(t)).map(([k]) => k));
function bankMismatch(st, h) {
  const s = banksIn(st);
  if (!s.size) return false;
  const hb = banksIn(h);
  return hb.size > 0 && ![...hb].some((b) => s.has(b));
}
// A US Senate / House / Governor market never takes a state-legislature headline ("Democrats flip two Alabama Senate seats
// as District 10 remains close" is the Alabama state senate, not the US Senate race).
const FED_OFFICE = /\b(senate|house|governor|gubernatorial|congress\w*)\b/i;
const STATE_LEG_STORY = /\b(state senate|state house|legislat\w*|assembly|district \d+|state (rep\w*|senator))\b/i;
const STATE_LEG_HEAD = new RegExp(`\\b(state senate|state house|statehouse|state legislat\\w*|legislatures?|legislative (seats?|races?|districts?|majorit\\w*|chambers?)|general assembly|state assembly|assembly (seats?|district)|state (rep|representative|senator)s?|district \\d+|(two|three|four|five|six|seven|eight|nine|ten|\\d+) (${STATES.join('|')}) (senate|house) seats)\\b`, 'i');
function legislatureMismatch(st, h) {
  return FED_OFFICE.test(st) && !STATE_LEG_STORY.test(st) && !DISTRICT.test(st) && STATE_LEG_HEAD.test(h);
}
/** true when a headline is about a place the (national) story is not: "Fairfield Gas Prices ... State Average". */
export function scopeMismatch(storyText, title) {
  const st = String(storyText || ''), h = String(title || '');
  if (bankMismatch(st, h) || legislatureMismatch(st, h)) return true;
  const sGeo = geoNames(st);
  if (sGeo.size || DISTRICT.test(st)) return false;           // the story names its own place: geoMiss handles that
  if (NATIONAL_HEAD.test(h)) return false;
  if (LOCAL_HEAD.test(h)) return true;                         // 'Wisconsin county ... statewide total' on a story that names no place
  if (!NATIONAL_STORY.test(st)) return false;
  for (const n of geoNames(h)) if (STATE_SET.has(n)) return true;
  return false;
}
/** true when the story names a country / state / city and the headline names none of them (nor the same leader topic). */
export function geoMiss(storyText, title) {
  // only a place named outright binds the headline: "English Premier League" / "French presidential" are not that
  const sGeo = geoNames(storyText, true);
  if (!sGeo.size) return false;
  const hGeo = geoNames(title);
  for (const g of sGeo) if (hGeo.has(g)) return false;
  // "Macron recommends ..." for a France story: a shared leader topic (country topics are the low-weight ones)
  for (const t of TOPICS) if (t.w <= 4 && t.market.test(storyText) && t.news.test(title)) return false;
  return true;
}

// ---------- index (cached per marketIndex array) ----------
const indexCache = new WeakMap();
function docText(m) { return `${m.eventTitle || ''} ${m.title || ''} ${m.outcome || ''}`; }
function buildIndex(markets) {
  if (indexCache.has(markets)) return indexCache.get(markets);
  const df = new Map();
  const byEvent = new Map();
  const docs = new Map();
  for (const m of markets) {
    if (!m?.id) continue;
    const tok = tokenSet(docText(m));
    docs.set(m.id, tok);
    let ev = byEvent.get(m.eventId);
    if (!ev) { ev = new Set(); byEvent.set(m.eventId, ev); }
    for (const t of tok) ev.add(t);
  }
  for (const ev of byEvent.values()) for (const t of ev) df.set(t, (df.get(t) || 0) + 1);
  const N = Math.max(byEvent.size, 50);
  // A word is "rare" when it is in at most ~1% of events (floor 7). A fixed 7-event cut stopped working once the
  // index held Polymarket AND Kalshi (~5.5k events): "Mississippi" is in 21 events there, so a Mississippi Senate
  // headline no longer matched the Mississippi Senate markets (2026-11-04).
  const rareDf = Math.max(7, Math.round(N / 100));
  const idx = { N, df, docs, rareIdf: Math.log((N + 1) / (rareDf + 1)), idf: (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) };
  indexCache.set(markets, idx);
  return idx;
}

// ---------- news side ----------
export function analyzeCluster(cluster) {
  const items = (cluster?.items?.length ? cluster.items : [{ title: cluster?.title || '' }]).filter((i) => !i.aggregator || cluster.items.length < 2);
  const titles = [cluster?.title, ...items.map((i) => i.title)].filter(Boolean);
  const uniq = [...new Set(titles)];
  const n = uniq.length;
  // Token weight = share of headlines in the cluster that carry it (consensus words matter most), floor 0.5 for
  // the representative title's own words.
  const tw = new Map();
  for (const t of uniq) for (const k of new Set(tokens(t))) tw.set(k, (tw.get(k) || 0) + 1 / n);
  for (const k of tokenSet(cluster?.title || '')) tw.set(k, Math.max(tw.get(k) || 0, 0.5));
  const text = uniq.join(' \n ');
  const topics = [...TOPICS.filter((t) => t.news.test(text)), ...dynamicTopics(text)];
  // Surface words for live-search queries: token -> original word from the representative title.
  const surface = new Map();
  for (const w of String(cluster?.title || '').split(/[\s,;:!?()“”"‘’']+/)) {
    const k = tokens(w)[0];
    if (k && !surface.has(k)) surface.set(k, w.replace(/[^\w.&-]/g, ''));
  }
  return { tw, topics, text, surface, title: String(cluster?.title || '') };
}

// ---------- scoring ----------
// Months, years and other context words: half a signal (they pick the right market inside a topic, they never
// make a match on their own).
const CONTEXT = /^(january|february|march|april|may|june|july|august|september|october|november|december|20\d\d|q[1-4])$/;
function scoreMarket(m, doc, news, idx, now) {
  const mtext = docText(m);
  const topicHits = news.topics.filter((t) => t.market.test(mtext));
  const covered = new Set();
  for (const t of topicHits) for (const c of t.covers) covered.add(c);
  let tokScore = 0, signals = 0, rareHits = 0;
  const hit = [];
  for (const [t, w] of news.tw) {
    if (!doc.has(t)) continue;
    const idf = news.idf(t);
    if (idf < 1) continue;                      // in most events: no signal
    tokScore += w * idf;
    if (w < 0.34) continue;                     // a word only one minor headline in the cluster used
    if (CONTEXT.test(t)) { signals += 0.5; hit.push(t); continue; }
    if (covered.has(t)) continue;               // already counted through its topic
    if (WEAK.has(t) || /^\d+$/.test(t)) continue;
    if (idf >= 1.8) { signals++; hit.push(t); }
    if (idf >= idx.rareIdf) rareHits++;
  }
  // Topics count once per group (Tesla + SpaceX = one Musk signal); weak topics (w < 4) count half.
  const groups = new Map();
  for (const t of topicHits) groups.set(t.group, Math.max(groups.get(t.group) || 0, t.w >= 4 ? 1 : 0.5));
  for (const v of groups.values()) signals += v;
  const topicScore = topicHits.reduce((s, t) => s + t.w, 0);
  const strongTopic = topicHits.some((t) => t.w >= 5);
  // Needs a topic or a rare word: two weak country-level topics with nothing else ("UK" + "France") never match.
  if (!(strongTopic || rareHits >= 1)) return null;
  // Coverage: how much of the market's distinctive wording the news accounts for (prefers the precise market).
  let mSum = 0, mHit = 0;
  for (const t of doc) { const i = idx.idf(t); if (i < 1.8) continue; mSum += i; if (news.tw.has(t) || covered.has(t)) mHit += i; }
  const coverage = mSum ? mHit / mSum : 0;
  // >= 2 independent signals, or 1.5 when the news covers most of what the market is about.
  if (!(signals >= 2 || (signals >= 1.5 && coverage >= 0.4))) return null;
  // Key entity (2026-11-05): the market's own subject must be in the news. Its rarest distinctive word outside the outcome
  // ("moratorium", "Alito", "Tampa") has to be hit unless a strong topic carries the match, so "Data Center IPOs" never
  // lands on a Louisiana data-center market through the two generic words they share, and "announces retirement" never
  // takes an Alito market on a Ronaldo story.
  if (!strongTopic) {
    const outTok = m.outcome && !/^[\s$<>≥≤~+–-]*\d/.test(String(m.outcome)) ? tokenSet(m.outcome) : new Set();
    let key = null, keyIdf = 0;
    for (const t of tokenSet(`${m.eventTitle || ''} ${m.title || ''}`)) {
      if (outTok.has(t) || WEAK.has(t) || CONTEXT.test(t) || /\d/.test(t)) continue;
      const i = idx.idf(t);
      if (i > keyIdf) { keyIdf = i; key = t; }
    }
    const near = (t) => (news.tw.get(t) || 0) >= 0.34 || (t.length >= 6 && [...news.tw.keys()].some((k) => k.length >= 5 && k.slice(0, 5) === t.slice(0, 5)));
    if (key && keyIdf >= 3 && !near(key) && !covered.has(key)) return null;
  }
  // Wrong place: a national market with a local headline, a named country with a headline about another one.
  if (news.title && !SPORTY.has(String(m.category || '').toLowerCase()) && (scopeMismatch(mtext, news.title) || geoMiss(mtext, news.title))) return null;
  let score = tokScore + topicScore;
  score += 6 * coverage;
  if (score < 9) return null;
  const vol = Number(m.volume24h) || 0;
  score *= 1 + Math.min(0.6, 0.15 * Math.log10(1 + vol / 10_000));
  const closes = m.closesAt ? Date.parse(m.closesAt) : NaN;
  if (Number.isFinite(closes) && closes > now && closes - now < 30 * DAY) score *= 1.15;
  if (m.yesPrice != null && (m.yesPrice < 0.03 || m.yesPrice > 0.97)) score *= 0.6;
  const why = [
    ...topicHits.map((t) => `topic:${t.key}`),
    hit.length ? `words:${hit.join(',')}` : null,
    `cover:${coverage.toFixed(2)}`,
  ].filter(Boolean).join(' ');
  return { score: Math.round(score * 10) / 10, why, coverage, signals };
}

// ---------- live search ----------
const SEARCH_TTL = 15 * 60_000;
const SEARCH_GAP = 10_000;
const searchCache = new Map();   // `${host}|${q}` -> {at, markets}
const lastCall = new Map();      // host -> epoch ms
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let UA = 'PNN/0.1 (Pre News Network; local broadcast display)';

async function slot(host, waitMs) {
  const next = (lastCall.get(host) || 0) + SEARCH_GAP;
  const wait = next - Date.now();
  if (wait > 0) { if (wait > waitMs) return false; await sleep(wait); }
  lastCall.set(host, Date.now());
  return true;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) { try { await res.arrayBuffer(); } catch {} throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status }); }
  return res.json();
}

let pmParse = null, ksParse = null;
async function parsers() {
  if (!pmParse) try { pmParse = (await import('../sources/polymarket.mjs')).parsePolymarketEvents; } catch (e) { log('warn', 'match: polymarket parser unavailable', { error: String(e?.message || e) }); }
  if (!ksParse) try { ksParse = (await import('../sources/kalshi.mjs')).parseKalshiMarkets; } catch (e) { log('warn', 'match: kalshi parser unavailable', { error: String(e?.message || e) }); }
}

async function cached(host, q, waitMs, fn) {
  const key = `${host}|${q.toLowerCase()}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.markets;
  if (!(await slot(host, waitMs))) return hit?.markets || [];
  try {
    const markets = await fn();
    searchCache.set(key, { at: Date.now(), markets });
    if (searchCache.size > 400) for (const k of [...searchCache.keys()].slice(0, 100)) searchCache.delete(k);
    return markets;
  } catch (e) {
    log('warn', 'match: live search failed', { host, q, error: String(e?.message || e) });
    if (e?.status === 429) lastCall.set(host, Date.now() + 60_000);
    return hit?.markets || [];
  }
}

export async function searchPolymarket(q, { waitMs = 0 } = {}) {
  await parsers();
  return cached('gamma-api.polymarket.com', q, waitMs, async () => {
    const url = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=5&events_status=active&search_tags=false&search_profiles=false`;
    const j = await getJson(url);
    const events = (j?.events || []).filter((e) => e && !e.closed && e.active !== false && !(e.endDate && Date.parse(e.endDate) < Date.now() - 2 * DAY));
    return pmParse ? pmParse(events, new Date()) : [];
  });
}

// Kalshi's site search (undocumented v1) -> v2-like event/market objects -> parseKalshiMarkets.
// v1 hits carry no per-market 24h volume, so the event's recent_volume is split by each market's share of total volume.
export function kalshiSearchToV2(hits) {
  const out = [];
  for (const h of hits || []) {
    const ms = (h.markets || []).filter((m) => !m.result);
    if (!ms.length) continue;
    const totalVol = ms.reduce((s, m) => s + (Number(m.volume) || 0), 0) || 1;
    out.push({
      event_ticker: h.event_ticker, series_ticker: h.series_ticker, title: h.event_title, category: h.category,
      mutually_exclusive: ms.length > 1 ? true : undefined,
      markets: ms.map((m) => ({
        ticker: m.ticker, event_ticker: h.event_ticker, title: m.title, yes_sub_title: m.yes_subtitle, status: 'active',
        last_price_dollars: m.last_price_dollars, yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars,
        previous_price_dollars: m.previous_price_dollars,
        volume_24h_fp: Math.round((Number(h.recent_volume) || 0) * ((Number(m.volume) || 0) / totalVol)),
        volume_fp: m.volume, close_time: m.close_ts, expected_expiration_time: m.expected_expiration_ts, open_time: m.open_ts,
      })),
    });
  }
  return out;
}

export async function searchKalshi(q, { waitMs = 0 } = {}) {
  await parsers();
  return cached('api.elections.kalshi.com', q, waitMs, async () => {
    const url = `https://api.elections.kalshi.com/v1/search/series?query=${encodeURIComponent(q)}&status=open&page_size=5`;
    const j = await getJson(url);
    const events = kalshiSearchToV2(j?.current_page || []);
    if (!ksParse) return [];
    const series = {};
    for (const h of j?.current_page || []) series[h.series_ticker] = { category: h.category, tags: h.tags || [], frequency: h.product_metadata?.series_frequency };
    return ksParse(events, series, new Date());
  });
}

/** 1-3 short keyword queries for live search: topic queries first, then the rarest words of the headline. */
export function searchQueries(news, idx) {
  const qs = [];
  for (const t of news.topics) if (t.query && !qs.includes(t.query)) qs.push(t.query);
  const words = [...news.tw.entries()]
    .filter(([t, w]) => w >= 0.34 && !WEAK.has(t) && !/^\d+$/.test(t) && news.surface.has(t))
    .map(([t, w]) => ({ t, s: w * idx.idf(t) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => news.surface.get(x.t));
  if (words.length >= 2) qs.push(words.slice(0, 3).join(' '));
  return [...new Set(qs)].slice(0, 2);
}

// ---------- main ----------
let defaultConfig = null;
export async function matchMarkets(cluster, marketIndex = [], opts = {}) {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 6;
  const perEvent = opts.perEvent ?? 2;
  let config = opts.config;
  if (!config) { if (!defaultConfig) defaultConfig = (await import('../config.mjs')).default; config = defaultConfig; }
  if (config?.userAgent) UA = config.userAgent;
  const idx = buildIndex(marketIndex);
  const news = analyzeCluster(cluster);
  news.idf = idx.idf;

  const keep = new Map(); // market id -> classify result (memo per call)
  const allowed = (m) => {
    if (!keep.has(m.id)) keep.set(m.id, classify(m, config, { now }));
    return keep.get(m.id).keep;
  };
  const score = (list, docsFor) => {
    const out = [];
    for (const m of list) {
      const doc = docsFor(m);
      if (!doc) continue;
      const s = scoreMarket(m, doc, news, idx, now);
      if (!s || !allowed(m)) continue;
      const c = keep.get(m.id);
      out.push({ market: c.category && !m.category ? { ...m, category: c.category } : m, score: s.score, why: s.why, origin: 'index' });
    }
    return out;
  };

  let results = score(marketIndex, (m) => idx.docs.get(m.id));
  const best = results.reduce((b, r) => Math.max(b, r.score), 0);
  let queries = [];
  if (opts.search !== false && best < (opts.strongScore ?? 16)) {
    queries = searchQueries(news, idx);
    const have = new Set(results.map((r) => r.market.id));
    const found = [];
    for (const q of queries) {
      const [pm, ks] = await Promise.all([searchPolymarket(q, { waitMs: opts.searchWaitMs ?? 0 }), searchKalshi(q, { waitMs: opts.searchWaitMs ?? 0 })]);
      for (const m of [...pm, ...ks]) if (!have.has(m.id)) { have.add(m.id); found.push(m); }
    }
    const extra = score(found, (m) => tokenSet(docText(m))).map((r) => ({ ...r, origin: 'search' }));
    results = results.concat(extra);
  }

  // Rank, keep the strongest few outcomes per event, drop anything far below the best.
  results.sort((a, b) => b.score - a.score);
  const top = results[0]?.score || 0;
  const perEv = new Map();
  const out = [];
  for (const r of results) {
    if (r.score < top * (opts.relCut ?? 0.45)) break;
    const n = perEv.get(r.market.eventId) || 0;
    if (n >= perEvent) continue;
    perEv.set(r.market.eventId, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  if (opts.debug) out.queries = queries;
  return out;
}

// ---------- story -> news (the reverse direction) ----------
// Every story that airs carries a headline (user directive 2026-11-05: "the news feeds drive the market content").
// buildHeadlineIndex(items) indexes headlines once (cached per array); matchStoryNews(story, hIndex, marketIndex)
// scores each candidate headline against the story's markets with the SAME scorer as the flash matcher (scoreMarket:
// >= 2 independent signals, a topic or rare word, IDF over the market index), so relevance stays strict.
// Sports / games stories may also match by entity: a sports or gaming feed headline that names one of the story's
// outcomes (team, player, game) or the event's distinctive subject ("GTA", "Ballon d'Or").
const hIndexCache = new WeakMap();
const SPORTY = new Set(['sports', 'sport', 'gaming', 'games', 'esports']);
export function buildHeadlineIndex(items) {
  if (hIndexCache.has(items)) return hIndexCache.get(items);
  const list = [];
  const byTok = new Map();
  const byTopic = new Map();
  // vocabulary for the generic cut-word check (news.mjs looksCut) must exist before the first headline is judged
  learnWords((items || []).map((x) => x?.title));
  for (const it of items || []) {
    if (!it?.title) continue;
    // Never the news item: exchange / promo / social / scraper sources, garbled lowercase titles, cut headlines, non-Latin
    if (badNewsSource(it) || headlineReject(it) || looksCut(it.title) || nonLatin(it.title) || nonLatin(it.outlet)) continue;
    const news = analyzeCluster({ title: it.title });
    const i = list.length;
    list.push({ it, news, lower: ` ${String(it.title).toLowerCase().replace(/[^a-z0-9'’&+-]+/g, ' ')} ` });
    for (const t of news.tw.keys()) { let a = byTok.get(t); if (!a) byTok.set(t, (a = [])); a.push(i); }
    for (const t of news.topics) { let a = byTopic.get(t.key); if (!a) byTopic.set(t.key, (a = [])); a.push(i); }
  }
  const h = { list, byTok, byTopic };
  hIndexCache.set(items, h);
  return h;
}

const ENTITY_GENERIC = new Set(['city', 'united', 'real', 'state', 'athletic', 'club', 'team', 'sporting', 'inter', 'saint', 'st',
  'new', 'los', 'san', 'the', 'other', 'field', 'none', 'yes', 'no', 'draw', 'tie', 'any', 'world', 'game', 'games', 'award', 'awards',
  'champion', 'winner', 'season', 'league', 'cup', 'open', 'north', 'south', 'east', 'west', 'american', 'national', 'young', 'jr', 'ii', 'iii',
  'brand', 'day', 'part', 'movie', 'film', 'show', 'album', 'song', 'party', 'democrat', 'republican', 'democratic', 'independent']);
// Frame words that never make a story match on their own (beyond match.mjs WEAK).
const STORY_WEAK = new Set(['ai', 'general', 'election', 'elect', 'winner', 'announce', 'release', 'released', 'company', 'largest', 'biggest',
  'best', 'top', 'highest', 'lowest', 'most', 'place', 'season', 'show', 'week', 'month', 'price', 'prices', 'end', 'rate', 'rates',
  'congress', 'midterm', 'midterms', 'democratic', 'federal', 'global', 'world', 'chart', 'love', 'margin', 'victory', 'vote', 'percent', 'change', 'changes', 'nominated', 'nomination', 'nominations', 'nominee', 'nominees', 'nominate', 'announced', 'announces', 'released', 'releases']);
// Capitalized but not a subject ("Finals", "Group", "Inc", "Prize"): never a P word.
const STORY_WEAK_P = new Set(['final', 'finals', 'pro', 'group', 'inc', 'corp', 'prize', 'problem', 'air', 'oil', 'crude', 'margin', 'district',
  'vote', 'percent', 'turnout', 'victory', 'cost', 'house', 'senate',
  // a question's capitalised first word is no subject: "Another Fed rate hike" never takes "another Switch 2 price hike"
  'another', 'any', 'other']);
// Service pieces on sports / gaming feeds never carry a story (fantasy lineups, betting picks, listicles, how-to-watch).
const SPORTS_FLUFF = /\b(DFS|DraftKings|FanDuel|fantasy|best bets?|prop bets?|picks?|predictions?|predicted|parlay|lineups?|how to (watch|follow|stream)|live stream|every player|ranked|ranking|quiz|deals? of the day|best deals?|on sale|discount|price drop|\d+% off)\b/i;
// A person named in a headline (2026-11-05 news unlock audit): the full name, or the surname used as this person's surname.
// "Thomas Massie" is not Clarence Thomas, "Robert Redford" is not Robert F. Kennedy Jr., "leave Netflix" names no Tom Homan.
const NAME_SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
function personHit(run, title, H) {
  const toks = [...run].filter((t) => !NAME_SUFFIX.has(t) && t.length > 1);
  if (!toks.length) return false;
  if (toks.every((t) => H.has(t))) return true;
  if (toks.length < 2) return false;
  const last = toks[toks.length - 1];
  if (!H.has(last) || COMMON_RUN.has(last)) return false;
  const cap = last[0].toUpperCase() + last.slice(1);
  const before = new RegExp(`\\b([A-Z][a-z]+)\\s+${cap}\\b`).exec(title);
  const tc = isTitleCase(title);
  if (before && !toks.includes(before[1].toLowerCase()) && !tc) return false;
  if (!tc && new RegExp(`\\b${cap}\\s+[A-Z][a-z]+`).test(title)) return false;
  return true;
}
/** true when `t` (a word of the name run `r`) appears in the headline only as another person's first name ("Thomas Massie"). */
function namesake(t, r, title) {
  if (isTitleCase(title)) return false;
  const cap = t[0].toUpperCase() + t.slice(1);
  const re = new RegExp(`\\b(?:${cap}|${t.toUpperCase()})\\s+([A-Z][a-z][\\w'’-]*)`, 'g');
  let m, any = false;
  while ((m = re.exec(title))) {
    any = true;
    if (r.has(m[1].toLowerCase())) return false;
  }
  return any && !new RegExp(`\\b(?:${cap}|${t}|${t.toUpperCase()})\\b(?!\\s+[A-Z])`).test(title);
}
const lowerWords = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9'’&+-]+/g, ' ').trim();
const isTitleCase = (t) => { if (/\?$/.test(String(t || '').trim())) return false; const w = String(t || '').split(/\s+/).filter((x) => /^[A-Za-z]/.test(x) && x.length > 3); return w.length >= 3 && w.filter((x) => /^[A-Z]/.test(x)).length / w.length >= 0.7; };
// Proper-noun tokens of a question: capitalized words after the first ("Will Samuel Alito announce..." -> samuel, alito).
// Questions are sentence case, so this separates the subject from frame words ("largest", "retirement", "place").
// properRuns(text) -> [Set] one set per run of adjacent capitalized words ("Pete Hegseth" is one run, one subject).
function properRuns(text) {
  const runs = [];
  if (!text || isTitleCase(text)) return runs;
  const words = String(text).split(/\s+/);
  let cur = null;
  const flush = () => { if (cur?.length) { const ts = tokens(cur.join(' ')).filter((t) => !WEAK.has(t) && !CONTEXT.test(t) && !/^\d+$/.test(t)); if (ts.length) runs.push(new Set(ts)); } cur = null; };
  // the first word is a subject unless it is a question / function word ("Elon Musk meets with Putin..." vs "Will ...")
  const start = /^(will|who|what|which|how|when|where|is|are|does|do|did|can|could|should|would|has|have|the|a|an|in|on|at|by|for|of|after|before|between|top|best|largest|biggest|highest|lowest|most|next|new|number|#\d+|\d+(st|nd|rd|th)?)$/i.test(words[0] || '') ? 1 : 0;
  for (let i = start; i < words.length; i++) {
    const w = words[i];
    // a middle initial or suffix ("Robert F. Kennedy Jr.") does not end the run; a sentence end does
    if (!/^[“"'(]?[A-Z0-9]/.test(w) || (i > 0 && /[?.!]$/.test(words[i - 1] || '') && !/^([A-Z]|jr|sr|dr|st)\.$/i.test(words[i - 1] || ''))) { flush(); continue; }
    (cur ||= []).push(w);   // tokenized as one phrase: "South Africa's" -> southafrica, not south + africa
  }
  flush();
  return runs;
}
const properTokens = (text) => new Set(properRuns(text).flatMap((r) => [...r]));
// An outcome is hit when its distinctive last word is in the headline (a surname, a team nickname) and, for long
// names (a film or album title), most of its distinctive words are.
function outcomeTerm(outcome, idf) {
  const toks = tokens(outcome).filter((t) => !ENTITY_GENERIC.has(t) && !WEAK.has(t) && !/^\d+$/.test(t) && !CONTEXT.test(t) && idf(t) >= 1.8);
  if (!toks.length) return null;
  const raw = lowerWords(outcome).split(' ').filter((w) => w.length >= 3).pop() || null;
  return { last: toks[toks.length - 1], toks, need: toks.length >= 3 ? Math.ceil(toks.length * 0.6) : 1, raw };
}
// `lower` (the headline's raw lowercase words) guards the stemmer: "Caleb Williams" must not hit "William Contreras"
// a word with a different ending still counts: impeach / impeachment, nominate / nomination / nominated
const hasStem = (H, t) => H.has(t) || (t.length >= 7 && [...H.keys()].some((k) => k.length >= 7 && Math.abs(k.length - t.length) <= 5 && k.slice(0, 7) === t.slice(0, 7)));
// a transliterated surname ("Eisenkot" / "Eizenkot"): same length (>= 6), same first two letters, one letter different
const translitHit = (o, H) => !!o && o.toks.length <= 3 && o.last.length >= 6 && [...H.keys()].some((k) => k.length === o.last.length && k.slice(0, 2) === o.last.slice(0, 2) && [...k].filter((c, i) => c !== o.last[i]).length === 1);
const outcomeHit = (o, H, lower = null) => !!o && H.has(o.last) && o.toks.filter((t) => H.has(t)).length >= o.need && (!lower || !o.raw || lower.includes(` ${o.raw}`));


// "out as Secretary of Defense" / "announces departure": a headline about the person's job being in doubt answers it
const LEAVE_Q = /\b(out as|out by|out before|leaves?|departure|depart|resign\w*|steps? down|retire\w*|fired|ousted|replaced|exit|leadership change|regime)\b/i;
const LEAVE_HEAD = /\b(out|leave|leaves|leaving|left|departure|depart\w*|exit\w*|resign\w*|steps? down|stepped down|retir\w*|fire[ds]?|firing|ous\w+|replac\w+|remov\w+|dismiss\w+|sack\w*|axe[ds]?|stay|survive[sd]?|fall guy|shake-?up|impeach\w*|quit\w*|regime change|supreme leader|succession|successor)\b/i;
const LEVEL_HEAD = /\b(prices?|rates?|yields?|barrel|ounce|oil|crude|climbs?|falls?|slumps?|surges?|jumps?|drops?|slides?|rallies|rally|rises?|plunges?|tumbles?|soars?|hits?|slips?|dips?|eases?|edges?|sinks?|gains?|loses?|steadies|steady|retreats?|rebounds?|spikes?|swings?)\b/i;
// "AZ-02" in a question is "Arizona's 2nd Congressional District" in a headline.
const ABBR = { AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming' };
const ORD = ['', '1st|first', '2nd|second', '3rd|third', '4th|fourth', '5th|fifth', '6th|sixth', '7th|seventh', '8th|eighth', '9th|ninth'];
function districtRes(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\b([A-Z]{2})-0?(\d{1,2})\b/g)) {
    const st = ABBR[m[1]]; const n = Number(m[2]);
    if (!st) continue;
    const ord = n < 10 ? ORD[n] : `${n}(?:st|nd|rd|th)`;
    out.push(new RegExp(`${st}.{0,24}\\b(?:${ord}|district ${n}|${m[1].toLowerCase()}-0?${n})\\b|\\b(?:${ord})\\b.{0,24}district.{0,24}${st}|\\b${m[1].toLowerCase()}-0?${n}\\b`, 'i'));
  }
  return out;
}

// ---------- question types (2026-11-05 relevance pass) ----------
// A headline that names the story's subject is not enough: it must be about what the market ASKS. "Avengers: Doomsday
// best opening weekend" never takes a Dunkin' ad piece; "The Cat in the Hat Rotten Tomatoes score" never takes a box-office
// tracking story; "best AI model" never takes a Diwali-prompts listicle. q: on the story's question text; h: the headline
// must match. All matching types apply.
const QTYPES = [
  { key: 'reviews', q: /\b(rotten tomatoes|tomatometer|metacritic|critics'? score|review score)\b/i,
    h: /\b(rotten tomatoes|tomatometer|metacritic|reviews?|reviewed|critics?|critical(ly)?|first reactions?|reactions|panned|acclaim\w*|praised?|raves?|verdict|rated|fresh|splat\w*|scores?)\b/i },
  { key: 'box-office', q: /\b(box office|opening weekend|domestic opening|worldwide gross|gross(es)?)\b/i,
    h: /\b(box office|opening|opens|opened|debut\w*|tickets?|pre-?sales?|tracking|gross\w*|weekend|projection\w*|projected|estimates?|record|\$\d[\d.,]*\s?(m|mn|million|b|bn|billion))\b/i },
  { key: 'best-ai', q: /\b(best|top) ai\b|\b(best|top) (ai )?model\b|\b(lmarena|text arena|chatbot arena|code arena|webdev arena|webdev)\b/i,
    h: /\b(benchmarks?|leaderboards?|lmarena|arena|rankings?|ranked|tops?|topped|beats?|outperform\w*|state[- ]of[- ]the[- ]art|smartest|most (capable|powerful|advanced|intelligent)|best (ai|model)|leading (ai|model)|ai race|frontier|new model|(ai|language|flagship|reasoning) models?|GPT-?\d[\w.]*|Gemini \d[\w.]*|Grok \d[\w.]*|Claude (Opus|Sonnet|Haiku|Fable)?\s?\d[\w.]*|Llama \d[\w.]*)\b/i },
  { key: 'release', q: /\b(releas(e|ed|es)|launch(es|ed)?|release date|ships?|go(es)? on sale)\b/i,
    h: /\b(releas\w*|launch\w*|reveal\w*|introduc\w*|new|rollout|rolls? out|rolled out|ships?|shipping|available|availability|debut\w*|unveil\w*|arriv\w*|coming|soon|date|leak\w*|delay\w*|postpon\w*|announc\w*|preview|beta|teas\w*|drops?|plans?|eyes|readies|prepar\w*|tests?|testing|ahead of|pre-?orders?|countdown)\b/i },
  { key: 'transit', q: /\b(transits?|transit calls|ships? (through|passing)|tanker traffic|traffic through)\b/i,
    h: /\b(transits?|ships?|shipping|tankers?|vessels?|traffic|crossings?|passage|navigation|reopen\w*|clos(e|ed|ure|ing)|blockade\w*|convoys?|escort\w*|mines?|chokepoint)\b/i },
  { key: 'sanction-relief', q: /\bsanctions? relief\b|\bwaivers?\b/i,
    h: /\b(relief|waivers?|lift\w*|eas(e|es|ed|ing)|exemptions?|licen[cs]es?|roll\w* back|unfreez\w*|carve-?outs?)\b/i },
  { key: 'searched', q: /\b(most searched|#1 searched|searched (person|people)|year in search|google trends)\b/i,
    h: /\b(search(ed|es)?|google trends|year in search|googled)\b/i },
  { key: 'chart', q: /\b(billboard|hot 100|billboard 200|spotify (chart|top)|#1 (song|album))\b/i,
    h: /\b(billboard|hot 100|charts?|charting|no\. ?1|number one|#1|debut\w*|streams?|streaming|spotify|top 10|tops?)\b/i },
  // App Store ranking questions ("TikTok Pro - Events are #1 Free App in the US Apple App Store"): the headline must be about
  // app-store rankings / charts / downloads; "TikTok quietly launches a standalone TikTok Shop app" is not.
  { key: 'app-rank', q: /\b(app store|play store|google play)\b|#\s?1\s+(free\s+|paid\s+)?apps?\b|\bno\.?\s?1\s+(free\s+|paid\s+)?apps?\b|\btop\s+(free\s+|paid\s+)?apps?\b|\bmost[- ]downloaded\b/i,
    h: /\b(app store|play store|google play|app (ranking|rankings|chart|charts|downloads?)|(top|#\s?1|no\.?\s?1|number[- ]one|best[- ]selling|most[- ]downloaded|top-ranked|chart-topping)\s+(free\s+|paid\s+)?(apps?|downloads?|charts?)|downloads?|downloaded|downloading|install\w*|(tops?|topped|hits?|reaches?|climbs?|surges?|leads?|dethrones?|overtakes?|passes)\s+(the\s+)?(\w+\s+){0,2}(charts?|rankings?)|apps?\s+(charts?|rankings?)|ranks?\s+(first|no\.?\s?1|#\s?1))\b/i },
  // "Will X shut down / fold / cease operations": the headline must be about the end (or the funding / talks that decide it),
  // not a history piece ("LIV Golf timeline: From the league's beginning to where things now stand")
  { key: 'shutdown', q: /\b(shut ?downs?|shut(s|ting)? down|fold(s|ing)?|cease(s)? operations?|wind(s|ing)? down|dissol\w+|go(es)? out of business|liquidat\w+)\b/i,
    h: /\b(shut ?downs?|shut(s|ting)? down|shuttered|end of|the end|ends?|ending|ended|fold(s|ed|ing)?|collaps\w*|demise|future|dissol\w+|wind(s|ing)? down|clos(e|es|ed|ing|ure)|cease\w*|pull(s|ed)? (the )?plug|funding|bankrupt\w*|insolven\w*|liquidat\w+|merg(e|er|es|ed|ing)|merger|takeover|cancel\w*|survive|survival|doomed|crisis|uncertain\w*|in doubt|exit|quit|disband\w*|scrap\w*|axed?|PIF|public investment fund)\b/i },
  // a new justice: "Justice Dept. Steps Up Criminal Investigation of Supreme Court Abortion Leak" is not about a vacancy or a
  // confirmation. The headline needs nomination / confirmation / retirement / Senate context.
  { key: 'new-justice', q: /\b(next|new) (supreme court )?justice\b|\bjustice\b[^?]*\b(confirmed|nominated)\b|\bconfirm\w*[^?]*\bsupreme court\b|\bsupreme court (nominee|vacancy|seat)\b/i,
    h: /\b(confirm\w*|nominat\w*|nominees?|vacanc\w*|retire\w*|step(s|ping)? down|steps? aside|replace\w*|successors?|shortlist\w*|short list|senate|judiciary committee|hearings?|seat|bench|appoint\w*|pick|picks|candidates?|contenders?|frontrunners?|front-runners?)\b/i },
  // a justice's own departure ("Alito announces retirement", "Thomas departure as Supreme Court justice"): the headline must be
  // about the departure or the vacancy it creates, not the Justice Department's leak probe
  { key: 'justice-departure', q: /(?=.*\b(supreme court|justices?)\b)(?=.*\b(retire\w*|departure|depart|resign\w*|step(s|ping)? down|leave the (supreme )?court)\b)/i,
    h: /\b(retire\w*|depart\w*|resign\w*|step(s|ping)? (down|aside)|leaves? the (supreme )?court|vacanc\w*|replace\w*|successors?|nominat\w*|nominees?|shortlist\w*|senate|bench|health|hospital\w*|age|term limits?|confirm\w*)\b/i },
  // album sales ("First Week Album Equivalent Units"): a sales / chart / debut headline, not a store listing of the record
  { key: 'album-units', q: /\b(album equivalent units|first[- ]week (sales|units)|equivalent units)\b/i,
    h: /\b(units|sales|sold|sells|selling|first[- ]week|debut\w*|billboard|charts?|charting|streams?|streaming|copies|tracking|projected|projections?|forecast\w*|no\. ?1|number one|#1)\b/i },
  // ---- 2026-11-05 news unlock audit: generic words and a company name are not the question ----
  // macro indicators: "core CPI above 2.9%" never takes "Cloudflare reports Q3 revenue up 39% YoY" or a Claude Code "core team" story
  { key: 'cpi', q: /\b(cpi|pce|consumer price index)\b/i, h: /\b(cpi|pce|inflation\w*|consumer prices?|price index|price pressures?)\b/i },
  { key: 'jobs', q: /\b(unemployment|nonfarm payrolls?|jobs report|jobless)\b/i,
    h: /\b(unemploy\w*|jobless\w*|jobs?|payrolls?|labou?r (market|force|department|data)|hiring|layoffs?|employment|bls)\b/i },
  { key: 'productivity', q: /\bproductivity\b/i, h: /\bproductivity\b/i },
  // a ticker close ("Amazon (AMZN) closes above $270"): a stock / market headline, not "The Amazon is no longer a carbon sink"
  // or a deal post. Case-sensitive ticker in parentheses.
  { key: 'stock-close', q: /\([A-Z]{2,5}\)\s*(close|closes|closing)\b/,
    h: /\b(stocks?|shares?|market (cap|value)\w*|valuation|trad(e|es|ed|ing)|clos(e|es|ed|ing)|rall\w*|slump\w*|surg\w*|plung\w*|tumbl\w*|soar\w*|jump\w*|slid\w*|fell|falls?|ris(e|es|ing)|rose|gain\w*|earnings|revenue|profits?|guidance|outlook|investors?|wall street|nasdaq|s&p|dow|analysts?|price targets?|downgrad\w*|upgrad\w*|sell-?off|selloff|record high|all-time high|trillion)\b/i },
  { key: 'earnings', q: /\bbeat (quarterly )?earnings\b/i, h: /\b(earnings|results|revenue|quarter\w*|q[1-4]|eps|profits?|guidance|reports?|forecast)\b/i },
  // "federal government take a stake in Nvidia" never takes "RTX 5090 now 262% above MSRP"
  { key: 'stake', q: /\btake a stake\b|\bequity stake\b|\bstake of\b/i, h: /\b(stakes?|equity|ownership|shares?|invest\w*|golden share)\b/i },
  // "Anthropic highest private valuation" never takes "ban employees from wearing badges"
  { key: 'valuation', q: /\bvaluation\b|\blargest private company\b/i,
    h: /\b(valu\w*|worth|funding|rais(e|es|ed|ing)|round|investors?|tender|secondary|ipo|\$\d[\d.,]*\s?(b|bn|billion|t|tn|trillion))\b/i },
  { key: 'agi', q: /\bAGI\b|\bartificial general intelligence\b/i, h: /\bAGI\b|\bartificial general intelligence\b|\bsuperintelligen\w*/i },
  // "Goldman lead-left on Anthropic's IPO" never takes "Price Cuts on Claude"
  { key: 'underwriter', q: /\bunderwrit\w*|\blead-left\b|\blead bank\b/i,
    h: /\b(ipos?|underwrit\w*|banks?|bankers?|wall street|listing|go(ing)? public|offering|s-1|filing)\b/i },
  // "US Government removes public access to another Anthropic AI model" never takes any Anthropic research post
  { key: 'gov-access', q: /\bgovernment removes\b|\bremoves? public access\b/i,
    h: /\b(government|federal|pentagon|administration|white house|ban\w*|restrict\w*|access|remov\w*|block\w*|pull(s|ed)?|supply[- ]chain risk|regulat\w*|national security|commerce department|executive order)\b/i },
  // "Louisiana enacts data center moratorium" never takes a Louisiana data-center story with no pause in it
  { key: 'moratorium', q: /\bmoratori\w*/i, h: /\b(moratori\w*|pause\w*|ban\w*|halt\w*|freeze|block\w*|limits?)\b/i },
  // a sports award race on a team / conference outcome ("ACC" for the Heisman) needs the award named: "ACC POY Awards" is not it
  { key: 'award', q: /\b(Heisman|Cy Young|Ballon d'?Or|Golden Boot|Hart Trophy|Vezina|Norris Trophy)\b/i, h: null },
];
// Award / prize races (Oscars, Emmys, Nobel ...): an event-level headline has to be about the race itself, not about a person
// who merely mentions it ("Matt Damon reveals his wife's aneurysm the week before the Oscars").
const AWARD_RACE_Q = /\b(oscars?|academy awards?|emmys?|grammys?|golden globes?|tonys?|baftas?|nobel|best (picture|actor|actress|director|film|song|album|animated|documentary)|person of the year|mvp|rookie of the year)\b/i;
const RACE_ABOUT_HEAD = /\b(nominat\w*|nominees?|frontrunners?|front-runners?|predict\w*|contenders?|favou?rites?|shortlist\w*|short list\w*|snubs?|snubbed|odds|race|campaign\w*|awards? season|winners?|wins|ballot|voters?|voting|shortlisted|lineup|line-up|buzz|early picks?|power rankings?)\b/i;
const PERSONAL_HEAD = /\b(wife|husband|aneurysm|surgery|surgeon|divorc\w*|baby|pregnan\w*|engage[dm]\w*|wedding|married|marriage|girlfriend|boyfriend|cancer|illness|hospital\w*|funeral|obituary|dies|died|dead|death|arrest\w*|lawsuit|sues?|sued|rehab|diagnos\w*|health scare|reveals? (that )?(his|her|their)|opens up|memoir|breakup|split)\b/i;
const AWARD_RE = /\b(Heisman|Cy Young|Ballon d'?Or|Golden Boot|Hart Trophy|Vezina|Norris Trophy)\b/i;
// Market-price levels (2026-11-05): "Brent above $97.99 on Nov 6" needs a headline about that asset's price that is < 24h old
// ("Brent Crude $104, Lowest Since 7 Oct" from yesterday contradicts the market), and the asset must be what the headline
// is about ("Gold climbs ... falling Treasury yields" is gold news, not a 10-year yield story).
const ASSETS = [
  { k: 'oil', q: /\b(wti|brent|crude|oil)\b/i, h: /\b(oil|crude|brent|wti|opec\+?)\b/i },
  { k: 'gold', q: /\bgold\b/i, h: /\bgold\b/i },
  { k: 'silver', q: /\bsilver\b/i, h: /\bsilver\b/i },
  { k: 'fuel', q: /\b(diesel|gasoline|gas price|price of gas|gas prices)\b/i, h: /\b(diesel|gasoline|gas prices?|fuel prices?|pump prices?|at the pump)\b/i },
  { k: 'yield', q: /\b(treasury|10-year|2-year|30-year|bond) yields?\b|\byield on\b|\btreasury\b/i, h: /\b(treasur(y|ies)|yields?|bonds?|10-year|t-notes?)\b/i },
  { k: 'bitcoin', q: /\b(bitcoin|btc|ethereum|eth)\b/i, h: /\b(bitcoin|btc|ethereum|ether|crypto\w*)\b/i },
  { k: 'stocks', q: /\b(s&p ?500|nasdaq|dow jones|the dow|russell 2000|vix)\b/i, h: /\b(s&p|nasdaq|dow|stocks?|wall street|russell|vix|equities)\b/i },
  { k: 'fx', q: /\b(usd\/\w+|eur\/usd|dollar index|yen|euro|pound|peso)\b.*\b(above|below|exchange rate)\b/i, h: /\b(dollar|yen|euro|pound|sterling|peso|currenc\w*|forex|fx)\b/i },
];
const PRICEISH = /\b(above|below|at least|between|price|prices|yields?|close[sd]?|settle\w*|hits?|reach(es)?|high|low|barrel|ounce|per gallon)\b|\$\d/i;
function storyAsset(text) {
  if (!PRICEISH.test(text)) return null;
  for (const a of ASSETS) if (a.q.test(text)) return a;
  return null;
}
/** The first asset the headline is about (by position), so "Gold climbs ... Treasury yields" leads with gold. */
function leadAsset(title) {
  let best = null, at = Infinity;
  for (const a of ASSETS) { const m = a.h.exec(title); if (m && m.index < at) { at = m.index; best = a; } }
  return best;
}
// race-level news (no candidate named) is fine for a race ("Mississippi Senate race still up in the air"), never for
// "who will attend" / "which movie" / "best actor nominee" events, where it is about someone else
const RACE_EVENT = /\b(election|elections|race|primary|runoff|nominee|nomination|next (prime minister|president|chancellor|speaker|leader|pm)|prime minister|leader|majority|control of|seats?|governor|senate|house|mayor|winner)\b/i;
const RACE_CATS = new Set(['elections', 'politics', 'world', 'geopolitics']);
// Numbered products / flights: the market's own number must be in the headline ("iPhone 18", "Gemini 4", "Starship Flight 15").
const MODEL_NUM = /\b(iphone|ipad|pixel|galaxy s|gemini|gpt|grok|llama|deepseek|kimi|claude (?:opus|sonnet|haiku)|starship flight(?: test)?)\s?-?\s?v?(\d+)(?![\d.]*\+)\b/i;
function modelRe(text) {
  const m = MODEL_NUM.exec(text);
  if (!m) return null;
  const head = m[1].toLowerCase().startsWith('starship') ? '(?:starship\\s+)?flight(?:\\s+test)?' : m[1].replace(/\s+/g, '\\s+');
  const next = m[1].toLowerCase() === 'iphone' ? '|\\bnext(-generation| generation)? iphone' : '';
  return new RegExp(`\\b${head}\\s?-?\\s?v?${m[2]}(?!\\d)${next}`, 'i');
}
const RETRO_HEAD = /\btimeline\b.*\b(from|beginning|origins?|history|where (things|it) (now )?stand\w*)\b|\b(a )?(brief |short |full |complete )?history of\b|\blook(ing)? back\b/i;
// ---------- 2026-11-05 news-gate build (option 3 + fifth lever) ----------
// Race-result lever: a margin / vote-share / turnout bracket on one race is answered by the race result ("Democrat Amy
// Acton wins Ohio's race for governor") even though the headline has none of the bracket's frame words.
const RESULT_Q = /\b(margin|percent|percentage|vote share|popular vote|turnout|least \d+(\.\d+)?%)/i;
const RESULT_HEAD = /\b(wins?|won|winning|flips?|flipped|defeats?|defeated|beats?|unseats?|ousts?|concedes?|conceded|projected|called|victory|victorious|re-?elected|elected|landslide|routs?)\b/i;
const OFFICES = [['gov', /\b(governor\w*|gubernatorial|governorship)\b/i], ['senate', /\bsenate\b/i], ['house', /\b(house|congressional|congress(man|woman)?)\b|\b[A-Z]{2}-\d{1,2}\b/i], ['mayor', /\bmayor\w*\b/i]];
const officesIn = (t) => new Set(OFFICES.filter(([, re]) => re.test(t)).map(([k]) => k));
// Proper-noun run words that are ordinary words too: "Red" of "Red Rocks" never counts as the subject on its own.
const COMMON_RUN = new Set(['red', 'new', 'big', 'blue', 'black', 'white', 'green', 'gold', 'golden', 'great', 'little', 'old', 'young', 'grand', 'high',
  'royal', 'united', 'north', 'south', 'east', 'west', 'best', 'good', 'star', 'stars', 'city', 'park', 'home', 'night', 'life', 'love', 'king', 'queen',
  'house', 'rock', 'rocks', 'man', 'woman', 'girl', 'boy', 'dead', 'last', 'free', 'real', 'live', 'open', 'world', 'one', 'top', 'bad', 'joy', 'mt']);
const NOT_NAME = /^(no|none|other|another|neither|nobody|no one|tie|draw|someone else|yes)\b|\d|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|exactly|more than|fewer|less than|over|under|above|below|between|at least)\b/i;
// Podcast episodes, round-ups and live blogs are the item only when nothing cleaner exists.
const LEDE_HEAD = /\b(podcast|episode|round-?up|live updates?|live blog|results for .+ and )\b/i;
// An official release backs an event only when it is about the policy itself, not an enforcement / personnel notice.
const POLICY_HEAD = /\b(fomc|monetary policy|interest rates?|rate (decision|hike|cut|increase|decrease)|policy rate|target range|federal funds|statement|minutes|projections?|opinion|ruling|order|decision)\b/i;
/** Why a headline that names the story's subject is still not about the question (null = fine). */
function questionMiss(T, title, ageH, leadHit) {
  // a history / recap piece is not news about a market's open question (unless the question itself is about history)
  if (RETRO_HEAD.test(title) && !RETRO_HEAD.test(T.storyText)) return 'retrospective';
  // a numbered product (2026-11-05 news unlock audit): "iPhone 18" never takes iPhone Duo / iOS beta / jailbreak news
  if (T.model && !T.model.test(title)) return 'model';
  for (const q of T.qtypes) {
    if (q.key === 'award') { const m = AWARD_RE.exec(T.storyText); if (m && !new RegExp(m[1].replace(/'/g, "'?"), 'i').test(title) && !(leadHit && T.leadOut?.toks.length >= 2)) return 'award'; continue; }
    if (!q.h.test(title)) return q.key;
  }
  if (T.asset) {
    if (!T.asset.h.test(title)) return 'asset';
    const la = leadAsset(title);
    if (la && la.k !== T.asset.k) return `asset:${la.k}`;
    if (ageH > 24) return 'stale-price';
  }
  return null;
}

// Stories are rebuilt every pass, so terms are memoized by story signature (event + lead + market ids): the same story
// re-matched against a new wire revision reuses them. The market index (idf) drifts slowly, so an entry lives 10 minutes.
const termsCache = new Map();
function storyTermsCached(story, idx, now) {
  const sig = `${story.id}|${story.eventTitle}|${story.lead?.title}|${story.lead?.outcome}|${story.lead?.id}|${(story.markets || []).map((m) => m.id).join(',')}`;
  const hit = termsCache.get(sig);
  if (hit && (hit.idx === idx || now - hit.at < 600_000)) return hit.T;
  const T = storyTerms(story, idx);
  if (termsCache.size > 8000) termsCache.clear();
  termsCache.set(sig, { idx, at: now, T });
  return T;
}
/** Entity terms of a story: see matchStoryNews. */
function storyTerms(story, idx) {
  const ms = [];
  const seenM = new Set();
  for (const m of [story.lead, ...(story.markets || [])]) if (m?.id && !seenM.has(m.id)) { seenM.add(m.id); ms.push(m); }
  const numeric = (o) => /^[\s$<>≥≤~+–-]*\d|^(above|below|over|under|at least|more than|less than|between)\b/i.test(String(o || ''));
  const withOutcome = ms.filter((m) => m.outcome && !numeric(m.outcome));
  const multi = !story.ladder && withOutcome.length >= 2;
  const distinct = (t) => idx.idf(t) >= 1.8 && !WEAK.has(t) && !STORY_WEAK.has(t) && !ENTITY_GENERIC.has(t) && !CONTEXT.test(t) && !/^\d+$/.test(t);
  const E = new Set();
  const lead = story.lead || ms[0] || {};
  const evTitle = story.eventTitle || lead.eventTitle || '';
  for (const t of tokens(`${evTitle} ${lead.title || ''} ${multi ? '' : lead.outcome || ''}`)) if (distinct(t)) E.add(t);
  const outcomes = multi ? withOutcome.map((m) => outcomeTerm(m.outcome, idx.idf)).filter(Boolean) : [];
  for (const o of outcomes) for (const t of o.toks) E.add(t);
  // P: the question's own proper nouns. Multi-outcome: only the frame shared by every outcome's question
  // ("Will X win the Mississippi Senate race?" -> mississippi, senate), never one outcome's name.
  let P;
  if (multi) {
    const sets = withOutcome.slice(0, 6).map((m) => properTokens(m.title));
    const oTok = new Set(outcomes.flatMap((o) => o.toks));
    P = new Set([...(sets[0] || [])].filter((t) => sets.every((x) => x.has(t)) && !oTok.has(t)));
    for (const t of properTokens(evTitle)) if (!oTok.has(t)) P.add(t);
  } else {
    P = new Set([...properTokens(lead.title), ...properTokens(evTitle)]);
    for (const t of tokens(lead.outcome || '')) if (distinct(t)) E.add(t);
  }
  // a subject word is one in < ~5% of events: "Mississippi", "Hegseth"; not "Senate"
  for (const t of [...P]) if (!distinct(t) || idx.idf(t) < 3 || ENTITY_GENERIC.has(t) || STORY_WEAK_P.has(t)) P.delete(t);
  const oTok = new Set(outcomes.flatMap((o) => o.toks));
  // one subject per run of capitalized words; runs that share a word ("Crude Oil" in the title and "Oil" in the event) merge
  const runs = [];
  for (const r0 of [...properRuns(lead.title), ...properRuns(evTitle)]) {
    const r = new Set([...r0].filter((t) => P.has(t)));
    if (!r.size) continue;
    const same = runs.find((x) => [...r].some((t) => x.has(t)));
    if (same) for (const t of r) same.add(t); else runs.push(r);
  }
  // frame words of the event title, weak ones included ("largest", "company"): a headline naming two outcomes must also
  // be about the event ("Nvidia overtakes Apple as the largest company"), not a list of names ("layoffs at Amazon, Microsoft")
  const F = new Set(tokens(evTitle).filter((t) => !oTok.has(t) && !CONTEXT.test(t) && !/^\d+$/.test(t) && !WEAK.has(t)));
  const text = `${evTitle} ${lead.title || ''}`;
  const topics = TOPICS.filter((t) => t.w >= 5 && t.market.test(text));
  // sports / games entity path: every named outcome counts, even on a one-market story
  // ... but only the leaders (top 3 by price): "Every player from Arkansas to play for the Celtics" is not title-race news
  const entOutcomes = [...withOutcome].sort((a, b) => (b.yesPrice || 0) - (a.yesPrice || 0)).slice(0, 3).map((m) => outcomeTerm(m.outcome, idx.idf)).filter(Boolean);
  // the lead outcome (the story's headline subject): a headline that names it is preferred over one about a rival
  const leadOut = multi && lead.outcome && !numeric(lead.outcome) ? outcomeTerm(lead.outcome, idx.idf) : null;
  // every named subject of a single question, common ones included ("Canada" is in many events, so it is not in P)
  const rawP = multi ? new Set() : new Set([...properTokens(lead.title), ...properTokens(evTitle)].filter((t) => !WEAK.has(t) && !STORY_WEAK.has(t) && !STORY_WEAK_P.has(t) && !ENTITY_GENERIC.has(t) && !CONTEXT.test(t) && t.length >= 3));
  // Frame of a single question (what is being asked about, beyond its subject): "Person of the Year", "impeached",
  // "costume design". A headline that only names the subject ("Bob Dylan knocks on Pope Leo XIV's door") is not about it.
  // The subject is the question's first proper-noun run ("Pope Leo XIV", "Pete Hegseth"); the rest of the question is the frame.
  const UNITS = new Set(['usd', 'eur', 'gbp', 'est', 'edt', 'pst', 'utc', 'bbl', 'oz', 'pm', 'am', 'mom', 'yoy', 'cpi', 'gdp']);
  const first = new Set([...([...properRuns(lead.title), ...properRuns(evTitle)][0] || [])].flatMap((t) => t.split(/[-./]/)).filter((t) => idx.idf(t) >= 2.2 && t.length >= 3 && !UNITS.has(t) && !WEAK.has(t) && !STORY_WEAK.has(t) && !CONTEXT.test(t) && !/\d/.test(t)));
  const frame = multi ? new Set() : new Set(tokens(`${evTitle} ${lead.title || ''}`).filter((t) => idx.idf(t) >= 2.2 && !first.has(t) && !WEAK.has(t) && !STORY_WEAK.has(t) && !ENTITY_GENERIC.has(t) && !CONTEXT.test(t) && !/\d/.test(t)));
  const storyText = `${evTitle} ${lead.title || ''} ${lead.outcome || ''}`;
  // outcomes that are names (a person, a film, a party), not counts or brackets ("Exactly 0 cuts") or "No Bond chosen"
  const named = withOutcome.filter((m) => !NOT_NAME.test(String(m.outcome)));
  const namedOutcomes = multi ? named.map((m) => outcomeTerm(m.outcome, idx.idf)).filter(Boolean) : [];
  const oTokNamed = new Set(namedOutcomes.flatMap((o) => o.toks));
  const Fall = new Set(tokens(evTitle).filter((t) => !oTok.has(t) && !CONTEXT.test(t) && !/\d/.test(t)));
  const qText = `${evTitle} ${lead.title || ''}`;
  const qtypes = QTYPES.filter((q) => q.q.test(qText));
  const model = modelRe(qText);
  const asset = storyAsset(qText);
  const race = RACE_CATS.has(String(story.category || lead.category || '').toLowerCase()) && RACE_EVENT.test(evTitle);
  // a place outcome ('UAE') is named by its cities too ('Abu Dhabi talks')
  const leadGeo = multi && lead.outcome ? geoNames(lead.outcome) : new Set();
  return { multi, qtypes, model, asset, race, leadGeo, E, P, F, Fall, outcomes, topics, oTok, runs, entOutcomes, leadOut, rawP, frame, storyText, first, levelQ: !multi && (numeric(lead.outcome) || /\b(above|below|between|at least)\b/i.test(lead.title || '')) && /\b(prices?|rates?|yields?|index|close|barrel|ounce)\b/i.test(storyText), leaveQ: LEAVE_Q.test(storyText), districts: districtRes(`${evTitle} ${lead.title || ''}`),
    resultQ: !multi && race && RESULT_Q.test(storyText), offices: officesIn(`${evTitle} ${lead.title || ''}`), raceGeo: geoNames(`${evTitle} ${lead.title || ''}`, true),
    // every distinctive word of the event's frame (not an outcome, not a weak or generic word): what "about the event" means
    // ("No Bond chosen" is an outcome, but "Bond" is still the event's frame: only named outcomes are taken out)
    evTitle, namedOutcomes, Fs: new Set(tokens(evTitle).filter((t) => !oTokNamed.has(t) && !CONTEXT.test(t) && !/\d/.test(t) && !WEAK.has(t) && !STORY_WEAK.has(t) && !ENTITY_GENERIC.has(t) && idx.idf(t) >= 1.8)) };
}

/** Entity phrases for sports/games matching (kept for callers/tests): outcome names and their last word. */
export function storyEntities(story) {
  const out = new Set();
  for (const m of [story?.lead, ...(story?.markets || [])].filter(Boolean)) {
    const o = lowerWords(m.outcome);
    if (!o || o.length < 3 || ENTITY_GENERIC.has(o)) continue;
    out.add(o);
    const last = o.split(' ').pop();
    if (last.length >= 4 && !ENTITY_GENERIC.has(last) && !/^\d+$/.test(last)) out.add(last);
  }
  return [...out];
}

// Story <-> headline relevance (strict). E = the story's distinctive words (IDF >= 1.8 over the market index);
// P = the question's proper nouns; outcome = a named outcome of a multi-outcome event.
//   single question: (a P hit or a shared strong topic) and >= 2 E hits         ("Pete Hegseth out..." <- "impeach Pete Hegseth")
//   multi-outcome:   (an outcome hit and >= 2 E hits) or (>= 2 frame-P hits and >= 2 E hits)
//                    ("Mississippi Senate winner? / Colom" <- "Mississippi Senate race is toss-up")
//   sports / games (opts.entity): also a sports or gaming feed headline naming one of the outcomes or a rare subject word.
// So "Alito retirement" never takes "Ronaldo announces retirement" and "Largest company / Apple" never takes
// "World's largest olive oil company".
export function matchStoryNews(story, hIndex, marketIndex = [], { now = Date.now(), max = 3, maxAgeMs = 48 * 3_600_000, entity = false, minScore = 3 } = {}) {
  if (!story || !hIndex?.list?.length) return [];
  const idx = buildIndex(marketIndex);
  const T = storyTermsCached(story, idx, now);
  const cands = new Set();
  for (const t of T.E) for (const i of hIndex.byTok.get(t) || []) cands.add(i);
  for (const t of T.topics) for (const i of hIndex.byTopic.get(t.key) || []) cands.add(i);
  // a story's headline is news: never older than 4 days, whatever the caller allows (a 5-day-old live blog is not today's story)
  const ageCap = Math.min(maxAgeMs, 96 * 3_600_000);
  const fresh = (it) => { const t = Date.parse(it.publishedAt); return Number.isFinite(t) && now - t <= ageCap && t - now < 15 * 60_000; };
  const out = [];
  for (const i of cands) {
    const h = hIndex.list[i];
    if (!fresh(h.it)) continue;
    // sports / gaming desk headlines only ever go with sports / games stories ("clean sweep" is not an election sweep)
    if (!entity && SPORTY.has(String(h.it.category || '').toLowerCase())) continue;
    const H = h.news.tw;
    let e = 0, p = 0, eOut = 0, eNonP = 0;
    for (const t of T.E) if (hasStem(H, t)) { e++; if (T.oTok.has(t)) eOut++; if (!T.P.has(t)) eNonP++; }
    // a multi-word run ("Red Rocks", "Pete Hegseth") hits on a word of its own that is not an ordinary word, or as a whole:
    // "Raise the Red Lantern" never names "Red Rocks" (2026-11-05 news-gate build)
    // ... and a word of a name used as someone else's first name is no hit: "Thomas Massie" never names Clarence Thomas, "Tom Hanks"
    // never names Tom Homan (2026-11-05 news unlock audit)
    const runHit = (r) => (r.size === 1 ? hasStem(H, [...r][0]) : [...r].every((t) => hasStem(H, t)) || [...r].some((t) => !COMMON_RUN.has(t) && hasStem(H, t) && !namesake(t, r, h.it.title)));
    const pRuns = T.runs.filter(runHit).length;
    for (const t of T.P) if (hasStem(H, t) && (!COMMON_RUN.has(t) || T.runs.some((r) => r.has(t) && (r.size === 1 || runHit(r))) || !T.runs.some((r) => r.has(t)))) p++;
    const topic = T.topics.some((t) => h.news.topics.includes(t));
    const oHits = T.outcomes.filter((o) => outcomeHit(o, H, h.lower)).length;
    let ok;
    // multi-outcome: the outcome named AND the event's own frame (a frame proper noun, or 2 frame words), so a headline
    // that merely names a candidate ("Elon Musk's very bad night") never lands on "#1 searched person on Google"
    // (two named outcomes in one headline is a story about the race: "Nvidia overtakes Apple as the largest company")
    const fHits = [...T.F].filter((t) => hasStem(H, t)).length;
    // sports / games races: a frame-only hit needs a rare subject ("IEM Beijing"), not a common award word ("MVP" took a
    // World Series MVP piece for the NFL MVP race)
    const pRare = [...T.P].some((t) => H.has(t) && idx.idf(t) >= idx.rareIdf);
    // ... and the outcome must be the story's own (its lead), or two outcomes together: "Arsenal pushed by pain" is rival news
    // on a Barcelona market, "Anthropic IPO" is not SpaceX news (2026-11-05).
    const leadHit = T.leadOut ? outcomeHit(T.leadOut, H, h.lower) || translitHit(T.leadOut, H) : false;
    const oOk = T.leadOut ? leadHit : oHits >= 1;
    // a full person name (two or more words) plus any word of the race itself ("Schumer ... Majority Leader") is the story;
    // "AZ-02" is "Arizona's 2nd Congressional District"
    const leadFull = leadHit && T.leadOut.toks.length >= 2 && T.leadOut.toks.every((t) => H.has(t));
    const distHit = T.districts.some((r) => r.test(h.lower));
    const fAll = [...T.Fall].filter((t) => hasStem(H, t)).length;
    if (T.multi) ok = (oHits >= 2 && fHits >= 1) || (oOk && ((entity ? pRare : p + (distHit ? 1 : 0) >= 1) || e - eOut >= 2 || (!entity && leadFull && fAll >= 1) || (!entity && leadHit && distHit))) || ((entity ? pRare : p + (distHit ? 1 : 0) >= 1) && e - eOut >= 2);
    // single question: two different subjects, or a subject plus a non-subject story word, or three story words
    // ... and a question with a named subject needs that subject: "Canada's GDP ... MoM in September" never takes
    // "Czech retail sales rise 0.1% MoM in September" on three shared frame words
    else ok = pRuns >= 2 || (pRuns >= 1 && eNonP >= 1) || ((pRuns >= 1 || (!T.runs.length && (!T.rawP.size || [...T.rawP].some((t) => H.has(t))))) && (e >= 3 || (topic && e >= 2 && eNonP >= 1)));
    // sports / games: the story's own team or player (its lead outcome) or two named outcomes; a generic league headline
    // ("Perfect Week 9 NFL DFS lineup") is no news on a 49ers title market
    if (ok && entity && T.multi && T.leadOut && !leadHit && oHits < 2) ok = false;
    if (ok && entity && SPORTS_FLUFF.test(h.it.title)) ok = false;
    // a person's job in doubt: the full name plus any "replace / fire / stay / fall guy" headline answers "out as Secretary of Defense"
    // a price-level market needs a price headline ("gas and grocery costs" is not a gas price)
    if (ok && T.levelQ && !LEVEL_HEAD.test(h.it.title)) ok = false;
    // a price-level market ("Gold above $4,128", "Brent above $98"): a headline naming the asset and its price is the story
    if (!ok && T.levelQ && p >= 1 && LEVEL_HEAD.test(h.it.title)) ok = true;
    if (!ok && !T.multi && T.leaveQ && T.runs.some((r) => personHit(r, h.it.title, H)) && LEAVE_HEAD.test(h.it.title)) ok = true;
    // single question: the headline must name the question's own subject (the first proper noun) unless a strong topic is shared
    // ("Sarah Paulson ... Rotten Tomatoes score" is not "The Cat in the Hat Rotten Tomatoes score")
    // race-result lever: a margin / vote-share / turnout bracket takes the race result itself ("Democrat Amy Acton wins Ohio's
    // race for governor"): same state (or district), same office, a result verb; the bracket's frame words are not needed
    const resultHit = T.resultQ && RESULT_HEAD.test(h.it.title) && [...officesIn(h.it.title)].some((o) => T.offices.has(o))
      && ([...T.raceGeo].some((g) => geoNames(h.it.title).has(g)) || distHit);
    if (!ok && resultHit && (pRuns >= 1 || e >= 2)) ok = true;
    // a strong topic stands in for the subject only when the topic IS the subject ("Fed" for a Fed question, "Alito" for SCOTUS);
    // "Google will block search access" is not Bad Bunny's Year in Search (2026-11-05 news-gate build)
    const topicSubj = topic && (!T.first.size || T.topics.some((tp) => h.news.topics.includes(tp) && [...T.first].some((f) => tp.covers.has(f) || tp.market.test(f))));
    if (ok && !T.multi && T.first.size && !topicSubj && [...T.first].filter((t) => hasStem(H, t)).length < (T.first.size >= 4 ? Math.ceil(T.first.size * 0.6) : 1)) ok = false;
    // single question whose headline only names the subject: it must also touch what is asked (the frame)
    if (ok && !T.multi && T.frame.size && pRuns < 2 && !resultHit && ![...T.frame].some((t) => hasStem(H, t)) && !(T.leaveQ && LEAVE_HEAD.test(h.it.title)) && !(T.levelQ && T.asset?.h.test(h.it.title) && LEVEL_HEAD.test(h.it.title))) { if (process.env.PNN_MATCH_DEBUG) console.error('frame miss', h.it.title.slice(0, 60), [...T.frame]); ok = false; }
    // Event level (option 3): a multi-outcome story whose lead is not named still takes a headline that is unambiguously about
    // the event: its own subject plus two frame words ("Justice Alito ... Supreme Court" on the next justice), a rival
    // outcome plus a distinctive frame word ("Brosnan endorses Callum Turner as next Bond" on Josh O'Connor), or an official
    // release on the policy itself. Never on one shared word or an outcome name alone (measured 15% precision).
    let tier = 'exact';
    const evCand = T.multi && T.leadOut && !leadHit && oHits < 2;
    const leadMiss = evCand && !T.race && !(T.leadGeo.size && [...geoNames(h.it.title)].some((g) => T.leadGeo.has(g)));
    let evOk = false;
    if (!entity && evCand) {
      const fsHit = [...T.Fs].filter((t) => hasStem(H, t));
      const fsHits = fsHit.length + (distHit ? 1 : 0);
      // the event's subject run plus two distinctive frame words, one of them its most distinctive ("Justice Alito ... Supreme
      // Court" on the next justice); "Oscar Micheaux Film Institute" names "Oscar" and "film", not "documentary", and "Mass
      // Effect ... Feature Doc" is not Best Animated Feature
      const fsTop = [...T.Fs].reduce((a, t) => (!a || idx.idf(t) > idx.idf(a) ? t : a), null);
      const topHit = !!fsTop && fsHit.includes(fsTop);
      // (when the most distinctive word is the subject run itself, "Critics" of "Critics Choice Awards", a second one is needed)
      const runToks = new Set(T.runs.filter(runHit).flatMap((r) => [...r]));
      const subjOk = pRuns >= 1 && ((topHit && fHits >= 2 && (fsHit.length >= 2 || !runToks.has(fsTop))) || fsHit.length >= 3);
      // a rival outcome by name (a word of its own, not one the event title shares: "Exactly 1 cut" is not a name) plus the
      // event's most distinctive frame word (or two frame words, or its district): "OpenAI ... cybersecurity model" is not
      // "best coding model"
      const evTok = new Set(tokens(T.evTitle));
      const rival = T.namedOutcomes.some((o) => outcomeHit(o, H, h.lower) && o.toks.some((t) => !evTok.has(t) && H.has(t)));
      const rivalOk = rival && (fsHits >= 2 || topHit || distHit);
      const officialOk = !!h.it.official && topic && fsHits >= 1 && POLICY_HEAD.test(h.it.title);
      // a race's own office: an Alaska Senate headline is not Alaska Governor news
      const hOff = officesIn(h.it.title);
      const officeOk = !T.offices.size || !hOff.size || [...hOff].some((o) => T.offices.has(o));
      evOk = officeOk && fsHits >= 1 && (subjOk || rivalOk || officialOk);
      // an award race takes an event-level headline only when it is about the race, not a person's private life
      if (evOk && AWARD_RACE_Q.test(T.storyText) && (PERSONAL_HEAD.test(h.it.title) || !RACE_ABOUT_HEAD.test(h.it.title))) evOk = false;
      if (process.env.PNN_MATCH_DEBUG) console.error(evOk ? 'event ok' : 'event no', { subjOk, rivalOk, officialOk, officeOk, fsHit, pRuns, fsTop }, h.it.title.slice(0, 60));
    }
    if (!ok && evOk) { ok = true; tier = 'event'; }
    let why = 'story';
    if (!ok && entity && SPORTY.has(String(h.it.category || '').toLowerCase()) && !SPORTS_FLUFF.test(h.it.title)) {
      // a rare subject named in full: "LIV Golf" needs "LIV", not just "golf" ("Good Good Golf executive...")
      const rareP = T.runs.some((r) => [...r].every((t) => H.has(t)) && [...r].some((t) => idx.idf(t) >= idx.rareIdf && !ENTITY_GENERIC.has(t)));
      // a one-word outcome ("Philadelphia") also needs a story word ("NBA", "Finals"): Eagles news is not 76ers news
      // ... and every outcome hit needs the event's frame too: "Jeremiah Smith ... NFL draft prospect" is not Heisman news
      // the story's own subject (its lead outcome), never a rival from the same race: Arsenal news is not Barcelona news
      const subj = T.leadOut ? [T.leadOut] : T.entOutcomes;
      ok = subj.some((o) => outcomeHit(o, H, h.lower) && (e - eOut >= 1 || fHits >= 1)) || (!T.multi && rareP);
      why = 'entity';
    }
    if (!ok) continue;
    // another office's race: a Maine House headline is not news on a Senate-seats market (2026-11-05 news-gate verify)
    if (!entity && T.offices?.size) { const ho = officesIn(h.it.title); if (ho.size && ![...ho].some((o) => T.offices.has(o))) { if (process.env.PNN_MATCH_DEBUG) console.error('office miss', h.it.title.slice(0, 60)); continue; } }
    // wrong place: a local story on a national market, another country's data on a named-country question
    if (scopeMismatch(T.storyText, h.it.title) || (!entity && geoMiss(T.storyText, h.it.title))) { if (process.env.PNN_MATCH_DEBUG) console.error('geo miss', h.it.title.slice(0, 60)); continue; }
    // the story's own subject (2026-11-05): a multi-outcome story that is not a race ("who will attend", "which movie",
    // "best actor nominee", "#1 searched person") needs its lead outcome named, or two outcomes together; a headline about
    // the field or a rival ("Best Actor odds: Malkovich leads" on Tom Cruise, "Iran's new supreme leader" on Witkoff) is not it
    // ... unless it is about the event itself (event tier above): then it backs every outcome, labelled as event-level
    if (leadMiss) { if (!evOk) { if (process.env.PNN_MATCH_DEBUG) console.error('lead miss', h.it.title.slice(0, 60)); continue; } tier = 'event'; }
    // what is asked: reviews for a Rotten Tomatoes score, a ranking / model for "best AI", a fresh price move for a price level
    const ageH = (now - (Date.parse(h.it.publishedAt) || 0)) / 3_600_000;
    const qm = questionMiss(T, h.it.title, ageH, leadHit);
    if (qm) { if (process.env.PNN_MATCH_DEBUG) console.error(`question miss (${qm})`, h.it.title.slice(0, 60)); continue; }
    const viaStory = why === 'story';
    if (process.env.PNN_MATCH_DEBUG) why += ` e=${[...T.E].filter((t) => H.has(t))} p=${[...T.P].filter((t) => H.has(t))} o=${oHits} topic=${topic} multi=${T.multi}`;
    const score = e + 2 * p + 3 * oHits + (topic ? 3 : 0) + (leadHit ? 4 : 0) + (T.qtypes.length || T.asset ? 1 : 0);
    // relevance floor: one shared word plus a frame word is not enough on its own (entity matches carry their own proof)
    if (viaStory && score < minScore) { if (process.env.PNN_MATCH_DEBUG) console.error(`low score ${score}`, h.it.title.slice(0, 60)); continue; }
    // an event-level headline ranks below an exact one; a podcast / round-up / live blog only when nothing cleaner exists
    const adj = (tier === 'event' ? 0.85 : 1) * (LEDE_HEAD.test(h.it.title) && !h.it.official ? 0.6 : 1);
    out.push({ item: h.it, score: Math.round(score * adj * 100) / 100, why, tier, about: tier === 'event' ? (T.race ? 'race' : 'question') : null, tw: H, outlet: String(h.it.outlet || h.it.source || '').toLowerCase() });
  }
  // Corroboration (2026-11-05): a headline that other outlets also ran (similar wording among the matches) is a story,
  // not one site's take; it ranks ahead of a lone piece of the same age.
  for (const x of out) {
    const outlets = new Set();
    for (const y of out) {
      if (y === x || !y.outlet || y.outlet === x.outlet || outlets.has(y.outlet)) continue;
      let both = 0; for (const k of x.tw.keys()) if (y.tw.has(k)) both++;
      if (both / Math.max(1, Math.min(x.tw.size, y.tw.size)) >= 0.4) outlets.add(y.outlet);
    }
    x.outlets = outlets.size + 1;
    x.score += Math.min(3, 1.5 * outlets.size);
  }
  for (const x of out) { delete x.tw; delete x.outlet; }
  // Freshest strong match first: recency matters more than a slightly higher score.
  const ts = (x) => Date.parse(x.item.publishedAt) || 0;
  // an exact hit outranks an event-level one of similar age (event counts as 6h older)
  const key = (x) => ts(x) / 3_600_000 + x.score * 0.5 - (x.tier === 'event' ? 6 : 0);
  out.sort((a, b) => key(b) - key(a));
  const seenT = new Set();
  return out.filter((x) => { const k = lowerWords(x.item.title); if (seenT.has(k)) return false; seenT.add(k); return true; }).slice(0, max);
}

/** Score arbitrary headlines (e.g. a Google News search) against one story; strict, same scorer. */
export function filterHeadlinesForStory(story, items, marketIndex = [], opts = {}) {
  const arr = (items || []).filter((x) => x?.title);
  if (!arr.length) return [];
  return matchStoryNews(story, buildHeadlineIndex(arr), marketIndex, { max: 3, ...opts });
}

/**
 * Story packages (2026-11-05): which aired stories does ONE wire cluster strictly cover? Each story is run through the same
 * story-news matcher (question-type rules, subject / frame / outcome checks, scope and race rules) against the cluster's own
 * headlines only, and kept only on an exact-tier hit (the headline names the story's own subject and question; event-level
 * hits never count). Returns [{story, item, score, tier}], best first.
 */
export function matchClusterStories(cluster, stories, marketIndex = [], { now = Date.now(), maxAgeMs = 12 * 3_600_000, minScore = 4 } = {}) {
  const items = (cluster?.items || []).filter((x) => x?.title);
  if (!items.length || !stories?.length) return [];
  const hIndex = buildHeadlineIndex(items);
  const out = [];
  for (const story of stories) {
    let hits = [];
    try { hits = matchStoryNews(story, hIndex, marketIndex, { now, max: 3, maxAgeMs, minScore }); } catch { hits = []; }
    const h = hits.find((x) => x.tier === 'exact' && x.score >= minScore);
    if (!h) continue;
    out.push({ story, item: h.item, score: h.score, tier: h.tier });
  }
  return out.sort((a, b) => b.score - a.score);
}

export default { matchClusterStories, matchMarkets, analyzeCluster, searchQueries, searchPolymarket, searchKalshi, kalshiSearchToV2, TOPICS, buildHeadlineIndex, matchStoryNews, filterHeadlinesForStory, storyEntities };
