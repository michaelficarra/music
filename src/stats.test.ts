import { describe, expect, it } from "vitest";
import { artists as roster } from "./data";
import {
  PREDICTOR_LIST_LIMIT,
  MIN_SUPPORT,
  OUTLIER_LIST_LIMIT,
  SPREAD_MIN_SUPPORT,
  TAG_LIST_LIMIT,
  categorySuperlatives,
  computeStats,
  computeTagStats,
  positionFraction,
  rankBestPredictors,
  rankWorstPredictors,
  rankOutliers,
  rankTags,
  tierLabel,
  tierScore,
  type TagStat,
} from "./stats";
import { isEraTag } from "./tag-groups";
import { TIERS, type Artist, type Slot } from "./types";

const artist = (name: string, slot: Slot, tags: string[]): Artist => ({
  name,
  baselineSlot: slot,
  imageURL: "",
  imageSource: "",
  tags,
});

/** A TagStat literal for testing the ranking functions in isolation. */
const stat = (
  tag: string,
  mean: number,
  count = MIN_SUPPORT,
  spread = 0,
  low = mean,
  high = mean,
  above = 0,
  below = 0,
): TagStat => ({ tag, count, mean, spread, low, high, above, below });

describe("tierScore", () => {
  it("maps the tiers linearly, S = 7 down to F = 1", () => {
    expect(TIERS.map(tierScore)).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });
});

describe("tierLabel", () => {
  it("gives whole scores the bare letter", () => {
    expect(tierLabel(7)).toBe("S");
    expect(tierLabel(6)).toBe("A");
    expect(tierLabel(1)).toBe("F");
  });

  it("leans + or − only outside the middle third of a tier's band", () => {
    expect(tierLabel(5.9)).toBe("A"); // within ±1/6 of 6
    expect(tierLabel(6.17)).toBe("A+");
    expect(tierLabel(5.66)).toBe("A−");
    expect(tierLabel(6.49)).toBe("A+");
    expect(tierLabel(5.49)).toBe("B+");
    expect(tierLabel(1.2)).toBe("F+");
  });

  it("rounds half-scores up to the better tier's − side", () => {
    expect(tierLabel(6.5)).toBe("S−");
  });

  it("uses a proper minus sign, not a hyphen", () => {
    expect(tierLabel(5.66)).toContain("−");
  });

  it("clamps to the scale, so S+ and F− cannot occur", () => {
    expect(tierLabel(7.5)).toBe("S");
    expect(tierLabel(0.2)).toBe("F");
  });
});

describe("positionFraction", () => {
  it("spans the full axis: F at the left end, S at the right", () => {
    expect(positionFraction(1)).toBe(0);
    expect(positionFraction(7)).toBe(1);
    expect(positionFraction(4)).toBe(0.5);
    // Out-of-range scores clamp to the scale.
    expect(positionFraction(0.5)).toBe(0);
    expect(positionFraction(7.5)).toBe(1);
  });
});

