import { describe, expect, it } from "vitest";
import {
  eligibleTiers,
  tierWeight,
  pick,
  hasEligible,
  schemeId,
  parseSchemeId,
  cutoffLabel,
} from "./random";
import type { Slot } from "./types";

describe("random", () => {
  it("eligibleTiers respects the cutoff", () => {
    expect(eligibleTiers("S")).toEqual(["S"]);
    expect(eligibleTiers("C")).toEqual(["S", "A", "B", "C"]);
    expect(eligibleTiers("F")).toEqual(["S", "A", "B", "C", "D", "F"]);
  });

  it("tierWeight matches the intensity curves", () => {
    expect(tierWeight("S", "unweighted")).toBe(1);
    expect(tierWeight("F", "unweighted")).toBe(1);
    expect(tierWeight("S", "weighted")).toBe(6);
    expect(tierWeight("F", "weighted")).toBe(1);
    expect(tierWeight("S", "heavily")).toBe(32);
    expect(tierWeight("F", "heavily")).toBe(1);
  });

  it("never picks unranked and honours the cutoff", () => {
    const slots = new Map<string, Slot>([
      ["x", "unranked"],
      ["y", "D"],
    ]);
    // D is excluded by a C+ cutoff → nothing eligible.
    expect(hasEligible(slots, { cutoff: "C", intensity: "unweighted" })).toBe(false);
    expect(pick(slots, { cutoff: "C", intensity: "unweighted" })).toBeNull();
    // full cutoff includes D.
    expect(pick(slots, { cutoff: "F", intensity: "unweighted" })).toBe("y");
  });

  it("returns null for an empty pool", () => {
    expect(pick(new Map(), { cutoff: "F", intensity: "unweighted" })).toBeNull();
  });

  it("selects deterministically from cumulative weights with an injected rng", () => {
    const slots = new Map<string, Slot>([
      ["top", "S"],
      ["bottom", "F"],
    ]);
    const scheme = { cutoff: "F", intensity: "weighted" } as const; // weights S=6, F=1, total 7
    expect(pick(slots, scheme, () => 0)).toBe("top");
    expect(pick(slots, scheme, () => 6.5 / 7)).toBe("bottom");
  });

  it("round-trips scheme ids and rejects invalid ones", () => {
    const scheme = { cutoff: "C", intensity: "weighted" } as const;
    expect(parseSchemeId(schemeId(scheme))).toEqual(scheme);
    expect(parseSchemeId("Z:nope")).toBeNull();
  });

  it("labels the lowest cutoff as 'full'", () => {
    expect(cutoffLabel("C")).toBe("C+");
    expect(cutoffLabel("F")).toBe("full");
  });
});
