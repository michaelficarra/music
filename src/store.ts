// Local-storage-backed arrangement state.
//
// The CSV provides the immutable baseline (roster, images, shipped tiers). This
// module layers user tier changes on top, persists them, computes whether the
// arrangement differs from the baseline (to drive Reset/Save), and serialises
// the current arrangement back to CSV for the clipboard "Save".

import { baselineByName, originalRows, COLUMN } from "./data";
import { serializeCsv } from "./csv";
import { compareArtistNames } from "./sort";
import { UNRANKED, isTier, type Slot } from "./types";

const STORAGE_KEY = "artist-tier-list:v1";
const SCHEME_KEY = "artist-tier-list:scheme";
const PICKED_KEY = "artist-tier-list:picked";

interface Persisted {
  version: 1;
  assignments: Record<string, Slot>;
}

/**
 * Tier overrides that differ from the baseline, keyed by artist name. Only
 * genuine differences live here (an override equal to baseline is removed), so
 * `overrides.size > 0` is exactly "the arrangement has changed".
 */
const overrides = new Map<string, Slot>();

function isSlot(value: unknown): value is Slot {
  return value === UNRANKED || (typeof value === "string" && isTier(value));
}

function load(): void {
  overrides.clear();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return;
  try {
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (
      parsed.version !== 1 ||
      typeof parsed.assignments !== "object" ||
      parsed.assignments === null
    ) {
      return;
    }
    for (const [name, slot] of Object.entries(parsed.assignments)) {
      // Ignore overrides for unknown artists, invalid slots, or no-op (== baseline).
      if (!baselineByName.has(name) || !isSlot(slot)) continue;
      if (slot === baselineByName.get(name)) continue;
      overrides.set(name, slot);
    }
  } catch {
    // Corrupt storage: ignore and fall back to the baseline.
  }
}

function persist(): void {
  if (overrides.size === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const assignments: Record<string, Slot> = {};
  for (const [name, slot] of overrides) assignments[name] = slot;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, assignments } satisfies Persisted),
  );
}

/** The artist's current slot: override if present, else baseline, else unranked. */
export function currentSlot(name: string): Slot {
  return overrides.get(name) ?? baselineByName.get(name) ?? UNRANKED;
}

/** Move an artist to a slot and persist. Overrides equal to baseline are dropped. */
export function setSlot(name: string, slot: Slot): void {
  const baseline = baselineByName.get(name) ?? UNRANKED;
  if (slot === baseline) {
    overrides.delete(name);
  } else {
    overrides.set(name, slot);
  }
  persist();
}

/** Does the current arrangement differ from the baseline (tier membership)? */
export function isChanged(): boolean {
  return overrides.size > 0;
}

/** Discard local changes, reverting to the baseline. */
export function reset(): void {
  overrides.clear();
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Serialise the current arrangement to CSV: every column preserved, only the
 * Tier column updated (blank for unranked), with the data rows sorted by artist
 * name so the file stays in its canonical order.
 */
export function toCSV(): string {
  const header = originalRows[0] ?? [];
  const body = originalRows
    .slice(1)
    .map((row) => {
      const r = [...row];
      const name = r[COLUMN.artist] ?? "";
      // Pad short rows so the Tier column always exists.
      while (r.length <= COLUMN.imageSource) r.push("");
      if (name.length > 0) {
        const slot = currentSlot(name);
        r[COLUMN.tier] = slot === UNRANKED ? "" : slot;
      }
      return r;
    })
    .sort((a, b) => compareArtistNames(a[COLUMN.artist] ?? "", b[COLUMN.artist] ?? ""));
  return serializeCsv([header, ...body]);
}

/** Last-used random-picker scheme id, if any. */
export function loadSchemeId(): string | null {
  return localStorage.getItem(SCHEME_KEY);
}

export function saveSchemeId(id: string): void {
  localStorage.setItem(SCHEME_KEY, id);
}

/** The artist most recently chosen by the 🎲 picker, persisted until the next pick. */
export function loadPickedName(): string | null {
  return localStorage.getItem(PICKED_KEY);
}

export function savePickedName(name: string): void {
  localStorage.setItem(PICKED_KEY, name);
}

// Hydrate overrides from local storage on first import.
load();
