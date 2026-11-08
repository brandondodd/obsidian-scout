import { describe, expect, it } from "vitest";
import { HttpError, type HttpClient } from "../../core/http";
import type { SettingsScope } from "../../core/settings/types";
import { defaultTemplateFor } from "../../templates/defaults";
import { renderTemplate } from "../../core/template/engine";
import { toTemplateContext } from "../../core/types";
import { IgdbProvider, genreFilter, toItem, type IgdbGame } from "./provider";

const FIXTURE: IgdbGame = {
	id: 1942,
	slug: "the-witcher-3-wild-hunt",
	name: "The Witcher 3: Wild Hunt",
	url: "https://www.igdb.com/games/the-witcher-3-wild-hunt",
	first_release_date: Date.UTC(2015, 4, 18) / 1000,
	cover: { image_id: "co1wyy" },
	total_rating: 93.4,
	total_rating_count: 3000,
	summary: "Geralt hunts.",
	genres: [
		{ id: 12, name: "Role-playing (RPG)" },
		{ id: 31, name: "Adventure" },
	],
	themes: [
		{ id: 1, name: "Action" },
		{ id: 17, name: "Fantasy" },
	],
	keywords: [{ id: 296, name: "open world" }],
	platforms: [{ name: "PC (Microsoft Windows)" }, { name: "PlayStation 5" }],
	involved_companies: [
		{ company: { name: "CD Projekt RED" }, developer: true },
		{ company: { name: "CD Projekt" }, publisher: true },
		{ company: { name: "Warner Bros." }, publisher: true },
	],
};

interface Call {
	url: string;
	body: string;
	headers: Record<string, string>;
}

function provider(answers: unknown[] = [[FIXTURE]], secret = "s") {
	const calls: Call[] = [];
	let tokens = 0;
	const http = {
		postForm: async () => ({ access_token: `t${++tokens}`, expires_in: 5_000_000 }),
		postText: async (url: string, body: string, options: { headers: Record<string, string> }) => {
			calls.push({ url, body, headers: options.headers });
			const answer = answers.length > 1 ? answers.shift() : answers[0];
			if (answer instanceof Error) throw answer;
			return answer;
		},
	} as unknown as HttpClient;
	const settings: SettingsScope = {
		get: <T>(key: string, fallback: T) => (key === "clientId" ? ("cid" as T) : fallback),
		set: async () => {},
		secret: () => secret,
	};
	return { calls, tokens: () => tokens, igdb: new IgdbProvider({ http, settings }) };
}

const signal = new AbortController().signal;

describe("IGDB mapping", () => {
	it("maps a game onto Scout's shape, rating out of ten", () => {
		const item = toItem(FIXTURE);
		expect(item).toMatchObject({
			ref: { providerId: "igdb", kind: "game", id: "1942" },
			title: "The Witcher 3: Wild Hunt",
			subtitle: "CD Projekt RED",
			year: 2015,
			rating: 9.3,
			ratingCount: 3000,
			tags: ["Role-playing", "Adventure", "Action"],
			people: ["CD Projekt RED", "CD Projekt", "Warner Bros."],
			externalUrl: "https://www.igdb.com/games/the-witcher-3-wild-hunt",
			releaseDate: "2015-05-18",
			thumbnailUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg",
		});
		expect(item.extra).toMatchObject({
			platforms: ["PC (Microsoft Windows)", "PlayStation 5"],
			developers: ["CD Projekt RED"],
			publishers: ["CD Projekt", "Warner Bros."],
		});
	});

	it("renders the default game template with the fields the library reads", () => {
		const { content, missing } = renderTemplate(
			defaultTemplateFor("game"),
			toTemplateContext(toItem(FIXTURE)),
		);
		expect(missing).toEqual([]);
		expect(content).toContain("type: game");
		expect(content).toContain("source: igdb");
		expect(content).toContain("[IGDB page](https://www.igdb.com/games/the-witcher-3-wild-hunt)");
	});
});

describe("IgdbProvider", () => {
	it("needs a client id and secret before it can be used", () => {
		expect(provider([], "").igdb.isConfigured()).toBe(false);
		expect(provider().igdb.isConfigured()).toBe(true);
	});

	it("searches with the app token and keeps quotes out of the query", async () => {
		const { calls, igdb } = provider();
		const found = await igdb.search('witcher "3"', { signal });
		expect(found[0]?.title).toBe("The Witcher 3: Wild Hunt");
		expect(calls[0]?.url).toBe("https://api.igdb.com/v4/games");
		expect(calls[0]?.body).toMatch(/^search "witcher  3"; fields /);
		expect(calls[0]?.headers).toEqual({ "Client-ID": "cid", Authorization: "Bearer t1" });
	});

	it("reuses its token, and fetches a new one when IGDB refuses it", async () => {
		const { calls, tokens, igdb } = provider([
			[FIXTURE],
			new HttpError(401, "u", ""),
			[FIXTURE],
		]);
		await igdb.search("a", { signal });
		await igdb.search("b", { signal });
		expect(tokens()).toBe(2);
		expect(calls[2]?.headers.Authorization).toBe("Bearer t2");
	});

	it("resolves IGDB and Backloggd links by slug", async () => {
		const { calls, igdb } = provider();
		expect(igdb.canResolve("https://www.igdb.com/games/the-witcher-3-wild-hunt")).toBe(true);
		expect(igdb.canResolve("https://backloggd.com/games/the-witcher-3-wild-hunt/")).toBe(true);
		expect(igdb.canResolve("https://example.com/games/x")).toBe(false);
		const item = await igdb.resolve("https://backloggd.com/games/the-witcher-3-wild-hunt/", {
			signal,
		});
		expect(item.ref.id).toBe("1942");
		expect(calls[0]?.body).toContain('where slug = "the-witcher-3-wild-hunt";');
	});

	it("reads themes and keywords, and makers, as traits", async () => {
		const { igdb } = provider();
		const traits = await igdb.traits({ providerId: "igdb", kind: "game", id: "1942" }, { signal });
		expect(traits?.keywords).toEqual([
			{ name: "Action", id: "theme:1" },
			{ name: "Fantasy", id: "theme:17" },
			{ name: "open world", id: "296" },
		]);
		expect(traits?.directors).toEqual([{ name: "CD Projekt RED" }]);
		expect(traits?.studios).toEqual(["CD Projekt", "Warner Bros."]);
	});

	it("adds the time to beat to details, in hours", async () => {
		const { igdb } = provider([[FIXTURE], [{ normally: 46 * 3600 }]]);
		const item = await igdb.details({ providerId: "igdb", kind: "game", id: "1942" }, { signal });
		expect(item.extra.playtime).toBe(46);
	});

	it("discovers by IGDB's genres, themes, and keywords", async () => {
		const { calls, igdb } = provider([[]]);
		await igdb.discover(
			{
				kind: "game",
				genres: ["RPG", "Science Fiction", "Horror"],
				keywords: [{ name: "Fantasy", id: "theme:17" }, { name: "open world", id: "296" }, { name: "Time Loop" }],
				minRating: 7,
				sort: "rated",
				page: 2,
			},
			{ signal },
		);
		const body = calls[0]?.body ?? "";
		expect(body).toContain("genres = (12)");
		expect(body).toContain("themes = (19,17)");
		expect(body).toContain("keywords = (296)");
		expect(body).toContain("total_rating >= 70");
		expect(body).toContain("sort total_rating desc;");
		expect(body).toContain("offset 20;");
		expect(genreFilter(["Board games"]).genres).toEqual([35]);
	});
});
