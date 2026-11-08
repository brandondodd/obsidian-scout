import { describe, expect, it } from "vitest";
import {
	episodeTotal,
	toEpisodes,
	toExtras as aniListExtras,
	toSeasons,
	type AniListExtras,
} from "./anilist/extras";
import { formatPrice, pickResult } from "./itunes/client";
import { toTitleScores } from "./mdblist/client";
import {
	creditLine,
	pickRelease,
	toCredits,
	toExtras as albumExtras,
	toItem as albumItem,
	toServices,
	toTracks,
	type MbRelease,
} from "./musicbrainz/map";
import { toEpisodeScores } from "./omdb/client";
import { toExtras as bookExtras } from "./openlibrary/extras";
import { toExtras as gameExtras } from "./igdb/extras";

describe("MDBList", () => {
	// The documented response, plus the `popcorn` source its schema names.
	const ratings = [
		{ source: "imdb", value: 8.1, score: 81 },
		{ source: "metacritic", value: 87, score: 87 },
		{ source: "metacriticuser", value: null, score: null },
		{ source: "tomatoes", value: 97, score: 97 },
		{ source: "popcorn", value: 90, score: 90 },
		{ source: "letterboxd", value: 8, score: 80 },
	];

	it("reads the scores in their native scales, Letterboxd and Trakt out of ten", () => {
		expect(toTitleScores({ ratings })).toEqual({
			imdb: 8.1,
			metacritic: 87,
			rtCritics: 97,
			rtAudience: 90,
			letterboxd: 8,
		});
	});

	it("puts Letterboxd stars and a Trakt percentage out of ten without a score", () => {
		expect(
			toTitleScores({
				ratings: [
					{ source: "letterboxd", value: 4.1, votes: 90000 },
					{ source: "trakt", value: 84, votes: 3000 },
				],
			}),
		).toEqual({ letterboxd: 8.2, trakt: 8.4, votes: { letterboxd: 90000, trakt: 3000 } });
	});

	it("also accepts the audience score's older name", () => {
		expect(
			toTitleScores({
				ratings: [{ source: "tomatoesaudience", value: 71 }],
			}),
		).toEqual({ rtAudience: 71 });
	});

	it("keeps how many votes and reviews are behind each score", () => {
		expect(
			toTitleScores({
				ratings: [
					{ source: "imdb", value: 7.4, votes: 120000 },
					{ source: "tomatoes", value: 88, votes: 0 },
				],
			}),
		).toEqual({ imdb: 7.4, rtCritics: 88, votes: { imdb: 120000 } });
	});

	it("leaves out sources with no score, so their boxes do not appear", () => {
		expect(
			toTitleScores({
				ratings: [
					{ source: "tomatoes", value: null },
					{ source: "imdb", value: 0 },
				],
			}),
		).toEqual({});
		expect(toTitleScores({})).toEqual({});
	});
});

describe("OMDb", () => {
	it("maps episodes to scores and skips N/A", () => {
		const scores = toEpisodeScores({
			Response: "True",
			Episodes: [
				{ Episode: "1", imdbRating: "8.9" },
				{ Episode: "2", imdbRating: "N/A" },
			],
		});
		expect([...scores]).toEqual([[1, 8.9]]);
	});

	it("is empty on an error response", () => {
		expect(toEpisodeScores({ Response: "False" }).size).toBe(0);
	});
});

