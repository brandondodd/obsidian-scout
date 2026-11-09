import { ratingFraction, statusTone, type LibraryConfig } from "../library/config";
import type { LibraryEntry } from "../library/entry";
import { MEDIA_KIND_LABELS, type MediaKind } from "../types";
import { cleanLine, namedTitleSchema, readNamed, type NamedTitle } from "./askModes";
import type { AiRequest } from "./providers";
import { trimBlurb } from "./tagger";

/**
 * Two things the detail page can ask about one title, each only when asked.
 *
 * - **Scout's take** — "what would I make of this?", for something you have
 *   not got to yet: a search result, a suggestion, or something planned or
 *   paused. A fit and two or three spoiler-free sentences tied to what you
 *   loved, disliked, or the threads you keep returning to.
 * - **Across kinds** — "if you loved this…", for something you rated at the
 *   top of your scale: titles of *other* kinds that share what made it work,
 *   each looked up at your sources before it is shown.
 *
 * Both need sharing, since both are about you. Pure, for testing; the calls
 * and the cache are in `takes.ts`.
 */

export type Fit = "strong" | "good" | "mixed" | "weak";
export const FITS: readonly Fit[] = ["strong", "good", "mixed", "weak"];
export const FIT_LABELS: Record<Fit, string> = {
	strong: "Strong fit",
	good: "Good fit",
	mixed: "Mixed",
	weak: "Long shot",
};

export interface Take {
	fit: Fit;
	headline: string;
	why: string;
}

/** What the model is told about the title itself. */
export interface TitleFacts {
	title: string;
	year?: number;
	kind: MediaKind;
	genres: readonly string[];
	people: readonly string[];
	moods: readonly string[];
	themes: readonly string[];
	description?: string;
	/** The source's score, out of ten. */
	score?: number;
}

/** The top of the scale, or a favourite: what "you loved this" means here. */
export const LOVED_AT = 0.8;
const PEOPLE_SENT = 4;
export const ACROSS_MAX = 6;

/** A search result or suggestion, or a note you have not started or have set aside. */
export function takeEligible(config: LibraryConfig, entry: LibraryEntry | undefined, kind: MediaKind): boolean {
	if (kind === "link") return false;
	if (!entry) return true;
	const tone = statusTone(config, entry.status);
	return tone === "planned" || tone === "paused";
}

export function acrossEligible(config: LibraryConfig, entry: LibraryEntry | undefined): boolean {
	if (!entry || entry.kind === "link") return false;
	if (statusTone(config, entry.status) === "dropped") return false;
	if (entry.favorite) return true;
	const fraction = ratingFraction(config, entry.kind, entry.rating);
	return fraction !== undefined && fraction >= LOVED_AT;
}

function factLines(facts: TitleFacts): string[] {
	const lines = [`${facts.title}${facts.year ? ` (${facts.year})` : ""} — ${MEDIA_KIND_LABELS[facts.kind].toLowerCase()}`];
	if (facts.genres.length) lines.push(`Genres: ${facts.genres.slice(0, 6).join(", ")}`);
	if (facts.people.length) lines.push(`By/with: ${facts.people.slice(0, PEOPLE_SENT).join(", ")}`);
	const feel = [...facts.moods, ...facts.themes];
	if (feel.length) lines.push(`Feel: ${feel.slice(0, 8).join(", ")}`);
	if (facts.score !== undefined) lines.push(`Source score: ${Math.round(facts.score * 10) / 10}/10`);
	const blurb = trimBlurb(facts.description);
	if (blurb) lines.push(`About: ${blurb}`);
	return lines;
}

/* --------------------------------------------------------------- the take */

export const TAKE_SYSTEM = `You are Scout, a candid friend who knows one person's taste in films, series, books, games and music. Given one title and what they love, say how well it would suit them.

- fit: "strong", "good", "mixed" or "weak". Be honest; "mixed" and "weak" are useful answers.
- headline: under 70 characters, plain and specific, no quotation marks.
- why: 2 or 3 short sentences, speaking to them ("you"). Tie it to particular titles they loved or disliked, or to their threads. No spoilers — nothing past the premise.`;

export function takeSchema(): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		required: ["fit", "headline", "why"],
		properties: {
			fit: { type: "string", enum: [...FITS] },
			headline: { type: "string" },
			why: { type: "string" },
		},
	};
}

export function takeRequest(facts: TitleFacts, taste: string): AiRequest {
	return {
		system: TAKE_SYSTEM,
		prompt: ["The title:", ...factLines(facts), "", "Their taste:", taste].join("\n"),
		schema: takeSchema(),
		maxTokens: 600,
	};
}

/** The take, or null when the answer is not one: a fit off the list, or nothing said. */
export function readTake(answer: unknown): Take | null {
	const at = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : null;
	if (!at || !FITS.includes(at.fit as Fit)) return null;
	const headline = cleanLine(at.headline, 90);
	const why = cleanLine(at.why, 480);
	if (!headline && !why) return null;
	return { fit: at.fit as Fit, headline, why };
}

/* ----------------------------------------------------------- across kinds */

export const ACROSS_SYSTEM = `You are Scout. Someone loved the title below. Name things of OTHER kinds — not the same kind as it — that share what made it work for them: the feeling, the ideas, the craft. Real, well-known titles that exist; never invent one, and never a direct adaptation of the same story.

For each: title as published; year of release; kind from the allowed list; creator: director, author, developer or artist (empty if unsure); reason: one line under 80 characters saying what it shares with the loved title. No spoilers.`;

export function acrossSchema(): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		required: ["titles"],
		properties: { titles: { type: "array", items: namedTitleSchema() } },
	};
}

export function acrossRequest(facts: TitleFacts, taste: string, owned: readonly string[]): AiRequest {
	return {
		system: ACROSS_SYSTEM,
		prompt: [
			`Name ${ACROSS_MAX} titles, none of them a ${MEDIA_KIND_LABELS[facts.kind].toLowerCase()}.`,
			"",
			"The title they loved:",
			...factLines(facts),
			"",
			"Their taste:",
			taste,
			...(owned.length ? ["", `Already in their library, so not these: ${owned.join("; ")}`] : []),
		].join("\n"),
		schema: acrossSchema(),
		maxTokens: 1200,
	};
}

/** Named titles of other kinds only; the same kind is what the page already is. */
export function readAcross(answer: unknown, kind: MediaKind): NamedTitle[] {
	const titles = answer && typeof answer === "object" ? (answer as Record<string, unknown>).titles : null;
	return readNamed(titles, ACROSS_MAX * 2)
		.filter((one) => one.kind !== kind)
		.slice(0, ACROSS_MAX);
}
