// App entry point: build the board and the toolbar, and wire up Reset, Save,
// and the weighted 🎲 random picker.

import "./styles.css";
import { artists } from "./data";
import * as store from "./store";
import { createBoard } from "./board";
import { TIERS, type Slot } from "./types";
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

const DEFAULT_SCHEME: Scheme = { cutoff: "C", intensity: "weighted" };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app container not found");

app.innerHTML = `
  <header class="toolbar">
    <h1>Michael's Artist Tier List</h1>
    <div class="picker">
      <select id="cutoff" aria-label="Tier cutoff"></select>
      <select id="intensity" aria-label="Weighting intensity"></select>
      <button id="roll" type="button" title="Pick a random artist">🎲</button>
      <span id="picked-name" class="picked-name" aria-live="polite"></span>
    </div>
    <div class="dirty-actions" hidden>
      <button id="reset" type="button">Reset</button>
      <button id="save" type="button">Save</button>
    </div>
  </header>
  <main id="board" class="board"></main>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <dialog id="reset-dialog" class="modal">
    <form method="dialog">
      <h2>Reset tier list?</h2>
      <p>This discards your local changes and reverts to the saved tier list. This can't be undone.</p>
      <div class="modal-actions">
        <button value="cancel" type="submit" autofocus>Cancel</button>
        <button value="confirm" type="submit" class="danger">Reset</button>
      </div>
    </form>
  </dialog>
`;

const boardEl = app.querySelector<HTMLElement>("#board")!;
const cutoffSelect = app.querySelector<HTMLSelectElement>("#cutoff")!;
const intensitySelect = app.querySelector<HTMLSelectElement>("#intensity")!;
const rollButton = app.querySelector<HTMLButtonElement>("#roll")!;
const pickedName = app.querySelector<HTMLElement>("#picked-name")!;
const dirtyActions = app.querySelector<HTMLElement>(".dirty-actions")!;
const resetButton = app.querySelector<HTMLButtonElement>("#reset")!;
const saveButton = app.querySelector<HTMLButtonElement>("#save")!;
const toast = app.querySelector<HTMLElement>("#toast")!;
const resetDialog = app.querySelector<HTMLDialogElement>("#reset-dialog")!;

// Populate the two scheme dropdowns: tier cutoff and weighting intensity.
for (const cutoff of TIERS) {
  const option = document.createElement("option");
  option.value = cutoff;
  option.textContent = cutoffLabel(cutoff);
  cutoffSelect.appendChild(option);
}
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

let toastTimer: number | undefined;
function showToast(message: string): void {
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2000);
}

const board = createBoard(boardEl, refreshControls);

function refreshControls(): void {
  // Reset/Save appear only when the arrangement differs from the shipped CSV.
  dirtyActions.hidden = !store.isChanged();
  // 🎲 is disabled when the current scheme has no eligible (ranked) artists.
  rollButton.disabled = !hasEligible(currentSlots(), currentScheme());
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
  const name = pick(currentSlots(), currentScheme());
  if (name !== null) {
    pickedName.textContent = name;
    store.savePickedName(name); // persists beside the picker until the next roll
    board.present(name);
  }
});

// Reset is destructive, so confirm via a modal first; the actual reset happens
// only when the dialog closes with the "confirm" value (Esc/Cancel do nothing).
resetButton.addEventListener("click", () => {
  resetDialog.showModal();
});

resetDialog.addEventListener("close", () => {
  if (resetDialog.returnValue !== "confirm") return;
  store.reset();
  board.rerender();
  refreshControls();
});

saveButton.addEventListener("click", () => {
  navigator.clipboard.writeText(store.toCSV()).then(
    () => showToast("Copied updated CSV to clipboard"),
    () => showToast("Could not access the clipboard"),
  );
});

// Restore the last picked artist's name next to the picker (persists across reloads).
pickedName.textContent = store.loadPickedName() ?? "";

board.setCutoff(currentScheme().cutoff);
refreshControls();