describe("iTunes", () => {
	const novel = {
		trackName: "Project Hail Mary",
		artistName: "Andy Weir",
		price: 4.99,
	};
	const guide = {
		trackName: "Summary of Project Hail Mary",
		artistName: "Quick Reads",
	};

	it("takes the real book, not a study guide", () => {
		expect(pickResult([guide, novel], "Project Hail Mary", "Andy Weir")).toBe(
			novel,
		);
	});

	it("ignores an audiobook's bracketed note", () => {
		const audio = {
			collectionName: "Project Hail Mary (Unabridged)",
			artistName: "Andy Weir",
		};
		expect(pickResult([audio], "Project Hail Mary", "Andy Weir")).toBe(audio);
	});

	it("gives no result rather than a wrong one", () => {
		expect(pickResult([novel], "Project Hail Mary", "Someone Else")).toBe(
			undefined,
		);
		expect(pickResult([guide], "Project Hail Mary", "Andy Weir")).toBe(
			undefined,
		);
	});

	it("writes a price the way the region does", () => {
		expect(formatPrice(4.99, "GBP", "GB")).toBe("£4.99");
		expect(formatPrice(0, "GBP", "GB")).toBe("Free");
		expect(formatPrice(undefined, "GBP", "GB")).toBeUndefined();
		expect(formatPrice(4.99, undefined, "GB")).toBeUndefined();
	});
});

describe("AniList", () => {
	const airing: AniListExtras = {
		id: 7,
		type: "ANIME",
		format: "TV",
		status: "RELEASING",
		season: "FALL",
		seasonYear: 2026,
		episodes: 12,
		duration: 24,
		averageScore: 84,
		source: "LIGHT_NOVEL",
		title: { romaji: "Shio", native: "潮の縁" },
		nextAiringEpisode: { episode: 5, airingAt: 1794571200 },
		externalLinks: [
			{
				site: "Crunchyroll",
				url: "https://cr.example",
				type: "STREAMING",
				icon: "https://icon.example",
				color: "#F88B24",
			},
			{ site: "Official Site", url: "https://x.example", type: "INFO" },
		],
		streamingEpisodes: [
			{ title: "Episode 2 - A Letter Unsent", thumbnail: "https://t.example" },
		],
		trailer: { id: "abc", site: "youtube" },
		airingSchedule: {
			nodes: [{ episode: 1, airingAt: 1791547200 }],
		},
		characters: {
			edges: [
				{
					role: "MAIN",
					node: { name: { full: "Nagi" } },
					voiceActors: [{ name: { full: "Kana Mori" } }],
				},
			],
		},
		studios: { nodes: [{ name: "Studio Kairos" }] },
		relations: {
			edges: [
				{
					relationType: "SOURCE",
					node: { id: 9, type: "MANGA", format: "MANGA", title: { romaji: "S" } },
				},
			],
		},
	};

	it("says when, and scores as a percentage", () => {
		const extras = aniListExtras(airing);
		expect(extras.when).toBe("Fall 2026");
		expect(extras.scores[0]?.value).toBe("84%");
		expect(extras.byline).toBe("潮の縁");
	});

	it("lists streaming links with their icon and colour, and nothing else", () => {
		const group = aniListExtras(airing).availability?.groups[0];
		expect(group?.tiles).toEqual([
			{
				name: "Crunchyroll",
				url: "https://cr.example",
				logoUrl: "https://icon.example",
				logoBackground: "#F88B24",
			},
		]);
	});

	it("is not region-specific, so it carries no JustWatch credit", () => {
		expect(aniListExtras(airing).availability?.justWatch).toBeUndefined();
	});

	it("puts staff first, and names who voices a character", () => {
		const extras = aniListExtras(airing);
		expect(extras.people).toEqual([
			{ name: "Studio Kairos", role: "Studio" },
			{ name: "Nagi", role: "Main", more: "Voiced by Kana Mori" },
		]);
	});

	it("captions a relation with how it relates", () => {
		const rail = aniListExtras(airing).rails[0];
		expect(rail?.captions?.["9"]).toBe("Source · Manga");
		expect(rail?.items[0]?.ref.kind).toBe("manga");
	});

	it("lists the run as one season", () => {
		expect(toSeasons(airing)).toEqual([
			{ number: 1, name: "Episodes", episodeCount: 12 },
		]);
	});

	it("has no episodes for a film or a manga", () => {
		expect(toSeasons({ ...airing, format: "MOVIE" })).toEqual([]);
		expect(toSeasons({ ...airing, type: "MANGA" })).toEqual([]);
	});

	it("counts as far as anyone knows when the total is unknown", () => {
		expect(episodeTotal({ ...airing, episodes: null })).toBe(5);
		expect(
			episodeTotal({ ...airing, episodes: null, nextAiringEpisode: null }),
		).toBe(0);
	});

	it("names episodes where it can and marks what is still to come", () => {
		const episodes = toEpisodes(airing);
		expect(episodes).toHaveLength(12);
		expect(episodes[1]?.title).toBe("A Letter Unsent");
		expect(episodes[1]?.stillUrl).toBe("https://t.example");
		expect(episodes[2]?.title).toBe("Episode 3");
		expect(episodes[3]?.upcoming).toBeUndefined();
		expect(episodes[4]?.upcoming).toBe(true);
	});

	it("leaves the chapter total open while a manga is releasing", () => {
		const manga: AniListExtras = {
			...airing,
			type: "MANGA",
			format: "MANGA",
			chapters: null,
		};
		expect(aniListExtras(manga).progress).toEqual({ unit: "chapter" });
		expect(aniListExtras({ ...manga, chapters: 90 }).progress).toEqual({
			unit: "chapter",
			total: 90,
		});
	});

	it("writes a manga's start date for reading", () => {
		const extras = aniListExtras({
			...airing,
			type: "MANGA",
			startDate: { year: 2021, month: 4, day: 9 },
		});
		const started = extras.facts.find((one) => one.label === "Started");
		expect(started?.value).toMatch(/2021/);
		expect(started?.value).not.toMatch(/2021-04/);
	});

	it("reads manga links as somewhere to read", () => {
		const extras = aniListExtras({ ...airing, type: "MANGA" });
		expect(extras.availability?.title).toBe("Where to read");
	});
});

