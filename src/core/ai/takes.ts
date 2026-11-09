import type { ScoutContext } from "../context";
import type { LibraryEntry } from "../library/entry";
import { sourceKey, type MediaItem, type MediaRef } from "../types";
import { answerKey, type AnswerKind } from "./answerCache";
import { briefInput, tasteNow, titleSearch } from "./asker";
import { tasteBrief } from "./brief";
import { resolveNamed, type Found } from "./discover";
import { acrossRequest, readAcross, readTake, takeRequest, type Take, type TitleFacts } from "./take";

/**
 * Scout's take and Across kinds, as the detail page asks for them: from the
 * month-long cache when an answer is there, otherwise one call on the main
 * model, filed for next time.
 */

export interface Across {
	found: Found[];
	missing: number;
}

/** The title's key for the cache: its source, or its note when it has none. */
export function titleKey(ref: MediaRef | undefined, entry: LibraryEntry | undefined): string | null {
	if (ref) return sourceKey(ref);
	return entry ? `note:${entry.path}` : null;
}

function keyFor(ctx: ScoutContext, kind: AnswerKind, title: string): string {
	const provider = ctx.assistant.provider();
	return answerKey(kind, title, provider.id, ctx.assistant.model(provider, "main"));
}

export function cachedTake(ctx: ScoutContext, title: string): Take | null {
	return readTake(ctx.settings.answer(keyFor(ctx, "take", title)));
}

export async function askTake(ctx: ScoutContext, title: string, facts: TitleFacts, signal: AbortSignal): Promise<Take> {
	const taste = tasteBrief(briefInput(ctx, tasteNow(ctx)));
	const answer = await ctx.assistant.ask<unknown>(takeRequest(facts, taste), { tier: "main", signal });
	const take = readTake(answer);
	if (!take) throw new Error("The answer didn't make sense. Try again.");
	ctx.settings.setAnswer(keyFor(ctx, "take", title), take);
	return take;
}

/** Stored as found items, so reopening needs neither the model nor the sources. */
function readStoredAcross(value: unknown): Across | null {
	const at = value as Partial<Across> | null | undefined;
	if (!at || !Array.isArray(at.found)) return null;
	const found = at.found.filter(
		(one): one is Found =>
			!!one && typeof one === "object" && typeof one.reason === "string" && !!one.item && typeof (one.item as MediaItem).title === "string" && !!(one.item as MediaItem).ref,
	);
	return { found, missing: typeof at.missing === "number" ? at.missing : 0 };
}

export function cachedAcross(ctx: ScoutContext, title: string): Across | null {
	return readStoredAcross(ctx.settings.answer(keyFor(ctx, "across", title)));
}

export async function askAcross(ctx: ScoutContext, title: string, facts: TitleFacts, signal: AbortSignal): Promise<Across> {
	const taste = tasteBrief(briefInput(ctx, tasteNow(ctx)));
	const answer = await ctx.assistant.ask<unknown>(acrossRequest(facts, taste, []), { tier: "main", signal });
	const named = readAcross(answer, facts.kind);
	if (named.length === 0) throw new Error("Nothing came back. Try again.");
	const resolved = await resolveNamed(named, titleSearch(ctx), (item) => Boolean(ctx.library.match(item)), signal);
	if (resolved.found.length === 0) {
		throw new Error(resolved.owned > 0 ? "Everything it thought of is already in your library." : "None of its suggestions could be found in your sources.");
	}
	const across = { found: resolved.found, missing: resolved.missing };
	ctx.settings.setAnswer(keyFor(ctx, "across", title), across);
	return across;
}
