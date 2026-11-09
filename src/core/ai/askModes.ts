import type { LibraryConfig } from "../library/config";
import type { LibraryEntry } from "../library/entry";
import { ALL_MEDIA_KINDS, MEDIA_KIND_LABELS, type MediaKind } from "../types";
import { askPrompt, askSchema, ASK_SYSTEM, toFocus, type AskAnswer, type AskResult, type AskVocabulary } from "./ask";
import type { LibraryBrief } from "./brief";
import type { AiRequest } from "./providers";

/**
 * Ask Scout: one question, one call, one of three kinds of answer.
 *
 * - **find** — the library's own filters, exactly as "Ask your library" always
 *   did (`ask.ts`). Needs nothing but the question and the filter words.
 * - **pick** — a few things off your own shelf, each with a reason. "What
 *   should I watch tonight, I've got ninety minutes" is a pick: the prompt
 *   carries how long things are, and the model weighs it.
 * - **discover** — things not in the library at all. The model names them;
 *   Scout looks each one up at your sources (`discover.ts`) before showing it.
 *
 * Without sharing, the call can only translate, so it is the fast model with
 * the filter schema plus one word saying what the question really wanted —
 * which is how Home knows to offer sharing rather than show a filter that
 * misses the point. With sharing, one call on the main model classifies and
 * answers together, so a pick costs one round trip and not two.
 *
 * Pure, for testing. The call and the lookups are in `asker.ts`.
 */

export type AskMode = "find" | "pick" | "discover";
export const ASK_MODES: readonly AskMode[] = ["find", "pick", "discover"];

export const PICKS_MAX = 6;
export const FINDS_MAX = 8;
/** Kinds a discover answer may name: those a source can be searched for. */
const DISCOVER_KINDS: readonly MediaKind[] = ALL_MEDIA_KINDS.filter((kind) => kind !== "link");
/** Turns of a conversation carried into a follow-up. Older ones are dropped. */
export const HISTORY_MAX = 3;

/** One earlier question and what was shown for it, for a follow-up. */
export interface AskTurn {
	question: string;
	mode: AskMode;
	summary: string;
	/** What was on screen: shelf ids with titles, or found titles. */
	shown: string[];
}

/** A title the model named that is not in the library — to be looked up. */
export interface NamedTitle {
	title: string;
	year: number | null;
	kind: MediaKind;
	creator: string;
	reason: string;
}

/* ----------------------------------------------------------------- schemas */

const findSchema = {
	type: "object",
	additionalProperties: false,
	required: ["title", "year", "kind", "creator", "reason"],
	properties: {
		title: { type: "string" },
		year: { anyOf: [{ type: "integer" }, { type: "null" }] },
		kind: { type: "string", enum: [...DISCOVER_KINDS] },
		creator: { type: "string" },
		reason: { type: "string" },
	},
} as const;

/** The shape a named title takes in any answer: Discover, and Across kinds. */
export function namedTitleSchema(): Record<string, unknown> {
	return JSON.parse(JSON.stringify(findSchema)) as Record<string, unknown>;
}

/** Without sharing: the filter, and which mode the question meant. */
export function intentSchema(vocabulary: AskVocabulary): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		required: ["mode", "filter"],
		properties: {
			mode: { type: "string", enum: [...ASK_MODES] },
			filter: askSchema(vocabulary),
		},
	};
}

/** With sharing: every mode's fields, filled for the mode chosen and empty for the rest. */
export function fullSchema(vocabulary: AskVocabulary): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		required: ["mode", "summary", "filter", "picks", "finds"],
		properties: {
			mode: { type: "string", enum: [...ASK_MODES] },
			summary: { type: "string" },
			filter: askSchema(vocabulary),
			picks: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["id", "reason"],
					properties: { id: { type: "string" }, reason: { type: "string" } },
				},
			},
			finds: { type: "array", items: namedTitleSchema() },
		},
	};
}

/* ------------------------------------------------------------------ prompts */

const MODE_GUIDE = `First decide what the question wants:
- "find": a list of what they already have, by some property — "sci-fi I finished", "books I gave up on", "anything from the 90s". Answered with the filter.
- "pick": a recommendation from what they already have but have not finished — "what should I watch tonight", "something short and cosy to read", "which game next". Answered with picks.
- "discover": something new, not in their library — "a film like Arrival I haven't seen", "books for someone who loved Hades", "new albums I'd like". Answered with finds.`;

