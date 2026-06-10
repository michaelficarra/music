import { describe, expect, it } from "vitest";
import { matchesAllTags } from "./filter";
import type { Artist } from "./types";

const artistWithTags = (tags: string[]): Artist => ({
  name: "Example Artist",
  baselineSlot: "B",
  imageURL: "",
  imageSource: "",
  tags,
});

describe("matchesAllTags", () => {
  it("matches every artist when no tags are selected", () => {
    expect(matchesAllTags(artistWithTags(["emo", "2000s"]), new Set())).toBe(true);
    expect(matchesAllTags(artistWithTags([]), new Set())).toBe(true);
  });

  it("matches an artist carrying every selected tag", () => {
    const artist = artistWithTags(["pop punk", "emo", "2000s"]);
    expect(matchesAllTags(artist, new Set(["emo"]))).toBe(true);
    expect(matchesAllTags(artist, new Set(["emo", "2000s"]))).toBe(true);
  });

  it("rejects an artist missing any selected tag", () => {
    const artist = artistWithTags(["pop punk", "2000s"]);
    expect(matchesAllTags(artist, new Set(["emo"]))).toBe(false);
    expect(matchesAllTags(artist, new Set(["pop punk", "emo"]))).toBe(false);
  });

  it("rejects an untagged artist once any tag is selected", () => {
    expect(matchesAllTags(artistWithTags([]), new Set(["emo"]))).toBe(false);
  });
});
