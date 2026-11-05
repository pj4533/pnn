// Full-screen story cards for STORY FOCUS, DESK, BIGGEST MOVERS and THIS WEEK: one story per card, ~9s each, huge type.
// The card fills the left ~47% between the top bar and the chyron; the 3D shows the same story on the right.
// Pure: segmentCard(seg, now) -> HTML. seg = {id: 'focus'|'desk'|'movers'|'week', story, index, count, desk?}.
// Variants (watchability plan 2026-11-04):
//   - story.swing: THEN vs NOW card ("YESTERDAY 14%" -> "NOW 92%" counting up, huge glowing +78, FLIPPED stamp).
//   - the day's move is a huge glowing +7 / -40 ("POINTS TODAY"); no "unchanged today" filler (week move or runner-up).
//   - story.exchanges (both exchanges price it): "KALSHI 92% · POLYMARKET 93% · both exchanges agree" badge.
// Also: sotdCard (Story of the Day board) and countdownCard (COUNTDOWN DESK, next 3 decisions).
import { countText } from './countdown.js';
import { fmtVal, finDir, moveSize, moveWords, changeAbs, finHeadline, finKindLabel } from './finance.js';
import { esc, pct, pctNum, ptsOf, moveCls, money, exchangeName, ago, until, etShort, marketLabel, categoryName, OUTCOME_COLORS, storyVolume, newsOf, newsLineHtml, newsMeta, newsKicker, newsOld, storyNewsHtml } from './util.js';

/** "up 45 points today" / "down 1 point this week" / "" (plain English, whole points). */
export function pointsText(d, when = 'today') {
  if (d == null || Number.isNaN(d)) return '';
  const n = Math.sign(d) * Math.round(Math.abs(d) * 100); // magnitude rounding, matches server copy
  if (n === 0) return `unchanged ${when}`;
  return `${n > 0 ? 'up' : 'down'} ${Math.abs(n)} ${Math.abs(n) === 1 ? 'point' : 'points'} ${when}`;
}
/** The outcome label shown as a subtitle under the headline; '' for a bare count-bucket number ("4", "5+", "0-2", "<3"),
 *  which says nothing without the question. */
export const BARE_NUM = /^\s*[<>≤≥~]?\s*[$]?\d[\d.,]*\s*(?:[-–]\s*\d[\d.,]*)?\s*(?:\+|%|or more|or fewer|or less|or fewer|plus)?\s*$/i;
export function outcomeSubtitle(story, m = story?.lead) {
  if (!((story?.markets || []).length > 1)) return '';
  const l = String(marketLabel(m) || '').trim();
  return !l || BARE_NUM.test(l) ? '' : l;
}
/** ONE source of truth for the card's move: whole points of the lead's change1d (the same number the widget, chyron and ticker show). */
export const leadPts = (s, key = 'change1d') => ptsOf(s?.lead?.[key]);
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');   // real minus sign, glows like the plus

const TITLES = { focus: 'STORY FOCUS', movers: 'BIGGEST MOVERS', week: 'THIS WEEK' };
export const VARIETY_TITLES = { tossup: 'TOSS-UP', swings: "THIS WEEK'S SWINGS", steady: 'STEADY FAVORITE', disagree: 'EXCHANGES DISAGREE', package: 'STORY BEHIND THE ODDS' };
const SWING_TITLES = { swing: 'BIGGEST SWINGS', longshot: 'LONGSHOTS ON THE MOVE', slipping: 'FAVORITES SLIPPING' };

/** Election races carry "Market prices, not official results" (editorial rule). */
export const isElection = (s) => s?.category === 'elections' || (s?.lead?.tags || []).includes('elections')
  || /\b(election|elections|race|mayor|senate|governor|house|primary|runoff|nominee)\b/i.test(`${s?.eventTitle || ''}`);

/** Exchanges badge when both exchanges price the story; '' otherwise. */
export function exchangesBadge(s) {
  const ex = (Array.isArray(s?.exchanges) ? s.exchanges : []).filter((x) => x && Number.isFinite(x.yesPrice));
  if (ex.length < 2) return '';
  const k = ex.find((x) => x.source === 'kalshi') || ex[0], p = ex.find((x) => x.source === 'polymarket') || ex[1];
  const agree = s.agree || (Math.abs(k.yesPrice - p.yesPrice) < 0.05 ? 'agree' : 'disagree');
  const a = `${exchangeName(k.source).toUpperCase()} ${pct(k.yesPrice)}`, b = `${exchangeName(p.source).toUpperCase()} ${pct(p.yesPrice)}`;
  return agree === 'disagree'
    ? `<div class="bc-ex dis fit" data-drop="3"><b>EXCHANGES DISAGREE</b> · ${esc(a)} vs ${esc(b)}</div>`
    : `<div class="bc-ex fit" data-drop="3">${esc(a)} · ${esc(b)} · <b>both exchanges agree</b></div>`;
}

