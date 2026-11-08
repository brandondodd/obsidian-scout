import { describe, expect, it } from "vitest";
import { toAvailability, toExtras, type TmdbExtrasResponse } from "./extras";

const film: TmdbExtrasResponse = {
	id: 1,
	backdrop_path: "/b.jpg",
	tagline: "Be careful.",
	status: "Released",
	runtime: 102,
	vote_average: 8.2,
	original_language: "en",
	imdb_id: "tt1",
	credits: {
		cast: [{ name: "Bear Actor", character: "Bear", profile_path: "/a.jpg" }],
		crew: [
			{ name: "Curry Barker", job: "Director" },
			{ name: "Curry Barker", job: "Writer" },
			{ name: "Taylor Lee", job: "Editor" },
			{ name: "Someone", job: "Catering" },
		],
	},
	keywords: { keywords: [{ name: "curse" }] },
	videos: {
		results: [
			{ key: "tease", site: "YouTube", type: "Teaser", official: true },
			{ key: "real", site: "YouTube", type: "Trailer", official: true },
			{ key: "x", site: "Vimeo", type: "Trailer" },
		],
	},
	release_dates: {
		results: [
			{
				iso_3166_1: "GB",
				release_dates: [
					{ certification: "", type: 1 },
					{ certification: "18", type: 5 },
					{ certification: "15", type: 3 },
				],
			},
			{ iso_3166_1: "US", release_dates: [{ certification: "R", type: 3 }] },
		],
	},
	"watch/providers": {
		results: {
			GB: {
				link: "https://www.themoviedb.org/movie/1/watch?locale=GB",
				rent: [
					{ provider_name: "Prime Video", logo_path: "/p.jpg", display_priority: 2 },
					{ provider_name: "Apple TV", logo_path: "/a.jpg", display_priority: 1 },
				],
				buy: [{ provider_name: "Apple TV", logo_path: "/a.jpg" }],
			},
		},
	},
};

const show: TmdbExtrasResponse = {
	id: 2,
	number_of_seasons: 6,
	number_of_episodes: 36,
	status: "Returning Series",
	vote_average: 0,
	created_by: [{ name: "Will Smith" }],
	next_episode_to_air: { air_date: "2026-11-12" },
	external_ids: { imdb_id: "tt2" },
	aggregate_credits: {
		cast: [
			{
				name: "Tom Ashby",
				roles: [{ character: "Jonah", episode_count: 10 }],
				total_episode_count: 10,
			},
		],
		crew: [
			{ name: "Dana Reyes", jobs: [{ job: "Director", episode_count: 4 }] },
		],
	},
	keywords: { results: [{ name: "spy" }] },
	content_ratings: {
		results: [
			{ iso_3166_1: "US", rating: "TV-MA" },
			{ iso_3166_1: "GB", rating: "" },
		],
	},
};

describe("film extras", () => {
	const extras = toExtras(film, "movie", "GB");

	it("takes the theatrical certificate for your region", () => {
		expect(extras.ageRating).toEqual({
			region: "GB",
			label: "15",
			fallback: false,
		});
	});

	it("merges one person's jobs into one entry, crew before cast", () => {
		expect(extras.people.map((one) => one.name)).toEqual([
			"Curry Barker",
			"Taylor Lee",
			"Bear Actor",
		]);
		expect(extras.people[0]?.role).toBe("Director, writer");
	});

	it("credits the director", () => {
		expect(extras.credit).toEqual({
			prefix: "Directed by",
			names: ["Curry Barker"],
		});
	});

	it("leads with the official trailer and keeps to YouTube", () => {
		expect(extras.videos.map((one) => one.url)).toEqual([
			"https://www.youtube.com/watch?v=real",
			"https://www.youtube.com/watch?v=tease",
		]);
	});

	it("shows the score to one decimal place", () => {
		expect(extras.scores).toEqual([
			{ id: "tmdb", label: "TMDB", value: "8.2", outOfTen: 8.2 },
		]);
	});

	it("writes the runtime for reading", () => {
		expect(extras.headerFacts).toEqual(["1h 42m"]);
	});

	it("links to IMDb's parents guide", () => {
		expect(extras.links.map((one) => one.label)).toEqual([
			"TMDB",
			"IMDb",
			"Parents guide",
		]);
	});

	it("names the age rating's country in the facts", () => {
		expect(extras.facts).toContainEqual({
			label: "Age rating",
			value: "15 (UK)",
		});
	});
});

describe("show extras", () => {
	const extras = toExtras(show, "tv", "GB");

	it("labels the fallback when your region has no rating", () => {
		expect(extras.ageRating).toEqual({
			region: "US",
			label: "TV-MA",
			fallback: true,
		});
	});

	it("gives cast and crew the same episode caption", () => {
		expect(extras.people).toEqual([
			{ name: "Will Smith", role: "Creator" },
			{ name: "Dana Reyes", role: "Director", more: "4 episodes" },
			{ name: "Tom Ashby", role: "Jonah", more: "10 episodes" },
		]);
	});

	it("reads television's keywords and external ids", () => {
		expect(extras.keywords).toEqual(["spy"]);
		expect(extras.imdbId).toBe("tt2");
		expect(extras.nextAirDate).toBe("2026-11-12");
	});

	it("treats a score of zero as nobody having voted", () => {
		expect(extras.scores).toEqual([]);
	});

	it("counts seasons in the header", () => {
		expect(extras.headerFacts).toEqual(["6 seasons"]);
	});
});

describe("availability", () => {
	it("marks it as JustWatch's, so the credit shows", () => {
		expect(toAvailability(film, "GB")?.justWatch).toBe(true);
	});

	it("uses real logos, in TMDB's priority order", () => {
		const rent = toAvailability(film, "GB")?.groups[0];
		expect(rent?.tiles.map((one) => one.name)).toEqual([
			"Apple TV",
			"Prime Video",
		]);
		expect(rent?.tiles[0]?.logoUrl).toBe(
			"https://image.tmdb.org/t/p/w92/a.jpg",
		);
	});

	it("is absent in a region nobody serves", () => {
		expect(toAvailability(film, "DE")).toBeUndefined();
	});

	it("never quotes a price, because TMDB does not give one", () => {
		const tiles = toAvailability(film, "GB")?.groups.flatMap((g) => g.tiles);
		expect(tiles?.every((one) => one.price === undefined)).toBe(true);
	});
});
