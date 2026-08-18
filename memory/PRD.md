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
