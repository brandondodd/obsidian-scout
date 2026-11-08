import { describe, expect, it } from "vitest";
import { toBookReadings } from "./ratings";

describe("toBookReadings", () => {
	it("keeps the average out of ten with its count, and drops the unrated", () => {
		const out = toBookReadings([
			{ key: "/works/OL1W", ratings_average: 4.45, ratings_count: 11 },
			{ key: "/works/OL2W", ratings_average: 0, ratings_count: 0 },
			{ key: "/works/OL3W" },
		]);
		expect([...out.keys()]).toEqual(["OL1W"]);
		expect(out.get("OL1W")).toEqual({ source: "openlibrary", value: 8.9, votes: 11 });
	});
});
