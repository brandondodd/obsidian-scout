import { normalizeTitle } from "../title";
import type { MediaKind } from "../types";

/** Helpers every export parser needs, in one place so they agree. */

/** `2021/03/05`, `2021-3-5`, `2021-03-05 14:02:00` → `2021-03-05`. */
export function isoDate(text: string | undefined | null): string | undefined {
	const match = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(text ?? "");
	if (!match) return undefined;
	const [, year, month, day] = match;
	const m = Number(month);
	const d = Number(day);
	if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
	return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Every date in a cell, in the order written. */
export function allDates(text: string | undefined): string[] {
	const out: string[] = [];
	for (const match of (text ?? "").matchAll(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g)) {
		const iso = isoDate(match[0]);
		if (iso) out.push(iso);
	}
	return out;
}

export function yearOf(text: string | undefined): number | undefined {
	const match = /\d{4}/.exec(text ?? "");
	if (!match) return undefined;
	const year = Number(match[0]);
	return year >= 1000 && year <= 3000 ? year : undefined;
}

/** A positive number, or nothing. Zero is "unrated" in every export. */
export function positive(text: string | undefined): number | undefined {
	const value = Number.parseFloat((text ?? "").replace(",", "."));
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Reviews arrive with `<br/>` and the odd entity in them. */
export function plainText(html: string | undefined): string | undefined {
	if (!html) return undefined;
	const text = html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>\s*<p>/gi, "\n\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&#039;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text || undefined;
}

/** The merge key for a row that has no id of its own. */
export function titleKey(kind: MediaKind, title: string, year?: number): string {
	return `${kind}:${normalizeTitle(title)}${year ? `:${year}` : ""}`;
}

/**
 * Dates sorted, deduplicated, and split into the latest and the rest.
 *
 * The rest is what Scout calls history: earlier times through.
 */
export function splitFinishes(dates: readonly string[]): {
	finished?: string;
	history: string[];
} {
	const sorted = [...new Set(dates)].sort();
	const finished = sorted.pop();
	return { finished, history: sorted };
}

/** ISBNs out of Goodreads' `="0439023483"` wrapping and the like. */
export function cleanIsbn(text: string | undefined): string | undefined {
	const digits = (text ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
	return digits.length === 10 || digits.length === 13 ? digits : undefined;
}

/** `The Hunger Games (The Hunger Games, #1)` → `The Hunger Games`. */
export function stripSeries(title: string): string {
	const stripped = title.replace(/\s*\([^()]*#\s*[\d.]+[^()]*\)\s*$/, "").trim();
	return stripped || title.trim();
}
