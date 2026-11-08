import type { HttpClient } from "../../core/http";
import type { Reading } from "../../core/scout-score";

/**
 * Open Library's star average and how many gave it, for many books at once.
 *
 * A note keeps only the average, and Open Library's are often a handful of
 * ratings: one book with eleven sat above Project Hail Mary. The count is what
 * lets Scout believe a big sample and doubt a small one. One search request
 * covers up to fifty works, and asks for nothing but the two numbers.
 */

const API = "https://openlibrary.org";
export const RATINGS_PER_REQUEST = 50;

interface RatingsDoc {
	key?: string;
	ratings_average?: number;
	ratings_count?: number;
}

/** Work id (`OL123W`) to its reading; a book nobody has rated is absent. */
export function toBookReadings(docs: readonly RatingsDoc[]): Map<string, Reading> {
	const out = new Map<string, Reading>();
	for (const doc of docs) {
		const id = doc.key?.replace(/^\/works\//, "");
		const average = doc.ratings_average;
		const count = doc.ratings_count;
		if (!id || typeof average !== "number" || !(average > 0)) continue;
		if (typeof count !== "number" || !(count > 0)) continue;
		out.set(id, { source: "openlibrary", value: average * 2, votes: count });
	}
	return out;
}

export async function bookReadings(
	http: HttpClient,
	ids: readonly string[],
	signal?: AbortSignal,
): Promise<Map<string, Reading>> {
	const works = ids.filter((id) => /^OL\d+W$/.test(id));
	if (works.length === 0) return new Map();
	const q = `key:(${works.map((id) => `/works/${id}`).join(" OR ")})`;
	const response = await http.getJson<{ docs?: RatingsDoc[] }>(
		`${API}/search.json?q=${encodeURIComponent(q)}&limit=${works.length}&fields=key,ratings_average,ratings_count`,
		{ signal },
	);
	return toBookReadings(response.docs ?? []);
}
