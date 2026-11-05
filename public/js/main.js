// PNN app shell: wires data → director → overlays/chyron/alerts, and the 3D scene when it loads.
// The scene is optional: if its import or WebGL fails, the 2D broadcast still runs.
import { report, safe, cleanText } from './util.js';
import { connect, FIXTURE } from './data.js';
import { createOverlay } from './overlay.js';
import { createChyron } from './chyron.js';
import { createAlerts } from './alerts.js';
import { createFlashes } from './flash.js';
import { createDirector } from './director.js';
import { startAutoFit, fitAll, fitReport } from './fit.js';
import { createPops } from './pops.js';
import { createCountdownChip } from './countdown.js';
import { createStageLink, watchFx } from './stagelink.js';
import { initPerf } from './perf.js';

window.addEventListener('error', (e) => report('window.error', e.error || e.message, { src: e.filename, line: e.lineno }));
window.addEventListener('unhandledrejection', (e) => report('unhandledrejection', e.reason));

const canvas = document.getElementById('scene');
const overlay = createOverlay(document.getElementById('overlay'));
const chyron = createChyron(document.getElementById('chyron'));
// Projector stage (2D side): shared --story accent, connector beam, eye-wall reticle; driven by the scene's 'pnn:hero' events.
safe('stagelink', () => { createStageLink(document.getElementById('overlay'), overlay); watchFx(); });

// Scene proxy: every call is guarded; calls before the scene loads are remembered and replayed.
let sceneImpl = null;
let lastStory = null, lastTicker = null, lastRect = '';
let flashLock = false; // while a NEWS MEETS MARKETS flash is up, only the flash drives the 3D
// Hand the scene the open 3D area of the current layout (it differs between TOP STORIES and the rest).
function syncRect() {
  const r = overlay.stageRect, k = JSON.stringify(r);
  if (k !== lastRect && sceneImpl?.setStageRect) { lastRect = k; safe('scene.setStageRect', () => sceneImpl.setStageRect(r)); }
}
const scene = {
  showStory(story, segment, force = false) { lastStory = [story, segment]; if (flashLock && !force) return; if (sceneImpl) { syncRect(); safe('scene.showStory', () => sceneImpl.showStory?.(story, segment)); } },
  showAlert(a) { if (sceneImpl) safe('scene.showAlert', () => sceneImpl.showAlert?.(a)); },
  clearAlert() { if (sceneImpl) safe('scene.clearAlert', () => sceneImpl.clearAlert?.()); },
  setTicker(ms) { lastTicker = ms; if (sceneImpl) safe('scene.setTicker', () => sceneImpl.setTicker?.(ms)); },
  resize(w, h) { if (sceneImpl) safe('scene.resize', () => sceneImpl.resize?.(w, h)); },
  envEvent(type, data) { if (sceneImpl) safe('scene.envEvent', () => sceneImpl.envEvent?.(type, data)); },
};
(async () => {
  if (new URLSearchParams(location.search).has('noscene')) return;
  try {
    const mod = await import('./scene/index.js');
    sceneImpl = mod.createScene(canvas);
    document.body.classList.add('has-scene');
    sceneImpl.resize?.(window.innerWidth, window.innerHeight);
    if (lastTicker) safe('scene.setTicker', () => sceneImpl.setTicker?.(lastTicker));
    if (lastStory) { syncRect(); safe('scene.showStory', () => sceneImpl.showStory?.(...lastStory)); }
  } catch (e) {
    sceneImpl = null;
    document.body.classList.add('no-scene');
    report('scene.load', e);
  }
})();
window.addEventListener('resize', () => scene.resize(window.innerWidth, window.innerHeight));

