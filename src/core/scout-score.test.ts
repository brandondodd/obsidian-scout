import { describe, expect, it } from "vitest";
import {
	calibrate,
	explainScout,
	isHype,
	scoutOf,
	scoutOfEntry,
	scoutOfItem,
	scoutScore,
	settledShare,
	shown,
	type Reading,
} from "./scout-score";

/**
 * Real titles' published scores (late 2026, rounded), and where the blend
 * ought to put them. Bands rather than exact numbers: the point is that the
 * scale reads the way people talk, not that a curve hits a decimal.
 */
const film = (
	imdb: number,
	metacritic: number,
	rtCritics: number,
	rtAudience: number,
	tmdb: number,
): Reading[] => [
	{ source: "imdb", value: imdb, votes: 500_000 },
	{ source: "metacritic", value: metacritic / 10, votes: 40 },
	{ source: "rt-critics", value: rtCritics / 10, votes: 200 },
	{ source: "rt-audience", value: rtAudience / 10, votes: 50_000 },
	{ source: "tmdb", value: tmdb, votes: 15_000 },
];

describe("scoutScore on real films", () => {
	it("puts the canon at the very top", () => {
		const godfather = scoutScore(film(9.2, 100, 97, 98, 8.7), "movie");
		expect(godfather).toBeGreaterThanOrEqual(9.5);
	});

	it("does not let a saturated Tomatometer hold a masterpiece down", () => {
		const withRt = scoutScore(film(9.2, 100, 97, 98, 8.7), "movie") ?? 0;
		const withoutRt =
			scoutScore(
				film(9.2, 100, 97, 98, 8.7).filter((one) => !one.source.startsWith("rt-")),
				"movie",
			) ?? 0;
		expect(Math.abs(withRt - withoutRt)).toBeLessThan(0.11);
	});

	it("ranks the best-loved film just below the canon", () => {
		const shawshank = scoutScore(film(9.3, 82, 89, 98, 8.7), "movie");
		expect(shawshank).toBeGreaterThanOrEqual(9.1);
		expect(shawshank).toBeLessThan(9.6);
	});

	it("lets a near-unanimous Tomatometer lift a well-liked film", () => {
		const paddington2 = scoutScore(film(7.8, 88, 99, 89, 7.5), "movie");
		expect(paddington2).toBeGreaterThanOrEqual(8.2);
		expect(paddington2).toBeLessThan(9);
	});

	it("lands a critically panned crowd-pleaser below average", () => {
		const venom = scoutScore(film(6.6, 35, 30, 80, 6.8), "movie");
		// Below the typical title's 6.5.
		expect(venom).toBeGreaterThan(4.5);
		expect(venom).toBeLessThan(6.5);
	});

	it("calls a disaster a disaster", () => {
		const cats = scoutScore(film(2.8, 32, 19, 53, 5.1), "movie");
		expect(cats).toBeLessThan(4);
	});

	it("weighs Rotten Tomatoes' critics and audience separately", () => {
		const base = scoutScore(film(7, 70, 80, 80, 7), "movie") ?? 0;
		const critics = scoutScore(film(7, 70, 20, 80, 7), "movie") ?? 0;
		const audience = scoutScore(film(7, 70, 80, 20, 7), "movie") ?? 0;
		expect(critics).toBeLessThanOrEqual(base - 0.3);
		// Still heard, but a Popcornmeter far under IMDb and TMDB reads as a
		// review-bomb, so it pulls no more than the same fall from the critics.
		expect(audience).toBeLessThan(base);
		expect(base - audience).toBeLessThanOrEqual(base - critics);
	});

});