describe("computeTagStats", () => {
  it("computes mean and population spread over a tag's ranked carriers", () => {
    const stats = computeTagStats([
      artist("a", "S", ["punk"]), // 7
      artist("b", "A", ["punk"]), // 6
      artist("c", "B", ["punk"]), // 5
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.tag).toBe("punk");
    expect(stats[0]!.count).toBe(3);
    expect(stats[0]!.mean).toBe(6);
    expect(stats[0]!.spread).toBeCloseTo(Math.sqrt(2 / 3), 12);
    expect(stats[0]!.low).toBe(5);
    expect(stats[0]!.high).toBe(7);
    // A full tier from the mean of 6: only the S (7) above, only the B (5) below.
    expect(stats[0]!.above).toBe(1);
    expect(stats[0]!.below).toBe(1);
  });

  it("ignores unranked carriers entirely", () => {
    const stats = computeTagStats([
      artist("a", "S", ["punk"]),
      artist("b", "S", ["punk"]),
      artist("c", "S", ["punk"]),
      artist("d", "unranked", ["punk"]), // must not dilute count or mean
      artist("e", "unranked", ["punk"]),
    ]);
    expect(stats[0]!.count).toBe(3);
    expect(stats[0]!.mean).toBe(7);
  });

  it("drops tags below the minimum support and keeps those exactly at it", () => {
    const stats = computeTagStats([
      artist("a", "S", ["kept", "dropped"]),
      artist("b", "A", ["kept", "dropped"]),
      artist("c", "B", ["kept"]),
    ]);
    expect(stats.map((s) => s.tag)).toEqual(["kept"]);
  });

  it("returns nothing for an empty or wholly unranked roster", () => {
    expect(computeTagStats([])).toEqual([]);
    expect(computeTagStats([artist("a", "unranked", ["punk"])])).toEqual([]);
  });

  it("ignores tagless artists and sorts tags canonically", () => {
    const trio = (slot: Slot, tags: string[]): Artist[] =>
      ["x", "y", "z"].map((n) => artist(n + tags[0], slot, tags));
    const stats = computeTagStats([
      ...trio("A", ["Zeta"]),
      ...trio("A", ["alpha"]),
      artist("tagless", "S", []),
    ]);
    // Case-insensitive name order, and the tagless artist changed nothing.
    expect(stats.map((s) => s.tag)).toEqual(["alpha", "Zeta"]);
  });
});

describe("rankTags", () => {
  it("ranks favourites by mean descending and the rest descending toward the worst", () => {
    const { favourites, leastFavourites } = rankTags(
      [stat("mid", 4), stat("best", 6), stat("worst", 2)],
      1,
    );
    expect(favourites.map((s) => s.tag)).toEqual(["best"]);
    expect(leastFavourites.map((s) => s.tag)).toEqual(["worst"]);
  });

  it("breaks mean ties by support, then by name", () => {
    const { favourites } = rankTags([stat("b", 5, 3), stat("a", 5, 3), stat("popular", 5, 9)]);
    expect(favourites.map((s) => s.tag)).toEqual(["popular", "a", "b"]);
  });

  it("never lets the two lists overlap", () => {
    // 12 qualifying tags with a limit of 10: the bottom list gets only the
    // 2 leftovers (descending, the very worst last), not a mirror of the top.
    const stats = Array.from({ length: 12 }, (_, i) => stat(`tag${i}`, i + 1));
    const { favourites, leastFavourites } = rankTags(stats, 10);
    expect(favourites).toHaveLength(10);
    expect(leastFavourites.map((s) => s.tag)).toEqual(["tag1", "tag0"]);

    // And with fewer tags than the limit, everything is a favourite.
    const few = rankTags([stat("a", 5), stat("b", 4), stat("c", 3)], 10);
    expect(few.favourites).toHaveLength(3);
    expect(few.leastFavourites).toEqual([]);
  });
});

describe("categorySuperlatives", () => {
  // Era stats never reach this function — computeStats partitions them into
  // their own section first — so none feature in these inputs.
  it("picks the best-rated tag per vocabulary category, in display order", () => {
    const superlatives = categorySuperlatives([
      // Genres (vocabulary from tag-groups.ts)
      stat("pop punk", 6),
      stat("emo", 5),
      // Musical qualities
      stat("catchy hooks", 4),
      // Notable aspects
      stat("British", 2),
    ]);
    expect(superlatives.map((s) => [s.category, s.stat.tag])).toEqual([
      ["Genres", "pop punk"],
      ["Musical qualities", "catchy hooks"],
      ["Notable aspects", "British"],
    ]);
  });

  it("omits empty categories and never surfaces an 'Other' tag", () => {
    const superlatives = categorySuperlatives([stat("emo", 5), stat("not in vocabulary", 7)]);
    expect(superlatives.map((s) => [s.category, s.stat.tag])).toEqual([["Genres", "emo"]]);
  });

  it("breaks mean ties by support", () => {
    const superlatives = categorySuperlatives([stat("emo", 5, 3), stat("pop punk", 5, 8)]);
    expect(superlatives[0]!.stat.tag).toBe("pop punk");
  });
});

describe("rankWorstPredictors", () => {
  it("wants two far-apart, evenly-matched camps over enough carriers", () => {
    const stats = [
      stat("balanced", 4, 10, 2, 1, 7, 5, 5), // spread 2 × smaller-camp share 0.5 = 1
      stat("lopsided", 4, 10, 2.4, 1, 7, 1, 8), // wider spread, but one camp of one: 0.24
      stat("flat", 4, 10, 0.5, 3, 5, 0, 4), // no upper camp at all: not divisive
      stat("small", 4, 4, 3, 1, 7, 2, 2), // too few carriers for this list
    ];
    expect(rankWorstPredictors(stats).map((s) => s.tag)).toEqual(["balanced", "lopsided"]);
    expect(rankWorstPredictors(stats, 1).map((s) => s.tag)).toEqual(["balanced"]);
  });
});

describe("rankBestPredictors", () => {
  it("ranks by tightest spread, better-evidenced tags first on ties", () => {
    const stats = [
      stat("loose", 4, 10, 2, 1, 7, 5, 5),
      stat("tight", 5, 10, 0.3, 4.5, 5.5),
      stat("tightToo", 5, 20, 0.3, 4.5, 5.5), // same spread, twice the evidence
      stat("tiny", 5, 4, 0), // perfectly tight, but too few carriers
    ];
    expect(rankBestPredictors(stats).map((s) => s.tag)).toEqual(["tightToo", "tight", "loose"]);
    expect(rankBestPredictors(stats, 1).map((s) => s.tag)).toEqual(["tightToo"]);
  });
});

describe("rankOutliers", () => {
  // One tag, four carriers: an S among three Cs. Leave-one-out, the S artist
  // is predicted (4+4+4)/3 = 4 (delta +3); each C is predicted (7+4+4)/3 = 5
  // (delta −1).
  const sAmongCs = [
    artist("star", "S", ["punk"]),
    artist("c1", "C", ["punk"]),
    artist("c2", "C", ["punk"]),
    artist("c3", "C", ["punk"]),
  ];

  it("computes leave-one-out predictions and signed deltas", () => {
    const { guiltyPleasures, blackSheep } = rankOutliers(sAmongCs);
    expect(guiltyPleasures.map((o) => o.name)).toEqual(["star"]);
    expect(guiltyPleasures[0]!.predicted).toBe(4);
    expect(guiltyPleasures[0]!.delta).toBe(3);
    // The three Cs all sit one tier below prediction — the furthest below on
    // this roster — name-ordered for selection, then reversed for display.
    expect(blackSheep.map((o) => o.name)).toEqual(["c3", "c2", "c1"]);
    expect(blackSheep[0]!.delta).toBe(-1);
  });

  it("splits the sides by the delta's sign; an exact match joins neither", () => {
    // An S among three As: the S sits +1 above its prediction, each A only
    // −1/3 below — small, but still the furthest below on this roster.
    const { guiltyPleasures, blackSheep } = rankOutliers([
      artist("top", "S", ["punk"]),
      artist("a1", "A", ["punk"]),
      artist("a2", "A", ["punk"]),
      artist("a3", "A", ["punk"]),
    ]);
    expect(guiltyPleasures.map((o) => o.name)).toEqual(["top"]);
    expect(blackSheep.map((o) => o.name)).toEqual(["a3", "a2", "a1"]);

    // Carriers all on one tier predict each other exactly: delta 0 for
    // everyone, and neither side lists anyone.
    const flat = rankOutliers(["f1", "f2", "f3"].map((n) => artist(n, "B", ["punk"])));
    expect(flat.guiltyPleasures).toEqual([]);
    expect(flat.blackSheep).toEqual([]);
  });

  it("averages the leave-one-out means of all qualifying tags", () => {
    // "subject" carries two predictor tags with different leave-one-out
    // means: "high" predicts (7+7)/2 = 7, "low" predicts (4+4)/2 = 4, so the
    // combined prediction is 5.5 and the F-placed subject's delta is −4.5.
    const { blackSheep } = rankOutliers([
      artist("subject", "F", ["high", "low"]),
      artist("h1", "S", ["high"]),
      artist("h2", "S", ["high"]),
      artist("l1", "C", ["low"]),
      artist("l2", "C", ["low"]),
    ]);
    const subject = blackSheep.find((o) => o.name === "subject")!;
    expect(subject.predicted).toBe(5.5);
    expect(subject.delta).toBe(1 - 5.5);
  });

  it("excludes artists with no sufficiently-supported tags, and unranked ones", () => {
    const { guiltyPleasures, blackSheep } = rankOutliers([
      artist("untagged", "S", []),
      artist("rare", "S", ["one-off", "two-off"]), // both tags below support
      artist("other", "F", ["two-off"]),
      artist("ghost", "unranked", ["punk"]), // not a subject…
      ...sAmongCs, // …and absent from punk's totals (tested above: predictions unchanged)
    ]);
    const names = [...guiltyPleasures, ...blackSheep].map((o) => o.name);
    expect(names).not.toContain("untagged");
    expect(names).not.toContain("rare");
    expect(names).not.toContain("ghost");
    expect(guiltyPleasures[0]!.predicted).toBe(4); // the unranked carrier changed nothing
  });

  it("caps each list at the limit", () => {
    // c1 and c2 make the cut (selection is name-ordered on tied deltas);
    // the display order then reverses.
    const { blackSheep } = rankOutliers(sAmongCs, 2);
    expect(blackSheep.map((o) => o.name)).toEqual(["c2", "c1"]);
  });

  it("never uses era tags as predictors", () => {
    // "1990s" is carried by plenty of ranked artists, but eras sit outside
    // the prediction model: "lone" has no other tag, so it is not judged at
    // all rather than scored against its decade…
    const { guiltyPleasures, blackSheep } = rankOutliers([
      artist("lone", "S", ["1990s"]),
      artist("d1", "D", ["1990s", "punk"]),
      artist("d2", "D", ["1990s", "punk"]),
      artist("d3", "D", ["1990s", "punk"]),
      artist("star", "S", ["1990s", "punk"]),
    ]);
    expect([...guiltyPleasures, ...blackSheep].map((o) => o.name)).not.toContain("lone");
    // …and "star"'s prediction comes from "punk" alone (leave-one-out mean
    // (3+3+3)/3 = 3), unmoved by the high-scoring era carriers.
    expect(guiltyPleasures.map((o) => o.name)).toEqual(["star"]);
    expect(guiltyPleasures[0]!.predicted).toBe(3);
  });
});

describe("computeStats", () => {
  it("returns empty, NaN-free results for a wholly unranked roster", () => {
    const stats = computeStats([
      artist("a", "unranked", ["punk"]),
      artist("b", "unranked", ["punk"]),
    ]);
    expect(stats.rankedCount).toBe(0);
    expect(stats.tagCount).toBe(0);
    expect(stats.eras).toEqual([]);
    expect(stats.rankings.favourites).toEqual([]);
    expect(stats.rankings.leastFavourites).toEqual([]);
    expect(stats.superlatives).toEqual([]);
    expect(stats.worstPredictors).toEqual([]);
    expect(stats.bestPredictors).toEqual([]);
    expect(stats.outliers.guiltyPleasures).toEqual([]);
    expect(stats.outliers.blackSheep).toEqual([]);
  });

  it("gives era tags their own chronological section and keeps them out of the rest", () => {
    // Three qualifying tags: two eras (the newer rated highest of all, the
    // older lowest) and one genre in between.
    const trio = (names: string[], slot: Slot, tags: string[]): Artist[] =>
      names.map((n) => artist(n, slot, tags));
    const stats = computeStats([
      ...trio(["n1", "n2", "n3"], "S", ["2020s"]),
      ...trio(["g1", "g2", "g3"], "B", ["emo"]),
      ...trio(["o1", "o2", "o3"], "F", ["1960s"]),
    ]);
    // Oldest decade first, regardless of rating.
    expect(stats.eras.map((s) => s.tag)).toEqual(["1960s", "2020s"]);
    expect(stats.tagCount).toBe(3); // eras still count toward the total
    // Despite being the extremes, the eras feature in no ranked list…
    expect(stats.rankings.favourites.map((s) => s.tag)).toEqual(["emo"]);
    expect(stats.rankings.leastFavourites).toEqual([]);
    expect(stats.worstPredictors).toEqual([]); // 3 carriers sits below the spread floor…
    expect(stats.bestPredictors).toEqual([]); // …for both spread-based lists
    // …and no Eras superlative is offered.
    expect(stats.superlatives.map((s) => s.category)).toEqual(["Genres"]);
  });

  // Invariant checks over the real shipped roster, so a data change that
  // produces degenerate statistics is caught in CI.
  describe("on the real roster", () => {
    const stats = computeStats(roster);

    it("finds plenty of ranked artists and supported tags", () => {
      expect(stats.rankedCount).toBeGreaterThan(0);
      expect(stats.tagCount).toBeGreaterThan(0);
    });

    it("keeps every score on the tier scale and every list within its limit", () => {
      const allTagStats = [
        ...stats.eras,
        ...stats.rankings.favourites,
        ...stats.rankings.leastFavourites,
        ...stats.superlatives.map((s) => s.stat),
        ...stats.worstPredictors,
        ...stats.bestPredictors,
      ];
      for (const tagStat of allTagStats) {
        expect(tagStat.low).toBeGreaterThanOrEqual(1);
        expect(tagStat.low).toBeLessThanOrEqual(tagStat.mean);
        expect(tagStat.mean).toBeLessThanOrEqual(tagStat.high);
        expect(tagStat.high).toBeLessThanOrEqual(7);
        expect(tagStat.count).toBeGreaterThanOrEqual(MIN_SUPPORT);
      }
      for (const outlier of [...stats.outliers.guiltyPleasures, ...stats.outliers.blackSheep]) {
        expect(outlier.predicted).toBeGreaterThanOrEqual(1);
        expect(outlier.predicted).toBeLessThanOrEqual(7);
        expect(Math.abs(outlier.delta)).toBeGreaterThan(0);
      }
      expect(stats.rankings.favourites.length).toBeLessThanOrEqual(TAG_LIST_LIMIT);
      expect(stats.rankings.leastFavourites.length).toBeLessThanOrEqual(TAG_LIST_LIMIT);
      expect(stats.worstPredictors.length).toBeLessThanOrEqual(PREDICTOR_LIST_LIMIT);
      expect(stats.outliers.guiltyPleasures.length).toBeLessThanOrEqual(OUTLIER_LIST_LIMIT);
      expect(stats.outliers.blackSheep.length).toBeLessThanOrEqual(OUTLIER_LIST_LIMIT);
    });

    it("keeps the favourite and least-favourite lists disjoint", () => {
      const favourites = new Set(stats.rankings.favourites.map((s) => s.tag));
      for (const least of stats.rankings.leastFavourites) {
        expect(favourites.has(least.tag)).toBe(false);
      }
    });

    it("confines era tags to the chronological era section", () => {
      expect(stats.eras.length).toBeGreaterThan(0);
      expect(stats.eras.every((s) => isEraTag(s.tag))).toBe(true);
      const chronological = [...stats.eras.map((s) => s.tag)].sort();
      expect(stats.eras.map((s) => s.tag)).toEqual(chronological);
      const elsewhere = [
        ...stats.rankings.favourites,
        ...stats.rankings.leastFavourites,
        ...stats.superlatives.map((s) => s.stat),
        ...stats.worstPredictors,
        ...stats.bestPredictors,
      ];
      expect(elsewhere.some((s) => isEraTag(s.tag))).toBe(false);
    });

    it("keeps each worst predictor genuinely two-camped", () => {
      expect(stats.worstPredictors.length).toBeGreaterThan(0);
      for (const tagStat of stats.worstPredictors) {
        expect(tagStat.count).toBeGreaterThanOrEqual(SPREAD_MIN_SUPPORT);
        expect(tagStat.above).toBeGreaterThanOrEqual(1);
        expect(tagStat.below).toBeGreaterThanOrEqual(1);
      }
    });

    it("ranks the best predictors tightest-first, over the same floor", () => {
      expect(stats.bestPredictors.length).toBeGreaterThan(0);
      const spreads = stats.bestPredictors.map((s) => s.spread);
      expect([...spreads].sort((a, b) => a - b)).toEqual(spreads);
      for (const tagStat of stats.bestPredictors) {
        expect(tagStat.count).toBeGreaterThanOrEqual(SPREAD_MIN_SUPPORT);
      }
    });
  });
});
