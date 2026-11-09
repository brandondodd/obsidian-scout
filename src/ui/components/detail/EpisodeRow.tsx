import React, { useEffect, useRef, useState } from "react";
import type { ScoutContext } from "../../../core/context";
import { episodeCode } from "../../../core/detail/episodes";
import { longDate, oneDecimal, relativeDay, shortDate } from "../../../core/format";
import { ratingScaleFor } from "../../../core/library/config";
import type { LibraryEntry } from "../../../core/library/entry";
import { episodeKey } from "../../../core/library/episodes";
import type { EpisodeInfo } from "../../../core/types";
import Rating from "../Rating";
import { Icon } from "../shared";
import { useDismiss } from "../library/useDismiss";
import { Facts, Picture, Sep } from "./bits";
import { useEscape } from "./useEscape";

export const rowId = (season: number, episode: number): string =>
	`sd-ep-${episodeKey(season, episode)}`;

/** Your score for one episode, closed to a pill until you go to change it. */
function RateControl({
	ctx,
	entry,
	code,
	open,
	onOpen,
	onDone,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	code: string;
	open: boolean;
	onOpen: () => void;
	onDone: () => void;
}): React.ReactElement {
	const config = ctx.settings.library();
	const mark = entry.episodeLog[code];
	const scale = ratingScaleFor(config, entry.kind);
	const picker = useRef<HTMLSpanElement>(null);
	// A press elsewhere, or Escape, folds the stars away; Escape no longer
	// closes the whole dialog with them.
	useDismiss(picker, open, onDone);
	useEscape(ctx.app, open, onDone);
	const write = (rating: number | null) => {
		void ctx.mutator.setEpisodeMark(entry, code, {
			...(rating !== null ? { rating } : {}),
			...(mark?.note ? { note: mark.note } : {}),
		});
		onDone();
	};

	if (open) {
		return (
			<span className="sd-ctl" ref={picker}>
				<Rating
					value={mark?.rating}
					scale={scale}
					step={config.ratingStep}
					icon={config.ratingIcon}
					slots={5}
					size={19}
					exact
					onChange={write}
				/>
				{mark?.rating !== undefined && (
					<button className="sd-undo" onClick={() => write(null)}>
						Clear
					</button>
				)}
			</span>
		);
	}
	if (mark?.rating !== undefined) {
		return (
			<button
				className="sd-myr"
				title="Your rating. Select to change it"
				onClick={onOpen}
			>
				★ {oneDecimal(mark.rating)}
				<span className="sd-of">/{scale}</span>
			</button>
		);
	}
	return (
		<button className="sd-rate" onClick={onOpen}>
			<Icon name="star" size={14} /> Rate
		</button>
	);
}

/** A line about one episode, saved on the way out rather than per keystroke. */
function NoteControl({
	ctx,
	entry,
	code,
	open,
	onOpen,
	onDone,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	code: string;
	open: boolean;
	onOpen: () => void;
	onDone: () => void;
}): React.ReactElement {
	const mark = entry.episodeLog[code];
	const note = mark?.note ?? "";
	const [text, setText] = useState(note);
	const box = useRef<HTMLTextAreaElement>(null);
	const discarded = useRef(false);

	useEffect(() => setText(note), [note]);
	useEffect(() => {
		if (!open) return;
		discarded.current = false;
		box.current?.focus();
	}, [open]);
	// Escape drops the edit, and only the edit: left to the dialog it closed
	// everything, saving the half-typed line on the way out.
	useEscape(ctx.app, open, () => {
		discarded.current = true;
		setText(note);
		onDone();
	});

	const save = () => {
		if (discarded.current) return;
		const next = text.trim();
		if (next !== note) {
			void ctx.mutator.setEpisodeMark(entry, code, {
				...(mark?.rating !== undefined ? { rating: mark.rating } : {}),
				...(next ? { note: next } : {}),
			});
		}
		onDone();
	};

	if (open) {
		return (
			<textarea
				ref={box}
				className="sd-noteedit"
				value={text}
				placeholder="A line about this episode…"
				aria-label="Your note on this episode"
				onChange={(e) => setText(e.target.value)}
				onBlur={save}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						box.current?.blur();
					}
				}}
			/>
		);
	}
	if (note) {
		return (
			<button className="sd-note" onClick={onOpen}>
				“{note}”
			</button>
		);
	}
	return (
		<button className="sd-rate sd-addnote" onClick={onOpen}>
			<Icon name="pencil" size={13} /> Add a note
		</button>
	);
}

