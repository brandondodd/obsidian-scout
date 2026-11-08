import type { MediaKind } from "../types";
import {
	ratingFraction,
	splitList,
	statusesFor,
	type LibraryConfig,
	type LibrarySort,
} from "./config";
import { exactScoutOrHypeOfEntry } from "../hype";
import type { LibraryEntry } from "./entry";
import { entryGenres } from "../genres/genres";
import { queryRule, type LibraryQuery } from "./query";
import { matchesRule, ruleIsEmpty } from "./rules";

/**
 * Filtering, sorting, and grouping the library.
 *
 * Pure functions over already-parsed entries, so the view can re-run them on
 * every keystroke and the behaviour can be tested without a vault.
 */

export { emptyQuery, type LibraryQuery } from "./query";

const lower = (value: string) => value.toLowerCase();
export { groupEntries, type LibraryGroup } from "./group";

/**
 * What the search box looks through, lowercased once per entry and kept for as
 * long as the entry itself lives.
 *
 * The library re-filters on every keystroke, and building this inside the loop
 * meant lowercasing and joining every title, genre and name in the vault sixty
 * times a second. A `WeakMap` because the key is the entry object: a re-parsed
 * note is a new object with no cache, so nothing here can go stale.
 */
const haystacks = new WeakMap<LibraryEntry, string>();

function haystackOf(entry: LibraryEntry): string {
	const found = haystacks.get(entry);
	if (found !== undefined) return found;
	const built = [
		entry.title,
		entry.basename,
		entry.status ?? "",
		// Scout's names as well as the source's, so "sci-fi" and "science
		// fiction" both find a film whichever its note says.
		...entryGenres(entry),
		...entry.tags,
		...entry.people,
	]
		.join(" ")
		.toLowerCase();
	haystacks.set(entry, built);
	return built;
}

/**
 * The entries the toolbar keeps.
 *
 * The filters run as a rule — the same rule "New view" saves — so the toolbar
 * and a saved view can never disagree about what a filter means. The search
 * box is the one thing a rule cannot say, and is matched here: every word has
 * to appear somewhere, so "nolan 2010" narrows rather than widens.
 */
export function filterEntries(
	entries: readonly LibraryEntry[],
	query: LibraryQuery,
	config: LibraryConfig,
	now: Date = new Date(),
): LibraryEntry[] {
	const rule = queryRule(query);
	const ruled = !ruleIsEmpty(rule);
	const words = query.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!ruled && words.length === 0) return [...entries];

	const out: LibraryEntry[] = [];
	for (const entry of entries) {
		if (ruled && !matchesRule(entry, rule, config, now)) continue;
		if (words.length > 0) {
			const text = haystackOf(entry);
			if (!words.every((word) => text.includes(word))) continue;
		}
		out.push(entry);
	}
	return out;
}

/* ------------------------------------------------------------------ sorting */

/**
 * Titles, compared. A bare `localeCompare` on purpose: V8 keeps a fast path for
 * exactly this call, and every `Intl.Collator` this was tried against — plain,
 * numeric, case-insensitive — sorted five thousand titles about twice as slowly.
 */
const compareText = (a: string, b: string) => a.localeCompare(b);

/**
 * Each kind's status vocabulary, lowercased, worked out once per sort.
 *
 * `statusesFor` splits a comma-separated setting every time it is asked, and it
 * was being asked from inside a comparator — so an eight-hundred-item sort split
 * the same string ten thousand times.
 */
function statusRanks(config: LibraryConfig): (entry: LibraryEntry) => number {
	const byKind = new Map<MediaKind, Map<string, number>>();
	return (entry) => {
		if (!entry.status) return 999;
		let ranks = byKind.get(entry.kind);
		if (!ranks) {
			ranks = new Map(
				statusesFor(config, entry.kind).map((status, at) => [
					lower(status),
					at,
				]),
			);
			byKind.set(entry.kind, ranks);
		}
		return ranks.get(lower(entry.status)) ?? 998;
	};
}

/**
 * Scout's score as a fraction, or undefined when the note has none.
 *
 * A film not out yet sorts by its hype, the number its card shows in the
 * score's place, so a run of upcoming films is ordered and not alphabetical.
 * Zero is nobody having voted rather than a verdict — the same guard the cards
 * make — so an unreleased film without a hype still sinks to the bottom.
 */
