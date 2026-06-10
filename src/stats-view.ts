// The 📊 statistics dialog: renders the tag statistics computed by stats.ts
// into the static shell in index.html (a .stats-body inside a .modal form).
// The content is a pure function of the build-embedded roster — local edits
// never change it — so it is built once, on the first open, and kept for the
// session, like the ☁️ map's plane.

import { artists } from "./data";
import {
  computeStats,
  positionFraction,
  tierBand,
  tierLabel,
  type ArtistOutlier,
  type CategorySuperlative,
  type TagStat,
} from "./stats";

export interface StatsView {
  /** Show the dialog, building its content on first use. */
  open(): void;
}

/** A signed one-decimal delta with a proper minus sign, e.g. "+2.3" / "−1.4". */
function signedDelta(delta: number): string {
  return (delta > 0 ? "+" : "−") + Math.abs(delta).toFixed(1);
}

/**
 * One statistic row: grade chip | name (with its muted annotation in
 * parentheses) | optional gauge. The chip expresses `score`; the gauge — an
 * average-sized bar or a spread range — fills the third column, and with
 * none the name spans that column instead (the .no-bar CSS), as in the
 * category-favourite rows, where the grade chip says enough on its own. The
 * row's cells become items of the section's shared grid (the row itself is
 * display:contents), which is what keeps the columns aligned down a whole
 * list.
 */
function statRow(
  name: string,
  score: number,
  detail: string,
  gauge: HTMLElement | null,
): HTMLElement {
  const row = document.createElement("div");
  row.className = gauge === null ? "stat-row no-bar" : "stat-row";
  row.append(tierChip(score), nameCell(name, detail));
  if (gauge !== null) row.appendChild(gauge);
  return row;
}

/** The tier-pastel grade chip for a score. */
function tierChip(score: number): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "stat-tier";
  chip.dataset.tier = tierBand(score).tier; // picks the chip's tier pastel
  chip.textContent = tierLabel(score);
  return chip;
}

/** The name cell: the label with its muted annotation in parentheses. */
function nameCell(name: string, detail: string): HTMLElement {
  const nameEl = document.createElement("span");
  nameEl.className = "stat-name";
  nameEl.textContent = name;
  const detailEl = document.createElement("span");
  detailEl.className = "stat-detail";
  detailEl.textContent = ` (${detail})`;
  nameEl.appendChild(detailEl);
  nameEl.title = `${name} (${detail})`; // a truncated row stays readable on hover
  return nameEl;
}

/** The accent bar carried by the tag and decade lists, filled to `fraction`
    of the track (0..1); the tooltip states the fill. */
function meanBar(fraction: number): HTMLElement {
  const bar = document.createElement("span");
  bar.className = "stat-bar";
  bar.title = `${Math.round(fraction * 100)}%`;
  const fill = document.createElement("span");
  fill.className = "stat-fill";
  fill.style.setProperty("--fraction", String(fraction));
  bar.appendChild(fill);
  return bar;
}

/**
 * The predictor rows' gauge (worst and best), on the same track a bar would
 * occupy: a band from `low` to `high` with a dot at `centre`. Positions use
 * the full tier axis (positionFraction) — an all-F point sits at the track's
 * left end.
 */
function rangeGauge(low: number, high: number, centre: number): HTMLElement {
  const gauge = document.createElement("span");
  gauge.className = "stat-range";
  const band = document.createElement("span");
  band.className = "stat-range-band";
  band.style.setProperty("--lo", String(positionFraction(low)));
  band.style.setProperty("--hi", String(positionFraction(high)));
  const dot = document.createElement("span");
  dot.className = "stat-range-dot";
  dot.style.setProperty("--at", String(positionFraction(centre)));
  gauge.append(band, dot);
  return gauge;
}

/**
 * The outlier rows' gauge: a ring at the predicted score joined to a dot at
 * the actual one by a thin connector — the gauge literally draws the delta
 * the list is ranked by. Positions use the full tier axis (positionFraction).
 */