export const INTENT_SYSTEM = `${ASK_SYSTEM}

Also set mode. ${MODE_GUIDE}
Fill in the filter whatever the mode: it is shown when nothing better can be.`;

export const FULL_SYSTEM = `You are Scout, a warm, concise guide to one person's own media library: films, series, books, games, anime, manga and albums.

${MODE_GUIDE}

Then fill in only the fields for that mode, leaving the others empty ([] for lists; the filter with empty lists, false, 0, null and "any").
- summary: one short sentence, speaking to them, that says what you are showing — e.g. "Three short, gentle things from your shelf for a tired evening". No quotation marks.
- filter (find): as in the rules below.
- picks (pick): 3–${PICKS_MAX} titles, only from the shelf list, by their id exactly as written (like "s12"). Weigh what they lean towards and what is on the go. When they mention time, company or energy, use the length and feel given. reason: one line, under 80 characters, tied to them — a title they loved, a thread, a mood — never a plot summary.
- finds (discover): 3–${FINDS_MAX} real, well-known titles that exist, NOT in the lists given. If they ask for a different kind than the one they mention ("books for someone who loved Hades"), honour the kind asked for. title as published; year of release; kind from the allowed list; creator: the director, author, developer or artist (empty if unsure); reason as for picks. Never invent a title.

Never mention spoilers. A follow-up refines the previous answer: keep what still fits, replace what they turned down, and do not repeat titles they rejected.

Filter rules:
${ASK_SYSTEM.split("\n").slice(2).join("\n")}`;

function historyLines(history: readonly AskTurn[]): string[] {
	const turns = history.slice(-HISTORY_MAX);
	if (turns.length === 0) return [];
	return [
		"Earlier in this conversation:",
		...turns.map(
			(turn) =>
				`- Asked: ${turn.question.trim()} → ${turn.mode}: ${turn.summary}${turn.shown.length ? ` Shown: ${turn.shown.join("; ")}` : ""}`,
		),
		"",
	];
}

export function intentRequest(question: string, vocabulary: AskVocabulary, history: readonly AskTurn[], today: Date): AiRequest {
	const earlier = historyLines(history);
	return {
		system: INTENT_SYSTEM,
		prompt: [...earlier, askPrompt(question, vocabulary, today)].join("\n"),
		schema: intentSchema(vocabulary),
	};
}

export function fullRequest(
	question: string,
	vocabulary: AskVocabulary,
	brief: LibraryBrief,
	history: readonly AskTurn[],
	today: Date,
): AiRequest {
	const prompt = [
		`Today is ${today.toISOString().slice(0, 10)}.`,
		"",
		"Their taste:",
		brief.taste,
		"",
		"Their shelf — not finished yet, by id:",
		brief.shelf || "(empty)",
		"",
		"Filter words:",
		`Kinds: ${vocabulary.kinds.map((k) => `${k} (${MEDIA_KIND_LABELS[k]})`).join(", ") || "none yet"}`,
		`Statuses: ${vocabulary.statuses.join(", ") || "none"}`,
		`Genres: ${vocabulary.genres.join(", ") || "none"}`,
		`Collections: ${vocabulary.collections.join(", ") || "none"}`,
		"",
		...historyLines(history),
		`Question: ${question.trim()}`,
	].join("\n");
	// Picks and finds with a reason each, plus a filter: comfortably more than
	// a bare filter, far less than a tagging batch.
	return { system: FULL_SYSTEM, prompt, schema: fullSchema(vocabulary), maxTokens: 2048 };
}

/* ------------------------------------------------------------------ answers */

export type Interpreted =
	| { mode: "find"; summary: string; find: AskResult }
	| { mode: "pick"; summary: string; picks: { entry: LibraryEntry; reason: string }[]; find: AskResult }
	| { mode: "discover"; summary: string; finds: NamedTitle[]; find: AskResult };

