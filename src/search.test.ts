import { describe, expect, it } from "vitest";
import { computeCloudLayout, type CloudLayout } from "./cloud-layout";
import { allSoundTags, artists as roster } from "./data";
import {
  MIN_QUERY_LENGTH,
  buildSearchIndex,
  foldForMatch,
  fuzzyMatch,
  resolveSpotlight,
  searchTargets,
  type SearchEntry,
} from "./search";
import type { Artist } from "./types";

/** A synthetic artist. As in cloud-layout.test.ts, `sound` defaults to `tags` —
    only the tests about what search declines to offer pass it explicitly. */
const artist = (name: string, tags: string[], sound: string[] = tags): Artist => ({
  name,
  baselineSlot: "B",
  imageURL: "",
  imageSource: "",
  ownTags: tags,
  tags,
  specificTags: tags,
  soundTags: sound,
});

/** Score a query against a candidate, both unfolded, as the UI effectively does. */
const score = (query: string, candidate: string): number | null =>
  fuzzyMatch(foldForMatch(query), foldForMatch(candidate));

/** The labels a query suggests, in order. */
const labels = (index: ReturnType<typeof buildSearchIndex>, query: string): string[] =>
  searchTargets(index, query).map((entry) => entry.label);

describe("foldForMatch", () => {
  it("ignores case", () => {
    expect(foldForMatch("CHVRCHES")).toBe("chvrches");
  });

  it("ignores combining accents", () => {
    expect(foldForMatch("girugämesh")).toBe("girugamesh");
    expect(foldForMatch("Sigur Rós")).toBe("sigur ros");
  });

  // The letters whose mark is part of the code point, which NFD cannot reach.
  // compareArtistNames (sort.ts) already treats these as equal to their plain
  // form, so search has to as well or the two disagree about what one string is.
  it("folds the letters NFD leaves alone, matching compareArtistNames", () => {
    expect(foldForMatch("Sigurðsson")).toBe("sigurdsson");
    expect(foldForMatch("Mø")).toBe("mo");
    expect(foldForMatch("Mötley Crüe")).toBe("motley crue");
    expect(foldForMatch("Blæst")).toBe("blaest");
  });
});

describe("fuzzyMatch", () => {
  it("declines a candidate missing one of the query's characters", () => {
    expect(score("punk", "pop")).toBeNull();
  });

  it("declines characters that appear out of order", () => {
    expect(score("knup", "punk")).toBeNull();
  });

  it("matches a contiguous run anywhere in the candidate", () => {
    expect(score("punk", "pop punk")).not.toBeNull();
    expect(score("berp", "cyberpunk")).not.toBeNull();
  });

  it("matches characters scattered in order", () => {
    // The gap-tolerant case: "ppnk" is nowhere in "pop punk" as a run.
    expect(score("ppnk", "pop punk")).not.toBeNull();
  });

  // The tiers, in the order the reader would expect to see the results.
  it("ranks an exact match above a prefix, a prefix above a word start", () => {
    expect(score("emo", "emo")!).toBeGreaterThan(score("emo", "emo pop")!);
    expect(score("emo", "emo pop")!).toBeGreaterThan(score("emo", "midwest emo")!);
  });

  it("ranks a word start above a match buried mid-word", () => {
    expect(score("punk", "pop punk")!).toBeGreaterThan(score("punk", "cyberpunk")!);
  });

  it("ranks any intact match above the same letters scattered", () => {
    expect(score("ppnk", "ppnkcore")!).toBeGreaterThan(score("ppnk", "pop punk")!);
  });

  it("prefers the shorter candidate when the query sits the same way in both", () => {
    expect(score("emo", "emo pop")!).toBeGreaterThan(score("emo", "emo pop punk")!);
  });

  it("prefers a word-start occurrence over an earlier buried one", () => {
    // "art" is buried in "heart" and begins a word in "art rock"; the second
    // occurrence must be the one that decides the tier.
    expect(score("art", "heart art")!).toBeGreaterThan(score("art", "hearty")!);
  });

  it("declines an empty query", () => {
    expect(fuzzyMatch("", "emo")).toBeNull();
  });
});

describe("searchTargets", () => {
  const rosterOf = [
    artist("Paramore", ["emo pop", "power pop"]),
    artist("Sigur Rós", ["post-rock", "dream pop"]),
    // Regions and eras are on the row but are not sound tags, so they must not
    // reach the index: the map groups nobody by them.
    artist("CHVRCHES", ["synthpop", "Glasgow", "2010s"], ["synthpop"]),
  ];
  const soundTags = ["emo pop", "power pop", "post-rock", "dream pop", "synthpop"];
  const index = buildSearchIndex(rosterOf, soundTags);

  it("offers nothing until the minimum query length is reached", () => {
    expect(MIN_QUERY_LENGTH).toBe(3);
    expect(searchTargets(index, "")).toEqual([]);
    expect(searchTargets(index, "em")).toEqual([]);
    expect(labels(index, "emo")).toContain("emo pop");
  });

  it("counts a query's leading and trailing space as nothing typed", () => {
    expect(searchTargets(index, "  em  ")).toEqual([]);
  });

  it("finds artists and tags alike", () => {
    expect(labels(index, "param")).toContain("Paramore");
    expect(labels(index, "synthp")).toContain("synthpop");
  });

  it("finds an accented name from a plain-letter query", () => {
    expect(labels(index, "sigur ros")).toContain("Sigur Rós");
  });

  it("tells a tag from an artist, and counts the tag's carriers", () => {
    const [top] = searchTargets(index, "emo pop");
    expect(top).toEqual({ kind: "tag", label: "emo pop", carriers: 1 });
    expect(searchTargets(index, "paramore")[0]).toEqual({ kind: "artist", label: "Paramore" });
  });

  it("puts the best match first", () => {
    expect(labels(index, "pop")[0]).toBe("emo pop");
  });

  it("never offers a tag that places nobody on the map", () => {
    // Glasgow and 2010s are on CHVRCHES' row but are not sound tags.
    expect(labels(index, "glasgow")).toEqual([]);
    expect(labels(index, "2010s")).toEqual([]);
  });

  it("honours the result limit", () => {
    expect(searchTargets(index, "pop", 2)).toHaveLength(2);
  });
});

