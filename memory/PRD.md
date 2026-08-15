# ATHLERA — Product Requirements & Build Log

## Original Problem Statement
Improve ATHLERA (existing Expo + FastAPI + MongoDB app) in place: sport-specific scoring (Squash Let/Stroke/No Let, Tennis sets/tiebreak, Padel adv/golden/star, Badminton cap-30, Pickleball side-out) with manual-score validation; streamlined live score (no timers, optional toss, choose server); Competition vs One-Off for live + manual results; private League/Knockout creation from sport pages (no fees/venue) with Automatic/Manual fixtures; Manage Fixtures (schedule/reorder/remove/edit, statuses Unscheduled/Scheduled/Live/Complete); public Events tab (venue/fee/register/withdraw, only public in discovery); organiser permissions; smooth player multi-select (search/nearby/chips); clickable nearby players (Profile/Ask/Message); location permission with manual-city fallback; auto-add unselected sports at low provisional rating; light/off-white theme redesign; gamification animations.

## Architecture
- Frontend: Expo SDK 54 + expo-router, React Native Web. Light off-white theme (`src/theme.ts`), Barlow Condensed (display) + DM Sans (body), sport accent colors.
- Backend: FastAPI + Motor (MongoDB), all routes under `/api`. JWT auth (bcrypt). UUID string IDs, never returns raw `_id`. `JWT_SECRET` in backend/.env.
- Scoring: authoritative server-side state machine (`backend/scoring.py`) with reusable per-sport `SPORT_RULES`; live events + Undo; rating engine applies on finalize.

## User Personas
- Competitive amateur wanting a cross-sport identity/rank.
- Casual/rec player tracking improvement and finding opponents.
- Organiser running private social leagues/knockouts.

## Implemented (2026-06, resumed session)
- ✅ FIXED backend boot crash (missing JWT_SECRET added to backend/.env).
- ✅ Light theme across app (auth, dashboard, sport pages, social, compete, competitions).
- ✅ Sport scoring engine verified (all 5 sports, Squash Let/Stroke/No Let, Undo, tennis tiebreak, padel golden/star, badminton cap-30, pickleball side-out) — pytest + targeted tests.
- ✅ Live scoring: One-Off + Competition modes, optional racket-spin/coin toss + Skip, choose first server, finalize updates ratings + fixture/standings/bracket.
- ✅ Private League/Knockout create from sport pages: private-only (no fee/venue), player multi-select (search + nearby + chips) via `PlayerMultiSelect`, Automatic (round-robin / knockout rating|random|manual draw) or Manual fixtures.
- ✅ Manage Fixtures (organiser): schedule date/time, reorder, remove, add fixture (manual league); statuses Unscheduled/Scheduled/Live/Complete; completed fixtures locked; Add Players sheet.
- ✅ Competition vs One-Off on manual Record-Match (Score tab) — competition routes to fixture entry.
- ✅ Events tab: create (venue/fee/public|private), register/withdraw, only public in discovery, readable card scrim.
- ✅ Social: nearby players clickable (Profile/Ask to Play/Message), LTP, play-requests, messaging; location permission + manual city fallback. Fixed Social tab crash (missing useEffect import).
- ✅ Auto-add unselected sport at provisional beginner rating (POST /player-sports/ensure + implicit via live/create + finalize).
- ✅ Champion confetti + result overlay.
- Backend added: POST /api/competitions/{cid}/fixtures (organiser add single fixture).

## Backlog (prioritized)
### P1
- Richer gamification moments on live-finish (Level Up / New PB / streak / ranking-move overlays with reanimated).
- "Invite to Competition" action on nearby player cards.
- Doubles player selection UI in live setup (backend supports doubles).
### P2
- Google/Apple sign-in (Emergent-managed).
- Rating history chart polish; UAS history.
- Organiser result-correction flow for completed fixtures (currently locked).

## Test Credentials
- qa.tester@athlera.dev / Test1234! (onboarded squash + tennis). See /app/memory/test_credentials.md.

## Testing status
- Backend: comprehensive pass (iteration_3) — scoring, competitions, fixtures, events, social, auto-add.
- Frontend: E2E ~92% (iteration_4); 2 HIGH UI bugs fixed (manual-score-sheet inline error `mg-error`; event card light text). Events readability re-verified.

---

## UPGRADE LOG — Multi-feature overhaul (2026-08-15)

Original problem statement: In-place upgrade of ATHLERA. Add Social Feed, replace "+" with Score Match action, all-sport provisional ratings, richer splash, Looking-to-Play responses, visual Knockout brackets, League board UX, central Match History, Events currency + real payments, functional public Event registration + organiser admin, public/private event discovery, City/Country filters on Events & Leaderboards. User choices: real online payments (Stripe), Like+few reactions, splash auto-advances, keep dark navy + purple theme, follow listed priority order.

### PHASE 1 — DONE & VERIFIED (2026-08-15)
- Premium splash (app/index.tsx): richer gradient, ambient brand glow, sport court-lines, gradient wordmark bar, tagline, progress bar, AUTO-ADVANCE after ~2.6s (tap to skip).
- Score Match fast flow (app/(tabs)/score.tsx + tab bar): center tab now a labelled SCORE button. Flow = Sport (ALL 5 sports, NEW/Provisional badges) -> Opponent (ALL athletes) -> One-Off/Competition -> Live Score (routes to /live/setup with opponent preselected) or Enter Final Score (inline preview+submit). Success card offers View Match + Share to Feed.
- All-sport provisional ratings (backend): /api/opponents/search returns ALL athletes for ANY sport; /api/matches/preview & /submit auto-add player_sport (provisional) for both players for any sport.
- Social Feed (backend feed_posts collection + endpoints /social/feed, /feed/{id}, /feed/{id}/react, /feed/{id}/comment, /feed/share-match, /matches/detail/{id}; frontend FEED tab + FeedCard + /feed/[id] comments + /match/[id] detail). Auto-post on verified match. Like + reactions (like/fire/clap/muscle/trophy), comments, open profile, open Match Details, share match to feed.
- Backend tests: /app/backend/tests/test_phase1_feed.py 11/11 pass.

### REMAINING BACKLOG (priority order)
- P0 Looking to Play responses: "I'm Interested" + "Message", notify creator, responses linked to post, private conversation, Score Match once arranged.
- P0 Knockouts: visual tournament draw (rounds, seeds, dates, scores, statuses, auto winner progression), mobile-friendly.
- P0 League UX: League Board/Home (Standings, Current Round, Fixtures, Results, Players, Recent Activity), fixtures by rounds with Score Match actions.
- P0 Match History: central area from Profile/sport pages, all One-Off/League/Knockout, filters (All, Sport, One-Off, League, Knockout, Wins, Losses, Date), open Match Details.
- P1 Events: Paid/Free dropdown, currency dropdown (INR/GBP/USD/EUR/AED/AUD/CAD/SGD + Other custom), fee when Paid.
- P1 Public Event registration: Register/Withdraw, status, details, participants, fixtures/draw, schedule, Score Match on assigned fixture.
- P1 Event organiser/admin: manage registrations/participants, approve/remove, edit info, create/manage League or Knockout, generate/edit fixtures, schedule/reschedule, manual results, live score fixtures.
- P1 Public/private discovery: only public events in discovery; private only to invited/registered.
- P1 City/Country filters on Events & Leaderboards (Global/Country/City), privacy-preserving.
- P2 Real online payments (Stripe) for Paid events — needs user's Stripe keys (integration_expert playbook pending).
