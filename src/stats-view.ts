// The 📊 statistics dialog: renders the statistics computed by stats.ts into
// the static shell in index.html (a .stats-body inside a .modal form). The
// content is a pure function of the build-embedded roster — local edits never
// change it — so it is built once, on the first open, and kept for the session,
// like the ☁️ map's plane.
//
// Every word here has to hold to the premise stats.ts is built on: this is a
// list of artists the user likes, so a low placement is never a complaint. No
// section may call a tag unloved, an artist a mistake, or a placement wrong.

import { artists } from "./data";
import {
  computeStats,
  positionFraction,
  tierBand,
  type ArtistIsolation,
  type CategoryComposition,
  type PositionRange,
  type PredictivePower,
  type RosterSummary,
  type TagStat,
  type TasteWorlds,
} from "./stats";
import type { Tier } from "./types";

export interface StatsView {
  /** Show the dialog, building its content on first use. */
  open(): void;
}

// --- Number formatting ---

/** A share of the roster's weight as a whole percentage, e.g. "55%". */
const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** An affection ratio, e.g. "×1.24". 1.00 is a typical artist in the list. */
const times = (ratio: number): string => `×${ratio.toFixed(2)}`;

/** Carrier counts are always ≥ MIN_SUPPORT (3), so the plural is safe. */
const carrierCount = (count: number): string => `${count} artists`;

// --- Row cells ---

/**
 * One statistic row: lead cell | name (with its muted annotation in
 * parentheses) | optional gauge. The lead is either a tier chip (only on rows
 * that describe a real artist, where a letter grade means something) or a bare
 * number. With no gauge the name spans that column instead (the .no-bar CSS).
 * The row's cells become items of the section's shared grid (the row itself is
 * display:contents), which is what keeps the columns aligned down a whole list.
 */
function statRow(
  lead: HTMLElement,
  name: string,
  detail: string,
  gauge: HTMLElement | null,
): HTMLElement {
  const row = document.createElement("div");
  row.className = gauge === null ? "stat-row no-bar" : "stat-row";
  row.append(lead, nameCell(name, detail));
  if (gauge !== null) row.appendChild(gauge);
  return row;
}

/**
 * The tier-pastel chip for an artist's placement. Reserved for rows about an
 * actual artist: a tag's average placement used to be banded onto a letter too,
 * but over a roster whose tag averages all sit within a tier and a half of each
 * other that chip said the same thing on every row — and rendered grades for
 * tiers the board no longer uses.
 */
function tierChip(tier: Tier): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "stat-tier";
  chip.dataset.tier = tier; // picks the chip's tier pastel
  chip.textContent = tier;
  return chip;
}

/** The lead cell for a tag row: the statistic itself, in the chip's column. */
function valueCell(text: string): HTMLElement {
  const value = document.createElement("span");
  value.className = "stat-value";
  value.textContent = text;
  return value;
}

/** The name cell: the label with its muted annotation in parentheses. */
function nameCell(name: string, detail: string): HTMLElement {
  const nameEl = document.createElement("span");
  nameEl.className = "stat-name";
  nameEl.textContent = name;
  if (detail !== "") {
    const detailEl = document.createElement("span");
    detailEl.className = "stat-detail";
    detailEl.textContent = ` (${detail})`;
    nameEl.appendChild(detailEl);
    nameEl.title = `${name} (${detail})`; // a truncated row stays readable on hover
  } else {
    nameEl.title = name;
  }
  return nameEl;
}

// --- Gauges ---

/**
 * A plain accent bar carrying `value`, drawn against `of` — **the largest value
 * in its own group**, not a theoretical maximum.
 *
 * Every bar list in this dialog compares its rows only with each other, and
 * against a theoretical 100% most of them are stubs: the biggest world is 41% of
 * the roster, the biggest genre 15%, so nine tenths of every track would be
 * empty and the differences that matter would be squeezed into the first
 * fraction of it. Filling the track makes the comparison the eye is actually
 * being asked to make.
 *
 * `value` is always the true quantity, never a pre-divided fraction — the label
 * and tooltip come from it, so a caller cannot accidentally print the scaled
 * number. Any `tick` is scaled identically, so a reference mark stays in the
 * right place relative to the bars.
 */
