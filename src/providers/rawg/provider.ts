import type {
	Detailable,
	Discoverable,
	DiscoverQuery,
	Enrichable,
	MediaProvider,
	ProviderContext,
	ProviderTraits,
	RequestContext,
	Resolvable,
	Searchable,
} from "../../core/provider";
import type { SettingDescriptor } from "../../core/settings/types";
import type { FieldSchema, MediaItem, MediaKind, MediaRef } from "../../core/types";

/**
 * RAWG (video games).
 *
 * Chosen over IGDB because it takes one free key in the query string: IGDB
 * needs a Twitch client id *and* secret traded for an app token that expires,
 * and every query is a POST of its own query language. RAWG is plain cached
 * GETs through the shared client, like every other source here.
 *
 * Its terms ask for attribution and a link back, which is in this source's
 * settings and in the default template's resources.
 */

const API = "https://api.rawg.io/api";
export const RAWG_SITE = "https://rawg.io";

interface Named {
	id?: number;
	name: string;
	slug?: string;
}

export interface RawgGame {
	id: number;
	slug?: string;
	name?: string;
	name_original?: string;
	released?: string | null;
	tba?: boolean;
	background_image?: string | null;
	rating?: number | null;
	ratings_count?: number | null;
	metacritic?: number | null;
	playtime?: number | null;
	added?: number | null;
	description_raw?: string | null;
	website?: string | null;
	genres?: Named[];
	tags?: (Named & { language?: string })[];
	platforms?: { platform: Named }[] | null;
	parent_platforms?: { platform: Named }[] | null;
	developers?: Named[];
	publishers?: Named[];
	esrb_rating?: Named | null;
}

/** RAWG serves full-size art; its CDN takes a width prefix for a thumbnail. */
function thumbnail(url: string | null | undefined): string | undefined {
	if (!url) return undefined;
	return url.replace("/media/games/", "/media/resize/420/-/games/");
}

const names = (list: readonly Named[] | null | undefined) =>
	(list ?? []).map((one) => one.name).filter(Boolean);

export function toItem(raw: RawgGame): MediaItem {
	const developers = names(raw.developers);
	const publishers = names(raw.publishers);
	const platforms = (raw.platforms ?? []).map((one) => one.platform.name);
	const year = raw.released ? Number.parseInt(raw.released.slice(0, 4), 10) : undefined;
	const title = raw.name ?? raw.name_original ?? "Untitled";

	return {
		ref: { providerId: "rawg", kind: "game", id: String(raw.id) },
		title,
		subtitle: developers[0] ?? (raw.name_original !== title ? raw.name_original : undefined),
		year: Number.isFinite(year) ? year : undefined,
		// RAWG rates out of five, and answers 0 for "nobody has yet".
		rating:
			typeof raw.rating === "number" && raw.rating > 0
				? Math.round(raw.rating * 20) / 10
				: undefined,
		ratingCount: raw.ratings_count ?? undefined,
		popularity: raw.added ?? undefined,
		imageUrl: raw.background_image ?? undefined,
		thumbnailUrl: thumbnail(raw.background_image),
		description: raw.description_raw?.trim() || undefined,
		tags: names(raw.genres),
		people: [...developers, ...publishers.filter((p) => !developers.includes(p))],
		externalUrl: `${RAWG_SITE}/games/${raw.slug ?? raw.id}`,
		releaseDate: raw.released ?? undefined,
		extra: {
			platforms,
			developers,
			publishers,
			// Hours the average player puts in, which makes a fair total for
			// progress counted in hours.
			playtime: raw.playtime && raw.playtime > 0 ? raw.playtime : undefined,
			metacritic: raw.metacritic ?? undefined,
			esrb: raw.esrb_rating?.name,
			website: raw.website || undefined,
			slug: raw.slug,
		},
	};
}

const FIELDS: FieldSchema = [
	{ name: "platforms", type: "list", description: "Platforms it was released on" },
	{ name: "developers", type: "list", description: "Developers" },
	{ name: "publishers", type: "list", description: "Publishers" },
	{ name: "playtime", type: "number", description: "Average hours played" },
	{ name: "metacritic", type: "number", description: "Metacritic score" },
	{ name: "esrb", type: "string", description: "ESRB age rating" },
	{ name: "website", type: "string", description: "Official website" },
	{ name: "slug", type: "string", description: "RAWG's name for it in URLs" },
];

/** RAWG's genres, by slug. Anything else is a genre RAWG does not have. */
const GENRE_SLUGS: Record<string, string> = {
	action: "action",
	indie: "indie",
	adventure: "adventure",
	rpg: "role-playing-games-rpg",
	"role-playing": "role-playing-games-rpg",
	"role playing": "role-playing-games-rpg",
	strategy: "strategy",
	shooter: "shooter",
	casual: "casual",
	simulation: "simulation",
	puzzle: "puzzle",
	arcade: "arcade",
	platformer: "platformer",
	racing: "racing",
	"massively multiplayer": "massively-multiplayer",
	sports: "sports",
	fighting: "fighting",
	family: "family",
	"board games": "board-games",
	educational: "educational",
	card: "card",
};

