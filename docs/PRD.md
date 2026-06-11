# Product Requirements — Artist Tier List

> This document describes the **user-observable** features and behaviours of the application.
> It deliberately omits incidental presentation choices (colours, fonts, spacing, exact copy).
> Technical/implementation concerns live in [ARCHITECTURE.md](./ARCHITECTURE.md).

## 1. Purpose / overview

A single-page, static web app for sorting a personal list of musical artists into ranked tiers
by drag-and-drop, in the spirit of tiermaker.com. The artist list is curated by the maintainer
and shipped with the app as static data. Visitors can rearrange the artists, have their changes
remembered locally, and (if they are the maintainer) export the new arrangement back into the
source data. A dice button picks a random artist from the ranked tiers under a configurable
weighting, for when you just want something to listen to.

The app is for a single maintainer's own use and casual sharing. It has no backend, no accounts,
and no server-side state.

## 2. Data model (user-facing)

Each **artist** has:

- a **name** (unique; this is how the artist is identified),
- a **tier** — one of the ranked tiers, or *unranked*,
- a **representative image** — shown on the artist's card; an artist may have none (and an image
  that fails to load is treated the same as none — see §11),
- a set of **tags** — descriptive labels (genres, musical qualities, eras, notable aspects) used
  by the random picker's tag filter (§8) and to lay out the artist map (§9); an artist may have
  none.

The set of artists is fixed at load time (curated in the source data). Users sort artists; they
do not add, rename, or delete artists, and do not edit images or tags, from within the app.

## 3. Tiers

There are seven fixed ranked tiers, displayed as rows from highest to lowest:

```
S   (highest)
A
B
C
D
E
F   (lowest)
```

Below (or alongside) the tiers there is an **always-visible "unranked" area** holding artists
that have not been placed into a ranked tier. The unranked area remains visible even when empty,
so an artist can always be dragged back out of a tier into it.

Each tier (and the unranked area) shows a **count of the cards it currently contains**, displayed
beneath the tier label and kept up to date as artists are moved between tiers.

The set of tiers is fixed: users cannot add, rename, reorder, or remove tiers.

## 4. Initial load

On load, the app obtains its artist data as follows:

1. If a saved arrangement exists in the browser's local storage, the app loads **that**.
2. Otherwise, it loads the **static arrangement** shipped with the app (the source CSV).

Either way, every artist is shown in the tier indicated by the loaded data; artists with no tier
appear in the unranked area.

A saved arrangement remembers **only each artist's tier placement**, not the artist list itself: the
roster and images always come from the data shipped with the app. So when the shipped data changes,
a returning visitor with a saved arrangement still sees the **newly added artists** (in the unranked
area) and any **updated images** — only their own tier placements are layered on top, and a placement
for an artist no longer shipped is simply ignored.

## 5. Sorting

- An artist is represented by a **card** showing its image (or a placeholder if it has none) and
  its name.
- The user **drags a card** from one tier (or the unranked area) and drops it into another tier
  or the unranked area. This works with both mouse and touch input. Dragging a card near the top or
  bottom edge of the viewport **auto-scrolls** the board, so a card can be moved between tiers that
  are far apart without scrolling first.
- Alternatively, **clicking a card** opens a small **tier-selection dropdown** (S, A, B, C, D, E,
  F, or **X** for unranked), which is focused immediately. **Save** and **Cancel** buttons sit below
  it; pressing **Enter** saves and **Escape** cancels. Saving moves the artist to the chosen tier.
  Clicking elsewhere, or starting to drag a card, dismisses the dropdown without changing the tier.
- **Hovering a card** reveals the artist's **tags** (§2) alongside its name, in the card's
  tooltip. An artist with no tags shows just its name.
- After a move that changes an artist's tier (by drag or via the dropdown), a brief notification
  offers to **undo** it, returning the artist to its previous tier. Undo is **single-level** — it
  reverses the most recent move only — and the notification dismisses itself after a few seconds. A
  within-tier rearrangement (no change of tier) is not an undoable move.
- **Only tier membership matters.** The position of a card within a tier carries no semantic
  meaning. Cards are displayed in **canonical name order** (alphabetical, case- and
  accent-insensitive) within every tier *and* the unranked area; this order is maintained
  automatically as cards are moved, so the layout is predictable rather than reflecting drop order.
  This applies **live while dragging**: the dragged card previews at its alphabetical position in
  the tier currently under the cursor, rather than following the pointer's horizontal position, so
  the preview shows where the card will actually land.

