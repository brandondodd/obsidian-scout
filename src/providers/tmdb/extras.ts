import { emptyExtras } from "../../core/detail/types";
import type {
	Availability,
	ItemExtras,
	PersonCredit,
	ServiceGroup,
	ServiceGroupId,
	ServiceTile,
	Video,
} from "../../core/detail/types";
import {
	formatRuntime,
	languageName,
	oneDecimal,
	plural,
} from "../../core/format";
import {
	ageRatingFact,
	pickAgeRating,
	type RegionalRating,
} from "../../core/region";
import type { MediaKind } from "../../core/types";

/**
 * Everything TMDB says about a title beyond the record a note is made from.
 *
 * One request with `append_to_response`. Pure mapping lives here so it can be
 * tested against a recorded response, and the provider only does the fetching.
 *
 * Availability comes from JustWatch by way of TMDB's watch-provider data, and
 * TMDB's terms require that credit wherever it is shown. `justWatch: true` is
 * what puts it on screen.
 */

const IMAGE = "https://image.tmdb.org/t/p";

/** What `extrasUrl` appends. `credits` and `release_dates` for films only. */
export const MOVIE_APPEND =
	"credits,keywords,videos,external_ids,release_dates,watch/providers";
/** The TV equivalents. `aggregate_credits` totals a person across every season. */
export const TV_APPEND =
	"aggregate_credits,keywords,videos,external_ids,content_ratings,watch/providers";

interface WatchProvider {
	provider_name: string;
	logo_path?: string | null;
	display_priority?: number;
}

interface WatchRegion {
	link?: string;
	flatrate?: WatchProvider[];
	free?: WatchProvider[];
	ads?: WatchProvider[];
	rent?: WatchProvider[];
	buy?: WatchProvider[];
}

interface CastCredit {
	name: string;
	character?: string;
	profile_path?: string | null;
	order?: number;
	roles?: { character?: string; episode_count?: number }[];
	total_episode_count?: number;
}

interface CrewCredit {
	id?: number;
	name: string;
	job?: string;
	profile_path?: string | null;
	jobs?: { job?: string; episode_count?: number }[];
	total_episode_count?: number;
}

export interface TmdbExtrasResponse {
	id: number;
	backdrop_path?: string | null;
	tagline?: string;
	status?: string;
	runtime?: number | null;
	episode_run_time?: number[];
	vote_average?: number;
	vote_count?: number;
	number_of_seasons?: number;
	number_of_episodes?: number;
	original_language?: string;
	imdb_id?: string | null;
	homepage?: string | null;
	created_by?: { name: string; profile_path?: string | null }[];
	next_episode_to_air?: { air_date?: string | null } | null;
	credits?: { cast?: CastCredit[]; crew?: CrewCredit[] };
	aggregate_credits?: { cast?: CastCredit[]; crew?: CrewCredit[] };
	keywords?: {
		keywords?: { name: string }[];
		results?: { name: string }[];
	};
	videos?: {
		results?: {
			key?: string;
			name?: string;
			site?: string;
			type?: string;
			official?: boolean;
		}[];
	};
	external_ids?: { imdb_id?: string | null };
	release_dates?: {
		results?: {
			iso_3166_1: string;
			release_dates?: { certification?: string; type?: number }[];
		}[];
	};
	content_ratings?: { results?: { iso_3166_1: string; rating?: string }[] };
	"watch/providers"?: { results?: Record<string, WatchRegion> };
}

const image = (path: string | null | undefined, size: string) =>
	path ? `${IMAGE}/${size}${path}` : undefined;

/** Theatrical first: a home release can carry a different certificate. */
function movieRatings(raw: TmdbExtrasResponse): RegionalRating[] {
	return (raw.release_dates?.results ?? []).map((country) => {
		const dated = (country.release_dates ?? []).filter((one) =>
			one.certification?.trim(),
		);
		const theatrical = dated.find((one) => one.type === 3);
		return {
			region: country.iso_3166_1,
			label: (theatrical ?? dated[0])?.certification?.trim() ?? "",
		};
	});
}

function tvRatings(raw: TmdbExtrasResponse): RegionalRating[] {
	return (raw.content_ratings?.results ?? []).map((country) => ({
		region: country.iso_3166_1,
		label: country.rating?.trim() ?? "",
	}));
}