function shareBar(
  value: number,
  options: { of?: number; tick?: { at: number; title: string }; title?: string } = {},
): HTMLElement {
  const largest = options.of ?? 1;
  const scaled = (quantity: number): number =>
    largest <= 0 ? 0 : Math.min(Math.max(quantity / largest, 0), 1);

  const bar = document.createElement("span");
  bar.className = "stat-bar";
  bar.title = options.title ?? percent(value);
  const fill = document.createElement("span");
  fill.className = "stat-fill";
  fill.style.setProperty("--fraction", String(scaled(value)));
  bar.appendChild(fill);
  if (options.tick !== undefined) {
    const tickEl = document.createElement("span");
    tickEl.className = "stat-bar-tick";
    tickEl.style.setProperty("--at", String(scaled(options.tick.at)));
    tickEl.title = options.tick.title;
    bar.appendChild(tickEl);
  }
  return bar;
}

/**
 * A bar diverging from a centre line at ratio 1.00 — a typical artist in the
 * list. Right of centre means the tag's carriers count for more than usual;
 * left means they are typical of the collection rather than that anything is
 * wrong with them. `halfWidth` is how far from 1.00 the track's ends sit.
 */
function ratioBar(ratio: number, halfWidth: number): HTMLElement {
  const gauge = document.createElement("span");
  gauge.className = "stat-diverge";
  gauge.title = times(ratio);
  const at = Math.min(Math.max(0.5 + (ratio - 1) / (2 * halfWidth), 0), 1);
  const fill = document.createElement("span");
  fill.className = "stat-diverge-fill";
  fill.style.setProperty("--lo", String(Math.min(0.5, at)));
  fill.style.setProperty("--hi", String(Math.max(0.5, at)));
  gauge.appendChild(fill);
  return gauge;
}

/**
 * The predictor rows' gauge, on the same track a bar would occupy: a band from
 * `low` to `high` with a dot at `centre`. Positions run across the tiers the
 * roster actually occupies (positionFraction), so the lowest occupied tier sits
 * at the track's left end.
 */
function rangeGauge(low: number, high: number, centre: number, range: PositionRange): HTMLElement {
  const gauge = document.createElement("span");
  gauge.className = "stat-range";
  const band = document.createElement("span");
  band.className = "stat-range-band";
  band.style.setProperty("--lo", String(positionFraction(low, range)));
  band.style.setProperty("--hi", String(positionFraction(high, range)));
  const dot = document.createElement("span");
  dot.className = "stat-range-dot";
  dot.style.setProperty("--at", String(positionFraction(centre, range)));
  gauge.append(band, dot);
  return gauge;
}

// --- One row constructor per kind of statistic ---

/** A tag by its affection ratio, against the diverging 1.00 centre line. */
const ratioRow = (stat: TagStat, halfWidth: number): HTMLElement =>
  statRow(
    valueCell(times(stat.ratio)),
    stat.tag,
    carrierCount(stat.count),
    ratioBar(stat.ratio, halfWidth),
  );

/** A tag by how concentrated it is in the favourite tiers. The bar is the
    plain rate, with a tick at the rate the roster as a whole shows — so the
    over-representation the list is ranked by is visible, not just stated. */
const favouriteRow = (stat: TagStat, baseRate: number, largest: number): HTMLElement =>
  statRow(
    valueCell(times(stat.favouriteIndex)),
    stat.tag,
    `${stat.favourites} of its ${stat.count} artists`,
    shareBar(stat.favouriteRate, {
      of: largest,
      tick: { at: baseRate, title: `the whole list sits at ${percent(baseRate)}` },
    }),
  );

/**
 * The span of tiers a tag's carriers occupy. These name real tiers, so they
 * wear the same pastels the board and the histogram use — one chip per end, or
 * a single chip when a tag's carriers share a tier. `low`/`high` are always
 * exact placements, so each end is a bare letter.
 */
function tierRangeCell(low: number, high: number): HTMLElement {
  const cell = document.createElement("span");
  cell.className = "stat-tier-range";
  const top = tierBand(high).tier;
  const bottom = tierBand(low).tier;
  if (top === bottom) {
    cell.appendChild(tierChip(top));
    return cell;
  }
  const dash = document.createElement("span");
  dash.className = "stat-tier-range-dash";
  dash.textContent = "–";
  cell.append(tierChip(top), dash, tierChip(bottom));
  return cell;
}

