// App entry point: populate the picker dropdowns, build the board, and wire up the
// toolbar's Reset, Save, and weighted 🎲 random picker. (The static shell is in index.html.)

import "./styles.css";
import { allTags, artists } from "./data";
import { isFilterMode, matchesTags, type FilterMode } from "./filter";
import { groupTags } from "./tag-groups";
import * as store from "./store";
import { createBoard, type MoveRecord } from "./board";
import { createCloud } from "./cloud";
import { createStats } from "./stats-view";
import { TIERS, UNRANKED, type Slot } from "./types";
import {
  INTENSITY_LABEL,
  INTENSITIES,
  cutoffLabel,
  schemeId,
  parseSchemeId,
  hasEligible,
  pick,
  type Scheme,
} from "./random";

const DEFAULT_SCHEME: Scheme = { cutoff: "D", intensity: "weighted" };

// GitHub's edit page can't be pre-filled from a URL, so Save copies the CSV to the
// clipboard and opens this edit page for the maintainer to paste over and commit.
// Hard-coded to this repo; update it if the repo is renamed or moved.
const EDIT_URL = "https://github.com/michaelficarra/music/edit/main/data/artists.csv";

// Only the deployed site opens the editor; elsewhere (local dev, forks) Save just
// copies, so it stays testable without spawning a tab to a repo you can't push to.
const SITE_URL = "https://michaelficarra.github.io/music/";

// The static UI shell (toolbar, board container, toast, reset dialog) is markup in
// index.html, so it paints during module load rather than after this script runs. Here
// we just grab those elements and wire up behaviour; main.ts populates the dynamic bits
// (the two <select>s and the board) below.
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app container not found");

const boardEl = app.querySelector<HTMLElement>("#board")!;
const cutoffSelect = app.querySelector<HTMLSelectElement>("#cutoff")!;
const intensitySelect = app.querySelector<HTMLSelectElement>("#intensity")!;
const filterButton = app.querySelector<HTMLButtonElement>("#filter")!;
const filterPanel = app.querySelector<HTMLDivElement>("#filter-panel")!;
const filterTagsEl = app.querySelector<HTMLElement>("#filter-tags")!;
const filterClearButton = app.querySelector<HTMLButtonElement>("#filter-clear")!;
const filterHint = app.querySelector<HTMLElement>(".filter-hint")!;
const filterModeRadios = app.querySelectorAll<HTMLInputElement>('input[name="filter-mode"]');
const rollButton = app.querySelector<HTMLButtonElement>("#roll")!;
const cloudButton = app.querySelector<HTMLButtonElement>("#cloud")!;
const cloudDialog = app.querySelector<HTMLDialogElement>("#cloud-dialog")!;
const statsButton = app.querySelector<HTMLButtonElement>("#stats")!;
const statsDialog = app.querySelector<HTMLDialogElement>("#stats-dialog")!;
const dirtyActions = app.querySelector<HTMLElement>(".dirty-actions")!;
const resetButton = app.querySelector<HTMLButtonElement>("#reset")!;
const saveButton = app.querySelector<HTMLButtonElement>("#save")!;
const toast = app.querySelector<HTMLElement>("#toast")!;
const pickAnnouncer = app.querySelector<HTMLElement>("#pick-announcer")!;
const resetDialog = app.querySelector<HTMLDialogElement>("#reset-dialog")!;
const resetDiff = app.querySelector<HTMLElement>("#reset-diff")!;
const saveDialog = app.querySelector<HTMLDialogElement>("#save-dialog")!;
const saveDiff = app.querySelector<HTMLElement>("#save-diff")!;

