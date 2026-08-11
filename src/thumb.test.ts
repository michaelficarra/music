import { describe, expect, it } from "vitest";
import { artistTooltip } from "./thumb";
import type { Artist } from "./types";

const artist = (over: Partial<Artist> = {}): Artist => ({
  name: "Blink-182",
  baselineSlot: "S",
  imageURL: "",
  imageSource: "",
  ownTags: [],
  tags: [],
  specificTags: [],
  // The tooltip describes the artist, so it reads `specificTags` — regions and
  // all. Set only to satisfy the type.
  soundTags: [],
  ...over,
});

describe("artistTooltip", () => {
  it("lists the tags the row states, not the ones derived from them", () => {
    // The whole hierarchy would bury the two tags that say something: a reader
    // glancing at a card does not need "pop rock, punk rock, rock" spelled out.
    expect(
      artistTooltip(
        artist({
          ownTags: ["pop punk", "San Diego"],
          tags: ["pop punk", "San Diego", "pop rock", "punk rock", "rock", "California"],
          // punk rock, rock and California are too broad to distinguish anyone.
          specificTags: ["pop punk", "San Diego", "pop rock"],
        }),
      ),
    ).toBe("Blink-182\npop punk, San Diego, pop rock");
  });

  it("is just the name when nothing specific survives", () => {
    // A freshly added artist, or one carrying only umbrellas.
    expect(artistTooltip(artist({ tags: ["rock"], specificTags: [] }))).toBe("Blink-182");
  });
});