describe("Open Library", () => {
	const doc = {
		author_name: ["Andy Weir"],
		first_publish_year: 2021,
		number_of_pages_median: 496,
		ratings_average: 4.5,
		ebook_access: "borrowable",
		ia: ["projecthailmary"],
	};

	it("offers borrowing only when a copy can be borrowed", () => {
		const extras = bookExtras({ doc });
		expect(extras.availability?.groups[0]).toEqual({
			id: "borrow",
			label: "Borrow",
			tiles: [
				{
					name: "Open Library",
					url: "https://archive.org/details/projecthailmary",
				},
			],
		});
	});

	it("does not count print-disabled access as borrowable", () => {
		expect(
			bookExtras({ doc: { ...doc, ebook_access: "printdisabled" } }).availability,
		).toBeUndefined();
		expect(
			bookExtras({ doc: { ...doc, ebook_access: "no_ebook" } }).availability,
		).toBeUndefined();
	});

	it("reads an author's bio in either shape", () => {
		const plain = bookExtras({ doc, author: { bio: "Writes." } });
		const typed = bookExtras({ doc, author: { bio: { value: "Writes." } } });
		expect(plain.author?.bio).toBe("Writes.");
		expect(typed.author?.bio).toBe("Writes.");
	});

	it("takes publisher, ISBN, and language from one edition, not the work", () => {
		const extras = bookExtras({
			doc: {
				...doc,
				language: ["bel", "eng"],
				publisher: ["DreamLitt", "Crown"],
				isbn: ["111"],
				editions: {
					docs: [
						{
							language: ["eng"],
							publisher: ["Crown Publishers"],
							isbn: ["9780804139021"],
						},
					],
				},
			},
		});
		expect(extras.facts).toContainEqual({
			label: "Publisher",
			value: "Crown Publishers",
		});
		expect(extras.facts).toContainEqual({ label: "Language", value: "English" });
	});

	it("says nothing about the edition when there is none", () => {
		const extras = bookExtras({
			doc: { ...doc, language: ["bel"], publisher: ["DreamLitt"] },
		});
		const labels = extras.facts.map((one) => one.label);
		expect(labels).not.toContain("Publisher");
		expect(labels).not.toContain("Language");
	});

	it("counts pages, with the total the card needs", () => {
		const extras = bookExtras({ doc });
		expect(extras.progress).toEqual({ unit: "page", total: 496 });
		expect(extras.scores[0]?.value).toBe("9.0");
	});

	it("links to the whole bibliography when the rail is only part of it", () => {
		const others = [
			{
				ref: { providerId: "openlibrary", kind: "book" as const, id: "a" },
				title: "T",
				tags: [],
				people: [],
				extra: {},
			},
		];
		const rail = bookExtras({
			doc,
			authorKey: "OL1A",
			others,
			worksTotal: 14,
		}).rails[0];
		expect(rail?.title).toBe("More by Andy Weir");
		expect(rail?.more?.label).toBe("All 14");
	});
});

