// Renders the tier board (S…F + unranked) and wires drag-and-drop via SortableJS.

import Sortable from "sortablejs";
import { artists } from "./data";
import * as store from "./store";
import { matchesTags, type FilterMode } from "./filter";
import { compareArtistNames } from "./sort";
import { artistTooltip, createThumb } from "./thumb";
import { TIERS, UNRANKED, type Artist, type Slot, type Tier } from "./types";

/** A single tier change, reported to `onChange` so the page can offer an undo. */
export interface MoveRecord {
  name: string;
  from: Slot;
  to: Slot;
}

export interface Board {
  /** Re-place every card according to the store (used after Reset). */
  rerender(): void;
  /**
   * Programmatically move an artist's card to a slot (DOM + store + counts),
   * exactly as a drag would. Used by the undo affordance; it reports no
   * `MoveRecord` of its own, so undoing never offers an undo-of-the-undo.
   */
  move(name: string, slot: Slot): void;
  /**
   * Reveal a picked artist's card large and centred, then animate it back into
   * its place in the grid (FLIP). Honours `prefers-reduced-motion`.
   */
  present(name: string): void;
  /**
   * Draw a divider line just below `cutoff`'s row to mark the picker's eligible
   * range (e.g. "D+" → between D and E). "F+" and UNRANKED ("X only") both draw
   * the line at the F/unranked boundary — for "F+" the eligible ranked tiers sit
   * above it, for "X only" the eligible unranked pool sits below it.
   */
  setCutoff(cutoff: Slot): void;
  /**
   * Dim every card whose artist does not match `selected` under `mode` — all of
   * the tags, or at least one (an empty selection dims nothing). Purely visual —
   * the matching restriction on 🎲 itself is applied by main.ts when it builds
   * the picker's slot map.
   */
  setTagFilter(selected: ReadonlySet<string>, mode: FilterMode): void;
}

// Insert `card` into `list` so the list stays in canonical artist-name order.
// Within-tier position carries no meaning (PRD §5), so every list is kept
// alphabetical for a predictable layout that survives drags, edits, and reloads.
function insertCardSorted(list: HTMLElement, card: HTMLElement): void {
  const name = card.dataset.artist ?? "";
  // Snapshot the children: we may move `card` (which is itself a child after a drag).
  for (const sibling of Array.from(list.children) as HTMLElement[]) {
    if (sibling === card) continue;
    if (compareArtistNames(name, sibling.dataset.artist ?? "") < 0) {
      list.insertBefore(card, sibling);
      return;
    }
  }
  list.appendChild(card);
}

function createCard(artist: Artist): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.artist = artist.name;
  card.title = artistTooltip(artist); // hover reveals the name + tags

  const label = document.createElement("span");
  label.className = "name";
  label.textContent = artist.name;

  card.append(createThumb(artist), label);
  return card;
}

/**
 * Build the board into `container`. `onChange` is invoked after any drag or edit
 * that may have altered tier membership (so the page can refresh Reset/Save/🎲).
 * When the change actually relocated an artist between slots, the move is passed
 * so the page can offer an undo; a no-op (e.g. a within-tier reorder) passes none.
 */
