// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./store";
import { parseCsv } from "./csv";
import { artists, originalRows, COLUMN } from "./data";
import { compareArtistNames } from "./sort";
import { UNRANKED, type Slot } from "./types";

// Two real artists from the roster, with their shipped baseline slots (which may
// be any tier or unranked — the tests derive expectations from the data).
const A = artists[0]!.name;
const ABASE = artists[0]!.baselineSlot;
const B = artists[1]!.name;
const BBASE = artists[1]!.baselineSlot;
const STORAGE_KEY = "artist-tier-list:v1";

// A slot guaranteed to differ from a given baseline (so setSlot marks a change).
const otherSlot = (base: Slot): Slot => (base === "S" ? "A" : "S");

beforeEach(() => {
  localStorage.clear();
  store.reset();
});

describe("store", () => {
  it("falls back to the baseline before any change", () => {
    expect(store.currentSlot(A)).toBe(ABASE);
    expect(store.isChanged()).toBe(false);
  });

  it("overrides a slot and marks the arrangement changed", () => {
    const target = otherSlot(ABASE);
    store.setSlot(A, target);
    expect(store.currentSlot(A)).toBe(target);
    expect(store.isChanged()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toContain(A);
  });

  it("drops an override that returns to the baseline", () => {
    store.setSlot(A, otherSlot(ABASE));
    store.setSlot(A, ABASE); // back to baseline
    expect(store.isChanged()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("reset clears overrides and storage", () => {
    store.setSlot(A, otherSlot(ABASE));
    store.reset();
    expect(store.isChanged()).toBe(false);
    expect(store.currentSlot(A)).toBe(ABASE);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("getChanges lists changed artists (name, baseline, current) in name order", () => {
    expect(store.getChanges()).toEqual([]); // nothing changed yet

    const aTarget = otherSlot(ABASE);
    const bTarget = otherSlot(BBASE);
    store.setSlot(A, aTarget);
    store.setSlot(B, bTarget);

    const changes = store.getChanges();
    expect(changes).toHaveLength(2);
    // Each entry carries the shipped baseline and the locally assigned slot.
    expect(changes).toContainEqual({ name: A, baseline: ABASE, current: aTarget });
    expect(changes).toContainEqual({ name: B, baseline: BBASE, current: bTarget });
    // Sorted by canonical name order.
    const names = changes.map((c) => c.name);
    expect(names).toEqual([...names].sort(compareArtistNames));
  });

  it("getChanges drops an artist returned to its baseline", () => {
    store.setSlot(A, otherSlot(ABASE));
    store.setSlot(A, ABASE);
    expect(store.getChanges()).toEqual([]);
  });

  it("toCSV updates only the Tier column, preserving other columns", () => {
    const target = otherSlot(ABASE); // always a ranked tier (S or A)
    store.setSlot(A, target);
    const rows = parseCsv(store.toCSV());

    expect(rows[0]).toEqual(["Artist", "Tier", "ImageURL", "ImageSource", "Tags"]);
    expect(rows.length).toBe(artists.length + 1); // header + full roster, no extra rows

    const rowA = rows.find((r) => r[0] === A)!;
    expect(rowA[1]).toBe(target);

    // The Tags column survives the export verbatim.
    const originalA = originalRows.find((r) => r[COLUMN.artist] === A)!;
    expect(rowA[COLUMN.tags]).toBe(originalA[COLUMN.tags] ?? "");

    // An untouched artist keeps its baseline tier (blank when unranked).
    const rowB = rows.find((r) => r[0] === B)!;
    expect(rowB[1]).toBe(BBASE === UNRANKED ? "" : BBASE);
  });

  it("exports the data rows sorted by artist name", () => {
    store.setSlot(A, otherSlot(ABASE));
    const names = parseCsv(store.toCSV())
      .slice(1)
      .map((r) => r[0] ?? "");
    expect(names).toEqual([...names].sort(compareArtistNames));
  });

  it("prunes saved assignments matching the current value on load", async () => {
    // Seed storage with one redundant assignment (== baseline) alongside a
    // genuine override, then re-import so the module's load() runs against it.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        assignments: { [A]: ABASE, [B]: otherSlot(BBASE) },
      }),
    );
    vi.resetModules();
    await import("./store");

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      assignments: Record<string, Slot>;
    };
    expect(stored.assignments).not.toHaveProperty(A); // redundant entry pruned
    expect(stored.assignments[B]).toBe(otherSlot(BBASE)); // genuine override kept
  });

  it("clears storage on load when every saved assignment matches the current value", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, assignments: { [A]: ABASE, [B]: BBASE } }),
    );
    vi.resetModules();
    await import("./store");

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("leaves storage untouched on load when nothing is redundant", async () => {
    const payload = JSON.stringify({
      version: 1,
      assignments: { [A]: otherSlot(ABASE) },
    });
    localStorage.setItem(STORAGE_KEY, payload);
    vi.resetModules();
    await import("./store");

    // No stale entries → no rewrite. The single genuine override survives.
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      assignments: Record<string, Slot>;
    };
    expect(stored.assignments[A]).toBe(otherSlot(ABASE));
  });

  it("remembers the last-used scheme id", () => {
    store.saveSchemeId("C:weighted");
    expect(store.loadSchemeId()).toBe("C:weighted");
  });

  it("remembers the last picked artist name", () => {
    expect(store.loadPickedName()).toBeNull();
    store.savePickedName("Radiohead");
    expect(store.loadPickedName()).toBe("Radiohead");
  });
});
