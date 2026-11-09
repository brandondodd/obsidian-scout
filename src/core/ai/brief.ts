import { ratingFraction, statusTone, type LibraryConfig, type StatusTone } from "../library/config";
import { customValue, coerce, type LibraryEntry } from "../library/entry";
import { isDisliked, isLiked } from "../library/evaluate";
import type { FeedbackLog } from "../library/feedback";
import { topTraits, type TasteProfile } from "../library/taste";
import { MEDIA_KIND_LABELS } from "../types";
import type { Thread } from "./threads";

/**
 * The library, as a model is told about it when sharing is allowed.
 *
 * A few thousand tokens, whatever the size of the vault: what you lean
 * towards, the threads, what you loved, what you finished lately, and the
 * shelf of things not yet finished. Titles, years, kinds, genres, statuses,
 * ratings, moods and themes — never a note's text or your thoughts.
 *
 * The shelf is listed under short ids local to one question ("s12"), so an
 * answer can only point at something that was on it; anything else is
 * dropped when the answer is read (`askModes.ts`).
 *
 * Pure, so what is sent can be read in a test.
 */

export const SHELF_MAX = 150;
export const LOVED_MAX = 40;
const RECENT_MAX = 12;
const DISLIKED_MAX = 15;
const REFUSED_MAX = 15;
const TRAITS_EACH = 8;
const GENRES_PER_TITLE = 4;
const WORDS_PER_TITLE = 4;

const SHELF_TONES: readonly StatusTone[] = ["active", "paused", "planned"];
const TONE_WORDS: Record<StatusTone, string> = {
	planned: "not started",
	active: "on the go",
	paused: "paused",
	done: "finished",
	dropped: "dropped",
};

export interface BriefInput {
	config: LibraryConfig;
	entries: readonly LibraryEntry[];
	profile: TasteProfile;
	threads: readonly Pick<Thread, "name">[];
	feedback?: Readonly<FeedbackLog>;
}

export interface LibraryBrief {
	/** The taste half: what you lean to and away from, threads, loved, finished. */
	taste: string;
	/** The shelf half, one line per title under its id. Empty when not asked for. */
	shelf: string;
	/** Id → the entry it stands for, to read an answer back with. */
	ids: Map<string, LibraryEntry>;
}

/** The rating as "8/10", whatever scale the note is on. */
function outOfTen(input: BriefInput, entry: LibraryEntry): string | null {
	const fraction = ratingFraction(input.config, entry.kind, entry.rating);
	if (fraction === undefined) return null;
	return `${Math.round(fraction * 100) / 10}/10`;
}

function titleOf(entry: LibraryEntry): string {
	return `${entry.title}${entry.year ? ` (${entry.year})` : ""}`;
}

function kindOf(entry: LibraryEntry): string {
	return MEDIA_KIND_LABELS[entry.kind].toLowerCase();
}

function number(entry: LibraryEntry, ...keys: string[]): number | undefined {
	for (const key of keys) {
		const value = coerce.asNumber(customValue(entry, key));
		if (value !== undefined && value > 0) return value;
	}
	return undefined;
}

/**
 * How long it is, and how much is left, where the note says — what "something
 * short tonight" is answered with.
 */