/** Best offer first, because that is the order the bar under the poster reads. */
const GROUPS: readonly [ServiceGroupId, keyof WatchRegion, string][] = [
	["stream", "flatrate", "Stream"],
	["free", "free", "Free"],
	["ads", "ads", "With ads"],
	["rent", "rent", "Rent"],
	["buy", "buy", "Buy"],
];

export function toAvailability(
	raw: TmdbExtrasResponse,
	region: string,
): Availability | undefined {
	const here = raw["watch/providers"]?.results?.[region];
	if (!here) return undefined;

	const groups: ServiceGroup[] = [];
	for (const [id, key, label] of GROUPS) {
		const list = here[key];
		if (!Array.isArray(list) || list.length === 0) continue;
		const tiles: ServiceTile[] = [...list]
			.sort(
				(a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99),
			)
			.map((one) => ({
				name: one.provider_name,
				...(one.logo_path ? { logoUrl: image(one.logo_path, "w92") } : {}),
				...(here.link ? { url: here.link } : {}),
			}));
		groups.push({ id, label, tiles });
	}
	if (groups.length === 0) return undefined;
	return {
		title: "Where to watch",
		groups,
		justWatch: true,
		...(here.link ? { link: here.link } : {}),
	};
}

/** Jobs worth a place beside the cast, most telling first. */
const CREW_JOBS: readonly string[] = [
	"Creator",
	"Director",
	"Writer",
	"Screenplay",
	"Story",
	"Novel",
	"Original Music Composer",
	"Director of Photography",
	"Editor",
];
const MAX_CREW = 4;

const jobRank = (job: string) => {
	const at = CREW_JOBS.indexOf(job);
	return at === -1 ? CREW_JOBS.length : at;
};

/** `Director, writer` — one person, one entry, however many jobs they did. */
function jobLine(jobs: readonly string[]): string {
	const sorted = [...new Set(jobs)].sort((a, b) => jobRank(a) - jobRank(b));
	return sorted
		.map((job, at) => (at === 0 ? job : job.toLowerCase()))
		.join(", ");
}

function episodesLine(count: number | undefined): string | undefined {
	return count && count > 0 ? plural(count, "episode") : undefined;
}

function crewCredits(raw: TmdbExtrasResponse): PersonCredit[] {
	const byName = new Map<
		string,
		{ jobs: string[]; photo?: string | null; episodes?: number }
	>();
	const note = (
		name: string,
		job: string,
		photo: string | null | undefined,
		episodes?: number,
	) => {
		if (!CREW_JOBS.includes(job)) return;
		const seen = byName.get(name) ?? { jobs: [], photo, episodes };
		seen.jobs.push(job);
		seen.photo = seen.photo ?? photo;
		seen.episodes = Math.max(seen.episodes ?? 0, episodes ?? 0) || undefined;
		byName.set(name, seen);
	};

	for (const one of raw.created_by ?? []) {
		note(one.name, "Creator", one.profile_path);
	}
	for (const one of raw.credits?.crew ?? []) {
		note(one.name, one.job ?? "", one.profile_path);
	}
	for (const one of raw.aggregate_credits?.crew ?? []) {
		for (const job of one.jobs ?? []) {
			note(one.name, job.job ?? "", one.profile_path, job.episode_count);
		}
	}

	return [...byName.entries()]
		.sort(
			([, a], [, b]) =>
				Math.min(...a.jobs.map(jobRank)) - Math.min(...b.jobs.map(jobRank)) ||
				(b.episodes ?? 0) - (a.episodes ?? 0),
		)
		.slice(0, MAX_CREW)
		.map(([name, one]) => {
			const more = one.jobs.includes("Creator")
				? undefined
				: episodesLine(one.episodes);
			const photo = image(one.photo, "w185");
			return {
				name,
				role: jobLine(one.jobs),
				...(more ? { more } : {}),
				...(photo ? { imageUrl: photo } : {}),
			};
		});
}

function castCredits(raw: TmdbExtrasResponse): PersonCredit[] {
	const list = raw.aggregate_credits?.cast ?? raw.credits?.cast ?? [];
	return list.map((one) => {
		const role = one.roles?.[0]?.character ?? one.character;
		const more = episodesLine(one.total_episode_count);
		const photo = image(one.profile_path, "w185");
		return {
			name: one.name,
			...(role ? { role } : {}),
			...(more ? { more } : {}),
			...(photo ? { imageUrl: photo } : {}),
		};
	});
}

