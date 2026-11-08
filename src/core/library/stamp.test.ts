import { describe, expect, it } from "vitest";
import { defaultLibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import { statusDates } from "./stamp";

const config = defaultLibraryConfig();
const { started, finished } = config.fields;
const TODAY = "2026-11-07";

const ACTIVE = config.inProgressStatuses.split(",")[0]!.trim();
const DONE = config.finishedStatuses.split(",")[0]!.trim();
const PAUSED = config.pausedStatuses.split(",")[0]!.trim();
const PLANNED = "Backlog";

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
	return {
		path: "Media/Arrival.md",
		basename: "Arrival",
		title: "Arrival",
		kind: "movie",
		tags: [],
		people: [],
		authored: [],
		favorite: false,
		history: [],
		episodeLog: {},
		collections: [],
		created: 0,
		modified: 0,
		frontmatter: {},
		...overrides,
	};
}

describe("statusDates", () => {
	it("dates the start when something begins", () => {
		expect(statusDates(config, entry({ status: PLANNED }), ACTIVE, TODAY)).toEqual({
			patch: { [started]: TODAY },
			undated: false,
		});
		expect(statusDates(config, entry(), ACTIVE, TODAY).patch).toEqual({
			[started]: TODAY,
		});
	});

	it("dates the finish when something under way is finished", () => {
		for (const from of [ACTIVE, PAUSED]) {
			const result = statusDates(
				config,
				entry({ status: from, started: "2026-10-01" }),
				DONE,
				TODAY,
			);
			expect(result).toEqual({ patch: { [finished]: TODAY }, undated: false });
		}
	});

	it("does not invent a start date when finishing", () => {
		const result = statusDates(config, entry({ status: ACTIVE }), DONE, TODAY);
		expect(result.patch).toEqual({ [finished]: TODAY });
	});

	// The case this exists for: logging something you finished long ago.
	it("writes no dates when jumping straight to done, and says so", () => {
		for (const status of [undefined, PLANNED]) {
			expect(statusDates(config, entry({ status }), DONE, TODAY)).toEqual({
				patch: {},
				undated: true,
			});
		}
	});

	it("never overwrites a date that is already there", () => {
		expect(
			statusDates(config, entry({ status: PLANNED, started: "2020-01-01" }), ACTIVE, TODAY)
				.patch,
		).toEqual({});
		expect(
			statusDates(config, entry({ status: ACTIVE, finished: "2020-01-01" }), DONE, TODAY),
		).toEqual({ patch: {}, undated: false });
	});

	it("does not restart the clock when resuming something paused", () => {
		expect(statusDates(config, entry({ status: PAUSED }), ACTIVE, TODAY).patch).toEqual({});
	});

	it("does nothing when turned off or cleared", () => {
		const off = { ...config, autoTimestamps: false };
		expect(statusDates(off, entry(), ACTIVE, TODAY).patch).toEqual({});
		expect(statusDates(config, entry({ status: ACTIVE }), null, TODAY)).toEqual({
			patch: {},
			undated: false,
		});
	});
});