/**
 * A predictor row, on its own four-column grid: the spread, the tier span, the
 * name, the gauge.
 *
 * The spread leads, because both predictor lists are ordered by it and every
 * other list in the dialog leads with its sort key. It is shown to two decimals
 * on purpose — at one, half the rows read as ties with their neighbour and the
 * ordering looked arbitrary. The tier span keeps a column of its own rather
 * than folding into the annotation, so its chips stay aligned down the list.
 */
const predictorRow = (stat: TagStat, detail: string, range: PositionRange): HTMLElement => {
  const row = document.createElement("div");
  row.className = "stat-row";
  row.append(
    valueCell(`±${stat.spread.toFixed(2)}`),
    tierRangeCell(stat.low, stat.high),
    nameCell(stat.tag, detail),
    rangeGauge(stat.low, stat.high, stat.mean, range),
  );
  return row;
};

const reliableRow = (stat: TagStat, range: PositionRange): HTMLElement =>
  predictorRow(stat, carrierCount(stat.count), range);

/** "above"/"below" are positions relative to the tag's own average — the
    explainer says so, because on a list of music the reader likes they must not
    be read as a verdict. */
const variableRow = (stat: TagStat, range: PositionRange): HTMLElement =>
  predictorRow(stat, `${stat.count} artists: ${stat.above} above, ${stat.below} below`, range);

/** How a tag-groups.ts category label reads as a sub-heading. Unknown labels
    (a future category) fall back to themselves rather than vanishing. Eras
    never appear here — they have a section of their own (stats.ts). */
const CATEGORY_PLURAL: Record<string, string> = {
  Genres: "Genres",
  "Musical qualities": "Musical qualities",
  "Notable aspects": "Notable aspects",
};

/**
 * The composition rows for one vocabulary category: a full-width sub-heading
 * naming the category, then its most common tags.
 *
 * The sub-heading spans the grid rather than taking a column of its own, so all
 * three categories' rows keep the same column widths and read as one aligned
 * table.
 *
 * **Each category is its own group of bars** and scales to its own largest tag.
 * The categories are separate lists under separate headings — a reader compares
 * genres with genres, not a genre with a vocal style — and one shared scale left
 * every genre a stub beside the far more widespread quality tags, which is the
 * squeeze the group-scaling convention exists to avoid. The printed percentage
 * is the true share of the roster throughout, so the categories remain
 * comparable by their numbers even though their bars are not.
 */
function compositionRows(composition: CategoryComposition): HTMLElement[] {
  const heading = document.createElement("div");
  heading.className = "stat-subheading";
  heading.textContent = CATEGORY_PLURAL[composition.category] ?? composition.category;
  const largest = Math.max(0, ...composition.stats.map((stat) => stat.prevalence));
  return [
    heading,
    ...composition.stats.map((stat) =>
      statRow(
        valueCell(percent(stat.prevalence)),
        stat.tag,
        carrierCount(stat.count),
        shareBar(stat.prevalence, { of: largest }),
      ),
    ),
  ];
}

/**
 * An artist from either end of the typicality ranking, on the same four-column
 * grid the predictors use: the kin count leads because it is what both lists are
 * ordered by, then the artist's tier, its name, and a bar of the count against
 * the most-connected artist shown.
 *
 * The raw similarity is deliberately absent — it is too compressed to draw or
 * print honestly (see ArtistIsolation.kinship). The count says the same thing in
 * a unit a reader can check. Only the lonely end keeps the rarest-tag note,
 * where the question "what makes this one different?" is the one being asked;
 * on the crowded end it answered a question nobody had.
 *
 * The lead cell is a bare number, so **both sections' explainers must say what
 * it counts**. On the lonely end it is 0 for every row, and an unexplained
 * column of zeros reads as "shares no tags with anyone" — which is not what it
 * means, and is not true of any of them.
 */
const isolationRow = (artist: ArtistIsolation, mostKin: number, note: boolean): HTMLElement => {
  const row = document.createElement("div");
  row.className = "stat-row";
  row.append(
    valueCell(String(artist.kin)),
    tierChip(artist.tier),
    nameCell(artist.name, note && artist.rarestTag !== null ? `rarest: ${artist.rarestTag}` : ""),
    shareBar(artist.kin, {
      of: mostKin,
      title: `${artist.kin} of your artists share at least half its tags`,
    }),
  );
  return row;
};

/** Breathing room above and below the ratio curve's own range, in ratio units,
    so the extreme decades are not pinned to the panel's edges. */
