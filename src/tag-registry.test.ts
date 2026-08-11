import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { allTags, artists } from "./data";
import { compareArtistNames } from "./sort";
import { groupTags } from "./tag-groups";
import {
  broadTags,
  buildRegistry,
  isSoundTag,
  redundantTags,
  withDerivedTags,
  REGISTRY,
  TAG_CATEGORIES,
  validateRegistry,
  type TagRegistry,
} from "./tag-registry";

/** Build a registry from CSV text, so the fixtures read like the real file. */
const registryOf = (body: string): TagRegistry =>
  buildRegistry(parseCsv(`Tag,Category,Derived\n${body}`));

describe("buildRegistry", () => {
  it("reads a tag's category and its immediate derived tags", () => {
    const registry = registryOf("pop punk,genre,pop rock;punk rock\npop rock,genre,pop\n");
    expect(registry.tags).toEqual(["pop punk", "pop rock"]);
    expect(registry.category.get("pop punk")).toBe("genre");
    expect(registry.derived.get("pop punk")).toEqual(["pop rock", "punk rock"]);
  });

  it("treats a blank Derived column as a root tag", () => {
    const registry = registryOf("male vocals,quality,\n");
    expect(registry.derived.get("male vocals")).toEqual([]);
  });

  it("ignores blank rows", () => {
    expect(registryOf("pop,genre,\n\n").tags).toEqual(["pop"]);
  });
});

describe("withDerivedTags", () => {
  const registry = registryOf(
    [
      "pop punk,genre,pop rock;punk rock",
      "pop rock,genre,pop;rock",
      "punk rock,genre,rock",
      "pop,genre,",
      "rock,genre,",
      "male vocals,quality,",
    ].join("\n"),
  );

  it("adds every derived tag, transitively", () => {
    expect([...withDerivedTags(["pop punk"], registry)].sort()).toEqual([
      "pop",
      "pop punk",
      "pop rock",
      "punk rock",
      "rock",
    ]);
  });

  it("lists the given tags first, then the derived ones", () => {
    expect(withDerivedTags(["pop punk", "male vocals"], registry)).toEqual([
      "pop punk",
      "male vocals",
      "pop rock",
      "punk rock",
      "pop",
      "rock",
    ]);
  });

  it("is idempotent — expanding an expanded set changes nothing", () => {
    const once = withDerivedTags(["pop punk"], registry);
    expect(withDerivedTags(once, registry)).toEqual(once);
  });

  it("leaves an unregistered tag alone rather than dropping it", () => {
    expect(withDerivedTags(["hyperpop"], registry)).toEqual(["hyperpop"]);
  });

  it("terminates on a cycle in the data", () => {
    const cyclic = registryOf("a,genre,b\nb,genre,a\n");
    expect([...withDerivedTags(["a"], cyclic)].sort()).toEqual(["a", "b"]);
  });
});

describe("redundantTags", () => {
  const registry = registryOf(
    [
      "easycore,genre,hardcore;pop punk",
      "pop punk,genre,pop rock;punk rock",
      "pop rock,genre,pop;rock",
      "punk rock,genre,rock",
      "hardcore,genre,punk rock",
      "pop,genre,",
      "rock,genre,",
      "Stockholm,region,Swedish",
      "Swedish,region,Scandinavian",
      "Scandinavian,region,",
      "male vocals,quality,",
    ].join("\n"),
  );

  it("finds nothing when every tag is the most specific in its direction", () => {
    expect(redundantTags(["pop punk", "Stockholm", "male vocals"], registry)).toEqual([]);
  });

  it("reports a tag another one derives directly", () => {
    expect(redundantTags(["pop punk", "punk rock"], registry)).toEqual(["punk rock"]);
  });

  it("reports one derived transitively, several links up", () => {
    expect(redundantTags(["easycore", "rock"], registry)).toEqual(["rock"]);
  });

  it("reports regions the same way as genres", () => {
    expect(redundantTags(["Stockholm", "Scandinavian"], registry)).toEqual(["Scandinavian"]);
  });

  it("keeps two specific tags that merely share an ancestor", () => {
    // Both derive punk rock; neither derives the other, so both are given tags.
    expect(redundantTags(["pop punk", "hardcore"], registry)).toEqual([]);
  });

  it("leaves an unregistered tag alone", () => {
    expect(redundantTags(["hyperpop", "male vocals"], registry)).toEqual([]);
  });
});

describe("broadTags", () => {
  /** `count` artists carrying `tags`, so a share of the roster is easy to state. */
  const cohort = (count: number, tags: string[]) => Array.from({ length: count }, () => ({ tags }));

  it("calls a tag broad once it covers more than the given share of the roster", () => {
    // "rock" is on 8 of 10, "emo" on 2, "pop" on 2. Breadth is failure to
    // distinguish, so the split is on how much of the roster a tag covers and
    // nothing else.
    const roster = [...cohort(6, ["rock"]), ...cohort(2, ["rock", "emo"]), ...cohort(2, ["pop"])];
    expect([...broadTags(roster, 0.5)]).toEqual(["rock"]);
  });

  it("keeps a tag exactly at the threshold — the cut is strictly above", () => {
    expect(broadTags([...cohort(5, ["rock"]), ...cohort(5, ["pop"])], 0.5).has("rock")).toBe(false);
  });

  it("does not care whether the carriers were given the tag or derived it", () => {
    // The rule deliberately ignores provenance: a hand-written tag on most of
    // the roster distinguishes no better than an inherited one.
    const stated = cohort(9, ["male vocals"]);
    const derived = cohort(9, ["rock"]);
    expect(broadTags([...stated, ...cohort(1, ["x"])], 0.5).has("male vocals")).toBe(true);
    expect(broadTags([...derived, ...cohort(1, ["x"])], 0.5).has("rock")).toBe(true);
  });

  it("exempts era tags, whose own section is about which decades dominate", () => {
    // "2010s" covers the whole roster and must survive: the era chart's subject
    // is exactly that concentration.
    const roster = cohort(10, ["2010s", "rock"]);
    const broad = broadTags(roster, 0.5);
    expect(broad.has("2010s")).toBe(false);
    expect(broad.has("rock")).toBe(true);
  });

  it("has nothing to say about an empty roster", () => {
    expect([...broadTags([])]).toEqual([]);
  });
});

