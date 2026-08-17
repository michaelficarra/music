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
│   ├── types.ts             # Core domain types (Tier, BaseTier, Slot, Cutoff, Artist)
│   ├── csv.ts               # RFC-4180 CSV parse/serialise (see §3)
│   ├── data.ts              # Embeds data/artists.csv at build time → the static baseline
│   ├── store.ts             # Local-storage overlay + diff (Reset/Save) logic
│   ├── board.ts             # Renders rank blocks + unranked area, wires SortableJS
│   ├── thumb.ts             # createThumb(): artist thumbnail/placeholder, shared by board + map
│   ├── random.ts            # Weighting schemes + weighted random pick (see §6)
│   ├── filter.ts            # matchesTags(): the 🎲 tag filter's matching rule (see §6)
│   ├── tag-registry.ts      # Embeds data/tags.csv; withDerivedTags(), broadTags(), isSoundTag() (§3a, §3b)
│   ├── tag-groups.ts        # groupTags(): vocabulary categories for the filter panel (see §6)
│   ├── cloud-layout.ts      # Tag similarity, scene/world grouping + layout for ☁️ (see §7)
│   ├── cloud.ts             # The ☁️ map dialog: renders the layout, pan/zoom, 🔍 (see §7, §7a)
│   ├── search.ts            # The ☁️ map's 🔍: fuzzy matching + spotlight resolution (see §7a)
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
| `Tier`        | One of the 19 ranked tiers — `S+`, `S`, `S-` … `E+`, `E`, `E-`, `F` (F has no variants) — or **blank** for unranked. ASCII `+`/`-`, never a typographic minus. Anything else reads as unranked (`isTier` in `data.ts`). |
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
    four tags gets four; one warranting thirty gets thirty. (Today the roster runs about 8–21.)
  - **A tag must be representative, not merely true.** A trait resting on a single album, a one-off
    collaboration, or a phase the artist is not identified with does not go on the row: Lady Gaga
    made two jazz records with Tony Bennett and is not tagged `jazz`, while Vulfpeck is. §9a's
    research script is what separates the two — MusicBrainz **vote share** measures how much of an
    artist's identity a genre actually is, where a Wikipedia infobox lists every genre ever touched
    and so cannot on its own justify a tag.
  - **Rows carry only the most specific tag in each direction — never one that another implies.**
    A row saying `pop punk` does not also say `punk rock`, `pop rock` or `rock`; a row saying
    `Swedish` does not also say `Scandinavian` or `European`. The rest are derived at
    load time from the registry, so writing them out too would be redundant and could contradict it.

  Conventions: no commas/semicolons/quotes inside a tag (keeps the field unquoted), no duplicates
  within an artist. Tag matching is **case-sensitive**, so keep each tag's spelling identical
  everywhere it appears. `src/data.ts` parses the field into `Artist.ownTags` (blank → `[]`), those
  plus everything derived from them into `Artist.tags`, that minus the too-broad tags into
  `Artist.specificTags`, and that restricted to genres and musical qualities into
  `Artist.soundTags` (§3b, §4).
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
without any of it being written on 284 artist rows by hand.

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

### 3b. Too-broad tags, and the four tag sets

Deriving the hierarchy creates a second problem: an artist ends up carrying `rock`, which four
fifths of the roster also carries. A tag that covers most of the collection cannot describe anyone
within it — it is excellent for *finding* artists and useless for telling them apart — so each
artist carries four tag sets, each a subset of the one above it:

| Set | Contents | Read by |
| --- | --- | --- |
| `ownTags` | exactly what the CSV row says (§3) | the Save export; the 📊 composition list |
| `tags` | `ownTags` + everything derived from them | the 🎲 **filter** — `European` must find the Swedes |
| `specificTags` | `tags` minus the too-broad ones | 📊 statistics, card tooltips |
| `soundTags` | `specificTags` restricted to genres and musical qualities | the ☁️ **map**, and the two 📊 sections that report its grouping |

The 📊 dialog's composition list ("What your list is made of") reading `ownTags` is explained in
§8.0; the map's narrower set, below.

**`soundTags` (`isSoundTag`, `tag-registry.ts`) is what the map means by likeness.** The map exists
to show which artists sound alike, and the three excluded categories do not answer that question
while being numerous enough to drown out the ones that do: `region`, `era` and `aspect` together are
**a third of every tag the roster carries** (1 276 of 3 630 `specificTags` entries), and a single
era sits on hundreds of artists at once. Counting them, the median similarity between two artists
picked at random from the roster is **0.681** — the model had almost no room left to say that two
artists are *not* alike. On `soundTags` it is **0.402**. Two second-order effects go with it: while
regions co-occurred with genres, one country's scene bled into the co-occurrence profile of every
genre played there; and a scene defined by an origin rather than a sound (`J-pop`) was stranded as
a world of its own instead of sitting with the music it resembles.