const ERA_RATIO_PADDING = 0.03;

/**
 * The decades chart: two panels stacked over one shared, left-to-right decade
 * axis — a column per decade for how many artists it holds, and beneath it a
 * line for how much those artists are worth against a typical one.
 *
 * This section is the only one whose rows have an inherent order that is not a
 * ranking, so it is the only one drawn as a chart rather than a list. Time
 * reading left to right is what makes the shape legible: the collection is
 * overwhelmingly 2000s-onward, and those same decades are the ones sitting above
 * ×1.00, so the step across the baseline between the 1990s and the 2000s reads
 * as the finding it is. Every earlier attempt — one bar coloured by the ratio,
 * then two bars stacked in a row — asked the reader to hold two scales in their
 * head per row and rebuild the curve themselves.
 *
 * Built from HTML boxes rather than as one SVG so that the labels keep real CSS
 * type sizes and the whole thing reflows with the dialog; only the connecting
 * line is SVG, stretched with preserveAspectRatio="none" and held to an even
 * width by vector-effect, since a polyline is the one part CSS cannot draw.
 */
function eraChart(eras: readonly TagStat[]): HTMLElement {
  const chart = document.createElement("div");
  chart.className = "era-chart";
  if (eras.length === 0) return chart;

  const fullest = Math.max(...eras.map((stat) => stat.count));
  // The ratio domain always contains 1.00, so the baseline is never off-panel.
  const low = Math.min(1, ...eras.map((stat) => stat.ratio)) - ERA_RATIO_PADDING;
  const high = Math.max(1, ...eras.map((stat) => stat.ratio)) + ERA_RATIO_PADDING;
  /** Distance down the ratio panel, 0 at its top edge and 1 at its bottom. */
  const depth = (ratio: number): number => 1 - (ratio - low) / (high - low);
  /** Centre of a decade's column, as a fraction of the axis. */
  const centre = (index: number): number => (index + 0.5) / eras.length;
  const describe = (stat: TagStat): string =>
    `${stat.tag}: ${carrierCount(stat.count)}, ${percent(stat.prevalence)} of the list, ${times(stat.ratio)}`;

  // --- Volume: a column per decade, against the fullest one ---
  const volume = document.createElement("div");
  volume.className = "era-volume";
  for (const stat of eras) {
    const column = document.createElement("div");
    column.className = "era-column";
    column.title = describe(stat);
    const count = document.createElement("span");
    count.className = "era-count";
    count.textContent = String(stat.count);
    const bar = document.createElement("span");
    bar.className = "era-bar";
    bar.style.setProperty("--height", `${(stat.count / fullest) * 100}%`);
    column.append(count, bar);
    volume.appendChild(column);
  }

  // --- Ratio: a baseline at ×1.00, the curve, and a dot per decade ---
  const ratioPanel = document.createElement("div");
  ratioPanel.className = "era-ratio";
  const baseline = document.createElement("span");
  baseline.className = "era-baseline";
  baseline.style.setProperty("--at", String(depth(1)));
  const baselineLabel = document.createElement("span");
  baselineLabel.className = "era-baseline-label";
  baselineLabel.style.setProperty("--at", String(depth(1)));
  baselineLabel.textContent = "×1.00";
  ratioPanel.append(baseline, baselineLabel);

  const line = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  line.setAttribute("class", "era-line");
  line.setAttribute("viewBox", "0 0 100 100");
  line.setAttribute("preserveAspectRatio", "none");
  line.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  path.setAttribute(
    "points",
    eras.map((stat, i) => `${centre(i) * 100},${depth(stat.ratio) * 100}`).join(" "),
  );
  line.appendChild(path);
  ratioPanel.appendChild(line);

  eras.forEach((stat, i) => {
    const dot = document.createElement("span");
    dot.className = "era-dot";
    dot.style.setProperty("--x", String(centre(i)));
    dot.style.setProperty("--y", String(depth(stat.ratio)));
    dot.title = describe(stat);
    ratioPanel.appendChild(dot);
  });

  // --- The shared axis ---
  const axis = document.createElement("div");
  axis.className = "era-axis";
  for (const stat of eras) {
    const label = document.createElement("span");
    label.textContent = stat.tag;
    axis.appendChild(label);
  }

  chart.append(volume, ratioPanel, axis);
  return chart;
}

