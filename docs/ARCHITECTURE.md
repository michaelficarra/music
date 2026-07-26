# Architecture — Artist Tier List

> This document describes **how the application is built**. It is the technical counterpart to
> [PRD.md](./PRD.md) and must be kept in sync with the code: any structural or technical change
> should be reflected here.

## 1. Tech stack & rationale

| Concern            | Choice                          | Why |
| ------------------ | ------------------------------- | --- |
| Build tool         | **Vite**                        | Fast dev server, simple static build, first-class `?raw` asset imports. |
| Language           | **TypeScript**                  | Type safety for the data model and weighting logic, minimal toolchain. |
| UI                 | **Vanilla DOM/TS** (no framework) | The app is small; no framework keeps the bundle tiny and the output purely static. |
| Drag-and-drop      | **SortableJS**                  | Framework-agnostic, zero-dependency, purpose-built for reorderable lists and dragging items between lists, with mouse **and** touch support. Its bundled AutoScroll plugin is enabled and tuned in `board.ts` (`scroll`/`scrollSensitivity`/`scrollSpeed`/`bubbleScroll`) so dragging near a viewport edge scrolls the page. This **requires `forceFallback: true`**: in native HTML5 drag mode SortableJS defers page scrolling to the browser, which Chrome doesn't do for the document body, so auto-scroll silently no-ops on desktop; the pointer-based fallback (already used for touch) runs the plugin's own scroller instead. |
| Hosting            | **GitHub Pages** via **GitHub Actions** | Free static hosting; the Action builds and deploys, so build artefacts are not committed. |

There is intentionally **no UI framework and no runtime data fetching of images** — the app is a
static bundle plus a build-time-embedded copy of the artist data.

## 2. Project layout

```
.
├── data/
│   ├── artists.csv          # Source of truth for the artist roster, tiers, and images
│   └── tags.csv             # The tag vocabulary: every tag, its category, what it derives (§3a)
├── scripts/
│   ├── enrich-images.ts     # Dev-time tool that fills in image URLs (see §9)
│   ├── add-artist.ts        # Append an unranked artist to the CSV, then enrich them
│   ├── tag-research.ts      # Dev-time tool: outside evidence for tagging an artist (see §9a)
│   └── thumbnail.ts         # toThumbnail(): prefer smaller image forms (see §9)
├── src/                     # Application source
│   ├── main.ts              # Entry point: populate dropdowns, build board, wire events
│   ├── types.ts             # Core domain types (Tier, Slot, Cutoff, Artist)
│   ├── csv.ts               # RFC-4180 CSV parse/serialise (see §3)
│   ├── data.ts              # Embeds data/artists.csv at build time → the static baseline
│   ├── store.ts             # Local-storage overlay + diff (Reset/Save) logic
│   ├── board.ts             # Renders tiers + unranked area, wires SortableJS
│   ├── thumb.ts             # createThumb(): artist thumbnail/placeholder, shared by board + map
│   ├── random.ts            # Weighting schemes + weighted random pick (see §6)
│   ├── filter.ts            # matchesTags(): the 🎲 tag filter's matching rule (see §6)
│   ├── tag-registry.ts      # Embeds data/tags.csv; withDerivedTags() (see §3a)
│   ├── tag-groups.ts        # groupTags(): vocabulary categories for the filter panel (see §6)
│   ├── cloud-layout.ts      # Tag similarity, scene/world grouping + layout for ☁️ (see §7)
│   ├── cloud.ts             # The ☁️ map dialog: renders the layout, pan/zoom (see §7)
│   ├── stats.ts             # Roster/tag/tier aggregation behind the 📊 statistics (see §8)
│   ├── stats-view.ts        # The 📊 statistics dialog: renders stats.ts's results (see §8)
│   ├── sort.ts              # compareArtistNames(): canonical (case/accent-insensitive) name order
│   └── styles.css           # App styles
├── public/
│   └── favicon.svg          # Static asset copied verbatim into the build
├── docs/                    # PRD.md, ARCHITECTURE.md (this file)
├── .github/workflows/
│   ├── ci.yml               # Typecheck + test + format check on push / PR (see §10)
│   └── deploy.yml           # Build + deploy to GitHub Pages (see §10)
├── index.html               # Static UI shell (toolbar, board container, reset dialog); main.ts fills the dynamic parts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 3. CSV schema (`data/artists.csv`)

Columns, in order:

| Column        | Meaning |
| ------------- | --- |
| `Artist`      | Artist name. **Unique**; used as the identity key throughout the app. |
| `Tier`        | One of `S`, `A`, `B`, `C`, `D`, `E`, `F`, or **blank** for unranked. |
| `ImageURL`    | URL of a representative image, or blank (→ placeholder). |
| `ImageSource` | Which provider supplied the image (`apple-music`, `musicbrainz`, `youtube-music`, `wikipedia`), or blank. |
| `Tags`        | Semicolon-delimited descriptive tags, or blank (a newly added artist). See below. |

- Encoding: UTF-8, first row is the header.
- **Quoting:** standard RFC-4180. Fields containing a comma, double-quote, or newline are wrapped
  in double quotes, with embedded double-quotes doubled. This matters for names such as
  `Dan le Sac vs. Scroobius Pip` (safe) and any future name containing a comma.
- **Tags:** descriptors drawn from the vocabulary registered in `data/tags.csv`
  (below), joined with `;` (no surrounding spaces), e.g.
  `pop punk;skate punk;anthemic choruses;male vocals;San Diego;2000s;Warped Tour`. Casing is
  natural: proper nouns and acronyms keep their capitals (`Warped Tour`, `EDM`, `J-pop`),
  everything else is lowercase. A row spans genre(s), Pandora-style musical qualities (vocal
  style, instrumentation, mood, lyrics), region, the peak decade(s) (`1950s`…`2020s`), and
  notable aspects (`side project`, `comedy`, `girl group`).

  Two rules govern how many tags a row carries and which ones:

  - **There is no upper or lower bound — accuracy is the only criterion.** An artist warranting
    four tags gets four; one warranting thirty gets thirty. (Today the roster runs about 13–24.)
  - **Rows carry only the most specific tag in each direction — never one that another implies.**
    A row saying `pop punk` does not also say `punk rock`, `pop rock` or `rock`; a row saying
    `Swedish` does not also say `Scandinavian` or `European`. The rest are derived at
    load time from the registry, so writing them out too would be redundant and could contradict it.

  Conventions: no commas/semicolons/quotes inside a tag (keeps the field unquoted), no duplicates
  within an artist. Tag matching is **case-sensitive**, so keep each tag's spelling identical
  everywhere it appears. `src/data.ts` parses the field into `Artist.ownTags` (blank → `[]`) and
  those plus everything derived from them into `Artist.tags` (§4).
- The file holds the full artist roster (a few hundred rows). It may be edited by hand or by the
  enrichment script (§9); `scripts/tag-research.ts` (§9a) gathers the outside evidence tagging
  should rest on.

### 3a. Tag vocabulary (`data/tags.csv`)

This file **declares the whole vocabulary**: one row per tag, whether or not that tag derives
anything. About a third of the rows derive nothing at all — every era and every notable aspect, and
most musical qualities (`male vocals` has no more general form) — and they are here to give the tag
its category, which is what the 🎲 panel groups by (§6). A tag used in `artists.csv` with no row
here is a test failure, not a shrug.

Where tags *do* relate, they form a **directed acyclic graph** rather than a flat list: a tag names
the more general tags derived from it, and the app derives them transitively. That is what lets the
🎲 panel's `European` find the Swedes and `punk rock` find the ska-punk and skate-punk bands,
without any of it being written on 253 artist rows by hand.

| Column     | Meaning |
| ---------- | --- |
| `Tag`      | The tag, spelled exactly as it appears in `artists.csv`. **Unique.** |
| `Category` | One of `genre`, `quality`, `region`, `era`, `aspect` — drives the 🎲 grouping (§6). |
| `Derived`  | Semicolon-delimited tags derived **directly** from it, or blank for a root. |

- **Deriving more than one tag is normal**, which is why this is a graph and not a tree: `pop punk`
  derives `pop rock;punk rock`, `metalcore` derives `hardcore;metal`, `avant-funk` derives
  `experimental;funk`.
- **Crossing categories is allowed where the implication is real.** `Christian rock` is a genre
  whose carriers genuinely are `Christian` (an aspect), and each tag still files under its own
  heading, so the artist appears in both. Two crossings are rejected: a non-region may not imply a
  **region** (`J-pop` → `Japanese` would assert an origin for everyone else who plays it), and
  nothing may involve an **era** on either side.
- **Eras are flat.** They are recognised by shape (`/^\d{4}s$/`) rather than by category, because
  the 📊 statistics use that same test to confine them to their own section (§8.4); an umbrella
  like `21st century` would not match it.
- Rows are sorted by category (in the §6 display order) then by tag, so one category's hierarchy
  reads together and diffs stay small.
- **Region granularity: recognised scenes, then countries.** A city is tagged when the artist is
  genuinely identified with that scene (`New York`, `Glasgow`, `Stockholm`, `Tokyo`), and the
  country otherwise. States and provinces exist in the registry as the connective tissue between
  a city and its country (`New York` → `New York State` → `American`) but are not written on
  rows. The alternative — tagging every birthplace MusicBrainz records — produces around 150
  cities carried by one artist each, which inflates the 🎲 panel without grouping anything.
- `src/tag-registry.ts` embeds this file at build time and exposes `withDerivedTags`; the invariants
  above are enforced by `validateRegistry` and asserted against the real data in
  `src/tag-registry.test.ts`. A tag used in `artists.csv` but absent here still reaches the 🎲
  panel, in a trailing **Other** group — a soft failure, and a test failure.

## 4. Data flow & the "static baseline"

```
data/artists.csv ──(Vite `?raw`, build time)──▶ parsed baseline (name → {tier, imageURL, ...})
                                                        │
