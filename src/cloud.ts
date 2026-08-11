// The ☁️ artist map: a full-screen dialog laying the whole roster out on a
// pannable, zoomable plane, clustered by tag similarity. The geometry comes
// from cloud-layout.ts; this module renders it and drives the interaction.

import { allSoundTags, artists } from "./data";
import { computeCloudLayout, sceneName, type CloudCluster, type CloudLayout } from "./cloud-layout";
import {
  buildSearchIndex,
  isSearchable,
  resolveSpotlight,
  searchTargets,
  type SearchEntry,
  type SearchIndex,
  type Spotlight,
} from "./search";
import { artistTooltip, createThumb } from "./thumb";

// What one of the layout's spacing units (the minimum distance between any
// two artists) becomes in world px. A node is taller than it is wide — an
// 84px thumb plus a wrapping name caption, ~115px in all — and the hexagonal
// cluster packing puts many neighbours at exactly this distance on the
// diagonal, so it must clear the node's tall side, not just the thumb.
const NODE_SPACING = 132;

// Zoom bounds: never closer than 4× (84px thumbs are plenty big by then) and
// never further than half the fitted overview.
const MAX_SCALE = 4;
const MIN_SCALE_FACTOR = 0.5;

// Keep at least this many px of the cloud on screen when panning/zooming, so
// the map can't be flung entirely out of view.
const PAN_MARGIN = 64;

// One hue per family of related sound, taken in turn from the largest family
// down (`CloudCluster.family` is that rank). These are the eight accent colours
// of Ethan Schoonover's Solarized palette — chosen rather than mixed by hand
// because they were picked for equal weight against a dark ground, which is
// exactly the job here; `glowColour` below dilutes each with white, so what
// reaches the map is a lean, not a colour cast. The order alternates warm and
// cool so that families of adjacent rank, which are nothing to do with each
// other, never come out in neighbouring hues. Eight covers the ~√k families the
// layout makes (7 on the current roster) with one to spare; beyond that it
// cycles.
const FAMILY_TINTS = [
  "#268bd2", // blue
  "#cb4b16", // orange
  "#859900", // green
  "#d33682", // magenta
  "#2aa198", // cyan
  "#b58900", // yellow
  "#6c71c4", // violet
  "#dc322f", // red
];

// How much of the family's hue survives the dilution with white. Enough to tell
// one neighbourhood from the next; not enough to turn the map into a chart of
// coloured regions.
const TINT_STRENGTH = 0.6;

/**
 * The light a family's glow is actually drawn with: its hue diluted with white.
 * Both layers read this one value — the canvas haze paints with it directly, and
 * the ring core gets it as the `--glow` custom property — so the two can never
 * drift into describing the same family differently.
 */
function glowColour(tint: string): { r: number; g: number; b: number } {
  const channel = (offset: number): number => {
    const hue = parseInt(tint.slice(offset, offset + 2), 16);
    return Math.round(hue * TINT_STRENGTH + 255 * (1 - TINT_STRENGTH));
  };
  return { r: channel(1), g: channel(3), b: channel(5) };
}

// The haze: each glow's wide, diffuse outer halo, three ring radii across and
// free to overlap its neighbours' — the layer that makes a field of discs read
// as one cloud (PRD §9).
//
// It is painted into **one canvas, in screen space**, redrawn for each view
// rather than living on the plane. Two failed approaches are why:
//
//   - As one huge gradient element per cluster, fifty of them overlapping and
//     alpha-blended over a world tens of thousands of px wide, it was the map's
//     one expensive layer, and Chromium re-rastered it mid-zoom so the map
//     visibly flashed (ARCHITECTURE §7). WebKit did not.
//   - As a single texture pinned to the world it cost nothing to zoom, but any
//     texture large enough to cover the world is coarse enough to show its own
//     texel grid once magnified, and no texture is large enough at 4×.
//
// Drawing it against the current transform sidesteps both: the picture is always
// made at exactly the resolution it is shown at, off-screen haloes are skipped,
// and the whole redraw measures ~0.7 ms — a twentieth of a frame.
const HAZE_RADIUS_SCALE = 3;
// The same five-stop falloff the cores use, a little heavier at the peak: this
// is the layer that carries the cloud, and the core then thickens the light
// towards each heart.
const HAZE_STOPS: readonly [number, number][] = [
  [0, 0.15],
  [0.25, 0.126],
  [0.5, 0.07],
  [0.75, 0.024],
  [1, 0],
];

