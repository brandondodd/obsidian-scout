import type { TitleScores } from "../../core/detail/types";
import type { HttpClient } from "../../core/http";
import type { MediaRef } from "../../core/types";

/**
 * MDBList: Rotten Tomatoes, IMDb, Metacritic, Letterboxd and Trakt scores for
 * one title.
 *
 * Not a media source. It has no search here and makes no notes; it only adds
 * score boxes to a dialog you opened. Contacted only with your own key, and only
 * for that title's TMDB id, so with no key this is never called at all.
 *
 * Verified against MDBList's own API blueprint and OpenAPI schema
 * (api.mdblist.com/schema/): `GET /tmdb/{movie|show}/{id}?apikey=…`, with
 * `ratings: [{source, value, score, votes, url}]`. Sources with nothing to say
 * are present with a null `value`, not absent. The audience score's source is
 * `popcorn`; `tomatoesaudience` is what older clients expect, so both are read.
 */

const API = "https://api.mdblist.com";

/** A day: scores move slowly, and the free key allows 1,000 requests a day. */
const CACHE_MS = 24 * 60 * 60 * 1000;

export interface MdbListRating {
	source?: string;
	value?: number | null;
	score?: number | null;
	votes?: number | null;
}

export interface MdbListResponse {
	ratings?: MdbListRating[];
}

/** Zero is a source with no votes yet, not a score of nothing. */
const usable = (value: number | null | undefined): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;

export function toTitleScores(raw: MdbListResponse): TitleScores {
	const find = (sources: readonly string[]) =>
		raw.ratings?.find(
			(one) => sources.includes(one.source ?? "") && usable(one.value) !== undefined,
		);
	const sources = {
		rtCritics: ["tomatoes"],
		rtAudience: ["popcorn", "tomatoesaudience"],
		imdb: ["imdb"],
		metacritic: ["metacritic"],
		tmdb: ["tmdb"],
		letterboxd: ["letterboxd"],
		trakt: ["trakt"],
	} as const;
	const out: TitleScores = {};
	const votes: NonNullable<TitleScores["votes"]> = {};
	for (const key of Object.keys(sources) as (keyof typeof sources)[]) {
		const found = find(sources[key]);
		let value = usable(found?.value);
		if (value === undefined) continue;
		// TMDB is out of ten on TMDB and out of a hundred on some MDBList
		// answers; either way Scout keeps it out of ten.
		if (key === "tmdb" && value > 10) value /= 10;
		// Letterboxd (stars) and Trakt (a percentage) are kept out of ten too.
		// `score` is MDBList's own 0–100 for every source, so it is the one to
		// trust; the native value is only the fallback.
		if (key === "letterboxd" || key === "trakt") {
			const score = usable(found?.score);
			if (score !== undefined) value = score / 10;
			else if (key === "letterboxd" && value <= 5) value *= 2;
			else if (key === "trakt" && value > 10) value /= 10;
		}
		out[key] = value;
		const count = usable(found?.votes);
		if (count !== undefined) votes[key] = count;
	}
	return Object.keys(votes).length > 0 ? { ...out, votes } : out;
}

export class MdbListClient {
	constructor(
		private readonly http: HttpClient,
		private readonly apiKey: () => string,
	) {}

	isConfigured(): boolean {
		return this.apiKey().length > 0;
	}

	/** Null when there is no key, or the title is not one MDBList covers. */
	async titleScores(
		ref: MediaRef,
		signal: AbortSignal,
	): Promise<TitleScores | null> {
		const key = this.apiKey();
		if (!key || ref.providerId !== "tmdb") return null;
		if (ref.kind !== "movie" && ref.kind !== "tv") return null;

		const type = ref.kind === "tv" ? "show" : "movie";
		const raw = await this.http.getJson<MdbListResponse>(
			`${API}/tmdb/${type}/${encodeURIComponent(ref.id)}?apikey=${encodeURIComponent(key)}`,
			// A spent daily limit answers 429 until midnight UTC, so waiting a few
			// seconds and asking again is only a way of spending more.
			{ signal, cacheTtlMs: CACHE_MS, retries: 0 },
		);
		return toTitleScores(raw);
	}
}
