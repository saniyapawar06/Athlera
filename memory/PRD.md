# ATHLERA — Product Requirements & Progress

## Original Problem Statement
Refine ATHLERA's gamification using existing data/components only (no new XP/currency system, no rewrite of working features). Make progress feel rewarding through real sporting metrics: rating movement, rank movement, personal bests, streaks, recent form, achievements and competition progress. Surface compact insight cards on Home/My Sports; add milestone achievements; use lightweight celebration levels; show post-match motivation for wins and losses; show recent form + rating/rank trends; allow sharing major moments to a Social Feed. Keep it premium, competitive, sport-focused, fast, low-latency.

## Architecture
- **Frontend:** Expo Router (React Native), reanimated animations, dark premium theme (BarlowCondensed display font), tab navigation.
- **Backend:** FastAPI + MongoDB (motor). All routes under `/api`. JWT auth.
- **Existing metrics reused:** player_sports (rating, peak_rating, matches_played, wins, provisional, current_streak, best_streak, recent_form), rating_history, matches (rating_changes, tags), competitions/fixtures (rounds, champions), UAS score.

## User Personas
- **Competitive club athlete** tracking real ratings/ranks across multiple racket sports.
- **Multi-sport player** motivated by cross-sport milestones and leaderboards.

## Core Requirements (static)
1. Compact, metric-based insight messages on Home/My Sports.
2. Milestone achievement catalog on real sporting metrics (no XP/currency).
3. Celebration levels: number tick (small gain), short overlay (PB/streak/rank), trophy+confetti (competition win).
4. Post-match motivation for both wins and losses.
5. Recent form + rating/rank trends.
6. Share achievements/PBs/streaks/rank jumps/competition wins to a Social Feed.

## Implemented (2026-08-16)
- **Backend gamification layer** (`/app/backend/server.py`):
  - Achievement catalog (21 codes): First Win, Upset Win, New PB, streaks 3/5/10, matches 10/25/50/100, Top 100/50/10/3, #1, League/Knockout/Tournament Champion, multi-sport 2/3/5.
  - `_evaluate_achievements` hooked into both result paths (`_apply_verified_match`, `_apply_result_general`); idempotent unlock via `achievements` collection.
  - Weekly rank movement stamped onto `rating_history`; `_rank_delta_week`.
  - `_build_sport_insights` -> dashboard `cards[].insights` (PB gap, streak, recent form, rank movement, next fixture round label, provisional countdown).
  - Competition champion awards (`_award_competition_achievements`) for knockout/league/tournament.
  - One-time `_backfill_achievements` from existing history (idempotent).
  - Endpoints: `GET /me/achievements`, `POST /social/share`; `GET /social/feed` now merges shared highlights + recent match results; dashboard returns `recent_achievements` + distinct-code `achievement_count`/`achievement_total`.
  - Match submit returns applied `rating_change` for immediate celebration.
- **Frontend:**
  - `src/gamification.ts` (celebration level, headlines, loss motivation, share-payload builder, tier/tone colors).
  - Enhanced `ResultOverlay` (animated rating tick, achievement chips, motivation subline, form dots, Share button, level-gated confetti).
  - `AchievementBadge` component.
  - Home (`(tabs)/index.tsx`): UAS hero with Trophies stat, Momentum strip, per-sport insight pills.
  - Trophies screen (`trophies.tsx`): progress bar + category groups + locked/unlocked badges.
  - Profile: Trophy Room section + recent achievement chips.
  - Social (`(tabs)/social.tsx`): new FEED tab merging highlights + results.
  - Score + Live flows: celebration overlay with achievements + share on match completion.
  - Bottom-tab testIDs added.
- **Verified:** Testing agent (backend 9/9 + full frontend E2E) passed; fixed trophy-count inconsistency (now distinct-code 10/21 everywhere).

## Backlog (prioritized)
- **P1:** `is_seed` flag in opponent search so UI signals auto-verify vs pending confirmation.
- **P2:** Rank trend sparkline on sport detail; per-sport achievement drill-down; shareable achievement image cards.
- **P2:** Head-to-head insights ("beaten X 3 times").

## Next Tasks
- Optional polish per user feedback; otherwise stable.
