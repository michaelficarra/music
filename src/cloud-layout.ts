// Layout for the ☁️ artist map: place every artist on a 2D plane, organised
// into explicit genre clusters. Pure logic, no DOM (unit tested in
// cloud-layout.test.ts); cloud.ts renders the result.
//
// The layout is cluster-first (see ARCHITECTURE §7): rather than embedding
// 265 artists with a force simulation and hoping clusters emerge, it builds
// the clusters explicitly and derives all geometry from them, so every
// placement has a reason a viewer can reconstruct:
//
//   1. Partition: each genre tag (per tag-groups.ts) claims its carriers,
//      most specific (rarest) genre first, so "third-wave ska" forms a scene
//      before "pop rock" sweeps the leftovers. Artists no genre claimed are
//      adopted by the cluster whose members they share the most tags with;
//      artists fitting nowhere become loners, tucked just outside the
//      cluster they most resemble.
//   2. Cluster packing: each cluster's members occupy the nearest points of
//      a hexagonal lattice — the densest packing of equal discs — so
//      neighbours sit at exactly the minimum spacing and the group fills its
//      bounding circle, best-connected members at the centre, fringe members
//      at the edge.
//   3. Disc placement, twice over: clusters are agglomerated into families
//      of related sound; each family packs its rings snugly (largest first,
//      each spiralling out from the affinity-weighted centroid of its
//      already-placed kin, edge to edge), then the families themselves are
//      packed the same way with a wide gap. Rings never overlap, related
//      clusters sit side by side, and the gulfs between families make the
//      grouping readable.
//
// Throughout, an artist is read through its `soundTags` — its genres and
// musical qualities, with regions, eras and notable aspects left out. The map
// answers "what does this sound like", and being Swedish or having worked in
// the 2010s is not an answer to it (ARCHITECTURE §3b, §7).
//
// Everything is deterministic — no randomness anywhere — so a given roster
// always produces the same map.
//
// All geometry is computed in "spacing units" (1 = the minimum distance
// between any two artists) and normalised to the unit square at the end; the
// returned `spacing` tells the renderer what one unit became, so it can scale
// the world to its node size exactly.

import { groupTags } from "./tag-groups";
import { redundantTags } from "./tag-registry";
import type { Artist } from "./types";

/** An artist's position on the map, within the unit square. */
export interface CloudPoint {
  name: string;
  x: number;
  y: number;
}

/** A genre cluster and its ring, in unit-square coordinates. */
export interface CloudCluster {
  /** The genre tag that founded the cluster. */
  tag: string;
  /** The cluster's full name: `tag`, then the tags its adoptees joined on. */
  tags: readonly string[];
  /** Names of the member artists; all of them lie within the ring. */
  members: string[];
  /** The tags that put each member here, by name (see `PartitionedCluster`). */
  joinedBy: ReadonlyMap<string, readonly string[]>;
  /**
   * The family of related sound this cluster was packed into, ranked **largest
   * family first** — the same order, with the same tie-break, that `groupRoster`
   * returns its groups in. A rank therefore means one thing across the app: the
   * renderer tints a family by it (PRD §9), and anything else describing the
   * same neighbourhood can use it without inventing a second ordering.
   */
  family: number;
  x: number;
  y: number;
  radius: number;
}

export interface CloudLayout {
  /** One point per artist, in roster order. */
  points: CloudPoint[];
  /** Disjoint cluster rings, largest first. */
  clusters: CloudCluster[];
  /**
   * The guaranteed minimum distance between any two artists, in unit-square
   * coordinates (one "spacing unit" after normalisation). The renderer maps
   * this to its node footprint to size the world.
   */
  spacing: number;
}

/**
 * Tag-aware similarity for every pair of artists, as a symmetric matrix of
 * cosines in [0, 1] (diagonal 1). Each tag gets a co-occurrence profile — how
 * often it appears alongside every tag across the roster, L2-normalised — so
 * near-synonym tags that rarely share an artist still keep similar company;
 * an artist's vector is the IDF-weighted sum of its tags' profiles. Shared
 * tags contribute fully, related tags partially. An artist with no sound tags
 * has similarity 0 to everyone else.
 *
 * Only `soundTags` count. The excluded categories do not merely add noise, they
 * outvote the signal: they are a third of every tag the roster carries, and an
 * era sits on hundreds of artists at once, so two acts with nothing musical in
 * common still score a solid resemblance for sharing a decade and a continent.
 * Dropping them also frees the profiles from a second-order distortion — while
 * regions co-occurred with genres, one country's scene bled into the profile of
 * every genre played there.
 */
