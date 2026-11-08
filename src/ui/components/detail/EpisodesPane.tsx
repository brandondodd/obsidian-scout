import React, { useEffect, useMemo, useState } from "react";
import type { ScoutContext } from "../../../core/context";
import {
	episodeCode,
	gapBehind,
	gapLabel,
	isOut,
	markEpisodes,
	upcomingLine,
} from "../../../core/detail/episodes";
import { average, barHeight } from "../../../core/detail/heat";
import { oneDecimal, shortDate, todayIso } from "../../../core/format";
import type { LibraryEntry } from "../../../core/library/entry";
import {
	isWatched,
	markUpTo,
	toggleWatched,
	type EpisodeId,
} from "../../../core/library/episodes";
import type { EpisodeInfo } from "../../../core/types";
import { Icon } from "../shared";
import { EpisodeRow, rowId, UpcomingRow } from "./EpisodeRow";
import { RatingsGrid } from "./RatingsGrid";
import { EpisodesSkeleton } from "./Skeleton";
import type { EpisodeView } from "./useEpisodeView";
import type { Show } from "./useShow";

/** The bars: one per episode, tallest the best, and each one a way in. */
function RatingBars({
	episodes,
	show,
	view,
	today,
	onJump,
}: {
	episodes: readonly EpisodeInfo[];
	show: Show;
	view: EpisodeView;
	today: string;
	onJump: (id: EpisodeId) => void;
}): React.ReactElement {
	return (
		<div className="sd-strip">
			{episodes.map((episode) => {
				const id = { season: episode.season, episode: episode.number };
				const out = isOut(episode, today);
				const score = out ? view.scoreOf(episode) : undefined;
				const seen = isWatched(id, show.state.marker, show.state.extra);
				const next =
					show.next?.season === id.season &&
					show.next.episode === id.episode;
				const code = episodeCode(id, show.flat);
				const said = score
					? ` · ${view.publicName} ${oneDecimal(score)}`
					: out
						? " · no score yet"
						: episode.airDate
							? ` · ${shortDate(episode.airDate)}`
							: "";
				return (
					<button
						key={episode.number}
						className={`sd-bar${!out ? " sd-un" : seen ? " sd-w" : ""}`}
						title={`${code} · ${episode.title}${said}`}
						onClick={() => onJump(id)}
					>
						<span className="sd-cw">
							<span className="sd-val">
								{score ? oneDecimal(score) : ""}
							</span>
							<span
								className="sd-col"
								style={{ height: score ? barHeight(score) : 6 }}
							/>
						</span>
						<span className={`sd-lab2${next ? " sd-nx" : ""}`}>
							{next ? "Next" : episode.number}
						</span>
					</button>
				);
			})}
		</div>
	);
}

/** Plain text beside the bars: the average, whose it is, and how far you are. */
function SeasonSummary({
	mean,
	name,
	seen,
	total,
	tracked,
}: {
	mean: number;
	name: string | null;
	seen: number;
	total: number;
	tracked: boolean;
}): React.ReactElement {
	return (
		<div className="sd-stile">
			<b>★ {oneDecimal(mean)}</b>
			<span>{name} average</span>
			{tracked &&
				(seen === total ? (
					<span className="sd-donelbl">
						<Icon name="check" size={13} /> Watched
					</span>
				) : (
					<span>
						{seen} of {total} watched
					</span>
				))}
		</div>
	);
}

/**
 * How many episode rows to build at once.
 *
 * One Piece is a single run of well over a thousand, and that many rows with
 * stills is more than a phone should be asked to lay out to show you one.
 */
const ROW_WINDOW = 100;

/** How far before your next episode the window opens. */
const ROW_LEAD = 10;

/** A tick that left a gap behind it, and the offer to fill it. */
interface Gap {
	id: EpisodeId;
	behind: EpisodeId[];
}

