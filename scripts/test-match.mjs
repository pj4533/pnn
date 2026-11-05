// Story <-> headline matcher regression cases (news-gate build, 2026-11-05; docs/PLAN-news-gate.md section 3). No network.
//
//   node scripts/test-match.mjs            run every case; exit 1 on any failure
//   PNN_MATCH_DEBUG=1 node scripts/test-match.mjs   also print the matcher's reasons (lead miss, frame miss, event ok ...)
//
// Markets are real (Polymarket + Kalshi, 2026-11-05) and the word rarity (IDF) the matcher uses is reproduced exactly from
// the full index: N_EVENTS background events carry each token in as many events as it appeared in then. Headlines come from
// research/news-gate-baseline.md. Covers: event-level matching (option 3), the race-result lever, the matcher weak spots
// (central banks, proper-noun runs, brand-as-frame, state legislatures, podcast items) and the sensitive / site-title
// headline filter (DECISIONS D4, QUEUED-FIXES 16).
import { matchStoryNews, buildHeadlineIndex, headlineReject, scopeMismatch } from '../server/editorial/match.mjs';
import { tokenSet } from '../server/editorial/text.mjs';

// [id, eventId (0 = same as id), eventTitle, title, outcome, yesPrice, category, kalshi strike ladder]
const MARKETS = [
  ["ks:KXRATEHIKE-2026-2","ks:KXRATEHIKE-2026","Number of rate hikes in 2026?","Will there be exactly 2 Fed rate hikes in 2026?","Exactly 2",0.68,"economy",0],
  ["ks:KXRATEHIKE-2026-1","ks:KXRATEHIKE-2026","Number of rate hikes in 2026?","Will there be exactly 1 Fed rate hike in 2026?","Exactly 1",0.34,"economy",0],
  ["pm:2657590","pm:626860","How many Fed rate hikes in 2026?","Will 2 Fed rate hikes happen in 2026?","2 (50 bps)",0.685,"economy",0],
  ["pm:2657589","pm:626860","How many Fed rate hikes in 2026?","Will 1 Fed rate hike happen in 2026?","1 (25 bps)",0.305,"economy",0],
  ["pm:2657591","pm:626860","How many Fed rate hikes in 2026?","Will 3 Fed rate hikes happen in 2026?","3 (75 bps)",0.0045,"economy",0],
  ["ks:KXSCOURT-29-JSAU","ks:KXSCOURT-29","Who will be the next Supreme Court justice?","Will D. John Sauer become the next Justice on the Supreme Court?","D. John Sauer",0.13,"politics",0],
  ["ks:KXSCOURT-29-TED","ks:KXSCOURT-29","Who will be the next Supreme Court justice?","Will Ted Cruz become the next Justice on the Supreme Court?","Ted Cruz",0.08,"politics",0],
  ["ks:KXSCOURT-29-AO","ks:KXSCOURT-29","Who will be the next Supreme Court justice?","Will Andrew Oldham become the next Justice on the Supreme Court?","Andrew Oldham",0.067,"politics",0],
  ["ks:KXSCOURT-29-JH","ks:KXSCOURT-29","Who will be the next Supreme Court justice?","Will James Ho become the next Justice on the Supreme Court?","James Ho",0.056,"politics",0],
  ["ks:KXSCOURT-29-ML","ks:KXSCOURT-29","Who will be the next Supreme Court justice?","Will Mike Lee become the next Justice on the Supreme Court?","Mike Lee",0.041,"politics",0],
  ["ks:KXSCOURT-29-MP","ks:KXSCOURT-29","Who will be the next Supreme Court justice?","Will Michael Park become the next Justice on the Supreme Court?","Michael Park",0.026,"politics",0],
  ["pm:2293862","pm:498879","Next James Bond actor?","Callum Turner announced as next James Bond?","Callum Turner",0.446,"culture",0],
  ["pm:2293863","pm:498879","Next James Bond actor?","Jack Lowden announced as next James Bond?","Jack Lowden",0.222,"culture",0],
  ["pm:2293900","pm:498879","Next James Bond actor?","No one announced as next James Bond?","No Bond chosen",0.1765,"culture",0],
  ["pm:2293866","pm:498879","Next James Bond actor?","Josh O'Connor announced as next James Bond?","Josh O'Connor",0.054,"culture",0],
  ["pm:2293872","pm:498879","Next James Bond actor?","Tom Francis announced as next James Bond?","Tom Francis",0.028,"culture",0],
  ["pm:2293874","pm:498879","Next James Bond actor?","Jack O'Connell announced as next James Bond?","Jack O'Connell",0.005,"culture",0],
  ["pm:5939179","pm:1219790","Who will receive the first mandate to form Israel's next government?","Will Gadi Eizenkot receive the first mandate to form a government after the 2026 Israeli election?","Gadi Eizenkot",0.9815,"world",0],
  ["pm:5939176","pm:1219790","Who will receive the first mandate to form Israel's next government?","Will Benjamin Netanyahu receive the first mandate to form a government after the 2026 Israeli election?","Benjamin Netanyahu",0.019,"world",0],
  ["pm:5939177","pm:1219790","Who will receive the first mandate to form Israel's next government?","Will Naftali Bennett receive the first mandate to form a government after the 2026 Israeli election?","Naftali Bennett",0.0005,"world",0],
  ["pm:5939178","pm:1219790","Who will receive the first mandate to form Israel's next government?","Will Yair Lapid receive the first mandate to form a government after the 2026 Israeli election?","Yair Lapid",0.0005,"world",0],
  ["pm:5939180","pm:1219790","Who will receive the first mandate to form Israel's next government?","Will Benny Gantz receive the first mandate to form a government after the 2026 Israeli election?","Benny Gantz",0.0005,"world",0],
  ["pm:5939181","pm:1219790","Who will receive the first mandate to form Israel's next government?","Will Avigdor Lieberman receive the first mandate to form a government after the 2026 Israeli election?","Avigdor Lieberman",0.0005,"world",0],
  ["ks:KXISRFIRSTMANDATE-27-GEIS","ks:KXISRFIRSTMANDATE-27","Who will get Israel's first mandate to form a government?","Will it be reported by The Times of Israel that the President of Israel gives Gadi Eisenkot the first mandate to form a government following the 2026 Knesset election before Jan 1, 2027?","Gadi Eisenkot",0.98,"politics",0],
  ["ks:KXISRFIRSTMANDATE-27-BNET","ks:KXISRFIRSTMANDATE-27","Who will get Israel's first mandate to form a government?","Will it be reported by The Times of Israel that the President of Israel gives Benjamin Netanyahu the first mandate to form a government following the 2026 Knesset election before Jan 1, 2027?","Benjamin Netanyahu",0.03,"politics",0],
  ["ks:KXISRFIRSTMANDATE-27-ALIE","ks:KXISRFIRSTMANDATE-27","Who will get Israel's first mandate to form a government?","Will it be reported by The Times of Israel that the President of Israel gives Avigdor Lieberman the first mandate to form a government following the 2026 Knesset election before Jan 1, 2027?","Avigdor Lieberman",0.01,"politics",0],
  ["ks:KXHOUSERACE-AZ05-26-R","ks:KXHOUSERACE-AZ05-26","AZ-05 House winner?","Will the Republican win the House race for AZ-05?","Mark Lamb",0.949,"elections",0],
  ["ks:KXHOUSERACE-AZ05-26-D","ks:KXHOUSERACE-AZ05-26","AZ-05 House winner?","Will the Democrat win the House race for AZ-05?","Elizabeth Lee",0.048,"elections",0],
  ["ks:KXMIDTERMMOV-OHGOVD-P1","ks:KXMIDTERMMOV-OHGOVD","Ohio Governor margin of victory","Will the margin of victory for Democrats in the governor election in Ohio be at least 1 percentage points?","Acton, 1+ pts",0.999,"elections",1],
  ["ks:KXMIDTERMMOV-OHGOVD-P5","ks:KXMIDTERMMOV-OHGOVD","Ohio Governor margin of victory","Will the margin of victory for Democrats in the governor election in Ohio be at least 5 percentage points?","Acton, 5+ pts",0.998,"elections",1],
  ["ks:KXMIDTERMMOV-OHGOVD-P2","ks:KXMIDTERMMOV-OHGOVD","Ohio Governor margin of victory","Will the margin of victory for Democrats in the governor election in Ohio be at least 2 percentage points?","Acton, 2+ pts",0.997,"elections",1],
  ["ks:KXMIDTERMMOV-OHGOVD-P3","ks:KXMIDTERMMOV-OHGOVD","Ohio Governor margin of victory","Will the margin of victory for Democrats in the governor election in Ohio be at least 3 percentage points?","Acton, 3+ pts",0.99,"elections",1],
  ["ks:KXMIDTERMMOV-OHGOVD-P4","ks:KXMIDTERMMOV-OHGOVD","Ohio Governor margin of victory","Will the margin of victory for Democrats in the governor election in Ohio be at least 4 percentage points?","Acton, 4+ pts",0.987,"elections",1],
  ["ks:KXMIDTERMMOV-OHGOVD-P7","ks:KXMIDTERMMOV-OHGOVD","Ohio Governor margin of victory","Will the margin of victory for Democrats in the governor election in Ohio be at least 7 percentage points?","Acton, 7+ pts",0.985,"elections",1],
  ["ks:KXMIDTERMMOV-OHGOVD-P8","ks:KXMIDTERMMOV-OHGOVD","Ohio Governor margin of victory","Will the margin of victory for Democrats in the governor election in Ohio be at least 8 percentage points?","Acton, 8+ pts",0.69,"elections",1],
  ["ks:KXMIDTERMMOV-TXSEND-P1.5","ks:KXMIDTERMMOV-TXSEND","Texas Senate margin of victory","Will the margin of victory for Democrats in the U.S. Senate election in Texas be at least 1.5 percentage points?","James Talarico, 1.5+ pts",0.999,"elections",1],
  ["ks:KXMIDTERMMOV-TXSEND-P0.5","ks:KXMIDTERMMOV-TXSEND","Texas Senate margin of victory","Will the margin of victory for Democrats in the U.S. Senate election in Texas be at least 0.5 percentage points?","James Talarico, 0.5+ pts",0.998,"elections",1],
  ["ks:KXMIDTERMMOV-TXSEND-P1","ks:KXMIDTERMMOV-TXSEND","Texas Senate margin of victory","Will the margin of victory for Democrats in the U.S. Senate election in Texas be at least 1 percentage points?","James Talarico, 1+ pts",0.998,"elections",1],
  ["ks:KXMIDTERMMOV-TXSEND-P2","ks:KXMIDTERMMOV-TXSEND","Texas Senate margin of victory","Will the margin of victory for Democrats in the U.S. Senate election in Texas be at least 2 percentage points?","James Talarico, 2+ pts",0.998,"elections",1],
  ["ks:KXMIDTERMMOV-TXSEND-P2.5","ks:KXMIDTERMMOV-TXSEND","Texas Senate margin of victory","Will the margin of victory for Democrats in the U.S. Senate election in Texas be at least 2.5 percentage points?","James Talarico, 2.5+ pts",0.998,"elections",1],
  ["ks:KXMIDTERMMOV-TXSEND-P3","ks:KXMIDTERMMOV-TXSEND","Texas Senate margin of victory","Will the margin of victory for Democrats in the U.S. Senate election in Texas be at least 3 percentage points?","James Talarico, 3+ pts",0.998,"elections",1],
  ["ks:KXMIDTERMMOV-TXSEND-P13","ks:KXMIDTERMMOV-TXSEND","Texas Senate margin of victory","Will the margin of victory for Democrats in the U.S. Senate election in Texas be at least 13 percentage points?","James Talarico, 13+ pts",0.059,"elections",1],
  ["ks:KXMIDTERMMOV-ALSENR-P11","ks:KXMIDTERMMOV-ALSENR","Alabama Senate margin of victory","Will the margin of victory for Republicans in the U.S. Senate election in Alabama be at least 11 percentage points?","Moore, 11+ pts",0.056,"elections",1],
  ["ks:KXMIDTERMMOV-ALSENR-P13","ks:KXMIDTERMMOV-ALSENR","Alabama Senate margin of victory","Will the margin of victory for Republicans in the U.S. Senate election in Alabama be at least 13 percentage points?","Moore, 13+ pts",0.05,"elections",1],
  ["ks:KXMIDTERMMOV-ALSENR-P17","ks:KXMIDTERMMOV-ALSENR","Alabama Senate margin of victory","Will the margin of victory for Republicans in the U.S. Senate election in Alabama be at least 17 percentage points?","Moore, 17+ pts",0.021,"elections",1],
  ["ks:KXMIDTERMMOV-ALSENR-P15","ks:KXMIDTERMMOV-ALSENR","Alabama Senate margin of victory","Will the margin of victory for Republicans in the U.S. Senate election in Alabama be at least 15 percentage points?","Moore, 15+ pts",0.019,"elections",1],
  ["ks:KXMIDTERMMOV-ALSENR-P23","ks:KXMIDTERMMOV-ALSENR","Alabama Senate margin of victory","Will the margin of victory for Republicans in the U.S. Senate election in Alabama be at least 23 percentage points?","Moore, 23+ pts",0.019,"elections",1],
  ["ks:KXMIDTERMMOV-ALSENR-P19","ks:KXMIDTERMMOV-ALSENR","Alabama Senate margin of victory","Will the margin of victory for Republicans in the U.S. Senate election in Alabama be at least 19 percentage points?","Moore, 19+ pts",0.017,"elections",1],
  ["pm:6353937","pm:1273034","Fed Decision in April?","Will there be no change in Fed interest rates after the April 2027 meeting?","No change",0.605,"economy",0],
  ["pm:6353938","pm:1273034","Fed Decision in April?","Will the Fed increase interest rates by 25 bps after the April 2027 meeting?","25 bps increase",0.16,"economy",0],
  ["pm:6353936","pm:1273034","Fed Decision in April?","Will the Fed decrease interest rates by 25 bps after the April 2027 meeting?","25 bps decrease",0.09,"economy",0],
  ["ks:KXOSCARACTR-27-JUL","ks:KXOSCARACTR-27","Oscar winner: Best Actress","Will Julianne Moore win Best Actress at the Oscars?","Julianne Moore",0.74,"culture",0],
  ["ks:KXOSCARACTR-27-IND","ks:KXOSCARACTR-27","Oscar winner: Best Actress","Will Inde Navarrette win Best Actress at the Oscars?","Inde Navarrette",0.16,"culture",0],
  ["ks:KXOSCARACTR-27-ANN","ks:KXOSCARACTR-27","Oscar winner: Best Actress","Will Anne hathaway win Best Actress at the Oscars?","Anne hathaway",0.02,"culture",0],
  ["ks:KXOSCARACTR-27-ZEN","ks:KXOSCARACTR-27","Oscar winner: Best Actress","Will Zendaya win Best Actress at the Oscars?","Zendaya",0.02,"culture",0],
  ["ks:KXOSCARACTR-27-CYN","ks:KXOSCARACTR-27","Oscar winner: Best Actress","Will Cynthia Erivo win Best Actress at the Oscars?","Cynthia Erivo",0.01,"culture",0],
  ["pm:2060104","pm:409920","Dancing with the Stars S35: Winner?","Will Harry Shum Jr. win Dancing With the Stars: Season 35?","Harry Shum Jr.",0.0925,"culture",0],
  ["pm:2060100","pm:409920","Dancing with the Stars S35: Winner?","Will Maura Higgins win Dancing With the Stars: Season 35?","Maura Higgins",0.0055,"culture",0],
  ["pm:4393420","pm:991303","Bank of Canada Decision in December?","Will the Bank of Canada make no change to the target for the overnight rate at the December interest rate announcement?","No Change",0.625,"economy",0],
  ["pm:4393418","pm:991303","Bank of Canada Decision in December?","Will the Bank of Canada increase the target for the overnight rate by 25 bps at the December interest rate announcement?","25 bps increase",0.37,"economy",0],
  ["ks:KXVENUEPERFORM-REDROCKS28JAN01-MTJ",0,"Will Mt. Joy perform at Red Rocks Park & Amphitheatre in 2027?","Will Mt. Joy perform at Red Rocks Park & Amphitheatre in 2027?",null,0.96,"culture",0],
  ["ks:KXRANKLISTGOOGLESEARCHTOP5-26DEC-BAD",0,"Will Bad Bunny be in the Top 5 rank on Google’s Year in Search 2026 Global – People?","Will Bad Bunny be in the Top 5 rank on Google’s Year in Search 2026 Global – People?",null,0.65,"culture",0],
  ["ks:KXUSAIRANAGREEMENT-27",0,"Will the US agree to a new Iranian nuclear deal this year?","Will the US agree to a new Iranian nuclear deal this year?",null,0.074,"politics",0],
  ["ks:KXRT-EBE-20","ks:KXRT-EBE","Ebenezer · Rotten Tomatoes score","Ebenezer Rotten Tomatoes score?","Above 20",0.89,"culture",1],
  ["ks:KXRT-EBE-25","ks:KXRT-EBE","Ebenezer · Rotten Tomatoes score","Ebenezer Rotten Tomatoes score?","Above 25",0.81,"culture",1],
  ["ks:KXRT-EBE-30","ks:KXRT-EBE","Ebenezer · Rotten Tomatoes score","Ebenezer Rotten Tomatoes score?","Above 30",0.69,"culture",1],
  ["ks:KXRT-EBE-35","ks:KXRT-EBE","Ebenezer · Rotten Tomatoes score","Ebenezer Rotten Tomatoes score?","Above 35",0.65,"culture",1],
  ["ks:KXRT-EBE-40","ks:KXRT-EBE","Ebenezer · Rotten Tomatoes score","Ebenezer Rotten Tomatoes score?","Above 40",0.47,"culture",1],
  ["ks:KXRT-EBE-45","ks:KXRT-EBE","Ebenezer · Rotten Tomatoes score","Ebenezer Rotten Tomatoes score?","Above 45",0.39,"culture",1],
  ["ks:KXALBUMEQUIV-HUN26NOV19-25K","ks:KXALBUMEQUIV-HUN26NOV19","The Hunger Games: Sunrise on the Reaping - The Album: First Week Album Equivalent Units","Will The Hunger Games: Sunrise on the Reaping - The Album by The Hunger Games have above 25000 Album Equivalent Units during the November 13, 2026 - November 19, 2026 tracking week?","Above 25K",0.85,"culture",1],
  ["ks:KXALBUMEQUIV-HUN26NOV19-30K","ks:KXALBUMEQUIV-HUN26NOV19","The Hunger Games: Sunrise on the Reaping - The Album: First Week Album Equivalent Units","Will The Hunger Games: Sunrise on the Reaping - The Album by The Hunger Games have above 30000 Album Equivalent Units during the November 13, 2026 - November 19, 2026 tracking week?","Above 30K",0.78,"culture",1],
  ["ks:KXALBUMEQUIV-HUN26NOV19-40K","ks:KXALBUMEQUIV-HUN26NOV19","The Hunger Games: Sunrise on the Reaping - The Album: First Week Album Equivalent Units","Will The Hunger Games: Sunrise on the Reaping - The Album by The Hunger Games have above 40000 Album Equivalent Units during the November 13, 2026 - November 19, 2026 tracking week?","Above 40K",0.66,"culture",1],
  ["ks:KXALBUMEQUIV-HUN26NOV19-60K","ks:KXALBUMEQUIV-HUN26NOV19","The Hunger Games: Sunrise on the Reaping - The Album: First Week Album Equivalent Units","Will The Hunger Games: Sunrise on the Reaping - The Album by The Hunger Games have above 60000 Album Equivalent Units during the November 13, 2026 - November 19, 2026 tracking week?","Above 60K",0.1,"culture",1],
  ["ks:KXALBUMEQUIV-HUN26NOV19-80K","ks:KXALBUMEQUIV-HUN26NOV19","The Hunger Games: Sunrise on the Reaping - The Album: First Week Album Equivalent Units","Will The Hunger Games: Sunrise on the Reaping - The Album by The Hunger Games have above 80000 Album Equivalent Units during the November 13, 2026 - November 19, 2026 tracking week?","Above 80K",0.05,"culture",1],
  ["pm:6401354","pm:1279916","Putin meets with Iranian officials by...?","Putin meets with Iranian officials by November 30?","November 30",0.9905,"geopolitics",0],
  ["pm:6401353","pm:1279916","Putin meets with Iranian officials by...?","Putin meets with Iranian officials by November 15?","November 15",0.987,"geopolitics",0],
  ["pm:2822017","pm:31195","Putin out as President of Russia by...?","Putin out as President of Russia by June 30, 2027?","June 30, 2027",0.085,"geopolitics",0],
  ["pm:560317","pm:31195","Putin out as President of Russia by...?","Putin out as President of Russia by December 31, 2026?","December 31, 2026",0.0195,"geopolitics",0],
  ["pm:2744695","pm:212877","Will Samuel Alito announce his retirement by...?","Will Samuel Alito announce his retirement by June 30, 2027?","June 30, 2027",0.195,"politics",0],
  ["pm:1388704","pm:212877","Will Samuel Alito announce his retirement by...?","Will Samuel Alito announce his retirement by December 31, 2026?","December 31",0.0345,"politics",0],
];
// event-level document frequency of every token above, over the full 5698-event index (Polymarket + Kalshi, 2026-11-05)
const N_EVENTS = 5698;
const DF = {
  "0.5":5,"1":974,"1.5":8,"10":170,"11":124,"12":125,"13":115,"14":115,"15":118,"16":89,"17":60,"19":83,"2":226,"2.5":11,"20":118,
  "2026":2365,"2027":1206,"21":101,"23":59,"25":97,"25000":8,"25k":6,"3":236,"3.5":9,"30":199,"30000":5,"30k":2,"31":339,"35":69,"4":172,
  "4.5":6,"40":37,"40000":4,"40k":3,"45":38,"5":379,"5.5":10,"50":79,"55":58,"6":326,"6.5":3,"60":72,"60000":3,"60k":2,"65":36,"7":188,
  "70":56,"75":52,"8":188,"80":63,"80000":4,"80k":2,"85":41,"9":125,"90":48,"above":1000,"acton":5,"actor":53,"actress":33,"agree":21,
  "aileen":1,"alabama":13,"album":167,"alito":9,"amir":2,"amphitheatre":11,"andrew":14,"anne":3,"announce":186,"announced":15,
  "announcement":16,"april":6,"avigdor":7,"az-05":4,"bad":22,"bank":58,"barkat":1,"become":84,"ben":11,"benjamin":16,"bennett":6,"benny":6,
  "best":281,"bond":36,"bps":28,"bumatay":1,"bunny":20,"callum":2,"canada":26,"cannon":1,"change":42,"chosen":2,"cotton":12,"cruz":10,
  "cynthia":2,"dancing":22,"deal":12,"december":313,"decision":66,"decrease":24,"democrat":311,"during":145,"ebenezer":2,"eisenkot":5,
  "eizenkot":4,"election":1253,"elizabeth":9,"equivalent":21,"erivo":2,"exactly":39,"fed":75,"following":24,"form":7,"francis":3,"gadi":9,
  "game":36,"gantz":4,"gideon":1,"give":2,"global":26,"google":40,"government":78,"governor":191,"gvir":2,"happen":5,"harry":18,"hathaway":3,
  "higgin":9,"hike":34,"ho":4,"house":760,"hunger":3,"increase":43,"inde":4,"iranian":15,"israel":36,"israeli":17,"itamar":2,"jack":8,
  "jame":85,"jan":526,"john":48,"josh":28,"joy":3,"jr":38,"julianne":1,"june":45,"justice":16,"kacsmaryk":1,"katz":5,"knesset":11,"lamb":5,
  "lapid":5,"lee":15,"lieberman":7,"lowden":2,"mandate":4,"margin":387,"mark":30,"matthew":9,"maura":9,"meet":43,"meeting":90,"michael":19,
  "mike":37,"moore":20,"mt":3,"naftali":5,"navarrette":4,"netanyahu":18,"nir":1,"november":523,"nuclear":11,"number":87,"oconnell":1,
  "oconnor":3,"official":30,"ohana":2,"ohio":44,"oldham":1,"oscar":174,"overnight":5,"park":22,"patrick":7,"people":25,"percentage":361,
  "perform":95,"point":410,"president":102,"pts":323,"putin":24,"race":103,"rank":27,"rate":131,"reaping":3,"receive":494,"red":20,
  "republican":409,"retirement":3,"rock":20,"rotten":23,"russia":30,"s35":4,"saar":1,"samuel":9,"sauer":1,"score":56,"scotus":33,"search":12,
  "season":56,"senate":372,"shum":7,"star":25,"sunrise":3,"talarico":33,"target":13,"ted":8,"texas":91,"theo":2,"time":56,"tom":31,
  "tomatoe":23,"tracking":25,"turner":6,"unit":19,"us":498,"victory":371,"win":583,"winner":351,"yair":6,"zendaya":3,
};

