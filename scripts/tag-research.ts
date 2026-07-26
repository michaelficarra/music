// Dev-time tool: gather outside evidence for tagging an artist (ARCHITECTURE §3).
//
// Tagging is a judgement call, but it should not be an unaided one. This script
// collects what three sources say about an artist and prints it side by side;
// the tags themselves are still written by hand, from this evidence.
//
// The sources are deliberately of two kinds:
//
//   Authoritative (structured, edited)
//     1. MusicBrainz  — country, city of origin, group-vs-person, active years.
//                       These settle the region and era tags outright.
//     2. Wikipedia    — the infobox's origin / genre / years active / members,
//                       which are edited and cited.
//   Non-authoritative (crowd folksonomy)
//     3. MusicBrainz tags and Last.fm tags — what listeners actually call the
//        artist. Far richer than the edited genre lists and far noisier; useful
//        for spotting a scene or a descriptor the encyclopedias omit, never on
//        its own.
//
// Nothing here supplies the Pandora-style *musical quality* tags (vocal style,
// mood, lyrical bent) — no source publishes those, so they remain a listening
// judgement informed by the above.
//
// This is NOT part of the app bundle. Requires Node ≥18 (global fetch).
//
// Usage:
//   npm run tag-research -- "Vampire Weekend"        # one or more artists
//   npm run tag-research -- --all                    # the whole roster
//   npm run tag-research -- --all --json > out.json  # machine-readable
//
// --all     every artist in data/artists.csv, in CSV order.
// --json    emit one JSON array instead of the human-readable blocks.
//
// Throttling: MusicBrainz asks for at most one request per second and will
// rate-limit otherwise, so requests are spaced (TAG_RESEARCH_DELAY_MS, default
// 1100). A whole-roster run therefore takes a few minutes.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv } from "../src/csv";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(HERE, "..", "data", "artists.csv");

// A descriptive User-Agent is required by MusicBrainz and Wikimedia.
const USER_AGENT = "ArtistTierList/0.1 (https://github.com/; tag research script)";

const ARTIST_COL = 0;
const TAGS_COL = 4;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const envInt = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** MusicBrainz permits one request per second; everything else is well under. */
const REQUEST_DELAY_MS = envInt("TAG_RESEARCH_DELAY_MS", 1100);

export interface TagEvidence {
  artist: string;
  currentTags: string[];
  // Every field a source may simply not record is `| undefined` rather than
  // optional: under exactOptionalPropertyTypes an absent value has to be
  // spelled out, and "the source had nothing" is exactly what it means here.
  /** MusicBrainz: the structured, authoritative facts. */
  origin: {
    country: string | undefined;
    area: string | undefined;
    city: string | undefined;
    type: string | undefined;
    began: string | undefined;
    ended: string | undefined;
  };
  /** Wikipedia infobox: edited and cited. */
  wikipedia: {
    title?: string | undefined;
    origin?: string | undefined;
    genres: string[];
    yearsActive?: string | undefined;
    members: string[];
  };
  /** Crowd folksonomy, most-voted first. */
  crowd: { musicbrainz: string[]; lastfm: string[] };
  problems: string[];
}

/** Retried on rate limits and server errors — Last.fm in particular 502s under
    a bulk run — but not on a 404, which is a real answer. */
async function fetchText(url: string, accept?: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, ...(accept === undefined ? {} : { Accept: accept }) },
    });
    if (res.ok) return res.text();
    const worthRetrying = res.status === 429 || res.status >= 500;
    if (!worthRetrying || attempt >= 2) throw new Error(`${res.status} ${url}`);
    await sleep(REQUEST_DELAY_MS * 2 ** attempt);
  }
}

const fetchJson = async (url: string): Promise<any> =>
  JSON.parse(await fetchText(url, "application/json"));

/** What we know about an artist MusicBrainz could not find: nothing. */
const NO_ORIGIN: TagEvidence["origin"] = {
  country: undefined,
  area: undefined,
  city: undefined,
  type: undefined,
  began: undefined,
  ended: undefined,
};

