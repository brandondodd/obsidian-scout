import React from "react";
import type { ScoutContext } from "../../../core/context";
import type { ItemExtras, Rail as RailData } from "../../../core/detail/types";
import { oneDecimal } from "../../../core/format";
import { hypeOfItem } from "../../../core/hype";
import { scoutOfItem } from "../../../core/scout-score";
import type { LibraryEntry } from "../../../core/library/entry";
import type { MediaItem, MediaKind, MediaRef } from "../../../core/types";
import { Icon, resolveImage } from "../shared";
import { SeriesStrip } from "../SeriesStrip";
import {
	Dotted,
	initials,
	openTitle,
	openUrl,
	Picture,
	Section,
} from "./bits";
import { People } from "./People";
import { peopleToShow } from "./present";
import { MoreSkeleton } from "./Skeleton";

/** The Cast & more tab, and its equivalents for the other kinds. */

function Card({
	ctx,
	item,
	caption,
	shape,
	onClose,
}: {
	ctx: ScoutContext;
	item: MediaItem;
	caption?: string;
	shape: string;
	onClose: () => void;
}): React.ReactElement {
	const owned = ctx.library.match(item) !== undefined;
	const line =
		caption ??
		[
			item.year ? String(item.year) : null,
			scoutOfItem(item) !== undefined
				? `★ ${oneDecimal(scoutOfItem(item) ?? 0)}`
				: hypeOfItem(item, ctx.settings.scores()) !== undefined
					? `forecast ${oneDecimal(hypeOfItem(item, ctx.settings.scores()) ?? 0)}`
					: null,
		]
			.filter(Boolean)
			.join(" · ");

	return (
		<button
			className={`sd-card ${shape}`}
			title={item.title}
			onClick={() => openTitle(ctx, item, onClose)}
		>
			<Picture
				src={resolveImage(ctx.app, item.thumbnailUrl ?? item.imageUrl)}
				seed={item.title}
				className="sd-pimg2"
			>
				{owned && (
					<span className="sd-inlib" title="In your library">
						<Icon name="check" size={14} />
					</span>
				)}
			</Picture>
			<b>{item.title}</b>
			<span className="sd-cap">
				<Dotted text={line} />
			</span>
		</button>
	);
}

function Rail({
	ctx,
	rail,
	shape,
	onClose,
}: {
	ctx: ScoutContext;
	rail: RailData;
	shape: ItemExtras["shape"];
	onClose: () => void;
}): React.ReactElement | null {
	if (rail.items.length === 0) return null;
	const form = rail.shape ?? shape;
	const cls = form === "wide" ? "sd-wide" : form === "square" ? "sd-sq" : "";
	const more = rail.more;
	return (
		<Section
			id={rail.id}
			title={rail.title}
			link={more?.label}
			onLink={more ? () => openUrl(more.url) : undefined}
		>
			<div className="sd-rail">
				{rail.items.map((item) => (
					<Card
						key={`${item.ref.providerId}:${item.ref.id}`}
						ctx={ctx}
						item={item}
						shape={cls}
						caption={rail.captions?.[item.ref.id]}
						onClose={onClose}
					/>
				))}
			</div>
		</Section>
	);
}

function Author({
	extras,
}: {
	extras: ItemExtras;
}): React.ReactElement | null {
	const author = extras.author;
	if (!author) return null;
	return (
		<Section id="author" title="About the author">
			<div className="sd-bio">
				<Picture src={author.imageUrl} seed={author.name} className="sd-av">
					{!author.imageUrl && initials(author.name)}
				</Picture>
				<div>
					{author.bio && <p>{author.bio}</p>}
					{author.facts && (
						<small>
							<Dotted text={author.facts} />
						</small>
					)}
				</div>
			</div>
		</Section>
	);
}

