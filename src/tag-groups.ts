// Grouping of the controlled tag vocabulary (ARCHITECTURE §3) for the 🎲 filter
// panel. The CSV stores each artist's tags flat; which category a tag belongs
// to lives here. A tag in the data but not listed here (e.g. newly minted)
// falls into the trailing "Other" group rather than disappearing, so this file
// lagging behind the CSV degrades softly — but keep it in step when adding tags.

export interface TagGroup {
  label: string;
  tags: string[];
}

const GENRES = new Set([
  "pop punk",
  "easycore",
  "skate punk",
  "punk rock",
  "hardcore",
  "post-hardcore",
  "screamo",
  "emo",
  "death metal",
  "metalcore",
  "nu metal",
  "alternative metal",
  "power metal",
  "symphonic metal",
  "hard rock",
  "post-grunge",
  "alternative rock",
  "indie rock",
  "indie pop",
  "power pop",
  "pop rock",
  "piano rock",
  "pop",
  "dance-pop",
  "electropop",
  "synthpop",
  "indietronica",
  "art pop",
  "dream pop",
  "chamber pop",
  "bedroom pop",
  "dark cabaret",
  "gothic rock",
  "industrial rock",
  "electropunk",
  "new wave",
  "garage rock",
  "dance-punk",
  "glam rock",
  "classic rock",
  "soft rock",
  "prog rock",
  "art rock",
  "experimental",
  "ska punk",
  "third-wave ska",
  "reggae rock",
  "Celtic punk",
  "folk punk",
  "folk",
  "folk rock",
  "indie folk",
  "singer-songwriter",
  "traditional pop",
  "atmospheric folk",
  "funk",
  "funk rock",
  "jazz fusion",
  "hip hop",
  "rap rock",
  "R&B",
  "EDM",
  "Eurodance",
  "happy hardcore",
  "Europop",
  "J-pop",
]);

const QUALITIES = new Set([
  "anthemic choruses",
  "catchy hooks",
  "synth-driven",
  "guitar-driven",
  "piano-driven",
  "heavy riffs",
  "distorted guitars",
  "jangly guitars",
  "acoustic textures",
  "breakdowns",
  "breakneck tempos",
  "high energy",
  "danceable grooves",
  "disco grooves",
  "electronic beats",
  "folk instrumentation",
  "horn section",
  "string arrangements",
  "orchestral arrangements",
  "classical influences",
  "psychedelic touches",
  "atmospheric textures",
  "lo-fi production",
  "polished production",
  "sample-based production",
  "virtuosic playing",
  "instrumental",
  "screamed vocals",
  "gang vocals",
  "dual vocals",
  "female vocals",
  "male vocals",
  "vocal harmonies",
  "falsetto vocals",
  "rapped verses",
  "breathy vocals",
  "ethereal vocals",
  "soulful vocals",
  "crooning vocals",
  "powerhouse vocals",
  "theatrical delivery",
  "angsty lyrics",
  "confessional lyrics",
  "sardonic humour",
  "witty wordplay",
  "political lyrics",
  "storytelling lyrics",
  "explicit lyrics",
  "concept albums",
  "party anthems",
  "melancholy mood",
  "quirky and playful",
  "camp and flamboyant",
  "retro influences",
  "genre-blending",
]);

const ASPECTS = new Set([
  "solo act",
  "duo",
  "side project",
  "supergroup",
  "comedy",
  "theatrical live shows",
  "masked or costumed",
  "viral breakout",
  "Warped Tour",
  "Christian",
  "soundtrack work",
  "video game ties",
  "British",
  "Irish",
  "Scandinavian",
  "French",
  "Canadian",
  "Australian",
  "Japanese",
  "New Zealand",
]);

/** Era tags are recognised by shape ("1950s" … "2020s") rather than a fixed
    list. Exported for the 📊 statistics, which give eras a section of their
    own (stats.ts). */
export const isEraTag = (tag: string): boolean => /^\d{4}s$/.test(tag);

/**
 * Partition `tags` (typically data.ts's `allTags`) into labelled groups in a
 * fixed display order, preserving the input order within each group. Empty
 * groups are omitted.
 */
export function groupTags(tags: readonly string[]): TagGroup[] {
  const groups: { label: string; matches: (tag: string) => boolean }[] = [
    { label: "Genres", matches: (tag) => GENRES.has(tag) },
    { label: "Musical qualities", matches: (tag) => QUALITIES.has(tag) },
    { label: "Eras", matches: isEraTag },
    { label: "Notable aspects", matches: (tag) => ASPECTS.has(tag) },
    { label: "Other", matches: () => true },
  ];
  const result: TagGroup[] = groups.map(({ label }) => ({ label, tags: [] }));
  for (const tag of tags) {
    result[groups.findIndex(({ matches }) => matches(tag))]!.tags.push(tag);
  }
  return result.filter((group) => group.tags.length > 0);
}