/** MusicBrainz: structured origin and active years, plus the raw tag votes. */
async function fromMusicBrainz(
  name: string,
): Promise<Pick<TagEvidence, "origin"> & { tags: string[] }> {
  const search = async (query: string): Promise<any> =>
    (
      await fetchJson(
        `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=1`,
      )
    ).artists?.[0];
  // Quoted first, for an exact-name hit. Names carrying Lucene punctuation
  // ("ATARASHII GAKKO!", "P!nk", "Fun.") can miss that way, so fall back to the
  // same name with the punctuation escaped and the phrase quoting dropped.
  const artist =
    (await search(`artist:"${name.replace(/["\\]/g, "")}"`)) ??
    (await search(name.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&")));
  if (artist === undefined) return { origin: NO_ORIGIN, tags: [] };
  return {
    origin: {
      country: artist.country,
      area: artist.area?.name,
      // "begin-area" is where a group formed / a person was born: the city-level
      // fact the region hierarchy wants, where MusicBrainz records one.
      city: artist["begin-area"]?.name,
      type: artist.type,
      began: artist["life-span"]?.begin,
      ended: artist["life-span"]?.end,
    },
    tags: (artist.tags ?? [])
      .filter((t: { count: number }) => t.count > 0)
      .sort((a: { count: number }, b: { count: number }) => b.count - a.count)
      .map((t: { name: string; count: number }) => `${t.name} (${t.count})`),
  };
}

/** Strip citation machinery so infobox links are genres, not the magazines
    cited for them — an unfiltered scrape returns "Paste (magazine)". */
// Self-closing refs must go first: <ref name="x"/> also matches the *opening*
// tag of the paired pattern, so removing pairs first would swallow everything
// from there to the next real </ref> — which ate the infobox's closing braces.
const stripCitations = (wikitext: string): string =>
  wikitext.replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");

/**
 * The article's first {{Infobox ...}} template, found by brace matching.
 *
 * Bounding the search this way matters: reading fields off the whole article
 * with one regex lets a field whose terminator is missed run to the end of the
 * page, which turned First Aid Kit's "genre" into every wikilink in the
 * article — 200 entries of chart positions and TV appearances.
 */
function infobox(wikitext: string): string {
  const start = wikitext.search(/\{\{\s*Infobox/i);
  if (start === -1) return "";
  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext.startsWith("{{", i)) depth += 1;
    else if (wikitext.startsWith("}}", i) && --depth === 0) return wikitext.slice(start, i);
  }
  return wikitext.slice(start);
}

/** Pull one infobox field's raw value, up to the next top-level field. */
function infoboxField(box: string, field: string): string | undefined {
  const match = new RegExp(
    `\\n *\\| *${field} *= *([\\s\\S]*?)(?=\\n *\\| *[A-Za-z0-9_ -]+ *=|$)`,
    "i",
  ).exec(box);
  return match?.[1]?.trim();
}

const wikiLinks = (value: string | undefined): string[] =>
  [...(value ?? "").matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1]!.trim());

/** Flatten wiki markup to something readable for a free-text field. */
const plainText = (value: string | undefined): string | undefined => {
  const flat = (value ?? "")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[|\]\]/g, "")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 0 ? flat : undefined;
};

const WIKI_API = "https://en.wikipedia.org/w/api.php?action=query&format=json";
const WIKI_CONTENT = "&prop=revisions&rvprop=content&rvslots=main";

/** The wikitext of one page, or undefined if the query resolved to nothing. */
async function wikitextOf(query: string): Promise<{ title: string; text: string } | undefined> {
  const result = await fetchJson(`${WIKI_API}${WIKI_CONTENT}&${query}`);
  const page: any = Object.values(result.query?.pages ?? {})[0];
  const text: string | undefined = page?.revisions?.[0]?.slots?.main?.["*"];
  return text === undefined ? undefined : { title: page.title, text };
}

/**
 * Wikipedia: the artist infobox.
 *
 * The exact title is tried first (following redirects), because a plain search
 * for a band reliably lands on a band *member* — "Talking Heads" scored David
 * Byrne, "BABYMETAL" scored a former member. Search is only the fallback, and
 * even then a page without a `genre` infobox field is rejected as the wrong
 * kind of article rather than reported as an artist with no genres.
 */
async function fromWikipedia(name: string): Promise<TagEvidence["wikipedia"]> {
  const candidates = [
    `titles=${encodeURIComponent(name)}&redirects=1`,
    `titles=${encodeURIComponent(`${name} (band)`)}&redirects=1`,
    `generator=search&gsrsearch=${encodeURIComponent(`intitle:"${name}" musician`)}&gsrlimit=1`,
  ];
  for (const candidate of candidates) {
    const page = await wikitextOf(candidate);
    if (page === undefined) continue;
    const clean = infobox(stripCitations(page.text));
    const genres = wikiLinks(infoboxField(clean, "genre"));
    const origin =
      plainText(infoboxField(clean, "origin")) ?? plainText(infoboxField(clean, "birth_place"));
    if (genres.length === 0 && origin === undefined) continue;
    return {
      title: page.title,
      origin,
      genres,
      yearsActive: plainText(infoboxField(clean, "years_active")),
      members: [
        ...wikiLinks(infoboxField(clean, "current_members")),
        ...wikiLinks(infoboxField(clean, "past_members")),
      ],
    };
  }
  return { genres: [], members: [] };
}

