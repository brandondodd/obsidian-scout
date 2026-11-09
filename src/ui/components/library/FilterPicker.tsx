import React, { useMemo, useRef, useState, type RefObject } from "react";
import { withinLabel, type FilterCategory } from "../../../core/library/chips";
import { statusTone, type LibraryConfig, type StatusTone } from "../../../core/library/config";
import type { LibraryEntry } from "../../../core/library/entry";
import { collectionFacets, moodFacets, peopleFacets, yearRange } from "../../../core/library/facets";
import { emptyFilters, type LensFilters } from "../../../core/library/lens";
import { isReleased, TONE_LABELS } from "../../../core/library/rules";
import { ALL_MEDIA_KINDS, MEDIA_KIND_PLURALS, type MediaKind } from "../../../core/types";
import { Icon, ratingThresholds } from "../shared";
import { GenrePane } from "./GenrePane";
import { useDismiss } from "./useDismiss";

/**
 * Everything the library can be filtered by, a short list of questions at a
 * time.
 *
 * A row of categories — Type, Progress, Genre, When, Rating — and under it
 * the answers to one of them as chips, each with how many things it would
 * find. It stays open while you pick, because a filter is usually two or three
 * choices, and a menu that closes after each one makes you open it three times.
 */

type Pane = "type" | "progress" | "genre" | "mood" | "when" | "rating" | "people" | "collection";

const PANES: { id: Pane; label: string; icon: string }[] = [
	{ id: "type", label: "Type", icon: "shapes" },
	{ id: "progress", label: "Progress", icon: "play" },
	{ id: "genre", label: "Genre", icon: "tag" },
	{ id: "mood", label: "Mood", icon: "sparkles" },
	{ id: "when", label: "When", icon: "calendar" },
	{ id: "rating", label: "Rating", icon: "star" },
	{ id: "people", label: "People", icon: "user" },
	{ id: "collection", label: "Collections", icon: "layers" },
];

/** Which pane a chip opens. */
export function paneFor(category: FilterCategory): Pane {
	switch (category) {
		case "type":
			return "type";
		case "progress":
		case "status":
		case "favourite":
			return "progress";
		case "genre":
		case "exclude":
			return "genre";
		case "release":
		case "year":
		case "added":
			return "when";
		case "rating":
		case "source":
			return "rating";
		case "person":
			return "people";
		case "collection":
			return "collection";
		case "mood":
			return "mood";
	}
}

/** Which panes have something set, for the dot on their tab. */
function setPanes(f: LensFilters): Set<Pane> {
	const on = new Set<Pane>();
	if (f.kinds.length) on.add("type");
	if (f.tones.length || f.statuses.length || f.favoritesOnly) on.add("progress");
	if (f.tags.length || f.notTags.length) on.add("genre");
	if (f.release !== "any" || f.yearFrom !== null || f.yearTo !== null || f.addedWithin) on.add("when");
	if (f.minRating || f.rated !== "any" || f.minSource) on.add("rating");
	if (f.people.length) on.add("people");
	if (f.collections.length) on.add("collection");
	if (f.moods.length) on.add("mood");
	return on;
}

const TONES: readonly StatusTone[] = ["active", "planned", "paused", "done", "dropped"];

export interface FilterPickerProps {
	entries: readonly LibraryEntry[];
	config: LibraryConfig;
	filters: LensFilters;
	statuses: readonly string[];
	collections: readonly string[];
	initial: Pane;
	anchor: RefObject<HTMLElement | null>;
	onChange: (patch: Partial<LensFilters>) => void;
	onClose: () => void;
}