// Populate the two scheme dropdowns: tier cutoff and weighting intensity.
for (const cutoff of TIERS) {
  const option = document.createElement("option");
  option.value = cutoff;
  option.textContent = cutoffLabel(cutoff);
  cutoffSelect.appendChild(option);
}
// "X only" sits at the bottom: it draws from the unranked pool rather than any ranked tier.
const unrankedCutoffOption = document.createElement("option");
unrankedCutoffOption.value = UNRANKED;
unrankedCutoffOption.textContent = cutoffLabel(UNRANKED);
cutoffSelect.appendChild(unrankedCutoffOption);
for (const intensity of INTENSITIES) {
  const option = document.createElement("option");
  option.value = intensity;
  option.textContent = INTENSITY_LABEL[intensity];
  intensitySelect.appendChild(option);
}

// Restore the last-used scheme, falling back to the default.
const initialScheme = (() => {
  const saved = store.loadSchemeId();
  return (saved !== null ? parseSchemeId(saved) : null) ?? DEFAULT_SCHEME;
})();
cutoffSelect.value = initialScheme.cutoff;
intensitySelect.value = initialScheme.intensity;

function currentScheme(): Scheme {
  return parseSchemeId(`${cutoffSelect.value}:${intensitySelect.value}`) ?? DEFAULT_SCHEME;
}

// --- Tag filter: restricts 🎲 to artists carrying every selected tag, and dims
// the rest of the board (board.setTagFilter). The panel is a native popover
// (markup in index.html); here we fill it with a checkbox per tag and keep the
// selection, button label, board, and storage in sync.

// One labelled checkbox per distinct roster tag, grouped by vocabulary category
// (genres / musical qualities / eras / notable aspects) and sorted within each.
const filterCheckboxes = new Map<string, HTMLInputElement>();
for (const group of groupTags(allTags)) {
  const heading = document.createElement("h3");
  heading.className = "filter-group-label";
  heading.textContent = group.label;
  const grid = document.createElement("div");
  grid.className = "filter-group-tags";
  for (const tag of group.tags) {
    const option = document.createElement("label");
    option.className = "filter-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = tag;
    option.append(checkbox, document.createTextNode(tag));
    grid.appendChild(option);
    filterCheckboxes.set(tag, checkbox);
  }
  filterTagsEl.append(heading, grid);
}

// Restore the persisted selection, dropping tags that no longer exist in the
// roster (e.g. after a data edit renamed one).
const selectedTags = new Set(store.loadFilterTags().filter((tag) => filterCheckboxes.has(tag)));
for (const tag of selectedTags) filterCheckboxes.get(tag)!.checked = true;

// How the selected tags combine: "all" (every tag) or "any" (at least one).
let filterMode: FilterMode = store.loadFilterMode();
for (const radio of filterModeRadios) radio.checked = radio.value === filterMode;

function updateFilterButton(): void {
  const count = selectedTags.size;
  filterButton.textContent =
    count === 0 ? "no filters" : count === 1 ? "1 filter" : `${count} filters`;
}

// Keep the panel's hint sentence in step with the mode toggle.
function updateFilterHint(): void {
  filterHint.textContent =
    filterMode === "all"
      ? "🎲 picks only artists matching every checked tag"
      : "🎲 picks only artists matching at least one checked tag";
}

// After any selection or mode change: persist, relabel the button, re-dim the
// board, and refresh 🎲 (which disables when no artist matches filter + cutoff).
function onFilterChange(): void {
  store.saveFilterTags([...selectedTags].sort());
  store.saveFilterMode(filterMode);
  updateFilterButton();
  updateFilterHint();
  board.setTagFilter(selectedTags, filterMode);
  refreshControls();
}

for (const radio of filterModeRadios) {
  radio.addEventListener("change", () => {
    if (radio.checked && isFilterMode(radio.value)) {
      filterMode = radio.value;
      onFilterChange();
    }
  });
}

filterTagsEl.addEventListener("change", (event) => {
  const checkbox = event.target as HTMLInputElement;
  if (checkbox.checked) selectedTags.add(checkbox.value);
  else selectedTags.delete(checkbox.value);
  onFilterChange();
});

filterClearButton.addEventListener("click", () => {
  selectedTags.clear();
  for (const checkbox of filterCheckboxes.values()) checkbox.checked = false;
  onFilterChange();
});

