import { describe, expect, it } from "vitest";
import {
	ageRatingBadge,
	ageRatingFact,
	pickAgeRating,
	regionFromLocale,
	regionName,
	resolveRegion,
} from "./region";

describe("regionFromLocale", () => {
	it("reads the country from a locale", () => {
		expect(regionFromLocale("en-GB")).toBe("GB");
		expect(regionFromLocale("pt_BR")).toBe("BR");
	});

	it("skips a script subtag", () => {
		expect(regionFromLocale("zh-Hant-TW")).toBe("TW");
	});

	it("falls back when the locale names no country", () => {
		expect(regionFromLocale("en")).toBe("US");
		expect(regionFromLocale(undefined)).toBe("US");
	});
});

describe("resolveRegion", () => {
	it("prefers the setting over the system", () => {
		expect(resolveRegion("de", "en-GB")).toBe("DE");
	});

	it("follows the system when the setting is empty or nonsense", () => {
		expect(resolveRegion("", "en-GB")).toBe("GB");
		expect(resolveRegion("Germany", "en-GB")).toBe("GB");
	});
});

describe("regionName", () => {
	it("spells a region out", () => {
		expect(regionName("GB")).toBe("United Kingdom");
	});
});

describe("pickAgeRating", () => {
	const ratings = [
		{ region: "US", label: "TV-MA" },
		{ region: "GB", label: "15" },
		{ region: "FR", label: "" },
	];

	it("uses your region's own rating, unlabelled", () => {
		const rating = pickAgeRating(ratings, "GB");
		expect(rating).toEqual({ region: "GB", label: "15", fallback: false });
		expect(ageRatingBadge(rating!)).toBe("15");
	});

	it("labels a rating that came from somewhere else", () => {
		const rating = pickAgeRating(ratings, "DE");
		expect(rating?.fallback).toBe(true);
		expect(ageRatingBadge(rating!)).toBe("TV-MA (US)");
	});

	it("treats a blank certificate as no rating", () => {
		expect(pickAgeRating(ratings, "FR")?.region).toBe("US");
	});

	it("falls back to whatever exists, and says whose it is", () => {
		const rating = pickAgeRating([{ region: "JP", label: "PG12" }], "DE");
		expect(ageRatingBadge(rating!)).toBe("PG12 (JP)");
	});

	it("has nothing to say with no ratings", () => {
		expect(pickAgeRating([], "GB")).toBeUndefined();
	});

	it("names the country in Details even when it is yours", () => {
		expect(ageRatingFact({ region: "GB", label: "15", fallback: false })).toBe(
			"15 (UK)",
		);
	});
});