export function pairwiseSimilarities(artists: readonly Artist[]): number[][] {
  const artistCount = artists.length;
  const similarities: number[][] = Array.from({ length: artistCount }, (_, i) =>
    Array.from({ length: artistCount }, (_, j) => (i === j ? 1 : 0)),
  );

  // Index the distinct tags so vectors can live in flat typed arrays.
  const tagIndex = new Map<string, number>();
  for (const artist of artists) {
    for (const tag of artist.soundTags) {
      if (!tagIndex.has(tag)) tagIndex.set(tag, tagIndex.size);
    }
  }
  const tagCount = tagIndex.size;
  if (tagCount === 0) return similarities;

  // Co-occurrence counts: occurrences[t] = artists carrying t, and
  // cooccurrence[t][u] = artists carrying both t and u (diagonal = occurrences,
  // so a tag is always part of its own profile).
  const occurrences = new Float64Array(tagCount);
  const cooccurrence = new Float64Array(tagCount * tagCount);
  for (const artist of artists) {
    const indices = artist.soundTags.map((tag) => tagIndex.get(tag)!);
    for (const t of indices) {
      occurrences[t]!++;
      for (const u of indices) cooccurrence[t * tagCount + u]!++;
    }
  }

  // L2-normalise each tag's profile row in place, so tags are compared by the
  // *shape* of the company they keep, not by how common they are.
  for (let t = 0; t < tagCount; t++) {
    let sumOfSquares = 0;
    for (let u = 0; u < tagCount; u++) sumOfSquares += cooccurrence[t * tagCount + u]! ** 2;
    const norm = Math.sqrt(sumOfSquares);
    if (norm > 0) {
      for (let u = 0; u < tagCount; u++) cooccurrence[t * tagCount + u]! /= norm;
    }
  }

  // Each artist's vector: IDF-weighted sum of its tags' profiles, L2-normalised
  // (zero vector for a tagless artist).
  const vectors = artists.map((artist) => {
    const vector = new Float64Array(tagCount);
    for (const tag of artist.soundTags) {
      const t = tagIndex.get(tag)!;
      const idf = 1 + Math.log(artistCount / occurrences[t]!);
      for (let u = 0; u < tagCount; u++) vector[u]! += idf * cooccurrence[t * tagCount + u]!;
    }
    let sumOfSquares = 0;
    for (let u = 0; u < tagCount; u++) sumOfSquares += vector[u]! ** 2;
    const norm = Math.sqrt(sumOfSquares);
    if (norm > 0) {
      for (let u = 0; u < tagCount; u++) vector[u]! /= norm;
    }
    return vector;
  });

  // Cosine of each pair (the vectors are already unit length, so just the dot).
  for (let i = 0; i < artistCount; i++) {
    for (let j = i + 1; j < artistCount; j++) {
      let dot = 0;
      for (let u = 0; u < tagCount; u++) dot += vectors[i]![u]! * vectors[j]![u]!;
      similarities[i]![j] = similarities[j]![i] = dot;
    }
  }
  return similarities;
}

// --- Tuning (all lengths in spacing units: 1 = min artist-to-artist gap) ---

/** A genre needs this many unclaimed carriers to found a cluster. */
const MIN_CLUSTER_SIZE = 4;
/** An unclaimed artist joins its best cluster only on genre evidence: it must
    share a genre tag with at least this fraction of the members, on average.
    (Musical qualities count towards similarity but not towards membership —
    `catchy hooks` is not a scene, and counting qualities adopted everyone,
    however poor the fit.) Artists clearing it nowhere stay unclustered —
    loners — because a cluster is meant to represent a real relationship, not a
    best-effort bucket. */
