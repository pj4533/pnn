// State, PNN's own price samples, and SSE fan-out.
// SSE events: 'state' (full snapshot, debounced ~1s), 'alert' (one per NEW alert only) and 'flash' (one per NEW
// NEWS MEETS MARKETS flash only), plus 'move' / 'listed' / 'money' (one per NEW corner pop, addMoment). None of these are ever replayed as events on connect.
import config from './config.mjs';
import { log } from './log.mjs';
import { clientStateJson } from './clientstate.mjs';

const DEBOUNCE_MS = 1000;
const HEARTBEAT_MS = 20_000;

const emptyFeed = () => ({ ok: false, lastOk: null, lastError: null, count: 0 });

export function createStore() {
  const feeds = { polymarket: emptyFeed(), kalshi: emptyFeed(), news: emptyFeed() };
  const state = {
    generatedAt: new Date().toISOString(),
    sim: false,
    feeds,
    stories: [],
    movers: [],
    closing: [],
    desks: [],
    alerts: [],
    flashes: [],
    wire: [],
    moves: [],       // ON THE MOVE corner pops (last ~10; never replayed as events on connect)
    listed: [],      // JUST LISTED corner pops
    money: [],       // MONEY MOVING flashes
    sotd: null,      // Story of the Day (newsroom.mjs)
    countdown: [],   // Next Big Decision (sources/calendar.mjs)
  };
  const MOMENT_KEYS = { move: 'moves', listed: 'listed', money: 'money' };
  const seenMomentIds = new Set();
  const momentStats = { move: 0, listed: 0, money: 0, lastMoveAt: null, lastListedAt: null, lastMoneyAt: null };
  const samples = new Map();   // marketId -> [{t, p}] (t = epoch seconds), oldest first
  const seenAlertIds = new Set();
  const seenFlashIds = new Set();
  const clients = new Set();
  let timer = null;

  const keepSec = (config.samples?.keepHours ?? 24) * 3600;
  const maxPer = config.samples?.maxPerMarket ?? 1000;
  const refresh = config.samples?.refreshSec ?? 300;
  const minVol = config.samples?.minVolume24h ?? 0;
  const maxAlerts = config.limits?.alerts ?? 10;
  const maxFlashes = config.limits?.flashes ?? 10;

  function broadcast(event, data) {
    if (!clients.size) return;
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try { res.write(msg); } catch { clients.delete(res); }
    }
  }

  // The browsers get the slim state (clientstate.mjs), built once per change and shared by every client and every connect.
  let clientJson = null;
  const getClientJson = () => clientJson ?? (clientJson = clientStateJson(state));

  function scheduleState() {
    clientJson = null;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!clients.size) return;
      const msg = `event: state\ndata: ${getClientJson()}\n\n`;
      for (const res of clients) {
        try { res.write(msg); } catch { clients.delete(res); }
      }
    }, DEBOUNCE_MS);
    timer.unref?.();
  }

  function getState() {
    return state;
  }

  function setState(partial = {}) {
    for (const [k, v] of Object.entries(partial)) {
      if (k === 'feeds') continue;          // feeds is a live object; mutate store.feeds instead
      state[k] = v;
    }
    state.generatedAt = new Date().toISOString();
    scheduleState();
  }

  /** Record one {t,p} sample per market. opts.t (epoch sec) lets SIM backfill. */
  function recordPrices(markets, opts = {}) {
    const t = Math.round(opts.t ?? Date.now() / 1000);
    for (const m of markets || []) {
      if (!m?.id || typeof m.yesPrice !== 'number' || !Number.isFinite(m.yesPrice)) continue;
      let arr = samples.get(m.id);
      if (!arr && typeof m.volume24h === 'number' && m.volume24h < minVol) continue;
      if (!arr) samples.set(m.id, (arr = []));
      const last = arr[arr.length - 1];
      if (last) {
        if (t < last.t) continue;                               // out of order
        const gap = t - last.t;
        const moved = Math.abs(m.yesPrice - last.p) >= 0.0005;
        if (!moved && gap < refresh) continue;
      }
      arr.push({ t, p: m.yesPrice });
      if (arr.length > maxPer) arr.splice(0, arr.length - maxPer);
    }
    prune(t);
  }

  let lastPrune = 0;
  function prune(nowSec) {
    if (nowSec - lastPrune < 600) return;
    lastPrune = nowSec;
    const cutoff = nowSec - keepSec;
    for (const [id, arr] of samples) {
      let i = 0;
      while (i < arr.length && arr[i].t < cutoff) i++;
      if (i) arr.splice(0, i);
      if (!arr.length) samples.delete(id);
    }
  }

  function history(marketId) {
    return samples.get(marketId) || [];
  }

  /**
   * Recent motion from PNN's own samples (oldest first, the last one is the current price):
   *   change1h:  price now minus price ~60 min ago; null unless the samples span >= 30 min (a shorter span is
   *              read as "the last hour" from the oldest sample, so it can understate the move, never overstate it)
   *   change15m: same over ~15 min; null unless the samples span >= 10 min
   *   flatMin:   minutes since the price was last >= 1.5 points away from now (a lower bound: capped at the span
   *              PNN has observed). null with < 2 samples.
   */
  function motion(marketId, nowSec = Date.now() / 1000) {
    const arr = samples.get(marketId);
    if (!arr || arr.length < 2) return { change1h: null, change15m: null, flatMin: null };
    const cur = arr[arr.length - 1];
    const span = nowSec - arr[0].t;
    // price at or before a time: binary search for the last sample with t <= at (or the oldest)
    const at = (tSec) => {
      let lo = 0, hi = arr.length - 1;
      if (arr[0].t > tSec) return arr[0].p;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid].t <= tSec) lo = mid; else hi = mid - 1; }
      return arr[lo].p;
    };
    const r = (x) => Math.round(x * 10000) / 10000;
    const change1h = span >= 1800 ? r(cur.p - at(nowSec - 3600)) : null;
    const change15m = span >= 600 ? r(cur.p - at(nowSec - 900)) : null;
    let flatFrom = arr[0].t;
    for (let i = arr.length - 2; i >= 0; i--) if (Math.abs(arr[i].p - cur.p) >= 0.015) { flatFrom = arr[i + 1].t; break; }
    return { change1h, change15m, flatMin: Math.max(0, Math.round((nowSec - flatFrom) / 60)) };
  }

  /** Add alerts (dedupe by id, newest first, cap). Only genuinely new ones go out as 'alert' events. */
  function addAlerts(alerts) {
    const fresh = [];
    for (const a of alerts || []) {
      if (!a?.id || seenAlertIds.has(a.id)) continue;
      seenAlertIds.add(a.id);
      fresh.push(a);
    }
    if (!fresh.length) return [];
    state.alerts = [...fresh.slice().reverse(), ...state.alerts].slice(0, maxAlerts);
    if (seenAlertIds.size > 5000) {
      const keep = [...seenAlertIds].slice(-2000);
      seenAlertIds.clear();
      keep.forEach((id) => seenAlertIds.add(id));
    }
    for (const a of fresh) {
      log('info', 'breaking', { id: a.id, marketId: a.marketId, headline: a.headline, from: a.from, to: a.to, minutes: a.minutes, source: a.source });
      broadcast('alert', a);
    }
    scheduleState();
    return fresh;
  }

  /** Add one flash (dedupe by id, i.e. by wire cluster; newest first, cap). Broadcasts 'flash' only when new. */
  function addFlash(f) {
    if (!f?.id || seenFlashIds.has(f.id)) return null;
    seenFlashIds.add(f.id);
    if (seenFlashIds.size > 2000) { const keep = [...seenFlashIds].slice(-1000); seenFlashIds.clear(); keep.forEach((id) => seenFlashIds.add(id)); }
    state.flashes = [f, ...(state.flashes || [])].slice(0, maxFlashes);
    broadcast('flash', f);
    scheduleState();
    return f;
  }

  /** Add one corner-pop moment ('move' | 'listed' | 'money'): dedupe by id, keep the last ~10 in state, broadcast once. */
  function addMoment(kind, ev) {
    const key = MOMENT_KEYS[kind];
    if (!key || !ev?.id || seenMomentIds.has(ev.id)) return null;
    seenMomentIds.add(ev.id);
    if (seenMomentIds.size > 2000) { const keep = [...seenMomentIds].slice(-1000); seenMomentIds.clear(); keep.forEach((id) => seenMomentIds.add(id)); }
    state[key] = [ev, ...(state[key] || [])].slice(0, 10);
    momentStats[kind]++;
    momentStats[`last${kind[0].toUpperCase()}${kind.slice(1)}At`] = ev.at || new Date().toISOString();
    log('info', kind, { ...ev });
    broadcast(kind, ev);
    scheduleState();
    return ev;
  }

  /** Attach an SSE response. Sends the current snapshot as 'state'; never replays old alerts or flashes as events. */
  function subscribe(res, req) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    try { res.write(`event: state\ndata: ${getClientJson()}\n\n`); } catch (e) { log('debug', 'sse write failed', { error: String(e?.message || e) }); }
    clients.add(res);
    const done = () => clients.delete(res);
    (req || res).on?.('close', done);
    res.on?.('error', done);
    return done;
  }

  const hb = setInterval(() => {
    for (const res of clients) {
      try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); } catch { clients.delete(res); }
    }
  }, HEARTBEAT_MS);
  hb.unref?.();

  return {
    getState,
    getClientJson,
    setState,
    recordPrices,
    history,
    motion,
    addAlerts,
    addFlash,
    addMoment,
    momentStats: () => ({ ...momentStats }),
    subscribe,
    feeds,
    clientCount: () => clients.size,
    sampleCount: () => samples.size,
  };
}
