# Roadmap

Ordered. Things above the line are what we're doing; things below are recorded so
they don't get lost. Reordered 2026-08-11 — the public share page moved to the
end at David's call, and OG tags moved with it because they're meta tags *on*
that page and do nothing without it.

---

## 1. Badge marks — trajectory shapes  ✔ done

Placeholder artwork so every other surface has something to render. **Each mark is
the shape of its own trajectory**: Flatline is flat, Riser climbs, Breakout spikes
and settles, Moonshot hockey-sticks, Juggernaut is a heavy slab. Semantically true
rather than arbitrary, and it doubles as the brief for the artist later.

Five marks plus a composition rule covers all fifteen badges — a hybrid draws its
primary shape solid over its secondary as a ghost, so we never hand-draw ten
bespoke hybrid icons.

**Replaced later by commissioned artwork.** Likely SVG, possibly with simple
animation. Nothing downstream should assume the placeholder shapes.

## 2. Trophy case + rarity  ✔ done

The in-app profile: badges as a grid, the pick that earned each one, and **what
percentage of picks reach it** — David flagged the rarity number as the important
part, and it's what turns a badge from a label into a status object.

Where hybrids finally get a home. Supernova, Titan, Ascendant and the rest exist
in the data today with nowhere to be displayed properly.

**Both rarity decisions are settled (2026-08-12):**
- **Measured against TRACKS, not players.** "Only 2% of tracks ever do this" is a
  fact about music — stable as the userbase grows, true on day one, and a better
  flex than "few of our small number of users have it". Player counts become a
  second line later, not a replacement.
- **LIVE, not frozen.** Nothing is snapshotted onto a pick; `rarityFor()` is read
  at render time, so correcting a number updates every badge at once.

Shipped: `BADGE_RARITY` in `scoring-config.ts`, surfaced in the badge hover.

Still open: all fifteen values are `estimated`. The real 40-track Chartmetric
measurement is drawn from the top of the catalogue — 60% of those classify as
Monolith, because mega-hits are enormous and flat — and users pick SMALL tracks,
which behave oppositely. Flip entries to `measured` from the corpus as they are
confirmed; the `source` field exists so a guess is never mistaken for a finding.

## 3. Spotify integration — taste input and fun facts  ← in progress

**Settled 2026-09-10 after testing against a real account and a real export.**
Spotify is a taste source, not a track source and not a proof source. Two jobs
only:
1. **Input for discovery** — what this person likes, to steer what we surface.
2. **Fun facts** — "you have been listening to Juice WRLD since May 2018,
   2,295 plays and 115 hours."

No retroactive badges, no proving anyone was early. See the finding below.

### ⚠ Spotify REMOVED artist genres
Verified live 2026-09-10. An artist object now carries exactly seven fields:
`external_urls, href, id, images, name, type, uri`. No `genres`, no
`popularity` — the fields are ABSENT, not empty, and they are missing from
`/artists/{id}` fetched directly too. The docs still describe them.

Of 50 top artists on a real account, **0 carried genres**. This kills the
pipeline that was planned here:

    Spotify top artists -> their genres -> SoundCloud search -> filter <1k plays

**Genres come from SoundCloud now.** Its free-text tags are messier but they are
the underground vocabulary this game actually needs — real tags off a live
account included dubstep, riddim, colorbass, melodictearout. Spotify contributes
artist and track NAMES; SoundCloud contributes the taxonomy.

### ⚠ Early calls cannot be proved retroactively
Chartmetric resolves Spotify URIs perfectly — 8/8, exact, no false positives,
because `/track/spotify/{id}/get-ids` takes the URI from the export. Resolution
is a solved problem.

But its Spotify stream history **starts around 2020-07**. Real first-plays from
2016 were already past a billion streams by the time coverage begins, so "you
called this when it had 400k" is unanswerable. That data does not appear to
exist anywhere purchasable — Spotify never published historical per-track counts.
Cost of learning this: $0.17.

What still works without any external data:
- **Personal history** — "since May 2018, 2,295 plays, 115 hours." Entirely from
  the export, entirely honest.
- **Head-to-head ordering** — if two users both have a track, the earlier
  `first_played` was earlier. Provable, needs nothing but the two exports.
- **Anything from now on** — coverage exists from 2020, so a track first played
  today can be verified later.