export function lengthOf(entry: LibraryEntry): string | null {
	const parts: string[] = [];
	const minutes = number(entry, "runtime", "duration");
	if (minutes && (entry.kind === "movie" || entry.kind === "album")) {
		const h = Math.floor(minutes / 60);
		const m = Math.round(minutes % 60);
		parts.push(h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`);
	}
	const pages = number(entry, "pages", "page_count");
	if (pages && entry.kind === "book") parts.push(`${pages} pages`);
	const hours = number(entry, "playtime");
	if (hours && entry.kind === "game") parts.push(`about ${Math.round(hours)}h to beat`);
	const total = entry.progressTotal;
	if (total && total > 0) {
		const done = entry.progress ?? 0;
		const unit = entry.kind === "book" ? "pages" : entry.kind === "manga" ? "chapters" : entry.kind === "game" ? "hours" : "episodes";
		parts.push(done > 0 ? `${done} of ${total} ${unit} done` : `${total} ${unit}`);
	} else if (minutes && (entry.kind === "tv" || entry.kind === "anime")) {
		parts.push(`${Math.round(minutes)}m episodes`);
	}
	return parts.length ? parts.join(", ") : null;
}

function shelfLine(input: BriefInput, id: string, entry: LibraryEntry, tone: StatusTone): string {
	const parts = [`[${id}] ${titleOf(entry)}`, kindOf(entry), TONE_WORDS[tone]];
	if (entry.tags.length) parts.push(`genres: ${entry.tags.slice(0, GENRES_PER_TITLE).join(", ")}`);
	const feel = [...entry.moods.slice(0, WORDS_PER_TITLE), ...entry.themes.slice(0, WORDS_PER_TITLE)];
	if (feel.length) parts.push(`feel: ${feel.join(", ")}`);
	const length = lengthOf(entry);
	if (length) parts.push(length);
	if (entry.favorite) parts.push("favourite");
	return parts.join(" — ");
}

/** On the go first, then paused, then the backlog newest-added first. */
function shelfOrder(input: BriefInput): { entry: LibraryEntry; tone: StatusTone }[] {
	const rank = (tone: StatusTone) => SHELF_TONES.indexOf(tone);
	return input.entries
		.filter((entry) => entry.kind !== "link")
		.map((entry) => ({ entry, tone: statusTone(input.config, entry.status) }))
		.filter((one): one is { entry: LibraryEntry; tone: StatusTone } => one.tone !== null && SHELF_TONES.includes(one.tone))
		.sort((a, b) => rank(a.tone) - rank(b.tone) || b.entry.created - a.entry.created || a.entry.title.localeCompare(b.entry.title));
}

function lovedLine(input: BriefInput, entry: LibraryEntry): string {
	const rating = outOfTen(input, entry);
	const feel = [...entry.moods.slice(0, 3), ...entry.themes.slice(0, 3)];
	return [
		`${titleOf(entry)}, ${kindOf(entry)}`,
		rating ?? (entry.favorite ? "favourite" : null),
		feel.length ? feel.join(", ") : null,
	]
		.filter(Boolean)
		.join(" — ");
}

function finishedAt(entry: LibraryEntry): number {
	const at = entry.finished ? Date.parse(entry.finished) : NaN;
	return Number.isFinite(at) ? at : 0;
}

/** The taste half on its own — what Scout's take and Across kinds send. */
export function tasteBrief(input: BriefInput): string {
	const { config, entries, profile } = input;
	const traits = (ns: Parameters<typeof topTraits>[1], direction: "liked" | "disliked" = "liked") =>
		topTraits(profile, ns, TRAITS_EACH, direction, 2).map((one) => one.label);
	const lines: string[] = [];
	const leanTo = [
		["genres", traits("genre")],
		["moods", traits("mood")],
		["themes", traits("theme")],
		["people", traits(["director", "person"])],
	] as const;
	const leanAway = [
		["genres", traits("genre", "disliked")],
		["moods", traits("mood", "disliked")],
	] as const;
	const said = (rows: readonly (readonly [string, readonly string[]])[]) =>
		rows.filter(([, words]) => words.length > 0).map(([name, words]) => `${name}: ${words.join(", ")}`);
	if (said(leanTo).length) lines.push(`They lean towards — ${said(leanTo).join("; ")}`);
	if (said(leanAway).length) lines.push(`They lean away from — ${said(leanAway).join("; ")}`);
	if (input.threads.length) lines.push(`Threads in what they love: ${input.threads.map((one) => one.name).join("; ")}`);

	const loved = entries
		.filter((entry) => entry.kind !== "link" && isLiked(config, entry))
		.sort(
			(a, b) =>
				(ratingFraction(config, b.kind, b.rating) ?? 0.7) - (ratingFraction(config, a.kind, a.rating) ?? 0.7) ||
				Number(b.favorite) - Number(a.favorite) ||
				finishedAt(b) - finishedAt(a),
		)
		.slice(0, LOVED_MAX);
	if (loved.length) lines.push("", "Loved most:", ...loved.map((entry) => lovedLine(input, entry)));

	const recent = entries
		.filter((entry) => entry.kind !== "link" && statusTone(config, entry.status) === "done" && finishedAt(entry) > 0)
		.sort((a, b) => finishedAt(b) - finishedAt(a))
		.slice(0, RECENT_MAX);
	if (recent.length) {
		lines.push(
			"",
			"Finished lately, newest first:",
			...recent.map((entry) => `${titleOf(entry)}, ${kindOf(entry)}${outOfTen(input, entry) ? ` — ${outOfTen(input, entry)}` : ""}`),
		);
	}

	const disliked = entries
		.filter((entry) => entry.kind !== "link" && isDisliked(config, entry))
		.sort((a, b) => b.modified - a.modified)
		.slice(0, DISLIKED_MAX);
	if (disliked.length) {
		lines.push(
			"",
			"Did not like or gave up on:",
			...disliked.map((entry) => `${titleOf(entry)}, ${kindOf(entry)}`),
		);
	}

	const refused = Object.values(input.feedback ?? {})
		.filter((one) => one.verdict === "disliked")
		.sort((a, b) => b.at - a.at)
		.slice(0, REFUSED_MAX)
		.map((one) => one.title);
	if (refused.length) lines.push("", `Turned down as suggestions: ${refused.join("; ")}`);

	return lines.length ? lines.join("\n") : "Little is known about their taste yet.";
}

/**
 * The whole brief. `shelf: false` leaves the shelf out, for questions that
 * have no use for it.
 */
export function libraryBrief(input: BriefInput, { shelf = true } = {}): LibraryBrief {
	const ids = new Map<string, LibraryEntry>();
	const lines: string[] = [];
	if (shelf) {
		const rows = shelfOrder(input).slice(0, SHELF_MAX);
		rows.forEach(({ entry, tone }, at) => {
			const id = `s${at + 1}`;
			ids.set(id, entry);
			lines.push(shelfLine(input, id, entry, tone));
		});
	}
	return { taste: tasteBrief(input), shelf: lines.join("\n"), ids };
}
