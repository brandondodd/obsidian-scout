import { ALL_MEDIA_KINDS, type MediaKind } from "../types";
import {
	ratingFraction,
	ratingScaleFor,
	statusTone,
	type LibraryConfig,
} from "./config";
import { coerce, customValue, type LibraryEntry } from "./entry";

/**
 * The stats page, worked out from the library alone.
 *
 * Every figure comes from dates and numbers already in the notes — nothing is
 * asked of a source. The unit is the *completion*: each date something was
 * finished on, earlier times through included, so a film seen twice in a year
 * is two evenings in that year. A figure that needs data the notes may not
 * have (runtimes, page counts) says how many items it was worked out from.
 */

export interface StatsFilter {
	/** Null for all time. */
	year: number | null;
	/** Null for every kind. */
	kind: MediaKind | null;
}

export interface Completion {
	entry: LibraryEntry;
	/** `YYYY-MM-DD`. */
	date: string;
	/** Not the first time it was finished. */
	again: boolean;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** The day part of a written date, or nothing for anything vaguer. */
export function dayOf(value: unknown): string | undefined {
	const text = coerce.asString(value);
	const match = text ? DAY.exec(text) : null;
	return match ? match[0] : undefined;
}

/** Every finish date in the library, oldest first. */
export function completions(entries: readonly LibraryEntry[]): Completion[] {
	const out: Completion[] = [];
	for (const entry of entries) {
		const dates = [...entry.history, ...(entry.finished ? [entry.finished] : [])]
			.map(dayOf)
			.filter((date): date is string => Boolean(date))
			.sort();
		dates.forEach((date, at) => out.push({ entry, date, again: at > 0 }));
	}
	return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Years with at least one completion, newest first. */
export function statsYears(entries: readonly LibraryEntry[]): number[] {
	const years = new Set(completions(entries).map((one) => Number(one.date.slice(0, 4))));
	return [...years].sort((a, b) => b - a);
}

/* ------------------------------------------------------------------- shapes */

export interface Bar {
	/** `2024-03` for a month, `2024` for a year. */
	key: string;
	label: string;
	count: number;
}

export interface Heatmap {
	/** The first day shown, a Monday. */
	start: string;
	/** One per day from `start`, in order. Days outside the period are null. */
	days: ({ date: string; count: number } | null)[];
	max: number;
}

export interface TimeFigure {
	kind: MediaKind;
	unit: "minutes" | "pages" | "hours";
	amount: number;
	/** Completions the figure was worked out from, of how many there were. */
	known: number;
	of: number;
}

export interface RatingSpread {
	kind: MediaKind;
	scale: number;
	/** Upper edge of each bucket, and how many ratings fell in it. */
	buckets: { upTo: number; count: number }[];
	average: number;
	count: number;
}

export interface TraitStat {
	name: string;
	count: number;
	/** Average rating as a fraction of its scale, among those rated. */
	average: number | null;
	/** `average` minus the period's own average, as a fraction. */
	delta: number | null;
}

export interface StatsData {
	filter: StatsFilter;
	finished: number;
	again: number;
	byKind: { kind: MediaKind; count: number }[];
	bars: Bar[];
	heatmap: Heatmap;
	time: TimeFigure[];
	ratings: RatingSpread[];
	average: number | null;
	genres: TraitStat[];
	people: TraitStat[];
	dropped: { count: number; of: number };
	replays: { entry: LibraryEntry; times: number }[];
	shelf: { entry: LibraryEntry; since: string; days: number }[];
	goals: { kind: MediaKind; target: number; done: number; year: number }[];
}

/* -------------------------------------------------------------------- build */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function iso(date: Date): string {
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${m}-${d}`;
}

const inYear = (date: string, year: number | null) =>
	year === null || date.startsWith(`${year}-`);

export function buildStats(
	config: LibraryConfig,
	all: readonly LibraryEntry[],
	filter: StatsFilter,
	now: Date = new Date(),
): StatsData {
	const entries = filter.kind ? all.filter((e) => e.kind === filter.kind) : all;
	const every = completions(entries);
	const done = every.filter((one) => inYear(one.date, filter.year));

	const byKind = new Map<MediaKind, number>();
	for (const one of done) byKind.set(one.entry.kind, (byKind.get(one.entry.kind) ?? 0) + 1);

	// What the ratings and the people are read from: everything finished in the
	// period — or, for all time, everything you have rated or shelved as done,
	// since plenty of notes were finished long before anybody wrote a date down.
	const finishedEntries = new Set(done.map((one) => one.entry));
	const period =
		filter.year === null
			? entries.filter(
					(e) =>
						finishedEntries.has(e) ||
						e.rating !== undefined ||
						statusTone(config, e.status) === "done",
				)
			: [...finishedEntries];

	const average = mean(period.map((e) => ratingFraction(config, e.kind, e.rating)));

	return {
		filter,
		finished: done.length,
		again: done.filter((one) => one.again).length,
		byKind: ALL_MEDIA_KINDS.filter((k) => byKind.has(k)).map((kind) => ({
			kind,
			count: byKind.get(kind) ?? 0,
		})),
		bars: bars(filter.year === null ? every : done, filter.year),
		heatmap: heatmap(done, filter.year, now),
		time: timeSpent(done),
		ratings: ratingSpreads(config, period),
		average,
		genres: traitStats(config, period, (e) => e.tags, average),
		people: traitStats(config, period, (e) => (e.authored.length > 0 ? e.authored : e.people.slice(0, 3)), average),
		dropped: droppedRate(config, entries, finishedEntries, filter.year),
		replays: replays(entries, done),
		shelf: shelf(config, entries, now),
		// Goals are yearly: the chosen year, or this one for all time.
		goals: goalProgress(config, all, filter.year ?? now.getFullYear(), filter.kind),
	};
}

function mean(values: readonly (number | undefined)[]): number | null {
	const known = values.filter((v): v is number => v !== undefined);
	return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

/** Months of the chosen year, or one bar per year across all time. */
function bars(list: readonly Completion[], year: number | null): Bar[] {
	if (year !== null) {
		const counts = new Array<number>(12).fill(0);
		for (const one of list) {
			const at = Number(one.date.slice(5, 7)) - 1;
			counts[at] = (counts[at] ?? 0) + 1;
		}
		return counts.map((count, at) => ({
			key: `${year}-${String(at + 1).padStart(2, "0")}`,
			label: MONTHS[at] ?? "",
			count,
		}));
	}
	const counts = new Map<number, number>();
	for (const one of list) {
		const y = Number(one.date.slice(0, 4));
		counts.set(y, (counts.get(y) ?? 0) + 1);
	}
	const years = [...counts.keys()].sort((a, b) => a - b);
	const first = years[0];
	const last = years[years.length - 1];
	if (first === undefined || last === undefined) return [];
	// Every year in between, so a gap reads as a gap rather than vanishing.
	return Array.from({ length: last - first + 1 }, (_, at) => first + at).map((y) => ({
		key: String(y),
		label: String(y),
		count: counts.get(y) ?? 0,
	}));
}

/** The chosen calendar year, or the last fifty-two weeks. */
function heatmap(list: readonly Completion[], year: number | null, now: Date): Heatmap {
	const first = year !== null ? new Date(year, 0, 1) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364);
	const last = year !== null ? new Date(year, 11, 31) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const start = new Date(first);
	// Back to Monday, so every column is one week.
	start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

	const counts = new Map<string, number>();
	for (const one of list) counts.set(one.date, (counts.get(one.date) ?? 0) + 1);

	const days: Heatmap["days"] = [];
	let max = 0;
	const lo = iso(first);
	const hi = iso(last);
	for (const day = new Date(start); iso(day) <= hi; day.setDate(day.getDate() + 1)) {
		const date = iso(day);
		if (date < lo) {
			days.push(null);
			continue;
		}
		const count = counts.get(date) ?? 0;
		max = Math.max(max, count);
		days.push({ date, count });
	}
	return { start: iso(start), days, max };
}

function num(entry: LibraryEntry, key: string): number | undefined {
	const value = coerce.asNumber(customValue(entry, key));
	return value !== undefined && value > 0 ? value : undefined;
}

/**
 * Minutes watched, pages read, hours played — from whatever each note records.
 *
 * Films use their runtime; series their episode count times an episode's
 * runtime, which only notes that record both can say; books their page count;
 * games the hours you logged as progress, or the source's typical playtime.
 */
function timeSpent(list: readonly Completion[]): TimeFigure[] {
	const figures = new Map<MediaKind, TimeFigure>();
	for (const { entry } of list) {
		let unit: TimeFigure["unit"] | null = null;
		let amount: number | undefined;
		if (entry.kind === "movie") {
			unit = "minutes";
			amount = num(entry, "runtime");
		} else if (entry.kind === "tv" || entry.kind === "anime") {
			unit = "minutes";
			const runtime = num(entry, "runtime");
			const episodes = entry.progressTotal ?? num(entry, "episodes");
			amount = runtime && episodes ? runtime * episodes : undefined;
		} else if (entry.kind === "book") {
			unit = "pages";
			amount = num(entry, "pages");
		} else if (entry.kind === "game") {
			unit = "hours";
			amount = entry.progress && entry.progress > 0 ? entry.progress : num(entry, "playtime");
		}
		if (!unit) continue;
		const figure = figures.get(entry.kind) ?? { kind: entry.kind, unit, amount: 0, known: 0, of: 0 };
		figure.of++;
		if (amount !== undefined) {
			figure.amount += amount;
			figure.known++;
		}
		figures.set(entry.kind, figure);
	}
	return [...figures.values()].filter((figure) => figure.known > 0);
}

/** Ratings in buckets on each kind's own scale: halves out of five, wholes out of ten. */
function ratingSpreads(config: LibraryConfig, entries: readonly LibraryEntry[]): RatingSpread[] {
	const out: RatingSpread[] = [];
	for (const kind of ALL_MEDIA_KINDS) {
		const ratings = entries
			.filter((e) => e.kind === kind && e.rating !== undefined && e.rating > 0)
			.map((e) => e.rating as number);
		if (ratings.length === 0) continue;
		const scale = ratingScaleFor(config, kind);
		const width = scale <= 5 ? 0.5 : scale <= 10 ? 1 : scale / 10;
		const n = Math.max(1, Math.round(scale / width));
		const counts = new Array<number>(n).fill(0);
		for (const rating of ratings) {
			const at = Math.min(n, Math.max(1, Math.ceil(rating / width - 1e-9))) - 1;
			counts[at] = (counts[at] ?? 0) + 1;
		}
		out.push({
			kind,
			scale,
			buckets: counts.map((count, at) => ({ upTo: Math.round((at + 1) * width * 100) / 100, count })),
			average: ratings.reduce((a, b) => a + b, 0) / ratings.length,
			count: ratings.length,
		});
	}
	return out;
}

const TOP = 8;

function traitStats(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	read: (entry: LibraryEntry) => readonly string[],
	overall: number | null,
): TraitStat[] {
	const groups = new Map<string, { name: string; entries: LibraryEntry[] }>();
	for (const entry of entries) {
		for (const name of new Set(read(entry))) {
			const key = name.trim().toLowerCase();
			if (!key) continue;
			const group = groups.get(key) ?? { name: name.trim(), entries: [] };
			group.entries.push(entry);
			groups.set(key, group);
		}
	}
	return [...groups.values()]
		.sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name))
		.slice(0, TOP)
		.map(({ name, entries: list }) => {
			const average = mean(list.map((e) => ratingFraction(config, e.kind, e.rating)));
			return {
				name,
				count: list.length,
				average,
				delta: average !== null && overall !== null ? average - overall : null,
			};
		});
}

/**
 * Given up on, against given up on plus finished.
 *
 * A dropped note has no finish date, so for a year it is counted by when it
 * was started.
 */
function droppedRate(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	finished: ReadonlySet<LibraryEntry>,
	year: number | null,
): { count: number; of: number } {
	const count = entries.filter(
		(e) =>
			statusTone(config, e.status) === "dropped" &&
			(year === null || inYear(dayOf(e.started) ?? dayOf(e.finished) ?? "", year)),
	).length;
	return { count, of: count + finished.size };
}

function replays(entries: readonly LibraryEntry[], done: readonly Completion[]) {
	const inPeriod = new Set(done.map((one) => one.entry));
	return entries
		.filter((e) => inPeriod.has(e) && e.history.length > 0)
		.map((entry) => ({ entry, times: entry.history.length + (entry.finished ? 1 : 0) }))
		.sort((a, b) => b.times - a.times || a.entry.title.localeCompare(b.entry.title))
		.slice(0, TOP);
}

/** Unstarted things, longest waiting first, by when they went on the list. */
function shelf(config: LibraryConfig, entries: readonly LibraryEntry[], now: Date) {
	const today = iso(now);
	return entries
		.filter((e) => (statusTone(config, e.status) ?? "planned") === "planned")
		.map((entry) => {
			// The note's own `created` — an import writes when it went on the
			// list there — and the file's age otherwise.
			const since = dayOf(customValue(entry, "created")) ?? iso(new Date(entry.created));
			const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(since)) / 86_400_000));
			return { entry, since, days };
		})
		.sort((a, b) => b.days - a.days)
		.slice(0, 5);
}

/** Each goal against what was finished in a year. Also the hub's figure. */
export function goalProgress(
	config: LibraryConfig,
	all: readonly LibraryEntry[],
	year: number,
	kind: MediaKind | null = null,
): StatsData["goals"] {
	const done = completions(all).filter((one) => inYear(one.date, year));
	return ALL_MEDIA_KINDS.filter(
		(k) => config.goals[k] && (kind === null || kind === k),
	).map((k) => ({
		kind: k,
		target: config.goals[k] as number,
		done: done.filter((one) => one.entry.kind === k).length,
		year,
	}));
}
