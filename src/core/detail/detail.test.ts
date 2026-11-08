import { describe, expect, it } from "vitest";
import type { LibraryEntry } from "../library/entry";
import { withAlbumPrice, withBookPrices, withFilmPrices } from "./apple";
import { average, barHeight, HEAT_RAMP, heatBins } from "./heat";
import { peopleInLibrary } from "./library";
import { assembleScores, fillGaps, hasMore, serviceBar } from "./scores";
import { readFavoriteTracks, toggleTrack } from "./tracks";
import { emptyExtras, type Availability } from "./types";

describe("heatBins", () => {
	it("spreads scores across the whole ramp by rank", () => {
		const scores = [7.9, 8.0, 8.1, 8.3, 8.6];
		const bin = heatBins(scores);
		expect(scores.map(bin)).toEqual([0, 1, 2, 3, 4]);
	});

	it("uses every shade on a show with a narrow range", () => {
		const bin = heatBins([8.1, 8.2]);
		expect(bin(8.1)).toBe(0);
		expect(bin(8.2)).toBe(HEAT_RAMP.length - 1);
	});

	it("gives equal scores the same shade", () => {
		const bin = heatBins([7, 8, 8, 8, 9]);
		expect(bin(8)).toBe(2);
	});

	it("takes the middle shade when every score is the same", () => {
		expect(heatBins([8, 8, 8])(8)).toBe(2);
	});

	it("matches the mockup's binning on a longer season", () => {
		const scores = [5, 6, 7, 8, 9, 10];
		expect(scores.map(heatBins(scores))).toEqual([0, 0, 1, 2, 3, 4]);
	});
});

describe("average", () => {
	it("is undefined with nothing to average", () => {
		expect(average([])).toBeUndefined();
		expect(average([8, 9])).toBe(8.5);
	});
});

describe("barHeight", () => {
	it("never disappears on a low score", () => {
		expect(barHeight(1)).toBe(8);
		expect(barHeight(10)).toBe(54);
	});
});

describe("fillGaps", () => {
	it("fills a source MDBList left blank from what it said before, on its own scale", () => {
		const filled = fillGaps({ imdb: 9 }, [
			{ source: "rt-critics", value: 9.4, votes: 280 },
			{ source: "rt-audience", value: 8.6 },
			{ source: "imdb", value: 8.9 },
		]);
		expect(filled.imdb).toBe(9);
		expect(filled.rtCritics).toBeCloseTo(94, 5);
		expect(filled.rtAudience).toBeCloseTo(86, 5);
		expect(filled.votes?.rtCritics).toBe(280);
	});
});

