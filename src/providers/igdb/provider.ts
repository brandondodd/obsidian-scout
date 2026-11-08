import { canonicalGenres, sourceGenresFor } from "../../core/genres/genres";
import { HttpError } from "../../core/http";
import type { ItemExtras } from "../../core/detail/types";
import type {
	Detailable,
	Discoverable,
	DiscoverQuery,
	Enrichable,
	Extended,
	MediaProvider,
	ProviderContext,
	ProviderTraits,
	RequestContext,
	Resolvable,
	Searchable,
} from "../../core/provider";
import type { SettingDescriptor } from "../../core/settings/types";
import type { FieldSchema, MediaItem, MediaKind, MediaRef } from "../../core/types";
import { toExtras, type IgdbTimeToBeat } from "./extras";

/**
 * IGDB (video games), Twitch's game database.
 *
 * Replaces RAWG, whose API stopped answering. IGDB wants a Twitch app's client
 * id and secret, traded for an app token that lasts about two months; the token
 * is kept in memory and fetched again when it runs out or is refused. Every
 * query is a POST of IGDB's own query language (Apicalypse) as plain text.
 *
 * Backloggd has no public API of its own — it is built on IGDB, and its game
 * links carry IGDB's slugs — so its links resolve here too.
 */

const API = "https://api.igdb.com/v4";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
export const IGDB_SITE = "https://www.igdb.com";

interface Named {
	id?: number;
	name: string;
	slug?: string;
}

export interface IgdbImage {
	image_id?: string;
}

export interface IgdbCompany {
	company?: Named;
	developer?: boolean;
	publisher?: boolean;
}

export interface IgdbWebsite {
	url?: string;
	/** Older field, still answered; `type` replaced it. 1 is the official site. */
	category?: number;
	type?: number | { id?: number };
}

export interface IgdbGame {
	id: number;
	slug?: string;
	name?: string;
	summary?: string | null;
	storyline?: string | null;
	url?: string;
	first_release_date?: number | null;
	cover?: IgdbImage | null;
	artworks?: IgdbImage[];
	screenshots?: IgdbImage[];
	videos?: { name?: string; video_id?: string }[];
	websites?: IgdbWebsite[];
	genres?: Named[];
	themes?: Named[];
	keywords?: Named[];
	platforms?: Named[];
	involved_companies?: IgdbCompany[];
	/** IGDB's users and critics together, out of a hundred. */
	total_rating?: number | null;
	total_rating_count?: number | null;
	/** Critics only, out of a hundred. */
	aggregated_rating?: number | null;
	aggregated_rating_count?: number | null;
	/** IGDB's users only, out of a hundred. */
	rating?: number | null;
	rating_count?: number | null;
	dlcs?: IgdbGame[];
	expansions?: IgdbGame[];
	collections?: { name?: string; games?: IgdbGame[] }[];
}

/** IGDB's image CDN takes the size in the path. */
export function image(
	img: IgdbImage | null | undefined,
	size: "cover_small" | "cover_big" | "screenshot_big" | "1080p" | "720p",
): string | undefined {
	return img?.image_id
		? `https://images.igdb.com/igdb/image/upload/t_${size}/${img.image_id}.jpg`
		: undefined;
}

const names = (list: readonly Named[] | null | undefined) =>
	(list ?? []).map((one) => one.name).filter(Boolean);

export function makers(raw: IgdbGame): { developers: string[]; publishers: string[] } {
	const pick = (role: "developer" | "publisher") =>
		(raw.involved_companies ?? [])
			.filter((one) => one[role] && one.company?.name)
			.map((one) => one.company?.name as string);
	return { developers: pick("developer"), publishers: pick("publisher") };
}

/** A Unix timestamp in seconds, as the calendar date it falls on. */
export function releaseDate(raw: IgdbGame): string | undefined {
	if (typeof raw.first_release_date !== "number") return undefined;
	return new Date(raw.first_release_date * 1000).toISOString().slice(0, 10);
}

export const pageUrl = (raw: IgdbGame) =>
	raw.url ?? `${IGDB_SITE}/games/${raw.slug ?? raw.id}`;

