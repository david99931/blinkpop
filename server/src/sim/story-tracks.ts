/**
 * Hand-authored tracks with known trajectories, matching the spec §4.6 worked
 * examples. No RNG here — every value is an explicit function of the sim day,
 * so automated tests (and demos) can rely on exact milestone-crossing days.
 */

export interface StoryTrack {
  providerTrackId: string;
  title: string;
  artistName: string;
  /** Total plays as of sim day d (d = 0 is the universe's first day). */
  playsAt(day: number): number;
  likeRate: number;
  repostRate: number;
}

export const STORY_TRACKS: readonly StoryTrack[] = [
  {
    // §4.6 ex.1 "the dream call": 600 plays → 1.2M by day 90 (exponential),
    // crossing every milestone from 10k to 1M on the way.
    // Also serves ex.2 "late to the party": plays pass 300k around day 74,
    // so a pick made then lands in the 250k–1M (0.3×) tier.
    providerTrackId: "story-dream",
    title: "Cold Water (demo)",
    artistName: "Vera Nocturne",
    playsAt: (d) =>
      d <= 90
        ? Math.round(600 * Math.pow(2000, d / 90)) // 600 → 1.2M at d=90
        : Math.round(1_200_000 * Math.pow(1.001, d - 90)),
    likeRate: 0.03,
    repostRate: 0.006,
  },
  {
    // §4.6 ex.3 "the flatline": 2,000 → 6,000 by day 90, then near-nothing.
    // Crosses no milestone; correct score is 0.
    providerTrackId: "story-flatline",
    title: "Basement Loop 7",
    artistName: "grayscale kid",
    playsAt: (d) => (d <= 90 ? 2000 + Math.round((4000 * d) / 90) : 6000 + (d - 90) * 3),
    likeRate: 0.02,
    repostRate: 0.003,
  },
  {
    // §4.6 ex.4 "big-artist pick": 4M at day 0, +80k/day.
    // Crosses 5M on day 13 and 10M on day 75 → (650+1000) × 0.05 = 82.5 pts.
    providerTrackId: "story-bigartist",
    title: "Gravity",
    artistName: "Halcyon Drive",
    playsAt: (d) => (d <= 90 ? 4_000_000 + d * 80_000 : 11_200_000 + (d - 90) * 10_000),
    likeRate: 0.025,
    repostRate: 0.004,
  },
  {
    // Weekly-growth fixture (§4.4): 6,000 plays growing 6%/day ≈ +50%/week,
    // first-week gain ≈ +3,000 — passes BOTH weekly-bonus conditions from
    // week one. (1.06^7 ≈ 1.504.)
    providerTrackId: "story-riser",
    title: "Sunspots",
    artistName: "Mora & June",
    playsAt: (d) => Math.round(6000 * Math.pow(1.06, d)),
    likeRate: 0.028,
    repostRate: 0.005,
  },
];
