// Offline tests for the news search path (no network): searchTargets ordering and retry backoff, search persistence with
// misses, the retail / junk / sensitive headline drops, refineQuery. Run: node scripts/test-news-search.mjs
import { createNewsdesk } from '../server/newsdesk.mjs';
import { badNewsSource, refineQuery, sensitiveHeadline, junkTitle, parseRss } from '../server/sources/news.mjs';

let fail = 0;
const check = (ok, name) => { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
const MIN = 60_000;
const story = (id, extra = {}) => ({ id, category: 'politics', lead: { id }, markets: [], ...extra });
const ids = (arr) => arr.map((s) => s.id);

// --- searchTargets: never searched first (moving-first ahead), then due retries (oldest due first), then stale search-only
{
  const nd = createNewsdesk();
  const now = Date.now();
  nd.load([
    ['retry-old', { at: now - 400 * MIN, found: false, misses: 1, items: [] }],
    ['retry-new', { at: now - 100 * MIN, found: false, misses: 1, items: [] }],
    ['not-due', { at: now - 30 * MIN, found: false, misses: 1, items: [] }],
  ]);
  const pending = [story('n1'), story('retry-new'), story('n2', { movingFirst: { points: 0.09 } }), story('retry-old'), story('not-due'), story('sg', { category: 'sports' })];
  const t = ids(nd.searchTargets(pending, [], { max: 14 }));
  check(JSON.stringify(t) === JSON.stringify(['n2', 'n1', 'retry-old', 'retry-new']), `ordering: moving-first, never-searched, due retries oldest first, no sports (${t})`);
  check(ids(nd.searchTargets(pending, [], { max: 2 })).length === 2, 'max is honoured');
  const pool = nd.poolStats(pending);
  check(pool.size === 5 && pool.neverSearched === 2 && pool.retrying === 3, `poolStats (${JSON.stringify(pool)})`);
}

// --- retry backoff: misses 1 / 2 / 3 -> 90 / 180 / 360 min, capped at 360
{
  const now = Date.now();
  const due = (misses, agoMin) => {
    const nd = createNewsdesk();
    nd.load([['s', { at: now - agoMin * MIN, found: false, misses, items: [] }]]);
    return nd.searchTargets([story('s')], [], {}).length === 1;
  };
  check(!due(1, 80) && due(1, 100), 'miss 1: waits 90 min');
  check(!due(2, 150) && due(2, 200), 'miss 2: waits 180 min');
  check(!due(3, 300) && due(3, 370), 'miss 3: waits 360 min');
  check(!due(6, 300) && due(6, 370), 'miss 6: still capped at 360 min');
  // a record saved before `misses` existed counts as one miss
  const nd = createNewsdesk();
  nd.load([['old', { at: now - 100 * MIN, found: false, items: [] }]]);
  check(nd.searchTargets([story('old')], [], {}).length === 1, 'legacy record without misses = 1 miss');
}

// --- setSearch counts consecutive misses and a hit resets them; dump/load round trip keeps misses; dump drops entries > 48h
{
  const nd = createNewsdesk();
  nd.setSearch('a', [], { found: false });
  nd.setSearch('a', [], { found: false });
  nd.setSearch('a', [], { found: false });
  check(nd.searched('a').misses === 3, 'three consecutive misses = misses 3');
  nd.setSearch('b', [], { found: false });
  nd.setSearch('b', [{ item: { title: 'Fed holds rates', source: 'Reuters', url: 'https://x/y', publishedAt: new Date().toISOString() }, score: 5, tier: 'event', about: 'question' }], { found: true });
  check(nd.searched('b').misses === 0 && nd.searched('b').items[0].tier === 'event' && nd.searched('b').items[0].about === 'question', 'a hit resets misses and keeps tier / about');
  const dumped = JSON.parse(JSON.stringify(nd.dump()));
  const nd2 = createNewsdesk();
  nd2.load(dumped);
  check(nd2.searched('a')?.misses === 3 && nd2.searched('b')?.items.length === 1, 'dump / load round trip keeps misses and items');
  check(nd2.searchTargets([story('a')], [], {}).length === 0, 'a restart does not re-search a recent miss');
  const old = createNewsdesk();
  old.load([['x', { at: Date.now() - 49 * 3_600_000, found: false, misses: 1, items: [] }], ['y', { at: Date.now() - 47 * 3_600_000, found: false, misses: 1, items: [] }]]);
  check(old.dump().length === 1 && old.dump()[0][0] === 'y', 'dump keeps 48h');
}

// --- filters: retail outlets, site-title junk, sensitive headlines, stale dates
{
  const hit = (title, outlet, extra = {}) => badNewsSource({ title, outlet, source: outlet, ...extra });
  check(hit('The Hunger Games album sells 500,000 units', 'Blood Records') === 'retail', 'record store outlet never airs');
  check(hit('Taylor Swift tour dates announced', 'Ticketmaster') === 'retail', 'ticket seller never airs');
  check(hit('Deluxe vinyl edition', 'Amazon.com') === 'retail', 'amazon never airs');
  check(hit('Taylor Swift album breaks streaming record', 'Daily Record') === null, 'a newspaper called Record still airs');
  check(hit('Fed holds rates steady', 'Reuters', { url: 'https://www.ebay.com/itm/1' }) === 'retail', 'retail domain never airs');
  check(hit('Vladimir Putin, Rezaei meet as Turkey probes deadly Iran border fire', 'Reuters') === 'sensitive', 'deadly border fire is sensitive (QUEUED-FIXES 16)');
  check(hit('Federal Reserve Board - Home', 'Federal Reserve (.gov)') === 'junk', 'site-title junk "Federal Reserve Board - Home"');
  check(hit('Calendar', 'Federal Reserve (.gov)') === 'junk', 'site-title junk "Calendar"');
  check(hit('Fed holds rates steady, signals December cut', 'Reuters') === null, 'a normal headline passes');
  check(hit('Warsh Fed Should Heed New Zealand\'s Cautionary Tale', 'Bloomberg.com') === null, 'Bloomberg headline passes');
  for (const t of ['Troops mass at the border as ceasefire talks stall', 'Gunman kills three in attack', 'Strike hits Gaza hospital', 'Officials mourn after fatal crash', 'Hostage deal reached']) {
    check(sensitiveHeadline(t), `sensitive: ${t}`);
  }
  check(!sensitiveHeadline('Ossoff climbs in the 2028 Democratic nomination race'), 'politics headline is not sensitive');
  check(junkTitle({ title: 'Home' }) === 'junk' && junkTitle({ title: 'Fed raises rates' }) === null, 'junkTitle');
  const rss = (title, src, date) => `<item><title>${title} - ${src}</title><link>https://news.google.com/rss/articles/x${Math.random()}</link><pubDate>${date}</pubDate><source url="https://example.com">${src}</source></item>`;
  const xml = `<rss><channel>${rss('Federal Reserve Board - Home', 'Federal Reserve (.gov)', 'Tue, 21 Mar 2006 02:29:45 GMT')}${rss('Fed signals December cut', 'Reuters', new Date().toUTCString())}${rss('Fed meeting calendar', 'Reuters', 'Tue, 21 Mar 2017 02:29:45 GMT')}</channel></rss>`;
  const items = parseRss(xml);
  check(items.length === 1 && items[0].title === 'Fed signals December cut', `parseRss drops junk and years-old items (${items.map((i) => i.title)})`);
}

// --- refineQuery
{
  check(refineQuery('Fed rate above 3.80 December') === 'Fed rate December', 'refineQuery drops thresholds');
  check(refineQuery('closes price above 97.99 USD t.oz gold') !== '', 'refineQuery never returns empty');
  check(refineQuery('Ossoff 2028 Democratic nomination') === 'Ossoff 2028 Democratic nomination', 'refineQuery keeps years');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall passed');
process.exit(fail ? 1 : 0);