export function createBoard(container: HTMLElement, onChange: (move?: MoveRecord) => void): Board {
  const cardsByName = new Map<string, HTMLElement>();
  const lists = new Map<Slot, HTMLElement>();
  const rowsBySlot = new Map<Slot, HTMLElement>();
  const countsBySlot = new Map<Slot, HTMLElement>();

  // In-flight pick presentation (the real card, its flying clone, and timers).
  let activeCard: HTMLElement | null = null;
  let presenter: HTMLElement | null = null;
  let presentAnim: Animation | null = null;
  let settleTimer: number | undefined;
  // Fires partway through the fly-back to release the dim spotlight as the card
  // starts heading home, rather than waiting for the landing (see present()).
  let dimTimer: number | undefined;

  // The card wearing the persistent "last picked" glow, kept until the next pick.
  let lastPickedCard: HTMLElement | null = null;

  // Click-to-edit tier popup state.
  let editorCard: HTMLElement | null = null;
  let justDragged = false; // suppresses the click that fires right after a drag

  // Divider marking the picker cutoff; reparented between rows by setCutoff().
  // Two small labels sit on top of the line, centred side by side — "eligible"
  // then "ineligible" — each painted over the line; setCutoff() fills their arrows.
  const cutoffEl = document.createElement("div");
  cutoffEl.className = "cutoff";
  cutoffEl.setAttribute("aria-hidden", "true");

  const cutoffLine = document.createElement("div");
  cutoffLine.className = "cutoff-line";
  const cutoffEligible = document.createElement("div");
  cutoffEligible.className = "cutoff-label";
  const cutoffIneligible = document.createElement("div");
  cutoffIneligible.className = "cutoff-label";

  cutoffEl.append(cutoffLine, cutoffEligible, cutoffIneligible);

  function addRow(slot: Slot, label: string, title?: string): void {
    const row = document.createElement("div");
    row.className = "tier-row";
    row.dataset.slot = slot;
    rowsBySlot.set(slot, row);

    const heading = document.createElement("div");
    heading.className = "tier-label";
    if (title !== undefined) heading.title = title;

    const letter = document.createElement("span");
    letter.className = "tier-letter";
    letter.textContent = label;

    // Live count of cards in this tier, kept small so three digits still fit.
    const count = document.createElement("span");
    count.className = "tier-count";
    countsBySlot.set(slot, count);

    heading.append(letter, count);

    const list = document.createElement("div");
    list.className = "tier-list";
    list.dataset.slot = slot;
    lists.set(slot, list);

    row.append(heading, list);
    container.appendChild(row);
  }

  function placeCards(): void {
    for (const artist of artists) {
      const slot = store.currentSlot(artist.name);
      const list = lists.get(slot) ?? lists.get(UNRANKED);
      const card = cardsByName.get(artist.name);
      if (list && card) {
        insertCardSorted(list, card);
        markMoved(artist.name);
      }
    }
    updateCounts();
  }

  // Flag a card whose current tier differs from its shipped baseline, so unsaved
  // moves are visually distinct.
  function markMoved(name: string): void {
    cardsByName.get(name)?.classList.toggle("moved", store.isMoved(name));
  }

  // Move the persistent blue glow to `name`'s card, removing it from the previous
  // pick. Unlike the transient `.picked` highlight (which drives the fly + dim
  // spotlight and clears after a moment), this stays until the next roll.
  function setLastPicked(name: string): void {
    lastPickedCard?.classList.remove("last-picked");
    lastPickedCard = cardsByName.get(name) ?? null;
    lastPickedCard?.classList.add("last-picked");
  }

  // Refresh each tier's counter from the number of cards currently in its list.
  function updateCounts(): void {
    for (const [slot, count] of countsBySlot) {
      count.textContent = String(lists.get(slot)?.childElementCount ?? 0);
    }
  }

  // Build rows: the seven ranked tiers, then the always-visible unranked pool.
  container.innerHTML = "";
  for (const tier of TIERS) addRow(tier, tier);
  addRow(UNRANKED, "X", "Unranked — artists not sorted into a tier");

  for (const artist of artists) cardsByName.set(artist.name, createCard(artist));
  placeCards();

  // Re-apply the persisted glow so the last pick stays marked across reloads.
  const persistedPick = store.loadPickedName();
  if (persistedPick !== null) setLastPicked(persistedPick);

  // One Sortable per list, all sharing a group so cards drag between any list.
  const options: Sortable.Options = {
    group: "artists",
    animation: 150,
    // Auto-scroll the page while dragging near a viewport edge, so a card can be
    // dragged between distant tiers on a tall board without first scrolling.
    // `forceFallback` is essential: in native HTML5 drag mode SortableJS leaves
    // window scrolling to the browser (which Chrome doesn't do for the page body),
    // so auto-scroll silently no-ops on desktop. Forcing the pointer-based fallback
    // routes auto-scroll through the plugin's own scroller, which scrolls the window
    // — and matches the path touch input already uses. bubbleScroll lets that target
    // the window rather than only a nested scroll container.
    forceFallback: true,
    scroll: true,
    scrollSensitivity: 80,
    scrollSpeed: 12,
    bubbleScroll: true,
    onStart: () => closeEditor(),
    // Keep the dragged card at its canonical (alphabetical) position in the list it
    // is over, instead of following the pointer's x, so the live drop preview shows
    // the real landing slot (the board is always sorted — PRD §5).
    //
    // Split across onMove + onChange so the card is sorted the instant it enters a
    // tier, not only after it's nudged around inside one:
    //  - onMove blocks SortableJS's pointer-based reordering *within* a list
    //    (return false), but leaves *cross-list entry* to SortableJS (return
    //    undefined) — cancelling entry would corrupt its drop bookkeeping so onEnd
    //    would read the wrong tier.
    //  - onChange fires right after SortableJS inserts the card into a list (at the
    //    pointer); we then re-seat it at its sorted slot. Intra-list moves are
    //    blocked above, so they never reach onChange — no fight with the pointer.
    onMove: (evt) => (evt.dragged.parentNode === evt.to ? false : undefined),
    onChange: (evt) => insertCardSorted(evt.to, evt.item),
    onEnd: (evt) => {
      justDragged = true;
      window.setTimeout(() => {
        justDragged = false;
      }, 0);
      const name = evt.item.dataset.artist;
      const from = (evt.from as HTMLElement).dataset.slot;
      const to = (evt.to as HTMLElement).dataset.slot;
      if (name !== undefined && to !== undefined) {
        store.setSlot(name, to as Slot);
        // SortableJS dropped the card wherever the pointer released; re-seat it
        // into the list's canonical name order (drop position is meaningless).
        insertCardSorted(evt.to as HTMLElement, evt.item);
        markMoved(name);
        updateCounts();
        // Only a cross-slot drop is a real change worth offering to undo; a
        // within-tier reorder leaves membership untouched.
        onChange(from !== to ? { name, from: from as Slot, to: to as Slot } : undefined);
      }
    },
  };
  for (const list of lists.values()) new Sortable(list, options);

  // --- Click-to-edit: a small tier-selection popup shown when a card is clicked.
  // Appended to <body> (not a tier row) so the rows' overflow:hidden can't clip it.
  const editorEl = document.createElement("div");
  editorEl.className = "tier-editor";
  editorEl.hidden = true;

  const editorSelect = document.createElement("select");
  editorSelect.className = "tier-editor-select";
  editorSelect.setAttribute("aria-label", "Set tier");
  for (const tier of TIERS) {
    const option = document.createElement("option");
    option.value = tier;
    option.textContent = tier;
    editorSelect.appendChild(option);
  }
  const unrankedOption = document.createElement("option");
  unrankedOption.value = "X"; // X = unranked
  unrankedOption.textContent = "X";
  editorSelect.appendChild(unrankedOption);

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  // Stack vertically: dropdown, then Save, then Cancel.
  editorEl.append(editorSelect, saveButton, cancelButton);
  document.body.appendChild(editorEl);

  function openEditor(card: HTMLElement): void {
    const name = card.dataset.artist;
    if (name === undefined) return;
    if (editorCard && editorCard !== card) editorCard.classList.remove("editing");
    editorCard = card;
    card.classList.add("editing"); // dim the card beneath the form
    const slot = store.currentSlot(name);
    editorSelect.value = slot === UNRANKED ? "X" : slot;

    editorEl.hidden = false;
    // Centre the form over the card (clamped to the viewport), then convert to
    // document coordinates so the absolutely-positioned form scrolls with the card.
    const rect = card.getBoundingClientRect();
    const ew = editorEl.offsetWidth;
    const eh = editorEl.offsetHeight;
    const left = rect.left + rect.width / 2 - ew / 2;
    const top = rect.top + rect.height / 2 - eh / 2;
    const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - ew - 8));
    const clampedTop = Math.max(8, Math.min(top, window.innerHeight - eh - 8));
    editorEl.style.left = `${clampedLeft + window.scrollX}px`;
    editorEl.style.top = `${clampedTop + window.scrollY}px`;
    editorSelect.focus();
  }

  function closeEditor(): void {
    editorEl.hidden = true;
    if (editorCard) {
      editorCard.classList.remove("editing");
      editorCard = null;
    }
  }

  function saveEditor(): void {
    if (!editorCard) return;
    const name = editorCard.dataset.artist;
    if (name !== undefined) {
      const from = store.currentSlot(name);
      const slot: Slot = editorSelect.value === "X" ? UNRANKED : (editorSelect.value as Slot);
      store.setSlot(name, slot);
      const list = lists.get(slot);
      if (list) insertCardSorted(list, editorCard);
      markMoved(name);
      updateCounts();
      onChange(from !== slot ? { name, from, to: slot } : undefined);
    }
    closeEditor();
  }

  editorSelect.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveEditor();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeEditor();
    }
  });
  saveButton.addEventListener("click", saveEditor);
  cancelButton.addEventListener("click", closeEditor);

  // One document-level handler: clicking a card opens (or moves) the editor to
  // it; clicks inside the editor are left to its own controls; any other click
  // closes the editor.
  document.addEventListener("click", (event) => {
    if (justDragged) return;
    const target = event.target as HTMLElement;
    if (editorEl.contains(target)) return;
    const card = target.closest<HTMLElement>(".card");
    if (card && container.contains(card)) {
      openEditor(card);
    } else {
      closeEditor();
    }
  });

  // Tear down any in-progress presentation, restoring the real card.
  function clearPresentation(): void {
    if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    settleTimer = undefined;
    if (dimTimer !== undefined) window.clearTimeout(dimTimer);
    dimTimer = undefined;
    if (presentAnim) {
      presentAnim.cancel();
      presentAnim = null;
    }
    if (presenter) {
      presenter.remove();
      presenter = null;
    }
    if (activeCard) {
      activeCard.classList.remove("presenting");
      activeCard.classList.remove("picked");
      activeCard = null;
    }
  }

  return {
    rerender(): void {
      placeCards();
    },
    move(name: string, slot: Slot): void {
      const card = cardsByName.get(name);
      if (!card) return;
      store.setSlot(name, slot);
      const list = lists.get(slot);
      if (list) insertCardSorted(list, card);
      markMoved(name);
      updateCounts();
      onChange(); // no MoveRecord: undoing a move shouldn't offer to undo the undo
    },
    present(name: string): void {
      const card = cardsByName.get(name);
      if (!card) return;
      clearPresentation();

      // Drop the previous pick's glow the instant the roll begins, rather than
      // letting it linger through the fly animation until the new glow settles
      // on the chosen card at the end.
      lastPickedCard?.classList.remove("last-picked");
      lastPickedCard = null;

      // Bring the card into view so its final (landing) position is on-screen.
      card.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
      activeCard = card;
      card.classList.add("picked"); // engages the outline + the dim spotlight

      // Reduced motion: skip the fly; just hold the highlight, then release. The
      // card never leaves its slot, so the glow can settle on it right away.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setLastPicked(name);
        settleTimer = window.setTimeout(clearPresentation, 2500);
        return;
      }

      const rect = card.getBoundingClientRect();

      // A fixed-position clone occupying the card's final slot (FLIP "Last").
      const clone = card.cloneNode(true) as HTMLElement;
      clone.classList.add("pick-presenter");
      clone.classList.remove("picked");
      clone.classList.remove("last-picked"); // glow shows on the settled card, not the flying clone
      Object.assign(clone.style, {
        position: "fixed",
        margin: "0",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      document.body.appendChild(clone);
      presenter = clone;
      // Leave the real card in its slot but show it as a neutral placeholder (its
      // artwork rides along on the flying clone), so the grid keeps its shape and
      // the slot the card will return to stays visible.
      card.classList.add("presenting");

      // FLIP "Invert": the transform that maps the final slot to a large, centred state.
      const scale = Math.min(6, Math.max(2.5, (0.5 * window.innerHeight) / rect.height));
      const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
      const dy = window.innerHeight / 2 - (rect.top + rect.height / 2);
      const big = `translate(${dx}px, ${dy}px) scale(${scale})`;
      const enter = `translate(${dx}px, ${dy}px) scale(${scale * 0.85})`;

      const duration = 2400;
      const holdEnd = 0.65; // offset at which the clone stops holding and flies home

      presentAnim = clone.animate(
        [
          { transform: enter, opacity: 0, offset: 0, easing: "ease-out" },
          { transform: big, opacity: 1, offset: 0.08 }, // pop in, large + centred
          { transform: big, opacity: 1, offset: holdEnd, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }, // hold longer
          { transform: "none", opacity: 1, offset: 1 }, // fly back into place
        ],
        { duration, fill: "both" },
      );

      // Release the dim spotlight the moment the clone leaves centre and starts
      // flying home, so the board brightens back as the card travels rather than
      // snapping back only once it has landed and the glow is applied.
      dimTimer = window.setTimeout(() => {
        activeCard?.classList.remove("picked");
        dimTimer = undefined;
      }, duration * holdEnd);

      presentAnim.finished
        .then(() => {
          // Reveal the real card where the clone landed (swapping the placeholder
          // back to its artwork) and settle the persistent glow onto it; the dim
          // is already lifting from when the card began its flight home, and
          // clearPresentation tidies up the leftover state shortly after.
          if (activeCard) {
            setLastPicked(name);
            activeCard.classList.remove("presenting");
          }
          if (presenter) {
            presenter.remove();
            presenter = null;
          }
          presentAnim = null;
          settleTimer = window.setTimeout(clearPresentation, 900);
        })
        .catch(() => {
          /* cancelled by a newer pick — that call already cleaned up */
        });
    },
    setCutoff(cutoff: Slot): void {
      cutoffEl.remove();
      // The line always sits just below its anchor row. For a ranked cutoff that
      // is the cutoff tier itself (e.g. "D+" → between D and E). "F+" and "X only"
      // both anchor on F, drawing the line at the F/unranked boundary — for "F+"
      // every ranked tier above is eligible; for "X only" the unranked pool below is.
      const anchor: Tier = cutoff === UNRANKED ? TIERS[TIERS.length - 1]! : cutoff;
      rowsBySlot.get(anchor)?.after(cutoffEl);
      // "eligible"/"ineligible" stay put (left/right); the arrows point at each
      // region's side of the line. Normally the eligible pool is above and the
      // ineligible below, but "X only" inverts that — so the arrows flip.
      const swap = cutoff === UNRANKED;
      const eligibleArrow = swap ? "↓" : "↑";
      const ineligibleArrow = swap ? "↑" : "↓";
      cutoffEligible.textContent = `${eligibleArrow} 🎲 eligible ${eligibleArrow}`;
      cutoffIneligible.textContent = `${ineligibleArrow} 🎲 ineligible ${ineligibleArrow}`;
    },
    setTagFilter(selected: ReadonlySet<string>, mode: FilterMode): void {
      for (const artist of artists) {
        cardsByName
          .get(artist.name)
          ?.classList.toggle("filtered-out", !matchesTags(artist, selected, mode));
      }
    },
  };
}