local storage (name → tier overrides) ──overlay──▶ current arrangement ──▶ rendered board
                                                        │
                            diff(current.tier, baseline.tier) ──▶ show/hide Reset & Save
```

- The CSV is embedded into the bundle at build time via a raw import
  (`import csvText from '../data/artists.csv?raw'`) and parsed in `data.ts`. This parsed result is
  the **baseline**: the roster (names + images) **and** the shipped tier assignments.
- The **roster and images always come from the baseline.** Local storage only ever holds **tier
  overrides** (see §5), which are overlaid on top. Consequences:
  - Adding/removing/curating artists or images in the CSV takes effect immediately, even for users
    who have a saved arrangement.
  - An override for an artist no longer in the CSV is simply ignored.
- **Current tier** of an artist = its local-storage override if present, else its baseline tier.
- **Save** (after confirmation, see §5) writes the serialised CSV (§3) to the clipboard, and — only
  when the page is served from the deployed site
  (`location.origin + pathname === "https://michaelficarra.github.io/music/"`) — opens the file's
  GitHub edit page in a new tab. The guard keeps local dev and forks from spawning
  a tab to a repo the viewer can't push to; the clipboard copy happens regardless. Both the edit URL
  (`https://github.com/michaelficarra/music/edit/main/data/artists.csv`) and the site URL are
  **hard-coded** in `main.ts` — the one place the repo name is baked in (cf. the relative `base` in
  `vite.config.ts`, §1) — so both must be updated if the repo is renamed or moved. GitHub cannot
  pre-fill the editor from a URL, hence the clipboard copy: the maintainer pastes, then commits to
  redeploy.

## 5. State model & persistence

- **In memory:** the current arrangement is held as a `Map<ArtistName, Tier | UNRANKED>` plus the
  immutable baseline (roster, images, baseline tiers).
- **Local storage** (`store.ts`) holds five independent keys:
  - `artist-tier-list:v1` — the arrangement, as JSON:
    ```json
    { "version": 1, "assignments": { "Radiohead": "S", "Nickelback": "E", ... } }
    ```
    `assignments` is a sparse map of **name → tier** overrides. Only tier is stored (no within-tier
    order, per PRD §5). Writes happen immediately on every drop.
  - `artist-tier-list:scheme` — the last-used picker scheme as a `cutoff:intensity` id (§6), so the
    two picker dropdowns restore their selection across reloads (PRD §8).
  - `artist-tier-list:picked` — the name of the most recently picked artist, so its persistent glow
    survives a reload until the next 🎲 press (PRD §8).
  - `artist-tier-list:filters` — the 🎲 tag filter's selection as a JSON string array of tag names
    (removed when the selection is empty). On load, `main.ts` drops any stored tag that no longer
    exists in the roster; malformed entries read as no filter.
  - `artist-tier-list:filter-mode` — how the filter combines its tags: `all`, or absent for the
    default `any` (invalid values also read as `any`).

  All but the first are independent UI preferences: they are never pruned against the baseline and
  do not affect the Reset/Save diff, which considers `assignments` only.
