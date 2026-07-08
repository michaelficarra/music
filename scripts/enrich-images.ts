// Dev-time tool: populate the ImageURL / ImageSource columns of data/artists.csv.
//
// For each artist with a blank ImageURL (or all artists with --force), it tries
// providers in order, stopping at the first hit, and records which provider won:
//
//   1. Apple Music   (iTunes Search → artist page og:image)
//   2. MusicBrainz   (artist → image relationship, resolved to a direct URL)
//   3. YouTube Music (search page og:image, best-effort)
//   4. Wikipedia     (REST page summary thumbnail; last — most collision-prone)
//
// This is NOT part of the app bundle. Requires Node ≥18 (global fetch).
//
// Usage:
//   npm run enrich                                  # fill blank rows (bulk)
//   npm run enrich -- --force                       # re-fetch every artist
//   npm run enrich -- --artist "Korn"               # (re)fetch one artist
//   npm run enrich -- --artist "Korn" --disable apple-music,musicbrainz
//                                                   # one artist, skipping providers
//
// --artist <name>   process only that artist, always re-fetching it.
// --disable <keys>  comma-separated provider keys to skip (apple-music,
//                   musicbrainz, youtube-music, wikipedia).
// --force           in bulk mode, re-fetch artists that already have a URL.
//
// Throttling (env vars, useful for large bulk re-fetches that trip provider
// rate limits — Apple's iTunes Search in particular starts returning 429/403):
//   ENRICH_DELAY_MS    pause between artists (default 300).
//   ENRICH_MAX_RETRIES retries on a 429/403 before giving up on a provider
//                      and falling through to the next one (default 3).
//   ENRICH_BACKOFF_MS  base back-off for the first retry; doubles each retry
//                      and honours a Retry-After header when present (default 8000).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, serializeCsv } from "../src/csv";
import { toThumbnail } from "./thumbnail";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, "..", "data", "artists.csv");

// A descriptive User-Agent is required by MusicBrainz and Wikimedia.
const USER_AGENT = "ArtistTierList/0.1 (https://github.com/; image enrichment script)";

const COLUMN = { artist: 0, tier: 1, imageURL: 2, imageSource: 3, tags: 4 } as const;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Read a non-negative integer env var, falling back to a default if unset/invalid.
const envInt = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

// Pause between artists in bulk mode. Overridable so a large re-fetch can space
// requests out enough to stay under provider rate limits.
const ARTIST_DELAY_MS = envInt("ENRICH_DELAY_MS", 300);
const MAX_RETRIES = envInt("ENRICH_MAX_RETRIES", 3);
const BACKOFF_BASE_MS = envInt("ENRICH_BACKOFF_MS", 8000);
// Statuses that mean "you're going too fast" rather than "no such resource":
// worth waiting out and retrying instead of falling straight through.
const RATE_LIMIT_STATUSES = new Set([429, 403]);

interface Found {
  url: string;
  source: string;
}