/**
 * Last.fm's public tag page: the most listener-driven source of all, but an
 * unofficial one — it has no key-free API, and it starts answering 406 partway
 * into a bulk run whatever User-Agent is sent. So it is strictly a bonus leg:
 * after a few consecutive refusals the run stops asking, rather than spending
 * three failed requests per artist for the rest of the roster. The crowd
 * evidence that matters is MusicBrainz's tag votes, which are reliable.
 */
let lastfmRefusals = 0;
const LASTFM_GIVE_UP_AFTER = 3;

async function fromLastfm(name: string): Promise<string[]> {
  if (lastfmRefusals >= LASTFM_GIVE_UP_AFTER) return [];
  try {
    const html = await fetchText(
      `https://www.last.fm/music/${encodeURIComponent(name).replace(/%20/g, "+")}/+tags`,
    );
    lastfmRefusals = 0;
    const tags = [...html.matchAll(/\/tag\/([a-zA-Z0-9%+._-]+)"/g)].map((m) =>
      decodeURIComponent(m[1]!.replace(/\+/g, " ")),
    );
    return [...new Set(tags)];
  } catch (error) {
    lastfmRefusals += 1;
    if (lastfmRefusals === LASTFM_GIVE_UP_AFTER) {
      console.error("  last.fm is refusing requests; skipping it for the rest of this run");
    }
    throw error;
  }
}

async function research(name: string, currentTags: string[]): Promise<TagEvidence> {
  const problems: string[] = [];
  // Each source is optional: a missing Wikipedia page or a Last.fm 404 should
  // leave the other evidence intact rather than abandoning the artist.
  const attempt = async <T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return fallback;
    }
  };

  const mb = await attempt("musicbrainz", () => fromMusicBrainz(name), {
    origin: NO_ORIGIN,
    tags: [],
  });
  await sleep(REQUEST_DELAY_MS);
  const wikipedia = await attempt("wikipedia", () => fromWikipedia(name), {
    genres: [],
    members: [],
  });
  const lastfm = await attempt("last.fm", () => fromLastfm(name), []);

  return {
    artist: name,
    currentTags,
    origin: mb.origin,
    wikipedia,
    crowd: { musicbrainz: mb.tags, lastfm },
    problems,
  };
}

function print(evidence: TagEvidence): void {
  const { origin, wikipedia, crowd } = evidence;
  const place = [origin.city, origin.area, origin.country].filter(Boolean).join(", ");
  console.log(`\n=== ${evidence.artist} ===`);
  console.log(`  now      : ${evidence.currentTags.join("; ") || "(untagged)"}`);
  console.log(
    `  MB       : ${place || "?"} | ${origin.type ?? "?"} | ${origin.began ?? "?"}–${origin.ended ?? ""}`,
  );
  console.log(`  wiki     : ${wikipedia.title ?? "(no page found)"} | ${wikipedia.origin ?? "?"}`);
  console.log(
    `  wiki yrs : ${wikipedia.yearsActive ?? "?"} | members: ${wikipedia.members.length}`,
  );
  console.log(`  wiki gen : ${wikipedia.genres.join(", ") || "-"}`);
  console.log(`  MB tags  : ${crowd.musicbrainz.join(", ") || "-"}`);
  console.log(`  last.fm  : ${crowd.lastfm.slice(0, 20).join(", ") || "-"}`);
  for (const problem of evidence.problems) console.log(`  ! ${problem}`);
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const names = args.filter((a) => !a.startsWith("--"));

const rows = parseCsv(readFileSync(CSV_PATH, "utf8"))
  .slice(1)
  .filter((r) => (r[ARTIST_COL] ?? "").length > 0);
const tagsOf = new Map(
  rows.map((r) => [r[ARTIST_COL]!, (r[TAGS_COL] ?? "").split(";").filter(Boolean)]),
);

const targets = args.includes("--all") ? [...tagsOf.keys()] : names;
if (targets.length === 0) {
  console.error('usage: npm run tag-research -- "<artist>" [...] | --all [--json]');
  process.exit(1);
}

const unknown = targets.filter((name) => !tagsOf.has(name));
if (unknown.length > 0) {
  console.error(`not in data/artists.csv: ${unknown.join(", ")}`);
  process.exit(1);
}

const collected: TagEvidence[] = [];
for (const [i, name] of targets.entries()) {
  if (!asJson) console.error(`[${i + 1}/${targets.length}] ${name}`);
  const evidence = await research(name, tagsOf.get(name)!);
  collected.push(evidence);
  if (!asJson) print(evidence);
  if (i < targets.length - 1) await sleep(REQUEST_DELAY_MS);
}
if (asJson) console.log(JSON.stringify(collected, null, 2));