The restriction is by **registry category**, not by hand: a tag the vocabulary does not know is not
a sound tag, which is safe because an unregistered roster tag already fails the tests (§3a). It is
applied *after* the breadth rule, so a genre on a fifth of the roster is still dropped — failing to
distinguish and failing to describe the music are two independent reasons to leave a tag out.

Everything else keeps reading `specificTags`. A card tooltip describes the artist in front of you,
and where an artist is from belongs in that description; only the features that *group* artists by
resemblance narrow to the sound.

`broadTags` (`tag-registry.ts`) marks a tag too broad when it covers more than `BROAD_PREVALENCE`
(a fifth) of the roster. **Breadth is failure to distinguish, and nothing else** — in particular it
does not matter whether a human wrote the tag or the hierarchy supplied it. `male vocals` is
hand-written on every one of its carriers and still splits the roster 7:3, so it narrows nothing
and goes; `rock` is written by nobody and goes for the same reason. On the shipped roster the rule
drops 21 tags: `rock`, `pop`, `punk rock`, `alternative rock`, `pop rock`, `pop punk`, `electronic`,
`experimental`, `American`, `North American`, `European`, `male vocals`, `female vocals`,
`catchy hooks`, `anthemic choruses`, `distorted guitars`, `guitar-driven`, `angsty lyrics`,
`melancholy mood`, `atmospheric textures`, `solo act`.

A fifth is a real cut rather than a nominal one: it takes `pop punk`, the collection's largest
genre. That is the intent — a genre covering a fifth of the collection is what the collection *is*,
so it cannot distinguish within it.

**Era tags are exempt.** They are a separate axis with a section of their own (§8.4) whose whole
subject is which decades the collection concentrates in; "169 of your artists are from the 2010s"
is that section's finding, not noise to filter out of it. Nothing compares an era against a genre,
so their prevalence never crowds another list.

Breadth is measured **over the roster, not declared in `data/tags.csv`**, because it is a fact about
this collection rather than about the vocabulary: `metal` is an umbrella on a roster of pop punk
bands and a real distinction on one that is half metal. It moves as the roster does, with nothing to
keep in sync. Declaring it per-tag in the vocabulary was considered and rejected for that reason, as
was deriving it from the hierarchy (anything another tag in use derives), which removes 104 tags
including `emo` and `indie pop` — having a sub-genre does not make a tag broad.

