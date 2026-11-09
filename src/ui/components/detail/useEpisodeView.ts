import { useMemo, useState } from "react";
import type { ScoutContext } from "../../../core/context";
import type { ItemExtras } from "../../../core/detail/types";
import type { LibraryEntry } from "../../../core/library/entry";
import { isEpisodic } from "../../../core/provider";
import type { EpisodeInfo, MediaRef } from "../../../core/types";
import { useProviderData, type Async } from "../shared";
import type { Show } from "./useShow";

export type ScoreSource = "imdb" | "tmdb" | "you";
export type EpisodeMode = "list" | "grid";

const NAMES: Record<ScoreSource, string> = {
	imdb: "IMDb",
	tmdb: "TMDB",
	you: "You",
};

/** One season of the ratings grid. */
export interface GridSeason {
	number: number;
	episodes: EpisodeInfo[];
	imdb: Map<number, number>;
}

/**
 * What the toolbar and the page under it share.
 *
 * They are separate because the toolbar sticks to the top of the dialog with the
 * tabs while the page scrolls, so the state has to live above both.
 */
export interface EpisodeView {
	mode: EpisodeMode;
	setMode: (mode: EpisodeMode) => void;
	season: number | null;
	setSeason: (season: number) => void;
	/** What the "Scores from" switch offers. */
	sources: ScoreSource[];
	source: ScoreSource;
	setSource: (source: ScoreSource) => void;
	/** The score bars and rows use: never "You", which has its own control. */
	publicName: string | null;
	episodes: Async<EpisodeInfo[]>;
	/**
	 * The season's public scores are on their way. They come from a second
	 * source, and landing after the list they drew the summary in above it.
	 */
	scoresLoading: boolean;
	/** The public score for an episode. */
	scoreOf: (episode: EpisodeInfo) => number | undefined;
	grid: Async<GridSeason[]>;
	sourceName: (source: ScoreSource) => string;
}

export function useEpisodeView(
	ctx: ScoutContext,
	source: MediaRef | undefined,
	entry: LibraryEntry | undefined,
	extras: ItemExtras,
	show: Show,
	active: boolean,
): EpisodeView {
	const provider = source ? ctx.registry.get(source.providerId) : undefined;
	const episodic = provider && isEpisodic(provider) ? provider : null;
	const key = source ? `${source.providerId}:${source.id}` : "none";

	const [mode, setMode] = useState<EpisodeMode>("list");
	const [picked, setPicked] = useState<number | null>(null);
	const [chosen, setChosen] = useState<ScoreSource | null>(null);

	const imdbId = extras.imdbId;
	const imdbOn = Boolean(imdbId) && ctx.detail.hasEpisodeImdb();
	const tmdbOn = source?.providerId === "tmdb";

	const sources = useMemo<ScoreSource[]>(
		() => [
			...(imdbOn ? (["imdb"] as const) : []),
			...(tmdbOn ? (["tmdb"] as const) : []),
			...(entry ? (["you"] as const) : []),
		],
		[imdbOn, tmdbOn, entry],
	);
	const fallback: ScoreSource = imdbOn ? "imdb" : tmdbOn ? "tmdb" : "you";
	const current =
		chosen && sources.includes(chosen) ? chosen : fallback;
	const publicSource: ScoreSource | null =
		current !== "you" ? current : imdbOn ? "imdb" : tmdbOn ? "tmdb" : null;

	const list = show.seasons;
	const first = show.run[0]?.number ?? list[0]?.number ?? null;
	const wanted =
		picked ?? show.next?.season ?? show.state.marker?.season ?? first;
	// The marker may name a season the source no longer lists: a show
	// renumbered, or a note written by hand.
	const season =
		wanted !== null && list.some((one) => one.number === wanted)
			? wanted
			: first;

	const episodes = useProviderData<EpisodeInfo[]>(
		active && episodic && source && season !== null
			? (signal) => episodic.episodes(source, season, { signal })
			: null,
		`${key}:episodes:${active ? (season ?? "none") : "off"}`,
	);

	const wantImdb = active && publicSource === "imdb" && imdbId && season !== null;
	const imdb = useProviderData<Map<number, number>>(
		wantImdb && imdbId && season !== null
			? (signal) => ctx.detail.imdbSeason(imdbId, season, signal)
			: null,
		`${key}:imdb:${wantImdb ? season : "off"}`,
	);

	const seasonsKey = show.run.map((one) => one.number).join(",");
	const grid = useProviderData<GridSeason[]>(
		active && mode === "grid" && episodic && source
			? async (signal) => {
					const useImdb = imdbOn && imdbId;
					return Promise.all(
						show.run.map(async (one) => ({
							number: one.number,
							episodes: await episodic.episodes(source, one.number, {
								signal,
							}),
							imdb: useImdb
								? await ctx.detail
										.imdbSeason(imdbId, one.number, signal)
										.catch(() => new Map<number, number>())
								: new Map<number, number>(),
						})),
					);
				}
			: null,
		`${key}:grid:${active && mode === "grid" ? seasonsKey : "off"}:${imdbOn}`,
	);

	return {
		mode,
		setMode,
		season,
		setSeason: (value) => {
			setPicked(value);
			setMode("list");
		},
		sources,
		source: current,
		setSource: setChosen,
		publicName: publicSource ? NAMES[publicSource] : null,
		episodes,
		scoresLoading: imdb.loading,
		scoreOf: (episode) =>
			publicSource === "imdb"
				? imdb.data?.get(episode.number)
				: publicSource === "tmdb"
					? episode.rating
					: undefined,
		grid,
		sourceName: (one) => NAMES[one],
	};
}
