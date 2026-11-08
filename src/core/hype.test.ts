import { describe, expect, it } from "vitest";
import { hypeOf, hypeOfEntry, hypeOfItem, type Outlook } from "./hype";
import type { MediaItem } from "./types";

const NOW = new Date(2026, 10, 8).getTime();
const SOON = { releaseDate: "2027-06-16" };

/** What TMDB knew of each, 8 November 2026. */
const ANIMATED = ["Animation", "Action", "Adventure", "Science Fiction"];
const BEYOND: Outlook = {
	series: {
		name: "Spider-Man: Spider-Verse Collection",
		films: [
			{ title: "Spider-Man: Into the Spider-Verse", rating: 8.403 },
			{ title: "Spider-Man: Across the Spider-Verse", rating: 8.349 },
		],
	},
	directors: {
		names: ["Bob Persichetti", "Justin K. Thompson"],
		films: [
			{ title: "Spider-Man: Into the Spider-Verse", rating: 8.403, genres: ANIMATED, released: "2018-12-06" },
			{ title: "Spider-Man: Across the Spider-Verse", rating: 8.349, genres: ANIMATED, released: "2023-05-31" },
		],
	},
	genres: ["Animation", "Action", "Adventure", "Science Fiction"],
	budget: 125_000_000,
};
const MINECRAFT: Outlook = {
	series: { name: "A Minecraft Movie Collection", films: [{ title: "A Minecraft Movie", rating: 6.192 }] },
	directors: {
		names: ["Jared Hess"],
		films: [6.9, 5.8, 6.2, 5.5, 6.3, 5.9, 6.2].map((rating) => ({ title: "", rating, genres: ["Comedy"] })),
	},
	genres: ["Family", "Fantasy", "Comedy", "Adventure"],
};
/** Zach Cregger's next: a horror director whose last two films were among horror's best. */
const CREGGER: Outlook = {
	directors: {
		names: ["Zach Cregger"],
		films: [
			{ title: "Miss March", rating: 5.525, genres: ["Comedy"], released: "2009-03-13" },
			{ title: "Barbarian", rating: 7.262, genres: ["Horror", "Thriller"], released: "2022-09-08" },
			{ title: "Weapons", rating: 7.445, genres: ["Horror", "Mystery"], released: "2025-08-06" },
		],
	},
	genres: ["Horror", "Action"],
};
const NOTHING: Outlook = { genres: [] };

const hype = (outlook: Outlook) => hypeOf(outlook, SOON, NOW)?.value ?? 0;