// ---- index: the case markets plus background events that reproduce DF exactly
const ms = MARKETS.map(([id, ev, eventTitle, title, outcome, yesPrice, category, ladder]) => ({ id, eventId: ev || id, eventTitle, title, outcome, yesPrice, category,
  tags: ladder ? ['kalshi:ladder'] : [], volume24h: 50_000, source: id.startsWith('pm:') ? 'polymarket' : 'kalshi' }));
const caseEv = new Map();
for (const m of ms) { let s = caseEv.get(m.eventId); if (!s) caseEv.set(m.eventId, (s = new Set())); for (const t of tokenSet(`${m.eventTitle} ${m.title} ${m.outcome || ''}`)) s.add(t); }
const rest = Object.entries(DF).map(([t, d]) => [t, Math.max(0, d - [...caseEv.values()].filter((s) => s.has(t)).length)]).sort((a, b) => b[1] - a[1]);
const bg = [];
for (let i = 0; i < N_EVENTS - caseEv.size; i++) {
  const ts = []; for (const [t, d] of rest) { if (d > i) ts.push(t); else break; }
  bg.push({ id: `bg${i}`, eventId: `bg${i}`, eventTitle: ts.join(' '), title: '', outcome: null, yesPrice: 0.5 });
}
const INDEX = [...ms, ...bg];
const NOW = Date.parse('2026-11-05T18:00:00Z');