const director = createDirector({ overlay, chyron, scene });
// Perf telemetry (item 11): frame times + hitch attribution every 30 s to /api/client-log; ?perf=1 shows a HUD.
safe('perf', () => initPerf({ send: !FIXTURE || new URLSearchParams(location.search).has('perflog'), segment: () => director.current?.id, wrap: [[overlay, 'render', 'overlay.render'], [chyron, 'update', 'chyron.update'], [director, 'update', 'director.update']] }));
// NEWS MEETS MARKETS: holds the rundown, shows the matched story in 3D, then cuts to STORY FOCUS on it.
const flashes = createFlashes(document.getElementById('flash'), {
  onStart(f) {
    director.hold(true);
    document.body.classList.add('flashing');
    flashLock = true;
    const st = director.flashStory(f);
    if (st) { scene.showStory(st, 'focus', true); director.note(st.id, 'flash'); overlay.setFrameLabel(st.eventTitle || st.short || st.headline); }
    scene.envEvent('flash');
  },
  onEnd(f, { cut }) {
    flashLock = false;
    overlay.setFrameLabel(null);
    document.body.classList.remove('flashing');
    if (!cut) { const st = director.flashStory(f); if (!st || !director.focusStory(st)) director.hold(false); }
    else if (!document.body.classList.contains('alerting')) director.hold(false); // cut by a click (focus follows) or by hand
  },
  onClick(f) {
    const st = director.flashStory(f);
    flashes.cut();
    if (st) director.focusStory(st, { manual: true });
  },
});
const alerts = createAlerts(document.getElementById('alerts'), {
  onStart(a) { director.note(a.storyId, 'alert'); document.body.classList.add('alerting'); director.hold(true); flashes.pause(true); scene.showAlert(a); },
  onEnd(a) { scene.clearAlert(); document.body.classList.remove('alerting'); director.focusStory(a.storyId); flashes.pause(false); },
});

// Corner pops (ON THE MOVE / JUST LISTED / MONEY MOVING): live SSE events only, paced and paused in pops.js.
const pops = createPops(document.getElementById('pops'), {
  onClick(id) { if (!document.body.classList.contains('alerting')) director.focusStory(id, { manual: true }); },
});
const chip = createCountdownChip(document.getElementById('chip'));

// Click a card, board row or ticker item to cut to STORY FOCUS on that story (ignored during a breaking takeover).
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-story]');
  const id = el?.dataset.story;
  if (!id || document.body.classList.contains('alerting')) return;
  if (director.focusStory(id, { manual: true })) { el.classList.remove('clicked'); void el.offsetWidth; el.classList.add('clicked'); }
});

startAutoFit();
let latest = null;
connect({
  onState(s) {
    if (!s || !Array.isArray(s.stories)) return;
    s.movers ||= []; s.closing ||= []; s.alerts ||= []; s.flashes ||= []; s.wire ||= [];
    cleanText(s);
    latest = s;
    window.__state = s;
    alerts.markSeen(s.alerts); // never replay history as takeovers
    flashes.markSeen(s.flashes);
    pops.markSeen(s); // state.moves / listed / money are history: never replayed as pops
    safe('chip.update', () => chip.update(s));
    safe('chyron.update', () => chyron.update(s));
    scene.setTicker(s.movers);
    safe('director.update', () => director.update(s));
  },
  onAlert(a) { safe('alerts.enqueue', () => alerts.enqueue(cleanText(a))); },
  onFlash(f) { safe('flashes.enqueue', () => flashes.enqueue(cleanText(f))); },
  onPop(type, e) {
    safe('pops.enqueue', () => pops.enqueue(type, cleanText(e)));
    if (type === 'move' && Number.isFinite(e?.change1h)) scene.envEvent('mover', { dir: e.change1h >= 0 ? 1 : -1 });
  },
  onStatus(ok) { overlay.setConnected(ok); },
});

// Dev hooks for tests and the console.
window.__pnn = { fitAll, fitReport, director, alerts, pops, get airLog() { return director.airLog; }, flashes, chyron, fixture: FIXTURE, get state() { return latest; }, get sceneLoaded() { return !!sceneImpl; } };

// Heartbeat so the server log shows the screen is alive.
let frames = 0; (function f() { frames++; requestAnimationFrame(f); })();
setInterval(() => {
  if (FIXTURE) { frames = 0; return; }
  fetch('/api/client-log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'info', kind: 'heartbeat', fps: Math.round(frames / 60), segment: director.current?.id, scene: !!sceneImpl, stateAge: latest ? Date.now() - Date.parse(latest.generatedAt) : null }) }).catch(() => {});
  frames = 0;
}, 60000);

// iPad / TV: keep the screen from sleeping while PNN is on air (Screen Wake Lock API; silently skipped if unsupported).
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* needs a user gesture on some versions: retried on tap */ }
}
keepAwake();
document.addEventListener('visibilitychange', keepAwake);
document.addEventListener('pointerdown', keepAwake, { passive: true });

// Tap the PNN logo to reload: the iPad home-screen app has no browser reload button.
document.addEventListener('click', (e) => {
  const m = e.target.closest?.('.bug-mark');
  if (!m) return;
  m.classList.add('reloading');
  setTimeout(() => location.reload(), 350);
});
