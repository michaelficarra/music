// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { parseCsv } from "./csv";
import { artists } from "./data";
import { compareArtistNames } from "./sort";

// Use two real artists from the roster; all ship as unranked (blank Tier).
const A = artists[0]!.name;
const B = artists[1]!.name;
const STORAGE_KEY = "artist-tier-list:v1";

beforeEach(() => {
  localStorage.clear();
  store.reset();
});

describe("store", () => {
  it("falls back to the baseline (unranked) before any change", () => {
    expect(store.currentSlot(A)).toBe("unranked");
    expect(store.isChanged()).toBe(false);
  });

  it("overrides a slot and marks the arrangement changed", () => {
    store.setSlot(A, "S");
    expect(store.currentSlot(A)).toBe("S");
    expect(store.isChanged()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toContain(A);
  });

  it("drops an override that returns to the baseline", () => {
    store.setSlot(A, "S");
    store.setSlot(A, "unranked"); // back to baseline
    expect(store.isChanged()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("reset clears overrides and storage", () => {
    store.setSlot(A, "B");
    store.reset();
    expect(store.isChanged()).toBe(false);
    expect(store.currentSlot(A)).toBe("unranked");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("toCSV updates only the Tier column, preserving other columns", () => {
    store.setSlot(A, "S");
    const rows = parseCsv(store.toCSV());

    expect(rows[0]).toEqual(["Artist", "Tier", "ImageURL", "ImageSource"]);
    expect(rows.length).toBe(artists.length + 1); // header + full roster, no extra rows

    const rowA = rows.find((r) => r[0] === A)!;
    expect(rowA[1]).toBe("S");

    const rowB = rows.find((r) => r[0] === B)!;
    expect(rowB[1]).toBe(""); // untouched artist stays unranked (blank)
  });

  it("exports the data rows sorted by artist name", () => {
    store.setSlot(A, "S");
    const names = parseCsv(store.toCSV())
      .slice(1)
      .map((r) => r[0] ?? "");
    expect(names).toEqual([...names].sort(compareArtistNames));
  });

  it("remembers the last-used scheme id", () => {
    store.saveSchemeId("C:weighted");
    expect(store.loadSchemeId()).toBe("C:weighted");
  });
});
