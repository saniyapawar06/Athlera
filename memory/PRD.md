# ATHLERA — Product Requirements & Build Log

## Original Problem Statement
Build ATHLERA, a cross-platform competitive sporting-identity platform for Squash, Padel, Tennis, Badminton, Pickleball. Sport-specific ratings + Universal Athlete Score (UAS 0–1000), match recording, live scoring, leaderboards, leagues, tournaments, events, player discovery, messaging, social feed and achievements. Opening brand screen ("Era of the Athlete"), auth (email/Google/Apple/guest), onboarding with accredited-rating upload or level pick, provisional ratings, server-validated rating engine, verification workflow. Spec requested Supabase; environment uses FastAPI + MongoDB (user approved).

## Architecture
- **Frontend**: Expo SDK 54 + expo-router (file-based), React Native Web. Dark-first tactical UI, Barlow Condensed (display) + DM Sans (body), sport-specific accent colors. Bundled TTF fonts under `assets/fonts`.
- **Backend**: FastAPI + Motor (MongoDB), all routes under `/api`. JWT auth (bcrypt, token revocation on logout). UUID string IDs, never returns raw `_id`.
- **Auth**: JWT email/password + Guest. `expo-secure-store` (native) / AsyncStorage (web) token persistence via `src/api.ts` + `src/auth-context.tsx`.
- **Rating engine (server-side)**: scale=max(minScale, 2·stdev), K=scale·0.12, expected=1/(1+10^((loser−winner)/scale)), marginMultiplier=1+0.9·marginScore (0.55·unitDom+0.45·pointDom, capped), anomaly damping (winProb>0.95 & gap>2.5σ), provisional ×2 boost for first 5 matches. UAS = 1000·avg percentile across rated sports.

## User Personas
- **Competitive amateur** wanting an objective cross-sport identity and rank.
- **Casual/rec player** tracking improvement and finding opponents.
- **Guest** exploring before committing to an account.

## Core Requirements (static)
- Brand opening, auth+guest, onboarding, provisional ratings, per-sport scales, UAS, match entry + preview + verification, sport-specific score validation, rankings, events, social, competitions, achievements, notifications.

## Implemented (2026-06)
- ✅ Opening brand screen (tap logo to enter)
- ✅ Auth: register / login / guest (+ token revoke on logout)
- ✅ Onboarding: sport multi-select → accredited-rating (provider + value + screenshot base64, stored as pending external submission) OR level pick → provisional ratings → summary
- ✅ 5-tab bottom nav (Sports / Compete / Score+ / Social / Rankings)
- ✅ My Sports dashboard: UAS hero, sport cards (rating, provisional/verified, band, rank, peak, percentile)
- ✅ Sport detail: Overview (stats + record CTA), Leaderboard (top 50), Scores (match history)
- ✅ Match entry: pick sport → opponent search → score entry → server rating preview (Upset/Clear Win tags, win prob, dominance) → confirm & submit
- ✅ Score validation for all 5 sports (server-side, derives winner)
- ✅ Match verification (auto-verify vs seed opponents; pending_confirmation vs real users; confirm/dispute endpoint)
- ✅ Rankings: per-sport + UAS leaderboards
- ✅ Events (Compete tab) with city/sport chip filters; Social community feed; public athlete profile; own profile with add-sport + logout
- ✅ ~36 seed athletes for populated leaderboards
- ✅ 36 backend pytest cases + full frontend E2E verified

## Backlog (prioritized)
### P0 (next)
- Live scoring engine (real-time score state, server/game tracking, undo, resume, spectators) for all 5 sports incl. tennis 0/15/30/40/adv + tiebreaks, doubles "sides".
- Match confirmation UI for real-opponent matches (currently endpoint-only) + notifications.
### P1
- Competitions: leagues (fixture generation, standings), tournaments, knockouts (seeding, byes, champion animation).
- Social: nearby players, Looking-to-Play, play requests, 1:1 realtime messaging, follows/friends leaderboard.
- Achievements + in-app notifications.
- Rating history chart on sport detail; UAS history & peak UAS.
### P2
- Google/Apple sign-in (Emergent-managed), guest→account data merge/upgrade.
- Push notifications (native build only).
- Admin verification console for external_rating_submissions; external-provider conversion layer.
- Desktop top-nav/sidebar layout parity.

## Next Tasks
1. Live scoring (P0) — highest-value differentiator.
2. Real-opponent confirmation UI + notifications.
3. Leagues/knockouts competition engine.

## Known non-blocking notes
- RN Web console warnings (shadow*/pointerEvents deprecations) — cosmetic.
- Score screen starts with 1 game row; users tap "+ ADD GAME" for BO3.
