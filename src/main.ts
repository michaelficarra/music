// App entry point: build the board and the toolbar, and wire up Reset, Save,
// and the weighted 🎲 random picker.

import "./styles.css";
import { artists } from "./data";
import * as store from "./store";
import { createBoard } from "./board";
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

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app container not found");

app.innerHTML = `
  <header class="toolbar">
    <h1>Michael's Artist Tier List</h1>
    <div class="picker">
      <select id="cutoff" aria-label="Tier cutoff"></select>
      <select id="intensity" aria-label="Weighting intensity"></select>
      <button id="roll" type="button" title="Pick a random artist">🎲</button>
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
  // Start the clipboard write and open GitHub's editor in the same user gesture so
  // neither the clipboard permission nor the popup blocker rejects them. (window.open
  // after an awaited promise is treated as a non-user-initiated popup and is blocked.)
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

board.setCutoff(currentScheme().cutoff);
refreshControls();
