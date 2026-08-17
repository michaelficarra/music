// Core domain types shared across the app.

/** The seven fixed base ranks, ordered best → worst. */
export const BASE_TIERS = ["S", "A", "B", "C", "D", "E", "F"] as const;
export type BaseTier = (typeof BASE_TIERS)[number];

/**
 * Every ranked tier, ordered best → worst: each base rank split into a `+`, a
 * bare and a `-` row, except F.
 *
 * F is deliberately alone. The other six ranks are refined in both directions
 * because there is a neighbour on each side to lean toward; nothing sits below
 * F, so an "F-" would name a place off the end of the scale.
 *
 * Written out rather than generated from `BASE_TIERS` so the literal union is
 * exact — that is what lets `Record<Tier, …>` and `isTier` typecheck without a
 * cast. `types.test.ts` asserts the two constants agree.
 */
export const TIERS = [
  "S+",
  "S",
  "S-",
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
  "E+",
  "E",
  "E-",
  "F",
] as const;
export type Tier = (typeof TIERS)[number];

/** The base rank a tier refines: "A+" → "A". Every base rank is a single letter. */
export function baseTier(tier: Tier): BaseTier {
  return tier[0] as BaseTier;
}

/**
 * The bottom variant of a base rank — "A" → "A-", "F" → "F" (F has none).
 *
 * Where a rank's family *ends*, which is what the 🎲 cutoff and the board's
 * eligibility divider both need: selecting "A+" means A- and everything above.
 */
export function lowestVariant(base: BaseTier): Tier {
  const withMinus = `${base}-`;
  return (TIERS as readonly string[]).includes(withMinus) ? (withMinus as Tier) : base;
}

/**
 * How far a `+`/`-` variant sits from its base rank: a third of a rank, so the
 * three variants divide the rank evenly and the whole scale lands on one 1/3
 * grid. F has no variants, so nothing sits between E- (1⅔) and F (1).
 */
const VARIANT_STEP = 1 / 3;

/**
 * A tier's rank on the scale: S = 7 down to F = 1, with a `+` a third of a rank
 * above its base and a `-` a third below (S+ = 7⅓, S- = 6⅔).
 *
 * The variants shift the position rather than being cosmetic, so everything
 * derived from it — the 🎲 odds and every 📊 placement figure alike — feels a
 * promotion within a rank. Since no artist has left a base rank yet, every
 * figure the app currently reports is the one it reported before the variants
 * existed.
 */
export function tierPosition(tier: Tier): number {
  const base = baseTier(tier);
  const rank = BASE_TIERS.length - BASE_TIERS.indexOf(base);
  if (tier.endsWith("+")) return rank + VARIANT_STEP;
  if (tier.endsWith("-")) return rank - VARIANT_STEP;
  return rank;
}

/** The ends of the position scale: S+ = 7⅓ and F = 1. */
export const TOP_POSITION = tierPosition(TIERS[0]);
export const BOTTOM_POSITION = tierPosition(TIERS[TIERS.length - 1]!);

/**
 * A weight for every tier on the power-law curve `position ** exponent`, so F
 * (position 1) always weighs 1 and a larger exponent steepens the climb.
 *
 * The curve's defining property is that its *proportional* steps shrink as you
 * climb — each is `(p_above / p_below) ** exponent` — because that is how the
 * tiers are actually used: promoting an artist out of the bottom says far more
 * than choosing between the top two. The exponent is what the 🎲 intensities
 * vary (ARCHITECTURE §6); scaling the whole table instead would do nothing at
 * all, since the picker normalises by the total.
 */
export function tierWeightScale(exponent: number): Record<Tier, number> {
  return Object.fromEntries(TIERS.map((tier) => [tier, tierPosition(tier) ** exponent])) as Record<
    Tier,
    number
  >;
}

/**
 * How much a ranked artist counts when aggregating affection: `position²`, so
 * F = 1, E = 4, D = 9, C = 16, B = 25, A = 36, S = 49, with each variant a third
 * of a rank off its base (S+ = 53.8, S- = 44.4). Every value is positive — the
 * roster is a list of artists the user likes, so a placement never subtracts.
 *
 * The two directions the gaps run are both deliberate. In *absolute* terms they
 * widen towards the top (S − A = 13 against E − F = 3): a favourite counts for
 * far more than a promotion at the bottom does. In *proportional* terms they
 * narrow (A → S is 1.36× where F → E is 4×): the S/A distinction is the finest
 * the tier list draws whole ranks at, and the one at the bottom the coarsest.
 *
 * Shared deliberately by the 🎲 picker (ARCHITECTURE §6) and the 📊 statistics
 * (§8) so the two features value a tier identically — including the variants,
 * which shift the odds and the statistics alike. Still distinct from
 * `tierPosition` — how much an artist counts is not where it sits — even though
 * the first is now derived from the second.
 */
export const TIER_WEIGHT: Record<Tier, number> = tierWeightScale(2);

/** Sentinel for artists that have not been placed into a ranked tier. */
export const UNRANKED = "unranked";

/** Where an artist currently sits: a ranked tier, or the unranked pool. */
export type Slot = Tier | typeof UNRANKED;

/**
 * Picker-only sentinel for the 🎲 cutoff that draws from the whole roster (every
 * ranked tier *and* the unranked pool). Not a `Slot` — an artist is never placed
 * in "all"; it exists only as a tier-cutoff selection.
 */
export const ALL = "all";

/**
 * The values the 🎲 tier-cutoff can take: a base rank, the unranked pool, or `ALL`.
 *
 * A *base* rank rather than any tier: the cutoff selects a whole family, so
 * "A+" draws from A- upward and there is no cutoff that would split A's three
 * rows apart (PRD §8).
 */
export type Cutoff = BaseTier | typeof UNRANKED | typeof ALL;

/** Narrowing guard: is an arbitrary string one of the ranked tiers? */
export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

/** Narrowing guard: is an arbitrary string one of the base ranks? */
export function isBaseTier(value: string): value is BaseTier {
  return (BASE_TIERS as readonly string[]).includes(value);
}

/** An artist as read from the static CSV baseline. */
export interface Artist {
  name: string;
  baselineSlot: Slot;
  imageURL: string;
  imageSource: string;
  /**
   * The tags written on the artist's own CSV row: the most specific descriptor
   * in each direction, with nothing derivable from another left in.
   */
  ownTags: readonly string[];
  /**
   * Every tag the artist carries: `ownTags` plus the tags derived from those
   * (data/tags.csv). Read by the 🎲 **filter**, so selecting `European` finds
   * the Swedes and `punk rock` finds the ska-punk bands.
   */
  tags: readonly string[];
  /**
   * `tags` minus the ones too broad to describe anything (`broadTags`).
   *
   * Everything that *reports or compares* tags reads this rather than `tags` —
   * the 📊 statistics, the card tooltips. Finding an artist by `rock` is useful;
   * saying that it is a rock band, when four fifths of the roster is, is not
   * (ARCHITECTURE §3b).
   */
  specificTags: readonly string[];
  /**
   * `specificTags` narrowed to the tags about the music itself — genres and
   * musical qualities, with regions, eras and notable aspects left out.
   *
   * Read by the ☁️ map, which arranges artists by resemblance of *sound*, and by
   * the two 📊 sections that are the map: the worlds it splits into, and the
   * core/distinctive lists. Being Swedish, or having worked in the 2010s, is a
   * fact about an artist rather than a neighbourhood on the map (ARCHITECTURE §3b).
   */
  soundTags: readonly string[];
}
