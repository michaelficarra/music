// Tag filtering for the 🎲 picker: an artist matches either ALL of the selected
// tags or ANY of them, per the panel's mode toggle. Pure logic, shared by the
// picker eligibility (main.ts) and the board's dimming of non-matching cards
// (board.ts).

import type { Artist } from "./types";

/** How selected tags combine: an artist must carry every tag, or at least one. */
export type FilterMode = "all" | "any";

export const FILTER_MODES: readonly FilterMode[] = ["all", "any"];

/** Narrowing guard: is an arbitrary string a filter mode? */
export function isFilterMode(value: string): value is FilterMode {
  return (FILTER_MODES as readonly string[]).includes(value);
}

/**
 * Does the artist match the selection under `mode`? An empty selection matches
 * every artist in both modes — no filter is active.
 */
export function matchesTags(
  artist: Artist,
  selected: ReadonlySet<string>,
  mode: FilterMode,
): boolean {
  if (selected.size === 0) return true;
  const carries = (tag: string): boolean => artist.tags.includes(tag);
  return mode === "all" ? [...selected].every(carries) : [...selected].some(carries);
}
