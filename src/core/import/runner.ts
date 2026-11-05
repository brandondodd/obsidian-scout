import type { ScoutContext } from "../context";
import { isAbortError } from "../http";
import { sourceKey, type MediaItem, type MediaKind } from "../types";
import { importPatch } from "./apply";
import { pickMatch, searchQuery, type Confidence } from "./match";
import type { ImportRecord } from "./types";

/**
 * Running an import: look everything up, let the user review, then write.
 *
 * Two passes on purpose. Nothing touches the vault until the user has seen
 * what was found and unticked what they do not want, and the second pass
 * re-checks the library, so running the same import twice — or resuming one
 * that was cancelled — creates nothing that is already there.
 */

export type RowState = "new" | "existing" | "unmatched";

export interface PlanRow {
	record: ImportRecord;
	state: RowState;
	item?: MediaItem;
	confidence?: Confidence;
	/** The note it is already in, for `existing`. */
	existingPath?: string;
	/** Whether to write it. The user can change this in the review. */
	include: boolean;
	/** Why a lookup failed, when it did rather than finding nothing. */
	error?: string;
}

export type Progress = (done: number, total: number) => void;

/** Lookups at once. Small, because the sources are free and say so. */
const CONCURRENCY = 3;

/** Runs `work` over `items`, a few at a time, stopping on abort. */
async function pool<T>(
	items: readonly T[],
	signal: AbortSignal,
	work: (item: T, at: number) => Promise<void>,
	onDone: () => void,
): Promise<void> {
	let next = 0;
	const lane = async () => {
		while (next < items.length && !signal.aborted) {
			const at = next++;
			await work(items[at] as T, at);
			onDone();
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, lane));
}

/** A row as something the index can look up by title and year. */
function probe(record: ImportRecord): MediaItem {
	return (
		record.item ?? {
			ref: { providerId: "", kind: record.kind, id: "" },
			title: record.title,
			year: record.year,
			tags: [],
			people: [],
			extra: {},
		}
	);
}

async function lookUp(
	ctx: ScoutContext,
	record: ImportRecord,
	signal: AbortSignal,
): Promise<{ item: MediaItem; confidence: Confidence } | null> {
	if (record.item) return { item: record.item, confidence: "exact" };
	const sources = ctx.registry
		.searchable(record.kind)
		.filter((p) => ctx.settings.isProviderEnabled(p.id));

	for (const source of sources) {
		// Open Library's search reads `isbn:` as a field query, which finds the
		// work an edition belongs to whatever that edition was titled.
		for (const isbn of record.kind === "book" ? record.isbns.slice(0, 2) : []) {
			const hits = await source.search(`isbn:${isbn}`, { signal, kind: "book" });
			const found = pickMatch(record, hits, true);
			if (found) return found;
		}
		const hits = await source.search(searchQuery(record), {
			signal,
			kind: record.kind,
		});
		const found = pickMatch(record, hits);
		if (found) return found;
	}
	return null;
}

/**
 * Finds every row: in the library already, at a source, or nowhere.
 *
 * Rows the library already has are settled without a request. Two rows that
 * turn out to be the same work — a film logged under two titles — are one
 * note, and the second is shown as already there.
 */
export async function planImport(
	ctx: ScoutContext,
	records: readonly ImportRecord[],
	signal: AbortSignal,
	onProgress: Progress,
): Promise<PlanRow[]> {
	const rows: PlanRow[] = records.map((record) => ({
		record,
		state: "unmatched",
		include: false,
	}));
	let done = 0;
	onProgress(0, rows.length);

	await pool(
		rows,
		signal,
		async (row) => {
			const local = ctx.library.match(probe(row.record));
			if (local) {
				row.state = "existing";
				row.existingPath = local.path;
				return;
			}
			try {
				const found = await lookUp(ctx, row.record, signal);
				if (!found) return;
				row.item = found.item;
				row.confidence = found.confidence;
				const owned = ctx.library.match(found.item);
				if (owned) {
					row.state = "existing";
					row.existingPath = owned.path;
				} else {
					row.state = "new";
					// A guess is shown, not acted on, until the user says so.
					row.include = found.confidence !== "likely";
				}
			} catch (err) {
				if (isAbortError(err)) return;
				row.error = err instanceof Error ? err.message : String(err);
			}
		},
		() => onProgress(++done, rows.length),
	);

	// Two rows, one work: the first keeps it.
	const claimed = new Set<string>();
	for (const row of rows) {
		if (row.state !== "new" || !row.item) continue;
		const key = sourceKey(row.item.ref);
		if (claimed.has(key)) {
			row.state = "existing";
			row.include = false;
		} else {
			claimed.add(key);
		}
	}
	return rows;
}

