import { pickMatch } from "../import/match";
import type { ImportRecord } from "../import/types";
import { sourceKey, type MediaItem, type MediaKind } from "../types";
import type { NamedTitle } from "./askModes";

/**
 * Turning titles a model named into things Scout can actually show.
 *
 * A model's memory is not a catalogue: it misremembers years, invents a sequel,
 * or names a book that was never translated. So nothing it names is shown as it
 * named it. Each title is searched for at the sources you have turned on and
 * matched the way an import row is (`pickMatch`, accepting a certain or likely
 * match); what no source knows is dropped, and so is anything already in the
 * library. What is left carries the source's own artwork, ids and facts, which
 * is what lets it be added, liked and learned from like any suggestion.
 *
 * The search is passed in, so this is tested with a fake.
 */

/** Searches one kind across the enabled sources, best source first. */
export type TitleSearch = (kind: MediaKind, query: string, signal: AbortSignal) => Promise<readonly MediaItem[][]>;

export interface Found {
	item: MediaItem;
	reason: string;
}

export interface Resolution {
	found: Found[];
	/** Named titles no source could find. Already-owned ones are not counted. */
	missing: number;
	/** Named titles that turned out to be in the library already. */
	owned: number;
}

/** Lookups at once: enough to be quick, few enough to be polite to a source. */
const PARALLEL = 3;

/** Books are matched by author too; for the rest, credits lists are too uneven. */
const AUTHORED: readonly MediaKind[] = ["book", "manga"];

export function recordOf(named: NamedTitle, at: number): ImportRecord {
	return {
		key: `named-${at}`,
		kind: named.kind,
		title: named.title,
		...(named.year ? { year: named.year } : {}),
		authors: AUTHORED.includes(named.kind) && named.creator ? [named.creator] : [],
		isbns: [],
		tone: "planned",
		history: [],
		favorite: false,
	};
}

/** What to type at a source: the title, with the author for a book. */
export function queryOf(named: NamedTitle): string {
	return AUTHORED.includes(named.kind) && named.creator ? `${named.title} ${named.creator}` : named.title;
}

async function lookUp(named: NamedTitle, at: number, search: TitleSearch, signal: AbortSignal): Promise<MediaItem | null> {
	const record = recordOf(named, at);
	let results: readonly MediaItem[][];
	try {
		results = await search(named.kind, queryOf(named), signal);
	} catch (err) {
		if (signal.aborted) throw err;
		// One source down is one title unfound, not the whole answer lost.
		return null;
	}
	for (const hits of results) {
		const match = pickMatch(record, hits);
		if (match) return match.item;
	}
	// An author's name in the query can push the right edition off a short
	// result list; the title alone is worth one more try.
	if (record.authors.length) {
		try {
			for (const hits of await search(named.kind, named.title, signal)) {
				const match = pickMatch(record, hits);
				if (match) return match.item;
			}
		} catch (err) {
			if (signal.aborted) throw err;
		}
	}
	return null;
}

/**
 * Looks up every named title and keeps those found and not owned, in the order
 * the model gave them.
 */
export async function resolveNamed(
	named: readonly NamedTitle[],
	search: TitleSearch,
	owned: (item: MediaItem) => boolean,
	signal: AbortSignal,
): Promise<Resolution> {
	const items: (MediaItem | null)[] = new Array(named.length).fill(null);
	let next = 0;
	const worker = async () => {
		while (next < named.length) {
			const at = next++;
			items[at] = await lookUp(named[at]!, at, search, signal);
		}
	};
	await Promise.all(Array.from({ length: Math.min(PARALLEL, named.length) }, worker));

	const found: Found[] = [];
	const seen = new Set<string>();
	let missing = 0;
	let ownedCount = 0;
	items.forEach((item, at) => {
		if (!item) {
			missing += 1;
			return;
		}
		if (owned(item)) {
			ownedCount += 1;
			return;
		}
		const key = sourceKey(item.ref);
		if (seen.has(key)) return;
		seen.add(key);
		found.push({ item, reason: named[at]!.reason });
	});
	return { found, missing, owned: ownedCount };
}

/** "2 suggestions couldn't be found in your sources", or nothing. */
export function missingNote(missing: number): string | null {
	if (missing <= 0) return null;
	return `${missing} suggestion${missing === 1 ? "" : "s"} couldn't be found in your sources.`;
}
