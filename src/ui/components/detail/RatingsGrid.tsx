import React from "react";
import { average, HEAT_RAMP, heatBins } from "../../../core/detail/heat";
import { oneDecimal } from "../../../core/format";
import type { LibraryEntry } from "../../../core/library/entry";
import { episodeKey, episodeLabel } from "../../../core/library/episodes";
import type { EpisodeInfo, SeasonInfo } from "../../../core/types";
import type {
	EpisodeView,
	GridSeason,
	ScoreSource,
} from "./useEpisodeView";

/** One episode's score, from whichever source the switch is on. */
export function gridScore(
	source: ScoreSource,
	season: GridSeason,
	episode: EpisodeInfo,
	entry: LibraryEntry | undefined,
): number | undefined {
	if (source === "you") {
		return entry?.episodeLog[episodeKey(season.number, episode.number)]?.rating;
	}
	if (source === "imdb") return season.imdb.get(episode.number);
	return episode.rating;
}

/** Whether the grid has anything for the key to explain. */
export function gridHasScores(
	view: EpisodeView,
	entry: LibraryEntry | undefined,
): boolean {
	return (view.grid.data ?? []).some((season) =>
		season.episodes.some((one) =>
			Boolean(gridScore(view.source, season, one, entry)),
		),
	);
}

/**
 * Every episode of every season, shaded against each other.
 *
 * Unrated cells are plain, faint squares and stay clickable, because the point of
 * a cell is getting to that episode. Long seasons scroll sideways.
 */
export function RatingsGrid({
	view,
	entry,
	run,
	onPick,
}: {
	view: EpisodeView;
	entry: LibraryEntry | undefined;
	/** The seasons as the record lists them, to draw the grid before it fills. */
	run: readonly SeasonInfo[];
	onPick: (season: number, episode: number) => void;
}): React.ReactElement {
	const seasons = view.grid.data;
	if (view.grid.error) return <p className="scout-error">{view.grid.error}</p>;
	if (!seasons) return <GridSkeleton run={run} />;

	const scored = seasons.flatMap((season) =>
		season.episodes.flatMap((episode) => {
			const score = gridScore(view.source, season, episode, entry);
			return score
				? [{ season: season.number, episode: episode.number, score }]
				: [];
		}),
	);
	const bin = heatBins(scored.map((one) => one.score));
	const best = scored.reduce<(typeof scored)[number] | null>(
		(top, one) => (!top || one.score > top.score ? one : top),
		null,
	);
	const widest = Math.max(1, ...seasons.map((one) => one.episodes.length));
	const columns = Array.from({ length: widest }, (_, at) => at);

	return (
		<div className="sd-heat">
			<table style={{ "--mx": widest } as React.CSSProperties}>
				<thead>
					<tr>
						<th />
						{columns.map((at) => (
							<th key={at}>E{at + 1}</th>
						))}
						<th>Avg</th>
					</tr>
				</thead>
				<tbody>
					{seasons.map((season) => {
						const row = season.episodes
							.map((one) => gridScore(view.source, season, one, entry))
							.filter((one): one is number => Boolean(one));
						const mean = average(row);
						return (
							<tr key={season.number}>
								<th>S{season.number}</th>
								{columns.map((at) => {
									const episode = season.episodes[at];
									if (!episode) return <td key={at} />;
									const code = episodeLabel(season.number, episode.number);
									const score = gridScore(
										view.source,
										season,
										episode,
										entry,
									);
									const pick = () =>
										onPick(season.number, episode.number);
									if (!score) {
										return (
											<td key={at}>
												<button
													className="sd-none"
													title={`${code} · not rated`}
													aria-label={`${code}, not rated`}
													onClick={pick}
												/>
											</td>
										);
									}
									const isBest =
										best?.season === season.number &&
										best.episode === episode.number;
									const shade = HEAT_RAMP[bin(score)];
									return (
										<td key={at}>
											<button
												style={{
													background: shade?.[0],
													color: shade?.[1],
												}}
												title={`${code} · ${episode.title} · ${oneDecimal(score)}${
													isBest ? " · Best episode" : ""
												}`}
												onClick={pick}
											>
												{isBest && (
													<span
														className="sd-bst"
														aria-label="Best episode"
													>
														★
													</span>
												)}
												{oneDecimal(score)}
											</button>
										</td>
									);
								})}
								<td className="sd-avg">
									{mean === undefined ? "–" : oneDecimal(mean)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

/**
 * The grid's own shape while every season is fetched: a row a season and a cell
 * an episode, from the counts the record already has, so only the cells change
 * when the scores land.
 */
function GridSkeleton({
	run,
}: {
	run: readonly SeasonInfo[];
}): React.ReactElement {
	const widest = Math.max(1, ...run.map((one) => one.episodeCount ?? 0));
	const columns = Array.from({ length: widest }, (_, at) => at);
	return (
		<div className="sd-heat" aria-busy="true" aria-label="Loading ratings">
			<table style={{ "--mx": widest } as React.CSSProperties}>
				<thead>
					<tr>
						<th />
						{columns.map((at) => (
							<th key={at}>E{at + 1}</th>
						))}
						<th>Avg</th>
					</tr>
				</thead>
				<tbody>
					{run.map((season) => (
						<tr key={season.number}>
							<th>S{season.number}</th>
							{columns.map((at) => (
								<td key={at}>
									{at < (season.episodeCount ?? widest) && (
										<span className="sd-bone sd-cell" />
									)}
								</td>
							))}
							<td className="sd-avg">–</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