// Anchor the panel under its button on each open. Popovers are fixed-position in
// the top layer, so without this the UA default styles would centre it in the
// viewport. Re-measured per open: the button's position shifts with viewport
// width and toolbar wrapping. (The toolbar is sticky, so scrolling can't move
// the anchor while the panel is open.)
filterPanel.addEventListener("toggle", (event) => {
  if ((event as ToggleEvent).newState !== "open") return;
  const anchor = filterButton.getBoundingClientRect();
  const width = filterPanel.offsetWidth;
  const left = Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8);
  filterPanel.style.left = `${Math.max(8, left)}px`;
  filterPanel.style.top = `${anchor.bottom + 8}px`;
  // Never extend past the bottom of the viewport; the tag grid scrolls instead.
  filterPanel.style.maxHeight = `calc(100dvh - ${anchor.bottom + 16}px)`;
});

/** Snapshot of each filter-matching artist's current slot, for the picker. */
function currentSlots(): Map<string, Slot> {
  return new Map<string, Slot>(
    artists
      .filter((artist) => matchesTags(artist, selectedTags, filterMode))
      .map((artist) => [artist.name, store.currentSlot(artist.name)]),
  );
}

/** An optional actionable button rendered alongside a toast message (e.g. Undo). */
interface ToastAction {
  label: string;
  onClick: () => void;
}

let toastTimer: number | undefined;
function hideToast(): void {
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
    toastTimer = undefined;
  }
  toast.hidden = true;
}

function showToast(message: string, action?: ToastAction, duration = 2000): void {
  // Rebuild the toast's contents: a message span, plus an action button when given.
  toast.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.onClick();
      hideToast();
    });
    toast.appendChild(button);
  }
  toast.hidden = false;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, duration);
}

/** A slot's human-readable name for messages ("unranked" for the X pool). */
function slotLabel(slot: Slot): string {
  return slot === UNRANKED ? "unranked" : slot;
}

// Fill a confirmation dialog's diff list with one line per changed artist. The arrow
// direction depends on the action: Save shows base → local (what will be written out),
// Reset shows local → base (what reverting will restore).
function renderDiff(listEl: HTMLElement, direction: "save" | "reset"): void {
  listEl.replaceChildren();
  for (const { name, baseline, current } of store.getChanges()) {
    const [from, to] = direction === "save" ? [baseline, current] : [current, baseline];
    const li = document.createElement("li");
    li.textContent = `${name}: ${slotLabel(from)} → ${slotLabel(to)}`;
    listEl.appendChild(li);
  }
}

// Offer to undo a just-completed tier move. Held longer than a plain toast so the
// Undo button stays clickable; pressing it moves the artist back to its old slot.
function showUndoToast(move: MoveRecord): void {
  showToast(
    `Moved ${move.name} to ${slotLabel(move.to)}`,
    { label: "Undo", onClick: () => board.move(move.name, move.from) },
    6000,
  );
}

const board = createBoard(boardEl, onBoardChange);

// After any board change, refresh the toolbar; if it relocated an artist, offer undo.
function onBoardChange(move?: MoveRecord): void {
  refreshControls();
  if (move) showUndoToast(move);
}

function refreshControls(): void {
  // Reset/Save appear only when the arrangement differs from the shipped CSV.
  dirtyActions.hidden = !store.isChanged();
  const scheme = currentScheme();
  // "X only" (the unranked pool) and "S only" (a single tier) each draw from one
  // pool with no tiers to weight against each other, so weighting intensity is a
  // no-op — hide its dropdown while either is selected.
  intensitySelect.hidden = scheme.cutoff === UNRANKED || scheme.cutoff === TIERS[0];
  // 🎲 is disabled when the current scheme has no eligible artists — no ranked
  // artists above the cutoff, or (for "X only") an empty unranked pool.
  rollButton.disabled = !hasEligible(currentSlots(), scheme);
}

