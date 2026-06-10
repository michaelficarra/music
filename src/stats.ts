// Aggregation for the 📊 statistics dialog: what the tier ratings say about
// the tags, and what the tags would predict about the ratings. Pure logic, no
// DOM (unit tested in stats.test.ts); stats-view.ts renders the result.
//
// Everything here is a pure function of the build-embedded roster — each
// artist's baselineSlot, i.e. the arrangement shipped in data/artists.csv —
// so the statistics follow the data automatically on every rebuild and never
// need hand-curating. Unranked artists are invisible to every statistic.

import { compareArtistNames } from "./sort";
import { groupTags, isEraTag } from "./tag-groups";
import { TIERS, UNRANKED, type Artist, type Tier } from "./types";

// --- Tuning (judgement calls, see ARCHITECTURE §8) ---

/** Ranked carriers a tag needs before any statistic will mention it — with
    fewer, one or two placements would masquerade as a trend. */
export const MIN_SUPPORT = 3;
/** Entries in each of the favourite / least-favourite tag lists. */
export const TAG_LIST_LIMIT = 10;
/** Entries in each of the worst-predictors / best-predictors lists. */
export const PREDICTOR_LIST_LIMIT = 6;
/** Carriers a tag needs before the spread-based lists (worst and best
    predictors) will consider it. Spread estimates are noisier than averages,
    so these lists demand more evidence than MIN_SUPPORT provides. */
export const SPREAD_MIN_SUPPORT = 5;
/** Entries in each of the guilty-pleasures / black-sheep lists. */
export const OUTLIER_LIST_LIMIT = 6;

// --- Scoring and banding ---

/** Linear score for a ranked tier: S = 7 down to F = 1. */
export function tierScore(tier: Tier): number {
  return TIERS.length - TIERS.indexOf(tier);
}

/** A mean score expressed as the nearest tier plus a leaning: "A−" reads as
    "an A, leaning toward B". */
export interface TierBand {
  tier: Tier;
  suffix: "+" | "" | "−";
}

/**
 * Band a score onto the tier scale. Each tier owns the unit of the scale
 * centred on its own score, split into equal thirds: the middle third is the
 * bare letter, the outer thirds lean "+" (toward the better neighbour) and
 * "−" (toward the worse). So 7 → "S", 6.5 → "S−", 6.17 → "A+", 5.66 → "A−".
 * Scores are clamped to [1, 7] first, which also makes "S+" and "F−"
 * impossible — there is nothing beyond the ends to lean toward.
 */
export function tierBand(score: number): TierBand {
  const clamped = Math.min(Math.max(score, 1), TIERS.length);
  const nearest = Math.round(clamped);
  const lean = clamped - nearest;
  return {
    tier: TIERS[TIERS.length - nearest]!,
    suffix: lean > 1 / 6 ? "+" : lean < -1 / 6 ? "−" : "",
  };
}

/** tierBand as display text, e.g. "A−". */
export function tierLabel(score: number): string {
  const { tier, suffix } = tierBand(score);
  return tier + suffix;
}

/** Where a score sits along the tier axis, F = 0 … S = 1. Sizes the decade
    bars and positions every gauge marker, so the tracks share one yardstick
    with F hard against the left end. */
export function positionFraction(score: number): number {
  return (Math.min(Math.max(score, 1), TIERS.length) - 1) / (TIERS.length - 1);
}

// --- Per-tag aggregates ---

/** One tag's aggregate over the ranked artists that carry it. */
export interface TagStat {
  tag: string;
  /** Ranked carriers (always ≥ MIN_SUPPORT). */
  count: number;
  /** Mean tier score of those carriers. */
  mean: number;
  /** Population standard deviation of those scores — how much the carriers'
      placements disagree with each other. */
  spread: number;
  /** The lowest and highest scores among those carriers. */
  low: number;
  high: number;
  /** Carriers placed at least a full tier above / below the mean — the two
      camps a worst-predictor (divisive) tag splits into. */
  above: number;
  below: number;
}

/**
 * Aggregate every sufficiently-supported tag over the ranked roster, in
 * canonical tag order. Unranked artists contribute nothing; tags carried by
 * fewer than MIN_SUPPORT ranked artists are dropped entirely.
 */
export function computeTagStats(artists: readonly Artist[]): TagStat[] {
  const scoresByTag = new Map<string, number[]>();
  for (const artist of artists) {
    if (artist.baselineSlot === UNRANKED) continue;
    const score = tierScore(artist.baselineSlot);
    for (const tag of artist.tags) {
      const scores = scoresByTag.get(tag);
      if (scores === undefined) scoresByTag.set(tag, [score]);
      else scores.push(score);
    }
  }
  const stats: TagStat[] = [];
  for (const [tag, scores] of scoresByTag) {
    if (scores.length < MIN_SUPPORT) continue;
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;
    stats.push({
      tag,
      count: scores.length,
      mean,
      spread: Math.sqrt(variance),
      low: Math.min(...scores),
      high: Math.max(...scores),
      above: scores.filter((score) => score >= mean + 1).length,
      below: scores.filter((score) => score <= mean - 1).length,
    });
  }
  return stats.sort((a, b) => compareArtistNames(a.tag, b.tag));
}

