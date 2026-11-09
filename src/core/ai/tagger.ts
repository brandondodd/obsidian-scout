import type { LibraryEntry } from "../library/entry";
import { MEDIA_KIND_LABELS, type MediaItem, type MediaKind } from "../types";
import type { AiRequest } from "./providers";
import { MOODS, snapMood, snapThemes, type Mood } from "./vocabulary";

/**
 * Tagging: what is sent to describe a batch of titles, and how the answer is
 * checked before anything reaches a note.
 *
 * Pure, so the prompt can be read in a test and a recorded answer replayed
 * against it. The run itself — batching, writing, cancelling — is in
 * `tagRunner.ts`.
 *
 * What is sent per title is what a stranger would need to place it: title,
 * year, kind, genres, the first few names, and a trimmed blurb. Never your
 * rating, status or thoughts — tagging describes the work, not your view of
 * it, and has no use for either.
 */

/** Titles per call. Large enough that a library is a few dozen calls, small enough that one bad answer costs little. */
export const BATCH_SIZE = 40;
/** The most one run will take on, so a runaway run is bounded. */
export const RUN_CAP = 1000;
/** Room for forty titles' answers, with margin. */
export const BATCH_MAX_TOKENS = 8192;

const MOODS_MIN = 2;
const MOODS_MAX = 4;
const THEMES_MAX = 6;
const PEOPLE_SENT = 3;
const BLURB_CHARS = 280;

/** One title as the model sees it, under a short id local to the batch. */
export interface TagInput {
	id: string;
	title: string;
	year?: number;
	kind: MediaKind;
	genres: string[];
	people: string[];
	description?: string;
}

/** What the model may say about one title, after checking. */
export interface TitleTags {
	moods: Mood[];
	/** Canonical themes, then up to two of the model's own words. */
	themes: string[];
}

export function trimBlurb(text: string | undefined): string | undefined {
	const plain = text?.replace(/\s+/g, " ").trim();
	if (!plain) return undefined;
	if (plain.length <= BLURB_CHARS) return plain;
	const cut = plain.slice(0, BLURB_CHARS);
	const stop = cut.lastIndexOf(" ");
	return `${cut.slice(0, stop > 200 ? stop : BLURB_CHARS)}…`;
}

export function tagInputOf(entry: LibraryEntry, id: string): TagInput {
	return {
		id,
		title: entry.title,
		...(entry.year ? { year: entry.year } : {}),
		kind: entry.kind,
		genres: entry.tags.slice(0, 6),
		people: (entry.authored.length ? entry.authored : entry.people).slice(0, PEOPLE_SENT),
		...(trimBlurb(entry.description) ? { description: trimBlurb(entry.description) } : {}),
	};
}

/** The same, off a source record — for a note that is being made right now. */
export function tagInputOfItem(item: MediaItem, id: string): TagInput {
	return {
		id,
		title: item.title,
		...(item.year ? { year: item.year } : {}),
		kind: item.ref.kind,
		genres: item.tags.slice(0, 6),
		people: item.people.slice(0, PEOPLE_SENT),
		...(trimBlurb(item.description) ? { description: trimBlurb(item.description) } : {}),
	};
}

/** Kinds worth describing. A bookmarked article has no mood worth filtering by. */
export function taggable(kind: MediaKind): boolean {
	return kind !== "link";
}

/** Whether a note still has an empty mood or theme property to fill. */
export function needsTags(entry: LibraryEntry): boolean {
	return taggable(entry.kind) && (entry.moods.length === 0 || entry.themes.length === 0);
}

/** "About 4 calls for 152 untagged titles", before anything is sent. */
export function estimate(untagged: number): { titles: number; calls: number; capped: boolean } {
	const titles = Math.min(untagged, RUN_CAP);
	return { titles, calls: Math.ceil(titles / BATCH_SIZE), capped: untagged > RUN_CAP };
}

export function chunk<T>(items: readonly T[], size = BATCH_SIZE): T[][] {
	const out: T[][] = [];
	for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
	return out;
}

