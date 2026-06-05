import { describe, expect, it } from "vitest";
import { compareArtistNames } from "./sort";

describe("compareArtistNames", () => {
  it("orders case-insensitively", () => {
    // Mixed-case names interleave by letter, not by case.
    expect(compareArtistNames("Art Brut", "ATARASHII GAKKO!")).toBeLessThan(0);
    expect(compareArtistNames("CHVRCHES", "Chumbawamba")).toBeGreaterThan(0);
    // A lowercase leading word still sorts among its capitalised neighbours.
    expect(compareArtistNames("the Colourist", "The Cranberries")).toBeLessThan(0);
  });

  it("sorts an array into canonical order regardless of case", () => {
    const arr = ["Weezer", "ABBA", "aZZ", "Bjork"];
    expect([...arr].sort(compareArtistNames)).toEqual(["ABBA", "aZZ", "Bjork", "Weezer"]);
  });
});
