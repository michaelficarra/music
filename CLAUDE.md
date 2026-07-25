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

## The 📊 statistics: what this data can and cannot support

This panel has been rebuilt several times because the same mistake keeps reappearing in new
clothes. Read this before adding, ranking, or "improving" any statistic. The mechanics are in
ARCHITECTURE §8; what follows is the reasoning, which the code cannot express on its own.

**The premise.** The roster contains only artists the maintainer likes. S means "favourite", the
bottom tier means "still good, just less so". **An artist's presence is already the positive
signal** — having collected 36 pop punk artists *is* the preference; where those 36 sit is a
second-order refinement among things already liked. No statistic may treat a low placement as a
negative verdict, and no copy may call a tag unloved or an artist a mistake.

**Every statistic is one of two kinds, and the difference decides everything:**

| | Descriptive | Inferential |
| --- | --- | --- |
| Claims | what the collection is made of | that a tag says something about the *ranking* |
| Counted by | plain headcount (`prevalence`) | tier weights (`ratio`, `favouriteIndex`, spread) |
| Must beat chance? | **no** — there is no hypothesis to reject | **yes**, corrected for multiplicity |
| When there is nothing to show | cannot happen | the section is omitted, and says why |

Before writing a statistic, decide which column it is in. Getting this wrong is the trap: an
earlier version ranked tags by a tier-derived "surplus" and required it to beat chance, which made
a descriptive count inferential *and* smuggled tier position back in as the measure of preference.

**Three findings are settled. Do not re-derive them, and do not build features that assume
otherwise:**

1. **The tags barely predict the tiers** — r² ≈ 1% over 239 artists (`measurePredictivePower`).
   Any statistic ranking artists by distance from a tag-based prediction therefore collapses into
   "what tier is it", because the prediction is nearly constant. Two sections died this way; the
   dialog now reports the measurement instead.
2. **No tag's elevation survives correction.** Every list picks the best of ~130 tags, and over that
   many tries the best of anything looks striking — shuffling the tiers at random beats the real
   roster's top tag about four times in five. The strongest real tag reaches p = 0.0033 against a
   Benjamini–Hochberg threshold of 0.0004. Nine tags clear p < 0.05 uncorrected, where 127 × 0.05 =
   6.4 is what chance alone produces.
3. **Prevalence cannot separate taste from base rate.** A tag's frequency carries both how much
   the maintainer likes the trait and how common the trait is in the music that exists, and nothing
   computable from this file can tell them apart — there is no outside population to compare
   against. Report prevalence as a fact about the collection, say so plainly, and **do not try to
   correct it with tier elevation**: that is cancelling one measurement error with another. Resist
   illustrating the point with a claim about music in general ("most acts have a male singer") —
   the app has no basis for such a claim, and any example drawn from today's roster goes stale.

**Rules that follow:**

- **An empty section is a correct outcome**, not a bug to fix by loosening a threshold. Sections
  that vanish must say why (`nothingStandsOut`) rather than silently disappearing.
- **Lead every list with the figure it is sorted by.** A ranking whose key is not on screen reads
  as unsorted, however principled it is.
- **Small samples dominate any extremum.** Tightest spread, highest average and best rate are all
  found among the fewest carriers unless shrunk (`PRIOR_STRENGTH`) or floored (`SPREAD_MIN_SUPPORT`).
- **Check that a chosen threshold is reachable.** `NULL_SAMPLES` at 2 000 made *every* tag fail by
  arithmetic, because the smallest observable p-value was above the correction's cut — a
  measurement artefact that looked exactly like a finding.
- **Reuse the ☁️ map's grouping** (`groupRoster`) for anything about which artists resemble which.
  Two features describing one collection must not disagree about its shape.
- **Prefer a null result to a decorative one.** "Your tags explain 1% of your ranking" is a better
  line than a ranked list of noise.

## Commands

```sh
npm install            # install dependencies
npm run dev            # Vite dev server with HMR
npm run build          # production build → dist/
npm run preview        # serve the production build locally
npm run enrich         # run scripts/enrich-images.ts (Apple Music → MusicBrainz → YouTube → Wikipedia)
npm run add-artist -- "<name>"   # append an unranked artist to the CSV and enrich just them
npm test               # unit tests (CSV round-trip, store diff, weighting, name sort, ☁️ map layout, 📊 statistics)
npm run typecheck      # tsc --noEmit
npm run format         # Prettier
```

## Validation before reporting success

After making changes, don't rely on tests alone — run the project's checks: `npm run typecheck`,
`npm test`, and `npm run format`. Iterate on the **specific** failing tests first, then run the
full suite. Verify user-facing changes against the PRD.

## Conventions

- British English spelling in docs and UI copy.
- **A group of bars scales to the largest bar in that group**, never to a theoretical maximum. Every
  bar list compares its rows only with each other, and against a notional 100% most of them are
  stubs — the biggest world is 41% of the roster, the biggest genre 15% — so the differences the
  reader is being asked to judge get squeezed into the first fraction of the track. The **printed
  value must stay the true one**: `shareBar` takes the real quantity and an `of` (the group's
  largest) precisely so a caller cannot label a bar with its scaled fraction by accident. Any
  reference tick scales with it. Diverging bars follow the same rule about their own centre line.
- Comment liberally to explain non-obvious sequences; avoid restating what the next line already says.
- Prefer descriptive placeholder names over `foo`/`bar`.
- Keep the app dependency-light and the output purely static (no backend, no runtime image fetching).