function bars(story) {
  const ms = (story.markets || []).slice(0, 4);
  if (ms.length < 2) return '';
  return `<div class="bc-bars" data-drop="2">${ms.map((m, i) => `<div class="bc-bar ${m.id === story.lead.id ? 'lead' : ''}" style="--c:${OUTCOME_COLORS[i % OUTCOME_COLORS.length]}" ${i >= 3 ? 'data-drop="1"' : ''}>
      <div class="bc-bar-top"><span class="bc-bar-name fit">${esc(marketLabel(m))}</span><span class="bc-bar-v">${esc(pct(m.yesPrice))}</span></div>
      <div class="bc-track"><u style="width:${Math.max(0.5, m.yesPrice * 100)}%"></u></div></div>`).join('')}</div>`;
}

/** The big move: today's move, else the week move, else the runner-up (multi-market), else nothing. */
function bigMove(s) {
  const m = s.lead, d = leadPts(s), w = leadPts(s, 'change1w');
  if (d) return { html: `<div class="bc-dl ${d > 0 ? 'up' : 'down'}"><span class="bc-d">${signed(d)}</span><span class="bc-dc fit">${Math.abs(d) === 1 ? 'POINT' : 'POINTS'} TODAY</span></div>`, usedWeek: false };
  if (w) return { html: `<div class="bc-dl ${w > 0 ? 'up' : 'down'}"><span class="bc-d">${signed(w)}</span><span class="bc-dc fit">${Math.abs(w) === 1 ? 'POINT' : 'POINTS'} THIS WEEK</span></div>`, usedWeek: true };
  const ru = (s.markets || []).filter((x) => x.id !== m.id).sort((a, b) => b.yesPrice - a.yesPrice)[0];
  if (ru) return { html: `<div class="bc-ru fit">Runner-up: ${esc(marketLabel(ru))} <b>${esc(pct(ru.yesPrice))}</b></div>`, usedWeek: false };
  return { html: '', usedWeek: false };
}

function meta(s, seg, now) {
  const m = s.lead;
  const ex = (s.sources?.length ? s.sources : [m.source]).map(exchangeName).join(' + ');
  return `<div class="meta bc-meta"><span class="fit meta-t"><b>${esc(ex)}</b> · updated ${esc(ago(m.updatedAt, now))} · <b>${esc(seg.id === 'movers' ? money(m.volume24h) : storyVolume(s))}</b> traded in 24 hrs</span>${s.thin ? '<span class="thin">THIN MARKET</span>' : ''}</div>`;
}
const newsLine = (s, now) => storyNewsHtml(s, now);
const electionNote = (s) => (isElection(s) ? '<div class="bc-note fit" data-drop="5">Market prices, not official results</div>' : '');

