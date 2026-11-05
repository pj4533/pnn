# Queued fixes: run after the news-driven and unified-stage workflows merge

Reported by the user on the iPad, 2026-11-05 07:30.

1. **Glow blowout (still).** Big center % numbers on dials ("22%", "40%") and some labels are white smears.
   - Root-cause fix: draw hologram text AFTER bloom (a label overlay pass that skips the bloom composer), or exclude labels from bloom with a selective-bloom layer. The fix must not be just "dim it", and should apply to every widget.
   - Then check that no text anywhere is blown out: 3D labels, the alert takeover, cards.
2. **Dial labels collide with the needle/arc.** "−8 PTS" sits on the needle, and "FLIPPED" / "LONGSHOT SURGES" sits over the needle and arc.
   - Lay out badge and points labels in reserved slots that don't overlap the arc or needle sweep.
3. **Raw-question headline via the ladder/mover path:** "WTI oil reaches $115.01 by Dec 31 slips to 22% in How high will oil (WTI) get by Dec 31, 2026".
   - Never append "in <question>". Ladder rungs should read like "WTI oil reaching $115 by Dec 31 slips to 22%".
4. **Novelty market leak:** "Number of distinct days with a Getty Images editorial photo of Trump is exactly 4" (Kalshi photo-count series).
   - Filter it as novelty, like tweet and mention counts.
   - Also fix the stray "4" label shown under the card's category line (the outcome label for count buckets).
5. Re-verify everything at 1194x834 (iPad Pro 11) and 1920x1080 in WebKit after the fixes.
6. **Numbers must agree between card and widget.** Avengers: Doomsday showed "−22 points today" on the card but "−21 PTS" / "21 pts today" on the dial. Use one source of truth for the move (same field and same rounding) on the card, widget, chyron and ticker.
7. **Glow verification must be done by me (the orchestrator), not just agents.** The user notes blowout is scene-dependent: fine over dark scenes, smeared over bright green/teal glow scenes.
   - Pin every scene × the dial / outcomes / swing widgets in WebKit at 1194x834 and 1920x1080.
   - Look at each screenshot myself: text crisp on every scene, glow still present on arcs, beams and particles.
   - Get the balance right: readable but still glowy.
8. **Balance runs both ways.** Over dark scenes some labels are too dim and need MORE glow. Example: the price replay for Avengers: Doomsday, where the title "AVENGERS: DOOMSDAY", the axis labels and "1H AGO 71%" are grey and small.
   - The target is a consistent, background-independent look: hologram text drawn after bloom, carrying its own designed glow halo (in the label texture or a dedicated text-glow pass), so it looks equally crisp and glowy over bright green and over black.
   - Also: the replay title, the axis labels and the "1H AGO" ghost label need more size and brightness.
9. **Leftovers from the unified-stage work** (branch bg-unify, e936e8b):
   - On dial stories the footer ("POLYMARKET · $1.2M TODAY") sits under the NEXT BIG DECISION chip.
   - Up-move stories turn almost every scene green, so scenes look alike. Lower the 35% green/red blend so each scene keeps its own palette, with the story color as an accent.
   - The light cone outline still reads faintly as a trapezoid in some scenes. Soften its edges or drop it.
   - The card glass is tinted with the story's second color (pink) while the stage is green. Sync it to one accent.
   - The card→widget connector beam only shows on TOP STORIES. Make it work on desk, movers, week, focus, swing, SOTD and countdown, or design an equivalent link.
   - Hyperspeed gets green-hazy at high energy.
   - Untested so far: down-move (red) stories, 2000x810, per-scene pulse reactions, and a real (unpinned) mid-transition.
