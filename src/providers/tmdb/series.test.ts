import { describe, expect, it } from "vitest";
import { seriesBase } from "./provider";

describe("seriesBase", () => {
	it("reads collections split from one series as the same series", () => {
		expect(seriesBase("The Hunger Games Collection")).toBe("The Hunger Games");
		expect(seriesBase("The Hunger Games – New Trilogy Collection")).toBe("The Hunger Games");
	});

	it("leaves a name with nothing to strip alone, and nothing as nothing", () => {
		expect(seriesBase("Dune Collection")).toBe("Dune");
		// A colon names a series of its own, not part of a bigger one.
		expect(seriesBase("Spider-Man: Spider-Verse Collection")).toBe("Spider-Man: Spider-Verse");
		expect(seriesBase(undefined)).toBeUndefined();
	});
});
