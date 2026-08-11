// Core domain types shared across the app.

/** The seven fixed ranked tiers, ordered best → worst. */
export const TIERS = ["S", "A", "B", "C", "D", "E", "F"] as const;
export type Tier = (typeof TIERS)[number];

/** A tier's ordinal rank on the scale: S = 7 down to F = 1. */
export function tierPosition(tier: Tier): number {
  return TIERS.length - TIERS.indexOf(tier);
}

/**
 * A weight for every tier on the power-law curve `position ** exponent`, so F
 * (position 1) always weighs 1 and a larger exponent steepens the climb.
 *
 * The curve's defining property is that its *proportional* steps shrink as you
 * climb — each is `((k+1)/k) ** exponent` — because that is how the tiers are
 * actually used: promoting an artist out of the bottom says far more than
 * choosing between the top two. The exponent is what the 🎲 intensities vary
 * (ARCHITECTURE §6); scaling the whole table instead would do nothing at all,
 * since the picker normalises by the total.
 */
export function tierWeightScale(exponent: number): Record<Tier, number> {
  return Object.fromEntries(TIERS.map((tier) => [tier, tierPosition(tier) ** exponent])) as Record<
    Tier,
    number
  >;
}

/**
 * How much a ranked artist counts when aggregating affection: `position²`, so
 * F = 1, E = 4, D = 9, C = 16, B = 25, A = 36, S = 49. Every value is positive —
 * the roster is a list of artists the user likes, so a placement never subtracts.
 *
 * The two directions the gaps run are both deliberate. In *absolute* terms they
 * widen towards the top (S − A = 13 against E − F = 3): a favourite counts for
 * far more than a promotion at the bottom does. In *proportional* terms they
 * narrow (A → S is 1.36× where F → E is 4×): the S/A distinction is the finest
 * the tier list draws, and the one at the bottom the coarsest.
 *
 * Shared deliberately by the 🎲 picker (ARCHITECTURE §6) and the 📊 statistics
 * (§8) so the two features value a tier identically. Still distinct from
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

/** The values the 🎲 tier-cutoff can take: a `Slot` (ranked tier / unranked), or `ALL`. */
export type Cutoff = Slot | typeof ALL;

/** Narrowing guard: is an arbitrary string one of the ranked tiers? */
export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
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
   * the 📊 statistics, the ☁️ map's similarity, the card tooltips. Finding an
   * artist by `rock` is useful; saying that it is a rock band, when four fifths
   * of the roster is, is not (ARCHITECTURE §3b).
   */
  specificTags: readonly string[];
}
