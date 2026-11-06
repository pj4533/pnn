#!/usr/bin/env node
// Offline checks for the wire headline filters and the 72h parse window (no network).
//   node scripts/test-wire-filters.mjs
// Covers: sensitive (D4, incl. the "deadly Iran border fire" case), site-title junk, the fluff group and its news-verb
// exception, the 72h age cap, feed list hygiene (unique ids, https, politeness, dead list kept out).
import cfg from '../server/wire-config.mjs';
import { compileFilters, rejectReason, normalizeItems } from '../server/sources/wire.mjs';
import { badNewsSource } from '../server/sources/news.mjs';

const f = compileFilters(cfg);
let fails = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fails++; };
const why = (t, skip = null) => rejectReason(t, f, skip, t);

for (const t of ['Putin, Rezaei meet as Turkey probes deadly Iran border fire', 'Turkey probes border clashes with Iran', 'Gunman killed after attack on border post', 'Beheaded statue found in museum depot', 'Opposition leader slain in capital'])
  check(`sensitive: ${t}`, why(t) === 'sensitive');
for (const t of ['Federal Reserve Board - Home', 'Home | Federal Reserve', 'Calendar', 'Press Releases'])
  check(`junk: ${t}`, why(t) === 'junk');
for (const t of ['Pop Stars podcast: Harry Shum on the new season', 'Raise the Red Lantern review – a dazzling restoration', 'Review: The Beatles Anthology',
  'Taylor Swift interview: on her new album', 'Ranked: every Bond film', 'Weekly sports quiz: who scored twice', 'Election night recap: what we learned',
  'The best of 2026 playlist', 'Photos: Celebration and gloom at watch parties across the U.S.', 'Gift guide for the tech lover'])
  check(`fluff: ${t}`, why(t, ['sports']) === 'fluff');
for (const t of ['Netflix announces new podcast network', 'Hollywood Reporter interview: Oscar winner named to Academy board', 'Brosnan endorses Callum Turner as next Bond',
  'Fed holds rates steady and signals a December hike', 'Apple ranked world\'s most valuable company again', 'Talarico wins Texas Senate seat'])
  check(`kept: ${t}`, why(t) === null);
// 2026-11-05 news unlock audit: war-adjacent Hormuz wording (D4); labor strikes and an ordinary ship fire stay
for (const t of ['Iran says tankers, tugboat catch fire in Strait of Hormuz', 'U.S. Strikes Iranian Targets Along Strait of Hormuz', 'Internet disruptions hit Iran amid prospect of renewed US strikes'])
  check(`sensitive: ${t}`, why(t) === 'sensitive');
for (const t of ['Writers strike targets studios over AI rules', 'Union strikes deal with automakers']) check(`kept: ${t}`, why(t) === null);
// independence: crypto-exchange news desks and bookmaker odds stories are never the news item
check('KuCoin via Google News is an exchange outlet', badNewsSource({ title: 'Anthropic Rumored to Test Claude Mythos 5.5 Ahead of IPO', outlet: 'KuCoin via Google News' }) === 'exchange');
check('CoinMarketCap is an exchange outlet', badNewsSource({ title: 'US CPI preview: inflation seen at 3.1%', outlet: 'CoinMarketCap' }) === 'exchange');
check('VegasOdds is an exchange outlet', badNewsSource({ title: 'Time Person of the Year 2026 picks', outlet: 'VegasOdds.com' }) === 'exchange');
check('"Odds Shift" headline is promo', badNewsSource({ title: 'Jack Lowden James Bond Casting Hopes Face a New Challenge as 007 Actor Odds Shift', outlet: 'Comic Book Resources' }) === 'promo');
check('Gold Derby award race headline stays', badNewsSource({ title: 'Oscar Predictions: Best Actress race heats up', outlet: 'Gold Derby' }) === null);
// description does not trigger title-only groups
check('description mentioning "review" does not drop a headline', rejectReason('Court rules on tariffs a review of the case', f, null, 'Court rules on tariffs') === null);

// 72h window
const now = Date.parse('2026-11-05T12:00:00Z');
const feed = { id: 't', outlet: 'T', category: 'politics' };
const raw = (h, title) => ({ title, url: `https://e.com/${h}`, ts: now - h * 3_600_000, desc: '' });
const out = normalizeItems(feed, [raw(1, 'Fed holds rates'), raw(60, 'Court rules on tariffs'), raw(71, 'Senate passes budget bill'), raw(73, 'Old news item here')], cfg, f, now, { filtered: {} });
check('72h parse window keeps 1h, 60h, 71h and drops 73h', out.length === 3 && !out.some((i) => /Old news/.test(i.title)));

// feed list hygiene
const ids = cfg.feeds.map((x) => x.id);
check('feed ids unique', new Set(ids).size === ids.length);
check('110 feeds', cfg.feeds.length >= 110);
// 2026-11-05 news unlock: Google News searches are aggregators and poll slowly (~1.5 requests/min to the host in total)
const gn = cfg.feeds.filter((x) => /news\.google\.com\/rss\/search/.test(x.url));
check('news unlock GN searches are aggregators polled >= 900s', gn.length >= 24 && gn.every((x) => x.aggregator && x.everySec >= 900 && x.outlet === 'Google News'));
check('news.google.com total poll rate <= 2/min', cfg.feeds.filter((x) => /news\.google\.com/.test(x.url)).reduce((a, x) => a + 60 / x.everySec, 0) <= 2);
check('macrumors present', ids.includes('macrumors'));
check('every feed https and >= 60s', cfg.feeds.every((x) => x.url.startsWith('https://') && x.everySec >= 60));
const underHost = {};
for (const x of cfg.feeds.filter((y) => y.id !== 'nws' && y.everySec < 180)) { const h = new URL(x.url).host; underHost[h] = (underHost[h] || 0) + 1; }
const newIds = new Set('thr billboard indiewire rollingstone variety-film verge-ai ars wired mit-tr engadget theinformation scotusblog courthousenews politico-politics politico-congress rollcall nbc-politics fox-politics abc-politics npr-politics semafor nyt-business fortune businessinsider ft npr-econ cnbc-world livescience sciencedaily physorg spacenews nasa-breaking guardian-us nyt-us nyt-world dw france24 kff nyt-health'.split(' '));
check('new feeds all >= 180s', cfg.feeds.filter((x) => newIds.has(x.id)).every((x) => x.everySec >= 180));
check('all 39 new feeds present', [...newIds].every((id) => ids.includes(id)));
const dead = /\/\/ew\.com|vulture\.com|lawfaremedia|venturebeat|washingtonpost|finance\.yahoo|bls\.gov|usatoday|rss\.cnn\.com|calculatedrisk|playbook/;
check('dead list kept out', !cfg.feeds.some((x) => dead.test(x.url)));
check('maxItemAgeHours is 72', cfg.maxItemAgeHours === 72);

console.log(fails ? `\n${fails} FAILURES` : '\nall wire filter checks passed');
process.exit(fails ? 1 : 0);
