import type { MediaKind } from "../types";
import type {
	LibraryConfig,
	LibraryGroupBy,
	LibrarySort,
	StatusTone,
} from "./config";
import type { Condition, RuleGroup } from "./rules";

/**
 * What the library's filter row is asking.
 *
 * Every filter here has a rule condition that means the same thing, and the
 * library filters by building that rule (`queryRule`) and running it — the
 * same code a saved view runs. So "New view" keeps exactly what was on screen,
 * and a filter added here is a filter a view can hold.
 *
 * Within one kind of filter, choices are alternatives: Films or TV, To watch or
 * Watching. Across kinds they all have to hold. Genres are the exception you
 * can flip, because "sci-fi and horror" and "sci-fi or horror" are both things
 * people mean.
 */
export interface LibraryQuery {
	text: string;
	/** Any of these. Empty means every kind. */
	kinds: MediaKind[];
	/** Any of these, matched case-insensitively. */
	statuses: string[];
	/** Any of these — the shared states behind each kind's own status words. */
	tones: StatusTone[];
	/** Genres to include. */
	tags: string[];
	/** Whether an entry needs one of `tags`, or every one. */
	genreMatch: "any" | "all";
	/** Genres to leave out. */
	notTags: string[];
	/** Any of these people. */
	people: string[];
	/** Every one of these collections. */
	collections: string[];
	/** Any of these moods, from the notes' own `moods` property. */
	moods: string[];
	favoritesOnly: boolean;
	/**
	 * On the default scale, compared proportionally — 4 out of 5 keeps a film
	 * rated 8 out of 10. 0 is off; unrated entries never pass a minimum.
	 */
	minRating: number;
	rated: "any" | "rated" | "unrated";
	/** The source's score, out of ten. 0 is off. */
	minSource: number;
	yearFrom: number | null;
	yearTo: number | null;
	/** Added within this many days. 0 is off. */
	addedWithin: number;
	release: "any" | "out" | "upcoming";
	sortBy: LibrarySort;
	groupBy: LibraryGroupBy;
}

/** The filters alone: everything but the search box, the sort and the grouping. */
export type QueryFilters = Omit<LibraryQuery, "text" | "sortBy" | "groupBy">;

export function emptyQuery(config: Pick<LibraryConfig, "sortBy" | "groupBy">): LibraryQuery {
	return {
		text: "",
		kinds: [],
		statuses: [],
		tones: [],
		tags: [],
		genreMatch: "any",
		notTags: [],
		people: [],
		collections: [],
		moods: [],
		favoritesOnly: false,
		minRating: 0,
		rated: "any",
		minSource: 0,
		yearFrom: null,
		yearTo: null,
		addedWithin: 0,
		release: "any",
		sortBy: config.sortBy,
		groupBy: config.groupBy,
	};
}

/** A query that may have been saved by an older build, filled out. */
export function completeQuery(
	partial: Partial<LibraryQuery>,
	config: Pick<LibraryConfig, "sortBy" | "groupBy">,
): LibraryQuery {
	return { ...emptyQuery(config), ...partial };
}

/** A comma inside a value would read as two values, so it is never joined. */
const joinable = (values: readonly string[]) => values.every((value) => !value.includes(","));

/**
 * The filters as a rule, without the text box.
 *
 * The text box is left to the caller because it searches title, people and
 * genres at once, which no single condition says. `ruleFromQuery` in views.ts
 * adds it back as a title condition when a view is saved.
 */
export function queryRule(query: QueryFilters): RuleGroup {
	const conditions: Condition[] = [];
	const groups: RuleGroup[] = [];

	/** One condition for one value, an "any" group for several. */
	const anyOf = (values: readonly string[], make: (value: string) => Condition) => {
		if (values.length === 0) return;
		if (values.length === 1) {
			conditions.push(make(values[0] as string));
			return;
		}
		groups.push({ match: "any", conditions: values.map(make), groups: [] });
	};

	anyOf(query.kinds, (value) => ({ field: "kind", op: "is", value }));
	anyOf(query.statuses, (value) => ({ field: "status", op: "is", value }));
	anyOf(query.tones, (value) => ({ field: "tone", op: "is", value }));

	if (query.tags.length > 0) {
		if (query.genreMatch === "all" || !joinable(query.tags)) {
			if (query.genreMatch === "all") {
				for (const tag of query.tags) conditions.push({ field: "genre", op: "has", value: tag });
			} else {
				anyOf(query.tags, (value) => ({ field: "genre", op: "has", value }));
			}
		} else {
			// `has` with a list is already "any of", and reads back as one line.
			conditions.push({ field: "genre", op: "has", value: query.tags.join(", ") });
		}
	}
	for (const tag of query.notTags) {
		conditions.push({ field: "genre", op: "has-not", value: tag });
	}
	if (query.people.length > 0) {
		if (joinable(query.people)) {
			conditions.push({ field: "person", op: "has", value: query.people.join(", ") });
		} else {
			anyOf(query.people, (value) => ({ field: "person", op: "has", value }));
		}
	}
	for (const name of query.collections) {
		conditions.push({ field: "collection", op: "has", value: name });
	}
	if (query.moods.length > 0) {
		if (joinable(query.moods)) {
			conditions.push({ field: "mood", op: "has", value: query.moods.join(", ") });
		} else {
			anyOf(query.moods, (value) => ({ field: "mood", op: "has", value }));
		}
	}
	if (query.favoritesOnly) conditions.push({ field: "favorite", op: "is", value: "true" });
	if (query.minRating > 0) {
		conditions.push({ field: "rating", op: "gte", value: String(query.minRating) });
	} else if (query.rated === "rated") {
		conditions.push({ field: "rating", op: "set" });
	}
	if (query.rated === "unrated") conditions.push({ field: "rating", op: "unset" });
	if (query.minSource > 0) {
		conditions.push({ field: "sourceRating", op: "gte", value: String(query.minSource) });
	}
	if (query.yearFrom !== null && query.yearTo !== null) {
		conditions.push({
			field: "year",
			op: "between",
			value: String(query.yearFrom),
			value2: String(query.yearTo),
		});
	} else if (query.yearFrom !== null) {
		conditions.push({ field: "year", op: "gte", value: String(query.yearFrom) });
	} else if (query.yearTo !== null) {
		conditions.push({ field: "year", op: "lte", value: String(query.yearTo) });
	}
	if (query.addedWithin > 0) {
		conditions.push({ field: "added", op: "within", value: String(query.addedWithin) });
	}
	if (query.release !== "any") {
		conditions.push({
			field: "released",
			op: "is",
			value: query.release === "out" ? "true" : "false",
		});
	}

	return { match: "all", conditions, groups };
}

/** How many filters are on, text aside — the number on the Filters button. */
export function activeFilterCount(query: QueryFilters): number {
	return (
		query.kinds.length +
		query.statuses.length +
		query.tones.length +
		query.tags.length +
		query.notTags.length +
		query.people.length +
		query.collections.length +
		query.moods.length +
		(query.favoritesOnly ? 1 : 0) +
		(query.minRating > 0 || query.rated !== "any" ? 1 : 0) +
		(query.minSource > 0 ? 1 : 0) +
		(query.yearFrom !== null || query.yearTo !== null ? 1 : 0) +
		(query.addedWithin > 0 ? 1 : 0) +
		(query.release !== "any" ? 1 : 0)
	);
}

/** Whether the toolbar is narrowing anything, sort and grouping aside. */
export function queryIsNarrowed(query: LibraryQuery): boolean {
	return query.text.trim() !== "" || activeFilterCount(query) > 0;
}
