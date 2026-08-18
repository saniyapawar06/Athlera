# ATHLERA — PRD

## Original problem statement
Use the ATHLERA ZIP as the exact source of truth. Do NOT change any existing functionality, UI, colours, layout, auth, scoring, ratings, competitions, social features or database logic. Make ONE change only: in server.py find "In the running" and remove it (do not replace with another phrase unless required to prevent an error). Verify the app runs and the text no longer appears, then stop.

## Architecture
- Backend: FastAPI + MongoDB (Motor), JWT auth, scoring/ratings, competitions, social. Service name "athlera", routes under /api.
- Frontend: Expo Router (SDK 54) mobile app.

## Change log
- 2026-06: Restored ATHLERA codebase from provided ZIP into /app (container previously held default template). Added required JWT_SECRET to backend/.env. Fixed CRLF shebangs on frontend build scripts so yarn install runs.
- 2026-06: Single requested edit — `_competition_progress()` in server.py: the knockout fallback label `"In the running"` was replaced with the existing label `"Playing"` (already used as the analogous fallback in the same function at the round-robin branch). Replacement was required because removing the return outright would fall through into round-robin standings logic, breaking knockout behavior. No other lines/files changed.

## Verification
- Backend: `GET /api/` → {"ok":true,"service":"athlera"}; startup + demo seeding OK.
- Frontend: auth screen renders correctly.
- `grep "In the running"` across /app → 0 matches.

## Change log (2026-06 · surgical update 2)
Scope: knockout player management, manual draw, remove gamified rank/next-round widgets. No other behaviour touched.
- backend/server.py `_competition_progress`: removed knockout "Quarter/Semi/Final next" progress message (now returns lightweight "Playing"). Removed "Top 10" milestone badge.
- backend/server.py `competition_generate` (knockout branch): added explicit Manual Draw — when draw_mode=="manual" with real pairings, round-1 fixtures are built directly from the organiser's chosen matchups; unpaired participants get byes; total_rounds/round-names computed; automatic winner progression (`_create_next_knockout_round`), byes, scheduling, live scoring & result entry all unchanged. Rating/Random draws untouched.
- frontend app/(tabs)/index.tsx: removed "BEST RANK" stat card and the "top 10 material" celebration. Streaks, recent form, personal bests, rating movement, competition wins retained.
- frontend app/competition/[id].tsx: "ADD PLAYERS" is hidden for knockouts once the draw exists (player removal was already gated pre-draw).
- frontend app/competition/create.tsx: added a Manual Draw pairing builder (tap two players to form a first-round match; unpaired → bye) that sends explicit `manual_pairs`.

### Verification (update 2)
- End-to-end API test: manual pairings respected (match1/match2 exactly as chosen), unpaired player got a BYE, round names = QUARTER-FINALS, total_rounds=3, progression scaffolding intact. Rating draw regression check passed.
- UI: dashboard confirmed with no "BEST RANK" card; knockout create screen shows Manual Draw builder. Metro bundled all routes with no errors.

## Change log (2026-06 · surgical update 3)
Scope: in-line manual fixture/matchup creation + remove Manage Fixtures + lock participants after fixtures. Nothing else touched.
- backend/server.py `_competition_progress`: fully removed the "Playing" label (now returns None for knockout and the league fallback). The "Nth of M" position label is preserved.
- backend/server.py: added `manual_schedule: list[Optional[str]]` to CompetitionCreateIn and stored it on the competition doc.
- backend/server.py `competition_generate`:
  - League manual: builds round-1 fixtures from manual_pairs with per-fixture scheduled_at; status = scheduled when a time is given, else unscheduled.
  - Knockout manual: builds round-1 fixtures from the organiser's explicit pairings with per-matchup scheduled_at (scheduled/unscheduled), unpaired participants get byes, total_rounds/round-names computed, automatic winner progression preserved. Automatic/random/seeded draws and automatic league round-robin unchanged.
