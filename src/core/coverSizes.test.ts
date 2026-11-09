import { describe, expect, it } from "vitest";
import { coverSrcSet } from "./coverSizes";

describe("coverSrcSet", () => {
	it("offers TMDB's smaller cuts up to the size the note asked for", () => {
		expect(coverSrcSet("https://image.tmdb.org/t/p/w500/abc.jpg")).toBe(
			"https://image.tmdb.org/t/p/w185/abc.jpg 185w, " +
				"https://image.tmdb.org/t/p/w342/abc.jpg 342w, " +
				"https://image.tmdb.org/t/p/w500/abc.jpg 500w",
		);
	});

	it("caps an original TMDB upload at a size a cover could use", () => {
		const set = coverSrcSet("https://image.tmdb.org/t/p/original/abc.jpg");
		expect(set).toContain("w780/abc.jpg 780w");
		expect(set).not.toContain("original");
	});

	it("reads the older TMDB host too", () => {
		expect(coverSrcSet("https://www.themoviedb.org/t/p/w342/x.jpg")).toBe(
			"https://www.themoviedb.org/t/p/w185/x.jpg 185w, " +
				"https://www.themoviedb.org/t/p/w342/x.jpg 342w",
		);
	});

	it("offers OpenLibrary's medium cut beside the large one", () => {
		expect(coverSrcSet("https://covers.openlibrary.org/b/id/123-L.jpg")).toBe(
			"https://covers.openlibrary.org/b/id/123-M.jpg 180w, " +
				"https://covers.openlibrary.org/b/id/123-L.jpg 500w",
		);
	});

	it("offers IGDB's single-density cover beside the double", () => {
		expect(
			coverSrcSet("https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1.jpg"),
		).toBe(
			"https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg 264w, " +
				"https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1.jpg 528w",
		);
	});

	it("offers nothing when only one size would come of it", () => {
		expect(coverSrcSet("https://image.tmdb.org/t/p/w185/abc.jpg")).toBeUndefined();
		expect(coverSrcSet("https://covers.openlibrary.org/b/id/123-M.jpg")).toBeUndefined();
		expect(
			coverSrcSet("https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg"),
		).toBeUndefined();
	});

	it("leaves other hosts and vault pictures alone", () => {
		expect(coverSrcSet("https://m.media-amazon.com/images/S/x.jpg")).toBeUndefined();
		expect(coverSrcSet("app://local/vault/cover.png")).toBeUndefined();
		expect(coverSrcSet("data:image/png;base64,AAAA")).toBeUndefined();
	});
});
