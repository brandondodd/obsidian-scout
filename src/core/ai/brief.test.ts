import { describe, expect, it } from "vitest";
import { buildTaste } from "../library/taste";
import { entry, NOW, testConfig, verdict } from "../../test/fixtures";
import { lengthOf, libraryBrief, LOVED_MAX, SHELF_MAX, tasteBrief, type BriefInput } from "./brief";

const config = testConfig();

function input(entries: ReturnType<typeof entry>[], extra: Partial<BriefInput> = {}): BriefInput {
	return { config, entries, profile: buildTaste(config, entries, NOW), threads: [], ...extra };
}

const library = [
	entry({ title: "Arrival", year: 2016, kind: "movie", status: "Watched", rating: 10, finished: "2026-07-01", tags: ["Science Fiction"], moods: ["cerebral"], themes: ["first contact"] }),
	entry({ title: "Dune", year: 2021, kind: "movie", status: "Watched", rating: 9, finished: "2026-06-01", tags: ["Science Fiction"] }),
	entry({ title: "Cats", year: 2019, kind: "movie", status: "Dropped", tags: ["Musical"] }),
	entry({ title: "Piranesi", year: 2020, kind: "book", status: "To read", tags: ["Fantasy"], frontmatter: { pages: 272 }, moods: ["dreamy"], themes: ["solitude"] }),
	entry({ title: "Severance", year: 2022, kind: "tv", status: "Watching", progress: 4, progressTotal: 9, created: NOW.getTime() - 1000 }),
	entry({ title: "Outer Wilds", kind: "game", status: "On hold", frontmatter: { playtime: 22 } }),
	entry({ title: "My notes", kind: "link", status: "To read" }),
];

describe("libraryBrief", () => {
	it("lists the shelf under short ids, on the go first, and leaves links out", () => {
		const brief = libraryBrief(input(library));
		const lines = brief.shelf.split("\n");
		expect(lines[0]).toMatch(/^\[s1\] Severance \(2022\) — tv show — on the go/);
		expect(lines[1]).toMatch(/^\[s2\] Outer Wilds — game — paused — about 22h to beat/);
		expect(lines[2]).toContain("[s3] Piranesi (2020) — book — not started — genres: Fantasy — feel: dreamy, solitude — 272 pages");
		expect(brief.shelf).not.toContain("My notes");
		expect(brief.ids.get("s1")?.title).toBe("Severance");
		expect(brief.ids.size).toBe(3);
	});

	it("caps the shelf and the loved list", () => {
		const many = Array.from({ length: SHELF_MAX + 40 }, (_, at) => entry({ title: `Planned ${at}`, status: "To watch" }));
		const loved = Array.from({ length: LOVED_MAX + 10 }, (_, at) => entry({ title: `Loved ${at}`, status: "Watched", rating: 9 }));
		const brief = libraryBrief(input([...many, ...loved]));
		expect(brief.ids.size).toBe(SHELF_MAX);
		const lovedLines = brief.taste.split("\n").filter((line) => line.startsWith("Loved ") && line !== "Loved most:");
		expect(lovedLines).toHaveLength(LOVED_MAX);
	});

	it("can leave the shelf out", () => {
		const brief = libraryBrief(input(library), { shelf: false });
		expect(brief.shelf).toBe("");
		expect(brief.ids.size).toBe(0);
	});
});

describe("tasteBrief", () => {
	it("names loved, recent and disliked titles with ratings out of ten, and threads", () => {
		const text = tasteBrief(input(library, { threads: [{ name: "First contact, quietly" }], feedback: { a: verdict({ verdict: "disliked", title: "Avatar" }) } }));
		expect(text).toContain("Arrival (2016), movie — 10/10 — cerebral, first contact");
		expect(text).toContain("Finished lately, newest first:\nArrival (2016), movie — 10/10\nDune (2021), movie — 9/10");
		expect(text).toContain("Did not like or gave up on:\nCats (2019), movie");
		expect(text).toContain("Threads in what they love: First contact, quietly");
		expect(text).toContain("Turned down as suggestions: Avatar");
	});

	it("never sends a note's text", () => {
		const secret = entry({ title: "Private", status: "Watched", rating: 9, description: "my secret thoughts", frontmatter: { thoughts: "hidden" } });
		const brief = libraryBrief(input([secret]));
		expect(brief.taste + brief.shelf).not.toContain("secret");
		expect(brief.taste + brief.shelf).not.toContain("hidden");
	});

	it("says so when there is nothing to go on", () => {
		expect(tasteBrief(input([]))).toBe("Little is known about their taste yet.");
	});
});

describe("lengthOf", () => {
	it("reads runtime, pages and progress where the note has them", () => {
		expect(lengthOf(entry({ kind: "movie", frontmatter: { runtime: 130 } }))).toBe("2h 10m");
		expect(lengthOf(entry({ kind: "movie", frontmatter: { runtime: "95 min" } }))).toBe("1h 35m");
		expect(lengthOf(entry({ kind: "book", progress: 120, progressTotal: 300 }))).toBe("120 of 300 pages done");
		expect(lengthOf(entry({ kind: "tv", frontmatter: { runtime: 45 } }))).toBe("45m episodes");
		expect(lengthOf(entry({ kind: "movie" }))).toBeNull();
	});
});
