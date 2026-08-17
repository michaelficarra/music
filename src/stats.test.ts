import { describe, expect, it } from "vitest";
import { artists as roster } from "./data";
import {
  MIN_CAMP_SIZE,
  MIN_SUPPORT,
  ARTIST_LIST_LIMIT,
  PREDICTOR_LIST_LIMIT,
  SPREAD_MIN_SUPPORT,
  TAG_LIST_LIMIT,
  categoryComposition,
  computeStats,
  computeTagStats,
  positionFraction,
  rankByFavouriteIndex,
  rankByRatio,
  rankIsolation,
  measurePredictivePower,
  rankReliable,
  rankVariable,
  tierBand,
  type TagStat,
} from "./stats";
import { isEraTag } from "./tag-groups";
import {
  BASE_TIERS,
  TIERS,
  TIER_WEIGHT,
  TOP_POSITION,
  tierPosition,
  type Artist,
  type Slot,
} from "./types";

/** `tags` is what the artist carries; the statistics read `specificTags`, which
    a synthetic roster sets to the same thing — breadth is measured over the real
    roster in data.ts, not re-derived here. `sound` is the narrower set the two
    ☁️-derived sections read, and defaults to the same list again; the tests
    about what those sections leave out pass it explicitly, rather than relying
    on a fixture tag happening to be a real registry region. */
const artist = (name: string, slot: Slot, tags: string[], sound: string[] = tags): Artist => ({
  name,
  baselineSlot: slot,
  imageURL: "",
  imageSource: "",
  ownTags: tags,
  tags,
  specificTags: tags,
  soundTags: sound,
});

/** `count` artists on one tier sharing one set of tags, uniquely named. */
const cohort = (
  prefix: string,
  slot: Slot,
  count: number,
  tags: string[],
  sound: string[] = tags,
): Artist[] => Array.from({ length: count }, (_, i) => artist(`${prefix}${i}`, slot, tags, sound));

/** A TagStat literal for testing the ranking functions in isolation. Only the
    fields a given ranking reads need overriding. */
const stat = (tag: string, over: Partial<TagStat> = {}): TagStat => ({
  tag,
  count: MIN_SUPPORT,
  prevalence: 0,
  meanWeight: 3,
  ratio: 1,
  favourites: 0,
  favouriteRate: 0,
  favouriteIndex: 1,
  mean: 4,
  spread: 0,
  low: 4,
  high: 4,
  above: 0,
  below: 0,
  elevationIsReal: true,
  clusteringIsReal: true,
  elevationP: 0,
  ...over,
});

describe("the two tier valuations", () => {
  it("positions the ranks linearly, S = 7 down to F = 1", () => {
    expect(BASE_TIERS.map(tierPosition)).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it("sits a rank's variants a third of a rank either side of it", () => {
    // The variants are a real move on the scale, not a label: everything derived
    // from the position — the 🎲 odds and every 📊 placement figure — feels them.
    expect(tierPosition("A+") - tierPosition("A")).toBeCloseTo(1 / 3);
    expect(tierPosition("A") - tierPosition("A-")).toBeCloseTo(1 / 3);
    // …which leaves a rank's own step between neighbouring ranks intact.
    expect(tierPosition("A-") - tierPosition("B+")).toBeCloseTo(1 / 3);
  });

  it("leaves F alone at the bottom, with no variant below E-", () => {
    // Nothing ranks below F, so an "F-" would name a place off the end of the
    // scale; the gap from E- down to F is two steps rather than one.
    expect(tierPosition("E-") - tierPosition("F")).toBeCloseTo(2 / 3);
  });

  it("weights every tier positively, never penalising a placement", () => {
    // The roster is a list of artists the user likes: being on it, anywhere,
    // may only ever add.
    for (const tier of TIERS) expect(TIER_WEIGHT[tier]).toBeGreaterThan(0);
  });

  it("weights the tiers in ranking order, with widening gaps towards the top", () => {
    const weights = TIERS.map((tier) => TIER_WEIGHT[tier]);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i - 1]!).toBeGreaterThan(weights[i]!);
    }
    // The S→A step dwarfs the E→F one: a favourite counts for far more than a
    // one-rank promotion at the bottom does.
    expect(TIER_WEIGHT.S - TIER_WEIGHT.A).toBeGreaterThan(TIER_WEIGHT.E - TIER_WEIGHT.F);
  });

  it("narrows the gaps proportionally towards the top, the reverse of the absolute ones", () => {
    // Both readings are deliberate: an S counts far more than an E in absolute
    // terms, yet the S/A distinction is the finest the tier list draws.
    const ratio = (better: number, worse: number) => better / worse;
    expect(ratio(TIER_WEIGHT.S, TIER_WEIGHT.A)).toBeLessThan(ratio(TIER_WEIGHT.E, TIER_WEIGHT.F));
  });

  it("keeps every base rank's weight exactly where it was before the variants", () => {
    // The whole roster still sits on base ranks, so nothing 📊 or 🎲 reports has
    // moved; the pinned figures in CLAUDE.md stay valid until artists are sorted
    // into the new rows.
    expect(TIER_WEIGHT.S).toBe(49);
    expect(TIER_WEIGHT.A).toBe(36);
    expect(TIER_WEIGHT.F).toBe(1);
  });
});

