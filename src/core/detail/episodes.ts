import {
	compareEpisodes,
	episodeLabel,
	isWatched,
	toggleWatched,
	type EpisodeId,
	type WatchState,
} from "../library/episodes";
import { shortDate, weekday, daysUntil } from "../format";
import type { EpisodeInfo, SeasonInfo } from "../types";

/** What the episode tab works out, away from React. Pure; the date is passed in. */

/** Whether an episode is out. No date and no word otherwise counts as out. */
export function isOut(episode: EpisodeInfo, today: string): boolean {
	if (episode.upcoming) return false;
	return !episode.airDate || episode.airDate <= today;
}

/** Every episode of the run in order, specials left out. */
export function runOf(seasons: readonly SeasonInfo[]): EpisodeId[] {
	const out: EpisodeId[] = [];
	for (const season of [...seasons].sort((a, b) => a.number - b.number)) {
		if (season.number <= 0) continue;
		for (let episode = 1; episode <= (season.episodeCount ?? 0); episode++) {
			out.push({ season: season.number, episode });
		}
	}
	return out;
}

/** The first episode you have not seen, wherever it is. */
export function firstUnwatched(
	seasons: readonly SeasonInfo[],
	state: WatchState,
): EpisodeId | null {
	return (
		runOf(seasons).find(
			(one) => !isWatched(one, state.marker, state.extra),
		) ?? null
	);
}

/** Share of a season you have seen, from 0 to 1. */
export function seasonFraction(season: SeasonInfo, state: WatchState): number {
	const total = season.episodeCount ?? 0;
	if (total === 0) return 0;
	let seen = 0;
	for (let episode = 1; episode <= total; episode++) {
		if (isWatched({ season: season.number, episode }, state.marker, state.extra)) {
			seen++;
		}
	}
	return seen / total;
}

/**
 * Marking several at once.
 *
 * One tick at a time, in order, because `toggleWatched` already knows how to
 * keep the marker where it can and fall back to loose ticks where it cannot.
 */
export function markEpisodes(
	seasons: readonly SeasonInfo[],
	state: WatchState,
	ids: readonly EpisodeId[],
): WatchState {
	let next = state;
	for (const id of [...ids].sort(compareEpisodes)) {
		if (!isWatched(id, next.marker, next.extra)) {
			next = toggleWatched(seasons, next, id);
		}
	}
	return next;
}

/** Earlier episodes of the run you skipped past to reach this one. */
export function gapBehind(
	seasons: readonly SeasonInfo[],
	state: WatchState,
	id: EpisodeId,
): EpisodeId[] {
	if (id.season <= 0) return [];
	return runOf(seasons).filter(
		(one) =>
			compareEpisodes(one, id) < 0 &&
			!isWatched(one, state.marker, state.extra),
	);
}

/** `S01 E03`, or `E03` for a show with no seasons to speak of. */
export function episodeCode(id: EpisodeId, flat: boolean): string {
	return flat
		? `E${String(id.episode).padStart(2, "0")}`
		: episodeLabel(id.season, id.episode);
}

/** `S01 E01–E04`, across a season break `S01 E09–S02 E02`, or one code alone. */
export function gapLabel(ids: readonly EpisodeId[], flat: boolean): string {
	const first = ids[0];
	const last = ids[ids.length - 1];
	if (!first || !last) return "";
	if (ids.length === 1) return episodeCode(first, flat);
	const end =
		last.season === first.season
			? `E${String(last.episode).padStart(2, "0")}`
			: episodeCode(last, flat);
	return `${episodeCode(first, flat)}–${end}`;
}

/** `New episodes Thursdays`. */
export function releaseDayLine(
	nextAirDate: string | undefined,
): string | undefined {
	return nextAirDate ? `New episodes ${weekday(nextAirDate)}s` : undefined;
}

/**
 * The collapsed end of a season: `4 more episodes · weekly until Thu, 24 Dec`.
 *
 * "Weekly" only when the dates really are a week apart, because a show
 * releasing its last episodes as a double bill is not weekly.
 */
export function upcomingLine(hidden: readonly EpisodeInfo[]): string {
	const count = hidden.length;
	const noun = count === 1 ? "more episode" : "more episodes";
	const dates = hidden
		.map((one) => one.airDate)
		.filter((one): one is string => Boolean(one));
	const last = dates[dates.length - 1];
	if (!last) return `${count} ${noun}`;
	const weekly =
		dates.length === hidden.length &&
		dates.every((one, at) => {
			const before = dates[at - 1];
			return before === undefined || daysUntil(one, before) === 7;
		});
	return `${count} ${noun} · ${weekly ? "weekly " : ""}until ${shortDate(last)}`;
}
