import React, { useEffect, useRef, useState } from "react";
import type { ScoutContext } from "../../../core/context";
import { statusTone, statusWithTone } from "../../../core/library/config";
import { episodeCode, isOut } from "../../../core/detail/episodes";
import type { ProgressUnit } from "../../../core/detail/types";
import {
	longDate,
	plural,
	relativeDay,
	shortDate,
	todayIso,
} from "../../../core/format";
import type { LibraryEntry } from "../../../core/library/entry";
import { toggleWatched } from "../../../core/library/episodes";
import type { MediaKind } from "../../../core/types";
import { Icon } from "../shared";
import { Picture, Sep } from "./bits";
import type { Show } from "./useShow";
import { UpNextSkeleton } from "./Skeleton";

/** The cards under the synopsis: where you are, and what is next. */

function MarkedText({ show }: { show: Show }): React.ReactElement | null {
	if (!show.lastMarked) return null;
	return (
		<span>
			Marked {episodeCode(show.lastMarked.id, show.flat)}{" "}
			<button className="sd-undo" onClick={show.undo}>
				Undo
			</button>
		</span>
	);
}

/** The undo on a card of its own, when nothing is left up next. */
function MarkedLine({ show }: { show: Show }): React.ReactElement | null {
	if (!show.lastMarked) return null;
	return (
		<div className="sd-cfoot">
			<MarkedText show={show} />
		</div>
	);
}

/**
 * The undo beside the card's buttons. A line of its own under them grew the
 * card the moment an episode was marked, and shoved everything below it down.
 */
function MarkedNote({ show }: { show: Show }): React.ReactElement | null {
	if (!show.lastMarked) return null;
	return (
		<span className="sd-marked">
			<MarkedText show={show} />
		</span>
	);
}

/**
 * Up next, or caught up and waiting.
 *
 * A finished show has neither: it offers Watch again in the header instead, so
 * the only thing left here is the undo for the episode that finished it.
 */
export function UpNextCard({
	entry,
	show,
	onAllEpisodes,
}: {
	entry: LibraryEntry;
	show: Show;
	onAllEpisodes: () => void;
}): React.ReactElement | null {
	const id = show.next;
	if (!id) {
		if (show.loading) return <UpNextSkeleton />;
		return show.lastMarked ? (
			<div className="sd-cont sd-slim">
				<MarkedLine show={show} />
			</div>
		) : null;
	}
	const episode = show.nextEpisode;
	if (!episode) return show.nextLoading ? <UpNextSkeleton /> : null;

	const today = todayIso();
	const out = isOut(episode, today);
	const code = episodeCode(id, show.flat);
	const all = (
		<button className="sd-btn sd-ghost sd-sm" onClick={onAllEpisodes}>
			All episodes <Icon name="chevron-right" size={14} />
		</button>
	);

	return (
		<div className="sd-cont">
			<Picture
				src={episode.stillUrl}
				seed={`${entry.path}:${code}`}
				className={`sd-still${out ? "" : " sd-dim"}`}
			/>
			{out ? (
				<div>
					<div className="sd-kick">
						Up next
						<Sep />
						{code}
					</div>
					<h4>{episode.title}</h4>
					<div className="sd-m">
						{episode.airDate &&
							(episode.airDate === today
								? "Out today"
								: `Aired ${longDate(episode.airDate)}`)}
						{episode.airDate && episode.runtime ? <Sep /> : null}
						{episode.runtime ? `${episode.runtime} min` : null}
					</div>
					<div className="sd-acts">
						<button
							className="sd-btn sd-cta sd-sm"
							onClick={() =>
								show.markNext(
									toggleWatched(show.run, show.state, id),
									id,
								)
							}
						>
							<Icon name="check" size={15} /> Mark watched
						</button>
						{all}
						<MarkedNote show={show} />
					</div>
				</div>
			) : (
				<div>
					<div className="sd-kick sd-kick-ok">You’re caught up</div>
					<h4>
						Next: {code}
						<Sep />
						{episode.title}
					</h4>
					{episode.airDate && (
						<div className="sd-m">
							<Icon name="bell" size={13} /> Out{" "}
							{shortDate(episode.airDate)}
							<Sep />
							{relativeDay(episode.airDate, today)}
						</div>
					)}
					<div className="sd-acts">
						{all}
						<MarkedNote show={show} />
					</div>
				</div>
			)}
		</div>
	);
}

