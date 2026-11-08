import { Menu } from "obsidian";
import React, { useEffect, useState } from "react";
import type { ScoutContext } from "../../../core/context";
import { releaseDayLine } from "../../../core/detail/episodes";
import { serviceBar, type ScoreRow } from "../../../core/detail/scores";
import type { ItemExtras } from "../../../core/detail/types";
import { longDate } from "../../../core/format";
import type { LibraryEntry } from "../../../core/library/entry";
import { releaseLine } from "../../../core/library/release";
import { ageRatingBadge } from "../../../core/region";
import { MEDIA_KIND_LABELS, type MediaKind } from "../../../core/types";
import { confirmModal } from "../../confirm";
import { Icon, KIND_ICONS } from "../shared";
import { Dotted, Facts, openUrl, Picture, Sep, useImageReady } from "./bits";
import type { Presented } from "./present";
import { ReplayControl, ReplayCount } from "./Replay";
import { ScoreBoxes } from "./Scores";
import { ServiceLogo } from "./Where";
import type { Show } from "./useShow";

/**
 * The header's glyph. Anime and manga read as the television and the book they
 * are here, even though cards use their own marks to tell them apart on a shelf.
 */
const headerIcon = (kind: MediaKind): string =>
	kind === "anime" ? "tv" : kind === "manga" ? "book" : KIND_ICONS[kind];

const posterShape = (kind: MediaKind, extras: ItemExtras): string => {
	const shape =
		extras.shape ??
		(kind === "game" || kind === "link"
			? "wide"
			: kind === "album"
				? "square"
				: "poster");
	return shape === "wide" ? " sd-wide" : shape === "square" ? " sd-sq" : "";
};

/**
 * The artwork behind the header.
 *
 * Each picture fades in over the last once it has loaded, so the poster that
 * stands in while the source answers gives way to the real backdrop without
 * a blank frame between them. Blurred when it is only the poster standing in.
 * The layers are children so the fade over them stays sharp to the edge.
 */
function Backdrop({
	src,
	soft,
}: {
	src: string;
	soft: boolean;
}): React.ReactElement {
	const ready = useImageReady(src);
	const [layers, setLayers] = useState<{ src: string; soft: boolean }[]>([]);
	useEffect(() => {
		if (!ready) return;
		setLayers((was) =>
			was[was.length - 1]?.src === src ? was : [...was.slice(-1), { src, soft }],
		);
	}, [ready, src, soft]);
	return (
		<div className="sd-bd">
			{layers.map((one) => (
				<div
					key={one.src}
					className={`sd-bd-img${one.soft ? " sd-bd-soft" : ""}`}
					style={{ backgroundImage: `url("${one.src}")` }}
				/>
			))}
		</div>
	);
}

/** The show's progress and its release day, on the one line. */
function ProgressLine({
	entry,
	show,
	extras,
	episodic,
}: {
	entry: LibraryEntry | undefined;
	show: Show;
	extras: ItemExtras;
	episodic: boolean;
}): React.ReactElement | null {
	if (!episodic) return null;
	const total = show.total || entry?.progressTotal || 0;
	const seen = show.total ? show.seen : (entry?.progress ?? 0);
	const air = releaseDayLine(extras.nextAirDate);
	const tracked = Boolean(entry) && total > 0;
	if (!tracked && !air) return null;

	const done = total > 0 && seen >= total;
	return (
		<div className="sd-ep-prog">
			{tracked && (
				<div className={`sd-prog${done ? " sd-done" : ""}`}>
					<div style={{ width: `${(seen / total) * 100}%` }} />
				</div>
			)}
			<p>
				{tracked &&
					(done ? (
						<>
							All <b>{total}</b> episodes watched
						</>
					) : (
						<>
							<b>
								{seen} of {total}
							</b>{" "}
							watched
						</>
					))}
				{air && (
					<>
						{tracked && <Sep />}
						<span className="sd-airtxt">
							<Icon name="bell" size={13} /> {air}
						</span>
					</>
				)}
			</p>
		</div>
	);
}

export interface HeroProps {
	ctx: ScoutContext;
	view: Presented;
	entry: LibraryEntry | undefined;
	extras: ItemExtras;
	row: ScoreRow;
	show: Show;
	cover: string | undefined;
	/** Web links have no scores and no tabs. */
	isLink: boolean;
	/** Counted in episodes, so its progress belongs in the header. */
	episodic: boolean;
	busy: boolean;
	/** The source's extras and scores are still on their way. */
	loading: boolean;
	canCreate: boolean;
	onCreate: () => void;
	onClose: () => void;
	onScrollTo: (target: "yours" | "where") => void;
}

