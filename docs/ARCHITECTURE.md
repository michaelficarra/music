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
│   └── artists.csv          # Source of truth for the artist roster, tiers, and images
├── scripts/
│   ├── enrich-images.ts     # Dev-time tool that fills in image URLs (see §9)
│   ├── add-artist.ts        # Append an unranked artist to the CSV, then enrich them
│   └── thumbnail.ts         # toThumbnail(): prefer smaller image forms (see §9)
├── src/                     # Application source
│   ├── main.ts              # Entry point: populate dropdowns, build board, wire events
│   ├── types.ts             # Core domain types (Tier, Slot, Artist)
│   ├── csv.ts               # RFC-4180 CSV parse/serialise (see §3)
│   ├── data.ts              # Embeds data/artists.csv at build time → the static baseline
│   ├── store.ts             # Local-storage overlay + diff (Reset/Save) logic
│   ├── board.ts             # Renders tiers + unranked area, wires SortableJS
│   ├── thumb.ts             # createThumb(): artist thumbnail/placeholder, shared by board + map
│   ├── random.ts            # Weighting schemes + weighted random pick (see §6)
│   ├── filter.ts            # matchesAllTags(): the 🎲 tag filter's matching rule (see §6)
│   ├── tag-groups.ts        # groupTags(): vocabulary categories for the filter panel (see §6)
│   ├── cloud-layout.ts      # Tag-similarity model + force layout for the ☁️ map (see §7)
│   ├── cloud.ts             # The ☁️ map dialog: renders the layout, pan/zoom (see §7)
│   ├── stats.ts             # Tag/tier aggregation behind the 📊 statistics (see §8)
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
- **Tags:** descriptors drawn from a shared controlled vocabulary, joined with `;` (no
  surrounding spaces), e.g. `pop punk;anthemic choruses;male vocals;2000s;side project`. Casing
  is natural: proper nouns and acronyms keep their capitals (`Warped Tour`, `EDM`, `J-pop`),
  everything else is lowercase. Each artist carries 5–10 tags spanning genre(s), Pandora-style
  musical qualities (vocal style, instrumentation, mood, lyrics), the peak decade(s)
  (`1950s`…`2020s`, typically 1–2), and notable aspects (e.g. `side project`, `comedy`,
  `British`). Conventions: no commas/semicolons/quotes inside a tag (keeps the field unquoted),
  no duplicates within an artist, and every tag should be shared by **at least two** artists —
  reuse an existing tag rather than minting a near-synonym. The app parses the field into
  `Artist.tags` (blank → `[]`) for the 🎲 tag filter (§6); tag matching is **case-sensitive**, so
  keep each tag's spelling identical everywhere it appears.
- The file holds the full artist roster (a few hundred rows). It may be edited by hand or by the
  enrichment script (§9).

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

- **Cutoff** — which slots are eligible. For a ranked cutoff the eligible tiers are S down to the
  cutoff inclusive (`eligibleTiers`); the special `unranked` cutoff ("X only") instead draws from
  the unranked pool alone, ignoring intensity.
- **Intensity** — how a candidate's selection weight is derived from its tier:
  - Each ranked tier has a base **Fibonacci / planning-poker weight** (`FIB_WEIGHT`): `S 13, A 8,
    B 5, C 3, D 2, E 1, F 1`.
  - `unweighted` → every eligible artist has weight 1 (uniform).
  - `weighted` → weight is `FIB_WEIGHT[tier]`.
  - `heavily` → weight is `2 × FIB_WEIGHT[tier]` (widening the gap between tiers).

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
it with one checkbox per tag from `data.ts`'s `allTags` (the sorted distinct tags in the roster),
anchors it under the toolbar's `#filter` button on each open (popovers are fixed in the top layer,
so the UA default would centre it), keeps the button's `no filters` / `N filters` label current,
and persists the selection (§5). The checkboxes are **grouped by vocabulary category** via
`src/tag-groups.ts` (`groupTags`): genres, musical qualities, eras (matched by the `/^\d{4}s$/`
shape rather than a list), and notable aspects. The CSV stores tags flat, so the category lists
live in that module; a tag missing from them lands in a trailing **Other** group rather than
disappearing — when minting a brand-new tag in the CSV, add it to its category there too. Dimming
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
     least 4 artists. Artists left unclaimed may be **adopted** — but only on genre evidence
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

