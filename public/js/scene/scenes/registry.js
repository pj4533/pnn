// Scene registry: lazy module loaders plus static META so the director can pick without importing anything.
// META: { id, title, family, weight, similar: [ids], hasLayer, morph }. '_stub' is test-only (weight 0, never rotated).
export const SCENES = {
  hyperspeed: () => import('./hyperspeed.js'),
  megacity: () => import('./megacity.js'),
  curlSwarm: () => import('./curlSwarm.js'),
  chromeBlobs: () => import('./chromeBlobs.js'),
  kaleidoTunnel: () => import('./kaleidoTunnel.js'),
  copperDemo: () => import('./copperDemo.js'),
  laserCathedral: () => import('./laserCathedral.js'),
  vectorArcade: () => import('./vectorArcade.js'),
  dataCyberspace: () => import('./dataCyberspace.js'),
  vaporGallery: () => import('./vaporGallery.js'),
  auroraFireworks: () => import('./auroraFireworks.js'),
  outrunClassic: () => import('./outrunClassic.js'),
  _stub: () => import('./_stub.js'),
};

const m = (id, title, family, weight, similar, hasLayer, morph = true) => ({ id, title, family, weight, similar, hasLayer, morph });
export const META = {
  hyperspeed: m('hyperspeed', 'Hyperspeed Highway', 'speed', 1, ['kaleidoTunnel'], false),
  megacity: m('megacity', 'Neon Megacity Flyover', 'city', 1, ['dataCyberspace'], false),
  curlSwarm: m('curlSwarm', 'Curl Swarm Galaxy', 'particles', 1, ['auroraFireworks'], true),
  chromeBlobs: m('chromeBlobs', 'Liquid Chrome Lounge', 'chrome', 1, ['vaporGallery'], true),
  kaleidoTunnel: m('kaleidoTunnel', 'Kaleidoscope Corridor', 'tunnel', 1, ['hyperspeed', 'copperDemo'], true),
  copperDemo: m('copperDemo', 'Copper Demo', 'demoscene', 1, ['kaleidoTunnel'], false),
  laserCathedral: m('laserCathedral', 'Laser Cathedral', 'lasers', 1, [], true),
  vectorArcade: m('vectorArcade', 'Vector Arcade Void', 'vector', 1, ['dataCyberspace'], false),
  dataCyberspace: m('dataCyberspace', 'Data Cyberspace', 'cyber', 1, ['megacity', 'vectorArcade'], false),
  vaporGallery: m('vaporGallery', 'Vapor Gallery', 'vapor', 1, ['chromeBlobs'], false),
  auroraFireworks: m('auroraFireworks', 'Midnight Aurora', 'sky', 1, ['curlSwarm'], false),
  outrunClassic: m('outrunClassic', 'Outrun Classic', 'outrun', 1.2, [], false),
  _stub: m('_stub', 'Stub', 'stub', 0, [], false),
};

/** Ids eligible for rotation (weight > 0). */
export const ROTATION = Object.keys(META).filter((id) => META[id].weight > 0 && SCENES[id]);

/** Pre-fetch every module on idle after boot so later creates don't wait on the network. Errors are ignored here;
 * the director handles a failing import when it actually needs the scene. */
export function prefetchAll(ids = ROTATION) {
  const idle = (typeof requestIdleCallback === 'function') ? requestIdleCallback : (f) => setTimeout(f, 200);
  let i = 0;
  const step = () => { if (i >= ids.length) return; const id = ids[i++]; SCENES[id]().catch(() => {}).finally(() => idle(step)); };
  idle(step);
}
