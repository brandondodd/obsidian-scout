import { emptyExtras } from "../../core/detail/types";
import type {
	Availability,
	ItemExtras,
	PersonCredit,
	ServiceTile,
	Video,
} from "../../core/detail/types";
import { formatRuntime, longDate, plural } from "../../core/format";
import type {
	EpisodeInfo,
	MediaItem,
	MediaKind,
	SeasonInfo,
} from "../../core/types";

/**
 * What the detail dialog shows for anime and manga, in one query.
 *
 * Checked live against AniList, including that `chapters` is null while a manga
 * is still releasing and that `externalLinks` carries an `icon` and a `color`.
 */

export const EXTRAS_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    id type format status season seasonYear episodes chapters volumes duration
    averageScore source bannerImage
    title { romaji english native }
    startDate { year month day }
    nextAiringEpisode { episode airingAt }
    externalLinks { site url type icon color }
    streamingEpisodes { title thumbnail url site }
    trailer { id site }
    airingSchedule(perPage: 50) { nodes { episode airingAt } }
    relations {
      edges {
        relationType
        node {
          id type format averageScore siteUrl
          title { romaji english }
          coverImage { medium large }
          startDate { year }
        }
      }
    }
    characters(perPage: 25, sort: [ROLE, RELEVANCE]) {
      edges {
        role
        node { name { full } image { medium } }
        voiceActors(language: JAPANESE, sort: [RELEVANCE]) { name { full } }
      }
    }
    staff(perPage: 8, sort: [RELEVANCE]) {
      edges { role node { name { full } image { medium } } }
    }
    studios(isMain: true) { nodes { name } }
    tags { name rank isMediaSpoiler }
  }
}`;

interface Relation {
	relationType?: string;
	node?: {
		id: number;
		type?: string;
		format?: string;
		averageScore?: number | null;
		siteUrl?: string;
		title?: { romaji?: string; english?: string | null };
		coverImage?: { medium?: string; large?: string };
		startDate?: { year?: number | null };
	};
}

export interface AniListExtras {
	id: number;
	type?: "ANIME" | "MANGA";
	format?: string | null;
	status?: string | null;
	season?: string | null;
	seasonYear?: number | null;
	episodes?: number | null;
	chapters?: number | null;
	volumes?: number | null;
	duration?: number | null;
	averageScore?: number | null;
	source?: string | null;
	bannerImage?: string | null;
	title?: { romaji?: string; english?: string | null; native?: string | null };
	startDate?: { year?: number | null; month?: number | null; day?: number | null };
	nextAiringEpisode?: { episode: number; airingAt: number } | null;
	externalLinks?: {
		site: string;
		url?: string | null;
		type?: string | null;
		icon?: string | null;
		color?: string | null;
	}[];
	streamingEpisodes?: { title?: string | null; thumbnail?: string | null }[];
	trailer?: { id?: string | null; site?: string | null } | null;
	airingSchedule?: { nodes?: { episode: number; airingAt: number }[] };
	relations?: { edges?: Relation[] };
	characters?: {
		edges?: {
			role?: string | null;
			node?: { name?: { full?: string }; image?: { medium?: string } };
			voiceActors?: { name?: { full?: string } }[];
		}[];
	};
	staff?: {
		edges?: {
			role?: string | null;
			node?: { name?: { full?: string }; image?: { medium?: string } };
		}[];
	};
	studios?: { nodes?: { name: string }[] };
	tags?: { name: string; rank?: number | null; isMediaSpoiler?: boolean }[];
}

/** `MAIN` → `Main`, `LIGHT_NOVEL` → `Light novel`. */
function words(raw: string | null | undefined): string | undefined {
	if (!raw) return undefined;
	const text = raw.replace(/_/g, " ").toLowerCase();
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** TV and OVA are initialisms, and `Tv` reads like a typo. */
function formatName(raw: string | null | undefined): string | undefined {
	if (!raw) return undefined;
	return /^(TV|OVA|ONA)$/.test(raw) ? raw : words(raw);
}

function isoFrom(seconds: number): string {
	return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function fullDate(date: AniListExtras["startDate"]): string | undefined {
	if (!date?.year || !date.month || !date.day) return undefined;
	return new Date(Date.UTC(date.year, date.month - 1, date.day, 12))
		.toISOString()
		.slice(0, 10);
}

function toLinks(raw: AniListExtras): ServiceTile[] {
	return (raw.externalLinks ?? [])
		.filter((one) => one.type === "STREAMING" && one.url)
		.map((one) => ({
			name: one.site,
			url: one.url ?? undefined,
			...(one.icon ? { logoUrl: one.icon } : {}),
			...(one.color ? { logoBackground: one.color } : {}),
		}));
}

function toAvailability(raw: AniListExtras): Availability | undefined {
	const tiles = toLinks(raw);
	if (tiles.length === 0) return undefined;
	return raw.type === "MANGA"
		? {
				title: "Where to read",
				groups: [{ id: "read", label: "Read", tiles }],
			}
		: {
				title: "Where to watch",
				groups: [{ id: "stream", label: "Stream", tiles }],
			};
}

function toPeople(raw: AniListExtras): PersonCredit[] {
	const crew: PersonCredit[] = [];
	for (const studio of raw.studios?.nodes ?? []) {
		crew.push({ name: studio.name, role: "Studio" });
	}
	for (const edge of raw.staff?.edges ?? []) {
		const name = edge.node?.name?.full;
		if (!name) continue;
		const photo = edge.node?.image?.medium;
		crew.push({
			name,
			...(edge.role ? { role: edge.role } : {}),
			...(photo ? { imageUrl: photo } : {}),
		});
	}

	const cast: PersonCredit[] = [];
	for (const edge of raw.characters?.edges ?? []) {
		const name = edge.node?.name?.full;
		if (!name) continue;
		const voice = edge.voiceActors?.[0]?.name?.full;
		const role = words(edge.role);
		const photo = edge.node?.image?.medium;
		cast.push({
			name,
			...(role ? { role } : {}),
			...(voice ? { more: `Voiced by ${voice}` } : {}),
			...(photo ? { imageUrl: photo } : {}),
		});
	}
	return [...crew.slice(0, 4), ...cast];
}

/** Relations as cards, captioned with how they relate rather than a year. */
function relatedRail(raw: AniListExtras): ItemExtras["rails"] {
	const items: MediaItem[] = [];
	const captions: Record<string, string> = {};
	for (const edge of raw.relations?.edges ?? []) {
		const node = edge.node;
		if (!node || (node.type !== "ANIME" && node.type !== "MANGA")) continue;
		const kind: MediaKind = node.type === "MANGA" ? "manga" : "anime";
		const id = String(node.id);
		const title = node.title?.english ?? node.title?.romaji ?? "Untitled";
		items.push({
			ref: { providerId: "anilist", kind, id },
			title,
			tags: [],
			people: [],
			extra: {},
			...(node.startDate?.year ? { year: node.startDate.year } : {}),
			...(node.coverImage?.large ? { imageUrl: node.coverImage.large } : {}),
			...(node.coverImage?.medium
				? { thumbnailUrl: node.coverImage.medium }
				: {}),
			...(node.siteUrl ? { externalUrl: node.siteUrl } : {}),
		});
		captions[id] = [words(edge.relationType), formatName(node.format)]
			.filter(Boolean)
			.join(" · ");
	}
	return items.length > 0
		? [{ id: "related", title: "Related", items, captions }]
		: [];
}

function toVideos(raw: AniListExtras): Video[] {
	const id = raw.trailer?.id;
	if (!id) return [];
	if (raw.trailer?.site === "youtube") {
		return [
			{
				name: "Trailer",
				url: `https://www.youtube.com/watch?v=${id}`,
				thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
			},
		];
	}
	if (raw.trailer?.site === "dailymotion") {
		return [
			{ name: "Trailer", url: `https://www.dailymotion.com/video/${id}` },
		];
	}
	return [];
}