function sourceFraction(entry: LibraryEntry): number | undefined {
	const score = exactScoutOrHypeOfEntry(entry);
	return score === undefined ? undefined : Math.min(score / 10, 1);
}

/** A date property as a timestamp, or undefined when it is missing or unreadable. */
export function dateStamp(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** When something came out, or comes out, as a timestamp. */
function releaseStamp(entry: LibraryEntry): number | undefined {
	const exact = dateStamp(entry.releaseDate);
	if (exact !== undefined) return exact;
	return entry.year ? Date.UTC(entry.year, 0, 1) : undefined;
}

function progressRatio(entry: LibraryEntry): number {
	if (entry.progress === undefined) return -1;
	if (!entry.progressTotal) return entry.progress;
	return entry.progress / entry.progressTotal;
}

/** Sorts a copy; entries missing the sort key always sink to the bottom. */
export function sortEntries(
	entries: readonly LibraryEntry[],
	sortBy: LibrarySort,
	config: LibraryConfig,
): LibraryEntry[] {
	const out = [...entries];
	const byTitle = (a: LibraryEntry, b: LibraryEntry) =>
		compareText(a.title, b.title);
	/**
	 * Proportional, so a book out of five is not beaten by every film out of
	 * ten. `missing` is the value entries with no score at all take, chosen by
	 * the caller so they sink to the bottom whichever direction the sort runs.
	 *
	 * Falling back to the source's score is what stops a backlog from ordering
	 * itself alphabetically: most of a library is unrated, and "the highest
	 * rated thing I have not seen" is the question this sort is usually being
	 * asked. Scout scores are always out of ten, whatever scale the notes use,
	 * and on one curve, so a film and a book sort fairly against each other.
	 */
	const rank = (entry: LibraryEntry, missing: number) =>
		ratingFraction(config, entry.kind, entry.rating) ??
		sourceFraction(entry) ??
		missing;
	// Your own verdict outranks a borrowed one when the two land on the same
	// number, so a film you gave 8 sits above a film the internet gave 8.
	const mine = (entry: LibraryEntry) => (entry.rating !== undefined ? 1 : 0);
	/**
	 * And when your own verdicts agree, the world's breaks the tie.
	 *
	 * A library sorted by what you thought of it is mostly ties — everything you
	 * liked is an 8 — and under them the order fell through to the alphabet,
	 * which is not an opinion about anything. `rank` already reaches for the
	 * source's score, but only for entries you never scored yourself, so between
	 * two of your own 8s it had nothing left to say.
	 */
	const theirs = (entry: LibraryEntry, missing: number) =>
		sourceFraction(entry) ?? missing;

	/**
	 * Keys are worked out inside the comparator rather than cached against each
	 * entry first: a `Map` keyed by object was measured at three times the cost
	 * of simply doing the arithmetic again, because these keys are a subtraction
	 * and a lookup in a Map is not.
	 */

	switch (sortBy) {
		case "title":
			out.sort(byTitle);
			break;
		case "title-desc":
			out.sort((a, b) => byTitle(b, a));
			break;
		case "added":
			// When the note was made, not when it was last touched — the order
			// you built the library in, which "recent" loses the moment you
			// rate something old.
			out.sort((a, b) => b.created - a.created);
			break;
		case "added-asc":
			out.sort((a, b) => a.created - b.created);
			break;
		case "recent-asc":
			// What has sat untouched longest — the forgotten end of the pile.
			out.sort((a, b) => a.modified - b.modified);
			break;
		case "source-desc":
			out.sort(
				(a, b) => theirs(b, -1) - theirs(a, -1) || byTitle(a, b),
			);
			break;
		case "source-asc":
			out.sort((a, b) => theirs(a, 2) - theirs(b, 2) || byTitle(a, b));
			break;
		case "finished-desc":
		case "finished-asc": {
			// Decorated, because a date has to be parsed and a comparator would
			// parse each one dozens of times. Unfinished things sink either way.
			const down = sortBy === "finished-desc";
			const ranked = out.map((entry) => ({ entry, at: dateStamp(entry.finished) }));
			ranked.sort((a, b) => {
				if (a.at === undefined || b.at === undefined) {
					return (
						(a.at === undefined ? 1 : 0) - (b.at === undefined ? 1 : 0) ||
						byTitle(a.entry, b.entry)
					);
				}
				return (down ? b.at - a.at : a.at - b.at) || byTitle(a.entry, b.entry);
			});
			return ranked.map((one) => one.entry);
		}
		case "rating-desc":
			out.sort(
				(a, b) =>
					rank(b, -1) - rank(a, -1) ||
					mine(b) - mine(a) ||
					theirs(b, -1) - theirs(a, -1) ||
					byTitle(a, b),
			);
			break;
		case "rating-asc":
			out.sort(
				(a, b) =>
					rank(a, 2) - rank(b, 2) ||
					mine(b) - mine(a) ||
					theirs(a, 2) - theirs(b, 2) ||
					byTitle(a, b),
			);
			break;
		case "year-desc":
		case "year-asc": {
			// By release date where the note has one, so "coming soon" runs in
			// the order things arrive; otherwise by the start of the year.
			// Decorated, because a date has to be parsed. Undated sinks either way.
			const down = sortBy === "year-desc";
			const ranked = out.map((entry) => ({ entry, at: releaseStamp(entry) }));
			ranked.sort((a, b) => {
				if (a.at === undefined || b.at === undefined) {
					return (
						(a.at === undefined ? 1 : 0) - (b.at === undefined ? 1 : 0) ||
						byTitle(a.entry, b.entry)
					);
				}
				return (down ? b.at - a.at : a.at - b.at) || byTitle(a.entry, b.entry);
			});
			return ranked.map((one) => one.entry);
		}
		case "status": {
			/**
			 * The one key worth working out in advance: it costs a lowercase and
			 * two map lookups, and a sort would otherwise ask for it a hundred
			 * thousand times over a library of five. Decorated into a parallel
			 * array rather than a `Map` keyed by entry — see above.
			 */
			const rankOf = statusRanks(config);
			const ranked = out.map((entry) => ({ entry, key: rankOf(entry) }));
			ranked.sort(
				(a, b) => a.key - b.key || byTitle(a.entry, b.entry),
			);
			return ranked.map((one) => one.entry);
		}
		case "progress":
			out.sort((a, b) => progressRatio(b) - progressRatio(a) || byTitle(a, b));
			break;
		default:
			// "recent" — most recently edited first, which is what you just touched.
			out.sort((a, b) => b.modified - a.modified);
			break;
	}
	return out;
}

/* -------------------------------------------------------------------- stats */

export interface LibraryStats {
	total: number;
	byKind: { kind: MediaKind; count: number }[];
	rated: number;
	/** On the default scale, whatever scales the individual notes use. */
	averageRating: number | null;
	favorites: number;
	inProgress: number;
	finished: number;
}

export function libraryStats(
	entries: readonly LibraryEntry[],
	config: LibraryConfig,
): LibraryStats {
	const inProgressSet = new Set(splitList(config.inProgressStatuses).map(lower));
	const finishedSet = new Set(splitList(config.finishedStatuses).map(lower));

	const counts = new Map<MediaKind, number>();
	let ratingSum = 0;
	let rated = 0;
	let favorites = 0;
	let inProgress = 0;
	let finished = 0;

	for (const entry of entries) {
		counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
		const fraction = ratingFraction(config, entry.kind, entry.rating);
		if (fraction !== undefined) {
			rated++;
			ratingSum += fraction;
		}
		if (entry.favorite) favorites++;
		const status = entry.status ? lower(entry.status) : "";
		if (inProgressSet.has(status)) inProgress++;
		if (finishedSet.has(status)) finished++;
	}

	return {
		total: entries.length,
		byKind: [...counts.entries()]
			.map(([kind, count]) => ({ kind, count }))
			.sort((a, b) => b.count - a.count),
		rated,
		averageRating:
			rated > 0 ? (ratingSum / rated) * config.ratingScale : null,
		favorites,
		inProgress,
		finished,
	};
}

export { collectTags } from "./facets";