describe("what the scores alone do not say", () => {
	const show = (imdb: number, metacritic: number, rtCritics: number): Reading[] => [
		{ source: "imdb", value: imdb, votes: 1_000_000 },
		{ source: "metacritic", value: metacritic / 10, votes: 30 },
		{ source: "rt-critics", value: rtCritics / 10, votes: 100 },
	];

	it("reads TV on its own scale: the very best series beside the very best films", () => {
		const breakingBad = scoutScore(show(9.5, 87, 96), "tv") ?? 0;
		const chernobyl = scoutScore(show(9.3, 82, 95), "tv") ?? 0;
		expect(breakingBad).toBeGreaterThanOrEqual(9.3);
		expect(chernobyl).toBeGreaterThanOrEqual(8.8);
		// An ordinary series is about three-quarters of a point higher on IMDb
		// than an ordinary film.
		const ordinary = calibrate({ source: "imdb", value: 7.3 }, "tv");
		expect(ordinary).toBeGreaterThan(calibrate({ source: "imdb", value: 6.5 }, "movie"));
		expect(ordinary).toBeLessThan(calibrate({ source: "imdb", value: 6.8 }, "movie"));
	});

	it("keeps the critics' full say when the broad audience did not like it either", () => {
		// Five Nights at Freddy's and its sequel: fans warm, IMDb below the middle.
		const first = scoutScore(film(5.4, 33, 33, 85, 7.2), "movie") ?? 0;
		const sequel = scoutScore(film(5.1, 26, 17, 81, 6.6), "movie") ?? 0;
		expect(first - sequel).toBeGreaterThanOrEqual(0.6);
	});

	it("puts back what broad audiences take off horror", () => {
		const babadook = film(6.8, 86, 98, 72, 6.5);
		const asHorror = scoutScore(babadook, "movie", { genres: ["Horror", "Drama"] }) ?? 0;
		const asDrama = scoutScore(babadook, "movie", { genres: ["Drama"] }) ?? 0;
		expect(asHorror).toBeGreaterThanOrEqual(asDrama);
		expect(asHorror - asDrama).toBeLessThan(0.5);
		// Plainer to see in the middle of the scale, where it is steeper.
		const middling = film(6, 60, 70, 60, 6.2);
		const midHorror = scoutScore(middling, "movie", { genres: ["Horror"] }) ?? 0;
		expect(midHorror).toBeGreaterThan(scoutScore(middling, "movie") ?? 0);
	});

	it("lets IMDb and Letterboxd pull a film down when they agree it is lower", () => {
		const horror = { genres: ["Horror"] };
		const withCrowd = (base: Reading[], letterboxd: number): Reading[] => [
			...base,
			{ source: "letterboxd", value: letterboxd, votes: 500_000 },
		];
		// Good Boy: 90% and 73 from critics beside a 6.1 and a 6.0. Without
		// the pull it read 7.45.
		const goodBoy = withCrowd(film(6.1, 73, 90, 81, 6.6), 6);
		expect(scoutScore(goodBoy, "movie", horror) ?? 10).toBeLessThanOrEqual(7.1);
		// IMDb rating it lowest gives it the most say of anyone.
		const parts = explainScout(goodBoy, "movie", horror)?.parts ?? [];
		const imdb = parts.find((one) => one.source === "imdb")?.share ?? 0;
		expect(Math.max(...parts.map((one) => one.share))).toBe(imdb);
		// Saint Maud: IMDb's 6.6 is low, but Letterboxd's 7.0 sides with the
		// critics, so there is no consensus to heed.
		const saintMaud = withCrowd(film(6.6, 83, 92, 67, 6.5), 7);
		expect(scoutScore(saintMaud, "movie", horror) ?? 0).toBeGreaterThanOrEqual(7.6);
		// The top is where the crowds already are.
		const shawshank = withCrowd(film(9.3, 82, 89, 98, 8.7), 9.2);
		expect(scoutScore(shawshank, "movie") ?? 0).toBeGreaterThanOrEqual(9.3);
	});

	it("doubts a book average with a handful of ratings behind it", () => {
		const few = scoutScore([{ source: "openlibrary", value: 8.9, votes: 11 }], "book") ?? 0;
		const many = scoutScore([{ source: "openlibrary", value: 8.9, votes: 400 }], "book") ?? 0;
		expect(few).toBeLessThan(8.1);
		expect(many).toBeGreaterThan(8.3);
	});
});