// fetch() wrapper that retries on rate-limit responses with exponential back-off
// (honouring Retry-After when the server sends it). Non-rate-limit responses —
// including genuine 404s — are returned as-is for the caller to handle.
async function fetchWithBackoff(url: string, headers: Record<string, string>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok || !RATE_LIMIT_STATUSES.has(res.status) || attempt >= MAX_RETRIES) {
      return res;
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : BACKOFF_BASE_MS * 2 ** attempt;
    console.warn(
      `  rate-limited (${res.status}) on ${url}; backing off ${Math.round(waitMs / 1000)}s ` +
        `(retry ${attempt + 1}/${MAX_RETRIES})`,
    );
    await sleep(waitMs);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetchWithBackoff(url, { "User-Agent": USER_AGENT, Accept: "application/json" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetchWithBackoff(url, { "User-Agent": USER_AGENT });
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

// MusicBrainz: search for the artist, then follow its "image" relationship.
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

// Wikipedia: page summary thumbnail.
async function fromWikipedia(name: string): Promise<Found | null> {
  const title = encodeURIComponent(name.replace(/ /g, "_"));
  const summary = (await fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`,
  )) as {
    originalimage?: { source: string };
    thumbnail?: { source: string };
  };
  const url = summary.originalimage?.source ?? summary.thumbnail?.source;
  return url ? { url, source: "wikipedia" } : null;
}

// Apple Music via the public iTunes Search API → artist page artwork.
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

// YouTube Music search page og:image (best-effort, brittle).
async function fromYouTubeMusic(name: string): Promise<Found | null> {
  return scrapeOgImage(
    `https://music.youtube.com/search?q=${encodeURIComponent(name)}`,
    "youtube-music",
  );
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

interface Provider {
  /** Stable key, also the value written to ImageSource. Used by --disable. */
  key: string;
  fn: (name: string) => Promise<Found | null>;
}

// Ordered fallback chain. Keys match the ImageSource value each provider writes.
// Apple Music first: its artist images are subject-correct (matched in Apple's
// music catalogue) and avoid the name-collision pitfalls of article-title lookups.
// Wikipedia is last: title lookups are the most collision-prone (e.g. "Ra", "Stars").
const PROVIDERS: Provider[] = [
  { key: "apple-music", fn: fromAppleMusic },
  { key: "musicbrainz", fn: fromMusicBrainz },
  { key: "youtube-music", fn: fromYouTubeMusic },
  { key: "wikipedia", fn: fromWikipedia },
];

async function enrich(name: string, disabled: ReadonlySet<string>): Promise<Found | null> {
  for (const { key, fn } of PROVIDERS) {
    if (disabled.has(key)) continue;
    try {
      const found = await fn(name);
      // Prefer a smaller/thumbnail form of the image where the host supports it.
      if (found) return { url: toThumbnail(found.url), source: found.source };
    } catch (err) {
      console.warn(`  ${key} failed for "${name}": ${(err as Error).message}`);
    }
  }
  return null;
}

interface Args {
  /** Restrict to a single artist by exact name (and always re-fetch it). */
  artist: string | null;
  /** Provider keys to skip in the fallback chain. */
  disabled: Set<string>;
  /** Re-fetch even artists that already have an ImageURL (bulk mode). */
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { artist: null, disabled: new Set(), force: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--force") {
      args.force = true;
    } else if (flag === "--artist") {
      args.artist = argv[++i] ?? null;
    } else if (flag === "--disable") {
      const value = argv[++i] ?? "";
      for (const key of value.split(",")) if (key.trim()) args.disabled.add(key.trim());
    }
  }
  return args;
}

async function main(): Promise<void> {
  const { artist, disabled, force } = parseArgs(process.argv.slice(2));
  if (disabled.size > 0) console.log(`Disabled providers: ${[...disabled].join(", ")}`);

  const rows = parseCsv(readFileSync(CSV_PATH, "utf8"));
  // Persist after each fill so progress survives an interruption (rate limits,
  // Ctrl-C) rather than being lost when only written at the very end.
  const flush = (): void => writeFileSync(CSV_PATH, serializeCsv(rows), "utf8");

  let filled = 0;
  let matched = false;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const name = row[COLUMN.artist] ?? "";
    if (name.length === 0) continue;
    while (row.length <= COLUMN.tags) row.push("");

    if (artist !== null) {
      // Single-artist mode: process only this artist, always (re)fetching it.
      if (name !== artist) continue;
      matched = true;
    } else if (!force && (row[COLUMN.imageURL] ?? "").length > 0) {
      // Bulk mode: leave already-filled rows alone unless --force.
      continue;
    }

    const found = await enrich(name, disabled);
    if (found) {
      row[COLUMN.imageURL] = found.url;
      row[COLUMN.imageSource] = found.source;
      filled++;
      flush(); // write incrementally so partial progress is never lost
      console.log(`✓ ${name} → ${found.source}`);
    } else {
      console.log(`· ${name} → (no image found)`);
    }
    await sleep(ARTIST_DELAY_MS); // Be polite between artists (see ENRICH_DELAY_MS).
  }

  if (artist !== null && !matched) {
    console.error(`Artist not found in CSV: "${artist}"`);
    process.exit(2);
  }

  console.log(`\nDone. Filled ${filled} image(s); wrote ${CSV_PATH}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
