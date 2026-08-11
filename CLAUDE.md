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

Known gap: current badge thresholds are tuned to the SIMULATOR, which is far more explosive than reality — 502 sampled live tracks projected max 2.78 doublings/180d where Moonshot asks 8. See the calibration note on `AFFINITY.moonshotDoublings`. Badges are upgrade-only, so thresholds can safely be LOOSENED later but never tightened without breaking the never-revoke promise.

## Commands (run from repo root)
- `npm run dev` — API server (port 3001)
- `npm run dev:web` — Vite dev server (port 5173, proxies `/api` → 3001)
- `npm run migrate` — apply SQL migrations in `server/migrations/`
- `npm test` — all workspace tests (vitest)
- `npm run typecheck` — tsc --noEmit across workspaces

## Non-negotiables from the spec
- Scoring is a **pure function** of (pick, snapshot history, competing picks); settlement is idempotent via `score_events.dedupe_key`.
- Game logic never imports provider-specific code — everything goes through the `MusicProvider` interface.
- The §4.6 worked examples are pinned unit-test fixtures; the "one true early call beats a mega-hit run" ratio must hold.
- Scoring numbers live in `shared/src/scoring-config.ts`, not hardcoded in logic.
