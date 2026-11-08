import { describe, expect, it } from "vitest";
import {
	defaultLibraryConfig,
	layoutOf,
	normalizeLibraryConfig,
	ratingFraction,
	ratingScaleFor,
	statusTone,
	statusesFor,
} from "./config";

const config = defaultLibraryConfig();

describe("albums in an older config", () => {
	it("adds the two new words to a config saved before albums", () => {
		const config = normalizeLibraryConfig({
			inProgressStatuses: "Watching, Reading",
			finishedStatuses: "Watched",
		});
		expect(statusTone(config, "Listening")).toBe("active");
		expect(statusTone(config, "Listened")).toBe("done");
		expect(config.inProgressStatuses).toBe("Watching, Reading, Listening");
	});

	it("does not add a word that is already there", () => {
		const config = normalizeLibraryConfig({
			finishedStatuses: "listened, Watched",
		});
		expect(config.finishedStatuses).toBe("listened, Watched");
	});

	it("gives albums their own statuses", () => {
		expect(statusesFor(defaultLibraryConfig(), "album")).toEqual([
			"To listen",
			"Listening",
			"Listened",
			"On hold",
			"Dropped",
		]);
	});
});

describe("statusTone", () => {
	it("sorts the default vocabulary into its four groups", () => {
		expect(statusTone(config, "Watching")).toBe("active");
		expect(statusTone(config, "Read")).toBe("done");
		expect(statusTone(config, "On hold")).toBe("paused");
		expect(statusTone(config, "Dropped")).toBe("dropped");
	});

	it("ignores case and surrounding space", () => {
		expect(statusTone(config, "  wATCHED ")).toBe("done");
	});

	it("treats anything unlisted as not started yet", () => {
		expect(statusTone(config, "To watch")).toBe("planned");
		expect(statusTone(config, "Wishlist")).toBe("planned");
	});

	it("has no tone for no status", () => {
		expect(statusTone(config, undefined)).toBeNull();
		expect(statusTone(config, "   ")).toBeNull();
	});

	it("follows the user's own lists rather than the words", () => {
		const custom = { ...config, inProgressStatuses: "Currently enjoying" };
		expect(statusTone(custom, "Currently enjoying")).toBe("active");
		// No longer listed as started, so it falls through to planned.
		expect(statusTone(custom, "Watching")).toBe("planned");
	});
});

describe("ratingScaleFor", () => {
	it("falls back to the default scale", () => {
		expect(ratingScaleFor(config, "movie")).toBe(config.ratingScale);
	});

	it("prefers a per-kind override", () => {
		const mixed = { ...config, ratingScales: { movie: 10 } };
		expect(ratingScaleFor(mixed, "movie")).toBe(10);
		expect(ratingScaleFor(mixed, "book")).toBe(5);
	});
});

describe("ratingFraction", () => {
	it("divides by the kind's own scale", () => {
		const mixed = { ...config, ratingScales: { movie: 10 } };
		expect(ratingFraction(mixed, "movie", 8)).toBeCloseTo(0.8);
		expect(ratingFraction(mixed, "book", 4)).toBeCloseTo(0.8);
	});

	it("clamps a rating that overshoots its scale", () => {
		expect(ratingFraction(config, "book", 9)).toBe(1);
	});

	it("is undefined for an unrated entry", () => {
		expect(ratingFraction(config, "book", undefined)).toBeUndefined();
	});
});

describe("normalizeLibraryConfig", () => {
	it("fills in settings a stored config predates", () => {
		const stored = { ratingScale: 10 } as Record<string, unknown>;
		const out = normalizeLibraryConfig(stored);
		expect(out.ratingScale).toBe(10);
		expect(out.pausedStatuses).toBe(config.pausedStatuses);
		expect(out.ratingScales).toEqual({});
	});

	it("drops rating overrides that are not usable scales", () => {
		const out = normalizeLibraryConfig({
			ratingScales: { movie: 10, book: 0, game: NaN },
		});
		expect(out.ratingScales).toEqual({ movie: 10 });
	});
});

describe("stored layout and order", () => {
	it("reads the board under its old name, and drops what it does not know", () => {
		expect(layoutOf("shelves")).toBe("board");
		expect(layoutOf("table")).toBe("table");
		expect(layoutOf("carousel")).toBeUndefined();
		const read = normalizeLibraryConfig({
			layout: "shelves" as never,
			sortBy: "nonsense" as never,
			groupBy: "tone",
		});
		expect(read.layout).toBe("board");
		expect(read.sortBy).toBe(defaultLibraryConfig().sortBy);
		expect(read.groupBy).toBe("tone");
	});
});