const UNITS: Partial<
	Record<
		MediaKind,
		{ unit: ProgressUnit["unit"]; step: number; stepLabel: string }
	>
> = {
	book: { unit: "page", step: 10, stepLabel: "+10 pages" },
	manga: { unit: "chapter", step: 1, stepLabel: "+1 chapter" },
	game: { unit: "hour", step: 1, stepLabel: "+1 hour" },
};

/** Whether this kind counts in pages, chapters, or hours. */
export const hasProgressCard = (kind: MediaKind): boolean => kind in UNITS;

/**
 * How far through a book, a manga, or a game you are.
 *
 * Only while it is in progress: reading a value you are not currently moving is
 * the panel's job, and a card at the top of the page is a call to act. Writes
 * the same `progress` property as everything else, and the total comes from the
 * note when it records one and from the source when it does not.
 */
export function ProgressCard({
	ctx,
	entry,
	progress,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	progress: ProgressUnit | undefined;
}): React.ReactElement | null {
	const config = ctx.settings.library();
	const unit = UNITS[entry.kind];
	const current = entry.progress ?? 0;
	const [draft, setDraft] = useState<string | null>(null);
	const field = useRef<HTMLInputElement>(null);

	useEffect(() => setDraft(null), [current]);

	if (!unit || statusTone(config, entry.status) !== "active") return null;

	const total = entry.progressTotal ?? progress?.total;
	const clamp = (value: number) =>
		Math.max(0, total ? Math.min(total, value) : value);
	const write = (value: number) =>
		void ctx.mutator.setProgress(entry, value > 0 ? value : null);

	const commit = () => {
		if (draft === null) return;
		const value = Number(draft);
		if (Number.isFinite(value) && value !== current) write(clamp(value));
		setDraft(null);
	};

	const finish = () => {
		const done = statusWithTone(config, entry.kind, "done");
		if (done) void ctx.mutator.setStatus(entry, done);
	};

	const left = total ? Math.max(0, total - current) : 0;
	const label =
		unit.unit === "page"
			? "Current page"
			: unit.unit === "chapter"
				? "Current chapter"
				: "Hours played";

	return (
		<div className="sd-cont sd-slim">
			<div>
				<div className="sd-kick">{entry.status}</div>
				<h4>
					{unit.unit === "page" && "Page"}
					{unit.unit === "chapter" && "Chapter"}
					<input
						ref={field}
						className="sd-stepin"
						type="number"
						min={0}
						value={draft ?? String(current)}
						aria-label={label}
						onChange={(e) => setDraft(e.target.value)}
						onBlur={commit}
						onKeyDown={(e) => {
							if (e.key === "Enter") field.current?.blur();
						}}
					/>
					{unit.unit === "hour"
						? "hours played"
						: total
							? `of ${total}`
							: null}
				</h4>
			</div>
			<div className="sd-acts">
				<button
					className="sd-btn sd-ghost sd-sm"
					onClick={() => write(clamp(current + unit.step))}
				>
					{unit.stepLabel}
				</button>
				<button className="sd-btn sd-cta sd-sm" onClick={finish}>
					<Icon name="check" size={15} /> Finished
				</button>
			</div>
			{total ? (
				<div className="sd-cfoot">
					<div className="sd-prog">
						<div
							style={{
								width: `${Math.min(100, (current / total) * 100)}%`,
							}}
						/>
					</div>
					<span>{plural(left, unit.unit)} to go</span>
				</div>
			) : unit.unit === "chapter" ? (
				<div className="sd-cfoot">
					<span>Still running, so there’s no chapter total yet</span>
				</div>
			) : null}
		</div>
	);
}