// a story the way rank.mjs builds one: the lead, the top five outcomes; a strike ladder airs as its lead rung alone
function story(eventId, leadPick = null) {
  const g = ms.filter((m) => m.eventId === eventId);
  if (!g.length) throw new Error(`no fixture markets for ${eventId}`);
  const byPrice = [...g].sort((a, b) => b.yesPrice - a.yesPrice);
  const lead = (leadPick && g.find((m) => m.id === leadPick || m.outcome === leadPick)) || byPrice[0];
  const ladder = g.some((m) => m.tags.includes('kalshi:ladder'));
  let markets = byPrice.slice(0, 5);
  if (!markets.includes(lead)) markets = [...markets.slice(0, 4), lead];
  return { id: eventId, eventTitle: lead.eventTitle, category: lead.category, lead, markets: ladder ? [lead] : markets, ladder: ladder ? 'strike' : null };
}
const hl = (title, outlet = 'Reuters', h = 3, extra = {}) => ({ title, outlet, publishedAt: new Date(NOW - h * 3_600_000).toISOString(), category: 'general',
  url: `https://example.invalid/${encodeURIComponent(title).slice(0, 48)}`, ...extra });
const match = (eventId, lead, items) => matchStoryNews(story(eventId, lead), buildHeadlineIndex(items), INDEX, { now: NOW, maxAgeMs: 96 * 3_600_000 });

