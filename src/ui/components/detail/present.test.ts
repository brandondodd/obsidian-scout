import { describe, expect, it } from "vitest";
import { peopleToShow } from "./present";

describe("peopleToShow", () => {
	it("prefers the source's own list", () => {
		const cast = [{ name: "Gary Oldman", role: "Jackson Lamb" }];
		expect(peopleToShow("book", cast, ["Mick Herron"])).toEqual(cast);
	});

	it("stands the note's names in for a cast on screen kinds", () => {
		expect(peopleToShow("movie", [], ["Ana", "Ben"])).toEqual([
			{ name: "Ana" },
			{ name: "Ben" },
		]);
		expect(peopleToShow("anime", [], ["Kana"])).toEqual([{ name: "Kana" }]);
	});

	it("leaves authors, artists and studios out of the grid", () => {
		for (const kind of ["book", "manga", "album", "game", "link"] as const) {
			expect(peopleToShow(kind, [], ["Someone"])).toEqual([]);
		}
	});
});
