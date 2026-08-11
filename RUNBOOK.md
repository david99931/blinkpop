# Runbook

How to start First Fan, switch between the two worlds, and keep the calibration
corpus collecting. Everything runs from the repo root: `C:\Users\david\Downloads\TGS`.

## Requirements

| | |
|---|---|
| Node | 22+ (you're on 24.18.0). `node:sqlite` needs 22+. |
| npm | 9+ (workspaces). You're on 11.16.0. |
| Database | none to install — SQLite is built into Node |
| Ports | 3001 (API), 5173 (web) |
| Internet | only for `soundcloud` mode and the corpus poller |

⚠ Port 5173 is also Vite's default for the solswap project one directory up. Run
one at a time, or Vite will silently move to 5174 and the API proxy will still
point at the first one.

## Start it

Two terminals, both at the repo root.

```powershell
npm run dev        # API on http://localhost:3001
```

```powershell
npm run dev:web    # web on http://localhost:5173
```

Open http://localhost:5173. Log in as any demo user — password `demo1234`.

First run on a machine, or after deleting the DB: `npm run migrate` first, then
start the server and `POST /api/dev/seed-demo` to build the sim world.

## The two worlds

`FIRSTFAN_PROVIDER` in `server/.env` decides which one you get. They have
separate DB files and never mix.

| | `mock` (or unset) | `soundcloud` |
|---|---|---|
| Data | simulator, 500 tracks | real SoundCloud API |
| Time | time-warp (day 110 now) | real time |
| DB | `server/firstfan.db` | `server/firstfan-live.db` |
| Use for | UI work, scoring, charts | verifying the provider layer |

Currently set to `mock`. Change the line, restart the API server.

### Resetting the sim world

Order matters — deleting the DB while the server runs **fails silently**, the
file stays locked and you'll think it worked.

1. Stop the API server (Ctrl+C).
2. `Remove-Item server\firstfan.db*`
3. `npm run migrate`
4. Start the server, then `POST /api/dev/seed-demo`.

## Checks

```powershell
npm test         # 126 tests
npm run typecheck
```

## The calibration corpus

2,000 real SoundCloud tracks, polled once a day, building the trajectory
history the badge thresholds need. This is the part that needs your PC.

```powershell
npm run corpus:poll     # one snapshot of all 2000 tracks (~40 API calls, ~1 min)
npm run corpus:report   # what the data says so far
npm run corpus:seed 500 # add more tracks (only if you want a bigger sample)
```

**Why it takes months:** SoundCloud only exposes a track's *current* play count.
There is no history endpoint. Shape — doublings, burst, sustain — can only be
measured by watching the same tracks over elapsed time, and no sample size
substitutes for that. Rough timeline:

- ~14 days — first real signal on which tracks are moving
- ~30 days — Riser and Flatline thresholds start to be trustworthy
- ~60–90 days — enough to fix Moonshot (currently set at 8 doublings, which the
  sample says no real track reaches — see the note in `scoring-config.ts`)

### The daily poll is scheduled

Windows Task Scheduler task **`blinkpop corpus`**, created 2026-08-10. It runs
`npm run corpus:poll` daily at 3am. You don't run anything by hand.

Settings that matter:

- **Start when available** — the PC does *not* have to be on at 3am. If it was
  off, the poll runs at next logon (Windows waits ~10 min first).
- **Wake to run** — wakes from sleep rather than skipping.
- **Only if network available**, and up to 3 retries 30 min apart.
- Runs as `david`, interactive — so it needs you logged in, not just booted.

Catch-up covers *one* missed run, not one per missed day. That's correct
anyway: a missed day's data is gone for good, since SoundCloud can't report
what a track's play count was last Tuesday.

Useful commands:

```powershell
schtasks /query /tn "blinkpop corpus" /fo list   # next/last run, last result
schtasks /run   /tn "blinkpop corpus"            # poll now
schtasks /delete /tn "blinkpop corpus" /f        # remove it
Get-Content corpus-poll.log -Tail 20             # what the last run did
```

`Last Result: 0` means success. The task definition is checked in at
`server/scripts/corpus-task.xml` — re-register with
`schtasks /create /xml server\scripts\corpus-task.xml /tn "blinkpop corpus"`.

### Do you have to leave the PC on?

**No.** With the missed-start setting above, the corpus tolerates gaps well —
it's measuring change over months, so a skipped day costs almost nothing.
Missing a *week* starts to blur short bursts, but even that isn't fatal.

What actually breaks it: not running it for a month, or reinstalling/deleting
`server/firstfan-corpus.db`. That file is gitignored and irreplaceable — the
history cannot be re-fetched after the fact. Back it up occasionally.

If you'd rather not depend on the desktop at all, the poller is small enough to
run anywhere with Node and the `.env` — a Raspberry Pi or a $5/mo VPS would do
it, and you'd `scp` the DB back when you want to run a report.
