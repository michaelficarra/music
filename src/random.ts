// Weighted random artist picker.
//
// A scheme has two independent dimensions: a cutoff (which slots are eligible —
// a base rank's family and everything above it, the whole roster via
// "unrestricted", or the unranked pool alone via "unranked only") and a weighting intensity (how
// strongly higher tiers are favoured). Under a ranked cutoff the unranked pool is
// excluded; under "unrestricted" it joins the draw weighted as the lowest tier;
// under "unranked only" it is the sole eligible region. See PRD §8 / ARCHITECTURE §6.

import {
  ALL,
  BASE_TIERS,
  TIERS,
  TIER_WEIGHT,
  UNRANKED,
  isBaseTier,
  lowestVariant,
  tierWeightScale,
  type BaseTier,
  type Cutoff,
  type Slot,
  type Tier,
} from "./types";

export type Intensity = "unweighted" | "weighted" | "heavily";

export const INTENSITIES: readonly Intensity[] = ["unweighted", "weighted", "heavily"];

export const INTENSITY_LABEL: Record<Intensity, string> = {
  unweighted: "unweighted",
  weighted: "gently weighted",
  heavily: "heavily weighted",
};

export interface Scheme {
  // A ranked-tier cutoff, ALL for the whole roster, or UNRANKED to draw
  // exclusively from the unranked pool.
  cutoff: Cutoff;
  intensity: Intensity;
}

/**
 * Eligible tiers for a cutoff: from the top of the board down to the *bottom*
 * of the cutoff rank's family, inclusive. A cutoff names a whole rank, so "C+"
 * reaches C- rather than stopping at the bare C row (PRD §8).
 */
export function eligibleTiers(cutoff: BaseTier): Tier[] {
  return TIERS.slice(0, TIERS.indexOf(lowestVariant(cutoff)) + 1);
}

/**
 * The steeper of the two weighted curves (`position³`: F=1 … S=343, S+=394),
 * against `TIER_WEIGHT`'s `position²` (F=1 … S=49, S+=53.8).
 *
 * Intensities differ by *exponent*, never by a multiplier: selection normalises
 * by the pool's total weight, so multiplying every tier by a constant leaves the
 * odds exactly as they were. Raising the exponent is what actually widens them.
 */
const HEAVY_TIER_WEIGHT = tierWeightScale(3);

/** Per-artist selection weight for an artist in `tier` under `intensity`. */
export function tierWeight(tier: Tier, intensity: Intensity): number {
  switch (intensity) {
    case "unweighted":
      return 1;
    case "weighted":
      return TIER_WEIGHT[tier]; // the scale shared with the 📊 statistics
    case "heavily":
      return HEAVY_TIER_WEIGHT[tier];
  }
}

/** Stable id for persistence and <option> values, e.g. "C:weighted". */
export function schemeId(scheme: Scheme): string {
  return `${scheme.cutoff}:${scheme.intensity}`;
}

export function parseSchemeId(id: string): Scheme | null {
  const [cutoff, intensity] = id.split(":");
  if (cutoff === undefined || intensity === undefined) return null;
  if (
    (cutoff !== ALL && cutoff !== UNRANKED && !isBaseTier(cutoff)) ||
    !INTENSITIES.includes(intensity as Intensity)
  ) {
    return null;
  }
  return { cutoff: cutoff as Cutoff, intensity: intensity as Intensity };
}

/**
 * Human label for a cutoff: "unrestricted" for the whole roster, "unranked only"
 * for the unranked pool, "S only" for the top rank, "F+ (all ranked)" for every
 * ranked tier (the F cutoff), else "C+".
 *
 * A label names the *rank*, so "C+" covers C+, C and C- along with everything
 * above, and "S only" is the three S rows rather than one.
 */