### The export — working, tested on real data
`npm run spotify:import <dir>` against the extended streaming history.
A real decade-long export: 132,717 rows → 68,386 kept, **13,002 tracks, 3,609
artists, 3,198 hours, 2016-08-26 → 2026-08-18**.

- Plays under **30s are dropped as skips** — that was half the rows. Revisit if
  skips turn out to be their own signal.
- Aggregated on import (105MB JSON → ~13k rows); raw play rows are never stored.
- **Privacy**: `ip_addr`, `conn_country`, `platform`, `incognito_mode` and the
  rest are read and thrown away. The discard list is explicit in the importer so
  a new Spotify field defaults to being ignored rather than silently persisted.
- Lives in its own DB, `server/firstfan-spotify.db`, gitignored.

### Still to build
- **Stats screen** — top artists by hours, tracks by count, discovery rate per
  year, "listening since". This is the visible payoff and the data is already in.
- **Upload flow** so a user can do this without a CLI.
- Live API for currency (top 50, recently played) on top of the export's depth.

## 4. Discovery

The game asks people to call a track before it blows up, but the only way to find
one today is SEARCH — you have to already know the name, which means you are not
discovering anything.

Seed it from the merged taste profile: **SoundCloud tags supply the genre
vocabulary** (Spotify no longer has one), Spotify supplies artist and track names
plus the weight of what someone actually plays.

    taste genres (SoundCloud tags) -> SoundCloud search in-genre -> filter <1k plays

Known obstacle, already solved once: plain SoundCloud genre search returns
nothing but big tracks — `corpus:seed` only reached small ones by walking artist
CATALOGUES. The discovery surface needs the same trick.

## 5. General UI pass

Bringing Home, Trending, Portfolio and TrackPage into line. Deliberately late:
steps 1–2 settle the palette, type and badge treatment, so most of the design
decisions are already made by the time this starts.

Cheaper now than post-launch (no users, nothing to migrate), but better informed
later (we'll know which screens matter). Not urgent either way.

## 6. Public share page (`/p/:pickId`)

No auth. The badge, the track, "called at 600 plays," the chart with the entry
marked, the date. This is both the share artifact and the acquisition landing
page — a stranger's first contact with the product.

**First public surface in the app**, so it forces a privacy decision: what's
exposed? Display name or handle, other picks, total score? Start minimal — one
pick, one badge, no profile links — and widen deliberately.

## 7. OG tags + 15 static PNGs

Meta tags on the share page so links unfurl in iMessage, Discord, Slack, Twitter.
Those crawlers don't run pages or render SVG — they read one tag and fetch a
raster file.

**No dependency needed.** Cards are per-pick but badges are only fifteen, so we
export fifteen static PNGs once and point `og:image` at the matching one. The
preview shows a properly branded badge; the personalised numbers live on the page
people click through to.

---

## Later

**Runtime rasterizer for personalised previews.** *(David: "really like this idea,
we will definitely get to it.")* Upgrade to step 5 — instead of one static PNG per
badge, render the actual card, numbers and all, so the link preview itself shows
`600 → 1,224,229`. Needs real SVG rasterisation on the server (`resvg-js` or
`sharp`), which means a new dependency and a decision under the CLAUDE.md rule.
Worth doing once there's evidence people are sharing.

**Integrity.** Permanent never-revoked badges plus public status invites alt
accounts, artists picking their own tracks, and coordinated picking. Because
badges only upgrade, **a gamed badge is permanent.** Needs at least a policy
decision before launch.

**Evolution badges.** Sleeper, Revenant, Metronome — path-dependent, keyed on what
a run did *over time* rather than its final shape. Prerequisite: we store the
current badge, not the sequence of classifications, so this needs a schema change
to record badge history.

**Apple Music.** Blocked as a stats provider: no track-stats source found, and
Chartmetric's API explicitly excludes it. Would need a different vendor entirely.

## Debt

- `server/src/scoring/engine.ts` is dead code. Settlement runs entirely through
  `badges.ts`, but ~49 tests still pin `scorePick`, so the suite misrepresents
  what's actually live.
- Sim world is down to 8 users / 10 tracks / 13 picks and no longer represents the
  product. Re-seeding wipes `firstfan.db`.
- **Pre-launch threshold decisions** — `riserSustain`, the four fade parameters,
  and `purityThreshold`. Thresholds may only ever loosen, so this is the last
  window where tightening is free. See the note on `AFFINITY.riserSustain`.
