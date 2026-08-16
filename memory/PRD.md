# ATHLERA — Product Requirements & Progress

## Original Problem Statement
Continue the existing ATHLERA codebase (Expo Router + FastAPI + MongoDB) in place — no rebuilds. Improve Score Match (One-Off opponent-first; Competition fixtures for participants & organisers), League/Knockout/Event scheduling with real Date/Time pickers, functional privacy-safe Nearby Players, richer Social Feed, Home/My Sports gamification, premium navy splash, finish Emergent Google auth, paid Public Event registration (Razorpay) with participant details + states, structured Country/City dropdowns + Events filtering. Keep working Squash scoring/rating/competition engines intact.

## Architecture
- Frontend: Expo Router (`/app/frontend/app`), theme `src/theme.ts`, API client `src/api.ts`, auth `src/auth-context.tsx`.
- Backend: FastAPI single file `/app/backend/server.py`, scoring `scoring.py`, MongoDB (motor). All routes under `/api`.
- Auth: JWT (email/guest) + Emergent-managed Google OAuth (`/auth/session`). Test account: qa.tester@athlera.dev / Test1234!
- Payments: Razorpay. TEST-MODE fallback when no keys (mock-confirm); auto-switches to live checkout when RAZORPAY_KEY_ID/SECRET added to backend/.env.

## Core Requirements (static)
- Preserve Squash live scoring, rating engine, provisional ratings, competition/bracket engines.
- Dark premium sports identity; navy splash (no dark purple).
- CTAs must persist real data; strong empty states + obvious next actions.

## Implemented (this session — Aug 2026)
- Navy premium animated splash (`app/index.tsx`) with glow/motion; ATHLERA + ERA OF THE ATHLETE prominent.
- Reusable `DateTimeField` (native pickers + web text fallback) wired into competition schedule/reschedule + manual Add Fixture (with optional date/time).
- `CountryCityPicker` + bundled `src/data/geo.ts`; used in Event create; Events filtering by Nearby/Country/City/Sport/Date/Free-Paid (`/events/upcoming` params).
- Paid Event registration: participant details + fee review + Razorpay (test-mode mock-confirm) + states Pending/Confirmed/Failed/Cancelled (`event_registrations`); free events confirm instantly; withdraw cancels. WebView checkout + verify + callback endpoints for live mode.
- Nearby Players: List + Radar map (privacy-safe approximate distance/bearing, no coords), View Profile / Ask to Play / Message / Invite to Competition.
- Social Feed richer typed cards (match_result, competition_win, personal_best, looking_to_play) preserving like/comment/details.
- Home gamification strip: current/longest streak, best rank, matches this week, recent form W/L, badges; lightweight `CelebrationBanner` (Level Up/PB/Streak/Top10/Keep It Up/Champion, shown once per milestone).
- Score Match competition picker now surfaces comps the user organises OR that have fixtures; empty state -> Create League/Knockout.

## Already-present & verified working (not rebuilt)
- Email/Guest auth, onboarding, dashboard, sport pages, Squash live scoring engine, rating calcs, competitions create/manage, standings, knockout bracket, match history/details, messaging, Looking to Play, play requests.

## Test status
- Backend pytest 16/16 (`tests/test_athlera_v5_review.py`) + curl smoke: events create/filters, paid+free registration, mock-confirm, gamification, feed types, nearby, fixture scheduling — all pass.
- Frontend smoke (testing agent iteration_5): all new flows verified. No blocking bugs.

## Backlog / Remaining
- P2: RN-Web deprecation warnings (shadow*/textShadow*/pointerEvents) — cosmetic web-only.
- P2: Make `EventCreateIn.city` Optional so missing-city returns 400 (currently 422 from pydantic).
- P3: Split server.py into routers.
- P3: Live Razorpay verification requires real keys + deploy (WebView deep-link tested only in test-mode).