/** THEN vs NOW: "YESTERDAY 14%" dimmed -> "NOW 92%" counting up over ~2s, a huge glowing +78, FLIPPED when it crossed 50%. */
function swingCard(seg, now) {
  const s = seg.story, m = s.lead, sw = s.swing;
  const from = Number.isFinite(sw.from) ? sw.from : m.yesPrice - (m.change1d || 0);
  const to = Number.isFinite(sw.to) ? sw.to : m.yesPrice;
  // same number as the widget: a 24h swing IS the lead's change1d (so card, dial, chyron and ticker round the same value); a last-hour swing is to - from
  const wk = sw.window === '1w';   // THIS WEEK'S SWINGS: the 7-day move, not the lead's day move
  const d = (((!wk && sw.window !== '1h' && Number.isFinite(m.change1d)) ? ptsOf(m.change1d) : ptsOf(Number.isFinite(sw.delta) ? sw.delta : to - from)) || 0);
  const a = pctNum(from), b = pctNum(to);
  const counts = /^\d+$/.test(a) && /^\d+$/.test(b);          // '<1' / '>99' can't count: show them as text
  const title = sw.title || SWING_TITLES[sw.shape] || 'BIGGEST SWINGS';
  const lbl = outcomeSubtitle(s, m);
  return `<section class="card bigc bc-swing sw-${esc(sw.shape || 'swing')} ${d >= 0 ? 'sw-up' : 'sw-down'}" data-story="${esc(s.id)}">
    <div class="bc-h"><span class="bc-seg fit">${esc(title)}</span>${s.settling ? '<span class="bc-tag">SETTLING</span>' : ''}</div>
    <div class="bc-kick fit">${esc(categoryName(s.category).toUpperCase())} · ${esc(s.eventTitle || '')}</div>
    <h1 class="bc-head fit" data-fit-h>${esc(s.short || s.headline)}</h1>
    ${newsLine(s, now)}
    ${lbl ? `<div class="sw-who fit">${esc(lbl)}</div>` : ''}
    ${wk ? `<div class="sw-words fit">${esc(pointsText(d / 100, 'this week'))}</div>` : ''}
    <div class="sw">
      <div class="sw-then"><span class="sw-l">${esc(sw.thenLabel || (wk ? 'A WEEK AGO' : 'YESTERDAY'))}</span><span class="sw-tv">${esc(a)}<small>%</small></span></div>
      <div class="sw-arrow">▶</div>
      <div class="sw-now"><span class="sw-l">NOW</span><span class="sw-nv"${counts ? ` data-from="${a}" data-to="${b}"` : ''}>${esc(counts ? a : b)}</span><span class="sw-p">%</span></div>
      <div class="sw-dl"><span class="sw-d">${signed(d)}</span><span class="sw-dc">${Math.abs(d) === 1 ? 'POINT' : 'POINTS'}</span></div>
      ${sw.flipped ? '<div class="sw-flip">FLIPPED</div>' : ''}
    </div>
    ${exchangesBadge(s)}
    ${electionNote(s)}
    ${meta(s, seg, now)}
  </section>`;
}

export function segmentCard(seg, now = Date.now()) {
  const s = seg.story;
  if (!s?.lead) return '';
  if (seg.kind && VARIETY_TITLES[seg.kind]) return varietyCard(seg, now);   // 2026-11-05 variety segments
  if (s.swing && typeof s.swing === 'object') return swingCard(seg, now);
  const m = s.lead;
  const title = seg.id === 'desk' ? (seg.desk?.title || `${String(seg.desk?.id || '').toUpperCase()} DESK`) : TITLES[seg.id] || '';
  const n = Math.max(1, seg.count || 1), i = Math.min(n - 1, Math.max(0, seg.index || 0));
  const lbl = outcomeSubtitle(s, m);
  const mv = bigMove(s);
  const wk = leadPts(s, 'change1w');
  const week = !mv.usedWeek && wk ? pointsText(m.change1w, 'this week') : '';
  const closes = seg.id === 'week' && m.closesAt ? until(m.closesAt, now) : '';
  const deskCls = seg.id === 'desk' && seg.desk ? ` desk-${esc(seg.desk.id)}` : '';
  return `<section class="card bigc bc-${esc(seg.id)}${deskCls}" data-story="${esc(s.id)}">
    <div class="bc-h"><span class="bc-seg fit">${esc(title)} · #${i + 1} OF ${n}</span></div>
    <div class="bc-kick fit">${s.flash ? '<b class="bc-news">IN THE NEWS</b> · ' : ''}${esc(categoryName(s.category).toUpperCase())} · ${esc(s.eventTitle || '')}</div>
    <h1 class="bc-head fit" data-fit-h>${esc(s.short || s.headline)}</h1>
    ${newsLine(s, now)}
    <div class="bc-num">
      <div class="bc-n"><span class="bc-v">${esc(pctNum(m.yesPrice))}</span><span class="bc-p">%</span></div>
      <div class="bc-side">
        ${lbl ? `<div class="bc-lbl fit" data-fit-h>${esc(lbl)}</div>` : ''}
        ${mv.html}
        ${week ? `<div class="bc-wk fit" data-drop="3">${esc(week)}</div>` : ''}
        ${closes ? `<div class="bc-when fit">Resolves ${esc(closes)}</div>` : ''}
      </div>
    </div>
    ${exchangesBadge(s)}
    ${bars(s)}
    ${electionNote(s)}
    ${meta(s, seg, now)}
  </section>`;
}

