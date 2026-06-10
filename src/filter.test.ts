import { describe, expect, it } from "vitest";
import { matchesTags } from "./filter";
import type { Artist } from "./types";

const artistWithTags = (tags: string[]): Artist => ({
  name: "Example Artist",
  baselineSlot: "B",
  imageURL: "",
  imageSource: "",
  tags,
});

describe("matchesTags", () => {
  it("matches every artist when no tags are selected, in both modes", () => {
    expect(matchesTags(artistWithTags(["emo", "2000s"]), new Set(), "all")).toBe(true);
    expect(matchesTags(artistWithTags(["emo", "2000s"]), new Set(), "any")).toBe(true);
    expect(matchesTags(artistWithTags([]), new Set(), "all")).toBe(true);
    expect(matchesTags(artistWithTags([]), new Set(), "any")).toBe(true);
  });

  it("all: matches only an artist carrying every selected tag", () => {
    const artist = artistWithTags(["pop punk", "emo", "2000s"]);
    expect(matchesTags(artist, new Set(["emo"]), "all")).toBe(true);
    expect(matchesTags(artist, new Set(["emo", "2000s"]), "all")).toBe(true);
    expect(matchesTags(artist, new Set(["emo", "duo"]), "all")).toBe(false);
  });

  it("any: matches an artist carrying at least one selected tag", () => {
    const artist = artistWithTags(["pop punk", "2000s"]);
    expect(matchesTags(artist, new Set(["emo", "2000s"]), "any")).toBe(true);
    expect(matchesTags(artist, new Set(["emo", "duo"]), "any")).toBe(false);
  });

  it("rejects an untagged artist once any tag is selected, in both modes", () => {
    expect(matchesTags(artistWithTags([]), new Set(["emo"]), "all")).toBe(false);
    expect(matchesTags(artistWithTags([]), new Set(["emo"]), "any")).toBe(false);
  });
});