describe("calibrate", () => {
	it("puts each source's typical title near the middle", () => {
		expect(calibrate({ source: "imdb", value: 6.5 }, "movie")).toBeCloseTo(5.5, 1);
		// TMDB runs a few tenths above IMDb for the same film.
		expect(calibrate({ source: "tmdb", value: 6.8 }, "movie")).toBeCloseTo(5.4, 1);
		expect(calibrate({ source: "metacritic", value: 6 }, "movie")).toBeCloseTo(5.5, 1);
		expect(calibrate({ source: "anilist", value: 7 }, "anime")).toBeCloseTo(5.7, 1);
	});

	it("holds TV to film's standard", () => {
		const show = calibrate({ source: "imdb", value: 8 }, "tv");
		const movie = calibrate({ source: "imdb", value: 8 }, "movie");
		expect(show).toBeLessThan(movie);
	});

	it("tells a much-loved film from a merely loved one by its audience", () => {
		// The Dark Knight's 94% against The Return of the King's 86%: both past
		// where a Tomatometer stops separating, but not where an audience does.
		const loved = scoutScore(film(9, 90, 94, 94, 8.5), "movie") ?? 0;
		const less = scoutScore(film(9, 90, 94, 86, 8.5), "movie") ?? 0;
		expect(loved).toBeGreaterThan(less);
	});

	it("does not let a fan audience rescue a film everyone else panned", () => {
		// Five Nights at Freddy's 2: IMDb 5.1, Metacritic 26, RT 17% and 81%.
		const fnaf2 = scoutScore(film(5.1, 26, 17, 81, 6.6), "movie") ?? 0;
		expect(fnaf2).toBeLessThan(5);
	});

	it("keeps a fan Popcornmeter from lifting a film past better-liked ones", () => {
		// Jigsaw's 88% beside IMDb's 5.7, against Now You See Me 2, which every
		// average prefers but whose audience gave only 53%.
		const jigsaw = scoutScore(film(5.7, 39, 32, 88, 6.2), "movie") ?? 0;
		const nowYouSeeMe2 = scoutScore(film(6.4, 46, 33, 53, 6.8), "movie") ?? 0;
		expect(jigsaw).toBeLessThan(nowYouSeeMe2);
	});

	it("lets Metacritic speak for the critics when a film's Tomatometer is missing", () => {
		// Audiences keen, critics cool: without the Tomatometer, the blend should
		// still hear the critics about as much as it would have.
		const full = film(8.2, 62, 68, 88, 7.9);
		const withRt = scoutScore(full, "movie") ?? 0;
		const without = scoutScore(full.filter((one) => !one.source.startsWith("rt-")), "movie") ?? 0;
		expect(Math.abs(without - withRt)).toBeLessThanOrEqual(0.2);
	});

	it("takes an unknown source at its word", () => {
		expect(calibrate({ source: "", value: 7.3 }, "movie")).toBe(7.3);
	});
});

describe("series", () => {
	it("reads a series' Popcornmeter kinder than a film's", () => {
		// It averages the seasons, and audiences sour on late ones.
		const share = { source: "rt-audience", value: 8 } as const;
		expect(calibrate(share, "tv")).toBeGreaterThan(calibrate(share, "movie") + 0.5);
	});

	it("puts a well-liked series in the low eights", () => {
		// The Night Manager: IMDb 8.0, Metacritic 79, RT 88% and 75%.
		const nightManager: Reading[] = [
			{ source: "imdb", value: 8, votes: 200_000 },
			{ source: "metacritic", value: 7.9, votes: 30 },
			{ source: "rt-critics", value: 8.8, votes: 60 },
			{ source: "rt-audience", value: 7.5, votes: 1_000 },
			{ source: "tmdb", value: 7.7, votes: 2_000 },
		];
		const score = scoutScore(nightManager, "tv") ?? 0;
		expect(score).toBeGreaterThanOrEqual(8);
		expect(score).toBeLessThan(8.7);
	});
});