// --- Ranked tag lists ---

/** Total order by `metric` descending; ties go to the better-supported tag,
    then canonical name, so every list is deterministic. */
function byMetricDesc(metric: (stat: TagStat) => number) {
  return (a: TagStat, b: TagStat): number =>
    metric(b) - metric(a) || b.count - a.count || compareArtistNames(a.tag, b.tag);
}

/**
 * The `limit` best stats by `metric`, and the `limit` worst of the rest. The
 * two ends never overlap: with few qualifying tags the bottom list comes up
 * short (or empty) rather than mirroring the top one. Both lists are ordered
 * descending — the bottom one ends on the very worst — so read in sequence
 * they form one continuous descent.
 */
function takeEnds(
  stats: readonly TagStat[],
  metric: (stat: TagStat) => number,
  limit: number,
): { top: TagStat[]; bottom: TagStat[] } {
  const ordered = [...stats].sort(byMetricDesc(metric));
  const top = ordered.slice(0, limit);
  // Select the bottom entries ascending (so the cut keeps the very worst,
  // with ties broken by count then name), then flip them to worst-last.
  const bottom = ordered
    .slice(top.length)
    .sort((a, b) => metric(a) - metric(b) || b.count - a.count || compareArtistNames(a.tag, b.tag))
    .slice(0, limit)
    .reverse();
  return { top, bottom };
}

export interface TagRankings {
  favourites: TagStat[];
  leastFavourites: TagStat[];
}

/** The tags whose artists are placed highest, and (disjointly) lowest. */
export function rankTags(stats: readonly TagStat[], limit = TAG_LIST_LIMIT): TagRankings {
  const { top, bottom } = takeEnds(stats, (stat) => stat.mean, limit);
  return { favourites: top, leastFavourites: bottom };
}

/** The tags that least predict their carriers' placements: those genuinely
    splitting their carriers into two camps — artists a full tier above and a
    full tier below the tag's mean — ranked by spread × the smaller camp's
    share of the carriers. Far-apart, evenly-matched camps beat a lone
    dissenter however distant; a tag with either camp empty never features. */
export function rankWorstPredictors(
  stats: readonly TagStat[],
  limit = PREDICTOR_LIST_LIMIT,
): TagStat[] {
  return stats
    .filter((stat) => stat.count >= SPREAD_MIN_SUPPORT && stat.above >= 1 && stat.below >= 1)
    .sort(byMetricDesc((stat) => stat.spread * (Math.min(stat.above, stat.below) / stat.count)))
    .slice(0, limit);
}

/** The mirror — the tags that best predict a placement: their carriers
    cluster most tightly around the mean (smallest spread, ties to the
    better-evidenced tag, then name), so carrying the tag all but pins an
    artist's tier. */
export function rankBestPredictors(
  stats: readonly TagStat[],
  limit = PREDICTOR_LIST_LIMIT,
): TagStat[] {
  return stats
    .filter((stat) => stat.count >= SPREAD_MIN_SUPPORT)
    .sort((a, b) => a.spread - b.spread || b.count - a.count || compareArtistNames(a.tag, b.tag))
    .slice(0, limit);
}

// --- Per-category superlatives ---

export interface CategorySuperlative {
  /** A tag-groups.ts label, e.g. "Genres". */
  category: string;
  /** The category's best-rated tag. */
  stat: TagStat;
}

/**
 * The best-rated tag in each vocabulary category, in the categories' fixed
 * display order. "Other" (tags the vocabulary doesn't know) is skipped — a
 * "favourite other" is not a conclusion — and so are categories left with no
 * sufficiently-supported tags.
 */
export function categorySuperlatives(stats: readonly TagStat[]): CategorySuperlative[] {
  const statByTag = new Map(stats.map((stat) => [stat.tag, stat]));
  const result: CategorySuperlative[] = [];
  for (const group of groupTags([...statByTag.keys()])) {
    if (group.label === "Other") continue;
    const best = group.tags
      .map((tag) => statByTag.get(tag)!)
      .sort(byMetricDesc((stat) => stat.mean))[0];
    if (best !== undefined) result.push({ category: group.label, stat: best });
  }
  return result;
}

// --- Outlier artists ---

/** An artist placed well away from where its tags sit on average. */
export interface ArtistOutlier {
  name: string;
  /** The actual placement and its score. */
  tier: Tier;
  score: number;
  /** Mean of the artist's tags' averages, each computed with the artist
      itself left out, so its own placement can't drag the prediction toward
      itself. */
  predicted: number;
  /** score − predicted: positive means placed above what the tags suggest. */
  delta: number;
}

