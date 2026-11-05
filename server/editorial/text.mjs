// Small text helpers shared by the news wire (clustering) and the news-to-market matcher.
//
// decodeEntities(s) -> plain text (CDATA, tags and HTML entities removed, whitespace collapsed)
// tokens(s)         -> string[] normalized content tokens (lowercase, stop words dropped, light stemming,
//                      a few multi-word synonyms folded: "federal reserve" -> fed, "supreme court" -> scotus)
// tokenSet(s)       -> Set of tokens(s)
// jaccard(a, b), overlapCoef(a, b) on Sets

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')            // entity-encoded markup inside descriptions
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeChar(+n))
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&rsquo;|&lsquo;/g, "'").replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
const safeChar = (n) => { try { return String.fromCodePoint(n); } catch { return ''; } };

export const STOP = new Set((
  'a an the and or but if of to in on at by for from with without into onto over under about after before ' +
  'as is are was were be been being am do does did done has have had having it its it\'s this that these those ' +
  'he she they them his her their we our you your i me my us\'s not no yes so than then there here what which who ' +
  'whom whose when where why how all any some more most less least very just also only up down out off again ' +
  'new news says say said saying report reports reported reportedly amid via per vs could would should may might ' +
  'can will won\'t wont must shall get gets got make makes made take takes took one two three first last next ' +
  'year years week weeks day days today tonight yesterday tomorrow now live update updates latest breaking ' +
  'video watch look inside first-ever plans plan set sets according like back still even much many big top ' +
  'mr mrs ms dr st co inc ltd too close call calls begin begins million millions billion billions trillion percent per cent'
).split(/\s+/));

// Multi-word synonyms folded before tokenizing (both news and market text get the same treatment).
const PHRASES = [
  [/\bu\.s\.a?\.?(?=\s|$|[,;:])/gi, ' us '],
  [/\bu\.k\.(?=\s|$|[,;:])/gi, ' uk '],
  [/\bunited states\b/gi, ' us '],
  [/\bunited kingdom\b|\bbritain\b|\bbritish\b/gi, ' uk '],
  [/\bfederal reserve\b|\bfomc\b/gi, ' fed '],
  [/\bsupreme court\b|\bscotus\b/gi, ' scotus '],
  [/\binterest rates?\b/gi, ' rate '],
  [/\bbasis points?\b|\bbps\b/gi, ' bps '],
  [/\bnew york city\b|\bnyc\b/gi, ' nyc '],
  [/\bprime minister\b/gi, ' pm '],
  [/\bartificial intelligence\b/gi, ' ai '],
  [/\bwhite house\b/gi, ' whitehouse '],
  [/\bwall street\b/gi, ' wallstreet '],
  [/\bhouse of representatives\b/gi, ' house '],
  [/\bnew york\b/gi, ' newyork '],
  [/\bhong kong\b/gi, ' hongkong '],
  [/\bsouth korea\b/gi, ' southkorea '],
  [/\bnorth korea\b/gi, ' northkorea '],
  [/\bdow jones\b/gi, ' dow '],
  // Multi-word places as one token, so a shared place name counts once.
  [/\b(north|south) (carolina|dakota)\b/gi, ' $1$2 '],
  [/\bnew (jersey|mexico|hampshire|zealand|delhi)\b/gi, ' new$1 '],
  [/\b(west virginia|rhode island|puerto rico|los angeles|san francisco|san diego|las vegas|el salvador|costa rica|sri lanka|saudi arabia|south africa|united nations|european union|middle east|latin america|silicon valley|capitol hill|downing street)\b/gi, (m) => ' ' + m.replace(/\s+/g, '').toLowerCase() + ' '],
  [/\bs&p 500\b|\bs&p\b/gi, ' sp500 '],
  [/\bchatgpt\b/gi, ' openai chatgpt '],
];

const STEM_KEEP = /(ss|us|is|as|os|ics|ous|ies)$/;
function stem(t) {
  if (/^\d/.test(t)) return t;
  if (t.endsWith("'s")) t = t.slice(0, -2);
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('s') && !STEM_KEEP.test(t)) return t.slice(0, -1);
  return t;
}

export function tokens(s) {
  let t = String(s ?? '').replace(/[’‘`]/g, "'");
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  t = t.toLowerCase().replace(/'s\b/g, '').replace(/[^a-z0-9%'+.-]+/g, ' ');
  const out = [];
  for (let w of t.split(/\s+/)) {
    w = w.replace(/^[^a-z0-9]+|[^a-z0-9%]+$/g, '').replace(/'/g, '');
    if (!w || STOP.has(w)) continue;
    if (w.length < 2 && !/^\d$/.test(w)) continue;
    w = stem(w);
    if (!w || STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}

export const tokenSet = (s) => new Set(tokens(s));

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

export function overlapCoef(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
}

export function sharedCount(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

// Exchange titles sometimes paste rules text into the question or outcome: "Any member of the Cabinet (defined as: the Vice
// President, Secretary of State, ...)". A parenthetical that defines, lists or explains (or is simply long) is rules text,
// never on-air copy: drop it. Short ones ("(D)", "(AZ-02)") stay. An unclosed "(defined as: ..." cut upstream is dropped too.
const RULES_PAREN = /\s*\((?:[^()]*\b(?:defined as|as defined|i\.e\.|e\.g\.|including|includes|excluding|see rules|for the purposes? of|refers? to|means)\b[^()]*|[^()]{48,})\)/gi;
export function stripRulesText(s) {
  let out = String(s ?? '');
  if (!out.includes('(')) return out;
  out = out.replace(RULES_PAREN, '').replace(/\s*\((?:defined as|as defined|i\.e\.|e\.g\.|including)\b[^)]*$/i, '');
  return out.replace(/\s+([?,.!:;])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export default { stripRulesText, decodeEntities, tokens, tokenSet, jaccard, overlapCoef, sharedCount, STOP };
