// Tag filtering for the 🎲 picker: an artist matches when it carries every
// selected tag. Pure logic, shared by the picker eligibility (main.ts) and the
// board's dimming of non-matching cards (board.ts).

import type { Artist } from "./types";

/** Does the artist carry every selected tag? Vacuously true for an empty selection. */
export function matchesAllTags(artist: Artist, selected: ReadonlySet<string>): boolean {
  for (const tag of selected) {
    if (!artist.tags.includes(tag)) return false;
  }
  return true;
}
