// The ☁️ map's 🔍 search: matching a typed query against artist names and sound
// tags, and working out what a chosen result should light up. Pure — no DOM, no
// geometry beyond reading a computed layout — so the matching rules are unit
// tested in search.test.ts; cloud.ts renders what this module decides.

import type { CloudLayout } from "./cloud-layout";
import { compareArtistNames } from "./sort";
import type { Artist } from "./types";

/** How many characters must be typed before the autocomplete offers anything. */
export const MIN_QUERY_LENGTH = 3;

/** How many suggestions the dropdown shows at most. */
export const MAX_RESULTS = 8;

// Latin letters whose "plain" form NFD cannot reach, because their mark is baked
// into the code point rather than a combining character. `compareArtistNames`
// already treats each of these as equal to its expansion (that is what
// `sensitivity: "base"` means), so the fold has to agree — otherwise typing
// "bjork" would find Björk while typing "moller" missed Møller. Letters base
// sensitivity keeps distinct (þ, ı, ŧ) are deliberately absent.
const UNCOMBINED_LETTERS: readonly (readonly [RegExp, string])[] = [
  [/ø/g, "o"],
  [/æ/g, "ae"],
  [/œ/g, "oe"],
  [/ß/g, "ss"],
  [/ł/g, "l"],
  [/đ/g, "d"],
  [/ð/g, "d"],
  [/ħ/g, "h"],
];

/**
 * The key both a query and a candidate are matched through: case- and
 * accent-insensitive.
 *
 * This is the containment counterpart to `compareArtistNames` (sort.ts), which
 * defines what "the same string" means everywhere else in the app but is a
 * comparator and so cannot answer "does this contain that". The two must agree
 * on which characters are the same character, hence the table above.
 */
export function foldForMatch(text: string): string {
  const lowered = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return UNCOMBINED_LETTERS.reduce(
    (folded, [letter, plain]) => folded.replace(letter, plain),
    lowered,
  );
}

/** Something the map can be searched for. */
export type SearchEntry =
  | { readonly kind: "artist"; readonly label: string }
  /** A sound tag, with how many artists carry it — shown beside the suggestion. */
  | { readonly kind: "tag"; readonly label: string; readonly carriers: number };

/**
 * The searchable set with every fold precomputed, so a keystroke costs one pass
 * of scoring rather than a pass of `String.normalize` over the whole roster.
 */
export type SearchIndex = readonly { readonly entry: SearchEntry; readonly key: string }[];

/**
 * Everything searchable: one entry per artist, one per sound tag.
 *
 * Sound tags rather than all of them, because the map only groups by sound
 * (PRD §9): a region or decade names no cluster, so offering `Swedish` would
 * promise a neighbourhood that does not exist. `soundTags` also has the
 * too-broad tags already removed, which is the same argument from the other end
 * — a tag on four fifths of the roster would spotlight four fifths of the map.
 */
export function buildSearchIndex(
  artists: readonly Artist[],
  soundTags: readonly string[],
): SearchIndex {
  const carriers = new Map<string, number>();
  for (const artist of artists) {
    for (const tag of artist.soundTags) carriers.set(tag, (carriers.get(tag) ?? 0) + 1);
  }
  const artistEntries = artists.map((artist) => ({
    entry: { kind: "artist", label: artist.name } as SearchEntry,
    key: foldForMatch(artist.name),
  }));
  const tagEntries = soundTags.map((tag) => ({
    entry: { kind: "tag", label: tag, carriers: carriers.get(tag) ?? 0 } as SearchEntry,
    key: foldForMatch(tag),
  }));
  return [...artistEntries, ...tagEntries];
}

// Score tiers, 200 apart and checked below never to overlap: how the query sits
// in the candidate decides the tier, and the refinements only order results
// *within* one. A whole-word hit must never be outranked by a lucky scattering
// of the same letters, however neatly that scattering falls.
const SCORE_EXACT = 1000;
const SCORE_PREFIX = 800;
const SCORE_WORD_START = 600;
const SCORE_SUBSTRING = 400;
const SCORE_SUBSEQUENCE = 150;

// Refinements. Each is bounded so that the widest possible swing (+150 from a
// perfect subsequence, −30 from a late substring) leaves the tiers disjoint.
const LENGTH_BONUS = 50; // rewards a candidate the query nearly fills
const WORD_START_BONUS = 100; // scattered letters that each begin a word
const GAP_PENALTY = 60; // scattered letters strewn far apart
const MAX_EARLINESS_PENALTY = 30;

// A word boundary for matching purposes: the string's start, or anything that
// is not a letter or digit before it — so "punk" begins a word in "pop punk"
// and in "post-punk", but not in "cyberpunk".
const NON_WORD = /[^\p{L}\p{N}]/u;
const isWordStart = (text: string, index: number): boolean =>
  index === 0 || NON_WORD.test(text[index - 1]!);

/**
 * How well a folded query matches a folded candidate: a score to rank by, or
 * `null` when the candidate does not contain the query's characters in order at
 * all.
 *
 * Deliberately forgiving in one direction only. Every character typed must
 * appear, in sequence — so a typo that *adds* a letter finds nothing — but they
 * need not be adjacent, which is what lets "ppnk" reach "pop punk" and initials
 * reach a long name. Nothing here attempts edit distance: a matcher that
 * tolerates wrong letters, over a roster where many names differ by one, offers
 * confident nonsense.
 */