export function cutoffLabel(cutoff: Cutoff): string {
  if (cutoff === ALL) return "unrestricted"; // the whole roster: every ranked tier plus the unranked pool
  if (cutoff === UNRANKED) return "unranked only"; // the unranked pool (the board's "?" row)
  if (cutoff === BASE_TIERS[0]) return "S only"; // nothing ranks above the top rank
  if (cutoff === BASE_TIERS[BASE_TIERS.length - 1]) return "F+ (all ranked)"; // the F cutoff = every ranked tier
  return `${cutoff}+`; // "A+" … "E+"
}

interface Candidate {
  name: string;
  weight: number;
}

/**
 * The furthest-down ranked tier anyone currently sits in, or null if nothing is
 * ranked. This is "the bottom of the ranking" the unrestricted cutoff weights
 * unranked artists at — the *occupied* floor rather than F, which is often empty
 * and, on a curve where F weighs a quarter of an E, would bury them.
 */
function lowestOccupiedTier(slotByName: ReadonlyMap<string, Slot>): Tier | null {
  let lowest: Tier | null = null;
  for (const slot of slotByName.values()) {
    if (slot === UNRANKED) continue;
    if (lowest === null || TIERS.indexOf(slot) > TIERS.indexOf(lowest)) lowest = slot;
  }
  return lowest;
}

function candidates(slotByName: ReadonlyMap<string, Slot>, scheme: Scheme): Candidate[] {
  const result: Candidate[] = [];
  if (scheme.cutoff === UNRANKED) {
    // The "unranked" cutoff draws only from the unranked pool, uniformly: there
    // are no tiers to favour, so weighting intensity does not apply.
    for (const [name, slot] of slotByName) {
      if (slot === UNRANKED) result.push({ name, weight: 1 });
    }
    return result;
  }
  if (scheme.cutoff === ALL) {
    // The "unrestricted" (ALL) cutoff draws from the whole roster. Ranked artists
    // keep their tier weight; unranked artists are weighted as the lowest occupied
    // tier so they surface about as often as the bottom of the ranking under any
    // intensity. With nothing ranked at all the fallback is arbitrary: every
    // candidate is then unranked, so they share one weight whatever it is.
    const floor = lowestOccupiedTier(slotByName) ?? TIERS[TIERS.length - 1]!;
    for (const [name, slot] of slotByName) {
      const tier = slot === UNRANKED ? floor : slot;
      result.push({ name, weight: tierWeight(tier, scheme.intensity) });
    }
    return result;
  }
  const eligible = new Set<Tier>(eligibleTiers(scheme.cutoff));
  for (const [name, slot] of slotByName) {
    if (slot === UNRANKED || !eligible.has(slot)) continue;
    result.push({ name, weight: tierWeight(slot, scheme.intensity) });
  }
  return result;
}

/** Are there any artists a given scheme could pick? */
export function hasEligible(slotByName: ReadonlyMap<string, Slot>, scheme: Scheme): boolean {
  return candidates(slotByName, scheme).length > 0;
}

/**
 * Pick one artist name at random under `scheme`, or null if none are eligible.
 * `rng` (defaulting to Math.random) is injectable for deterministic tests.
 *
 * `exclude` (typically the previous pick) is kept out of the draw so the same
 * artist is never chosen twice in a row — unless it is the only eligible artist,
 * in which case there is no alternative and the repeat is allowed.
 */
export function pick(
  slotByName: ReadonlyMap<string, Slot>,
  scheme: Scheme,
  rng: () => number = Math.random,
  exclude: string | null = null,
): string | null {
  const eligible = candidates(slotByName, scheme);
  const pool = eligible.length > 1 ? eligible.filter((c) => c.name !== exclude) : eligible;
  const total = pool.reduce((sum, c) => sum + c.weight, 0);
  if (pool.length === 0 || total <= 0) return null;

  let threshold = rng() * total;
  for (const c of pool) {
    threshold -= c.weight;
    if (threshold < 0) return c.name;
  }
  // Floating-point safety: return the last candidate if rounding overshoots.
  return pool[pool.length - 1]!.name;
}