describe("assembleScores", () => {
	const tmdb = { id: "tmdb", label: "TMDB", value: "8.2", outOfTen: 8.2, votes: 9000 };
	const full = { rtCritics: 91, rtAudience: 84, imdb: 8, metacritic: 78 };

	it("leads with Scout, then Rotten Tomatoes and IMDb, with the rest under More", () => {
		const row = assembleScores([tmdb], full, "movie");
		expect(row.scout?.from).toEqual([
			"Rotten Tomatoes critics",
			"Rotten Tomatoes audience",
			"IMDb",
			"Metacritic",
			"TMDB",
		]);
		expect(row.rt).toEqual({ critics: "91%", audience: "84%" });
		expect(row.boxes.map((one) => one.id)).toEqual(["imdb"]);
		expect(row.more?.map((one) => one.value)).toEqual(["78", "8.2"]);
	});

	it("blends every reading, Rotten Tomatoes' two included", () => {
		const scout = (title: typeof full) =>
			Number(assembleScores([tmdb], title, "movie").scout?.value);
		const base = scout(full);
		expect(base).toBeGreaterThan(7.5);
		expect(base).toBeLessThan(9);
		expect(scout({ ...full, rtCritics: 40 })).toBeLessThan(base);
		// Far under IMDb, the audience share is mostly discounted, never ignored.
		expect(scout({ ...full, rtAudience: 40 })).toBeLessThanOrEqual(base);
		const bombed = assembleScores([tmdb], { ...full, rtAudience: 10 }, "movie").scout;
		expect(Number(bombed?.value)).toBeLessThanOrEqual(base);
		expect(bombed?.parts.find((one) => one.id === "rt-audience")?.share).toBeGreaterThan(0);
	});

	it("shows its working: what each source said and counted as, biggest say first", () => {
		// Money Heist: everyone in the low 80s, critics 94%.
		const scout = assembleScores(
			[{ ...tmdb, votes: 19_784 }],
			{ rtCritics: 94, rtAudience: 81, imdb: 8.2, trakt: 8.1 },
			"tv",
		).scout;
		const parts = scout?.parts ?? [];
		expect(parts.map((one) => one.label).sort()).toEqual(
			["IMDb", "RT audience", "RT critics", "TMDB", "Trakt"].sort(),
		);
		expect(parts.find((one) => one.id === "rt-critics")?.says).toBe("94%");
		expect(parts.find((one) => one.id === "trakt")?.says).toBe("81%");
		expect(parts[0]?.share).toBeGreaterThanOrEqual(parts[parts.length - 1]?.share ?? 1);
		const shares = parts.reduce((sum, one) => sum + one.share, 0);
		expect(shares).toBeCloseTo(1, 5);
		// Plenty of reviews and ratings behind each, so no row says how few.
		expect(parts.every((one) => one.few === undefined)).toBe(true);
		const thin = assembleScores([], { imdb: 8, rtCritics: 90, votes: { rtCritics: 6 } }, "movie");
		expect(thin.scout?.parts.find((one) => one.id === "rt-critics")?.few).toBe("6 reviews");
	});

	it("lists More in the same order as the Scout breakdown", () => {
		const row = assembleScores(
			[{ ...tmdb, votes: 19_784 }],
			{ imdb: 7.4, rtCritics: 93, metacritic: 81, letterboxd: 7.2, trakt: 7.8, votes: { letterboxd: 3_000_000 } },
			"movie",
		);
		const order = (row.scout?.parts ?? []).map((one) => one.id);
		const more = (row.more ?? []).map((one) => one.id);
		expect(more).toEqual(order.filter((id) => more.includes(id)));
	});

	it("adds the blend and its steps up to the score exactly", () => {
		// Three weeks out, keen everywhere, and few IMDb votes: two steps.
		const facts = { releaseDate: new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10) };
		const scout = assembleScores(
			[],
			{ imdb: 9.1, rtCritics: 96, rtAudience: 95, votes: { imdb: 27_000 } },
			"movie",
			facts,
		).scout;
		const steps = scout?.steps ?? [];
		expect(steps.map((one) => one.label)).toEqual(["Just released", "Few IMDb votes"]);
		const total = steps.reduce(
			(sum, one) => sum + Number(one.by.replace("−", "-")),
			Number(scout?.blended),
		);
		expect(total.toFixed(1)).toBe(scout?.value);
	});

	it("shows a film not out yet its hype, worked out step by step, in place of a Scout score", () => {
		const facts = { releaseDate: "2099-06-16" };
		const outlook = {
			series: {
				name: "Shrek Collection",
				films: [
					{ title: "Shrek", rating: 7.8 },
					{ title: "Shrek 2", rating: 7.3 },
					{ title: "Shrek the Third", rating: 6.3 },
				],
			},
			directors: {
				names: ["Walt Dohrn", "Conrad Vernon"],
				films: [
					{ title: "Trolls", rating: 6.6, genres: ["Animation"], released: "2016-10-13" },
					{ title: "Madagascar 3", rating: 6.7, genres: ["Animation"], released: "2012-06-06" },
				],
			},
			genres: ["Comedy", "Animation"],
			budget: 5_000_000,
		};
		const row = assembleScores([{ ...tmdb, outOfTen: 8, votes: 7 }], null, "movie", facts, outlook);
		expect(row.scout).toBeUndefined();
		const hype = row.hype;
		expect(hype?.steps.map((one) => [one.label, one.detail])).toEqual([
			["Its series", "3 earlier films, latest Shrek the Third"],
			["Its directors", "Walt Dohrn & Conrad Vernon, 2 earlier films"],
			["Its genres", "Comedy, Animation"],
		]);
		const total = (hype?.steps ?? []).reduce(
			(sum, one) => sum + Number(one.by.replace("−", "-")),
			Number(hype?.typical),
		);
		expect(total.toFixed(1)).toBe(hype?.value);
		// Series have no earlier seasons to go on.
		expect(assembleScores([], null, "tv", facts, outlook).hype).toBeUndefined();
	});

	it("reads the source alone with no key, and does not fold one score away", () => {
		const row = assembleScores([tmdb], null, "movie");
		expect(row.rt).toBeUndefined();
		expect(row.more).toBeUndefined();
		expect(row.boxes).toEqual([tmdb]);
		expect(row.scout?.from).toEqual(["TMDB"]);
	});

	it("keeps one half of Rotten Tomatoes when that is all there is", () => {
		expect(assembleScores([], { rtCritics: 50 }, "movie").rt).toEqual({ critics: "50%" });
	});

	it("does not show a source twice", () => {
		const row = assembleScores(
			[{ id: "metacritic", label: "Metacritic", value: "70" }],
			{ metacritic: 78 },
			"movie",
		);
		expect(row.boxes).toHaveLength(1);
		expect(row.boxes[0]?.value).toBe("78");
	});

	it("blends a game's critics and players", () => {
		const row = assembleScores(
			[
				{ id: "igdb-critics", label: "Critics", value: "9.0", outOfTen: 9, votes: 40 },
				{ id: "igdb", label: "IGDB", value: "8.0", outOfTen: 8, votes: 900 },
			],
			null,
			"game",
		);
		expect(row.scout?.from).toEqual(["Critics", "IGDB"]);
		expect(row.boxes).toHaveLength(2);
	});

	it("has no Scout box when nothing has a number behind it", () => {
		expect(
			assembleScores([{ id: "x", label: "X", value: "?" }], null, "movie").scout,
		).toBeUndefined();
	});
});

