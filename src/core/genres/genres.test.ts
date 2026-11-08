import { describe, expect, it } from "vitest";
import {
	canonicalGenres,
	entryGenres,
	genreKey,
	isMainGenre,
	mainGenreOf,
	sourceGenresFor,
} from "./genres";
import { TAXONOMY, type GenreDomain } from "./taxonomy";

describe("genreKey", () => {
	it("folds case, accents, ampersands and punctuation", () => {
		expect(genreKey("Sci-Fi & Fantasy")).toBe("sci fi and fantasy");
		expect(genreKey("Children's")).toBe("childrens");
		expect(genreKey("  Café  Noir ")).toBe("cafe noir");
	});
});

describe("canonicalGenres", () => {
	it("drops Open Library's noise and keeps what is a genre", () => {
		expect(
			canonicalGenres("book", [
				"Mystery",
				"nyt:paperback_books=2011-06-11",
				"Suicide",
				"Accessible book",
				"Protected DAISY",
			]),
		).toEqual(["Mystery"]);
	});

	it("reads hierarchical subjects", () => {
		expect(
			canonicalGenres("book", [
				"Fiction, thrillers, suspense",
				"Fiction, mystery & detective, general",
			]),
		).toEqual(["Thriller", "Mystery", "Detective"]);
	});

	it("falls back to Fiction when that is all there is", () => {
		expect(canonicalGenres("book", ["Kidnapping", "Fiction", "Reality"])).toEqual([
			"Fiction",
		]);
		expect(canonicalGenres("book", ["Science fiction", "Fiction"])).toEqual([
			"Science fiction",
		]);
	});

	it("splits TMDB's combined television genres", () => {
		expect(canonicalGenres("tv", ["Sci-Fi & Fantasy", "Action & Adventure"])).toEqual([
			"Science fiction",
			"Fantasy",
			"Action",
			"Adventure",
		]);
		expect(canonicalGenres("tv", ["War & Politics"])).toEqual([
			"War",
			"Drama",
			"Political",
		]);
	});

	it("brings a sub-genre's main genre with it, first", () => {
		expect(canonicalGenres("book", ["Urban fantasy"])).toEqual([
			"Fantasy",
			"Urban fantasy",
		]);
		expect(canonicalGenres("movie", ["Romantic comedy"])).toEqual([
			"Comedy",
			"Romance",
			"Romantic comedy",
		]);
	});

	it("maps AniList's names", () => {
		expect(canonicalGenres("anime", ["Sci-Fi", "Mahou Shoujo", "Slice of Life"])).toEqual([
			"Science fiction",
			"Fantasy",
			"Magical girl",
			"Slice of life",
		]);
	});

	it("maps IGDB's and MusicBrainz's names", () => {
		expect(
			canonicalGenres("game", [
				"Role-playing (RPG)",
				"Hack and slash/Beat 'em up",
				"Card & Board Game",
				"Indie",
			]),
		).toEqual([
			"Role-playing",
			"Action",
			"Hack and slash",
			"Beat 'em up",
			"Card games",
			"Board games",
			"Indie",
		]);
		expect(
			canonicalGenres("album", ["Indie rock", "british", "2010s", "Hip-Hop/Rap", "R&B/Soul"]),
		).toEqual(["Rock", "Indie rock", "Hip-hop", "R&B", "Soul"]);
	});

	it("keeps families apart", () => {
		expect(canonicalGenres("album", ["Thriller"])).toEqual([]);
		expect(canonicalGenres("book", ["Comedy"])).toEqual(["Humour"]);
	});

	it("keeps a hand-written word only when asked to", () => {
		expect(canonicalGenres("movie", ["Cosy", "Horror"])).toEqual(["Horror"]);
		expect(canonicalGenres("movie", ["Cosy", "Horror"], { keepUnknown: true })).toEqual([
			"Horror",
			"Cosy",
		]);
		expect(
			canonicalGenres("movie", ["nyt:list=2020"], { keepUnknown: true }),
		).toEqual([]);
	});

	it("does not repeat itself", () => {
		expect(canonicalGenres("movie", ["Horror", "horror", "Horror films"])).toEqual([
			"Horror",
		]);
	});

	it("is a fixed point", () => {
		for (const kind of ["movie", "book", "game", "album"] as const) {
			const once = canonicalGenres(kind, ["Sci-Fi & Fantasy", "Space opera", "Rock"]);
			expect(canonicalGenres(kind, once)).toEqual(once);
		}
	});
});

describe("the taxonomy", () => {
	it("maps every label to itself, and every parent exists", () => {
		const kinds: Record<GenreDomain, "movie" | "book" | "game" | "album"> = {
			screen: "movie",
			books: "book",
			games: "game",
			music: "album",
		};
		for (const [domain, defs] of Object.entries(TAXONOMY) as [GenreDomain, typeof TAXONOMY.screen][]) {
			const labels = new Set(defs.map((def) => def.label));
			for (const def of defs) {
				if (def.parent) expect(labels.has(def.parent), def.label).toBe(true);
				for (const extra of def.also ?? []) expect(labels.has(extra), def.label).toBe(true);
				expect(canonicalGenres(kinds[domain], [def.label]), def.label).toContain(def.label);
			}
		}
	});
});

describe("main genres", () => {
	it("knows which is which", () => {
		expect(mainGenreOf("book", "Urban fantasy")).toBe("Fantasy");
		expect(mainGenreOf("book", "Fantasy")).toBe("Fantasy");
		expect(isMainGenre("movie", "Slasher")).toBe(false);
		expect(isMainGenre("movie", "Something else")).toBe(true);
	});
});

describe("entryGenres", () => {
	it("keeps the words of a note written by hand", () => {
		expect(entryGenres({ kind: "movie", tags: ["Cosy"] })).toEqual(["Cosy"]);
		expect(entryGenres({ kind: "movie", tags: ["Cosy"], ref: {} })).toEqual([]);
	});
});

describe("sourceGenresFor", () => {
	it("finds a provider's own words for Scout's genres", () => {
		expect(
			sourceGenresFor("tv", ["Science fiction"], ["Drama", "Sci-Fi & Fantasy"]),
		).toEqual(["Sci-Fi & Fantasy"]);
		expect(
			sourceGenresFor("anime", ["Magical girl"], ["Action", "Mahou Shoujo"]),
		).toEqual(["Mahou Shoujo"]);
	});
});
