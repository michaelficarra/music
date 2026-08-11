// Aggregation for the 📊 statistics dialog: what the tier list says about the
// tags, and what the tags would predict about the ratings. Pure logic, no DOM
// (unit tested in stats.test.ts); stats-view.ts renders the result.
//
// Everything here is a pure function of the build-embedded roster — each
// artist's baselineSlot, i.e. the arrangement shipped in data/artists.csv — so
// the statistics follow the data automatically on every rebuild and never need
// hand-curating. Unranked artists are invisible to every statistic.
//
// The roster is a list of artists the user *likes*: S means "favourite", the
// bottom tier means "still good, just not as good". Nothing here may treat a
// low placement as a negative verdict.
//
// The statistics divide sharply in two, and the division is the design:
//
//   * **Descriptive** — what the collection is made of. Counted by plain
//     prevalence, unweighted by tier, because on a list of music the user likes
//     an artist's presence is already the positive signal: having collected 36
//     pop punk artists is the preference, and where those 36 sit is a
//     second-order refinement among things already liked. These make no claim
//     that needs testing and are always shown.
//   * **Inferential** — claims that a tag says something about the *ranking*.
//     Measured against the user's own baseline (TagStat.ratio, where 1.00 is a
//     typical artist and below 1.00 reads as "typical of your taste", never as
//     "bad"), and every one of them must first beat chance (markSignificant).
//     A section with nothing that clears the bar is omitted entirely.
//
// Prevalence cannot separate "the user likes this" from "this is common in
// music at large" — there is no outside population to compare against — so it
// is reported as a fact about the collection and never as a discovered
// preference. See PRD §10.2.
//
// Two tier valuations coexist on purpose, answering different questions:
//   * TIER_WEIGHT (types.ts) — how much an artist *counts*, shared with the 🎲
//     picker. Feeds the inferential half only. It is the square of the position,
//     which relates the two scales without making either redundant.
//   * tierPosition (types.ts) — where an artist *sits*. Used only for statements
//     about placement: the predictor range gauges and the predictive-power measure.

import { groupRoster, pairwiseSimilarities } from "./cloud-layout";
import { compareArtistNames } from "./sort";
import { groupTags, isEraTag } from "./tag-groups";
import { TIERS, TIER_WEIGHT, UNRANKED, tierPosition, type Artist, type Tier } from "./types";

// --- Tuning (judgement calls, see ARCHITECTURE §8) ---

/** Ranked carriers a tag needs before any statistic will mention it — with
    fewer, one or two placements would masquerade as a trend. */
export const MIN_SUPPORT = 3;
/** Entries in each of the tag lists (lifts, favourite traits). */
export const TAG_LIST_LIMIT = 10;
/** Tags shown per vocabulary category in the composition breakdown. */
export const COMPOSITION_PER_CATEGORY = 5;
/** Entries in each of the reliable / variable predictor lists. */
export const PREDICTOR_LIST_LIMIT = 6;
/** Carriers a tag needs before the spread-based lists (reliable and variable
    predictors) will consider it. Spread estimates are noisier than averages,
    so these lists demand more evidence than MIN_SUPPORT provides. */
export const SPREAD_MIN_SUPPORT = 5;
/** Artists each end of a tag's range needs before it counts as genuinely
    spanning the board. At 1, a single far-flung placement would qualify a tag
    whose other carriers all sit together. */
export const MIN_CAMP_SIZE = 2;
/** Entries in each of the two isolation lists (core sound, one of a kind). */
export const ARTIST_LIST_LIMIT = 10;
/**
 * Strength of the prior pulling every tag's ratio towards the roster average,
 * in artists: a tag with this many carriers earns half the elevation its raw
 * average claims. Without it the "most loved" lists are pure small-sample
 * noise — three artists who happen to sit high outrank a scene of thirty-six.
 */
export const PRIOR_STRENGTH = 10;
/**
 * Neighbours averaged when measuring how isolated an artist is. The single
 * nearest neighbour is too brittle — one close cousin makes an otherwise
 * unique artist look ordinary — so take the mean of the closest few.
 */
export const ISOLATION_NEIGHBOURS = 3;
/**
 * How much of an artist's tag list another artist must share to count as kin.
 * A fraction rather than a fixed number of tags, since tag counts vary widely
 * from artist to artist (ARCHITECTURE §3 sets no bound) and a flat threshold
 * would make the sparsely-tagged look lonely for no reason but their sparseness.
 */
export const KIN_SHARE = 0.5;
/**
 * The favourite tiers are the top tiers holding at least this share of the
 * ranked roster. Derived rather than hard-coded, so a reshuffle that promotes
 * or demotes a whole tier's worth of artists moves the boundary with it.
 */
export const FAVOURITE_SHARE = 0.25;
/**
 * Shuffles used to work out what a tag's figures would look like by chance.
 *
 * The floor matters: with S shuffles the smallest p-value observable is
 * 1/(S+1), and the correction below asks the strongest tag to clear
 * FALSE_DISCOVERY_RATE / (number of tags) — 0.00023 over the 217 tags that
 * counting derived tags puts past MIN_SUPPORT. Too few shuffles and nothing can
 * pass however real it is, which would look like a finding rather than the
 * measurement artefact it is. Twenty thousand keeps the smallest observable p
 * (0.00005) clear of that threshold by a factor of ~4.6; at the ten thousand
 * this ran while only own tags were counted, the switch to derived tags would
 * have left ~2.2. Re-check if the vocabulary grows much further — every tag's
 * `elevationP` carries what is needed to do it.
 */