function Details({
	extras,
}: {
	extras: ItemExtras;
}): React.ReactElement | null {
	const { facts, keywords, links } = extras;
	if (facts.length + keywords.length + links.length === 0) return null;
	return (
		<Section id="details" title="Details">
			{facts.length > 0 && (
				<dl className="sd-facts">
					{facts.map((fact) => (
						<div key={fact.label}>
							<dt>{fact.label}</dt>
							<dd>{fact.value}</dd>
						</div>
					))}
				</dl>
			)}
			{keywords.length > 0 && (
				<div className="sd-kw">
					{keywords.map((word) => (
						<span key={word}>{word}</span>
					))}
				</div>
			)}
			{links.length > 0 && (
				<div className="sd-links">
					{links.map((link) => (
						<button
							key={link.label}
							className="sd-btn sd-sm sd-ghost"
							onClick={() => openUrl(link.url)}
						>
							{link.label} <Icon name="external-link" size={13} />
						</button>
					))}
				</div>
			)}
		</Section>
	);
}

export function MorePane({
	ctx,
	extras,
	source,
	previous,
	entry,
	kind,
	fallbackPeople,
	loading,
	onClose,
}: {
	ctx: ScoutContext;
	extras: ItemExtras;
	kind: MediaKind;
	source: MediaRef | undefined;
	previous: MediaItem | undefined;
	entry: LibraryEntry | undefined;
	/** Names the note holds, for a note with no source to ask. */
	fallbackPeople: readonly string[];
	/** The source has yet to answer. */
	loading: boolean;
	onClose: () => void;
}): React.ReactElement {
	const people = peopleToShow(kind, extras.people, fallbackPeople);
	if (loading) {
		return <MoreSkeleton people={kind !== "book" && kind !== "album"} />;
	}
	return (
		<>
			<Author extras={extras} />
			<People
				ctx={ctx}
				title={extras.peopleTitle ?? "Cast & crew"}
				people={people}
				entry={entry}
				onClose={onClose}
			/>
			{source && (
				<div className="sd-sec">
					<SeriesStrip
						ctx={ctx}
						source={source}
						previous={previous}
						onClose={onClose}
					/>
				</div>
			)}
			{extras.rails.map((rail) => (
				<Rail
					key={rail.id}
					ctx={ctx}
					rail={rail}
					shape={extras.shape}
					onClose={onClose}
				/>
			))}
			{extras.credits && extras.credits.length > 0 && (
				<Section id="credits" title="Credits">
					<dl className="sd-facts">
						{extras.credits.map((one) => (
							<div key={one.label}>
								<dt>{one.label}</dt>
								<dd>{one.value}</dd>
							</div>
						))}
					</dl>
				</Section>
			)}
			<Details extras={extras} />
		</>
	);
}

/** A game's trailers and screenshots. */
export function MediaPane({
	extras,
}: {
	extras: ItemExtras;
}): React.ReactElement {
	return (
		<>
			{extras.videos.length > 0 && (
				<Section id="videos" title="Trailers">
					<div className="sd-vids">
						{extras.videos.map((video) => (
							<button
								key={video.url}
								className="sd-vid"
								onClick={() => openUrl(video.url)}
							>
								<Picture
									src={video.thumbnailUrl}
									seed={video.name}
									className="sd-fill"
								/>
								<span className="sd-play">
									<Icon name="play" size={17} />
								</span>
								<em>{video.name}</em>
							</button>
						))}
					</div>
				</Section>
			)}
			{extras.screenshots.length > 0 && (
				<Section
					id="shots"
					title="Screenshots"
					count={extras.screenshotTotal}
				>
					<div className="sd-shots">
						{extras.screenshots.map((url, at) => (
							<button
								key={url}
								className="sd-shot"
								aria-label={`Screenshot ${at + 1}`}
								onClick={() => openUrl(url)}
							>
								<Picture src={url} seed={url} className="sd-fill" />
							</button>
						))}
					</div>
				</Section>
			)}
		</>
	);
}
