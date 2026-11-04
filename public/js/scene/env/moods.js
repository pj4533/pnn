// Living-environment moods. Every param is numeric (discrete choices are weight vectors), colors are sRGB hex
// strings (converted once to linear THREE.Color by resolveMood), palettes are [r,g,b] arrays (IQ cosine palette;
// keep palC integer so the sky's wrapped palette phase is seamless). DEFAULTS reproduces the original look.
import * as THREE from '../../../vendor/three/three.module.js';

export const DEFAULTS = {
  sky: {
    zenith: '#05000f', mid: '#1a0533', horizon: '#ff2a8a', glow: '#ff6ad5',
    palA: [0.5, 0.5, 0.5], palB: [0.5, 0.5, 0.5], palC: [1, 1, 1], palD: [0.0, 0.33, 0.67],
    palDrift: 0, bandAmt: 1, cloudAmt: 0.25, cloudScale: 1, cloudSpeed: 1,
    nebulaAmt: 0.1, warp: 0.5, auroraAmt: 0, auroraHue: 0.35, auroraSpeed: 1, starAmt: 0.7,
  },
  sun: {
    stripe: 1, eclipse: 0, ring: 0, twin: 0, moon: 0,
    colA: '#ff2fb0', colB: '#ffd35a', coronaCol: '#ff6ad5',
    size: 1, height: 150, yaw: -0.2, stripes: 12, stripeSpeed: 0.12, corona: 1,
    eclipseOffset: 0, ringTilt: 0.35, twinOffset: 0.3, moonPhase: 0.15, shafts: 0, bright: 1,
  },
  terrain: {
    ridge: 1, dune: 0, canyon: 0, wave: 0, amp: 1, freq: 1, scroll: 0.5, morphSeed: 0,
    wireColA: '#f359f3', wireColB: '#00cbff', wireAmt: 1, solidCol: '#07011a',
    pulseAmt: 0.4, pulseSpeed: 1,
    skyline: 0.6, skylineCol: '#00e7ff', windowCol: '#ffc46b', windowRate: 0.5, flicker: 0.5,
  },
  grid: {
    square: 1, hex: 0, polar: 0, dots: 0, colA: '#ff2bd6', colB: '#00f0ff', storyMix: 0.5,
    speed: 1, cell: 1, fade: 1, ripple: 0, rippleSpeed: 1, glow: 1,
  },
  atmos: {
    fogCol: '#652065', fogDensity: 0.5, fogLayers: 0.3, fogSpeed: 1,
    hazeAmt: 0.3, hazeCol: '#aa4589', boltCol: '#e0e8ff', lightningRate: 0,
  },
  particles: {
    stars: 0.7, starTwinkle: 0.6, dust: 0.6, dustColA: '#ff2bd6', dustColB: '#00f0ff',
    rain: 0, snow: 0, embers: 0, fireflies: 0, motes: 0, weatherCol: '#e0f0ff',
    wind: 0, fall: 1, shootingRate: 2, cometRate: 0,
  },
  post: { bloom: 0.55, bloomThreshold: 0.78, bloomRadius: 0.4, ca: 1, grain: 1, vignette: 1, scan: 1, tint: '#ffffff', tintAmt: 0, sat: 1, contrast: 1 },
  camera: { orbitScale: 1, bob: 1 },
};

// weight groups: a mood that names any member zeroes the others it doesn't name; blends renormalize to sum 1
export const GROUPS = {
  sun: ['stripe', 'eclipse', 'ring', 'twin', 'moon'],
  terrain: ['ridge', 'dune', 'canyon', 'wave'],
  grid: ['square', 'hex', 'polar', 'dots'],
};
export const WEATHER = ['rain', 'snow', 'embers', 'fireflies', 'motes'];