/** STORY OF THE DAY: one multi-market card. Framed "IN THE NEWS", never "because of". */
export function sotdCard(sotd, state, now = Date.now()) {
  if (!sotd?.title || !Array.isArray(sotd.markets) || !sotd.markets.length) return '';
  const rows = sotd.markets.filter((x) => x && Number.isFinite(x.yesPrice))
    .map((x) => ({ ...x, pts: ptsOf(x.change1d) || 0 })).sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  const top = rows[0];
  const sources = [...new Set(rows.map((x) => x.source).filter(Boolean))].map(exchangeName).join(' + ') || 'Prediction markets';
  const n = sotd.markets.length;
  const elect = rows.some((x) => /\b(win|wins|race|mayor|senate|governor|house|election|nominee)\b/i.test(x.label || ''));
  return `<section class="card bigc bc-sotd" ${sotd.leadStoryId ? `data-story="${esc(sotd.leadStoryId)}"` : ''}>
    <div class="bc-h"><span class="bc-seg fit">STORY OF THE DAY</span></div>
    <div class="bc-kick fit">WHAT THE WIRES ARE REPORTING · MARKETS THE STORY IS ABOUT</div>
    <h1 class="bc-head sotd-t fit" data-fit-h>${esc(sotd.title)}<span class="sotd-n"> · ${n} ${n === 1 ? 'market' : 'markets'} moved</span></h1>
    ${newsLineHtml(sotd.headline ? { title: sotd.headline, source: sotd.credit || 'The wires', publishedAt: sotd.newsAt || sotd.publishedAt } : null, now, '')}
    <div class="sotd-board">${rows.slice(0, 7).map((x, i) => `<div class="sotd-r ${x === top ? 'hi' : ''}" ${x.storyId ? `data-story="${esc(x.storyId)}"` : ''} ${i >= 5 ? `data-drop="${7 - i}"` : ''}>
        <span class="sotd-l fit">${esc(x.label)}</span><span class="sotd-v">${esc(pct(x.yesPrice))}</span><span class="sotd-m ${moveCls(x.change1d)}">${x.pts ? esc(signed(x.pts)) : '0'}</span></div>`).join('')}</div>
    <div class="sotd-key fit" data-drop="3">Today's move in points · markets the story is about, not a cause and effect</div>
    ${elect ? '<div class="bc-note fit" data-drop="4">Market prices, not official results</div>' : ''}
    <div class="meta bc-meta"><span class="fit meta-t"><b>${esc(sources)}</b> · updated ${esc(ago(state?.generatedAt, now))}</span></div>
  </section>`;
}

/** COUNTDOWN DESK: the next 3 scheduled decisions on a timeline, each with its market's live odds. */
export function countdownCard(items, now = Date.now(), newsFor = null) {
  const list = (items || []).filter((c) => c?.at && Date.parse(c.at) > now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 3);
  if (!list.length) return '';
  return `<section class="card bigc bc-countdown" ${list[0].storyId ? `data-story="${esc(list[0].storyId)}"` : ''}>
    <div class="bc-h"><span class="bc-seg fit">COUNTDOWN DESK</span></div>
    <div class="bc-kick fit">${list.length === 1 ? 'THE NEXT SCHEDULED DECISION' : `THE NEXT ${list.length} SCHEDULED DECISIONS`} · LIVE MARKET ODDS</div>
    <div class="cd-tl">${list.map((c, i) => {
      const d = ptsOf(c.change1d);
      const nw = newsOf(c) || (newsFor && c.storyId ? newsOf({ news: newsFor(c.storyId) }) : null);
      return `<div class="cd-i ${i === 0 ? 'first' : ''}" ${c.storyId ? `data-story="${esc(c.storyId)}"` : ''}>
        <div class="cd-when"><span class="cd-n" data-count-at="${esc(c.at)}">IN ${esc(countText(c.at, now))}</span><span class="cd-at fit">${esc(etShort(c.at))} ET</span></div>
        <div class="cd-b"><div class="cd-t fit" data-fit-h>${esc(c.title)}</div>
          ${c.label ? `<div class="cd-o"><span class="cd-ol fit">${esc(c.eventTitle && c.eventTitle !== c.title ? `${c.eventTitle}: ${c.label}` : c.label)}</span><b class="cd-v">${esc(pct(c.yesPrice))}</b>${d ? `<span class="cd-m ${d > 0 ? 'up' : 'down'}">${esc(signed(d))} today</span>` : ''}</div>` : ''}
          ${nw ? `<div class="cd-nw" ${i ? 'data-drop="2"' : ''}><b>${esc(newsKicker(nw, undefined, true))}</b><span class="cd-nt fit" data-fit-h>${esc(nw.title)}</span><span class="cd-ns fit${newsOld(nw, now) ? ' old' : ''}">${esc(newsMeta(nw, now))}</span></div>` : ''}
        </div></div>`;
    }).join('')}</div>
    <div class="meta bc-meta"><span class="fit meta-t"><b>${esc([...new Set(list.map((c) => c.source).filter(Boolean))].map(exchangeName).join(' + ') || 'Prediction markets')}</b> · odds are market prices, not forecasts of record</span></div>
  </section>`;
}