- **Prune on load:** when overrides are hydrated, any stored assignment that now equals the current
  baseline value (e.g. because a rebuild shipped that tier) is redundant and dropped, as are entries
  for unknown artists or invalid slots. If anything was dropped, storage is rewritten with the
  cleaned set (or the key removed when nothing genuine remains) so stale data doesn't linger.
- **Diff for Reset/Save:** compare each artist's current tier with its baseline tier. If any differ,
  the arrangement is "changed" → show Reset and Save. Within-tier order is irrelevant to the diff.
  `store.getChanges()` returns the changed set as a sorted `SlotChange[]` (`{ name, baseline,
  current }`, canonical name order) — the data both confirmation modals render, one line per artist.
- **Confirmation modals:** Reset and Save each have a native `<dialog>` (`#reset-dialog`,
  `#save-dialog`; `showModal()` + `<form method="dialog">`). Before opening, `main.ts` fills the
  dialog's `<ul class="diff-list">` from `getChanges()` — Reset shows each change as **current →
  baseline** (what reverting restores), Save as **baseline → current** (what will be written out).
  Neither action runs unless the dialog closes with a `confirm` return value. The dialogs are
  light-dismissable (click the backdrop / Esc) via the declarative `closedby="any"` attribute,
  with a click-outside fallback in `main.ts` for browsers that lack it (e.g. Safari); since
  `showModal()` resets `returnValue` to `""`, any such dismissal reads as a cancel.
- **Reset:** on `confirm`, removes the local-storage key and re-renders from the baseline.
- **Save (clipboard):** on `confirm`, serialise the **full** arrangement to CSV and write it to the
  clipboard via the async Clipboard API (`navigator.clipboard.writeText`). The clipboard write and
  the GitHub-tab `window.open` run synchronously inside the dialog's `close` handler, which is still
  within the confirm-button's transient activation, so the popup blocker and clipboard permission
  treat them as user-initiated. Serialisation rules:
  - Update only the `Tier` field of each row to the artist's current tier (blank for unranked); all
    other columns are passed through unchanged.
  - **Sort the data rows by artist name** via `compareArtistNames` (`src/sort.ts`, a case- and
    accent-insensitive `localeCompare`) so the exported CSV stays in the list's canonical order.
  - Apply RFC-4180 quoting (§3).
- **Undo (single-level):** `createBoard`'s `onChange` callback takes an optional `MoveRecord`
  (`{ name, from, to }`), emitted whenever a drag or click-to-edit actually changed an artist's tier
  (a within-tier reorder emits none). `main.ts` renders a toast whose **Undo** button calls
  `board.move(name, from)` to restore the previous tier. `Board.move` applies the same store/DOM
  update as a drag but deliberately reports **no** `MoveRecord`, so an undo can't itself be undone.
  No extra persisted state backs this — an undo is just another `store.setSlot`.
- **Render order:** the board keeps every list (each tier and the unranked pool) in canonical name
  order via `insertCardSorted` (`board.ts`), which reuses `compareArtistNames` (`src/sort.ts`). It is
  applied on initial placement, on edit/undo/`Board.move`, and **live during a drag** via two
  SortableJS hooks: `onMove` returns `false` for moves *within* a list (cancelling the default
  pointer-based reorder) but `undefined` for *cross-list entry* (a `false` there would corrupt the
  drop bookkeeping, so `onEnd` would read the wrong tier); `onChange` then fires right after the card
  is inserted into a list and re-seats it at its sorted slot — so it lands sorted the instant it
  enters a tier, not only after being nudged within one. Because intra-list moves are blocked in
  `onMove`, they never reach `onChange`, so there's no fight with the pointer. `onEnd` re-seats once
  more as a final safety. Within-tier order is non-semantic (PRD §5), so this is purely presentational
  and nothing about ordering is persisted.

## 6. Random picker & weighting (`src/random.ts`)

The 🎲 picker (PRD §8) is pure, side-effect-free logic, so it lives in its own module and is unit
tested in `src/random.test.ts`. A **scheme** has two independent dimensions — both persisted as a
single `cutoff:intensity` id (§5):

- **Cutoff** — which slots are eligible (typed `Cutoff = Slot | typeof ALL`; the `ALL` sentinel is
  a picker-only value, never a stored `Slot`). For a ranked cutoff the eligible tiers are S down to
  the cutoff inclusive (`eligibleTiers`); the special `unranked` cutoff ("unranked only") instead
  draws from the unranked pool alone, ignoring intensity; the `ALL` cutoff ("unrestricted") draws
  from the **whole roster** — ranked artists keep their tier weight and unranked artists are weighted
  as the lowest ranked tier (F), so intensity still applies.
- **Intensity** — how a candidate's selection weight is derived from its tier:
  - Each ranked tier has a base **Fibonacci / planning-poker weight** (`TIER_WEIGHT`, exported from
    `types.ts`): `S 13, A 8, B 5, C 3, D 2, E 1, F 1`. The 📊 statistics (§8) share it, so the two
    features value a tier identically.
  - `unweighted` → every eligible artist has weight 1 (uniform).
  - `weighted` → weight is `TIER_WEIGHT[tier]`.
  - `heavily` → weight is `2 × TIER_WEIGHT[tier]` (widening the gap between tiers).

  These multipliers are the concrete realisation of the "probability curve" PRD §8 leaves
  unspecified; treat the exact numbers as tunable, not contractual.