const ADOPTION_THRESHOLD = 0.5;
/** Padding between a cluster's outermost member and its ring. */
const RING_PADDING = 0.75;
/** Clear space required between two rings of the same family: none — sibling
    rings pack snugly, edge to edge. (Their members still keep their distance:
    two touching rings hold their artists 2 ring paddings apart.) All the
    visual separation lives at the family level instead. */
const RING_GAP = 0;
/** Placement-spiral resolution: radius grows this much per radian walked. */
const PLACEMENT_SPIRAL_STEP = 0.05;
/** Clear space between two cluster *families*: wider than the (zero) ring gap,
    so the family structure reads at a glance, but no wider — the gulfs should
    separate, not strand. Since each family's light now carries its own tint and
    spreads far past its rings (PRD §9), the boundary is legible from the colour
    change alone and the gap no longer has to do that work by itself. */
const FAMILY_GAP = 1;
/** How far a loner's centre must stay from any ring's edge. Half a footprint
    keeps it a full spacing unit from the ring's outermost member (with the
    ring padding), while letting it nestle right up against the circle. */
const LONER_CLEARANCE = 0.5;

interface PartitionedCluster {
  tag: string;
  members: number[]; // roster indices
  /**
   * Why each member is here: the founding tag for the carriers that founded the
   * cluster, and the genres it shares with them for every artist adopted after.
   *
   * A cluster is named for the genre that founded it, but adoption then puts in
   * artists who do not carry that genre — Nobuo Uematsu (`prog rock`) into
   * `progressive metal`, because every founder derives `prog rock` from it. The
   * name alone therefore states something false about part of the membership;
   * keeping the evidence lets the map say what actually put each artist there
   * (PRD §9) instead of extending the founders' label over everyone.
   *
   * Keyed by roster index, so it survives the cohesion sort below.
   */
  joinedBy: Map<number, readonly string[]>;
}

/**
 * The tags to credit an adoption to: which of `ownGenres` the cluster's members
 * actually hold, commonest first, keeping only the most specific.
 *
 * The reduction is against the *reasons themselves*, never against the founding
 * tag. Nobuo Uematsu shares `prog rock` and `art rock` with the `progressive
 * metal` founders, and `prog rock` derives `art rock`, so only the first is
 * worth printing — but `progressive metal` derives `prog rock` in turn, and
 * reducing against that too would leave nothing at all. Precisely the adoptions
 * whose evidence is an *ancestor* of the founding tag are the ones the name fails
 * to describe, so they are the ones that must survive.
 */
function sharedWith(
  ownGenres: readonly string[],
  cluster: PartitionedCluster,
  artists: readonly Artist[],
): readonly string[] {
  const holders = new Map<string, number>();
  for (const m of cluster.members) {
    for (const tag of ownGenres) {
      if (artists[m]!.soundTags.includes(tag)) holders.set(tag, (holders.get(tag) ?? 0) + 1);
    }
  }
  const shared = [...holders.keys()].sort(
    (a, b) => holders.get(b)! - holders.get(a)! || a.localeCompare(b),
  );
  const redundant = new Set(redundantTags(shared));
  return shared.filter((tag) => !redundant.has(tag));
}

/**
 * A cluster's full name: the founding tag, then the tag each adoptee chiefly
 * joined on, commonest first. `progressive metal + prog rock` — the second half
 * is what the four founders' label was never going to say about Nobuo Uematsu.
 *
 * Only each adoptee's *leading* tag, not all of them: `joinedBy` is ordered by
 * how many members hold the tag, so the head is the one that carried the
 * adoption, and the rest are corroboration. Naming the cluster after all of them
 * would stretch `death metal + metalcore` to `+ beatdown hardcore` for the sake
 * of one artist. The tooltip prints the full list per member instead.
 */
function clusterTags(cluster: PartitionedCluster): readonly string[] {
  const joiners = new Map<string, number>();
  for (const [leading] of cluster.joinedBy.values()) {
    if (leading !== undefined && leading !== cluster.tag) {
      joiners.set(leading, (joiners.get(leading) ?? 0) + 1);
    }
  }
  return [
    cluster.tag,
    ...[...joiners.keys()].sort((a, b) => joiners.get(b)! - joiners.get(a)! || a.localeCompare(b)),
  ];
}

