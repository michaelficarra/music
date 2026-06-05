// Dev-time tool: add a new artist to data/artists.csv as unranked, then enrich
// just that artist (reusing scripts/enrich-images.ts).
//
//   npm run add-artist -- "Artist Name"
//
// The artist is appended with a blank Tier/ImageURL/ImageSource and then the
// enrichment script is invoked with --artist to fill in the image.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, serializeCsv } from "../src/csv";
import { compareArtistNames } from "../src/sort";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, "..", "data", "artists.csv");
const ARTIST_COL = 0;

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error('Usage: npm run add-artist -- "<artist name>"');
  process.exit(1);
}

const rows = parseCsv(readFileSync(CSV_PATH, "utf8"));
const exists = rows.slice(1).some((r) => (r[ARTIST_COL] ?? "") === name);
if (exists) {
  console.error(`"${name}" is already in the list; nothing to add.`);
  process.exit(1);
}

// Add as unranked (Artist, Tier, ImageURL, ImageSource — last three blank) and
// keep the list sorted by artist name.
const header = rows[0] ?? ["Artist", "Tier", "ImageURL", "ImageSource"];
const body = rows.slice(1).filter((r) => (r[ARTIST_COL] ?? "").length > 0);
body.push([name, "", "", ""]);
body.sort((a, b) => compareArtistNames(a[ARTIST_COL] ?? "", b[ARTIST_COL] ?? ""));
writeFileSync(CSV_PATH, serializeCsv([header, ...body]), "utf8");
console.log(`Added "${name}" (unranked). Enriching…\n`);

// Enrich only this artist, reusing the enrichment CLI; show its output live.
execFileSync("npx", ["tsx", join(HERE, "enrich-images.ts"), "--artist", name], {
  stdio: "inherit",
});
