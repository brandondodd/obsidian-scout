# Scout

Track what you watch, read, play, and listen to, in plain Obsidian notes.

Search a title (or paste a link), pick a result, and Scout renders it through your own template into the folder you choose. Everything it then creates lands in the **library** — one place to browse what you own, rate it, set its status, and write down what you thought.

## Sources

| Source | Kinds | Credentials |
| --- | --- | --- |
| TMDB | Movies, TV | Free API read access token |
| Open Library | Books | None |
| AniList | Anime, manga | None |
| [IGDB](https://www.igdb.com) | Games | Free Twitch app (client ID and secret) |
| [MusicBrainz](https://musicbrainz.org) | Albums (off until you turn it on) | None |
| Web link | Any URL | None |

Game data comes from IGDB, Twitch's video game database. Backloggd game links resolve through it too, since Backloggd is built on IGDB. Album data comes from MusicBrainz, with covers from the Cover Art Archive. Where-to-watch data on films and shows comes from JustWatch, through TMDB.

### Optional extras

All of these are off until you act, and each is explained under **Settings → Scout → Scores and availability**. None of them makes notes or answers searches: they only add to the detail dialog. Without them, the parts they supply simply do not appear.

| Service | Adds | Needs | What it receives |
| --- | --- | --- | --- |
| [MDBList](https://mdblist.com) | Rotten Tomatoes (critics and audience), IMDb, Metacritic, Letterboxd, and Trakt scores for films and shows, blended into the Scout score | Free API key (1,000 requests a day) | The TMDB id of each title you open |
| [OMDb](https://www.omdbapi.com) | IMDb scores for each episode | Free API key | The IMDb id and season number when you open a show's episodes |
| Apple prices (iTunes Search) | Apple Books and iTunes prices for your region | Turning on **Apple prices** | The title and author or artist of each book or album you open |

Keys are kept in Obsidian's secret storage. Results are cached for a day, and only in memory.

## Setup

1. Enable the plugin in **Settings → Community plugins**.
2. Open **Settings → Scout**.
3. Under **Notes**, set an output folder for each kind you want to use.
4. Under **Sources**, pick or create a secret holding your TMDB token if you want movies and TV, and, if you want games, the client ID and secret of a free app made at [dev.twitch.tv/console](https://dev.twitch.tv/console) (any name, redirect URL `http://localhost`, category **Application Integration**).

Templates are optional — each kind has a built-in one.

## The library

Open it from the ribbon or with **Open library**. It lists every note whose media-type property names a kind — `type: movie`, `type: book`, and so on — so notes you wrote years ago show up alongside the ones Scout creates.

Browse as a grid, a list, or a table. Filter by type, status, genre, rating, or favourites; group by any of them; sort however you like. Right-click an item for its status menu without leaving the page.

Select something to open its details. A header stays in place on every tab: the artwork, the facts, the scores, and what you can do. Below it, **Overview** holds the part you own, and depending on the type there are also tabs for episodes, tracks, media, and cast. Selecting someone in the cast shows which of your other titles they are in.

The first score after yours is the **Scout score**: every score Scout can find for the title — Rotten Tomatoes critics and audience, IMDb, Metacritic, Letterboxd, Trakt, and the source's own — each put on one 0–10 scale and weighed by how far it can be trusted. On that scale a typical title is about 7, a well-liked film about 8, a top-250 film about 8.7, and the very best things ever made 9.4 and up, while a film critics and audiences both panned sits below 4 — roughly where the sites you know put them. Hover the Scout score to see what each source said, what it counted as, and how much say it had. A score with only a handful of votes behind it counts for less, and a near-unanimous Rotten Tomatoes share can lift a score but never drag a masterpiece down — past 85% from critics, or 88% from audiences, who grade kinder. Metacritic, Letterboxd, Trakt, and TMDB sit behind **More**. Each source's curve onto the scale is fitted, not guessed: every percentile of its scores is matched to the same percentile of what the other sources say about the same titles. The blend also knows that TV is graded on its own curve, that broad audiences mark horror down more than critics do, that reality TV is rated by its fans and so read closer to the middle, that a title's first months of scores come mostly from its keenest viewers, so anything well liked and out less than two months is held back a little until it settles, that a top score from tens of thousands of IMDb voters has not been tested the way one from millions has, so a well-liked title is held back a little until its vote count catches up with the films everyone has seen, and that a Rotten Tomatoes audience score far above what IMDb, Letterboxd, TMDB and Trakt say is measuring fans rather than the film, so it can lift a score only a little past theirs. When MDBList has no Rotten Tomatoes critics score for a film, its Metacritic score speaks for the critics in its place, so the blend does not tip toward audiences just because a number is missing. On a film, IMDb gets double its usual say when it rates the film lower than everyone else does — never when it rates it higher. And when a film's IMDb and Letterboxd scores both sit below the blend, the score is pulled most of the way toward them, so a middling film that critics were kind to cannot float above what its two biggest crowds think of it. If either one agrees with the critics, that pull is left off. When MDBList answers a source blank that it had a number for before — Rotten Tomatoes most often — Scout keeps the last number it knew, and asks again within a couple of days. Something not out yet has no Scout score — Trakt and TMDB let people rate a title before release, and a handful of early ratings is anticipation, not a verdict. A film gets a **Forecast** instead, with a telescope in place of Scout's compass: the Scout score it is likely to settle at once its reviews are in. It starts from a typical film and is moved by what is known before release, and hovering it shows each step. Its series counts most: the latest film for half, more when the earlier films have agreed with each other, and more again when a director of the series is back. Its directors' other films count next, each for half as much every six years back, so a director's recent form outweighs an early miss, and one great film counts for less than a run of them. An earlier film counts for as much as its vote count says it has settled, and a film in the series is never counted again under its director's name. Then its genres, and for a film outside a series its budget. TMDB sometimes splits a series across collections, as with the Hunger Games prequels, and Scout reads collections of the same name as one series. The base was fitted on 2,400 films, each predicted from only what had come out before it; the weight on series, directors and track records has been tuned by hand since. It tells a likely hit from a likely miss, but it is a forecast, not a verdict. Series not out yet get no forecast, as there are no earlier seasons to go on. With background refresh on, Scout asks TMDB about each film in your library not out yet every two weeks: the film itself, its series, and each of its directors' films, a few requests each. Opening its dialog does the same. Search results and suggestions show a forecast for films Scout has already looked into. Sorting and grouping by Scout score place a forecast alongside Scout scores, as the cards show it. A film with festival reviews in already has critics who have seen it, so it keeps its Scout score. In the library, cards and the table show the same Scout score as the dialog: Scout keeps each title's scores in its cache and blends them as it shows them, so a better blend reaches the whole library at once.

Shows and anime track episode by episode, with a season summary, a score for each episode, and a **Ratings** grid comparing a whole series at a glance. Books, manga, and games get a progress card while you are part-way through.

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

### Region

**Settings → Scout → Scores and availability → Region** sets which country's age ratings, streaming services, and prices you see. It follows your system until you pick one. If your region has no rating for a title, Scout shows another country's and says whose, like `TV-MA (US)`. Games only have American ESRB ratings, so those appear under **Details**, labelled, and never in the header.

## Importing what you already logged

**Import library…** (in the command palette, on the empty library, and under **Settings → Scout → Library**) reads an export from:

- **Letterboxd** — unzip the data export and pick its CSVs: `watched`, `ratings`, `diary`, `watchlist`, `reviews`, and `likes/films`. Rewatches in the diary become history.
- **Goodreads** — `goodreads_library_export.csv`. Books are found by ISBN first, then by title and author.
- **The StoryGraph** — the CSV export. Every read in `Dates Read` is kept.
- **AniList** — a public username. Titles come straight from AniList, so nothing is guessed.

Each title is looked up at its source, so imported notes come out of the same template as searched ones. Before anything is written you see what was found, what is already in your library, and what could not be matched, and you can untick anything — best guesses start unticked. Your statuses, ratings (on each type's own scale), dates, favourites, and reviews are then written the same way the library writes them, with the review under your thoughts heading. Running the same import again creates nothing twice, and titles that could not be found are offered as a list to copy.

## Stats

**Open stats** (or **Stats** on the home page) shows, for any year or all time and any type: what you finished and when, a calendar of finish days, time spent where your notes record runtimes, pages, or hours, how you rate, your top genres and people against your own average, rewatches, what you gave up on, and what has waited longest. Set a yearly goal per type there — "52 books" — and its progress also shows on the home page. Every chart can be read as a table instead.

## Ask your library

Off by default. Turn it on under **Settings → Scout → AI** with your own [Anthropic API key](https://console.anthropic.com), then run **Ask your library** and type a question — "sci-fi I loved from the 90s", "books I gave up on", "anything with Villeneuve I haven't finished". Claude turns the question into the library's own filters, and the library opens filtered to the answer. What Claude suggests is checked against your library first, and anything it has no match for (a genre you never use, say) is left out and named.

## Commands


- **Open library** — browse and manage everything you have
- **Open stats** — what you finished, when, and what you made of it
- **Ask your library** — a question in plain words, answered with the library's filters (only when turned on)
- **Evaluate suggestions** — scores how well suggestions fit your own library, so a change to the recommender can be judged by a number
- **Import library…** — bring in a Letterboxd, Goodreads, StoryGraph, or AniList history
- **Search all sources** — one modal across every enabled source
- **Search movies / TV shows / books / games / albums / …** — per-kind, hidden when no configured source offers that kind
- **Manage this note** — the detail view for the note you are looking at
- **Create note from link in clipboard** — resolves a TMDB, Open Library, AniList, IGDB, Backloggd, MusicBrainz, or arbitrary URL

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

### Measuring suggestions

Run **Evaluate suggestions** before and after changing the recommender. The *taste check* hides a fifth of your rated titles at a time and measures how often a liked one outscores a disliked one (AUC; 0.5 is chance), offline. The *suggestion check* hides your ten latest liked finishes and counts how many the engine suggests back. It asks your sources once and keeps their answers in `eval-recordings.json` (gitignored); turn on **Use kept answers only** to replay them offline, so two runs compare the recommender and not the sources' moods.

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

- when you search, open a result or a note, or resolve a link
- for **background refresh** (on by default, **Settings → Scout → Background**): re-checks notes that already record a source id, and updates only facts the source owns
  - the same switch lets Scout keep the library's Scout scores current: Open Library is asked for each book note's rating count (work ids only, fifty to a request), and, if you set up MDBList, MDBList for each film and show note's scores (TMDB ids only). These go into Scout's own cache, never into your notes
- for **background reading-up** (off by default, same tab): fetches keywords, cast, and crew for linked notes to improve suggestions
- when you **ask your library** (off by default, **Settings → Scout → AI**): your question, and the types, statuses, genres, and collection names your library uses, go to Anthropic's Claude API with your own key. Titles, notes, ratings, and people's names in your library are never sent; a name you type in the question is sent as typed. Anthropic's [privacy policy](https://www.anthropic.com/legal/privacy) applies to what it receives.
- when you run an **import**: each title's name, year, author, and ISBN is searched for at its source (or, for AniList, the username you typed is looked up). The export file itself is read on your device and never sent anywhere. Stats never use the network.

Opening the detail dialog asks that item's own source for its cast, availability, and so on. A source you have turned off is not contacted, even for a note that came from it. Web links are not fetched again when opened. MDBList, OMDb, and Apple are contacted only if you have set them up, as listed under [Optional extras](#optional-extras). MusicBrainz is off until you enable it under **Sources**, and is limited to one request a second as it asks.

Artwork and service logos in the dialog load from those sources' image servers, and from YouTube for trailer thumbnails.

Background jobs send only the source ids already in your notes — never note contents, file names, ratings, or thoughts. Reading-up results are kept in `cache.json` in the plugin folder, never in your notes.

Your TMDB token, IGDB client secret, MDBList and OMDb keys, and Anthropic key are kept in Obsidian's secret storage. If an older version stored it in `data.json`, it is copied into secret storage and the plain copy is kept as a fallback, so it keeps working on synced devices. Once every device runs this version, you can delete `accessToken` from `data.json`.

No telemetry.

## License

MIT
