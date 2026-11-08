import { statusesFor, type LibraryConfig, type StatusTone } from "../library/config";
import type { LibraryEntry } from "../library/entry";
import type { QueryFilters } from "../library/query";
import { ALL_MEDIA_KINDS, MEDIA_KIND_LABELS, type MediaKind } from "../types";

/**
 * "Ask your library": a question in plain words, turned into the library's own
 * filters.
 *
 * The model only translates. It is sent the question and the words the filters
 * understand — the kinds, statuses, genres and collection names in use — and
 * never a title, a note, a rating or a person. It answers with a filter, which
 * is checked here against what the library actually holds before anything is
 * shown, and the library does the finding locally, exactly as if the filter
 * had been set by hand.
 */

const TONES: readonly StatusTone[] = ["planned", "active", "done", "paused", "dropped"];
/** Enough genres to cover any real library without sending a long tail of one-offs. */
const MAX_GENRES = 200;

/** The words the library's filters understand, from what is in use. */
export interface AskVocabulary {
	kinds: MediaKind[];
	statuses: string[];
	genres: string[];
	collections: string[];
}

export function askVocabulary(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	collections: readonly string[],
): AskVocabulary {
	const kinds = ALL_MEDIA_KINDS.filter((kind) => entries.some((e) => e.kind === kind));
	const statuses = unique(kinds.flatMap((kind) => statusesFor(config, kind)));

	const counts = new Map<string, number>();
	for (const e of entries) for (const tag of e.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	const genres = [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, MAX_GENRES)
		.map(([tag]) => tag);

	return {
		kinds,
		statuses,
		genres,
		collections: unique([...collections, ...entries.flatMap((e) => e.collections)]),
	};
}

/** What the model is asked to fill in. Every field is required, so "off" has a value. */
export interface AskAnswer {
	summary: string;
	text: string;
	kinds: string[];
	statuses: string[];
	tones: string[];
	tags: string[];
	genreMatch: "any" | "all";
	notTags: string[];
	people: string[];
	collections: string[];
	favoritesOnly: boolean;
	minRating: number;
	rated: "any" | "rated" | "unrated";
	yearFrom: number | null;
	yearTo: number | null;
	addedWithin: number;
	release: "any" | "out" | "upcoming";
}

const strings = { type: "array", items: { type: "string" } };
const year = { anyOf: [{ type: "integer" }, { type: "null" }] };

export function askSchema(vocabulary: AskVocabulary): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		summary: { type: "string" },
		text: { type: "string" },
		kinds: { type: "array", items: { type: "string", enum: vocabulary.kinds.length ? vocabulary.kinds : [...ALL_MEDIA_KINDS] } },
		statuses: strings,
		tones: { type: "array", items: { type: "string", enum: [...TONES] } },
		tags: strings,
		genreMatch: { type: "string", enum: ["any", "all"] },
		notTags: strings,
		people: strings,
		collections: strings,
		favoritesOnly: { type: "boolean" },
		minRating: { type: "number" },
		rated: { type: "string", enum: ["any", "rated", "unrated"] },
		yearFrom: year,
		yearTo: year,
		addedWithin: { type: "integer" },
		release: { type: "string", enum: ["any", "out", "upcoming"] },
	};
	return {
		type: "object",
		additionalProperties: false,
		properties,
		required: Object.keys(properties),
	};
}

export const ASK_SYSTEM = `You turn a question about someone's media library into filters for it. You never see the library itself, only the words its filters understand.

Fill in every field; use an empty list, false, 0, null or "any" for a filter the question does not ask for.
- summary: one short sentence saying what the filter shows, e.g. "Sci-fi films you finished and rated well".
- text: words to search titles and notes for. Leave empty unless the question names something no other field covers.
- kinds: media types, from the list given.
- statuses: the library's own status words, from the list given. Prefer tones when the question means a state rather than a word: planned (not started), active (in progress), done (finished), paused, dropped.
- tags / notTags: genres to include / leave out, only from the list given. genreMatch "all" only when every genre must apply.
- people: names of directors, authors, actors, artists, as written in the question.
- collections: only from the list given.
- minRating: the person's own rating, out of 10. 0 means no minimum. "Loved" is about 8, "liked" about 7.
- rated: "rated" or "unrated" only when the question asks whether a rating exists.
- yearFrom / yearTo: release years, inclusive. "The 90s" is 1990 to 1999.
- addedWithin: added to the library within this many days. 0 is off.
- release: "upcoming" for things not out yet, "out" for released.`;

