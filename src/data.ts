// The static baseline: the artist roster, images, and shipped tier assignments,
// read from data/artists.csv embedded at build time.

import csvText from "../data/artists.csv?raw";
import { parseCsv } from "./csv";
import { compareArtistNames } from "./sort";
import { UNRANKED, isTier, type Artist, type Slot } from "./types";

/** Column order in data/artists.csv (see ARCHITECTURE §3). */
export const COLUMN = {
  artist: 0,
  tier: 1,
  imageURL: 2,
  imageSource: 3,
  tags: 4,
} as const;

const rows = parseCsv(csvText);

/**
 * The original parsed rows (including the header), kept verbatim so that the
 * clipboard "Save" can update only the Tier column while preserving row order
 * and every other column.
 */
export const originalRows: readonly (readonly string[])[] = rows;

const bodyRows = rows.slice(1).filter((r) => (r[COLUMN.artist] ?? "").length > 0);

/** The artist roster, in CSV order. */
export const artists: readonly Artist[] = bodyRows.map((r) => {
  const tierRaw = (r[COLUMN.tier] ?? "").trim();
  const baselineSlot: Slot = isTier(tierRaw) ? tierRaw : UNRANKED;
  return {
    name: r[COLUMN.artist] ?? "",
    baselineSlot,
    imageURL: r[COLUMN.imageURL] ?? "",
    imageSource: r[COLUMN.imageSource] ?? "",
    // Semicolon-delimited in the CSV; blank (e.g. a freshly added artist) → [].
    tags: (r[COLUMN.tags] ?? "")
      .split(";")
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  };
});

/** Baseline slot for each artist, keyed by name. */
export const baselineByName: ReadonlyMap<string, Slot> = new Map(
  artists.map((a) => [a.name, a.baselineSlot]),
);

/**
 * Every distinct tag in the roster, for the 🎲 filter panel. Sorted with the
 * same case-insensitive compare as artist names, so mixed-case tags (proper
 * nouns, acronyms) interleave naturally instead of grouping by capitalisation.
 */
export const allTags: readonly string[] = [...new Set(artists.flatMap((a) => a.tags))].sort(
  compareArtistNames,
);