export const NULL_SAMPLES = 20000;
/**
 * The share of surviving findings allowed to be flukes (Benjamini–Hochberg).
 *
 * A correction is not optional here. Every tag list picks the best of ~220
 * candidates, and over that many tries the best of *anything* looks striking:
 * 20 tags clear p < 0.05 uncorrected on this roster, where chance alone would
 * produce 217 × 0.05 ≈ 11. Controlling the false-discovery rate is what makes
 * "this tag is a real preference" mean something.
 */
export const FALSE_DISCOVERY_RATE = 0.05;

/**
 * The tags a statistic counts: `specificTags` — everything the artist's row
 * implies, derived tags included, minus those too broad to describe anything
 * (ARCHITECTURE §3b).
 *
 * Derived tags are counted because whether a band is *written down* as pop punk
 * is an artefact of CSV hygiene rather than a fact about the music: rows carry
 * only their most specific tag (§3), so Paramore says `emo pop` and stops.
 * Enforcing that rule across the roster once moved `pop punk` from 39 carriers
 * to 30 without a single artist changing — the clearest possible sign that
 * counting stated tags measured the wrong thing.
 *
 * The broad ones are excluded because they are the mirror-image error. `rock`
 * covers four fifths of the roster and no row states it; leading a prevalence
 * list with it describes the vocabulary, and averaging it into a prediction
 * drags every artist towards the roster mean. They are dropped once, in
 * data.ts, so every statistic here — and the card tooltips — works from one
 * definition of what carrying a tag means. Only the 🎲 filter keeps them, since
 * finding artists is exactly what they are good for.
 *
 * The two sections that *are* the ☁️ map — `rankTasteWorlds` and `rankIsolation`
 * — narrow it once further, to `soundTags`. They report the map's own grouping,
 * so they must read what the map reads; every other statistic here is about the
 * tags themselves and counts regions, eras and aspects among them.
 */
const countedTags = (artist: Artist): readonly string[] => artist.specificTags;

// --- Placement: where an artist sits ---

/** A mean position expressed as the nearest tier plus a leaning: "A−" reads as
    "an A, leaning toward B". */
export interface TierBand {
  tier: Tier;
  suffix: "+" | "" | "−";
}

/**
 * Band a position onto the tier scale. Each tier owns the unit of the scale
 * centred on its own position, split into equal thirds: the middle third is the
 * bare letter, the outer thirds lean "+" (toward the better neighbour) and
 * "−" (toward the worse). So 7 → "S", 6.5 → "S−", 6.17 → "A+", 5.66 → "A−".
 * Positions are clamped to [1, 7] first, which also makes "S+" and "F−"
 * impossible — there is nothing beyond the ends to lean toward.
 */
export function tierBand(position: number): TierBand {
  const clamped = Math.min(Math.max(position, 1), TIERS.length);
  const nearest = Math.round(clamped);
  const lean = clamped - nearest;
  return {
    tier: TIERS[TIERS.length - nearest]!,
    suffix: lean > 1 / 6 ? "+" : lean < -1 / 6 ? "−" : "",
  };
}

/** tierBand as display text, e.g. "A−". */
export function tierLabel(position: number): string {
  const { tier, suffix } = tierBand(position);
  return tier + suffix;
}

/** The span of tier positions the roster actually occupies. */
export interface PositionRange {
  low: number;
  high: number;
}

/**
 * Where a position sits along the gauge track, 0 at the lowest occupied tier
 * and 1 at the highest. Deliberately *not* the theoretical 1..7 axis: with the
 * bottom tiers empty (F has held nobody since the F-tier artists were removed)
 * an absolute axis pins every marker into the same narrow band, which is what
 * drove the old view-level rescale hack. Deriving the ends from the data keeps
 * the track honest and widens automatically if the empty tiers refill.
 */
export function positionFraction(position: number, range: PositionRange): number {
  if (range.high <= range.low) return 1; // a single occupied tier: everything is "the top"
  const clamped = Math.min(Math.max(position, range.low), range.high);
  return (clamped - range.low) / (range.high - range.low);
}

// --- The ranked roster, and the baselines every statistic is measured against ---

/** One ranked artist reduced to what the statistics need. */
interface RankedArtist {
  name: string;
  tier: Tier;
  /** How much this artist counts (TIER_WEIGHT). */
  weight: number;
  /** Where this artist sits (tierPosition). */
  position: number;
  tags: readonly string[];
}

/** The roster-wide baselines: every "above/below average" claim is relative to
    these, never to an absolute idea of quality. */
interface Baseline {
  ranked: RankedArtist[];
  /** Σ weight over the ranked roster; the denominator of every share. */
  totalWeight: number;
  /** Mean weight of a ranked artist; the denominator of every ratio. */
  meanWeight: number;
  /** The top tiers making up FAVOURITE_SHARE of the roster. */
  favouriteTiers: Tier[];
  /** How many ranked artists sit in those tiers. */
  favouriteCount: number;
  /** favouriteCount / ranked.length — what an unremarkable tag would score. */
  favouriteRate: number;
  positions: PositionRange;
}

/**
 * The favourite tiers: take tiers from the top until they hold at least
 * FAVOURITE_SHARE of the ranked roster. Always at least one tier, so "your
 * favourites" is never an empty set on a non-empty roster.
 */
function favouriteTiers(ranked: readonly RankedArtist[]): Tier[] {
  const chosen: Tier[] = [];
  let covered = 0;
  for (const tier of TIERS) {
    const held = ranked.filter((artist) => artist.tier === tier).length;
    if (held === 0 && chosen.length === 0) continue; // skip empty tiers above the first occupied one
    chosen.push(tier);
    covered += held;
    if (covered >= FAVOURITE_SHARE * ranked.length) break;
  }
  return chosen;
}