export function fuzzyMatch(query: string, candidate: string): number | null {
  if (query.length === 0) return null;

  const first = candidate.indexOf(query);
  if (first >= 0) {
    // The query survives intact somewhere. Prefer an occurrence that starts a
    // word over an earlier one buried mid-word: searching "punk" should read as
    // a hit on "pop punk" rather than on the tail of "cyberpunk".
    let best = first;
    for (let at = first; at >= 0; at = candidate.indexOf(query, at + 1)) {
      if (isWordStart(candidate, at)) {
        best = at;
        break;
      }
    }
    const tier =
      candidate.length === query.length
        ? SCORE_EXACT
        : best === 0
          ? SCORE_PREFIX
          : isWordStart(candidate, best)
            ? SCORE_WORD_START
            : SCORE_SUBSTRING;
    return tier + lengthBonus(query, candidate) - Math.min(best, MAX_EARLINESS_PENALTY);
  }

  // Scattered: take each character as early as it can be taken. Greedy rather
  // than optimal, which costs nothing here — candidates are a few words long —
  // and keeps the ranking explainable.
  let cursor = 0;
  let start = -1;
  let gaps = 0;
  let wordStarts = 0;
  for (const character of query) {
    const at = candidate.indexOf(character, cursor);
    if (at < 0) return null;
    if (start < 0) start = at;
    else if (at > cursor) gaps += 1;
    if (isWordStart(candidate, at)) wordStarts += 1;
    cursor = at + 1;
  }
  return (
    SCORE_SUBSEQUENCE +
    (WORD_START_BONUS * wordStarts) / query.length -
    (GAP_PENALTY * gaps) / query.length +
    lengthBonus(query, candidate) -
    Math.min(start, MAX_EARLINESS_PENALTY)
  );
}

// How much of the candidate the query accounts for. Without it "emo" would rank
// "emo pop" and "emocore" as well as it ranks "emo": all three are prefix hits,
// and the one the reader typed exactly should come first.
const lengthBonus = (query: string, candidate: string): number =>
  (LENGTH_BONUS * query.length) / candidate.length;

/**
 * Whether enough has been typed to suggest anything. Shared with the view, so
 * that "the dropdown is open" and "there were results" stay separate questions:
 * a query below the floor shows nothing at all, where one above it that matched
 * nothing says so.
 */
export const isSearchable = (query: string): boolean =>
  foldForMatch(query.trim()).length >= MIN_QUERY_LENGTH;

/**
 * The suggestions for a query, best first, or none at all below
 * `MIN_QUERY_LENGTH` — two characters match most of the roster, so a dropdown
 * that early is a list of everything rather than a suggestion.
 *
 * Ties break towards the tag more artists carry, then by name, so the order is
 * stable for a given roster rather than dependent on index order.
 */
export function searchTargets(
  index: SearchIndex,
  query: string,
  limit: number = MAX_RESULTS,
): SearchEntry[] {
  if (!isSearchable(query)) return [];
  const folded = foldForMatch(query.trim());
  const hits: { entry: SearchEntry; score: number }[] = [];
  for (const { entry, key } of index) {
    const score = fuzzyMatch(folded, key);
    if (score !== null) hits.push({ entry, score });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      carrierCount(b.entry) - carrierCount(a.entry) ||
      compareArtistNames(a.entry.label, b.entry.label),
  );
  return hits.slice(0, limit).map((hit) => hit.entry);
}

const carrierCount = (entry: SearchEntry): number => (entry.kind === "tag" ? entry.carriers : 0);

/** What a chosen suggestion lights up on the map. */
export interface Spotlight {
  /** The artists the query itself named: the brightest level. */
  readonly artists: ReadonlySet<string>;
  /** Indices into `layout.clusters` of every cluster holding one of them. */
  readonly clusters: ReadonlySet<number>;
}

/**
 * Resolve a suggestion to the artists and clusters it should light.
 *
 * Two levels, because a tag's carriers are rarely one neighbourhood: the
 * clusters give the answer to "where does this live on the map", the artists to
 * "which of these did I actually ask for". An artist no cluster claimed (PRD §9
 * leaves such artists unclustered rather than forcing them in) resolves to
 * itself and no cluster — it still lights, via the halo it already has.
 *
 * Reads the layout the map is drawn from rather than regrouping the roster, so
 * the spotlight can never disagree with the rings under it.
 */
export function resolveSpotlight(
  layout: CloudLayout,
  artists: readonly Artist[],
  entry: SearchEntry,
): Spotlight {
  const matched =
    entry.kind === "artist"
      ? new Set([entry.label])
      : new Set(
          artists.filter((a) => a.soundTags.includes(entry.label)).map((artist) => artist.name),
        );
  const clusters = new Set<number>();
  layout.clusters.forEach((cluster, index) => {
    if (cluster.members.some((member) => matched.has(member))) clusters.add(index);
  });
  return { artists: matched, clusters };
}