export const MOODS = [
  { name: 'classicSunset', weight: 1.4, look: 'the original magenta/gold striped sun over ridges and a square grid' },
  {
    name: 'midnightAurora', weight: 1, look: 'indigo night, green-cyan aurora curtains, pale moon, slow pixel snow',
    sky: { zenith: '#01010a', mid: '#06123a', horizon: '#1a6a9a', glow: '#3ad0ff', auroraAmt: 0.85, auroraHue: 0.35, starAmt: 1, cloudAmt: 0.1, nebulaAmt: 0.15, palD: [0.3, 0.2, 0.5] },
    sun: { moon: 1, colA: '#cfe8ff', colB: '#6aa8ff', coronaCol: '#7ab8ff', size: 0.55, height: 195, bright: 0.6, moonPhase: 0.3 },
    terrain: { ridge: 0.7, dune: 0.3, amp: 0.7, wireColA: '#3af0ff', wireColB: '#7a4dff', wireAmt: 0.8, skyline: 0.3, skylineCol: '#5a8aff' },
    grid: { dots: 0.6, square: 0.4, colA: '#00f0ff', colB: '#6a7dff' },
    atmos: { fogCol: '#0e2648', hazeAmt: 0.4, hazeCol: '#3a6aaa', fogLayers: 0.3 },
    particles: { snow: 0.35, stars: 1, cometRate: 1, dust: 0.3, weatherCol: '#d8eaff', fall: 0.7, shootingRate: 2 },
    post: { bloom: 0.5, sat: 0.9, tint: '#3060ff', tintAmt: 0.08, grain: 1.2 },
  },
  {
    name: 'neonRain', weight: 1, look: 'Blade-Runner city: dense low clouds, full lit skyline, rain streaks, distant lightning',
    sky: { zenith: '#02000a', mid: '#160c34', horizon: '#7a2a8a', glow: '#ff5ad0', cloudAmt: 0.7, cloudScale: 1.4, nebulaAmt: 0, starAmt: 0.2 },
    sun: { stripe: 1, bright: 0.35, height: 120 },
    terrain: { ridge: 1, amp: 0.6, skyline: 1, windowRate: 1.2, windowCol: '#ffc46b', flicker: 1, skylineCol: '#00e0ff' },
    grid: { square: 1, ripple: 0.6, rippleSpeed: 1.4, colA: '#00f0ff', colB: '#ff2bd6' },
    atmos: { fogCol: '#2e1a50', fogDensity: 0.9, fogLayers: 0.8, lightningRate: 0.3, hazeCol: '#7a3aaa' },
    particles: { rain: 0.6, dust: 0.2, stars: 0.2, weatherCol: '#b8d8ff', wind: 0.8, shootingRate: 0.5 },
    post: { bloom: 0.6, ca: 1.2, scan: 1.2 },
  },
  {
    name: 'eclipse', weight: 1, look: 'black-red sky, eclipsed sun with a burning corona, red canyons, rising embers',
    sky: { zenith: '#000000', mid: '#1a0410', horizon: '#9a1a2a', glow: '#ff3a2a', cloudAmt: 0.15, nebulaAmt: 0.2, palD: [0.0, 0.1, 0.2] },
    sun: { eclipse: 1, eclipseOffset: 0.08, corona: 1.4, colA: '#ff2a1a', colB: '#ffb04a', coronaCol: '#ff5a2a', shafts: 0.5, bright: 1 },
    terrain: { canyon: 0.7, ridge: 0.3, amp: 1.1, wireColA: '#ff3a2a', wireColB: '#ff8a3a', skyline: 0.3, skylineCol: '#ff6a3a' },
    grid: { polar: 0.5, square: 0.5, colA: '#ff3a5a', colB: '#ff9a2a', storyMix: 0.6 },
    atmos: { fogCol: '#3a0a16', hazeCol: '#aa2a2a' },
    particles: { embers: 0.5, stars: 0.5, weatherCol: '#ff8a3a', dust: 0.3 },
    post: { bloom: 0.6, sat: 1.1, tint: '#ff2020', tintAmt: 0.05, vignette: 1.25 },
  },
  {
    name: 'oceanDusk', weight: 1, look: 'teal/pink seascape: soft low sun, rolling wireframe swells, sea sparkle',
    sky: { zenith: '#020818', mid: '#0e3458', horizon: '#ff7aa8', glow: '#ffa0c0', palDrift: 0.3, cloudAmt: 0.35, palD: [0.5, 0.2, 0.25] },
    sun: { stripe: 0.6, moon: 0.4, colA: '#ff6a9a', colB: '#ffe0a0', coronaCol: '#ff9ac0', height: 110 },
    terrain: { wave: 1, amp: 0.8, scroll: 1, wireColA: '#00ffd0', wireColB: '#ff6ad5', skyline: 0 },
    grid: { square: 0.7, polar: 0.3, ripple: 0.8, colA: '#00ffd0', colB: '#ff6ad5' },
    atmos: { fogCol: '#0e3a48', hazeAmt: 0.6, hazeCol: '#ff7aa8', fogLayers: 0.5 },
    particles: { fireflies: 0.4, dust: 0.3, weatherCol: '#a0fff0', stars: 0.5 },
    post: { bloom: 0.5, sat: 1.05 },
  },
  {
    name: 'dataStorm', weight: 1, look: 'electric blue boiling nebula, ringed sun, hex grid, frequent wire sweeps and lightning',
    sky: { zenith: '#01000c', mid: '#0e0e4a', horizon: '#4a2aff', glow: '#6a7aff', nebulaAmt: 0.6, warp: 0.9, cloudAmt: 0.5, palD: [0.6, 0.7, 0.9] },
    sun: { ring: 0.5, stripe: 0.5, bright: 0.5, colA: '#6a8aff', colB: '#ff6ad5', ringTilt: 0.45 },
    terrain: { ridge: 1, amp: 0.9, pulseAmt: 1, pulseSpeed: 1.4, skyline: 0.4, wireColA: '#3a8aff', wireColB: '#ff2bd6' },
    grid: { hex: 1, colA: '#3a8aff', colB: '#ff2bd6', speed: 1.4 },
    atmos: { lightningRate: 1.2, fogCol: '#1a1a50', hazeCol: '#4a4aff', boltCol: '#c0d0ff' },
    particles: { motes: 0.6, shootingRate: 3, weatherCol: '#7ab0ff', dust: 0.4 },
    post: { bloom: 0.62, ca: 1.3, grain: 1.2 },
  },
  {
    name: 'ringedPlanetDawn', weight: 1, look: 'peach/lilac morning, a big ringed planet, soft dunes, dotted grid',
    sky: { zenith: '#120a2a', mid: '#4a2a6a', horizon: '#ffb08a', glow: '#ffd0a0', cloudAmt: 0.4, palDrift: 0.4, starAmt: 0.3, palD: [0.1, 0.25, 0.4] },
    sun: { ring: 1, colA: '#ffb0d0', colB: '#8a6aff', coronaCol: '#ffc0e0', ringTilt: 0.35, size: 1.0, height: 210, bright: 0.85 },
    terrain: { dune: 0.8, ridge: 0.2, amp: 0.6, wireColA: '#ff9ad5', wireColB: '#9a7aff', skyline: 0.2, skylineCol: '#ffb0e0' },
    grid: { dots: 0.5, square: 0.5, colA: '#ffb0e0', colB: '#9a7aff' },
    atmos: { hazeAmt: 0.5, fogCol: '#4a2448', hazeCol: '#ffa0a0' },
    particles: { dust: 0.5, stars: 0.3, dustColA: '#ffc0a0', dustColB: '#c0a0ff' },
    post: { bloom: 0.45, sat: 0.95, contrast: 0.95 },
  },
  {
    name: 'twinSunDesert', weight: 1, look: 'amber/teal alien desert, gold and cyan twin suns, terraced canyons, blowing sand',
    sky: { zenith: '#0a0210', mid: '#3a0a2a', horizon: '#ff8a2a', glow: '#ffb05a', cloudAmt: 0.2, palD: [0.05, 0.15, 0.3] },
    sun: { twin: 1, colA: '#ffcf4a', colB: '#00e0ff', coronaCol: '#ffa03a', twinOffset: 0.35, bright: 0.7 },
    terrain: { canyon: 0.5, dune: 0.5, amp: 1, wireColA: '#ff9a2a', wireColB: '#00e0d0', skyline: 0 },
    grid: { square: 0.6, hex: 0.4, colA: '#ffaa2a', colB: '#00e0d0' },
    atmos: { hazeAmt: 0.7, fogCol: '#4a2410', hazeCol: '#ff9a4a' },
    particles: { embers: 0.2, dust: 0.6, wind: 1.5, dustColA: '#ffb05a', dustColB: '#ffe0a0', weatherCol: '#ffb04a' },
    post: { bloom: 0.55, sat: 1.1, tint: '#ff9020', tintAmt: 0.05 },
  },
  {
    name: 'nebulaDrift', weight: 1, look: 'deep-space violet/green nebula, small far moon, low ridges, fireflies and comets',
    sky: { zenith: '#020010', mid: '#160830', horizon: '#4a1a7a', glow: '#9a5aff', nebulaAmt: 0.9, warp: 0.7, auroraAmt: 0.2, starAmt: 1, cloudAmt: 0.1, palD: [0.75, 0.3, 0.6] },
    sun: { moon: 0.6, ring: 0.4, size: 0.5, height: 300, colA: '#b0ffc0', colB: '#b04aff', bright: 0.7 },
    terrain: { ridge: 1, amp: 0.5, wireColA: '#7aff9a', wireColB: '#b04aff', skyline: 0.1 },
    grid: { hex: 0.5, dots: 0.5, colA: '#7aff9a', colB: '#b04aff' },
    atmos: { fogLayers: 0.2, fogCol: '#24104a', hazeCol: '#6a3aaa' },
    particles: { stars: 1, fireflies: 0.2, cometRate: 2, shootingRate: 3, weatherCol: '#9aff9a', dust: 0.4 },
    post: { bloom: 0.55, sat: 1 },
  },
];