function computeBaseline(artists: readonly Artist[]): Baseline {
  const ranked: RankedArtist[] = [];
  for (const artist of artists) {
    if (artist.baselineSlot === UNRANKED) continue;
    ranked.push({
      name: artist.name,
      tier: artist.baselineSlot,
      weight: TIER_WEIGHT[artist.baselineSlot],
      position: tierPosition(artist.baselineSlot),
      tags: countedTags(artist),
    });
  }
  const totalWeight = ranked.reduce((sum, artist) => sum + artist.weight, 0);
  const favourites = favouriteTiers(ranked);
  const favouriteSet = new Set(favourites);
  const favouriteCount = ranked.filter((artist) => favouriteSet.has(artist.tier)).length;
  const positionValues = ranked.map((artist) => artist.position);
  return {
    ranked,
    totalWeight,
    meanWeight: ranked.length === 0 ? 0 : totalWeight / ranked.length,
    favouriteTiers: favourites,
    favouriteCount,
    favouriteRate: ranked.length === 0 ? 0 : favouriteCount / ranked.length,
    positions: {
      low: ranked.length === 0 ? 1 : Math.min(...positionValues),
      high: ranked.length === 0 ? TIERS.length : Math.max(...positionValues),
    },
  };
}

/**
 * Shrink an observed average towards the roster's own average, in proportion
 * to how little evidence stands behind it (empirical Bayes with a prior worth
 * PRIOR_STRENGTH artists). This is what stops three well-placed artists from
 * outranking a whole scene.
 */
function shrink(total: number, count: number, prior: number): number {
  return (total + PRIOR_STRENGTH * prior) / (count + PRIOR_STRENGTH);
}

// --- Per-tag aggregates ---

/** One tag's aggregate over the ranked artists that carry it. */
export interface TagStat {
  tag: string;
  /** Ranked carriers (always ≥ MIN_SUPPORT). */
  count: number;
  /**
   * How much of the ranked roster carries this tag, 0..1 — a plain headcount,
   * deliberately unweighted by tier.
   *
   * This is the **descriptive** measure, and the one the dialog leads with. On a
   * list of music the user likes, an artist's presence is already the positive
   * signal; having collected 36 pop punk artists is the preference, and where
   * those 36 sit is a second-order refinement among things already liked. A
   * tier-weighted version of this was tried and dropped — it quietly re-imported
   * the assumption that a low placement means less.
   *
   * What it cannot do is separate "the user likes this" from "this is common in
   * music at large". A tag's frequency carries both, and nothing computable
   * from this roster alone can tell them apart — there is no outside population
   * to compare against. So prevalence is reported as a fact about the collection
   * and never as a discovered preference. See PRD §10.2.
   */
  prevalence: number;
  /** Mean TIER_WEIGHT of the carriers. Feeds `ratio` and the chance test; not
      displayed, since it is a claim about placement rather than a description. */
  meanWeight: number;
  /**
   * Affection ratio: the tag's shrunk mean weight over the roster's mean
   * weight. 1.00 is a typical artist in this list; 1.20 means carriers count a
   * fifth more than usual. Below 1.00 means "typical of your taste", *not*
   * "disliked" — everything here is liked.
   */
  ratio: number;
  /** Carriers sitting in the favourite tiers, and what share of the tag's
      carriers that is. */
  favourites: number;
  favouriteRate: number;
  /** favouriteRate over the roster's own favourite rate, shrunk: how much more
      concentrated at the top of the list this tag is than the list at large. */
  favouriteIndex: number;
  /** Mean tier position of those carriers. */
  mean: number;
  /** Population standard deviation of those positions — how much the carriers'
      placements disagree with each other. */
  spread: number;
  /** The lowest and highest positions among those carriers. */
  low: number;
  high: number;
  /** Carriers placed at least a full tier above / below the mean — the two
      ends of the range a variable (unpredictive) tag spans. */
  above: number;
  below: number;
  /**
   * Could chance alone have placed this tag's carriers this high (or this low)?
   * False until shuffling says otherwise, and corrected for the fact that every
   * list picks a winner out of the whole vocabulary. Sections that claim a tag
   * reveals a preference show only tags that clear it.
   */
  elevationIsReal: boolean;
  /** The same question asked of how tightly the carriers cluster — what the
      predictor lists rank by. */
  clusteringIsReal: boolean;
  /**
   * The uncorrected p behind `elevationIsReal`, kept so the correction can be
   * *re-measured* rather than remembered. The doctrine in CLAUDE.md rests on
   * concrete figures — how close the strongest tag gets, and whether the
   * Benjamini–Hochberg threshold is even reachable given NULL_SAMPLES — and
   * those go stale silently every time the roster is retagged. Nothing renders
   * it; `1` until markSignificant runs.
   */
  elevationP: number;
}

/**
 * Aggregate every sufficiently-supported tag over the ranked roster, in
 * canonical tag order. Unranked artists contribute nothing; tags carried by
 * fewer than MIN_SUPPORT ranked artists are dropped entirely.
 */
