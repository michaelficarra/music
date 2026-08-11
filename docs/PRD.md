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
- a set of **tags** — descriptive labels (genres, musical qualities, regions, eras, notable
  aspects) used by the random picker's tag filter (§8) and to lay out the artist map (§9); an
  artist may have none. How many an artist carries varies: a tag is present when it is accurate,
  and there is no target number.

**Tags form a hierarchy: a specific tag always carries with it the more general tags containing
it, and those are called its *derived tags*.** An artist described as *pop punk* also derives punk
rock, pop rock and rock; one from *Stockholm* derives Swedish, Scandinavian, Nordic and European.
**The tag filter treats an artist as carrying all of them**, so someone looking for European
artists finds one tagged only *Swedish*, and *punk rock* finds the ska-punk bands.

Everywhere that *describes* an artist rather than finding one — the card tooltip, the ☁️ map and the
📊 statistics — derived tags still count, but **tags too broad to distinguish anyone are left out**.
A tag is too broad when it covers more than a fifth of the roster: on a list this heavily weighted
towards guitar music, being tagged *rock* separates an artist from almost nobody. Era tags are the
exception, since the statistics have a section about exactly which decades the collection favours.
The hierarchy is part of the curated source data, not something users edit.

**Anything that groups artists by how alike they are reads only the tags about the music itself —
genres and musical qualities — and ignores regions, eras and notable aspects.** That is the ☁️ map
(§9) and the two 📊 sections reporting its grouping (§10.3). Being from the same country, or having
worked in the same decade, is a real fact about two artists and no kind of resemblance between
them: those tags sit on hundreds of artists at once, so counting them would make near-strangers
look like neighbours. Everywhere else — the tag filter, the tooltip, every other statistic — all
the tags still count.

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
  F, or **?** for unranked), which is focused immediately. **Save** and **Cancel** buttons sit below
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
  ranks (an arrow between the static tier and the local tier; `unranked` denotes the unranked pool). Nothing
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
tiers; the `unranked only` tier cutoff (below) instead draws **only from the unranked pool**, and the
`unrestricted` cutoff draws from the **whole roster**. When pressed, the chosen artist's **card and name are shown
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
  - `F+ (all ranked)` → S, A, B, C, D, E, F (every ranked tier)
  - `unranked only` → the unranked pool only (no ranked tiers)
  - `unrestricted` → the whole roster (every ranked tier **and** the unranked pool)
- **Weighting intensity** — how probability is spread across the eligible artists:
  - `unweighted` — every eligible artist is equally likely.
  - `gently weighted` — favours higher tiers (an artist in a higher tier is more likely than one in
    a lower tier).
  - `heavily weighted` — strongly favours higher tiers.

  Under the `unrestricted` cutoff, ranked artists are weighted by their tier as usual and the
  unranked artists are weighted **as if they sat in the lowest tier anyone currently occupies**, so
  they surface about as often as the artists at the bottom of the ranking. Empty tiers below that
  one are ignored, so clearing out a bottom tier does not quietly make the unranked rarer.

  The `unranked only` and `S only` cutoffs each draw from a single pool — the unranked artists, or
  the one top tier — with no tiers to weight against each other, so their artists are picked
  uniformly. While either is selected the intensity dropdown is shown **disabled on `unweighted`**;
  reselecting a weighted cutoff (a ranked tier or `unrestricted`) restores the last-used weighting.

- **Tag filter** — restricts eligibility by the artists' tags (see §2). The control sits between
  the cutoff and intensity dropdowns and reads **`no filters`** when nothing is selected, else the
  selection size (e.g. **`5 filters`**). Clicking it opens a **panel listing every tag** present in
  the roster, each with a **checkbox**, **grouped by kind** (genres, musical qualities, regions,
  eras, notable aspects), plus a control that **clears** the whole selection; the panel closes on a
  click elsewhere or Esc. An **all / any toggle** in the panel sets how multiple tags combine: an
  artist **matches** the selection by carrying **every** selected tag (`all`) or **at least one**
  of them (`any`, the default). Because a specific tag carries its derived tags (§2), ticking a
  general tag selects everything beneath it: `punk rock` matches the pop punk, ska punk and
  skate punk artists, and `European` matches the Swedes and the Scots. While one or more tags are
  selected:
  - 🎲 draws only from **matching** artists (combined with the tier cutoff and weighting as
    usual), and
  - every **non-matching** artist is **dimmed** on the board — across all tiers, regardless of the
    cutoff — so the matching artists stand out. Dimmed cards remain fully interactive (drag,
    click-to-edit).

  An artist with no tags matches only the empty selection (under either mode).

