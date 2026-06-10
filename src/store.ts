// Local-storage-backed arrangement state.
//
// The CSV provides the immutable baseline (roster, images, shipped tiers). This
// module layers user tier changes on top, persists them, computes whether the
// arrangement differs from the baseline (to drive Reset/Save), and serialises
// the current arrangement back to CSV for the clipboard "Save".

import { baselineByName, originalRows, COLUMN } from "./data";
import { serializeCsv } from "./csv";
import { isFilterMode, type FilterMode } from "./filter";
import { compareArtistNames } from "./sort";
import { UNRANKED, isTier, type Slot } from "./types";

const STORAGE_KEY = "artist-tier-list:v1";
const SCHEME_KEY = "artist-tier-list:scheme";
const PICKED_KEY = "artist-tier-list:picked";
const FILTER_KEY = "artist-tier-list:filters";
const FILTER_MODE_KEY = "artist-tier-list:filter-mode";

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
    // Track whether the stored set carried any entries we won't keep, so we can
    // prune them from storage below rather than leave stale data lying around.
    let stale = false;
    for (const [name, slot] of Object.entries(parsed.assignments)) {
      // Ignore overrides for unknown artists, invalid slots, or no-op (== baseline).
      if (!baselineByName.has(name) || !isSlot(slot)) {
        stale = true;
        continue;
      }
      // A saved assignment equal to the current baseline value is redundant; drop it.
      if (slot === baselineByName.get(name)) {
        stale = true;
        continue;
      }
      overrides.set(name, slot);
    }
    // Rewrite (or clear) storage so redundant assignments matching the current
    // value don't linger across reloads.
    if (stale) persist();
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

/** Has this artist been moved off its baseline (shipped) tier? */
export function isMoved(name: string): boolean {
  return overrides.has(name);
}

/** A single artist whose current slot differs from its baseline (shipped) slot. */
export interface SlotChange {
  name: string;
  baseline: Slot; // shipped tier from the CSV
  current: Slot; // locally assigned tier
}

/**
 * The changed artists (current slot differs from baseline), in canonical name
 * order. Drives the diff shown in the Reset/Save confirmation modals.
 */
export function getChanges(): SlotChange[] {
  const changes: SlotChange[] = [];
  for (const [name, current] of overrides) {
    changes.push({ name, baseline: baselineByName.get(name) ?? UNRANKED, current });
  }
  return changes.sort((a, b) => compareArtistNames(a.name, b.name));
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
      // Pad short rows so every column exists and the export stays rectangular.
      while (r.length <= COLUMN.tags) r.push("");
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

/** The tags selected in the 🎲 filter panel (a JSON string array; [] when unset). */
export function loadFilterTags(): string[] {
  const raw = localStorage.getItem(FILTER_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return []; // corrupt storage: fall back to no filter
  }
}

export function saveFilterTags(tags: readonly string[]): void {
  if (tags.length === 0) localStorage.removeItem(FILTER_KEY);
  else localStorage.setItem(FILTER_KEY, JSON.stringify(tags));
}

/** How the 🎲 filter combines its tags: "any" (the default) or "all". */
export function loadFilterMode(): FilterMode {
  const raw = localStorage.getItem(FILTER_MODE_KEY);
  return raw !== null && isFilterMode(raw) ? raw : "any";
}

export function saveFilterMode(mode: FilterMode): void {
  if (mode === "any")
    localStorage.removeItem(FILTER_MODE_KEY); // the default
  else localStorage.setItem(FILTER_MODE_KEY, mode);
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