describe("Letterboxd and Trakt", () => {
	const lb = (value: number, kind: "movie" | "tv" = "movie") =>
		calibrate({ source: "letterboxd", value }, kind);
	const trakt = (value: number, kind: "movie" | "tv" = "movie") =>
		calibrate({ source: "trakt", value }, kind);

	it("reads Letterboxd stars the way its users mean them", () => {
		// 3.1 stars is an ordinary film, 4 a very good one, 4.5 the canon.
		expect(lb(6.2)).toBeGreaterThan(5);
		expect(lb(6.2)).toBeLessThan(6);
		expect(lb(8)).toBeGreaterThan(7.4);
		expect(lb(9)).toBeGreaterThanOrEqual(8.9);
	});

	it("marks down Trakt's bunched-high percentages", () => {
		expect(trakt(6.8)).toBeLessThan(5.6);
		expect(trakt(8)).toBeGreaterThan(7);
		expect(trakt(8)).toBeLessThan(7.8);
	});

	it("reads series on their own, higher curves", () => {
		expect(lb(8, "tv")).toBeLessThan(lb(8));
		expect(trakt(8, "tv")).toBeLessThan(trakt(8));
	});

	it("agrees with the other sources when they agree", () => {
		const base = film(7.8, 77, 93, 94, 8.2);
		const withBoth: Reading[] = [
			...base,
			{ source: "letterboxd", value: 8, votes: 1_000_000 },
			{ source: "trakt", value: 8.1, votes: 40_000 },
		];
		const gap = (scoutScore(withBoth, "movie") ?? 0) - (scoutScore(base, "movie") ?? 0);
		expect(Math.abs(gap)).toBeLessThanOrEqual(0.2);
	});
});

describe("TV's scale", () => {
	it("never reorders two series", () => {
		const show = (imdb: number) => scoutScore([{ source: "imdb", value: imdb }], "tv") ?? 0;
		for (let v = 7; v < 9.5; v += 0.1) expect(show(v + 0.1)).toBeGreaterThanOrEqual(show(v));
	});
});

describe("shown", () => {
	it("lifts a typical title to 7 and keeps the ends and the order", () => {
		expect(shown(5.5)).toBeCloseTo(7, 5);
		expect(shown(0)).toBe(0);
		expect(shown(10)).toBeCloseTo(10, 5);
		for (let x = 0; x < 10; x += 0.5) expect(shown(x + 0.5)).toBeGreaterThan(shown(x));
	});
});

describe("reality TV", () => {
	// The Traitors: fans and a few critics rate it like Sherlock.
	const traitors = [
		{ source: "imdb", value: 8.7, votes: 8907 },
		{ source: "metacritic", value: 8.3, votes: 21 },
		{ source: "rt-critics", value: 9, votes: 40 },
	];

	it("reads the best of the genre below the best of television", () => {
		const drama = scoutScore(traitors, "tv") ?? 0;
		const reality = scoutScore(traitors, "tv", { genres: ["Reality"] }) ?? 0;
		expect(reality).toBeLessThan(drama - 0.3);
		expect(reality).toBeGreaterThan(7.8);
	});

	it("reads the worst of it up, toward the middle", () => {
		const panned = [{ source: "imdb", value: 5.9, votes: 23_493 }];
		expect(scoutScore(panned, "tv", { genres: ["Reality"] }) ?? 0).toBeGreaterThan(
			(scoutScore(panned, "tv") ?? 0) + 0.5,
		);
	});
});

