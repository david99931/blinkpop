# Project Spec: "First Fan" — Early-Discovery Music Game (working title)

Handoff document for Claude Code. Read this fully before writing code. Decisions marked **[DECIDED]** are settled — implement as written. Items marked **[OPEN]** are for the developer/founder to confirm; pick the suggested default and flag it if you must proceed.

> **v1.1 (2026-08-05):** §4.2 changed by the founder — the underdog multiplier is
> now keyed to the **artist's average plays** at pick time (equal expected value
> per artist), not the track's own baseline. Track baseline still gates which
> milestones can pay. Fixtures in §4.6 are unchanged (story artists are
> single-track, so artist average = track baseline at pick time).
>
> **v1.2 (2026-08-05):** two founder additions — **§4.7 early-bird bonus**
> (reward for picking inside a track's first 100 / 1,000 plays, paid only when
> the call proves out) and **§4.8 weekly super pick** (one extra pick per
> user-local ISO week at 5× points). Game rule 9 added in §3.
>
> **v2.0 (2026-08-05):** founder redesign of the point engine — points now
> accrue **continuously, proportional to plays gained** (settled every couple
> of hours), with milestones demoted to bonuses (§4.3/§4.4 rewritten). The v1
> weekly growth bonus is retired (continuous accrual supersedes it). §4.6
> examples updated.

---

## 1. Product Overview

A competitive social app where users get status for discovering songs *before* they blow up. Think Letterboxd × fantasy sports for music taste.

Core loop:
1. Each user locks in **one song pick per day**.
2. The app records the track's stats (plays, likes, reposts) at the moment of the pick.
3. As the track grows, the user earns points — scaled so that early calls on tiny artists are worth far more than picks of already-popular songs.
4. Profiles ("portfolios") showcase a user's best calls; leaderboards and a friend feed drive competition and music discovery.

**Platform strategy [DECIDED]:** SoundCloud-first MVP. SoundCloud allows full in-app playback for free via its API/widget, exposes exact `playback_count` (plus likes/reposts) in its public API, and its underground catalog matches the "find them before they blow up" culture. Spotify integration is a later phase — the architecture must keep the music platform behind an abstraction layer so a second provider can be added without touching game logic.

**Build phasing [DECIDED]:**
- **Phase 1 (build first):** Entire app running against a **mock music provider** with simulated data. No external API calls. All game mechanics, scoring, and UI testable locally.
- **Phase 2:** Swap in the real SoundCloud provider behind the same interface. (SoundCloud app registration + credentials will be provided later; stub the config.)

---

## 2. Tech Stack Suggestions **[OPEN — confirm or substitute]**

Suggested defaults (founder has not mandated a stack):
- **Backend:** Node.js + TypeScript (Fastify or Express), PostgreSQL, a scheduled-job runner (node-cron acceptable for MVP).
- **Frontend:** React (Vite) as a mobile-first responsive web app. Native mobile comes later; do not build native now.
- **Auth:** Simple email/password or magic-link for MVP. SoundCloud OAuth is NOT required for MVP (client-credentials covers public data; picks happen in-app).
- Monorepo with `/server`, `/web`, `/shared` (shared types for domain objects).

Keep it boring and readable. No microservices, no Redis, no queues unless a real need appears.

> **Implementation note (settled during build):** SQLite via Node's built-in
> `node:sqlite` for Phase 1 on this machine (no Docker/Postgres available);
> SQL kept portable, Postgres remains the production target.

---

## 3. Core Game Rules **[DECIDED]**