## 8. Tag statistics (`src/stats.ts`, `src/stats-view.ts`)

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
- **Scoring.** Tiers map linearly onto scores (`tierScore`): S 7 down to F 1; unranked artists
  are excluded everywhere. A mean score is displayed via `tierBand`/`tierLabel`: each tier owns
  the unit of the scale centred on its own score, split into thirds — the middle third reads as
  the bare letter, the outer thirds lean `+`/`−` (6.5 → `S−`; clamping makes `S+`/`F−`
  impossible). Bars and gauge markers share `positionFraction` = (score − 1) / 6 — the full
  tier axis, F at the track's left end and S at its right. The favourite/least-favourite
  lists further stretch their bar widths between the lowest and highest entries shown (a
  view-level rescale in `stats-view.ts`), and every bar's tooltip states its fill percentage.
- **Per-tag aggregates** (`computeTagStats`): the mean, population standard deviation,
  lowest/highest placement, and two **camp sizes** (carriers at least a full tier above / below
  the mean) of each tag's ranked carriers' scores, dropping tags with fewer than `MIN_SUPPORT`
  (3) of them. The favourite/least-favourite lists (`rankTags`) order by mean and are
  **non-overlapping** — the least-favourites draw from the remainder, so few qualifying tags
  shorten that list rather than letting it mirror the favourites; both lists run descending
  (the second ends on the very worst), so together they read as one continuous descent. The
  worst-predictors list (`rankWorstPredictors`) wants genuine division: it considers only tags
  with at least `SPREAD_MIN_SUPPORT` (5) carriers and a non-empty camp on **both** sides,
  ranked by spread × the smaller camp's share of the carriers — far-apart, evenly-matched
  camps beat a lone dissenter however distant. Its mirror, the best-predictors list
  (`rankBestPredictors`), ranks the same floor's tags by **ascending** spread (ties to the
  better-evidenced tag), surfacing the tags that pin a placement down. The dialog renders both
  lists' entries as a range gauge — a band spanning the carriers' full range with a dot at the
  mean — in place of a bar, annotated with camp sizes (worst) or ±σ (best). Ties break by
  carrier count then canonical tag name. Category favourites (`categorySuperlatives`) take the
  best mean per `tag-groups.ts` category, skipping "Other".
- **Eras stand apart.** `computeStats` partitions the aggregates on `isEraTag` (exported by
  `tag-groups.ts`, the same decade-shape test the filter panel's grouping uses): era tags fill
  their own chronological section (canonical tag order is already chronological for
  decade-shaped names) and are withheld from the ranked lists, the superlatives, and the
  outlier prediction model below — being numerous, well-supported, and internally uniform,
  they would otherwise crowd out the rest of the vocabulary.
- **Outliers** (`rankOutliers`): an artist's predicted score is the mean of its qualifying tags'
  **leave-one-out** means — each tag's mean recomputed without the artist itself, so its own
  placement cannot vote for itself (qualification is the same `MIN_SUPPORT`, leaving at least
  two other placements per tag; era tags never qualify, as above). Guilty pleasures / black
  sheep are the artists placed **furthest above / below** their prediction — the delta's sign
  picks the side, its size the order (guilty pleasures run furthest-above first; black sheep
  end on the furthest below, descending like the least-favourite tags); artists with no
  qualifying tags are not judged. The
  dialog draws each entry as a ring at the prediction joined to a dot at the artist's actual
  score by a thin connector — the delta the list is ranked by.
- The list lengths (`TAG_LIST_LIMIT` 10, `PREDICTOR_LIST_LIMIT` 6, `OUTLIER_LIST_LIMIT` 6)
  and the `MIN_SUPPORT` and `SPREAD_MIN_SUPPORT` thresholds are exported constants in
  `stats.ts` — **tunable, not contractual** (PRD §10 leaves them unspecified).

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
- **Flags:** `--force` (re-fetch already-filled rows in bulk mode); `--artist "<name>"` (process
  just one artist, always re-fetching it); `--disable <keys>` (comma-separated provider keys to
  skip — used to retry an artist whose previously chosen provider gave a broken image).
- **`scripts/add-artist.ts`** (`npm run add-artist -- "<name>"`) adds a new artist as unranked
  (blank Tier/ImageURL/ImageSource/Tags) in sorted position (`compareArtistNames`, keeping the CSV
  sorted by name), then invokes the enrichment above for just that artist. Refuses a duplicate
  name. Tags are **not** auto-populated — fill the `Tags` column by hand afterwards, following the
  conventions in §3 (prefer existing tags from the file over new ones).

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
- Type-checking via `tsc --noEmit`; formatting via Prettier; all enforced in CI (§10). The
  enrichment and add-artist scripts run under **tsx**. Exact commands are listed in
  [CLAUDE.md](../CLAUDE.md).