function deltaGauge(predicted: number, actual: number): HTMLElement {
  const gauge = document.createElement("span");
  gauge.className = "stat-range";
  const link = document.createElement("span");
  link.className = "stat-range-link";
  link.style.setProperty("--lo", String(positionFraction(Math.min(predicted, actual))));
  link.style.setProperty("--hi", String(positionFraction(Math.max(predicted, actual))));
  const ring = document.createElement("span");
  ring.className = "stat-range-ring";
  ring.style.setProperty("--at", String(positionFraction(predicted)));
  const dot = document.createElement("span");
  dot.className = "stat-range-dot";
  dot.style.setProperty("--at", String(positionFraction(actual)));
  gauge.append(link, ring, dot);
  return gauge;
}

// --- One row constructor per kind of statistic ---

/** Carrier counts are always ≥ MIN_SUPPORT (3), so the plural is safe. */
const carrierCount = (stat: TagStat): string => `${stat.count} artists`;

const tagRow = (stat: TagStat, barFill: number): HTMLElement =>
  statRow(stat.tag, stat.mean, carrierCount(stat), meanBar(barFill));

const worstPredictorRow = (stat: TagStat): HTMLElement =>
  statRow(
    stat.tag,
    stat.mean,
    `${stat.above}↑/${stat.below}↓ of ${stat.count} artists`,
    rangeGauge(stat.low, stat.high, stat.mean),
  );

const bestPredictorRow = (stat: TagStat): HTMLElement =>
  statRow(
    stat.tag,
    stat.mean,
    `±${stat.spread.toFixed(1)} across ${stat.count} artists`,
    rangeGauge(stat.low, stat.high, stat.mean),
  );

/** How a tag-groups.ts category label reads as a row prefix. Unknown labels
    (a future category) fall back to themselves rather than vanishing. Eras
    never appear here — they have a section of their own (stats.ts). */
const CATEGORY_NOUN: Record<string, string> = {
  Genres: "Genre",
  "Musical qualities": "Musical quality",
  "Notable aspects": "Notable aspect",
};

/** One winner per category: the bold category name sits left of the grade,
    reading as the row's heading, and there is no gauge — nothing alongside
    to compare against. The three cells land on the section grid's three
    columns (the label takes the grade column's place, shifting grade and
    name right), which is fine because every row in this section agrees. */
const superlativeRow = (superlative: CategorySuperlative): HTMLElement => {
  const noun = CATEGORY_NOUN[superlative.category] ?? superlative.category;
  const row = document.createElement("div");
  row.className = "stat-row";
  const heading = document.createElement("strong");
  heading.textContent = `${noun}:`;
  row.append(
    heading,
    tierChip(superlative.stat.mean),
    nameCell(superlative.stat.tag, carrierCount(superlative.stat)),
  );
  return row;
};

/** The chip shows the artist's actual placement; the annotation says where
    its tags expected it. The gauge tells the same story spatially: the ring
    is the prediction, the dot the actual tier, the connector the gap. */
const outlierRow = (outlier: ArtistOutlier): HTMLElement =>
  statRow(
    outlier.name,
    outlier.score,
    `predicted ${tierLabel(outlier.predicted)}, ${signedDelta(outlier.delta)}`,
    deltaGauge(outlier.predicted, outlier.score),
  );

/**
 * A heading, a one-line explainer of what the statistic means, then the rows.
 * With no rows the section is omitted entirely — unless `emptyText` is given,
 * in which case the heading and explainer render over that muted line instead
 * (used by the outlier sections, where having nothing to report is itself a
 * finding).
 */
function section(
  heading: string,
  explainer: string,
  rows: HTMLElement[],
  emptyText?: string,
): HTMLElement | null {
  if (rows.length === 0 && emptyText === undefined) return null;
  const sectionEl = document.createElement("section");
  sectionEl.className = "stats-section";
  const headingEl = document.createElement("h3");
  headingEl.textContent = heading;
  const explainerEl = document.createElement("p");
  explainerEl.className = "stats-explainer";
  explainerEl.textContent = explainer;
  sectionEl.append(headingEl, explainerEl);
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "stats-empty";
    empty.textContent = emptyText!;
    sectionEl.appendChild(empty);
  } else {
    const rowsEl = document.createElement("div");
    rowsEl.className = "stat-rows";
    rowsEl.append(...rows);
    sectionEl.appendChild(rowsEl);
  }
  return sectionEl;
}