/**
 * Split the roster into genre clusters plus the leftover loners.
 * Exported for the renderer-independent tests; computeCloudLayout uses it.
 */
function partitionIntoClusters(
  artists: readonly Artist[],
  similarities: number[][],
): { clusters: PartitionedCluster[]; loners: number[] } {
  // Candidate genres, most specific (fewest carriers) first so niche scenes
  // form before umbrella genres sweep up everything; ties by name for
  // determinism. Vocabulary categories live in tag-groups.ts.
  //
  // Scenes are founded on the genres among `soundTags` — everything a row
  // implies except the tags too broad to mean anything (§3b) and the ones that
  // are not about the music. Derived genres belong here: a band written down as
  // `emo pop` really is in the pop punk scene, and reading only the stated tag
  // would scatter one scene across its sub-genres. Broad ones do not: every rock
  // band derives `rock`, so an umbrella founds one enormous meaningless cluster
  // and makes the adoption test below unanimous, leaving nobody on the rim.
  //
  // Filtering to the "Genres" group is still needed even from `soundTags`,
  // which also holds the musical qualities: those inform how alike two artists
  // are, but a ring labelled `catchy hooks` names no scene.
  const distinctTags = [...new Set(artists.flatMap((artist) => artist.soundTags))];
  const genreTags = groupTags(distinctTags).find((group) => group.label === "Genres")?.tags ?? [];
  const carriers = new Map(
    genreTags.map((tag) => [
      tag,
      artists.flatMap((artist, i) => (artist.soundTags.includes(tag) ? [i] : [])),
    ]),
  );
  const orderedGenres = [...carriers.keys()].sort(
    (a, b) => carriers.get(a)!.length - carriers.get(b)!.length || a.localeCompare(b),
  );

  const clusterOf = new Map<number, PartitionedCluster>();
  const clusters: PartitionedCluster[] = [];
  for (const tag of orderedGenres) {
    const unclaimed = carriers.get(tag)!.filter((i) => !clusterOf.has(i));
    if (unclaimed.length < MIN_CLUSTER_SIZE) continue;
    const cluster: PartitionedCluster = {
      tag,
      members: unclaimed,
      // Founders are here for the obvious reason: they carry the tag.
      joinedBy: new Map(unclaimed.map((i) => [i, [tag]])),
    };
    clusters.push(cluster);
    for (const i of unclaimed) clusterOf.set(i, cluster);
  }

  // Adoption: an artist left over (its genres were all too small, or it has
  // none) joins the cluster whose members it shares the most *genre* tags
  // with — kinship of sound, not of incidental qualities — and only when that
  // evidence clears the threshold. The rest stay loners.
  const genreSet = new Set(genreTags);
  const loners: number[] = [];
  for (let i = 0; i < artists.length; i++) {
    if (clusterOf.has(i)) continue;
    const ownGenres = artists[i]!.soundTags.filter((tag) => genreSet.has(tag));
    let bestCluster: PartitionedCluster | null = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      let sharedTotal = 0;
      for (const m of cluster.members) {
        sharedTotal += ownGenres.filter((tag) => artists[m]!.soundTags.includes(tag)).length;
      }
      const score = sharedTotal / cluster.members.length;
      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }
    if (bestCluster !== null && bestScore >= ADOPTION_THRESHOLD) {
      // Attribute before joining: an artist shares every one of its genres with
      // itself, so scanning the members afterwards would credit tags no existing
      // member actually holds.
      bestCluster.joinedBy.set(i, sharedWith(ownGenres, bestCluster, artists));
      bestCluster.members.push(i);
    } else loners.push(i);
  }

  // Within each cluster, order members by how connected they are to the rest
  // of the cluster (mean pairwise similarity), so the phyllotaxis spiral puts
  // the archetypal members at the centre and the fringe (incl. adoptees) at
  // the edge. Ties by name keep it deterministic.
  for (const cluster of clusters) {
    const cohesion = new Map(
      cluster.members.map((i) => [
        i,
        cluster.members.reduce((sum, j) => sum + (i === j ? 0 : similarities[i]![j]!), 0),
      ]),
    );
    cluster.members.sort(
      (a, b) =>
        cohesion.get(b)! - cohesion.get(a)! || artists[a]!.name.localeCompare(artists[b]!.name),
    );
  }

  // Largest cluster first: the placement below anchors on the big discs.
  clusters.sort((a, b) => b.members.length - a.members.length || a.tag.localeCompare(b.tag));
  return { clusters, loners };
}