describe("resolveSpotlight", () => {
  // Three scenes plus an artist resembling nobody, so the layout really does
  // leave one artist unclustered. Registered genre tags, as in
  // cloud-layout.test.ts: only a tag the vocabulary calls a genre founds a ring,
  // so invented ones would produce a map with no clusters at all to light.
  const popPunks = ["pp1", "pp2", "pp3", "pp4", "pp5", "pp6"].map((n) =>
    artist(n, ["pop punk", "distorted guitars"]),
  );
  const emoActs = ["em1", "em2", "em3", "em4", "em5", "em6"].map((n) =>
    artist(n, ["emo", "distorted guitars"]),
  );
  const edms = ["ed1", "ed2", "ed3", "ed4", "ed5", "ed6"].map((n) =>
    artist(n, ["EDM", "electronic beats"]),
  );
  const scenes = [...popPunks, ...emoActs, ...edms, artist("Loner", [])];
  const layout: CloudLayout = computeCloudLayout(scenes);
  const clusterOf = (name: string): number =>
    layout.clusters.findIndex((cluster) => cluster.members.includes(name));

  const entry = (label: string, kind: SearchEntry["kind"]): SearchEntry =>
    kind === "artist" ? { kind, label } : { kind, label, carriers: 0 };

  it("lights a clustered artist and exactly the cluster holding it", () => {
    const spotlight = resolveSpotlight(layout, scenes, entry("pp1", "artist"));
    expect([...spotlight.artists]).toEqual(["pp1"]);
    expect([...spotlight.clusters]).toEqual([clusterOf("pp1")]);
  });

  it("lights an unclustered artist alone, with no cluster", () => {
    expect(clusterOf("Loner")).toBe(-1); // the fixture's premise
    const spotlight = resolveSpotlight(layout, scenes, entry("Loner", "artist"));
    expect([...spotlight.artists]).toEqual(["Loner"]);
    expect(spotlight.clusters.size).toBe(0);
  });

  it("lights every carrier of a tag, and every cluster one of them is in", () => {
    const spotlight = resolveSpotlight(layout, scenes, entry("pop punk", "tag"));
    expect([...spotlight.artists].sort()).toEqual(popPunks.map((a) => a.name));
    expect([...spotlight.clusters]).toEqual([clusterOf("pp1")]);
  });

  it("spans clusters when a tag's carriers do", () => {
    // A quality shared by two scenes: the pop punks and the emos both distort
    // their guitars, so both rings must light.
    const spotlight = resolveSpotlight(layout, scenes, entry("distorted guitars", "tag"));
    expect(spotlight.artists.size).toBe(popPunks.length + emoActs.length);
    expect([...spotlight.clusters].sort()).toEqual(
      [clusterOf("pp1"), clusterOf("em1")].sort((a, b) => a - b),
    );
  });

  it("lights nothing for a tag nobody carries", () => {
    const spotlight = resolveSpotlight(layout, scenes, entry("sea shanty", "tag"));
    expect(spotlight.artists.size).toBe(0);
    expect(spotlight.clusters.size).toBe(0);
  });
});

// Invariants over the shipped roster, so a data change that breaks search is
// caught in CI. The index is built once and shared.
describe("on the real roster", () => {
  const index = buildSearchIndex(roster, allSoundTags);
  const layout = computeCloudLayout(roster);

  it("indexes every artist and every sound tag", () => {
    expect(index).toHaveLength(roster.length + allSoundTags.length);
  });

  it("offers no tag that nobody carries", () => {
    for (const { entry } of index) {
      if (entry.kind === "tag") expect(entry.carriers).toBeGreaterThan(0);
    }
  });

  it("finds a real artist from a partial, wrongly-cased query", () => {
    expect(labels(index, "paramo")[0]).toBe("Paramore");
    expect(labels(index, "chvr")[0]).toBe("CHVRCHES");
  });

  it("finds an accented name typed in plain letters", () => {
    expect(labels(index, "girugamesh")).toContain("girugämesh");
  });

  it("puts a tag typed in full at the top of its own suggestions", () => {
    expect(labels(index, "emo pop")[0]).toBe("emo pop");
  });

  it("lands every suggestion on at least one artist", () => {
    // Whatever a real query offers must be actionable: an entry that resolves to
    // nobody would spotlight an empty map.
    for (const query of ["pop", "metal", "vocals", "synth", "rock"]) {
      for (const entry of searchTargets(index, query)) {
        expect(resolveSpotlight(layout, roster, entry).artists.size).toBeGreaterThan(0);
      }
    }
  });
});
