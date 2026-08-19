# Roadmap

Ordered. Things above the line are what we're doing; things below are recorded so
they don't get lost. Reordered 2026-08-11 — the public share page moved to the
end at David's call, and OG tags moved with it because they're meta tags *on*
that page and do nothing without it.

---

## 1. Badge marks — trajectory shapes  ← in progress

Placeholder artwork so every other surface has something to render. **Each mark is
the shape of its own trajectory**: Flatline is flat, Riser climbs, Breakout spikes
and settles, Moonshot hockey-sticks, Juggernaut is a heavy slab. Semantically true
rather than arbitrary, and it doubles as the brief for the artist later.

Five marks plus a composition rule covers all fifteen badges — a hybrid draws its
primary shape solid over its secondary as a ghost, so we never hand-draw ten
bespoke hybrid icons.

**Replaced later by commissioned artwork.** Likely SVG, possibly with simple
animation. Nothing downstream should assume the placeholder shapes.

## 2. Trophy case + rarity

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

## 3. General UI pass

Bringing Home, Trending, Portfolio and TrackPage into line. Deliberately late:
steps 1–2 settle the palette, type and badge treatment, so most of the design
decisions are already made by the time this starts.

Cheaper now than post-launch (no users, nothing to migrate), but better informed
later (we'll know which screens matter). Not urgent either way.

## 4. Public share page (`/p/:pickId`)

No auth. The badge, the track, "called at 600 plays," the chart with the entry
marked, the date. This is both the share artifact and the acquisition landing
page — a stranger's first contact with the product.

**First public surface in the app**, so it forces a privacy decision: what's
exposed? Display name or handle, other picks, total score? Start minimal — one
pick, one badge, no profile links — and widen deliberately.

## 5. OG tags + 15 static PNGs

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

**Discovery surface.** The game asks people to find small tracks before they blow
up. If the app doesn't help them dig, they'll pick whatever's already trending,
everyone lands Flatline or Juggernaut, and the badge system never gets exercised.
Options: browse by play-count band, "under 1k plays in your genres,"
recommendations from the linked SoundCloud account.

**Integrity.** Permanent never-revoked badges plus public status invites alt
accounts, artists picking their own tracks, and coordinated picking. Because
badges only upgrade, **a gamed badge is permanent.** Needs at least a policy
decision before launch.

**Evolution badges.** Sleeper, Revenant, Metronome — path-dependent, keyed on what
a run did *over time* rather than its final shape. Prerequisite: we store the
current badge, not the sequence of classifications, so this needs a schema change
to record badge history.

**Spotify integration.** Viable — Chartmetric has real measured stream history
(40/40 coverage, verified 2026-08-11). Apple Music is blocked: no track-stats
provider found, and Chartmetric's API explicitly excludes it.

## Debt

- `server/src/scoring/engine.ts` is dead code. Settlement runs entirely through
  `badges.ts`, but ~49 tests still pin `scorePick`, so the suite misrepresents
  what's actually live.
- Sim world is down to 8 users / 10 tracks / 13 picks and no longer represents the
  product. Re-seeding wipes `firstfan.db`.
- **Pre-launch threshold decisions** — `riserSustain`, the four fade parameters,
  and `purityThreshold`. Thresholds may only ever loosen, so this is the last
  window where tightening is free. See the note on `AFFINITY.riserSustain`.
