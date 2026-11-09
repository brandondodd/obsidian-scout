import { describe, expect, it } from "vitest";
import { entry, item } from "../../test/fixtures";
import {
	BATCH_SIZE,
	RUN_CAP,
	chunk,
	estimate,
	needsTags,
	readTags,
	tagInputOf,
	tagInputOfItem,
	tagPrompt,
	tagRequest,
	tagSchema,
	tagValues,
	trimBlurb,
} from "./tagger";
import { MOODS } from "./vocabulary";

const dune = entry({
	title: "Dune",
	year: 2021,
	kind: "movie",
	tags: ["Science Fiction", "Adventure"],
	people: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson", "Oscar Isaac"],
	authored: ["Denis Villeneuve"],
	description: "Paul Atreides, a brilliant and gifted young man born into a great destiny beyond his understanding, must travel to the most dangerous planet in the universe.",
	rating: 9,
	status: "Watched",
});

/** A recorded answer, in the shape a schema-following service sends. */
const RECORDED = {
	titles: [
		{ id: "1", moods: ["epic", "atmospheric", "brooding", "tense", "cerebral"], themes: ["Power", "destiny", "Coming-of-age", "ecology", "messiahs and their cost"] },
		{ id: "2", moods: ["cozy", "melancholic"], themes: [] },
		{ id: "7", moods: ["funny"], themes: ["heists"] },
		{ id: "3", moods: [], themes: [] },
	],
};

describe("tag inputs", () => {
	it("sends what places a title, and never a rating, status or thoughts", () => {
		const input = tagInputOf(dune, "1");
		expect(input).toMatchObject({ id: "1", title: "Dune", year: 2021, kind: "movie" });
		expect(input.people).toEqual(["Denis Villeneuve"]);
		const sent = tagPrompt([input]) + JSON.stringify(tagSchema());
		expect(sent).toContain("[1] Dune (2021)");
		expect(sent).not.toContain("Watched");
		expect(sent).not.toMatch(/rating/i);
	});

	it("takes the first few names off a source record", () => {
		const input = tagInputOfItem(item({ title: "Arrival", people: ["A", "B", "C", "D"] }), "2");
		expect(input.people).toEqual(["A", "B", "C"]);
	});

	it("trims a long blurb at a word", () => {
		const long = "word ".repeat(100);
		const out = trimBlurb(long) ?? "";
		expect(out.length).toBeLessThanOrEqual(281);
		expect(out.endsWith("…")).toBe(true);
		expect(trimBlurb("  ")).toBeUndefined();
	});

	it("asks for a big enough answer and holds moods to the list", () => {
		const request = tagRequest([tagInputOf(dune, "1")]);
		expect(request.maxTokens).toBeGreaterThan(2048);
		const items = (request.schema as { properties: { titles: { items: { properties: { moods: { items: { enum: string[] } } } } } } })
			.properties.titles.items.properties.moods.items.enum;
		expect(items).toEqual([...MOODS]);
	});
});

describe("readTags", () => {
	it("keeps only asked-for ids, drops moods off the list, snaps themes", () => {
		const out = readTags(RECORDED, ["1", "2", "3"]);
		expect([...out.keys()]).toEqual(["1", "2"]);
		expect(out.get("1")).toEqual({
			moods: ["epic", "atmospheric", "brooding", "tense"],
			themes: ["power", "fate", "coming of age", "environment", "messiahs and their cost"],
		});
		// "melancholic" is not on the list; the title keeps what is.
		expect(out.get("2")).toEqual({ moods: ["cozy"], themes: [] });
	});

	it("survives answers that are not the shape asked for", () => {
		expect(readTags(null, ["1"]).size).toBe(0);
		expect(readTags({ titles: "nope" }, ["1"]).size).toBe(0);
		expect(readTags({ titles: [null, { id: 1 }] }, ["1"]).size).toBe(0);
		expect(readTags({ titles: [{ id: "[1]", moods: ["tense"], themes: "x" }] }, ["1"]).get("1")).toEqual({
			moods: ["tense"],
			themes: [],
		});
	});
});

describe("tagValues", () => {
	const fields = { moods: "moods", themes: "themes" };
	const tags = { moods: ["tense" as const], themes: ["heist"] };

	it("never offers to replace what a note already has", () => {
		expect(tagValues(entry({ moods: ["cozy"] }), tags, fields)).toEqual({ themes: ["heist"] });
		expect(tagValues(entry({ moods: ["cozy"], themes: ["x"] }), tags, fields)).toEqual({});
		expect(tagValues(null, tags, fields)).toEqual({ moods: ["tense"], themes: ["heist"] });
	});
});

describe("planning a run", () => {
	it("counts what needs tagging, skipping links", () => {
		expect(needsTags(entry())).toBe(true);
		expect(needsTags(entry({ moods: ["cozy"], themes: ["grief"] }))).toBe(false);
		expect(needsTags(entry({ moods: ["cozy"] }))).toBe(true);
		expect(needsTags(entry({ kind: "link" }))).toBe(false);
	});

	it("estimates calls and caps the run", () => {
		expect(estimate(0)).toEqual({ titles: 0, calls: 0, capped: false });
		expect(estimate(BATCH_SIZE + 1)).toEqual({ titles: BATCH_SIZE + 1, calls: 2, capped: false });
		expect(estimate(RUN_CAP + 500)).toEqual({ titles: RUN_CAP, calls: Math.ceil(RUN_CAP / BATCH_SIZE), capped: true });
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});
});