/**
 * Pack `count` members into the tightest disc the spacing guarantee allows:
 * the `count` hexagonal-lattice points nearest the origin (the densest
 * packing of equal discs), so every neighbour sits at exactly one spacing
 * unit and the set compactly fills its bounding circle — no sparse spiral
 * arms, no repeated signature shape. Within a radius tier, points are taken
 * in angle order, so a partial outer ring forms a contiguous arc. The offsets
 * are recentred on their centroid and returned with the bounding-circle
 * radius (which therefore hugs the actual shape). Offsets are ordered
 * centre-out, matching the members' archetype-first ordering. Deterministic.
 */
function packMembers(count: number): { offsets: { x: number; y: number }[]; radius: number } {
  // Generate a comfortably-large patch of the lattice (a disc of area
  // π·range² ≫ count), then keep the `count` points nearest the origin.
  const range = Math.ceil(Math.sqrt(count)) + 1;
  const lattice: { x: number; y: number }[] = [];
  for (let q = -range; q <= range; q++) {
    for (let r = -range; r <= range; r++) {
      lattice.push({ x: q + r / 2, y: (r * Math.sqrt(3)) / 2 });
    }
  }
  lattice.sort(
    (a, b) =>
      Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x),
  );
  const offsets = lattice.slice(0, count);
  const centroidX = offsets.reduce((sum, p) => sum + p.x, 0) / count;
  const centroidY = offsets.reduce((sum, p) => sum + p.y, 0) / count;
  for (const offset of offsets) {
    offset.x -= centroidX;
    offset.y -= centroidY;
  }
  const radius = Math.max(...offsets.map((p) => Math.hypot(p.x, p.y))) + RING_PADDING;
  return { offsets, radius };
}

/**
 * Greedy spiral packing of discs, the layout's one placement primitive (used
 * for clusters within a family, and again for the families themselves).
 * Largest disc first; each subsequent disc walks an Archimedean spiral out
 * from the affinity-weighted centroid of the discs already placed (affinity
 * squared, to favour the closest kin) and takes the first position with at
 * least `gap` clear of every placed disc — so related discs end up adjacent
 * and nothing ever overlaps. Returns centres, recentred on the packing's
 * bounding box. Deterministic.
 */
function packDiscs(radii: readonly number[], affinity: number[][], gap: number) {
  const order = radii.map((_, i) => i).sort((a, b) => radii[b]! - radii[a]! || a - b);
  const centres: { x: number; y: number }[] = radii.map(() => ({ x: 0, y: 0 }));
  const placed: number[] = [];
  for (const disc of order) {
    if (placed.length > 0) {
      let weightTotal = 0;
      let focusX = 0;
      let focusY = 0;
      for (const other of placed) {
        const weight = affinity[disc]![other]! ** 2;
        weightTotal += weight;
        focusX += weight * centres[other]!.x;
        focusY += weight * centres[other]!.y;
      }
      if (weightTotal > 0) {
        focusX /= weightTotal;
        focusY /= weightTotal;
      }
      let angle = 0;
      for (;;) {
        const x = focusX + PLACEMENT_SPIRAL_STEP * angle * Math.cos(angle);
        const y = focusY + PLACEMENT_SPIRAL_STEP * angle * Math.sin(angle);
        const clear = placed.every(
          (other) =>
            Math.hypot(x - centres[other]!.x, y - centres[other]!.y) >=
            radii[disc]! + radii[other]! + gap,
        );
        if (clear) {
          centres[disc] = { x, y };
          break;
        }
        angle += 0.2;
      }
    }
    placed.push(disc);
  }
  // Recentre on the bounding box, so nesting one packing inside another (and
  // the final normalisation around the outermost) treats it symmetrically.
  if (radii.length > 0) {
    const minX = Math.min(...centres.map((c, i) => c.x - radii[i]!));
    const maxX = Math.max(...centres.map((c, i) => c.x + radii[i]!));
    const minY = Math.min(...centres.map((c, i) => c.y - radii[i]!));
    const maxY = Math.max(...centres.map((c, i) => c.y + radii[i]!));
    for (const centre of centres) {
      centre.x -= (minX + maxX) / 2;
      centre.y -= (minY + maxY) / 2;
    }
  }
  return centres;
}

