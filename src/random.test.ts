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
    expect(eligibleTiers("E")).toEqual(["S", "A", "B", "C", "D", "E"]);
    expect(eligibleTiers("F")).toEqual(["S", "A", "B", "C", "D", "E", "F"]);
  });

  it("tierWeight matches the intensity curves", () => {
    expect(tierWeight("S", "unweighted")).toBe(1);
    expect(tierWeight("E", "unweighted")).toBe(1);
    // weighted = Fibonacci scale (F=1, E=1, D=2, C=3, B=5, A=8, S=13)
    expect(tierWeight("S", "weighted")).toBe(13);
    expect(tierWeight("B", "weighted")).toBe(5);
    expect(tierWeight("E", "weighted")).toBe(1);
    expect(tierWeight("F", "weighted")).toBe(1);
    // heavily = double Fibonacci
    expect(tierWeight("S", "heavily")).toBe(26);
    expect(tierWeight("B", "heavily")).toBe(10);
    expect(tierWeight("E", "heavily")).toBe(2);
    expect(tierWeight("F", "heavily")).toBe(2);
  });

  it("never picks unranked and honours the cutoff", () => {
    const slots = new Map<string, Slot>([
      ["x", "unranked"],
      ["y", "D"],
    ]);
    // D is excluded by a C+ cutoff → nothing eligible.
    expect(hasEligible(slots, { cutoff: "C", intensity: "unweighted" })).toBe(false);
    expect(pick(slots, { cutoff: "C", intensity: "unweighted" })).toBeNull();
    // an E+ cutoff includes D.
    expect(pick(slots, { cutoff: "E", intensity: "unweighted" })).toBe("y");
  });

  it("returns null for an empty pool", () => {
    expect(pick(new Map(), { cutoff: "E", intensity: "unweighted" })).toBeNull();
  });

  it("selects deterministically from cumulative weights with an injected rng", () => {
    const slots = new Map<string, Slot>([
      ["top", "S"],
      ["bottom", "E"],
    ]);
    const scheme = { cutoff: "E", intensity: "weighted" } as const; // Fibonacci: S=13, E=1, total 14
    expect(pick(slots, scheme, () => 0)).toBe("top");
    expect(pick(slots, scheme, () => 13.5 / 14)).toBe("bottom");
  });

  it("round-trips scheme ids and rejects invalid ones", () => {
    const scheme = { cutoff: "C", intensity: "weighted" } as const;
    expect(parseSchemeId(schemeId(scheme))).toEqual(scheme);
    expect(parseSchemeId("Z:nope")).toBeNull();
  });

  it("labels the cutoffs ('S only', 'C+', 'F+', 'X only')", () => {
    expect(cutoffLabel("S")).toBe("S only");
    expect(cutoffLabel("C")).toBe("C+");
    expect(cutoffLabel("E")).toBe("E+");
    expect(cutoffLabel("F")).toBe("F+");
    expect(cutoffLabel("unranked")).toBe("X only");
  });

  it("the 'unranked' cutoff picks only from the unranked pool, ignoring intensity", () => {
    const slots = new Map<string, Slot>([
      ["ranked", "S"],
      ["loose-1", "unranked"],
      ["loose-2", "unranked"],
    ]);
    // Heavily-weighted intensity is irrelevant here: both unranked artists weigh 1.
    const scheme = { cutoff: "unranked", intensity: "heavily" } as const;
    expect(hasEligible(slots, scheme)).toBe(true);
    expect(pick(slots, scheme, () => 0)).toBe("loose-1");
    expect(pick(slots, scheme, () => 0.75)).toBe("loose-2");
    // The ranked artist is never chosen by an "unranked" cutoff.
    expect(pick(slots, scheme, () => 0.99)).toBe("loose-2");
  });

  it("the 'unranked' cutoff has nothing to pick when the pool is empty", () => {
    const slots = new Map<string, Slot>([["ranked", "A"]]);
    const scheme = { cutoff: "unranked", intensity: "unweighted" } as const;
    expect(hasEligible(slots, scheme)).toBe(false);
    expect(pick(slots, scheme)).toBeNull();
  });

  it("round-trips an 'unranked' scheme id", () => {
    const scheme = { cutoff: "unranked", intensity: "weighted" } as const;
    expect(parseSchemeId(schemeId(scheme))).toEqual(scheme);
  });
});