For accessibility, each successful pick also writes `Picked <name>` into a visually-hidden
`aria-live` region (`#pick-announcer` in `index.html`, set in `main.ts`'s roll handler), so screen
readers announce the choice that the on-screen reveal conveys only visually.

Selection is **cumulative-weight roulette**: sum the candidates' weights, draw `rng() × total`
(`rng` defaults to `Math.random` but is injectable for deterministic tests), and walk the list
subtracting until the threshold goes negative; a final fall-through returns the last candidate to
absorb floating-point overshoot. The previous pick is **excluded** from the draw (never the same
artist twice in a row) unless it is the only candidate. `hasEligible` drives whether 🎲 is enabled.

**Tag filter (PRD §8).** The picker can additionally be restricted to artists matching a set of
selected tags (§3) — carrying **all** of them or **at least one**, per the panel's all/any mode
toggle. The matching rule lives in `src/filter.ts` (`matchesTags(artist, selected, mode)`, unit
tested in `src/filter.test.ts`); `random.ts` knows nothing about tags — `main.ts` applies the
filter *upstream*, building the picker's slot map from only the matching artists, so `pick` and
`hasEligible` see a pre-filtered pool (and 🎲 disables when the filter and cutoff together leave
no candidates). The panel itself is a native **popover** (`popover` + `popovertarget` in
`index.html` — the browser supplies top-layer stacking, Esc, and light-dismiss); `main.ts` fills
it with one checkbox per tag from `data.ts`'s `allTags` (the sorted distinct tags in the roster,
**including the ones derived from the registry** — that is what makes ticking `European`
or `punk rock` useful), anchors it under the toolbar's `#filter` button on each open (popovers are
fixed in the top layer, so the UA default would centre it), keeps the button's `no filters` /
`N filters` label current, and persists the selection (§5). The checkboxes are **grouped by
vocabulary category** via `src/tag-groups.ts` (`groupTags`): genres, musical qualities, regions,
eras (matched by the `/^\d{4}s$/` shape rather than a category), and notable aspects. Which
category a tag belongs to is data, not code — `tag-groups.ts` reads it from `tag-registry.ts`
(§3a) and only decides the headings and their order; a tag absent from the registry lands in a
trailing **Other** group rather than disappearing. Dimming
of non-matching cards is `Board.setTagFilter`, which toggles a `filtered-out` class per card —
visual only, the cards stay interactive.

## 7. Artist map (`src/cloud-layout.ts`, `src/cloud.ts`)

The ☁️ map (PRD §9) is split like the picker: pure geometry in `cloud-layout.ts` (no DOM, unit
tested in `src/cloud-layout.test.ts`), rendering and interaction in `cloud.ts`, and the
full-screen `<dialog id="cloud-dialog">` shell in `index.html`.

- **Similarity model** (`pairwiseSimilarities`): each tag gets a **co-occurrence profile** — a
  vector of how often it appears alongside every tag across the roster, L2-normalised so tags
  compare by the *shape* of the company they keep rather than their raw frequency. An artist's
  vector is the **IDF-weighted sum** of its tags' profiles (rare tags are more discriminative
  than ubiquitous ones), and artist-to-artist similarity is the **cosine** of those vectors.
  Sharing a tag contributes fully; carrying *related* tags contributes partially — including
  near-synonyms that rarely share an artist (curators pick one or the other) but keep the same
  company, e.g. two punk subgenres both co-occurring with `punk rock` and `2000s`. Relatedness
  is thus **data-driven** — `tag-groups.ts` names the clusters (below) but plays no part in how
  similar two artists are; its categories (all of "Genres", say) are far too broad for that.
