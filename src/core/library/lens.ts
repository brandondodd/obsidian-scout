import type { MediaKind } from "../types";
import type { LibraryGroupBy, LibrarySort, StatusTone } from "./config";
import { emptyQuery, queryRule, type QueryFilters } from "./query";
import { emptyRule, mergeRules, ruleIsEmpty, type Condition, type RuleGroup } from "./rules";

/**
 * A lens: what the library is showing — filters, order and grouping.
 *
 * The toolbar edits one, and a saved view is one with a name. Views are still
 * stored as rules, so anything the rule editor can say stays sayable; opening a
 * view reads its rule back into the toolbar's filters, and whatever part of it
 * the toolbar has no control for is carried along untouched as `extra`. So the
 * view you open is the view you edit, in the same place you made it.
 */

export type LensFilters = QueryFilters;

export interface Lens {
	filters: LensFilters;
	/** Conditions the toolbar cannot show, kept as they were. */
	extra: RuleGroup;
	sortBy: LibrarySort;
	groupBy: LibraryGroupBy;
}

export function emptyFilters(): LensFilters {
	const { text: _text, sortBy: _sort, groupBy: _group, ...filters } = emptyQuery({
		sortBy: "recent",
		groupBy: "none",
	});
	return filters;
}

const split = (value: string | undefined) =>
	(value ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);

const num = (value: string | undefined): number | undefined => {
	const parsed = Number(value);
	return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * A rule, read back into filters.
 *
 * The inverse of `queryRule`: everything it writes is read here, and anything
 * else — an "any" rule at the top, a property condition, a second year range —
 * is left in `extra`, which still applies.
 */
export function filtersFromRule(rule: RuleGroup): { filters: LensFilters; extra: RuleGroup } {
	const filters = emptyFilters();
	const extra: RuleGroup = emptyRule();
	if (ruleIsEmpty(rule)) return { filters, extra };
	if (rule.match !== "all") return { filters, extra: rule };

	/** Genre conditions, each one a set the entry needs any of. */
	const genreSets: { values: string[]; source: Condition | RuleGroup }[] = [];

	const absorb = (c: Condition): boolean => {
		const values = split(c.value);
		switch (`${c.field}/${c.op}`) {
			case "kind/is":
				if (filters.kinds.length > 0 || values.length === 0) return false;
				filters.kinds = values as MediaKind[];
				return true;
			case "status/is":
				if (filters.statuses.length > 0 || values.length === 0) return false;
				filters.statuses = values;
				return true;
			case "tone/is":
				if (filters.tones.length > 0 || values.length === 0) return false;
				filters.tones = values.map((v) => v.toLowerCase()) as StatusTone[];
				return true;
			case "genre/has":
				if (values.length === 0) return false;
				genreSets.push({ values, source: c });
				return true;
			case "genre/has-not":
				filters.notTags.push(...values);
				return values.length > 0;
			case "person/has":
				if (filters.people.length > 0 || values.length === 0) return false;
				filters.people = values;
				return true;
			case "collection/has":
				if (values.length !== 1) return false;
				filters.collections.push(values[0] as string);
				return true;
			case "favorite/is":
				if (["false", "no", "0"].includes((c.value ?? "true").toLowerCase())) return false;
				filters.favoritesOnly = true;
				return true;
			case "rating/gte": {
				const at = num(c.value);
				if (at === undefined || filters.minRating > 0) return false;
				filters.minRating = at;
				return true;
			}
			case "rating/set":
				if (filters.rated !== "any") return false;
				filters.rated = "rated";
				return true;
			case "rating/unset":
				if (filters.rated !== "any") return false;
				filters.rated = "unrated";
				return true;
			case "sourceRating/gte": {
				const at = num(c.value);
				if (at === undefined || filters.minSource > 0) return false;
				filters.minSource = at;
				return true;
			}
			case "year/between": {
				const a = num(c.value);
				const b = num(c.value2);
				if (a === undefined || b === undefined) return false;
				if (filters.yearFrom !== null || filters.yearTo !== null) return false;
				filters.yearFrom = Math.min(a, b);
				filters.yearTo = Math.max(a, b);
				return true;
			}
			case "year/gte": {
				const a = num(c.value);
				if (a === undefined || filters.yearFrom !== null) return false;
				filters.yearFrom = a;
				return true;
			}
			case "year/lte": {
				const a = num(c.value);
				if (a === undefined || filters.yearTo !== null) return false;
				filters.yearTo = a;
				return true;
			}
			case "added/within": {
				const days = num(c.value);
				if (days === undefined || filters.addedWithin > 0) return false;
				filters.addedWithin = days;
				return true;
			}
			case "released/is":
				if (filters.release !== "any") return false;
				filters.release = ["false", "no", "0"].includes((c.value ?? "true").toLowerCase())
					? "upcoming"
					: "out";
				return true;
			default:
				return false;
		}
	};

	/** An "any" group of one field's single values: "Movie or TV", "Drama or Crime". */
	const absorbGroup = (g: RuleGroup): boolean => {
		if (g.match !== "any" || g.groups.length > 0 || g.conditions.length === 0) return false;
		const first = g.conditions[0] as Condition;
		const same = g.conditions.every(
			(c) => c.field === first.field && c.op === first.op && split(c.value).length === 1,
		);
		if (!same) return false;
		const values = g.conditions.flatMap((c) => split(c.value));
		const as = { ...first, value: values.join(", ") };
		if (first.field === "genre" && first.op === "has") {
			genreSets.push({ values, source: g });
			return true;
		}
		if (["kind/is", "status/is", "tone/is", "person/has"].includes(`${first.field}/${first.op}`)) {
			return absorb(as);
		}
		return false;
	};

	for (const c of rule.conditions) if (!absorb(c)) extra.conditions.push(c);
	for (const g of rule.groups) if (!absorbGroup(g)) extra.groups.push(g);

	if (genreSets.length === 1) {
		filters.tags = (genreSets[0] as { values: string[] }).values;
		filters.genreMatch = "any";
	} else if (genreSets.length > 1 && genreSets.every((set) => set.values.length === 1)) {
		filters.tags = genreSets.map((set) => set.values[0] as string);
		filters.genreMatch = "all";
	} else {
		// "Drama or Crime, and also Thriller" is more than the toolbar can say.
		for (const set of genreSets) {
			if ("field" in set.source) extra.conditions.push(set.source);
			else extra.groups.push(set.source);
		}
	}

	return { filters, extra };
}

/** The rule a lens's filters and extra conditions make together. */
export function lensRule(filters: LensFilters, extra: RuleGroup): RuleGroup {
	return mergeRules(queryRule(filters), extra);
}

/** Whether two sets of filters say the same thing. */
export function sameFilters(a: LensFilters, b: LensFilters): boolean {
	const keys = Object.keys(a) as (keyof LensFilters)[];
	return keys.every((key) => {
		const x = a[key];
		const y = b[key];
		if (Array.isArray(x) && Array.isArray(y)) {
			if (x.length !== y.length) return false;
			const lower = (values: readonly string[]) => values.map((v) => v.toLowerCase()).sort();
			const [p, q] = [lower(x), lower(y)];
			return p.every((value, at) => value === q[at]);
		}
		return x === y;
	});
}