export function toItem(raw: IgdbGame): MediaItem {
	const { developers, publishers } = makers(raw);
	const released = releaseDate(raw);
	const year = released ? Number.parseInt(released.slice(0, 4), 10) : undefined;
	const official = (raw.websites ?? []).find(isOfficial)?.url;

	return {
		ref: { providerId: "igdb", kind: "game", id: String(raw.id) },
		title: raw.name ?? "Untitled",
		subtitle: developers[0],
		year: Number.isFinite(year) ? year : undefined,
		rating:
			typeof raw.total_rating === "number" && raw.total_rating > 0
				? Math.round(raw.total_rating) / 10
				: undefined,
		ratingCount: raw.total_rating_count ?? undefined,
		popularity: raw.total_rating_count ?? undefined,
		imageUrl: image(raw.cover, "cover_big"),
		thumbnailUrl: image(raw.cover, "cover_big"),
		description: raw.summary?.trim() || undefined,
		// Themes carry Horror, Survival, Stealth, and 4X, which Scout counts as
		// game genres; the rest of them simply match nothing.
		tags: canonicalGenres("game", [...names(raw.genres), ...names(raw.themes)]),
		people: [...developers, ...publishers.filter((p) => !developers.includes(p))],
		externalUrl: pageUrl(raw),
		releaseDate: released,
		extra: {
			platforms: names(raw.platforms),
			developers,
			publishers,
			// Hours to beat, played normally — a fair total for progress counted
			// in hours. IGDB keeps it apart, so only `details` fills it in; the
			// key is here so templates asking for it never read as unknown.
			playtime: undefined,
			website: official,
			slug: raw.slug,
		},
	};
}

export function isOfficial(site: IgdbWebsite): boolean {
	const type = typeof site.type === "object" ? site.type?.id : site.type;
	return (type ?? site.category) === 1;
}

const FIELDS: FieldSchema = [
	{ name: "platforms", type: "list", description: "Platforms it was released on" },
	{ name: "developers", type: "list", description: "Developers" },
	{ name: "publishers", type: "list", description: "Publishers" },
	{ name: "playtime", type: "number", description: "Hours to beat, played normally" },
	{ name: "website", type: "string", description: "Official website" },
	{ name: "slug", type: "string", description: "IGDB's name for it in URLs" },
];

/** What a card needs, under a prefix for expanded relations (`dlcs.`). */
export function cardFields(prefix = ""): string {
	return [
		"name",
		"slug",
		"url",
		"summary",
		"first_release_date",
		"cover.image_id",
		"total_rating",
		"total_rating_count",
		"genres.name",
		"themes.name",
		"platforms.name",
		"involved_companies.company.name",
		"involved_companies.developer",
		"involved_companies.publisher",
	]
		.map((field) => prefix + field)
		.join(",");
}

const DETAIL_FIELDS = [
	cardFields(),
	"aggregated_rating",
	"aggregated_rating_count",
	"rating",
	"rating_count",
	"storyline",
	"keywords.name",
	"themes.id",
	"websites.url",
	"websites.category",
	"websites.type",
	"artworks.image_id",
	"screenshots.image_id",
	"videos.name",
	"videos.video_id",
	cardFields("dlcs."),
	cardFields("expansions."),
	"collections.name",
	cardFields("collections.games."),
].join(",");

/**
 * IGDB's genres and the themes Scout reads as genres, by id. IGDB has kept
 * these ids since it began; a new one only means it is not offered here.
 */
const GENRES: Record<string, number> = {
	"Point-and-click": 2,
	Fighting: 4,
	Shooter: 5,
	Music: 7,
	Platform: 8,
	Puzzle: 9,
	Racing: 10,
	"Real Time Strategy (RTS)": 11,
	"Role-playing (RPG)": 12,
	Simulator: 13,
	Sport: 14,
	Strategy: 15,
	"Turn-based strategy (TBS)": 16,
	"Hack and slash/Beat 'em up": 25,
	Adventure: 31,
	Indie: 32,
	Arcade: 33,
	"Visual Novel": 34,
	"Card & Board Game": 35,
};

const THEMES: Record<string, number> = {
	Action: 1,
	Horror: 19,
	Survival: 21,
	Stealth: 23,
	Educational: 34,
	Party: 40,
	"4X (explore, expand, exploit, and exterminate)": 41,
};

/** IGDB's genre and theme ids for Scout's genre names. */
export function genreFilter(wanted: readonly string[]): { genres: number[]; themes: number[] } {
	const pick = (table: Record<string, number>) =>
		sourceGenresFor("game", wanted, Object.keys(table))
			.map((name) => table[name])
			.filter((id): id is number => typeof id === "number");
	return { genres: pick(GENRES), themes: pick(THEMES) };
}

/** Text inside an Apicalypse string literal. */
const quoted = (text: string) => `"${text.replace(/["\\]/g, " ").trim()}"`;