describe("tierBand", () => {
  it("gives whole positions their own tier", () => {
    expect(tierBand(7)).toBe("S");
    expect(tierBand(6)).toBe("A");
    expect(tierBand(1)).toBe("F");
  });

  it("bands a mean onto the nearest tier, variants included", () => {
    expect(tierBand(5.9)).toBe("A"); // within ±1/6 of 6
    expect(tierBand(6.17)).toBe("A+");
    expect(tierBand(5.66)).toBe("A-");
    expect(tierBand(6.49)).toBe("A+");
    expect(tierBand(5.49)).toBe("B+");
  });

  it("rounds a position falling exactly between two tiers up to the better one", () => {
    expect(tierBand(6.5)).toBe("S-");
  });

  it("names only tiers the board has, so there is no F+", () => {
    // A mean just above F has E- as its other neighbour, two thirds of a rank
    // away — F is still the nearer.
    expect(tierBand(1.2)).toBe("F");
  });

  it("bands positions past either end onto the tier at that end", () => {
    expect(tierBand(7.5)).toBe("S+");
    expect(tierBand(0.2)).toBe("F");
  });
});

describe("positionFraction", () => {
  it("spans the tiers the roster actually occupies, not the theoretical axis", () => {
    // E (2) to S (7): the empty bottom tier must not eat a sixth of the track.
    const occupied = { low: 2, high: 7 };
    expect(positionFraction(2, occupied)).toBe(0);
    expect(positionFraction(7, occupied)).toBe(1);
    expect(positionFraction(4.5, occupied)).toBe(0.5);
    // Positions outside the occupied span clamp to its ends.
    expect(positionFraction(1, occupied)).toBe(0);
    expect(positionFraction(9, occupied)).toBe(1);
  });

  it("puts everything at the top when only one tier is occupied", () => {
    expect(positionFraction(4, { low: 4, high: 4 })).toBe(1);
  });
});

