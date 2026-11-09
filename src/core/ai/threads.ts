import type { LibraryConfig } from "../library/config";
import type { LibraryEntry } from "../library/entry";
import { isLiked } from "../library/evaluate";
import { MEDIA_KIND_LABELS } from "../types";
import type { AiRequest } from "./providers";
import { MOODS, snapMood, snapTheme, type Mood, type Theme } from "./vocabulary";

/**
 * Threads: the few strands that run through what you love, across kinds.
 *
 * "Quiet stories about grief", "Heists and the people who plan them" — a
 * thread is named and described by the model once, from the moods and themes
 * of the titles you rated highest. What it is *made of* is a signature: a few
 * canonical moods and themes. Which notes belong to it is worked out here, from
 * the notes' own properties, every time it is shown — so threads work offline,
 * cost nothing to keep current, and a film tagged tomorrow joins the thread it
 * belongs to without anyone asking a model again.
 *
 * Pure, for testing. Storage and the call are in `threadKeeper.ts`.
 */

export interface Thread {
	id: string;
	name: string;
	description: string;
	moods: Mood[];
	themes: Theme[];
	/** Kept through a refresh; the model writes the rest around it. */
	pinned: boolean;
	/** Not shown. Dropped at the next refresh unless pinned. */
	hidden: boolean;
}

export const THREADS_WANTED = 5;
export const THREADS_MAX = 6;
/** A thread fewer titles than this join is not a thread, it is a coincidence. */
export const MIN_MEMBERS = 3;

/* --------------------------------------------------------------- membership */

/**
 * Themes count for more than moods: "grief" picks out a handful of titles in a
 * library, "melancholy" a sixth of it. The threshold means one shared theme
 * and one shared mood, two shared themes, or three shared moods — never a
 * single word on its own.
 */
const THEME_POINTS = 1;
const MOOD_POINTS = 0.6;
const JOIN_AT = 1.6;

interface Signature {
	moods: Set<Mood>;
	themes: Set<Theme>;
}

/** Per entry object, which the index replaces whenever the note changes. */
const SIGNATURES = new WeakMap<object, Signature>();

/** An entry's moods and themes, folded onto the canonical lists. */
export function signatureOf(entry: Pick<LibraryEntry, "moods" | "themes">): Signature {
	const cached = SIGNATURES.get(entry);
	if (cached) return cached;
	const moods = new Set<Mood>();
	const themes = new Set<Theme>();
	for (const word of entry.moods) {
		const mood = snapMood(word);
		if (mood) moods.add(mood);
	}
	for (const word of entry.themes) {
		const theme = snapTheme(word);
		if (theme) themes.add(theme);
	}
	const signature = { moods, themes };
	SIGNATURES.set(entry, signature);
	return signature;
}

/** How much of a thread an entry carries. Zero when it shares nothing. */
export function threadScore(
	thread: Pick<Thread, "moods" | "themes">,
	entry: Pick<LibraryEntry, "moods" | "themes">,
): number {
	const own = signatureOf(entry);
	let score = 0;
	for (const theme of thread.themes) if (own.themes.has(theme)) score += THEME_POINTS;
	for (const mood of thread.moods) if (own.moods.has(mood)) score += MOOD_POINTS;
	return score;
}

/** The notes that belong to a thread, closest first, then best rated. */
export function threadMembers(
	thread: Pick<Thread, "moods" | "themes">,
	entries: readonly LibraryEntry[],
): LibraryEntry[] {
	const scored: { entry: LibraryEntry; score: number }[] = [];
	for (const entry of entries) {
		if (entry.moods.length === 0 && entry.themes.length === 0) continue;
		const score = threadScore(thread, entry);
		if (score >= JOIN_AT) scored.push({ entry, score });
	}
	scored.sort(
		(a, b) =>
			b.score - a.score ||
			(b.entry.rating ?? -1) - (a.entry.rating ?? -1) ||
			a.entry.title.localeCompare(b.entry.title),
	);
	return scored.map((one) => one.entry);
}

/* -------------------------------------------------------------- the request */

/** What the model is told about the titles you love: counts and titles, nothing else. */
export interface LovedDigest {
	titles: string[];
	moods: [string, number][];
	themes: [string, number][];
	loved: number;
}

const DIGEST_TITLES = 80;
const DIGEST_WORDS = 30;

export function lovedDigest(config: LibraryConfig, entries: readonly LibraryEntry[]): LovedDigest {
	const loved = entries
		.filter((entry) => (entry.moods.length > 0 || entry.themes.length > 0) && isLiked(config, entry))
		.sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.rating ?? 0) - (a.rating ?? 0));
	const moods = new Map<string, number>();
	const themes = new Map<string, number>();
	for (const entry of loved) {
		const own = signatureOf(entry);
		for (const mood of own.moods) moods.set(mood, (moods.get(mood) ?? 0) + 1);
		for (const theme of own.themes) themes.set(theme, (themes.get(theme) ?? 0) + 1);
	}
	const top = (counts: Map<string, number>) =>
		[...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, DIGEST_WORDS);
	return {
		loved: loved.length,
		moods: top(moods),
		themes: top(themes),
		titles: loved.slice(0, DIGEST_TITLES).map((entry) => {
			const own = signatureOf(entry);
			const words = [...own.moods, ...own.themes].join(", ");
			return `${entry.title}${entry.year ? ` (${entry.year})` : ""}, ${MEDIA_KIND_LABELS[entry.kind].toLowerCase()}: ${words}`;
		}),
	};
}