function aggregateTags(baseline: Baseline): TagStat[] {
  const carriersByTag = new Map<string, RankedArtist[]>();
  for (const artist of baseline.ranked) {
    for (const tag of artist.tags) {
      const carriers = carriersByTag.get(tag);
      if (carriers === undefined) carriersByTag.set(tag, [artist]);
      else carriers.push(artist);
    }
  }

  const favouriteSet = new Set(baseline.favouriteTiers);
  const stats: TagStat[] = [];
  for (const [tag, carriers] of carriersByTag) {
    if (carriers.length < MIN_SUPPORT) continue;
    const count = carriers.length;
    const weight = carriers.reduce((sum, artist) => sum + artist.weight, 0);
    const positions = carriers.map((artist) => artist.position);
    const mean = positions.reduce((sum, position) => sum + position, 0) / count;
    const variance = positions.reduce((sum, p) => sum + (p - mean) ** 2, 0) / count;
    const favourites = carriers.filter((artist) => favouriteSet.has(artist.tier)).length;
    const ratio =
      baseline.meanWeight === 0
        ? 0
        : shrink(weight, count, baseline.meanWeight) / baseline.meanWeight;
    stats.push({
      tag,
      count,
      prevalence: count / baseline.ranked.length,
      meanWeight: weight / count,
      ratio,
      favourites,
      favouriteRate: favourites / count,
      favouriteIndex:
        baseline.favouriteRate === 0
          ? 0
          : shrink(favourites, count, baseline.favouriteRate) / baseline.favouriteRate,
      mean,
      spread: Math.sqrt(variance),
      low: Math.min(...positions),
      high: Math.max(...positions),
      above: positions.filter((position) => position >= mean + 1).length,
      below: positions.filter((position) => position <= mean - 1).length,
      // Filled in below, once every tag's p-values can be corrected together.
      elevationIsReal: false,
      elevationP: 1,
      clusteringIsReal: false,
    });
  }

  markSignificant(baseline, stats);
  return stats.sort((a, b) => compareArtistNames(a.tag, b.tag));
}

// --- Telling a real preference from a lucky one ---

/**
 * A tag's figures are only worth showing if chance could not have produced
 * them. Both questions this asks — is a tag's average elevated, are its artists
 * unusually clustered — are settled the same way: shuffle the tier assignments
 * across the roster (leaving every artist's tags alone), and see how often a
 * group of that size lands somewhere as extreme by luck alone.
 *
 * Shuffling is used rather than a normal approximation because the weights are
 * badly skewed (an S counts 49, an E counts 4), so a handful of carriers has a
 * lumpy null distribution that a bell curve would misjudge exactly where it
 * matters — in the tail. A prefix of a shuffle *is* a uniform random subset, so
 * one pass down each shuffle yields the null for every carrier count at once.
 *
 * Deterministic: a fixed seed, so the dialog is still a pure function of the
 * roster and two builds never disagree.
 */
function nullDistributions(
  baseline: Baseline,
  counts: ReadonlySet<number>,
): Map<number, { weight: number[]; spread: number[] }> {
  const result = new Map<number, { weight: number[]; spread: number[] }>();
  for (const count of counts) result.set(count, { weight: [], spread: [] });
  if (baseline.ranked.length === 0) return result;

  const weights = baseline.ranked.map((artist) => artist.weight);
  const positions = baseline.ranked.map((artist) => artist.position);
  const size = weights.length;
  const order = weights.map((_, i) => i);
  const wanted = [...counts].sort((a, b) => a - b);

  let seed = 0x9e3779b9; // any fixed constant; only determinism matters
  const random = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let sample = 0; sample < NULL_SAMPLES; sample++) {
    // Fisher–Yates as far as the largest group we need.
    const deepest = wanted[wanted.length - 1]!;
    for (let i = 0; i < deepest; i++) {
      const j = i + Math.floor(random() * (size - i));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    let weightSum = 0;
    let positionSum = 0;
    let positionSquares = 0;
    let next = 0;
    for (let taken = 1; taken <= deepest; taken++) {
      const index = order[taken - 1]!;
      weightSum += weights[index]!;
      positionSum += positions[index]!;
      positionSquares += positions[index]! ** 2;
      if (taken === wanted[next]) {
        const mean = positionSum / taken;
        const bucket = result.get(taken)!;
        bucket.weight.push(weightSum / taken);
        bucket.spread.push(Math.sqrt(Math.max(positionSquares / taken - mean * mean, 0)));
        next += 1;
      }
    }
  }
  return result;
}

/** How often chance lands at least as far from `centre` as `observed` did. The
    +1s are the standard guard against reporting a p-value of exactly zero from
    a finite number of shuffles. */
function tailProbability(nulls: readonly number[], observed: number, centre: number): number {
  if (nulls.length === 0) return 1;
  const reach = Math.abs(observed - centre);
  let atLeastAsFar = 0;
  for (const value of nulls) if (Math.abs(value - centre) >= reach) atLeastAsFar += 1;
  return (1 + atLeastAsFar) / (1 + nulls.length);
}

/**
 * Benjamini–Hochberg: given every tag's p-value, the largest p that still keeps
 * the expected share of flukes among the survivors under FALSE_DISCOVERY_RATE.
 * Returns 0 when nothing qualifies, which correctly passes nothing.
 *
 * Chosen over Bonferroni because these lists are exploratory — the cost of one
 * fluke among a handful of findings is small, and Bonferroni over 130 tags
 * would demand near-certainty of every entry and empty the dialog on principle
 * rather than on evidence.
 */
function falseDiscoveryCutoff(pValues: readonly number[]): number {
  const sorted = [...pValues].sort((a, b) => a - b);
  let cutoff = 0;
  for (let rank = 1; rank <= sorted.length; rank++) {
    if (sorted[rank - 1]! <= (rank / sorted.length) * FALSE_DISCOVERY_RATE) {
      cutoff = sorted[rank - 1]!;
    }
  }
  return cutoff;
}

/**
 * Decide, for every tag at once, whether its elevation and its clustering could
 * have come from chance — and set the flags on the stats in place.
 *
 * The correction has to see the whole vocabulary together, which is why this
 * runs as a second pass rather than per tag: a p-value of 0.02 is impressive on
 * its own and unremarkable as the best of a hundred and thirty tries.
 */
