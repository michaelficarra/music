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
| Drag-and-drop      | **SortableJS**                  | Framework-agnostic, zero-dependency, purpose-built for reorderable lists and dragging items between lists, with mouse **and** touch support. |
| Hosting            | **GitHub Pages** via **GitHub Actions** | Free static hosting; the Action builds and deploys, so build artefacts are not committed. |

There is intentionally **no UI framework and no runtime data fetching of images** — the app is a
static bundle plus a build-time-embedded copy of the artist data.

## 2. Project layout

```
.
├── data/
│   └── artists.csv          # Source of truth for the artist roster, tiers, and images
├── scripts/
│   ├── enrich-images.ts     # Dev-time tool that fills in image URLs (see §6)
│   ├── add-artist.ts        # Append an unranked artist to the CSV, then enrich them
│   └── thumbnail.ts         # toThumbnail(): prefer smaller image forms (see §6)
├── src/                     # Application source
│   ├── main.ts              # Entry point: load data, build UI, wire events
│   ├── data.ts              # CSV parse/serialise + the static baseline import
│   ├── store.ts             # Local-storage overlay + diff (Reset/Save) logic
│   ├── board.ts             # Renders tiers + unranked area, wires SortableJS
│   ├── random.ts            # Weighting schemes + weighted random pick
│   └── ...                  # (styles, small helpers)
├── docs/                    # PRD.md, ARCHITECTURE.md (this file)
├── .github/workflows/
│   └── deploy.yml           # Build + deploy to GitHub Pages
├── index.html
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

- Encoding: UTF-8, first row is the header.
- **Quoting:** standard RFC-4180. Fields containing a comma, double-quote, or newline are wrapped
  in double quotes, with embedded double-quotes doubled. This matters for names such as
  `Dan le Sac vs. Scroobius Pip` (safe) and any future name containing a comma.
- The current file holds 252 artists. It may be edited by hand or by the enrichment script (§6).

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
- **Save** writes the serialised CSV (§3) to the clipboard, and — only when the page is served from
  the deployed site (`location.origin + pathname === "https://michaelficarra.github.io/music/"`) —
  opens the file's GitHub edit page in a new tab. The guard keeps local dev and forks from spawning
  a tab to a repo the viewer can't push to; the clipboard copy happens regardless. Both the edit URL
  (`https://github.com/michaelficarra/music/edit/main/data/artists.csv`) and the site URL are
  **hard-coded** in `main.ts` — the one place the repo name is baked in (cf. the relative `base` in
  `vite.config.ts`, §1) — so both must be updated if the repo is renamed or moved. GitHub cannot
  pre-fill the editor from a URL, hence the clipboard copy: the maintainer pastes, then commits to
  redeploy.

## 5. State model & persistence

- **In memory:** the current arrangement is held as a `Map<ArtistName, Tier | UNRANKED>` plus the
  immutable baseline (roster, images, baseline tiers).
- **Local storage** (`store.ts`): a single key (e.g. `artist-tier-list:v1`) holding JSON:
  ```json
  { "version": 1, "assignments": { "Radiohead": "S", "Nickelback": "E", ... } }
  ```
  `assignments` is a sparse map of **name → tier** overrides. Only tier is stored (no within-tier
  order, per PRD §5). Writes happen immediately on every drop.
- **Diff for Reset/Save:** compare each artist's current tier with its baseline tier. If any differ,
  the arrangement is "changed" → show Reset and Save. Within-tier order is irrelevant to the diff.
- **Reset:** confirmed via a native `<dialog>` (`showModal()`, a `<form method="dialog">`); only a
  `confirm` return value removes the local-storage key and re-renders from the baseline.
- **Save (clipboard):** serialise the **full** arrangement to CSV and write it to the clipboard via
  the async Clipboard API (`navigator.clipboard.writeText`). Serialisation rules:
  - Update only the `Tier` field of each row to the artist's current tier (blank for unranked); all
    other columns are passed through unchanged.
  - **Sort the data rows by artist name** via `compareArtistNames` (`src/sort.ts`, a case- and
    accent-insensitive `localeCompare`) so the exported CSV stays in the list's canonical order.
  - Apply RFC-4180 quoting (§3).

## 6. Image-enrichment tooling (`scripts/enrich-images.ts`)

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
  (blank Tier/ImageURL/ImageSource) in sorted position (`compareArtistNames`, keeping the CSV
  sorted by name), then invokes the enrichment above for just that artist. Refuses a duplicate name.

## 7. Build & deploy

- **Dev:** `vite` (dev server with HMR).
- **Build:** `npm run build` (`tsc --noEmit && vite build`) → static assets in `dist/`.
  `vite.config.ts` sets **`base: './'`** (relative asset URLs), so the bundle works under any GitHub
  Pages project subpath (`https://<user>.github.io/<repo>/`) without hard-coding the repo name.
- **Deploy:** `.github/workflows/deploy.yml` runs on push to the default branch: install → build →
  `configure-pages` → `upload-pages-artifact` (`dist`) → `deploy-pages`. **Build artefacts are not
  committed**; the Action publishes `dist/` to Pages.

## 8. Testing & quality (intended)

- **Vitest** unit tests for the pure logic: CSV parse/serialise round-trip (incl. quoting) in
  `src/csv.test.ts`, the overlay/diff/export in `src/store.test.ts` (run under the `jsdom`
  environment for `localStorage`), and the weighting/selection in `src/random.test.ts`.
- Type-checking via `tsc --noEmit`; formatting via Prettier. The enrichment script runs under
  **tsx**. Exact commands are listed in [CLAUDE.md](../CLAUDE.md).
