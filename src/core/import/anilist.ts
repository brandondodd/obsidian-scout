import type { StatusTone } from "../library/config";
import { sourceKey, type MediaItem } from "../types";
import type { ImportRecord } from "./types";
import { plainText, splitFinishes } from "./util";

/**
 * A public AniList profile's lists.
 *
 * The one import that needs no matching: every entry arrives with AniList's
 * own record attached, so the note is made from exactly that title. The
 * provider fetches and maps the media; this turns the list half of each entry
 * into Scout's terms, and is pure so it can be checked without the network.
 */

/** AniList's fuzzy date: any part may be missing. */
export interface FuzzyDate {
	year?: number | null;
	month?: number | null;
	day?: number | null;
}

/** The list half of one `MediaList`, with its score asked for out of 100. */
export interface AniListListEntry {
	status?: string | null;
	/** `score(format: POINT_100)`, so the user's own format does not matter. */
	score?: number | null;
	progress?: number | null;
	repeat?: number | null;
	notes?: string | null;
	startedAt?: FuzzyDate | null;
	completedAt?: FuzzyDate | null;
	/** Unix seconds. */
	createdAt?: number | null;
}

const TONES: Record<string, StatusTone> = {
	CURRENT: "active",
	REPEATING: "active",
	PLANNING: "planned",
	COMPLETED: "done",
	DROPPED: "dropped",
	PAUSED: "paused",
};

/** Only a date known to the day: a month on its own is not a day it happened. */
export function fuzzyIso(date: FuzzyDate | null | undefined): string | undefined {
	if (!date?.year || !date.month || !date.day) return undefined;
	return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function unixIso(seconds: number | null | undefined): string | undefined {
	if (!seconds || seconds <= 0) return undefined;
	return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function fromAniList(
	rows: readonly { item: MediaItem; entry: AniListListEntry }[],
): ImportRecord[] {
	return rows.map(({ item, entry }) => {
		const tone = TONES[entry.status ?? ""] ?? "planned";
		const completed = fuzzyIso(entry.completedAt);
		// Rewatching: the completion on record belongs to an earlier time through.
		const rewatching = entry.status === "REPEATING";
		const { finished, history } = splitFinishes(
			completed && !rewatching ? [completed] : [],
		);
		const score = entry.score ?? 0;

		return {
			key: sourceKey(item.ref),
			kind: item.ref.kind,
			title: item.title,
			year: item.year,
			authors: [],
			isbns: [],
			item,
			tone,
			rating: score > 0 ? Math.min(score / 100, 1) : undefined,
			started: fuzzyIso(entry.startedAt),
			finished: tone === "done" ? finished : undefined,
			history: rewatching && completed ? [completed] : history,
			progress: entry.progress && entry.progress > 0 ? entry.progress : undefined,
			added: unixIso(entry.createdAt),
			favorite: false,
			review: plainText(entry.notes ?? undefined),
		};
	});
}
