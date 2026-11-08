import { normalizeTitle } from "../title";
import { sourceKey, type MediaItem, type MediaKind } from "../types";
import { ratingFraction, statusTone, type LibraryConfig } from "./config";
import { SuggestionEngine, type SuggestionPort } from "./engine";
import type { LibraryEntry } from "./entry";
import type { FeedbackLog } from "./feedback";
import { buildTaste, candidateOf, scoreCandidate } from "./taste";
import type { TraitOptions } from "./traits";

/**
 * Measuring the recommender against your own library.
 *
 * Two checks, so a change to a constant can be judged by a number instead of
 * by how the row feels this evening:
 *
 * - `tasteCheck` needs no network. It hides a fifth of what you have rated,
 *   rebuilds the taste model from the rest, and asks whether the hidden things
 *   you liked score above the hidden things you did not (AUC: 0.5 is a coin,
 *   1.0 is perfect). It reports the full score, the taste part alone, and the
 *   source's own rating alone, so you can see what the model adds over "just
 *   show well-rated things".
 * - `pipelineCheck` hides the things you most recently finished and liked,
 *   runs the real suggestion engine as if they were not on your shelf, and
 *   counts how many of them it suggests back. It asks the sources, so run it
 *   through `recordingPort` to make re-runs offline and repeatable.
 */

/* ------------------------------------------------------------------ labels */

/** A considered yes: rated in the top part of its scale, or a favourite. */
export function isLiked(config: LibraryConfig, entry: LibraryEntry): boolean {
	if (statusTone(config, entry.status) === "dropped") return false;
	const fraction = ratingFraction(config, entry.kind, entry.rating);
	if (fraction !== undefined) return fraction >= 0.7;
	return entry.favorite;
}

/** A considered no: dropped, or rated below halfway. */
export function isDisliked(config: LibraryConfig, entry: LibraryEntry): boolean {
	if (statusTone(config, entry.status) === "dropped") return true;
	const fraction = ratingFraction(config, entry.kind, entry.rating);
	return fraction !== undefined && fraction < 0.5;
}

/** Feedback minus anything about the entries being tested, which would leak. */
function withoutKeys(feedback: Readonly<FeedbackLog>, keys: ReadonlySet<string>): FeedbackLog {
	const out: FeedbackLog = {};
	for (const [key, record] of Object.entries(feedback)) {
		if (!keys.has(key)) out[key] = record;
	}
	return out;
}

function keysOf(entries: readonly LibraryEntry[]): Set<string> {
	const out = new Set<string>();
	for (const entry of entries) if (entry.ref) out.add(sourceKey(entry.ref));
	return out;
}

/** A stable fold for a note, so a re-run splits the library the same way. */
function foldOf(path: string, folds: number): number {
	let hash = 0;
	for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) | 0;
	return Math.abs(hash) % folds;
}

/**
 * The chance a random liked item outscores a random disliked one.
 * Ties count half. Null when either side is empty.
 */
export function auc(positives: readonly number[], negatives: readonly number[]): number | null {
	if (positives.length === 0 || negatives.length === 0) return null;
	let wins = 0;
	for (const p of positives) {
		for (const n of negatives) {
			if (p > n) wins += 1;
			else if (p === n) wins += 0.5;
		}
	}
	return wins / (positives.length * negatives.length);
}

/* ------------------------------------------------------------ taste check */

export interface TasteCheckOptions {
	feedback?: Readonly<FeedbackLog>;
	traitOptions?: TraitOptions;
	folds?: number;
	now?: Date;
}

export interface TasteCheck {
	liked: number;
	disliked: number;
	/** The whole score the row ranks by. */
	score: number | null;
	/** The taste part alone, without the source's rating. */
	fit: number | null;
	/** The source's own rating alone: the baseline the model has to beat. */
	source: number | null;
	/** The full score, per kind with enough of both to say anything. */
	byKind: { kind: MediaKind; liked: number; disliked: number; score: number | null }[];
}