describe("IGDB", () => {
	const game = {
		id: 1,
		slug: "hollow",
		name: "Hollow",
		rating: 84.2,
		aggregated_rating: 88,
		first_release_date: Date.UTC(2025, 2, 14) / 1000,
		involved_companies: [
			{ company: { name: "Ashgrove" }, developer: true },
			{ company: { name: "Bigco" }, publisher: true },
		],
		websites: [
			{ url: "https://store.steampowered.com/app/1", type: 13 },
			{ url: "https://hollow.example", category: 1 },
		],
		screenshots: [{ image_id: "abc" }],
		videos: [{ name: "Launch trailer", video_id: "yt1" }],
		collections: [{ name: "Hollow", games: [{ id: 1, name: "Hollow" }, { id: 2, name: "Hollow II" }] }],
	};

	it("reads time to beat into the header, Details, and progress", () => {
		const extras = gameExtras({
			game,
			timeToBeat: { hastily: 18 * 3600, normally: 24 * 3600, completely: 40 * 3600 },
		});
		expect(extras.headerFacts).toEqual(["About 24h to beat"]);
		expect(extras.facts).toContainEqual({ label: "Completionist", value: "40h" });
		expect(extras.progress).toEqual({ unit: "hour", total: 24 });
		expect(extras.byline).toBe("Ashgrove");
	});

	it("survives a bare record", () => {
		const extras = gameExtras({ game: { id: 3 }, timeToBeat: null });
		expect(extras.screenshots).toEqual([]);
		expect(extras.videos).toEqual([]);
		expect(extras.rails.every((one) => one.items.length === 0)).toBe(true);
		expect(extras.availability).toBeUndefined();
	});

	it("names stores by their links and keeps the official site apart", () => {
		const extras = gameExtras({ game });
		expect(extras.availability?.groups[0]?.tiles).toEqual([
			{ name: "Steam", url: "https://store.steampowered.com/app/1" },
		]);
		expect(extras.links.map((one) => one.label)).toEqual(["IGDB", "Backloggd", "Official site"]);
	});

	it("reads scores on the dialog's scales", () => {
		expect(gameExtras({ game }).scores.map((one) => one.value)).toEqual(["8.8", "8.4"]);
	});

	it("leaves the game itself out of its series, and plays YouTube trailers", () => {
		const extras = gameExtras({ game });
		expect(extras.rails[1]?.items.map((one) => one.title)).toEqual(["Hollow II"]);
		expect(extras.rails[1]?.title).toBe("In the Hollow series");
		expect(extras.videos[0]?.url).toBe("https://www.youtube.com/watch?v=yt1");
		expect(extras.screenshots[0]).toContain("/t_screenshot_big/abc.jpg");
	});
});