export const THREAD_SYSTEM = `You find the threads that run through what one person loves across films, series, books, games and music.

A thread is a feeling plus a subject that keeps recurring, like "Quiet grief, told gently" or "Clever people planning the impossible". Each thread has:
- name: 2 to 6 words, sentence case, warm and specific, no quotation marks.
- description: one short sentence, under 90 characters, speaking to the person ("You keep coming back to…" is fine, but vary it).
- moods: 1 to 3, only from the allowed list.
- themes: 1 to 3 short lowercase subjects, taken from the themes given where possible.

Make threads distinct from each other and from any kept threads. Prefer threads that span more than one kind of media when the library allows it.`;

export function threadRequest(digest: LovedDigest, kept: readonly Thread[], wanted: number): AiRequest {
	const keptLine = `Already kept (do not repeat): ${kept
		.map((one) => `${one.name} [${[...one.moods, ...one.themes].join(", ")}]`)
		.join("; ")}`;
	const prompt = [
		`Write ${wanted} new thread${wanted === 1 ? "" : "s"}.`,
		...(kept.length ? [keptLine] : []),
		`Moods across the ${digest.loved} titles they love most, with counts: ${digest.moods.map(([w, n]) => `${w} ${n}`).join(", ")}`,
		`Themes, with counts: ${digest.themes.map(([w, n]) => `${w} ${n}`).join(", ")}`,
		"",
		"Titles they love, with their moods and themes:",
		...digest.titles,
	].join("\n");
	return {
		system: THREAD_SYSTEM,
		prompt,
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["threads"],
			properties: {
				threads: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						required: ["name", "description", "moods", "themes"],
						properties: {
							name: { type: "string" },
							description: { type: "string" },
							moods: { type: "array", items: { type: "string", enum: [...MOODS] } },
							themes: { type: "array", items: { type: "string" } },
						},
					},
				},
			},
		},
	};
}

/* --------------------------------------------------------------- the answer */

/**
 * New threads from the model's answer, checked against the library.
 *
 * Words off the lists are dropped; a thread left with fewer than two words, or
 * that fewer than `MIN_MEMBERS` notes would join, or that has the same
 * signature as one already kept, is dropped too. The model names; the library
 * decides whether there is anything to name.
 */
export function readThreads(
	answer: unknown,
	entries: readonly LibraryEntry[],
	kept: readonly Thread[],
	wanted: number,
	makeId: (at: number) => string,
): Thread[] {
	const rows = (answer as { threads?: unknown } | null)?.threads;
	if (!Array.isArray(rows)) return [];
	const seen = new Set(kept.map(signatureKey));
	const out: Thread[] = [];
	for (const row of rows as Record<string, unknown>[]) {
		if (out.length >= wanted) break;
		if (!row || typeof row !== "object") continue;
		const name = clean(row.name, 48);
		if (!name) continue;
		const moods = unique(strings(row.moods).map(snapMood)).slice(0, 3);
		const themes = unique(strings(row.themes).map(snapTheme)).slice(0, 3);
		if (moods.length + themes.length < 2) continue;
		const thread: Thread = {
			id: makeId(out.length),
			name,
			description: clean(row.description, 140),
			moods,
			themes,
			pinned: false,
			hidden: false,
		};
		const key = signatureKey(thread);
		if (seen.has(key)) continue;
		if (threadMembers(thread, entries).length < MIN_MEMBERS) continue;
		seen.add(key);
		out.push(thread);
	}
	return out;
}

/** Threads as stored, from data that may have been edited or written by an older build. */
export function normaliseThreads(raw: unknown): Thread[] {
	if (!Array.isArray(raw)) return [];
	const out: Thread[] = [];
	for (const one of raw as Record<string, unknown>[]) {
		if (!one || typeof one !== "object" || typeof one.id !== "string") continue;
		const name = clean(one.name, 48);
		if (!name) continue;
		out.push({
			id: one.id,
			name,
			description: clean(one.description, 140),
			moods: unique(strings(one.moods).map(snapMood)),
			themes: unique(strings(one.themes).map(snapTheme)),
			pinned: one.pinned === true,
			hidden: one.hidden === true,
		});
	}
	return out;
}

function signatureKey(thread: Pick<Thread, "moods" | "themes">): string {
	return [...thread.moods].sort().join(",") + "|" + [...thread.themes].sort().join(",");
}

function clean(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	const text = value.replace(/\s+/g, " ").replace(/^["“']+|["”']+$/g, "").trim();
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];
}

function unique<T>(values: readonly (T | null)[]): T[] {
	const out: T[] = [];
	for (const one of values) if (one !== null && !out.includes(one)) out.push(one);
	return out;
}
