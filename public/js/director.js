// Director: a MIXED stream of single full-screen story cards (user, 2026-11-04: "we're showing five of the same type in
//   a row… it needs to be different each time"). Each step picks a card kind different from the last one
//   (STORY FOCUS / BIGGEST MOVERS / THIS WEEK / a DESK story), and a story whose category group differs from the last
//   card's. Scheduled resets: TOP STORIES every ~6–8 cards, STORY OF THE DAY every ~9–11 (when state.sotd), COUNTDOWN DESK
//   every ~11–13 (when state.countdown), MARKETS (a stock / index / bond yield with its paired odds, when state.finance) every ~5–6 cards. Stories come from per-list shuffle bags (draw()): every list airs all its items
//   before any repeats, then reshuffles; random start on page load.
// Watchability (2026-11-04):
//   - the director plans two cards ahead, so the top bar can tease "NEXT: <short> · then <short>";
//   - no story re-airs within 5 minutes under any banner (aired map + the planned cards), when anything else is available;
//   - a settling story (>=95% / <=5% after a big move) airs once, then leaves every bag until it stops settling;
//   - the chyron carries "ALSO MOVING: …" (a mover not on screen) or the tease instead of repeating the card's headline.
// ?fast=1 runs the clock 10x for testing; window.__pnn.airLog lists what aired. Client 'air'/'draw' logs go to the server.
// Keys: → next card, Space pause, 1–8 force top/focus/movers/week/desk/sotd/countdown/markets now; t/w/y/x/p force toss-up / week swings / steady / exchanges disagree / package.
import { report, pct, money, exchangeName, ago, newsOf, isMovingFirst } from './util.js';
import { pointsText, VARIETY_TITLES } from './cards.js';
import { finCards, finItems, finStory } from './finance.js';

// The kinds of card in the mix (weights: how often each kind is picked; never the same kind twice in a row).
const RUNDOWN = [
  { id: 'top', ms: 22000, w: 0 },            // scheduled: every SCHED.top cards
  { id: 'focus', ms: 10000, w: 3 },
  { id: 'movers', ms: 9000, w: 2 },
  { id: 'week', ms: 9000, w: 1 },
  { id: 'desk', ms: 9000, w: 3 },
  { id: 'sotd', ms: 13000, w: 0 },           // scheduled
  { id: 'countdown', ms: 10000, w: 0 },      // scheduled
  { id: 'markets', ms: 11000, w: 0 },        // scheduled: at most one per 5-6 cards (a price chart needs the time)
  // variety segments (2026-11-05): the same data another way. They ride on overlay id 'focus' (seg.kind says which card); each
  // needs `gap` cards since its last airing (about 1 per 8, packages about 1 per 6), and is skipped when state has no data for it.
  { id: 'tossup', ms: 9000, w: 1 },
  { id: 'swings', ms: 9000, w: 1 },
  { id: 'steady', ms: 9000, w: 1 },
  { id: 'disagree', ms: 10000, w: 1 },
  { id: 'package', ms: 12000, w: 2 },
];
const VGAP = { tossup: 8, swings: 8, steady: 8, disagree: 8, package: 6 };
const VKEYS = { t: 'tossup', w: 'swings', y: 'steady', x: 'disagree', p: 'package' }; // dev keys
const VALIAS = { // state.segments = {tossups, weekSwings, quietFavorites, disagreements} (server); the other names are tolerated aliases; a flat array of {kind, ...} also works
  tossup: ['tossup', 'tossups', 'tossUp', 'tossUps', 'toss-up'], swings: ['weekSwings', 'swings', 'weeklySwings', 'week-swings'],
  steady: ['quietFavorites', 'steady', 'steadyFavorites', 'steadyFavorite', 'steady-favorites'], disagree: ['disagreements', 'disagree', 'exchangesDisagree', 'exchanges'],
};
const VTEASE = { tossup: 'Toss-up', swings: "This week's swings", steady: 'Steady favorite', disagree: 'Exchanges disagree', package: 'The story behind the odds' };
const wkPts = (s, it) => Math.abs(Number.isFinite(it?.week?.delta) ? it.week.delta : Number.isFinite(it?.swing?.delta) ? it.swing.delta : s.lead.change1w ?? 0);
const VQUAL = { // a last client-side sanity check on what the server sent (never air a card its own title contradicts)
  tossup: (s) => s.lead.yesPrice >= 0.35 && s.lead.yesPrice <= 0.65,
  swings: (s, it) => wkPts(s, it) >= 0.05,
  steady: (s) => s.lead.yesPrice >= 0.6,
  disagree: (s) => (Array.isArray(s.exchanges) ? s.exchanges : []).filter((x) => x && Number.isFinite(x.yesPrice)).length >= 2,
};
const DEF = Object.fromEntries(RUNDOWN.map((d) => [d.id, d]));
const SCHED = { top: [6, 8], sotd: [9, 11], countdown: [11, 13], markets: [4, 5] }; // after a random a–b cards
const SCHED_ORDER = ['top', 'sotd', 'countdown', 'markets'];
const RECENT_MS = 5 * 60000; // no story twice within 5 minutes, under any banner
// category groups for "no two similar stories in a row"
const GROUP = { elections: 'politics', courts: 'politics', geopolitics: 'world', science: 'tech', health: 'tech', weather: 'culture', games: 'sports' };
const DESK_IDS = new Set(['economy', 'tech', 'world', 'culture', 'politics', 'sports']);
const groupOf = (s) => (s?.category ? GROUP[s.category] || s.category : DESK_IDS.has(s?.id) ? s.id : null); // stories by category; desks by id
const SPEED = Number(new URLSearchParams(location.search).get('fast')) > 0 ? 10 : 1; // ?fast=1: 10x clock for tests
const T0 = Date.now();
const clock = () => T0 + (Date.now() - T0) * SPEED; // scaled "now" for freshness
const ms$ = (ms) => ms / SPEED;
const SEGNAME = (s) => s.kind || s.id;
const MINI_POOL = 12;         // TOP STORIES minis draw from board ranks 2..12
const KEYS = ['top', 'focus', 'movers', 'week', 'desk', 'sotd', 'countdown', 'markets'];
const DESK_TAG = { economy: 'ECONOMY', tech: 'TECH', world: 'WORLD', culture: 'CULTURE', politics: 'POLITICS', sports: 'SPORTS & GAMES' };
const DESK_ORDER = ['economy', 'tech', 'world', 'culture', 'politics', 'sports'];
const rand = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
const futureCountdown = (s) => (Array.isArray(s?.countdown) ? s.countdown : []).filter((c) => c?.at && Date.parse(c.at) > Date.now());

