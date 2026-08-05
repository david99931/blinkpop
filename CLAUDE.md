# First Fan — early-discovery music game

Full product/game spec: `PROJECT_SPEC.md` (read it before changing game rules or scoring).
The CLAUDE.md one directory up (`Downloads/CLAUDE.md`) belongs to a different project — ignore it here.

## Stack decisions (settled with the founder)
- Monorepo via npm workspaces: `shared/` (domain types + scoring config), `server/` (Fastify API + jobs), `web/` (React + Vite, mobile-first).
- Database: **SQLite via Node's built-in `node:sqlite`** for Phase 1 — no Docker, no Postgres on this machine. Keep SQL portable; Postgres is the intended production target later.
- No build step for `shared/` — server (tsx) and web (Vite) import its TS source directly.
- Provider switch: `FIRSTFAN_PROVIDER` in `server/.env` — `soundcloud` (real API, real time, polling jobs, DB `firstfan-live.db`) or unset/`mock` (simulator + time-warp, DB `firstfan.db`). Each mode has its own DB file; worlds never mix.
- SoundCloud credentials live ONLY in `server/.env` (gitignored). Field reality check: likes are `favoritings_count` on track objects, not `likes_count` — verified live 2026-08-05; see `server/scripts/check-soundcloud.mjs`.

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