export function toExtras(raw: AniListExtras): ItemExtras {
	const manga = raw.type === "MANGA";
	const kindPath = manga ? "manga" : "anime";
	const when =
		raw.season && raw.seasonYear
			? `${words(raw.season)} ${raw.seasonYear}`
			: undefined;

	const headerFacts: string[] = [];
	if (!manga && raw.episodes) {
		headerFacts.push(plural(raw.episodes, "episode"));
	}
	if (manga && raw.volumes) headerFacts.push(plural(raw.volumes, "volume"));

	const facts: ItemExtras["facts"] = [];
	const add = (label: string, value: string | undefined) => {
		if (value) facts.push({ label, value });
	};
	add("Format", formatName(raw.format));
	add("Source", words(raw.source));
	add("Status", words(raw.status));
	if (!manga) {
		add("Episode length", formatRuntime(raw.duration ?? undefined));
	} else {
		const started = fullDate(raw.startDate);
		add("Started", started ? longDate(started) : undefined);
		add("Chapters", raw.chapters ? String(raw.chapters) : undefined);
		add("Native title", raw.title?.native ?? undefined);
	}

	const next = raw.nextAiringEpisode?.airingAt;
	const availability = toAvailability(raw);
	const banner = raw.bannerImage;
	const native = raw.title?.native;

	return {
		...emptyExtras(),
		headerFacts,
		scores:
			typeof raw.averageScore === "number" && raw.averageScore > 0
				? [
						{
							id: "anilist",
							label: "AniList",
							value: `${Math.round(raw.averageScore)}%`,
							outOfTen: raw.averageScore / 10,
						},
					]
				: [],
		moreLabel: "Characters & more",
		peopleTitle: "Characters & staff",
		people: toPeople(raw),
		videos: toVideos(raw),
		rails: relatedRail(raw),
		facts,
		keywords: (raw.tags ?? [])
			.filter((tag) => !tag.isMediaSpoiler && (tag.rank ?? 0) >= 60)
			.slice(0, 10)
			.map((tag) => tag.name.toLowerCase()),
		links: [
			{
				label: "AniList",
				url: `https://anilist.co/${kindPath}/${raw.id}`,
			},
		],
		...(when ? { when } : {}),
		...(!manga && native ? { byline: native } : {}),
		...(banner ? { backdropUrl: banner } : {}),
		...(next ? { nextAirDate: isoFrom(next) } : {}),
		...(availability ? { availability } : {}),
		...(manga
			? {
					progress: {
						unit: "chapter" as const,
						...(raw.chapters ? { total: raw.chapters } : {}),
					},
				}
			: {}),
	};
}

