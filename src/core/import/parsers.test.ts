import { describe, expect, it } from "vitest";
import { fromAniList } from "./anilist";
import { parseGoodreads, shelfTone } from "./goodreads";
import { parseLetterboxd } from "./letterboxd";
import { parseImportFiles } from "./parse";
import { parseStoryGraph, readsOf } from "./storygraph";
import { item } from "../../test/fixtures";

describe("parseLetterboxd", () => {
	const files = [
		{
			name: "watched.csv",
			text: "Date,Name,Year,Letterboxd URI\n2021-02-01,Arrival,2016,https://boxd.it/a\n2022-05-01,Heat,1995,https://boxd.it/h\n",
		},
		{
			name: "ratings.csv",
			text: "Date,Name,Year,Letterboxd URI,Rating\n2021-02-02,Arrival,2016,https://boxd.it/a,4.5\n",
		},
		{
			name: "diary.csv",
			text:
				"Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n" +
				"2021-02-02,Arrival,2016,https://boxd.it/d1,4,,,2021-01-30\n" +
				"2023-06-10,Arrival,2016,https://boxd.it/d2,4.5,Yes,,2023-06-09\n",
		},
		{
			name: "reviews.csv",
			text:
				"Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n" +
				'2023-06-10,Arrival,2016,https://boxd.it/d2,4.5,Yes,"Even better,<br/>the second time.",,2023-06-09\n',
		},
		{
			name: "watchlist.csv",
			text: "Date,Name,Year,Letterboxd URI\n2020-03-03,Stalker,1979,https://boxd.it/s\n",
		},
		{ name: "films.csv", text: "Date,Name,Year,Letterboxd URI\n2021-02-02,Arrival,2016,https://boxd.it/a\n" },
		{ name: "profile.csv", text: "Username\nme\n" },
	];
	const { records, ignored } = parseLetterboxd(files);
	const byTitle = (title: string) => records.find((r) => r.title === title);

	it("merges every file about a film into one row", () => {
		expect(records).toHaveLength(3);
		const arrival = byTitle("Arrival");
		expect(arrival).toMatchObject({
			kind: "movie",
			year: 2016,
			tone: "done",
			rating: 0.9,
			finished: "2023-06-09",
			history: ["2021-01-30"],
			favorite: true,
			review: "Even better,\nthe second time.",
		});
	});

	it("falls back to the watched date when there is no diary", () => {
		expect(byTitle("Heat")).toMatchObject({ tone: "done", finished: "2022-05-01" });
		expect(byTitle("Heat")?.rating).toBeUndefined();
	});

	it("puts the watchlist on the planned shelf, with its date added", () => {
		expect(byTitle("Stalker")).toMatchObject({
			tone: "planned",
			added: "2020-03-03",
			finished: undefined,
		});
	});

	it("reports files that are not part of an export", () => {
		expect(ignored).toEqual(["profile.csv"]);
	});
});

describe("parseGoodreads", () => {
	const text =
		"Book Id,Title,Author,Additional Authors,ISBN,ISBN13,My Rating,Year Published,Original Publication Year,Date Read,Date Added,Exclusive Shelf,My Review,Read Count\n" +
		'2767052,"The Hunger Games (The Hunger Games, #1)",Suzanne Collins,,"=""0439023483""","=""9780439023481""",4,2008,2008,2012/03/05,2011/12/01,read,"Tense.<br/><br/>Good.",2\n' +
		'1,Dune,Frank Herbert,,"=""""","=""""",0,2005,1965,,2020/01/01,to-read,,0\n' +
		"2,Ulysses,James Joyce,,,,0,1922,1922,,2019/05/05,dnf,,0\n";
	const records = parseGoodreads(text);

	it("unwraps ISBNs and strips the series from the title", () => {
		expect(records[0]).toMatchObject({
			key: "goodreads:2767052",
			title: "The Hunger Games",
			authors: ["Suzanne Collins"],
			isbns: ["9780439023481", "0439023483"],
			year: 2008,
			tone: "done",
			rating: 0.8,
			finished: "2012-03-05",
			added: "2011-12-01",
			review: "Tense.\n\nGood.",
		});
	});

	it("reads zero as unrated and prefers the original year", () => {
		expect(records[1]).toMatchObject({ title: "Dune", year: 1965, tone: "planned", isbns: [] });
		expect(records[1]?.rating).toBeUndefined();
	});

	it("reads custom shelves for what they mean", () => {
		expect(records[2]?.tone).toBe("dropped");
		expect(shelfTone("on-hold")).toBe("paused");
		expect(shelfTone("favourites")).toBe("planned");
	});
});