/** Kinds among the rows that have nowhere to be written. */
export function kindsWithoutFolder(
	ctx: ScoutContext,
	rows: readonly PlanRow[],
): MediaKind[] {
	const kinds = new Set<MediaKind>();
	for (const row of rows) {
		if (row.state !== "new" || !row.item) continue;
		const kind = row.item.ref.kind;
		if (!ctx.settings.kind(kind).outputFolder) kinds.add(kind);
	}
	return [...kinds];
}

export interface ImportSummary {
	created: number;
	/** In the library already when it came to writing — a resumed run. */
	skipped: number;
	failed: { title: string; reason: string }[];
	/** Rows cancelled before they were reached. */
	remaining: number;
}

/**
 * Writes every ticked row, one at a time.
 *
 * One at a time because each note is a detail request and a file write, and
 * the point of an import is to finish, not to race a rate limit. Each row is
 * checked against the library again first: a cancelled run resumed, or the
 * same file imported twice, finds its earlier notes and leaves them alone.
 */
export async function writeImport(
	ctx: ScoutContext,
	rows: readonly PlanRow[],
	signal: AbortSignal,
	onProgress: Progress,
): Promise<ImportSummary> {
	const todo = rows.filter((row) => row.include && row.state === "new" && row.item);
	const summary: ImportSummary = { created: 0, skipped: 0, failed: [], remaining: 0 };
	const config = ctx.settings.library();
	onProgress(0, todo.length);

	for (const [at, row] of todo.entries()) {
		if (signal.aborted) {
			summary.remaining = todo.length - at;
			break;
		}
		const item = row.item as MediaItem;
		if (ctx.library.match(item)) {
			summary.skipped++;
			onProgress(at + 1, todo.length);
			continue;
		}
		try {
			const outcome = await ctx.factory.create(item, signal, {
				quiet: true,
				open: false,
				// A same-named note that is a different work gets its own file.
				policy: "increment",
			});
			if (!outcome) {
				summary.failed.push({ title: row.record.title, reason: "No output folder" });
			} else {
				const note = { path: outcome.file.path, title: item.title };
				await ctx.mutator.patch(note, importPatch(config, row.record), true);
				if (row.record.review) {
					await ctx.mutator.writeThoughts(note, row.record.review);
				}
				// Settled in the plan too, so resuming a cancelled run never
				// writes it twice even before the index has caught up.
				row.state = "existing";
				row.existingPath = outcome.file.path;
				row.include = false;
				summary.created++;
			}
		} catch (err) {
			if (isAbortError(err)) {
				summary.remaining = todo.length - at;
				break;
			}
			summary.failed.push({
				title: row.record.title,
				reason: err instanceof Error ? err.message : String(err),
			});
		}
		onProgress(at + 1, todo.length);
	}
	return summary;
}

/** Rows nobody could find, as lines the user can paste somewhere. */
export function unmatchedList(rows: readonly PlanRow[]): string {
	return rows
		.filter((row) => row.state === "unmatched")
		.map((row) => {
			const { title, year, authors } = row.record;
			const by = authors[0] ? ` — ${authors[0]}` : "";
			return `${title}${year ? ` (${year})` : ""}${by}`;
		})
		.join("\n");
}