- **Cluster-first layout** (`computeCloudLayout`): the map is *not* a force-directed embedding —
  an earlier force-simulation approach produced a uniform-density smear with inexplicable
  neighbours and was abandoned. Instead the clusters are built explicitly and all geometry
  follows from them, so every placement has a reason a viewer can reconstruct:
  1. **Partition.** Each genre tag (per `tag-groups.ts`) claims its carriers, **most specific
     (rarest) genre first**, so a niche scene (`third-wave ska`) forms before an umbrella genre
     (`pop rock`) sweeps up the leftovers; a genre founds a cluster only if it can claim at
     least 4 artists. Two details matter here:
     - Specificity is inferred from **rarity**, not read off the registry's hierarchy (§3a). The
       two largely agree — a derived umbrella is by construction carried by everything beneath it —
       and rarity additionally ranks genres the hierarchy leaves unrelated.
     - Scenes are founded on **`ownTags`**, the genres artists were actually given, while the
       similarity model above counts derived tags too. A shared umbrella is real evidence two
       artists are related, but it cannot *define* a scene: every rock band derives `rock`, so
       umbrellas found huge meaningless rings and make the adoption test below unanimous. Founding
       on derived tags gave 46 scenes with **every** artist adopted; on own tags it gives 42 scenes
       with 17 loners, the same shape the pre-hierarchy roster produced (41 scenes, 6 loners).

     Artists left unclaimed may be **adopted** — but only on genre evidence
     (sharing a genre tag with members; mean ≥ 0.5), since counting ubiquitous quality/era tags
     adopted everyone however poor the fit; artists clearing the bar nowhere stay unclustered,
     on the rim (PRD §9: membership is never forced). Within a cluster, members are ordered by
     mean similarity to their fellows — archetypes first.
  2. **Cluster packing.** A cluster's members occupy the nearest points of a **hexagonal
     lattice** (the densest packing of equal discs): every neighbour sits at exactly the
     minimum spacing and the group compactly fills its bounding circle, archetypes at the
     heart. The ring is the bounding circle of the actual offsets, plus padding.
  3. **Disc placement, twice over.** The clusters are agglomerated into **families of related
     sound** (~√k groups, average-linkage on affinity = mean cross-member similarity); a
     shared greedy primitive (`packDiscs`) then packs each family's rings **edge to edge** —
     largest first, each walking an Archimedean spiral out from the affinity-weighted centroid
     of its already-placed kin (affinity squared, favouring the closest) to the first clear
     position — and packs the families themselves the same way with a **wide gap**. Rings never
     overlap, related clusters touch, and the gulfs between families carry the visual
     separation (PRD §9).
  4. **The loners.** Unclustered artists are placed by the same spiral search: each walks out
     from the cluster it most resembles to the first spot clear of every ring and every other
     loner, nestling into the notches beside its nearest kin rather than orbiting the map.

  All geometry is computed in **spacing units** (1 = the minimum artist-to-artist distance) and
  normalised to the unit square; the returned `spacing` value tells the renderer what one unit
  became. The whole pipeline is **deterministic — no randomness at all** (PRD §9's stability)
  and runs in ~10 ms; it is computed **lazily on the first ☁️ press** and kept for the session.
- **Rendering & interaction** (`cloud.ts`): one absolutely-positioned node per artist (the
  shared thumbnail from `src/thumb.ts` plus a name caption) on a `.cloud-plane` in **world px**,
  where the world's size maps the layout's spacing unit onto the node footprint
  (`NODE_SPACING`) exactly — density is by construction, not tuning. The cluster markers are
  circles appended **before** the nodes (so they paint behind), filled with a soft white
  radial gradient rather than an outline and drawn half again larger than the cluster's
  geometric radius (`GLOW_SCALE`) so the light spills past the boundary; each carries a
  `title` tooltip naming its genre and members. Loners get a node-sized halo of the same
  gradient (tooltip: the artist's own). Pan and zoom never touch the nodes: both are a single
  `translate(…) scale(…)` transform on the plane. Wheel events zoom **anchored on the cursor**
  (exponential in deltaY, normalised for line-mode deltas; trackpad pinches arrive as
  ctrl+wheel and work unchanged), clamped between half the fitted overview and a 4× close-up.
  Dragging and touch pinching share one pointer-capture handler over up to two tracked
  pointers: each move re-anchors the view so the world point under the pointers' midpoint
  follows it, scaled by the ratio of their separation — with one pointer that reduces to a
  plain pan, with two it is a pinch zoom (same scale clamp as the wheel). Panning is clamped
  so part of the world square always stays on screen.
  The dialog opens via `showModal()` (Esc/close requests are native); being full-screen there
  is no visible backdrop, so no `closedby` light-dismiss — the ✕ button calls `dialog.close()`.
  While it is open, the page's own scroll bar is suppressed
  (`body:has(#cloud-dialog[open])`). The view re-fits to the whole cloud on every open.

## 8. Statistics (`src/stats.ts`, `src/stats-view.ts`)

The 📊 dialog (PRD §10) follows the map's split: pure aggregation in `stats.ts` (no DOM, unit
tested in `src/stats.test.ts`), rendering in `stats-view.ts`, and a `<dialog id="stats-dialog">`
shell in `index.html` — a standard `.modal` like Reset/Save, sharing their `closedby="any"`
light-dismiss and the `main.ts` click-outside fallback (§5); its only form control is a top-right
✕ (still submitted through the dialog form), styled by the shared `.modal-close` rule the map's
✕ also uses.

- **Inputs.** Every statistic is a pure function of the **baseline** (§4): each artist's
  `baselineSlot` and tags, exactly as embedded from the CSV at build time. Local overrides play
  no part (PRD §10), so the content is fixed per build — `stats-view.ts` computes and renders it
  lazily on the first 📊 press and keeps the DOM for the session, like the map's plane. Nothing
  is hand-curated: a data change reshapes the statistics on the next build.

### 8.0 Which tags a statistic counts

`countedTags` reads an artist's **`ownTags`** — what its CSV row says — and not the tags derived
from those (§3a). This was a measurement, not a preference. Counting derived tags too, every
prevalence list is topped by umbrellas: `rock, pop, alternative rock, punk rock, pop rock` for
genres and `North American, American, European` for regions. That describes the shape of the
*vocabulary*, not of the collection, and it is the exact failure PRD §10.2 forbids — a list whose
ordering is an artefact of how the data is stored. On own tags the same list reads `pop punk, power
pop, emo pop, alternative rock, electropop`, which is the question the reader asked. Derived tags
also push 42 extra tags past `MIN_SUPPORT` for no gain, tightening the correction (§8.2a).

Two figures do count derived tags, because they **are** the ☁️ map: `rankTasteWorlds`, which
delegates wholesale to `groupRoster`, and an artist's `kinship`, which is `pairwiseSimilarities`.
Derived tags genuinely help the similarity model — two artists sharing an umbrella are related
evidence — and the map and the dialog must not disagree about the collection's shape.

### 8.1 Two tier valuations, deliberately

PRD §10.1's premise — presence is positive, comparisons are to the user's own average — is
implemented by keeping two *different* questions on two different scales. They are not a
duplication to be tidied away:

- **`TIER_WEIGHT` (`types.ts`) — how much an artist counts.** The Fibonacci weights shared with the
  🎲 picker (§6). Every value is positive, so no placement can subtract, and the gaps widen towards
  the top, matching how a tier list is used. Drives `share` and `ratio`.
- **`tierPosition` (`stats.ts`) — where an artist sits.** The ordinal index, S 7 down to F 1. Used
  *only* for statements about placement: the predictor range gauges, the outlier prediction model,
  and `tierBand`/`tierLabel`, which band a mean position onto a letter (each tier owns the unit of
  the scale centred on its own position, split into thirds — middle third the bare letter, outer
  thirds leaning `+`/`−`; 6.5 → `S−`, and clamping makes `S+`/`F−` impossible).

`computeBaseline` derives the roster-wide denominators once: `totalWeight`, `meanWeight`, the
occupied `positions` range, and the **favourite tiers** — the top tiers covering at least
`FAVOURITE_SHARE` (0.25) of the ranked roster, taken from the data rather than hard-coded so a
reshuffle moves the boundary with it.

`positionFraction(position, range)` maps a placement onto a gauge track across the **occupied**
span, not the theoretical 1..7. The old absolute axis reserved a sixth of every track for `F`,
which has held nobody since the F-tier artists were removed; with every tag's mean landing inside a
tier and a half of every other, that forced a view-level rescale hack in `stats-view.ts` just to
tell the rows apart. Deriving the ends from the data retires it.

### 8.2 Per-tag aggregates (`computeTagStats`)

Each tag's ranked carriers yield, alongside the placement facts (mean position, population standard
deviation, lowest/highest, and how many carriers sit a full tier either side of the mean):

- `prevalence` = carriers ÷ ranked roster — a plain 0..1 headcount, **deliberately unweighted by
  tier**, and the currency of every descriptive section. A tier-weighted `share` stood here and was
  removed: it quietly re-imported the assumption that a low placement counts for less, which is the
  premise this module exists to reject. Bars render it directly.
- `ratio` = shrunk mean carrier weight ÷ `meanWeight`, where shrinkage mixes in a prior worth
  `PRIOR_STRENGTH` (10) artists at the roster average. **This is the fix for the failure that
  prompted the rework**: ranking by a raw average crowned three-artist tags (`New Zealand`,
  `bedroom pop`) while a 36-artist scene (`pop punk`) never appeared. A tag needs about
  `PRIOR_STRENGTH` carriers before it earns half the elevation its raw average claims.
- `meanWeight` — mean `TIER_WEIGHT` of the carriers; feeds `ratio` and the chance test, never
  displayed, since it is a claim about placement rather than a description.
- `favourites` / `favouriteRate` / `favouriteIndex` — carriers in the favourite tiers, as a count, a
  rate, and that rate shrunk against the roster's own rate.

