// HTML builders for the segment panels. Pure functions of (data, now) → HTML string.
import { outcomeSubtitle } from './cards.js';
import { esc, pct, pctNum, moveText, moveShort, moveCls, money, exchangeName, ago, until, marketLabel, categoryName, OUTCOME_COLORS, storyVolume, newsOf, newsLineHtml, newsOutlet, newsMeta } from './util.js';

const KIND = { mover: 'ON THE MOVE', favorite: 'THE FAVORITE', closing: 'RESOLVING SOON', news: 'IN THE NEWS' };

/** Footer meta: exchange · updated · $vol · THIN MARKET. Always shown (editorial rule). */
export function metaLine(story, now, cls = '') {
  const m = story.lead;
  const ex = (story.sources?.length ? story.sources : [m.source]).map(exchangeName).join(' + ');
  return `<div class="meta ${cls}"><span class="fit meta-t"><b>${esc(ex)}</b> · updated ${esc(ago(m.updatedAt, now))} · <b>${esc(storyVolume(story))}</b> traded in 24 hrs</span>${story.thin ? '<span class="thin">THIN MARKET</span>' : ''}</div>`;
}

/** Strip-card outlet: the first outlet only ("The Guardian and CBS News" -> "The Guardian"): the strip card is too narrow for a list. */
const miniOutlet = (nw) => newsOutlet(nw).split(/\s+(?:and|&)\s+|\s*[,/|]\s*/i)[0].trim() || newsOutlet(nw);

function bigNumber(story, cls = '') {
  const m = story.lead;
  const lbl = outcomeSubtitle(story, m) || 'Chance';
  return `<div class="big ${cls}">
    <div class="big-n"><span class="big-v">${esc(pctNum(m.yesPrice))}</span><span class="big-p">%</span></div>
    <div class="big-side">
      <div class="big-lbl fit">${esc(lbl)}</div>
      <div class="big-mv ${moveCls(m.change1d)} fit">${esc(moveText(m.change1d) || 'new on the board')}</div>
      ${m.change1w != null ? `<div class="big-wk fit">${esc(moveText(m.change1w, 'this week'))}</div>` : ''}
    </div>
  </div>`;
}

export function outcomeBars(story, { max = 5, dropFrom = 4 } = {}) {
  const ms = (story.markets || []).slice(0, max);
  if (ms.length < 2) {
    const p = story.lead.yesPrice;
    return `<div class="bars single"><div class="bar-row">
      <div class="bar-top"><span class="bar-name fit">Chance it happens</span><span class="bar-v">${esc(pct(p))}</span></div>
      <div class="bar-track"><u style="width:${Math.max(0.5, p * 100)}%;--c:${OUTCOME_COLORS[0]}"></u></div></div></div>`;
  }
  return `<div class="bars">${ms.map((m, i) => `<div class="bar-row ${m.id === story.lead.id ? 'lead' : ''}" ${i + 1 >= dropFrom ? 'data-drop="3"' : ''} style="--c:${OUTCOME_COLORS[i % OUTCOME_COLORS.length]}">
      <div class="bar-top"><span class="bar-name fit">${esc(marketLabel(m))}</span><span class="bar-mv ${moveCls(m.change1d)}">${esc(moveShort(m.change1d))}</span><span class="bar-v">${esc(pct(m.yesPrice))}</span></div>
      <div class="bar-track"><u style="width:${Math.max(0.5, m.yesPrice * 100)}%"></u></div></div>`).join('')}</div>`;
}

export function sparkline(story, now, attrs = '') {
  const h = (story.history || []).filter((x) => x && Number.isFinite(x.p));
  if (h.length < 3) return '';
  const W = 300, H = 60, pad = 3;
  const t0 = h[0].t, t1 = h[h.length - 1].t || t0 + 1;
  let lo = Math.min(...h.map((x) => x.p)), hi = Math.max(...h.map((x) => x.p));
  if (hi - lo < 0.06) { const c = (hi + lo) / 2; lo = Math.max(0, c - 0.03); hi = Math.min(1, c + 0.03); }
  const X = (t) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad * 2);
  const Y = (p) => H - pad - ((p - lo) / Math.max(1e-6, hi - lo)) * (H - pad * 2);
  const pts = h.map((x) => `${X(x.t).toFixed(1)},${Y(x.p).toFixed(1)}`).join(' ');
  const last = h[h.length - 1];
  const days = Math.max(1, Math.round((t1 - t0) / 86400));
  const span = days >= 2 ? `${days} days ago` : '24 hrs ago';
  return `<div class="spark" ${attrs}>
    <div class="spark-h"><span class="fit">TREND · ${esc(span.toUpperCase())} ${esc(pct(h[0].p))}</span><span>NOW ${esc(pct(last.p))}</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="sg-${esc(story.id).replace(/[^a-z0-9]/gi, '')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2bd6" stop-opacity=".45"/><stop offset="1" stop-color="#ff2bd6" stop-opacity="0"/></linearGradient></defs>
      <polygon points="${pad},${H} ${pts} ${(W - pad).toFixed(1)},${H}" fill="url(#sg-${esc(story.id).replace(/[^a-z0-9]/gi, '')})"/>
      <polyline points="${pts}" fill="none" stroke="#00f0ff" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.p).toFixed(1)}" r="3.5" fill="#fff"/>
    </svg></div>`;
}