/** How many episodes to list: the full run, or as far as anyone knows. */
export function episodeTotal(raw: AniListExtras): number {
	if (raw.episodes && raw.episodes > 0) return raw.episodes;
	return raw.nextAiringEpisode?.episode ?? 0;
}

/** Anime has no seasons to speak of, so the whole run is one. */
export function toSeasons(raw: AniListExtras): SeasonInfo[] {
	if (raw.type === "MANGA") return [];
	// A film is one sitting, not one episode of something.
	if (raw.format === "MOVIE") return [];
	const total = episodeTotal(raw);
	if (total === 0) return [];
	return [
		{
			number: 1,
			name: "Episodes",
			episodeCount: total,
			...(raw.startDate?.year ? { year: raw.startDate.year } : {}),
		},
	];
}

/** `Episode 3 - The Lamplighter` → the part after the number. */
function streamingTitle(raw: string | null | undefined): {
	number?: number;
	title?: string;
} {
	const match = /^Episode\s+(\d+)\s*[-–:]\s*(.+)$/i.exec(raw?.trim() ?? "");
	if (!match) return {};
	return { number: Number(match[1]), title: match[2]?.trim() };
}

export function toEpisodes(raw: AniListExtras): EpisodeInfo[] {
	const named = new Map<number, { title?: string; still?: string }>();
	for (const one of raw.streamingEpisodes ?? []) {
		const { number, title } = streamingTitle(one.title);
		if (number === undefined) continue;
		named.set(number, {
			...(title ? { title } : {}),
			...(one.thumbnail ? { still: one.thumbnail } : {}),
		});
	}
	const dates = new Map(
		(raw.airingSchedule?.nodes ?? []).map((one) => [
			one.episode,
			isoFrom(one.airingAt),
		]),
	);

	const next = raw.nextAiringEpisode?.episode;
	const out: EpisodeInfo[] = [];
	for (let number = 1; number <= episodeTotal(raw); number++) {
		const known = named.get(number);
		const airDate = dates.get(number);
		out.push({
			season: 1,
			number,
			title: known?.title ?? `Episode ${number}`,
			...(airDate ? { airDate } : {}),
			...(raw.duration ? { runtime: raw.duration } : {}),
			...(known?.still ? { stillUrl: known.still } : {}),
			...(next !== undefined && number >= next ? { upcoming: true } : {}),
		});
	}
	return out;
}
