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

## 3. Spotify integration — taste, stats, and the data export  ← next

Added 2026-08-12. Spotify is a **taste source, not a track source**: its API
exposes `popularity` (0-100) and no play counts at all, so Spotify tracks can
never be picked or scored. That is the reason the game runs on SoundCloud and it
does not change. Read-only, feeding stats and discovery.

`connected_accounts` is already keyed `(user_id, provider)` with a generic
provider column, so this needs no migration — only the queries hardcode
`'soundcloud'`.

**Available the moment someone links** (`user-top-read`,
`user-read-recently-played`, `user-library-read`): top 50 artists and tracks
across ~4 weeks / ~6 months / ~1 year, the **genres** carried on those artists,
last 50 plays with timestamps, and saved tracks. No play counts and no listening
time exist anywhere in the API.

**Listening time requires accumulation.** stats.fm builds it by polling
`recently-played` per user and storing its own history — which is why it shows
nothing before you signed up. Same option here: poll every 2-3h (the 50-item cap
means heavier gaps lose plays). Per-user infrastructure that scales with
signups, so only worth it if "hours listened" is a feature we actually want.

### The data export
Spotify's extended streaming history covers the **entire account lifetime**,
every stream with a timestamp and `ms_played`. Users request it from privacy
settings and upload the JSON.

Worth more to us than to stats.fm, because it answers *when did you FIRST play
this track* — retroactive evidence of early taste, which solves the empty-profile
problem a collection app has on day one. It is also a better discovery seed than
the API: `/me/top/tracks` is the mainstream head of someone's taste, while the
export has the whole tail, and the tail is where early discovery lives.

**Hard boundary: the export must NEVER award badges.** A badge is earned by
PICKING — a public commitment at a moment, visible to everyone. Private listening
is not calling it. If an upload fills a trophy case then badges mean nothing and
never-revoke is attached to something unearned. It powers a separate, clearly
labelled surface instead ("Before you joined" — you were playing 12 tracks before
they crossed a million). Keep the separation at the schema level from the start.

**A first-played feature is explicitly wanted** (David, 2026-08-12) — not just a
caveat on the badge boundary. `first played` is the single most valuable field
the export yields, because it is this product's own premise turned backwards:
proof you were on something before it moved. Shapes worth considering, none
decided:
- *Before you joined* — tracks you played early that later crossed a milestone,
  with the play count at the time you first heard it.
- A **taste-age** or prescience number: across your library, how far ahead of the
  curve were you on average.
- Retroactive near-misses — "you were playing this two years before anyone on
  First Fan called it" — which motivates picking rather than substituting for it.
Whatever it becomes, it stays visibly distinct from badges: badges are earned by
a public pick, this is evidence of private listening. Different surface,
different vocabulary, no overlap in wording.

**Privacy.** The export contains IP address, user agent, country and
private-session flags. Parse those and DISCARD them on import; store only
timestamp, track, artist and ms_played. Say so on the upload screen.

**Size.** Lifetime history is multiple JSON files and six figures of rows.
Parse server-side, aggregate on import, and keep raw stream history in its own DB
file — same call as the corpus.

**Dev-mode cap:** a new Spotify app is limited to 25 hand-added users until a
quota extension is approved. Start that request early; it has lead time.

Order: generalise account linking → OAuth + taste fetch → personal stats screen
→ discovery. The export slots in after the stats screen exists to display it.

## 4. Discovery

The game asks people to call a track before it blows up, but the only way to find
one today is SEARCH — you have to already know the name, which means you are not
discovering anything. Users will search what is already on their mind, land
Flatline or Juggernaut, and the trophy case never fills in the slots that matter.

Browse instead of recall: by play-count band ("under 1k plays"), by genre, by
fresh uploads nobody has called yet, and by taste profile from the Spotify link:

    Spotify top artists -> their genres -> SoundCloud search in-genre -> filter <1k plays

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