// An unclustered artist's core: half a spacing unit, matching the layout's
// LONER_CLEARANCE. A loner's centre is at least that far outside every ring and
// a full unit from every other loner, so its core is tangent to its neighbours
// at worst — the same disjointness the cluster cores get from the packing.
const LONER_CORE_RADIUS = 0.5 * NODE_SPACING;

// How much clear space a revealed spotlight keeps from the viewport's edges,
// and how long the move to it takes (kept in step with the .gliding transition
// in styles.css).
const REVEAL_MARGIN = 48;
const REVEAL_MS = 400;

/**
 * What hovering inside a ring says: the cluster's name, then who is in it.
 *
 * Members are grouped by the tags that put them there, because a cluster is
 * named after the genre that *founded* it and adoption then admits artists who
 * do not carry that genre (PRD §9) — printing the bare name over the whole list
 * asserts something false about them. Where nobody was adopted the cluster has a
 * single group and reads as it always did: a prefix repeating the ring's own
 * name on every line explains nothing.
 */
function ringTooltip(cluster: CloudCluster): string {
  const heading = `${sceneName(cluster.tags)} (${cluster.members.length} artists)`;
  if (cluster.tags.length === 1) return `${heading}\n${cluster.members.join(", ")}`;
  // Keyed on the member's whole reason, so an artist appears once with all of
  // it; built in member order, so the groups come out most-archetypal first.
  const groups = new Map<string, string[]>();
  for (const name of cluster.members) {
    const via = (cluster.joinedBy.get(name) ?? [cluster.tag]).join(", ");
    groups.set(via, [...(groups.get(via) ?? []), name]);
  }
  return [heading, ...[...groups].map(([via, names]) => `${via}: ${names.join(", ")}`)].join("\n");
}

/** Where the map currently sits on screen, and how large its world is. */
interface HazeView {
  world: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/**
 * Draw the haze for one view: every cluster's halo in its family's light, and a
 * node-sized one for each loner in the neutral white of no family at all, placed
 * by the same `world × scale + offset` transform the plane itself carries.
 *
 * Haloes falling outside the viewport are skipped. That is not a micro-
 * optimisation: zoomed in, a single halo can be several screens across, and the
 * cull is what keeps a redraw proportional to the screen rather than the world.
 */
function drawHaze(
  context: CanvasRenderingContext2D,
  layout: CloudLayout,
  clustered: ReadonlySet<string>,
  view: HazeView,
): void {
  context.clearRect(0, 0, view.width, view.height);
  const halo = (
    worldX: number,
    worldY: number,
    worldRadius: number,
    glow: ReturnType<typeof glowColour>,
  ): void => {
    const x = view.offsetX + worldX * view.scale;
    const y = view.offsetY + worldY * view.scale;
    const radius = worldRadius * view.scale;
    if (x + radius < 0 || y + radius < 0 || x - radius > view.width || y - radius > view.height) {
      return;
    }
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    for (const [stop, alpha] of HAZE_STOPS) {
      gradient.addColorStop(stop, `rgba(${glow.r}, ${glow.g}, ${glow.b}, ${alpha})`);
    }
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, 2 * Math.PI);
    context.fill();
  };

  for (const cluster of layout.clusters) {
    halo(
      cluster.x * view.world,
      cluster.y * view.world,
      HAZE_RADIUS_SCALE * cluster.radius * view.world,
      glowColour(FAMILY_TINTS[cluster.family % FAMILY_TINTS.length]!),
    );
  }
  for (const point of layout.points) {
    if (clustered.has(point.name)) continue;
    halo(point.x * view.world, point.y * view.world, HAZE_RADIUS_SCALE * LONER_CORE_RADIUS, {
      r: 255,
      g: 255,
      b: 255,
    });
  }
}

export interface Cloud {
  /** Show the map, building it on first use, fitted to the viewport. */
  open(): void;
}

/**
 * Wire up the ☁️ map inside its dialog (the static shell in index.html: a
 * .cloud-viewport to fill and a .cloud-close button). The plane of artist
 * nodes is built lazily on the first open — the layout simulation costs a
 * moment, so it's not paid until the map is actually used — then kept for the
 * session (positions are deterministic; there is nothing to refresh).
 */