/** Affinity between two clusters: the mean similarity across their members. */
function clusterAffinity(
  clusters: readonly PartitionedCluster[],
  similarities: number[][],
): number[][] {
  return clusters.map((a) =>
    clusters.map((b) => {
      if (a === b) return 0;
      let sum = 0;
      for (const i of a.members) for (const j of b.members) sum += similarities[i]![j]!;
      return sum / (a.members.length * b.members.length);
    }),
  );
}

/**
 * Group the clusters into ~√k families of related sound by average-linkage
 * agglomeration: start with every cluster alone, repeatedly merge the two
 * groups with the highest mean cross-cluster affinity. Deterministic (ties
 * break towards the earliest pair).
 */
function groupClusters(affinity: number[][], clusterCount: number): number[][] {
  const targetCount = Math.max(1, Math.round(Math.sqrt(clusterCount)));
  const groups: number[][] = Array.from({ length: clusterCount }, (_, i) => [i]);
  while (groups.length > targetCount) {
    let bestA = 0;
    let bestB = 1;
    let bestScore = -Infinity;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        let sum = 0;
        for (const i of groups[a]!) for (const j of groups[b]!) sum += affinity[i]![j]!;
        const score = sum / (groups[a]!.length * groups[b]!.length);
        if (score > bestScore) {
          bestScore = score;
          bestA = a;
          bestB = b;
        }
      }
    }
    groups[bestA] = [...groups[bestA]!, ...groups[bestB]!];
    groups.splice(bestB, 1);
  }
  return groups;
}

/**
 * The families in display order: **largest first**, ties broken by the tag of
 * the largest scene in each. Both callers below rank them through this one
 * function, so a family's position is the same fact whether it is being drawn on
 * the map or listed in 📊 — the map tints by that position (PRD §9).
 *
 * `clusters` arrives from the partition already sorted largest-first with ties
 * by tag, so a family's leading scene is simply its lowest cluster index.
 */
function rankFamilies(
  families: readonly number[][],
  clusters: readonly PartitionedCluster[],
): number[][] {
  const size = (family: readonly number[]): number =>
    family.reduce((sum, c) => sum + clusters[c]!.members.length, 0);
  const leadTag = (family: readonly number[]): string => clusters[Math.min(...family)]!.tag;
  return [...families].sort((a, b) => size(b) - size(a) || leadTag(a).localeCompare(leadTag(b)));
}

/** One genre scene: the tag that founded it and the artists it claimed. */
export interface Scene {
  tag: string;
  /** The scene's full name: `tag`, then the tags its adoptees joined on. */
  tags: readonly string[];
  members: string[];
}

/**
 * A scene's name for display, wherever one is shown as a single string.
 *
 * Joined with `+` rather than `·` because "the worlds it splits into" (§8)
 * already separates *scenes* with `·`; nesting one inside the other would leave
 * no way to tell a second scene from a second tag on the first.
 */
export const sceneName = (tags: readonly string[]): string => tags.join(" + ");

/** A family of related scenes — one neighbourhood of the map. */
export interface TasteGroup {
  /** The scenes it gathers, largest first. */
  scenes: Scene[];
  /** Every artist across those scenes, in no particular order. */
  members: string[];
}

/**
 * The roster's structure without any of the geometry: genre scenes, then those
 * agglomerated into families of related sound. These are the first two steps of
 * computeCloudLayout, and therefore exactly the neighbourhoods a viewer sees on
 * the ☁️ map — the 📊 dialog describes the same grouping rather than inventing a
 * second, differently-drawn one (ARCHITECTURE §7).
 *
 * Families come out largest first, and the scenes within each likewise. Artists
 * no scene claimed are returned separately rather than forced into one.
 */
