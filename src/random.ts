// Weighted random artist picker.
//
// A scheme has two independent dimensions: a cutoff (which slots are eligible —
// a ranked tier and everything above it, the whole roster via "unrestricted", or
// the unranked pool alone via "unranked only") and a weighting intensity (how
// strongly higher tiers are favoured). Under a ranked cutoff the unranked pool is
// excluded; under "unrestricted" it joins the draw weighted as the lowest tier;
// under "unranked only" it is the sole eligible region. See PRD §8 / ARCHITECTURE §6.

import { ALL, TIERS, UNRANKED, isTier, type Cutoff, type Slot, type Tier } from "./types";

/** Fibonacci weight per tier (planning-poker scale): F=1 … S=13. */
export const FIB_WEIGHT: Record<Tier, number> = { S: 13, A: 8, B: 5, C: 3, D: 2, E: 1, F: 1 };

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

/** Eligible tiers for a cutoff: from S down to the cutoff, inclusive. */
export function eligibleTiers(cutoff: Tier): Tier[] {
  return TIERS.slice(0, TIERS.indexOf(cutoff) + 1);
}

/** Per-artist selection weight for an artist in `tier` under `intensity`. */
export function tierWeight(tier: Tier, intensity: Intensity): number {
  switch (intensity) {
    case "unweighted":
      return 1;
    case "weighted":
      return FIB_WEIGHT[tier]; // Fibonacci scale (F=1 … S=13)
    case "heavily":
      return 2 * FIB_WEIGHT[tier]; // double Fibonacci (F=2 … S=26)
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
    (cutoff !== ALL && cutoff !== UNRANKED && !isTier(cutoff)) ||
    !INTENSITIES.includes(intensity as Intensity)
  ) {
    return null;
  }
  return { cutoff: cutoff as Cutoff, intensity: intensity as Intensity };
}

/**
 * Human label for a cutoff: "unrestricted" for the whole roster, "unranked only"
 * for the unranked pool, "S only" for the top tier, "F+ (all ranked)" for every
 * ranked tier (the F cutoff), else "C+".
 */
export function cutoffLabel(cutoff: Cutoff): string {
  if (cutoff === ALL) return "unrestricted"; // the whole roster: every ranked tier plus the unranked pool
  if (cutoff === UNRANKED) return "unranked only"; // the unranked pool (the board's "?" row)
  if (cutoff === TIERS[0]) return "S only"; // nothing ranks above the top tier
  if (cutoff === TIERS[TIERS.length - 1]) return "F+ (all ranked)"; // the F cutoff = every ranked tier
  return `${cutoff}+`; // "A+" … "E+"
}

interface Candidate {
  name: string;
  weight: number;
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
    // keep their tier weight; unranked artists are weighted as the lowest tier (F)
    // so they surface about as often as the bottom of the ranking under any intensity.
    const lowestTier = TIERS[TIERS.length - 1]!;
    for (const [name, slot] of slotByName) {
      const tier = slot === UNRANKED ? lowestTier : slot;
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
