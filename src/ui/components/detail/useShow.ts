import { useMemo, useState } from "react";
import type { ScoutContext } from "../../../core/context";
import { firstUnwatched } from "../../../core/detail/episodes";
import type { LibraryEntry } from "../../../core/library/entry";
import {
	countWatched,
	type EpisodeId,
	type WatchState,
} from "../../../core/library/episodes";
import { isEpisodic } from "../../../core/provider";
import type {
	EpisodeInfo,
	MediaKind,
	MediaRef,
	SeasonInfo,
} from "../../../core/types";
import { useProviderData } from "../shared";

/** What the note holds, in the shape the pure helpers work in. */
export function watchStateOf(entry: LibraryEntry | undefined): WatchState {
	return {
		marker: entry?.currentEpisode ?? null,
		extra: new Set(entry?.watchedEpisodes ?? []),
	};
}

/** The last thing the Up next card did, so it can be taken back. */
export interface Undoable {
	id: EpisodeId;
	before: WatchState;
}

/**
 * Where you are in a series, for every part of the dialog that shows it.
 *
 * The header, the Up next card, and the episode tab all read this one object, so
 * ticking an episode moves them together.
 */
export interface Show {
	/** The whole list including specials. */
	seasons: SeasonInfo[];
	/** Without the specials. */
	run: SeasonInfo[];
	loading: boolean;
	error: string | null;
	/** Anime has one long run, so episodes are `E03` rather than `S01 E03`. */
	flat: boolean;
	state: WatchState;
	seen: number;
	total: number;
	next: EpisodeId | null;
	nextEpisode: EpisodeInfo | undefined;
	/** The next episode's season is still on its way. */
	nextLoading: boolean;
	lastMarked: Undoable | null;
	commit: (next: WatchState) => void;
	/** Commits, remembering how to take it back. */
	markNext: (next: WatchState, id: EpisodeId) => void;
	undo: () => void;
}

export function useShow(
	ctx: ScoutContext,
	source: MediaRef | undefined,
	entry: LibraryEntry | undefined,
	kind: MediaKind,
	enabled: boolean,
): Show {
	const provider = source ? ctx.registry.get(source.providerId) : undefined;
	const episodic =
		enabled && provider && isEpisodic(provider) ? provider : null;
	const key = source ? `${source.providerId}:${source.id}` : "none";

	const loaded = useProviderData<SeasonInfo[]>(
		episodic && source
			? (signal) => episodic.seasons(source, { signal })
			: null,
		`${key}:seasons`,
	);
	const seasons = useMemo(() => loaded.data ?? [], [loaded.data]);
	const run = useMemo(
		() => seasons.filter((season) => season.number > 0),
		[seasons],
	);

	const state = watchStateOf(entry);
	const next = firstUnwatched(run, state);
	const total = run.reduce((sum, one) => sum + (one.episodeCount ?? 0), 0);

	const nextSeason = next?.season ?? null;
	const inSeason = useProviderData<EpisodeInfo[]>(
		episodic && source && nextSeason !== null
			? (signal) => episodic.episodes(source, nextSeason, { signal })
			: null,
		`${key}:next:${nextSeason ?? "none"}`,
	);
	const nextEpisode = inSeason.data?.find(
		(one) => one.number === next?.episode,
	);

	const [lastMarked, setLastMarked] = useState<Undoable | null>(null);

	const commit = (value: WatchState) => {
		if (!entry) return;
		void ctx.mutator.setEpisode(entry, value, countWatched(run, value));
	};

	return {
		seasons,
		run,
		loading: loaded.loading,
		error: loaded.error,
		flat: kind === "anime",
		state,
		seen: countWatched(run, state),
		total,
		next,
		nextEpisode,
		nextLoading: inSeason.loading,
		lastMarked,
		commit: (value) => {
			setLastMarked(null);
			commit(value);
		},
		markNext: (value, id) => {
			setLastMarked({ id, before: state });
			commit(value);
		},
		undo: () => {
			if (!lastMarked) return;
			commit(lastMarked.before);
			setLastMarked(null);
		},
	};
}
