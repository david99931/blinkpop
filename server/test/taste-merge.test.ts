/**
 * The two vocabularies have to actually meet.
 *
 * Merging SoundCloud and Spotify only pays off if the same genre from both
 * sources collapses to one key — otherwise "Future Garage" and "future garage"
 * sit as separate entries, the overlap boost never fires, and the combined
 * profile is just two lists stapled together.
 *
 * These cover the pure parts. The fetching is network-bound and lives behind
 * buildTasteProfile.
 */

import { describe, expect, it } from "vitest";

process.env.FIRSTFAN_DB = ":memory:";

const { normaliseGenre, parseTagList } = await import("../src/domain/taste.ts");

describe("normaliseGenre", () => {
  it("collapses the casing and spacing differences between the two sources", () => {
    // Spotify emits lowercase phrases; SoundCloud emits arbitrary free text.
    expect(normaliseGenre("Future Garage")).toBe(normaliseGenre("future garage"));
    expect(normaliseGenre("  UK  Dance  ")).toBe("uk dance");
    expect(normaliseGenre("Drum_And_Bass")).toBe("drum and bass");
    expect(normaliseGenre("Hip/Hop")).toBe("hip hop");
  });

  it("strips the quoting SoundCloud leaves on tags", () => {
    expect(normaliseGenre('"Deep House"')).toBe("deep house");
  });

  it("unifies & and 'and' so R&B doesn't split in two", () => {
    expect(normaliseGenre("R&B")).toBe(normaliseGenre("R and B"));
  });
});

describe("parseTagList", () => {
  it("treats a quoted run as one multi-word tag", () => {
    expect(parseTagList('"future garage" ambient "lo fi"')).toEqual([
      "future garage",
      "ambient",
      "lo fi",
    ]);
  });

  it("treats bare words as separate tags", () => {
    expect(parseTagList("techno ambient")).toEqual(["techno", "ambient"]);
  });

  it("survives the empty and missing cases", () => {
    expect(parseTagList("")).toEqual([]);
    expect(parseTagList(null)).toEqual([]);
    expect(parseTagList(undefined)).toEqual([]);
  });
});