describe("computeTagStats", () => {
  it("computes prevalence, placement and spread over a tag's ranked carriers", () => {
    const stats = computeTagStats([
      artist("a", "S", ["punk"]), // position 7, weight 49
      artist("b", "A", ["punk"]), // position 6, weight 36
      artist("c", "B", ["punk"]), // position 5, weight 25
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.tag).toBe("punk");
    expect(stats[0]!.count).toBe(3);
    // Every ranked artist carries the tag, so it covers the whole roster.
    expect(stats[0]!.prevalence).toBe(1);
    expect(stats[0]!.mean).toBe(6);
    expect(stats[0]!.spread).toBeCloseTo(Math.sqrt(2 / 3), 12);
    expect(stats[0]!.low).toBe(5);
    expect(stats[0]!.high).toBe(7);
    // A full tier from the mean of 6: only the S (7) above, only the B (5) below.
    expect(stats[0]!.above).toBe(1);
    expect(stats[0]!.below).toBe(1);
  });

  it("gives a tag carrying the whole roster a ratio of exactly 1", () => {
    // Its carriers *are* the average, so it can be neither lifted nor typical.
    const stats = computeTagStats(cohort("a", "C", 6, ["everywhere"]));
    expect(stats[0]!.ratio).toBeCloseTo(1, 12);
    expect(stats[0]!.prevalence).toBe(1);
  });

  it("counts prevalence by head, leaving the tiers out of it", () => {
    const stats = computeTagStats([
      ...cohort("top", "S", 3, ["loved"]),
      ...cohort("low", "E", 3, ["quiet"]),
    ]);
    const byTag = new Map(stats.map((s) => [s.tag, s]));
    // Three artists each, at opposite ends of the board — and prevalence, the
    // descriptive measure, treats them identically. That is the point: presence
    // is the positive signal, and a tier-weighted version of this quietly
    // reintroduced "lower means less".
    expect(byTag.get("loved")!.prevalence).toBeCloseTo(0.5, 12);
    expect(byTag.get("quiet")!.prevalence).toBeCloseTo(0.5, 12);
    // The tiers survive only in the inferential half.
    expect(byTag.get("loved")!.meanWeight).toBeGreaterThan(byTag.get("quiet")!.meanWeight);
  });

  it("ignores unranked carriers entirely", () => {
    const stats = computeTagStats([
      ...cohort("r", "S", 3, ["punk"]),
      artist("d", "unranked", ["punk"]), // must not dilute count, prevalence or mean
      artist("e", "unranked", ["punk"]),
    ]);
    expect(stats[0]!.count).toBe(3);
    expect(stats[0]!.mean).toBe(7);
    expect(stats[0]!.prevalence).toBe(1);
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
    const stats = computeTagStats([
      ...cohort("z", "A", 3, ["Zeta"]),
      ...cohort("a", "A", 3, ["alpha"]),
      artist("tagless", "S", []),
    ]);
    // Case-insensitive name order, and the tagless artist changed nothing.
    expect(stats.map((s) => s.tag)).toEqual(["alpha", "Zeta"]);
  });

  it("counts carriers in the favourite tiers, derived from the roster's own shape", () => {
    // 40 ranked artists: the favourite tiers are the top ones covering a
    // quarter of them, so S (4) and A (8) — 12 artists, 30%.
    const stats = computeTagStats([
      ...cohort("s", "S", 4, ["elite", "wide"]),
      ...cohort("a", "A", 8, ["elite", "wide"]),
      ...cohort("c", "C", 28, ["wide"]),
    ]);
    const byTag = new Map(stats.map((s) => [s.tag, s]));
    expect(byTag.get("elite")!.favourites).toBe(12);
    expect(byTag.get("elite")!.favouriteRate).toBe(1);
    expect(byTag.get("wide")!.favourites).toBe(12);
    expect(byTag.get("wide")!.favouriteRate).toBeCloseTo(12 / 40, 12);
    // "wide" is the whole roster, so it can only ever match the baseline.
    expect(byTag.get("wide")!.favouriteIndex).toBeCloseTo(1, 12);
    expect(byTag.get("elite")!.favouriteIndex).toBeGreaterThan(1);
  });
});

describe("shrinkage towards the roster average", () => {
  // The failure the whole rework exists to fix: on the real roster, ranking
  // tags by their raw average crowned three-artist tags ("New Zealand",
  // "bedroom pop") while a 36-artist scene never appeared at all.
  const noisyVsEstablished = [
    ...cohort("rare", "A", 3, ["niche"]), // 3 carriers, the highest raw average
    ...cohort("scene", "B", 20, ["established"]), // 20 carriers, a lower one
    ...cohort("filler", "E", 60, ["backdrop"]),
  ];

  it("lets a well-evidenced tag beat a higher-scoring handful", () => {
    const stats = computeTagStats(noisyVsEstablished);
    const byTag = new Map(stats.map((s) => [s.tag, s]));
    const niche = byTag.get("niche")!;
    const established = byTag.get("established")!;

    // Raw averages: the three-artist tag is comfortably ahead…
    expect(TIER_WEIGHT.A).toBeGreaterThan(TIER_WEIGHT.B);
    // …but with the evidence weighed, the scene wins.
    expect(established.ratio).toBeGreaterThan(niche.ratio);
    expect(rankByRatio(stats)[0]!.tag).toBe("established");
  });

  it("still lets a small tag rank when its evidence is extreme enough", () => {
    // Shrinkage tempers small samples; it does not silence them.
    const stats = computeTagStats([
      ...cohort("rare", "S", 3, ["niche"]),
      ...cohort("filler", "E", 30, ["backdrop"]),
    ]);
    const byTag = new Map(stats.map((s) => [s.tag, s]));
    expect(byTag.get("niche")!.ratio).toBeGreaterThan(byTag.get("backdrop")!.ratio);
  });

  it("pulls a tag with the least evidence closest to the roster average", () => {
    const stats = computeTagStats(noisyVsEstablished);
    const byTag = new Map(stats.map((s) => [s.tag, s]));
    // Both tags sit above the roster average; the sparser one is dragged back
    // towards 1.00 harder.
    expect(byTag.get("niche")!.ratio).toBeGreaterThan(1);
    expect(byTag.get("established")!.ratio).toBeGreaterThan(byTag.get("niche")!.ratio);
  });
});

describe("rankByRatio", () => {
  it("orders by affection ratio, most lifted first", () => {
    const ranked = rankByRatio([
      stat("typical", { ratio: 1 }),
      stat("lifting", { ratio: 1.3 }),
      stat("ordinary", { ratio: 0.8 }),
    ]);
    expect(ranked.map((s) => s.tag)).toEqual(["lifting", "typical", "ordinary"]);
  });
});

describe("rankByFavouriteIndex", () => {
  it("orders by concentration in the favourite tiers", () => {
    const ranked = rankByFavouriteIndex([
      stat("even", { favouriteIndex: 1, count: SPREAD_MIN_SUPPORT }),
      stat("crowded", { favouriteIndex: 2.2, count: SPREAD_MIN_SUPPORT }),
    ]);
    expect(ranked.map((s) => s.tag)).toEqual(["crowded", "even"]);
  });

  it("demands more evidence than a bare average does", () => {
    // A rate over three carriers can only read 0, 1/3, 2/3 or 1 — far too
    // coarse to call a trend, so this list applies the higher floor.
    const ranked = rankByFavouriteIndex([
      stat("thin", { favouriteIndex: 9, count: SPREAD_MIN_SUPPORT - 1 }),
      stat("solid", { favouriteIndex: 1.5, count: SPREAD_MIN_SUPPORT }),
    ]);
    expect(ranked.map((s) => s.tag)).toEqual(["solid"]);
  });
});

describe("categoryComposition", () => {
  /** `count` ranked artists stating `ownTags` — the rows the inventory reads. */
  const stating = (count: number, ownTags: string[], slot: Slot = "B"): Artist[] =>
    Array.from({ length: count }, (_, i) => artist(`${ownTags.join("-")}${i}`, slot, ownTags));

  it("groups tags by vocabulary category, in display order, most common first", () => {
    const composition = categoryComposition([
      ...stating(5, ["emo", "catchy hooks", "British", "side project"]),
      ...stating(3, ["pop punk"]),
    ]);
    expect(composition.map((c) => [c.category, c.stats.map((t) => t.tag)])).toEqual([
      ["Genres", ["emo", "pop punk"]],
      ["Musical qualities", ["catchy hooks"]],
      ["Regions", ["British"]],
      ["Notable aspects", ["side project"]],
    ]);
  });

  it("counts the tags rows state, never the ones derived from them", () => {
    // Every one of these artists carries "punk rock" and "rock" by derivation.
    // Neither may appear: nobody described an artist that way, and an inventory
    // of descriptions used is exactly what this list is.
    const roster = [
      ...Array.from({ length: 4 }, (_, i) => ({
        ...artist(`a${i}`, "B", ["pop punk", "punk rock", "rock"]),
        ownTags: ["pop punk"],
      })),
    ];
    expect(categoryComposition(roster)[0]!.stats.map((t) => t.tag)).toEqual(["pop punk"]);
  });

  it("applies no breadth rule — a tag on everyone is what the list is for", () => {
    // "male vocals" covers the whole roster. It is excluded from every other
    // statistic for saying nothing, and belongs at the top of this one.
    const composition = categoryComposition(stating(6, ["male vocals", "emo"]));
    expect(composition.map((c) => c.stats.map((t) => t.tag))).toEqual([["emo"], ["male vocals"]]);
  });

  it("keeps the most common tag even where it says nothing about the ranking", () => {
    // Prevalence is a description of what was collected, so the biggest tag
    // belongs in it whatever its tiers look like. An earlier version dropped
    // "male vocals" for sitting below its average placement, which was the
    // tier-as-quality assumption creeping back in.
    const composition = categoryComposition([
      ...stating(6, ["male vocals"], "E"),
      ...stating(3, ["female vocals"], "S"),
    ]);
    expect(composition[0]!.stats.map((t) => t.tag)).toEqual(["male vocals", "female vocals"]);
  });

  it("honours the per-category limit", () => {
    const roster = [
      ...stating(6, ["emo"]),
      ...stating(5, ["pop punk"]),
      ...stating(4, ["post-hardcore"]),
      ...stating(3, ["electropop"]),
    ];
    expect(categoryComposition(roster, 2)[0]!.stats.map((s) => s.tag)).toEqual(["emo", "pop punk"]);
  });

  it("drops a tag too rare to be worth reporting", () => {
    expect(
      categoryComposition([
        ...stating(5, ["emo"]),
        ...stating(MIN_SUPPORT - 1, ["ska punk"]),
      ])[0]!.stats.map((t) => t.tag),
    ).toEqual(["emo"]);
  });

  it("ignores unranked artists and era tags", () => {
    // Eras have a section of their own; unranked artists are invisible to every
    // statistic.
    const composition = categoryComposition([
      ...stating(4, ["emo", "2000s"]),
      ...stating(9, ["ska punk"], "unranked"),
    ]);
    expect(composition.map((c) => [c.category, c.stats.map((t) => t.tag)])).toEqual([
      ["Genres", ["emo"]],
    ]);
  });

  it("omits empty categories and never surfaces an 'Other' tag", () => {
    const composition = categoryComposition(stating(4, ["emo", "not in vocabulary"]));
    expect(composition.map((c) => [c.category, c.stats.map((t) => t.tag)])).toEqual([
      ["Genres", ["emo"]],
    ]);
  });
});

describe("prevalence", () => {
  it("is a plain headcount, indifferent to where the carriers sit", () => {
    const stats = computeTagStats([
      ...cohort("wide", "E", 40, ["wide"]),
      ...cohort("narrow", "S", 4, ["narrow"]),
      ...cohort("filler", "C", 80, ["backdrop"]),
    ]);
    const byTag = new Map(stats.map((s) => [s.tag, s]));
    // "narrow" is four S-tier artists; "wide" is forty at the bottom of the
    // board. Prevalence says the collection is far more made of "wide", which
    // is simply true — and is exactly the statement a tier-weighted measure
    // would have suppressed.
    expect(byTag.get("narrow")!.ratio).toBeGreaterThan(byTag.get("wide")!.ratio);
    expect(byTag.get("wide")!.prevalence).toBeGreaterThan(byTag.get("narrow")!.prevalence);
  });

  it("is the carrier count over the ranked roster, and nothing else", () => {
    const stats = computeTagStats([
      ...cohort("a", "S", 5, ["punk"]),
      ...cohort("b", "E", 15, ["other"]),
    ]);
    const punk = stats.find((s) => s.tag === "punk")!;
    expect(punk.prevalence).toBeCloseTo(5 / 20, 12);
  });
});

describe("rankVariable", () => {
  const qualifying = (tag: string, spread: number): TagStat =>
    stat(tag, { count: 10, spread, low: 1, high: 7, above: 3, below: 3 });

  it("ranks by widest spread, the exact mirror of rankReliable", () => {
    const stats = [qualifying("narrow", 1.2), qualifying("widest", 2.4), qualifying("wide", 2)];
    expect(rankVariable(stats).map((s) => s.tag)).toEqual(["widest", "wide", "narrow"]);
    expect(rankVariable(stats, 1).map((s) => s.tag)).toEqual(["widest"]);
    // Reversing the same qualifying tags through the mirror gives the same order.
    expect(
      rankReliable(stats)
        .map((s) => s.tag)
        .reverse(),
    ).toEqual(rankVariable(stats).map((s) => s.tag));
  });

  it("wants both ends of a tag's range to hold more than one artist", () => {
    const stats = [
      qualifying("spanning", 2),
      // Wider, but its upper end is a single artist: one far-flung placement,
      // not a tag that genuinely reaches across the board — and reach is a gate
      // now, so no amount of spread rescues it.
      stat("oneFarPlacement", { count: 10, spread: 2.4, low: 1, high: 7, above: 1, below: 8 }),
      // Nothing at the upper end at all.
      stat("flat", { count: 10, spread: 2.4, low: 1, high: 7, above: 0, below: 4 }),
      // Genuinely spanning, but too few carriers for this list.
      stat("small", { count: 4, spread: 3, low: 1, high: 7, above: 2, below: 2 }),
    ];
    expect(rankVariable(stats).map((s) => s.tag)).toEqual(["spanning"]);
  });
});

describe("rankReliable", () => {
  it("ranks by tightest spread, better-evidenced tags first on ties", () => {
    const stats = [
      stat("loose", { count: 10, spread: 2, low: 1, high: 7, above: 5, below: 5 }),
      stat("tight", { count: 10, spread: 0.3, low: 4.5, high: 5.5 }),
      stat("tightToo", { count: 20, spread: 0.3, low: 4.5, high: 5.5 }), // twice the evidence
      stat("tiny", { count: 4, spread: 0 }), // perfectly tight, but too few carriers
    ];
    expect(rankReliable(stats).map((s) => s.tag)).toEqual(["tightToo", "tight", "loose"]);
    expect(rankReliable(stats, 1).map((s) => s.tag)).toEqual(["tightToo"]);
  });
});

describe("rankIsolation", () => {
  // A tight scene of six sharing a vocabulary, plus one artist sharing none of
  // it — the shape the "one of a kind" list exists to find.
  const sceneAndStranger = [
    ...cohort("scene", "B", 6, ["emo", "pop punk", "male vocals"]),
    artist("stranger", "C", ["jazz fusion", "virtuosic playing", "instrumental"]),
  ];

  it("counts the artists sharing at least half of each artist's tags", () => {
    const { core, distinctive } = rankIsolation(sceneAndStranger);
    // Each of the six scene artists has the other five for company…
    expect(core[0]!.kin).toBe(5);
    // …and nothing in the roster shares half of the stranger's tags.
    expect(distinctive[0]!.kin).toBe(0);
  });

  it("orders both ends by that count, the figure the dialog shows", () => {
    // A third group sits between the two: it shares two of the scene's three
    // tags, so it is kin to the scene but has fewer of its own.
    const { core } = rankIsolation([
      ...sceneAndStranger,
      ...cohort("fringe", "C", 2, ["emo", "pop punk", "screamed vocals"]),
    ]);
    const counts = core.map((artist) => artist.kin);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(core[0]!.name).toMatch(/^scene/);
  });

  it("puts the artist with the least company at the distinctive end", () => {
    const { core, distinctive } = rankIsolation(sceneAndStranger);
    expect(distinctive[0]!.name).toBe("stranger");
    expect(core[0]!.name).toMatch(/^scene/);
    expect(distinctive[0]!.kinship).toBeLessThan(core[0]!.kinship);
  });

  it("annotates each artist with its least-shared tag", () => {
    const { distinctive } = rankIsolation(sceneAndStranger);
    // Every one of the stranger's tags is unique to it; the tie breaks by name.
    expect(distinctive[0]!.rarestTag).toBe("instrumental");
  });

  it("weighs and explains an artist by its sound alone", () => {
    // This section borrows the ☁️ map's model, so it reads what the map reads:
    // genres and musical qualities. A decade belongs to its own section, and an
    // origin nobody else shares does not make an artist unusual to listen to —
    // neither may be the reason given for putting one on the lonely end.
    const { core, distinctive } = rankIsolation([
      ...cohort("scene", "B", 6, ["emo", "pop punk", "1990s"], ["emo", "pop punk"]),
      artist("crooner", "C", ["1950s", "Canadian", "traditional pop"], ["traditional pop"]),
    ]);
    for (const entry of [...core, ...distinctive]) {
      expect(entry.rarestTag).not.toBeNull();
      expect(isEraTag(entry.rarestTag!)).toBe(false);
      expect(entry.rarestTag).not.toBe("Canadian");
    }
    expect(distinctive[0]!.rarestTag).toBe("traditional pop");
  });

  it("counts kin by shared sound, not by shared origins", () => {
    // Six artists from one country: five are a scene, the sixth plays something
    // else entirely. Counting the country would give it five companions.
    const { distinctive } = rankIsolation([
      ...cohort("scene", "B", 5, ["emo", "pop punk", "Canadian"], ["emo", "pop punk"]),
      artist("odd one", "C", ["free jazz", "Canadian"], ["free jazz"]),
    ]);
    expect(distinctive[0]!.name).toBe("odd one");
    expect(distinctive[0]!.kin).toBe(0);
  });

  it("ranks both ends over the same artists, and excludes unranked ones", () => {
    const { core, distinctive } = rankIsolation([
      ...sceneAndStranger,
      artist("ghost", "unranked", ["emo", "pop punk"]),
    ]);
    expect([...core, ...distinctive].map((a) => a.name)).not.toContain("ghost");
  });

  it("reads the same ranking from both ends", () => {
    // Seven ranked artists over an explicit limit of six — stated here rather
    // than taken from ARTIST_LIST_LIMIT, so retuning that constant cannot
    // quietly make this case vacuous. The least typical artist is exactly the
    // one the core list has no room for.
    const { core, distinctive } = rankIsolation(sceneAndStranger, 6);
    expect(core).toHaveLength(6);
    expect(core.map((a) => a.name)).not.toContain("stranger");
    expect(distinctive[0]!.name).toBe("stranger");
  });

  it("has nothing to say about a roster with no company in it", () => {
    expect(rankIsolation([])).toEqual({ core: [], distinctive: [] });
    expect(rankIsolation([artist("only", "S", ["emo"])])).toEqual({ core: [], distinctive: [] });
  });
});

describe("measurePredictivePower", () => {
  it("reports a perfect correlation when the tags do decide the placement", () => {
    // Two tags, each on its own tier: knowing the tag tells you the tier.
    const power = measurePredictivePower([
      ...cohort("top", "S", 4, ["loud"]),
      ...cohort("low", "E", 4, ["quiet"]),
    ])!;
    expect(power.judged).toBe(8);
    expect(power.correlation).toBeCloseTo(1, 6);
    expect(power.explained).toBeCloseTo(1, 6);
  });

  it("reports nothing to correlate when every artist shares one tag", () => {
    // One tag on everyone predicts the same value for everyone, so there is no
    // variation to correlate — a null result, not a zero one.
    expect(measurePredictivePower(cohort("a", "C", 6, ["everywhere"]))).toBeNull();
    expect(measurePredictivePower([])).toBeNull();
  });

  it("judges only artists carrying a supported tag", () => {
    const power = measurePredictivePower([
      ...cohort("top", "S", 4, ["loud"]),
      ...cohort("low", "E", 4, ["quiet"]),
      artist("untagged", "B", []),
      artist("rare", "B", ["one-off"]),
      artist("ghost", "unranked", ["loud"]),
    ])!;
    expect(power.judged).toBe(8);
  });

  it("finds almost no link on the real roster", () => {
    // The finding two removed sections existed to dress up: what a tag says and
    // where an artist sits are very nearly independent here. If a data change
    // ever makes the tags genuinely predictive, this test should fail loudly and
    // be reconsidered rather than relaxed.
    const power = measurePredictivePower(roster)!;
    expect(power.judged).toBeGreaterThan(200);
    expect(power.explained).toBeLessThan(0.1);
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
    expect(stats.lifts).toEqual([]);
    expect(stats.favouriteTraits).toEqual([]);
    expect(stats.composition).toEqual([]);
    expect(stats.variable).toEqual([]);
    expect(stats.reliable).toEqual([]);
    expect(stats.prediction).toBeNull();
    expect(stats.isolation.core).toEqual([]);
    expect(stats.isolation.distinctive).toEqual([]);
    expect(stats.summary.favouriteCount).toBe(0);
  });

  it("summarises the roster's shape, including the ranks nobody occupies", () => {
    const stats = computeStats([
      ...cohort("s", "S", 2, ["emo"]),
      ...cohort("c", "C", 6, ["emo", "2000s"]),
      artist("waiting", "unranked", ["emo"]),
    ]);
    expect(stats.summary.artistCount).toBe(9);
    expect(stats.summary.rankedCount).toBe(8);
    expect(stats.summary.vocabularySize).toBe(2);
    // Every rank appears, so the histogram shows the whole board's shape.
    expect(stats.summary.tierCounts.map((t) => t.tier)).toEqual([...BASE_TIERS]);
    expect(stats.summary.tierCounts.find((t) => t.tier === "S")!.count).toBe(2);
    expect(stats.summary.tierCounts.find((t) => t.tier === "F")!.count).toBe(0);
    expect(stats.summary.favouriteTiers).toEqual(["S"]); // 2 of 8 clears the quarter
    // The gauges span the occupied tiers only: C (4) up to S (7).
    expect(stats.positions).toEqual({ low: 4, high: 7 });
  });

  it("folds a rank's variants into its histogram bar and its favourite boundary", () => {
    // The rows are separate on the board and separate to every continuous
    // statistic, but the histogram and the favourite boundary count whole ranks.
    const stats = computeStats([
      ...cohort("splus", "S+", 1, ["emo"]),
      ...cohort("s", "S", 1, ["emo"]),
      ...cohort("c", "C-", 6, ["emo", "2000s"]),
    ]);
    expect(stats.summary.tierCounts.map((t) => t.tier)).toEqual([...BASE_TIERS]);
    expect(stats.summary.tierCounts.find((t) => t.tier === "S")!.count).toBe(2);
    expect(stats.summary.tierCounts.find((t) => t.tier === "C")!.count).toBe(6);
    expect(stats.summary.favouriteTiers).toEqual(["S"]);
    expect(stats.summary.favouriteCount).toBe(2); // the S+ artist counts as an S
    // The positions, by contrast, do resolve the rows: S+ (7⅓) down to C- (3⅔).
    expect(stats.positions.high).toBeCloseTo(22 / 3);
    expect(stats.positions.low).toBeCloseTo(11 / 3);
  });

  it("gives era tags their own chronological section and keeps them out of the rest", () => {
    // Three qualifying tags: two eras (the newer rated highest of all, the
    // older lowest) and one genre in between, itself above the roster average
    // so that it does qualify as a signature and the eras' absence is the only
    // thing under test.
    const stats = computeStats([
      ...cohort("n", "S", 3, ["2020s"]),
      ...cohort("g", "A", 3, ["emo"]),
      ...cohort("o", "E", 3, ["1960s"]),
    ]);
    // Oldest decade first, regardless of rating.
    expect(stats.eras.map((s) => s.tag)).toEqual(["1960s", "2020s"]);
    expect(stats.tagCount).toBe(3); // eras still count toward the total
    // Despite being the extremes, the eras reach no other list. On a roster
    // this small nothing clears the significance gate either, so the ranked
    // lists are empty for that reason as well — hence checking the partition
    // itself rather than what came through it.
    expect(stats.eras.every((s) => isEraTag(s.tag))).toBe(true);
    expect(stats.evidence.tested).toBe(1); // "emo" alone; the eras stand apart
    for (const list of [stats.lifts, stats.favouriteTraits, stats.variable, stats.reliable]) {
      expect(list.some((s) => isEraTag(s.tag))).toBe(false);
    }
    expect(stats.composition.some((s) => s.category === "Eras")).toBe(false);
  });

  // Invariant checks over the real shipped roster, so a data change that
  // produces degenerate statistics is caught in CI.
  describe("on the real roster", () => {
    const stats = computeStats(roster);
    const tagLists = [
      stats.lifts,
      stats.favouriteTraits,
      stats.eras,
      stats.variable,
      stats.reliable,
    ];

    it("finds plenty of ranked artists and supported tags", () => {
      expect(stats.rankedCount).toBeGreaterThan(0);
      expect(stats.tagCount).toBeGreaterThan(0);
      expect(stats.summary.favouriteCount).toBeGreaterThan(0);
      // The sections that describe the collection rather than infer from it are
      // always populated; the inferential ones are gated on beating chance and
      // may legitimately be empty (see below).
      expect(stats.isolation.core.length).toBeGreaterThan(0);
      expect(stats.isolation.distinctive.length).toBeGreaterThan(0);
      expect(stats.eras.length).toBeGreaterThan(0);
      expect(stats.evidence.tested).toBeGreaterThan(50);
    });

    it("gates the lists that infer, and only those", () => {
      // A list claiming a tag says something about the ranking may never
      // contain a tag that failed the test — that is the contract of the gate.
      for (const list of [stats.lifts, stats.favouriteTraits]) {
        for (const entry of list) expect(entry.elevationIsReal).toBe(true);
      }
      for (const list of [stats.reliable, stats.variable]) {
        for (const entry of list) expect(entry.clusteringIsReal).toBe(true);
      }
      // …and is empty exactly when nothing cleared it.
      if (stats.evidence.elevated === 0) {
        expect(stats.lifts).toEqual([]);
        expect(stats.favouriteTraits).toEqual([]);
      }
      if (stats.evidence.clustered === 0) {
        expect(stats.reliable).toEqual([]);
        expect(stats.variable).toEqual([]);
      }
    });

    it("never gates the lists that only describe", () => {
      // The counterpart, and the more easily lost half: what the collection is
      // made of is a fact, with no hypothesis to reject. On this roster no tag
      // clears the gate at all, so a composition list that survives is proof it
      // was never subject to it.
      expect(stats.evidence.elevated).toBe(0);
      expect(stats.composition.length).toBeGreaterThan(0);
      expect(stats.composition.flatMap((c) => c.stats).length).toBeGreaterThan(0);
      expect(stats.worlds.worlds.length).toBeGreaterThan(0);
      expect(stats.isolation.core.length).toBeGreaterThan(0);
      expect(stats.eras.length).toBeGreaterThan(0);
    });

    it("finds no tag preference that survives correction, on this roster", () => {
      // Documenting the finding, not asserting it must stay true: 127 tags with
      // ~9 clearing p<0.05 individually is what 127 coin flips would give. If a
      // data change ever produces real preferences this fails, and the right
      // response is to update the expectation — the dialog handles both.
      expect(stats.evidence.elevated).toBe(0);
      expect(stats.evidence.clustered).toBe(0);
    });

    it("keeps every statistic in its meaningful range", () => {
      for (const tagStat of tagLists.flat()) {
        expect(tagStat.prevalence).toBeGreaterThan(0);
        expect(tagStat.prevalence).toBeLessThanOrEqual(1);
        expect(tagStat.ratio).toBeGreaterThan(0);
        expect(tagStat.favouriteRate).toBeGreaterThanOrEqual(0);
        expect(tagStat.favouriteRate).toBeLessThanOrEqual(1);
        expect(tagStat.low).toBeGreaterThanOrEqual(1);
        expect(tagStat.low).toBeLessThanOrEqual(tagStat.mean);
        expect(tagStat.mean).toBeLessThanOrEqual(tagStat.high);
        expect(tagStat.high).toBeLessThanOrEqual(TOP_POSITION);
        expect(tagStat.count).toBeGreaterThanOrEqual(MIN_SUPPORT);
      }
      // The composition counts stated tags, so they carry no tier-derived
      // fields to range-check — only that a share is a share.
      for (const count of stats.composition.flatMap((c) => c.stats)) {
        expect(count.prevalence).toBeGreaterThan(0);
        expect(count.prevalence).toBeLessThanOrEqual(1);
        expect(count.count).toBeGreaterThanOrEqual(MIN_SUPPORT);
      }
      for (const artistStat of [...stats.isolation.core, ...stats.isolation.distinctive]) {
        expect(artistStat.kinship).toBeGreaterThanOrEqual(0);
        expect(artistStat.kinship).toBeLessThanOrEqual(1);
        expect(artistStat.kin).toBeGreaterThanOrEqual(0);
        expect(artistStat.kin).toBeLessThan(stats.rankedCount);
        expect(artistStat.rarestTag).not.toBeNull();
      }
      // The two ends must actually separate, or the section says nothing.
      expect(stats.isolation.core[0]!.kin).toBeGreaterThan(
        stats.isolation.distinctive[0]!.kin * 10,
      );
    });

    it("keeps every list within its limit", () => {
      expect(stats.lifts.length).toBeLessThanOrEqual(TAG_LIST_LIMIT);
      expect(stats.favouriteTraits.length).toBeLessThanOrEqual(TAG_LIST_LIMIT);
      expect(stats.variable.length).toBeLessThanOrEqual(PREDICTOR_LIST_LIMIT);
      expect(stats.reliable.length).toBeLessThanOrEqual(PREDICTOR_LIST_LIMIT);
      expect(stats.isolation.core.length).toBeLessThanOrEqual(ARTIST_LIST_LIMIT);
      expect(stats.isolation.distinctive.length).toBeLessThanOrEqual(ARTIST_LIST_LIMIT);
    });

    it("never lets a barely-supported tag top a headline list", () => {
      // The regression this rework exists to prevent: three-artist tags owning
      // the favourites list while a whole scene went unmentioned. The
      // significance gate now removes them at source, so the check is that any
      // survivor is well-evidenced rather than that a survivor exists.
      for (const list of [stats.lifts, stats.favouriteTraits]) {
        for (const entry of list) expect(entry.count).toBeGreaterThan(MIN_SUPPORT);
      }
    });

    it("confines era tags to the chronological era section", () => {
      expect(stats.eras.length).toBeGreaterThan(0);
      expect(stats.eras.every((s) => isEraTag(s.tag))).toBe(true);
      const chronological = [...stats.eras.map((s) => s.tag)].sort();
      expect(stats.eras.map((s) => s.tag)).toEqual(chronological);
      const elsewhere = [
        stats.lifts,
        stats.favouriteTraits,
        stats.variable,
        stats.reliable,
        stats.composition.flatMap((c) => c.stats),
      ].flat();
      expect(elsewhere.some((s) => isEraTag(s.tag))).toBe(false);
    });

    it("spans only the tiers the board actually occupies", () => {
      // F has been empty since the F-tier artists were removed; the gauges must
      // not reserve a sixth of every track for it.
      const occupied = TIERS.filter((tier) =>
        roster.some((candidate) => candidate.baselineSlot === tier),
      );
      expect(stats.positions.low).toBe(tierPosition(occupied[occupied.length - 1]!));
      expect(stats.positions.high).toBe(tierPosition(occupied[0]!));
      expect(positionFraction(stats.positions.low, stats.positions)).toBe(0);
      expect(positionFraction(stats.positions.high, stats.positions)).toBe(1);
    });

    it("keeps each variable tag genuinely two-camped, widest first", () => {
      for (const tagStat of stats.variable) {
        expect(tagStat.count).toBeGreaterThanOrEqual(SPREAD_MIN_SUPPORT);
        expect(tagStat.above).toBeGreaterThanOrEqual(MIN_CAMP_SIZE);
        expect(tagStat.below).toBeGreaterThanOrEqual(MIN_CAMP_SIZE);
      }
      // Both predictor lists must be ordered by the ± they display, in opposite
      // directions — that is the whole point of them being mirrors.
      const spreads = stats.variable.map((s) => s.spread);
      expect([...spreads].sort((a, b) => b - a)).toEqual(spreads);
    });

    it("ranks the reliable tags tightest-first, over the same floor", () => {
      const spreads = stats.reliable.map((s) => s.spread);
      expect([...spreads].sort((a, b) => a - b)).toEqual(spreads);
      for (const tagStat of stats.reliable) {
        expect(tagStat.count).toBeGreaterThanOrEqual(SPREAD_MIN_SUPPORT);
      }
    });
  });
});
