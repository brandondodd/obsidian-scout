import { describe, expect, it } from "vitest";
import {
	daysUntil,
	formatRuntime,
	oneDecimal,
	plural,
	relativeDay,
	todayIso,
} from "./format";

describe("oneDecimal", () => {
	it("always writes one decimal place", () => {
		expect(oneDecimal(8)).toBe("8.0");
		expect(oneDecimal(7.5)).toBe("7.5");
		expect(oneDecimal(7.26)).toBe("7.3");
		expect(oneDecimal(10)).toBe("10.0");
	});
});

describe("formatRuntime", () => {
	it("reads in hours and minutes", () => {
		expect(formatRuntime(102)).toBe("1h 42m");
		expect(formatRuntime(48)).toBe("48m");
		expect(formatRuntime(120)).toBe("2h");
	});

	it("says nothing for nothing", () => {
		expect(formatRuntime(0)).toBeUndefined();
		expect(formatRuntime(undefined)).toBeUndefined();
	});
});

describe("plural", () => {
	it("agrees with the count", () => {
		expect(plural(1, "season")).toBe("1 season");
		expect(plural(6, "season")).toBe("6 seasons");
	});
});

describe("days", () => {
	it("counts whole days between dates", () => {
		expect(daysUntil("2026-11-12", "2026-11-05")).toBe(7);
		expect(daysUntil("2026-11-01", "2026-11-05")).toBe(-4);
	});

	it("says it the way a person would", () => {
		expect(relativeDay("2026-11-05", "2026-11-05")).toBe("today");
		expect(relativeDay("2026-11-06", "2026-11-05")).toBe("tomorrow");
		expect(relativeDay("2026-11-11", "2026-11-05")).toBe("in 6 days");
	});

	it("takes today in the reader's own time zone", () => {
		expect(todayIso(new Date(2026, 10, 5, 23, 30))).toBe("2026-11-05");
	});
});