describe("serviceBar", () => {
	const apple = { name: "Apple TV", price: "£3.49" };
	const prime = { name: "Prime Video" };

	it("counts other services, not other offers", () => {
		const bar = serviceBar({
			title: "Where to watch",
			justWatch: true,
			groups: [
				{ id: "rent", label: "Rent", tiles: [apple, prime] },
				{ id: "buy", label: "Buy", tiles: [{ name: "Apple TV" }] },
			],
		});
		expect(bar?.caption).toBe("Rent from £3.49");
		expect(bar?.name).toBe("Apple TV +1");
	});

	it("does not quote a price nobody gave", () => {
		const bar = serviceBar({
			title: "Where to watch",
			groups: [{ id: "rent", label: "Rent", tiles: [prime] }],
		});
		expect(bar?.caption).toBe("Available to rent");
	});

	it("only says now streaming about your region", () => {
		const groups: Availability["groups"] = [
			{ id: "stream", label: "Stream", tiles: [prime] },
		];
		expect(
			serviceBar({ title: "", groups, justWatch: true })?.caption,
		).toBe("Now streaming");
		expect(serviceBar({ title: "", groups })?.caption).toBe("Stream on");
	});

	it("has nothing to show without a service", () => {
		expect(serviceBar(undefined)).toBeUndefined();
		expect(
			serviceBar({
				title: "",
				groups: [{ id: "buy", label: "Buy", tiles: [] }],
			}),
		).toBeUndefined();
	});
});

