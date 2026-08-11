// The tag vocabulary, read from data/tags.csv and embedded at build time
// alongside the roster itself (ARCHITECTURE §3a).
//
// The file declares *every* tag and its category — about a third of the rows
// derive nothing, and exist purely so the tag has a category for the 🎲 panel to
// group it under. Where tags do relate, a row also names the more general tags
// **derived** from it.
//
// data/artists.csv carries only the tags an artist is actually *given* — the
// most specific genre, the most specific place. The more general ones (a Swedish
// artist is also Scandinavian, Nordic and European; a pop punk band also plays
// punk rock and rock) are derived here rather than written out, so the hierarchy
// is edited in one file instead of 253 rows.

import registryText from "../data/tags.csv?raw";
import { parseCsv } from "./csv";

/** Column order in data/tags.csv. */
export const REGISTRY_COLUMN = {
  tag: 0,
  category: 1,
  derived: 2,
} as const;

/** The vocabulary's categories, in the order the 🎲 filter panel shows them. */
export const TAG_CATEGORIES = ["genre", "quality", "region", "era", "aspect"] as const;
export type TagCategory = (typeof TAG_CATEGORIES)[number];

export function isTagCategory(value: string): value is TagCategory {
  return (TAG_CATEGORIES as readonly string[]).includes(value);
}

export interface TagRegistry {
  /** Every registered tag, in file order. */
  readonly tags: readonly string[];
  /**
   * Each tag's declared category, kept verbatim rather than narrowed to
   * TagCategory: an unrecognised value has to survive as far as
   * `validateRegistry` to be reported, and callers comparing it against a known
   * category get `false` either way.
   */
  readonly category: ReadonlyMap<string, string>;
  /** The tags derived *directly* from each tag, in declaration order. */
  readonly derived: ReadonlyMap<string, readonly string[]>;
}

/**
 * Build a registry from parsed CSV rows (header included). Pure — takes the
 * output of `parseCsv` rather than reading a file, so tests and Node scripts can
 * use it without Vite's `?raw` import.
 *
 * Malformed input degrades rather than throwing, matching how a tag missing
 * from the vocabulary still reaches the 🎲 panel's "Other" group: the data is
 * embedded at build time, so a throw here would ship a blank page instead of a
 * slightly wrong one. `validateRegistry` is what turns the problems into a test
 * failure.
 */
export function buildRegistry(rows: readonly (readonly string[])[]): TagRegistry {
  const tags: string[] = [];
  const category = new Map<string, string>();
  const derived = new Map<string, readonly string[]>();
  for (const row of rows.slice(1)) {
    const tag = (row[REGISTRY_COLUMN.tag] ?? "").trim();
    if (tag.length === 0 || category.has(tag)) continue;
    tags.push(tag);
    category.set(tag, (row[REGISTRY_COLUMN.category] ?? "").trim());
    derived.set(
      tag,
      (row[REGISTRY_COLUMN.derived] ?? "")
        .split(";")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );
  }
  return { tags, category, derived };
}

/** The shipped vocabulary. */
export const REGISTRY: TagRegistry = buildRegistry(parseCsv(registryText));

/**
 * `tags` plus everything derived from them, transitively.
 *
 * Breadth-first from the given tags, appending onto the result as it goes, so
 * the output reads specific → general — the order the card tooltips and the 🎲
 * panel want. Duplicates are dropped on first sight, which also means a cycle in
 * the data cannot loop forever (it is still a bug; `validateRegistry` reports it).
 */
export function withDerivedTags(
  tags: readonly string[],
  registry: TagRegistry = REGISTRY,
): readonly string[] {
  const all = [...new Set(tags)];
  const seen = new Set(all);
  for (let i = 0; i < all.length; i++) {
    for (const derived of registry.derived.get(all[i]!) ?? []) {
      if (seen.has(derived)) continue;
      seen.add(derived);
      all.push(derived);
    }
  }
  return all;
}

/**
 * The tags in a single row that another tag on that same row already derives.
 *
 * A row saying `pop punk` need not also say `punk rock` — the hierarchy supplies
 * it at load time (ARCHITECTURE §3), so writing it out is redundant. It is not
 * merely untidy: `withDerivedTags` produces the same set either way, but the 📊
 * statistics count the tags an artist was *given*, and a row that spells out its
 * own implications inflates that count with tags nobody chose.
 *
 * Takes one row's `ownTags` rather than the whole roster, so the check reads the
 * same in a fixture as it does against the shipped data.
 */
export function redundantTags(
  ownTags: readonly string[],
  registry: TagRegistry = REGISTRY,
): string[] {
  const implied = new Set<string>();
  for (const tag of ownTags) {
    // The closure of a tag's *direct* derivations — i.e. everything it implies,
    // not counting itself, so a tag never reports as its own redundancy.
    for (const ancestor of withDerivedTags(registry.derived.get(tag) ?? [], registry)) {
      implied.add(ancestor);
    }
  }
  return ownTags.filter((tag) => implied.has(tag));
}

/** An era tag, recognised by shape rather than by category (ARCHITECTURE §3a):
    `2000s`, `1990s`. Lives here so `broadTags` can exempt them without importing
    tag-groups.ts, which imports this module. */
export const isEraTag = (tag: string): boolean => /^\d{4}s$/.test(tag);

/**
 * The categories that describe **how an artist sounds** — what it plays and how
 * it plays it — as opposed to where it is from, when it worked, or what is
 * otherwise notable about it.
 */