// --- Section and group scaffolding ---

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
  { emptyText, rowsClass }: { emptyText?: string; rowsClass?: string } = {},
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
    rowsEl.className = rowsClass === undefined ? "stat-rows" : `stat-rows ${rowsClass}`;
    rowsEl.append(...rows);
    sectionEl.appendChild(rowsEl);
  }
  return sectionEl;
}

/**
 * What "What you like" says when the significance gate empties it.
 *
 * A section that simply vanishes reads as a bug, or worse as nothing to report.
 * The truth is more specific and more interesting: every tag was weighed against
 * chance and none of them cleared it, which is a finding about the roster rather
 * than a gap in the dialog. Rendered only when there is genuinely nothing to
 * show, so a roster with real preferences never sees it.
 */
function nothingStandsOut(evidence: { tested: number; elevated: number }): HTMLElement {
  const sectionEl = document.createElement("section");
  sectionEl.className = "stats-section";
  const heading = document.createElement("h3");
  heading.textContent = "Nothing stands out yet";
  const body = document.createElement("p");
  body.className = "stats-explainer";
  body.textContent =
    `Each of your ${evidence.tested} tags was tested against chance — shuffle the tiers at ` +
    `random, and see how often a group of that size lands as high as this one really does. ` +
    `None of them clears the bar once the test accounts for having looked at all ${evidence.tested}, ` +
    `and the handful that would pass on their own are about what that many coin flips produces ` +
    `anyway. So this reads as an empty section rather than a list of your luckiest tags. It will ` +
    `fill in if the collection grows or the tiers sharpen.`;
  sectionEl.append(heading, body);
  return sectionEl;
}

/**
 * The closing note on what a tag tells you: how much of a placement the whole
 * vocabulary actually accounts for.
 *
 * This section is the residue of two that were removed. Both ranked artists by
 * their distance from a tag-based prediction, and both turned out to be
 * reprinting the top and bottom tiers — because the prediction barely varies, so
 * the distance from it is little more than the tier itself. Rather than dress
 * that up with a cleverer ranking, the dialog now reports the measurement, which
 * is the more interesting fact and the honest one.
 */
function predictiveLimit(power: PredictivePower | null): HTMLElement | null {
  if (power === null) return null;
  const sectionEl = document.createElement("section");
  sectionEl.className = "stats-section";
  const heading = document.createElement("h3");
  heading.textContent = "How far the tags go";
  const body = document.createElement("p");
  body.className = "stats-explainer";
  // Below a tenth of a percent "0%" would read as a rounding artefact rather
  // than as the finding, so the floor is stated as a bound.
  const share = power.explained < 0.001 ? "well under 1%" : `about ${percent(power.explained)}`;
  body.textContent =
    `Guessing where an artist sits from its tags alone accounts for ${share} of the answer, ` +
    `across the ${power.judged} artists carrying enough of a shared vocabulary to guess from. ` +
    `Whatever decides a placement, the tags barely touch it — so read everything above as a ` +
    `description of what you have collected, not an explanation of how you ranked it.`;
  sectionEl.append(heading, body);
  return sectionEl;
}

/** A thematic banner over a run of sections. Thirteen sections in one scroll
    need signposting; the groups say what question the next few answer. */
function group(title: string, sections: (HTMLElement | null)[]): HTMLElement | null {
  const present = sections.filter((sectionEl) => sectionEl !== null);
  if (present.length === 0) return null;
  const wrapper = document.createElement("section");
  wrapper.className = "stats-group";
  const heading = document.createElement("h3");
  heading.className = "stats-group-heading";
  heading.textContent = title;
  wrapper.append(heading, ...present);
  return wrapper;
}

/** The opening block: the roster's headline counts and the shape of the board.
    A tier histogram is the one place the tier pastels belong unambiguously —
    these are the tiers themselves, not a grade inferred for something else. */