describe("parseStoryGraph", () => {
	it("keeps every read as history", () => {
		expect(readsOf("2023/01/05-2023/01/20, 2022/06/09")).toEqual([
			{ start: "2023-01-05", end: "2023-01-20" },
			{ end: "2022-06-09" },
		]);
		expect(readsOf("2024/02/01-")).toEqual([{ start: "2024-02-01" }]);
	});

	const text =
		"Title,Authors,ISBN/UID,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Star Rating,Review\n" +
		"Piranesi,Susanna Clarke,9781635575637,read,2021/01/01,2023/01/20,\"2023/01/05-2023/01/20, 2022/06/09\",2,4.25,Strange.\n" +
		"Middlemarch,George Eliot,abc-uid,currently-reading,2020/01/01,,2024/02/01-,0,,\n";
	const [piranesi, middlemarch] = parseStoryGraph(text);

	it("maps a finished book with a quarter-star rating", () => {
		expect(piranesi).toMatchObject({
			key: "isbn:9781635575637",
			tone: "done",
			rating: 0.85,
			started: "2023-01-05",
			finished: "2023-01-20",
			history: ["2022-06-09"],
			review: "Strange.",
		});
	});

	it("maps a book in progress, keyed by its uid", () => {
		expect(middlemarch).toMatchObject({
			key: "storygraph:abc-uid",
			tone: "active",
			started: "2024-02-01",
			finished: undefined,
			history: [],
			isbns: [],
		});
	});

	it("drops duplicate rows across picked files", () => {
		const twice = parseImportFiles("storygraph", [
			{ name: "a.csv", text },
			{ name: "b.csv", text },
		]);
		expect(twice.records).toHaveLength(2);
	});
});

describe("fromAniList", () => {
	const anime = item({ ref: { providerId: "anilist", kind: "anime", id: "1" }, title: "Frieren", year: 2023 });
	const manga = item({ ref: { providerId: "anilist", kind: "manga", id: "2" }, title: "Berserk" });

	it("maps lists, scores out of 100, and full dates", () => {
		const [done, rewatch] = fromAniList([
			{
				item: anime,
				entry: {
					status: "COMPLETED",
					score: 95,
					progress: 28,
					startedAt: { year: 2023, month: 9, day: 29 },
					completedAt: { year: 2024, month: 3, day: 22 },
					notes: "Perfect.",
					createdAt: 1696000000,
				},
			},
			{
				item: manga,
				entry: {
					status: "REPEATING",
					score: 0,
					completedAt: { year: 2019, month: 1, day: 2 },
					startedAt: { year: 2024, month: null, day: null },
				},
			},
		]);
		expect(done).toMatchObject({
			key: "anilist:1",
			kind: "anime",
			item: anime,
			tone: "done",
			rating: 0.95,
			progress: 28,
			started: "2023-09-29",
			finished: "2024-03-22",
			review: "Perfect.",
			added: "2023-09-29",
		});
		expect(rewatch).toMatchObject({
			kind: "manga",
			tone: "active",
			history: ["2019-01-02"],
			finished: undefined,
			started: undefined,
		});
		expect(rewatch?.rating).toBeUndefined();
	});
});