function markSignificant(baseline: Baseline, stats: TagStat[]): void {
  if (stats.length === 0 || baseline.ranked.length === 0) return;
  // Too-broad tags never reach here — aggregateTags drops them — so every tag
  // tested is one that could genuinely have landed in a tail, and the
  // Benjamini–Hochberg cutoff below is not diluted by tags that could not.
  const nulls = nullDistributions(baseline, new Set(stats.map((stat) => stat.count)));

  // The roster-wide values each tag is measured against.
  const positions = baseline.ranked.map((artist) => artist.position);
  const meanPosition = positions.reduce((sum, p) => sum + p, 0) / positions.length;
  const rosterSpread = Math.sqrt(
    positions.reduce((sum, p) => sum + (p - meanPosition) ** 2, 0) / positions.length,
  );

  const elevation = stats.map((stat) =>
    // The raw mean carrier weight, not the shrunk ratio: shrinkage is a display
    // choice, and the null must be asked about what was measured.
    tailProbability(nulls.get(stat.count)!.weight, stat.meanWeight, baseline.meanWeight),
  );
  const clustering = stats.map((stat) =>
    tailProbability(nulls.get(stat.count)!.spread, stat.spread, rosterSpread),
  );

  const elevationCutoff = falseDiscoveryCutoff(elevation);
  const clusteringCutoff = falseDiscoveryCutoff(clustering);
  stats.forEach((stat, i) => {
    stat.elevationP = elevation[i]!;
    stat.elevationIsReal = elevation[i]! <= elevationCutoff;
    stat.clusteringIsReal = clustering[i]! <= clusteringCutoff;
  });
}

/** computeTagStats over a raw roster — the shape the tests exercise directly. */
export function computeTagStats(artists: readonly Artist[]): TagStat[] {
  return aggregateTags(computeBaseline(artists));
}

// --- Ranked tag lists ---

/** Total order by `metric` descending; ties go to the better-supported tag,
    then canonical name, so every list is deterministic. */
function byMetricDesc(metric: (stat: TagStat) => number) {
  return (a: TagStat, b: TagStat): number =>
    metric(b) - metric(a) || b.count - a.count || compareArtistNames(a.tag, b.tag);
}

/** The tags whose carriers count for most per artist: what lifts an artist up
    the board. Shrunk, so a scene of thirty-six beats a trio of three. */
export function rankByRatio(stats: readonly TagStat[], limit = TAG_LIST_LIMIT): TagStat[] {
  return stats
    .filter((stat) => stat.elevationIsReal)
    .sort(byMetricDesc((stat) => stat.ratio))
    .slice(0, limit);
}

/** The tags most concentrated in the favourite tiers relative to the roster at
    large — what the very top of the list has in common. A rate needs more
    evidence than an average does (a three-carrier tag can only ever read 0%,
    33%, 67% or 100%), so this list applies the higher SPREAD_MIN_SUPPORT floor
    rather than MIN_SUPPORT. */
export function rankByFavouriteIndex(stats: readonly TagStat[], limit = TAG_LIST_LIMIT): TagStat[] {
  return stats
    .filter((stat) => stat.count >= SPREAD_MIN_SUPPORT && stat.elevationIsReal)
    .sort(byMetricDesc((stat) => stat.favouriteIndex))
    .slice(0, limit);
}

/**
 * The tags that least predict their carriers' placements — the widest spread
 * first, so this list is the exact mirror of rankReliable below and both are
 * ordered by the one number they display.
 *
 * Reach is a gate rather than part of the score: a tag qualifies only when
 * **both** ends of its range — carriers a full tier above and a full tier below
 * its own mean — hold at least MIN_CAMP_SIZE artists, so a single far-flung
 * placement cannot stand in for a tag that genuinely spans the board. Folding
 * that into the ranking instead (spread × the smaller end's share, as this once
 * did) produced an order that no displayed column moved with, which read as no
 * order at all.
 *
 * Note for the copy: these ends are positions within *the tag's own* range. On
 * a roster of music the user likes, an artist at the lower end is not a
 * dissenter and the tag has not divided anyone — the trait simply is not what
 * decides the placement.
 */
export function rankVariable(stats: readonly TagStat[], limit = PREDICTOR_LIST_LIMIT): TagStat[] {
  return stats
    .filter(
      (stat) =>
        stat.count >= SPREAD_MIN_SUPPORT &&
        Math.min(stat.above, stat.below) >= MIN_CAMP_SIZE &&
        stat.clusteringIsReal,
    )
    .sort(byMetricDesc((stat) => stat.spread))
    .slice(0, limit);
}

/** The mirror — the tags that best predict a placement: their carriers
    cluster most tightly around the mean (smallest spread, ties to the
    better-evidenced tag, then name), so carrying the tag all but pins an
    artist's tier. */
export function rankReliable(stats: readonly TagStat[], limit = PREDICTOR_LIST_LIMIT): TagStat[] {
  return stats
    .filter((stat) => stat.count >= SPREAD_MIN_SUPPORT && stat.clusteringIsReal)
    .sort((a, b) => a.spread - b.spread || b.count - a.count || compareArtistNames(a.tag, b.tag))
    .slice(0, limit);
}

// --- What the collection is made of ---

/**
 * A tag and how much of the ranked roster states it.
 *
 * Deliberately not a `TagStat`: the composition list is descriptive, so the
 * tier-derived fields would be not merely unused but misleading to have to
 * hand — and it counts a different set of tags (see `categoryComposition`), so
 * a `TagStat` for `male vocals` does not exist to be reused.
 */
export interface TagCount {
  tag: string;
  /** Ranked artists whose own row names this tag (always ≥ MIN_SUPPORT). */
  count: number;
  /** Those artists as a fraction of the ranked roster. */
  prevalence: number;
}

export interface CategoryComposition {
  /** A tag-groups.ts label, e.g. "Genres". */
  category: string;
  /** The category's most-stated tags, most-carried first. */
  stats: TagCount[];
}