export function Hero({
	ctx,
	view,
	entry,
	extras,
	row,
	show,
	cover,
	isLink,
	episodic,
	busy,
	loading,
	canCreate,
	onCreate,
	onClose,
	onScrollTo,
}: HeroProps): React.ReactElement {
	const bar = serviceBar(extras.availability);
	const soon = releaseLine(view.releaseDate, view.year, view.releaseStatus);
	const byline =
		extras.byline ??
		(view.subtitle && view.subtitle !== view.title ? view.subtitle : undefined);
	const trailer = extras.videos[0];
	const when = extras.when ?? view.year;
	const kindLabel =
		view.kind === "tv" ? "TV series" : MEDIA_KIND_LABELS[view.kind];
	// A web link's date is a day it was published, not a release year.
	const facts = isLink && view.releaseDate ? longDate(view.releaseDate) : when;
	const backdrop = extras.backdropUrl ?? cover;

	return (
		<div className="sd-hero">
			{backdrop && (
				<Backdrop src={backdrop} soft={!extras.backdropUrl} />
			)}
			<div className="sd-hero-in">
				<div className={`sd-poster${posterShape(view.kind, extras)}`}>
					<Picture
						src={cover}
						seed={view.title}
						className={`sd-pimg${bar ? "" : " sd-solo"}`}
					/>
					{entry && <ReplayCount entry={entry} />}
					{bar && (
						<button
							className="sd-watchbar"
							onClick={() => onScrollTo("where")}
						>
							<ServiceLogo tile={bar.tile} />
							<span>
								<small>{bar.caption}</small>
								<b>{bar.name}</b>
							</span>
						</button>
					)}
				</div>

				<div className="sd-head">
					<h2>{view.title}</h2>
					{byline && (
						<p className="sd-byline">
							<Dotted text={byline} />
						</p>
					)}
					<Facts className="sd-meta">
						<span className="sd-kind">
							<Icon name={headerIcon(view.kind)} size={14} /> {kindLabel}
						</span>
						{facts && !isLink ? <span className="sd-mi">{facts}</span> : null}
						{extras.ageRating && (
							<span className="sd-mi">
								<span className="sd-cert">
									{ageRatingBadge(extras.ageRating)}
								</span>
							</span>
						)}
						{extras.headerFacts.map((fact) => (
							<span className="sd-mi" key={fact}>
								{fact}
							</span>
						))}
						{facts && isLink ? <span className="sd-mi">{facts}</span> : null}
						{view.tags.length > 0 && !isLink && (
							<span className="sd-mi">{view.tags.slice(0, 3).join(", ")}</span>
						)}
						{soon && <span className="sd-mi">{soon}</span>}
					</Facts>

					<ProgressLine
						entry={entry}
						show={show}
						extras={extras}
						episodic={episodic}
					/>
					{extras.tagline && <p className="sd-tagline">{extras.tagline}</p>}

					{isLink ||
					(!entry && !loading && !row.scout && !row.hype && !row.rt && row.boxes.length === 0) ? (
						<div className="sd-gap" />
					) : (
						<ScoreBoxes
							yours={entry?.rating}
							showYours={Boolean(entry)}
							row={row}
							loading={loading}
							onRate={() => onScrollTo("yours")}
						/>
					)}

					<div className="sd-actions">
						{!entry && canCreate && (
							<button
								className="sd-btn sd-cta"
								disabled={busy}
								onClick={onCreate}
							>
								<Icon name="plus" size={15} />
								{busy ? "Creating…" : "Add to library"}
							</button>
						)}
						{entry && (
							<button
								className="sd-btn sd-cta"
								onClick={() => {
									void ctx.mutator.open(entry);
									onClose();
								}}
							>
								<Icon name="file-text" size={15} /> Open note
							</button>
						)}
						{entry && <ReplayControl ctx={ctx} entry={entry} />}
						{trailer && (
							<button
								className="sd-btn sd-solid-icon"
								onClick={() => openUrl(trailer.url)}
							>
								<Icon name="play" size={13} /> Trailer
							</button>
						)}
						{isLink && view.url && (
							<button
								className="sd-btn"
								onClick={() => view.url && openUrl(view.url)}
							>
								<Icon name="external-link" size={15} /> Open link
							</button>
						)}
						{!entry && !isLink && view.url && (
							<button
								className="sd-btn"
								onClick={() => view.url && openUrl(view.url)}
							>
								<Icon name="external-link" size={15} /> Source
							</button>
						)}
						{entry && (
							<button
								className={`sd-btn sd-icon sd-fav${
									entry.favorite ? " sd-on" : ""
								}`}
								aria-pressed={entry.favorite}
								aria-label={
									entry.favorite
										? "Remove from favourites"
										: "Add to favourites"
								}
								onClick={() => void ctx.mutator.toggleFavorite(entry)}
							>
								<Icon name="heart" size={16} />
							</button>
						)}
						{entry && (
							<button
								className="sd-btn sd-icon"
								aria-label="More actions"
								title="More"
								onClick={(event) =>
									moreMenu(ctx, entry, view.url, onClose, event)
								}
							>
								<Icon name="more-horizontal" size={16} />
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

/** The occasional things: the source page, and deleting the note. */
function moreMenu(
	ctx: ScoutContext,
	entry: LibraryEntry,
	url: string | undefined,
	onClose: () => void,
	event: React.MouseEvent,
): void {
	const menu = new Menu();
	if (url) {
		menu.addItem((i) =>
			i
				.setTitle("Open source page")
				.setIcon("external-link")
				.onClick(() => window.open(url, "_blank", "noopener")),
		);
	}
	menu.addItem((i) =>
		i
			.setTitle("Open note in new tab")
			.setIcon("plus-square")
			.onClick(() => void ctx.mutator.open(entry, true)),
	);
	menu.addSeparator();
	menu.addItem((i) =>
		i
			.setTitle("Delete note")
			.setIcon("trash-2")
			.onClick(() => void remove(ctx, entry, onClose)),
	);
	menu.showAtMouseEvent(event.nativeEvent);
}

/** Confirms before trashing, unless the user has turned the prompt off. */
async function remove(
	ctx: ScoutContext,
	entry: LibraryEntry,
	onClose: () => void,
): Promise<void> {
	if (ctx.settings.library().confirmDelete) {
		const ok = await confirmModal(ctx.app, {
			title: "Delete note",
			body: `Move "${entry.title}" to the trash? This uses Obsidian's own delete, so it follows whatever you have set under Files and links.`,
			confirmText: "Delete",
			danger: true,
		});
		if (!ok) return;
	}
	await ctx.mutator.trash(entry);
	onClose();
}