export function tasteCheck(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	options: TasteCheckOptions = {},
): TasteCheck {
	const folds = Math.max(2, options.folds ?? 5);
	const now = options.now ?? new Date();
	const traitOptions = options.traitOptions ?? {};

	const scored: { kind: MediaKind; liked: boolean; score: number; fit: number; source?: number }[] = [];
	for (let fold = 0; fold < folds; fold++) {
		const test = entries.filter(
			(entry) =>
				foldOf(entry.path, folds) === fold &&
				(isLiked(config, entry) || isDisliked(config, entry)),
		);
		if (test.length === 0) continue;
		const hidden = new Set(test);
		const train = entries.filter((entry) => !hidden.has(entry));
		const profile = buildTaste(
			config,
			train,
			now,
			withoutKeys(options.feedback ?? {}, keysOf(test)),
			traitOptions,
		);
		for (const entry of test) {
			const verdict = scoreCandidate(profile, candidateOf(entry, traitOptions), now);
			scored.push({
				kind: entry.kind,
				liked: isLiked(config, entry),
				score: verdict.score,
				fit: verdict.fit,
				...(entry.sourceRating === undefined ? {} : { source: entry.sourceRating }),
			});
		}
	}

	const split = (rows: typeof scored, pick: (row: (typeof scored)[number]) => number | undefined) => {
		const pos: number[] = [];
		const neg: number[] = [];
		for (const row of rows) {
			const value = pick(row);
			if (value === undefined) continue;
			(row.liked ? pos : neg).push(value);
		}
		return auc(pos, neg);
	};

	const kinds = [...new Set(scored.map((row) => row.kind))];
	return {
		liked: scored.filter((row) => row.liked).length,
		disliked: scored.filter((row) => !row.liked).length,
		score: split(scored, (row) => row.score),
		fit: split(scored, (row) => row.fit),
		source: split(scored, (row) => row.source),
		byKind: kinds.map((kind) => {
			const rows = scored.filter((row) => row.kind === kind);
			return {
				kind,
				liked: rows.filter((row) => row.liked).length,
				disliked: rows.filter((row) => !row.liked).length,
				score: split(rows, (row) => row.score),
			};
		}),
	};
}

/* --------------------------------------------------------- pipeline check */

/** The most recent liked, finished, linked entries, newest first. */
export function holdOut(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	count: number,
): { held: LibraryEntry[]; train: LibraryEntry[] } {
	const held = entries
		.filter(
			(entry) =>
				entry.ref &&
				entry.finished &&
				statusTone(config, entry.status) === "done" &&
				isLiked(config, entry),
		)
		.sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? ""))
		.slice(0, count);
	const hidden = new Set(held);
	return { held, train: entries.filter((entry) => !hidden.has(entry)) };
}

const identity = (title: string, year: number | undefined) =>
	`${normalizeTitle(title)}|${year ?? "?"}`;

/**
 * Whether a suggestion is one of the hidden titles — by source id, or by title
 * and year when another source returned it. A port built for a pipeline check
 * should treat these as not owned, or a series lookup filters them out first.
 */
export function heldMatcher(held: readonly LibraryEntry[]): (item: MediaItem) => boolean {
	const keys = keysOf(held);
	const ids = new Set(held.map((entry) => identity(entry.title, entry.year)));
	return (item) => keys.has(sourceKey(item.ref)) || ids.has(identity(item.title, item.year));
}

export interface PipelineOptions {
	config: LibraryConfig;
	entries: readonly LibraryEntry[];
	port: SuggestionPort;
	kinds: readonly MediaKind[];
	/** How many recent favourites to hide. */
	hold?: number;
	/** Rows to draw: the first, and one per "show me others". */
	rows?: number;
	feedback?: Readonly<FeedbackLog>;
	traitOptions?: TraitOptions;
	now?: Date;
	/** Give up on a fetch that has not finished in this long. */
	timeoutMs?: number;
}

export interface PipelineCheck {
	held: number;
	/** Suggestions drawn, across every row. */
	drawn: number;
	/** Hidden titles in the first row, the first three, and everything drawn. */
	inFirstRow: number;
	inFirstThree: number;
	inAll: number;
	/** Each hidden title found, and the place it first appeared (1-based). */
	found: { title: string; at: number }[];
	missed: string[];
	error: string | null;
}

/** Resolves once the engine is not fetching, or after the timeout. */
function settled(engine: SuggestionEngine, timeoutMs: number): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			stop();
			clearTimeout(timer);
			resolve();
		};
		const stop = engine.subscribe(() => {
			if (!engine.state().loading) done();
		});
		const timer = setTimeout(done, timeoutMs);
		// Checked after a tick: the fetch an update starts flips `loading` on
		// synchronously, but one with nothing to ask never does.
		void Promise.resolve().then(() => {
			if (!engine.state().loading) done();
		});
	});
}