let fails = 0;
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); };
const show = (r) => r.map((x) => `${x.tier}${x.about ? `/${x.about}` : ''} ${x.score}`).join(', ') || 'none';

// ---- must match: event level (option 3) and the race-result lever
console.log('=== MUST MATCH');
const MUST = [
  // [eventId, lead, headline, tier ('event' | 'exact' | null = either)]
  ['ks:KXRATEHIKE-2026', 'Exactly 2', hl('September Fed Rate Hike Was a Mistake, Miran Says', 'Bloomberg'), 'event'],
  ['pm:626860', null, hl('September Fed Rate Hike Was a Mistake, Miran Says', 'Bloomberg'), null],            // numeric outcomes: one question, exact
  ['ks:KXSCOURT-29', 'D. John Sauer', hl('Justice Alito Will Not Retire From Supreme Court Immediately, Despite Election Outcome', 'The New York Times'), 'event'],
  ['pm:498879', "Josh O'Connor", hl('Brosnan endorses Callum Turner as next Bond', 'Deadline'), 'event'],
  // "Eisenkot" in the headline, "Eizenkot" in the market: a transliteration, so the lead itself is named (exact)
  ['pm:1219790', 'Gadi Eizenkot', hl('Joint List says it will back Eisenkot to form Israel’s next government', 'Al Jazeera'), null],
  ['ks:KXHOUSERACE-AZ05-26', 'Elizabeth Lee', hl('Mark Lamb moves ahead in race for AZ-5', 'KTAR'), 'event'],
  ['ks:KXHOUSERACE-AZ05-26', 'Mark Lamb', hl('Mark Lamb moves ahead in race for AZ-5', 'KTAR'), 'exact'],
  ['ks:KXMIDTERMMOV-OHGOVD', 'ks:KXMIDTERMMOV-OHGOVD-P8', hl("Democrat Amy Acton wins Ohio's race for governor", 'AP'), 'exact'],
  ['ks:KXMIDTERMMOV-TXSEND', 'ks:KXMIDTERMMOV-TXSEND-P13', hl('Talarico first Democrat to win Texas Senate seat since 1988', 'BBC'), 'exact'],
  ['ks:KXVENUEPERFORM-REDROCKS28JAN01-MTJ', null, hl('Mt. Joy announce two nights at Red Rocks in 2027', 'Billboard'), null],
  ['ks:KXRANKLISTGOOGLESEARCHTOP5-26DEC-BAD', null, hl("Bad Bunny tops Google's Year in Search as the most searched person", 'CNN'), null],
];
for (const [ev, lead, item, tier] of MUST) {
  const r = match(ev, lead, [item]);
  check(r.length === 1 && (!tier || r[0].tier === tier) && (r[0].tier !== 'event' || ['race', 'question'].includes(r[0].about)),
    `${ev}${lead ? ` / ${lead}` : ''} <- "${item.title}" [${tier || 'any'}] => ${show(r)}`);
}

