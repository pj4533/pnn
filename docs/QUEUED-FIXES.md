# Queued fixes: run after the news-driven and unified-stage workflows merge

Reported by the user on the iPad, 2026-11-05 07:30.

1. **[DONE]** Labels go on their own layer, drawn after bloom and the grade with a halo in the label texture. In WebKit across all 12 scenes there were no white smears and the glow stays on arcs and beams (`docs/shots/polish-glow-*`).
   **Glow blowout (still).** Big center % numbers on dials ("22%", "40%") and some labels are white smears.
   - Root-cause fix: draw hologram text AFTER bloom (a label overlay pass that skips the bloom composer), or exclude labels from bloom with a selective-bloom layer. The fix must not be just "dim it", and should apply to every widget.
   - Then check that no text anywhere is blown out: 3D labels, the alert takeover, cards.
2. **[DONE]** The points line and the FLIPPED/SHAPE badge now sit in reserved slots under the hub, and the label on the needle is gone (`polish-app-movers-1920.png`, `polish-glow-*-swing-*`).
   **Dial labels collide with the needle/arc.** "−8 PTS" sits on the needle, and "FLIPPED" / "LONGSHOT SURGES" sits over the needle and arc.
   - Lay out badge and points labels in reserved slots that don't overlap the arc or needle sweep.
3. **[DONE]** `moverName()` returns one self-contained clause. Over 19 min of live state on :4200, display copy had 0 "in <question>" strings.
   **Raw-question headline via the ladder/mover path:** "WTI oil reaches $115.01 by Dec 31 slips to 22% in How high will oil (WTI) get by Dec 31, 2026".
   - Never append "in <question>". Ladder rungs should read like "WTI oil reaching $115 by Dec 31 slips to 22%".
4. **[DONE]** `KXTRUMPPHOTO` and photo-count patterns are filtered in config and `filter.mjs`. `outcomeSubtitle()` drops bare numeric labels. Live state had 0 novelty strings.
   **Novelty market leak:** "Number of distinct days with a Getty Images editorial photo of Trump is exactly 4" (Kalshi photo-count series).
   - Filter it as novelty, like tweet and mention counts.
   - Also fix the stray "4" label shown under the card's category line (the outcome label for count buckets).
5. **[DONE]** Verified in WebKit (Python Playwright) at 1194x834 and 1920x1080 on :4200 (live and fixture). fitReport was empty and the console clean (`polish-app-*`, `polish-dialchip-*`, `polish-alert-*`).
   Re-verify everything at 1194x834 (iPad Pro 11) and 1920x1080 in WebKit after the fixes.
6. **[DONE]** The server `swingOf` emits integer `swing.points`. The card uses `leadPts` (`ptsOf`) and the dial uses the same rounding. Card and dial agreed in every check: -15/15, +4/4, -31/31, +33/33, +28/28, and 11 live swings.
   **Numbers must agree between card and widget.** Avengers: Doomsday showed "−22 points today" on the card but "−21 PTS" / "21 pts today" on the dial. Use one source of truth for the move (same field and same rounding) on the card, widget, chyron and ticker.
7. **[DONE (orchestrator review pending)]** 84 WebKit shots cover 12 scenes x dial/swing/outcomes at both sizes, plus replay at 1194: `docs/shots/polish-glow-<scene>-<widget>-<w>.png`. The verifier saw crisp text on bright green and dark scenes. The orchestrator still has to look at them.
   **Glow verification must be done by me (the orchestrator), not just agents.** The user notes blowout is scene-dependent: fine over dark scenes, smeared over bright green/teal glow scenes.
   - Pin every scene × the dial / outcomes / swing widgets in WebKit at 1194x834 and 1920x1080.
   - Look at each screenshot myself: text crisp on every scene, glow still present on arcs, beams and particles.
   - Get the balance right: readable but still glowy.
8. **[DONE, round 2 2026-11-05]** The replay title, sub-line, axis labels, start readout and 1H AGO were enlarged again; labels now wait for Orbitron and Rajdhani (no serif fallback). Earlier: labels render at full brightness with their own halo, and the replay title, axis labels and 1H AGO are bigger. The replay date sub-line and the left axis tick (for example "38%") are still small, so this may be worth one more look.
   **Balance runs both ways.** Over dark scenes some labels are too dim and need MORE glow. Example: the price replay for Avengers: Doomsday, where the title "AVENGERS: DOOMSDAY", the axis labels and "1H AGO 71%" are grey and small.
   - The target is a consistent, background-independent look: hologram text drawn after bloom, carrying its own designed glow halo (in the label texture or a dedicated text-glow pass), so it looks equally crisp and glowy over bright green and over black.
   - Also: the replay title, the axis labels and the "1H AGO" ghost label need more size and brightness.
9. **[DONE except: economy-green tint and untested parts]** Round 2: the `overlay.js` `offsetParent` chip test is fixed (it now measures the chip box), so at 1194x834 the stage drops to y1 0.712 with the chip up. Still OPEN: `THEMES.economy.b` is green in `scene/holo.js`, so economy stories still turn the stage green (finance avoids this with the `tech` theme), and per-scene pulse and the unpinned mid-transition are still untested. Earlier: The footer clears the chip (`polish-dialchip-*`). The scene tint is down to 10%. The cone rim is removed. Card glass uses `--story`. Every card kind gets a dock link. Hyperspeed bloom is cut. Still OPEN: per-scene pulse reactions and the unpinned mid-transition, which were not tested. Two notes: `overlay.js` still has the `offsetParent` test (the scene works around it), and economy stories stay green because the economy theme colour is green.
   **Leftovers from the unified-stage work** (branch bg-unify, e936e8b):
   - On dial stories the footer ("POLYMARKET · $1.2M TODAY") sits under the NEXT BIG DECISION chip.
   - Up-move stories turn almost every scene green, so scenes look alike. Lower the 35% green/red blend so each scene keeps its own palette, with the story color as an accent.
   - The light cone outline still reads faintly as a trapezoid in some scenes. Soften its edges or drop it.
   - The card glass is tinted with the story's second color (pink) while the stage is green. Sync it to one accent.
   - The card→widget connector beam only shows on TOP STORIES. Make it work on desk, movers, week, focus, swing, SOTD and countdown, or design an equivalent link.
   - Hyperspeed gets green-hazy at high energy.
   - Untested so far: down-move (red) stories, 2000x810, per-scene pulse reactions, and a real (unpinned) mid-transition.