export function createDirector({ overlay, chyron, scene }) {
  let state = null, timer = 0, paused = false, current = null, held = false, onAir = null, curAlt = null;
  let sceneSig = '';
  const aired = new Map(); // storyId -> last time it was shown anywhere (scaled clock)
  const airLog = [];       // recent [{id, at, seg}] (capped), for tests
  const settled = new Set(); // settling stories that already had their one appearance
  let plan = [];           // the next two cards, already drawn (for the NEXT tease)
  // plan-time bookkeeping (the last PLANNED card, which airs after everything already planned)
  let pLast = null, pGroup = null;
  const sinceV = Object.fromEntries(Object.entries(VGAP).map(([k, g]) => [k, Math.floor(Math.random() * g)])); // cards since each variety kind last aired
  const since = { top: 0, sotd: 0, countdown: 0, markets: 0 }, after = { top: rand(SCHED.top), sotd: rand([4, 6]), countdown: rand([6, 8]), markets: rand([2, 4]) };
  const note = (id, seg) => {
    if (!id) return;
    const at = clock();
    const last = airLog[airLog.length - 1];
    if (last && last.id === id && last.seg === seg && at - last.at < 2000) return; // same event noted twice (e.g. flash start + cut)
    aired.set(id, at);
    airLog.push({ id, at, seg });
    if (airLog.length > 600) airLog.splice(0, airLog.length - 600);
  };
  const recent = (id) => !!id && ((aired.has(id) && clock() - aired.get(id) < RECENT_MS) || onAir?.story?.id === id || plan.some((p) => p.story?.id === id));
  // a settling story airs once, then it's out of every list (it comes back if it stops settling)
  const live = (list) => (list || []).filter((x) => x && !(x.settling && settled.has(x.id)));

  // ---- shuffle bags (user, 2026-11-04): every list airs in a random order, goes through ALL its items before any
  // repeats, then reshuffles (never starting the new round with the item just shown). Items that join mid-round are
  // slotted in at a random spot; items that left are skipped. Bags start random on every page load.
  // Picks prefer, in order: not aired in the last 5 min AND a different category group; not aired in 5 min; anything.
  const bags = new Map(); // name -> { queue: id[], done: Set<id>, last: id|null }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function draw(name, list, k, avoid = null, { block = true } = {}) {
    const byId = new Map(list.map((x) => [x.id, x]));
    let b = bags.get(name);
    if (!b) { b = { queue: shuffle([...byId.keys()]), done: new Set(), last: null }; bags.set(name, b); }
    const queued = new Set(b.queue);
    for (const id of byId.keys()) if (!queued.has(id) && !b.done.has(id)) b.queue.splice(Math.floor(Math.random() * (b.queue.length + 1)), 0, id);
    const out = [];
    const taken = (id) => out.some((x) => x.id === id);
    const tiers = [
      (id) => !(block && recent(id)) && (!avoid || groupOf(byId.get(id)) !== avoid),
      (id) => !(block && recent(id)),
      () => true,
    ];
    while (out.length < Math.min(k, byId.size)) {
      let cands = b.queue.filter((id) => byId.has(id) && !taken(id));
      // round finished, or everything left this round aired recently: start a new round (keeps the 5-min rule)
      if (!cands.length || (block && cands.every((id) => recent(id)) && [...byId.keys()].some((id) => !recent(id) && !cands.includes(id)))) {
        b.done.clear();
        const fresh = shuffle([...byId.keys()].filter((id) => !taken(id)));
        if (fresh.length > 1 && fresh[0] === b.last) fresh.push(fresh.shift());
        b.queue = fresh;
        cands = fresh;
        if (!cands.length) break;
      }
      let id = null;
      for (const t of tiers) { id = cands.find(t); if (id != null) break; }
      b.queue.splice(b.queue.indexOf(id), 1);
      b.done.add(id); b.last = id; out.push(byId.get(id));
    }
    return out;
  }

  const desksOf = (s) => (Array.isArray(s?.desks) ? s.desks : [])
    .filter((d) => d && d.id && Array.isArray(d.stories))
    .map((d) => ({ ...d, stories: live(d.stories.filter((x) => x?.lead)) }))
    .filter((d) => d.stories.length)
    .sort((a, b) => (DESK_ORDER.indexOf(a.id) + 1 || 99) - (DESK_ORDER.indexOf(b.id) + 1 || 99));
  const boardStories = () => live(state?.stories);
  const has = {
    top: (s) => s.stories?.length > 0,
    focus: () => boardStories().length > 0,
    movers: () => moverCards().length >= 3,
    week: () => weekCards().length > 0,
    desk: (s) => desksOf(s).length > 0,
    sotd: (s) => Array.isArray(s.sotd?.markets) && s.sotd.markets.length > 0 && !!s.sotd.title,
    countdown: (s) => futureCountdown(s).length >= 2, // one lone entry is a thin card; the corner chip still shows it
    markets: (s) => finCards(s).length > 0,
    ...Object.fromEntries(Object.keys(VGAP).map((k) => [k, () => varietyEntries(k).length > 0])),
  };
  const finStoryFor = (id) => { const fi = typeof id === 'string' && id.startsWith('fin:') ? finItems(state).find((x) => x.id === id) : null; return fi ? finStory(fi) : null; }; // a clicked ticker quote
  const deskStory = (eventId) => { for (const d of desksOf(state)) { const x = d.stories.find((s) => s.id === eventId); if (x) return x; } return null; };
  const storyFor = (eventId) => state.stories.find((s) => s.id === eventId) || state.closing?.find((s) => s.id === eventId) || deskStory(eventId) || finStoryFor(eventId) || null;
  // A mover whose event didn't make the board (clicked in the ticker or movers list): a minimal one-market story.
  // 'TN-04 House winner?' -> 'the TN-04 House race'; other contexts pass through without the '?'
  const place = (w) => { const t = w.replace(/\?$/, '').trim(); return /\s+winner$/i.test(t) ? `the ${t.replace(/\s+winner$/i, '')} race` : t; };
  function moverHeadline(m) {
    const p = Math.round(m.yesPrice * 100), pctTxt = p < 1 ? 'under 1%' : p > 99 ? 'over 99%' : `${p}%`;
    const who = m.label || m.outcome || m.eventTitle || m.title;
    // never "… in Who will win …" (QUEUED-FIXES 3): a server label is already self-contained, and a raw question is never a place
    const raw = m.label ? '' : m.context || (m.outcome ? m.eventTitle : '');
    const where = /^(will|who|what|which|when|how|is|are|does|do|can)\b/i.test(raw || '') ? '' : raw;
    const n = Math.round((m.change1d ?? 0) * 100), verb = n > 0 ? 'climbs to' : n < 0 ? 'slips to' : 'holds at';
    return `${who} ${verb} ${pctTxt}${where ? ` in ${place(where)}` : ''}`;
  }
  function moverStory(id) {
    const m = state.movers?.find((x) => (x.storyId || x.eventId) === id);
    return m ? marketStory(m, id) : null;
  }
  function marketStory(m, id) {
    return {
      id, eventTitle: m.eventTitle || m.title, category: m.category, sources: [m.source], lead: m, markets: [m], kind: 'mover',
      headline: moverHeadline(m), dek: '', thin: !!m.thin, history: null, news: Array.isArray(m.news) ? m.news : m.news ? [m.news] : [], swing: null, exchanges: null,
      visual: { type: 'dial', region: null, theme: m.category },
    };
  }

  // ---- variety segments (2026-11-05). state.segments / state.packages are read defensively: any missing piece skips the kind.
  // An item is a story id ({storyId, ...extras}) or a story-like object; the live board copy wins (fresh numbers). Every story that
  // airs carries a news item or is a labeled MARKETS MOVING FIRST story (existing rule), else the item is dropped here.
  function varietyItems(kind) {
    const sg = state?.segments;
    if (!sg || typeof sg !== 'object') return [];
    if (Array.isArray(sg)) return sg.filter((x) => x && (x.kind === kind || x.segment === kind || x.type === kind));
    for (const k of VALIAS[kind]) { const v = sg[k]; if (Array.isArray(v)) return v; if (v && Array.isArray(v.items || v.stories)) return v.items || v.stories; }
    return [];
  }
  function itemStory(it) {
    if (!it || typeof it !== 'object') return null;
    const base = it.story && typeof it.story === 'object' ? it.story : it;
    const id = (typeof it.storyId === 'string' && it.storyId) || it.eventId || base.id;
    let st = (id && storyFor(id)) || (base.lead ? base : null) || (Number.isFinite(base.yesPrice) ? marketStory(base, id || base.id) : null);
    if (!st?.lead || !Number.isFinite(st.lead.yesPrice)) return null;
    if (Array.isArray(it.exchanges) && it.exchanges.length > 1) st = { ...st, exchanges: it.exchanges };
    if (!newsOf(st) && it.news) st = { ...st, news: Array.isArray(it.news) ? it.news : [it.news] };
    return newsOf(st) || isMovingFirst(st) ? st : null;
  }
  function varietyList(kind) {
    const seen = new Set(), out = [];
    for (const it of varietyItems(kind)) {
      const st = itemStory(it);
      if (!st || seen.has(st.id) || !VQUAL[kind](st, it)) continue;
      seen.add(st.id); out.push({ id: st.id, story: st, item: it, settling: !!st.settling });
    }
    return live(out);
  }
  const pkgId = (p) => `pkg:${String(p.id || p.packageId || p.headline).replace(/^pkg:/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
  function pkgStory(p, id) {
    const rows = p.markets.filter((m) => m && Number.isFinite(m.yesPrice)).slice(0, 4)
      .map((m) => ({ ...m, id: m.id || m.storyId || `${id}:${m.label}`, updatedAt: m.updatedAt || p.updatedAt || state.generatedAt }));
    const lead = [...rows].sort((a, b) => Math.abs(b.change1d ?? 0) - Math.abs(a.change1d ?? 0))[0];
    const title = p.title || p.short || p.headline;
    return {
      id, eventTitle: title, short: title, headline: p.headline, category: p.category || storyFor(rows[0].storyId)?.category || 'world',
      sources: [...new Set(rows.map((m) => m.source).filter(Boolean))], lead, markets: rows, kind: 'news', dek: '', thin: !!p.thin, history: null, swing: null, exchanges: null,
      news: [{ title: p.headline, source: p.credit || 'The wires', url: p.url, publishedAt: p.newsAt || p.publishedAt }], visual: { type: 'dial', region: null, theme: p.category || 'world' },
    };
  }
  function packageList() {
    const a = state?.packages;
    const arr = Array.isArray(a) ? a : a && Array.isArray(a.items) ? a.items : [];
    return arr.filter((p) => p && typeof p === 'object' && String(p.headline || '').trim() && Array.isArray(p.markets) && p.markets.filter((m) => m && Number.isFinite(m.yesPrice)).length >= 2)
      .map((p) => { const id = pkgId(p); return { id, pkg: p, story: pkgStory(p, id), settling: false }; });
  }
  const varietyEntries = (kind) => (kind === 'package' ? packageList() : varietyList(kind));
  const varietySeg = (kind, e) => ({ id: 'focus', kind, story: e.story, ...(kind === 'package' ? { pkg: e.pkg } : { item: e.item }) });

  // NEWS MEETS MARKETS: the aired story for a flash (by storyId, then by any matched market/event), else a minimal
  // story built from the flash's own market rows (same shape as moverStory) so the 3D and STORY FOCUS can show it.
  function flashStory(f) {
    if (!f?.markets?.length) return null;
    const ids = new Set(f.markets.flatMap((m) => [m.id, m.eventId]).filter(Boolean));
    const all = [...(state?.stories || []), ...desksOf(state).flatMap((d) => d.stories), ...(state?.closing || [])];
    const hit = (f.storyId && storyFor(f.storyId)) || all.find((s) => ids.has(s.id) || s.markets?.some((m) => ids.has(m.id)));
    if (hit) return hit;
    const lead0 = f.markets[0];
    const same = f.markets.filter((m) => m.eventId && m.eventId === lead0.eventId);
    const toMarket = (m) => ({ ...m, title: m.label, outcome: same.length > 1 ? m.label : null, eventTitle: m.label, category: f.category, change1w: null });
    const markets = (same.length > 1 ? same : [lead0]).map(toMarket);
    return {
      id: f.storyId || lead0.eventId || lead0.id, eventTitle: lead0.label, category: f.category || 'world', sources: [...new Set(markets.map((m) => m.source))],
      lead: markets[0], markets, kind: 'news', headline: f.line || lead0.line, dek: '', thin: !!lead0.thin, history: null,
      news: [{ title: f.headline, source: f.credit, url: f.url, publishedAt: f.newsAt }], flash: { id: f.id, headline: f.headline, credit: f.credit, newsAt: f.newsAt },
      visual: { type: markets.length > 1 ? 'outcomes' : 'dial', region: null, theme: f.category === 'economy' ? 'economy' : f.category === 'tech' ? 'tech' : 'world' },
    };
  }

  /** The scene's (story, segment) for a card: what sceneShow airs and what prepNext prewarms. */
  function sceneArgs(seg) {
    let story = seg.story, name = seg.id;
    if (seg.id === 'sotd' && seg.sotd) { story = { ...seg.sotd, eventTitle: seg.sotd.title, lead: seg.story?.lead, category: seg.story?.category }; name = 'sotd'; }
    // COUNTDOWN DESK: an orbital clock per scheduled decision (the card's first entry rarely has a board story,
    // and without this the previous story's hologram stayed up under a "NEXT BIG DECISIONS" label)
    if (seg.id === 'countdown' && seg.countdown?.length) {
      const ms = seg.countdown.slice(0, 3).map((c) => ({ id: c.id, yesPrice: c.yesPrice, closesAt: c.at, label: c.title, outcome: c.label }));
      story = { id: `countdown:${ms.map((m) => m.id).join(',')}`, eventTitle: 'Next big decisions', category: 'economy', lead: ms[0], markets: ms, closesAt: ms[0].closesAt, visual: { type: ms.length > 1 ? 'week' : 'countdown', region: null, theme: 'economy' } };
    }
    // variety cards reuse existing holograms: the package on the SOTD board, the rest on a dial (disagree: outcomes when there are several markets)
    if (seg.kind === 'package' && seg.pkg) { story = { ...seg.story, markets: seg.story.markets.map((m) => ({ label: m.label, yesPrice: m.yesPrice, change1d: m.change1d, source: m.source, storyId: m.storyId })) }; name = 'sotd'; }
    else if (seg.kind) story = { ...story, swing: null, visual: { ...(story.visual || {}), type: seg.kind === 'disagree' && (story.markets || []).length > 1 ? 'outcomes' : 'dial' } };
    return { story, name, segName: name === 'top' || name === 'sotd' ? name : 'focus' }; // cards: the card's story
  }
  function sceneShow(seg) {
    const { story, name, segName } = sceneArgs(seg);
    const sig = `${name}|${story?.id}`; // price ticks no longer rebuild the hologram (it re-scanned in mid-card)
    if (sig === sceneSig) return;
    sceneSig = sig;
    if (scene?.showStory && story) { try { scene.showStory(story, segName); } catch (e) { report('scene.showStory', e); } }
  }
  // perf round 3: a few seconds before the card changes, let the scene prewarm the next card's hologram labels
  // (drawn + uploaded in spare hold frames, so the reveal does not stall on canvas rasters). No effect on what airs.
  const PREP_LEAD_MS = 5000;
  let prepTimer = 0;
  function prepNext() {
    if (!state || paused || held || !scene?.prepareStory) return;
    const seg = plan[0] && refresh(plan[0]);
    if (!seg) return;
    const { story, segName } = sceneArgs(seg);
    if (story) { try { scene.prepareStory(story, segName); } catch (e) { report('scene.prepareStory', e); } }
  }

  // Candidate stories for BIGGEST MOVERS: the board story when the mover is its lead, else a one-market mover story (one per story id).
  function moverCards() {
    const seen = new Set();
    return live((state?.movers || []).map((m) => {
      const id = m.storyId || m.eventId;
      const st = storyFor(id);
      return st && st.lead?.id === m.id ? st : moverStory(id);
    }).filter((s) => s?.lead && !seen.has(s.id) && seen.add(s.id)));
  }
  const weekCards = () => live((state?.closing || []).filter((s) => s?.lead));
  const candidates = (id, deskId) => (id === 'desk' ? desksOf(state).find((x) => x.id === deskId)?.stories || [] : id === 'movers' ? moverCards() : id === 'week' ? weekCards() : id === 'focus' ? boardStories() : []);

  /** The story of the day's lead story: the board copy, else a mover story, else one built from its first market. */
  function sotdStory(sotd) {
    const st = (sotd.leadStoryId && (storyFor(sotd.leadStoryId) || moverStory(sotd.leadStoryId))) || null;
    if (st) return st;
    const m = sotd.markets[0] || {};
    return { id: sotd.leadStoryId || sotd.id, eventTitle: sotd.title, category: 'politics', sources: [m.source].filter(Boolean), lead: { ...m, id: m.storyId || sotd.id }, markets: [], headline: sotd.headline || sotd.title, visual: { type: 'dial' } };
  }

  // TOP STORIES: the lead (first board story that hasn't had its settling appearance) + minis drawn from the next few.
  function topSeg() {
    const pool = live(state.stories);
    const lead = pool[0] || state.stories[0];
    const n = window.innerWidth / window.innerHeight > 2.1 ? 3 : 4; // how many minis the layout shows
    const minis = draw('top-minis', pool.slice(1, MINI_POOL), n, null, { block: false }).map((s) => ({ ...s, boardRank: state.stories.indexOf(s) + 1 })); // real rank for the mini's number
    return { id: 'top', story: lead, minis, n };
  }

  /** A fresh card of kind `id` (draws from the bags). */
  function build(id) {
    if (id === 'desk') {
      const desks = desksOf(state);
      if (!desks.length) return null;
      const desk = draw('desks', desks, 1, pGroup, { block: false })[0] || desks[0];   // shuffled desks, not the last card's group
      const picked = draw(`desk:${desk.id}`, desk.stories, 1, pGroup); logDraw(`desk:${desk.id}`, desk.stories, picked);
      return picked[0] ? withRank({ id: 'desk', desk, story: picked[0] }) : null;
    }
    if (id === 'focus' || id === 'movers' || id === 'week') {
      const list = candidates(id);
      const picked = draw(id, list, 1, pGroup);
      if (id !== 'focus') logDraw(id, list, picked);
      return picked[0] ? withRank({ id, story: picked[0] }) : null;
    }
    if (VGAP[id]) {
      const list = varietyEntries(id);
      if (!list.length) return null;
      const picked = draw(`v:${id}`, list, 1, pGroup); logDraw(`v:${id}`, list, picked);
      return picked[0] ? varietySeg(id, picked[0]) : null;
    }
    if (id === 'top') return topSeg();
    if (id === 'markets') {
      const list = finCards(state).map(finStory);
      const picked = draw('markets', list, 1, null);
      logDraw('markets', list, picked);
      return picked[0] ? { id: 'markets', story: picked[0] } : null;
    }
    if (id === 'sotd') return has.sotd(state) ? { id: 'sotd', sotd: state.sotd, story: sotdStory(state.sotd) } : null;
    if (id === 'countdown') {
      const c = futureCountdown(state).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      if (!c.length) return null;
      const st = c[0].storyId ? storyFor(c[0].storyId) || moverStory(c[0].storyId) : null;
      return { id: 'countdown', story: st, countdown: c };
    }
    return null;
  }
  // index/count = the story's rank in its full list (like STORY FOCUS), not the card's position in this airing
  function withRank(seg) {
    const list = candidates(seg.id, seg.desk?.id);
    const r = list.findIndex((x) => x.id === seg.story.id);
    return { ...seg, index: r < 0 ? 0 : r, count: Math.max(1, list.length) };
  }

  /** Re-read a planned/on-air card from the current state (fresh numbers); null when it can't air any more. */
  function refresh(seg) {
    if (!seg || !state) return null;
    if (seg.id === 'top') {
      const pool = live(state.stories);
      if (!pool.length) return null;
      return { ...seg, story: pool[0], minis: seg.minis.map((m) => state.stories.find((x) => x.id === m.id)).filter(Boolean).map((s) => ({ ...s, boardRank: state.stories.indexOf(s) + 1 })) };
    }
    if (seg.id === 'sotd') return has.sotd(state) ? { ...seg, sotd: state.sotd, story: sotdStory(state.sotd) } : null;
    if (seg.id === 'countdown') return has.countdown(state) ? build('countdown') : null;
    if (seg.id === 'standby') return seg;
    if (seg.kind) { const e = varietyEntries(seg.kind).find((x) => x.id === seg.story?.id); return e ? varietySeg(seg.kind, e) : null; }
    if (seg.id === 'markets') { const fi = finCards(state).find((x) => x.id === seg.story?.id); return fi ? { ...seg, story: finStory(fi) } : null; }
    const desk = seg.desk ? desksOf(state).find((d) => d.id === seg.desk.id) : null;
    if (seg.id === 'desk' && !desk) return null;
    const list = candidates(seg.id, seg.desk?.id);
    const st = list.find((x) => x.id === seg.story?.id);
    if (!st) return null;
    return withRank({ ...seg, ...(desk ? { desk } : {}), story: st });
  }

  // TOP STORIES draws the lead + the next few from state.stories; hand it the lead, the chosen minis, then the rest.
  const topState = (seg) => {
    const ids = new Set([seg.story?.id, ...seg.minis.map((x) => x.id)]);
    return { ...state, stories: [seg.story, ...seg.minis, ...state.stories.filter((x) => !ids.has(x.id))] };
  };

  // ---- air logging (debug, 2026-11-04): every card/segment that airs and every sequence drawn goes to the server log
  // as client kind 'air' / 'draw', so we can see exactly what a real screen showed and in what order.
  const pageId = Math.random().toString(36).slice(2, 7);
  let airQ = [], airT = 0, lastAirKey = '';
  const rankIn = (id, list) => { const i = (list || []).findIndex((x) => (x.storyId || x.eventId || x.id) === id); return i < 0 ? null : i + 1; };
  const NOLOG = new URLSearchParams(location.search).has('fixture'); // the static fixture server has no /api/client-log
  function postAir(e) {
    if (NOLOG) return;
    airQ.push({ level: 'info', kind: e.kind, page: pageId, ...e });
    if (!airT) airT = setTimeout(() => {   // fixed 1.5s batch window (a resetting debounce never fired in fast mode)
      airT = 0;
      const b = airQ.splice(0, 20);
      if (b.length) fetch('/api/client-log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), keepalive: true }).catch(() => {});
    }, 1500);
  }
  function logDraw(name, list, picked) {
    postAir({ kind: 'draw', bag: name, pool: list.length, picked: picked.map((x) => ({ id: x.id, rank: rankIn(x.id, list) })) });
  }
  function logAir(seg) {
    const id = seg?.story?.id || seg?.sotd?.id || (seg?.id === 'countdown' ? 'countdown' : null); const key = `${seg?.kind || seg?.id}|${seg?.desk?.id || ''}|${id}|${seg?.index}`;
    if (!id || key === lastAirKey) return; lastAirKey = key;
    const list = seg.id === 'movers' ? state.movers : seg.id === 'week' ? state.closing : seg.id === 'desk' ? seg.desk?.stories : seg.id === 'focus' || seg.id === 'top' ? state.stories : null;
    postAir({ kind: 'air', seg: SEGNAME(seg), desk: seg.desk?.id, id, rank: rankIn(id, list), swing: seg.story?.swing ? seg.story.swing.shape : undefined, short: (seg.sotd?.title || seg.story?.short || seg.story?.headline || '').slice(0, 70) });
  }

  // ---- tease + ALSO MOVING
  const teaseOf = (seg) => {
    if (!seg) return '';
    if (seg.id === 'top') return 'Top stories';
    if (seg.id === 'sotd') return `Story of the Day: ${seg.sotd?.title || ''}`.trim();
    if (seg.id === 'countdown') return 'Countdown desk';
    if (seg.id === 'markets') return `Markets: ${seg.story?.short || ''}`.trim();
    if (seg.kind && VTEASE[seg.kind]) return `${VTEASE[seg.kind]}: ${seg.story?.short || seg.story?.eventTitle || ''}`.trim();
    return seg.story?.short || seg.story?.eventTitle || seg.story?.headline || '';
  };
  const onScreen = (seg) => new Set([seg?.story?.id, ...(seg?.minis || []).map((x) => x.id), ...(seg?.sotd?.markets || []).map((x) => x.storyId), ...(seg?.pkg?.markets || []).map((x) => x.storyId)].filter(Boolean));
  function alsoFor(seg) {
    const ids = onScreen(seg);
    const pool = (state?.movers || []).filter((m) => m && Number.isFinite(m.yesPrice) && Math.abs(m.change1d ?? 0) >= 0.02 && !ids.has(m.storyId || m.eventId) && !m.thin
      && !(settled.has(m.storyId || m.eventId)) && storyFor(m.storyId || m.eventId))
      .sort((a, b) => Math.abs(b.change1d) - Math.abs(a.change1d)).slice(0, 8).map((m) => ({ ...m, id: m.storyId || m.eventId || m.id }));
    const m = draw('also', pool, 1, null, { block: false })[0];
    if (m) {
      // the story's own (house-style) short line when it is a board story; raw market titles ("Will …?") never air
      const st = storyFor(m.id);
      // only board/desk stories: a raw bracket mover read as "44 climbs to 90% in Republican Senate seats…"
      const line0 = st ? st.short || st.headline : '';
      let line = line0;
      if (!line) return teaseAlt();
      // odds are not facts: a number-free short line ("Dems hold exactly 56 Senate seats") must carry its price
      const ref = st?.lead && Number.isFinite(st.lead.yesPrice) ? st.lead : m;
      if (!/\d%/.test(line)) line += ` · ${pct(ref.yesPrice)} chance`;
      if (!/\bpoints?\b/i.test(line)) line += `, ${pointsText(ref.change1d ?? m.change1d, 'today')}`;
      return {
        tag: 'ALSO MOVING', storyId: m.id,
        line,
        sub: `${exchangeName(m.source)} · updated ${ago(m.updatedAt)} · ${money(m.volume24h)} traded in 24 hrs`,
      };
    }
    return teaseAlt();
  }
  function teaseAlt() {
    const a = teaseOf(plan[0]), b = teaseOf(plan[1]);
    return a ? { tag: 'COMING UP', line: a, sub: b ? `Then: ${b}` : '', storyId: plan[0]?.story?.id } : null;
  }

  function paint(seg, { durationMs, alt } = {}) {
    if (alt === undefined) alt = seg.id === current?.id && seg.story?.id === current?.story?.id ? curAlt : null; // in-place refresh keeps its line
    current = seg; curAlt = alt;
    logAir(seg);
    try { overlay.render(seg, seg.id === 'top' ? topState(seg) : state); } catch (e) { report('overlay.render', e); }
    try { chyron.setLower(SEGNAME(seg), seg.story, { durationMs, tag: seg.desk ? DESK_TAG[seg.desk.id] || 'DESK' : undefined, alt }); } catch (e) { report('chyron.setLower', e); }
    try { overlay.setNext?.(teaseOf(plan[0]), teaseOf(plan[1])); } catch (e) { report('overlay.setNext', e); }
    if (seg.kind && VARIETY_TITLES[seg.kind]) { const t = document.querySelector('.seg-t'); if (t && t.textContent !== VARIETY_TITLES[seg.kind]) t.textContent = VARIETY_TITLES[seg.kind]; } // top-bar title (overlay.js only knows 'focus')
    sceneShow(seg);
  }

  /** Plan one more card: a scheduled reset when due, else a weighted random kind that has data and differs from the last. */
  function planOne() {
    const ok = (id) => !!has[id]?.(state);
    // kinds to try, in order: scheduled resets that are due, then the weighted kinds in a weighted-random order.
    // Never the same kind twice in a row (unless it's the only kind with data).
    const order = [];
    for (const k of SCHED_ORDER) {
      if (since[k] < after[k] || !ok(k) || pLast === k) continue;
      // TOP STORIES waits (up to 6 cards) while its lead aired in the last 5 minutes
      if (k === 'top' && recent(live(state.stories)[0]?.id) && since.top < after.top + 6) continue;
      order.push(k);
    }
    let pool = RUNDOWN.filter((d) => d.w > 0 && d.id !== pLast && (!VGAP[d.id] || sinceV[d.id] >= VGAP[d.id]) && ok(d.id));
    if (!pool.length && !order.length) pool = RUNDOWN.filter((d) => ok(d.id));
    while (pool.length) {
      const tot = pool.reduce((a, x) => a + (x.w || 1), 0); let r = Math.random() * tot, j = pool.length - 1;
      for (let i = 0; i < pool.length; i++) { if ((r -= pool[i].w || 1) < 0) { j = i; break; } }
      order.push(pool.splice(j, 1)[0].id);
    }
    // first card whose story hasn't aired in the last 5 minutes; else the first card we could build at all
    let seg = null, fallback = null;
    for (const id of order) {
      const s = build(id);
      if (!s) continue;
      if (!s.story || s.id === 'top' || s.id === 'countdown' || !recent(s.story.id)) { seg = s; break; }
      fallback ||= s;
    }
    seg ||= fallback;
    if (!seg) return null;
    for (const k of SCHED_ORDER) { if (seg.id === k) { since[k] = 0; after[k] = rand(SCHED[k]); } else since[k]++; }
    for (const k of Object.keys(VGAP)) sinceV[k] = seg.kind === k ? 0 : sinceV[k] + 1;
    pLast = SEGNAME(seg); pGroup = groupOf(seg.story);
    return seg;
  }
  const fillPlan = () => { while (plan.length < 2) { const s = planOne(); if (!s) break; plan.push(s); } };

  function air(seg, ms) {
    paint(seg, { durationMs: ms$(ms), alt: seg.id === 'standby' ? null : alsoFor(seg) });
    if (seg.id === 'top') { note(seg.story?.id, 'top'); seg.minis.forEach((x) => note(x.id, 'top-mini')); }
    else if (seg.id === 'sotd') note(seg.story?.id, 'sotd');
    else if (seg.id !== 'countdown' && seg.id !== 'standby') note(seg.story?.id, SEGNAME(seg));
    clearTimeout(timer); clearTimeout(prepTimer);
    if (paused || held) return;
    timer = setTimeout(advance, ms$(ms));
    prepTimer = setTimeout(prepNext, Math.max(ms$(ms) / 2, ms$(ms) - ms$(PREP_LEAD_MS)));
  }

  function advance() {
    clearTimeout(timer);
    if (!state) return;
    if (current?.story?.settling && current.id !== 'top') settled.add(current.story.id); // its one appearance is over
    if (!KEYS.some((k) => has[k](state))) { plan = []; paint({ id: 'standby' }); timer = setTimeout(advance, 5000); return; }
    let seg = null;
    while (plan.length && !seg) seg = refresh(plan.shift());
    if (!seg) seg = planOne();
    onAir = seg;
    fillPlan();
    if (!seg) { paint({ id: 'standby' }); timer = setTimeout(advance, 2000); return; } // never leave an empty card up
    air(seg, DEF[SEGNAME(seg)]?.ms || 9000);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { paused = !paused; if (!paused) advance(); else clearTimeout(timer); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') advance();
    else if (KEYS[Number(e.key) - 1]) jump(KEYS[Number(e.key) - 1]);
    else if (VKEYS[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) jump(VKEYS[e.key]);
  });

  function jump(id) {
    if (!state || !has[id]?.(state)) return;
    const seg = build(id);
    if (seg) { if (current?.story?.settling && current.id !== 'top') settled.add(current.story.id); onAir = seg; pLast = id; if (VGAP[id]) sinceV[id] = 0; air(seg, DEF[id].ms); }
  }

  return {
    update(s) {
      const first = !state;
      state = s;
      if (first || !current) { advance(); return; } // random first card on every reload
      if (current.id === 'standby') return;
      // refresh the current card in place with the newest numbers (same story by id)
      if (current.id === 'focus' && current.cut) {
        const fresh = storyFor(current.story.id) || moverStory(current.story.id) || (current.story.flash ? current.story : null);
        if (fresh) paint({ ...current, story: fresh }); else advance();
        return;
      }
      const seg = refresh(current);
      if (!seg) { advance(); return; }
      paint(seg);
    },
    /** Freeze rotation during a breaking takeover. */
    hold(on) { const was = held; held = on; if (on) clearTimeout(timer); else if (was) advance(); },
    /** After an alert: cut to STORY FOCUS on that story if we have it, then continue the rundown. */
    focusStory(storyId, { manual = false } = {}) {
      held = false;
      // storyId may be a story object (a flash's ad-hoc story); prefer the live board copy when there is one
      const s = state && (typeof storyId === 'object' && storyId
        ? storyFor(storyId.id) || storyId
        : storyFor(storyId) || (manual ? moverStory(storyId) : null));
      if (!s) { if (!manual) advance(); return false; }
      clearTimeout(timer);
      const pool = state.stories, i = pool.findIndex((x) => x.id === s.id);
      const seg = s.fin ? { id: 'markets', cut: true, story: s } : { id: 'focus', cut: true, story: s, index: i >= 0 ? i : pool.length, count: i >= 0 ? pool.length : pool.length + 1 };
      const ms = manual ? 20000 : 12000; // a clicked story holds a little longer
      if (current?.story?.settling && current.id !== 'top' && current.story.id !== s.id) settled.add(current.story.id);
      onAir = seg; plan = plan.filter((p) => p.story?.id !== s.id); fillPlan();
      paint(seg, { durationMs: ms$(ms), alt: alsoFor(seg) });
      note(s.id, manual ? 'click' : 'cut');
      if (!paused) timer = setTimeout(() => advance(), ms$(ms));
      return true;
    },
    /** Stamp a story as aired by something other than the rundown (an alert or a news flash). */
    note,
    get airLog() { return airLog; },
    get aired() { return aired; },
    flashStory,
    get current() { return current; },
    get plan() { return plan.map((p) => ({ id: p.id, story: p.story?.id || p.sotd?.id || null })); }, // debug: the next two cards
    get seq() { return current?.story ? [current.story.id] : []; },
    get settled() { return [...settled]; },
    jump,
  };
}
