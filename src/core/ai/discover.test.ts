import { describe, expect, it } from "vitest";
import { item } from "../../test/fixtures";
import type { MediaItem, MediaKind } from "../types";
import type { NamedTitle } from "./askModes";
import { missingNote, queryOf, recordOf, resolveNamed, type TitleSearch } from "./discover";

const named = (over: Partial<NamedTitle>): NamedTitle => ({ title: "", year: null, kind: "movie", creator: "", reason: "", ...over });

const catalogue: MediaItem[] = [
	item({ title: "Arrival", year: 2016, ref: { providerId: "tmdb", kind: "movie", id: "329865" } }),
	item({ title: "Contact", year: 1997, ref: { providerId: "tmdb", kind: "movie", id: "686" } }),
	item({ title: "Contact", year: 1985, ref: { providerId: "openlibrary", kind: "book", id: "OL1" }, people: ["Carl Sagan"] }),
	item({ title: "Annihilation", year: 2014, ref: { providerId: "openlibrary", kind: "book", id: "OL2" }, people: ["Jeff VanderMeer"] }),
];

/** A fake source: every catalogue item of the kind whose title the query starts with. */
function fakeSearch(log: string[] = []): TitleSearch {
	return async (kind: MediaKind, query: string) => {
		log.push(`${kind}:${query}`);
		const hits = catalogue.filter((one) => one.ref.kind === kind && query.toLowerCase().startsWith(one.title.toLowerCase()));
		return [hits];
	};
}

const signal = new AbortController().signal;

describe("resolveNamed", () => {
	it("keeps what a source finds, drops what it doesn't and what is owned", async () => {
		const result = await resolveNamed(
			[
				named({ title: "Contact", year: 1997, reason: "Big questions, quietly asked" }),
				named({ title: "The Arrival Sequel", year: 2030 }),
				named({ title: "Arrival", year: 2016 }),
				named({ title: "Contact", year: 1985, kind: "book", creator: "Carl Sagan", reason: "The novel" }),
			],
			fakeSearch(),
			(found) => found.title === "Arrival",
			signal,
		);
		expect(result.found.map((one) => `${one.item.ref.kind}:${one.item.title}:${one.item.year}`)).toEqual([
			"movie:Contact:1997",
			"book:Contact:1985",
		]);
		expect(result.found[0]!.reason).toBe("Big questions, quietly asked");
		expect(result).toMatchObject({ missing: 1, owned: 1 });
	});

	it("rejects a year far from the one named, and a book by someone else", async () => {
		const result = await resolveNamed(
			[
				named({ title: "Contact", year: 2010 }),
				named({ title: "Annihilation", kind: "book", creator: "Somebody Else" }),
			],
			fakeSearch(),
			() => false,
			signal,
		);
		expect(result.found).toEqual([]);
		expect(result.missing).toBe(2);
	});

	it("tries the title alone when the author made the search miss", async () => {
		const log: string[] = [];
		const search: TitleSearch = async (kind, query) => {
			log.push(query);
			return query.includes("VanderMeer") ? [[]] : fakeSearch()(kind, query, signal);
		};
		const result = await resolveNamed([named({ title: "Annihilation", kind: "book", creator: "Jeff VanderMeer" })], search, () => false, signal);
		expect(log).toEqual(["Annihilation Jeff VanderMeer", "Annihilation"]);
		expect(result.found).toHaveLength(1);
	});

	it("counts a failing source as not found rather than failing the answer", async () => {
		const search: TitleSearch = async () => {
			throw new Error("down");
		};
		const result = await resolveNamed([named({ title: "Contact" })], search, () => false, signal);
		expect(result).toEqual({ found: [], missing: 1, owned: 0 });
	});
});

describe("helpers", () => {
	it("searches books by title and author, others by title", () => {
		expect(queryOf(named({ title: "Contact", kind: "book", creator: "Carl Sagan" }))).toBe("Contact Carl Sagan");
		expect(queryOf(named({ title: "Contact", creator: "Robert Zemeckis" }))).toBe("Contact");
		expect(recordOf(named({ title: "Contact", creator: "Robert Zemeckis" }), 0).authors).toEqual([]);
	});

	it("words the footnote", () => {
		expect(missingNote(0)).toBeNull();
		expect(missingNote(1)).toBe("1 suggestion couldn't be found in your sources.");
		expect(missingNote(3)).toBe("3 suggestions couldn't be found in your sources.");
	});
});
