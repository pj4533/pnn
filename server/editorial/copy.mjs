// PNN copy templates (DECISIONS D3: deterministic templates, no LLM yet).
//
// Exports: pct(p), pts(delta, when), money(n), marketLine(m), storyHeadline(story), storyDek(story),
//          alertCopy(market, from, to, minutes) -> {headline, line}, newsQuery(story),
//          clauseFor(market), subjectFor(market), eventPhrase(eventTitle)
//
// Editorial rules enforced here (CLAUDE.md):
//   - State the data: subject + number + change. Every line reads as a probability ("chance", "odds" or a
//     percentage tied to the subject). No "Bettors ..." template (user directive 2026-11-04). PNN never says
//     something "will" happen; a "will" may only appear inside a quoted market question.
//   - Percentages are rounded; extremes show "<1%" and ">99%".
//   - Moves read "up 12 points today" / "down 4 points this week".
//   - No jargon: no cents, YES/NO, "bps" (rewritten to "a quarter point" etc.).
//
// LLM seam: storyHeadline/storyDek are the only entry points the rank stage uses. A future Claude-written
// copy layer can wrap them and fall back to these templates.
//
// Config keys read: none.

const HEADLINE_MAX = 90;

// ---------- numbers ----------
export function pct(p) {
  if (p == null || !Number.isFinite(p)) return '';
  const r = Math.round(p * 100);
  if (r < 1) return '<1%';
  if (r > 99) return '>99%';
  return `${r}%`;
}

export function pts(delta, when = '') {
  if (delta == null || !Number.isFinite(delta)) return '';
  const n = Math.round(Math.abs(delta) * 100);
  const tail = when ? ` ${when}` : '';
  if (n === 0) return `flat${tail}`;
  return `${delta > 0 ? 'up' : 'down'} ${n} point${n === 1 ? '' : 's'}${tail}`;
}

