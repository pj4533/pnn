# PNN handoff: start here

You're picking up a project that grew out of another one. This doc explains where it came from, what the user wants, what you can reuse, and a suggested first milestone. Read it fully once, then use `CLAUDE.md` as the day-to-day reference.

## Where this came from

On **Nov 3, 2026** (the US midterms), the user and Claude Code built **Election Night**, a live 3D synthwave cable-news-style results broadcast, in one session.
- **Repo:** `~/Developer/election_night`, public at https://github.com/pj4533/election_night, MIT licensed.
- **What it did:** pollers fed a Node store, which pushed to the browser over SSE. The browser drew a Three.js scene with chyrons, breaking-news alerts, a rotating segment director, and **Kalshi + Polymarket odds written in plain English** ("Bettors give El-Sayed a 95% chance").

The user's biggest takeaway was the betting lines. At 8:44 PM ET, before New York's polls closed, the board read Senate D 98–99% and House D 99%, hours before the networks called either chamber. Markets "knew" the story before the news did.

That raised the question PNN exists to answer: **what if a 24-hour news network reported what the markets predict, not what already happened?**

## The idea: PNN, the Pre News Network

A continuously running, broadcast-style channel (in the browser, built for a TV or second monitor) that:
- **Tracks what prediction markets are pricing** across current affairs: politics, geopolitics, the economy, courts, tech, culture and weather. It is not limited to elections.
- **Reports market moves as news, in plain English.** For example: *"Bettors now give the Fed a 80% chance of hiking in December, up 7 points today."*
- **Explains why it moved.** Pair each move with matching headlines from RSS and Google News.
- **Looks and feels like a 24-hour news channel:** a rotating rundown, a "breaking" alert when a market jumps, a ticker and chyron, a top-stories board, and "what the markets expect this week".
- **Is independent.** No exchange sponsorship or affiliate links. See below for why that matters.

## Why there's room for this (research summary)

Full report: `research/prediction-market-news-landscape.md`, with sourced notes in `research/notes/`.

- **Most "what the markets say" coverage is run or paid for by the exchanges.**
  - Kalshi has paid deals with CNN, CNBC (which it partly owns), Fox and CBS, plus its own newsroom and an election-night "99% KALSHI PROJECTION" feed.
  - Polymarket has exclusives with Dow Jones and Substack, its own newsletter and podcast, and a network of **paid, often undisclosed** "news-wire" accounts on X (documented by CJR, Politico, WSJ and NPR in 2026).
- **The independent layer is thin and mostly raw numbers.**
  - Election Betting Odds and arbitrage aggregators like Predxy and PredictionMarkets.US.
  - Trader terminals, Telegram whale bots, and a few newsletters (Prediction News, Event Horizon, Sentinel).
  - Boring News was an AI-scripted experiment. Adjacent News abandoned its news product to build indices.
- **No one runs an independent, plain-English, cross-exchange, live broadcast-style "markets newsroom".** The research found no open-source TV-style market display at all.
- **Credibility constraints the critics raise:**
  - A bet is not a poll, and readers round 70% up to "certain".
  - Markets missed Brexit, 2016 and the 2022 "red wave", and in 2026 they missed the Texas governor race and the Iowa and South Carolina Senate races.
  - Prices of 98¢ and up are distorted by fees and settlement delays.
  - About 25% of Polymarket's historical volume is likely wash trading.

**PNN's editorial stance should answer these critiques on screen:** always "bettors give X a Y% chance", never "X will happen"; show the source and timestamp; show volume; never present a market as a call or a fact.

## Proof there's enough content

See `research/market-snapshot-2026-11-04.md`.
- **Polymarket's free API** exposes `oneDayPriceChange`, `oneWeekPriceChange` and `volume24hr` on every market, so a "biggest movers" list takes a single query.
- **Kalshi** has about 1,330 series that repeat hourly, daily, weekly or monthly: Trump approval this week, CPI, gas prices, airport delays, Billboard #1, COVID, GPU prices and more.
- **On a normal day** the high-volume non-sports markets cover the Iran ceasefire, the Fed, 2028 nominees, Putin or Xi leaving power, a Supreme Court retirement, oil prices, the Anthropic IPO and more.

