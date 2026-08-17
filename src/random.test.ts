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
import { BASE_TIERS, TIERS, type Slot } from "./types";

describe("random", () => {
  it("eligibleTiers takes the cutoff rank's whole family", () => {
    // A cutoff names a rank, not a row: "C+" reaches C- rather than stopping at
    // the bare C row.
    expect(eligibleTiers("S")).toEqual(["S+", "S", "S-"]);
    // "C+" reaches C- and stops there; every D row below it is out.
    expect(eligibleTiers("C")).toEqual([
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
    ]);
    expect(eligibleTiers("F")).toEqual([...TIERS]);
  });

  it("tierWeight matches the intensity curves", () => {
    expect(tierWeight("S", "unweighted")).toBe(1);
    expect(tierWeight("E", "unweighted")).toBe(1);
    // weighted = position² (F=1, E=4, D=9, C=16, B=25, A=36, S=49)
    expect(tierWeight("S", "weighted")).toBe(49);
    expect(tierWeight("B", "weighted")).toBe(25);
    expect(tierWeight("E", "weighted")).toBe(4);
    expect(tierWeight("F", "weighted")).toBe(1);
    // heavily = position³
    expect(tierWeight("S", "heavily")).toBe(343);
    expect(tierWeight("B", "heavily")).toBe(125);
    expect(tierWeight("E", "heavily")).toBe(8);
    expect(tierWeight("F", "heavily")).toBe(1);
  });

  it("weighs a rank's variants apart, so a promotion within a rank shifts the odds", () => {
    // 🎲 and 📊 share one valuation, so the picker resolves the +/- rows exactly
    // as the statistics do.
    for (const intensity of ["weighted", "heavily"] as const) {
      expect(tierWeight("S+", intensity)).toBeGreaterThan(tierWeight("S", intensity));
      expect(tierWeight("S", intensity)).toBeGreaterThan(tierWeight("S-", intensity));
    }
  });

  it("narrows the gap between tiers towards the top under both weightings", () => {
    // The shape the curve exists for: an artist's presence anywhere is already
    // the positive signal, so choosing between the top two tiers is the finest
    // distinction the list draws and the one at the bottom the coarsest. Stated
    // over whole ranks, which is the comparison the curve was designed around.
    for (const intensity of ["weighted", "heavily"] as const) {
      const steps = BASE_TIERS.slice(0, -1).map(
        (tier, i) => tierWeight(tier, intensity) / tierWeight(BASE_TIERS[i + 1]!, intensity),
      );
      for (const step of steps) expect(step).toBeGreaterThan(1);
      // steps run S/A first down to E/F last, each wider than the one above it.
      for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
    }
  });

  it("makes 'heavily' a steeper curve, not a rescaling of 'weighted'", () => {
    // Selection normalises by the pool total, so a scalar multiple of the whole
    // table would leave every probability untouched. Only the spread matters.
    const spread = (intensity: "weighted" | "heavily") =>
      tierWeight("S", intensity) / tierWeight("E", intensity);
    expect(spread("heavily")).toBeGreaterThan(spread("weighted"));
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

  // S owns [0, S/total) of the draw and E the remainder; midE lands halfway
  // through E's slice, wherever the curve happens to put the boundary.
  const sOverE = () => {
    const s = tierWeight("S", "weighted");
    const e = tierWeight("E", "weighted");
    return { total: s + e, midE: (s + e / 2) / (s + e) };
  };

  it("selects deterministically from cumulative weights with an injected rng", () => {
    const slots = new Map<string, Slot>([
      ["top", "S"],
      ["bottom", "E"],
    ]);
    const scheme = { cutoff: "E", intensity: "weighted" } as const;
    expect(pick(slots, scheme, () => 0)).toBe("top");
    expect(pick(slots, scheme, () => sOverE().midE)).toBe("bottom");
  });

  it("never picks the excluded (previous) artist when an alternative exists", () => {
    const slots = new Map<string, Slot>([
      ["top", "S"],
      ["bottom", "E"],
    ]);
    const scheme = { cutoff: "E", intensity: "weighted" } as const;
    // rng=0 would normally land on "top", but excluding it leaves only "bottom".
    expect(pick(slots, scheme, () => 0, "top")).toBe("bottom");
    // Excluding "bottom" leaves only "top", regardless of where rng lands.
    expect(pick(slots, scheme, () => sOverE().midE, "bottom")).toBe("top");
  });

  it("allows a repeat when the excluded artist is the only eligible one", () => {
    const slots = new Map<string, Slot>([["solo", "S"]]);
    const scheme = { cutoff: "S", intensity: "unweighted" } as const;
    // No alternative exists, so the previous pick is allowed again.
    expect(pick(slots, scheme, () => 0, "solo")).toBe("solo");
  });

  it("round-trips scheme ids and rejects invalid ones", () => {
    const scheme = { cutoff: "C", intensity: "weighted" } as const;
    expect(parseSchemeId(schemeId(scheme))).toEqual(scheme);
    expect(parseSchemeId("Z:nope")).toBeNull();
  });

  it("labels the cutoffs ('S only', 'C+', 'F+ (all ranked)', 'unrestricted', 'unranked only')", () => {
    expect(cutoffLabel("S")).toBe("S only");
    expect(cutoffLabel("C")).toBe("C+");
    expect(cutoffLabel("E")).toBe("E+");
    expect(cutoffLabel("F")).toBe("F+ (all ranked)"); // the F cutoff = every ranked tier
    expect(cutoffLabel("all")).toBe("unrestricted");
    expect(cutoffLabel("unranked")).toBe("unranked only");
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

  it("the 'all' cutoff draws from the whole roster (ranked and unranked)", () => {
    const slots = new Map<string, Slot>([
      ["ranked", "S"],
      ["loose", "unranked"],
    ]);
    // Unweighted: both weigh 1, so rng picks each half of the [0,1) range.
    const scheme = { cutoff: "all", intensity: "unweighted" } as const;
    expect(hasEligible(slots, scheme)).toBe(true);
    expect(pick(slots, scheme, () => 0)).toBe("ranked");
    expect(pick(slots, scheme, () => 0.75)).toBe("loose");
  });

  it("the 'all' cutoff weights unranked artists as the lowest occupied tier", () => {
    const slots = new Map<string, Slot>([
      ["effie", "F"],
      ["uma", "unranked"],
    ]);
    // F is occupied here, so it is the floor and an unranked artist matches it:
    // the two split the draw 50/50 and the boundary sits exactly at rng 0.5.
    const scheme = { cutoff: "all", intensity: "heavily" } as const;
    expect(pick(slots, scheme, () => 0.49)).toBe("effie");
    expect(pick(slots, scheme, () => 0.5)).toBe("uma");
  });

  it("the 'all' cutoff floors unranked artists at the bottom of the ranking, not at F", () => {
    const slots = new Map<string, Slot>([
      ["ethel", "E"],
      ["uma", "unranked"],
    ]);
    // Nobody occupies F, so the bottom of the ranking is E and an unranked artist
    // weighs what an E does — a 50/50 split. Were the floor fixed at F they would
    // weigh a quarter as much (1 against 4) and rng 0.5 would land on "ethel".
    const scheme = { cutoff: "all", intensity: "weighted" } as const;
    expect(pick(slots, scheme, () => 0.49)).toBe("ethel");
    expect(pick(slots, scheme, () => 0.5)).toBe("uma");
  });

  it("the 'all' cutoff still favours higher tiers under weighting", () => {
    const slots = new Map<string, Slot>([
      ["star", "S"],
      ["plain", "E"],
      ["loose", "unranked"],
    ]);
    // Weighted: S weighs 49 and both the E and the unranked artist (floored at E)
    // weigh 4, so S owns [0, 49) of the total 57.
    const scheme = { cutoff: "all", intensity: "weighted" } as const;
    expect(pick(slots, scheme, () => 48.5 / 57)).toBe("star");
    expect(pick(slots, scheme, () => 49.5 / 57)).toBe("plain");
    expect(pick(slots, scheme, () => 53.5 / 57)).toBe("loose");
  });

  it("round-trips an 'all' scheme id", () => {
    const scheme = { cutoff: "all", intensity: "weighted" } as const;
    expect(parseSchemeId(schemeId(scheme))).toEqual(scheme);
  });
});
