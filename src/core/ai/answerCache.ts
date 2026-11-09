/**
 * Answers worth keeping: Scout's take and Across kinds.
 *
 * Both are about one title and change only as your taste does, which is slowly,
 * so they are kept for a month. Reopening a page then shows the answer at once
 * and costs nothing. Keyed by what asked and who answered — the title's source
 * key, the service and the model — so switching models asks again rather than
 * showing another model's words as this one's.
 *
 * Kept in `cache.json` (see `cacheFile.ts`): rebuildable, never synced
 * opinion, cleared from the AI settings. Pure, for testing.
 */

export const ANSWER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A ceiling, so years of opening pages cannot grow the cache without end. */
export const ANSWERS_MAX = 500;

export type AnswerKind = "take" | "across";

export interface AnswerRecord {
	at: number;
	value: unknown;
}

export type AnswerLog = Record<string, AnswerRecord>;

export function answerKey(kind: AnswerKind, title: string, provider: string, model: string): string {
	return `${kind}|${title}|${provider}|${model || "default"}`;
}

export function isFresh(record: AnswerRecord | undefined, now: number): record is AnswerRecord {
	return !!record && now - record.at >= 0 && now - record.at < ANSWER_TTL_MS;
}

/** Expired records out, then the oldest past the ceiling. */
export function pruneAnswers(log: Readonly<AnswerLog>, now: number): AnswerLog {
	const live = Object.entries(log).filter(([, record]) => isFresh(record, now));
	live.sort((a, b) => b[1].at - a[1].at);
	return Object.fromEntries(live.slice(0, ANSWERS_MAX));
}

/** Read defensively — the file is hand-editable. */
export function normalizeAnswers(raw: unknown): AnswerLog {
	const out: AnswerLog = {};
	if (!raw || typeof raw !== "object") return out;
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const one = value as Partial<AnswerRecord> | null;
		if (!one || typeof one.at !== "number" || !Number.isFinite(one.at) || one.value === undefined) continue;
		out[key] = { at: one.at, value: one.value };
	}
	return out;
}
