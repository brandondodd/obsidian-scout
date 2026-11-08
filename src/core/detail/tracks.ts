/**
 * Favourite tracks, kept in the note as a plain list of numbers:
 *
 *     favorite_tracks: [3, 7]
 *
 * Ratings do not need a property of their own: a track is written to the episode
 * log as `S01E03`, so they get the same reading, writing, and hand editing that
 * episode ratings already have. Pure.
 */

export const FAVORITE_TRACKS_KEY = "favorite_tracks";

/** Season one of the log, which is the only one an album has. */
export const TRACK_SEASON = 1;

export function readFavoriteTracks(raw: unknown): number[] {
	const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
	return list
		.map((one) => Number(one))
		.filter((one) => Number.isInteger(one) && one > 0);
}

/** Back to a frontmatter value, in order. Null removes the property. */
export function toggleTrack(
	current: readonly number[],
	track: number,
): number[] | null {
	const next = current.includes(track)
		? current.filter((one) => one !== track)
		: [...current, track];
	return next.length > 0 ? [...next].sort((a, b) => a - b) : null;
}
