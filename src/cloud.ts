// The ☁️ artist map: a full-screen dialog laying the whole roster out on a
// pannable, zoomable plane, clustered by tag similarity. The geometry comes
// from cloud-layout.ts; this module renders it and drives the interaction.

import { artists } from "./data";
import { computeCloudLayout } from "./cloud-layout";
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

// The cluster glows are drawn half again larger than the cluster's geometric
// radius, so the light spills past the outermost members and feathers into
// the gulf around the cluster instead of stopping dead at its boundary.
const GLOW_SCALE = 1.5;

// An unclustered artist's halo: the geometric radius of a one-artist ring
// (matching the layout's ring padding around an outermost member), so loners
// glow on the same scale as the clusters beside them.
const LONER_GLOW_RADIUS = 0.75 * NODE_SPACING;

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

  // The view transform: screen = world × scale + (offsetX, offsetY), applied to
  // the plane as a single translate+scale (so panning and zooming never touch
  // the per-node geometry).
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let fitScale = 1; // the whole-cloud overview scale, recomputed per open

  function applyTransform(): void {
    plane!.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
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
    const layout = computeCloudLayout(artists);
    world = NODE_SPACING / layout.spacing;
    // Rings go onto the plane first, so the artist nodes paint over them.
    for (const cluster of layout.clusters) {
      const ring = document.createElement("div");
      ring.className = "cloud-ring";
      ring.style.left = `${cluster.x * world}px`;
      ring.style.top = `${cluster.y * world}px`;
      const diameter = 2 * cluster.radius * world * GLOW_SCALE;
      ring.style.width = `${diameter}px`;
      ring.style.height = `${diameter}px`;
      // Hovering the space inside a ring explains the cluster — handy at the
      // fitted overview, where the member names are too small to read.
      ring.title = `${cluster.tag} (${cluster.members.length} artists)\n${cluster.members.join(", ")}`;
      plane.appendChild(ring);
    }
    // Unclustered artists get a halo of their own — a node-sized pool of the
    // same light, so a loner reads as deliberately alone, not forgotten. Its
    // tooltip is the artist's own, mirroring the cluster glows' explanations.
    const clustered = new Set(layout.clusters.flatMap((cluster) => cluster.members));
    artists.forEach((artist, i) => {
      if (clustered.has(artist.name)) return;
      const halo = document.createElement("div");
      halo.className = "cloud-ring";
      halo.style.left = `${layout.points[i]!.x * world}px`;
      halo.style.top = `${layout.points[i]!.y * world}px`;
      const diameter = 2 * LONER_GLOW_RADIUS * GLOW_SCALE;
      halo.style.width = `${diameter}px`;
      halo.style.height = `${diameter}px`;
      halo.title = artistTooltip(artist);
      plane!.appendChild(halo);
    });
    artists.forEach((artist, i) => {
      const node = document.createElement("div");
      node.className = "cloud-node";
      node.style.left = `${layout.points[i]!.x * world}px`;
      node.style.top = `${layout.points[i]!.y * world}px`;
      node.title = artistTooltip(artist);
      const label = document.createElement("span");
      label.className = "name";
      label.textContent = artist.name;
      node.append(createThumb(artist), label);
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

  // Wheel (and trackpad pinch, which browsers deliver as ctrl+wheel) zooms,
  // anchored so the point under the cursor stays put while the scale changes.
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
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
