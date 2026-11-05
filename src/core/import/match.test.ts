import { describe, expect, it } from "vitest";
import { item, testConfig } from "../../test/fixtures";
import { importPatch, scaledRating } from "./apply";
import { pickMatch, searchQuery } from "./match";
import type { ImportRecord } from "./types";

function record(over: Partial<ImportRecord> = {}): ImportRecord {
	return {
		key: "k",
		kind: "movie",
		title: "Arrival",
		authors: [],
		isbns: [],
		tone: "done",
		history: [],
		favorite: false,
		...over,
	};
}

describe("pickMatch", () => {
	const film = (title: string, year: number, ratingCount = 100) =>
		item({ title, year, ratingCount });

	it("is certain when title and year leave one candidate", () => {
		const right = film("Arrival", 2016);
		const found = pickMatch(record({ year: 2016 }), [film("Arrival", 1996), right]);
		expect(found).toEqual({ item: right, confidence: "certain" });
	});

	it("only guesses when nothing is certain, and says so", () => {
		const close = film("Arrival: Extended", 2016);
		expect(pickMatch(record({ year: 2016 }), [close])?.confidence).toBe("likely");
	});

	it("finds nothing rather than a poor guess", () => {
		expect(pickMatch(record({ year: 2016 }), [film("Departures", 2016)])).toBeNull();
		expect(pickMatch(record({ year: 2016 }), [film("Arrival", 1950)])).toBeNull();
	});

	it("trusts an ISBN hit, but not one by somebody else", () => {
		const book = item({
			ref: { providerId: "openlibrary", kind: "book", id: "OL1W" },
			title: "Whatever the edition says",
			people: ["Frank Herbert"],
		});
		const dune = record({ kind: "book", title: "Dune", authors: ["Frank Herbert"] });
		expect(pickMatch(dune, [book], true)?.confidence).toBe("exact");
		const other = { ...book, people: ["Brian Herbert-Smith"] };
		expect(pickMatch(dune, [other], true)).toBeNull();
	});

	it("matches a book under its main title", () => {
		const sapiens = item({
			ref: { providerId: "openlibrary", kind: "book", id: "OL2W" },
			title: "Sapiens",
			people: ["Yuval Noah Harari"],
		});
		const row = record({
			kind: "book",
			title: "Sapiens: A Brief History of Humankind",
			authors: ["Yuval Noah Harari"],
		});
		expect(pickMatch(row, [sapiens])?.item).toBe(sapiens);
		expect(searchQuery(row)).toBe("Sapiens Yuval Noah Harari");
	});
});

describe("importPatch", () => {
	it("writes the user's own words and scale", () => {
		const config = testConfig({ ratingScale: 5, ratingStep: 0.5 });
		const patch = importPatch(
			config,
			record({
				rating: 0.9,
				started: "2021-01-01",
				finished: "2021-01-02",
				history: ["2019-05-05"],
				favorite: true,
				added: "2018-01-01",
			}),
		);
		expect(patch).toEqual({
			status: "Watched",
			rating: 4.5,
			started: "2021-01-01",
			finished: "2021-01-02",
			history: ["2019-05-05"],
			favorite: true,
			created: "2018-01-01",
		});
	});

	it("picks the status by tone from a custom vocabulary", () => {
		const config = testConfig();
		config.statuses.book = "Wishlist, Now, Finished";
		config.inProgressStatuses = "Now";
		config.finishedStatuses = "Finished";
		expect(importPatch(config, record({ kind: "book", tone: "planned" })).status).toBe(
			"Wishlist",
		);
		expect(importPatch(config, record({ kind: "book", tone: "active" })).status).toBe("Now");
	});

	it("rounds onto each kind's scale and step", () => {
		const config = testConfig({ ratingScale: 10, ratingStep: 1, ratingScales: { book: 5 } });
		expect(scaledRating(config, "movie", 0.85)).toBe(9);
		expect(scaledRating(config, "book", 0.85)).toBe(4);
		expect(scaledRating(config, "book", 0.05)).toBe(1);
	});
});
