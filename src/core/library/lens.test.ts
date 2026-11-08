import { describe, expect, it } from "vitest";
import { filterChips, suggestedName } from "./chips";
import { emptyFilters, filtersFromRule, lensRule, sameFilters, type LensFilters } from "./lens";
import { normalizeRule, type RuleGroup } from "./rules";

const filters = (overrides: Partial<LensFilters>): LensFilters => ({
	...emptyFilters(),
	...overrides,
});

describe("filtersFromRule", () => {
	it("reads back every filter the toolbar writes", () => {
		const cases: Partial<LensFilters>[] = [
			{ kinds: ["movie"], release: "upcoming" },
			{ kinds: ["movie", "tv"], tones: ["active", "paused"] },
			{ tags: ["Drama", "Crime"], genreMatch: "any" },
			{ tags: ["Drama", "Crime"], genreMatch: "all" },
			{ notTags: ["Horror"], people: ["Ann Lee", "Bo"] },
			{ minRating: 4, minSource: 7, yearFrom: 1990, yearTo: 1999 },
			{ yearFrom: 2000, rated: "unrated", addedWithin: 30, favoritesOnly: true },
			{ statuses: ["To watch"], collections: ["Cosy", "Winter"], release: "out" },
		];
		for (const one of cases) {
			const wanted = filters(one);
			const { filters: back, extra } = filtersFromRule(lensRule(wanted, { match: "all", conditions: [], groups: [] }));
			expect(sameFilters(back, wanted), JSON.stringify(one)).toBe(true);
			expect(extra.conditions, JSON.stringify(one)).toHaveLength(0);
			expect(extra.groups).toHaveLength(0);
		}
	});

	it("keeps what it cannot show, and it still applies", () => {
		const rule: RuleGroup = normalizeRule({
			match: "all",
			conditions: [
				{ field: "kind", op: "is", value: "movie" },
				{ field: "title", op: "contains", value: "star" },
			],
			groups: [],
		});
		const { filters: back, extra } = filtersFromRule(rule);
		expect(back.kinds).toEqual(["movie"]);
		expect(extra.conditions).toEqual([{ field: "title", op: "contains", value: "star" }]);
		expect(lensRule(back, extra).conditions).toHaveLength(2);
	});

	it("leaves an any-of rule whole", () => {
		const rule = normalizeRule({
			match: "any",
			conditions: [
				{ field: "kind", op: "is", value: "movie" },
				{ field: "favorite", op: "is", value: "true" },
			],
		});
		const { filters: back, extra } = filtersFromRule(rule);
		expect(sameFilters(back, emptyFilters())).toBe(true);
		expect(extra).toEqual(rule);
	});
});

describe("filterChips", () => {
	it("says each filter in plain words", () => {
		const labels = filterChips(
			filters({
				kinds: ["movie", "tv"],
				release: "upcoming",
				tags: ["Horror"],
				notTags: ["Comedy"],
				yearFrom: 1980,
				yearTo: 1989,
				addedWithin: 30,
			}),
		).map((chip) => chip.label);
		expect(labels).toEqual([
			"Movies or TV shows",
			"Coming soon",
			"Horror",
			"Not Comedy",
			"1980s",
			"Added in the last month",
		]);
	});

	it("suggests a name for a view", () => {
		expect(suggestedName(filters({ kinds: ["movie"], release: "upcoming" }))).toBe(
			"Movies · Coming soon",
		);
		expect(suggestedName(emptyFilters())).toBe("");
	});
});
