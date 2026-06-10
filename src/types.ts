// Core domain types shared across the app.

/** The seven fixed ranked tiers, ordered best → worst. */
export const TIERS = ["S", "A", "B", "C", "D", "E", "F"] as const;
export type Tier = (typeof TIERS)[number];

/** Sentinel for artists that have not been placed into a ranked tier. */
export const UNRANKED = "unranked";

/** Where an artist currently sits: a ranked tier, or the unranked pool. */
export type Slot = Tier | typeof UNRANKED;

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
  /** Descriptive tags (genres, musical qualities, eras, notable aspects). */
  tags: readonly string[];
}