// ---- must stay rejected
console.log('\n=== MUST REJECT');
const REJECT = [
  ['pm:1273034', 'No change', hl('Federal Reserve Board announces termination of enforcement action with Allegiant United Holdings, LLC, Nano Financial Holdings, Inc., and Nano Banc', 'Federal Reserve', 3, { official: true })],
  ['ks:KXOSCARACTR-27', 'Julianne Moore', hl('Is This the Gayest Oscar Season Ever?', 'Variety')],
  ['pm:409920', 'Harry Shum Jr.', hl('‘Rings of Power’ Star Eddie Marsan on Playing a Power-Hungry Dwarf and Why He Once Had 2,000 Pairs of Orlando Bloom’s Elf Ears in His Attic', 'Variety')],
  ['pm:991303', null, hl('Bank of England raises rates for first time in three years', 'The New York Times')],
  ['ks:KXVENUEPERFORM-REDROCKS28JAN01-MTJ', null, hl('Raise the Red Lantern review – a ravishing restoration', 'The Guardian')],
  ['ks:KXRANKLISTGOOGLESEARCHTOP5-26DEC-BAD', null, hl('Google will block search access for schools that ban AI', 'CBS News')],
  ['ks:KXMIDTERMMOV-ALSENR', null, hl('Democrats flip two Alabama Senate seats as District 10 remains close', 'Alabama Political Reporter')],
  ['ks:KXUSAIRANAGREEMENT-27', null, hl('More Iranians call for nuclear weapons after war with U.S.', 'The New York Times')],
  ['ks:KXRT-EBE', null, hl('Taika Waititi slams critics after Klara and the Sun debuts to 24% RT', 'Yahoo')],
  // the record-store outlet itself is news.mjs's drop (builder A); with a clean outlet the title still fails on the frame
  ['ks:KXALBUMEQUIV-HUN26NOV19', null, hl('The Hunger Games: Sunrise on the Reaping – Original Motion Picture Soundtrack (Limited Edition Red Vinyl LP)', 'Music News')],
  ['pm:1279916', null, hl('Vladimir Putin, Rezaei meet as Turkey probes deadly Iran border fire', 'The Jerusalem Post')],
  ['pm:31195', null, hl('Vladimir Putin, Rezaei meet as Turkey probes deadly Iran border fire', 'The Jerusalem Post')],
  ['pm:1273034', null, hl('Federal Reserve Board - Home', 'Federal Reserve (.gov)')],
  ['pm:1273034', null, hl('Calendar', 'Federal Reserve (.gov)')],
  // event level stays strict: a rival named without the event's frame, a frame word shared by another story
  ['pm:498879', "Josh O'Connor", hl('Callum Turner joins the cast of a new Netflix thriller', 'Deadline')],
  ['ks:KXRATEHIKE-2026', 'Exactly 2', hl('Cut number of police forces in England to as few as nine, review recommends', 'The Guardian')],
];
for (const [ev, lead, item] of REJECT) {
  const r = match(ev, lead, [item]);
  check(r.length === 0, `${ev}${lead ? ` / ${lead}` : ''} x "${item.title.slice(0, 90)}" => ${show(r)}`);
}