/**
 * The most common tags in each vocabulary category, by plain prevalence.
 *
 * **Ungated, and no significance test applies.** This is a description of what
 * the user assembled, not a claim about their ranking: "15% of your list is pop
 * punk" is a fact in the same class as "you have 239 artists", with no
 * hypothesis to reject. An earlier version ranked by a tier-derived surplus and
 * required it to beat chance, which was a category error twice over — it made a
 * descriptive count inferential, and it measured preference by tier position,
 * the very assumption this whole module exists to avoid.
 *
 * Broken down **per category** because one flat list is not useful here: the
 * vocal-style and production tags are so much more widespread than any genre
 * that they would fill it entirely, burying the question "what genres is this
 * collection made of" under the answer to a different one.
 *
 * **This is the one statistic that counts `ownTags`** — the tags actually
 * written on each row — rather than `countedTags`, and it applies no breadth
 * rule (§3b). It is an inventory of the descriptions used, and a description
 * nobody wrote is not part of it. Both of the alternatives fail here, in
 * opposite directions and for the same underlying reason:
 *
 *  - Counting **derived** tags leads every category with tags the vocabulary
 *    supplied rather than the collection earned: `rock`, then `pop`.
 *  - Counting derived tags **minus the too-broad ones** removes those but
 *    promotes the next rank of the same thing — `California`, `Western
 *    European`, `New York State`, the registry's connective tissue between a
 *    city and its country, which no row states and which describes an artist no
 *    better than the `American` just removed.
 *
 * Reading the rows directly settles it without a threshold to tune: nobody is
 * described as `rock` or as `California`, so neither can appear, while
 * `pop punk` and `male vocals` are counted exactly as often as they were
 * claimed. The cost is that a scene split across sub-genres is reported split —
 * `emo pop` and `pop punk` are separate rows rather than one — which is the
 * honest answer to "what is your list made of" even where it is not the answer
 * to "how much of it is pop punk". The ☁️ map's scenes (§8.3) answer that one.
 *
 * Era tags are excluded, having a section of their own. "Other" (tags the
 * vocabulary doesn't know) is skipped, and so are categories with no
 * sufficiently-supported tags.
 */
export function categoryComposition(
  artists: readonly Artist[],
  limit = COMPOSITION_PER_CATEGORY,
): CategoryComposition[] {
  const ranked = artists.filter((artist) => artist.baselineSlot !== UNRANKED);
  if (ranked.length === 0) return [];

  const carriers = new Map<string, number>();
  for (const artist of ranked) {
    for (const tag of new Set(artist.ownTags)) {
      if (isEraTag(tag)) continue;
      carriers.set(tag, (carriers.get(tag) ?? 0) + 1);
    }
  }
  const countByTag = new Map<string, TagCount>();
  for (const [tag, count] of carriers) {
    if (count < MIN_SUPPORT) continue;
    countByTag.set(tag, { tag, count, prevalence: count / ranked.length });
  }

  const result: CategoryComposition[] = [];
  for (const group of groupTags([...countByTag.keys()])) {
    if (group.label === "Other") continue;
    const most = group.tags
      .map((tag) => countByTag.get(tag)!)
      .sort((a, b) => b.prevalence - a.prevalence || compareArtistNames(a.tag, b.tag))
      .slice(0, limit);
    if (most.length > 0) result.push({ category: group.label, stats: most });
  }
  return result;
}

// --- The worlds the collection splits into ---

/** One family of related scenes, sized against the roster. */
export interface TasteWorld {
  /** The genre scenes it gathers, largest first. */
  scenes: string[];
  /** Ranked artists across those scenes. */
  count: number;
  /** Those artists as a fraction of the ranked roster. */
  prevalence: number;
}

export interface TasteWorlds {
  worlds: TasteWorld[];
  /** Artists no scene claimed — a corner of the collection, not a failure. */
  loners: number;
}

/**
 * The handful of broad worlds the collection divides into, above the level of
 * any single tag: genre scenes, agglomerated into families of related sound.
 *
 * Delegated wholesale to `groupRoster` (cloud-layout.ts) so these are the *same*
 * neighbourhoods the ☁️ map draws — grouped, as the map is, on `soundTags`
 * alone. Two features describing the shape of one collection must not disagree
 * about what that shape is, and a second clustering invented here would
 * eventually drift from the one the user can see.
 *
 * Purely descriptive, like `categoryComposition`: which artists group together
 * is a fact about their tags, with the tiers playing no part, so there is
 * nothing here for the significance gate to weigh.
 */
export function rankTasteWorlds(artists: readonly Artist[]): TasteWorlds {
  const ranked = artists.filter((artist) => artist.baselineSlot !== UNRANKED);
  if (ranked.length === 0) return { worlds: [], loners: 0 };
  const { groups, loners } = groupRoster(ranked);
  return {
    worlds: groups.map((group) => ({
      scenes: group.scenes.map((scene) => scene.tag),
      count: group.members.length,
      prevalence: group.members.length / ranked.length,
    })),
    loners: loners.length,
  };
}

// --- How far the tags go ---

/** How much of a placement the tag vocabulary actually accounts for. */
export interface PredictivePower {
  /** Ranked artists the model could judge (those carrying a supported tag). */
  judged: number;
  /** Pearson correlation between the leave-one-out prediction and the real
      placement, over those artists. */
  correlation: number;
  /** correlation² — the share of placement the tags account for, 0..1. */
  explained: number;
}