The two dropdowns **default to "D+" and "gently weighted"**; they and the tag filter (its tags **and**
its all/any mode) **remember your last selection** across page reloads. The exact probability
curve for each intensity is an implementation detail.

Consecutive presses of 🎲 **never pick the same artist twice in a row**: the previously chosen
artist is excluded from the next draw. The sole exception is when that artist is the *only* eligible
one under the current scheme — then there is no alternative and the repeat is allowed.

A horizontal line is drawn on the board between the lowest eligible tier and the next row down,
reflecting the selected cutoff (e.g. `D+` draws it between the D and E rows). It updates when the
cutoff changes. Both `F+ (all ranked)` and `unranked only` draw the line between the F row and the
unranked area: for `F+ (all ranked)` every ranked tier sits above the line as eligible; for
`unranked only` the unranked pool sits below it as the sole eligible region. The line carries small
labels naming the eligible and ineligible regions, each pointing to its own side of the line; for
`unranked only` those direction indicators invert, since the eligible region sits below the line
rather than above it. The `unrestricted` cutoff draws **no line** at all: every row is eligible, so
there is no boundary to mark.

Edge behaviour: if the chosen scheme has **no eligible artists** (e.g. `A+` selected but S and A
are both empty, `unranked only` with an empty unranked pool, or a tag filter that no artist in the
eligible range satisfies), the 🎲 button performs no action and indicates that nothing can be
picked (e.g. by being disabled).

## 9. Artist map (☁️)

A **☁️** button opens a **full-screen map** of the roster: every artist's card (image — or the
usual placeholder — and name) laid out on a two-dimensional plane, organised into **genre
clusters** drawn from the artists' tags (§2).

The map is a picture of how the collection **sounds**, so it reads only the tags that say so —
genres and musical qualities — and a shared country, decade or notable aspect never brings two
artists together on it (§2). An artist's tooltip still lists all of its descriptive tags: the map
is saying where the artist belongs, not everything true about it.

