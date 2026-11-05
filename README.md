# Scout

Track what you watch, read, and play, in plain Obsidian notes.

Search a title (or paste a link), pick a result, and Scout renders it through your own template into the folder you choose. Everything it then creates lands in the **library** — one place to browse what you own, rate it, set its status, and write down what you thought.

## Sources

| Source | Kinds | Credentials |
| --- | --- | --- |
| TMDB | Movies, TV | Free API read access token |
| Open Library | Books | None |
| AniList | Anime, manga | None |
| [RAWG](https://rawg.io) | Games | Free API key |
| Web link | Any URL | None |

Game data comes from RAWG, the video game database.

## Setup

1. Enable the plugin in **Settings → Community plugins**.
2. Open **Settings → Scout**.
3. Under **Notes**, set an output folder for each kind you want to use.
4. Under **Sources**, pick or create a secret holding your TMDB token if you want movies and TV, and your RAWG key if you want games.

Templates are optional — each kind has a built-in one.

## The library

Open it from the ribbon or with **Open library**. It lists every note whose media-type property names a kind — `type: movie`, `type: book`, and so on — so notes you wrote years ago show up alongside the ones Scout creates.

Browse as a grid, a list, or a table. Filter by type, status, genre, rating, or favourites; group by any of them; sort however you like. Right-click an item for its status menu without leaving the page.

Select something to open its details: the metadata on top, and below it the part you own.

- **Rating** — stars, hearts, or a number, out of 5, 10, or 100, in whole or half steps, and a different scale per type if your films are out of ten and your books are out of five
- **Status** — one click, with the start and finish dates stamped for you, each shelf carrying its own colour and icon (and a progress ring, on anything you are part-way through)
- **Progress** — episodes, pages, or chapters, with a bar when the note records a total
- **Thoughts** — a text box wired to a heading in the note, so it stays readable and editable by hand
- **Your own fields** — anything else you want to track, defined in settings

Every control writes ordinary frontmatter. There is no separate database, so Dataview, Bases, sync, and hand edits all keep working, and uninstalling Scout leaves your notes exactly as they are.

### Making it fit your vault

Scout reads what you already have rather than asking you to convert anything. Under **Settings → Scout → Properties** you can point every field at the property name your notes use, and say which values (`film`, `series`, `graphic novel`) mean which kind. It already accepts the obvious alternatives — `poster` for a cover, `overview` for a description, `my_rating` for a rating — so most vaults need no changes at all.

Statuses are yours too: set the shelves each kind can be on, in the order they should appear. Since they are your words, Scout cannot read meaning into them — instead you sort them into four groups (started, finished, set aside, given up on), and that is what decides each one's colour and icon and when a date gets stamped. Anything you leave out counts as not started yet.

Ratings work the same way. Scout never rewrites a number in your notes — changing the scale only changes how the numbers already there are read — so instead of converting your vault you give each type the scale it already uses. Sorting, filtering, and the average then compare proportionally: a book at 4 out of 5 outranks a film at 7 out of 10. However large the scale, the row is always five icons, so a film rated 8 out of 10 fills four of them and nothing overflows a card.

## Importing what you already logged

**Import library…** (in the command palette, on the empty library, and under **Settings → Scout → Library**) reads an export from:

- **Letterboxd** — unzip the data export and pick its CSVs: `watched`, `ratings`, `diary`, `watchlist`, `reviews`, and `likes/films`. Rewatches in the diary become history.
- **Goodreads** — `goodreads_library_export.csv`. Books are found by ISBN first, then by title and author.
- **The StoryGraph** — the CSV export. Every read in `Dates Read` is kept.
- **AniList** — a public username. Titles come straight from AniList, so nothing is guessed.

Each title is looked up at its source, so imported notes come out of the same template as searched ones. Before anything is written you see what was found, what is already in your library, and what could not be matched, and you can untick anything — best guesses start unticked. Your statuses, ratings (on each type's own scale), dates, favourites, and reviews are then written the same way the library writes them, with the review under your thoughts heading. Running the same import again creates nothing twice, and titles that could not be found are offered as a list to copy.

## Stats

**Open stats** (or **Stats** on the home page) shows, for any year or all time and any type: what you finished and when, a calendar of finish days, time spent where your notes record runtimes, pages, or hours, how you rate, your top genres and people against your own average, rewatches, what you gave up on, and what has waited longest. Set a yearly goal per type there — "52 books" — and its progress also shows on the home page. Every chart can be read as a table instead.

## Commands

- **Open library** — browse and manage everything you have
- **Open stats** — what you finished, when, and what you made of it
- **Import library…** — bring in a Letterboxd, Goodreads, StoryGraph, or AniList history
- **Search all sources** — one modal across every enabled source
- **Search movies / TV shows / books / games / …** — per-kind, hidden when no configured source offers that kind
- **Manage this note** — the detail view for the note you are looking at
- **Create note from link in clipboard** — resolves a TMDB, Open Library, AniList, RAWG, or arbitrary URL

## Templates

Placeholders use `{{name}}`. Frontmatter is rendered as **valid YAML** — values are quoted and escaped automatically, so a title containing a quote or colon will not corrupt the file, and lists become real YAML sequences that Dataview can query.

```markdown
---
title: {{title}}
genres: {{tags}}
rating: {{rating}}
release_date: {{release_date}}
---

# {{title}}

{{description}}

{{#if runtime}}**Runtime:** {{runtime}} minutes{{/if}}
```

Common fields: `title`, `subtitle`, `year`, `rating` (always 0–10), `cover`, `description`, `tags`, `people`, `url`, `release_date`, `kind`, `provider`, `id`, `now`. Each source adds its own — the full list is in **Settings → Scout → Templates**.

Filters: `{{tags|list}}`, `{{release_date|date:YYYY}}`, `{{description|truncate:200}}`, `{{people|link}}`, `{{rating|scale:10:5}}`, `{{pages|default:Unknown}}`, `{{cast|take:5}}`.

Blocks: `{{#if x}}…{{else}}…{{/if}}`, `{{#each people}}- {{.}}{{/each}}`.

A template that writes `type`, `status`, `rating`, `source`, and `scout_id` puts the note straight onto the right shelf and lets Scout recognize it in a later search. The built-in templates do all five.

## Adding a source

Providers are self-contained. Implement `MediaProvider` plus whichever capabilities apply — `Searchable`, `Detailable`, `Resolvable`, `Authenticated` — and add one line to the `PROVIDERS` table in `src/main.ts`. No changes to the modal, settings tab, or commands are needed.

Settings pages work the same way: a page is one file in `src/core/settings/sections/` plus one entry in the `SECTIONS` list.

```
src/
  core/
    library/    reading, filtering, and editing the notes you already have
    settings/   the store, and one file per tab of the settings dialog
    ...         provider contracts, registry, HTTP, templating, note writing
  providers/    one directory per source
  ui/           the search modal, the detail dialog, the library view
```

## Development

```bash
pnpm install
```

```bash
pnpm run dev
```

```bash
pnpm test
```

```bash
pnpm run build
```

`dev` and `build` both write `main.js` to the repo root. `build` also mirrors the release artifacts into `dist/` (gitignored — attach them to a GitHub release).

### Live reload

1. Install and enable [hot-reload](https://github.com/pjeby/hot-reload) in your test vault.
2. Run `pnpm run dev`. esbuild rebuilds `main.js` on every source change, and hot-reload re-enables the plugin within a second. It also picks up `styles.css` edits.

If this clone is the plugin folder (`<vault>/.obsidian/plugins/scout`), that is all — the repo ships a `.hotreload` marker.

If the clone lives elsewhere, point the watcher at the vault's plugin folder, in the environment or in a gitignored `.env` file:

```bash
OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/scout
```

The watcher then copies `main.js`, `manifest.json`, and `styles.css` there after each change and creates the `.hotreload` marker.

## Privacy

The library is built entirely from notes already in your vault. Scout contacts a source only:

- when you search, open a result, or resolve a link
- for **background refresh** (on by default, **Settings → Scout → Background**): re-checks notes that already record a source id, and updates only facts the source owns
- for **background reading-up** (off by default, same tab): fetches keywords, cast, and crew for linked notes to improve suggestions
- when you run an **import**: each title's name, year, author, and ISBN is searched for at its source (or, for AniList, the username you typed is looked up). The export file itself is read on your device and never sent anywhere. Stats never use the network.

Background jobs send only the source ids already in your notes — never note contents, file names, ratings, or thoughts. Reading-up results are kept in `cache.json` in the plugin folder, never in your notes.

Your TMDB token and RAWG key are kept in Obsidian's secret storage. If an older version stored it in `data.json`, it is copied into secret storage and the plain copy is kept as a fallback, so it keeps working on synced devices. Once every device runs this version, you can delete `accessToken` from `data.json`.

No telemetry.

## License

MIT