export const SOUND_CATEGORIES: readonly string[] = ["genre", "quality"];

/**
 * Is this a tag about the music itself?
 *
 * The ☁️ map groups artists by resemblance of *sound* (ARCHITECTURE §7), so its
 * similarity model reads only these: two Swedish bands are not kin for being
 * Swedish, and every act working in the 2010s is not one scene. Region, era and
 * aspect tags are common enough to swamp a co-occurrence profile — between them
 * they are a third of every tag the roster carries — and what they push together
 * is a coincidence of biography rather than a neighbourhood anyone can hear.
 *
 * An unregistered tag is not a sound tag: the vocabulary is what says a tag
 * describes the music, and a tag the registry has never heard of makes no such
 * claim (src/tag-registry.test.ts fails before one can ship).
 */
export const isSoundTag = (tag: string, registry: TagRegistry = REGISTRY): boolean =>
  SOUND_CATEGORIES.includes(registry.category.get(tag) ?? "");

/**
 * The share of the roster a tag may cover before it is **too broad** to
 * describe anyone.
 *
 * Breadth is a failure to distinguish, and nothing else. A tag on four fifths
 * of the roster splits it 4:1 and tells a reader almost nothing about the
 * artist in front of them, whether or not a human typed it: `rock` is derived
 * by every guitar genre, `male vocals` is written out by hand, and neither
 * narrows anything. Such tags remain the point of the hierarchy for *finding*
 * artists, so the 🎲 filter keeps them; everything that reports or compares
 * drops them (ARCHITECTURE §3b).
 *
 * A fifth is a real cut, not a nominal one — it removes 25 tags including
 * `pop punk`, the largest genre. That is the intent: a genre on a fifth of the
 * collection is what the collection *is*, so it cannot distinguish within it.
 *
 * Breadth is measured over the roster rather than declared in `data/tags.csv`
 * because it is a fact about this collection, not about the vocabulary: `metal`
 * is an umbrella on a roster of pop punk bands and a real distinction on one
 * that is half metal. It moves as the roster does, with nothing to keep in sync.
 */
export const BROAD_PREVALENCE = 0.2;

/**
 * The tags too broad to describe the roster: those carried by more than `share`
 * of it.
 *
 * **Era tags are exempt.** They are a separate axis with a section of their own
 * (§8.4) whose entire subject is which decades the collection concentrates in —
 * "72% of your artists are from the 2010s" is that section's finding, not noise
 * to be filtered out of it. Nothing else compares an era against a genre, so
 * their prevalence never crowds another list.
 */
export function broadTags(
  roster: readonly { readonly tags: readonly string[] }[],
  share = BROAD_PREVALENCE,
): ReadonlySet<string> {
  if (roster.length === 0) return new Set();
  const carriers = new Map<string, number>();
  for (const artist of roster) {
    for (const tag of new Set(artist.tags)) carriers.set(tag, (carriers.get(tag) ?? 0) + 1);
  }
  const broad = new Set<string>();
  for (const [tag, count] of carriers) {
    if (!isEraTag(tag) && count / roster.length > share) broad.add(tag);
  }
  return broad;
}

export interface RegistryProblem {
  tag: string;
  problem: string;
}

/**
 * Everything wrong with a registry, as human-readable problems. Checked by
 * src/tag-registry.test.ts against the shipped vocabulary; the roster's tags are
 * passed in so an unregistered tag is caught here rather than silently landing
 * in the 🎲 panel's "Other" group.
 */
export function validateRegistry(
  registry: TagRegistry,
  rosterTags: readonly string[] = [],
): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  for (const tag of registry.tags) {
    const declared = registry.category.get(tag)!;
    if (!isTagCategory(declared)) {
      problems.push({ tag, problem: `unknown category "${declared}"` });
    }
    for (const derived of registry.derived.get(tag)!) {
      if (!registry.category.has(derived)) {
        problems.push({ tag, problem: `derived tag "${derived}" is not registered` });
        continue;
      }
      // Deriving across categories is allowed, and sometimes required:
      // "Christian rock" is a genre that genuinely derives the "Christian"
      // aspect, and each tag still lands in its own 🎲 group. Two derivations
      // are not allowed:
      //
      //  - anything non-region deriving a region, which would let a genre assert
      //    where an artist is from — "J-pop" ⇒ "Japanese" is wrong for everyone
      //    else who plays it; and
      //  - anything involving an era, which are matched by shape rather than
      //    category and must stay roots for the 📊 statistics to hold them apart.
      const derivedCategory = registry.category.get(derived)!;
      if (derivedCategory === "region" && declared !== "region") {
        problems.push({
          tag,
          problem: `is a ${declared} but derives the region "${derived}"`,
        });
      }
      if (derivedCategory === "era" || declared === "era") {
        problems.push({ tag, problem: `era tags derive nothing and are derived from nothing` });
      }
    }
    // A tag derived from itself: withDerivedTags survives it, but the hierarchy
    // it describes is nonsense, and "most specific first" stops having a meaning.
    if (withDerivedTags(registry.derived.get(tag)!, registry).includes(tag)) {
      problems.push({ tag, problem: "is derived from itself (cycle)" });
    }
  }
  for (const tag of new Set(rosterTags)) {
    if (!registry.category.has(tag)) {
      problems.push({ tag, problem: "is used in the roster but not registered" });
    }
  }
  return problems;
}