/** MARKETS: one stock / index / bond yield / commodity. The price and its day move are facts (delayed quotes); the paired prediction-market rows
 *  below are odds and carry their own source, size and thin-market flag. seg = {id: 'markets', story: finStory(fi)}. */
export function marketsCard(seg, now = Date.now()) {
  const fi = seg.story?.fin;
  if (!fi) return '';
  const d = finDir(fi), cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  const abs = changeAbs(fi);
  const sym = /^[\^=]|[=.]/.test(fi.symbol) || fi.kind !== 'stock' ? '' : ` · ${fi.symbol}`;
  const mw = fi.market && { open: 'MARKET OPEN', closed: 'MARKET CLOSED', pre: 'BEFORE THE OPEN', post: 'AFTER HOURS' }[fi.market];
  const nw = newsOf(seg.story);
  const prevTxt = Number.isFinite(fi.prev) ? `${fi.market === 'open' || !fi.market ? 'Yesterday\'s close' : 'Previous close'} ${fmtVal(fi, fi.prev)}` : '';
  const rows = fi.pairs.map((m) => {
    const n = ptsOf(m.change1d) || 0;
    return `<div class="fin-r" ${m.storyId ? `data-story="${esc(m.storyId)}"` : ''}>
      <span class="fin-l fit">${esc(m.label)}</span>
      <span class="fin-tr"><u style="width:${Math.max(1, m.yesPrice * 100)}%"></u></span>
      <span class="fin-p">${esc(pct(m.yesPrice))}</span>
      <span class="fin-d ${n > 0 ? 'up' : n < 0 ? 'down' : 'flat'}">${n ? esc(`${n > 0 ? '▲' : '▼'} ${Math.abs(n)}`) : '0'}</span>
      ${m.thin ? '<i class="thin sm">THIN</i>' : ''}</div>`;
  }).join('');
  const ex = [...new Set(fi.pairs.map((m) => exchangeName(m.source)))].join(' + ');
  const vol = fi.pairs.reduce((a, m) => a + (m.volume24h || 0), 0);
  return `<section class="card bigc bc-markets fin-${cls}" data-story="${esc(fi.id)}">
    <div class="bc-h"><span class="bc-seg fit">MARKETS · ${esc(finKindLabel(fi))}</span>${fi.delayed ? '<span class="bc-tag">PRICES DELAYED</span>' : ''}</div>
    <div class="bc-kick fit">${esc(fi.name.toUpperCase())}${esc(sym)}${mw ? ` · ${esc(mw)}` : ''}</div>
    <h1 class="bc-head fit" data-fit-h>${esc(finHeadline(fi))}</h1>
    ${newsLineHtml(nw, now)}
    <div class="fin-num">
      <div class="fin-px"><span class="fin-v fit">${esc(fmtVal(fi, fi.price))}</span>${fi.per ? `<span class="fin-per">${esc(fi.per)}</span>` : ''}</div>
      <div class="fin-side">
        <div class="fin-mv ${cls}"><span class="fin-ar">${d > 0 ? '▲' : d < 0 ? '▼' : '●'}</span><span class="fin-mvn">${esc(d ? moveSize(fi).replace(/\s.*$/, '').replace(/%$/, '') : '0')}</span><span class="fin-mvu">${esc(d ? (fi.kind === 'yield' ? 'POINTS' : '%') : '')}</span></div>
        <div class="fin-mvt fit">${esc(moveWords(fi))}${abs && fi.kind !== 'yield' ? esc(` · ${abs}`) : ''}</div>
        ${prevTxt ? `<div class="fin-prev fit" data-drop="3">${esc(prevTxt)}</div>` : ''}
      </div>
    </div>
    ${rows ? `<div class="fin-odds" data-drop="2"><div class="fin-oh fit">WHAT THE MARKETS ARE PRICING · ODDS TODAY, POINTS CHANGED</div>${rows}</div>` : ''}
    <div class="meta bc-meta fin-meta"><span class="fit meta-t"><b>${esc(fi.delayed ? 'Prices delayed' : 'Prices')}</b>${fi.source ? ` · ${esc(fi.source)}` : ''} · updated ${esc(ago(fi.updated, now))}</span></div>
    ${rows ? `<div class="meta bc-meta fin-meta2" data-drop="4"><span class="fit meta-t"><b>${esc(ex)}</b> · odds, not facts${vol > 0 ? ` · ${esc(money(vol))} traded in 24 hrs` : ''}</span></div>` : ''}
  </section>`;
}