export function askPrompt(question: string, vocabulary: AskVocabulary, today: Date): string {
	return [
		`Today is ${today.toISOString().slice(0, 10)}.`,
		`Kinds: ${vocabulary.kinds.map((k) => `${k} (${MEDIA_KIND_LABELS[k]})`).join(", ") || "none yet"}`,
		`Statuses: ${vocabulary.statuses.join(", ") || "none"}`,
		`Genres: ${vocabulary.genres.join(", ") || "none"}`,
		`Collections: ${vocabulary.collections.join(", ") || "none"}`,
		"",
		`Question: ${question.trim()}`,
	].join("\n");
}

/** A filter ready for the library, and what had to be left out of it. */
export interface AskResult {
	summary: string;
	focus: Partial<QueryFilters> & { text?: string };
	/** Words the model used that this library has no match for. */
	unknown: string[];
}

/**
 * Checks the model's answer against the library and converts it to filters.
 *
 * Anything that matches nothing here is dropped and reported rather than
 * passed on, because a filter for a genre the library does not have would
 * silently show nothing.
 */
export function toFocus(
	answer: AskAnswer,
	vocabulary: AskVocabulary,
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
): AskResult {
	const unknown: string[] = [];
	const pick = (wanted: readonly string[], known: readonly string[]): string[] => {
		const byLower = new Map(known.map((k) => [k.toLowerCase(), k]));
		const out: string[] = [];
		for (const word of wanted) {
			const hit = byLower.get(word.trim().toLowerCase());
			if (hit) out.push(hit);
			else if (word.trim()) unknown.push(word.trim());
		}
		return unique(out);
	};

	const people = unique(entries.flatMap((e) => e.people));
	const matchPerson = (name: string): string | undefined => {
		const needle = name.trim().toLowerCase();
		const exact = people.find((p) => p.toLowerCase() === needle);
		if (exact) return exact;
		// "Villeneuve" for "Denis Villeneuve", but only when it means one person.
		const partial = people.filter((p) => p.toLowerCase().includes(needle));
		return partial.length === 1 ? partial[0] : undefined;
	};

	const focus: AskResult["focus"] = {};
	const kinds = pick(answer.kinds, vocabulary.kinds) as MediaKind[];
	if (kinds.length) focus.kinds = kinds;
	const statuses = pick(answer.statuses, vocabulary.statuses);
	if (statuses.length) focus.statuses = statuses;
	const tones = answer.tones.filter((t): t is StatusTone => TONES.includes(t as StatusTone));
	if (tones.length) focus.tones = unique(tones);
	const tags = pick(answer.tags, vocabulary.genres);
	if (tags.length) {
		focus.tags = tags;
		focus.genreMatch = answer.genreMatch === "all" ? "all" : "any";
	}
	const notTags = pick(answer.notTags, vocabulary.genres);
	if (notTags.length) focus.notTags = notTags;
	const collections = pick(answer.collections, vocabulary.collections);
	if (collections.length) focus.collections = collections;

	const named: string[] = [];
	for (const name of answer.people) {
		const hit = matchPerson(name);
		if (hit) named.push(hit);
		else if (name.trim()) unknown.push(name.trim());
	}
	if (named.length) focus.people = unique(named);

	if (answer.favoritesOnly) focus.favoritesOnly = true;
	if (answer.minRating > 0) {
		// The filter takes the default scale and compares proportionally; the model speaks in tens.
		const onScale = (Math.min(answer.minRating, 10) / 10) * config.ratingScale;
		focus.minRating = Math.round(onScale * 2) / 2;
	}
	if (answer.rated === "rated" || answer.rated === "unrated") focus.rated = answer.rated;
	if (validYear(answer.yearFrom)) focus.yearFrom = answer.yearFrom;
	if (validYear(answer.yearTo)) focus.yearTo = answer.yearTo;
	if (answer.addedWithin > 0) focus.addedWithin = Math.round(answer.addedWithin);
	if (answer.release === "out" || answer.release === "upcoming") focus.release = answer.release;
	if (answer.text.trim()) focus.text = answer.text.trim();

	return { summary: answer.summary.trim(), focus, unknown: unique(unknown) };
}

function validYear(value: number | null): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 1800 && value < 3000;
}

function unique<T>(values: readonly T[]): T[] {
	return [...new Set(values)];
}
