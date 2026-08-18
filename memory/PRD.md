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
