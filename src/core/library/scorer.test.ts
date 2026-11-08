import { describe, expect, it } from "vitest";
import type { LibraryEntry } from "./entry";
import { keepKnown, outlookDue, pruneScores, replaces, scoresDue } from "./scorer";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 7);

const entry = (id: string, extra: Partial<LibraryEntry> = {}): LibraryEntry =>
	({
		ref: { providerId: "tmdb", kind: "movie", id },
		releaseDate: "2010-01-01",
		...extra,
	}) as LibraryEntry;

describe("scoresDue", () => {
	it("asks about the never-asked first, then the stalest, within budget", () => {
		const log = {
			"tmdb:movie:a": { readings: [], at: NOW - 40 * DAY, full: true as const, v: 2 },
			"tmdb:movie:b": { readings: [], at: NOW - 60 * DAY, full: true as const, v: 2 },
			"tmdb:movie:c": { readings: [], at: NOW - 2 * DAY, full: true as const, v: 2 },
		};
		const due = scoresDue(
			[entry("a"), entry("b"), entry("c"), entry("d")],
			log,
			NOW,
			2,
		);
		expect(due.map((one) => one.ref.id)).toEqual(["d", "b"]);
	});

	it("re-asks weekly about recent releases, daily about partial blends", () => {
		const log = {
			"tmdb:movie:new": { readings: [], at: NOW - 8 * DAY, full: true as const, v: 2 },
			"tmdb:movie:part": { readings: [], at: NOW - 2 * DAY },
		};
		const due = scoresDue(
			[entry("new", { releaseDate: "2026-10-01" }), entry("part")],
			log,
			NOW,
			10,
		);
		expect(due.map((one) => one.ref.id).sort()).toEqual(["new", "part"]);
	});

	it("asks about films, shows and Open Library books, nothing else", () => {
		const book = { ref: { providerId: "openlibrary", kind: "book", id: "OL1W" } } as LibraryEntry;
		const game = { ref: { providerId: "igdb", kind: "game", id: "7" } } as LibraryEntry;
		expect(scoresDue([book, game], {}, NOW, 10)).toEqual([book]);
	});
});

describe("scoresDue after Scout learns to read more", () => {
	it("asks again about films filed before, ahead of the merely stale", () => {
		const log = {
			"tmdb:movie:old": { readings: [], at: NOW - DAY, full: true as const, v: 1 },
			"tmdb:movie:stale": { readings: [], at: NOW - 60 * DAY, full: true as const, v: 2 },
			"tmdb:movie:fine": { readings: [], at: NOW - DAY, full: true as const, v: 2 },
		};
		const due = scoresDue([entry("old"), entry("stale"), entry("fine")], log, NOW, 10);
		expect(due.map((one) => one.ref.id)).toEqual(["old", "stale"]);
	});
});

describe("Rotten Tomatoes gaps", () => {
	const rt = { source: "rt-critics", value: 8.3, votes: 209 };
	const imdb = { source: "imdb", value: 8.7 };

	it("asks again within days about a film MDBList gave no Tomatometer", () => {
		const log = {
			"tmdb:movie:gap": { readings: [imdb], at: NOW - 3 * DAY, full: true as const, v: 2 },
			"tmdb:movie:whole": { readings: [imdb, rt], at: NOW - 3 * DAY, full: true as const, v: 2 },
		};
		const due = scoresDue([entry("gap"), entry("whole")], log, NOW, 10);
		expect(due.map((one) => one.ref.id)).toEqual(["gap"]);
	});

	it("keeps a score a later answer left blank", () => {
		const before = { readings: [imdb, rt], at: NOW - DAY, full: true as const, v: 2 };
		expect(keepKnown(before, [{ ...imdb, value: 8.8 }])).toEqual([{ ...imdb, value: 8.8 }, rt]);
		// A fresh number always wins over a kept one.
		expect(keepKnown(before, [imdb, { ...rt, value: 8.4 }])).toEqual([imdb, { ...rt, value: 8.4 }]);
		// Nothing is carried over from a blend MDBList took no part in.
		expect(keepKnown({ readings: [rt], at: NOW }, [imdb])).toEqual([imdb]);
	});
});

describe("replaces", () => {
	const full = { readings: [], at: NOW - DAY, full: true as const, v: 2 };
	it("keeps a recent full blend over a partial one", () => {
		expect(replaces(full, { readings: [], at: NOW }, NOW)).toBe(false);
		expect(replaces(full, { readings: [], at: NOW, full: true }, NOW)).toBe(true);
	});
	it("lets a partial one in once the full blend is stale", () => {
		const stale = { ...full, at: NOW - 31 * DAY };
		expect(replaces(stale, { readings: [], at: NOW }, NOW)).toBe(true);
	});
});

describe("pruneScores", () => {
	it("drops scores no note holds", () => {
		const log = {
			"tmdb:movie:a": { readings: [], at: NOW },
			"tmdb:movie:gone": { readings: [], at: NOW },
		};
		expect(Object.keys(pruneScores(log, [entry("a")]))).toEqual(["tmdb:movie:a"]);
	});
});

describe("the library blends live", () => {
	it("works the score out from stored readings, so a new blend needs no new fetch", async () => {
		const { scoutOfEntry, scoutScore } = await import("../scout-score");
		const readings = [
			{ source: "imdb", value: 8.1, votes: 400_000 },
			{ source: "rt-critics", value: 9.2, votes: 300 },
		];
		const held = { kind: "movie" as const, readings, sourceRating: 6 };
		expect(scoutOfEntry(held)).toBe(scoutScore(readings, "movie"));
		// Asked, nothing found: the note's own score stands.
		expect(scoutOfEntry({ ...held, readings: [] })).toBe(
			scoutOfEntry({ kind: "movie", sourceRating: 6 }),
		);
	});
});

describe("outlookDue", () => {
	it("asks after films not out yet, unknown or stalest first, and nothing else", () => {
		const soon = { releaseDate: "2027-06-16" };
		const log = {
			"tmdb:movie:fresh": { readings: [], at: 0, outlook: { genres: [], at: NOW - DAY } },
			"tmdb:movie:stale": { readings: [], at: 0, outlook: { genres: [], at: NOW - 20 * DAY } },
		};
		const due = outlookDue(
			[
				entry("out"),
				entry("fresh", soon),
				entry("stale", soon),
				entry("never", soon),
				entry("book", { ...soon, ref: { providerId: "openlibrary", kind: "book", id: "x" } }),
				entry("show", { ...soon, ref: { providerId: "tmdb", kind: "tv", id: "y" } }),
			],
			log,
			NOW,
		);
		expect(due.map((one) => one.ref.id)).toEqual(["never", "stale"]);
	});
});