describe("isSoundTag", () => {
  const registry = registryOf(
    "emo,genre,\nscreamed vocals,quality,\nSwedish,region,\n2000s,era,\nsibling band,aspect,\n",
  );

  it("accepts what an artist plays and how it plays it", () => {
    expect(isSoundTag("emo", registry)).toBe(true);
    expect(isSoundTag("screamed vocals", registry)).toBe(true);
  });

  it("rejects where it is from, when it worked, and what else is notable", () => {
    expect(isSoundTag("Swedish", registry)).toBe(false);
    expect(isSoundTag("2000s", registry)).toBe(false);
    expect(isSoundTag("sibling band", registry)).toBe(false);
  });

  it("rejects a tag the vocabulary has never heard of", () => {
    // Nothing has claimed it describes the music, so the ☁️ map must not assume
    // it does. Such a tag is a test failure elsewhere in this file anyway.
    expect(isSoundTag("shoegaze", registry)).toBe(false);
  });
});

describe("validateRegistry", () => {
  it("reports a derived tag that is not itself registered", () => {
    const problems = validateRegistry(registryOf("ska punk,genre,ska\n"));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.problem).toContain("not registered");
  });

  it("reports a category the panel does not know how to group", () => {
    const problems = validateRegistry(registryOf("Swedish,nationality,\n"));
    expect(problems[0]!.problem).toContain("unknown category");
  });

  it("reports a genre that derives a region", () => {
    const problems = validateRegistry(registryOf("J-pop,genre,Japanese\nJapanese,region,\n"));
    expect(problems[0]!.problem).toContain('derives the region "Japanese"');
  });

  it("reports an era that derives something", () => {
    const problems = validateRegistry(registryOf("2000s,era,decades\ndecades,era,\n"));
    expect(problems.map((p) => p.problem)).toContain(
      "era tags derive nothing and are derived from nothing",
    );
  });

  it("allows a genre to imply an aspect — Christian rock is Christian", () => {
    expect(
      validateRegistry(
        registryOf("Christian rock,genre,rock;Christian\nrock,genre,\nChristian,aspect,\n"),
      ),
    ).toEqual([]);
  });

  it("reports a cycle", () => {
    const problems = validateRegistry(registryOf("a,genre,b\nb,genre,a\n"));
    expect(problems.map((p) => p.problem)).toEqual([
      "is derived from itself (cycle)",
      "is derived from itself (cycle)",
    ]);
  });

  it("reports a roster tag missing from the vocabulary", () => {
    const problems = validateRegistry(registryOf("pop,genre,\n"), ["pop", "hyperpop"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEqual({
      tag: "hyperpop",
      problem: expect.stringContaining("not registered"),
    });
  });
});

// The shipped vocabulary. These are the invariants that keep the hierarchy
// honest as the roster is retagged; a failure here means data/artists.csv and
// data/tags.csv have drifted apart.
describe("the shipped vocabulary", () => {
  it("registers every tag the roster uses, with a sound hierarchy", () => {
    expect(validateRegistry(REGISTRY, allTags)).toEqual([]);
  });

  it("gives every artist only the most specific tag in each direction", () => {
    // Named per artist rather than counted, so a failure says which row to edit
    // and which tag to drop — the general one, since it is derived anyway.
    const offenders = artists
      .map((artist) => ({ artist: artist.name, redundant: redundantTags(artist.ownTags) }))
      .filter(({ redundant }) => redundant.length > 0);
    expect(offenders).toEqual([]);
  });

  it("gives the ☁️ map only tags about the music, and enough of them", () => {
    // The map has nowhere to put an artist it cannot hear: with no sound tags
    // it is similar to nobody and lands on the rim by default rather than on
    // the evidence. A row tagged only by origin and decade is the way that
    // happens, so the roster is checked for it.
    for (const artist of artists) {
      expect(artist.soundTags.every((tag) => isSoundTag(tag))).toBe(true);
      expect(artist.soundTags.length).toBeGreaterThan(0);
    }
  });

  it("leaves nothing in the 🎲 panel's Other group", () => {
    expect(groupTags(allTags).map((group) => group.label)).not.toContain("Other");
  });

  it("is sorted by category, then by tag", () => {
    const key = (tag: string): number =>
      TAG_CATEGORIES.indexOf(REGISTRY.category.get(tag) as never);
    const sorted = [...REGISTRY.tags].sort((a, b) => key(a) - key(b) || compareArtistNames(a, b));
    expect(REGISTRY.tags).toEqual(sorted);
  });
});
