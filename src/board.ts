// Renders the tier board (S…F + unranked) and wires drag-and-drop via SortableJS.

import Sortable from "sortablejs";
import { artists } from "./data";
import * as store from "./store";
import { TIERS, UNRANKED, type Artist, type Slot, type Tier } from "./types";

export interface Board {
  /** Re-place every card according to the store (used after Reset). */
  rerender(): void;
  /** Briefly highlight an artist's card and scroll it into view. */
  highlight(name: string): void;
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
  let highlighted: HTMLElement | null = null;
  let highlightTimer: number | undefined;

  // Divider marking the picker cutoff; reparented between rows by setCutoff().
  const cutoffLine = document.createElement("div");
  cutoffLine.className = "cutoff-line";
  cutoffLine.setAttribute("aria-hidden", "true");

  function addRow(slot: Slot, label: string): void {
    const row = document.createElement("div");
    row.className = "tier-row";
    row.dataset.slot = slot;
    rowsBySlot.set(slot, row);

    const heading = document.createElement("div");
    heading.className = "tier-label";
    heading.textContent = label;

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
  addRow(UNRANKED, "Unranked");

  for (const artist of artists) cardsByName.set(artist.name, createCard(artist));
  placeCards();

  // One Sortable per list, all sharing a group so cards drag between any list.
  const options: Sortable.Options = {
    group: "artists",
    animation: 150,
    onEnd: (evt) => {
      const name = evt.item.dataset.artist;
      const slot = (evt.to as HTMLElement).dataset.slot;
      if (name !== undefined && slot !== undefined) {
        store.setSlot(name, slot as Slot);
        onChange();
      }
    },
  };
  for (const list of lists.values()) new Sortable(list, options);

  return {
    rerender(): void {
      placeCards();
    },
    highlight(name: string): void {
      const card = cardsByName.get(name);
      if (!card) return;
      if (highlighted) highlighted.classList.remove("picked");
      if (highlightTimer !== undefined) window.clearTimeout(highlightTimer);
      card.classList.add("picked");
      card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      highlighted = card;
      highlightTimer = window.setTimeout(() => {
        card.classList.remove("picked");
        if (highlighted === card) highlighted = null;
      }, 2500);
    },
    setCutoff(cutoff: Tier): void {
      cutoffLine.remove();
      // "full" (the lowest tier) means every tier is eligible → no divider.
      if (cutoff === TIERS[TIERS.length - 1]) return;
      rowsBySlot.get(cutoff)?.after(cutoffLine);
    },
  };
}