// ---- variety segments (2026-11-05): the same data shown another way. seg = {id: kind, kind: 'tossup'|'swings'|'steady'|'disagree'|'package', story, item?, pkg?}.
// Each is its own overlay segment (overlay.js: header, sub line, full-screen layout); seg.kind picks the card here.
const durText = (d) => (d <= 1 ? 'a day' : d === 7 ? 'a week' : d === 14 ? 'two weeks' : d === 21 ? 'three weeks' : d >= 28 && d <= 31 ? 'a month' : `${d} days`);
const vHead = (s, title, now, tag = '') => `<div class="bc-h"><span class="bc-seg fit">${esc(title)}</span>${tag}${s.settling ? '<span class="bc-tag">SETTLING</span>' : ''}</div>
    <div class="bc-kick fit">${s.flash ? '<b class="bc-news">IN THE NEWS</b> · ' : ''}${esc(categoryName(s.category).toUpperCase())} · ${esc(s.eventTitle || '')}</div>
    <h1 class="bc-head fit" data-fit-h>${esc(s.short || s.headline)}</h1>
    ${newsLine(s, now)}`;
const sideLabel = (m, fallback) => { const l = String(marketLabel(m) || '').trim(); return !l || BARE_NUM.test(l) ? fallback : l; };

/** TOSS-UP: a big % near 50 and "TOO CLOSE TO CALL", with the two sides head to head. */
function tossupCard(seg, now) {
  const s = seg.story, m = s.lead, p = m.yesPrice;
  const others = (s.markets || []).filter((x) => x.id !== m.id && Number.isFinite(x.yesPrice)).sort((a, b) => b.yesPrice - a.yesPrice);
  // head to head only when the runner-up is close; otherwise a toss-up is about this side vs even (a 44% leader 29 points clear of #2 is not 'too close' against #2)
  const multi = (s.markets || []).length > 1 && others.length > 0 && Math.abs(p - others[0].yesPrice) <= 0.10;
  const aName = multi ? sideLabel(m, 'Leading side') : 'Chance it happens', bName = multi ? sideLabel(others[0], 'Runner-up') : 'Chance it does not';
  const bp = multi ? others[0].yesPrice : 1 - p;
  const gap = Math.abs(Math.round(p * 100) - Math.round(bp * 100));
  const d = leadPts(s);
  return `<section class="card bigc bc-var bc-tossup" data-story="${esc(s.id)}">
    ${vHead(s, VARIETY_TITLES.tossup, now)}
    <div class="bc-num">
      <div class="bc-n"><span class="bc-v">${esc(pctNum(p))}</span><span class="bc-p">%</span></div>
      <div class="bc-side">
        <div class="tu-ctc fit">TOO CLOSE TO CALL</div>
        <div class="tu-gap fit">${multi ? (gap === 0 ? `Dead even with ${esc(bName)}` : `${gap} ${gap === 1 ? 'point' : 'points'} ${p > bp ? 'ahead of' : 'behind'} ${esc(bName)}`) : (Math.round(Math.abs(p - 0.5) * 100) === 0 ? 'Dead even' : `${Math.round(Math.abs(p - 0.5) * 100)} ${Math.round(Math.abs(p - 0.5) * 100) === 1 ? 'point' : 'points'} from even`)}</div>
        ${d ? `<div class="bc-wk fit" data-drop="3">${esc(pointsText(m.change1d, 'today'))}</div>` : ''}
      </div>
    </div>
    <div class="tu-vs" data-drop="2">
      <div class="tu-names"><span class="tu-a fit">${esc(aName)} <b>${esc(pct(p))}</b></span><span class="tu-b fit">${esc(bName)} <b>${esc(pct(bp))}</b></span></div>
      <div class="tu-bar"><u class="tu-ua" style="width:${(p / Math.max(0.01, p + bp) * 100).toFixed(1)}%"></u><u class="tu-ub"></u></div>
    </div>
    ${exchangesBadge(s)}
    ${electionNote(s)}
    ${meta(s, { id: 'tossup' }, now)}
  </section>`;
}

