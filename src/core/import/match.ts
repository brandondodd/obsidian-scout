import { certainMatch } from "../library/link";
import { titleScore } from "../ranking";
import { normalizeTitle } from "../title";
import type { MediaItem } from "../types";
import type { ImportRecord } from "./types";

/**
 * Choosing which search result an imported row means.
 *
 * Pure, so the judgement can be tested apart from the searching. A row is
 * only ever matched with a stated confidence: `exact` when an id or ISBN
 * settled it, `certain` when the title and year leave one candidate (the same
 * rule that backfills source ids on existing notes), and `likely` for a best
 * guess the user is shown and asked about before anything is written.
 */

export type Confidence = "exact" | "certain" | "likely";

export interface Match {
	item: MediaItem;
	confidence: Confidence;
}

/** Below this, a best guess is no guess at all. */
const LIKELY_FLOOR = 0.6;

function surnames(names: readonly string[]): Set<string> {
	const out = new Set<string>();
	for (const name of names) {
		const words = normalizeTitle(name).split(" ").filter(Boolean);
		const last = words[words.length - 1];
		if (last) out.add(last);
	}
	return out;
}

/**
 * Whether a book candidate is by one of the row's authors.
 *
 * Surnames only, so "J. R. R. Tolkien" and "John Ronald Reuel Tolkien" agree.
 * A candidate that names nobody is given the benefit of the doubt.
 */
function sameAuthor(record: ImportRecord, item: MediaItem): boolean {
	if (record.authors.length === 0 || item.people.length === 0) return true;
	const wanted = surnames(record.authors);
	for (const name of surnames(item.people)) if (wanted.has(name)) return true;
	return false;
}

function yearsAgree(record: ImportRecord, item: MediaItem): boolean {
	return (
		record.year === undefined ||
		item.year === undefined ||
		Math.abs(item.year - record.year) <= 1
	);
}

/** "Sapiens: A Brief History of Humankind" is catalogued as "Sapiens". */
function titleFit(record: ImportRecord, item: MediaItem): number {
	const main = record.title.split(/[:(]/)[0]?.trim() ?? record.title;
	return Math.max(
		titleScore(record.title, item.title),
		main ? titleScore(main, item.title) : 0,
	);
}

export function pickMatch(
	record: ImportRecord,
	candidates: readonly MediaItem[],
	byIsbn = false,
): Match | null {
	const authored = candidates.filter(
		(item) => item.ref.kind === record.kind && sameAuthor(record, item),
	);
	// The catalogue answered an ISBN query: whichever work it returned is the
	// one that edition belongs to, whatever the edition happened to be called —
	// and in whichever year that edition came out.
	if (byIsbn) {
		const first = authored[0];
		return first ? { item: first, confidence: "exact" } : null;
	}
	// Two years far apart are two works, however alike the titles.
	const pool = authored.filter((item) => yearsAgree(record, item));
	if (pool.length === 0) return null;

	const certain =
		certainMatch(record, pool) ??
		certainMatch({ ...record, title: record.title.split(":")[0]?.trim() ?? record.title }, pool);
	if (certain) return { item: certain, confidence: "certain" };

	let best: MediaItem | undefined;
	let bestScore = 0;
	for (const item of pool) {
		const score = titleFit(record, item);
		if (score > bestScore) {
			best = item;
			bestScore = score;
		}
	}
	return best && bestScore >= LIKELY_FLOOR
		? { item: best, confidence: "likely" }
		: null;
}

/** What to type into a search box for a row. */
export function searchQuery(record: ImportRecord): string {
	const author = record.authors[0];
	return record.kind === "book" && author
		? `${record.title.split(":")[0]?.trim() ?? record.title} ${author}`
		: record.title;
}
