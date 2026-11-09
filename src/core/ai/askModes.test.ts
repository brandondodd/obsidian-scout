import { describe, expect, it } from "vitest";
import { buildTaste } from "../library/taste";
import { entry, NOW, testConfig } from "../../test/fixtures";
import { askVocabulary } from "./ask";
import {
	fullRequest,
	fullSchema,
	intentRequest,
	interpret,
	interpretIntent,
	PICKS_MAX,
	readNamed,
	type AskTurn,
} from "./askModes";
import { libraryBrief } from "./brief";

const config = testConfig();
const entries = [
	entry({ title: "Dune", kind: "movie", status: "Watched", rating: 9, tags: ["Science Fiction"] }),
	entry({ title: "Paddington 2", kind: "movie", status: "To watch", tags: ["Comedy"], frontmatter: { runtime: 103 } }),
	entry({ title: "Piranesi", kind: "book", status: "To read", tags: ["Fantasy"] }),
	entry({ title: "Severance", kind: "tv", status: "Watching", tags: ["Drama"] }),
];
const vocab = askVocabulary(config, entries, []);
const brief = libraryBrief({ config, entries, profile: buildTaste(config, entries, NOW), threads: [] });

const emptyFilter = {
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

/** Every object in a schema closed and fully required: what OpenAI's strict mode insists on. */
function assertStrict(schema: unknown, path = "$"): void {
	if (!schema || typeof schema !== "object") return;
	const at = schema as Record<string, unknown>;
	if (at.type === "object") {
		expect(at.additionalProperties, path).toBe(false);
		expect([...(at.required as string[])].sort(), path).toEqual(Object.keys(at.properties as object).sort());
	}
	for (const [key, value] of Object.entries(at)) {
		if (Array.isArray(value)) value.forEach((one, i) => assertStrict(one, `${path}.${key}[${i}]`));
		else if (value && typeof value === "object") assertStrict(value, `${path}.${key}`);
	}
}

describe("schemas", () => {
	it("are strict all the way down", () => {
		assertStrict(fullSchema(vocab));
		assertStrict(intentRequest("x", vocab, [], NOW).schema);
	});
});

describe("prompts", () => {
	it("without sharing, sends no titles even with a follow-up", () => {
		const history: AskTurn[] = [{ question: "sci-fi I finished", mode: "find", summary: "Sci-fi you finished", shown: [] }];
		const request = intentRequest("but only books", vocab, history, NOW);
		const sent = request.system + request.prompt;
		expect(sent).not.toContain("Dune");
		expect(sent).not.toContain("Paddington");
		expect(request.prompt).toContain("- Asked: sci-fi I finished → find: Sci-fi you finished");
		expect(request.prompt).toContain("Question: but only books");
	});

	it("with sharing, carries the shelf by id and the earlier answer", () => {
		const history: AskTurn[] = [{ question: "something tonight", mode: "pick", summary: "Two easy ones", shown: ["Paddington 2"] }];
		const request = fullRequest("not that one, something shorter", vocab, brief, history, NOW);
		expect(request.prompt).toMatch(/\[s\d\] Paddington 2 — movie — not started — genres: Comedy — 1h 43m/);
		expect(request.prompt).toContain("Shown: Paddington 2");
		expect(request.prompt.indexOf("Earlier in this conversation")).toBeLessThan(request.prompt.indexOf("Question:"));
	});
});

describe("interpret", () => {
	const id = (title: string) => [...brief.ids].find(([, e]) => e.title === title)![0];

	it("keeps picks by known id and drops invented ones", () => {
		const read = interpret(
			{
				mode: "pick",
				summary: " Two easy ones for tonight ",
				filter: emptyFilter,
				picks: [
					{ id: id("Paddington 2"), reason: "Warm, funny, and under two hours" },
					{ id: "s999", reason: "Not on the shelf" },
					{ id: `[${id("Piranesi")}]`, reason: "Like the quiet worlds you love" },
					{ id: id("Paddington 2"), reason: "Again" },
				],
				finds: [],
			},
			vocab,
			config,
			entries,
			brief.ids,
		);
		expect(read.mode).toBe("pick");
		if (read.mode !== "pick") return;
		expect(read.summary).toBe("Two easy ones for tonight");
		expect(read.picks.map((one) => one.entry.title)).toEqual(["Paddington 2", "Piranesi"]);
	});

	it("caps picks", () => {
		const picks = Array.from({ length: 10 }, () => ({ id: id("Severance"), reason: "" }));
		const ids = new Map(Array.from({ length: 10 }, (_, at) => [`s${at + 1}`, entries[0]!]));
		const read = interpret({ mode: "pick", summary: "", filter: emptyFilter, picks: picks.map((p, at) => ({ ...p, id: `s${at + 1}` })), finds: [] }, vocab, config, entries, ids);
		expect(read.mode === "pick" && read.picks.length).toBe(PICKS_MAX);
	});

	it("reads discover titles, checking kind and year", () => {
		const read = interpret(
			{
				mode: "discover",
				summary: "Books for a Hades fan",
				filter: emptyFilter,
				picks: [],
				finds: [
					{ title: "The Song of Achilles", year: 2011, kind: "book", creator: "Madeline Miller", reason: "Greek myth, told with heart" },
					{ title: "Circe", year: 99999, kind: "book", creator: "Madeline Miller", reason: "" },
					{ title: "Bad kind", year: 2000, kind: "podcast", creator: "", reason: "" },
					{ title: "  ", year: 2000, kind: "book", creator: "", reason: "" },
				],
			},
			vocab,
			config,
			entries,
			brief.ids,
		);
		expect(read.mode).toBe("discover");
		if (read.mode !== "discover") return;
		expect(read.finds).toEqual([
			{ title: "The Song of Achilles", year: 2011, kind: "book", creator: "Madeline Miller", reason: "Greek myth, told with heart" },
			{ title: "Circe", year: null, kind: "book", creator: "Madeline Miller", reason: "" },
		]);
	});

	it("falls back to the filter when a mode comes back empty or garbled", () => {
		const read = interpret(
			{ mode: "pick", summary: "", filter: { ...emptyFilter, summary: "Books", kinds: ["book"] }, picks: [{ id: "nope", reason: "" }], finds: [] },
			vocab,
			config,
			entries,
			brief.ids,
		);
		expect(read).toMatchObject({ mode: "find", summary: "Books", find: { focus: { kinds: ["book"] } } });
		expect(interpret(null, vocab, config, entries, brief.ids).mode).toBe("find");
		expect(interpret({ mode: "weird", filter: "x" }, vocab, config, entries, brief.ids).mode).toBe("find");
	});
});

describe("interpretIntent", () => {
	it("says what the question wanted alongside the filter", () => {
		const read = interpretIntent({ mode: "discover", filter: { ...emptyFilter, tags: ["fantasy"] } }, vocab, config, entries);
		expect(read.wanted).toBe("discover");
		expect(read.find.focus.tags).toEqual(["Fantasy"]);
	});
});

describe("readNamed", () => {
	it("drops repeats and survives junk", () => {
		expect(readNamed("nope", 5)).toEqual([]);
		const twice = { title: "Dune", year: 1965, kind: "book", creator: "Frank Herbert", reason: "" };
		expect(readNamed([twice, { ...twice, title: "dune" }, null], 5)).toHaveLength(1);
	});
});
