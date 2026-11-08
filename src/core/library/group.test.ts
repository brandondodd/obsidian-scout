import { describe, expect, it } from "vitest";
import { defaultLibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import { genreFacets, peopleFacets, yearRange } from "./facets";
import { sortEntries } from "./filter";
import { groupEntries } from "./group";
import { activeFilterCount, emptyQuery, queryRule } from "./query";

const config = defaultLibraryConfig();

function entry(title: string, overrides: Partial<LibraryEntry> = {}): LibraryEntry {
	return {
		path: `Media/${title}.md`,
		basename: title,
		title,
		kind: "movie",
		tags: [],
		people: [],
		authored: [],
		favorite: false,
		history: [],
		episodeLog: {},
		collections: [],
		created: 0,
		modified: 0,
		frontmatter: {},
		...overrides,
	};
}

const labels = (groups: { label: string }[]) => groups.map((g) => g.label);

describe("groupEntries", () => {
	it("groups by what a status means, in reading order", () => {
		const set = [
			entry("A", { status: "Watched" }),
			entry("B", { kind: "book", status: "Reading" }),
			entry("C", { status: "Watching" }),
			entry("D", { status: "To watch" }),
			entry("E"),
		];
		const groups = groupEntries(set, "tone", config);
		expect(labels(groups)).toEqual(["In progress", "Not started", "Finished", "No status"]);
		expect(groups[0]?.entries.map((e) => e.title)).toEqual(["B", "C"]);
	});

	it("puts what is coming before what is out", () => {
		const now = new Date("2026-06-01");
		const set = [
			entry("Out", { year: 2020 }),
			entry("Soon", { releaseDate: "2026-12-01", year: 2026 }),
			entry("Unknown"),
		];
		expect(labels(groupEntries(set, "release", config, now))).toEqual([
			"Coming soon",
			"Out now",
			"Date unknown",
		]);
	});

	it("groups by month added, newest first", () => {
		const set = [
			entry("Jan", { created: new Date(2026, 0, 5).getTime() }),
			entry("Mar", { created: new Date(2026, 2, 5).getTime() }),
		];
		expect(labels(groupEntries(set, "added", config))).toEqual(["March 2026", "January 2026"]);
	});

	it("bands source scores and leaves the unscored last", () => {
		const set = [
			entry("Low", { sourceRating: 3 }),
			entry("High", { sourceRating: 9 }),
			entry("None", { sourceRating: 0 }),
		];
		expect(labels(groupEntries(set, "source", config))).toEqual([
			"8 and up",
			"Below 5",
			"No score",
		]);
	});

	it("groups by year finished", () => {
		const set = [
			entry("A", { finished: "2024-05-01" }),
			entry("B", { finished: "2025-01-01" }),
			entry("C"),
		];
		expect(labels(groupEntries(set, "finished", config))).toEqual([
			"2025",
			"2024",
			"Not finished",
		]);
	});

	it("groups by Scout's genres, and by main genre once each", () => {
		const set = [
			entry("A", { kind: "book", tags: ["Urban fantasy"], ref: { provider: "x", id: "1" } as never }),
			entry("B", { kind: "book", tags: ["Fantasy"] }),
		];
		expect(labels(groupEntries(set, "genre", config))).toEqual(["Fantasy", "Urban fantasy"]);
		const main = groupEntries(set, "genre-main", config);
		expect(labels(main)).toEqual(["Fantasy"]);
		expect(main[0]?.entries).toHaveLength(2);
	});
});

describe("sortEntries, the newer ways", () => {
	it("sorts by source score and by date finished, missing last", () => {
		const set = [
			entry("A", { sourceRating: 6, finished: "2024-01-01" }),
			entry("B", { sourceRating: 9 }),
			entry("C", { finished: "2025-01-01" }),
		];
		const titles = (sort: Parameters<typeof sortEntries>[1]) =>
			sortEntries(set, sort, config).map((e) => e.title);
		expect(titles("source-desc")).toEqual(["B", "A", "C"]);
		expect(titles("source-asc")).toEqual(["A", "B", "C"]);
		expect(titles("finished-desc")).toEqual(["C", "A", "B"]);
		expect(titles("finished-asc")).toEqual(["A", "C", "B"]);
	});
});

describe("facets", () => {
	it("keeps each family's genres apart, sub-genres under their main genre", () => {
		const set = [
			entry("Film", { tags: ["Science fiction", "Cyberpunk"] }),
			entry("Book", { kind: "book", tags: ["Science fiction"] }),
			entry("Album", { kind: "album", tags: ["Indie rock"] }),
		];
		const families = genreFacets(set);
		expect(families.map((f) => f.label)).toEqual(["Film & TV", "Books", "Music"]);
		const screen = families[0]?.genres.find((g) => g.label === "Science fiction");
		expect(screen?.count).toBe(1);
		expect(screen?.subs.map((s) => s.label)).toContain("Cyberpunk");
		expect(families[2]?.genres[0]).toMatchObject({ label: "Rock", count: 1 });
	});

	it("counts people and finds the year range", () => {
		const set = [
			entry("A", { people: ["Ann"], year: 1990 }),
			entry("B", { people: ["Ann", "Bob"], year: 2010 }),
		];
		expect(peopleFacets(set)[0]).toEqual({ label: "Ann", count: 2 });
		expect(yearRange(set)).toEqual({ min: 1990, max: 2010 });
		expect(yearRange([entry("C")])).toBeNull();
	});
});

describe("queryRule", () => {
	it("says nothing for an empty query", () => {
		const rule = queryRule(emptyQuery(config));
		expect(rule.conditions).toHaveLength(0);
		expect(rule.groups).toHaveLength(0);
	});

	it("counts the filters that are on", () => {
		expect(
			activeFilterCount({
				...emptyQuery(config),
				kinds: ["movie"],
				tags: ["Drama", "Crime"],
				release: "upcoming",
			}),
		).toBe(4);
	});
});