describe("thin samples", () => {
	it("does not believe a handful of votes", () => {
		const four = scoutScore([{ source: "tmdb", value: 10, votes: 4 }], "movie") ?? 0;
		expect(four).toBeLessThan(7.6);
	});

	/** You Can See Everything: 93 TMDB votes cost it its place under a classic. */
	it("does not let a thin source drag a title everyone else agrees on", () => {
		const settled = [
			{ source: "imdb", value: 9.1, votes: 26_917 },
			{ source: "letterboxd", value: 9.2, votes: 683_228 },
			{ source: "metacritic", value: 9.7, votes: 42 },
		];
		const alone = scoutScore(settled, "movie") ?? 0;
		const thin = scoutScore([...settled, { source: "tmdb", value: 9.4, votes: 93 }], "movie") ?? 0;
		expect(thin).toBeGreaterThanOrEqual(alone - 0.05);
	});

	it("still doubts thin sources when they are all there is", () => {
		const few = (votes: number) => [
			{ source: "imdb", value: 9, votes },
			{ source: "trakt", value: 9, votes },
			{ source: "tmdb", value: 9, votes },
		];
		expect(scoutScore(few(50), "movie") ?? 0).toBeLessThan((scoutScore(few(50_000), "movie") ?? 0) - 1);
	});

	it("ignores a source nobody has voted on", () => {
		expect(scoutScore([{ source: "tmdb", value: 8, votes: 0 }], "movie")).toBeUndefined();
	});

	it("has nothing to say about nothing", () => {
		expect(scoutScore([], "movie")).toBeUndefined();
		expect(scoutOf("tmdb", "movie", 0)).toBeUndefined();
	});
});

describe("scoutOfItem", () => {
	it("leaves out AniList's member count, which is not a vote count", () => {
		const item = {
			ref: { providerId: "anilist", kind: "anime" as const, id: "1" },
			title: "x",
			rating: 9,
			ratingCount: 3,
		};
		expect(scoutOfItem(item as never)).toBe(scoutOf("anilist", "anime", 9));
	});
});

describe("anticipation", () => {
	const now = new Date(2026, 10, 8).getTime();
	// Spider-Man: Beyond the Spider-Verse, seven months off, scored by Trakt alone.
	const anticipated = {
		kind: "movie" as const,
		readings: [{ source: "trakt", value: 8.6, votes: 7 }],
		releaseDate: "2027-06-16",
	};

	it("is a title not out yet that only pre-release sites have scored", () => {
		expect(isHype(["trakt"], { releaseDate: "2027-06-16" }, now)).toBe(true);
		expect(isHype(["trakt", "tmdb"], { year: 2028 }, now)).toBe(true);
		expect(isHype([], { releaseDate: "2027-06-16" }, now)).toBe(true);
	});

	it("is not anticipation once it is out, or once anyone who has seen it says so", () => {
		expect(isHype(["trakt"], { releaseDate: "2026-10-16" }, now)).toBe(false);
		// A festival film with reviews in, months before it opens.
		expect(isHype(["trakt", "rt-critics"], { releaseDate: "2027-03-01" }, now)).toBe(false);
		expect(isHype(["trakt"], {}, now)).toBe(false);
	});

	it("gives anticipation no Scout score", () => {
		expect(scoutOfEntry(anticipated, now)).toBeUndefined();
		expect(scoutOfEntry({ ...anticipated, releaseDate: "2025-06-16" }, now)).toBeDefined();
		const note = { kind: "movie" as const, sourceRating: 7.8, ref: { providerId: "tmdb" }, year: 2028 };
		expect(scoutOfEntry(note, now)).toBeUndefined();
	});

	it("gives a search result not out yet no Scout score", () => {
		const item = {
			ref: { providerId: "tmdb", kind: "movie" as const, id: "1" },
			title: "x",
			rating: 8,
			ratingCount: 40,
			releaseDate: "2099-01-01",
			tags: [],
		};
		expect(scoutOfItem(item as never)).toBeUndefined();
		expect(scoutOfItem({ ...item, releaseDate: "2001-01-01" } as never)).toBeDefined();
	});
});