export function FilterPicker(props: FilterPickerProps): React.ReactElement {
	const { entries, config, filters, onChange, onClose } = props;
	const [pane, setPane] = useState<Pane>(props.initial);
	const box = useRef<HTMLDivElement>(null);
	useDismiss(box, true, onClose, props.anchor);
	const on = setPanes(filters);
	// Moods come from notes' own properties, which only exist once something
	// has filled them in — no tab for a filter that could find nothing.
	const hasMoods = useMemo(() => entries.some((entry) => entry.moods.length > 0), [entries]);
	const panes = PANES.filter((one) => one.id !== "mood" || hasMoods || filters.moods.length > 0);

	return (
		<div className="scout-picker" ref={box} role="dialog" aria-label="Filters">
			<div className="scout-picker-tabs" role="tablist">
				{panes.map((one) => (
					<button
						key={one.id}
						role="tab"
						aria-selected={pane === one.id}
						className={pane === one.id ? "is-on" : ""}
						onClick={() => setPane(one.id)}
					>
						<Icon name={one.icon} size={14} />
						{one.label}
						{on.has(one.id) && <span className="scout-view-dirty" aria-label="Set" />}
					</button>
				))}
			</div>
			<div className="scout-picker-body">
				{pane === "type" && <TypePane {...props} />}
				{pane === "progress" && <ProgressPane {...props} />}
				{pane === "genre" && (
					<GenrePane entries={entries} filters={filters} onChange={onChange} />
				)}
				{pane === "mood" && <MoodPane {...props} />}
				{pane === "when" && <WhenPane {...props} />}
				{pane === "rating" && <RatingPane {...props} config={config} />}
				{pane === "people" && <PeoplePane {...props} />}
				{pane === "collection" && <CollectionPane {...props} />}
			</div>
			<div className="scout-picker-foot">
				<button className="scout-reset" onClick={() => onChange(emptyFilters())}>
					Clear all
				</button>
				<button className="mod-cta" onClick={onClose}>
					Done
				</button>
			</div>
		</div>
	);
}

/* --------------------------------------------------------------- pieces */

function Chip({
	label,
	count,
	on,
	icon,
	onClick,
}: {
	label: string;
	count?: number;
	on: boolean;
	icon?: string;
	onClick: () => void;
}): React.ReactElement {
	return (
		<span className={`scout-pick-chip${on ? " is-on" : ""}`}>
			<button aria-pressed={on} onClick={onClick}>
				{icon && <Icon name={icon} size={13} />}
				{label}
				{count !== undefined && <span className="scout-pick-count">{count}</span>}
			</button>
		</span>
	);
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="scout-pick-section">
			<span className="scout-pick-label">{label}</span>
			<div className="scout-pick-chips">{children}</div>
		</div>
	);
}

const toggled = <T,>(list: readonly T[], value: T): T[] =>
	list.includes(value) ? list.filter((one) => one !== value) : [...list, value];

/* ---------------------------------------------------------------- panes */

function TypePane({ entries, filters, onChange }: FilterPickerProps) {
	const counts = useMemo(() => {
		const out = new Map<MediaKind, number>();
		for (const entry of entries) out.set(entry.kind, (out.get(entry.kind) ?? 0) + 1);
		return out;
	}, [entries]);
	return (
		<Section label="Show only">
			{ALL_MEDIA_KINDS.filter((kind) => counts.has(kind)).map((kind) => (
				<Chip
					key={kind}
					label={MEDIA_KIND_PLURALS[kind]}
					count={counts.get(kind)}
					on={filters.kinds.includes(kind)}
					onClick={() => onChange({ kinds: toggled(filters.kinds, kind) })}
				/>
			))}
		</Section>
	);
}