export function groupRoster(artists: readonly Artist[]): {
  groups: TasteGroup[];
  loners: string[];
} {
  if (artists.length === 0) return { groups: [], loners: [] };
  const similarities = pairwiseSimilarities(artists);
  const { clusters, loners } = partitionIntoClusters(artists, similarities);
  const stray = loners.map((i) => artists[i]!.name);
  if (clusters.length === 0) return { groups: [], loners: stray };

  const families = rankFamilies(
    groupClusters(clusterAffinity(clusters, similarities), clusters.length),
    clusters,
  );
  const groups = families.map((memberClusters) => {
    const scenes = memberClusters
      .map((c) => ({
        tag: clusters[c]!.tag,
        tags: clusterTags(clusters[c]!),
        members: clusters[c]!.members.map((m) => artists[m]!.name),
      }))
      .sort((a, b) => b.members.length - a.members.length || a.tag.localeCompare(b.tag));
    return { scenes, members: scenes.flatMap((scene) => scene.members) };
  });
  return { groups, loners: stray };
}

/**
 * Lay the artists out in the unit square: genre-cluster discs (with their
 * rings) packed together, related clusters adjacent, leftover artists on an
 * loners tucked beside their nearest kin. Returns one point per artist in
 * roster order, plus the rings.
 * Deterministic for a given roster.
 */