describe("hypeOf", () => {
	it("expects a sequel to great films to be great, and one to a weak film to be weak", () => {
		expect(hype(BEYOND)).toBeGreaterThan(8.2);
		expect(hype(MINECRAFT)).toBeLessThan(6.3);
	});

	it("expects a director with recent hits to make another, an old miss notwithstanding", () => {
		expect(hype(CREGGER)).toBeGreaterThan(7.5);
		expect(hype(CREGGER)).toBeGreaterThan(hype({ genres: CREGGER.genres }) + 0.6);
	});

	it("trusts a series whose films have agreed more than one that has swung about", () => {
		const series = (ratings: number[]): Outlook => ({
			series: { name: "S", films: ratings.map((rating, at) => ({ title: `Part ${at + 1}`, rating, votes: 9000 })) },
			genres: [],
		});
		// The same latest film and the same average, one series steady, one not.
		expect(hype(series([8.4, 8.4]))).toBeGreaterThan(hype(series([7.4, 9.4, 8.4])) + 0.15);
		// A single film shows no agreement either way.
		expect(hypeOf(series([8.4]), SOON, NOW)?.steps[0]?.by).toBeLessThan(hype(series([8.4, 8.4])) - 7.3);
	});

	it("does not count a series' films again under their directors", () => {
		const steps = hypeOf(BEYOND, SOON, NOW)?.steps.map((one) => one.reason);
		expect(steps).not.toContain("directors");
		// Still below the films it follows: hype is a forecast, not a promise.
		expect(hype(BEYOND)).toBeLessThan(9);
	});

	it("counts one great film for less than a run of them", () => {
		const made = (ratings: number[]): Outlook => ({
			directors: {
				names: ["D"],
				films: ratings.map((rating, at) => ({ title: `Film ${at}`, rating, released: "2025-01-01", votes: 9000 })),
			},
			genres: [],
		});
		const lift = (ratings: number[]) => hype(made(ratings)) - hype(NOTHING);
		expect(lift([8])).toBeGreaterThan(0);
		expect(lift([8])).toBeLessThan(lift([8, 8]) * 0.85);
	});

	it("trusts a series more when its director comes back for the next", () => {
		const sequel = (director: string): Outlook => ({
			series: { name: "M", films: [{ title: "First", rating: 6.2, votes: 9000 }] },
			directors: { names: [director], films: [{ title: director === "same" ? "First" : "Other", rating: 6.2, votes: 9000 }] },
			genres: [],
		});
		// The same team's weak first film says more about its second.
		expect(hype(sequel("same"))).toBeLessThan(hypeOf({ ...sequel("same"), directors: undefined }, SOON, NOW)?.value ?? 0);
	});

	it("believes an earlier film by how many have rated it", () => {
		const director = (votes: number): Outlook => ({
			directors: {
				names: ["Curry Barker"],
				films: [{ title: "Obsession", rating: 8.171, genres: ["Horror"], released: "2026-05-13", votes }],
			},
			genres: ["Horror", "Comedy"],
		});
		expect(hype(director(6534))).toBeGreaterThan(hype(director(60)) + 0.5);
	});

	it("expects a typical film when nothing is known", () => {
		const typical = hypeOf(NOTHING, SOON, NOW);
		expect(typical?.value).toBeCloseTo(7.3, 1);
		expect(typical?.steps).toEqual([]);
	});

	it("adds up: a typical film and each step make the value", () => {
		const worked = hypeOf(BEYOND, SOON, NOW);
		if (!worked) throw new Error("no hype");
		const sum = worked.steps.reduce((total, one) => total + one.by, worked.typical);
		expect(sum).toBeCloseTo(worked.value, 9);
		// A sequel's budget is already in its series' scores.
		// Nor its directors: their only films are the series, counted once.
		expect(worked.steps.map((one) => one.reason)).toEqual(["series", "genres"]);
		const original = hypeOf({ ...BEYOND, series: undefined }, SOON, NOW);
		expect(original?.steps.map((one) => one.reason)).toEqual(["directors", "genres", "budget"]);
	});

	it("reads horror with the lift Scout gives it, in the genre step", () => {
		const horror = hypeOf({ genres: ["Horror"] }, SOON, NOW);
		const thriller = hypeOf({ genres: ["Thriller"] }, SOON, NOW);
		// TMDB's horror runs well below its thrillers; Scout's lift puts most of that back.
		expect(Math.abs((horror?.value ?? 0) - (thriller?.value ?? 0))).toBeLessThan(0.3);
	});

	it("counts a small budget up and a vast one a little down", () => {
		const middling = hype({ genres: [], budget: 100_000_000 });
		expect(hype({ genres: [], budget: 5_000_000 })).toBeGreaterThan(middling);
		expect(hype({ genres: [], budget: 400_000_000 })).toBeLessThan(middling);
		// A placeholder is no budget.
		expect(hype({ genres: [], budget: 1_000 })).toBe(hype(NOTHING));
	});

	it("has nothing to say about a film that is out, or one nobody has looked into", () => {
		expect(hypeOf(BEYOND, { releaseDate: "2026-10-01" }, NOW)).toBeUndefined();
		expect(hypeOf(undefined, SOON, NOW)).toBeUndefined();
	});
});

describe("hypeOfEntry and hypeOfItem", () => {
	const upcoming = {
		kind: "movie" as const,
		ref: { providerId: "tmdb" },
		sourceRating: 8,
		...SOON,
		outlook: BEYOND,
	};

	it("gives a film with no Scout score its hype, to one decimal", () => {
		const value = hypeOfEntry(upcoming, NOW);
		expect(value).toBe(Math.round(hype(BEYOND) * 10) / 10);
	});

	it("gives nothing beside a Scout score, or to a series", () => {
		const reviewed = { ...upcoming, readings: [{ source: "metacritic", value: 8 }] };
		expect(hypeOfEntry(reviewed, NOW)).toBeUndefined();
		expect(hypeOfEntry({ ...upcoming, kind: "tv" }, NOW)).toBeUndefined();
	});

	it("reads a search result's hype from what Scout has filed for it", () => {
		const item = {
			ref: { providerId: "tmdb", kind: "movie", id: "911916" },
			title: "Spider-Man: Beyond the Spider-Verse",
			rating: 8,
			ratingCount: 7,
			tags: [],
			people: [],
			extra: {},
			...SOON,
		} as MediaItem;
		const filed = { "tmdb:movie:911916": { readings: [], at: 0, outlook: { ...BEYOND, at: NOW } } };
		expect(hypeOfItem(item, filed, NOW)).toBe(hypeOfEntry(upcoming, NOW));
		expect(hypeOfItem(item, {}, NOW)).toBeUndefined();
	});
});
