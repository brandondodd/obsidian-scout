import { domainOf, entryGenres, genreRank, mainGenreOf } from "../genres/genres";
import { DOMAIN_LABELS, type GenreDomain } from "../genres/taxonomy";
import type { MediaKind } from "../types";
import type { LibraryEntry } from "./entry";

/**
 * What there is to filter by, counted.
 *
 * The filter panel offers what the library actually holds rather than every
 * genre Scout knows, and in families: a film's genres and an album's are
 * different vocabularies, and one long list mixing "Rock" with "Romance" is
 * what this replaces. Each family lists its main genres, each with the
 * sub-genres beneath it that something in the library carries.
 */

export interface Facet {
	label: string;
	count: number;
}

export interface GenreFacet extends Facet {
	subs: Facet[];
}

export interface GenreFamily {
	/** Null for kinds with no vocabulary of their own, like web links. */
	domain: GenreDomain | null;
	label: string;
	/** The kinds in the library this family covers. */
	kinds: MediaKind[];
	genres: GenreFacet[];
}

const byCount = (a: Facet, b: Facet) => b.count - a.count || a.label.localeCompare(b.label);

export function genreFacets(entries: readonly LibraryEntry[]): GenreFamily[] {
	interface Building {
		kinds: Set<MediaKind>;
		mains: Map<string, { count: number; subs: Map<string, number> }>;
	}
	const families = new Map<GenreDomain | null, Building>();

	for (const entry of entries) {
		const genres = entryGenres(entry);
		if (genres.length === 0) continue;
		const domain = domainOf(entry.kind);
		let family = families.get(domain);
		if (!family) {
			family = { kinds: new Set(), mains: new Map() };
			families.set(domain, family);
		}
		family.kinds.add(entry.kind);
		// Counted once per entry per main genre, however many of its sub-genres
		// the entry also carries.
		const seenMain = new Set<string>();
		for (const label of genres) {
			const main = mainGenreOf(entry.kind, label);
			let slot = family.mains.get(main);
			if (!slot) {
				slot = { count: 0, subs: new Map() };
				family.mains.set(main, slot);
			}
			if (!seenMain.has(main)) {
				seenMain.add(main);
				slot.count++;
			}
			if (main !== label) slot.subs.set(label, (slot.subs.get(label) ?? 0) + 1);
		}
	}

	const order: (GenreDomain | null)[] = ["screen", "books", "games", "music", null];
	return order.flatMap((domain) => {
		const family = families.get(domain);
		if (!family) return [];
		const genres: GenreFacet[] = [...family.mains.entries()].map(([label, slot]) => ({
			label,
			count: slot.count,
			subs: [...slot.subs.entries()]
				.map(([sub, count]) => ({ label: sub, count }))
				.sort(byCount),
		}));
		genres.sort(
			(a, b) =>
				b.count - a.count ||
				(domain ? genreRank(domain, a.label) - genreRank(domain, b.label) : 0) ||
				a.label.localeCompare(b.label),
		);
		return [
			{
				domain,
				label: domain ? DOMAIN_LABELS[domain] : "Other",
				kinds: [...family.kinds],
				genres,
			},
		];
	});
}

/** Values of a list field, most common first, case folded together. */
function counted(lists: Iterable<readonly string[]>): Facet[] {
	const counts = new Map<string, Facet>();
	for (const list of lists) {
		const seen = new Set<string>();
		for (const raw of list) {
			const label = raw.trim();
			const key = label.toLowerCase();
			if (!key || seen.has(key)) continue;
			seen.add(key);
			const found = counts.get(key);
			if (found) found.count++;
			else counts.set(key, { label, count: 1 });
		}
	}
	return [...counts.values()].sort(byCount);
}

export function peopleFacets(entries: readonly LibraryEntry[]): Facet[] {
	return counted(entries.map((entry) => entry.people));
}

/** Moods in use, most common first. */
export function moodFacets(entries: readonly LibraryEntry[]): Facet[] {
	return counted(entries.map((entry) => entry.moods));
}

export function themeFacets(entries: readonly LibraryEntry[]): Facet[] {
	return counted(entries.map((entry) => entry.themes));
}

export function collectionFacets(entries: readonly LibraryEntry[]): Facet[] {
	return counted(entries.map((entry) => entry.collections));
}

/** Every genre, in Scout's vocabulary, most common first. */
export function collectTags(entries: readonly LibraryEntry[]): string[] {
	return counted(entries.map((entry) => entryGenres(entry))).map((facet) => facet.label);
}

/** The earliest and latest years in the set, or null when nothing has one. */
export function yearRange(entries: readonly LibraryEntry[]): { min: number; max: number } | null {
	let min = Infinity;
	let max = -Infinity;
	for (const entry of entries) {
		if (!entry.year) continue;
		if (entry.year < min) min = entry.year;
		if (entry.year > max) max = entry.year;
	}
	return Number.isFinite(min) ? { min, max } : null;
}