export const TAG_SYSTEM = `You describe films, series, books, games and albums for someone's personal library, so they can find things by how they feel and what they are about.

For each title, give:
- moods: ${MOODS_MIN} to ${MOODS_MAX} words for how it feels to watch, read, play or hear — only from the allowed list.
- themes: 3 to ${THEMES_MAX} short lowercase subjects it is about, like "grief", "found family", "first contact", "heist", "coming of age". Prefer plain, common words over clever ones. One idea per theme.

Describe the work itself as it is widely known. If you do not recognise a title, go by its genres and description. Answer for every id given, using the id exactly.`;

export function tagPrompt(inputs: readonly TagInput[]): string {
	const lines = inputs.map((one) => {
		const parts = [
			`[${one.id}] ${one.title}${one.year ? ` (${one.year})` : ""}`,
			MEDIA_KIND_LABELS[one.kind],
		];
		if (one.genres.length) parts.push(`genres: ${one.genres.join(", ")}`);
		if (one.people.length) parts.push(`by/with: ${one.people.join(", ")}`);
		if (one.description) parts.push(`about: ${one.description}`);
		return parts.join(" — ");
	});
	return `Titles:\n${lines.join("\n")}`;
}

export function tagSchema(): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		required: ["titles"],
		properties: {
			titles: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["id", "moods", "themes"],
					properties: {
						id: { type: "string" },
						moods: { type: "array", items: { type: "string", enum: [...MOODS] } },
						themes: { type: "array", items: { type: "string" } },
					},
				},
			},
		},
	};
}

export function tagRequest(inputs: readonly TagInput[]): AiRequest {
	return {
		system: TAG_SYSTEM,
		prompt: tagPrompt(inputs),
		schema: tagSchema(),
		maxTokens: BATCH_MAX_TOKENS,
	};
}

/** The answer's shape as asked for. Nothing in it is trusted until `readTags`. */
export interface TagAnswer {
	titles: { id: string; moods: string[]; themes: string[] }[];
}

/**
 * The answer, checked against what was asked.
 *
 * Ids the batch did not contain are dropped, so a model that invents a title or
 * garbles an id cannot write to the wrong note. Moods off the list are dropped
 * (a JSON-mode service cannot be held to the enum), themes are snapped, and a
 * title left with nothing usable is left out — and so stays empty, for the next
 * run to try again.
 */
export function readTags(answer: unknown, ids: readonly string[]): Map<string, TitleTags> {
	const out = new Map<string, TitleTags>();
	const wanted = new Set(ids);
	const rows = (answer as Partial<TagAnswer> | null)?.titles;
	if (!Array.isArray(rows)) return out;
	for (const row of rows) {
		if (!row || typeof row !== "object") continue;
		const id = typeof row.id === "string" ? row.id.trim().replace(/^\[|\]$/g, "") : "";
		if (!wanted.has(id) || out.has(id)) continue;
		const moods: Mood[] = [];
		for (const word of strings(row.moods)) {
			const mood = snapMood(word);
			if (mood && !moods.includes(mood)) moods.push(mood);
		}
		const { canonical, loose } = snapThemes(strings(row.themes));
		const themes = [...canonical.slice(0, THEMES_MAX), ...loose].slice(0, THEMES_MAX);
		const tags = { moods: moods.slice(0, MOODS_MAX), themes };
		if (tags.moods.length === 0 && tags.themes.length === 0) continue;
		out.set(id, tags);
	}
	return out;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];
}

/**
 * The property values to write: only into properties that are empty now.
 *
 * Returns property name → list, ready for `LibraryMutator.fillEmpty`, which
 * checks again at the moment of writing — this check is against the entry as
 * the run last saw it, which may be a minute old.
 */
export function tagValues(
	entry: Pick<LibraryEntry, "moods" | "themes"> | null,
	tags: TitleTags,
	fields: { moods: string; themes: string },
): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	if (fields.moods.trim() && tags.moods.length > 0 && !(entry && entry.moods.length > 0)) {
		out[fields.moods.trim()] = [...tags.moods];
	}
	if (fields.themes.trim() && tags.themes.length > 0 && !(entry && entry.themes.length > 0)) {
		out[fields.themes.trim()] = [...tags.themes];
	}
	return out;
}