function ProgressPane({ entries, config, filters, statuses, onChange }: FilterPickerProps) {
	const scoped = filters.kinds.length
		? entries.filter((entry) => filters.kinds.includes(entry.kind))
		: entries;
	const counts = useMemo(() => {
		const out = new Map<string, number>();
		for (const entry of scoped) {
			const tone = statusTone(config, entry.status);
			if (tone) out.set(tone, (out.get(tone) ?? 0) + 1);
			if (entry.status) {
				const key = entry.status.toLowerCase();
				out.set(`s:${key}`, (out.get(`s:${key}`) ?? 0) + 1);
			}
		}
		return out;
	}, [scoped, config]);
	const lower = filters.statuses.map((s) => s.toLowerCase());
	return (
		<>
			<Section label="Where you are with it">
				{TONES.map((tone) => (
					<Chip
						key={tone}
						label={TONE_LABELS[tone]}
						count={counts.get(tone) ?? 0}
						on={filters.tones.includes(tone)}
						onClick={() => onChange({ tones: toggled(filters.tones, tone) })}
					/>
				))}
			</Section>
			<Section label="Exact status">
				{statuses
					.filter((status) => counts.has(`s:${status.toLowerCase()}`))
					.map((status) => (
						<Chip
							key={status}
							label={status}
							count={counts.get(`s:${status.toLowerCase()}`)}
							on={lower.includes(status.toLowerCase())}
							onClick={() =>
								onChange({
									statuses: lower.includes(status.toLowerCase())
										? filters.statuses.filter(
												(one) => one.toLowerCase() !== status.toLowerCase(),
											)
										: [...filters.statuses, status],
								})
							}
						/>
					))}
			</Section>
			<Section label="Also">
				<Chip
					label="Favourites only"
					icon="heart"
					on={filters.favoritesOnly}
					onClick={() => onChange({ favoritesOnly: !filters.favoritesOnly })}
				/>
			</Section>
		</>
	);
}

function WhenPane({ entries, filters, onChange }: FilterPickerProps) {
	const now = new Date();
	const year = now.getFullYear();
	const upcoming = useMemo(
		() => entries.filter((entry) => isReleased(entry, now) === false).length,
		// Counted once per open; the date does not move while it is.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[entries],
	);
	const range = useMemo(() => yearRange(entries), [entries]);
	const decades: number[] = [];
	if (range) {
		for (let at = Math.floor(range.max / 10) * 10; at >= Math.floor(range.min / 10) * 10; at -= 10) {
			decades.push(at);
		}
	}
	const isRange = (from: number | null, to: number | null) =>
		filters.yearFrom === from && filters.yearTo === to;
	const setRange = (from: number | null, to: number | null) =>
		onChange(isRange(from, to) ? { yearFrom: null, yearTo: null } : { yearFrom: from, yearTo: to });
	const number = (value: string) => {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) ? parsed : null;
	};

	return (
		<>
			<Section label="Release">
				<Chip
					label="Out now"
					on={filters.release === "out"}
					onClick={() => onChange({ release: filters.release === "out" ? "any" : "out" })}
				/>
				<Chip
					label="Coming soon"
					count={upcoming}
					icon="calendar-clock"
					on={filters.release === "upcoming"}
					onClick={() =>
						onChange({ release: filters.release === "upcoming" ? "any" : "upcoming" })
					}
				/>
			</Section>
			<Section label="Released">
				<Chip label="This year" on={isRange(year, year)} onClick={() => setRange(year, year)} />
				<Chip
					label="Last 5 years"
					on={isRange(year - 4, null)}
					onClick={() => setRange(year - 4, null)}
				/>
				{decades.map((decade) => (
					<Chip
						key={decade}
						label={`${decade}s`}
						on={isRange(decade, decade + 9)}
						onClick={() => setRange(decade, decade + 9)}
					/>
				))}
			</Section>
			<div className="scout-pick-section scout-pick-years">
				<span className="scout-pick-label">Or between</span>
				<input
					type="number"
					placeholder="From"
					aria-label="From year"
					value={filters.yearFrom ?? ""}
					onChange={(e) => onChange({ yearFrom: number(e.target.value) })}
				/>
				<span>and</span>
				<input
					type="number"
					placeholder="To"
					aria-label="To year"
					value={filters.yearTo ?? ""}
					onChange={(e) => onChange({ yearTo: number(e.target.value) })}
				/>
			</div>
			<Section label="Added to your library">
				{[7, 30, 90, 365].map((days) => (
					<Chip
						key={days}
						label={`In ${withinLabel(days)}`}
						on={filters.addedWithin === days}
						onClick={() =>
							onChange({ addedWithin: filters.addedWithin === days ? 0 : days })
						}
					/>
				))}
			</Section>
		</>
	);
}

