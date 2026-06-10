# Working in this repo

A single-page, static web app for sorting musical artists into tiers by drag-and-drop, with a
weighted random picker. See [docs/PRD.md](./docs/PRD.md) for behaviour and
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for how it is built.

> The app and its toolchain (`package.json`, Vite config, `src/`, tests, CI) are in place and the
> commands below are wired up; the project is past its MVP. The docs remain the source of truth —
> keep them current with the workflow described next.

## Doc-driven workflow (source of truth)

`docs/PRD.md` and `docs/ARCHITECTURE.md` are the source of truth for this project. Keep them
current as part of the same change that alters behaviour or structure — not as an afterthought:

- **Any user-observable behaviour change** (a feature, an interaction, an edge-case rule) **must
  update `docs/PRD.md`.** Keep the PRD free of incidental presentation details (colour, fonts,
  spacing, exact wording) — those are not requirements.
- **Any structural or technical change** (stack, file layout, data schema, data flow, build/deploy)
  **must update `docs/ARCHITECTURE.md`.**
- **Keep this `CLAUDE.md` current** when the workflow, commands, or conventions change.

When unsure whether something belongs in the PRD or ARCHITECTURE: if a user could observe it, it's
the PRD; if it's about how the code achieves it, it's ARCHITECTURE.

## Data conventions

- `data/artists.csv` is the **source of truth** for the artist roster, tiers, images, and tags.
  Its schema (`Artist, Tier, ImageURL, ImageSource, Tags`) and RFC-4180 quoting rules are defined
  in ARCHITECTURE §3. Tags are semicolon-delimited descriptors from a shared controlled
  vocabulary (5–10 per artist; naturally cased — capitals only for proper nouns/acronyms; reuse
  existing tags rather than minting near-synonyms). When a brand-new tag is unavoidable, also add
  it to its category in `src/tag-groups.ts` so the 🎲 filter panel groups it correctly.
- The app embeds this CSV at **build time**; changing the data requires a rebuild/redeploy to
  affect the shipped default.
- The in-app **Save** button exports the current arrangement as CSV to the clipboard; updating the
  static default means pasting that over `data/artists.csv` and committing.
- Image URLs are populated by `scripts/enrich-images.ts` (ARCHITECTURE §9), which tries
  Apple Music → MusicBrainz → YouTube Music → Wikipedia (preferring thumbnails) and records the
  provider in `ImageSource`. It is idempotent (fills blanks only, unless `--force`).
- **Never commit** editor swap files (e.g. `data/.artists.csv.swp`); add them to `.gitignore`.

### Adding an artist

When asked to add an artist (optionally at a given tier):

1. Run `npm run add-artist -- "<name>"`. It rejects duplicates, appends an unranked row keeping
   the CSV alphabetically sorted, and immediately enriches the image (network required, no API
   keys). If enrichment fails, retry with `npm run enrich -- --artist "<name>"`; a blank image is
   acceptable — report it rather than hand-crafting a URL.
2. The script leaves `Tier` and `Tags` blank — edit the new row by hand. Set the tier if one was
   requested, and pick 5–10 tags per the conventions above: read the rows of the most similar
   existing artists and reuse their tags; check candidates exist in `src/tag-groups.ts`. A
   brand-new tag is fine **if** it would not be unique to this artist: suggest at least one
   existing artist that should also get it, and get the user's confirmation before adding the tag
   (to the new artist's row, the suggested artists' rows, and `src/tag-groups.ts`).
3. A pure data row needs **no** PRD/ARCHITECTURE updates. Validate with `npm test`,
   `npm run typecheck`, and `npm run format` (the tests derive expectations from the loaded
   roster, so they adapt to the new row).

## Commands

```sh
npm install            # install dependencies
npm run dev            # Vite dev server with HMR
npm run build          # production build → dist/
npm run preview        # serve the production build locally
npm run enrich         # run scripts/enrich-images.ts (Apple Music → MusicBrainz → YouTube → Wikipedia)
npm run add-artist -- "<name>"   # append an unranked artist to the CSV and enrich just them
npm test               # unit tests (CSV round-trip, store diff, weighting, name sort, ☁️ map layout, 📊 tag stats)
npm run typecheck      # tsc --noEmit
npm run format         # Prettier
```

## Validation before reporting success

After making changes, don't rely on tests alone — run the project's checks: `npm run typecheck`,
`npm test`, and `npm run format`. Iterate on the **specific** failing tests first, then run the
full suite. Verify user-facing changes against the PRD.

## Conventions

- British English spelling in docs and UI copy.
- Comment liberally to explain non-obvious sequences; avoid restating what the next line already says.
- Prefer descriptive placeholder names over `foo`/`bar`.
- Keep the app dependency-light and the output purely static (no backend, no runtime image fetching).
