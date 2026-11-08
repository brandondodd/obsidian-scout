import type { HttpClient } from "../../core/http";

/**
 * OMDb: IMDb's score for each episode of a season.
 *
 * Not a media source either. One request per season, with your own key, and only
 * when you open a season or the ratings grid. No key, no request, and IMDb drops
 * out of the "Scores from" switch.
 *
 * `?i=tt…&Season=n` and its `Episodes` list are from OMDb's changelog and from
 * long-standing use. They have not been exercised against a real key here.
 */

const API = "https://www.omdbapi.com/";

const CACHE_MS = 24 * 60 * 60 * 1000;

export interface OmdbSeason {
	Response?: string;
	Episodes?: { Episode?: string; imdbRating?: string }[];
}

/** Episode number to score. `N/A` is an episode nobody has rated. */
export function toEpisodeScores(raw: OmdbSeason): Map<number, number> {
	const out = new Map<number, number>();
	if (raw.Response === "False") return out;
	for (const one of raw.Episodes ?? []) {
		const episode = Number.parseInt(one.Episode ?? "", 10);
		const score = Number.parseFloat(one.imdbRating ?? "");
		if (Number.isFinite(episode) && Number.isFinite(score) && score > 0) {
			out.set(episode, score);
		}
	}
	return out;
}

export class OmdbClient {
	constructor(
		private readonly http: HttpClient,
		private readonly apiKey: () => string,
	) {}

	isConfigured(): boolean {
		return this.apiKey().length > 0;
	}

	async seasonScores(
		imdbId: string,
		season: number,
		signal: AbortSignal,
	): Promise<Map<number, number>> {
		const key = this.apiKey();
		if (!key) return new Map();
		const params = new URLSearchParams({
			apikey: key,
			i: imdbId,
			Season: String(season),
		});
		const raw = await this.http.getJson<OmdbSeason>(
			`${API}?${params.toString()}`,
			{ signal, cacheTtlMs: CACHE_MS, retries: 0 },
		);
		return toEpisodeScores(raw);
	}
}