/**
 * Measure the tags against the tiers: predict every artist's placement from its
 * tags alone, then correlate those predictions with where the artists really
 * sit.
 *
 * A prediction is the mean of the artist's qualifying tags' **leave-one-out**
 * means — each tag's mean recomputed without the artist itself, so its own
 * placement cannot vote for itself (qualification is MIN_SUPPORT, leaving at
 * least two other placements per tag; era tags never qualify, as they describe
 * when rather than what).
 *
 * This exists because the honest answer on a roster like this is **very
 * little**, and that is worth saying outright. Two sections used to rank artists
 * by their distance from this prediction; both turned out to be listing the top
 * and bottom tiers, because averaging nine tag means regresses so hard to the
 * roster mean that the prediction is nearly constant, leaving
 * (position − prediction) a straight restatement of the tier. Reporting how weak
 * the link is says more than either list did.
 */
export function measurePredictivePower(artists: readonly Artist[]): PredictivePower | null {
  const baseline = computeBaseline(artists);
  // Per-tag position totals over the ranked roster, for the leave-one-out means.
  const totals = new Map<string, { sum: number; count: number }>();
  // baseline.ranked already carries the counted tags (computeBaseline), so the
  // too-broad ones are gone: a tag four fifths of the roster carries has a
  // leave-one-out mean of very nearly the roster mean, and averaging it into
  // every prediction flattens the model rather than informing it.
  for (const artist of baseline.ranked) {
    for (const tag of artist.tags) {
      if (isEraTag(tag)) continue;
      const total = totals.get(tag) ?? { sum: 0, count: 0 };
      total.sum += artist.position;
      total.count += 1;
      totals.set(tag, total);
    }
  }

  const pairs: { predicted: number; actual: number }[] = [];
  for (const artist of baseline.ranked) {
    const means = artist.tags.flatMap((tag) => {
      const total = totals.get(tag);
      return total !== undefined && total.count >= MIN_SUPPORT
        ? [(total.sum - artist.position) / (total.count - 1)]
        : [];
    });
    if (means.length === 0) continue;
    pairs.push({
      predicted: means.reduce((sum, mean) => sum + mean, 0) / means.length,
      actual: artist.position,
    });
  }
  if (pairs.length < 2) return null;

  const meanPredicted = pairs.reduce((sum, p) => sum + p.predicted, 0) / pairs.length;
  const meanActual = pairs.reduce((sum, p) => sum + p.actual, 0) / pairs.length;
  let covariance = 0;
  let variancePredicted = 0;
  let varianceActual = 0;
  for (const pair of pairs) {
    const dp = pair.predicted - meanPredicted;
    const da = pair.actual - meanActual;
    covariance += dp * da;
    variancePredicted += dp * dp;
    varianceActual += da * da;
  }
  // A roster where every prediction (or every placement) is identical has no
  // correlation to report rather than an undefined one.
  if (variancePredicted <= 0 || varianceActual <= 0) return null;
  const correlation = covariance / Math.sqrt(variancePredicted * varianceActual);
  return { judged: pairs.length, correlation, explained: correlation ** 2 };
}

// --- How typical an artist is of the roster ---

/** An artist and how much company it keeps in the roster. */
export interface ArtistIsolation {
  name: string;
  tier: Tier;
  /**
   * How many other ranked artists carry at least KIN_SHARE of this artist's
   * tags. The **ranking key**, and the one figure of the three that a reader can
   * check: on the shipped roster the crowded end scores 40–68 and the lonely end
   * 0–2, so it separates the two lists as sharply as the similarity does while
   * meaning something on its own.
   */
  kin: number;
  /**
   * Mean similarity to its ISOLATION_NEIGHBOURS closest neighbours, 0..1, from
   * the ☁️ map's model. Breaks ties on `kin` — which matters at the lonely end,
   * where many artists score 0 and only the finer measure can order them. Not
   * displayed: the map's similarity compares tags by the company they keep,
   * which over a coherent roster compresses every value into a narrow band near
   * the top, where a bare "0.84" would read as a strong match.
   */
  kinship: number;
  /** The artist's least-shared tag — the shorthand for what sets it apart.
      Era tags are skipped: they are confined to their own section, and "the
      1950s" explains nothing about what makes an artist unlike its neighbours.
      Null when the artist carries no other kind of tag. */
  rarestTag: string | null;
}

export interface IsolationRankings {
  /** The most typical artists — the collection's centre of gravity. */
  core: ArtistIsolation[];
  /** The least typical — artists unlike anything else here. */
  distinctive: ArtistIsolation[];
}

/**
 * Rank the ranked roster by how much company each artist keeps, reusing the
 * ☁️ map's tag-aware similarity matrix (cloud-layout.ts) rather than inventing
 * a second notion of similarity.
 *
 * Kinship is the mean of an artist's few closest similarities, not its single
 * closest: one near-twin would otherwise make a genuinely unusual artist look
 * ordinary. Both ends are reported — the crowded centre describes the sound the
 * collection is built around, the sparse edge the one-offs.
 *
 * This is the one section reading `soundTags` rather than `countedTags`, and it
 * reads them throughout — the similarity, the kin count and the rarest-tag note
 * alike. Both halves of that follow from what the section is: it borrows the ☁️
 * map's model, so it inherits the map's tag set, and a section that ranked by
 * musical company while explaining itself with a region would be answering a
 * question it had not asked. "One of a kind" here means one of a kind to listen
 * to; the sole artist from Belgium is not thereby unusual.
 */
