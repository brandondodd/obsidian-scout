import type { ScoutContext } from "../context";
import { buildTaste, type TasteProfile } from "../library/taste";
import type { MediaKind } from "../types";
import { askPrompt, askSchema, askVocabulary, ASK_SYSTEM, toFocus, type AskAnswer, type AskResult } from "./ask";
import {
	fullRequest,
	interpret,
	interpretIntent,
	intentRequest,
	type AskMode,
	type AskTurn,
} from "./askModes";
import { libraryBrief, type BriefInput } from "./brief";
import { resolveNamed, type Found, type TitleSearch } from "./discover";

/**
 * The calls behind Ask Scout and the library's sparkle, with the library and
 * sources wired in. The judgement is in the pure modules; this only fetches.
 */

export type AskOutcome =
	| { mode: "find"; summary: string; find: AskResult }
	| { mode: "pick"; summary: string; picks: { path: string; reason: string }[] }
	| { mode: "discover"; summary: string; found: Found[]; missing: number }
	/** The question wanted the library and sharing is not allowed yet. */
	| { mode: "offer"; wanted: Exclude<AskMode, "find">; find: AskResult };

/** The taste model as Home builds it, for pages that do not have one to hand. */
export function tasteNow(ctx: ScoutContext): TasteProfile {
	const manualCollections = new Set(
		ctx.settings
			.collections()
			.filter((one) => !one.auto)
			.map((one) => one.name.trim().toLowerCase()),
	);
	return buildTaste(ctx.settings.library(), ctx.library.all(), new Date(), ctx.settings.feedback(), {
		enrichment: ctx.settings.enrichment(),
		manualCollections,
	});
}

export function briefInput(ctx: ScoutContext, profile: TasteProfile): BriefInput {
	return {
		config: ctx.settings.library(),
		entries: ctx.library.all(),
		profile,
		threads: ctx.threads.shown(),
		feedback: ctx.settings.feedback(),
	};
}

/** Every enabled source that searches a kind, asked one after another until one finds it. */
export function titleSearch(ctx: ScoutContext): TitleSearch {
	return async (kind: MediaKind, query: string, signal: AbortSignal) => {
		const sources = ctx.registry.searchable(kind).filter((p) => ctx.settings.isProviderEnabled(p.id));
		const out = [];
		for (const source of sources) {
			try {
				out.push(await source.search(query, { signal, kind }));
			} catch (err) {
				if (signal.aborted) throw err;
			}
			// The first source with results usually settles it; the rest are
			// only asked when it had nothing.
			if (out[out.length - 1]?.length) break;
		}
		return out;
	};
}

function vocabularyOf(ctx: ScoutContext) {
	return askVocabulary(
		ctx.settings.library(),
		ctx.library.all(),
		ctx.settings.collections().map((c) => c.name),
	);
}

/** Words in, filters out — on the fast model, with nothing but filter names sent. */
export async function askFind(ctx: ScoutContext, question: string, signal?: AbortSignal): Promise<AskResult> {
	const vocabulary = vocabularyOf(ctx);
	const answer = await ctx.assistant.ask<AskAnswer>(
		{ system: ASK_SYSTEM, prompt: askPrompt(question, vocabulary, new Date()), schema: askSchema(vocabulary) },
		{ tier: "fast", signal },
	);
	return toFocus(answer, vocabulary, ctx.settings.library(), ctx.library.all());
}

/**
 * One question from the Ask bar, answered in whichever mode it meant.
 *
 * Without sharing it is the fast model and a filter, and a question that wanted
 * more comes back as an offer. With sharing, one call on the main model.
 */
export async function askScout(
	ctx: ScoutContext,
	question: string,
	history: readonly AskTurn[],
	signal: AbortSignal,
	profile?: TasteProfile,
): Promise<AskOutcome> {
	const { assistant, settings, library } = ctx;
	const config = settings.library();
	const entries = library.all();
	const vocabulary = vocabularyOf(ctx);

	if (!assistant.canShare()) {
		const answer = await assistant.ask<unknown>(intentRequest(question, vocabulary, history, new Date()), {
			tier: "fast",
			signal,
		});
		const { wanted, find } = interpretIntent(answer, vocabulary, config, entries);
		if (wanted !== "find" && assistant.shouldOfferSharing()) return { mode: "offer", wanted, find };
		return { mode: "find", summary: find.summary, find };
	}

	const brief = libraryBrief(briefInput(ctx, profile ?? tasteNow(ctx)));
	const answer = await assistant.ask<unknown>(fullRequest(question, vocabulary, brief, history, new Date()), {
		tier: "main",
		signal,
	});
	const read = interpret(answer, vocabulary, config, entries, brief.ids);
	if (read.mode === "pick") {
		return { mode: "pick", summary: read.summary, picks: read.picks.map((one) => ({ path: one.entry.path, reason: one.reason })) };
	}
	if (read.mode === "discover") {
		const resolved = await resolveNamed(read.finds, titleSearch(ctx), (item) => Boolean(library.match(item)), signal);
		if (resolved.found.length) {
			return { mode: "discover", summary: read.summary, found: resolved.found, missing: resolved.missing };
		}
		throw new Error(
			resolved.owned > 0 && resolved.missing === 0
				? "Everything it thought of is already in your library."
				: "None of its suggestions could be found in your sources.",
		);
	}
	return { mode: "find", summary: read.summary, find: read.find };
}

/** What an outcome showed, as lines for the next question's context. */
export function shownLines(ctx: ScoutContext, outcome: AskOutcome): string[] {
	if (outcome.mode === "pick") {
		return outcome.picks.map((one) => ctx.library.byPath(one.path)?.title ?? "").filter(Boolean);
	}
	if (outcome.mode === "discover") {
		return outcome.found.map((one) => `${one.item.title}${one.item.year ? ` (${one.item.year})` : ""}`);
	}
	return [];
}