export function computeCloudLayout(artists: readonly Artist[]): CloudLayout {
  if (artists.length === 0) return { points: [], clusters: [], spacing: 1 };
  if (artists.length === 1) {
    return { points: [{ name: artists[0]!.name, x: 0.5, y: 0.5 }], clusters: [], spacing: 1 };
  }

  const similarities = pairwiseSimilarities(artists);
  const { clusters, loners } = partitionIntoClusters(artists, similarities);
  // Each cluster's member offsets and the ring radius that hugs them.
  const memberPackings = clusters.map((c) => packMembers(c.members.length));
  const radii = memberPackings.map((packing) => packing.radius);

  // Affinity between clusters: mean cross-member similarity. Drives which
  // already-placed discs each new disc snuggles up to.
  const affinity = clusterAffinity(clusters, similarities);

  // Two-tier placement: agglomerate the clusters into families of related
  // sound, pack each family's rings tightly, then pack the families (with a
  // wider gap), so related characteristics render side by side — the punk
  // scenes in one neighbourhood, electronic pop in another — and the family
  // structure is readable from the gulfs between them.
  // Ranked largest first, so a family's index here is the rank the renderer
  // tints by and the position 📊 lists it at — one ordering, not two.
  const families = rankFamilies(groupClusters(affinity, clusters.length), clusters);
  const familyPackings = families.map((memberClusters) => {
    const localCentres = packDiscs(
      memberClusters.map((c) => radii[c]!),
      memberClusters.map((a) => memberClusters.map((b) => affinity[a]![b]!)),
      RING_GAP,
    );
    // The family's own disc: the circle (about the packing's centre) that
    // encloses every member ring.
    const radius = Math.max(
      ...localCentres.map(
        (centre, m) => Math.hypot(centre.x, centre.y) + radii[memberClusters[m]!]!,
      ),
    );
    return { memberClusters, localCentres, radius };
  });
  const familyAffinity = familyPackings.map((a) =>
    familyPackings.map((b) => {
      if (a === b) return 0;
      let sum = 0;
      for (const i of a.memberClusters) for (const j of b.memberClusters) sum += affinity[i]![j]!;
      return sum / (a.memberClusters.length * b.memberClusters.length);
    }),
  );
  const familyCentres = packDiscs(
    familyPackings.map((family) => family.radius),
    familyAffinity,
    FAMILY_GAP,
  );
  const centres: { x: number; y: number }[] = clusters.map(() => ({ x: 0, y: 0 }));
  const familyOf = new Int32Array(clusters.length);
  familyPackings.forEach((family, f) => {
    family.memberClusters.forEach((c, m) => {
      familyOf[c] = f;
      centres[c] = {
        x: familyCentres[f]!.x + family.localCentres[m]!.x,
        y: familyCentres[f]!.y + family.localCentres[m]!.y,
      };
    });
  });

  // Member positions: the cluster's hexagonal packing around its centre, with
  // the best-connected members (the partition pre-sorted them) at the heart.
  const x = new Float64Array(artists.length);
  const y = new Float64Array(artists.length);
  clusters.forEach((cluster, c) => {
    cluster.members.forEach((member, rank) => {
      x[member] = centres[c]!.x + memberPackings[c]!.offsets[rank]!.x;
      y[member] = centres[c]!.y + memberPackings[c]!.offsets[rank]!.y;
    });
  });

  // The loners: artists no cluster wanted. Each is tucked just outside the
  // cluster it most resembles, by the same spiral search the discs use —
  // walking out from that cluster's centre to the first spot clear of every
  // ring and every already-placed loner. They nestle into the notches between
  // rings beside their nearest kin, rather than being banished to a distant
  // orbit around the whole map.
  if (loners.length > 0) {
    const homeCluster = (i: number): number => {
      let best = -1;
      let bestScore = 0;
      clusters.forEach((cluster, c) => {
        const score =
          cluster.members.reduce((sum, m) => sum + similarities[i]![m]!, 0) /
          cluster.members.length;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      });
      return best;
    };
    const ordered = loners
      .map((i) => ({ i, home: homeCluster(i) }))
      .sort((a, b) => a.home - b.home || artists[a.i]!.name.localeCompare(artists[b.i]!.name));
    const placedLoners: { x: number; y: number }[] = [];
    for (const { i, home } of ordered) {
      // No kinship anywhere (e.g. tagless) → walk out from the map's centre.
      const focusX = home >= 0 ? centres[home]!.x : 0;
      const focusY = home >= 0 ? centres[home]!.y : 0;
      let angle = 0;
      for (;;) {
        const px = focusX + PLACEMENT_SPIRAL_STEP * angle * Math.cos(angle);
        const py = focusY + PLACEMENT_SPIRAL_STEP * angle * Math.sin(angle);
        const clear =
          centres.every(
            (centre, c) => Math.hypot(px - centre.x, py - centre.y) >= radii[c]! + LONER_CLEARANCE,
          ) && placedLoners.every((other) => Math.hypot(px - other.x, py - other.y) >= 1);
        if (clear) {
          x[i] = px;
          y[i] = py;
          placedLoners.push({ x: px, y: py });
          break;
        }
        angle += 0.2;
      }
    }
  }

  // Normalise into the unit square, scaling both axes by the same factor (the
  // larger span) so the shape isn't distorted; the shorter axis is centred.
  // Ring extents are included so circles never poke outside the world.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const include = (px: number, py: number, pad: number): void => {
    minX = Math.min(minX, px - pad);
    maxX = Math.max(maxX, px + pad);
    minY = Math.min(minY, py - pad);
    maxY = Math.max(maxY, py + pad);
  };
  for (let i = 0; i < artists.length; i++) include(x[i]!, y[i]!, 0.5);
  centres.forEach((centre, c) => include(centre.x, centre.y, radii[c]!));
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const toUnit = (px: number, py: number): { x: number; y: number } => ({
    x: (px - minX + (span - (maxX - minX)) / 2) / span,
    y: (py - minY + (span - (maxY - minY)) / 2) / span,
  });

  return {
    points: artists.map((artist, i) => ({ name: artist.name, ...toUnit(x[i]!, y[i]!) })),
    clusters: clusters.map((cluster, c) => ({
      tag: cluster.tag,
      tags: clusterTags(cluster),
      members: cluster.members.map((m) => artists[m]!.name),
      // Re-keyed by name: the renderer never sees roster indices.
      joinedBy: new Map(
        cluster.members.map((m) => [artists[m]!.name, cluster.joinedBy.get(m) ?? [cluster.tag]]),
      ),
      family: familyOf[c]!,
      ...toUnit(centres[c]!.x, centres[c]!.y),
      radius: radii[c]! / span,
    })),
    spacing: 1 / span,
  };
}
