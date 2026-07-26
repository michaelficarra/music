// Core domain types shared across the app.

/** The seven fixed ranked tiers, ordered best → worst. */
export const TIERS = ["S", "A", "B", "C", "D", "E", "F"] as const;
export type Tier = (typeof TIERS)[number];

/**
 * How much a ranked artist counts when aggregating affection, on the Fibonacci
 * / planning-poker scale: F = 1 … S = 13. Every value is positive — the roster
 * is a list of artists the user likes, so a placement never subtracts — and the
 * gaps widen towards the top, matching how a tier list is actually used: the
 * distance from A to S means far more than the distance from E to D.
 *
 * Shared deliberately by the 🎲 picker (ARCHITECTURE §6) and the 📊 statistics
 * (§8) so the two features value a tier identically. Distinct from a tier's
 * ordinal *position* in TIERS, which is what statements about placement use.
 */
export const TIER_WEIGHT: Record<Tier, number> = { S: 13, A: 8, B: 5, C: 3, D: 2, E: 1, F: 1 };

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
   * (data/tags.csv). This is what the 🎲 filter, the ☁️ map and the card
   * tooltips read, so selecting `European` finds the Swedes.
   */
  tags: readonly string[];
}
