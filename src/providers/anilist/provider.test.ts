import { describe, expect, it } from "vitest";
import type { HttpClient } from "../../core/http";
import type { SettingsScope } from "../../core/settings/types";
import { AniListProvider } from "./provider";

const settings: SettingsScope = {
	get: <T>(_key: string, fallback: T) => fallback,
	set: async () => {},
	secret: () => "",
};

const media = (id: number, type: "ANIME" | "MANGA", title: string) => ({
	id,
	type,
	title: { english: title, romaji: title },
	startDate: { year: 2020, month: 1, day: 1 },
	genres: ["Drama"],
});

describe("AniListProvider.userList", () => {
	it("reads both lists, once per title, with scores out of 100", async () => {
		const asked: unknown[] = [];
		const http = {
			postJson: async (_url: string, payload: { variables: { type: string } }) => {
				asked.push(payload.variables);
				const anime = payload.variables.type === "ANIME";
				const entry = anime
					? { status: "COMPLETED", score: 80, media: media(1, "ANIME", "Mushishi") }
					: { status: "PLANNING", score: 0, media: media(2, "MANGA", "Vagabond") };
				// The same title on a second custom list must not import twice.
				return {
					data: {
						MediaListCollection: { lists: [{ entries: [entry] }, { entries: [entry] }] },
					},
				};
			},
		} as unknown as HttpClient;

		const provider = new AniListProvider({ http, settings });
		const records = await provider.userList("someone", {
			signal: new AbortController().signal,
		});

		expect(asked).toEqual([
			{ user: "someone", type: "ANIME" },
			{ user: "someone", type: "MANGA" },
		]);
		expect(records.map((r) => [r.title, r.kind, r.tone, r.rating])).toEqual([
			["Mushishi", "anime", "done", 0.8],
			["Vagabond", "manga", "planned", undefined],
		]);
		expect(records[0]?.item?.ref).toEqual({ providerId: "anilist", kind: "anime", id: "1" });
	});
});