/** A filter answer, with every field defaulted so a sloppy model cannot crash `toFocus`. */
function filterOf(raw: unknown): AskAnswer {
	const at = raw && typeof raw === "object" ? (raw as Partial<AskAnswer>) : {};
	const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
	const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
	const yearOf = (value: unknown) => (typeof value === "number" ? value : null);
	return {
		summary: typeof at.summary === "string" ? at.summary : "",
		text: typeof at.text === "string" ? at.text : "",
		kinds: list(at.kinds),
		statuses: list(at.statuses),
		tones: list(at.tones),
		tags: list(at.tags),
		genreMatch: at.genreMatch === "all" ? "all" : "any",
		notTags: list(at.notTags),
		people: list(at.people),
		collections: list(at.collections),
		favoritesOnly: at.favoritesOnly === true,
		minRating: num(at.minRating),
		rated: at.rated === "rated" || at.rated === "unrated" ? at.rated : "any",
		yearFrom: yearOf(at.yearFrom),
		yearTo: yearOf(at.yearTo),
		addedWithin: num(at.addedWithin),
		release: at.release === "out" || at.release === "upcoming" ? at.release : "any",
	};
}

export function modeOf(value: unknown): AskMode {
	return ASK_MODES.includes(value as AskMode) ? (value as AskMode) : "find";
}

export function cleanLine(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	const text = value.replace(/\s+/g, " ").replace(/^["“']+|["”']+$/g, "").trim();
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Named titles, checked: a real title, a kind on the list, a year that is a year. */
export function readNamed(raw: unknown, max: number): NamedTitle[] {
	if (!Array.isArray(raw)) return [];
	const out: NamedTitle[] = [];
	const seen = new Set<string>();
	for (const one of raw as Record<string, unknown>[]) {
		if (out.length >= max) break;
		if (!one || typeof one !== "object") continue;
		const title = cleanLine(one.title, 160);
		const kind = one.kind as MediaKind;
		if (!title || !DISCOVER_KINDS.includes(kind)) continue;
		const key = `${kind}:${title.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const year = typeof one.year === "number" && Number.isInteger(one.year) && one.year > 1800 && one.year < 3000 ? one.year : null;
		out.push({ title, year, kind, creator: cleanLine(one.creator, 80), reason: cleanLine(one.reason, 120) });
	}
	return out;
}

/** Picks, by id, dropping any id the shelf did not contain and any repeat. */
export function readPicks(raw: unknown, ids: ReadonlyMap<string, LibraryEntry>): { entry: LibraryEntry; reason: string }[] {
	if (!Array.isArray(raw)) return [];
	const out: { entry: LibraryEntry; reason: string }[] = [];
	const seen = new Set<string>();
	for (const one of raw as Record<string, unknown>[]) {
		if (out.length >= PICKS_MAX) break;
		if (!one || typeof one !== "object" || typeof one.id !== "string") continue;
		const id = one.id.trim().replace(/^\[|\]$/g, "").toLowerCase();
		const entry = ids.get(id);
		if (!entry || seen.has(id)) continue;
		seen.add(id);
		out.push({ entry, reason: cleanLine(one.reason, 120) });
	}
	return out;
}

/**
 * The answer, checked against the library before anything is shown.
 *
 * A pick or discover answer that comes back empty falls back to its filter,
 * so a question always ends somewhere rather than on a blank.
 */
export function interpret(
	answer: unknown,
	vocabulary: AskVocabulary,
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	ids: ReadonlyMap<string, LibraryEntry>,
): Interpreted {
	const at = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
	const find = toFocus(filterOf(at.filter), vocabulary, config, entries);
	const summary = cleanLine(at.summary, 200) || find.summary;
	const mode = modeOf(at.mode);
	if (mode === "pick") {
		const picks = readPicks(at.picks, ids);
		if (picks.length) return { mode, summary, picks, find };
	}
	if (mode === "discover") {
		const finds = readNamed(at.finds, FINDS_MAX);
		if (finds.length) return { mode, summary, finds, find };
	}
	return { mode: "find", summary: summary || find.summary, find };
}

/** Without sharing: the filter, and whether the question wanted more than one. */
export function interpretIntent(
	answer: unknown,
	vocabulary: AskVocabulary,
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
): { wanted: AskMode; find: AskResult } {
	const at = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
	return { wanted: modeOf(at.mode), find: toFocus(filterOf(at.filter), vocabulary, config, entries) };
}

/** What a turn showed, as carried into the next question. */
export function turnOf(question: string, shown: Interpreted | { mode: AskMode; summary: string }, lines: readonly string[]): AskTurn {
	return { question, mode: shown.mode, summary: shown.summary, shown: lines.slice(0, PICKS_MAX + FINDS_MAX) };
}