API details, verified on 2026-11-04, are in `research/market-apis.md`.

## What to reuse from election_night

Read these files; don't import from that repo. Copy and adapt, because PNN should stand alone.

| Need | Look at `~/Developer/election_night/...` |
| --- | --- |
| No-framework Node server, SSE, static files, `/api/state`, `/api/health`, client error log | `server/app.mjs`, `server/index.mjs`, `server/http.mjs` (fetch with timeout, ETag, backoff), `server/log.mjs` (JSON-lines logs) |
| Polymarket Gamma client (parsing `outcomePrices`, paging events) | `server/sources/polymarket.mjs` |
| Kalshi client (batching tickers, discovery, cache) | `server/sources/kalshi.mjs` |
| RSS / Google News headlines | `server/sources/news.mjs` |
| Diff state into events, dedupe, flood protection | `server/store.mjs`, `public/js/alerts.js` |
| Broadcast UI: rundown director, chyron/ticker, full-screen alerts, auto-fit | `public/js/director.js`, `chyron.js`, `alerts.js`, `fit.js`, `overlay.js`, `public/css/theme.css` |
| Plain-English odds helper | `public/js/util.js` (`betTxt`) |
| Three.js synthwave scene (optional; PNN may want a different look) | `public/js/scene/*` |
| Layout and sizing rules learned the hard way | `docs/FRONTEND_CONTRACT.md` |
| Log watcher for a live-ops Claude session | `scripts/watch.sh` |

Lessons from election night (also in that repo's `CLAUDE.md`):
- **Content:** dedupe alerts by content, cap the alert queue, and never replay old alerts from state on reconnect.
- **Layout:** stacked panels must not flex-shrink, and you should test at 1920×1080, 1512×945 and a wide-short 2000×810.
- **Rendering:** don't call the renderer's `setSize` on every segment change, because it causes flashing.
- **Ops:**
  - Restart servers by PID, never `pkill`, which kills other agents' test servers.
  - Any data file read at runtime must be listed in deploy config (Vercel `includeFiles`), or it silently disappears.

## Suggested first milestone (MVP)

Get a working channel on screen quickly, then iterate. Don't polish before it runs.

1. **Ingest:** poll Polymarket's top markets by `volume24hr` and Kalshi's open markets, normalized into one shape:
   - Identity: `{id, source, title, eventTitle, category}`
   - Prices: `{yesPrice, change1d, change1w}`
   - Size and timing: `{volume24h, liquidity, closesAt, url}`
2. **Rank and filter:**
   - Drop sports, esports, crypto price brackets and promo tags; keep the categories in config.
   - Group by event so one multi-outcome event doesn't flood the list.
   - Score moves by size weighted by volume.
   - Damp "by date X" decay. One heuristic: ignore steady drift toward 0 as the deadline nears.
3. **Write the copy:** a template-based plain-English line per market, then a headline per story.
   - Example: "Bettors give X a Y% chance, up Z points today."
   - LLM-written copy can come later, maybe through the Claude API. Keep templates as the fallback.
4. **Explain:** attach one or two matching headlines from Google News RSS per top story ("why it moved").
5. **Broadcast UI:** a top-stories board, a movers ticker, a "breaking" alert when a market moves ≥N points in M minutes on real volume, a story-of-the-hour full screen, and a clock.
6. **Ops:** JSON-lines logs, `/api/health` showing feed freshness, and a `scripts/watch.sh`-style filter so a Claude session can babysit it.

## Open questions for the user (ask, don't assume)
- **Look:** same synthwave 3D style as Election Night, or a different visual identity?
- **Where it runs:** local only at first, or hosted? Is it ever public? Public use means checking the exchanges' data terms first.
- **AI copy:** should headlines be written by an LLM (Claude API) or templates only? Is cost a concern?
- **Sensitive markets:** what's the policy for war, death and assassination markets? Fox excludes them.
- **Categories:** which to lead with? Politics and geopolitics seem the natural core.
- **Name and branding:** "PNN: Pre News Network" is the working title.
