// Renders the tier board (S…E + unranked) and wires drag-and-drop via SortableJS.

import Sortable from "sortablejs";
import { artists } from "./data";
import * as store from "./store";
import { TIERS, UNRANKED, type Artist, type Slot, type Tier } from "./types";

export interface Board {
  /** Re-place every card according to the store (used after Reset). */
  rerender(): void;
  /**
   * Reveal a picked artist's card large and centred, then animate it back into
   * its place in the grid (FLIP). Honours `prefers-reduced-motion`.
   */
  present(name: string): void;
  /**
   * Draw a divider line just below `cutoff`'s row to mark the picker's eligible
   * range (e.g. "C+" → between C and D). The lowest tier ("full") draws no line.
   */
  setCutoff(cutoff: Tier): void;
}

function createCard(artist: Artist): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.artist = artist.name;
  card.title = artist.name;

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (artist.imageURL) {
    const img = document.createElement("img");
    img.src = artist.imageURL;
    img.alt = artist.name;
    img.loading = "lazy";
    thumb.appendChild(img);
  } else {
    // No image yet: show the artist's first character as a placeholder.
    thumb.classList.add("placeholder");
    thumb.textContent = artist.name.slice(0, 1).toUpperCase();
  }

  const label = document.createElement("span");
  label.className = "name";
  label.textContent = artist.name;

  card.append(thumb, label);
  return card;
}

/**
 * Build the board into `container`. `onChange` is invoked after any drag that
 * may have altered tier membership (so the page can refresh Reset/Save/🎲).
 */
export function createBoard(container: HTMLElement, onChange: () => void): Board {
  const cardsByName = new Map<string, HTMLElement>();
  const lists = new Map<Slot, HTMLElement>();
  const rowsBySlot = new Map<Slot, HTMLElement>();

  // In-flight pick presentation (the real card, its flying clone, and timers).
  let activeCard: HTMLElement | null = null;
  let presenter: HTMLElement | null = null;
  let presentAnim: Animation | null = null;
  let settleTimer: number | undefined;

  // Click-to-edit tier popup state.
  let editorCard: HTMLElement | null = null;
  let justDragged = false; // suppresses the click that fires right after a drag

  // Divider marking the picker cutoff; reparented between rows by setCutoff().
  const cutoffLine = document.createElement("div");
  cutoffLine.className = "cutoff-line";
  cutoffLine.setAttribute("aria-hidden", "true");

  function addRow(slot: Slot, label: string, title?: string): void {
    const row = document.createElement("div");
    row.className = "tier-row";
    row.dataset.slot = slot;
    rowsBySlot.set(slot, row);

    const heading = document.createElement("div");
    heading.className = "tier-label";
    heading.textContent = label;
    if (title !== undefined) heading.title = title;

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
      if (list && card) list.appendChild(card);
    }
  }

  // Build rows: the six ranked tiers, then the always-visible unranked pool.
  container.innerHTML = "";
  for (const tier of TIERS) addRow(tier, tier);
  addRow(UNRANKED, "X", "Unranked — artists not sorted into a tier");

  for (const artist of artists) cardsByName.set(artist.name, createCard(artist));
  placeCards();

  // One Sortable per list, all sharing a group so cards drag between any list.
  const options: Sortable.Options = {
    group: "artists",
    animation: 150,
    onStart: () => closeEditor(),
    onEnd: (evt) => {
      justDragged = true;
      window.setTimeout(() => {
        justDragged = false;
      }, 0);
      const name = evt.item.dataset.artist;
      const slot = (evt.to as HTMLElement).dataset.slot;
      if (name !== undefined && slot !== undefined) {
        store.setSlot(name, slot as Slot);
        onChange();
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
      const slot: Slot = editorSelect.value === "X" ? UNRANKED : (editorSelect.value as Slot);
      store.setSlot(name, slot);
      lists.get(slot)?.appendChild(editorCard);
      onChange();
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
    if (presentAnim) {
      presentAnim.cancel();
      presentAnim = null;
    }
    if (presenter) {
      presenter.remove();
      presenter = null;
    }
    if (activeCard) {
      activeCard.style.visibility = "";
      activeCard.classList.remove("picked");
      activeCard = null;
    }
  }

  return {
    rerender(): void {
      placeCards();
    },
    present(name: string): void {
      const card = cardsByName.get(name);
      if (!card) return;
      clearPresentation();

      // Bring the card into view so its final (landing) position is on-screen.
      card.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
      activeCard = card;
      card.classList.add("picked"); // engages the outline + the dim spotlight

      // Reduced motion: skip the fly; just hold the highlight, then release.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        settleTimer = window.setTimeout(clearPresentation, 2500);
        return;
      }

      const rect = card.getBoundingClientRect();

      // A fixed-position clone occupying the card's final slot (FLIP "Last").
      const clone = card.cloneNode(true) as HTMLElement;
      clone.classList.add("pick-presenter");
      clone.classList.remove("picked");
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
      card.style.visibility = "hidden"; // hide the real card while the clone flies

      // FLIP "Invert": the transform that maps the final slot to a large, centred state.
      const scale = Math.min(6, Math.max(2.5, (0.5 * window.innerHeight) / rect.height));
      const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
      const dy = window.innerHeight / 2 - (rect.top + rect.height / 2);
      const big = `translate(${dx}px, ${dy}px) scale(${scale})`;
      const enter = `translate(${dx}px, ${dy}px) scale(${scale * 0.85})`;

      presentAnim = clone.animate(
        [
          { transform: enter, opacity: 0, offset: 0, easing: "ease-out" },
          { transform: big, opacity: 1, offset: 0.08 }, // pop in, large + centred
          { transform: big, opacity: 1, offset: 0.65, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }, // hold longer
          { transform: "none", opacity: 1, offset: 1 }, // fly back into place
        ],
        { duration: 2400, fill: "both" },
      );

      presentAnim.finished
        .then(() => {
          // Reveal the real (highlighted) card where the clone landed, hold the
          // dimmed + outlined state briefly, then clearPresentation removes
          // `.picked` and CSS transitions fade everything back to default.
          if (activeCard) activeCard.style.visibility = "";
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
    setCutoff(cutoff: Tier): void {
      cutoffLine.remove();
      // "full" (the lowest tier) means every tier is eligible → no divider.
      if (cutoff === TIERS[TIERS.length - 1]) return;
      rowsBySlot.get(cutoff)?.after(cutoffLine);
    },
  };
}