describe("scoutOfEntry", () => {
	const now = new Date(2026, 10, 7).getTime();
	const note = (releaseDate?: string, year?: number) => ({
		kind: "movie" as const,
		sourceRating: 8.9,
		ref: { providerId: "tmdb" },
		...(releaseDate ? { releaseDate } : {}),
		...(year ? { year } : {}),
	});

	it("does not let a three-week-old score outrank a classic", () => {
		const fresh = scoutOfEntry(note("2026-10-16"), now) ?? 0;
		const classic = scoutOfEntry({ ...note("1994-09-23"), sourceRating: 8.7 }, now) ?? 0;
		expect(fresh).toBeLessThan(7.5);
		expect(classic).toBeGreaterThan(9);
	});

	it("trusts a score more as the months pass", () => {
		const weeks = scoutOfEntry(note("2026-10-16"), now) ?? 0;
		const months = scoutOfEntry(note("2026-05-01"), now) ?? 0;
		const year = scoutOfEntry(note("2025-06-01"), now) ?? 0;
		expect(weeks).toBeLessThan(months);
		expect(months).toBeLessThan(year);
	});

	it("takes an undated note, or one from an earlier year, as settled", () => {
		expect(scoutOfEntry(note(), now)).toBe(scoutOf("tmdb", "movie", 8.9));
		expect(scoutOfEntry(note(undefined, 2019), now)).toBe(scoutOf("tmdb", "movie", 8.9));
	});

	it("barely trusts a score on something not out yet", () => {
		expect(settledShare("2027-03-01", undefined, now)).toBeCloseTo(0.3);
	});
});

describe("the first months", () => {
	const now = new Date(2026, 10, 7).getTime();
	// Shaped like a documentary three weeks out: well-voted, and every source keen.
	const keen: Reading[] = [
		{ source: "imdb", value: 9.1, votes: 27000 },
		{ source: "tmdb", value: 8.9, votes: 400 },
		{ source: "rt-critics", value: 10, votes: 60 },
		{ source: "rt-audience", value: 9.8, votes: 900 },
	];
	const at = (releaseDate: string) =>
		explainScout(keen, "movie", { releaseDate }, now)?.exact ?? 0;

	it("holds a brand-new blend toward the middle, and lets it go over two months", () => {
		const weeks = at("2026-10-16");
		const weeksMore = at("2026-09-20");
		const settled = at("2026-08-01");
		expect(weeks).toBeLessThan(weeksMore);
		expect(weeksMore).toBeLessThan(settled);
		expect(at("2024-01-01")).toBe(settled);
		expect(settled - weeks).toBeLessThan(0.6);
	});

	it("holds a top score back a little until enough people have voted", () => {
		const settled = (votes: number): Reading[] =>
			keen.map((one) => (one.source === "imdb" ? { ...one, votes } : one));
		const few = explainScout(settled(27_000), "movie", {}, now);
		const many = explainScout(settled(3_000_000), "movie", {}, now);
		expect(few?.unproven ?? 0).toBeGreaterThan(0.03);
		expect(many?.unproven).toBe(0);
		expect((many?.exact ?? 0) - (few?.exact ?? 0)).toBeGreaterThan(0.05);
		expect((many?.exact ?? 0) - (few?.exact ?? 0)).toBeLessThan(0.2);
	});

	it("never lifts a panned new release toward the middle", () => {
		const panned: Reading[] = [
			{ source: "imdb", value: 4.8, votes: 20_000 },
			{ source: "rt-critics", value: 2, votes: 80 },
		];
		const fresh = explainScout(panned, "movie", { releaseDate: "2026-10-16" }, now);
		expect(fresh?.held).toBe(0);
		expect(fresh?.exact).toBe(explainScout(panned, "movie", {}, now)?.exact);
	});

	it("leaves an undated title alone", () => {
		expect(explainScout(keen, "movie", {}, now)?.exact).toBe(at("2025-06-01"));
	});

	it("says how much it held", () => {
		expect(explainScout(keen, "movie", { releaseDate: "2026-10-16" }, now)?.held).toBeGreaterThan(0.05);
		expect(explainScout(keen, "movie", { releaseDate: "2020-01-01" }, now)?.held).toBe(0);
	});
});