/** Keyword ids are plain numbers; themes are `theme:` ids, so both fit one list. */
const THEME = "theme:";

export class IgdbProvider
	implements
		MediaProvider,
		Searchable,
		Detailable,
		Extended,
		Resolvable,
		Discoverable,
		Enrichable
{
	readonly id = "igdb";
	readonly name = "IGDB (games)";
	readonly kinds: readonly MediaKind[] = ["game"];
	readonly fields = FIELDS;

	private token: { value: string; expiresAt: number } | null = null;
	private pendingToken: Promise<string> | null = null;

	constructor(private readonly ctx: ProviderContext) {}

	isConfigured(): boolean {
		return this.clientId().length > 0 && this.clientSecret().length > 0;
	}

	settingsSchema(): readonly SettingDescriptor[] {
		return [
			{
				type: "text",
				key: "clientId",
				name: "Client ID",
				desc: "From a free app at dev.twitch.tv/console. Use http://localhost as its redirect URL.",
				default: "",
				placeholder: "Twitch client ID",
			},
			{
				type: "secret",
				key: "clientSecretSecret",
				name: "Client secret",
				desc: "The same app's secret. Kept in Obsidian's secret storage.",
			},
			{
				type: "info",
				key: "attribution",
				name: "Attribution",
				render: (el) => {
					el.appendText("Data from ");
					el.createEl("a", { text: "IGDB", href: IGDB_SITE });
					el.appendText(", by Twitch.");
				},
			},
		];
	}

	/** One Apicalypse query against one endpoint. */
	async query<T>(
		endpoint: string,
		body: string,
		ctx: RequestContext,
		cacheTtlMs: number,
	): Promise<T> {
		const send = async () =>
			this.ctx.http.postText<T>(`${API}/${endpoint}`, body, {
				signal: ctx.signal,
				cacheTtlMs,
				headers: {
					"Client-ID": this.clientId(),
					Authorization: `Bearer ${await this.accessToken(ctx)}`,
				},
			});
		try {
			return await send();
		} catch (err) {
			// A token Twitch has since revoked: fetch a fresh one, once.
			if (!(err instanceof HttpError) || err.status !== 401) throw err;
			this.token = null;
			return send();
		}
	}

	private async accessToken(ctx: RequestContext): Promise<string> {
		if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
		// Requests made while one is already being fetched share it.
		this.pendingToken ??= this.fetchToken(ctx).finally(() => {
			this.pendingToken = null;
		});
		return this.pendingToken;
	}

	private async fetchToken(ctx: RequestContext): Promise<string> {
		const answer = await this.ctx.http.postForm<{
			access_token?: string;
			expires_in?: number;
		}>(
			TOKEN_URL,
			{
				client_id: this.clientId(),
				client_secret: this.clientSecret(),
				grant_type: "client_credentials",
			},
			{ signal: ctx.signal, retries: 1 },
		);
		if (!answer.access_token) throw new Error("Twitch did not issue an IGDB token");
		// A minute early, so a request is never sent with a token about to lapse.
		const lifetimeMs = Math.max(0, (answer.expires_in ?? 3600) - 60) * 1000;
		this.token = { value: answer.access_token, expiresAt: Date.now() + lifetimeMs };
		return answer.access_token;
	}

	async search(query: string, ctx: RequestContext): Promise<MediaItem[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];
		const games = await this.query<IgdbGame[]>(
			"games",
			`search ${quoted(trimmed)}; fields ${cardFields()}; limit 20;`,
			ctx,
			5 * 60 * 1000,
		);
		return games.map(toItem);
	}

	private async game(where: string, ctx: RequestContext): Promise<IgdbGame> {
		const [found] = await this.query<IgdbGame[]>(
			"games",
			`fields ${DETAIL_FIELDS}; where ${where}; limit 1;`,
			ctx,
			30 * 60 * 1000,
		);
		if (!found) throw new Error("IGDB has no such game");
		return found;
	}

	private byId(ref: MediaRef, ctx: RequestContext): Promise<IgdbGame> {
		const id = Number.parseInt(ref.id, 10);
		if (!Number.isFinite(id)) throw new Error(`Not an IGDB id: ${ref.id}`);
		return this.game(`id = ${id}`, ctx);
	}

	/** How long it takes to beat, which IGDB keeps apart from the game. */
	private async timeToBeat(id: number, ctx: RequestContext): Promise<IgdbTimeToBeat | null> {
		try {
			const [found] = await this.query<IgdbTimeToBeat[]>(
				"game_time_to_beats",
				`fields hastily,normally,completely; where game_id = ${id}; limit 1;`,
				ctx,
				24 * 60 * 60 * 1000,
			);
			return found ?? null;
		} catch (err) {
			if (ctx.signal.aborted) throw err;
			return null;
		}
	}

	async details(ref: MediaRef, ctx: RequestContext): Promise<MediaItem> {
		const raw = await this.byId(ref, ctx);
		const item = toItem(raw);
		const hours = toHours((await this.timeToBeat(raw.id, ctx))?.normally);
		if (hours) item.extra.playtime = hours;
		return item;
	}

	/** Screenshots, trailers, DLC, series, and store links — all in the game's own record. */
	async extras(ref: MediaRef, ctx: RequestContext): Promise<ItemExtras> {
		const game = await this.byId(ref, ctx);
		return toExtras({ game, timeToBeat: await this.timeToBeat(game.id, ctx) });
	}

	/** The themes and keywords (what it is about), who made it, and who put it out. */
	async traits(ref: MediaRef, ctx: RequestContext): Promise<ProviderTraits | null> {
		const raw = await this.byId(ref, ctx);
		const { developers, publishers } = makers(raw);
		const themes = (raw.themes ?? [])
			.filter((one) => one.id !== undefined)
			.map((one) => ({ name: one.name, id: `${THEME}${one.id}` }));
		const keywords = (raw.keywords ?? []).map((one) => ({
			name: one.name,
			...(one.id !== undefined ? { id: String(one.id) } : {}),
		}));
		return {
			keywords: [...themes, ...keywords].slice(0, 12),
			directors: developers.slice(0, 3).map((name) => ({ name })),
			studios: publishers.slice(0, 2),
			people: [],
		};
	}

	async discover(query: DiscoverQuery, ctx: RequestContext): Promise<MediaItem[]> {
		const where: string[] = ["version_parent = null"];
		const { genres, themes } = genreFilter(query.genres ?? []);
		const keywordIds: number[] = [];
		for (const one of (query.keywords ?? []).slice(0, 5)) {
			if (!one.id) continue;
			if (one.id.startsWith(THEME)) themes.push(Number(one.id.slice(THEME.length)));
			else keywordIds.push(Number(one.id));
		}
		const ids = (list: number[]) => [...new Set(list.filter(Number.isFinite))].join(",");
		if (genres.length > 0) where.push(`genres = (${ids(genres.slice(0, 3))})`);
		if (themes.length > 0) where.push(`themes = (${ids(themes)})`);
		if (keywordIds.length > 0) where.push(`keywords = (${ids(keywordIds)})`);
		if (query.minRating !== undefined) {
			where.push(`total_rating >= ${Math.round(query.minRating * 10)}`);
		}
		if (query.fromYear !== undefined) {
			where.push(`first_release_date >= ${Date.UTC(query.fromYear, 0, 1) / 1000}`);
		}
		let sort = "total_rating_count desc";
		if (query.sort === "recent") {
			sort = "first_release_date desc";
			// Not the games announced for years from now.
			where.push(`first_release_date <= ${Math.floor(Date.now() / 1000)}`);
		} else if (query.sort === "rated") {
			sort = "total_rating desc";
			where.push("total_rating_count >= 20");
		}
		const page = Math.max(1, query.page ?? 1);
		const games = await this.query<IgdbGame[]>(
			"games",
			`fields ${cardFields()}; where ${where.join(" & ")}; sort ${sort}; limit 20; offset ${(page - 1) * 20};`,
			ctx,
			12 * 60 * 60 * 1000,
		);
		return games.map(toItem);
	}

	canResolve(url: string): boolean {
		return SLUG.test(url);
	}

	async resolve(url: string, ctx: RequestContext): Promise<MediaItem> {
		const slug = SLUG.exec(url)?.[1];
		if (!slug) throw new Error("Not an IGDB or Backloggd game URL");
		return toItem(await this.game(`slug = ${quoted(slug)}`, ctx));
	}

	private clientId(): string {
		return this.ctx.settings.get("clientId", "").trim();
	}

	private clientSecret(): string {
		return this.ctx.settings.secret("clientSecretSecret").trim();
	}
}

/** IGDB and Backloggd share game slugs. */
const SLUG = /(?:igdb\.com|backloggd\.com)\/games\/([\w-]+)/;

/** IGDB counts time to beat in seconds. */
export function toHours(seconds: number | null | undefined): number | undefined {
	return typeof seconds === "number" && seconds > 0 ? Math.round(seconds / 3600) : undefined;
}