// slow in-mood wander amplitudes (param units)
export const WANDER = {
  'sky.cloudAmt': 0.15, 'sky.palDrift': 0.1, 'sky.nebulaAmt': 0.1, 'sky.auroraAmt': 0.1, 'sky.warp': 0.1,
  'sun.height': 25, 'sun.yaw': 0.06, 'sun.stripeSpeed': 0.04, 'sun.eclipseOffset': 0.07, 'sun.ringTilt': 0.08, 'sun.size': 0.06,
  'terrain.amp': 0.04, 'terrain.scroll': 0.3, 'terrain.morphSeed': 0, // user: terrain jumped around; keep it subtle
  'grid.ripple': 0.15, 'grid.speed': 0.15,
  'atmos.fogDensity': 0.15, 'atmos.hazeAmt': 0.1, 'atmos.fogLayers': 0.1,
  'particles.dust': 0.15, 'particles.stars': 0.1,
  'post.bloom': 0.04, 'camera.orbitScale': 0.12, 'camera.bob': 0.15,
};

const isHex = (v) => typeof v === 'string' && v[0] === '#';

export function resolveMood(m) {
  const out = {};
  for (const sec in DEFAULTS) {
    const d = DEFAULTS[sec], o = (m && m[sec]) || {}, r = (out[sec] = {});
    const grp = GROUPS[sec];
    const named = grp && grp.some((k) => o[k] !== undefined);
    for (const k in d) {
      let v = o[k] !== undefined ? o[k] : d[k];
      if (named && grp.includes(k) && o[k] === undefined) v = 0;
      if (isHex(v)) r[k] = new THREE.Color(v);              // Color(hex) converts sRGB -> linear under ColorManagement
      else if (Array.isArray(v)) r[k] = v.slice();
      else r[k] = v;
    }
  }
  out.name = m?.name || 'custom';
  return out;
}

// in-place lerp a->b into out (numbers, Colors, arrays); no allocation
export function blendParams(a, b, k, out) {
  for (const sec in DEFAULTS) {
    const A = a[sec], B = b[sec], O = out[sec];
    for (const key in A) {
      const va = A[key], vb = B[key];
      if (typeof va === 'number') O[key] = va + (vb - va) * k;
      else if (va && va.isColor) O[key].lerpColors(va, vb, k);
      else if (Array.isArray(va)) { const o = O[key]; for (let i = 0; i < va.length; i++) o[i] = va[i] + (vb[i] - va[i]) * k; }
    }
    const grp = GROUPS[sec];
    if (grp) {
      let s = 0; for (const g of grp) s += O[g];
      if (s > 1e-4) for (const g of grp) O[g] /= s; else O[grp[0]] = 1;
    }
  }
  return out;
}

// dominant variant per group (used by the director to pick a next mood that actually looks different)
export function dominant(res, sec) {
  let best = null, bv = -1;
  for (const g of GROUPS[sec]) if (res[sec][g] > bv) { bv = res[sec][g]; best = g; }
  return best;
}