export interface EpisodeRowProps {
	ctx: ScoutContext;
	entry: LibraryEntry | undefined;
	episode: EpisodeInfo;
	flat: boolean;
	watched: boolean;
	next: boolean;
	score: number | undefined;
	scoreName: string | null;
	rateOpen: boolean;
	noteOpen: boolean;
	onRateOpen: (open: boolean) => void;
	onNoteOpen: (open: boolean) => void;
	onTick: () => void;
}

/**
 * One released episode, all of it, the way a streaming service lists them:
 * a guide exists to be read down, and nothing here is behind a fold.
 */
export function EpisodeRow({
	ctx,
	entry,
	episode,
	flat,
	watched,
	next,
	score,
	scoreName,
	rateOpen,
	noteOpen,
	onRateOpen,
	onNoteOpen,
	onTick,
}: EpisodeRowProps): React.ReactElement {
	const id = { season: episode.season, episode: episode.number };
	const code = episodeKey(id.season, id.episode);
	const said = episodeCode(id, flat);

	const facts: React.ReactNode[] = [
		`E${String(episode.number).padStart(2, "0")}`,
		episode.airDate ? longDate(episode.airDate) : null,
		episode.runtime ? `${episode.runtime} min` : null,
		score ? (
			<span title={`${scoreName ?? "Source"} score`}>
				★ {oneDecimal(score)}
			</span>
		) : null,
	].filter(Boolean);

	return (
		<li
			className={`sd-ep${next ? " sd-next" : ""}`}
			id={rowId(id.season, id.episode)}
		>
			<button
				className={`sd-ring${watched ? " sd-on" : ""}${entry ? "" : " sd-dis"}`}
				disabled={!entry}
				aria-pressed={watched}
				aria-label={`${said} watched`}
				title={watched ? "Watched. Select to untick" : "Mark watched"}
				onClick={onTick}
			>
				<span className="sd-num">{episode.number}</span>
				<Icon name="check" size={16} />
			</button>
			<Picture
				src={episode.stillUrl}
				seed={`${code}:${episode.title}`}
				className="sd-still"
			/>
			<div className="sd-ep-b">
				<div className="sd-ep-t">
					<span className="sd-t">{episode.title}</span>
					{next && <span className="sd-badge">Up next</span>}
				</div>
				<Facts className="sd-ep-m">{facts}</Facts>
				{episode.overview && <p className="sd-syn">{episode.overview}</p>}
				{entry && (
					<div className="sd-ep-a">
						<RateControl
							ctx={ctx}
							entry={entry}
							code={code}
							open={rateOpen}
							onOpen={() => onRateOpen(true)}
							onDone={() => onRateOpen(false)}
						/>
						<NoteControl
							ctx={ctx}
							entry={entry}
							code={code}
							open={noteOpen}
							onOpen={() => onNoteOpen(true)}
							onDone={() => onNoteOpen(false)}
						/>
					</div>
				)}
			</div>
		</li>
	);
}

/** An episode that is not out yet: the date, and not much else. */
export function UpcomingRow({
	episode,
	today,
}: {
	episode: EpisodeInfo;
	today: string;
}): React.ReactElement {
	return (
		<li
			className="sd-ep sd-up"
			id={rowId(episode.season, episode.number)}
		>
			<span className="sd-ring sd-dis">
				<span className="sd-num">{episode.number}</span>
			</span>
			<div className="sd-ep-b">
				<div className="sd-ep-t">
					<span className="sd-t">{episode.title}</span>
				</div>
				<Facts className="sd-ep-m">
					{episode.airDate && (
						<span className="sd-soon">
							<Icon name="bell" size={12} /> {shortDate(episode.airDate)}
							<Sep />
							{relativeDay(episode.airDate, today)}
						</span>
					)}
					{episode.runtime ? `${episode.runtime} min` : null}
				</Facts>
			</div>
		</li>
	);
}