export async function pipelineCheck(options: PipelineOptions): Promise<PipelineCheck> {
	const now = options.now ?? new Date();
	const rows = Math.max(1, options.rows ?? 5);
	const timeoutMs = options.timeoutMs ?? 60_000;
	const { held, train } = holdOut(options.config, options.entries, options.hold ?? 10);

	const heldKeys = keysOf(held);
	const isHeld = heldMatcher(held);

	// The hidden titles are not on the shelf as far as the engine can tell.
	const port: SuggestionPort = {
		...options.port,
		owned: (item) => !isHeld(item) && options.port.owned(item),
	};
	const feedback = withoutKeys(options.feedback ?? {}, heldKeys);
	const traitOptions = options.traitOptions ?? {};
	const profile = buildTaste(options.config, train, now, feedback, traitOptions);

	const engine = new SuggestionEngine(port);
	const order: MediaItem[] = [];
	let error: string | null = null;
	try {
		engine.update({
			config: options.config,
			entries: train,
			profile,
			feedback,
			kinds: options.kinds,
			traitOptions,
			now,
			rotation: 0,
		});
		await settled(engine, timeoutMs);
		for (let row = 0; row < rows; row++) {
			const state = engine.state();
			error ??= state.error;
			order.push(...state.shown.map((at) => at.item));
			if (row === rows - 1 || state.exhausted) break;
			engine.more();
			await settled(engine, timeoutMs);
		}
	} finally {
		engine.dispose();
	}

	const firstAt = new Map<string, number>();
	order.forEach((item, index) => {
		if (!isHeld(item)) return;
		const match = held.find(
			(entry) =>
				(entry.ref && sourceKey(entry.ref) === sourceKey(item.ref)) ||
				identity(entry.title, entry.year) === identity(item.title, item.year),
		);
		if (match && !firstAt.has(match.path)) firstAt.set(match.path, index + 1);
	});
	const found = held
		.filter((entry) => firstAt.has(entry.path))
		.map((entry) => ({ title: entry.title, at: firstAt.get(entry.path) ?? 0 }))
		.sort((a, b) => a.at - b.at);
	const within = (limit: number) => found.filter((one) => one.at <= limit).length;

	return {
		held: held.length,
		drawn: order.length,
		inFirstRow: within(7),
		inFirstThree: within(21),
		inAll: found.length,
		found,
		missed: held.filter((entry) => !firstAt.has(entry.path)).map((entry) => entry.title),
		error,
	};
}

/* --------------------------------------------------------------- recording */

/** Source answers by request, so a pipeline check can be re-run offline. */
export type Recording = Record<string, MediaItem[]>;

/** Stable JSON: keys sorted, so the same request always makes the same key. */
function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.filter((key) => record[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

/**
 * Wraps a port so every answer is kept in `recording`.
 *
 * `record` asks the source only for requests it has not seen; `replay` never
 * asks, and answers anything new with nothing, counting it as a miss. A miss
 * means the change being measured asked a new question — worth knowing,
 * because a replayed run cannot score what it never heard the answer to.
 */
export function recordingPort(
	port: SuggestionPort,
	recording: Recording,
	mode: "record" | "replay",
): { port: SuggestionPort; misses: () => number; asked: () => number } {
	let misses = 0;
	let asked = 0;
	const via = async (key: string, live: () => Promise<MediaItem[]>) => {
		const kept = recording[key];
		if (kept) return kept;
		if (mode === "replay") {
			misses += 1;
			return [];
		}
		asked += 1;
		const items = await live();
		recording[key] = items;
		return items;
	};
	return {
		port: {
			...port,
			similar: (providerId, ref, signal) =>
				via(`similar|${providerId}|${stable(ref)}`, () => port.similar(providerId, ref, signal)),
			series: (providerId, ref, signal) =>
				via(`series|${providerId}|${stable(ref)}`, () => port.series(providerId, ref, signal)),
			discover: (providerId, query, signal) =>
				via(`discover|${providerId}|${stable(query)}`, () =>
					port.discover(providerId, query, signal),
				),
		},
		misses: () => misses,
		asked: () => asked,
	};
}

/* ------------------------------------------------------------------ report */

const pct = (value: number | null) => (value === null ? "n/a" : value.toFixed(3));

export function formatReport(taste: TasteCheck | null, pipeline: PipelineCheck | null): string {
	const lines: string[] = [];
	if (taste) {
		lines.push(
			"## Taste check",
			"",
			`${taste.liked} liked and ${taste.disliked} disliked titles, each scored by a model that had not seen it. AUC: 0.5 is a coin toss, 1.0 is perfect.`,
			"",
			"| Measure | AUC |",
			"| --- | --- |",
			`| Full score | ${pct(taste.score)} |`,
			`| Taste alone | ${pct(taste.fit)} |`,
			`| Source rating alone (baseline) | ${pct(taste.source)} |`,
			"",
		);
		if (taste.byKind.length > 1) {
			lines.push("| Type | Liked | Disliked | AUC |", "| --- | --- | --- | --- |");
			for (const row of taste.byKind) {
				lines.push(`| ${row.kind} | ${row.liked} | ${row.disliked} | ${pct(row.score)} |`);
			}
			lines.push("");
		}
	}
	if (pipeline) {
		lines.push(
			"## Suggestion check",
			"",
			`Hid your ${pipeline.held} most recent liked finishes and drew ${pipeline.drawn} suggestions without them.`,
			"",
			"| Found | Count |",
			"| --- | --- |",
			`| In the first row | ${pipeline.inFirstRow} |`,
			`| In the first three rows | ${pipeline.inFirstThree} |`,
			`| Anywhere drawn | ${pipeline.inAll} |`,
			"",
		);
		if (pipeline.found.length > 0) {
			lines.push(`Found: ${pipeline.found.map((one) => `${one.title} (#${one.at})`).join(", ")}`, "");
		}
		if (pipeline.missed.length > 0) lines.push(`Missed: ${pipeline.missed.join(", ")}`, "");
		if (pipeline.error) lines.push(`Source error: ${pipeline.error}`, "");
	}
	return lines.join("\n");
}
