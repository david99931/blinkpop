/**
 * SoundCloud field mapping — pinned to the shapes observed on the live API
 * (scripts/check-soundcloud.mjs, 2026-08-05): playback_count, and crucially
 * `favoritings_count` for likes (likes_count does NOT exist on track objects).
 * Pure mapping tests; no network.
 */

import { describe, expect, it } from "vitest";
import { mapStats, mapTrack, type ScTrack } from "../src/providers/soundcloud.ts";

const live: ScTrack = {
  id: 123456789,
  title: "She Neva Know Lofi Ver",
  permalink_url: "https://soundcloud.com/tien-pham/she-neva-know",
  artwork_url: "https://i1.sndcdn.com/artworks-xyz-large.jpg",
  playback_count: 2_551_633,
  favoritings_count: 9_998,
  reposts_count: 194,
  user: { id: 42, username: "Tien Pham", avatar_url: "https://i1.sndcdn.com/avatars-a.jpg" },
};

describe("mapTrack", () => {
  it("maps the live API shape into the domain shape", () => {
    expect(mapTrack(live)).toEqual({
      provider: "soundcloud",
      providerTrackId: "123456789",
      title: "She Neva Know Lofi Ver",
      artistName: "Tien Pham",
      artworkUrl: "https://i1.sndcdn.com/artworks-xyz-large.jpg",
      permalinkUrl: "https://soundcloud.com/tien-pham/she-neva-know",
      currentPlays: 2_551_633,
    });
  });

  it("falls back to avatar art and tolerates a missing user", () => {
    expect(mapTrack({ ...live, artwork_url: null }).artworkUrl).toBe(
      "https://i1.sndcdn.com/avatars-a.jpg",
    );
    const bare = mapTrack({ id: 1, title: "x", user: null });
    expect(bare.artistName).toBe("Unknown artist");
    expect(bare.artworkUrl).toBeNull();
    expect(bare.currentPlays).toBeNull();
  });
});

describe("mapStats", () => {
  it("likes come from favoritings_count (the field that actually exists)", () => {
    const s = mapStats(live, "2026-08-05T00:00:00.000Z");
    expect(s).toEqual({
      plays: 2_551_633,
      likes: 9_998,
      reposts: 194,
      fetchedAt: "2026-08-05T00:00:00.000Z",
    });
  });

  it("stats-disabled tracks map to nulls (pick becomes pending data)", () => {
    const s = mapStats({ id: 2, title: "hidden stats" }, "2026-08-05T00:00:00.000Z");
    expect(s.plays).toBeNull();
    expect(s.likes).toBeNull();
    expect(s.reposts).toBeNull();
  });
});