## 6. Persistence

- Every change to an artist's tier is **immediately saved to local storage**, so the arrangement
  survives a page reload or browser restart on the same device/browser.
- Local storage is the only place user changes are kept; nothing is sent to a server.

## 7. Reset / Save

The app distinguishes the **current arrangement** (what the user sees, backed by local storage)
from the **static arrangement** (the source data shipped with the app).

- When the current arrangement is **identical** to the static arrangement (same tier for every
  artist), neither button is shown.
- When they **differ**, two controls appear. **Both first open a confirmation modal that lists the
  diff from the static arrangement** — one line per changed artist showing a move between its two
  ranks (an arrow between the static tier and the local tier; `unranked` for the X pool). Nothing
  happens until the user confirms; dismissing the dialog (Cancel, Esc, or a click outside it)
  leaves everything untouched. The two buttons differ in the arrow's direction and in what
  confirming does:
  - **Reset** — discards local changes by clearing the saved arrangement from local storage, so
    the app reverts to the static arrangement. Its modal lists each changed artist as **local tier
    → static tier** (what reverting will restore). Because this is destructive, confirming is the
    only thing that clears the overrides.
  - **Save** — copies the updated data, as CSV, to the system **clipboard**, and (only when viewed
    on the deployed site) opens the GitHub edit page for the source data file (`data/artists.csv`)
    in a **new tab**. Its modal lists each changed artist as **static tier → local tier** (what
    will be written out). There is no server to save to; the maintainer pastes this CSV over the
    file and commits, redeploying to make the arrangement the new static default. The exported CSV
    changes only each artist's tier, and its rows are **sorted by artist name** (the list's
    canonical order). The copy and the GitHub tab happen only on confirm. Save then gives brief
    feedback confirming the copy succeeded, and tells the user if the clipboard could not be
    accessed (so a failed copy is never silent).

Individual cards whose current tier **differs from the static arrangement** carry a slight
highlight, so the specific artists contributing to the difference stand out at a glance. A card
returned to its shipped tier loses the highlight.

"Differ" is judged on **tier membership only** (consistent with §5): reordering cards within a
tier does not, by itself, make the arrangement count as changed.

## 8. Random artist picker

A prominent **🎲** button picks a single artist at random. By default it draws from the **ranked**
tiers; the `X only` tier cutoff (below) instead draws **only from the unranked pool**. When pressed, the chosen artist's **card and name are shown
large and centred**, then **animate back into that card's place** in the grid. While it is enlarged
and flying, **its grid slot shows a placeholder** so the board keeps its shape and the spot the card
returns to stays visible. The chosen artist's
**card then keeps a highlight** that **persists** (across page reloads) until the next
press of 🎲. While the pick is being revealed, the **rest of the board dims** to spotlight it (the
**toolbar stays fully visible**) — the page is *not* blocked: every control stays interactive
throughout. (Where the viewer prefers reduced
motion, the fly-in is skipped and the card is simply highlighted in place.) Because the reveal is
otherwise purely visual, the chosen artist's name is also **announced to assistive technology** (a
screen reader reads out the pick) on each press.

**Two dropdowns and a tag filter** next to the button control how the pick is made — the **tier
cutoff**, then the **filter**, then the **weighting intensity**:

- **Tier cutoff** — which artists are eligible:
  - `S only` → S only
  - `A+` → S, A
  - `B+` → S, A, B
  - `C+` → S, A, B, C
  - `D+` → S, A, B, C, D
  - `E+` → S, A, B, C, D, E
  - `F+` → S, A, B, C, D, E, F (all ranked tiers)
  - `X only` → the unranked pool only (no ranked tiers)
- **Weighting intensity** — how probability is spread across the eligible artists:
  - `unweighted` — every eligible artist is equally likely.
  - `weighted` — favours higher tiers (an artist in a higher tier is more likely than one in a
    lower tier).
  - `heavily weighted` — strongly favours higher tiers.

  The `X only` and `S only` cutoffs each draw from a single pool — the unranked artists, or the
  one top tier — with no tiers to weight against each other, so the intensity dropdown is
  **hidden** while either is selected (their artists are picked uniformly).