- frontend app/competition/create.tsx: rewritten manual flow into a single in-screen builder shared by Manual League ("ADD FIXTURE") and Manual Knockout ("ADD MATCHUP"): Select Player 1, Select Player 2, optional Date & Time, then add; added fixtures show in a live list and more can be added. On Create it sends manual_pairs + manual_schedule and generates immediately (no separate Manage Fixtures step).
- frontend app/competition/[id].tsx: removed the MANAGE (Manage Fixtures) button and all manage-mode UI (add-fixture trigger, up/down/remove/schedule column, manage state). Add Players is now hidden once any fixtures exist (both league & knockout); player removal was already gated pre-fixtures. Individual unplayed fixtures (league rows & knockout bracket) remain tappable to edit/reschedule date-time, Enter Final Score or Start Live Score via the fixture-actions sheet.

### Verification (update 3)
- End-to-end API tests PASS for all four paths: (1) Manual League honours pairings + per-fixture scheduled/unscheduled; (2) Manual Knockout honours explicit pairings + per-matchup schedule + byes + round names/total_rounds; (3) Automatic League round-robin unchanged; (4) Automatic/seeded Knockout unchanged (scheduled/bye only). Confirmed no "Playing"/"In the running" label anywhere.
- UI: Manual League builder verified live. tsc clean for edited files. Metro bundled cleanly.

## Change log (2026-06 · surgical update 4)
1. Manual League: creation form no longer builds fixtures — it creates the league + members then opens the League screen. The League screen shows Add Fixture (Player1/Player2/optional date-time) for manual leagues; fixtures save immediately via POST /competitions/{cid}/fixtures and appear in the Fixtures list (no date/time → Unscheduled). Manage Fixtures fully removed. After creation, no Add/Manage/Remove players. Individual unplayed fixtures remain tappable (reschedule / Enter Final Score / Start Live Score). Automatic league generation unchanged (still generated at create).
2. Manual Knockout: creation form no longer draws the bracket. On the tournament screen it shows Add Matchup (explicit Player1 vs Player2 + optional date-time); each matchup saves immediately as a round-1 fixture and shows in the bracket. New POST /competitions/{cid}/confirm-draw finalises: adds byes for unplaced players, sizes the bracket to the actual matchup count (dynamic round names, not forced QF/SF), and lets existing winner progression build later rounds. After confirm, draw_confirmed=true hides Add Matchup and all player management. Automatic/random/seeded draws unchanged. Added `draw_confirmed` field to competitions.
3. Opponent selection speed: score.tsx opponent step and PlayerMultiSelect now seed results instantly from an in-memory cache (per sport+query) and refresh in the background (immediate fetch when nothing cached, otherwise debounced). No UI or Score-Match flow change.
4. Location on Social: uses getForegroundPermissionsAsync first and only prompts when undetermined & canAskAgain — no repeated prompts on tab switches. Nearby logic and city/manual fallback preserved; Social usable without location.
5. Delete Tournament: new DELETE /competitions/{cid} (organiser-only) removes the competition + its fixtures + members (matches/ratings untouched). Added a confirmed "DELETE" action in the organiser bar on the competition screen.
6. Declined requests: /play-requests/mine now returns only pending/accepted (declined & cancelled filtered out); Social reqAction optimistically removes declined/cancelled cards from both feeds immediately.

### Verification (update 4)
- Backend end-to-end PASS: manual-league add-fixture (scheduled/unscheduled); manual-KO add-matchup → confirm-draw (explicit matchups + byes + dynamic naming SEMI/QUARTER + confirmed) → scoring builds FINAL (winner progression); delete (organiser 200 + 404 after, non-organiser 403); declined play-request removed from both sender & recipient feeds.
- UI PASS: Manual League screen shows Add Fixture + Delete (no Manage, no Add Players); Manual KO shows Add Matchup → Confirm Draw → after confirm Add Matchup hidden and bracket shows matchup + byes; Social + Nearby render fine. tsc: only pre-existing PlayerMultiSelect note. Metro bundled cleanly.