// ---- ordering: an exact hit outranks an event-level one of similar age; a podcast item yields to a clean one
console.log('\n=== ORDER');
{
  const r = match('pm:498879', "Josh O'Connor", [hl('Brosnan endorses Callum Turner as next Bond', 'Deadline', 2), hl("Josh O'Connor in talks to play the next James Bond", 'Variety', 5)]);
  check(r.length === 2 && r[0].tier === 'exact' && r[1].tier === 'event', `exact (5h) ahead of event (2h) => ${r.map((x) => `${x.tier}:${x.item.outlet}`).join(', ')}`);
  const p = match('pm:498879', "Josh O'Connor", [hl("Josh O'Connor and the next James Bond: Pop Culture podcast episode", 'Podcast Net', 2), hl("Josh O'Connor in talks to play the next James Bond", 'Variety', 3)]);
  check(p.length === 2 && p[0].item.outlet === 'Variety', `podcast item ranks below a clean headline => ${p.map((x) => `${x.item.outlet} ${x.score}`).join(', ')}`);
}

// ---- headline filter (D4 sensitive, site titles) and scope rules
console.log('\n=== HEADLINE FILTER + SCOPE');
for (const t of ['Vladimir Putin, Rezaei meet as Turkey probes deadly Iran border fire', 'More Iranians call for nuclear weapons after war with U.S.',
  'Airstrikes hit the capital overnight', 'Two dead after shooting near polling site']) check(headlineReject(t) === 'sensitive', `sensitive: ${t}`);