function RatingPane({ config, filters, onChange }: FilterPickerProps) {
	return (
		<>
			<Section label="Your rating">
				<Chip
					label="Rated"
					on={filters.rated === "rated" && filters.minRating === 0}
					onClick={() =>
						onChange({ rated: filters.rated === "rated" ? "any" : "rated", minRating: 0 })
					}
				/>
				<Chip
					label="Not rated yet"
					on={filters.rated === "unrated"}
					onClick={() =>
						onChange({ rated: filters.rated === "unrated" ? "any" : "unrated", minRating: 0 })
					}
				/>
				{ratingThresholds(config.ratingScale).map((value) => (
					<Chip
						key={value}
						label={`${value}+`}
						icon="star"
						on={filters.minRating === value}
						onClick={() =>
							onChange({
								minRating: filters.minRating === value ? 0 : value,
								rated: "any",
							})
						}
					/>
				))}
			</Section>
			<Section label="Scout score, out of 10">
				{[5, 6, 7, 8, 9].map((value) => (
					<Chip
						key={value}
						label={`${value}+`}
						on={filters.minSource === value}
						onClick={() => onChange({ minSource: filters.minSource === value ? 0 : value })}
					/>
				))}
			</Section>
		</>
	);
}

function PeoplePane({ entries, filters, onChange }: FilterPickerProps) {
	const [search, setSearch] = useState("");
	const people = useMemo(() => {
		const scoped = filters.kinds.length
			? entries.filter((entry) => filters.kinds.includes(entry.kind))
			: entries;
		return peopleFacets(scoped);
	}, [entries, filters.kinds]);
	const words = search.trim().toLowerCase();
	const shown = (words ? people.filter((p) => p.label.toLowerCase().includes(words)) : people)
		.filter((p) => !filters.people.includes(p.label))
		.slice(0, 24);
	return (
		<>
			<input
				type="text"
				className="scout-pick-search"
				placeholder="Find a director, author, artist…"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
			/>
			{filters.people.length > 0 && (
				<Section label="Showing">
					{filters.people.map((name) => (
						<Chip
							key={name}
							label={name}
							on
							onClick={() => onChange({ people: toggled(filters.people, name) })}
						/>
					))}
				</Section>
			)}
			<Section label={words ? "Matches" : "Most in your library"}>
				{shown.map((person) => (
					<Chip
						key={person.label}
						label={person.label}
						count={person.count}
						on={false}
						onClick={() => onChange({ people: [...filters.people, person.label] })}
					/>
				))}
			</Section>
		</>
	);
}

function MoodPane({ entries, filters, onChange }: FilterPickerProps) {
	const moods = useMemo(() => {
		const scoped = filters.kinds.length
			? entries.filter((entry) => filters.kinds.includes(entry.kind))
			: entries;
		return moodFacets(scoped);
	}, [entries, filters.kinds]);
	const lower = filters.moods.map((one) => one.toLowerCase());
	if (moods.length === 0) return <p className="scout-pick-empty">No moods in these notes yet.</p>;
	return (
		<Section label="Feels like any of">
			{moods.map((mood) => (
				<Chip
					key={mood.label}
					label={mood.label}
					count={mood.count}
					on={lower.includes(mood.label.toLowerCase())}
					onClick={() =>
						onChange({
							moods: lower.includes(mood.label.toLowerCase())
								? filters.moods.filter((one) => one.toLowerCase() !== mood.label.toLowerCase())
								: [...filters.moods, mood.label],
						})
					}
				/>
			))}
		</Section>
	);
}

function CollectionPane({ entries, collections, filters, onChange }: FilterPickerProps) {
	const counts = useMemo(() => {
		const out = new Map<string, number>();
		for (const facet of collectionFacets(entries)) out.set(facet.label.toLowerCase(), facet.count);
		return out;
	}, [entries]);
	if (collections.length === 0) {
		return <p className="scout-pick-empty">No collections yet.</p>;
	}
	return (
		<Section label="In every one of">
			{collections.map((name) => (
				<Chip
					key={name}
					label={name}
					count={counts.get(name.toLowerCase()) ?? 0}
					on={filters.collections.includes(name)}
					onClick={() => onChange({ collections: toggled(filters.collections, name) })}
				/>
			))}
		</Section>
	);
}