export function createCloud(dialog: HTMLDialogElement): Cloud {
  const viewport = dialog.querySelector<HTMLElement>(".cloud-viewport")!;
  const closeButton = dialog.querySelector<HTMLButtonElement>(".cloud-close")!;
  let plane: HTMLElement | null = null;
  // The world's side in CSS px at scale 1; set when the plane is built (it
  // depends on how many spacing units the computed layout spans).
  let world = 1;

  // Set alongside the plane, and kept for the session: the geometry the plane
  // was drawn from, and the elements the 🔍 spotlight needs to reach back into.
  // Identity lives in these maps rather than in data-attributes on the nodes —
  // nothing outside this module addresses them.
  let layout: CloudLayout | null = null;
  let searchIndex: SearchIndex | null = null;
  const nodeByName = new Map<string, HTMLElement>();
  const haloByName = new Map<string, HTMLElement>();
  const ringByCluster: HTMLElement[] = [];

  // The haze layer: a screen-space canvas *behind* the plane rather than on it,
  // redrawn for whatever view is current (see drawHaze), plus the names it draws
  // a solitary halo for.
  let haze: HTMLCanvasElement | null = null;
  let hazeContext: CanvasRenderingContext2D | null = null;
  let clustered: ReadonlySet<string> = new Set();
  // The pending redraw, so a burst of wheel or pointer events costs one.
  let hazeFrame = 0;

  // The view transform: screen = world × scale + (offsetX, offsetY), applied to
  // the plane as a single translate+scale (so panning and zooming never touch
  // the per-node geometry).
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let fitScale = 1; // the whole-cloud overview scale, recomputed per open

  /**
   * Redraw the haze for a given transform, resizing the canvas to the viewport
   * (in device pixels) if that has changed. Taking the transform as arguments
   * rather than reading the closure's is what lets the glide below follow a
   * transition it does not control.
   */
  function paintHaze(atScale: number, atOffsetX: number, atOffsetY: number): void {
    if (haze === null || hazeContext === null || layout === null) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const pixelRatio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * pixelRatio);
    const pixelHeight = Math.round(height * pixelRatio);
    if (haze.width !== pixelWidth || haze.height !== pixelHeight) {
      haze.width = pixelWidth;
      haze.height = pixelHeight;
    }
    // Draw in CSS px and let the context scale to the backing store, so the
    // picture is made at exactly the resolution it is shown at.
    hazeContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    drawHaze(hazeContext, layout, clustered, {
      world,
      scale: atScale,
      offsetX: atOffsetX,
      offsetY: atOffsetY,
      width,
      height,
    });
  }

  // One redraw per frame at most, however many events moved the view.
  function scheduleHaze(): void {
    if (hazeFrame !== 0) return;
    hazeFrame = window.requestAnimationFrame(() => {
      hazeFrame = 0;
      paintHaze(scale, offsetX, offsetY);
    });
  }

  function applyTransform(): void {
    plane!.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    scheduleHaze();
  }

  // Don't let the cloud leave the screen entirely: at least PAN_MARGIN px of
  // the world square must remain inside the viewport on each axis.
  function clampPan(): void {
    const worldSize = world * scale;
    offsetX = Math.min(
      Math.max(offsetX, PAN_MARGIN - worldSize),
      viewport.clientWidth - PAN_MARGIN,
    );
    offsetY = Math.min(
      Math.max(offsetY, PAN_MARGIN - worldSize),
      viewport.clientHeight - PAN_MARGIN,
    );
  }

  function buildPlane(): void {
    plane = document.createElement("div");
    plane.className = "cloud-plane";
    // One point per artist (roster order) plus the cluster rings; the world's
    // px size maps the layout's minimum spacing exactly onto NODE_SPACING.
    const built = computeCloudLayout(artists);
    layout = built;
    searchIndex = buildSearchIndex(artists, allSoundTags);
    world = NODE_SPACING / built.spacing;
    // The haze canvas goes into the viewport, before the plane, so it lies
    // behind everything. It is not on the plane: the plane is transformed, and
    // the whole point is that the haze is drawn afresh for each view instead of
    // being stretched with one.
    clustered = new Set(built.clusters.flatMap((cluster) => cluster.members));
    haze = document.createElement("canvas");
    haze.className = "cloud-haze";
    hazeContext = haze.getContext("2d");
    viewport.appendChild(haze);
    // Then the ring cores, before the nodes so those paint over them. Each is
    // drawn at the cluster's exact geometric radius, and is the only hoverable
    // part of the glow: the layout guarantees the cores never overlap, so a
    // cluster can never take a neighbour's tooltip however far its haze spills.
    for (const cluster of built.clusters) {
      const ring = document.createElement("div");
      ring.className = "cloud-ring";
      ring.style.left = `${cluster.x * world}px`;
      ring.style.top = `${cluster.y * world}px`;
      const diameter = 2 * cluster.radius * world;
      ring.style.width = `${diameter}px`;
      ring.style.height = `${diameter}px`;
      // The family's diluted light, matching what the haze beneath was painted
      // with. A loner's halo leaves it unset and keeps the neutral white, since a
      // loner is in no family.
      const { r, g, b } = glowColour(FAMILY_TINTS[cluster.family % FAMILY_TINTS.length]!);
      ring.style.setProperty("--glow", `rgb(${r} ${g} ${b})`);
      // Hovering the space inside a ring explains the cluster — handy at the
      // fitted overview, where the member names are too small to read.
      ring.title = ringTooltip(cluster);
      ringByCluster.push(ring);
      plane.appendChild(ring);
    }
    // Unclustered artists get a halo of their own — a node-sized pool of the
    // same light (core here, haze in the canvas), so a loner reads as
    // deliberately alone, not forgotten. Its tooltip is the artist's own,
    // mirroring the cluster glows' explanations; the node above it carries the
    // same text, so nothing is lost where the two overlap.
    artists.forEach((artist, i) => {
      if (clustered.has(artist.name)) return;
      const halo = document.createElement("div");
      halo.className = "cloud-ring";
      halo.style.left = `${built.points[i]!.x * world}px`;
      halo.style.top = `${built.points[i]!.y * world}px`;
      const diameter = 2 * LONER_CORE_RADIUS;
      halo.style.width = `${diameter}px`;
      halo.style.height = `${diameter}px`;
      halo.title = artistTooltip(artist);
      haloByName.set(artist.name, halo);
      plane!.appendChild(halo);
    });
    artists.forEach((artist, i) => {
      const node = document.createElement("div");
      node.className = "cloud-node";
      node.style.left = `${built.points[i]!.x * world}px`;
      node.style.top = `${built.points[i]!.y * world}px`;
      node.title = artistTooltip(artist);
      const label = document.createElement("span");
      label.className = "name";
      label.textContent = artist.name;
      node.append(createThumb(artist), label);
      nodeByName.set(artist.name, node);
      plane!.appendChild(node);
    });
    viewport.appendChild(plane);
  }

  // Fit the whole cloud in the viewport, centred, with a little breathing room
  // (nodes overhang their layout points by half a card).
  function fitView(): void {
    fitScale = (Math.min(viewport.clientWidth, viewport.clientHeight) / world) * 0.92;
    scale = fitScale;
    offsetX = (viewport.clientWidth - world * scale) / 2;
    offsetY = (viewport.clientHeight - world * scale) / 2;
    applyTransform();
  }

  // --- 🔍 search: light up what was asked for, and bring it into view.

  /**
   * Light a chosen suggestion, or (with `null`) put the map back as it was.
   *
   * Three levels, matching what a viewer wants to know: the artists the query
   * named, the neighbourhoods they live in, and everything else. Returns what
   * it lit, so the caller can reveal it without resolving twice.
   */
  function applySpotlight(entry: SearchEntry | null): Spotlight | null {
    if (plane === null || layout === null) return null;
    for (const element of [...nodeByName.values(), ...haloByName.values(), ...ringByCluster]) {
      element.classList.remove("spotlit", "in-spotlight");
    }
    plane.classList.toggle("spotlit", entry !== null);
    // The haze recedes with everything else, but it is not on the plane, so it
    // takes the class itself.
    haze?.classList.toggle("spotlit", entry !== null);
    if (entry === null) return null;
    const spotlight = resolveSpotlight(layout, artists, entry);
    for (const index of spotlight.clusters) {
      ringByCluster[index]?.classList.add("spotlit");
      // Cluster-mates the query did not name sit at the middle level: the point
      // is to show where the match lives, not to hide the company it keeps.
      for (const member of layout.clusters[index]!.members) {
        nodeByName.get(member)?.classList.add("in-spotlight");
      }
    }
    for (const name of spotlight.artists) {
      const node = nodeByName.get(name);
      node?.classList.remove("in-spotlight");
      node?.classList.add("spotlit");
      // A loner is in no ring; the halo it already has is what marks it out.
      haloByName.get(name)?.classList.add("spotlit");
    }
    return spotlight;
  }

  // The lit region's bounding box in world px: every lit cluster's circle, and
  // every named artist's node (which covers the loners, who have no circle).
  // Null when nothing was lit — a tag whose carriers the roster has since lost.
  function spotlightBounds(
    spotlight: Spotlight,
  ): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const index of spotlight.clusters) {
      const cluster = layout!.clusters[index]!;
      const radius = cluster.radius * world;
      xs.push(cluster.x * world - radius, cluster.x * world + radius);
      ys.push(cluster.y * world - radius, cluster.y * world + radius);
    }
    layout!.points.forEach((point) => {
      if (!spotlight.artists.has(point.name)) return;
      xs.push(point.x * world - NODE_SPACING / 2, point.x * world + NODE_SPACING / 2);
      ys.push(point.y * world - NODE_SPACING / 2, point.y * world + NODE_SPACING / 2);
    });
    if (xs.length === 0) return null;
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }

  /**
   * Move the view only as far as it must to make the lit region visible.
   *
   * A spotlight the viewer can already see is left exactly where it is —
   * yanking the map about after every search would lose the place they had
   * found. When it is off screen (or only partly on), zoom out just far enough
   * to fit it, never in, and centre it.
   */
  function revealSpotlight(spotlight: Spotlight): void {
    if (layout === null) return;
    const bounds = spotlightBounds(spotlight);
    if (bounds === null) return;
    const onScreen = {
      left: bounds.minX * scale + offsetX,
      top: bounds.minY * scale + offsetY,
      right: bounds.maxX * scale + offsetX,
      bottom: bounds.maxY * scale + offsetY,
    };
    if (
      onScreen.left >= REVEAL_MARGIN &&
      onScreen.top >= REVEAL_MARGIN &&
      onScreen.right <= viewport.clientWidth - REVEAL_MARGIN &&
      onScreen.bottom <= viewport.clientHeight - REVEAL_MARGIN
    ) {
      return;
    }
    // The scale at which the region just fits. A single artist has no extent on
    // one axis, giving Infinity — which `min` below correctly reads as "no zoom
    // change needed".
    const fits = Math.min(
      (viewport.clientWidth - 2 * REVEAL_MARGIN) / (bounds.maxX - bounds.minX),
      (viewport.clientHeight - 2 * REVEAL_MARGIN) / (bounds.maxY - bounds.minY),
    );
    scale = Math.max(Math.min(scale, fits), fitScale * MIN_SCALE_FACTOR);
    offsetX = viewport.clientWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
    offsetY = viewport.clientHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * scale;
    clampPan();
    glide(applyTransform);
  }

  // Run a view change as a short animated move rather than a jump. The class is
  // dropped on a timer rather than on `transitionend`, which never fires when
  // the transform happens to land where it already was.
  function glide(update: () => void): void {
    if (plane === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }
    plane.classList.add("gliding");
    window.setTimeout(() => plane?.classList.remove("gliding"), REVEAL_MS + 50);
    update();
    // The plane's move is a CSS transition, which the haze — drawn in screen
    // space, from numbers this module holds — knows nothing about. So follow it:
    // each frame, redraw against the transform the transition is *currently*
    // showing, read back off the element. The loop ends with the class, whether
    // that is the timer above or a pan cancelling the glide, and its last pass
    // lands on the settled view.
    const follow = (): void => {
      if (plane === null) return;
      const gliding = plane.classList.contains("gliding");
      const matrix = new DOMMatrix(window.getComputedStyle(plane).transform);
      paintHaze(matrix.a, matrix.e, matrix.f);
      if (gliding) window.requestAnimationFrame(follow);
    };
    window.requestAnimationFrame(follow);
  }

  // Any hand-driven pan or zoom cancels an in-flight glide, so a drag is never
  // animated behind the pointer.
  const stopGliding = (): void => plane?.classList.remove("gliding");

  // The plane's own layout survives a window resize untouched, but the haze is
  // drawn to the viewport's size, so it has to be told.
  window.addEventListener("resize", () => {
    if (dialog.open) scheduleHaze();
  });

  // Wheel (and trackpad pinch, which browsers deliver as ctrl+wheel) zooms,
  // anchored so the point under the cursor stays put while the scale changes.
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      stopGliding();
      // Firefox reports line-based deltas for mouse wheels; convert to ~px.
      const deltaY =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      const nextScale = Math.min(
        Math.max(scale * Math.exp(-deltaY * 0.002), fitScale * MIN_SCALE_FACTOR),
        Math.max(MAX_SCALE, fitScale),
      );
      const rect = viewport.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      offsetX = cursorX - ((cursorX - offsetX) * nextScale) / scale;
      offsetY = cursorY - ((cursorY - offsetY) * nextScale) / scale;
      scale = nextScale;
      clampPan();
      applyTransform();
    },
    { passive: false },
  );

  // Drag-to-pan and pinch-to-zoom via pointer capture, so a gesture keeps
  // tracking even when a pointer leaves the window or passes over nodes. One
  // set of maths drives both: each move keeps the world point under the
  // tracked pointers' midpoint pinned to it, scaling by the ratio of the
  // pointers' separation — with a single pointer there is no separation, the
  // scale holds, and the re-anchoring reduces to a plain pan.
  const pointers = new Map<number, { x: number; y: number }>();
  // Midpoint and separation of the tracked pointers, in client coordinates
  // (separation 0 while only one pointer is down).
  const gestureState = (): { x: number; y: number; span: number } => {
    const [first, second] = [...pointers.values()];
    if (second === undefined) return { x: first!.x, y: first!.y, span: 0 };
    return {
      x: (first!.x + second.x) / 2,
      y: (first!.y + second.y) / 2,
      span: Math.hypot(second.x - first!.x, second.y - first!.y),
    };
  };
  viewport.addEventListener("pointerdown", (event) => {
    // Primary button/touch only, and at most two pointers — a third finger
    // would only wobble the midpoint, so it is ignored.
    if (event.button !== 0 || pointers.size >= 2) return;
    stopGliding();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("panning");
  });
  viewport.addEventListener("pointermove", (event) => {
    const tracked = pointers.get(event.pointerId);
    if (tracked === undefined) return;
    const before = gestureState();
    tracked.x = event.clientX;
    tracked.y = event.clientY;
    const after = gestureState();
    // Pinch: scale by how much the fingers spread, within the wheel zoom's
    // bounds. (Guarding both spans also covers fingers landing on the exact
    // same spot, whose ratio would otherwise degenerate to 0.)
    const nextScale =
      before.span > 0 && after.span > 0
        ? Math.min(
            Math.max((scale * after.span) / before.span, fitScale * MIN_SCALE_FACTOR),
            Math.max(MAX_SCALE, fitScale),
          )
        : scale;
    // Re-anchor so the world point that was under the old midpoint lands
    // under the new one (the same anchoring as the wheel zoom's).
    const rect = viewport.getBoundingClientRect();
    offsetX = after.x - rect.left - ((before.x - rect.left - offsetX) * nextScale) / scale;
    offsetY = after.y - rect.top - ((before.y - rect.top - offsetY) * nextScale) / scale;
    scale = nextScale;
    clampPan();
    applyTransform();
  });
  // A pointer lifting mid-pinch leaves the survivor panning alone; the next
  // move measures from the survivor's own midpoint, so the view doesn't jump.
  const releasePointer = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size === 0) viewport.classList.remove("panning");
  };
  viewport.addEventListener("pointerup", releasePointer);
  viewport.addEventListener("pointercancel", releasePointer);

  // --- The 🔍 control: a button that expands a field, and the field's
  // autocomplete. Markup is the static shell in index.html.

  const searchGroup = dialog.querySelector<HTMLElement>(".cloud-search")!;
  const searchToggle = dialog.querySelector<HTMLButtonElement>(".cloud-search-toggle")!;
  const searchInput = dialog.querySelector<HTMLInputElement>(".cloud-search-input")!;
  const searchClear = dialog.querySelector<HTMLButtonElement>(".cloud-search-clear")!;
  const resultList = dialog.querySelector<HTMLElement>(".cloud-search-results")!;

  // What the dropdown is currently offering, and which of those the keyboard
  // has moved to (-1 while none has been, so Enter takes the best match).
  let suggestions: SearchEntry[] = [];
  let activeIndex = -1;

  const optionId = (index: number): string => `cloud-search-option-${index}`;

  function closeDropdown(): void {
    resultList.hidden = true;
    resultList.replaceChildren();
    suggestions = [];
    activeIndex = -1;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
  }

  // Move the keyboard highlight, keeping the moved-to row in view — the list
  // scrolls once a query matches more than a few things.
  function setActive(index: number): void {
    for (const [i, option] of [...resultList.children].entries()) {
      option.classList.toggle("active", i === index);
    }
    activeIndex = index;
    if (index < 0) {
      searchInput.removeAttribute("aria-activedescendant");
      return;
    }
    searchInput.setAttribute("aria-activedescendant", optionId(index));
    resultList.children[index]?.scrollIntoView({ block: "nearest" });
  }

  function showSuggestions(): void {
    const query = searchInput.value;
    searchClear.hidden = query.length === 0;
    // Below the minimum there is no dropdown at all — distinct from a long
    // enough query that matched nothing, which says so.
    if (searchIndex === null || !isSearchable(query)) {
      closeDropdown();
      return;
    }
    suggestions = searchTargets(searchIndex, query);
    activeIndex = -1;
    searchInput.removeAttribute("aria-activedescendant");
    const rows = suggestions.map((entry, index) => {
      const option = document.createElement("li");
      option.className = "cloud-search-option";
      option.id = optionId(index);
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      const label = document.createElement("span");
      label.textContent = entry.label;
      option.appendChild(label);
      // A tag says how many artists it would light; an artist is one artist,
      // and the absence of a count is what tells the two kinds apart.
      if (entry.kind === "tag") {
        const count = document.createElement("span");
        count.className = "cloud-search-count";
        count.textContent = `${entry.carriers} ${entry.carriers === 1 ? "artist" : "artists"}`;
        option.appendChild(count);
      }
      return option;
    });
    if (rows.length === 0) {
      const empty = document.createElement("li");
      empty.className = "cloud-search-empty";
      empty.textContent = "No artist or tag matches";
      rows.push(empty);
    }
    resultList.replaceChildren(...rows);
    resultList.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  function select(entry: SearchEntry): void {
    searchInput.value = entry.label;
    searchClear.hidden = false;
    closeDropdown();
    const spotlight = applySpotlight(entry);
    if (spotlight !== null) revealSpotlight(spotlight);
  }

  function collapseSearch(): void {
    closeDropdown();
    searchGroup.hidden = true;
    searchToggle.setAttribute("aria-expanded", "false");
  }

  searchToggle.addEventListener("click", () => {
    if (!searchGroup.hidden) {
      collapseSearch();
      return;
    }
    searchGroup.hidden = false;
    searchToggle.setAttribute("aria-expanded", "true");
    searchInput.focus();
    searchInput.select();
  });

  searchInput.addEventListener("input", showSuggestions);

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(
        activeIndex < 0
          ? step > 0
            ? 0
            : suggestions.length - 1
          : (activeIndex + step + suggestions.length) % suggestions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = suggestions[activeIndex < 0 ? 0 : activeIndex];
      if (chosen !== undefined) select(chosen);
      return;
    }
    if (event.key === "Escape" && !resultList.hidden) {
      // Dismiss the suggestions rather than the whole map. With the dropdown
      // already closed, Escape is left alone and closes the dialog as usual.
      event.preventDefault();
      event.stopPropagation();
      closeDropdown();
    }
  });

  // Pressing on a suggestion must not blur the field first: the blur would
  // close the dropdown and the click would land on nothing.
  resultList.addEventListener("mousedown", (event) => event.preventDefault());

  resultList.addEventListener("click", (event) => {
    const option = (event.target as HTMLElement).closest(".cloud-search-option");
    if (option === null) return;
    const chosen = suggestions[[...resultList.children].indexOf(option)];
    if (chosen !== undefined) select(chosen);
  });

  // Clearing the query is the one thing that puts the lights back on: a
  // spotlight outlives selecting, closing the dropdown and even closing the map.
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.hidden = true;
    closeDropdown();
    applySpotlight(null);
    searchInput.focus();
  });

  // Leaving an empty field folds the control back to its button; a field still
  // holding a query stays open, since it is the only way back to that ✕.
  searchGroup.addEventListener("focusout", (event) => {
    if (searchGroup.contains(event.relatedTarget as Node | null)) return;
    if (searchInput.value.length === 0) collapseSearch();
    else closeDropdown();
  });

  closeButton.addEventListener("click", () => dialog.close());

  return {
    open(): void {
      if (plane === null) buildPlane();
      dialog.showModal();
      // Fit only once shown: the viewport has its full-screen size — and the
      // current screen may differ from last open — only while the dialog is up.
      fitView();
    },
  };
}
