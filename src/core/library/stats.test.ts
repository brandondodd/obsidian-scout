import { describe, expect, it } from "vitest";
import { entry, testConfig } from "../../test/fixtures";
import { buildStats, completions, statsYears } from "./stats";

const NOW = new Date(2025, 5, 15);

const library = [
	entry({
		title: "Arrival",
		kind: "movie",
		status: "Watched",
		rating: 9,
		finished: "2025-03-10",
		history: ["2023-01-05"],
		tags: ["Science Fiction", "Drama"],
		authored: ["Denis Villeneuve"],
		frontmatter: { runtime: 116 },
	}),
	entry({
		title: "Heat",
		kind: "movie",
		status: "Watched",
		rating: 7,
		finished: "2025-03-22T20:00",
		tags: ["Crime", "Drama"],
		authored: ["Michael Mann"],
	}),
	entry({
		title: "Dune",
		kind: "book",
		status: "Read",
		rating: 10,
		finished: "2025-07-01",
		tags: ["Science Fiction"],
		frontmatter: { pages: 600 },
	}),
	entry({ title: "Ulysses", kind: "book", status: "Dropped", started: "2025-02-02" }),
	entry({
		title: "Stalker",
		kind: "movie",
		status: "To watch",
		frontmatter: { created: "2020-01-01" },
	}),
	entry({ title: "Old", kind: "book", status: "Read", rating: 4 }),
];

describe("completions", () => {
	it("counts every time through, oldest first, and marks repeats", () => {
		const list = completions(library);
		expect(list.map((one) => [one.entry.title, one.date, one.again])).toEqual([
			["Arrival", "2023-01-05", false],
			["Arrival", "2025-03-10", true],
			["Heat", "2025-03-22", false],
			["Dune", "2025-07-01", false],
		]);
		expect(statsYears(library)).toEqual([2025, 2023]);
	});
});

describe("buildStats", () => {
	const config = testConfig({ goals: { book: 12 } });
	const year = buildStats(config, library, { year: 2025, kind: null }, NOW);

	it("totals the year by kind and month", () => {
		expect(year.finished).toBe(3);
		expect(year.again).toBe(1);
		expect(year.byKind).toEqual([
			{ kind: "movie", count: 2 },
			{ kind: "book", count: 1 },
		]);
		expect(year.bars).toHaveLength(12);
		expect(year.bars[2]).toEqual({ key: "2025-03", label: "Mar", count: 2 });
	});

	it("lays the heatmap out in whole weeks from a Monday", () => {
		expect(year.heatmap.start).toBe("2024-12-30");
		expect(year.heatmap.days[0]).toBeNull();
		expect(year.heatmap.days.filter(Boolean)).toHaveLength(365);
		expect(year.heatmap.max).toBe(1);
	});

	it("only reports time it can work out, and from how much", () => {
		expect(year.time).toEqual([
			{ kind: "movie", unit: "minutes", amount: 116, known: 1, of: 2 },
			{ kind: "book", unit: "pages", amount: 600, known: 1, of: 1 },
		]);
	});

	it("compares genres with the period's average", () => {
		const drama = year.genres.find((g) => g.name === "Drama");
		const scifi = year.genres.find((g) => g.name === "Science Fiction");
		expect(year.average).toBeCloseTo((0.9 + 0.7 + 1) / 3);
		expect(drama?.count).toBe(2);
		expect(drama?.delta).toBeCloseTo(0.8 - (0.9 + 0.7 + 1) / 3);
		expect(scifi?.delta).toBeGreaterThan(0);
		expect(year.people.map((p) => p.name)).toContain("Denis Villeneuve");
	});

	it("spreads ratings on each kind's own scale", () => {
		const movies = year.ratings.find((r) => r.kind === "movie");
		expect(movies?.scale).toBe(10);
		expect(movies?.buckets).toHaveLength(10);
		expect(movies?.buckets[8]).toEqual({ upTo: 9, count: 1 });
		expect(movies?.average).toBe(8);
	});

	it("counts drops, repeats, the waiting shelf, and goals", () => {
		expect(year.dropped).toEqual({ count: 1, of: 4 });
		expect(year.replays.map((r) => [r.entry.title, r.times])).toEqual([["Arrival", 2]]);
		expect(year.shelf[0]).toMatchObject({ since: "2020-01-01" });
		expect(year.shelf[0]?.entry.title).toBe("Stalker");
		expect(year.goals).toEqual([{ kind: "book", target: 12, done: 1, year: 2025 }]);
	});

	it("reads all time from everything rated or done, one bar per year", () => {
		const ever = buildStats(config, library, { year: null, kind: "book" }, NOW);
		expect(ever.finished).toBe(1);
		expect(ever.ratings[0]).toMatchObject({ kind: "book", count: 2 });
		expect(ever.bars.map((b) => b.key)).toEqual(["2025"]);
		const films = buildStats(config, library, { year: null, kind: "movie" }, NOW);
		expect(films.bars.map((b) => [b.key, b.count])).toEqual([
			["2023", 1],
			["2024", 0],
			["2025", 2],
		]);
		expect(films.goals).toEqual([]);
	});
});