for (const it of [{ title: 'Federal Reserve Board - Home', outlet: 'Federal Reserve (.gov)' }, { title: 'Calendar', outlet: 'Federal Reserve (.gov)' }, { title: 'Press Releases', outlet: 'SEC' }])
  check(headlineReject(it) === 'site-title', `site title: ${it.title}`);
for (const t of ['Fed holds rates steady and signals a December hike is possible', 'Brosnan endorses Callum Turner as next Bond', 'Bank of England raises rates for first time in three years'])
  check(headlineReject(t) === null, `clean: ${t}`);
check(scopeMismatch('Bank of Canada Decision in December?', 'Bank of England raises rates for first time in three years'), 'scope: Bank of England is not Bank of Canada');
check(scopeMismatch('Fed Decision in December?', 'ECB holds rates as Lagarde warns on growth'), 'scope: ECB is not the Fed');
check(!scopeMismatch('Fed Decision in December?', 'Fed and ECB both hold rates'), 'scope: a headline naming the Fed too is fine');
check(scopeMismatch('Alabama Senate margin of victory', 'Democrats flip two Alabama Senate seats as District 10 remains close'), 'scope: state senate seats are not the US Senate race');
check(scopeMismatch('Georgia Governor winner', 'Republicans keep the Georgia General Assembly'), 'scope: a legislature headline is not the governor race');
check(!scopeMismatch('Texas Senate District 10 winner? (2028)', 'Democrats flip Texas Senate District 10'), 'scope: a state-senate market takes its own district');
check(!scopeMismatch('Texas Senate margin of victory', 'Talarico first Democrat to win Texas Senate seat since 1988'), 'scope: the US Senate race result is fine');

console.log(fails ? `\n${fails} FAILED` : '\nall match checks passed');
process.exit(fails ? 1 : 0);
