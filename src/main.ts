// App entry point: build the board and the toolbar, and wire up Reset, Save,
// and the weighted 🎲 random picker.

import "./styles.css";
import { artists } from "./data";
import * as store from "./store";
import { createBoard } from "./board";
import { TIERS, type Slot } from "./types";
import {
  SCHEMES,
  INTENSITY_LABEL,
  INTENSITIES,
  cutoffLabel,
  schemeId,
  parseSchemeId,
  hasEligible,
  pick,
  type Scheme,
} from "./random";

const DEFAULT_SCHEME: Scheme = { cutoff: "F", intensity: "weighted" };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app container not found");

app.innerHTML = `
  <header class="toolbar">
    <h1>Artist Tier List</h1>
    <div class="controls">
      <label class="picker">
        <button id="roll" type="button" title="Pick a random artist">🎲</button>
        <select id="scheme" aria-label="Weighting scheme"></select>
      </label>
      <div class="dirty-actions" hidden>
        <button id="reset" type="button">Reset</button>
        <button id="save" type="button">Save</button>
      </div>
    </div>
  </header>
  <main id="board" class="board"></main>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
`;

const boardEl = app.querySelector<HTMLElement>("#board")!;
const schemeSelect = app.querySelector<HTMLSelectElement>("#scheme")!;
const rollButton = app.querySelector<HTMLButtonElement>("#roll")!;
const dirtyActions = app.querySelector<HTMLElement>(".dirty-actions")!;
const resetButton = app.querySelector<HTMLButtonElement>("#reset")!;
const saveButton = app.querySelector<HTMLButtonElement>("#save")!;
const toast = app.querySelector<HTMLElement>("#toast")!;

// Populate the scheme dropdown, grouped by tier cutoff.
for (const cutoff of TIERS) {
  const group = document.createElement("optgroup");
  group.label = cutoffLabel(cutoff);
  for (const intensity of INTENSITIES) {
    const option = document.createElement("option");
    option.value = schemeId({ cutoff, intensity });
    option.textContent = `${cutoffLabel(cutoff)} — ${INTENSITY_LABEL[intensity]}`;
    group.appendChild(option);
  }
  schemeSelect.appendChild(group);
}

// Restore the last-used scheme, falling back to the default.
const savedScheme = store.loadSchemeId();
schemeSelect.value =
  savedScheme !== null && SCHEMES.some((s) => schemeId(s) === savedScheme)
    ? savedScheme
    : schemeId(DEFAULT_SCHEME);

function currentScheme(): Scheme {
  return parseSchemeId(schemeSelect.value) ?? DEFAULT_SCHEME;
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

schemeSelect.addEventListener("change", () => {
  store.saveSchemeId(schemeSelect.value);
  refreshControls();
});

rollButton.addEventListener("click", () => {
  const name = pick(currentSlots(), currentScheme());
  if (name !== null) board.highlight(name);
});

resetButton.addEventListener("click", () => {
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

refreshControls();