1. **One pick per day per user.** Resets at midnight in the user's local timezone. No banking: unused picks are lost.
2. **Picks are immutable.** Once confirmed, a pick cannot be edited or deleted. The confirmation step in the UI must make this weighty and explicit.
3. **A user can never pick the same track twice** (lifetime, per user).
4. **Multiple users may pick the same track.** Later pickers earn less: apply a **pick-order decay** (see scoring). Being the first picker of a track that moons is the best outcome in the game.
5. **Eligibility — soft cap, not hard block.** Any track can be picked, but tracks by already-popular artists earn a near-zero underdog multiplier (see scoring). Optionally warn in the UI: "This artist is already popular — low point potential."
6. **Scoring window:** each pick is "live" for **180 days** from pick time. After that it stops accruing points (portfolio still displays it forever).
7. **Streaks:** consecutive days with a pick build a streak counter. Streak affects nothing in scoring for MVP — it is displayed for status only. **[OPEN]** streak point bonuses later.
8. **Settlement cadence (v2):** every live-picked track is re-polled and settled **every 2 hours** (growth accrues through the day); "hot" tracks (milestone crossed in the last 7 days) are re-polled **hourly**. Cadence is a config value.
9. **Weekly super pick (v1.2):** on top of the daily pick, each user gets **one super pick per user-local ISO week** (Monday reset). It is an extra pick — it does not consume the daily slot — and every point it earns is multiplied 5× (§4.8). All other rules apply unchanged (immutable, never the same track twice across daily+super, 180-day window, normal pick_rank).

---

## 4. Scoring System **[DECIDED as v1.1 — expect tuning]**

All scoring inputs come from the provider snapshot history (mock or SoundCloud). Primary metric: **playback_count** (plays). Secondary: likes, reposts.

### 4.1 Definitions

For a pick P of track T by user U:
- `B` = plays at pick time (baseline, from the snapshot taken at confirmation)
- `A` = the artist's average plays across their tracks, at pick time
- `C` = current plays (latest snapshot)
- `gained` = C − B

### 4.2 Underdog multiplier (the heart of the game) — **artist-based (v1.1)**

Rewards discovering **unknown artists**, so every artist carries roughly equal
expected value. Based on the artist's average plays `A` at pick time:

```
underdog(A):
  A < 1,000        → 10.0
  A < 10,000       → 5.0
  A < 50,000       → 2.5
  A < 250,000      → 1.0
  A < 1,000,000    → 0.3
  else             → 0.05
```