function buildBody(body: HTMLElement): void {
  const stats = computeStats(artists);

  // Degenerate rosters (nothing ranked, or no tag carried by enough ranked
  // artists) get one explanatory line rather than a stack of empty sections.
  if (stats.tagCount === 0) {
    const empty = document.createElement("p");
    empty.className = "stats-empty";
    empty.textContent =
      stats.rankedCount === 0
        ? "Nothing is ranked yet — statistics need artists placed in tiers."
        : "Not enough ranked artists share a tag yet for any conclusions.";
    body.appendChild(empty);
    return;
  }

  const intro = document.createElement("p");
  intro.textContent =
    `What the tier list says about the tags, drawn from ` +
    `${stats.rankedCount} ranked artists and ${stats.tagCount} tags. A tag ` +
    `counts only when at least three ranked artists carry it.`;
  body.appendChild(intro);

  // The two tag lists share one visual scale stretched over the entries they
  // actually show: on the absolute 1..7 scale every bar hovered around
  // half-full and the lists read as identical. The ends are exact — the
  // lowest entry shows an empty track, the highest a full one.
  const shown = [...stats.rankings.favourites, ...stats.rankings.leastFavourites];
  const lowest = Math.min(...shown.map((s) => s.mean));
  const highest = Math.max(...shown.map((s) => s.mean));
  const relative = (score: number): number =>
    highest === lowest ? 1 : (score - lowest) / (highest - lowest);

  const sections = [
    section(
      "Category favourites",
      "The best-rated tag in each part of the vocabulary.",
      stats.superlatives.map(superlativeRow),
    ),
    section(
      "Favourite tags",
      "The tags placed highest, by the average tier of the artists carrying them. Bars are scaled between the lowest and highest entries of these two lists.",
      stats.rankings.favourites.map((s) => tagRow(s, relative(s.mean))),
    ),
    section(
      "Least favourite tags",
      "The tags placed lowest, by the same average.",
      stats.rankings.leastFavourites.map((s) => tagRow(s, relative(s.mean))),
    ),
    section(
      "Best predictors",
      "Tags whose artists cluster most tightly, so carrying the tag all but pins an artist's tier. ± is the typical distance from the tag's average.",
      stats.bestPredictors.map(bestPredictorRow),
    ),
    section(
      "Worst predictors",
      "Tags that least predict a placement, splitting their artists into far-apart camps: ↑ and ↓ count those placed a full tier above and below the tag's average. The band spans the full range those artists occupy; the dot marks the average.",
      stats.worstPredictors.map(worstPredictorRow),
    ),
    section(
      "Guilty pleasures",
      "The artists placed furthest above where the averages of their tags suggest they would sit. The ring marks the tags' suggestion, the dot the artist's actual tier.",
      stats.outliers.guiltyPleasures.map(outlierRow),
      "None — no artist is placed above what its tags predict.",
    ),
    section(
      "Black sheep",
      "The artists placed furthest below where the averages of their tags suggest they would sit. The ring marks the tags' suggestion, the dot the artist's actual tier.",
      stats.outliers.blackSheep.map(outlierRow),
      "None — no artist is placed below what its tags predict.",
    ),
    // Every qualifying era, oldest first — a preference curve over the
    // decades rather than a ranking, hence its own section. Decades keep the
    // absolute tier scale (F = empty … S = full): a curve over time only
    // means something against a fixed yardstick.
    section(
      "Decades",
      "Each decade's average placement, oldest first.",
      stats.eras.map((s) => tagRow(s, positionFraction(s.mean))),
    ),
  ];
  body.append(...sections.filter((sectionEl) => sectionEl !== null));
}

/**
 * Wire up the 📊 dialog (the static shell in index.html). The body is filled
 * lazily on the first open; the dialog's own form provides Close, and Esc /
 * backdrop dismissal come from showModal() + closedby (with main.ts's
 * fallback), so there is nothing further to wire here.
 */
export function createStats(dialog: HTMLDialogElement): StatsView {
  const body = dialog.querySelector<HTMLElement>(".stats-body")!;
  let built = false;
  return {
    open(): void {
      if (!built) {
        buildBody(body);
        built = true;
      }
      dialog.showModal();
    },
  };
}
