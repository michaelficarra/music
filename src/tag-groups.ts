// Grouping of the tag vocabulary (ARCHITECTURE §3) for the 🎲 filter panel.
// Which category a tag belongs to is declared in data/tags.csv and
// read by tag-registry.ts; this module only decides how those categories are
// labelled and ordered on screen. A tag in the roster but absent from the
// registry falls into the trailing "Other" group rather than disappearing, so
// the registry lagging behind the roster degrades softly — but keep it in step
// (src/tag-registry.test.ts fails if it drifts).

import { REGISTRY, isEraTag } from "./tag-registry";

export interface TagGroup {
  label: string;
  tags: string[];
}

/** Era tags are recognised by shape ("1950s" … "2020s") rather than by their
    registry category, so a decade nobody has tagged yet still lands in the right
    group. Defined in tag-registry.ts — which needs it to exempt eras from the
    breadth rule and cannot import this module without a cycle — and re-exported
    here, where its callers (the 📊 statistics) already look for it. */
export { isEraTag };

const GROUPS: { label: string; matches: (tag: string) => boolean }[] = [
  { label: "Genres", matches: (tag) => REGISTRY.category.get(tag) === "genre" },
  { label: "Musical qualities", matches: (tag) => REGISTRY.category.get(tag) === "quality" },
  { label: "Regions", matches: (tag) => REGISTRY.category.get(tag) === "region" },
  { label: "Eras", matches: isEraTag },
  { label: "Notable aspects", matches: (tag) => REGISTRY.category.get(tag) === "aspect" },
  { label: "Other", matches: () => true },
];

/**
 * Partition `tags` (typically data.ts's `allTags`) into labelled groups in a
 * fixed display order, preserving the input order within each group. Empty
 * groups are omitted.
 */
export function groupTags(tags: readonly string[]): TagGroup[] {
  const result: TagGroup[] = GROUPS.map(({ label }) => ({ label, tags: [] }));
  for (const tag of tags) {
    result[GROUPS.findIndex(({ matches }) => matches(tag))]!.tags.push(tag);
  }
  return result.filter((group) => group.tags.length > 0);
}
