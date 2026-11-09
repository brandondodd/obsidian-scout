import { describe, expect, it } from "vitest";
import { entry, testConfig } from "../../test/fixtures";
import {
	MIN_MEMBERS,
	lovedDigest,
	normaliseThreads,
	readThreads,
	threadMembers,
	threadRequest,
	threadScore,
	type Thread,
} from "./threads";

const config = testConfig();

const grief: Thread = {
	id: "t1",
	name: "Quiet grief",
	description: "Loss, told gently.",
	moods: ["melancholy", "tender"],
	themes: ["grief", "family"],
	pinned: false,
	hidden: false,
};

const library = [
	entry({ title: "Aftersun", kind: "movie", rating: 9, moods: ["melancholy", "tender"], themes: ["grief", "parenthood"] }),
	entry({ title: "H is for Hawk", kind: "book", rating: 8, moods: ["Melancholy"], themes: ["Grief", "animals"] }),
	entry({ title: "What Remains of Edith Finch", kind: "game", rating: 10, moods: ["haunting"], themes: ["family", "death", "grief"] }),
	entry({ title: "Paddington 2", kind: "movie", rating: 9, moods: ["cozy", "tender", "funny"], themes: ["community"] }),
	entry({ title: "Heat", kind: "movie", rating: 9, moods: ["tense"], themes: ["heist", "crime"] }),
	entry({ title: "Untagged", kind: "movie", rating: 9 }),
	entry({ title: "Loose words", kind: "movie", rating: 9, moods: ["sad"], themes: ["the grief of others"] }),
];

describe("threadScore and threadMembers", () => {
	it("needs more than one shared word to join", () => {
		// One shared mood is not enough; a theme and a mood is.
		expect(threadScore(grief, library[3]!)).toBeCloseTo(0.6);
		expect(threadScore(grief, library[0]!)).toBeCloseTo(2.2);
	});

	it("finds members across kinds from their properties, closest first", () => {
		const members = threadMembers(grief, library).map((one) => one.title);
		expect(members).toEqual(["Aftersun", "What Remains of Edith Finch", "H is for Hawk"]);
	});

	it("does not count a loose theme that snaps to nothing", () => {
		expect(threadScore(grief, library[6]!)).toBe(0);
	});
});

describe("lovedDigest and threadRequest", () => {
	it("sends counts and titles of loved, tagged notes only", () => {
		const digest = lovedDigest(config, [...library, entry({ title: "Disliked", rating: 2, moods: ["bleak"], themes: ["war"] })]);
		expect(digest.loved).toBe(6);
		expect(digest.themes[0]).toEqual(["grief", 3]);
		expect(digest.titles.some((line) => line.startsWith("Aftersun, movie: melancholy, tender, grief"))).toBe(true);
		const request = threadRequest(digest, [{ ...grief, pinned: true }], 4);
		expect(request.prompt).toContain("Write 4 new threads.");
		expect(request.prompt).toContain("Already kept (do not repeat): Quiet grief");
		expect(request.prompt).not.toContain("Disliked");
	});
});

describe("readThreads", () => {
	const ids = (at: number) => `new-${at}`;
	const answer = {
		threads: [
			{ name: "“Grief, gently”", description: "You keep returning to loss.", moods: ["melancholy", "wistful"], themes: ["Grief", "family"] },
			{ name: "Heists", description: "Clever plans.", moods: ["tense"], themes: ["heist"] },
			{ name: "Nothing real", description: "", moods: ["sombre"], themes: ["sorrowful vibes"] },
			{ name: "", description: "No name", moods: ["tense"], themes: ["crime"] },
		],
	};

	it("keeps threads the library can fill, with canonical words only", () => {
		const out = readThreads(answer, library, [], 5, ids);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ id: "new-0", name: "Grief, gently", moods: ["melancholy", "wistful"], themes: ["grief", "family"] });
		expect(threadMembers(out[0]!, library).length).toBeGreaterThanOrEqual(MIN_MEMBERS);
	});

	it("drops a thread that repeats a kept one", () => {
		const kept = [{ ...grief, moods: ["melancholy", "wistful"], themes: ["grief", "family"] } as Thread];
		expect(readThreads(answer, library, kept, 5, ids)).toEqual([]);
	});

	it("stops at the number wanted and survives a malformed answer", () => {
		expect(readThreads(answer, library, [], 0, ids)).toEqual([]);
		expect(readThreads({ threads: "x" }, library, [], 3, ids)).toEqual([]);
		expect(readThreads(null, library, [], 3, ids)).toEqual([]);
	});
});

describe("normaliseThreads", () => {
	it("reads stored threads back, dropping what is not one", () => {
		const out = normaliseThreads([{ ...grief, moods: ["melancholy", "nope"], pinned: true }, { id: 3 }, "x", { id: "a", name: "" }]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ id: "t1", pinned: true, moods: ["melancholy"] });
		expect(normaliseThreads(undefined)).toEqual([]);
	});
});