- **Every artist belongs to at most one cluster** — broadly, the most specific genre it shares
  with enough other artists. Membership is **never forced**: an artist whose own genres are too
  rare to form a group joins another cluster only when it genuinely shares that cluster's sound
  (its genres overlap the members'); artists that fit nowhere well stay **unclustered**, each
  standing just outside the circle of the cluster it most resembles, with a small **glow of its
  own**. A cluster represents a real relationship, not a best-effort bucket.
- **A cluster is named after every tag that put an artist in it**: the genre that defines it,
  followed by the tags on which artists who do *not* carry that genre joined. Where nobody joined
  from outside — most clusters — the defining genre is the whole name. Naming a cluster after its
  defining genre alone would state something untrue of everyone taken in afterwards: a composer of
  orchestral game music sits among progressive metal bands because they all share *prog rock*, and
  *progressive metal* is not a description of him.
- Each cluster is marked by a **soft, faint glow** behind its artists, in two parts: a **wide haze**
  that reaches well past the cluster and **mingles with its neighbours'**, so the map reads as one
  cloud rather than a field of separate discs, and a **brighter pool** over the cluster's own
  artists — brightest at the heart, fading out at the boundary. **All of a cluster's members lie
  inside its circle, tightly and evenly packed**, and clusters never overlap one another.
  **Hovering the space inside a cluster** explains it in a tooltip: its name, and the artists it
  contains **grouped by the tags each of them joined on** (useful zoomed out, when names are too
  small to read). Hovering explains **the cluster whose circle the pointer is inside, and only
  that one**: a cluster's neighbours are always reachable, however far its light spills over them,
  and the gulfs between families explain nothing.
- The grouping is **two-tiered**: clusters of related sound form **families** (the punk scenes
  in one neighbourhood, electronic pop in another). Within a family the circles pack **snugly,
  edge to edge**; between families lie **wide gulfs** — so both which artists belong together
  and which clusters belong together are readable at a glance. Within a cluster, the most
  representative members sit at the **centre**, with looser fits towards the edge.
- **Each family's light carries a slight tint of its own**, one hue per family, so a
  neighbourhood is recognisable as one thing even where its clusters' haloes merge. The tints are
  handed out **largest family first** and repeat only if the families outnumber the hues. They
  identify a family and say nothing else: no hue ranks above another, and an artist in no family
  keeps the neutral light. Families are numbered in the same order the statistics (§10.3) list
  them, so the same neighbourhood is the same one in both.
- The map shows **every artist**, regardless of tier placement, picker cutoff, or active tag
  filter; artists are **spaced apart — never stacked on top of one another** — so every artist
  stays individually visible.
- The layout is **stable**: the same roster produces the same map on every open and across
  reloads. Positions change only when the roster's tags change.
- **Scrolling zooms** the map in and out, anchored on the pointer's position, between a
  whole-cloud overview and a close-up; on touch screens a **two-finger pinch zooms** the same
  way, anchored between the fingers (panning at the same time if the fingers travel together).
  **Dragging pans** it. The map opens fitted so the whole cloud is visible, and it can never be
  zoomed or panned so far that the cloud is lost off screen entirely.
- As on the board (§5), **hovering an artist** reveals its tags in a tooltip.
- The map is **read-only**: artists cannot be rearranged from it, and viewing it changes nothing
  about tiers, the picker, or filters.
- A **close control (✕) in the top-right corner** exits the map, as do the platform's standard
  dismissal actions (e.g. the Esc key). Closing returns to the board exactly as it was.

### 9.1 Searching the map (🔍)

A **🔍 button beside the ✕** expands a **search field** for finding an artist or a tag on a map far
too large to read at a glance. The button folds the field away again, as does leaving an empty
field.

- **What can be searched: every artist, and every tag that places an artist on the map** — the
  genres and musical qualities the clusters are built from (§2). Regions, decades and notable
  aspects are deliberately **not** offered: the map groups nobody by them, so a country has no
  neighbourhood to be shown, and neither do the tags too broad to distinguish anything. Artists
  remain findable by name whatever their tags say.
- Suggestions appear **once three characters have been typed** — fewer matches most of the roster,
  which is a list rather than a suggestion — and are **fuzzy**: matching ignores case and accents,
  and the typed characters need only appear **in order**, not adjacently, so an abbreviation finds
  its tag and a partly-remembered name finds its artist. Every typed character must appear, so a
  query with a wrong letter matches nothing rather than guessing.
- Suggestions are ordered **best match first**, and each **tag says how many artists carry it** —
  which is also what tells a tag apart from an artist of the same name.
- **Choosing a suggestion** (by clicking it, or with the arrow keys and Enter) **shines a spotlight**
  on the map: the rest of the map dims, the **clusters holding the matched artists** brighten, and
  the **matched artists themselves** are brighter still and ringed. A tag whose carriers are spread
  over several clusters lights every one of them. An artist in no cluster lights alone, in the glow
  it already has.
- The view **moves only if it has to**: a spotlight already on screen is left exactly where it is,
  and one that is off screen or only partly visible is brought into view by panning, and zooming
  out no further than needed to fit it.
- The **spotlight stays** until the query is **cleared with the ✕ inside the search field**. It
  survives choosing another suggestion (which replaces it), dismissing the suggestions, and closing
  and reopening the map.
- With suggestions showing, **Esc dismisses the suggestions** rather than the map; a second press
  closes the map as usual (§9).

## 10. Statistics (📊)

A **📊** button opens a **read-only dialog of statistics** about the tier list, derived from the
artists' tags (§2) crossed with their tier placements. The statistics describe the **static
arrangement** (the data shipped with the app, §7): they are computed from that data alone — never
hand-curated — so they automatically follow every artist, tier, or tag change shipped in the
source data. Local rearrangements (§6) do **not** affect them until exported (§7) and shipped.

### 10.1 The premise

The roster is a list of artists the user **likes**. The tiers rank that liking — S is a favourite,
the bottom tier is still good, merely less so — so **no statistic may present a placement as a
criticism**. Two rules follow, and everything below obeys them:

- **Presence is always positive.** Being in the list, at any tier, only ever adds to a tag's
  standing. There is no "least favourite" anything.
- **Comparisons are to the user's own average**, never to an absolute idea of quality. A tag whose
  artists sit below that average is **typical of the collection**, not disliked.

### 10.2 Ground rules

- **Unranked artists are excluded** from every statistic.
- A tag features only when **at least three ranked artists** carry it, so one or two placements
  cannot masquerade as a trend; rarer tags are ignored entirely. Statistics that rest on a
  proportion rather than an average demand more carriers still.
- Statistics that rank tags by how highly their artists sit are **weighted by how much evidence
  stands behind them**, so a tag carried by a handful of artists must be far more striking than a
  widely-carried one to outrank it.
- Two quantities recur, and every entry shows one of them in place of a grade:
  - a **share of the list** (a percentage), counting each artist by its tier, so a tag's standing
    reflects **how many artists carrying it the user collected** as well as where they sit;
  - a **ratio against a typical artist** (e.g. `×1.24`), shown on a bar growing left or right of a
    centre line at `×1.00`.
- **Statistics count every tag an artist's row implies, derived tags included (§2), minus the ones
  too broad to distinguish anyone.** Both halves of that are load-bearing. Derived tags must count
  because a row carries only its most specific tag: an artist described as *emo pop* belongs to the
  pop punk scene whether or not those words appear on it, so counting only what was written down
  scatters one scene across its sub-genres and turns "how much of this list is pop punk?" into a
  question about tagging habits. Broad tags must not, because otherwise every list of common tags is
  headed by the widest labels in the vocabulary — *rock*, *pop*, *North American* — which describes
  how the tags are organised rather than what was collected. **One section departs from this and
  says so**: *What your list is made of* (§10.3) is an inventory of the descriptions actually used,
  so it counts only the tags written on each artist — and needs no breadth rule as a result, since
  nobody is described as *rock*.
- **Prevalence is a description, not a claim, and is never tested.** How much of the list carries a
  tag is a fact in the same class as how many artists there are; it is counted **by head, not
  weighted by tier**, because on a list of music the user likes an artist's presence is already the
  positive signal — having collected 36 pop punk artists *is* the preference, and where those 36 sit
  is a second-order refinement among things already liked.

  What prevalence **cannot** do is separate "the user likes this" from "this is simply common in
  music at large". A tag's frequency carries both, and nothing computable from this data can tell
  them apart, since there is no outside population to compare against. The dialog says so where it
  reports prevalence, and never dresses a count as a discovered preference.
- **A statistic that claims a tag reveals a preference must first beat chance.** Every tag is
  weighed against what a group of its size would do if the tiers were shuffled at random, and the
  test accounts for the fact that each list picks a winner out of the whole vocabulary. **A section
  shows only tags that clear it, and is omitted entirely when none do** — with a short note saying
  so, since a section that silently vanishes reads as a fault rather than as the finding it is.
  Sections that merely *describe* the collection — the roster summary, the two typicality lists,
  and how much of the list each decade accounts for — make no such claim and are always shown.
- **Tier letters appear only where a real tier is named** — an artist's placement, a tier in the
  histogram, or the ends of a span of tiers. Wherever they appear they carry that tier's colour, as
  on the board. A tag is never given a grade of its own.
- Every bar's exact value is available on hover.

### 10.3 What the dialog presents

Sections are gathered under headings that say what question the next few answer.

**Your list in numbers** — the opening summary: how many artists are ranked, how many tags describe
them, and a **histogram of the tiers** (including any tier nobody occupies, so the board's shape is
honest). Bars scale to the fullest tier, which is what makes the shape legible. It also names the tiers counted as
**favourites**, which several later statistics are measured against. The most-collected tag and the
dominant decade are deliberately *not* repeated here — each heads a section of its own below.

**What you like**

- **What lifts an artist** — the tags whose artists are worth most against a typical artist,
  as ratios.
- **The surest signs of a favourite** — the tags that most raise an artist's chances of reaching the
  favourite tiers. Each entry's bar is the share of that tag's artists that are favourites, with a
  **tick marking the whole list's own rate**, so over-representation is visible rather than merely
  asserted; the multiplier comparing the two is damped where few artists stand behind it, and the
  section says so, since it therefore will not equal the bar divided by the tick.

**What a tag tells you**

- **Reliable signals** — the tags whose artists cluster most tightly, so carrying one all but pins
  an artist's tier. Each entry leads with **how far a typical carrier sits from the tag's average**,
  which is what the list is ordered by, then names the span of tiers its artists occupy and draws
  it as a band with a marker for the average.
- **Depends on the artist** — the exact mirror, ordered by the same figure in the opposite
  direction: tags **reaching right across the list**, turning up at every level of the ranking, so
  which artist carries one matters more than the trait does. Each entry counts its artists a full
  tier above and below **that tag's own average** — a position within the tag's own range, never a
  verdict on the artist — and both ends must hold more than one, which is a condition of appearing
  rather than something the ordering trades off. A stricter minimum carrier count applies to both
  of these lists.

- **How far the tags go** — closing the group, a plain statement of **how much of a placement the
  whole vocabulary actually accounts for**, measured by predicting every artist's tier from its tags
  alone and comparing that against where the artists really sit. On a roster where the answer is
  near zero, the dialog says so and tells the reader to treat the lists above as descriptions of the
  collection rather than explanations of the ranking. This replaced two sections that ranked artists
  by their distance from that prediction; both were reprinting the top and bottom tiers, because a
  prediction that barely varies makes the distance from it a restatement of the tier.

**The shape of the collection**

- **What your list is made of** — the most common tags in each vocabulary category (genre, musical
  quality, region, notable aspect), by plain prevalence. Broken down per category because one flat list is
  dominated by vocal-style and production tags, burying the question "what genres is this made of"
  under the answer to a different one. **This one section counts only the tags actually written on
  each artist**, not the ones derived from them (§2) — an inventory of the descriptions used, so a
  description nobody wrote is not in it. That also means it needs no breadth rule: nobody is
  described as *rock*, so *rock* cannot appear. The trade is that a scene split across sub-genres is
  reported split (*emo pop* and *pop punk* as separate rows); "the worlds it splits into", below,
  is what answers the question at that level.
- **The worlds it splits into** — the collection above the level of any single tag: artists gather
  into genre scenes, and those scenes into a handful of broader worlds, each named by the scenes it
  contains rather than by an invented label — and each scene by its own full name (§9), so a scene
  that took in artists from outside its defining genre is listed under all of the tags that put
  them there. These are **the same neighbourhoods the ☁️ map draws**,
  so the two features agree about the shape of the collection — and, like the map, they are built
  from genre and musical-quality tags alone (§2). Artists belonging to no scene are counted out and
  said so.
- **Your core sound** and **One of a kind** — the two ends of one ranking: the artists with the most
  company in the list, and those least like anything else in it. Both lead with the figure they are
  ordered by — **how many other artists carry at least half of this one's musical tags** — so the
  ordering is checkable, and share one bar scale so the lonely end reads as short beside the
  crowded one. Like the map they borrow their notion of likeness from, these two sections read
  genres and musical qualities only (§2): *one of a kind* means one of a kind to listen to, and the
  only artist from a given country is not thereby unusual.
  **Both sections state what that figure counts**, because at the lonely end it is routinely 0 for
  every row, and an unlabelled column of zeros reads as "shares no tags with anything", which is
  not what it means.
  Being an outlier is explicitly not a demerit; those are the corners the taste reaches into, and
  only that list carries the extra note of the artist's **least-shared musical tag**, since "what
  makes this one different?" is the question only it raises — and a section ranking by sound must
  answer it with a sound.
- **Decades** — the one section drawn as a **chart** rather than a list, because its order is
  chronological rather than a ranking. Two panels sit over a single **oldest-to-newest** axis: a
  column per decade for how many artists it holds, and beneath it a curve for how much those
  artists are worth against a typical one, read against a marked baseline. Presenting it this way —
  rather than as two numbers per row — is what makes the shape of a listening history legible at a
  glance. Era tags appear **only here**; they are left out of every other statistic, so a strong
  decade preference cannot crowd out the rest of the vocabulary.

The exact list lengths, carrier minimums, weighting strength, and spread measure are implementation
details. The dialog is dismissed with its **✕ close button**, the Esc key, or a **click outside
it**, and viewing it changes nothing about tiers, the picker, or filters.

## 11. Empty / edge states

- **Artist with no image:** the card shows a placeholder in place of the image; the name is still
  shown. An artist whose image **fails to load** (e.g. a broken or removed URL) falls back to the
  same placeholder, so a dead link never shows a broken-image glyph.
- **Empty tier:** the tier row is still displayed (empty), as a valid drop target.
- **Empty unranked area:** still displayed, as described in §3.
- **No eligible artists for a pick:** handled as in §8.
- **Map search matching nothing:** the suggestions say so plainly (§9.1). Below the three-character
  minimum no suggestions are shown at all — having typed too little to search is not the same as
  having searched and found nothing.
- **Statistics with too little data:** when nothing is ranked — or no tag is carried by enough
  ranked artists — the statistics dialog (§10) explains that there is not enough data, instead of
  presenting empty sections. Individual sections with nothing to report are omitted, except the
  significance-gated ones in §10.3, where having nothing to report is itself the finding and is
  stated rather than hidden.

## 12. Out of scope (explicitly)

The following are intentionally **not** part of the application:

- No backend, server, database, or user accounts.
- No adding, renaming, or deleting artists from within the app.
- No editing of artist images from within the app.
- No fetching of images at runtime — images are pre-curated URLs in the static data.
- No adding, renaming, reordering, or deleting tiers.
- No automatic writing back to the source data file — export is manual, via the clipboard (§7).