export function EpisodesPane({
	ctx,
	entry,
	show,
	view,
	scroller,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry | undefined;
	show: Show;
	view: EpisodeView;
	scroller: React.RefObject<HTMLDivElement | null>;
}): React.ReactElement {
	const [gap, setGap] = useState<Gap | null>(null);
	const [upOpen, setUpOpen] = useState(false);
	const [allRows, setAllRows] = useState(false);
	const [rateOpen, setRateOpen] = useState<string | null>(null);
	const [noteOpen, setNoteOpen] = useState<string | null>(null);
	const [target, setTarget] = useState<EpisodeId | null>(null);

	const today = todayIso();
	const many = show.seasons.length > 1;
	const episodes = useMemo(
		() => view.episodes.data ?? [],
		[view.episodes.data],
	);

	/**
	 * Jumping to a row, once it exists.
	 *
	 * The target may be in a season that has yet to load, or folded under "more
	 * episodes", so this runs again as each of those settles.
	 */
	useEffect(() => {
		if (!target || view.mode !== "list") return;
		const root = scroller.current;
		if (!root) return;
		const row = root.querySelector<HTMLElement>(
			`#${rowId(target.season, target.episode)}`,
		);
		if (!row) {
			if (episodes.some((one) => one.number === target.episode)) {
				setUpOpen(true);
				setAllRows(true);
			}
			return;
		}
		const offset =
			row.getBoundingClientRect().top - root.getBoundingClientRect().top - 120;
		root.scrollBy({ top: offset, behavior: "smooth" });
		row.classList.remove("sd-flash");
		void row.offsetWidth;
		row.classList.add("sd-flash");
		setTarget(null);
	}, [target, episodes, upOpen, view.mode, scroller]);

	if (many && view.mode === "grid") {
		return (
			<div className="sd-ep-page">
				<RatingsGrid
					view={view}
					entry={entry}
					onPick={(season, episode) => {
						view.setSeason(season);
						setTarget({ season, episode });
					}}
				/>
			</div>
		);
	}

	if (show.loading) return <EpisodesSkeleton />;
	if (show.error) return <p className="scout-error">{show.error}</p>;
	if (view.episodes.loading) return <EpisodesSkeleton />;
	if (view.episodes.error) {
		return <p className="scout-error">{view.episodes.error}</p>;
	}

	const watched = (one: EpisodeInfo) =>
		isWatched(
			{ season: one.season, episode: one.number },
			show.state.marker,
			show.state.extra,
		);
	const released = episodes.filter((one) => isOut(one, today));
	const upcoming = episodes.filter((one) => !isOut(one, today));
	const seen = episodes.filter(watched).length;
	const nextAt = released.findIndex(
		(one) =>
			show.next?.season === one.season && show.next.episode === one.number,
	);
	const windowed = !allRows && released.length > ROW_WINDOW;
	const from = windowed ? Math.max(0, nextAt - ROW_LEAD) : 0;
	const rows = windowed
		? released.slice(from, from + ROW_WINDOW)
		: released;
	const showAll = windowed && (
		<li className="sd-upmore">
			<button onClick={() => setAllRows(true)}>
				<Icon name="chevron-down" size={15} /> Show all {released.length}{" "}
				episodes
			</button>
		</li>
	);
	const complete = episodes.length > 0 && seen === episodes.length;
	const todo = released.filter((one) => !watched(one));
	const scores = released
		.map((one) => view.scoreOf(one))
		.filter((one): one is number => Boolean(one));
	const mean = average(scores);

	const tick = (id: EpisodeId) => {
		setGap(null);
		const was = isWatched(id, show.state.marker, show.state.extra);
		if (!was) {
			const behind = gapBehind(show.run, show.state, id);
			if (behind.length > 0) setGap({ id, behind });
		}
		show.commit(toggleWatched(show.seasons, show.state, id));
	};

	const markAll = () => {
		setGap(null);
		show.commit(
			markEpisodes(
				show.seasons,
				show.state,
				released.map((one) => ({
					season: one.season,
					episode: one.number,
				})),
			),
		);
	};

	return (
		<div className="sd-ep-page">
			{mean !== undefined && (
				<div className={`sd-sumwrap${many ? "" : " sd-solo"}`}>
					<SeasonSummary
						mean={mean}
						name={view.publicName}
						seen={seen}
						total={episodes.length}
						tracked={Boolean(entry)}
					/>
					<RatingBars
						episodes={episodes}
						show={show}
						view={view}
						today={today}
						onJump={setTarget}
					/>
				</div>
			)}

			{/* Keeps its height with the button gone, so marking moves nothing. */}
			<div className="sd-season-h sd-lh">
				<b>
					{episodes.length} episode{episodes.length === 1 ? "" : "s"}
				</b>
				{entry && todo.length > 0 ? (
					<button className="sd-btn sd-ghost sd-sm" onClick={markAll}>
						<Icon name="check" size={14} /> Mark{" "}
						{upcoming.length > 0 ? "released" : "season"} as watched
					</button>
				) : entry && complete && mean === undefined ? (
					<span className="sd-donelbl">
						<Icon name="check" size={14} /> Watched
					</span>
				) : null}
			</div>

			<ul className="sd-eplist">
				{from > 0 && showAll}
				{rows.map((episode) => {
					const id = { season: episode.season, episode: episode.number };
					const key = `${id.season}:${id.episode}`;
					const next =
						show.next?.season === id.season &&
						show.next.episode === id.episode;
					return (
						<React.Fragment key={key}>
							<EpisodeRow
								ctx={ctx}
								entry={entry}
								episode={episode}
								flat={show.flat}
								watched={watched(episode)}
								next={next}
								score={view.scoreOf(episode)}
								scoreName={view.publicName}
								rateOpen={rateOpen === key}
								noteOpen={noteOpen === key}
								onRateOpen={(open) => setRateOpen(open ? key : null)}
								onNoteOpen={(open) => setNoteOpen(open ? key : null)}
								onTick={() => tick(id)}
							/>
							{gap?.id.season === id.season &&
								gap.id.episode === id.episode && (
									<li className="sd-gapli">
										<Icon name="info" size={15} />
										<span>
											Also mark{" "}
											<b>{gapLabel(gap.behind, show.flat)}</b> as
											watched?
										</span>
										<button
											className="sd-btn sd-cta sd-sm"
											onClick={() => {
												show.commit(
													markUpTo(show.seasons, show.state, gap.id),
												);
												setGap(null);
											}}
										>
											Mark them
										</button>
										<button
											className="sd-btn sd-ghost sd-sm"
											onClick={() => setGap(null)}
										>
											Just this one
										</button>
									</li>
								)}
						</React.Fragment>
					);
				})}
				{from === 0 && showAll}
				{upcoming.map((episode, at) =>
					at === 0 || upOpen ? (
						<UpcomingRow
							key={episode.number}
							episode={episode}
							today={today}
						/>
					) : null,
				)}
				{upcoming.length > 1 && (
					<li className="sd-upmore">
						<button onClick={() => setUpOpen(!upOpen)}>
							<Icon
								name={upOpen ? "chevron-up" : "chevron-down"}
								size={15}
							/>{" "}
							{upOpen ? "Show fewer" : upcomingLine(upcoming.slice(1))}
						</button>
					</li>
				)}
			</ul>

			{!entry && (
				<p className="scout-detail-hint">
					Add this to your library to tick off episodes, rate them, and
					write your thoughts.
				</p>
			)}
		</div>
	);
}