/** The standard IN THE NEWS block (shared markup with the full-screen cards); '' when the story has no news item. */
export function newsBlock(story, now, { drop = 5 } = {}) {
  return newsLineHtml(newsOf(story), now, `data-drop="${drop}"`);
}

function kicker(story, extra = '', { withEvent = true } = {}) {
  return `<div class="kick"><span class="kick-tag${story.flash ? ' news' : ''}">${esc(story.flash ? 'IN THE NEWS' : KIND[story.kind] || 'MARKETS')}</span><span class="kick-cat fit">${esc(categoryName(story.category).toUpperCase())}${withEvent ? ` · ${esc(story.eventTitle)}` : ''}</span>${extra}</div>`;
}

/** TOP STORIES: lead card (left column). */
export function leadCard(story, now) {
  return `<section class="card lead-card" data-story="${esc(story.id)}">
    ${kicker(story)}
    <h1 class="headline fit" data-fit-h>${esc(story.short || story.headline)}</h1>
    ${newsBlock(story, now, { drop: 6 })}
    ${story.dek ? `<p class="dek fit" data-fit-h data-drop="4">${esc(story.dek)}</p>` : ''}
    ${bigNumber(story)}
    ${outcomeBars(story)}
    ${sparkline(story, now, 'data-drop="2"')}
    ${metaLine(story, now)}
  </section>`;
}

/** TOP STORIES: secondary card (bottom strip). */
export function miniCard(story, now, rank) {
  const m = story.lead, nw = newsOf(story);
  return `<article class="mini" data-story="${esc(story.id)}" style="--i:${rank}">
    <div class="mini-top"><span class="mini-rk">${story.boardRank || rank + 1}</span><span class="mini-cat fit">${esc(categoryName(story.category).toUpperCase())}</span><span class="mini-v">${esc(pct(m.yesPrice))}</span></div>
    <div class="mini-h fit" data-fit-h>${esc(story.short || story.headline)}</div>
    ${nw ? `<div class="mini-nw" data-opt-parent><b>${esc(miniOutlet(nw).toUpperCase())}</b><span data-opt> · ${esc(nw.title)}</span><i>${nw.publishedAt ? ` · ${esc(ago(nw.publishedAt, now))}` : ''}</i></div>` : ''}
    <div class="mini-meta"><span class="mini-mv ${moveCls(m.change1d)}">${esc(moveShort(m.change1d))}</span><span class="fit"><b>${esc(exchangeName(m.source))}</b> · ${esc(ago(m.updatedAt, now))} · ${esc(money(m.volume24h))}/24h</span>${story.thin ? '<span class="thin sm">THIN</span>' : ''}</div>
  </article>`;
}

/** STORY FOCUS: compact info panel; the 3D visual is the star. */
export function focusCard(story, now, i, n) {
  return `<section class="card focus-card">
    ${kicker(story, `<span class="kick-n">${i + 1} OF ${n}</span>`, { withEvent: false })}
    <h1 class="headline sm fit" data-fit-h>${esc(story.short || story.headline)}</h1>
    ${newsBlock(story, now, { drop: 6 })}
    ${bigNumber(story, 'sm')}
    ${outcomeBars(story, { max: 4, dropFrom: 3 })}
    ${story.dek ? `<p class="dek fit" data-fit-h data-drop="2">${esc(story.dek)}</p>` : ''}
    ${metaLine(story, now)}
  </section>`;
}