/** STEADY FAVORITE: the calm card: "steady at 82% for two weeks" with the range it stayed in. */
function steadyCard(seg, now) {
  const s = seg.story, m = s.lead, p = m.yesPrice, it = seg.item || {}, st = it.steady && typeof it.steady === 'object' ? it.steady : {};
  const days = Math.max(1, Math.round(Number(st.days ?? it.days) || 7));
  let lo = Number(st.lo ?? it.lo), hi = Number(st.hi ?? it.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    const cut = Date.now() / 1000 - days * 86400, h = (s.history || []).filter((x) => x && Number.isFinite(x.p) && x.t >= cut);
    if (h.length >= 3) { lo = Math.min(...h.map((x) => x.p)); hi = Math.max(...h.map((x) => x.p)); } else { lo = NaN; hi = NaN; }
  }
  const range = Number.isFinite(lo) && Number.isFinite(hi);
  if (range) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
  const lbl = outcomeSubtitle(s, m);
  return `<section class="card bigc bc-var bc-steady" data-story="${esc(s.id)}">
    ${vHead(s, VARIETY_TITLES.steady, now)}
    <div class="bc-num">
      <div class="bc-n"><span class="bc-v">${esc(pctNum(p))}</span><span class="bc-p">%</span></div>
      <div class="bc-side">
        ${lbl ? `<div class="bc-lbl fit" data-fit-h>${esc(lbl)}</div>` : ''}
        <div class="st-words fit" data-fit-h>steady at ${esc(pct(p))} for ${esc(durText(days))}</div>
        ${range ? `<div class="bc-wk fit" data-drop="3">Range over that time: ${esc(pct(lo))} to ${esc(pct(hi))}</div>` : ''}
      </div>
    </div>
    <div class="st-meter" aria-hidden="true"><div class="st-track"><u style="width:${Math.max(0.5, p * 100)}%"></u>${range ? `<i style="left:${(lo * 100).toFixed(1)}%;width:${Math.max(1.2, (hi - lo) * 100).toFixed(1)}%"></i>` : ''}<b style="left:${(p * 100).toFixed(1)}%"></b></div>
      <div class="st-scale"><span>0%</span><span>50%</span><span>100%</span></div></div>
    ${bars(s)}
    ${electionNote(s)}
    ${meta(s, { id: 'steady' }, now)}
  </section>`;
}

/** EXCHANGES DISAGREE: Kalshi and Polymarket side by side, with the gap between them. */
function disagreeCard(seg, now) {
  const s = seg.story, it = seg.item || {};
  const src = Array.isArray(it.exchanges) && it.exchanges.length > 1 ? it.exchanges : s.exchanges;
  const ex = (Array.isArray(src) ? src : []).filter((x) => x && Number.isFinite(x.yesPrice));
  const k = ex.find((x) => x.source === 'kalshi') || ex[0], pm = ex.find((x) => x.source === 'polymarket') || ex.find((x) => x !== k) || ex[1];
  if (!k || !pm) return '';
  const gap = Math.abs(Math.round(k.yesPrice * 100) - Math.round(pm.yesPrice * 100));
  const hi = k.yesPrice >= pm.yesPrice ? k : pm, lo = hi === k ? pm : k;
  const lbl = outcomeSubtitle(s, s.lead);
  const col = (x, cls) => `<div class="ex-c ${cls} ${x === hi && gap ? 'hi' : ''}"><span class="ex-n fit">${esc(exchangeName(x.source).toUpperCase())}</span>
      <span class="ex-v"><b>${esc(pctNum(x.yesPrice))}</b><small>%</small></span>
      <div class="ex-tr"><u style="width:${Math.max(0.5, x.yesPrice * 100)}%"></u></div>
      <span class="ex-s fit" data-drop="3">${Number.isFinite(x.volume24h) ? `${esc(money(x.volume24h))} traded in 24 hrs` : esc(x.updatedAt ? `updated ${ago(x.updatedAt, now)}` : '')}</span></div>`;
  return `<section class="card bigc bc-var bc-disagree" data-story="${esc(s.id)}">
    ${vHead(s, VARIETY_TITLES.disagree, now)}
    ${lbl ? `<div class="sw-who fit" data-drop="4">${esc(lbl)}</div>` : ''}
    <div class="ex">
      ${col(k, 'k')}
      <div class="ex-gap"><span class="ex-gn">${gap}</span><span class="ex-gl">${gap === 1 ? 'POINT' : 'POINTS'}<br>APART</span></div>
      ${col(pm, 'p')}
    </div>
    <div class="ex-words fit" data-drop="2">${gap ? `${esc(exchangeName(hi.source))} prices it ${gap} ${gap === 1 ? 'point' : 'points'} higher than ${esc(exchangeName(lo.source))}` : 'Both exchanges price it the same'}</div>
    ${electionNote(s)}
    ${meta(s, { id: 'disagree' }, now)}
  </section>`;
}