export function rankIsolation(
  artists: readonly Artist[],
  limit = ARTIST_LIST_LIMIT,
): IsolationRankings {
  const ranked = artists.filter((artist) => artist.baselineSlot !== UNRANKED);
  // Kinship needs at least one neighbour to average over.
  if (ranked.length <= 1) return { core: [], distinctive: [] };

  // How many ranked artists carry each sound tag, for the rarest-tag
  // annotation. No era filter is needed: a decade is not a sound tag, so the
  // set this reads cannot contain one.
  const carriers = new Map<string, number>();
  for (const artist of ranked) {
    for (const tag of artist.soundTags) carriers.set(tag, (carriers.get(tag) ?? 0) + 1);
  }

  // One tag set throughout — the ☁️ map's `soundTags`, which `kinship` reads by
  // way of `pairwiseSimilarities`, so `kin` and `rarestTag` read it too. The
  // alternative, letting the displayed figures count tags the ranking behind
  // them ignored, is how a list ends up disagreeing with its own explanation.
  const similarities = pairwiseSimilarities(ranked);
  const tagSets = ranked.map((artist) => new Set(artist.soundTags));
  const scored: ArtistIsolation[] = ranked.map((artist, i) => {
    const neighbours = similarities[i]!.filter((_, j) => j !== i).sort((a, b) => b - a);
    const nearest = neighbours.slice(0, ISOLATION_NEIGHBOURS);
    const rarest = [...artist.soundTags].sort(
      (a, b) => carriers.get(a)! - carriers.get(b)! || compareArtistNames(a, b),
    )[0];
    // Kin: others carrying at least half of this artist's own sound tags.
    const needed = Math.ceil(artist.soundTags.length * KIN_SHARE);
    let kin = 0;
    if (needed > 0) {
      for (let j = 0; j < ranked.length; j++) {
        if (j === i) continue;
        let shared = 0;
        for (const tag of ranked[j]!.soundTags) if (tagSets[i]!.has(tag)) shared += 1;
        if (shared >= needed) kin += 1;
      }
    }
    return {
      name: artist.name,
      tier: artist.baselineSlot as Tier,
      kin,
      kinship: nearest.reduce((sum, similarity) => sum + similarity, 0) / nearest.length,
      rarestTag: rarest ?? null,
    };
  });

  const byName = (a: ArtistIsolation, b: ArtistIsolation): number =>
    compareArtistNames(a.name, b.name);
  return {
    core: [...scored]
      .sort((a, b) => b.kin - a.kin || b.kinship - a.kinship || byName(a, b))
      .slice(0, limit),
    distinctive: [...scored]
      .sort((a, b) => a.kin - b.kin || a.kinship - b.kinship || byName(a, b))
      .slice(0, limit),
  };
}

// --- The whole dialog's worth ---

/** The headline counts opening the dialog. */
export interface RosterSummary {
  /** Every artist in the roster, ranked or not. */
  artistCount: number;
  rankedCount: number;
  /** Distinct tags across the whole roster, and how many clear MIN_SUPPORT. */
  vocabularySize: number;
  supportedTagCount: number;
  /** Ranked artists per tier, top tier first; empty tiers included so the
      histogram shows the shape of the whole board. */
  tierCounts: { tier: Tier; count: number }[];
  /** The tiers counted as favourites, and how many artists they hold. */
  favouriteTiers: Tier[];
  favouriteCount: number;
}

/** Everything the 📊 dialog shows. */
export interface TierStats {
  summary: RosterSummary;
  /** Ranked artists considered (tagless ones included). */
  rankedCount: number;
  /** Tags meeting MIN_SUPPORT (era tags included). */
  tagCount: number;
  /** The occupied span of the tier axis, for the gauges. */
  positions: PositionRange;
  /** Every qualifying era tag, oldest decade first. */
  eras: TagStat[];
  /** What the collection is made of, per vocabulary category — descriptive. */
  composition: CategoryComposition[];
  /** The broad worlds it splits into, above the level of any single tag. */
  worlds: TasteWorlds;
  /** …what lifts an artist within it, by affection ratio… */
  lifts: TagStat[];
  /** …and what the favourite tiers have in common. */
  favouriteTraits: TagStat[];
  /** The tags that least pin a placement down (those spanning the board)… */
  variable: TagStat[];
  /** …and the tags that best do. */
  reliable: TagStat[];
  /** How much of a placement the tags account for at all — very little. */
  prediction: PredictivePower | null;
  /** How many tags were weighed against chance, and how many cleared it — so
      the dialog can explain an empty section instead of just omitting it. */
  evidence: { tested: number; elevated: number; clustered: number };
  isolation: IsolationRankings;
}

export function computeStats(artists: readonly Artist[]): TierStats {
  const baseline = computeBaseline(artists);
  const stats = aggregateTags(baseline);
  // Era tags get a section of their own — a chronological preference curve —
  // and stay out of every other statistic: they are numerous, well-supported,
  // and internally uniform enough to crowd the ranked lists out otherwise.
  // aggregateTags's canonical tag order is already chronological for
  // decade-shaped names ("1950s" … "2020s" sort lexicographically).
  const eras = stats.filter((stat) => isEraTag(stat.tag));
  const general = stats.filter((stat) => !isEraTag(stat.tag));
  return {
    summary: {
      artistCount: artists.length,
      rankedCount: baseline.ranked.length,
      vocabularySize: new Set(artists.flatMap(countedTags)).size,
      supportedTagCount: stats.length,
      tierCounts: TIERS.map((tier) => ({
        tier,
        count: baseline.ranked.filter((artist) => artist.tier === tier).length,
      })),
      favouriteTiers: baseline.favouriteTiers,
      favouriteCount: baseline.favouriteCount,
    },
    rankedCount: baseline.ranked.length,
    tagCount: stats.length,
    positions: baseline.positions,
    eras,
    composition: categoryComposition(artists),
    worlds: rankTasteWorlds(artists),
    lifts: rankByRatio(general),
    favouriteTraits: rankByFavouriteIndex(general),
    variable: rankVariable(general),
    reliable: rankReliable(general),
    prediction: measurePredictivePower(artists),
    evidence: {
      tested: general.length,
      elevated: general.filter((stat) => stat.elevationIsReal).length,
      clustered: general.filter((stat) => stat.clusteringIsReal).length,
    },
    isolation: rankIsolation(artists),
  };
}
