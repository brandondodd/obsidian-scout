import { describe, expect, it } from "vitest";
import { isWatched, type WatchState } from "../library/episodes";
import type { EpisodeInfo, SeasonInfo } from "../types";
import {
	episodeCode,
	firstUnwatched,
	gapBehind,
	gapLabel,
	isOut,
	markEpisodes,
	releaseDayLine,
	seasonFraction,
	upcomingLine,
} from "./episodes";

const seasons: SeasonInfo[] = [
	{ number: 0, name: "Specials", episodeCount: 2 },
	{ number: 1, name: "Season 1", episodeCount: 3 },
	{ number: 2, name: "Season 2", episodeCount: 2 },
];
const run = seasons.filter((one) => one.number > 0);
const none: WatchState = { marker: null, extra: new Set() };
const episode = (over: Partial<EpisodeInfo>): EpisodeInfo => ({
	season: 1,
	number: 1,
	title: "E",
	...over,
});

describe("isOut", () => {
	const today = "2026-11-05";

	it("goes by the air date, counting today as out", () => {
		expect(isOut(episode({ airDate: "2026-11-05" }), today)).toBe(true);
		expect(isOut(episode({ airDate: "2026-11-06" }), today)).toBe(false);
	});

	it("counts an episode with no date as out", () => {
		expect(isOut(episode({}), today)).toBe(true);
	});

	it("believes a source that says it is still to come", () => {
		expect(isOut(episode({ upcoming: true }), today)).toBe(false);
	});
});

describe("firstUnwatched", () => {
	it("starts at the top of the run, past the specials", () => {
		expect(firstUnwatched(run, none)).toEqual({ season: 1, episode: 1 });
	});

	it("finds a hole behind the marker's loose ticks", () => {
		const state = { marker: null, extra: new Set(["S01E01", "S01E03"]) };
		expect(firstUnwatched(run, state)).toEqual({ season: 1, episode: 2 });
	});

	it("is null once everything is watched", () => {
		const state = { marker: { season: 2, episode: 2 }, extra: new Set<string>() };
		expect(firstUnwatched(run, state)).toBeNull();
	});
});

describe("seasonFraction", () => {
	it("measures one season for the progress underline", () => {
		const state = { marker: { season: 1, episode: 3 }, extra: new Set(["S02E01"]) };
		expect(seasonFraction(run[0]!, state)).toBe(1);
		expect(seasonFraction(run[1]!, state)).toBe(0.5);
	});

	it("is zero for a season with no episode count", () => {
		expect(seasonFraction({ number: 1, name: "S" }, none)).toBe(0);
	});
});

describe("markEpisodes", () => {
	it("marks a run from the start into the marker", () => {
		const next = markEpisodes(seasons, none, [
			{ season: 1, episode: 2 },
			{ season: 1, episode: 1 },
		]);
		expect(next.marker).toEqual({ season: 1, episode: 2 });
		expect(next.extra.size).toBe(0);
	});

	it("marks a later season as loose ticks, leaving earlier ones unwatched", () => {
		const next = markEpisodes(seasons, none, [
			{ season: 2, episode: 1 },
			{ season: 2, episode: 2 },
		]);
		expect(next.marker).toBeNull();
		expect([...next.extra].sort()).toEqual(["S02E01", "S02E02"]);
	});

	it("never unticks something already watched", () => {
		const state = { marker: { season: 1, episode: 1 }, extra: new Set<string>() };
		const next = markEpisodes(seasons, state, [
			{ season: 1, episode: 1 },
			{ season: 1, episode: 2 },
		]);
		const first = { season: 1, episode: 1 };
		expect(isWatched(first, next.marker, next.extra)).toBe(true);
	});
});

describe("gapBehind", () => {
	it("lists what was skipped, across seasons", () => {
		expect(gapBehind(run, none, { season: 2, episode: 1 })).toEqual([
			{ season: 1, episode: 1 },
			{ season: 1, episode: 2 },
			{ season: 1, episode: 3 },
		]);
	});

	it("is empty when you are next in line", () => {
		const state = { marker: { season: 1, episode: 2 }, extra: new Set<string>() };
		expect(gapBehind(run, state, { season: 1, episode: 3 })).toEqual([]);
	});

	it("does not apply to specials", () => {
		expect(gapBehind(run, none, { season: 0, episode: 1 })).toEqual([]);
	});
});

describe("codes", () => {
	it("drops the season from a flat run", () => {
		const id = { season: 1, episode: 3 };
		expect(episodeCode(id, false)).toBe("S01 E03");
		expect(episodeCode(id, true)).toBe("E03");
	});

	it("labels a gap", () => {
		const a = { season: 1, episode: 1 };
		const b = { season: 1, episode: 4 };
		const c = { season: 2, episode: 2 };
		expect(gapLabel([a], false)).toBe("S01 E01");
		expect(gapLabel([a, b], false)).toBe("S01 E01–E04");
		expect(gapLabel([a, c], false)).toBe("S01 E01–S02 E02");
		expect(gapLabel([a, b], true)).toBe("E01–E04");
	});
});

describe("releaseDayLine", () => {
	it("names the day", () => {
		expect(releaseDayLine("2026-11-12")).toBe("New episodes Thursdays");
		expect(releaseDayLine(undefined)).toBeUndefined();
	});
});

describe("upcomingLine", () => {
	const on = (airDate: string) => episode({ airDate });

	it("says weekly only when the dates are a week apart", () => {
		expect(upcomingLine([on("2026-11-12"), on("2026-11-19")])).toMatch(
			/^2 more episodes · weekly until /,
		);
		expect(upcomingLine([on("2026-11-12"), on("2026-11-13")])).toMatch(
			/^2 more episodes · until /,
		);
	});

	it("gets by without dates", () => {
		expect(upcomingLine([episode({}), episode({})])).toBe("2 more episodes");
		expect(upcomingLine([episode({})])).toBe("1 more episode");
	});
});