/** BIGGEST MOVERS board. movers: Market[]; storiesByEvent for categories. */
export function moversBoard(movers, now, updatedAt) {
  const rows = movers.slice(0, 8);
  return `<section class="card board movers-board">
    <div class="board-h"><span class="board-t">BIGGEST MOVERS</span><span class="board-s fit">Largest 24-hour swings in market odds</span></div>
    <div class="rows">${rows.map((m, i) => `<div class="row" data-story="${esc(m.storyId || m.eventId || '')}" ${i >= 5 ? `data-drop="${i >= 6 ? 1 : 2}"` : ''}>
      <div class="row-mv ${moveCls(m.change1d)}"><span>${esc(moveShort(m.change1d))}</span><small>PTS</small></div>
      <div class="row-main">
        <div class="row-name fit" data-fit-h>${esc(m.label != null ? (m.context ? `${m.label}: ${m.context}` : m.label) : m.outcome ? `${m.outcome}: ${m.eventTitle}` : m.eventTitle || m.title)}</div>
        <div class="row-meta fit"><b>${esc(exchangeName(m.source))}</b> · ${esc(ago(m.updatedAt, now))} · ${esc(money(m.volume24h))} traded in 24 hrs</div>
      </div>
      <div class="row-v">${esc(pct(m.yesPrice))}${(m.thin ?? m.volume24h < 25000) ? '<span class="thin sm">THIN</span>' : ''}</div>
    </div>`).join('')}</div>
    <div class="board-f fit">Moves are changes in market prices, not results. Updated ${esc(ago(updatedAt, now))}.</div>
  </section>`;
}

/** THIS WEEK board: stories resolving within 7 days. */
export function weekBoard(closing, now, updatedAt) {
  const rows = closing.slice(0, 6);
  return `<section class="card board week-board">
    <div class="board-h"><span class="board-t">THIS WEEK</span><span class="board-s fit">Markets that resolve within seven days</span></div>
    <div class="rows">${rows.map((s, i) => `<div class="row wk" data-story="${esc(s.id)}" ${i >= 4 ? `data-drop="${i >= 5 ? 1 : 2}"` : ''}>
      <div class="row-when"><span class="fit">${esc(until(s.lead.closesAt, now).replace(/^in /, ''))}</span><small>TO GO</small></div>
      <div class="row-main">
        <div class="row-name fit" data-fit-h>${esc(s.short || s.headline)}</div>
        <div class="row-meta fit"><b>${esc(exchangeName(s.lead.source))}</b> · ${esc(ago(s.lead.updatedAt, now))} · ${esc(money(s.lead.volume24h))} traded in 24 hrs</div>
      </div>
      <div class="row-v">${esc(pct(s.lead.yesPrice))}${s.thin ? '<span class="thin sm">THIN</span>' : ''}</div>
    </div>`).join('')}</div>
    <div class="board-f fit">Market prices until the official result is in. Updated ${esc(ago(updatedAt, now))}.</div>
  </section>`;
}

const DESK_SUB = {
  economy: 'Rates, prices and money: the odds right now',
  sports: 'Games and gaming in the headlines: the odds right now',
  tech: 'AI, space and science: the odds right now',
  world: 'Leaders and elections abroad: the odds right now',
  culture: 'Awards, charts, screens and skies: the odds right now',
  politics: 'Washington and the courts: the odds right now',
};

/** DESK board: one category desk's stories; the row on in 3D is highlighted. */
export function deskBoard(desk, on, now, updatedAt) {
  const rows = desk.stories.slice(0, 6);
  return `<section class="card board desk-board desk-${esc(desk.id)}">
    <div class="board-h"><span class="board-t fit">${esc(desk.title || `${desk.id.toUpperCase()} DESK`)}</span><span class="board-s fit">${esc(DESK_SUB[desk.id] || 'The odds right now')}</span></div>
    <div class="rows">${rows.map((s, i) => {
      const m = s.lead;
      const ex = (s.sources?.length ? s.sources : [m.source]).map(exchangeName).join(' + ');
      return `<div class="row dk${i === on ? ' on' : ''}" data-story="${esc(s.id)}" ${i >= 4 && i !== on ? `data-drop="${i >= 5 ? 1 : 2}"` : ''}>
      <div class="row-mv ${moveCls(m.change1d)}"><span>${esc(moveShort(m.change1d) || 'NEW')}</span><small>${m.change1d == null ? '&nbsp;' : 'PTS'}</small></div>
      <div class="row-main">
        <div class="row-name fit" data-fit-h>${esc(s.short || s.headline)}</div>
        <div class="row-meta fit"><b>${esc(ex)}</b> · ${esc(ago(m.updatedAt, now))} · ${esc(storyVolume(s))} traded in 24 hrs</div>
      </div>
      <div class="row-v">${esc(pct(m.yesPrice))}${s.thin ? '<span class="thin sm">THIN</span>' : ''}</div>
    </div>`;
    }).join('')}</div>
    <div class="board-f fit">Market prices, not results. Updated ${esc(ago(updatedAt, now))}.</div>
  </section>`;
}

export function standbyCard() {
  return `<section class="card standby"><div class="board-t">PNN</div><div class="headline sm fit" data-fit-h>Checking the markets. The broadcast starts as soon as fresh prices arrive.</div></section>`;
}
