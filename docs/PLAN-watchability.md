# Watchability plan (agreed with the user on 2026-11-04)

This plan came from a research workflow: a product audit (Opus), broadcast/TV research (Sonnet), untapped-data research (Sonnet), and a Fable synthesis. The user then picked from the options. The live diagnosis showed that PNN has dramatic numbers (Colom 14%→92% overnight) but airs them as static gauges, and has no payoff moments. The surprise machinery fired on obscure brackets or not at all (0 alerts and 0 flashes live).

## In scope

### Phase 1: quick wins (S each, ship together)
1. **Kill dead content.** No near-certain rain, sub-$25K markets closing within about 12h, or decided races on the board.
   - Markets at ≥95% or ≤5% after a big move get one "SETTLING" appearance, then leave the rotation.
   - THIS WEEK airs only when it has non-thin stories.
   - Lives in `rank.mjs`.
2. **THEN vs NOW swing cards.** Movers become "YESTERDAY 14% → NOW 92%".
   - The number counts up while the 3D needle or leading column sweeps from the old value to the new, leaving a ghost tick at the old one.
   - FLIPPED stamp when the market crosses 50%.
   - Banner variants: BIGGEST SWINGS / LONGSHOTS ON THE MOVE / FAVORITES SLIPPING.
   - Election races carry "Market prices, not official results".
3. **Better surprise moments.**
   - BREAKING requires a board/desk story or at least $250K, plus a human-readable lead line. No margin brackets.
   - New **ON THE MOVE** corner pop: 4s, no takeover, about one per 3 minutes, per-story cooldown, driven by `change1h`.
   - Optional "STILL MOVING" escalation.
   - Rare **JUST LISTED** pop for genuinely new non-noise markets.
   - Wire clusters that fire before markets load are retried instead of dropped, and repeat clusters are deduped.
4. **"Next up" tease.**
   - A "NEXT: … · then …" strip in the top bar (the director picks one card ahead).
   - No story airs twice within 5 minutes under different banners.
5. **Declutter.**
   - The chyron carries something new while a card is up ("ALSO MOVING: …" or the tease) instead of repeating the headline.
   - The 3D drops its duplicate big %.
   - The move becomes a huge glowing +78 / −40.
   - "unchanged today" filler is replaced by the runner-up or the week move.

### Phase 2: bigger features (M each)
6. **Price replay hologram.** On cards with real history, the ribbon rewinds and redraws the 24h path as a glowing tracer over about 3s.
   - Markers where wire headlines landed.
   - Ghost lines at 1h-ago and 24h-ago.
   - Ends on the live price.
7. **Story of the Day: one multi-market card** (the user chose a single card over a 3-beat block).
   - "THE BLUE WAVE · 12 markets moved", credited to the wire cluster.
   - A board of the markets it moved, with % and today's move, the biggest highlighted and the 3D camera pulling to it.
   - Framed as "IN THE NEWS", never "because of".
8. **Next Big Decision clock.**
   - A persistent countdown chip to the next scheduled resolution (CPI, Fed, jobs, award shows) with its market's live odds; it switches to mm:ss in the last hour.
   - A recurring COUNTDOWN DESK card showing the next 3 decisions on a timeline.
9. **MONEY MOVING flash** (the user chose this wording; no "bet", "wager" or "someone put").
   - "MONEY MOVING · $30,000 traded on Democrats winning Mississippi at 91%", plus "Largest trade on this story today · Polymarket · 20:47".
   - The amount counts up.
   - Only for prices between 5% and 95% and for board/desk stories.
   - Polymarket data-api trades; Kalshi gets an aggregate flow line.
   - Never shows trader handles.
10. **Exchanges agree badge.**
    - "KALSHI 92% · POLYMARKET 93% · both exchanges agree" on stories priced on both.
    - A rare "EXCHANGES DISAGREE · 41% vs 49%" pop when they differ by 5+ points on matched titles.

## Not chosen (for now)
- SETTLED payoff cards
- Claude-written "take" line (copy stays templates-only, D3)
- Who-got-in-early position panel
- Wall-clock rituals: no Market Minute, no dayparts. Rotation only.