function summaryBlock(summary: RosterSummary): HTMLElement {
  const sectionEl = document.createElement("section");
  sectionEl.className = "stats-section";
  const heading = document.createElement("h3");
  heading.textContent = "Your list in numbers";
  const intro = document.createElement("p");
  intro.className = "stats-explainer";
  const unranked = summary.artistCount - summary.rankedCount;
  intro.textContent =
    `${summary.rankedCount} ranked artists described by ${summary.vocabularySize} tags, ` +
    `${summary.supportedTagCount} of which enough artists share to draw conclusions from` +
    (unranked > 0 ? `. ${unranked} more are still unranked and sit out every statistic.` : ".");
  sectionEl.append(heading, intro);

  // The histogram scales to the biggest tier rather than to the whole roster:
  // this is the one section comparing rows only with each other, and stretching
  // it to the fullest tier is what makes the board's shape legible — against
  // the roster the tallest bar would be barely a quarter full.
  const rowsEl = document.createElement("div");
  rowsEl.className = "stat-rows";
  const fullest = Math.max(...summary.tierCounts.map(({ count }) => count), 1);
  for (const { tier, count } of summary.tierCounts) {
    const shareOfList = summary.rankedCount === 0 ? 0 : count / summary.rankedCount;
    rowsEl.appendChild(
      statRow(
        tierChip(tier),
        `${count}`,
        count === 0 ? "empty" : percent(shareOfList),
        shareBar(count, { of: fullest, title: percent(shareOfList) }),
      ),
    );
  }
  sectionEl.appendChild(rowsEl);

  // The most-collected tag and dominant decade used to be named here too. They
  // now head "What your list is made of" and the decades chart respectively, so
  // saying them twice only made the reader check whether the two agreed. What
  // stays is the favourite-tier boundary, which nothing else states and which
  // several statistics are measured against.
  if (summary.favouriteTiers.length > 0) {
    const closing = document.createElement("p");
    closing.className = "stats-explainer";
    closing.textContent =
      `Your favourites — ${listOf(summary.favouriteTiers)} — are ${summary.favouriteCount} artists, ` +
      `${percent(summary.favouriteCount / Math.max(summary.rankedCount, 1))} of the list.`;
    sectionEl.appendChild(closing);
  }
  return sectionEl;
}

/**
 * One world: the scenes it gathers, sized by how much of the roster it holds.
 *
 * Named by listing its own scenes rather than by a label invented for it —
 * "synth pop and friends" would be a guess dressed as a finding, and the scene
 * names already say what the world is. The first few lead; the rest are on
 * hover, since a world can gather seventeen of them.
 */
const worldRow = (world: TasteWorlds["worlds"][number], largest: number): HTMLElement => {
  const shown = world.scenes.slice(0, 3).join(" · ");
  const rest = world.scenes.length - 3;
  const row = statRow(
    valueCell(percent(world.prevalence)),
    // "+14" already says how many scenes there are, so the annotation carries
    // only the artist count — spelling both out pushed the names into ellipsis.
    rest > 0 ? `${shown} +${rest}` : shown,
    carrierCount(world.count),
    shareBar(world.prevalence, { of: largest }),
  );
  const scenes = world.scenes.length === 1 ? "1 scene" : `${world.scenes.length} scenes`;
  row.title = `${scenes}: ${world.scenes.join(", ")} — ${carrierCount(world.count)}`;
  return row;
};

function worldsExplainer(worlds: TasteWorlds): string {
  const base =
    "Above the level of any single tag: your artists gather into genre scenes, and those scenes " +
    "into a handful of broader worlds. These are the same neighbourhoods the ☁️ map draws, so the " +
    "two features agree about the shape of your collection.";
  if (worlds.loners === 0) return base;
  // One loner is common on a well-clustered roster, so this sentence has to
  // read correctly in the singular.
  const who =
    worlds.loners === 1
      ? "One artist belongs to no scene at all and is"
      : `${worlds.loners} artists belong to no scene at all and are`;
  return `${base} ${who} left out of the count — a corner of the list rather than a gap in it.`;
}

