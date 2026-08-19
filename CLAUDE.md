# First Fan — early-discovery music game

Full product/game spec: `PROJECT_SPEC.md` (read it before changing game rules or scoring).
The CLAUDE.md one directory up (`Downloads/CLAUDE.md`) belongs to a different project — ignore it here.

## Stack decisions (settled with the founder)
- Monorepo via npm workspaces: `shared/` (domain types + scoring config), `server/` (Fastify API + jobs), `web/` (React + Vite, mobile-first).
- Database: **SQLite via Node's built-in `node:sqlite`** for Phase 1 — no Docker, no Postgres on this machine. Keep SQL portable; Postgres is the intended production target later.
- No build step for `shared/` — server (tsx) and web (Vite) import its TS source directly.
- Sim demo world: POST `/api/dev/seed-demo` on a fresh DB builds a ~94-day story (8 users, password `demo1234`) and warps itself. Reset = stop the server FIRST, then delete `server/firstfan.db*` (deleting while it runs fails silently — the file stays locked).
- Sim snapshots are intraday (`SNAPSHOTS_PER_DAY` in `sim/catalog.ts`), with uneven per-slot weights so charts look like a ticker; the last slot of each day always equals the canonical daily value.
- Provider switch: `FIRSTFAN_PROVIDER` in `server/.env` — `soundcloud` (real API, real time, polling jobs, DB `firstfan-live.db`) or unset/`mock` (simulator + time-warp, DB `firstfan.db`). Each mode has its own DB file; worlds never mix.
- SoundCloud credentials live ONLY in `server/.env` (gitignored). Field reality check: likes are `favoritings_count` on track objects, not `likes_count` — verified live 2026-08-05; see `server/scripts/check-soundcloud.mjs`.

## Calibration corpus (badge thresholds)
SoundCloud exposes only a track's CURRENT play count — there is no history endpoint, so trajectory shape can't be measured from a single call at any sample size. `server/scripts/corpus.ts` keeps a standing sample of real tracks in its own DB (`firstfan-corpus.db`, gitignored) and polls it daily to accumulate the history badge thresholds need.
- `npm run corpus:seed` — discover tracks (genre search **plus artist-catalogue walking**, which is the only way to reach small tracks; search alone is all big ones)
- `npm run corpus:poll` — snapshot the whole corpus; batched 50/call, so 2,000 tracks ≈ 40 API calls
- `npm run corpus:report` — distributions + badge mix using the real classifier
Seeded 2,000 tracks on 2026-08-10. **Poll daily** (Task Scheduler); useful signal ~14 days, real calibration ~60–90.

Known gap: badge thresholds are tuned to the SIMULATOR and still need real-data confirmation. Badges are upgrade-only, so thresholds can safely be LOOSENED later but never tightened without breaking the never-revoke promise.

Moonshot's threshold of 8 doublings was measured and **held** — see the note on `AFFINITY.moonshotDoublings`. An earlier claim that 8 was unreachable came from extrapolating lifetime average growth, which structurally cannot show a burst; real dated Spotify series show p90 7.20 / max 10.09 over 180 days. What remains uncalibrated is the *rate* at which picked tracks earn each badge, which only the corpus can measure.

## Chartmetric (`server/scripts/chartmetric.ts`)
Evaluated 2026-08-11 (~$2 of credits) as a way to skip the corpus wait. **It cannot replace the corpus**, for measured reasons:
- **SoundCloud**: the endpoint exists and works (`/api/track/{id}/soundcloud/stats/most-history?type=plays`) but coverage is ~2.5% — 1 of 40 top-of-catalogue commercial tracks had any data. For UGC it is effectively zero. There is also no SoundCloud→CM id resolution (`/api/track/{type}/{id}/get-ids` accepts chartmetric/isrc/spotify/itunes/tiktok/genius only), and free-text search on UGC titles returns false positives — two different tracks resolved to the same CM id on a shared surname.
- **Apple Music**: not available for track stats at any price. The API's 400 enumerates `[shazam, spotify, youtube, tiktok, genius, soundcloud, chartmetric, line, melon, radio]`. Apple Music appears only in playlist/chart endpoints. Relevant if Apple Music integration is ever planned — the stats provider would have to be someone else.
- **Spotify**: excellent — 40/40 tracks, 180 days of real dated points. This is what produced the Moonshot measurement.

Commands: `npm run cm:probe` (SoundCloud coverage), `cm:spotify`, `cm:sc`, `cm:apple`.

Two hard-won gotchas: endpoint paths must come from `apidocs.chartmetric.com/llms-full.txt`, NOT the third-party api-evangelist OpenAPI spec, whose track-stats path is missing the `{mode}` segment and 404s. And when a parameter is rejected, the 400 body ENUMERATES the valid values — sending a deliberately wrong one is the cheapest way to discover an undocumented enum. Billing is usage-based at $0.01/credit; every call goes through one `spend()` cap so a loop bug can't overrun.

## Commands (run from repo root)
- `npm run dev` — API server (port 3001)
- `npm run dev:web` — Vite dev server (port 5173, proxies `/api` → 3001)
- `npm run migrate` — apply SQL migrations in `server/migrations/`
- `npm test` — all workspace tests (vitest)
- `npm run typecheck` — tsc --noEmit across workspaces

## Non-negotiables from the spec
- Scoring is a **pure function** of (pick, snapshot history, competing picks); settlement is idempotent via `score_events.dedupe_key`.
- Game logic never imports provider-specific code — everything goes through the `MusicProvider` interface.
- The §4.6 balance invariant is pinned in `server/test/badge-balance.test.ts`, against the LIVE badge scoring. Restated for the badge model: scores are comparable only WITHIN a badge, so the global "early call beats a mega-hit run" comparison no longer means anything. What must hold is that **on the same track, calling it early dominates calling it late** — currently ~4.8x at equal rank, ~6.6x with rank decay. The old fixtures tested `scoring/engine.ts`, which settlement stopped calling when badges landed; that file and its 37 tests were deleted 2026-08-12.
- Scoring numbers live in `shared/src/scoring-config.ts`, not hardcoded in logic.