/** Official trailers first, then anything else YouTube has for it. */
function toVideos(raw: TmdbExtrasResponse): Video[] {
	const rank = (type: string | undefined, official: boolean | undefined) =>
		(type === "Trailer" ? 0 : type === "Teaser" ? 1 : 2) + (official ? 0 : 3);
	return (raw.videos?.results ?? [])
		.filter((one) => one.site === "YouTube" && one.key)
		.sort((a, b) => rank(a.type, a.official) - rank(b.type, b.official))
		.map((one) => ({
			name: one.name ?? "Trailer",
			url: `https://www.youtube.com/watch?v=${one.key}`,
			thumbnailUrl: `https://i.ytimg.com/vi/${one.key}/hqdefault.jpg`,
		}));
}

export function toExtras(
	raw: TmdbExtrasResponse,
	kind: MediaKind,
	region: string,
): ItemExtras {
	const tv = kind === "tv";
	const ageRating = pickAgeRating(
		tv ? tvRatings(raw) : movieRatings(raw),
		region,
	);
	const imdbId =
		raw.external_ids?.imdb_id || raw.imdb_id || undefined;
	const runtime = raw.runtime ?? raw.episode_run_time?.[0] ?? undefined;
	const seasons = raw.number_of_seasons ?? 0;
	const crew = crewCredits(raw);
	const cast = castCredits(raw);
	const credited = crew.filter((one) =>
		tv ? one.role?.startsWith("Creator") : one.role?.startsWith("Director"),
	);
	const language = languageName(raw.original_language);
	const runtimeLine = formatRuntime(runtime ?? undefined);
	const availability = toAvailability(raw, region);

	const links: ItemExtras["links"] = [
		{
			label: "TMDB",
			url: `https://www.themoviedb.org/${tv ? "tv" : "movie"}/${raw.id}`,
		},
	];
	if (imdbId) {
		links.push(
			{ label: "IMDb", url: `https://www.imdb.com/title/${imdbId}/` },
			{
				label: "Parents guide",
				url: `https://www.imdb.com/title/${imdbId}/parentalguide`,
			},
		);
	}

	const facts: ItemExtras["facts"] = [];
	if (raw.status) facts.push({ label: "Status", value: raw.status });
	if (tv && raw.number_of_episodes) {
		facts.push({ label: "Episodes", value: String(raw.number_of_episodes) });
	}
	if (!tv && runtimeLine) facts.push({ label: "Runtime", value: runtimeLine });
	if (language) facts.push({ label: "Original language", value: language });
	if (ageRating) {
		facts.push({ label: "Age rating", value: ageRatingFact(ageRating) });
	}

	const backdrop = image(raw.backdrop_path, "w780");
	const tagline = raw.tagline?.trim();
	const next = raw.next_episode_to_air?.air_date;

	return {
		...emptyExtras(),
		headerFacts: tv
			? seasons > 0
				? [plural(seasons, "season")]
				: []
			: runtimeLine
				? [runtimeLine]
				: [],
		// Zero is nobody having voted, not a verdict.
		scores:
			typeof raw.vote_average === "number" && raw.vote_average > 0
				? [
						{
							id: "tmdb",
							label: "TMDB",
							value: oneDecimal(raw.vote_average),
							outOfTen: raw.vote_average,
							...(raw.vote_count ? { votes: raw.vote_count } : {}),
						},
					]
				: [],
		people: [...crew, ...cast],
		videos: toVideos(raw),
		facts,
		keywords: (raw.keywords?.keywords ?? raw.keywords?.results ?? [])
			.map((one) => one.name)
			.slice(0, 12),
		links,
		...(backdrop ? { backdropUrl: backdrop } : {}),
		...(tagline ? { tagline } : {}),
		...(ageRating ? { ageRating } : {}),
		...(imdbId ? { imdbId } : {}),
		...(next ? { nextAirDate: next } : {}),
		...(availability ? { availability } : {}),
		...(credited.length > 0
			? {
					credit: {
						prefix: tv ? "Created by" : "Directed by",
						names: credited.map((one) => one.name),
					},
				}
			: {}),
	};
}
