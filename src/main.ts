// App entry point: populate the picker dropdowns, build the board, and wire up the
// toolbar's Reset, Save, and weighted 🎲 random picker. (The static shell is in index.html.)

import "./styles.css";
import { artists } from "./data";
import * as store from "./store";
import { createBoard, type MoveRecord } from "./board";
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
const rollButton = app.querySelector<HTMLButtonElement>("#roll")!;
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

/** Snapshot of every artist's current slot, for the picker. */
function currentSlots(): Map<string, Slot> {
  return new Map<string, Slot>(artists.map((a) => [a.name, store.currentSlot(a.name)]));
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
  // The "X only" cutoff has no tiers to weight, so hide its intensity dropdown.
  intensitySelect.hidden = scheme.cutoff === UNRANKED;
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

board.setCutoff(currentScheme().cutoff);
refreshControls();
