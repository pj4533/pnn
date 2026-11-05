// Chyron: persistent lower third (current story headline), scrolling ticker, data/disclaimer strip.
// The ticker cycles MOVERS (45s), PRICES (25s, state.finance: delayed stock / index / yield / oil / gold quotes) and NEWS WIRE (30s, state.wire:
// outlet + headline + age) with a quick crossfade. The wire is skipped while it has fewer than 3 headlines, PRICES while there are fewer than 3 quotes.
import { el, esc, pct, moveShort, moveCls, money, exchangeName, ago, storyVolume, newsAge, isMovingFirst } from './util.js';
import { fitText } from './fit.js';
import { finItems, fmtVal, moveShortFin, finDir, finMeta } from './finance.js';

const TAGS = { top: 'TOP STORY', focus: 'IN FOCUS', movers: 'MOVERS', week: 'THIS WEEK', desk: 'DESK', markets: 'MARKETS', tossup: 'TOSS-UP', swings: 'WEEK SWINGS', steady: 'STEADY', disagree: 'EXCHANGES', package: 'THE STORY', standby: 'PNN', alert: 'BREAKING' };

export function createChyron(root) {
  root.innerHTML = `
    <div class="cy-t1">
      <div class="cy-tag"><span>PNN</span></div>
      <div class="cy-head"><div class="cy-line fit" data-fit-h></div><div class="cy-sub fit"></div></div>
      <div class="cy-sweep"></div><div class="cy-prog"></div>
    </div>
    <div class="cy-t2"><div class="cy-lbl">MOVERS</div><div class="cy-view"><div class="cy-track"></div></div></div>
    <div class="cy-t3">
      <span class="cy-src fit"><i class="cy-dot"></i><b>PRICES:</b> Polymarket · Kalshi &nbsp; <b>NEWS:</b> wire feeds · Google News</span>
      <span class="cy-note fit">ODDS ARE NOT FACTS · MARKET PRICES, NOT CALLS · NO AFFILIATE LINKS</span>
      <span class="cy-upd fit"></span>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const tag = $('.cy-tag'), line = $('.cy-line'), sub = $('.cy-sub'), prog = $('.cy-prog');
  const track = $('.cy-track'), view = $('.cy-view'), upd = $('.cy-upd'), lbl = $('.cy-lbl'), t2 = $('.cy-t2');

  const srcEl = $('.cy-src'), SRC_BASE = srcEl.innerHTML, SRC_FIN = `${SRC_BASE} &nbsp; <b>QUOTES:</b> delayed stock and bond prices`;
  let state = null;
  let lastHeadline = ''; let lastStoryKey = '';

  // ---- lower third
  // alt (watchability #5): while a full-screen card is up, the lower third carries something NEW instead of repeating the
  // card's headline: {tag: 'ALSO MOVING' | 'COMING UP', line, sub, storyId}. Without alt it shows the story as before.
  function setLower(kind, story, { durationMs, tag: tagText, alt } = {}) {
    if (alt?.line) {
      const t = alt.tag || 'ALSO MOVING';
      if (tag.textContent !== t) tag.innerHTML = `<span>${esc(t)}</span>`;
      tag.className = `cy-tag ${kind} alt`;
      const sk = `alt|${kind}|${story?.id || ''}|${alt.line}`;
      if (sk !== lastStoryKey) { lastStoryKey = sk; lastHeadline = alt.line; line.classList.remove('in'); void line.offsetWidth; line.textContent = alt.line; line.classList.add('in'); }
      if (alt.storyId) line.dataset.story = alt.storyId; else delete line.dataset.story;
      sub.textContent = alt.sub || 'Odds are market prices, not facts or forecasts of record.';
      requestAnimationFrame(() => { fitText(line); fitText(sub); });
      if (durationMs) {
        prog.style.transition = 'none'; prog.style.transform = 'scaleX(0)'; void prog.offsetWidth;
        prog.style.transition = `transform ${durationMs}ms linear`; prog.style.transform = 'scaleX(1)';
      }
      return;
    }
    delete line.dataset.story;
    const t = tagText || (kind !== 'alert' && isMovingFirst(story) ? 'MOVING FIRST' : TAGS[kind]) || 'PNN';
    if (tag.textContent !== t) { tag.innerHTML = `<span>${esc(t)}</span>`; }
    tag.className = `cy-tag ${kind}${isMovingFirst(story) ? ' mf' : ''}`;
    const h = story?.headline || 'PNN reports what prediction markets are pricing, in plain English.';
    const sk = `${kind}|${story?.id || ''}`;
    if (sk !== lastStoryKey) {            // new story: animate the headline in
      lastStoryKey = sk; lastHeadline = h;
      line.classList.remove('in'); void line.offsetWidth;
      line.textContent = h; line.classList.add('in');
    } else if (h !== lastHeadline) {      // same story, numbers ticked: update quietly
      lastHeadline = h; line.textContent = h;
    }
    if (story?.fin) sub.textContent = finMeta(story.fin);
    else if (story?.lead) {
      const m = story.lead;
      sub.innerHTML = `${esc(story.sources?.map(exchangeName).join(' + ') || exchangeName(m.source))} · updated ${esc(ago(m.updatedAt))} · ${esc(storyVolume(story))} traded in 24 hrs${story.thin ? ' · <span class="thin sm">THIN MARKET</span>' : ''}`;
    } else sub.textContent = 'Odds are market prices, not facts or forecasts of record.';
    requestAnimationFrame(() => { fitText(line); fitText(sub); });
    if (durationMs) {
      prog.style.transition = 'none'; prog.style.transform = 'scaleX(0)'; void prog.offsetWidth;
      prog.style.transition = `transform ${durationMs}ms linear`; prog.style.transform = 'scaleX(1)';
    }
  }

  // ---- ticker: seamless loop, content swaps only at the loop seam so it never jumps
  let items = '', pendingItems = null, x = 0, half = 0, lastT = 0;
  function itemsFor(s) {
    const ms = (s?.movers || []).slice(0, 20);
    if (!ms.length) {
      return (s?.stories || []).slice(0, 12).map((st) => `<span class="cy-item" data-story="${esc(st.id)}"><span class="nm">${esc(st.eventTitle)}</span><span class="v">${esc(pct(st.lead.yesPrice))}</span></span>`).join('');
    }
    return ms.map((m) => {
      const name = m.label != null ? m.label : m.outcome ? `${m.outcome}` : m.eventTitle || m.title;
      const ctx = m.label != null ? m.context || '' : m.outcome ? m.eventTitle : '';
      return `<span class="cy-item" data-story="${esc(m.storyId || m.eventId || '')}"><span class="nm">${esc(name)}</span>${ctx ? `<span class="ctx">${esc(ctx)}</span>` : ''}<span class="v">${esc(pct(m.yesPrice))}</span><span class="mv ${moveCls(m.change1d)}">${esc(moveShort(m.change1d))}</span><span class="ex">${esc(exchangeName(m.source).toUpperCase())} ${esc(money(m.volume24h))}</span></span>`;
    }).join('');
  }
  function wireFor(s) {
    return (s?.wire || []).slice(0, 30).map((w) => `<span class="cy-item wi"><span class="ol">${esc(String(w.outlet || 'NEWS').toUpperCase())}</span><span class="nm">${esc(w.title)}</span><span class="ag">${esc(newsAge(w) || ago(w.publishedAt))}</span></span>`).join('');
  }
  // PRICES: delayed quotes (facts), never mixed into the odds items. Indices first, then yields, oil / gold, then stocks.
  const KIND_ORDER = { index: 0, yield: 1, commodity: 2, currency: 3, stock: 4 };
  function quotesFor(s) {
    return finItems(s).slice().sort((a, b) => (KIND_ORDER[a.kind] ?? 5) - (KIND_ORDER[b.kind] ?? 5)).slice(0, 14).map((q) => `<span class="cy-item fq" data-story="${esc(q.id)}"><span class="nm">${esc(q.name)}</span><span class="v">${esc(fmtVal(q, q.price))}</span><span class="mv ${finDir(q) > 0 ? 'up' : finDir(q) < 0 ? 'down' : 'flat'}">${esc(moveShortFin(q))}</span><span class="ex">DELAYED</span></span>`).join('');
  }
  const MODE_MS = { movers: 45000, quotes: 25000, wire: 30000 };
  const MODE_LBL = { movers: 'MOVERS', quotes: 'PRICES', wire: 'NEWS WIRE' };
  const ORDER = ['movers', 'quotes', 'wire'];
  let mode = 'movers', modeAt = Date.now(), swapping = false;
  const modeOk = (m, s = state) => m === 'movers' || (m === 'wire' && (s?.wire || []).length >= 3) || (m === 'quotes' && finItems(s).length >= 3);
  const htmlFor = (s) => (mode === 'wire' ? wireFor(s) : mode === 'quotes' ? quotesFor(s) : itemsFor(s));
  function setMode(m) {
    if (m === mode || swapping) return;
    swapping = true;
    view.classList.add('swap');
    setTimeout(() => {
      mode = m; modeAt = Date.now(); pendingItems = null;
      lbl.textContent = MODE_LBL[m] || 'MOVERS';
      t2.classList.toggle('wire', m === 'wire');
      t2.classList.toggle('quotes', m === 'quotes');
      x = 0; mount(htmlFor(state));
      view.classList.remove('swap');
      swapping = false;
    }, 380);
  }
  setInterval(() => {
    if (!state) return;
    if (!modeOk(mode)) return setMode('movers');
    if (Date.now() - modeAt >= MODE_MS[mode]) {
      for (let i = 1; i <= ORDER.length; i++) { const n = ORDER[(ORDER.indexOf(mode) + i) % ORDER.length]; if (modeOk(n)) return setMode(n); }
    }
  }, 1000);
  function mount(html) {
    items = html;
    track.innerHTML = html;
    const w = track.scrollWidth || 1;
    const unit = html.repeat(Math.max(1, Math.ceil((view.clientWidth || window.innerWidth) / w)));
    track.innerHTML = unit + unit;
    half = track.scrollWidth / 2;
  }
  function frame(t) {
    const dt = Math.min(0.1, (t - (lastT || t)) / 1000); lastT = t;
    if (half > 0) {
      x -= dt * Math.max(60, window.innerWidth * 0.045);
      if (-x >= half) {
        x += half;
        if (pendingItems != null) { mount(pendingItems); pendingItems = null; x = 0; }
      }
      track.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => { if (items) mount(items); });
  setInterval(() => { if (state) upd.textContent = `DATA UPDATED ${ago(state.generatedAt).toUpperCase()}`; }, 5000);

  return {
    update(s) {
      state = s;
      const html = htmlFor(s);
      if (!items) mount(html);
      else if (html !== items) pendingItems = html;
      upd.textContent = `DATA UPDATED ${ago(s.generatedAt).toUpperCase()}`;
      const src = finItems(s).length ? SRC_FIN : SRC_BASE;
      if (srcEl.innerHTML !== src) srcEl.innerHTML = src;
      requestAnimationFrame(() => root.querySelectorAll('.cy-t3 .fit').forEach(fitText));
    },
    setLower,
    /** Dev/test: switch the ticker now ('movers' | 'wire'). */
    setTickerMode: (m) => setMode(m),
    get tickerMode() { return mode; },
  };
}
