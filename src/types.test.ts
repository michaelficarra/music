import { describe, expect, it } from "vitest";
import {
  BASE_TIERS,
  BOTTOM_POSITION,
  TIERS,
  TOP_POSITION,
  baseTier,
  isBaseTier,
  isTier,
  lowestVariant,
  tierPosition,
} from "./types";

describe("the tier scale", () => {
  it("is every base rank split three ways, except F", () => {
    // TIERS is written out literally so its union type is exact; this is the
    // guard that it and BASE_TIERS cannot drift apart.
    const expanded = BASE_TIERS.flatMap((rank) =>
      rank === "F" ? [rank] : [`${rank}+`, rank, `${rank}-`],
    );
    expect([...TIERS]).toEqual(expanded);
    expect(TIERS).toHaveLength(19);
  });

  it("orders the rows best to worst, by position", () => {
    const positions = TIERS.map(tierPosition);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i - 1]!).toBeGreaterThan(positions[i]!);
    }
    expect(TOP_POSITION).toBeCloseTo(22 / 3); // S+
    expect(BOTTOM_POSITION).toBe(1); // F
  });

  it("maps a variant back to the rank it refines", () => {
    expect(baseTier("A+")).toBe("A");
    expect(baseTier("A")).toBe("A");
    expect(baseTier("A-")).toBe("A");
    expect(baseTier("F")).toBe("F");
  });

  it("finds where a rank's family ends", () => {
    // What the 🎲 cutoff and the board's eligibility divider both need.
    expect(lowestVariant("A")).toBe("A-");
    expect(lowestVariant("F")).toBe("F"); // F has no variants to end with
    for (const rank of BASE_TIERS) expect(baseTier(lowestVariant(rank))).toBe(rank);
  });

  it("tells a tier from a rank", () => {
    expect(isTier("S-")).toBe(true);
    expect(isTier("S")).toBe(true);
    expect(isTier("F-")).toBe(false); // never minted: nothing ranks below F
    // Every rank is also a tier (its own bare row), but only the seven bare ones
    // can be a 🎲 cutoff.
    expect(isBaseTier("S-")).toBe(false);
    expect(isBaseTier("S")).toBe(true);
    for (const rank of BASE_TIERS) expect(isTier(rank)).toBe(true);
  });
});
