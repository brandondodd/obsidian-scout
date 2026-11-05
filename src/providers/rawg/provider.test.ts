import { describe, expect, it } from "vitest";
import type { HttpClient } from "../../core/http";
import type { SettingsScope } from "../../core/settings/types";
import { defaultTemplateFor } from "../../templates/defaults";
import { renderTemplate } from "../../core/template/engine";
import { toTemplateContext } from "../../core/types";
import { RawgProvider, genreSlugs, toItem, type RawgGame } from "./provider";

const FIXTURE: RawgGame = {
	id: 3328,
	slug: "the-witcher-3-wild-hunt",
	name: "The Witcher 3: Wild Hunt",
	released: "2015-05-18",
	background_image: "https://media.rawg.io/media/games/618/618c.jpg",
	rating: 4.66,
	ratings_count: 6500,
	metacritic: 92,
	playtime: 46,
	added: 20000,
	description_raw: "Geralt hunts.",
	genres: [
		{ id: 4, name: "Action", slug: "action" },
		{ id: 5, name: "RPG", slug: "role-playing-games-rpg" },
	],
	tags: [
		{ id: 1, name: "Open World", slug: "open-world", language: "eng" },
		{ id: 2, name: "Открытый мир", slug: "otkrytyi-mir", language: "rus" },
	],
	platforms: [{ platform: { id: 4, name: "PC" } }, { platform: { id: 187, name: "PlayStation 5" } }],
	developers: [{ name: "CD PROJEKT RED" }],
	publishers: [{ name: "CD PROJEKT RED" }, { name: "Warner Bros." }],
	esrb_rating: { id: 4, name: "Mature" },
};

function provider(answer: unknown, key = "k") {
	const urls: string[] = [];
	const http = {
		getJson: async (url: string) => {
			urls.push(url);
			return answer;
		},
	} as unknown as HttpClient;
	const settings: SettingsScope = {
		get: <T>(_key: string, fallback: T) => fallback,
		set: async () => {},
		secret: () => key,
	};
	return { urls, rawg: new RawgProvider({ http, settings }) };
}

const signal = new AbortController().signal;

describe("RAWG mapping", () => {
	it("maps a game onto Scout's shape, rating out of ten", () => {
		const item = toItem(FIXTURE);
		expect(item).toMatchObject({
			ref: { providerId: "rawg", kind: "game", id: "3328" },
			title: "The Witcher 3: Wild Hunt",
			subtitle: "CD PROJEKT RED",
			year: 2015,
			rating: 9.3,
			ratingCount: 6500,
			tags: ["Action", "RPG"],
			people: ["CD PROJEKT RED", "Warner Bros."],
			externalUrl: "https://rawg.io/games/the-witcher-3-wild-hunt",
			releaseDate: "2015-05-18",
			thumbnailUrl: "https://media.rawg.io/media/resize/420/-/games/618/618c.jpg",
		});
		expect(item.extra).toMatchObject({
			platforms: ["PC", "PlayStation 5"],
			developers: ["CD PROJEKT RED"],
			playtime: 46,
			metacritic: 92,
			esrb: "Mature",
		});
	});

	it("treats a zero rating as nobody having rated it", () => {
		expect(toItem({ ...FIXTURE, rating: 0, playtime: 0 }).rating).toBeUndefined();
		expect(toItem({ ...FIXTURE, playtime: 0 }).extra.playtime).toBeUndefined();
	});

	it("renders the default game template with the fields the library reads", () => {
		const { content, missing } = renderTemplate(
			defaultTemplateFor("game"),
			toTemplateContext(toItem(FIXTURE)),
		);
		expect(missing).toEqual([]);
		expect(content).toContain("type: game");
		expect(content).toContain("source: rawg");
		expect(content).toContain("playtime: 46");
		expect(content).toContain("platforms: [PC, PlayStation 5]");
	});
});

describe("RawgProvider", () => {
	it("needs a key before it can be used", () => {
		expect(provider({}, "").rawg.isConfigured()).toBe(false);
		expect(provider({}).rawg.isConfigured()).toBe(true);
	});

	it("searches with the key and maps results", async () => {
		const { urls, rawg } = provider({ results: [FIXTURE] });
		const found = await rawg.search("witcher 3", { signal });
		expect(found[0]?.title).toBe("The Witcher 3: Wild Hunt");
		const url = new URL(urls[0] ?? "");
		expect(url.pathname).toBe("/api/games");
		expect(url.searchParams.get("key")).toBe("k");
		expect(url.searchParams.get("search")).toBe("witcher 3");
	});

	it("resolves its game links by slug", async () => {
		const { urls, rawg } = provider(FIXTURE);
		expect(rawg.canResolve("https://rawg.io/games/the-witcher-3-wild-hunt")).toBe(true);
		expect(rawg.canResolve("https://example.com/games/x")).toBe(false);
		const item = await rawg.resolve("https://rawg.io/games/the-witcher-3-wild-hunt", { signal });
		expect(item.ref.id).toBe("3328");
		expect(urls[0]).toContain("/games/the-witcher-3-wild-hunt?");
	});

	it("reads English tags and makers as traits", async () => {
		const { rawg } = provider(FIXTURE);
		const traits = await rawg.traits({ providerId: "rawg", kind: "game", id: "3328" }, { signal });
		expect(traits?.keywords).toEqual([{ name: "Open World", id: "open-world" }]);
		expect(traits?.directors).toEqual([{ name: "CD PROJEKT RED" }]);
		expect(traits?.studios).toEqual(["CD PROJEKT RED", "Warner Bros."]);
	});

	it("discovers by RAWG's own genre slugs and tags", async () => {
		const { urls, rawg } = provider({ results: [] });
		await rawg.discover(
			{
				kind: "game",
				genres: ["RPG", "Science Fiction", "Action"],
				keywords: [{ name: "Open World", id: "open-world" }, { name: "Time Loop" }],
				minRating: 7,
				sort: "rated",
			},
			{ signal },
		);
		const url = new URL(urls[0] ?? "");
		expect(url.searchParams.get("genres")).toBe("role-playing-games-rpg,action");
		expect(url.searchParams.get("tags")).toBe("open-world,time-loop");
		expect(url.searchParams.get("metacritic")).toBe("70,100");
		expect(url.searchParams.get("ordering")).toBe("-rating");
		expect(genreSlugs(["Board Games"])).toEqual(["board-games"]);
	});
});
