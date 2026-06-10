import { describe, expect, it } from "vitest";
import { computeCloudLayout, pairwiseSimilarities, type CloudPoint } from "./cloud-layout";
import { artists as roster } from "./data";
import type { Artist } from "./types";

const artist = (name: string, tags: string[]): Artist => ({
  name,
  baselineSlot: "B",
  imageURL: "",
  imageSource: "",
  tags,
});

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

// A roster of three clearly separated families, used by the similarity tests.
// Every tag appears on at least two artists (matching ARCHITECTURE §3).
//  - punks and emos share no tags, but their tags keep common company
//    ("guitars"), so the two families are related without being identical.
//  - ravers share nothing with anyone.
const punks = ["p1", "p2", "p3", "p4"].map((n) => artist(n, ["punk", "fast", "guitars"]));
const emos = ["e1", "e2", "e3", "e4"].map((n) => artist(n, ["emo", "sad", "guitars"]));
const ravers = ["r1", "r2", "r3", "r4"].map((n) => artist(n, ["rave", "synths", "loud"]));
const families = [...punks, ...emos, ...ravers];

describe("pairwiseSimilarities", () => {
  it("gives identical tag sets similarity ≈ 1 and itself exactly 1", () => {
    const sims = pairwiseSimilarities(families);
    expect(sims[0]![0]).toBe(1);
    expect(sims[0]![1]).toBeCloseTo(1, 6); // p1 and p2 carry the same tags
  });

  it("gives artists with disjoint, unrelated tags similarity 0", () => {
    const sims = pairwiseSimilarities(families);
    // Punks and ravers share no tags and no co-occurring context at all.
    expect(sims[0]![8]).toBeCloseTo(0, 6);
  });

  it("relates artists whose different tags keep common company", () => {
    const sims = pairwiseSimilarities(families);
    // Punks and emos share no tags, but both families' tags co-occur with
    // "guitars" — so they must be more similar than punks and ravers (0)…
    expect(sims[0]![4]).toBeGreaterThan(0.1);
    expect(sims[0]![4]).toBeGreaterThan(sims[0]![8]!);
    // …while remaining clearly less similar than two artists sharing all tags.
    expect(sims[0]![4]).toBeLessThan(sims[0]![1]!);
  });

  it("gives a tagless artist similarity 0 to everyone (and no NaN)", () => {
    const sims = pairwiseSimilarities([...families, artist("untagged", [])]);
    for (const row of sims) {
      for (const value of row) expect(Number.isFinite(value)).toBe(true);
    }
    expect(sims[12]!.slice(0, 12).every((value) => value === 0)).toBe(true);
  });
});

describe("computeCloudLayout", () => {
  // Three genre families (ring candidates come from tag-groups' Genres
  // category, so the cluster tags must be genuine genre vocabulary). The
  // larger EDM family anchors the packing; pop punk and emo share the
  // "distorted guitars" context, making them kin — EDM is unrelated.
  const popPunks = ["pp1", "pp2", "pp3", "pp4", "pp5", "pp6"].map((n) =>
    artist(n, ["pop punk", "distorted guitars"]),
  );
  const emoActs = ["em1", "em2", "em3", "em4", "em5", "em6"].map((n) =>
    artist(n, ["emo", "distorted guitars"]),
  );
  const edms = ["ed1", "ed2", "ed3", "ed4", "ed5", "ed6", "ed7", "ed8"].map((n) =>
    artist(n, ["EDM", "electronic beats"]),
  );
  const genreRoster = [...popPunks, ...emoActs, ...edms];

  it("is deterministic: the same roster yields the same map", () => {
    expect(computeCloudLayout(genreRoster)).toEqual(computeCloudLayout(genreRoster));
  });

  it("returns one point per artist, in roster order, within the unit square", () => {
    const { points } = computeCloudLayout([...genreRoster, artist("untagged", [])]);
    expect(points.map((p) => p.name)).toEqual([...genreRoster.map((a) => a.name), "untagged"]);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });

  it("forms one cluster per genre family, containing exactly its carriers", () => {
    const { clusters } = computeCloudLayout(genreRoster);
    expect(clusters.map((c) => c.tag).sort()).toEqual(["EDM", "emo", "pop punk"]);
    for (const cluster of clusters) {
      const expected = genreRoster.filter((a) => a.tags.includes(cluster.tag)).map((a) => a.name);
      expect([...cluster.members].sort()).toEqual([...expected].sort());
    }
  });

  it("places related clusters nearer than unrelated ones", () => {
    const { clusters } = computeCloudLayout(genreRoster);
    const byTag = new Map(clusters.map((c) => [c.tag, c]));
    const popPunk = byTag.get("pop punk")!;
    // pop punk and emo share the "distorted guitars" context; EDM shares
    // nothing with either, so it must be the farther neighbour.
    expect(distance(popPunk, byTag.get("emo")!)).toBeLessThan(distance(popPunk, byTag.get("EDM")!));
  });

  it("sends artists that fit no cluster to the rim, not into a ring", () => {
    const loner = artist("Loner", []);
    const { points, clusters } = computeCloudLayout([...genreRoster, loner]);
    expect(clusters.flatMap((c) => c.members)).not.toContain("Loner");
    const lonerPoint = points.find((p) => p.name === "Loner")!;
    // Outside every ring, but still on the map.
    for (const cluster of clusters) {
      expect(distance(lonerPoint, cluster)).toBeGreaterThan(cluster.radius);
    }
  });

  it("handles degenerate rosters", () => {
    expect(computeCloudLayout([])).toEqual({ points: [], clusters: [], spacing: 1 });
    expect(computeCloudLayout([artist("only", ["solo act"])]).points).toEqual([
      { name: "only", x: 0.5, y: 0.5 },
    ]);
  });

  // Invariant checks over the real shipped roster, so a data change that
  // breaks the layout is caught in CI. Computed once and shared.
  describe("on the real roster", () => {
    const layout = computeCloudLayout(roster);

    it("keeps every pair of artists at least the published spacing apart", () => {
      const { points, spacing } = layout;
      let closest = Infinity;
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          closest = Math.min(closest, distance(points[i]!, points[j]!));
        }
      }
      expect(spacing).toBeGreaterThan(0);
      expect(closest).toBeGreaterThanOrEqual(spacing * 0.99);
    });

    it("finds a healthy number of clusters covering most of the roster", () => {
      const { clusters } = layout;
      expect(clusters.length).toBeGreaterThanOrEqual(6);
      const clustered = clusters.flatMap((c) => c.members);
      // No artist sits in two clusters…
      expect(new Set(clustered).size).toBe(clustered.length);
      // …and the clusters absorb the large majority of the roster.
      expect(clustered.length).toBeGreaterThan(roster.length * 0.7);
    });

    it("draws disjoint rings that contain all of their members", () => {
      const { points, clusters } = layout;
      const byName = new Map<string, CloudPoint>(points.map((p) => [p.name, p]));
      for (const cluster of clusters) {
        expect(cluster.radius).toBeGreaterThan(0);
        for (const member of cluster.members) {
          expect(distance(byName.get(member)!, cluster)).toBeLessThanOrEqual(cluster.radius);
        }
      }
      // Sibling rings pack edge to edge, so allow exact tangency (within
      // floating-point error) but never overlap.
      for (let a = 0; a < clusters.length; a++) {
        for (let b = a + 1; b < clusters.length; b++) {
          expect(distance(clusters[a]!, clusters[b]!)).toBeGreaterThanOrEqual(
            clusters[a]!.radius + clusters[b]!.radius - 1e-9,
          );
        }
      }
    });
  });
});