Tags with fewer than `MIN_SUPPORT` (3) carriers are dropped. The rankings: `rankByRatio`, and
`rankByFavouriteIndex` (which applies the higher `SPREAD_MIN_SUPPORT` floor — a rate over three
carriers can only read 0, ⅓, ⅔ or 1).

`rankVariable` and `rankReliable` are exact mirrors, ranking the same `SPREAD_MIN_SUPPORT` (5)
floor by **descending** and **ascending** spread respectively — the one number both lists display.
`rankVariable` additionally gates on genuine reach: **both** ends of a tag's range must hold at
least `MIN_CAMP_SIZE` (2) carriers, so one far-flung placement cannot stand in for a tag that
spans the board. That used to be part of the score (spread × the smaller end's share) instead; the resulting
order moved with no displayed column, so the list read as unsorted. Making it a gate keeps the
guarantee and lets the ± explain the ranking. Ties break by carrier count then canonical tag name
throughout.

`categoryComposition` groups the top `COMPOSITION_PER_CATEGORY` (5) tags of each `tag-groups.ts`
category (skipping "Other") by `prevalence`, and is **ungated** — see §8.2a for why that is the
point rather than an oversight. Per category because one flat list is filled by vocal-style and
production tags, burying "what genres is this made of" under the answer to a different question.

A predecessor ranked by a tier-derived surplus (`excess`) and required it to beat chance. That was a
category error twice over: it made a descriptive count inferential, and it measured preference by
tier position — the very assumption the module is built to avoid. On the roster of the day the
biggest tag was excluded for sitting below its average placement, when "62% of this collection
carries it" is simply a true and useful description of the collection.

`rankTasteWorlds` (§8.3) is descriptive in the same way and likewise ungated.

### 8.2a The significance gate

`markSignificant` runs as a second pass over every tag, because the correction has to see the whole
vocabulary at once. For each tag it asks two questions — is its average elevated, are its carriers
unusually clustered — by **shuffling the tier assignments across the roster** (leaving each artist's
tags alone) `NULL_SAMPLES` (10 000) times and seeing how often a group of that size lands as far
out by luck. A prefix of a shuffle *is* a uniform random subset, so one walk down each shuffle
yields the null for every carrier count at once; the RNG is seeded, so the dialog stays a pure
function of the roster. Cost is ~45 ms on the shipped data, inside the existing lazy first-open
build.

Shuffling rather than a normal approximation, because `TIER_WEIGHT` is badly skewed (S counts 13,
E counts 1) and a handful of carriers has a lumpy null that a bell curve misjudges precisely in the
tail. The resulting p-values are corrected with **Benjamini–Hochberg** at `FALSE_DISCOVERY_RATE`
(0.05); `rankByRatio` and `rankByFavouriteIndex` gate on `elevationIsReal`,
`rankReliable` and `rankVariable` on `clusteringIsReal`.

`NULL_SAMPLES` is load-bearing, not a tuning knob: with S shuffles the smallest observable p-value
is 1/(S+1), and BH's rank-1 threshold here is 0.05/173 ≈ 0.00029. At 2 000 shuffles **no tag could
pass however real it was**, which would look like a finding rather than the measurement artefact it
is. At 10 000 the floor (0.0001) clears the threshold by a factor of only ~3, so a much larger
vocabulary would need more shuffles — counting only each artist's own tags (§8.0) is part of what
keeps the margin, since including derived tags tests 215 and halves it.

On the shipped roster **nothing clears the gate**, and the dialog says so rather than showing a
heading over nothing. The strongest tag is `synthpop` at p = 0.0028 (20 carriers) against that
0.00029 threshold, then `indietronica` at 0.0040 and `queer themes` at 0.0085; 16 tags clear
p < 0.05 uncorrected, where 173 × 0.05 ≈ 8.7 is what chance alone produces. That result is pinned in
`stats.test.ts` so a data change that produces real preferences fails loudly and gets looked at.
Each tag's uncorrected p survives on `TagStat.elevationP` precisely so these figures can be
re-measured after a retag rather than remembered.

### 8.3 Worlds, predictive power and isolation

- **`rankTasteWorlds`** delegates wholesale to `groupRoster` (`cloud-layout.ts`), which runs the
  first two steps of the map's layout without any geometry: genre scenes, then those agglomerated
  into ~√k families of related sound. Reused rather than reinvented so the 📊 dialog and the ☁️ map
  cannot disagree about the shape of one collection — a second clustering here would drift from the
  one the user can actually see. Descriptive, so ungated: which artists group together is a fact
  about their tags, with the tiers playing no part. On the shipped roster it yields 6 worlds over 38
  scenes, covering 233 of 239 artists; the 6 unclaimed are reported rather than forced into a
  family. Worlds are named by listing their own scenes — an invented label like "synth pop and
  friends" would be a guess dressed as a finding.

- **`measurePredictivePower`** predicts each artist's position from the mean of its qualifying
  tags' **leave-one-out** means — each tag's mean recomputed without the artist itself, so its own
  placement cannot vote for itself (qualification is `MIN_SUPPORT`; era tags never qualify) — then
  returns the Pearson correlation against the real placements, and its square.

  It is the **replacement for two removed sections** (`rankOutliers`, "More than the sum of their
  parts" / "Worth another listen") which ranked artists by their distance from that prediction. On
  the shipped roster those lists were simply the S tier and the E tier: averaging nine tag means
  regresses so hard to the roster mean that predictions span 0.18 tiers against an actual spread of
  1.28, leaving (position − prediction) a straight restatement of the tier — mean raw delta by tier
  ran S +3.20, A +2.24, B +1.21, C +0.25, D −0.76, E −1.70, a near-perfect line. A nearest-neighbour
  model over `pairwiseSimilarities` was tried as a rescue and reached r² ≈ 3.9%, still nothing.
  Reporting the measurement is the honest form of the same finding, and `stats.test.ts` pins
  r² < 0.1 on the real roster so that a data change making the tags genuinely predictive fails
  loudly rather than passing unnoticed.
- **`rankIsolation`** ranks both ends by `kin` — how many other ranked artists carry at least
  `KIN_SHARE` (½) of this artist's tags. A fraction rather than a fixed count, since tag counts
  vary widely from artist to artist (§3 sets no bound) and a flat threshold would make the
  sparsely-tagged look lonely for no reason but their sparseness. On the shipped roster
  it scores 53–55 at the crowded end and 0 at the lonely one, so it separates the lists as sharply
  as a similarity measure would **while meaning something a reader can check** — which is why it,
  and not the similarity, is the displayed figure.
  `kinship` — the mean of an artist's `ISOLATION_NEIGHBOURS` (3) closest similarities from the ☁️
  map's `pairwiseSimilarities` (`cloud-layout.ts`, reused rather than reinvented) — survives as the
  **tie-break**, which is load-bearing at the lonely end where many artists score 0 `kin` and only
  the finer measure can order them. It is never displayed: over a coherent roster it compresses into
  a narrow band near the top (0.83–0.99 on the shipped data), where a bare "0.84" would read as a
  strong match. `rarestTag` (the least-shared tag, eras excluded) is carried for both ends but
  rendered only on `distinctive`.

### 8.4 Eras, and tuning

**Eras stand apart.** `computeStats` partitions the aggregates on `isEraTag` (exported by
`tag-groups.ts`, the same decade-shape test the filter panel's grouping uses): era tags fill their
own chronological section (canonical tag order is already chronological for decade-shaped names) and
are withheld from every other list, the composition breakdown, the predictive-power measure, and the
rarest-tag annotation — being numerous, well-supported, and internally uniform, they would otherwise crowd out the
rest of the vocabulary.

The list lengths (`TAG_LIST_LIMIT` 10, `PREDICTOR_LIST_LIMIT` 6, `ARTIST_LIST_LIMIT` 6,
`COMPOSITION_PER_CATEGORY` 5) and the `MIN_SUPPORT`, `SPREAD_MIN_SUPPORT`, `MIN_CAMP_SIZE`,
`PRIOR_STRENGTH`, `ISOLATION_NEIGHBOURS`, `KIN_SHARE` and `FAVOURITE_SHARE` thresholds are exported constants in
`stats.ts` — **tunable, not contractual** (PRD §10 leaves them unspecified). `NULL_SAMPLES` and
`FALSE_DISCOVERY_RATE` are the exception — they set what the dialog is willing to call a finding,
and §8.2a explains why neither can be lowered casually.

### 8.5 Rendering

`stats-view.ts` groups the sections under thematic `<h3 class="stats-group-heading">` banners, since
a flat stack of sections is not navigable. Every row keeps the shared three-column grid
(`.stat-rows`, each row `display: contents`): a **lead cell**, the name with its parenthesised
annotation, and an optional gauge. The lead is either a `.stat-tier` pastel chip — reserved for rows
naming a real artist, tier, or span of tiers, per PRD §10.2 — or a `.stat-value` number holding
that list's sort key.

The signature section divides its rows by vocabulary category with a `.stat-subheading` spanning
every column (`grid-column: 1 / -1`), so all three categories share one set of column widths and
read as a single aligned table rather than three.

The **decades** section is not a row list at all (`.stat-rows.as-block` cancels the grid): `eraChart`
builds a column-per-decade volume panel and a ratio curve over one shared axis. Three encodings were
tried and discarded before it — a single bar coloured by the ratio (four of the eight decades are 1%
slivers with no room to show a colour), the same bar with a marker along its length (a second scale
on one axis), and two bars stacked in a row (`.stat-pair`, since removed: the reader had to rebuild
the curve from eight pairs by eye). Drawn left to right, the step across the ×1.00 baseline between
the 1990s and the 2000s becomes the finding rather than something to be inferred.

It is built from **HTML boxes, not one SVG**: labels then keep real CSS type sizes and the chart
reflows with the dialog, where a viewBox-scaled SVG would shrink its text to nothing on a phone. Only
the connecting polyline is SVG — stretched with `preserveAspectRatio="none"`, so its stroke needs
`vector-effect: non-scaling-stroke` to keep an even width. A `max-width: 640px` query steps the axis
labels down, since eight full decade names fill a phone-width dialog edge to edge.

The isolation sections take `.stat-rows.with-kin`, the same four columns
with the width moved from the bar into the name track (artist names are longer than tag names).

The predictor sections take a **four-column** variant (`.stat-rows.with-tier-range`): the spread
leads, since both lists are ordered by it, then a `.stat-tier-range` (one narrowed chip per end of
the span its carriers occupy, joined by a dash; a single chip when both ends agree) keeps its own
track so the chips stay aligned rather than drifting with the tag names. The spread is printed to
two decimals — at one, adjacent rows rounded to equal values and the ordering looked arbitrary.
Gauges are
`.stat-bar` (a 0-anchored fill, optionally with a `.stat-bar-tick` reference mark),
`.stat-diverge` (a fill growing from a centre line at ×1.00), `.stat-range` (a band plus dot), or
none.

**Every group of bars scales to its own largest member**, never to a theoretical maximum — see the
convention in `CLAUDE.md`. `shareBar` takes the true quantity plus an `of` (the group's largest) and
divides internally, so the label and tooltip are always drawn from the real value and a caller
cannot print the scaled fraction by mistake; a `tick` is scaled by the same factor so it stays in
place relative to the bars. `.stat-diverge` follows the same rule about its centre line via
`halfWidth`, and the decade columns and tier histogram compute their own maxima. The one gauge that
is *not* group-scaled is `.stat-range`, which is positioned by `positionFraction` over the tiers the
roster occupies — a shared yardstick is the point there, since the bands are read against each
other and against the board.

## 9. Image-enrichment tooling (`scripts/enrich-images.ts`)

A **dev-time** Node/TS script, run manually by the maintainer — **not** part of the app bundle.

- Reads `data/artists.csv`, and for each artist with a blank `ImageURL` (or all artists with
  `--force`), tries providers in this **fallback order**, stopping at the first success:
  1. **Apple Music** (iTunes Search → the artist page's `og:image`; a subject-correct catalogue
     match that avoids article-title name collisions, so it leads the chain).
  2. **MusicBrainz** (look up the artist, follow image relationships / Wikidata).
  3. **YouTube Music** (search page `og:image`, best-effort).
  4. **Wikipedia / Wikimedia** (REST summary thumbnail or Commons) — last, since title lookups are
     the most name-collision-prone (e.g. "Ra", "Stars", "Peaches").
- Writes the resulting `ImageURL` and records the winning provider in `ImageSource`. Each URL is
  passed through `toThumbnail()` (`scripts/thumbnail.ts`) to prefer a **smaller/thumbnail** form
  where the host supports it (Wikimedia → `Special:FilePath?width=`; Apple/mzstatic → a small
  square); unknown hosts are left unchanged.
- Politeness: sets a descriptive `User-Agent` and rate-limits requests (especially MusicBrainz /
  Wikimedia, which require it). The script is **idempotent** — re-running only fills blanks unless
  `--force` is passed. It **writes after each fill** so partial progress survives an interruption,
  using the same RFC-4180 serialiser as the app (§5).
- Rate-limit resilience: a `429`/`403` from a provider (Apple's iTunes Search throttles a large
  bulk run) triggers **exponential back-off and retry** — honouring `Retry-After` when present —
  rather than immediately falling through to a lower-priority provider. Three env vars tune this
  for big re-fetches: `ENRICH_DELAY_MS` (pause between artists, default 300), `ENRICH_MAX_RETRIES`
  (retries before giving up on a provider, default 3), and `ENRICH_BACKOFF_MS` (base back-off,
  doubled per retry, default 8000). A throttled bulk re-fetch is best run with a raised
  `ENRICH_DELAY_MS` (e.g. `ENRICH_DELAY_MS=5000 npm run enrich`).
- **Flags:** `--force` (re-fetch already-filled rows in bulk mode); `--artist "<name>"` (process
  just one artist, always re-fetching it); `--disable <keys>` (comma-separated provider keys to
  skip — used to retry an artist whose previously chosen provider gave a broken image).
- **`scripts/add-artist.ts`** (`npm run add-artist -- "<name>"`) adds a new artist as unranked
  (blank Tier/ImageURL/ImageSource/Tags) in sorted position (`compareArtistNames`, keeping the CSV
  sorted by name), then invokes the enrichment above for just that artist. Refuses a duplicate
  name. Tags are **not** auto-populated — fill the `Tags` column by hand afterwards, following the
  conventions in §3 and the evidence from §9a.

## 9a. Tag research (`scripts/tag-research.ts`)

`npm run tag-research -- "<artist>"` (or `--all`, optionally `--json`) prints what outside sources
say about an artist, so tagging rests on evidence rather than recollection. It **writes nothing** —
the tags are still a judgement, made from what it shows.

The sources are deliberately of two kinds, because they fail differently:

| Source | Kind | Supplies |
| --- | --- | --- |
| MusicBrainz artist record | authoritative, structured | `country`, `begin-area` (the city), `type` (person/group), `life-span` — this settles the region and era tags |
| Wikipedia infobox | authoritative, edited and cited | `origin`, `genre`, `years_active`, members |
| MusicBrainz tag votes | crowd folksonomy | scene and genre names with vote counts — richer and noisier |
| Last.fm tag page | crowd folksonomy | the same, from listeners |

Nothing published supplies the Pandora-style **musical quality** tags (vocal style, mood, lyrical
bent), so those remain a listening judgement informed by the rest.

Details worth knowing before changing it:

- **MusicBrainz throttles to one request per second**, so requests are spaced
  (`TAG_RESEARCH_DELAY_MS`, default 1100) and a whole-roster run takes a few minutes.
- **Wikipedia is queried by exact title first**, then `"<name> (band)"`, and only then by search.
  A plain search for a band reliably lands on a band *member* — "Talking Heads" scored David
  Byrne. A candidate page with neither a `genre` nor an `origin` infobox field is rejected as the
  wrong kind of article rather than reported as an artist with no genres.
- **The infobox is located by brace matching**, and citations are stripped *self-closing first*.
  Both guard the same failure: reading fields off the whole article with one regex let First Aid
  Kit's `genre` run to the end of the page and return 200 chart positions, because
  `<ref name="x"/>` also matches the opening tag of the paired-`<ref>` pattern and deleting pairs
  first swallowed the infobox's closing braces.
- **Last.fm has no key-free API** and begins answering `406` partway through a bulk run whatever
  User-Agent is sent, so it is a bonus leg: after three consecutive refusals the run stops asking.
  The crowd evidence that matters is MusicBrainz's, which is reliable.

## 10. Build, CI & deploy

- **Dev:** `vite` (dev server with HMR).
- **Build:** `npm run build` (`tsc --noEmit && vite build`) → static assets in `dist/`.
  `vite.config.ts` sets **`base: './'`** (relative asset URLs), so the bundle works under any GitHub
  Pages project subpath (`https://<user>.github.io/<repo>/`) without hard-coding the repo name.
- **CI:** `.github/workflows/ci.yml` runs on every push to the default branch and on pull requests:
  `npm ci` → `npm run typecheck` → `npm test` → `npx prettier --check .` (a non-rewriting check, vs.
  the `--write` of `npm run format`). Concurrent runs for the same ref are cancelled.
- **Deploy:** `.github/workflows/deploy.yml` runs on push to the default branch (or manual
  `workflow_dispatch`): install → build → `configure-pages` → `upload-pages-artifact` (`dist`) →
  `deploy-pages`. **Build artefacts are not committed**; the Action publishes `dist/` to Pages.

## 11. Testing & quality

- **Vitest** unit tests for the pure logic: CSV parse/serialise round-trip (incl. quoting) in
  `src/csv.test.ts`, the overlay/diff/export in `src/store.test.ts` (run under the `jsdom`
  environment for `localStorage`), the weighting/selection in `src/random.test.ts`, the
  canonical name ordering in `src/sort.test.ts`, the ☁️ map's similarity model and layout in
  `src/cloud-layout.test.ts` (determinism, bounds, and cluster geometry — on synthetic rosters
  and as a smoke test over the real one), and the 📊 statistics aggregation in
  `src/stats.test.ts` (scoring/banding, minimum support, ranking ties, leave-one-out outliers —
  likewise on synthetic rosters and the real one).
- **The tag vocabulary is tested as data** (`src/tag-registry.test.ts`): parsing and derivation on
  synthetic registries, then the §3a invariants asserted against the shipped files — every roster
  tag is registered, every `Derived` value resolves, no cycles, no genre deriving a region,
  rows canonically sorted. These are what stop `data/artists.csv` and `data/tags.csv`
  drifting apart as the roster is retagged; the "Other" group being empty is asserted rather than
  assumed.
- Type-checking via `tsc --noEmit`; formatting via Prettier; all enforced in CI (§10). The
  enrichment, add-artist and tag-research scripts run under **tsx**. Exact commands are listed in
  [CLAUDE.md](../CLAUDE.md).
