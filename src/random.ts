// Weighted random artist picker.
//
// A scheme has two independent dimensions: a tier cutoff (which ranked tiers are
// eligible) and a weighting intensity (how strongly higher tiers are favoured).
// Unranked artists are never eligible. See PRD §8 / ARCHITECTURE §7.

import { TIERS, UNRANKED, isTier, type Slot, type Tier } from "./types";

/** Fibonacci weight per tier (planning-poker scale): F=1 … S=13. */
export const FIB_WEIGHT: Record<Tier, number> = { S: 13, A: 8, B: 5, C: 3, D: 2, F: 1 };

export type Intensity = "unweighted" | "weighted" | "heavily";

export const INTENSITIES: readonly Intensity[] = ["unweighted", "weighted", "heavily"];

export const INTENSITY_LABEL: Record<Intensity, string> = {
  unweighted: "unweighted",
  weighted: "weighted",
  heavily: "heavily weighted",
};

export interface Scheme {
  cutoff: Tier;
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
  if (!isTier(cutoff) || !INTENSITIES.includes(intensity as Intensity)) return null;
  return { cutoff, intensity: intensity as Intensity };
}

/** Human label for a cutoff: "S only" for the top tier, "full" for the lowest, else "C+". */
export function cutoffLabel(cutoff: Tier): string {
  if (cutoff === TIERS[0]) return "S only"; // nothing ranks above the top tier
  return cutoff === TIERS[TIERS.length - 1] ? "full" : `${cutoff}+`;
}

/** Every (cutoff × intensity) scheme, for building the dropdown. */
export const SCHEMES: readonly Scheme[] = TIERS.flatMap((cutoff) =>
  INTENSITIES.map((intensity): Scheme => ({ cutoff, intensity })),
);

interface Candidate {
  name: string;
  weight: number;
}

function candidates(slotByName: ReadonlyMap<string, Slot>, scheme: Scheme): Candidate[] {
  const eligible = new Set<Tier>(eligibleTiers(scheme.cutoff));
  const result: Candidate[] = [];
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
 */
export function pick(
  slotByName: ReadonlyMap<string, Slot>,
  scheme: Scheme,
  rng: () => number = Math.random,
): string | null {
  const pool = candidates(slotByName, scheme);
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
