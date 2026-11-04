// Corner-pop moments (watchability plan #3, #8, #9): ON THE MOVE, JUST LISTED, MONEY MOVING, plus the
// Next Big Decision countdown. Driven by ingest.mjs after each rebuild; MONEY MOVING polls Polymarket's data-api.
//   const mo = createMoments(store, config, {sim})
//   mo.onRebuild({stories, desks, closing, airable, aliases})   detect move/listed, refresh state.countdown
//   mo.pollMoney()                                               live only: big trades on the top board/desk stories
//   mo.startSim()                                                SIM: a fake move/listed/money every 60–90s
//   mo.stats()                                                   health counters
// Events go out through store.addMoment(kind, ev) (SSE 'move' | 'listed' | 'money', state.moves/listed/money).
// Server pacing (docs/ARCHITECTURE.md "Watchability contract"): move <= 1 per 3 min with a 30-min per-story
// cooldown; listed and money <= 1 per 10 min each. SIM ignores the 10-min pacing so the UI can be tested.
import { log } from './log.mjs';
import { fetchBigTrades } from './sources/trades.mjs';
import { buildCountdown, labelOf } from './sources/calendar.mjs';

const errMsg = (e) => String(e?.message || e).slice(0, 300);
const MIN = 60_000;

export function createMoments(store, config, { sim = false } = {}) {
  const C = {
    movePoints: 0.05, moveMinVolume: 10_000, moveGlobalMin: 3, moveStoryCooldownMin: 30,
    stillPoints: 0.15, stillWindowMin: 180,
    listedWarmupMin: 30, listedMaxAgeHours: 48, listedMinVolume: 10_000, listedEveryMin: 10,
    moneyMinCash: 10_000, moneyEveryMin: 10, moneyTopStories: 15, moneyFreshMin: 20, moneyLo: 0.05, moneyHi: 0.95,
    countdownDays: 14, countdownMax: 3,
    simMinSec: 60, simMaxSec: 90,
    ...(config.moments || {}),
  };
  const startedAt = Date.now();
  const stats = {
    moves: 0, stills: 0, listed: 0, money: 0,
    moneyPolls: 0, moneyErrors: 0, moneyLastError: null, moneyLastPoll: null, tradesSeen: 0, moneyPending: 0,
    listedPending: 0, listedSeenEvents: 0, listedWarm: false, countdown: 0,
  };
  let lastMoveAt = 0, lastListedAt = 0, lastMoneyAt = 0;
  const storyMoveAt = new Map();       // storyId -> ms of its last 'move'
  const seenEvents = new Set();        // JUST LISTED: every event id seen (warm-up fills it)
  const listedPending = [];            // new-event markets waiting for a 10-min slot
  const seenTrades = new Set();
  const tradesByStory = new Map();     // storyId -> [{amount, at(ms)}] within 24h
  let moneyPending = [];               // fresh, airable big trades waiting for a slot
  let index = { byMarket: new Map(), byEvent: new Map(), stories: new Map(), aliases: {} };
  let lastCountdownAt = 0, lastCountdownKey = '';
  let latestAirable = [];

  // ---- story lookup (board, desks, closing; merged-event aliases)
  function reindex({ stories = [], desks = [], closing = [], aliases = {} }) {
    const byMarket = new Map(), byEvent = new Map(), all = new Map();
    const add = (s) => {
      if (!s?.id || all.has(s.id)) return;
      all.set(s.id, s);
      byEvent.set(s.id, s.id);
      for (const m of [s.lead, ...(s.markets || [])]) {
        if (!m?.id) continue;
        if (!byMarket.has(m.id)) byMarket.set(m.id, s.id);
        if (m.eventId && !byEvent.has(m.eventId)) byEvent.set(m.eventId, s.id);
      }
    };
    stories.forEach(add);
    desks.forEach((d) => (d.stories || []).forEach(add));
    closing.forEach(add);
    index = { byMarket, byEvent, stories: all, aliases: aliases || {} };
  }
  const storyIdFor = (id) => (id ? index.aliases[id] || index.byMarket.get(id) || index.byEvent.get(id) || null : null);
  // Board + desk stories only (the airing pool for move/money).
  function airingStories() {
    const s = store.getState();
    const out = [], seen = new Set();
    for (const st of [...(s.stories || []), ...(s.desks || []).flatMap((d) => d.stories || [])]) {
      if (st?.id && !seen.has(st.id)) { seen.add(st.id); out.push(st); }
    }
    return out;
  }
  const marketsOf = (st) => { const seen = new Set(); return [st.lead, ...(st.markets || [])].filter((m) => m?.id && !seen.has(m.id) && seen.add(m.id)); };
  const shortOf = (st) => st.short || st.headline || st.eventTitle || '';

  // ---- ON THE MOVE
  function priceAgo(marketId, nowSec, sec) {
    const arr = store.history(marketId);
    if (!arr?.length) return null;
    if (arr[0].t > nowSec - sec) return null;   // not observed that far back
    let p = arr[0].p;
    for (const x of arr) { if (x.t <= nowSec - sec) p = x.p; else break; }
    return p;
  }
  function detectMove(stories, nowMs) {
    if (nowMs - lastMoveAt < C.moveGlobalMin * MIN) return;
    const nowSec = nowMs / 1000;
    let best = null;
    for (const st of stories) {
      if ((storyMoveAt.get(st.id) || 0) > nowMs - C.moveStoryCooldownMin * MIN) continue;
      for (const m of marketsOf(st)) {
        if ((m.volume24h || 0) < C.moveMinVolume || !(m.yesPrice > 0.01 && m.yesPrice < 0.99)) continue;
        const mo = store.motion?.(m.id, nowSec) || {};
        const c = mo.change1h;
        if (typeof c !== 'number' || Math.abs(c) < C.movePoints) continue;
        const score = Math.abs(c) * Math.log10(10 + (m.volume24h || 0));
        if (!best || score > best.score) best = { st, m, c, score };
      }
    }
    if (!best) return;
    const { st, m, c } = best;
    const prev = storyMoveAt.get(st.id) || 0;
    const p3h = priceAgo(m.id, nowSec, C.stillWindowMin * 60);
    const still = prev > nowMs - C.stillWindowMin * MIN && p3h != null && Math.abs(m.yesPrice - p3h) >= C.stillPoints;
    const ev = {
      id: `move:${st.id}:${Math.floor(nowMs / MIN)}`, at: new Date(nowMs).toISOString(), storyId: st.id, marketId: m.id,
      short: shortOf(st), label: labelOf(m), yesPrice: m.yesPrice, change1h: Math.round(c * 1000) / 1000,
      kind: still ? 'still' : 'move', change3h: still ? Math.round((m.yesPrice - p3h) * 1000) / 1000 : null,
      source: m.source, volume24h: Math.round(m.volume24h || 0), category: st.category || m.category || null,
    };
    if (store.addMoment('move', ev)) {
      lastMoveAt = nowMs;
      storyMoveAt.set(st.id, nowMs);
      if (still) stats.stills++; else stats.moves++;
    }
    if (storyMoveAt.size > 500) for (const [k, t] of storyMoveAt) if (t < nowMs - 6 * 60 * MIN) storyMoveAt.delete(k);
  }

  // ---- JUST LISTED: an event first seen after the warm-up, created on the exchange within 48h, with real volume.
  function detectListed(airable, nowMs) {
    const warm = nowMs - startedAt >= C.listedWarmupMin * MIN;
    stats.listedWarm = warm;
    for (const m of airable) {
      if (!m?.eventId || seenEvents.has(m.eventId)) continue;
      seenEvents.add(m.eventId);
      if (!warm) continue;
      const created = Date.parse(m.createdAt || '');
      if (!Number.isFinite(created) || created < nowMs - C.listedMaxAgeHours * 60 * MIN) continue;
      listedPending.push(m);
    }
    stats.listedSeenEvents = seenEvents.size;
    // The market objects are replaced every poll: re-read volume/price from the latest airable set by id.
    const live = new Map(airable.map((m) => [m.id, m]));
    for (let i = listedPending.length - 1; i >= 0; i--) {
      const m = live.get(listedPending[i].id) || listedPending[i];
      const created = Date.parse(m.createdAt || '');
      if (!(created >= nowMs - C.listedMaxAgeHours * 60 * MIN)) listedPending.splice(i, 1);
      else listedPending[i] = m;
    }
    if (listedPending.length > 50) listedPending.splice(0, listedPending.length - 50);
    stats.listedPending = listedPending.length;
    if (nowMs - lastListedAt < C.listedEveryMin * MIN) return;
    const ok = listedPending.filter((m) => (m.volume24h || 0) >= C.listedMinVolume && m.yesPrice > 0.03 && m.yesPrice < 0.97);
    if (!ok.length) return;
    const m = ok.reduce((b, x) => ((x.volume24h || 0) > (b.volume24h || 0) ? x : b), ok[0]);
    // one pop per event: drop every pending market of that event
    for (let i = listedPending.length - 1; i >= 0; i--) if (listedPending[i].eventId === m.eventId) listedPending.splice(i, 1);
    const ev = {
      id: `listed:${m.eventId}`, at: new Date(nowMs).toISOString(), storyId: storyIdFor(m.id) || storyIdFor(m.eventId),
      marketId: m.id, title: m.eventTitle || labelOf(m), label: labelOf(m), yesPrice: m.yesPrice, source: m.source,
      volume24h: Math.round(m.volume24h || 0), createdAt: m.createdAt, category: m.category || null,
    };
    if (store.addMoment('listed', ev)) { lastListedAt = nowMs; stats.listed++; }
  }

  // ---- Next Big Decision
  function refreshCountdown(airable, nowMs, force = false) {
    if (!force && nowMs - lastCountdownAt < MIN) return;
    lastCountdownAt = nowMs;
    let list = [];
    try {
      list = buildCountdown(airable, { now: nowMs, storyIdFor, days: C.countdownDays, max: C.countdownMax });
    } catch (e) {
      log('warn', 'countdown failed', { error: errMsg(e) });
      return;
    }
    stats.countdown = list.length;
    const key = list.map((c) => `${c.id}|${c.at}|${Math.round(c.yesPrice * 100)}|${c.storyId}`).join(';');
    if (key === lastCountdownKey) return;
    lastCountdownKey = key;
    store.setState({ countdown: list });
  }

  function onRebuild({ stories = [], desks = [], closing = [], airable = [], aliases = {} } = {}) {
    const nowMs = Date.now();
    latestAirable = airable;
    reindex({ stories, desks, closing, aliases });
    const pool = airingStories();
    if (!sim) {
      try { detectMove(pool, nowMs); } catch (e) { log('warn', 'move detect failed', { error: errMsg(e) }); }
      try { detectListed(airable, nowMs); } catch (e) { log('warn', 'listed detect failed', { error: errMsg(e) }); }
      try { emitMoney(nowMs); } catch (e) { log('warn', 'money emit failed', { error: errMsg(e) }); }
    }
    refreshCountdown(airable, nowMs);
  }

  // ---- MONEY MOVING
  function dayTrades(storyId, nowMs) {
    const list = (tradesByStory.get(storyId) || []).filter((t) => t.at >= nowMs - 24 * 60 * MIN);
    tradesByStory.set(storyId, list);
    return list;
  }
  async function pollMoney() {
    const nowMs = Date.now();
    const stories = airingStories()
      .filter((st) => marketsOf(st).some((m) => m.source === 'polymarket' && m.conditionId))
      .slice(0, C.moneyTopStories);
    const byCond = new Map();
    for (const st of stories) {
      for (const m of marketsOf(st).slice(0, 3)) if (m.source === 'polymarket' && m.conditionId && !byCond.has(m.conditionId)) byCond.set(m.conditionId, { st, m });
    }
    if (!byCond.size) return;
    stats.moneyPolls++;
    stats.moneyLastPoll = new Date(nowMs).toISOString();
    let trades;
    try {
      trades = await fetchBigTrades([...byCond.keys()], { minCash: C.moneyMinCash });
      stats.moneyLastError = null;
    } catch (e) {
      stats.moneyErrors++;
      stats.moneyLastError = errMsg(e);
      throw e;
    }
    const first = stats.moneyPolls === 1;
    for (const t of trades) {
      if (seenTrades.has(t.key)) continue;
      seenTrades.add(t.key);
      stats.tradesSeen++;
      const hit = byCond.get(t.conditionId);
      if (!hit || t.amount < C.moneyMinCash) continue;
      const atMs = t.at * 1000;
      dayTrades(hit.st.id, nowMs).push({ amount: t.amount, at: atMs });
      if (atMs < nowMs - C.moneyFreshMin * MIN || !(t.yesPrice >= C.moneyLo && t.yesPrice <= C.moneyHi)) continue;
      moneyPending.push({ t, storyId: hit.st.id, m: hit.m, short: shortOf(hit.st) });
    }
    if (seenTrades.size > 5000) { const keep = [...seenTrades].slice(-2500); seenTrades.clear(); keep.forEach((k) => seenTrades.add(k)); }
    if (first) log('info', 'money first poll', { markets: byCond.size, trades: trades.length, pending: moneyPending.length });
    emitMoney(nowMs);
  }
  // What the money was traded on: the story's number-free headline when it is the lead market; an outcome name that
  // means nothing alone ("None", "Other", "Yes") carries its event title.
  function tradeLabel({ m, short, storyId }) {
    const st = index.stories.get(storyId);
    if (st?.lead?.id === m.id && short) return short;
    const l = labelOf(m);
    if (m.outcome && (l.length <= 5 || /^(none|other|yes|no|any|neither|tie)$/i.test(l))) return `${m.eventTitle || m.title}: ${l}`;
    return l;
  }
  function emitMoney(nowMs) {
    moneyPending = moneyPending.filter((x) => x.t.at * 1000 >= nowMs - C.moneyFreshMin * MIN);
    stats.moneyPending = moneyPending.length;
    if (!moneyPending.length || nowMs - lastMoneyAt < C.moneyEveryMin * MIN) return;
    const pick = moneyPending.reduce((b, x) => (x.t.amount > b.t.amount ? x : b), moneyPending[0]);
    moneyPending = moneyPending.filter((x) => x.storyId !== pick.storyId);
    const day = dayTrades(pick.storyId, nowMs);
    const largestToday = day.reduce((a, x) => Math.max(a, x.amount), pick.t.amount);
    const ev = {
      id: `money:${pick.t.key}`, at: new Date(pick.t.at * 1000).toISOString(), storyId: pick.storyId, marketId: pick.m.id,
      label: tradeLabel(pick), eventTitle: pick.m.eventTitle || null, short: pick.short, outcome: pick.m.outcome || null,
      amount: pick.t.amount, price: Math.round(pick.t.yesPrice * 1000) / 1000, source: 'polymarket',
      largestToday, countToday: day.length, isLargestToday: pick.t.amount >= largestToday,
    };
    if (store.addMoment('money', ev)) { lastMoneyAt = nowMs; stats.money++; }
  }

  // ---- SIM: one fake moment every 60–90s, rotating move -> listed -> money
  function startSim() {
    let n = 0;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const fire = () => {
      try {
        const nowMs = Date.now();
        const pool = airingStories().filter((st) => st.lead && st.lead.yesPrice > 0.06 && st.lead.yesPrice < 0.94);
        if (!pool.length) return;
        const kind = ['move', 'listed', 'money'][n++ % 3];
        const st = pick(pool);
        const m = st.lead;
        const at = new Date(nowMs).toISOString();
        if (kind === 'move') {
          const c = (0.05 + Math.random() * 0.08) * (Math.random() < 0.5 ? -1 : 1);
          const still = Math.random() < 0.3;
          store.addMoment('move', {
            id: `move:sim${n}:${st.id}`, at, storyId: st.id, marketId: m.id, short: shortOf(st), label: labelOf(m),
            yesPrice: m.yesPrice, change1h: Math.round(c * 1000) / 1000, kind: still ? 'still' : 'move',
            change3h: still ? Math.round(c * 2.5 * 1000) / 1000 : null, source: m.source, volume24h: Math.round(m.volume24h || 0), category: st.category || null, sim: true,
          });
          if (still) stats.stills++; else stats.moves++;
        } else if (kind === 'listed') {
          const x = pick(latestAirable.filter((a) => a.volume24h >= 10_000 && a.yesPrice > 0.05 && a.yesPrice < 0.95)) || m;
          store.addMoment('listed', {
            id: `listed:sim${n}:${x.id}`, at, storyId: storyIdFor(x.id) || storyIdFor(x.eventId), marketId: x.id,
            title: x.eventTitle || labelOf(x), label: labelOf(x), yesPrice: x.yesPrice, source: x.source,
            volume24h: Math.round(x.volume24h || 0), createdAt: new Date(nowMs - 3 * 60 * MIN).toISOString(), category: x.category || null, sim: true,
          });
          stats.listed++;
        } else {
          const amount = Math.round((10_000 + Math.random() * 70_000) / 100) * 100;
          const largestToday = Math.random() < 0.5 ? amount : amount + Math.round(Math.random() * 50_000 / 100) * 100;
          store.addMoment('money', {
            id: `money:sim${n}:${st.id}`, at, storyId: st.id, marketId: m.id, label: labelOf(m), eventTitle: m.eventTitle || null,
            short: shortOf(st), amount, price: Math.round(m.yesPrice * 1000) / 1000, source: m.source === 'kalshi' ? 'kalshi' : 'polymarket',
            largestToday, countToday: 1 + Math.floor(Math.random() * 5), isLargestToday: largestToday === amount, sim: true,
          });
          stats.money++;
        }
      } catch (e) {
        log('warn', 'sim moment failed', { error: errMsg(e) });
      }
      const t = setTimeout(fire, (C.simMinSec + Math.random() * (C.simMaxSec - C.simMinSec)) * 1000);
      t.unref?.();
      simTimer = t;
    };
    let simTimer = setTimeout(fire, 30_000);
    simTimer.unref?.();
    stopSim = () => clearTimeout(simTimer);
  }
  let stopSim = () => {};

  return {
    onRebuild,
    pollMoney,
    startSim,
    storyIdFor,
    stats: () => ({ ...stats }),
    stop: () => stopSim(),
  };
}
