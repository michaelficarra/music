import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { allTags } from "./data";
import { compareArtistNames } from "./sort";
import { groupTags } from "./tag-groups";
import {
  buildRegistry,
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