10. **[DONE 2026-11-05]** Tick and axis labels are plain text with a glow and a thin outline, and only the centre readout and badges keep soft translucent plates. The big % and the FROM line are about half a digit apart. The swing dials no longer show the duplicate NOW label (`docs/shots/labels-*`, `round-*-focus-*`, `round-*-movers-*`). Small leftovers: at 52% the needle crosses the TOSS-UP label, and at 1920 the LIVE 3D strip nearly touches the dial's outcome chip. Before: Tick labels (25%/50%/UNLIKELY/LIKELY/TOSS-UP) still sit on solid plates. The big % and the FROM line are separate lines but tight; at 1920 the "2%" plate touches "UNCHANGED TODAY" (`polish-dialchip-1920.png`).
    **Dial layout overlaps (user screenshot 07:5x, Callum Turner dial, mid-polish state).**
    - The big "63%" and its "FROM 73% YESTERDAY" sub-line collide inside one plate. Give them separate lines with real spacing.
    - The center readout plate crowds the arc's lower ends and the 0%/100% labels.
    - The solid backing plates on every label (25%, 50%, UNLIKELY, LIKELY, TOSS-UP…) read heavy and boxy. Keep legibility, but use lighter treatments: no plates on tick labels, and subtle plates only where text sits over busy scenery.
    - Verify every dial and badge label has clear space from every other label, the arc and the needle at 1194x834 and 1920x1080.
11. **[Part 1 DONE 2026-11-05: telemetry; part 2 OPEN: collect real Safari and iPad data, then fix]** `public/js/perf.js` sends a perf line every 30 s to `/api/client-log` (level debug, so it goes to `logs/pnn.log` only), and `?perf=1` shows a HUD. To get the report, run `node scripts/perf-report.mjs --since 2h [--device iPad|Mac] [--browser Safari]`; headless runs are excluded unless `--headless` is passed. Early headless WebKit leads: the cold-start hologram warmup takes about 900 ms, mostly a 665-732 ms texture upload of 77 label canvases plus 86 shader compiles, and `globe` and `dial:reveal` have the worst long-frame rates. Before:
    **Performance (next workflow, after the polish pass).** The user sees jittery slowdown and dropped frames on some new animations in Safari. Don't change the look; make everything smooth.
    - Add real-device telemetry: frame-time percentiles and long-frame counts (>33ms) per scene, transition and widget build, with hitch causes and the device, sent every 30s via client-log; plus a `?perf=1` HUD.
    - Collect about 15 min from the user's Mac Safari and iPad, rank the hotspots, and fix them: shader pre-warm, label-texture reuse, allocation/GC churn, transition pass cost, adaptive DPR on iPad.
    - Verify with Chrome and WebKit (Playwright) for main-thread hitches, then with before/after device telemetry.
12. **[DONE v1 2026-11-05]** The server side is `server/finance.mjs` and `server/sources/finance.mjs`: it polls Yahoo and Treasury.gov on a market-hours cadence, applies hysteresis, requires a headline and a paired market, and puts at most 3 moves in `state.finance`. The client side is the MARKETS card (key 8, about 1 in 5-6 cards), the 3D `finance` widget and the ticker PRICES mode. Verified live on :4204 during market hours: NVDA, ^NDX, ^GSPC and ^VIX moves, 31 quotes, 0 quote errors. Open: a Dow move was paired with a "Dow rises…" headline while the Dow was down 1.6%, because the headline gate doesn't check direction. It didn't air (not in the top 3). At 1194 the widget's "YESTERDAY'S CLOSE 7,688.6" label is clipped at the right edge.
    **Feature: stock and bond moves (after the polish pass; research in progress → research/financial-data.md).**
    - Big moves on mega-cap stocks, indices and Treasury yields, shown with price history and connected to related prediction markets (Kalshi index/yield ranges, Polymarket largest-company, Fed odds).
    - Not overwhelming: a modest share of the mixed stream.
    - News-driven: every move shown has a headline.
    - Plain English: "10-year yield rises to 4.62%, up 0.12", no "bps".
    - **User decisions (2026-11-05):**
      - Sources: Yahoo chart API as primary, Treasury.gov for yields; no Finnhub.
      - Watchlist: top ~20 mega-caps, indices (S&P, Nasdaq-100, Dow, VIX), Treasury 2Y/10Y/30Y, and oil/gold/dollar.
      - Earnings markets: only the well-traded pairings (largest company, Fed, yields, S&P ranges, recession, oil). No thin single-stock earnings markets.
      - Spec: research/financial-data.md.
13. **Remove the "LIVE 3D // <event>" frame tag entirely (the user decided this).** The widgets name their own subject.
    - Drop the tag markup and its fit and flash-override logic (`overlay.setFrameLabel`).
    - Let the stage rect start at the frame top.
    - Verify nothing else referenced it.
    - Owner: orchestrator, after the next-round workflow.