function onSchemeChange(): void {
  const scheme = currentScheme();
  store.saveSchemeId(schemeId(scheme));
  board.setCutoff(scheme.cutoff);
  refreshControls();
}
cutoffSelect.addEventListener("change", onSchemeChange);
intensitySelect.addEventListener("change", onSchemeChange);

rollButton.addEventListener("click", () => {
  // Exclude the previous pick so the same artist is never chosen twice in a row.
  const name = pick(currentSlots(), currentScheme(), Math.random, store.loadPickedName());
  if (name !== null) {
    store.savePickedName(name); // persists the glowing card until the next roll
    board.present(name);
    // The reveal is purely visual; announce the choice for screen-reader users.
    pickAnnouncer.textContent = `Picked ${name}`;
  }
});

// The ☁️ artist map: a full-screen, read-only view of the roster clustered by tag
// similarity (cloud.ts). It builds its plane lazily on the first open.
const cloud = createCloud(cloudDialog);
cloudButton.addEventListener("click", () => cloud.open());

// The 📊 statistics dialog: tag statistics over the built-in arrangement
// (stats-view.ts). Like the map, its content is fixed at build time, so it is
// built lazily on the first open and kept.
const statsView = createStats(statsDialog);
statsButton.addEventListener("click", () => statsView.open());

// Reset is destructive, so confirm via a modal first; it lists what will be reverted
// (each changed artist, local rank → base rank). The actual reset happens only when the
// dialog closes with the "confirm" value (Esc/Cancel do nothing).
resetButton.addEventListener("click", () => {
  renderDiff(resetDiff, "reset");
  resetDialog.showModal();
});

resetDialog.addEventListener("close", () => {
  if (resetDialog.returnValue !== "confirm") return;
  store.reset();
  board.rerender();
  refreshControls();
});

// Save also confirms via a modal, listing what will be written out (each changed artist,
// base rank → local rank). Nothing is copied or opened until the dialog is confirmed.
saveButton.addEventListener("click", () => {
  renderDiff(saveDiff, "save");
  saveDialog.showModal();
});

saveDialog.addEventListener("close", () => {
  if (saveDialog.returnValue !== "confirm") return;
  // Do the clipboard write and open GitHub's editor in the same user gesture so neither
  // the clipboard permission nor the popup blocker rejects them. The confirm submit
  // provides transient activation, and this close handler runs synchronously within that
  // gesture, so both are still treated as user-initiated. (window.open after an awaited
  // promise, by contrast, is treated as a non-user-initiated popup and is blocked.)
  const copied = navigator.clipboard.writeText(store.toCSV());
  const onDeployedSite = location.origin + location.pathname === SITE_URL;
  if (onDeployedSite) window.open(EDIT_URL, "_blank", "noopener");
  copied.then(
    () =>
      showToast(
        onDeployedSite
          ? "Copied CSV — paste it into the GitHub editor and commit"
          : "Copied updated CSV to clipboard",
      ),
    () => showToast("Could not access the clipboard"),
  );
});

// Light-dismiss (click the backdrop to close) for browsers without the declarative
// `closedby="any"` attribute, e.g. Safari. A modal dialog's backdrop clicks register on
// the dialog element itself, so a click whose target is the dialog and whose coordinates
// fall outside its content box is a backdrop click. Closing this way leaves returnValue
// as "" (showModal resets it), so the close handlers above treat it as a cancel.
function enableLightDismissFallback(dialog: HTMLDialogElement): void {
  if ("closedBy" in HTMLDialogElement.prototype) return; // native support; nothing to do
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return; // a click on the dialog's contents, not the backdrop
    const rect = dialog.getBoundingClientRect();
    const insideContent =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!insideContent) dialog.close();
  });
}
enableLightDismissFallback(resetDialog);
enableLightDismissFallback(saveDialog);
enableLightDismissFallback(statsDialog);

board.setCutoff(currentScheme().cutoff);
updateFilterButton();
updateFilterHint();
board.setTagFilter(selectedTags, filterMode); // re-apply a persisted filter's dimming on load
refreshControls();