describe("hasMore", () => {
	it("hides the tab when every section would be empty", () => {
		expect(hasMore(emptyExtras())).toBe(false);
		expect(
			hasMore({
				...emptyExtras(),
				rails: [{ id: "a", title: "A", items: [] }],
			}),
		).toBe(false);
		expect(hasMore({ ...emptyExtras(), keywords: ["x"] })).toBe(true);
	});
});

describe("Apple prices", () => {
	const book = { price: "£6.99", url: "https://apple.example/b" };

	it("puts a book's prices ahead of borrowing", () => {
		const extras = withBookPrices(
			{
				...emptyExtras(),
				availability: {
					title: "Where to read",
					groups: [
						{
							id: "borrow",
							label: "Borrow",
							tiles: [{ name: "Open Library" }],
						},
					],
				},
			},
			{ ebook: book, audiobook: { price: "£18.99" } },
		);
		const groups = extras.availability?.groups ?? [];
		expect(groups.map((one) => one.id)).toEqual(["buy", "borrow"]);
		expect(extras.availability?.regional).toBe(true);
		expect(groups[0]?.tiles.map((one) => one.price)).toEqual([
			"Ebook £6.99",
			"Audiobook £18.99",
		]);
	});

	it("leaves a book alone when Apple quoted nothing", () => {
		const base = emptyExtras();
		expect(withBookPrices(base, {})).toBe(base);
	});

	it("files an album's price after the services", () => {
		const extras = withAlbumPrice(
			{
				...emptyExtras(),
				availability: {
					title: "Where to listen",
					groups: [
						{
							id: "listen",
							label: "Stream",
							tiles: [{ name: "Spotify" }],
						},
					],
				},
			},
			{ price: "£8.99" },
		);
		expect(extras.availability?.groups.map((one) => one.id)).toEqual([
			"listen",
			"buy",
		]);
		expect(extras.availability?.regional).toBe(true);
	});

	it("prices only the Apple tiles of a film", () => {
		const extras = withFilmPrices(
			{
				...emptyExtras(),
				availability: {
					title: "Where to watch",
					groups: [
						{
							id: "rent",
							label: "Rent",
							tiles: [{ name: "Apple TV" }, { name: "Prime Video" }],
						},
					],
				},
			},
			{ rent: { price: "£3.49" } },
		);
		expect(
			extras.availability?.groups[0]?.tiles.map((one) => one.price),
		).toEqual(["£3.49", undefined]);
	});
});

describe("peopleInLibrary", () => {
	const entry = (path: string, title: string, people: string[]) =>
		({ path, title, people }) as LibraryEntry;

	it("names the titles someone is in, ignoring case", () => {
		const found = peopleInLibrary(
			["Andy Richter"],
			[entry("a.md", "Weapons", ["andy richter"]), entry("b.md", "Other", [])],
			undefined,
		);
		expect(found.get("Andy Richter")?.map((one) => one.title)).toEqual([
			"Weapons",
		]);
	});

	it("leaves out the title you are looking at", () => {
		const found = peopleInLibrary(
			["Ada"],
			[entry("here.md", "This one", ["Ada"])],
			"here.md",
		);
		expect(found.get("Ada")).toBeUndefined();
	});

	it("counts a title once however often it lists someone", () => {
		const found = peopleInLibrary(
			["Ada"],
			[entry("a.md", "T", ["Ada", "ada"])],
			undefined,
		);
		expect(found.get("Ada")).toHaveLength(1);
	});
});

describe("favourite tracks", () => {
	it("reads a list, a lone value, or nothing", () => {
		expect(readFavoriteTracks([3, "7", "x"])).toEqual([3, 7]);
		expect(readFavoriteTracks(4)).toEqual([4]);
		expect(readFavoriteTracks(undefined)).toEqual([]);
	});

	it("toggles, stays sorted, and removes the property when empty", () => {
		expect(toggleTrack([7], 3)).toEqual([3, 7]);
		expect(toggleTrack([3, 7], 3)).toEqual([7]);
		expect(toggleTrack([3], 3)).toBeNull();
	});
});
