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
- a **representative image** — shown on the artist's card; an artist may have none.

The set of artists is fixed at load time (curated in the source data). Users sort artists; they
do not add, rename, or delete artists, and do not edit images, from within the app.

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

## 5. Sorting

- An artist is represented by a **card** showing its image (or a placeholder if it has none) and
  its name.
- The user **drags a card** from one tier (or the unranked area) and drops it into another tier
  or the unranked area. This works with both mouse and touch input.
- Alternatively, **clicking a card** opens a small **tier-selection dropdown** (S, A, B, C, D, E,
  or **X** for unranked), which is focused immediately. **Save** and **Cancel** buttons sit below
  it; pressing **Enter** saves and **Escape** cancels. Saving moves the artist to the chosen tier.
- **Only tier membership matters.** The left-to-right position of a card within a tier carries no
  meaning and is not remembered between sessions (it may be re-laid-out freely).

## 6. Persistence

- Every change to an artist's tier is **immediately saved to local storage**, so the arrangement
  survives a page reload or browser restart on the same device/browser.
- Local storage is the only place user changes are kept; nothing is sent to a server.

## 7. Reset / Save

The app distinguishes the **current arrangement** (what the user sees, backed by local storage)
from the **static arrangement** (the source data shipped with the app).

- When the current arrangement is **identical** to the static arrangement (same tier for every
  artist), neither button is shown.
- When they **differ**, two controls appear:
  - **Reset** — discards local changes by clearing the saved arrangement from local storage, so
    the app reverts to the static arrangement. Because this is destructive, it first asks for
    confirmation in a modal dialog (Cancel / Reset); dismissing the dialog leaves the arrangement
    untouched.
  - **Save** — copies the updated data, as CSV, to the system **clipboard**, and (only when viewed
    on the deployed site) opens the GitHub edit page for the source data file (`data/artists.csv`)
    in a **new tab**. There is no server to save to; the maintainer pastes this CSV over the file
    and commits, redeploying to make the arrangement the new static default. The exported CSV
    changes only each artist's tier, and its rows are **sorted by artist name** (the list's
    canonical order).

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
motion, the fly-in is skipped and the card is simply highlighted in place.)

**Two dropdowns** next to the button control how the pick is made — one for the **tier cutoff** and
one for the **weighting intensity**:

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

  The `X only` cutoff has no tiers to weight, so the intensity dropdown is **hidden** while it is
  selected (its artists are picked uniformly).

The two dropdowns **default to "D+" and "weighted"** and **remember your last selection** across
page reloads. The exact probability curve for each intensity is an implementation detail.

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
are both empty, or `X only` with an empty unranked pool), the 🎲 button performs no action and
indicates that nothing can be picked (e.g. by being disabled).

## 9. Empty / edge states

- **Artist with no image:** the card shows a placeholder in place of the image; the name is still
  shown.
- **Empty tier:** the tier row is still displayed (empty), as a valid drop target.
- **Empty unranked area:** still displayed, as described in §3.
- **No eligible artists for a pick:** handled as in §8.

## 10. Out of scope (explicitly)

The following are intentionally **not** part of the application:

- No backend, server, database, or user accounts.
- No adding, renaming, or deleting artists from within the app.
- No editing of artist images from within the app.
- No fetching of images at runtime — images are pre-curated URLs in the static data.
- No adding, renaming, reordering, or deleting tiers.
- No automatic writing back to the source data file — export is manual, via the clipboard (§7).
