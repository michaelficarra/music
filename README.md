# Artist Tier List

A single-page, static web app for sorting a curated list of musical artists into ranked tiers by
drag-and-drop, in the spirit of [tiermaker.com](https://tiermaker.com). Drag artists between tiers,
have your arrangement remembered in your browser, and roll a 🎲 to pick something to listen to.

It runs entirely in the browser — there is no backend, no accounts, and no server-side state.

## What it does

- **Drag-and-drop tiers** — sort artists into seven fixed tiers (S, A, B, C, D, E, F) plus an
  always-visible *unranked* area. Works with mouse and touch.
- **Remembers your changes** — your arrangement is saved to the browser's local storage and
  restored on your next visit.
- **Reset / Save** — when your arrangement differs from the shipped default, a **Reset** button
  reverts it, and a **Save** button copies the updated data (as CSV) to your clipboard so the
  maintainer can paste it back into the source data.
- **🎲 Random picker** — pick a random artist from the ranked tiers, with selectable weighting
  schemes (which tiers are eligible, and how strongly higher tiers are favoured). Unranked artists
  are never picked.

Each artist has a name, a tier, and a representative image. The list of artists is curated in
`data/artists.csv` and shipped with the app.

For full details, see [docs/PRD.md](./docs/PRD.md) (features/behaviour) and
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) (how it's built).

> **Status:** the app is built and past its MVP — the toolchain, tests, and CI are all in place, so
> the build/run steps below work as written.

## Tech stack

Vite + TypeScript, vanilla DOM (no UI framework), [SortableJS](https://github.com/SortableJS/Sortable)
for drag-and-drop. Built to a static bundle and hosted on GitHub Pages.

## Build and try it yourself

```sh
# 1. Install dependencies
npm install

# 2. Run the dev server (with hot reload) and open the printed URL
npm run dev

# 3. Build a production bundle into dist/
npm run build

# 4. Preview the production build locally
npm run preview
```

That's all you need to try the app — the artist data is read from `data/artists.csv` and embedded
at build time.

## Updating the artist data

- **Add an artist:** `npm run add-artist -- "Artist Name"` appends them as unranked and fills in
  their image automatically.
- **Edit by hand:** change `data/artists.csv` (columns: `Artist, Tier, ImageURL, ImageSource`).
- **From the app:** rearrange artists, then click **Save** to copy the updated CSV to your
  clipboard and paste it over `data/artists.csv`.
- **Fill in images:** run the enrichment script, which looks up a representative image per artist
  (Apple Music → MusicBrainz → YouTube Music → Wikipedia/Wikimedia), preferring thumbnail sizes:

  ```sh
  npm run enrich
  ```

Rebuild/redeploy to make any data changes the new shipped default.

## Documentation

- [docs/PRD.md](./docs/PRD.md) — what the app does (user-observable features and behaviour).
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — how it's built.
- [CLAUDE.md](./CLAUDE.md) — how to work in this repo and keep the docs current.