- **Tag filter** — restricts eligibility by the artists' tags (see §2). The control sits between
  the cutoff and intensity dropdowns and reads **`no filters`** when nothing is selected, else the
  selection size (e.g. **`5 filters`**). Clicking it opens a **panel listing every tag** present in
  the roster, each with a **checkbox**, **grouped by kind** (genres, musical qualities, eras,
  notable aspects), plus a control that **clears** the whole selection; the panel closes on a
  click elsewhere or Esc. An **all / any toggle** in the panel sets how multiple tags combine: an
  artist **matches** the selection by carrying **every** selected tag (`all`) or **at least one**
  of them (`any`, the default). While one or more tags are selected:
  - 🎲 draws only from **matching** artists (combined with the tier cutoff and weighting as
    usual), and
  - every **non-matching** artist is **dimmed** on the board — across all tiers, regardless of the
    cutoff — so the matching artists stand out. Dimmed cards remain fully interactive (drag,
    click-to-edit).

  An artist with no tags matches only the empty selection (under either mode).

The two dropdowns **default to "D+" and "weighted"**; they and the tag filter (its tags **and**
its all/any mode) **remember your last selection** across page reloads. The exact probability
curve for each intensity is an implementation detail.

Consecutive presses of 🎲 **never pick the same artist twice in a row**: the previously chosen
artist is excluded from the next draw. The sole exception is when that artist is the *only* eligible
one under the current scheme — then there is no alternative and the repeat is allowed.

A horizontal line is drawn on the board between the lowest eligible tier and the next row down,
reflecting the selected cutoff (e.g. `D+` draws it between the D and E rows). It updates when the
cutoff changes. Both `F+` and `X only` draw the line between the F row and the unranked area: for
`F+` every ranked tier sits above the line as eligible; for `X only` the unranked pool sits below it
as the sole eligible region. The line carries small labels naming the eligible and ineligible
regions, each pointing to its own side of the line; for `X only` those direction indicators invert,
since the eligible region sits below the line rather than above it.

Edge behaviour: if the chosen scheme has **no eligible artists** (e.g. `A+` selected but S and A
are both empty, `X only` with an empty unranked pool, or a tag filter that no artist in the
eligible range satisfies), the 🎲 button performs no action and indicates that nothing can be
picked (e.g. by being disabled).

## 9. Artist map (☁️)

A **☁️** button opens a **full-screen map** of the roster: every artist's card (image — or the
usual placeholder — and name) laid out on a two-dimensional plane, organised into **genre
clusters** drawn from the artists' tags (§2).

