import { describe, expect, it } from "vitest";
import { entry, testConfig } from "../../test/fixtures";
import { askPrompt, askSchema, askVocabulary, toFocus, type AskAnswer } from "./ask";

const config = testConfig();
const entries = [
	entry({ title: "Dune", kind: "movie", tags: ["Science Fiction", "Drama"], people: ["Denis Villeneuve"], collections: ["Rewatch"] }),
	entry({ title: "Arrival", kind: "movie", tags: ["Science Fiction"], people: ["Denis Villeneuve", "Amy Adams"] }),
	entry({ title: "Piranesi", kind: "book", tags: ["Fantasy"], people: ["Susanna Clarke"] }),
];

const blank: AskAnswer = {
	summary: "",
	text: "",
	kinds: [],
	statuses: [],
	tones: [],
	tags: [],
	genreMatch: "any",
	notTags: [],
	people: [],
	collections: [],
	favoritesOnly: false,
	minRating: 0,
	rated: "any",
	yearFrom: null,
	yearTo: null,
	addedWithin: 0,
	release: "any",
};

describe("askVocabulary", () => {
	it("lists only what is in use, genres by how often they appear", () => {
		const vocab = askVocabulary(config, entries, ["Comfort"]);
		expect(vocab.kinds).toEqual(["movie", "book"]);
		expect(vocab.genres[0]).toBe("Science Fiction");
		expect(vocab.collections).toEqual(["Comfort", "Rewatch"]);
	});

	it("never puts titles or people in what is sent", () => {
		const vocab = askVocabulary(config, entries, []);
		const sent = askPrompt("sci-fi I loved", vocab, new Date(2026, 0, 1)) + JSON.stringify(askSchema(vocab));
		expect(sent).not.toContain("Dune");
		expect(sent).not.toContain("Villeneuve");
	});
});

describe("toFocus", () => {
	const vocab = askVocabulary(config, entries, []);

	it("matches words case-insensitively and reports ones the library lacks", () => {
		const result = toFocus(
			{ ...blank, summary: " Sci-fi films ", kinds: ["movie"], tags: ["science fiction", "Western"], tones: ["done"] },
			vocab,
			config,
			entries,
		);
		expect(result.summary).toBe("Sci-fi films");
		expect(result.focus).toEqual({ kinds: ["movie"], tags: ["Science Fiction"], genreMatch: "any", tones: ["done"] });
		expect(result.unknown).toEqual(["Western"]);
	});

	it("finds a person by surname only when it means one person", () => {
		expect(toFocus({ ...blank, people: ["villeneuve"] }, vocab, config, entries).focus.people).toEqual(["Denis Villeneuve"]);
		expect(toFocus({ ...blank, people: ["a"] }, vocab, config, entries).unknown).toEqual(["a"]);
	});

	it("converts a rating out of ten to the library's scale and drops 'off' values", () => {
		const result = toFocus({ ...blank, minRating: 8, yearFrom: 1990, yearTo: 1999 }, vocab, config, entries);
		expect(result.focus).toEqual({ minRating: (8 / 10) * config.ratingScale, yearFrom: 1990, yearTo: 1999 });
	});
});