describe("MusicBrainz", () => {
	const track = (title: string, length: number, guest?: string) => ({
		title,
		length,
		"artist-credit": [{ name: "Wren" }, ...(guest ? [] : [])].map((one) => ({
			...one,
			...(guest ? { name: guest } : {}),
		})),
	});
	const group = {
		id: "g",
		title: "Paper Lanterns",
		"primary-type": "Album",
		"first-release-date": "2025-06-06",
		"artist-credit": [{ name: "Wren", joinphrase: " & ", artist: { id: "a" } }, { name: "the Low Tide" }],
		rating: { value: 4.2, "votes-count": 12 },
		genres: [
			{ name: "folk", count: 1 },
			{ name: "indie folk", count: 5 },
		],
	};

	it("keeps the credit as written", () => {
		expect(creditLine(group["artist-credit"])).toBe("Wren & the Low Tide");
	});

	it("maps a release group, with covers from the archive", () => {
		const item = albumItem(group);
		expect(item.ref).toEqual({
			providerId: "musicbrainz",
			kind: "album",
			id: "g",
		});
		expect(item.year).toBe(2025);
		expect(item.rating).toBe(8.4);
		expect(item.tags.slice(0, 2)).toEqual(["Folk", "Indie folk"]);
		expect(item.imageUrl).toBe(
			"https://coverartarchive.org/release-group/g/front-500",
		);
	});

	it("prefers the plain album to a box set, and the original to a reissue", () => {
		const tracks = [track("A", 1000)];
		const box: MbRelease = {
			id: "box",
			date: "2007-01-01",
			media: [{ tracks }, { tracks }, { tracks }],
		};
		const reissue: MbRelease = { id: "re", date: "2016-01-01", media: [{ tracks }] };
		const original: MbRelease = { id: "og", date: "2007-10-10", media: [{ tracks }] };
		expect(pickRelease([box, reissue, original])?.id).toBe("og");
	});

	it("skips releases with no track list", () => {
		expect(pickRelease([{ id: "x", media: [{}] }])).toBeUndefined();
	});

	it("numbers a double album straight through, with lengths and guests", () => {
		const release: MbRelease = {
			id: "r",
			media: [
				{ tracks: [track("One", 252000)] },
				{ tracks: [track("Two", 218000, "Ada Holm")] },
			],
		};
		expect(toTracks(release, "Wren")).toEqual([
			{ number: 1, title: "One", length: "4:12" },
			{ number: 2, title: "Two", length: "3:38", featuring: "Ada Holm" },
		]);
	});

	it("collects streaming links once per service, ignoring the rest", () => {
		const url = (resource: string) => ({ url: { resource } });
		const tiles = toServices([
			{
				id: "a",
				relations: [
					url("https://open.spotify.com/album/1"),
					url("https://www.discogs.com/release/1"),
				],
			},
			{
				id: "b",
				relations: [
					url("https://open.spotify.com/album/2"),
					url("https://music.apple.com/gb/album/1"),
				],
			},
		]);
		expect(tiles.map((one) => one.name)).toEqual(["Spotify", "Apple Music"]);
	});

	it("finds credits on recordings, across every edition", () => {
		const producer = (name: string) => ({
			type: "producer",
			artist: { name },
		});
		expect(
			toCredits([
				{
					id: "a",
					media: [
						{
							tracks: [
								{ recording: { relations: [producer("Nigel Godrich")] } },
								{ recording: { relations: [producer("Nigel Godrich")] } },
							],
						},
					],
				},
				{
					id: "b",
					relations: [
						{ type: "mix", artist: { name: "Sam" } },
						{ type: "photography", artist: { name: "Not listed" } },
					],
				},
			]),
		).toEqual([
			{ label: "Producer", value: "Nigel Godrich" },
			{ label: "Mixing", value: "Sam" },
		]);
	});

	it("builds the album's extras", () => {
		const extras = albumExtras({
			group,
			releases: [
				{
					id: "r",
					date: "2025-06-06",
					media: [{ tracks: [track("One", 120000), track("Two", 120000)] }],
					"label-info": [{ label: { name: "Harbour Records" } }],
					relations: [{ type: "producer", artist: { name: "Jo Hallam" } }],
				},
			],
			others: [],
		});
		expect(extras.shape).toBe("square");
		expect(extras.headerFacts).toEqual(["2 tracks", "4 min"]);
		expect(extras.tracks).toHaveLength(2);
		expect(extras.scores[0]).toEqual({
			id: "musicbrainz",
			label: "MusicBrainz",
			value: "8.4",
			outOfTen: 8.4,
			votes: 12,
		});
		expect(extras.credits).toEqual([{ label: "Producer", value: "Jo Hallam" }]);
		expect(extras.facts).toContainEqual({
			label: "Label",
			value: "Harbour Records",
		});
	});
});
