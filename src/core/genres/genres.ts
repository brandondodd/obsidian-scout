import type { MediaKind } from "../types";
import { TAXONOMY, type GenreDef, type GenreDomain } from "./taxonomy";

/**
 * Turning whatever a source calls its genres into Scout's own.
 *
 * Pure, and the only place that knows how: providers call it as items leave
 * them, the library calls it on notes written before it existed, and the
 * recommendations call it on both sides so a film tagged "Sci-Fi & Fantasy"
 * and a book tagged "Science fiction" are recognised as the same taste.
 */

export function domainOf(kind: MediaKind): GenreDomain | null {
	switch (kind) {
		case "movie":
		case "tv":
		case "anime":
			return "screen";
		case "book":
		case "manga":
			return "books";
		case "game":
			return "games";
		case "album":
			return "music";
		default:
			return null;
	}
}

/**
 * The comparable form of a name: lowercase, no accents, "&" and "+" read as
 * "and", and everything that is not a letter or a digit turned into a space.
 */
export function genreKey(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/['’]/g, "")
		.replace(/[&+]/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

interface DomainIndex {
	byKey: Map<string, GenreDef>;
	byLabel: Map<string, GenreDef>;
	/** Labels in the order the taxonomy lists them, for stable display. */
	order: Map<string, number>;
}

const INDEXES = new Map<GenreDomain, DomainIndex>();

function indexOf(domain: GenreDomain): DomainIndex {
	const found = INDEXES.get(domain);
	if (found) return found;
	const byKey = new Map<string, GenreDef>();
	const byLabel = new Map<string, GenreDef>();
	const order = new Map<string, number>();
	TAXONOMY[domain].forEach((def, at) => {
		byLabel.set(def.label, def);
		order.set(def.label, at);
		for (const name of [def.label, ...(def.aliases ?? [])]) {
			const key = genreKey(name);
			// First definition wins, so an alias never steals a label's own key.
			if (key && !byKey.has(key)) byKey.set(key, def);
		}
	});
	const built = { byKey, byLabel, order };
	INDEXES.set(domain, built);
	return built;
}

/** Words that say "this is a story" and nothing about which kind. */
const NOISE = new Set(["general", "fiction", "nonfiction", "non fiction", "literature", "stories", "other", "misc", "miscellaneous"]);

const SUFFIXES = [
	" fiction",
	" novels",
	" novel",
	" stories",
	" story",
	" films",
	" film",
	" movies",
	" movie",
	" series",
	" books",
	" book",
	" literature",
	" music",
	" games",
	" game",
	" television",
	" tv",
	" shows",
	" show",
	" manga",
];

/** One piece of text, looked up as given, singular, and without a trailing "fiction". */
function lookup(key: string, index: DomainIndex): GenreDef | undefined {
	if (!key) return undefined;
	const tries = [key];
	if (key.endsWith("ies")) tries.push(`${key.slice(0, -3)}y`);
	if (key.endsWith("s")) tries.push(key.slice(0, -1));
	for (const suffix of SUFFIXES) {
		if (key.endsWith(suffix) && key.length > suffix.length + 1) {
			const bare = key.slice(0, -suffix.length);
			tries.push(bare);
			if (bare.endsWith("s")) tries.push(bare.slice(0, -1));
		}
	}
	for (const one of tries) {
		const hit = index.byKey.get(one);
		if (hit) return hit;
	}
	return undefined;
}

/** Hierarchical subjects, lists, and combinations all split the same way. */
const SPLIT = /\s*(?:[,;/|:()=]|\s-\s|--|\.\s)\s*/;

function match(raw: string, index: DomainIndex, out: GenreDef[]): void {
	const whole = lookup(genreKey(raw), index);
	if (whole) {
		out.push(whole);
		return;
	}
	const parts = raw.split(SPLIT).filter((part) => part.trim().length > 0);
	if (parts.length > 1) {
		for (const part of parts) match(part, index, out);
		return;
	}
	// "Action & Adventure", "Sci-Fi & Fantasy": a pair that is not a name of
	// its own is the two genres it names.
	const key = genreKey(raw);
	if (key.includes(" and ")) {
		for (const half of key.split(" and ")) {
			const hit = lookup(half.trim(), index);
			if (hit) out.push(hit);
		}
	}
}

/**
 * A hand-written value worth keeping when it matches nothing: a word or three,
 * letters only. "Cosy" survives; "nyt:paperback_books=2011-06-11" does not.
 */
function looksLikeGenre(value: string): boolean {
	const text = value.trim();
	if (text.length < 2 || text.length > 30) return false;
	if (!/^[\p{L}][\p{L}\s&'’-]*$/u.test(text)) return false;
	return text.split(/\s+/).length <= 3;
}

export interface CanonicalOptions {
	/**
	 * Keep values that match nothing. `true` keeps those that look like a
	 * genre, for notes written by hand, where an unknown word is the user's own
	 * and not noise. `"any"` keeps every one, for the recommendations, which
	 * learn from whatever they are given.
	 */
	keepUnknown?: boolean | "any";
}

/**
 * Scout's genres for something, from whatever its source called them.
 *
 * In the order the source gave them, since sources list the defining genre
 * first. A sub-genre brings its main genre with it, placed before it, so the
 * main genres can be read off the front. Kinds with no vocabulary (web links)
 * keep their values as written, tidied.
 */
export function canonicalGenres(
	kind: MediaKind,
	raw: readonly string[] | undefined,
	options: CanonicalOptions = {},
): string[] {
	if (!raw || raw.length === 0) return [];
	const domain = domainOf(kind);
	if (!domain) {
		return dedupe(raw.map((one) => one.trim()).filter(looksLikeGenre));
	}
	const index = indexOf(domain);

	const found: GenreDef[] = [];
	const unknown: string[] = [];
	for (const value of raw) {
		if (typeof value !== "string" || NOISE.has(genreKey(value))) continue;
		const before = found.length;
		match(value, index, found);
		// Anything else a person typed into a note is theirs, not noise.
		const keep =
			options.keepUnknown === "any"
				? value.trim().length > 0
				: options.keepUnknown === true && looksLikeGenre(value);
		if (found.length === before && keep) {
			unknown.push(value.trim());
		}
	}

	const specific = found.filter((def) => !def.fallback);
	const chosen =
		specific.length > 0 || unknown.length > 0 ? specific : fallbackFrom(raw, index);

	const out: string[] = [];
	const add = (label: string) => {
		if (!out.includes(label)) out.push(label);
	};
	for (const def of chosen) {
		if (def.parent) add(def.parent);
		for (const extra of def.also ?? []) add(extra);
		add(def.label);
	}
	for (const value of unknown) {
		if (!out.some((label) => genreKey(label) === genreKey(value))) out.push(value);
	}
	return out;
}

/** "Fiction" or "Nonfiction", when that is all a source said. */
function fallbackFrom(raw: readonly string[], index: DomainIndex): GenreDef[] {
	for (const value of raw) {
		if (typeof value !== "string") continue;
		for (const part of [value, ...value.split(SPLIT)]) {
			const hit = index.byKey.get(genreKey(part));
			if (hit?.fallback) return [hit];
		}
	}
	return [];
}

function dedupe(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const key = genreKey(value);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(value);
	}
	return out;
}

/** The main genre a label sits under, or the label itself if it is one. */
export function mainGenreOf(kind: MediaKind, label: string): string {
	const domain = domainOf(kind);
	if (!domain) return label;
	return indexOf(domain).byLabel.get(label)?.parent ?? label;
}

/** Whether a label is a main genre in this kind's vocabulary. Unknown labels count as main. */
export function isMainGenre(kind: MediaKind, label: string): boolean {
	const domain = domainOf(kind);
	if (!domain) return true;
	return !indexOf(domain).byLabel.get(label)?.parent;
}

/** Where a label sits in its family's list, for ordering. Unknown ones go last. */
export function genreRank(domain: GenreDomain, label: string): number {
	return indexOf(domain).order.get(label) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * A provider's own genre names that mean any of `wanted`.
 *
 * Providers search in their own vocabulary — TMDB's "Sci-Fi & Fantasy",
 * AniList's "Mahou Shoujo" — and taste is now learned in Scout's. This finds
 * the provider's words for each wanted genre, keeping the order they were
 * asked in.
 */
export function sourceGenresFor(
	kind: MediaKind,
	wanted: readonly string[],
	vocabulary: readonly string[],
): string[] {
	const theirs = vocabulary.map((name) => ({
		name,
		labels: canonicalGenres(kind, [name]),
	}));
	const out: string[] = [];
	for (const one of wanted) {
		const labels = canonicalGenres(kind, [one], { keepUnknown: true });
		for (const label of labels) {
			for (const entry of theirs) {
				if (entry.labels.includes(label) && !out.includes(entry.name)) {
					out.push(entry.name);
				}
			}
		}
	}
	return out;
}

/** What `entryGenres` needs of a note. */
interface GenreSource {
	kind: MediaKind;
	tags: readonly string[];
	/** Present on notes made from a source; absent on hand-written ones. */
	ref?: unknown;
}

const ENTRY_GENRES = new WeakMap<GenreSource, string[]>();

/**
 * A note's genres, in Scout's vocabulary.
 *
 * Notes written before the vocabulary existed still carry whatever their source
 * said, so the library reads them through this rather than as written. A note
 * with no source keeps the words its author chose. Cached on the entry object,
 * which the index replaces whenever the note changes.
 */
export function entryGenres(entry: GenreSource): string[] {
	const found = ENTRY_GENRES.get(entry);
	if (found) return found;
	const built = canonicalGenres(entry.kind, entry.tags, { keepUnknown: !entry.ref });
	ENTRY_GENRES.set(entry, built);
	return built;
}

/** Just the main genres of a note — one level, for charts and shelves. */
export function entryMainGenres(entry: GenreSource): string[] {
	return entryGenres(entry).filter((label) => isMainGenre(entry.kind, label));
}