export interface OutlierRankings {
  /** Placed above their tags' prediction, furthest first. */
  guiltyPleasures: ArtistOutlier[];
  /** Placed below their tags' prediction, furthest last — like the
      least-favourite tags, the list descends to the extreme. */
  blackSheep: ArtistOutlier[];
}

/**
 * The ranked artists whose placement most disagrees with their tags: the
 * furthest above the prediction and the furthest below it (the sign of the
 * delta decides the side; artists sitting exactly on it appear in neither).
 * A tag counts as a predictor only when MIN_SUPPORT ranked artists carry it
 * (the leave-one-out mean then averages at least two other placements); era
 * tags never predict (they describe when, not what — see computeStats);
 * artists with no predictor tags — untagged, or all tags too rare — are
 * excluded rather than judged against nothing.
 */
export function rankOutliers(
  artists: readonly Artist[],
  limit = OUTLIER_LIST_LIMIT,
): OutlierRankings {
  // Per-tag score totals over the ranked roster, for the leave-one-out means.
  const totals = new Map<string, { sum: number; count: number }>();
  for (const artist of artists) {
    if (artist.baselineSlot === UNRANKED) continue;
    const score = tierScore(artist.baselineSlot);
    for (const tag of artist.tags) {
      if (isEraTag(tag)) continue; // eras sit outside the prediction model
      const total = totals.get(tag) ?? { sum: 0, count: 0 };
      total.sum += score;
      total.count += 1;
      totals.set(tag, total);
    }
  }

  const outliers: ArtistOutlier[] = [];
  for (const artist of artists) {
    if (artist.baselineSlot === UNRANKED) continue;
    const score = tierScore(artist.baselineSlot);
    // Each predictor tag's mean with this artist excluded. The remaining
    // count is ≥ MIN_SUPPORT − 1 ≥ 2, so the division is always sound.
    const leaveOneOutMeans = artist.tags.flatMap((tag) => {
      const total = totals.get(tag); // absent for era tags
      return total !== undefined && total.count >= MIN_SUPPORT
        ? [(total.sum - score) / (total.count - 1)]
        : [];
    });
    if (leaveOneOutMeans.length === 0) continue;
    const predicted =
      leaveOneOutMeans.reduce((sum, mean) => sum + mean, 0) / leaveOneOutMeans.length;
    outliers.push({
      name: artist.name,
      tier: artist.baselineSlot,
      score,
      predicted,
      delta: score - predicted,
    });
  }

  const byName = (a: ArtistOutlier, b: ArtistOutlier): number => compareArtistNames(a.name, b.name);
  return {
    guiltyPleasures: outliers
      .filter((outlier) => outlier.delta > 0)
      .sort((a, b) => b.delta - a.delta || byName(a, b))
      .slice(0, limit),
    blackSheep: outliers
      .filter((outlier) => outlier.delta < 0)
      // Select ascending so the cut keeps the furthest below, then flip:
      // the list ends on the most extreme black sheep.
      .sort((a, b) => a.delta - b.delta || byName(a, b))
      .slice(0, limit)
      .reverse(),
  };
}

// --- The whole dialog's worth ---

/** Everything the 📊 dialog shows. */
export interface TierStats {
  /** Ranked artists considered (tagless ones included). */
  rankedCount: number;
  /** Tags meeting MIN_SUPPORT (era tags included). */
  tagCount: number;
  /** Every qualifying era tag, oldest decade first. */
  eras: TagStat[];
  rankings: TagRankings;
  superlatives: CategorySuperlative[];
  /** The tags that least pin a placement down (the two-camp splits)… */
  worstPredictors: TagStat[];
  /** …and the tags that best do. */
  bestPredictors: TagStat[];
  outliers: OutlierRankings;
}

export function computeStats(artists: readonly Artist[]): TierStats {
  const stats = computeTagStats(artists);
  // Era tags get a section of their own — a chronological preference curve —
  // and stay out of every other statistic: they are numerous, well-supported,
  // and internally uniform enough to crowd the ranked lists out otherwise.
  // computeTagStats's canonical tag order is already chronological for
  // decade-shaped names ("1950s" … "2020s" sort lexicographically).
  const eras = stats.filter((stat) => isEraTag(stat.tag));
  const general = stats.filter((stat) => !isEraTag(stat.tag));
  return {
    rankedCount: artists.filter((artist) => artist.baselineSlot !== UNRANKED).length,
    tagCount: stats.length,
    eras,
    rankings: rankTags(general),
    superlatives: categorySuperlatives(general),
    worstPredictors: rankWorstPredictors(general),
    bestPredictors: rankBestPredictors(general),
    outliers: rankOutliers(artists), // era exclusion happens inside
  };
}