export function money(n) {
  if (n == null || !Number.isFinite(n)) return '';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

// "a 72% chance" / "an 80% chance" / "an 11% chance"
const article = (p) => (/^(8|11%|18%)/.test(p) ? 'an' : 'a');
const withArticle = (p) => `${article(p)} ${p}`;

// ---------- text cleanup ----------
const BPS = [
  [/\b25\s*(bps|basis points?)\b/gi, 'a quarter point'],
  [/\b50\+?\s*(bps|basis points?)\b/gi, 'a half point'],
  [/\b75\s*(bps|basis points?)\b/gi, 'three quarters of a point'],
  [/\b100\s*(bps|basis points?)\b/gi, 'a full point'],
  [/\b(\d+)\s*bps\b/gi, '$1 basis points'],
];
export function dejargon(s) {
  let out = String(s || '');
  for (const [re, rep] of BPS) out = out.replace(re, rep);
  return out
    .replace(/(\d+(?:\.\d+)?)\s*¢/g, (_, n) => `${Math.round(Number(n))}%`)
    .replace(/\bU\.S\.(?=\s|$)/g, 'US')
    .replace(/\s+/g, ' ')
    .trim();
}

const stripQ = (s) => String(s || '').replace(/\?+\s*$/, '').trim();
// "Houthis capture Taiz by...? (castle)" -> "Houthis capture Taiz by": the stub an outcome ("November 30") completes
const eventStub = (e) => stripQ(stripParens(stripQ(dejargon(e)))).replace(/\s*(?:\.\.\.|…|_+)\s*\??$/, '').replace(/\?+$/, '').trim();
const stripParens = (s) => String(s || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

// "Scott Colom (D)" -> "Democrat Scott Colom"; "Sen. Dan Sullivan (R)" -> "Republican Dan Sullivan"
export function cleanOutcome(o) {
  let s = String(o || '').trim();
  const party = s.match(/\((D|R|I)\)\s*$/);
  s = s.replace(/\s*\((D|R|I)\)\s*$/, '').replace(/^(Sen\.|Rep\.|Gov\.|Mayor|Dr\.)\s+/, '').trim();
  s = dejargon(s);
  if (party) s = `${{ D: 'Democrat', R: 'Republican', I: 'independent' }[party[1]]} ${s}`;
  return s;
}
// Short name for tickers/boards: "Scott Colom (D)" -> "Colom"? Keep full names, they read better on air.
const shortOutcome = (o) => String(o || '').replace(/^(Sen\.|Rep\.|Gov\.|Dr\.)\s+/, '').trim();

// Event title -> noun phrase usable after "for"/"in". Returns {phrase, prep}.
export function eventPhrase(eventTitle) {
  let t = stripQ(stripParens(stripQ(dejargon(eventTitle))));
  let m;
  // "Where/Who/Which/What/When ..." events are questions: never paste them after "in"/"for". When the question maps to
  // an infinitive ("Where will the next talks take place" -> "to host the next talks") that is the phrase.
  if (/^(where|which|who|what|how many|when)\b/i.test(t)) {
    const inf = questionInfinitive(t);
    return inf ? { phrase: inf, prep: '', quoted: true, inf } : { phrase: `“${t}?”`, prep: 'in', quoted: true };
  }
  if ((m = t.match(/^(Republican|Democratic) Presidential Nominee (\d{4})$/i))) return { phrase: `the ${m[2]} ${cap(m[1])} nomination`, prep: 'for' };
  if ((m = t.match(/^Presidential Election Winner (\d{4})$/i))) return { phrase: `the ${m[1]} presidential race`, prep: 'in' };
  if ((m = t.match(/^(.+?) (Senate|House|Governor|Gubernatorial|Mayoral) Election Winner$/i))) return { phrase: `the ${m[1]} ${m[2].toLowerCase() === 'gubernatorial' ? 'governor' : m[2]} race`.replace(/ Governor race/, ' governor race').replace(/ Mayoral race/, ' mayor race'), prep: 'in' };
  if ((m = t.match(/^(.+?) Election Winner$/i))) return { phrase: `the ${m[1]} race`, prep: 'in' };
  if ((m = t.match(/^(.+?) (House|Senate|Governor) winner$/i))) return { phrase: `the ${m[1]} ${m[2].toLowerCase() === 'governor' ? 'governor' : m[2]} race`, prep: 'in' };
  if ((m = t.match(/^(.+?) (Mayor|Mayoral|Attorney General|Secretary of State|Lieutenant Governor) winner$/i))) return { phrase: `the ${m[1]} ${/^mayor/i.test(m[2]) ? 'mayor' : m[2]} race`, prep: 'in' };
  if ((m = t.match(/^(\d{4}) (Republican|Democratic) presidential nominee$/i))) return { phrase: `the ${m[1]} ${cap(m[2])} nomination`, prep: 'for' };
  if ((m = t.match(/^Largest IPO by market cap(?: in (\d{4}))?$/i))) return { phrase: 'the race for largest IPO by market cap', prep: 'in' };
  if ((m = t.match(/^(.+?) by-election winner$/i))) return { phrase: `the ${m[1]} by-election`, prep: 'in' };
  if ((m = t.match(/^Grammy winner:\s*(.+)$/i))) return { phrase: `${m[1]} at the Grammys`, prep: 'for' };
  // sports futures ("NBA: 2027 Champion", "IEM Beijing 2026: Winner"): never paste the colon after "in"
  if ((m = t.match(/^(.+?):\s*(\d{4})\s+Champion$/i))) return { phrase: `the ${m[2]} ${m[1]} title race`, prep: 'in' };
  if ((m = t.match(/^(.+?):\s*(\d{4}(?:-\d{2,4})?)\s+(MVP|Rookie of the Year|[A-Z][\w' ]{2,30} (?:Award|Trophy))$/))) return { phrase: `the ${m[2]} ${m[1]} ${m[3]} race`, prep: 'in' };
  if ((m = t.match(/^(.+?):\s*(?:Winner|Champion)$/i))) return { phrase: `the ${m[1].replace(/^the /i, '')} race`, prep: 'in' };
  if ((m = t.match(/^(.+?) winner$/i)) && !/^(who|which|what)\b/i.test(m[1]) && m[1].split(/\s+/).length <= 7) return { phrase: `the ${m[1].replace(/^the /i, '')} race`, prep: 'in' };
  if ((m = t.match(/^(\d{4}) (Democratic|Republican) VP nominee$/i))) return { phrase: `the ${m[1]} ${cap(m[2])} VP pick`, prep: 'for' };
  if ((m = t.match(/^(?:(\d+)(?:st|nd|rd|th) )?Largest Company end of (\w+)(?: (\d{4}))?$/i))) {
    const ord = m[1] ? `${m[1]}${{ 1: 'st', 2: 'nd', 3: 'rd' }[m[1]] || 'th'}-` : '';
    return { phrase: `the race for ${ord}largest company ${/^dec/i.test(m[2]) ? 'at year end' : `at the end of ${MONTH_FULL[m[2].slice(0, 3).toLowerCase()] || m[2]}`}`, prep: 'in' };
  }
  if ((m = t.match(/^(.+?) Mayoral Election$/i))) return { phrase: `the ${m[1]} mayor race`, prep: 'in' };
  if ((m = t.match(/^Balance of Power:?\s*(\d{4}) Midterms$/i))) return { phrase: `control of Congress after the ${m[1]} midterms`, prep: 'for' };
  if ((m = t.match(/^(Prime Minister|President|Chancellor|Speaker) of (.+?) after the next election$/i))) return { phrase: `the race for ${m[2]}'s next ${m[1].toLowerCase()}`, prep: 'in' };
  if ((m = t.match(/^Next (.+?) Presidential Election$/i))) return { phrase: `the next ${m[1]} presidential election`, prep: 'in' };
  if ((m = t.match(/^Fed Decision in (\w+)$/i))) return { phrase: `the Fed's ${m[1]} decision`, prep: 'for' };
  if ((m = t.match(/^(\w+) Senate Election Margin of Victory$/i))) return { phrase: `the ${m[1]} Senate margin`, prep: 'in' };
  // awards, charts and rankings: "Oscar Winner: Best Picture", "Dancing with the Stars Season 35 · Winner",
  // "Best AI at the end of 2026", "Top Artist on Spotify US 2026", "Top US Streamed Song : 2026"
  if ((m = t.match(/^Oscar Winner:\s*(.+)$/i))) return { phrase: `${m[1]} at the Oscars`, prep: 'for' };
  if ((m = t.match(/^Oscars?(?: \d{4})?:\s*(.+?) Nominations?$/i))) return { phrase: `a ${m[1]} nomination at the Oscars`, prep: 'for' };
  if ((m = t.match(/^Oscars?(?: \d{4})?:\s*(.+?)(?: Winner)?$/i))) return { phrase: `${m[1]} at the Oscars`, prep: 'for' };
  if ((m = t.match(/^(TIME Person of the Year|.+? (?:Award|Prize|Trophy))(?: \d{4})?$/))) return { phrase: m[1], prep: 'for' };
  if ((m = t.match(/^Next (.+)$/)) && !/\b(by|before|after|election)\b/i.test(m[1])) return { phrase: `the race to be the next ${m[1].replace(/ actor$/, '')}`, prep: 'in' };
  if ((m = t.match(/^(.+?)\s*[·:–-]\s*Winner$/i))) return { phrase: m[1].replace(/\bS(\d+)\b/, 'Season $1'), prep: 'to win' };
  if ((m = t.match(/^(Best|Top|Largest|Biggest|Most [a-z]+) (.+)$/i)) && !/\b(will|be|is|by|before)\b/i.test(m[2])) {
    const rest = m[2].replace(/\s*:\s*(\d{4})$/, ' of $1').replace(/\b(Artist|Song|Album|Company|Show|Movie|Film|Model|Streamed|Selling|Podcast|Book|Game)s?\b/g, (w) => w.toLowerCase());
    return { phrase: `the race for ${m[1].toLowerCase()} ${rest}`, prep: 'in' };
  }
  if (/^(which|who|what|how many|when)\b/i.test(t)) return { phrase: `“${t}?”`, prep: 'in', quoted: true };
  return { phrase: t.replace(/\.\.\.$/, '').trim(), prep: 'in' };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
// "Who/Which/Where will ..." -> the infinitive the answer completes: "Where will next Russia x Ukraine peace talks take
// place this week" -> "to host the next Russia-Ukraine peace talks this week". null when it does not map cleanly.
export function questionInfinitive(title) {
  const t = String(title || '').replace(/\?\s*$/, '').replace(/\s+/g, ' ').trim().replace(/\b([A-Z][\w.]*) x ([A-Z])/g, '$1-$2');
  let m;
  if ((m = t.match(/^Where will (.+?) (?:take place|be held|be hosted|happen|occur)(?: (this week|this month|today|tomorrow|next week|next month|in \d{4}|by .+|before .+|on .+))?$/i))) {
    const X = /^(next|first|second|third|final|upcoming)\b/i.test(m[1]) ? `the ${m[1]}` : m[1];
    return `to host ${X}${m[2] ? ' ' + m[2] : ''}`;
  }
  if ((m = t.match(/^(?:Who|Which [a-z]+(?: [a-z]+)?|What [a-z]+(?: [a-z]+)?) will (?!the\b|a\b|an\b)([a-z]+) (.+)$/i))) return `to ${m[1].toLowerCase()} ${m[2]}`;
  return null;
}

// ---------- question -> clause ----------
const VERBS = new Set(('win lose be confirm increase decrease cut raise hike pass sign announce approve reach hit hold leave resign remain ' +
  'become have get make visit meet end launch release ban impose declare return retire nominate issue file go rise fall drop exceed close beat ' +
  'defeat take keep finish receive step stay sell buy acquire merge default happen occur pardon indict testify appear run enter ' +
  'veto overturn rule block unveil introduce extend lift lower publish reveal top surpass outperform drop fire replace appoint join quit').split(' '));
const PREPS = new Set('by before after in on at for to of with from than during through until within over under into per via'.split(' '));
const SUBJ_STOP = new Set(['the', 'a', 'an', 'of', 'and', 'de', 'van', 'von', 'der', 'x', '&', 'la', 'le', 'del', 'da', 'bin', 'al']);
const IRREG = { be: 'is', have: 'has', do: 'does', go: 'goes' };
const PLURAL_IRREG = { be: 'are', have: 'have', do: 'do', go: 'go' };

function conjugate(v, plural) {
  if (plural) return PLURAL_IRREG[v] || v;
  if (IRREG[v]) return IRREG[v];
  if (/(s|sh|ch|x|z|o)$/.test(v)) return v + 'es';
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + 'ies';
  return v + 's';
}
function isPluralSubject(words) {
  const last = words[words.length - 1] || '';
  if (/^(there)$/i.test(words[0] || '') ) return null; // decided by complement
  if (/^(US|U\.S\.|UK|EU|UN|NATO|OPEC|Congress|News|Paris|Texas|Kansas|Arkansas|Brussels|Athens|Barbados)$/i.test(last)) return false;
  if (/(ss|us|is)$/i.test(last)) return false;
  // a capitalized multi-word subject is a name ("Sarah Huckabee Sanders", "Bernie Sanders") unless its last word is a
  // people/plural proper noun ("Democrats", "the New York Knicks")
  if (/^[A-Z]/.test(last) && words.length >= 2 && words.every((w) => /^[A-Z]/.test(w) || SUBJ_STOP.has(w.toLowerCase()))
    && !/(ans|ats|ists|ites|States|Nations|Islands|Emirates|Netherlands|Philippines|Knicks|Giants|Jets|Chiefs|Eagles|Lakers|Celtics|Yankees)$/.test(last)) return false;
  return /s$/.test(last) && /^[A-Za-z]/.test(last);
}

// Phrase rewrites applied to every question before parsing (shorter, plainer subjects).
const PRE = [
  [/\bthe Democratic Party candidate\b/gi, 'the Democrat'],
  [/\bthe Republican Party candidate\b/gi, 'the Republican'],
  [/\bthe Democratic Party\b/gi, 'Democrats'],
  [/\bthe Republican Party\b/gi, 'Republicans'],
  [/\bthe (Democrats|Republicans)\b/g, '$1'],
  [/\b(\d{4}) midterm elections\b/gi, '$1 midterms'],
  // Kalshi template grammar: "Will Democratics win ...", "Will Democratic win the House race for NC-03?",
  // "Will Pete Hegseth leaves Secretary of Defense in before 2027?"
  [/\bDemocratics\b/g, 'Democrats'],
  [/\bRepublicans?s\b/g, 'Republicans'],
  [/^(Will )?Democratic (win|wins)\b/, (_, w, v) => `${w || ''}the Democrat ${w ? 'win' : 'wins'}`],
  [/^(Will )?Republican (win|wins)\b/, (_, w, v) => `${w || ''}the Republican ${w ? 'win' : 'wins'}`],
  [/\bin before (\d{4})\b/g, 'before $1'],
  [/^Will (.+?) leaves? ((?:Secretary|Attorney General|Director|Administrator|Chair|Chairman|Speaker|Governor|Deputy|Chief|HHS|Press|National Security)\b[^?]*?) before\b/, 'Will $1 be out as $2 before'],
  // Kalshi "Closer Senate Race: Maine or Texas?": "Will Texas US Senate have the smallest margin of victory in
  // the ... general elections for Maine US Senate and Texas US Senate?" -> "Will the Texas Senate race be closer than Maine's"
  [/^Will (.+?) US (Senate|House|Governor) have the smallest margin of victory in .*? for (.+?) US \2 and (.+?) US \2$/i,
    (_, a, office, x, y) => `Will the ${a} ${office} race be closer than ${a === x ? y : x}'s`],
  [/\bat market close on IPO day\b/gi, 'at the close of its first trading day'],
  [/^Will (.+?) IPO\b/, 'Will $1 go public'],
  // central banks take "the" ("Bank of Mexico decreases ..." -> "the Bank of Mexico cuts ...")
  [/^(Will )?(Bank of [A-Z]|Reserve Bank of|European Central Bank|Federal Reserve\b|People's Bank of|Swiss National Bank|National Bank of)/, (_, w, b) => `${w || ''}the ${b}`],
  // rate moves in plain English: "Hike rates by 0bps" -> "leave rates unchanged", "decreases interest rates by 25 bps" ->
  // "cuts rates a quarter point", ">25bps" -> "more than a quarter point"
  [/\b(?:hike|cut|raise|lower|increase|decrease)s? (?:interest )?rates by 0 basis points\b/gi, 'leave rates unchanged'],
  [/>\s*(a quarter point|a half point|a full point)/g, 'more than $1'],
  [/\b(increase|raise|hike|decrease|lower|reduce|cut)(s)? (?:the )?(?:interest |policy |benchmark |key )?rates?(?: by)?(?=\s|$)/gi,
    (_, v, s3) => `${/^(increase|raise|hike)$/i.test(v) ? 'hike' : 'cut'}${s3 ? 's' : ''} rates`],
  // "Will the Democratic party hold ..." / "Will Yes receive at least 52% of the popular vote in the California Proposition 40 election?"
  [/^Will Yes receive (.+?) of the (?:popular )?vote in the (.+?) election$/i, 'Will the Yes side get $1 of the vote on $2'],
  [/^Will No receive (.+?) of the (?:popular )?vote in the (.+?) election$/i, 'Will the No side get $1 of the vote on $2'],
  [/\b(?:a|an) any\b/g, 'any'],
  [/\s*\((?:HIGH|LOW)\)/g, ''],
  [/\b([A-Z])([A-Z])([a-z]{3,})\b/g, (_, a, b, c) => a + b.toLowerCase() + c],   // "Susie WIles" -> "Susie Wiles"
  [/\b1-a quarter point\b/g, 'up to a quarter point'],
  [/\bDemocratic Party nominees\b/g, 'Democratic nominees'],
  [/\bRepublican Party nominees\b/g, 'Republican nominees'],
  [/\bwin above (\d+)/g, 'win more than $1'],
  [/\bretires? the Supreme Court\b/g, (w) => w.replace(/ the/, ' from the')],
  [/\bleaves? (Republicans|Democrats)\b/g, (w, p) => w.replace(p, `the ${p}`)],
  [/^Will (?:the )?(.+?) rate cuts for (\d{4}) be exactly (\d+)$/, 'Will the $1 make exactly $3 rate cuts in $2'],
  [/\b(report|reports|have|has) (Above|Below|At least|More than|Less than) (?=[\d$])/g, (_, v, r) => `${v} ${r.toLowerCase()} `],
  [/\bat the end of ((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2})\b/g, 'on $1'],
  [/^Will (.+?) have the smallest margin of victory in (?:the )?(?:\d{4} )?(?:United States|US) (Senate|House|governor) (?:elections|races)$/i, 'Will $1 be the closest $2 race'],
  [/\bUnited States\b/g, 'US'],
  [/\b(?:the )?(?:\d{4} )?US House of Representatives\b/g, 'the House'],
  [/\bregarding\b/g, 'over'],
  // central banks: "after the November 2026 meeting", "at the November Bank of Mexico Governing Board meeting"
  [/\b(?:at|after) (?:the |their |its )?(January|February|March|April|May|June|July|August|September|October|November|December)(?: \d{4})?(?: (?:[A-Z][\w’']*|of))*(?: [a-z]+)? (?:[Mm]eeting|[Dd]ecision)\b/g, 'in $1'],
  [/\bat (\d{1,2}(?::\d\d)?\s*[ap]m)(?: [A-Z]{2,4})?\b/gi, ''],
  [/\b(\d{3,})\.99\b/g, (_, n) => String(Number(n) + 1)],
  [/\bbefore Jan(?:uary)? 1,? (\d{4})\b/g, 'before $1'],
  // margin brackets: "by 12% or more" reads as a price; say points
  [/\bby (\d+(?:\.\d+)?)% or more\b/g, 'by $1 points or more'],
  [/\bby (\d+(?:\.\d+)?)%\s*-\s*(\d+(?:\.\d+)?)%/g, 'by $1 to $2 points'],
];
const PARTY = { D: 'Democrats', R: 'Republicans' };
// Titles that are not "Will ..." questions but can be read as a clause.
const SPECIAL = [
  [/^(?:\d{4} )?Balance of Power:\s*([DR]) Senate,\s*([DR]) House$/i, (m) => (m[1] === m[2]
    ? `${PARTY[m[1].toUpperCase()]} win both the Senate and the House`
    : `${PARTY[m[1].toUpperCase()]} win the Senate and ${PARTY[m[2].toUpperCase()]} win the House`)],
  [/^(?:Will )?(.+?) (?:be )?out (as .+?|of office )?\s*(before|by) (.+)$/i, (m) => `${m[1]} is out ${m[2] ? m[2].trim() + ' ' : ''}${m[3]} ${m[4]}`],
];
const STATEMENT_VERB = /^(reissues|extends|renews|imposes|recognizes|restores|decreases|increases|maintains|keeps|passes|wins|loses|continues|returns|announces|declares|reaches|hits|ends|resigns|leaves|signs|cuts|raises|hikes|holds|confirms|approves|launches|happens|is|are|exceeds|falls|rises|drops|closes|beats|imports|exports|releases|bans|lifts|joins|becomes)$/i;

// "Will the Fed cut rates in December?" -> "the Fed cuts rates in December". Returns null if it can't parse.
export function questionToClause(title) {
  let t = dejargon(stripQ(title));
  for (const [re, rep] of PRE) t = t.replace(re, rep);
  for (const [re, fn] of SPECIAL) { const mm = t.match(re); if (mm) return fn(mm).replace(/\s+/g, ' ').trim(); }
  const m = t.match(/^Will\s+(.+)$/i);
  if (!m) {
    // statement title with a present-tense verb: "Billionaire wealth tax passes in California election 2026?"
    if (!/\?\s*$/.test(String(title || ''))) return null;
    const pp = t.match(/^([A-Z][^?]*?) (?:([a-z]+ly) )?(released|filed|closed|reopened|confirmed|approved|announced|passed|signed|launched|named|fired|arrested|indicted|charged|convicted|sentenced|pardoned|extradited|formed|elected|nominated|banned|delisted|acquired|cancel(?:l)?ed|delayed|impeached|removed|replaced) ((?:by|before|on|in|at|as|after|this|next)\b.*)$/);
    if (pp && !/\.\.\.$/.test(t)) {
      const subj = pp[1].replace(/^(Next|First|New) /, (w) => `the ${w.trim().toLowerCase()} `);
      return `${subj} ${isPluralSubject(pp[1].split(/\s+/)) ? 'are' : 'is'} ${pp[2] ? pp[2] + ' ' : ''}${pp[3]} ${pp[4]}`;
    }
    const w = t.split(/\s+/);
    const vi = w.findIndex((x, i) => i > 0 && STATEMENT_VERB.test(x));
    if (vi < 1 || /\.\.\.$/.test(t)) return null;
    if (/^(Billionaire|Federal|National|Government|Another|Any|New|Global|Annual|Monthly|Weekly)$/.test(w[0])) w[0] = w[0].toLowerCase();
    return w.join(' ');
  }
  const words = m[1].split(/\s+/);
  let vi = -1, conjugated = false;
  for (let i = 1; i < words.length; i++) {
    const w = words[i].toLowerCase().replace(/[^a-z-]/g, '');
    if (VERBS.has(w)) { vi = i; break; }
    // Kalshi sometimes writes the verb already conjugated ("Will X leaves ...", "Will X wins ..."): keep it.
    const stem = w.endsWith('es') && VERBS.has(w.slice(0, -2)) ? w.slice(0, -2) : w.endsWith('s') && VERBS.has(w.slice(0, -1)) ? w.slice(0, -1) : null;
    if (stem && !/^[A-Z]/.test(words[i])) { vi = i; conjugated = true; break; }
  }
  if (vi < 0) {
    for (let i = 1; i < words.length; i++) {
      const raw = words[i];
      if (/^[a-z]/.test(raw) && !SUBJ_STOP.has(raw.toLowerCase()) && !PREPS.has(raw.toLowerCase())) { vi = i; break; }
    }
  }
  if (vi < 1) return null;
  const subj = words.slice(0, vi);
  const verb = words[vi].toLowerCase();
  let plural = isPluralSubject(subj);
  if (plural === null) { // "there be ..." -> "there is/are"
    const next = (words[vi + 1] || '').toLowerCase();
    const after = words.slice(vi + 1, vi + 4).join(' ').toLowerCase();
    plural = /^(\d|two|three|four|five|many|several|more|multiple)/.test(next) || /^(at least|at most|more than|fewer than|over|under|above|below) (\d|two|three)/.test(after)
      || /s$/.test(words[vi + 2] || '') && !/^(a|an|no)$/.test(next);
  }
  const rest = words.slice(vi + 1).join(' ');
  if (conjugated) return `${subj.join(' ')} ${verb}${rest ? ' ' + rest : ''}`.replace(/\s+/g, ' ').trim();
  // lowercase-word fallback picked a word that is already third person ("leaves"): don't double it
  if (!VERBS.has(verb) && /[^s]s$/.test(verb)) return `${subj.join(' ')} ${verb}${rest ? ' ' + rest : ''}`.replace(/\s+/g, ' ').trim();
  return `${subj.join(' ')} ${conjugate(verb, plural)}${rest ? ' ' + rest : ''}`.replace(/\s+/g, ' ').trim();
}

// Tighten a clause for headlines without changing its meaning.
const YEAR = String(new Date().getUTCFullYear());
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function tighten(clause) {
  return clause
    .replace(/\b([A-Z][a-zA-Z.]+) x ([A-Z][a-zA-Z.]+)\b/g, '$1-$2')
    // "the Alaska, Iowa, Kansas, Maine, Michigan, Ohio, and Texas Senate seats" -> "all seven key Senate seats"
    .replace(/\bthe ((?:[A-Z][a-z]+(?: [A-Z][a-z]+)?, ){3,}(?:and )?[A-Z][a-z]+(?: [A-Z][a-z]+)?) (Senate|House|governor)(\s+(?:seats|races))\b/g,
      (_, list, office, noun) => `all ${NUMW[list.split(/,\s*(?:and\s+)?/).length] || list.split(',').length} key ${office}${noun}`)
    .replace(new RegExp(`\\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.? \\d{1,2}),? ${YEAR}\\b`, 'g'), '$1')
    .replace(new RegExp(`\\b((?:January|February|March|April|May|June|July|August|September|October|November|December)) ${YEAR}\\b`, 'g'), '$1')
    .replace(/(^|[^\d.,$])(\d{5,})(?![\d.,])/g, (_, a, n) => a + Number(n).toLocaleString('en-US'))
    .replace(new RegExp(`\\s+in ${YEAR}\\b`, 'g'), '')
    .replace(new RegExp(`\\bthe ${YEAR} `, 'g'), 'the ')
    .replace(new RegExp(`\\b(on|in|for) ${YEAR} (?=[A-Z])`, 'g'), '$1 ')
    .replace(new RegExp(`\\b(Q[1-4]) ${YEAR}\\b`, 'g'), '$1')
    .replace(new RegExp(`\\b(election|elections|midterms?) ${YEAR}\\b`, 'gi'), '$1')
    .replace(/\b(Senate|House|governor|mayoral) election\b/g, '$1 race')
    .replace(/\bgubernatorial (election|race)\b/g, 'governor race')
    .replace(/ (Above|Below|At least|More than|Less than) (?=[\d$])/g, (w) => w.toLowerCase())
    .replace(/(seat count .*?) in the US (?:House|Senate) elections$/, '$1')
    .replace(/\bmidterm elections\b/g, 'midterms')
    .replace(/\binterest rates\b/gi, 'rates')
    .replace(/\bafter the (\w+) \d{4} meeting\b/gi, 'in $1')
    .replace(/\bthe (\d{4}) /g, 'the $1 ')
    .replace(new RegExp(`\\s+in (?:${YEAR}|${+YEAR + 1})\\b(?=$)`), '')   // this year and next are implied; "in 2030" is not
    .replace(/\s+/g, ' ')
    .trim();
}

// A headline-length clause: drop trailing context that is not part of the condition ("after the Israeli
// election", "as published by Billboard"). Deadlines ("by", "before") are kept.
export function shortClause(title) {
  const c = questionToClause(title);
  if (!c) return null;
  let t = tighten(c);
  t = t.replace(/,? (?:after|following|in|at) the (?:\d{4} )?(?:(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? (?:\d{4} )?)?(?:[A-Z][\w-]* )*(?:general |legislative |national |presidential )?elections?\b/, '')
    .replace(/,? (?:as published by|according to|per) .*$/i, '')
    .replace(/\s*\([^)]*\)/g, '');
  return t.replace(/\s+/g, ' ').trim() || null;
}

// ---------- strike ladders and "Will X be above Y" ----------
// Kalshi recurring economics series (gas, diesel, oil, CPI...) are cumulative ladders of "Above X" rungs. rank.mjs
// airs a ladder as ONE yes/no story on the rung nearest 50% (the line bettors are split on); this turns a rung, or any
// "Will <noun> be above <value> ...?" market, into a noun phrase: "National gas price above $4.02 this week".
const REL_WORDS = '(?:above|below|over|under|at least|at most|more than|less than|greater than|higher than|lower than|between)';
const VAL = String.raw`-?\$?\d[\d,]*(?:\.\d+)?%?(?:\s*(?:USD\/Bbl|USD\/t\.oz|USD\/MMBtu|USD|percentage points?|points?|percent|%))?`;
const MONTHS_RE = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
const REL_NORM = { over: 'above', 'greater than': 'above', 'higher than': 'above', under: 'below', 'lower than': 'below' };
// Kalshi's long nouns -> what a newsreader would say. Meaning is never changed.
const NOUN_FIX = [
  [/^number of (?:US |U\.S\. )?(House|Senate) seats won by (Democratic|Republican) (?:Party )?candidates$/i, (_, o, p) => `${/^d/i.test(p) ? 'Democrats' : 'Republicans'}' ${o} seat count`],
  [/^average (?:US |national )?gas prices?$/i, 'National gas price'],
  [/^(?:average |national )?diesel prices?$/i, 'National diesel price'],
  [/^WTI crude oil settlement price$/i, 'WTI oil'],
  [/^(WTI|brent) crude oil close price$/i, (_, x) => `${x.toUpperCase() === 'WTI' ? 'WTI' : 'Brent'} oil`],
  [/^(gold|silver|copper) close price$/i, (_, x) => capFirst(x.toLowerCase())],
  [/^President's approval rating$/i, "Trump's approval rating"],
  [/^margin of victory for (Democrats|Republicans) in the (?:U\.S\. |US )?(Senate|governor) election in (.+)$/i, (_, p, o, st) => `${p}' ${st} ${o} margin`],
  [/^margin of victory for (Democrats|Republicans) in the (.+?) (House|Senate) election$/i, (_, p, place) => `${p}' margin in ${place}`],
  [/^margin of victory for (Democrats|Republicans) in the (.+?) (Senate|governor|gubernatorial) election$/i, (_, p, st, o) => `${p}' ${st} ${o === 'Senate' ? 'Senate' : 'governor'} margin`],
  [/^total vote count for all participants in (.+?) General Election$/i, (_, r) => `Turnout in the ${r} race`],
  [/^natural gas close price$/i, 'Natural gas'],
  [/^Generic Ballot: (Democrats|Republicans) Up\/Down$/i, (_, p) => `${p}' generic-ballot lead`],
  [/^(?:AAA )?national average price for (diesel|gas(?:oline)?)$/i, (_, f) => `National ${/^d/i.test(f) ? 'diesel' : 'gas'} price`],
  [/^maximum WTI front month settle price$/i, 'WTI oil'],
  [/^30-Yr FRM$/i, '30-year mortgage rate'],
  [/^price of (WTI|Brent) (?:crude )?oil$/i, (_, x) => `${x.toUpperCase() === 'WTI' ? 'WTI' : 'Brent'} oil`],
  [/^(\w+) Vercel share of AI Gateway (requests|spend) across the top labs$/i, (_, co, k) => `${co}'s share of Vercel AI Gateway ${k}`],
];
function fmtNum(n, dollars) {
  const x = Number(String(n).replace(/,/g, ''));
  if (!Number.isFinite(x)) return String(n);
  if (dollars) {
    const d = String(n).split('.')[1] || '';
    const sig = d.replace(/0+$/, '').length;
    // $4.0200 -> $4.02, $4.0850 -> $4.085, $4068.00 -> $4,068, $3947.99 -> $3,947.99
    const keep = x >= 10 && sig === 0 ? 0 : Math.min(Math.max(2, sig), 3);   // $115.00 -> $115, but a gas rung stays $4.00
    return x.toLocaleString('en-US', { minimumFractionDigits: keep, maximumFractionDigits: keep });
  }
  if (Math.abs(x) >= 1e6 && Number.isInteger(x)) return `${+(x / 1e6).toFixed(2)} million`;
  if (Math.abs(x) >= 10_000) return x.toLocaleString('en-US');
  return String(n).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
// "$4.0200" -> "$4.02", "116.99 USD/Bbl" -> "$116.99 a barrel", "0.5 percentage points" -> "0.5 points", 8200000 -> "8.2 million"
export function fmtValue(raw, { percent = false } = {}) {
  const v = String(raw || '').trim();
  const m = v.match(/^(-?)(\$?)(\d[\d,]*(?:\.\d+)?)(%?)\s*(.*)$/);
  if (!m) return v;
  const [, neg, dol, num, pc, unitRaw] = m;
  const unit = unitRaw.trim();
  const barrel = /^USD\/Bbl$/i.test(unit), ounce = /^USD\/t\.oz$/i.test(unit), usd = /^USD$/i.test(unit), btu = /^USD\/MMBtu$/i.test(unit);
  const money = !!dol || barrel || ounce || usd || btu;
  let out = `${neg}${money ? '$' : ''}${fmtNum(num, money)}`;
  if (pc || /^(%|percent)$/i.test(unit)) out += '%';
  else if (/^(percentage )?points?$/i.test(unit)) out += Number(num) === 1 ? ' point' : ' points';
  else if (barrel) out += ' a barrel';
  else if (ounce) out += ' an ounce';
  else if (btu) out += ' per million BTU';
  else if (percent && !money) out += '%';
  return out;
}
// When the ladder settles: "this week" / "tomorrow" from the event title, else the rung's own date, else the
// event's date line ("On Nov 9, 2026" -> "on Nov 9", "In Oct 2026" -> "in October").
function whenOf(m, tail) {
  const ev = String(m?.eventTitle || '');
  const w = ev.match(/\b(this week|this month|this year|today|tomorrow|next week|next month)\b/i);
  if (w) return w[1].toLowerCase();
  let t = String(tail || '').replace(/\s*(?:,\s*)?(?:according to|as (?:reported|published) by|per)\b.*$/i, '').trim();
  if (!t) {
    const ed = ev.match(new RegExp(`\\b((?:on|by|before|in) ${MONTHS_RE}(?: \\d{1,2})?(?:,? \\d{4})?)\\b`, 'i'));
    if (ed) t = ed[1].charAt(0).toLowerCase() + ed[1].slice(1);
  }
  if (!t) {
    const sub = String(m?.eventSub || '').trim();
    if (/^(on|in|by|before) /i.test(sub)) t = sub.charAt(0).toLowerCase() + sub.slice(1);
    else if (new RegExp(`^${MONTHS_RE} \\d{1,2},? \\d{4}`, 'i').test(sub)) t = `on ${sub}`;
  }
  t = tidyWhen(t);
  // an election ladder's date line is the day already voted ("On November 3, 2026"): don't repeat a past day
  const d = t.match(new RegExp(`^on (${MONTHS_RE}) (\\d{1,2})(?:,? (\\d{4}))?$`, 'i'));
  if (d) {
    const ms = Date.parse(`${d[1].replace(/\.$/, '')} ${d[2]}, ${d[3] || YEAR} 23:59 UTC`);
    const ref = Date.parse(m?.updatedAt || '') || Date.now();
    if (Number.isFinite(ms) && ms < ref - 12 * 3600_000) return '';
  }
  return t;
}
const MONTH_FULL = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };
function tidyWhen(t) {
  return tighten(String(t || '')
    .replace(/^in the (?:US )?(?:House|Senate) elections?$/i, '')
    .replace(new RegExp(`^at the end of (${MONTHS_RE} \\d{1,2})`, 'i'), 'on $1')
    .replace(/\bat \d{1,2}(?::\d\d)?\s*[AP]M(?: [A-Z]{2,4})?\b/gi, '')
    .replace(new RegExp(`\\b(${MONTHS_RE}) 0(\\d)\\b`, 'g'), '$1 $2')
    .replace(new RegExp(`^in (${MONTHS_RE}) (\\d{4})$`, 'i'), (_, mo, y) => `in ${MONTH_FULL[mo.slice(0, 3).toLowerCase()] || mo} ${y}`)
    .replace(/\s+/g, ' ').trim()).replace(/^in (\d{4})$/, (x, y) => (y === YEAR ? '' : x)).trim();
}
// -> {noun, rel, value, when, phrase} or null. phrase is the headline noun phrase, rel+value the rung ("above $4.02").
export function ladderParts(m) {
  if (!m?.title) return null;
  let t = dejargon(stripQ(String(m.title).replace(/\*\*/g, ''))).replace(/\s+/g, ' ')
    .replace(/\bthe upper bound of the target range for the federal funds rate in effect at .*? on /i, 'the Fed funds rate on ');
  let noun, rel, value, tail = '';
  // "How many launches will SpaceX have in November?" with rung "Above 8" -> "SpaceX launches above 8 in November"
  const hm = t.match(/^How many (\w+(?: \w+)?) will (.+?) (?:have|get|make|see|win|hold|receive|sign|issue)\b ?(.*)$/i);
  const ho = String(m.outcome || '').match(new RegExp(`^(${REL_WORDS}) (${VAL})$`, 'i'));
  if (hm && ho) t = `${hm[2]} ${hm[1]}${hm[3] ? ' ' + hm[3] : ''}`;
  // "How high will unemployment get before 2027?" with rung "Above 8%" -> "Unemployment above 8% before 2027"
  const hh = t.match(/^How (?:high|low) will (?:the )?(.+?) (?:get|go|rise|climb|fall|drop|reach)\b ?(.*)$/i);
  if (hh && ho) t = `${capFirst(hh[1])} ${ho[1].toLowerCase()} ${ho[2]}${hh[2] ? ' ' + hh[2] : ''}`;
  // a bare rung title ("Above 8.5%") takes its noun from the event ("Generic Ballot: Democrats Up/Down (10/30-11/6)?")
  const bareRung = t.match(new RegExp(`^(${REL_WORDS}) (${VAL})$`, 'i'));
  if (bareRung && m.eventTitle) t = `${stripParens(stripQ(String(m.eventTitle)))} ${bareRung[1].toLowerCase()} ${bareRung[2]}`;
  let x = t.match(new RegExp(`^Will (?:the )?(.+?) (?:be|close|settle|end|finish|stay|remain) (${REL_WORDS}) (${VAL})(?: and (${VAL}))?(?:\\s+(.*))?$`));
  let y;
  if (x && !/^there$/i.test(x[1])) {
    [, noun, rel] = x;
    value = x[4] ? `${x[3]} and ${x[4]}` : x[3];
    tail = x[5] || '';
  } else if ((y = t.match(new RegExp(`^Will (?:the )?(.+?) (reach|hit|top|exceed|go above|go below|rise above|fall below) (${VAL})(?:\\s+(.*))?$`))) && !/^there$/i.test(y[1])) {
    // "Will the maximum WTI front month settle price reach $115.01 by Dec 31, 2026?"
    noun = y[1];
    rel = { reach: 'reaches', hit: 'hits', top: 'tops', exceed: 'exceeds', 'go above': 'goes above', 'go below': 'goes below', 'rise above': 'rises above', 'fall below': 'falls below' }[y[2]];
    // Kalshi writes "reach $115.01" for "above $115": the cent is a strike artifact, not a price anyone says
    value = y[3].replace(/^(\$?\d[\d,]{1,}|\$?[1-9]\d)\.01(?=\s|$)/, '$1'); tail = y[4] || '';
  } else if (!/^Will\b/i.test(t) && (y = t.match(new RegExp(`^(?:the )?([A-Z].+?) (above|below|at least|at most|more than|less than) (${VAL})(?:\\s+(.*))?$`)))) {
    // statement rung: "Anthropic Vercel share of AI Gateway requests across the top labs above 7.7%"
    [, noun, rel, value] = y; tail = y[4] || '';
  } else if (!new RegExp(`\\b${REL_WORDS} -?\\$?\\d`, 'i').test(t) && !/^Will\b/i.test(t) && (x = String(m.outcome || '').match(new RegExp(`^(${REL_WORDS}) (${VAL})$`, 'i')))) {
    // "Hexed Rotten Tomatoes score?" with rung "Above 65"
    noun = t.replace(/\s*·\s*/g, ' '); rel = x[1]; value = x[2];
  } else return null;
  rel = rel.toLowerCase(); rel = REL_NORM[rel] || rel;
  noun = stripParens(noun);
  // a date inside the noun ("Diesel Price on November 9, 2026", "... index for November 2026") belongs to the time
  const nd = noun.match(new RegExp(`^(.+?) ((?:on|for|in) (?:${MONTHS_RE}(?: \\d{1,2})?,? )?\\d{4})$`, 'i'));
  if (nd) { noun = nd[1]; if (!tail) tail = nd[2].replace(/^for /i, 'in '); }
  noun = noun.replace(/^the /, '');
  for (const [re, rep] of NOUN_FIX) if (re.test(noun)) { noun = noun.replace(re, rep); break; }
  // Kalshi state gas ladders share the national title ("Will average gas prices be above $3.565?"); the place is only
  // in the event ("Texas gas prices tomorrow", "How high will gas prices in Texas get this year?").
  const fuel = noun.match(/^National (gas|diesel) price$/);
  if (fuel) {
    const ev = String(m.eventTitle || '');
    const pl = ev.match(/^(?!US\b|How\b|What\b)([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*){0,2}) (?:gas|diesel) prices\b/) || ev.match(/\b(?:gas|diesel) prices in (?!the US\b|US\b)([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*){0,2})(?= get\b| in\b|\?|$)/);
    if (pl) noun = `${pl[1]} ${fuel[1]} price`;
  }
  if (noun.length > 64) return null;   // "Number of statewide races won by ..." reads better as a clause
  const pctNoun = /\b(approval|rating|share|percent|rate)\b/i.test(noun);
  const moneyNoun = /^(WTI|Brent) oil$|\bprice$/i.test(noun);
  const fv = (v) => fmtValue(moneyNoun && /^\d/.test(v) ? `$${v}` : v, { percent: pctNoun });
  const val = rel === 'between' ? value.split(' and ').map(fv).join(' and ').replace(/ a barrel and /, ' and ') : fv(value);
  const when = whenOf(m, tail);
  const phrase = capFirst(`${noun} ${rel} ${val}${when ? ' ' + when : ''}`.replace(/\s+/g, ' ').trim());
  // "WTI oil reaching $115 by Dec 31": the form a verb can follow ("... slips to 22%"). Only the reach/hit rels change.
  const ING = { reaches: 'reaching', hits: 'hitting', tops: 'topping', exceeds: 'exceeding', 'goes above': 'going above', 'goes below': 'going below', 'rises above': 'rising above', 'falls below': 'falling below' };
  const phraseIng = ING[rel] ? capFirst(`${noun} ${ING[rel]} ${val}${when ? ' ' + when : ''}`.replace(/\s+/g, ' ').trim()) : phrase;
  return { noun: capFirst(noun), rel, value: val, when, phrase, phraseIng };
}
// The rung on its own, for neighbor lines in a ladder dek: "above $4.00", "at least 48", "more than 0.2%".
export function rungLabel(m) {
  const lp = ladderParts(m);
  if (lp) return `${lp.rel} ${lp.value}`;
  const t = dejargon(stripQ(String(m?.title || '')));
  const x = t.match(new RegExp(`\\b(${REL_WORDS}|reach(?:es)?|hit|rise more than|fall more than) (${VAL})`, 'i'));
  if (x) {
    const r = x[1].toLowerCase().replace(/^reach(es)?$/, 'reaches').replace(/^(rise|fall) more than$/, (_, d) => `${d === 'rise' ? 'up' : 'down'} more than`);
    return `${REL_NORM[r] || r} ${fmtValue(x[2], { percent: /%/.test(x[2]) })}`;
  }
  const o = String(m?.outcome || '').trim();
  if (/^[↑↓]/.test(o)) return `${o.startsWith('↑') ? 'hits' : 'dips to'} ${o.slice(1).trim()}`;
  return dejargon(o).replace(/^(Above|Below|At least|More than|Less than)\b/, (w) => w.toLowerCase());
}

// ---------- noun-phrase markets ----------
// Some markets are a bare noun phrase with a deadline ("US-Iran Hormuz Agreement by December 31?", "Russia x Ukraine
// peace talks by November 15?"). Quoting them reads like a press release; "Chance of a US-Iran Hormuz agreement by
// December 31" reads like the news. Only Title Case words from this list are lowercased, so names stay capitalized.
const NP_COMMON = new Set(('agreement agreements deal deals management meeting meetings summit talks treaty visit peace trade senior ' +
  'diplomatic release launch announcement approval merger acquisition resignation impeachment indictment pardon nomination ' +
  'confirmation hike cut tariff tariffs sanctions call debate interview ruling verdict decision vote bill law ban recession default ' +
  'shutdown referendum framework accord pact negotiations official direct new first reopening closure exchange prisoner swap ' +
  'partnership investment purchase sale listing recognition normalization relations embassy extradition end return transit toll ' +
  'tolls fees passage nuclear minerals mineral rare earth earths security energy oil gas ceiling debt budget funding government ' +
  'state national federal joint public formal bilateral trilateral high-level level phone face-to-face in-person trifecta ' +
  'supermajority majority landslide sweep rate leadership change blackout internet total relief hikes cuts').split(' '));
const NP_GLUE = new Set(['x', 'and', 'of', 'the', 'a', 'an', 'with', 'between', 'on', 'for', 'over', '&', '-', 'to']);
export function nounPhrase(q) {
  let t = String(q || '').replace(/\s+/g, ' ').trim();
  const x = t.match(/^(.+?)\s+((?:by|before|in|on|during|this|next|through|until)\b.*)$/i);
  let head = x ? x[1] : t;
  const tail = x ? ' ' + tighten(x[2]) : '';
  if (!x) return null;
  let words = head.split(/\s+/);
  if (words.length < 2 || words.length > 8) return null;
  // a noun phrase: Title Case words, glue words and known common nouns only (no verbs, no "will")
  if (!words.every((w) => /^[A-Z0-9"“'$]/.test(w) || NP_GLUE.has(w.toLowerCase()) || NP_COMMON.has(w.toLowerCase()))) return null;
  const last = words[words.length - 1].toLowerCase();
  if (!NP_COMMON.has(last)) return null;          // the head noun must be a thing that happens (agreement, talks, meeting)
  let lead = '';
  if (/^next$/i.test(words[0])) words = words.slice(1);   // "Next US-Iran meeting by Dec 31" = a meeting by Dec 31
  if (/^another$/i.test(words[0])) { words = words.slice(1); lead = 'another '; }
  words = words.map((w, i) => (NP_COMMON.has(w.toLowerCase()) && /^[A-Z][a-z-]+$/.test(w) ? w.toLowerCase() : w))
    .map((w) => (w === 'x' ? '-' : w));
  head = words.join(' ').replace(/ - /g, '-');
  const plural = /[^s]s$/.test(last) && !/(ss|us|is)$/.test(last);
  if (!plural && !lead) lead = /^[aeio]/i.test(head) && !/^(one|eu|uni|euro)/i.test(head) ? 'an ' : 'a ';
  return `${lead}${head}${tail}`.replace(/\s+/g, ' ').trim();
}

// Is the outcome a name we can make the grammatical subject? ("Jon Ossoff", "Scott Colom (D)")
function nameLike(m) {
  const o = String(m?.outcome || '').trim();
  if (!o) return false;
  if (/\d|\bbps\b|%|,|^no change$|^other$|^yes$|^no$/i.test(o)) return false;
  if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(o)) return false;
  if (!/^[A-Z]/.test(o)) return false;
  // Kalshi "Texas US Senate" is a race, not a name; "Closest Senate race?" outcomes are places
  if (/\b(Senate|House|Governor|Mayor)\b/.test(o.replace(/\s*\([^)]*\)\s*$/, '')) || /^clos(est|er)\b/i.test(String(m.eventTitle || ''))) return false;
  // a name is capitalized throughout ("Maintain current rate" and "No change" are not)
  const ws = o.replace(/\s*\([^)]*\)\s*$/, '').split(/\s+/);
  if (!ws.every((w) => /^[A-Z0-9#&'"“]/.test(w) || SUBJ_STOP.has(w.toLowerCase()) || /^(with|on|in|for|to)$/i.test(w))) return false;
  // Title usually names the outcome: "Will Jon Ossoff win ...". Last word of the name should appear in the title.
  const last = o.replace(/\s*\([^)]*\)\s*$/, '').split(/\s+/).pop().toLowerCase();
  const t = String(m.title || '').toLowerCase();
  if (t.includes(last) || /\((D|R|I)\)$/.test(o)) return true;
  // The outcome is the answer to the event ("Who will win ...", "Tallahassee Mayoral Election" -> "Jeremy Matlow"),
  // or a Kalshi party race whose sub-title names the candidate. Only person-shaped names qualify.
  const personish = /^[A-Z][a-zA-Z'.-]+(?: [A-Z][a-zA-Z'.-]+){1,3}$/.test(o) && !/\b(party|other|field|none|candidate|democrats?|republicans?)\b/i.test(o);
  const ev = String(m.eventTitle || '');
  if (personish && (/^who will\b/i.test(ev) || /\b(election|winner|nominee|mayoral|primary)\b/i.test(ev))) return true;
  // a short proper noun in an awards/chart/ranking race ("Claude" in "Best AI at the end of 2026", a film for Best Picture)
  const ep = eventPhrase(ev);
  if (ws.length <= 5 && (/^the race for /.test(ep.phrase) || / at the Oscars$/.test(ep.phrase) || ep.prep === 'to win')) return true;
  return false;
}
function partyOf(m) {
  const t = String(m?.title || '');
  if (/\b(Democratic|Democrats?|Democratics)\b/.test(t) && !/\bRepublican/.test(t)) return 'Democrat';
  if (/\bRepublicans?\b/.test(t) && !/\bDemocra/.test(t)) return 'Republican';
  return null;
}

// What the market is about, as text that can follow "chance that".
export function clauseFor(m) {
  return questionToClause(m?.title) || null;
}
export function subjectFor(m) {
  if (!nameLike(m)) return null;
  const s = cleanOutcome(m.outcome);
  // Kalshi: "Will Democratic win the House race for NC-09?" with sub-title "Richard Ojeda" -> "Democrat Richard Ojeda"
  const party = m.source === 'kalshi' && !/^(Democrat|Republican|independent) /.test(s) && !/\b(nominee|nomination|primary)\b/i.test(String(m.eventTitle || '')) ? partyOf(m) : null;
  return party ? `${party} ${s}` : s;
}

// Board/ticker label for one outcome. Exchange placeholders ("None", "Other", "All 7") mean nothing on air:
// use the market's own question as a clause instead ("Republicans lose all seven key Senate seats").
const JUNK_OUTCOME = /^(none|other|all|all \d+|yes|no|field|any other)$/i;
const isLadderRung = (m) => (m?.tags || []).includes('kalshi:ladder') || m?.strike != null;
export function outcomeLabel(m) {
  if (!m) return '';
  const o = String(m.outcome || '').trim();
  const lp = (!o || isLadderRung(m)) && ladderParts(m);
  if (lp) return lp.phrase;
  if (o && !JUNK_OUTCOME.test(o) && !isLadderRung(m)) return dejargon(o);
  const clause = questionToClause(m.title);
  if (clause) return capFirst(tighten(clause));
  return o ? dejargon(o) : dejargon(stripQ(m.title || m.eventTitle || ''));
}
// Ticker/movers-board name and context: {label, context}. context is '' when the label already says it all.
// The client glues them as "<label> slips to 22% in <context>", so a label must read as a subject and a context must be
// a place ("AZ-02 House winner"), never a raw question ("How high will oil get?"), an ellipsis title or a bare date/number.
const RAW_Q = /^(?:[^:?]{0,30}:\s*)?(how|where|who|whom|which|what|when|why|will|is|are|does|do|did|can|should|would)\b|\.\.\.|…|_{2,}|\((?:higher|lower|middle|top) /i;
const isRawQuestion = (s) => RAW_Q.test(String(s || '').trim());
export function moverName(m) {
  if (!m) return { label: '', context: '' };
  const o = String(m.outcome || '').trim();
  const lp = (!o || isLadderRung(m)) && ladderParts(m);
  if (lp) return { label: lp.phraseIng, context: '' };
  if (isLadderRung(m)) return { label: outcomeLabel(m), context: '' };
  if (o && !JUNK_OUTCOME.test(o)) {
    // an event that is a question or a "by..." stub cannot follow "in": say the whole thing as one clause instead
    if (!isRawQuestion(m.eventTitle) && !isRawQuestion(m.title && /^(?:how|which|who|what|when|where)\b/i.test(m.title) ? m.title : '')) {
      return { label: dejargon(o), context: eventStub(m.eventTitle || '') };
    }
    const cl = questionToClause(m.title);
    for (const w of [cl && tighten(cl), tighten(marketLabel(m).replace(/:\s*$/, ''))]) {
      if (w && !isRawQuestion(w) && !/^\d/.test(w) && w.length > o.length + 6) return { label: /^[a-z][A-Z]/.test(w) ? w : capFirst(w), context: '' };
    }
    return { label: dejargon(o), context: '' };
  }
  if (o) return { label: outcomeLabel(m), context: '' };
  const clause = questionToClause(m.title);
  return { label: clause ? capFirst(tighten(clause)) : dejargon(stripQ(m.eventTitle || m.title || '')), context: '' };
}

// "What/Which <noun>/Who will be X?" or "Which <noun> will <verb> ...?" with a named outcome -> a statement the outcome
// completes. null when there is no usable outcome or the question does not map cleanly.
function whAnswer(m) {
  const o = cleanOutcome(m?.outcome);
  if (!o || JUNK_OUTCOME.test(o) || /^\d|^(above|below|at least|more than|less than)\b/i.test(o)) return null;
  // the market's own question first, else the event's ("120th Congress: Who will be Senate Minority Leader" + "John Thune")
  for (const src of [m.title, m.eventTitle]) {
    const raw = tighten(stripQ(dejargon(src || '')));
    const pre = raw.match(/^([^:?]{0,40}):\s*(?=(?:what|which|who)\b)/i);
    const t = pre ? raw.slice(pre[0].length) : raw;
    const where = pre && /^\d+(?:st|nd|rd|th) Congress$/i.test(pre[1].trim()) ? ` in the ${pre[1].trim()}` : '';
    let x;
    if ((x = t.match(/^(?:What|Which [a-z]+(?: [a-z]+)?|Who) (?:will|would) be (.+)$/i))) return `${o} is ${x[1]}${where}`;
    if ((x = t.match(/^(?:Which [a-z]+(?: [a-z]+)?|Who) will (?!be\b)([a-z]+) (.+)$/i)) && !/^(be|been|being)$/i.test(x[1])) {
      return `${o} ${conjugate(x[1].toLowerCase(), isPluralSubject(o.split(/\s+/)) === true)} ${x[2]}${where}`;
    }
  }
  return null;
}

function pickShortest(cands, max = HEADLINE_MAX) {
  const list = cands.filter(Boolean).map((s) => s.replace(/\s+/g, ' ').trim());
  return list.find((s) => s.length <= max) || list.sort((a, b) => a.length - b.length)[0] || '';
}

// ---------- market-level lines ----------
// For tickers and boards: "Jon Ossoff 29%, up 12 points today"
export function marketLine(m) {
  if (!m) return '';
  const label = marketLabel(m);
  const mv = m.change1d != null && Math.abs(m.change1d) >= 0.005 ? `, ${pts(m.change1d, 'today')}` : '';
  return `${label} ${pct(m.yesPrice)}${mv}`;
}
export function marketLabel(m) {
  if (!m) return '';
  const subj = subjectFor(m);
  if (subj) {
    const ev = eventPhrase(m.eventTitle);
    return ev.quoted ? (ev.inf ? `${subj} ${tighten(ev.inf)}` : subj) : `${shortOutcome(subj)}, ${ev.phrase.replace(/^the /, '')}`.replace(/^(.)/, (c) => c.toUpperCase());
  }
  const lp = (!m.outcome || isLadderRung(m)) && ladderParts(m);
  if (lp) return lp.phrase + ':';
  const clause = questionToClause(m.title);
  if (clause) return capFirst(tighten(clause)) + ':';
  const wa = whAnswer(m);
  if (wa) return capFirst(wa) + ':';
  return capFirst(dejargon(stripQ(m.outcome && !/^\d/.test(m.outcome) ? `${eventStub(m.eventTitle)} ${m.outcome}` : m.title))) + ':';
}
const capFirst = (s) => String(s || '').replace(/^(.)/, (c) => c.toUpperCase());

// ---------- story copy ----------
// Headlines state the data: subject + number + change ("Scott Colom jumps to 84% in the Mississippi Senate race",
// "Chance the Fed raises rates in December: 78%, up 4 points today"). Every line reads as a probability: it
// always carries "chance"/"odds" or a percentage tied to the subject, never "X will ..." and never "Bettors".
// Verbs vary with size and direction; the variant is seeded by the market id so a headline is stable between
// rebuilds but the board does not read as one template.
const seedOf = (s) => { let h = 2166136261; for (const c of String(s || '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function moveVerb(d, plural, seed) {
  const n = Math.round(Math.abs(d) * 100);
  const up = d > 0;
  const sets = up
    ? (n >= 20 ? [['surges', 'surge'], ['jumps', 'jump']] : n >= 10 ? [['jumps', 'jump'], ['climbs', 'climb']] : n >= 5 ? [['climbs', 'climb'], ['rises', 'rise']] : [['edges up', 'edge up'], ['rises', 'rise']])
    : (n >= 20 ? [['sinks', 'sink'], ['plunges', 'plunge']] : n >= 10 ? [['drops', 'drop'], ['falls', 'fall']] : n >= 5 ? [['falls', 'fall'], ['slips', 'slip']] : [['slips', 'slip'], ['eases', 'ease']]);
  return sets[seed % sets.length][plural ? 1 : 0];
}
const possessive = (s) => (/s$/.test(s) ? `${s}'` : `${s}'s`);

function oddsLine(m, mode, { max = HEADLINE_MAX } = {}) {
  const p = pct(m.yesPrice);
  const d = m.change1d ?? 0;
  const w = m.change1w ?? 0;
  // "What's moving now": when the last hour's move (PNN's own samples) is the notable one, the line says so.
  const h = m.change1h;
  const hourly = mode === 'mover' && h != null && Math.abs(h) >= 0.03 && (Math.abs(d) < 0.05 || Math.abs(h) >= 0.6 * Math.abs(d));
  const moved = mode === 'mover' && (hourly || Math.abs(d) >= 0.03);
  const weekMove = !moved && Math.abs(w) >= 0.08;
  const chg = hourly ? pts(h, 'in the last hour') : moved ? pts(d, 'today') : weekMove ? pts(w, 'this week') : '';
  const dd = hourly ? h : moved ? d : w;
  const whenMoved = hourly ? ' in the last hour' : '';
  const seed = seedOf(m.id || m.title);
  const subj = subjectFor(m);
  const ev = eventPhrase(m.eventTitle);
  const sc = shortClause(m.title);
  if (subj) {
    const short = shortOutcome(m.outcome).replace(/\s*\([^)]*\)$/, '');
    const evp = ev.quoted ? '' : ` ${ev.prep} ${ev.phrase}`;
    // "Where will the next talks take place?" -> "UAE's odds to host the next Russia-Ukraine peace talks jump to 94%"
    const inf = ev.inf && tighten(ev.inf);
    const infLine = () => {
      if (moved) {
        const vp = moveVerb(dd, true, seed);
        return pickShortest([`${possessive(subj)} odds ${inf} ${vp} to ${p}${whenMoved}`, `${p} chance ${subj} ${inf}, ${chg}`, `${subj} ${inf}: ${p}, ${chg}`], max);
      }
      const hold = seed % 3 === 0 ? 'steady at' : 'holds at';
      const tail = weekMove ? `, ${chg}` : '';
      return pickShortest([`${subj} ${hold} ${withArticle(p)} chance ${inf}${tail}`, `${subj} ${inf}: ${p}${tail}`, `${subj} ${inf}: ${p}`], max);
    };
    if (inf && /^Where\b/i.test(String(m.eventTitle || ''))) return infLine();
    // "Who will announce a presidential run?" -> "Chance Ron DeSantis announces presidential run before 2027"
    const last = short.split(/\s+/).pop();
    if (ev.quoted && sc && sc.includes(last)) {
      const c = sc;
      return pickShortest(moved || weekMove
        ? [`Chance ${c}: ${p}, ${chg}`, `${p} chance ${c}, ${chg}`, `Chance ${c}: ${p}`]
        : [`${p} chance ${c}`, `Chance ${c}: ${p}`], max);
    }
    if (inf) return infLine();
    if (moved || weekMove) {
      const v = moveVerb(dd, false, seed), vp = moveVerb(dd, true, seed);
      // "this week" belongs to the move ("up 24 points this week"), never glued onto the subject or race
      const when = moved ? whenMoved : `, ${chg}`;
      const a = seed % 2
        ? [`${possessive(subj)} odds ${vp} to ${p}${evp}${when}`, `${subj} ${v} to ${p}${evp}${when}`]
        : [`${subj} ${v} to ${p}${evp}${when}`, `${possessive(subj)} odds ${vp} to ${p}${evp}${when}`];
      return pickShortest([
        ...a,
        `${short} ${v} to ${p}${evp}${when}`,
        sc && `Chance ${sc}: ${p}, ${chg}`,
        sc && `Chance ${sc}: ${p}`,
        `${subj} ${v} to a ${p} chance${when}`,
      ], max);
    }
    const hold = seed % 3 === 0 ? 'steady at' : 'holds at';
    return pickShortest([
      `${subj} ${hold} ${withArticle(p)} chance${evp}`,
      `${short} ${hold} ${withArticle(p)} chance${evp}`,
      sc && `${capFirst(withArticle(p))} chance ${sc}`.replace(/^A /, '').replace(/^An /, ''),
      sc && `Chance ${sc}: ${p}`,
      `${subj} ${hold} ${withArticle(p)} chance`,
    ], max);
  }
  // "Will average gas prices be above $4.02?" -> "National gas price above $4.02 this week: 52% chance, up 6 points today"
  const lp = ladderParts(m);
  if (lp) {
    const bare = capFirst(`${lp.noun} ${lp.rel} ${lp.value}`);
    const cands = (moved || weekMove
      ? [`${lp.phrase}: ${p} chance, ${chg}`, `${lp.phrase}: ${p}, ${chg}`, `${lp.phrase}: ${p} chance`, `${bare}: ${p} chance, ${chg}`, `${bare}: ${p} chance`]
      : [`${lp.phrase}: ${p} chance`, `${bare}: ${p} chance`]);
    // a noun too long for a headline ("Number of statewide races won by ...") falls through to the clause forms
    if (cands.some((c) => c.length <= max)) return pickShortest(cands, max);
  }
  const clause = questionToClause(m.title);
  if (clause) {
    const c2 = tighten(clause);
    const cs = [c2, sc].filter((x, i, arr) => x && arr.indexOf(x) === i);
    if (moved || weekMove) {
      const v = moveVerb(dd, false, seed), vp = moveVerb(dd, true, seed);
      const when = moved ? whenMoved : '';
      // "Odds <clause> jump to 63%" only reads cleanly when the clause is short (and, for a week move, the move phrase
      // already says "this week", so that form is skipped)
      const forms = (c) => [
        `Chance ${c}: ${p}, ${chg}`,
        c.length <= 48 && (moved || !weekMove) && `Odds ${c} ${vp} to ${p}${when}`,
        `${p} chance ${c}, ${chg}`,
      ].filter(Boolean);
      void v;
      // margin brackets ("by 12 points or more") read badly after "Odds ... jump": lead with the number
      const marginy = /\bby \d+(?:\.\d+)? (?:to \d+(?:\.\d+)? )?points\b/.test(c2);
      const order = (c) => { const f = forms(c); if (marginy) return [f[2], f[0]]; const k = seed % f.length; return [...f.slice(k), ...f.slice(0, k)]; };
      return pickShortest([...cs.flatMap(order), ...cs.map((c) => `Chance ${c}: ${p}`)], max);
    }
    const forms = (c) => (seed % 2 ? [`${p} chance ${c}`, `Chance ${c}: ${p}`] : [`Chance ${c}: ${p}`, `${p} chance ${c}`]);
    return pickShortest(cs.flatMap(forms), max);
  }
  // No parse: quote the market question, or "outcome" inside the event.
  const q = stripParens(m.outcome && !nameLike(m)
    ? `${eventStub(m.eventTitle)} ${dejargon(m.outcome)}`
    : stripQ(dejargon(m.title))).replace(/\.\.\.|…/g, '').replace(/\s+/g, ' ');
  const pw = String(m.outcome || '').match(/^(Democratic|Republican) [Pp]arty$/) && stripQ(String(m.eventTitle || '')).match(/^(.+?) winner$/i);
  if (pw) {
    const c = `${/^D/.test(m.outcome) ? 'Democrats' : 'Republicans'} win the ${pw[1]}`;
    return pickShortest(moved || weekMove ? [`Chance ${c}: ${p}, ${chg}`, `Chance ${c}: ${p}`] : [`Chance ${c}: ${p}`], max);
  }
  // "What will be the largest source of energy in 2030?" with outcome "Oil" -> "Oil is the largest source of energy in 2030"
  const wa = whAnswer(m);
  if (wa) {
    return pickShortest(moved || weekMove ? [`Chance ${wa}: ${p}, ${chg}`, `${p} chance ${wa}, ${chg}`, `Chance ${wa}: ${p}`] : [`Chance ${wa}: ${p}`, `${p} chance ${wa}`], max);
  }
  const np = nounPhrase(q);
  if (np) {
    return pickShortest(moved || weekMove ? [`Chance of ${np}: ${p}, ${chg}`, `Chance of ${np}: ${p}`] : [`Chance of ${np}: ${p}`], max);
  }
  if (moved || weekMove) {
    return pickShortest([`“${q}”: ${p} chance, ${chg}`, `“${q}” ${moveVerb(dd, false, seed)} to ${p}`, `“${q}”: ${p} chance`], max);
  }
  return pickShortest([`“${q}”: ${p} chance`], max);
}

export function storyHeadline(story) {
  const m = story?.lead;
  if (!m) return story?.eventTitle || '';
  return oddsLine(m, story.kind === 'mover' ? 'mover' : 'favorite');
}

// ---------- short headline (cards / focus) ----------
// Cards already show the big % and the move line, so the on-card headline only says WHAT is priced:
// "Chance of an Iran-Oman Hormuz management agreement by December 31: 32%, up 6 points today"
//   -> "Iran-Oman Hormuz deal by Dec 31". Works on oddsLine's own (finite) output shapes, then tightens words.
const NUM = String.raw`[<>]?\d+%`;
const MOVE_TAIL = String.raw`(?:,\s*(?:up|down) \d+ points? (?:today|this week|in the last hour))?`;
const VERB = String.raw`(?:surges?|jumps?|climbs?|rises?|edges? up|slips?|eases?|falls?|drops?|sinks?|plunges?|holds? at|steady at)`;
const SHORT_SHAPES = [
  [new RegExp(String.raw`^${NUM} chance (.+?)${MOVE_TAIL}$`), (m) => m[1]],
  [new RegExp(String.raw`^Chance (?:of )?(.+?): ${NUM}${MOVE_TAIL}$`), (m) => m[1]],
  [new RegExp(String.raw`^(.+?): ${NUM} chance${MOVE_TAIL}$`), (m) => m[1]],
  [new RegExp(String.raw`^Odds (.+?) ${VERB} (?:to )?${NUM}$`), (m) => m[1]],
  [new RegExp(String.raw`^(.+?)'s? odds (to .+?) ${VERB} to ${NUM}$`), (m) => `${m[1]} ${m[2]}`],
  [new RegExp(String.raw`^(.+?)(?:'s?)? odds ${VERB} (?:to )?${NUM} (in|for|to) (.+)$`), (m) => `${m[1]} ${m[2]} ${m[3]}`],
  [new RegExp(String.raw`^(.+?) ${VERB} (?:to )?(?:a )?${NUM}(?: chance)? (in|for|to) (.+)$`), (m) => `${m[1]} ${m[2]} ${m[3]}`],
  [new RegExp(String.raw`^(.+?) ${VERB} (?:to )?(?:a )?${NUM}(?: chance)?$`), (m) => m[1]],
  [new RegExp(String.raw`^“(.+?)”.*$`), (m) => m[1]],
];
const MONTH_ABBR = { January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr', August: 'Aug', September: 'Sept', October: 'Oct', November: 'Nov', December: 'Dec' };
const TIGHTEN = [
  [/\bin the Oscars \d{4}: (.+?) race\b/g, 'for $1 Oscar'], [/\bdeclares election interference national emergency\b/g, 'declares election emergency'],
  [/\breceives the first mandate to form a government\b/g, 'gets first mandate to govern'], [/\bis out as\b/g, 'out as'],
  [/\bwins the\b/g, 'wins'], [/\bby (\d+) points or more\b/g, 'by $1+ pts'], [/ that (?=\w+ exist)/g, ' '],
  [/\bin the race for\b/g, 'for'], [/^the race for /i, ''], [/\bin the (.+?) race\b/g, 'in $1 race'],
  [/\bthe next\b/g, 'next'], [/\bin the next\b/g, 'in next'],
  [/\bSecretary of Defense\b/g, 'Defense Secretary'], [/\bprime minister\b/gi, 'PM'],
  [/\bpresidential election\b/g, 'election'], [/\bannounces a presidential run\b/g, 'runs for president'],
  [/\bRepublicans\b/g, 'GOP'], [/\bDemocrats\b/g, 'Dems'], [/\bin the 1\d\dth Congress\b/g, 'next Congress'],
  [/\b(agreement|agreements)\b/g, 'deal'], [/\bmanagement deal\b/g, 'deal'], [/\bsenior diplomatic meeting\b/g, 'senior talks'],
  [/\bRotten Tomatoes score\b/g, 'RT score'], [/\breaches (?=\$\d)/g, 'hits '], [/ a barrel\b/g, ''], [/\ba quarter point\b/g, 'a quarter point'],
  [/\bat the end of (\d{4}|December|this month)\b/g, 'by end of $1'], [/\bin the Oscars \d{4}: (.+?) race\b/g, 'for $1 Oscar'],
  [/\bis released\b/g, 'out'], [/\bhas the best AI model\b/g, 'tops AI rankings'],
  [/\s*\([^)]*\)/g, ''], [/^(?:the|a|an) /i, ''], [/^Chance (?:of )?/i, ''],
];
export function shortHeadline(headline) {
  let t = String(headline || '').trim();
  if (!t) return t;
  t = t.replace(/,\s*(?:up|down) \d+ points? (?:today|this week|in the last hour)$/, '');   // the card shows the move
  t = t.replace(/(?<!\bpoints?) in the last hour$/, '');   // "X jumps to 45% in the Senate race in the last hour"
  for (const [re, f] of SHORT_SHAPES) { const m = t.match(re); if (m) { t = f(m); break; } }
  for (const [re, rep] of TIGHTEN) t = t.replace(re, rep);
  t = t.replace(/\b(January|February|March|April|August|September|October|November|December)\b/g, (x) => MONTH_ABBR[x] || x);
  t = t.replace(/\bGOP (lose|win|hold|keep|gain|flip)\b/g, 'GOP $1s');
  t = t.replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function storyDek(story) {
  const m = story?.lead;
  if (!m) return '';
  const bits = [];
  // A ladder airs on its line; the dek gives the rungs either side ("Above $4.00: 92% · above $4.04: 8%.").
  const nb = (story.rungs || []).filter((r) => !r.lead && r.label);
  if (nb.length) bits.push(capFirst(nb.map((r) => `${r.label}: ${pct(r.yesPrice)}`).join(' · ')) + '.');
  const d1 = m.change1d, d1w = m.change1w;
  const hasDay = d1 != null && Math.abs(d1) >= 0.01;
  const hasWeek = d1w != null && Math.abs(d1w) >= 0.02 && Math.abs(d1w - (d1 ?? 0)) >= 0.05;
  const who = subjectFor(m);
  const leadName = who ? who : 'That';
  // Movement sentence (skip the part the headline already says).
  const hl = story.headline || '';
  if (hasDay && hl.includes(pts(d1, 'today'))) {
    if (hasWeek) bits.push(`${who ? who + ' is' : "That's"} ${pts(d1w, 'this week')}.`);
  } else if (!hasDay && hasWeek && hl.includes(pts(d1w, 'this week'))) {
    // nothing to add
  } else if (hasDay && hasWeek) bits.push(`${who ? who + ' is' : "That's"} ${pts(d1, 'today')} and ${pts(d1w, 'this week')}.`);
  else if (hasDay) bits.push(`${who ? who + ' is' : "That's"} ${pts(d1, 'today')}.`);
  else if (hasWeek) bits.push(`${who ? who + ' is' : "That's"} ${pts(d1w, 'this week')}.`);
  else if (story.kind !== 'mover' && d1 != null && !(Math.abs(m.change1h ?? 0) >= 0.03)) bits.push(`${who ? who + ' is' : 'The price is'} steady today.`);
  // The last hour, when it moved and the headline did not already say so.
  const h1 = m.change1h;
  if (h1 != null && Math.abs(h1) >= 0.03 && !hl.includes(pts(h1, 'in the last hour'))) bits.push(`${capFirst(pts(h1))} in the last hour.`);
  // Context: rival outcome or the favorite.
  const others = story.ladder ? [] : (story.markets || []).filter((x) => x.id !== m.id);
  if (others.length) {
    const top = [...others].sort((a, b) => b.yesPrice - a.yesPrice)[0];
    const plainOutcome = top.outcome && /^[A-Za-z][a-z]+(\s+\S+)+$/.test(top.outcome) && !/,/.test(top.outcome) ? `“${dejargon(top.outcome)}”` : null;
    const holdish = /^(no change|maintain(s)? (current )?rates?|hold(s)?( rates)?|unchanged|pause)$/i.test(String(top.outcome || '').trim());
    const bracket = /\d/.test(String(top.outcome || '')) && !subjectFor(top);
    const partyName = { democratic: 'Democrats', republican: 'Republicans' }[String(top.outcome || '').match(/^(Democratic|Republican) party$/i)?.[1]?.toLowerCase()];
    const topName = subjectFor(top) || partyName || (holdish ? 'no change' : bracket ? rungLabel(top) : plainOutcome);
    if (topName && top.yesPrice >= 0.02) {
      bits.push(top.yesPrice > m.yesPrice ? `The favorite is still ${topName}, at ${pct(top.yesPrice)}.` : `Next is ${topName} at ${pct(top.yesPrice)}.`);
    }
  }
  // Clock.
  if (story.closesAt || m.closesAt) {
    const ms = Date.parse(story.closesAt || m.closesAt) - (story._now ?? Date.now());
    if (ms > 0 && ms < 7 * 864e5) {
      const days = Math.round(ms / 864e5);
      const hrs = Math.round(ms / 36e5);
      bits.push(`The market closes ${hrs < 36 ? `in ${Math.max(1, hrs)} hour${hrs === 1 ? '' : 's'}` : `in ${days} days`}.`);
    }
  }
  if (story.thin) bits.push(`Thin market: ${money(Math.max(m.volume24h || 0, ...(story.sourceVolumes || []).map((x) => x.volume24h || 0)))} traded in 24 hours.`);
  void leadName;
  if (!bits.length) {
    const vol = Math.max(m.volume24h || 0, ...(story.sourceVolumes || []).map((x) => x.volume24h || 0));
    if (vol > 0) bits.push(`${money(vol)} traded in the last 24 hours.`);
  }
  return bits.slice(0, nb.length ? 4 : 3).join(' ');
}

// ---------- swings (watchability #2) ----------
// Banner title for a swing card. The same string rides on story.swing.title so the client never imports server code.
const SHAPE_TITLES = { swing: 'BIGGEST SWINGS', longshot: 'LONGSHOTS ON THE MOVE', slipping: 'FAVORITES SLIPPING' };
export function shapeTitle(shape) {
  return SHAPE_TITLES[shape] || SHAPE_TITLES.swing;
}
// "Yesterday 14%, now 92%" (or "An hour ago 40%, now 46%" for a last-hour swing). '' when there is no swing.
export function swingLine(story) {
  const w = story?.swing;
  if (!w || !Number.isFinite(w.from) || !Number.isFinite(w.to)) return '';
  return `${w.window === '1h' ? 'An hour ago' : 'Yesterday'} ${pct(w.from)}, now ${pct(w.to)}`;
}

// ---------- breaking ----------
// The takeover shows from -> to big, so the headline is kept short (user rule: short headlines).
const ALERT_MAX = 64;
export function alertCopy(market, from, to, minutes) {
  const m = { ...market, yesPrice: to, change1d: to - from };
  const headline = oddsLine(m, 'mover', { max: ALERT_MAX });
  const mins = Math.max(1, Math.round(minutes || 0));
  const span = mins >= 90 ? `${Math.round(mins / 60)} hours` : `${mins} minute${mins === 1 ? '' : 's'}`;
  const src = market?.source === 'kalshi' ? 'Kalshi' : 'Polymarket';
  const line = `${capFirst(pts(to - from))} in ${span} on ${src}, from ${pct(from)} to ${pct(to)}.`;
  return { headline, line };
}

// ---------- news search ----------
const MONTHS = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)';
export function newsQuery(story) {
  const m = story?.lead || {};
  const subj = subjectFor(m);
  let base;
  if (subj) base = `${cleanOutcome(m.outcome).replace(/^(Democrat|Republican|independent) /, '')} ${eventPhrase(story.eventTitle || m.eventTitle).phrase}`;
  else base = questionToClause(m.title) || m.title || story?.eventTitle || '';
  let q = dejargon(stripParens(base))
    .replace(/[“”"?]/g, ' ')
    .replace(/^Will\s+/i, '')
    .replace(new RegExp(`\\b${MONTHS}\\s+\\d{1,2}(?!\\d)(st|nd|rd|th)?(,\\s*\\d{4})?`, 'gi'), ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(by|before|through|after) (the )?(end of )?(\d{4}|\.\.\.)/gi, ' ')
    .replace(/\.\.\./g, ' ')
    .replace(/\b(the|a|an|that|is|are|be|of|to|for|in|on|at|its|by|before|after|through|race|chance)\b/gi, ' ')
    .replace(/[^\w\s'&.$%-]/g, ' ')
    .replace(/(^|\s)[.$%]+|[.]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = q.split(' ').filter(Boolean);
  return words.slice(0, 8).join(' ');
}

export default { shapeTitle, swingLine, shortHeadline, pct, pts, money, marketLine, marketLabel, outcomeLabel, moverName, storyHeadline, storyDek, alertCopy, newsQuery, questionToClause, eventPhrase, cleanOutcome, dejargon };