/** "S, A and B" — an Oxford-comma-free English list, for the tier names. */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
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

  // No preface. One stood here restating that the roster is all music the user
  // likes and that the inferential sections are gated — but both are the
  // maintainer's own premises handed back to them, and each section that acts on
  // them says so in its own words where that is actually useful.

  // The diverging ratio bars share one half-width, so a longer bar means a
  // bigger lift across every list that uses them. It stretches to the most
  // extreme entry actually shown (with a floor, so a flat roster doesn't
  // magnify noise into a full track).
  const halfWidth = Math.max(0.25, ...stats.lifts.map((stat) => Math.abs(stat.ratio - 1)));
  // Each group of bars is drawn against its own largest member (see shareBar).
  // The composition list's groups are its individual categories, so it computes
  // its scales per category inside compositionRows rather than taking one here.
  const largestWorld = Math.max(0, ...stats.worlds.worlds.map((world) => world.prevalence));
  const largestFavouriteRate = Math.max(
    0,
    ...stats.favouriteTraits.map((stat) => stat.favouriteRate),
  );
  // Both isolation lists share one bar scale — they are two ends of one ranking,
  // so the lonely end must read as short against the crowded end, not be
  // stretched to fill its own track.
  const mostKin = Math.max(0, ...stats.isolation.core.map((artist) => artist.kin));
  const baseRate =
    stats.summary.rankedCount === 0 ? 0 : stats.summary.favouriteCount / stats.summary.rankedCount;
  const positions = stats.positions;

  body.append(
    summaryBlock(stats.summary),
    ...[
      group("What you like", [
        section(
          "What lifts an artist",
          "How much more than a typical artist in your list a tag's carriers are worth. ×1.00 is the middle of your taste, not a pass mark — everything here is music you like.",
          stats.lifts.map((stat) => ratioRow(stat, halfWidth)),
        ),
        section(
          "The surest signs of a favourite",
          `Only ${percent(baseRate)} of your ranked artists reach ${listOf(stats.summary.favouriteTiers)}, but carrying one of these tags makes it likelier. Each bar is that tag's own rate, against a tick at the ${percent(baseRate)} baseline. The multiplier compares the two — held back towards ×1.00 when few artists stand behind the figure, so it reads lower than dividing the bar by the tick would suggest.`,
          stats.favouriteTraits.map((stat) => favouriteRow(stat, baseRate, largestFavouriteRate)),
        ),
        // Every list in this group is gated on beating chance, so all three can
        // empty at once — in which case say why rather than showing a bare
        // heading or nothing at all.
        stats.evidence.elevated === 0 && stats.evidence.tested > 0
          ? nothingStandsOut(stats.evidence)
          : null,
      ]),
      group("What a tag tells you", [
        section(
          "Reliable signals",
          "Tags whose artists cluster most tightly, so carrying one all but pins an artist's tier. ± is how far a typical carrier sits from the tag's average, tightest first; the band spans the tiers those artists occupy, with a dot at the average.",
          stats.reliable.map((stat) => reliableRow(stat, positions)),
          { rowsClass: "with-tier-range" },
        ),
        section(
          "Depends on the artist",
          "The exact reverse, widest ± first: tags that reach right across your list. You plainly enjoy the trait — it turns up at every level of your ranking — but which artist is doing it matters more than the trait itself. The counts are of artists a full tier above and below that tag's own average, not above or below any mark of quality, and both ends must hold more than one.",
          stats.variable.map((stat) => variableRow(stat, positions)),
          { rowsClass: "with-tier-range" },
        ),
        predictiveLimit(stats.prediction),
      ]),
      group("The shape of the collection", [
        section(
          "What your list is made of",
          "The most common tags in each part of the vocabulary — a plain count of what you have gathered, with no claim about your ranking attached. A tag's frequency reflects both your taste and how common the trait is in music at large, and nothing here can tell the two apart.",
          stats.composition.flatMap((c) => compositionRows(c)),
        ),
        section(
          "The worlds it splits into",
          worldsExplainer(stats.worlds),
          stats.worlds.worlds.map((world) => worldRow(world, largestWorld)),
        ),
        section(
          "Your core sound",
          "The artists with the most company here — the centre of gravity everything else is arranged around. The count is how many of your other artists carry at least half of this one's tags.",
          stats.isolation.core.map((artist) => isolationRow(artist, mostKin, false)),
          { rowsClass: "with-kin" },
        ),
        section(
          "One of a kind",
          "The same count at its other end: artists almost nothing else you have collected shares a tag list with. A count of 0 means no single other artist carries half of this one's tags — not that it shares no tags at all, which is rare here; most of these still have several tags in common with their nearest neighbour. Being an outlier is not a demerit; these are the corners your taste reaches into.",
          stats.isolation.distinctive.map((artist) => isolationRow(artist, mostKin, true)),
          { rowsClass: "with-kin" },
        ),
        // Every qualifying era, oldest to newest — the one section whose order
        // is chronological rather than a ranking, so the one drawn as a chart.
        section(
          "Decades",
          "How many artists you have from each decade, and beneath it how much those artists are worth against a typical one. Both read left to right over the same years.",
          [eraChart(stats.eras)],
          { rowsClass: "as-block" },
        ),
      ]),
    ].filter((groupEl) => groupEl !== null),
  );
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
