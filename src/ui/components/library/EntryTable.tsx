import React from "react";
import type { ScoutContext } from "../../../core/context";
import { entryMainGenres } from "../../../core/genres/genres";
import {
	ratingScaleFor,
	sortFieldOf,
	sortIsDescending,
	type LibrarySort,
} from "../../../core/library/config";
import type { LibraryEntry } from "../../../core/library/entry";
import { hypeOfEntry } from "../../../core/hype";
import { scoutOfEntry } from "../../../core/scout-score";
import { MEDIA_KIND_LABELS } from "../../../core/types";
import { formatRating } from "../Rating";
import StatusBadge, { progressFraction } from "../Status";
import { Cover, Icon, KIND_ICONS, resolveImage } from "../shared";

/**
 * Scout's score, for an item you have not rated: the source's own score put on
 * Scout's scale, so a film and a book on the same shelf compare fairly.
 *
 * Deliberately unlike the rating control — one small glyph and a number, in the
 * faint colour — because it is not your rating and should never be mistaken for
 * it. Renders nothing when the note records no source score.
 */
export function SourceRating({
	ctx,
	entry,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
}): React.ReactElement | null {
	// Zero is not a score, it is a source with nobody having voted yet — which
	// is most unreleased items, and "★ 0" reads as a verdict.
	const score = scoutOfEntry(entry);
	if (score === undefined) return <HypeRating entry={entry} />;
	const source = entry.ref ? ctx.registry.get(entry.ref.providerId)?.name : undefined;
	return (
		<span
			className="scout-source-rating"
			title={`Scout score, out of 10, from ${source ?? "the source"}'s ${formatRating(entry.sourceRating ?? 0)}`}
		>
			<Icon name="compass" size={12} />
			{formatRating(score)}
		</span>
	);
}

/**
 * The Scout score a film not out yet is likely to settle at — a telescope rather
 * than Scout's compass, so it never reads as a verdict. Nothing when it is
 * out, or Scout has not yet looked into it.
 */
export function HypeRating({ entry }: { entry: LibraryEntry }): React.ReactElement | null {
	const hype = hypeOfEntry(entry);
	if (hype === undefined) return null;
	return (
		<span
			className="scout-source-rating scout-hype"
			title="Forecast: not out yet, so the Scout score it is likely to settle at"
		>
			<Icon name="telescope" size={12} />
			{formatRating(hype)}
		</span>
	);
}

/**
 * The table: for comparing, and for sorting by any column.
 *
 * Fixed column widths, so the numbers line up from one group's table to the
 * next and a wide window gives its room to the title rather than to the gaps
 * between four short columns. The type rides in front of the title as a
 * glyph instead of taking a column, and the columns that matter least drop
 * away first as the pane narrows.
 */

interface Column {
	id: string;
	label: string;
	/** The sort a press on its heading asks for, first time. */
	sort?: LibrarySort;
	className: string;
}

const COLUMNS: readonly Column[] = [
	{ id: "title", label: "Title", sort: "title", className: "scout-col-title" },
	{ id: "by", label: "By", className: "scout-col-by" },
	{ id: "genre", label: "Genre", className: "scout-col-genre" },
	{ id: "year", label: "Year", sort: "year-desc", className: "scout-col-year" },
	{ id: "rating", label: "Rating", sort: "rating-desc", className: "scout-col-rating" },
	{ id: "source", label: "Score", sort: "source-desc", className: "scout-col-source" },
	{ id: "status", label: "Status", sort: "status", className: "scout-col-status" },
	{ id: "added", label: "Added", sort: "added", className: "scout-col-added" },
];

const added = (created: number) =>
	created > 0
		? new Date(created).toLocaleDateString(undefined, { month: "short", year: "numeric" })
		: "—";

export function EntryTable({
	ctx,
	entries,
	sortBy,
	onSort,
	onOpen,
	onMenu,
}: {
	ctx: ScoutContext;
	entries: readonly LibraryEntry[];
	sortBy: LibrarySort;
	onSort: (sort: LibrarySort) => void;
	onOpen: (entry: LibraryEntry, event?: React.MouseEvent) => void;
	onMenu: (entry: LibraryEntry, event: React.MouseEvent) => void;
}): React.ReactElement {
	const config = ctx.settings.library();
	const current = sortFieldOf(sortBy).field;
	const down = sortIsDescending(sortBy);

	/** A heading pressed again turns its column the other way. */
	const sortOn = (column: Column) => {
		if (!column.sort) return;
		const field = sortFieldOf(column.sort).field;
		if (field.id === current.id && field.other) {
			onSort(sortBy === field.first ? field.other : field.first);
		} else {
			onSort(column.sort);
		}
	};

	return (
		<div className="scout-table-wrap">
			<table className="scout-table">
				<thead>
					<tr>
						{COLUMNS.map((column) => {
							const on = column.sort && sortFieldOf(column.sort).field.id === current.id;
							return (
								<th
									key={column.id}
									className={column.className}
									aria-sort={on ? (down ? "descending" : "ascending") : undefined}
								>
									{column.sort ? (
										<button
											className={on ? "is-on" : ""}
											onClick={() => sortOn(column)}
										>
											{column.label}
											{on && <Icon name={down ? "arrow-down" : "arrow-up"} size={11} />}
										</button>
									) : (
										column.label
									)}
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{entries.map((entry) => (
						<tr
							key={entry.path}
							tabIndex={0}
							onClick={(e) => onOpen(entry, e)}
							onContextMenu={(e) => onMenu(entry, e)}
							onKeyDown={(e) => {
								if (e.key === "Enter") onOpen(entry);
							}}
						>
							<td className="scout-col-title">
								<span className="scout-table-title">
									{config.showCovers && (
										<span className="scout-table-cover">
											<Cover
												src={resolveImage(ctx.app, entry.cover, entry.path)}
												alt=""
												title={entry.title}
											/>
										</span>
									)}
									<span
										className="scout-table-kind"
										title={MEDIA_KIND_LABELS[entry.kind]}
										aria-label={MEDIA_KIND_LABELS[entry.kind]}
									>
										<Icon name={KIND_ICONS[entry.kind]} size={12} />
									</span>
									<span className="scout-table-name">{entry.title}</span>
									{entry.favorite && (
										<span className="scout-table-fav" aria-label="Favourite">
											<Icon name="heart" size={12} />
										</span>
									)}
								</span>
							</td>
							<td className="scout-col-by">{(entry.authored[0] ?? entry.people[0]) || "—"}</td>
							<td className="scout-col-genre">
								{entryMainGenres(entry).slice(0, 2).join(", ") || "—"}
							</td>
							<td className="scout-col-year">{entry.year ?? "—"}</td>
							<td className="scout-col-rating">
								{entry.rating !== undefined ? (
									<>
										<strong>{formatRating(entry.rating)}</strong>
										<span className="scout-table-of"> / {ratingScaleFor(config, entry.kind)}</span>
									</>
								) : (
									"—"
								)}
							</td>
							<td className="scout-col-source">
								{scoutOfEntry(entry) !== undefined || hypeOfEntry(entry) !== undefined ? (
									<SourceRating ctx={ctx} entry={entry} />
								) : (
									"—"
								)}
							</td>
							<td className="scout-col-status">
								{entry.status ? (
									<StatusBadge
										config={config}
										status={entry.status}
										progress={progressFraction(entry.progress, entry.progressTotal)}
									/>
								) : (
									"—"
								)}
							</td>
							<td className="scout-col-added">{added(entry.created)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