Tiers, not a continuous function — easier to explain to users ("you found them
in the under-1k tier") and easier to rebalance.

Why artist-based (changed from track-based in v1.0): a brand-new single from a
mega-artist starts at ~0 plays. Under track-based tiers that pick landed in the
10× tier and was a guaranteed jackpot — no discovery involved. Keying the tier
to the artist closes that exploit and centers the game on finding *people*
before the crowd does.

Fallback: if the provider cannot supply artist stats for a track (stats
disabled, legacy picks made before v1.1), use the track baseline `B` in place
of `A`.

Artist identity: provider-scoped (mock: exact artist name; SoundCloud: the
user id behind the track).

### 4.3 Continuous growth accrual (primary point source, v2)

Points accrue **proportionally to plays gained**, settled every couple of
hours (each snapshot pass), so a portfolio moves through the day like a stock
ticker instead of jumping at milestones:

```
points = plays gained × (1 / 1,000) × underdog(A) × orderDecay(rank) × super
```

Mechanics:
- Emitted as `growth` score events, one per snapshot that has banked enough
  gain; tiny gains **bank** until they are worth ≥ 1 point (no dust events).
  The awarded total always telescopes to `(current − baseline) / 1000 × mult`
  regardless of how often settlement runs — pure and idempotent.
- Only accrues inside the 180-day live window.
- Growth events are silent: no notifications, hidden from the feed (the drip
  would drown it). Milestone/early-bird moments carry the fanfare.

`orderDecay(rank)` — rank is the user's position among all users who picked T (1 = first):

```
orderDecay(rank) = max(0.25, 0.9 ^ (rank − 1))
```

First picker gets 1.0, second 0.9, third 0.81 … floor at 0.25.

### 4.4 Milestone bonuses (secondary, v2 — was the primary source in v1)

Bonus points when the track **crosses absolute play milestones after the pick**. Milestones already passed at pick time never pay out (this stays keyed to the track baseline `B`).

```
MILESTONES = [10k, 25k, 50k, 100k, 250k, 500k, 1M, 2.5M, 5M, 10M]
BASE_POINTS = [ 10,  15,  25,   40,   75,  125, 250,  400, 650, 1000]
```

Award for each milestone M crossed while the pick is live:

```
points = BASE_POINTS[M] × underdog(A) × orderDecay(rank) × super
```

*(The v1 weekly growth bonus is retired — continuous accrual pays the same
growth, better. Legacy `weekly_growth` score events remain valid in old data.)*

### 4.5 Engagement signals **[OPEN — v1.1, design for it, don't build yet]**

Reposts/likes velocity as an "early heat" bonus. Leave columns in snapshots for likes and reposts from day one so history exists when this ships.

### 4.6 Worked examples (use as unit-test fixtures)

Each story artist below has exactly one track, so `A = B` at pick time.
Numbers are v2 (growth accrual + milestone bonuses).

1. **The dream call:** picked at B = 600 plays, artist averaging 600 (underdog 10.0), first picker (decay 1.0). Track runs to 1.2M in 90 days. Growth: (1,200,000 − 600)/1000 × 10 ≈ **11,994 pts**, accruing continuously. Milestone bonuses: all 7 from 10k→1M → (10+15+25+40+75+125+250) × 10 = **5,400 pts**. Early bird (< 1k): +200. Total ≈ **17,594 pts**.
2. **Late to the party:** same track, picked when it (and the artist's average) sits at 300,000 (underdog 0.3), 14th picker (decay 0.9^13 ≈ 0.254). Milestone bonuses 500k + 1M → (125+250) × 0.3 × 0.254 ≈ **29 pts**, plus growth ≈ (900k/1000) × 0.3 × 0.254 ≈ 69 pts.
3. **The flatline:** picked at B = 2,000, track drifts to ~6,200. No milestone, no bonuses — just a growth drip of ≈ **21 pts**. Noise. Rarity of BIG numbers is the product; near-zero is still the common outcome.
4. **Big-artist pick:** picked at B = 4M, artist averaging 4M (underdog 0.05), runs to 10M: growth 6,000 × 0.05 = **300 pts** + milestone bonuses (650+1000) × 0.05 = **82.5** → ≈ 382.5 total. A mega-hit run still earns a fraction of one true early call (≈ 46× less). Verify this ratio holds in tests; it is the core balance invariant.
5. **The exploit that must stay dead (v1.1):** a 600-play track that runs to 1.2M — but by an artist averaging 4M plays. Underdog(A) = 0.05 applies to growth AND bonuses → ~627 pts total, not ~17.6k. New single ≠ new artist.

### 4.7 Early-bird bonus (v1.2)

Reward for being among a track's **first listeners** — the incentive to be in the
first 100 or first 1,000 plays:

```
earlyBird(B):
  B < 100    → 50 base points  ("first 100")
  B < 1,000  → 20 base points  ("first 1k")
  else       → no bonus
```

Paid **once per pick**, as its own score event (`early_bird`), and **only when
the track crosses its first milestone** while the pick is live — never at pick
time. This is deliberate: an instant bonus would reward shotgunning any
50-play track daily; gating it on the first milestone means the bonus only
lands when the early call actually proved out.

`points = earlyBird(B) × underdog(A) × orderDecay(rank) × super(5× if super pick)`

Dedupe key: `pick:{id}:early_bird`.

### 4.8 Weekly super pick (v1.2)

One per user per user-local ISO week (game rule 9). Every score event the pick
earns — milestones, weekly growth, early bird — is multiplied by **5**. The UI
must make spending it feel weighty (it's the week's one big swing); the
confirmation modal states that it does not consume the daily pick.

Worked example: the §4.6 dream call made as a super pick = 5,400 × 5 =
**27,000 milestone pts** (plus the early-bird bonus, also ×5).

Scoring must be implemented as a **pure, deterministic function** of (pick, snapshot history, competing picks) → score events. No side effects inside scoring. The batch job feeds it data and persists the resulting events. Recomputing from scratch must always give the same result (idempotent settlement).

---

## 5. Provider Abstraction **[DECIDED — this is the most important architectural requirement]**

Define an interface, e.g.:

```ts
interface MusicProvider {
  searchTracks(query: string): Promise<TrackSearchResult[]>;
  getTrack(providerTrackId: string): Promise<TrackDetails>;      // includes current stats + artistAvgPlays
  getTrackStats(providerTrackId: string): Promise<TrackStats>;   // plays, likes, reposts, fetchedAt
  getEmbed(providerTrackId: string): EmbedInfo;                  // widget/player payload for the UI
}
```

Implementations:
- `MockProvider` (Phase 1): backed by a local dataset + simulator (see §6).
- `SoundCloudProvider` (Phase 2): real API. Stub the class now with TODOs; wire config for client credentials.

Game logic (picks, scoring, feed, leaderboards) must never import provider-specific code. Track identity in the domain layer is `(provider, providerTrackId)`.

### SoundCloud implementation notes (for Phase 2, written now so the abstraction fits reality)
- Auth: client-credentials flow covers public data (search, track fetch, playback/URL resolution). No user OAuth needed.
- Stats: track objects expose `playback_count`, `likes_count` (historically `favoritings_count`), `reposts_count`. **Verify exact field names against the current OpenAPI spec at developers.soundcloud.com — do not trust this doc or training data for field names.** Some tracks may have stats disabled — provider returns `null` stats; game logic must treat pick as "pending data" and exclude from scoring until stats exist.
- Artist average plays: mean `playback_count` over the artist's tracks (`GET /users/{id}/tracks`), cached aggressively — one call per artist, not per track. Emit null when unavailable (scoring falls back to track baseline).
- Playback: SoundCloud widget embed (full tracks, free). Respect attribution/branding requirements — always show SoundCloud branding + link back to the track page.
- Rate limits exist (historically ~15k plays/day app-wide and request quotas). Centralize all API calls through one client with request budgeting and caching.
- Snapshot polling: daily for all live-picked tracks; hourly for "hot" tracks. Only tracks that have ever been picked get polled — keeps volume trivial.

---

## 6. Mock Data + Simulator (Phase 1 core deliverable)

Build a seedable, deterministic simulator so the whole game is testable:

- Generate ~500 fake tracks across archetypes: **moonshot** (~2%: slow start then explosive growth to 1M+), **riser** (~10%: steady 20–60% weekly growth), **spike-and-die** (~8%: one viral week then plateau), **flatliner** (~70%), **slow-burn** (~10%: dormant for weeks, then takes off — tests the 180-day window).
- Each track gets a plays/likes/reposts time series generated day-by-day with noise. Seeded RNG: same seed → same universe.
- A **time-warp control** (dev-only endpoint or CLI): advance the simulated clock N days, which appends snapshot rows and triggers settlement. This is how you demo the app: pick tracks, warp a week, watch points and feed events appear.
- Include a handful of hand-authored "story" tracks with known trajectories matching §4.6 examples exactly, used in automated tests.

---

## 7. Data Model (Postgres — adjust as needed)

```
users            id, handle, display_name, email, tz, created_at
follows          follower_id, followee_id, created_at
tracks           id, provider, provider_track_id, title, artist_name,
                 artwork_url, permalink_url, first_seen_at
                 UNIQUE (provider, provider_track_id)
track_snapshots  id, track_id, plays, likes, reposts, captured_at
                 -- append-only; the time series
picks            id, user_id, track_id, picked_at, pick_date (user-local date),
                 pick_week (user-local ISO week, v1.2), kind (daily|super, v1.2),
                 baseline_snapshot_id, pick_rank (order among pickers of track),
                 artist_avg_plays (artist popularity captured at pick time, v1.1),
                 expires_at (picked_at + 180d), status (active|expired)
                 UNIQUE (user_id, track_id)            -- spans daily and super
                 UNIQUE (user_id, pick_date) WHERE kind='daily'
                 UNIQUE (user_id, pick_week) WHERE kind='super'
score_events     id, pick_id, type (milestone|weekly_growth|early_bird), milestone_value NULL,
                 points, computed_at, dedupe_key UNIQUE
                 -- dedupe_key e.g. "pick:{id}:milestone:100000" makes settlement idempotent
streaks          user_id, current_streak, longest_streak, last_pick_date
```

Derived (view or cached): user total score = SUM(score_events.points) over their picks; leaderboards read from this.

Enforce the two UNIQUE constraints on `picks` at the DB level — they encode game rules 1 and 3.

---

## 8. Screens (mobile-first web)

1. **Onboarding:** account creation, pick a handle, brief "how it works" (3 cards: pick daily → earn when it blows up → climb the board).
2. **Home / Daily Pick:** shows today's status (picked / not picked), streak, countdown to reset. Search box → results list (artwork, artist, current plays, underdog tier badge like "🔥 artist <1k — 10× tier"). Track detail: embedded player (mock: fake player UI), stats, **"Lock in today's pick"** → confirmation modal stating immutability → locked state.
3. **Portfolio (profile):** total score, streak, badge row; list of picks as position cards: artwork, "picked at X plays → now Y plays", points earned, milestone chips. Best pick pinned on top. This screen is the product's status artifact — make it screenshot-worthy. Public at /u/:handle.
4. **Feed:** followed users' pick events ("Alex locked in [track] — 3.2k plays, 5× tier") and score events ("Sam's pick crossed 100k 🚀 +400 pts"). Each card links to the track (playable) — the feed doubles as music discovery.
5. **Leaderboard:** global + friends tabs; all-time and current season (season = calendar month; season score = points from events in that month).
6. **Track page:** track info, player, sparkline of plays over time, list of pickers ranked by pick order with their baselines ("OG board").

Design notes: dark theme default; the aesthetic register is closer to a trading app (Robinhood/CashApp) than a music player — numbers, deltas, green arrows. Load the frontend-design skill if available before building UI.

## 9. Notifications (in-app only for MVP)

An in-app inbox/badge for: your pick crossed a milestone, weekly growth bonus awarded, someone you follow made a pick, someone followed you. Architecture note: emit these from score settlement as events so push notifications can attach later without rework.

---

## 10. Anti-gaming (MVP-level)

- One pick/day + immutability already blocks shotgunning.
- Rate-limit account creation per IP/email domain (multi-accounting to farm "first picker" slots is the obvious exploit).
- `pick_rank` is assigned transactionally at confirmation to prevent race-condition ties.
- Do NOT build listening verification, device fingerprinting, or bot detection now — log the risk in code comments where relevant.

---

## 11. What NOT to build (explicit non-goals for MVP)

- No Spotify/Apple Music integration (abstraction only).
- No native mobile apps.
- No real-money anything, no tokens, no crypto. Points are status only.
- No DMs/comments. Social = follow, feed, leaderboard.
- No genre/city leaderboards yet (schema may anticipate genre on tracks).
- No paid Soundcharts/Chartmetric data.

---

## 12. Build Order

1. Repo scaffold, DB schema + migrations, shared domain types.
2. MockProvider + simulator + time-warp control.
3. Pick flow end-to-end (search → confirm → immutable pick with baseline snapshot).
4. Scoring engine as pure functions + unit tests pinned to §4.6 fixtures.
5. Settlement jobs (daily batch, hourly hot-track pass, weekly growth bonus) — idempotent via dedupe keys.
6. Portfolio, feed, leaderboard, track page UI.
7. Streaks + in-app notifications.
8. SoundCloudProvider stub with config wiring + TODOs (implementation deferred until credentials exist).

Definition of done for Phase 1: seed the simulator, create 3 demo users, make picks, time-warp 90 days, and watch correct scores, feed events, and leaderboard movement appear — with the §4.6 examples reproduced exactly in automated tests.

---

## 13. Open Questions for the Founder

- ~~Confirm/override the suggested tech stack (§2)~~ → settled: Node/TS + Fastify, React/Vite, SQLite for Phase 1 (Postgres later).
- App name + handle scheme.
- Reset time: user-local midnight (current spec) vs one global drop time (stronger "everyone at once" social moment, worse for some timezones).
- Season length: monthly (current spec) vs quarterly.
- Exact underdog tier boundaries and point values will need tuning once real SoundCloud growth data is observed — treat §4 numbers as v1 config, and keep them in a config file, not hardcoded (they live in `shared/src/scoring-config.ts`).