/** STORY BEHIND THE ODDS: a headline and its credit, then 2 to 4 markets it touches with their odds and day move. Never "because of". */
export function packageCard(seg, now = Date.now()) {
  const pkg = seg.pkg || {}, s = seg.story;
  const rows = (pkg.markets || []).filter((x) => x && Number.isFinite(x.yesPrice)).slice(0, 4).map((x) => ({ ...x, pts: ptsOf(x.change1d) || 0 }));
  const headline = String(pkg.headline || '').trim();
  if (!headline || rows.length < 2) return '';
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const title = String(pkg.title || '').trim(), sameTitle = !title || norm(title) === norm(headline);
  const nw = { title: headline, source: pkg.credit || 'The wires', publishedAt: pkg.newsAt || pkg.publishedAt };
  const top = [...rows].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))[0];
  const sources = [...new Set(rows.map((x) => x.source).filter(Boolean))].map(exchangeName).join(' + ') || 'Prediction markets';
  const vol = rows.reduce((a, x) => a + (Number.isFinite(x.volume24h) ? x.volume24h : 0), 0);
  const elect = rows.some((x) => /\b(win|wins|race|mayor|senate|governor|house|election|nominee)\b/i.test(x.label || ''));
  return `<section class="card bigc bc-var bc-pkg" data-story="${esc(s.id)}">
    <div class="bc-h"><span class="bc-seg fit">${esc(VARIETY_TITLES.package)}</span>${pkg.thin ? '<span class="bc-tag">THIN MARKETS</span>' : ''}</div>
    <div class="bc-kick fit">WHAT THE WIRES ARE REPORTING · ${rows.length} MARKETS IT TOUCHES</div>
    <h1 class="bc-head fit" data-fit-h>${esc(sameTitle ? headline : title)}</h1>
    ${sameTitle ? `<div class="pkg-credit fit">${esc(newsMeta(nw, now).toUpperCase())}</div>` : newsLineHtml(nw, now, '')}
    <div class="sotd-board pkg-board">${rows.map((x, i) => `<div class="sotd-r ${x === top ? 'hi' : ''}" ${x.storyId ? `data-story="${esc(x.storyId)}"` : ''} ${i >= 3 ? 'data-drop="2"' : ''}>
        <span class="sotd-l fit">${esc(x.label)}</span><span class="sotd-v">${esc(pct(x.yesPrice))}</span><span class="sotd-m ${moveCls(x.change1d)}">${x.pts ? esc(signed(x.pts)) : '0'}</span></div>`).join('')}</div>
    <div class="sotd-key fit" data-drop="3">Today's move in points · markets the story is about, not a cause and effect</div>
    ${elect ? '<div class="bc-note fit" data-drop="4">Market prices, not official results</div>' : ''}
    <div class="meta bc-meta"><span class="fit meta-t"><b>${esc(sources)}</b> · updated ${esc(ago(s.lead?.updatedAt, now))}${vol > 0 ? ` · <b>${esc(money(vol))}</b> traded in 24 hrs` : ''}</span></div>
  </section>`;
}

function varietyCard(seg, now) {
  const s = seg.story;
  switch (seg.kind) {
    case 'tossup': return tossupCard(seg, now);
    case 'steady': return steadyCard(seg, now);
    case 'disagree': return disagreeCard(seg, now);
    case 'package': return packageCard(seg, now);
    case 'swings': {
      const m = s.lead, w = Number.isFinite(m.change1w) ? m.change1w : 0, it = seg.item?.week || seg.item?.swing || {};
      const delta = Number.isFinite(it.delta) ? it.delta : w, to = Number.isFinite(it.to) ? it.to : m.yesPrice, from = Number.isFinite(it.from) ? it.from : to - delta;
      const sw = { from, to, delta, window: '1w', shape: 'week', title: VARIETY_TITLES.swings, thenLabel: 'A WEEK AGO', flipped: (from < 0.5) !== (to < 0.5) };
      return swingCard({ ...seg, story: { ...s, swing: sw } }, now);
    }
    default: return '';
  }
}