export function genreSlugs(genres: readonly string[]): string[] {
	const out: string[] = [];
	for (const genre of genres) {
		const slug = GENRE_SLUGS[genre.trim().toLowerCase()];
		if (slug && !out.includes(slug)) out.push(slug);
	}
	return out;
}

const slugOf = (name: string) =>
	name.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export class RawgProvider
	implements MediaProvider, Searchable, Detailable, Resolvable, Discoverable, Enrichable
{
	readonly id = "rawg";
	readonly name = "RAWG (games)";
	readonly kinds: readonly MediaKind[] = ["game"];
	readonly fields = FIELDS;

	constructor(private readonly ctx: ProviderContext) {}

	isConfigured(): boolean {
		return this.key().length > 0;
	}

	settingsSchema(): readonly SettingDescriptor[] {
		return [
			{
				type: "secret",
				key: "apiKeySecret",
				name: "API key",
				desc: "Free from rawg.io/apidocs. Kept in Obsidian's secret storage.",
			},
			{
				type: "info",
				key: "attribution",
				name: "Attribution",
				render: (el) => {
					el.appendText("Data from ");
					el.createEl("a", { text: "RAWG", href: RAWG_SITE });
					el.appendText(", the video game database.");
				},
			},
		];
	}

	private url(path: string, params: Record<string, string> = {}): string {
		const query = new URLSearchParams({ key: this.key(), ...params });
		return `${API}/${path}?${query.toString()}`;
	}

	async search(query: string, ctx: RequestContext): Promise<MediaItem[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];
		const response = await this.ctx.http.getJson<{ results?: RawgGame[] }>(
			this.url("games", { search: trimmed, page_size: "20", search_precise: "true" }),
			{ signal: ctx.signal, cacheTtlMs: 5 * 60 * 1000 },
		);
		return (response.results ?? []).map(toItem);
	}

	/** Takes an id or a slug — RAWG answers to both. */
	private async game(id: string, ctx: RequestContext): Promise<RawgGame> {
		return this.ctx.http.getJson<RawgGame>(this.url(`games/${encodeURIComponent(id)}`), {
			signal: ctx.signal,
			cacheTtlMs: 30 * 60 * 1000,
		});
	}

	async details(ref: MediaRef, ctx: RequestContext): Promise<MediaItem> {
		const raw = await this.game(ref.id, ctx);
		const item = toItem(raw);
		// The detail record has no platform list in some responses; keep the
		// search result's rather than lose it.
		const previous = ctx.previous?.extra.platforms;
		if (Array.isArray(previous) && (item.extra.platforms as string[]).length === 0) {
			item.extra.platforms = previous;
		}
		return item;
	}

	/** The tags (what it is about), who made it, and who put it out. */
	async traits(ref: MediaRef, ctx: RequestContext): Promise<ProviderTraits | null> {
		const raw = await this.game(ref.id, ctx);
		return {
			keywords: (raw.tags ?? [])
				.filter((tag) => !tag.language || tag.language === "eng")
				.slice(0, 12)
				.map((tag) => ({ name: tag.name, ...(tag.slug ? { id: tag.slug } : {}) })),
			directors: (raw.developers ?? []).slice(0, 3).map((one) => ({ name: one.name })),
			studios: names(raw.publishers).slice(0, 2),
			people: [],
		};
	}

	async discover(query: DiscoverQuery, ctx: RequestContext): Promise<MediaItem[]> {
		const params: Record<string, string> = {
			page_size: "20",
			page: String(Math.max(1, query.page ?? 1)),
			ordering: query.sort === "recent" ? "-released" : query.sort === "rated" ? "-rating" : "-added",
		};
		const genres = genreSlugs(query.genres ?? []);
		if (genres.length > 0) params.genres = genres.slice(0, 3).join(",");
		const tags = (query.keywords ?? []).slice(0, 3).map((one) => one.id ?? slugOf(one.name));
		if (tags.length > 0) params.tags = tags.join(",");
		// Metacritic out of a hundred, Scout asks out of ten.
		if (query.minRating !== undefined) {
			params.metacritic = `${Math.round(query.minRating * 10)},100`;
		}
		if (query.fromYear !== undefined) {
			params.dates = `${query.fromYear}-01-01,${new Date().getFullYear() + 1}-12-31`;
		}
		const response = await this.ctx.http.getJson<{ results?: RawgGame[] }>(
			this.url("games", params),
			{ signal: ctx.signal, cacheTtlMs: 12 * 60 * 60 * 1000 },
		);
		return (response.results ?? []).map(toItem);
	}

	canResolve(url: string): boolean {
		return /rawg\.io\/games\/[\w-]+/.test(url);
	}

	async resolve(url: string, ctx: RequestContext): Promise<MediaItem> {
		const match = /rawg\.io\/games\/([\w-]+)/.exec(url);
		if (!match?.[1]) throw new Error("Not a RAWG game URL");
		return toItem(await this.game(match[1], ctx));
	}

	private key(): string {
		return this.ctx.settings.secret("apiKeySecret").trim();
	}
}