**Known limitation.** A pure prevalence cut removes the largest umbrellas but leaves the next rank
of them — `California`, `Western European`, `New York State`, the connective tissue (§3a) that no
row states. This no longer shows in the composition list, which reads `ownTags` (§8.0), but those
tags still reach the card tooltips and the ☁️ map's similarity. Adding a second, disjunctive test
(also call a tag broad when hardly any of its carriers were given it) would remove them; it is a
one-line change in `broadTags` if they are judged to be doing harm there.

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
    { "version": 1, "assignments": { "Radiohead": "S-", "Nickelback": "E", ... } }
    ```
    `assignments` is a sparse map of **name → tier** overrides. Only tier is stored (no within-tier
    order, per PRD §5). Writes happen immediately on every drop. Adding the `+`/`-` tiers only
    widened the set of accepted values, so arrangements saved before they existed still load and
    `version` stays `1`.
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
- **Board DOM:** the board is built from **blocks**, not rows — one `.tier-row[data-base]` per base
  rank plus one for the unranked pool. Each holds a single `.tier-label` (the rank's letter and a
  `.tier-count` summing its lanes) and a `.tier-lanes` column of `.tier-list[data-slot]` elements,
  one per tier of that rank, best first (`addBlock` in `board.ts`). Keying the block on the *rank*
  is what lets one CSS rule paint a rank's three lanes in its pastel, and what makes the picker's
  cutoff divider — reparented after a whole block — unable to land inside a rank. Lanes carry no
  label of their own: their order says which is which, `.tier-list + .tier-list` rules them apart,
  and `.tier-list:empty` collapses an unused one so twelve empty rows cost a band each rather than
  a card height each (PRD §3, §11).
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

- **Cutoff** — which slots are eligible (typed `Cutoff = BaseTier | typeof UNRANKED | typeof ALL`;
  the `ALL` sentinel is a picker-only value, never a stored `Slot`). A cutoff is a **base rank**
  rather than any tier, so it can never split a rank's three rows apart: the eligible tiers run from
  the top of the board down to `lowestVariant(cutoff)` inclusive (`eligibleTiers`), which is why
  "C+" reaches `C-`. The special `unranked` cutoff ("unranked only") instead
  draws from the unranked pool alone, ignoring intensity; the `ALL` cutoff ("unrestricted") draws
  from the **whole roster** — ranked artists keep their tier weight and unranked artists are weighted
  as the **lowest tier anyone currently occupies** (`lowestOccupiedTier`, not a hard-coded F, which
  is usually empty and weighs a quarter of an E), so intensity still applies.
- **Intensity** — how a candidate's selection weight is derived from its tier:
  - Weights come from the **power law** `tierWeightScale(exponent)` (`types.ts`), which raises a
    tier's *position* (S+ 7⅓, S 7, S- 6⅔ … F 1) to a fixed exponent. Its proportional steps
    therefore narrow towards the top — the S/A distinction is the finest the tier list draws
    between whole ranks, the E/F one the coarsest — while its absolute steps still widen.
  - `unweighted` → every eligible artist has weight 1 (uniform).
  - `weighted` → `TIER_WEIGHT`, i.e. `position²`: `S 49, A 36, B 25, C 16, D 9, E 4, F 1`, with a
    variant a third of a rank off its base (`S+ 53.8, S- 44.4`). The 📊
    statistics (§8) share it, so the two features value a tier identically — variants included:
    a promotion from S to S+ shifts the picker's odds exactly as it shifts the statistics.
  - `heavily` → `HEAVY_TIER_WEIGHT` (`random.ts`), i.e. `position³`: `S 343, A 216, B 125, C 64,
    D 27, E 8, F 1` (`S+ 394.4`).

  The intensities differ by **exponent, never by a multiplier**: roulette normalises by the pool
  total, so scaling every tier by a constant leaves the odds untouched. An earlier `heavily` was
  `2 × TIER_WEIGHT` and consequently drew identically to `weighted`.

  These curves are the concrete realisation of the "probability curve" PRD §8 leaves unspecified;
  treat the exact numbers as tunable, not contractual.

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

- **Tag set** (§3b): every step below reads an artist's **`soundTags`** — the genres and musical
  qualities among its specific tags. The map's whole claim is "these artists sound alike", so a
  shared country or decade must not contribute to it. Because the excluded categories are a third
  of the roster's tags, this is not a refinement at the margin: it halves the median similarity
  between two random artists (0.681 → 0.402), which is the room the model needs to distinguish
  anyone from anyone.
- **Similarity model** (`pairwiseSimilarities`): each sound tag gets a **co-occurrence profile** — a
  vector of how often it appears alongside every other across the roster, L2-normalised so tags
  compare by the *shape* of the company they keep rather than their raw frequency. An artist's
  vector is the **IDF-weighted sum** of its tags' profiles (rare tags are more discriminative
  than ubiquitous ones), and artist-to-artist similarity is the **cosine** of those vectors.
  Sharing a tag contributes fully; carrying *related* tags contributes partially — including
  near-synonyms that rarely share an artist (curators pick one or the other) but keep the same
  company, e.g. two punk subgenres both co-occurring with `punk rock` and `melodic hardcore`.
  Relatedness is thus **data-driven** — `tag-groups.ts` names the clusters (below) but plays no
  part in how similar two artists are; its categories (all of "Genres", say) are far too broad
  for that.
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
     - Scenes are founded on the genres within **`soundTags`** (§3b), like the similarity model
       above. Derived genres belong: a band written down as `emo pop` really is in the pop punk
       scene, and reading only its stated tag scatters one scene across its sub-genres. Too-broad
       ones do not — every rock band derives `rock`, so an umbrella founds one huge meaningless
       ring and makes the adoption test below unanimous. Founding on the full derived set gave 46
       scenes with **every** artist adopted; on the narrowed set it gives 41 scenes with 1 loner.
       (The genres are the same either way — `soundTags` and `specificTags` differ only outside
       that category — so **the rings themselves did not move when the map narrowed to sound**;
       what changed is which rings neighbour which, and the order of members within each.)

     Artists left unclaimed may be **adopted** — but only on genre evidence
     (sharing a genre tag with members; mean ≥ 0.5), since counting ubiquitous musical qualities
     adopted everyone however poor the fit; artists clearing the bar nowhere stay unclustered,
     on the rim (PRD §9: membership is never forced). Within a cluster, members are ordered by
     mean similarity to their fellows — archetypes first.

     **Every member records why it is there** (`joinedBy`, keyed by roster index so it survives
     that reordering): the founding tag for the carriers who founded the cluster, and for an
     adoptee the genres it shares with them — commonest first, reduced to the most specific by
     `redundantTags` (§3a). A cluster's **name** (`tags`, formatted by `sceneName`) is the
     founding tag followed by each adoptee's *leading* shared tag: `progressive metal + prog
     rock`. This is not decoration. Adoption admits artists who do not carry the founding tag —
     Nobuo Uematsu into `progressive metal`, because `progressive metal` derives `prog rock`
     derives `art rock` and those are his only two genres — so the founders' tag alone asserts
     something false about part of the membership, on the ☁️ ring (PRD §9) and in 📊's worlds
     (§8.3) alike. Two rules make the name work:
     - **The reduction is against the other reason tags, never against the founding tag.**
       `progressive metal` derives `prog rock`, so reducing against it would erase the very tag
       that explains the adoption and leave the name unchanged. Adoptions whose evidence is an
       *ancestor* of the founding tag are exactly the ones the name fails to describe.
     - **The name carries each adoptee's leading tag only**, not its whole list; the tooltip
       prints the full list per member. Otherwise one artist stretches `death metal + metalcore`
       to `+ beatdown hardcore`.

     **Rejecting ancestor-only adoptions was measured and is wrong.** The rule "an adoptee whose
     every shared tag is one the founding tag derives is broader than the scene, not part of it"
     sounds principled and disqualifies 3 of the roster's 11 adoptions. Re-running the partition
     under it moves Enya from `folk punk` to **`country`**, Nobuo from `progressive metal` to
     **`math rock`**, and strands Angels & Airwaves as the roster's only loner. Every outcome is
     worse than the one it replaces, and Nobuo's is not fixed but relabelled. Name the cluster
     honestly instead; do not tighten the membership rules.
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
     separation (PRD §9). The families are ranked **largest first** (`rankFamilies`, ties by the
     leading scene's tag) and each cluster carries its family's rank as `CloudCluster.family`;
     `groupRoster` ranks through the same function, so the map's *n*th family and 📊's *n*th
     world are the same neighbourhood, and the renderer can tint by rank alone.
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
  (`NODE_SPACING`) exactly — density is by construction, not tuning. The cluster markers are soft
  radial gradients rather than outlines, in **two layers** appended **before** the nodes (so they
  paint behind):

  - the **haze** — every cluster's halo, three ring radii across and free to overlap its
    neighbours', which is what makes a field of discs read as one cloud. It is **a single
    `<canvas>` in screen space**: a viewport-sized sibling *before* the plane (so it lies behind
    everything), redrawn by `drawHaze` against the current `world × scale + offset` whenever the
    view moves, coalesced to one redraw per frame and culled to the haloes actually on screen.
    Two earlier arrangements are why, and neither should be reinstated:
    - **As ~50 overlapping gradient elements on the plane** it was the map's one expensive layer
      (a zoom sweep's median frame 19.9 ms against 16.7 ms without it, p95 31.7 ms against 17.6 ms)
      and **Chromium flashed while zooming**, re-tiling the world mid-gesture, where WebKit did not.
      `will-change: transform` on the plane is not the fix and was tried: promoting a world this
      large to one compositor layer makes Chromium fail to raster it at all, and the haze comes back
      as torn bands of stale tile.
    - **As one texture pinned to the world** the zoom cost vanished, but any texture big enough to
      span the world is coarse enough to show its own texel grid once magnified — and at the 4×
      cap none is big enough. Drawing per view sidesteps the trade: the picture is always made at
      the resolution it is shown at, and the whole redraw measures ~0.7 ms.
  - the **core** — the `.cloud-ring` element itself, at the cluster's exact geometric radius, over
    the haze, carrying the `title` tooltip that names the genre and members. Drawn a little lighter
    than the haze (peak 12% against 15%), it thickens the light towards each heart.

  Only the cores take the pointer, and step 3's packing makes them **disjoint**, so overlapping
  light can never mean an overlapping hit region: a hover always answers with the cluster it is
  inside. The ring's `::before` (`z-index: -1` inside the plane's isolated stacking context,
  `pointer-events: none`) is haze-shaped but transparent until the cluster is spotlit, when it
  blooms in the accent — the canvas cannot fade one cluster at a time, and a handful of lit
  gradients is exactly the cost that made fifty untenable. The canvas takes `spotlit` on itself,
  not being on the plane. Loners get a halo of both layers, its core half a spacing unit to match
  the layout's `LONER_CLEARANCE` (tooltip: the artist's own, as on the node above it).

  Both layers are drawn in the same light: `glowColour` takes the family's hue from `FAMILY_TINTS` —
  the eight **Solarized** accent hues, indexed by `CloudCluster.family` and ordered warm/cool
  alternately so adjacent ranks are never adjacent hues — and dilutes it with white
  (`TINT_STRENGTH`, 60%). `drawHaze` fills with that value directly and the ring gets it as
  `--glow`, which the CSS mixes down to each stop's alpha with `color-mix`; deriving it once in
  script is what stops the two layers describing the same family differently. A loner's halo leaves
  `--glow` at its white default, having no family to name. Pan and zoom never touch the nodes: both are a single
  `translate(…) scale(…)` transform on the plane. Wheel events zoom **anchored on the cursor**
  (exponential in deltaY, normalised for line-mode deltas; trackpad pinches arrive as
  ctrl+wheel and work unchanged), clamped between half the fitted overview and a 4× close-up.
  Dragging and touch pinching share one pointer-capture handler over up to two tracked
  pointers: each move re-anchors the view so the world point under the pointers' midpoint
  follows it, scaled by the ratio of their separation — with one pointer that reduces to a
  plain pan, with two it is a pinch zoom (same scale clamp as the wheel). Panning is clamped
  so part of the world square always stays on screen. Every view change redraws the haze; the
  `.gliding` reveal is a CSS transition the canvas cannot see, so `glide` runs a frame loop that
  reads the plane's *animated* matrix back off the element and draws against that until the class
  is dropped. A window resize redraws it too — the plane needs no such help, being in world px.
  The dialog opens via `showModal()` (Esc/close requests are native); being full-screen there
  is no visible backdrop, so no `closedby` light-dismiss — the ✕ button calls `dialog.close()`.
  While it is open, the page's own scroll bar is suppressed
  (`body:has(#cloud-dialog[open])`). The view re-fits to the whole cloud on every open.

### 7a. Map search (`src/search.ts`)

The map's 🔍 (PRD §9.1) follows the same split once more: the matching rules and what a result
means are pure and unit tested in `src/search.test.ts`; `cloud.ts` renders the result; the field,
its inline ✕ and the suggestion listbox are static shell in `index.html`, grouped with the ✕ in a
`.cloud-tools` corner container.

- **The corpus** is one entry per artist plus one per **sound tag** (`buildSearchIndex`, reading
  `data.ts`'s `allSoundTags`). Sound tags rather than `allTags`, and this is the one place the
  four tag sets (§3b) are chosen *against* the "finding is what the broad set is for" rule: the
  spotlight's answer is a *place on this map*, and a region, decade or too-broad genre names no
  cluster to point at. Each entry's fold is precomputed, so a keystroke is one scoring pass rather
  than a `String.normalize` over the roster.
- **Folding** (`foldForMatch`) is NFD + diacritic strip + lowercase, plus a small table for the
  letters whose mark is part of the code point (`ø`, `æ`, `œ`, `ß`, `ł`, `đ`, `ð`, `ħ`). The table
  exists because `compareArtistNames` (`sort.ts`) already treats those as equal to their plain
  form under `sensitivity: "base"`, and the app must not hold two different opinions about which
  strings are the same string. Letters base sensitivity keeps distinct (`þ`, `ı`, `ŧ`) are absent.
- **Scoring** (`fuzzyMatch`) is subsequence matching in **five tiers 200 apart** — exact, prefix,
  word-start, substring, scattered — with bounded refinements (length share, word starts, gap
  penalty, earliness) that only reorder *within* a tier. The bounds are chosen so the tiers cannot
  overlap: an intact match must never lose to a lucky scattering of the same letters. Deliberately
  **no edit distance**: tolerating a wrong letter, over a roster where names differ by one, would
  produce confident nonsense. `searchTargets` applies the `MIN_QUERY_LENGTH` floor (shared with the
  view as `isSearchable`, so "typed too little" and "found nothing" stay distinct states), then
  sorts by score, carrier count, and `compareArtistNames` for a stable order.
- **`resolveSpotlight(layout, artists, entry)`** turns a chosen entry into the artists and the
  cluster *indices* to light, reading the `CloudLayout` the plane was drawn from rather than
  regrouping the roster — the spotlight can therefore never disagree with the rings beneath it. An
  artist entry resolves to itself and its cluster (none, if it is a loner); a tag entry to every
  carrier and every cluster holding one.
- **Rendering** (`cloud.ts`): the layout and three element registries (`nodeByName`, `haloByName`,
  `ringByCluster`) are kept on the closure when the plane is built — identity lives in those maps,
  not in `data-` attributes, since nothing outside the module addresses the nodes. `applySpotlight`
  toggles `spotlit` on the plane, on the lit rings and named nodes, and `in-spotlight` on the
  remaining members of a lit cluster, giving the three brightness levels in `styles.css`.
- **`revealSpotlight`** boxes the lit region in world px (each lit cluster's circle, plus each
  named artist's node, which covers the loners), converts it with the current transform, and
  **returns early if it is already on screen** with a `REVEAL_MARGIN` to spare. Otherwise it zooms
  *out* only as far as needed to fit (`Math.min(scale, fits)` — a single artist gives `fits =
  Infinity`, correctly read as "no zoom change"), centres, and reuses `clampPan`/`applyTransform`.
  The move is animated by a `.gliding` class on the plane, dropped on a timer (a transform that
  lands where it already was fires no `transitionend`) and cancelled by any wheel or pointer-down
  so a drag is never animated behind the pointer. `prefers-reduced-motion` skips it entirely.
- **Escape** is intercepted on the input only while the dropdown is open, with `preventDefault()`
  (the dialog's close request is the keydown's default action) and `stopPropagation()`; otherwise
  it falls through to the native close. `mousedown` on the listbox is prevented so clicking a
  suggestion does not blur the field out from under the click.

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

`countedTags` reads an artist's **`specificTags`** (§3b) — everything its CSV row implies, derived
tags included, minus the tags too broad to describe anything. Both halves of that were measured.

**One statistic opts out entirely.** `categoryComposition` ("What your list is made of") counts
`ownTags` and applies no breadth rule, because it is an inventory of the descriptions used rather
than a claim about the artists: a description nobody wrote is not part of it. Counting derived tags
led its categories with `rock` and `pop`; counting derived-minus-broad led them with `California`
and `Western European` instead — the same failure one level down. Reading the rows settles it with
no threshold at all. The cost is that a scene split across sub-genres is reported split, which
`rankTasteWorlds` (§8.3) is what answers instead.

**Derived tags are counted** because own tags alone cannot answer "how much of this collection is
pop punk": whether a band is *written down* as pop punk is an artefact of how the row was tagged
rather than a fact about the music. Rows carry only their most specific tag (§3), so Paramore says
`emo pop` and stops. Enforcing that rule across the roster moved `pop punk` from 39 carriers to 30
without a single artist changing — a figure that swings on CSV hygiene is measuring the wrong thing.

**Broad tags are dropped** because they are the mirror-image error, and dropping them is not merely
cosmetic:

- The prevalence lists would otherwise be led by `rock` (80%) over every genre anyone chose — the
  failure PRD §10.2 forbids, an ordering that is an artefact of how the data is stored.
- `measurePredictivePower` improves from r² 0.29% to 0.32%: a tag four fifths of the roster carries
  has a leave-one-out mean of nearly the roster mean, so averaging it into every prediction flattens
  the model rather than informing it.
- The multiplicity correction tests 192 tags instead of 213, since a tag that sits at the roster
  average by construction cannot reach a tail but still tightens the cutoff for tags that can. The
  Benjamini–Hochberg margin rises from 4.69× to 5.21× (§8.2a).

This puts the whole dialog on one definition of carrying a tag. Only the 🎲 filter keeps the broad
tags, since finding artists is exactly what they are good for.

**The two sections that are the ☁️ map narrow once further, to `soundTags`** (§3b): `rankTasteWorlds`,
which delegates to `groupRoster`, and `rankIsolation`, whose ranking comes from the map's
`pairwiseSimilarities`. They report the map's grouping, so they must read what the map reads — a
section explaining a neighbourhood the user can see on screen cannot be computing a different one.
`rankIsolation` applies it to its *displayed* figures too (`kin`, `rarestTag`), not just to the
similarity behind the ordering: ranking artists by musical company while captioning them with a
region is a list disagreeing with its own explanation. Everything else in the dialog is about the
tags themselves and counts regions, eras and aspects among them.

### 8.1 Two tier valuations, deliberately

PRD §10.1's premise — presence is positive, comparisons are to the user's own average — is
implemented by keeping two *different* questions on two different scales. They are not a
duplication to be tidied away:

- **`TIER_WEIGHT` (`types.ts`) — how much an artist counts.** The `position²` weights shared with
  the 🎲 picker (§6). Every value is positive, so no placement can subtract. Its gaps run both ways
  on purpose: *absolutely* they widen towards the top (S − A = 13 against E − F = 3), so a favourite
  counts for far more than a promotion at the bottom; *proportionally* they narrow (A → S is 1.36×
  where F → E is 4×), because the S/A distinction is the finest the list draws. Drives `share` and
  `ratio`.
- **`tierPosition` (`types.ts`) — where an artist sits.** The rank index, S 7 down to F 1, with a
  `+` a third of a rank above its base and a `-` a third below (`S+ 7⅓`, `S- 6⅔`), so the whole
  scale lands on one 1/3 grid running from 1 to 7⅓ (`BOTTOM_POSITION`/`TOP_POSITION`). Used
  *only* for statements about placement: the predictor range gauges, the outlier prediction model,
  and `tierBand`, which bands a mean position onto the tier whose own position is nearest
  (6.17 → `A+`, 6.5 → `S-`, ties going to the better tier). Because the tiers *are* the grid, the
  band always names a row the board has, needs no clamp at either end, and cannot produce an `F+`:
  a mean just above F has `E-` two thirds of a rank away as its other neighbour.

`TIER_WEIGHT` is *derived* from `tierPosition` (it is the square), which is what keeps the picker
and the statistics honest about being one ranking. The two remain separate questions all the same:
squaring is not order-preserving arithmetic on the differences, so "counts twice as much" and "sits
two tiers higher" are not interchangeable statements, and mixing them is the mistake §8's doctrine
exists to prevent.

`computeBaseline` derives the roster-wide denominators once: `totalWeight`, `meanWeight`, the
occupied `positions` range, and the **favourite tiers** — the top **ranks** covering at least
`FAVOURITE_SHARE` (0.25) of the ranked roster, taken from the data rather than hard-coded so a
reshuffle moves the boundary with it.

The favourite boundary and `RosterSummary.tierCounts` (the histogram) are the two places that fold
a rank's `+`/`-` rows back together; every other statistic reads the position or the weight and so
resolves them. Both are read as a glance or a sentence — a bar per row would give the histogram a
dozen empty ones, and the "skip empty ranks above the first occupied" rule would drag empty rows
into the favourite list behind the first occupied one.

`positionFraction(position, range)` maps a placement onto a gauge track across the **occupied**
span, not the theoretical 1..7⅓. The old absolute axis reserved a sixth of every track for `F`,
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
tags alone) `NULL_SAMPLES` (20 000) times and seeing how often a group of that size lands as far
out by luck. A prefix of a shuffle *is* a uniform random subset, so one walk down each shuffle
yields the null for every carrier count at once; the RNG is seeded, so the dialog stays a pure
function of the roster. Cost is ~45 ms on the shipped data, inside the existing lazy first-open
build.

Shuffling rather than a normal approximation, because `TIER_WEIGHT` is badly skewed (S counts 49,
E counts 4) and a handful of carriers has a lumpy null that a bell curve misjudges precisely in the
tail. The resulting p-values are corrected with **Benjamini–Hochberg** at `FALSE_DISCOVERY_RATE`
(0.05); `rankByRatio` and `rankByFavouriteIndex` gate on `elevationIsReal`,
`rankReliable` and `rankVariable` on `clusteringIsReal`.

`NULL_SAMPLES` is load-bearing, not a tuning knob: with S shuffles the smallest observable p-value
is 1/(S+1), and BH's rank-1 threshold here is 0.05/192 ≈ 0.00026. At 2 000 shuffles **no tag could
pass however real it was**, which would look like a finding rather than the measurement artefact it
is. At 20 000 the floor (0.00005) clears the threshold by a factor of ~5.1. It was raised from
10 000 when §8.0 switched to counting derived tags; excluding the too-broad ones (§3b) then brought
the tested count back down to 196, so the margin is now comfortable rather than marginal.

On the shipped roster **nothing clears the gate**, and the dialog says so rather than showing a
heading over nothing. The strongest tag is `indietronica` at p = 0.00295 (12 carriers) against that
0.00026 threshold; the tags clearing p < 0.05 uncorrected are about what 192 × 0.05 ≈ 10 coin flips
produce anyway. That result is pinned in
`stats.test.ts` so a data change that produces real preferences fails loudly and gets looked at.
Each tag's uncorrected p survives on `TagStat.elevationP` precisely so these figures can be
re-measured after a retag rather than remembered.

### 8.3 Worlds, predictive power and isolation

- **`rankTasteWorlds`** delegates wholesale to `groupRoster` (`cloud-layout.ts`), which runs the
  first two steps of the map's layout without any geometry: genre scenes, then those agglomerated
  into ~√k families of related sound. Reused rather than reinvented so the 📊 dialog and the ☁️ map
  cannot disagree about the shape of one collection — a second clustering here would drift from the
  one the user can actually see. Descriptive, so ungated: which artists group together is a fact
  about their tags, with the tiers playing no part. On the shipped roster it yields 6 worlds over 41
  scenes, covering 244 of 245 ranked artists; the 1 unclaimed is reported rather than forced into a
  family. Worlds are named by listing their own scenes — an invented label like "synth pop and
  friends" would be a guess dressed as a finding — and each scene by its full name (`sceneName`,
  §7), so a scene that adopted from outside its founding genre reads `progressive metal + prog
  rock` here exactly as it does on the map. That is why scenes are joined with `·` and a scene's
  own tags with `+`: nested in one line, a single separator would leave no way to tell a second
  scene from a second tag on the first.

  Narrowing the grouping to `soundTags` (§3b) is what made the worlds worth listing: they had been
  36%, 34%, 14%, 12%, 2%, 2% of the roster — two blobs, two remainders, and two singletons that were
  really origin tags in disguise (`J-pop` alone, `traditional pop` alone). They are now 24%, 21%,
  19%, 17%, 16%, 3%, with `J-pop` seated among the hip hop and ska scenes it actually resembles.
  The scene list is unchanged, since scenes were always founded on genres (§7).

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
  `KIN_SHARE` (½) of this artist's **sound tags**. A fraction rather than a fixed count, since tag
  counts vary widely from artist to artist (§3 sets no bound) and a flat threshold would make the
  sparsely-tagged look lonely for no reason but their sparseness. On the shipped roster
  it scores up to 44 at the crowded end and 0 at the lonely one, so it separates the lists as sharply
  as a similarity measure would **while meaning something a reader can check** — which is why it,
  and not the similarity, is the displayed figure.
  `kinship` — the mean of an artist's `ISOLATION_NEIGHBOURS` (3) closest similarities from the ☁️
  map's `pairwiseSimilarities` (`cloud-layout.ts`, reused rather than reinvented) — survives as the
  **tie-break**, which is load-bearing at the lonely end where many artists score 0 `kin` and only
  the finer measure can order them. It is never displayed: over a coherent roster it compresses into
  a narrow band near the top (0.65–1.00 on the shipped data), where a bare "0.84" would read as a
  strong match. `rarestTag` (the least-shared sound tag) is carried for both ends but rendered only
  on `distinctive`; it needs no era exclusion, since a decade is not a sound tag.

  Both figures halved when the section narrowed to `soundTags` (`kin` peaked at 87 before): an
  artist's shared decade and continent had been doing much of the work of making it look
  well-companioned. The captions moved further than the numbers: `The Beatles` was explained by
  `Liverpool` and is now explained by `merseybeat`, `Apashe` by `Belgian` and now by `dubstep`, and
  the artists whose sole unusual tag was an origin (`t.A.T.u.`, on `Eastern European`) left the
  list — which is the point, since "few Russians are on this list" is a fact about the list's
  coverage rather than about how t.A.T.u. sounds.

### 8.4 Eras, and tuning

**Eras stand apart.** `computeStats` partitions the aggregates on `isEraTag` (exported by
`tag-groups.ts`, the same decade-shape test the filter panel's grouping uses): era tags fill their
own chronological section (canonical tag order is already chronological for decade-shaped names) and
are withheld from every other list, the composition breakdown, the predictive-power measure, and the
rarest-tag annotation — being numerous, well-supported, and internally uniform, they would otherwise crowd out the
rest of the vocabulary.

The list lengths (`TAG_LIST_LIMIT` 10, `PREDICTOR_LIST_LIMIT` 6, `ARTIST_LIST_LIMIT` 10,
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
`halfWidth`, and the decade columns and tier histogram compute their own maxima. **A "group" is the
list a reader compares within**, which is not always a whole section: the composition list
("What your list is made of") scales each vocabulary category to its own largest tag, because its
categories are separate lists under separate sub-headings and the widespread quality tags otherwise
leave every genre a stub. The printed percentages stay the true share of the roster, so the
categories remain comparable by their numbers. The one gauge that
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

- **Vitest** unit tests for the pure logic: the tier scale itself in `src/types.test.ts` (that
  `TIERS` is `BASE_TIERS` expanded with `F` left unvaried, the position ordering, and the
  rank/variant helpers), CSV parse/serialise round-trip (incl. quoting) in
  `src/csv.test.ts`, the overlay/diff/export in `src/store.test.ts` (run under the `jsdom`
  environment for `localStorage`), the weighting/selection in `src/random.test.ts`, the
  canonical name ordering in `src/sort.test.ts`, the ☁️ map's similarity model and layout in
  `src/cloud-layout.test.ts` (determinism, bounds, and cluster geometry — on synthetic rosters
  and as a smoke test over the real one), the map's 🔍 matching and spotlight resolution in
  `src/search.test.ts` (folding, the score tiers' ordering, the query-length floor, and that a
  suggestion always lands on at least one artist — synthetic rosters and the real one), and the
  📊 statistics aggregation in
  `src/stats.test.ts` (scoring/banding, minimum support, ranking ties, leave-one-out outliers —
  likewise on synthetic rosters and the real one).
- **The tag vocabulary is tested as data** (`src/tag-registry.test.ts`): parsing and derivation on
  synthetic registries, then the §3a invariants asserted against the shipped files — every roster
  tag is registered, every `Derived` value resolves, no cycles, no genre deriving a region,
  no row carrying a tag another tag on it already derives (`redundantTags`, §3), rows canonically
  sorted. `broadTags` and `isSoundTag` (§3b) are covered here too, on synthetic rosters, plus one
  invariant over the shipped data that the two of them make possible to violate: **every artist
  keeps at least one sound tag**. An artist described purely by origin and decade would reach the ☁️
  map with an empty vector, be similar to nobody, and land on the rim by default rather than on the
  evidence. These are what stop `data/artists.csv` and `data/tags.csv`
  drifting apart as the roster is retagged; the "Other" group being empty is asserted rather than
  assumed.
- Type-checking via `tsc --noEmit`; formatting via Prettier; all enforced in CI (§10). The
  enrichment, add-artist and tag-research scripts run under **tsx**. Exact commands are listed in
  [CLAUDE.md](../CLAUDE.md).