- **Every artist belongs to at most one cluster** — broadly, the most specific genre it shares
  with enough other artists. Membership is **never forced**: an artist whose own genres are too
  rare to form a group joins another cluster only when it genuinely shares that cluster's sound
  (its genres overlap the members'); artists that fit nowhere well stay **unclustered**, each
  standing just outside the circle of the cluster it most resembles, with a small **glow of its
  own**. A cluster represents a real relationship, not a best-effort bucket.
- Each cluster is marked by a **soft, faint glow** behind its artists — brightest at the heart,
  spilling a little past the cluster's boundary before fading out. **All of a cluster's members
  lie inside its circle, tightly and evenly packed**, and clusters never overlap one another.
  **Hovering the space inside a cluster** explains it in a tooltip: the genre that defines it
  and the artists it contains (useful zoomed out, when names are too small to read).
- The grouping is **two-tiered**: clusters of related sound form **families** (the punk scenes
  in one neighbourhood, electronic pop in another). Within a family the circles pack **snugly,
  edge to edge**; between families lie **wide gulfs** — so both which artists belong together
  and which clusters belong together are readable at a glance. Within a cluster, the most
  representative members sit at the **centre**, with looser fits towards the edge.
- The map shows **every artist**, regardless of tier placement, picker cutoff, or active tag
  filter; artists are **spaced apart — never stacked on top of one another** — so every artist
  stays individually visible.
- The layout is **stable**: the same roster produces the same map on every open and across
  reloads. Positions change only when the roster's tags change.
- **Scrolling zooms** the map in and out, anchored on the pointer's position, between a
  whole-cloud overview and a close-up; **dragging pans** it. The map opens fitted so the whole
  cloud is visible, and it can never be zoomed or panned so far that the cloud is lost off
  screen entirely.
- As on the board (§5), **hovering an artist** reveals its tags in a tooltip.
- The map is **read-only**: artists cannot be rearranged from it, and viewing it changes nothing
  about tiers, the picker, or filters.
- A **close control (✕) in the top-right corner** exits the map, as do the platform's standard
  dismissal actions (e.g. the Esc key). Closing returns to the board exactly as it was.

## 10. Tag statistics (📊)

A **📊** button opens a **read-only dialog of statistics** about the tier list, derived from the
artists' tags (§2) crossed with their tier placements. The statistics describe the **static
arrangement** (the data shipped with the app, §7): they are computed from that data alone — never
hand-curated — so they automatically follow every artist, tier, or tag change shipped in the
source data. Local rearrangements (§6) do **not** affect them until exported (§7) and shipped.

Ground rules, applying throughout:

- **Unranked artists are excluded** from every statistic.
- A tag features only when **at least three ranked artists** carry it, so one or two placements
  cannot masquerade as a trend; rarer tags are ignored entirely.
- A tag's **average** is the mean of its ranked carriers' tiers (tiers being evenly spaced for
  this purpose). Each tag entry shows its average as the nearest tier's letter with **+ or −**
  marking a lean towards the neighbouring tier (e.g. `A−`), alongside a **bar** sized by the
  average and the **number of artists** counted. The favourite/least-favourite lists stretch
  their bars between the lowest and highest entries they show, keeping small differences
  visible; hovering a bar reveals its fill percentage. (Category-favourite entries carry no
  bar; predictor and outlier entries replace it with the spread displays described below;
  outlier entries' grades are exact placements rather than averages.)

The dialog presents, in order:

- **Category favourites** — the best-rated tag in each tag category (genre, musical quality,
  notable aspect). A category with no qualifying tags is omitted.
- **Favourite and least favourite tags** — the tags with the highest and the lowest averages, as
  two ranked lists. The lists never overlap: when few tags qualify, the least-favourite list
  comes up short (or empty) rather than mirroring the favourites.
- **Best predictors** — the tags whose carriers cluster most tightly around the tag's
  average, so carrying the tag all but pins an artist's tier. Instead of a bar, each entry
  shows the full range its artists occupy with a marker for the average, annotated with the
  typical deviation; a stricter minimum carrier count applies to both predictor lists.
- **Worst predictors** — the mirror: the tags that least predict where their carriers sit,
  splitting them into **two camps**: artists at least a full tier above the tag's average,
  and artists at least a full tier below it. Ranked by how far apart the carriers sit and how
  evenly the two camps are matched — a lone dissenter does not divide a fanbase. Each entry
  shows the camp sizes alongside the same range display.
- **Guilty pleasures and black sheep** — the artists placed **furthest above** (guilty
  pleasures) and **furthest below** (black sheep) where their tags suggest they would sit;
  whether an artist sits above or below that suggestion decides which side it can appear on.
  An artist's suggested placement averages its qualifying tags' averages, each computed **as if
  that artist were not on the board**, so its own placement cannot vote for itself. Each entry
  shows the artist's actual tier and the predicted one, with a marker for each on a track and a
  line joining them — drawing the very gap the list is ranked by. Artists with no qualifying
  tags are not judged. When no artist sits above (or below) its
  prediction at all, the section says so — agreement between the tags and the tiers is itself a
  finding.
- **Decades** — every qualifying era/decade tag with its average, ordered **oldest to newest**: a
  preference curve over the decades rather than a ranking. Era tags appear **only here** — they
  are left out of every other statistic, so a strong decade preference cannot crowd out the
  rest of the vocabulary.

The exact list lengths, banding boundaries, and spread measure are implementation details. The
dialog is dismissed with its **✕ close button**, the Esc key, or a **click outside it**, and
viewing it changes nothing about tiers, the picker, or filters.

## 11. Empty / edge states

- **Artist with no image:** the card shows a placeholder in place of the image; the name is still
  shown. An artist whose image **fails to load** (e.g. a broken or removed URL) falls back to the
  same placeholder, so a dead link never shows a broken-image glyph.
- **Empty tier:** the tier row is still displayed (empty), as a valid drop target.
- **Empty unranked area:** still displayed, as described in §3.
- **No eligible artists for a pick:** handled as in §8.
- **Statistics with too little data:** when nothing is ranked — or no tag is carried by enough
  ranked artists — the statistics dialog (§10) explains that there is not enough data, instead of
  presenting empty sections.

## 12. Out of scope (explicitly)

The following are intentionally **not** part of the application:

- No backend, server, database, or user accounts.
- No adding, renaming, or deleting artists from within the app.
- No editing of artist images from within the app.
- No fetching of images at runtime — images are pre-curated URLs in the static data.
- No adding, renaming, reordering, or deleting tiers.
- No automatic writing back to the source data file — export is manual, via the clipboard (§7).
