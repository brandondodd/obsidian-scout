import { describe, expect, it } from "vitest";
import { entry, testConfig } from "../../test/fixtures";
import { ANSWER_TTL_MS, ANSWERS_MAX, answerKey, isFresh, normalizeAnswers, pruneAnswers } from "./answerCache";
import {
	acrossEligible,
	acrossRequest,
	acrossSchema,
	readAcross,
	readTake,
	takeEligible,
	takeRequest,
	takeSchema,
	type TitleFacts,
} from "./take";

const config = testConfig();

const facts: TitleFacts = {
	title: "Annihilation",
	year: 2018,
	kind: "movie",
	genres: ["Science Fiction", "Horror"],
	people: ["Alex Garland", "Natalie Portman", "Tessa Thompson", "Oscar Isaac", "Gina Rodriguez"],
	moods: ["eerie"],
	themes: ["grief"],
	description: "A biologist signs up for a dangerous, secret expedition. ".repeat(10),
	score: 6.84,
};

describe("eligibility", () => {
	it("offers a take on unowned, planned and paused things only", () => {
		expect(takeEligible(config, undefined, "movie")).toBe(true);
		expect(takeEligible(config, entry({ status: "To watch" }), "movie")).toBe(true);
		expect(takeEligible(config, entry({ status: "On hold" }), "movie")).toBe(true);
		expect(takeEligible(config, entry({ status: "Watched" }), "movie")).toBe(false);
		expect(takeEligible(config, undefined, "link")).toBe(false);
	});

	it("offers Across kinds on the top of the scale or a favourite", () => {
		expect(acrossEligible(config, entry({ rating: 8 }))).toBe(true);
		expect(acrossEligible(config, entry({ rating: 7.5 }))).toBe(false);
		expect(acrossEligible(config, entry({ favorite: true }))).toBe(true);
		expect(acrossEligible(config, entry({ favorite: true, status: "Dropped" }))).toBe(false);
		expect(acrossEligible(config, undefined)).toBe(false);
	});
});

describe("requests", () => {
	it("send the facts trimmed, and a few people", () => {
		const request = takeRequest(facts, "They lean towards — genres: Horror");
		expect(request.prompt).toContain("Annihilation (2018) — movie");
		expect(request.prompt).toContain("By/with: Alex Garland, Natalie Portman, Tessa Thompson, Oscar Isaac\n");
		expect(request.prompt).toContain("Source score: 6.8/10");
		expect(request.prompt).toContain("Feel: eerie, grief");
		expect(request.prompt.length).toBeLessThan(800);
	});

	it("ask Across kinds for other kinds", () => {
		expect(acrossRequest(facts, "", []).prompt).toContain("none of them a movie");
	});

	it("have strict schemas", () => {
		for (const schema of [takeSchema(), acrossSchema()]) {
			expect(schema.additionalProperties).toBe(false);
		}
		const item = (acrossSchema().properties as { titles: { items: Record<string, unknown> } }).titles.items;
		expect(item.additionalProperties).toBe(false);
		expect(item.required).toEqual(Object.keys(item.properties as object));
	});
});

describe("readTake", () => {
	it("keeps a take with a fit off the list", () => {
		expect(readTake({ fit: "good", headline: "“Your kind of strange”", why: "Like Arrival, it is grief told through the unknown." })).toEqual({
			fit: "good",
			headline: "Your kind of strange",
			why: "Like Arrival, it is grief told through the unknown.",
		});
	});

	it("rejects a fit off the list, or an empty answer", () => {
		expect(readTake({ fit: "perfect", headline: "x", why: "y" })).toBeNull();
		expect(readTake({ fit: "good", headline: "", why: " " })).toBeNull();
		expect(readTake(null)).toBeNull();
	});
});

describe("readAcross", () => {
	it("drops the page's own kind", () => {
		const answer = {
			titles: [
				{ title: "Roadside Picnic", year: 1972, kind: "book", creator: "Strugatsky", reason: "The Zone, before the Shimmer" },
				{ title: "Stalker", year: 1979, kind: "movie", creator: "Tarkovsky", reason: "" },
				{ title: "Control", year: 2019, kind: "game", creator: "Remedy", reason: "An eerie place with rules" },
			],
		};
		expect(readAcross(answer, "movie").map((one) => one.title)).toEqual(["Roadside Picnic", "Control"]);
		expect(readAcross({}, "movie")).toEqual([]);
	});
});

describe("answer cache", () => {
	const now = 1_800_000_000_000;

	it("keys by kind, title, service and model", () => {
		expect(answerKey("take", "tmdb:1", "openai", "gpt")).toBe("take|tmdb:1|openai|gpt");
		expect(answerKey("across", "tmdb:1", "claude-code", "")).toBe("across|tmdb:1|claude-code|default");
	});

	it("expires after thirty days", () => {
		expect(isFresh({ at: now - ANSWER_TTL_MS + 1, value: 1 }, now)).toBe(true);
		expect(isFresh({ at: now - ANSWER_TTL_MS, value: 1 }, now)).toBe(false);
		expect(isFresh(undefined, now)).toBe(false);
	});

	it("prunes the expired and the oldest past the ceiling", () => {
		const log = Object.fromEntries(Array.from({ length: ANSWERS_MAX + 5 }, (_, at) => [`k${at}`, { at: now - at, value: at }]));
		log.old = { at: now - ANSWER_TTL_MS - 1, value: 0 };
		const pruned = pruneAnswers(log, now);
		expect(Object.keys(pruned)).toHaveLength(ANSWERS_MAX);
		expect(pruned.old).toBeUndefined();
		expect(pruned.k0).toBeDefined();
		expect(pruned[`k${ANSWERS_MAX + 4}`]).toBeUndefined();
	});

	it("reads a hand-edited file defensively", () => {
		expect(normalizeAnswers({ a: { at: 1, value: { fit: "good" } }, b: { at: "x", value: 1 }, c: null, d: { at: 2 } })).toEqual({
			a: { at: 1, value: { fit: "good" } },
		});
		expect(normalizeAnswers("nope")).toEqual({});
	});
});
