// Dev-time tool: populate the ImageURL / ImageSource columns of data/artists.csv.
//
// For each artist with a blank ImageURL (or all artists with --force), it tries
// providers in order, stopping at the first hit, and records which provider won:
//
//   1. MusicBrainz      (artist → image relationship, resolved to a direct URL)
//   2. Wikipedia        (REST page summary thumbnail)
//   3. Discogs          (artist search cover image; needs DISCOGS_TOKEN)
//   4. Streaming        (Apple Music via iTunes Search; YouTube Music og:image)
//
// This is NOT part of the app bundle. Run with:  npm run enrich  [-- --force]
// Requires Node ≥18 (global fetch). Set DISCOGS_TOKEN in the environment to
// enable the Discogs tier.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, serializeCsv } from "../src/csv";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, "..", "data", "artists.csv");

// A descriptive User-Agent is required by MusicBrainz and Wikimedia.
const USER_AGENT = "ArtistTierList/0.1 (https://github.com/; image enrichment script)";

const COLUMN = { artist: 0, tier: 1, imageURL: 2, imageSource: 3 } as const;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Found {
  url: string;
  source: string;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** Resolve a Wikimedia Commons "File:" page to a direct image URL. */
function resolveCommons(resource: string): string {
  const match = resource.match(/commons\.wikimedia\.org\/wiki\/(File:.+)$/);
  if (match) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${match[1]!.slice("File:".length)}`;
  }
  return resource;
}

// 1. MusicBrainz: search for the artist, then follow its "image" relationship.
async function fromMusicBrainz(name: string): Promise<Found | null> {
  const query = encodeURIComponent(`artist:"${name}"`);
  const search = (await fetchJson(
    `https://musicbrainz.org/ws/2/artist/?query=${query}&fmt=json&limit=1`,
  )) as { artists?: { id: string }[] };
  const id = search.artists?.[0]?.id;
  if (!id) return null;
  await sleep(1100); // MusicBrainz asks for ≤1 request/second.

  const detail = (await fetchJson(
    `https://musicbrainz.org/ws/2/artist/${id}?inc=url-rels&fmt=json`,
  )) as { relations?: { type: string; url?: { resource: string } }[] };
  const rel = detail.relations?.find((r) => r.type === "image" && r.url?.resource);
  if (!rel?.url?.resource) return null;
  return { url: resolveCommons(rel.url.resource), source: "musicbrainz" };
}

// 2. Wikipedia: page summary thumbnail.
async function fromWikipedia(name: string): Promise<Found | null> {
  const title = encodeURIComponent(name.replace(/ /g, "_"));
  const summary = (await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`)) as {
    originalimage?: { source: string };
    thumbnail?: { source: string };
  };
  const url = summary.originalimage?.source ?? summary.thumbnail?.source;
  return url ? { url, source: "wikipedia" } : null;
}

// 3. Discogs: artist search cover image (requires a token).
async function fromDiscogs(name: string): Promise<Found | null> {
  const token = process.env.DISCOGS_TOKEN;
  if (!token) return null;
  const q = encodeURIComponent(name);
  const data = (await fetchJson(
    `https://api.discogs.com/database/search?q=${q}&type=artist&per_page=1&token=${token}`,
  )) as { results?: { cover_image?: string; thumb?: string }[] };
  const hit = data.results?.[0];
  const url = hit?.cover_image ?? hit?.thumb;
  return url ? { url, source: "discogs" } : null;
}

// 4a. Apple Music via the public iTunes Search API (album/track artwork).
async function fromAppleMusic(name: string): Promise<Found | null> {
  const term = encodeURIComponent(name);
  const data = (await fetchJson(
    `https://itunes.apple.com/search?term=${term}&entity=musicArtist&limit=1&media=music`,
  )) as { results?: { artistLinkUrl?: string }[] };
  const link = data.results?.[0]?.artistLinkUrl;
  if (!link) return null;
  // The artist page exposes an og:image we can scrape.
  return scrapeOgImage(link, "apple-music");
}

// 4b. YouTube Music search page og:image (best-effort, brittle).
async function fromYouTubeMusic(name: string): Promise<Found | null> {
  return scrapeOgImage(`https://music.youtube.com/search?q=${encodeURIComponent(name)}`, "youtube-music");
}

async function scrapeOgImage(pageUrl: string, source: string): Promise<Found | null> {
  try {
    const html = await fetchText(pageUrl);
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    return match?.[1] ? { url: match[1], source } : null;
  } catch {
    return null;
  }
}

const PROVIDERS: ((name: string) => Promise<Found | null>)[] = [
  fromMusicBrainz,
  fromWikipedia,
  fromDiscogs,
  fromAppleMusic,
  fromYouTubeMusic,
];

async function enrich(name: string): Promise<Found | null> {
  for (const provider of PROVIDERS) {
    try {
      const found = await provider(name);
      if (found) return found;
    } catch (err) {
      console.warn(`  ${provider.name} failed for "${name}": ${(err as Error).message}`);
    }
  }
  return null;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const rows = parseCsv(readFileSync(CSV_PATH, "utf8"));

  let filled = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const name = row[COLUMN.artist] ?? "";
    if (name.length === 0) continue;
    while (row.length <= COLUMN.imageSource) row.push("");

    if (!force && (row[COLUMN.imageURL] ?? "").length > 0) continue;

    const found = await enrich(name);
    if (found) {
      row[COLUMN.imageURL] = found.url;
      row[COLUMN.imageSource] = found.source;
      filled++;
      console.log(`✓ ${name} → ${found.source}`);
    } else {
      console.log(`· ${name} → (no image found)`);
    }
    await sleep(300); // Be polite between artists.
  }

  writeFileSync(CSV_PATH, serializeCsv(rows), "utf8");
  console.log(`\nDone. Filled ${filled} image(s); wrote ${CSV_PATH}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
