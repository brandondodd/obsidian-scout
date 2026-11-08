import { MEDIA_KIND_PLURALS } from "../types";
import type { LibraryGroupBy, LibrarySort } from "./config";
import type { LensFilters } from "./lens";
import { TONE_LABELS } from "./rules";

/**
 * The filters, as the chips that show them.
 *
 * Each chip is one plain phrase — "Movies or TV shows", "Coming soon", "Not
 * Horror" — so the filter row reads as a sentence about what you are looking
 * at, and the same phrases name a view when you save one.
 */

export type FilterCategory =
	| "type"
	| "progress"
	| "status"
	| "genre"
	| "exclude"
	| "release"
	| "year"
	| "rating"
	| "source"
	| "added"
	| "person"
	| "collection"
	| "favourite";

export interface FilterChip {
	category: FilterCategory;
	label: string;
	/** What clearing the chip changes. */
	clear: Partial<LensFilters>;
}

const either = (values: readonly string[]) => values.join(" or ");

/** "the last 30 days", in the words people use. */
export function withinLabel(days: number): string {
	switch (days) {
		case 7:
			return "the last week";
		case 30:
			return "the last month";
		case 90:
			return "the last 3 months";
		case 365:
			return "the last year";
		default:
			return `the last ${days} days`;
	}
}

export function yearLabel(from: number | null, to: number | null): string {
	if (from !== null && to !== null) {
		if (from === to) return String(from);
		if (from % 10 === 0 && to === from + 9) return `${from}s`;
		return `${from}–${to}`;
	}
	if (from !== null) return `${from} onwards`;
	if (to !== null) return `Up to ${to}`;
	return "Any year";
}

export function filterChips(filters: LensFilters): FilterChip[] {
	const out: FilterChip[] = [];
	const add = (category: FilterCategory, label: string, clear: Partial<LensFilters>) =>
		out.push({ category, label, clear });

	if (filters.kinds.length > 0) {
		add("type", either(filters.kinds.map((kind) => MEDIA_KIND_PLURALS[kind])), { kinds: [] });
	}
	if (filters.release !== "any") {
		add("release", filters.release === "upcoming" ? "Coming soon" : "Out now", {
			release: "any",
		});
	}
	if (filters.tones.length > 0) {
		add("progress", either(filters.tones.map((tone) => TONE_LABELS[tone])), { tones: [] });
	}
	if (filters.statuses.length > 0) add("status", either(filters.statuses), { statuses: [] });
	if (filters.tags.length > 0) {
		add(
			"genre",
			filters.genreMatch === "all" ? filters.tags.join(" and ") : either(filters.tags),
			{ tags: [], genreMatch: "any" },
		);
	}
	if (filters.notTags.length > 0) {
		add("exclude", `Not ${either(filters.notTags)}`, { notTags: [] });
	}
	if (filters.yearFrom !== null || filters.yearTo !== null) {
		add("year", yearLabel(filters.yearFrom, filters.yearTo), { yearFrom: null, yearTo: null });
	}
	if (filters.minRating > 0) {
		add("rating", `Rated ${filters.minRating}+`, { minRating: 0, rated: "any" });
	} else if (filters.rated !== "any") {
		add("rating", filters.rated === "rated" ? "Rated" : "Not rated", { rated: "any" });
	}
	if (filters.minSource > 0) add("source", `Scored ${filters.minSource}+`, { minSource: 0 });
	if (filters.addedWithin > 0) {
		add("added", `Added in ${withinLabel(filters.addedWithin)}`, { addedWithin: 0 });
	}
	if (filters.people.length > 0) add("person", either(filters.people), { people: [] });
	for (const name of filters.collections) {
		add("collection", `In ${name}`, {
			collections: filters.collections.filter((one) => one !== name),
		});
	}
	if (filters.favoritesOnly) add("favourite", "Favourites", { favoritesOnly: false });
	return out;
}

/** A name for a view of these filters, offered when saving one. */
export function suggestedName(filters: LensFilters): string {
	const chips = filterChips(filters);
	if (chips.length === 0) return "";
	const name = chips
		.slice(0, 3)
		.map((chip) => chip.label)
		.join(" · ");
	return name.length > 48 ? `${name.slice(0, 47)}…` : name;
}

/**
 * Starting points: the questions people ask a library most, one click each.
 *
 * Offered while nothing is filtered, as somewhere to begin rather than a list
 * to learn. Each sets filters, order and grouping together — the parts that
 * make "coming soon" useful are the soonest-first order as much as the filter.
 */
export interface Preset {
	id: string;
	label: string;
	icon: string;
	filters: Partial<LensFilters>;
	sortBy: LibrarySort;
	groupBy: LibraryGroupBy;
}

export const PRESETS: readonly Preset[] = [
	{
		id: "in-progress",
		label: "In progress",
		icon: "play",
		filters: { tones: ["active"] },
		sortBy: "recent",
		groupBy: "kind",
	},
	{
		id: "up-next",
		label: "Up next",
		icon: "list-todo",
		filters: { tones: ["planned"] },
		sortBy: "source-desc",
		groupBy: "kind",
	},
	{
		id: "coming-soon",
		label: "Coming soon",
		icon: "calendar-clock",
		filters: { release: "upcoming" },
		sortBy: "year-asc",
		groupBy: "kind",
	},
	{
		id: "finished",
		label: "Recently finished",
		icon: "check-circle-2",
		filters: { tones: ["done"] },
		sortBy: "finished-desc",
		groupBy: "finished",
	},
	{
		id: "top-rated",
		label: "Top rated",
		icon: "star",
		filters: { rated: "rated" },
		sortBy: "rating-desc",
		groupBy: "none",
	},
	{
		id: "to-rate",
		label: "Finished, not rated",
		icon: "star-off",
		filters: { tones: ["done"], rated: "unrated" },
		sortBy: "finished-desc",
		groupBy: "none",
	},
	{
		id: "favourites",
		label: "Favourites",
		icon: "heart",
		filters: { favoritesOnly: true },
		sortBy: "rating-desc",
		groupBy: "kind",
	},
	{
		id: "added",
		label: "Added this month",
		icon: "clock",
		filters: { addedWithin: 30 },
		sortBy: "added",
		groupBy: "none",
	},
];
