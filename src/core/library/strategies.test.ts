import { describe, expect, it } from "vitest";
import { entry, NOW, opinionated, testConfig } from "../../test/fixtures";
import type { MediaKind } from "../types";
import {
	planRound,
	roundsAvailable,
	SEEDS_PER_ROUND,
	type RegistryFacts,
	type Seed,
} from "./strategies";
import { buildTaste } from "./taste";

const config = testConfig();
const profile = buildTaste(config, opinionated(), NOW);

/** Everything can do everything, unless a test says otherwise. */
function facts(over: Partial<RegistryFacts> = {}): RegistryFacts {
	return {
		recommendable: () => ["tmdb"],
		discoverable: () => ["tmdb"],
		seriesAware: () => ["tmdb"],
		...over,
	};
}

function seed(title: string, id: string, strength = 0.8): Seed {
	return {
		entry: entry({
			title,
			ref: { providerId: "tmdb", kind: "movie", id },
		}),
		strength,
	};
}

const plan = (
	seeds: Seed[],
	round = 0,
	over: Partial<RegistryFacts> = {},
	standard?: number,
) =>
	planRound(
		{
			profile,
			seeds,
			kinds: ["movie"] as MediaKind[],
			facts: facts(over),
			...(standard === undefined ? {} : { standard }),
		},
		round,
	);

/** The rating floors of every request in a round that carries one. */
const floors = (requests: ReturnType<typeof plan>) =>
	requests.flatMap((one) =>
		one.query?.minRating === undefined ? [] : [one.query.minRating],
	);

describe("the standard a round is planned to", () => {
	/**
	 * The one thing about a person the model cannot learn by watching them, so
	 * the one thing worth a control. Everything that browses a catalogue moves
	 * with it; nothing that follows one of your own titles does, because a
	 * neighbour of something you loved never went through a rating filter.
	 */
	it("raises every catalogue floor when you ask for better", () => {
		const usual = floors(plan([seed("Arrival", "1")], 0, {}, 6.8));
		const picky = floors(plan([seed("Arrival", "1")], 0, {}, 8));

		expect(usual).not.toHaveLength(0);
		expect(picky).toHaveLength(usual.length);
		for (const [at, floor] of picky.entries()) {
			expect(floor).toBeCloseTo((usual[at] ?? 0) + 1.2, 5);
		}
	});

	it("lowers them again when you do not mind what turns up", () => {
		const relaxed = floors(plan([seed("Arrival", "1")], 0, {}, 5.5));
		expect(Math.max(...relaxed)).toBeLessThan(6.5);
	});

	// The punt is spending the one seat that is not about you, so it asks for
	// more than the rest of the round — wherever the rest of the round is set.
	it("keeps the punt above the rest of the round", () => {
		const requests = plan([seed("Arrival", "1")], 0, {}, 7);
		const punt = requests.find((one) => one.origin.strategy === "wildcard");
		const explore = requests.find((one) => one.origin.strategy === "explore");
		expect(punt?.query?.minRating ?? 0).toBeGreaterThan(
			explore?.query?.minRating ?? 0,
		);
	});
});

describe("planRound", () => {
	it("asks a source what is like each of your titles", () => {
		const requests = plan([seed("Arrival", "1"), seed("Dune", "2")]);
		const similar = requests.filter((one) => one.op === "similar");
		expect(similar).toHaveLength(2);
		expect(similar[0]?.origin.seed).toBe("Arrival");
		expect(similar[0]?.origin.strategy).toBe("exploit");
	});

	// Neighbours of what you own can only ever return more of what you own.
	it("asks the catalogue something as well as asking about your own titles", () => {
		const requests = plan([seed("Arrival", "1")]);
		expect(requests.some((one) => one.op === "discover")).toBe(true);
		expect(
			requests.find((one) => one.op === "discover")?.origin.strategy,
		).toBe("explore");
	});

	/**
	 * `registry.discoverable()` only ever checked whether a source had its
	 * credentials, so a source the user had switched off in settings was still
	 * being asked for suggestions. The facts this is handed now account for it.
	 */
	it("asks nothing of a source that is switched off", () => {
		const requests = plan([seed("Arrival", "1")], 0, {
			recommendable: () => [],
			discoverable: () => [],
		});
		expect(requests).toEqual([]);
	});

	it("leaves alone a title whose source cannot say what is like it", () => {
		const requests = plan([seed("Arrival", "1")], 0, {
			recommendable: () => ["anilist"],
		});
		expect(requests.some((one) => one.op === "similar")).toBe(false);
	});

	it("passes over a note that never recorded where it came from", () => {
		const nameless: Seed = { entry: entry({ title: "Hand-written" }), strength: 1 };
		expect(plan([nameless]).some((one) => one.op === "similar")).toBe(false);
	});

	// Otherwise "show me others" asks the same four questions and gets the same
	// four answers, and the button does nothing.
	it("moves on to the next titles on a later round", () => {
		const seeds = Array.from({ length: 8 }, (_, at) =>
			seed(`Film ${at}`, String(at)),
		);
		const first = plan(seeds, 0)
			.filter((one) => one.op === "similar")
			.map((one) => one.origin.seed);
		const second = plan(seeds, 1)
			.filter((one) => one.op === "similar")
			.map((one) => one.origin.seed);

		expect(first).toHaveLength(SEEDS_PER_ROUND);
		expect(second).toHaveLength(SEEDS_PER_ROUND);
		expect(second.some((title) => first.includes(title))).toBe(false);
	});

	it("walks further down the catalogue on a later round", () => {
		const page = (round: number) =>
			plan([], round).find((one) => one.op === "discover")?.query?.page;
		expect(page(1)).toBeGreaterThan(page(0) ?? 0);
	});

	it("never asks one source the same question twice in a round", () => {
		const twice = [seed("Arrival", "1"), seed("Arrival again", "1")];
		expect(plan(twice).filter((one) => one.op === "similar")).toHaveLength(1);
	});

	/**
	 * The row stopped having anything to say after four presses. Slicing past the
	 * end of the seed list asked about seeds twenty-one to twenty-four of a list
	 * of eighteen — that is, about nothing — and "show me others" went quiet on a
	 * library with plenty more to offer.
	 */
	it("keeps asking about something on a round far past the end", () => {
		const seeds = [seed("A", "1"), seed("B", "2"), seed("C", "3")];
		expect(plan(seeds, 9).filter((one) => one.op === "similar")).not.toHaveLength(
			0,
		);
	});
});

/**
 * The row was films and television and nothing else, and this was why: the two
 * kinds the library held most of won every round, so the books on the shelf were
 * never once asked about.
 */
describe("which kinds get asked about", () => {
	const mixed = [
		entry({ kind: "movie", rating: 9, status: "Watched" }),
		entry({ kind: "movie", rating: 8, status: "Watched" }),
		entry({ kind: "tv", rating: 8, status: "Watched" }),
		entry({ kind: "book", rating: 9, status: "Watched" }),
		entry({ kind: "anime", rating: 8, status: "Watched" }),
	];
	const kinds: MediaKind[] = ["movie", "tv", "book", "anime"];

	const asked = (round = 0) => {
		const requests = planRound(
			{
				profile: buildTaste(config, mixed, NOW),
				seeds: [],
				kinds,
				facts: facts(),
			},
			round,
		);
		return new Set(
			requests.flatMap((one) => (one.query?.kind ? [one.query.kind] : [])),
		);
	};

	it("asks about every kind you actually engage with", () => {
		expect(asked().size).toBeGreaterThan(2);
		expect(asked().has("book")).toBe(true);
	});

	it("leaves out a kind no source can browse", () => {
		expect(asked().has("game" as MediaKind)).toBe(false);
	});

	// A backlog is not a preference: forty unread books say you mean to read
	// books, not that going and finding a forty-first would help.
	it("says nothing about a kind sitting unopened on the shelf", () => {
		const shelved = [
			entry({ kind: "movie", rating: 9, status: "Watched" }),
			entry({ kind: "book", status: "To read" }),
			entry({ kind: "book", status: "To read" }),
		];
		const requests = planRound(
			{
				profile: buildTaste(config, shelved, NOW),
				seeds: [],
				kinds: ["movie", "book"] as MediaKind[],
				facts: facts(),
			},
			0,
		);
		const wanted = requests.flatMap((one) =>
			one.query?.kind ? [one.query.kind] : [],
		);
		expect(wanted).not.toContain("book");
	});
});

describe("the strategies beyond the first two", () => {
	const enrichment = {
		"tmdb:1": {
			v: 1,
			at: 0,
			keywords: [{ name: "time loop", id: "4565" }],
			people: [],
			directors: [{ name: "Denis Villeneuve", id: "137427" }],
			studios: [],
			series: { id: "tmdb:8091", name: "Alien" },
		},
		"tmdb:2": {
			v: 1,
			at: 0,
			keywords: [{ name: "time loop", id: "4565" }],
			people: [],
			directors: [{ name: "Denis Villeneuve", id: "137427" }],
			studios: [],
			series: { id: "tmdb:8091", name: "Alien" },
		},
	};

	/** A library that has read up on itself and has an opinion. */
	function studied() {
		const entries = [
			entry({
				tags: ["Science Fiction"],
				rating: 9,
				status: "Watched",
				ref: { providerId: "tmdb", kind: "movie", id: "1" },
			}),
			entry({
				tags: ["Science Fiction"],
				rating: 9,
				status: "Watched",
				ref: { providerId: "tmdb", kind: "movie", id: "2" },
			}),
			entry({ tags: ["Romance"], rating: 3, status: "Watched" }),
			entry({ tags: ["Romance"], rating: 3, status: "Watched" }),
		];
		return {
			profile: buildTaste(config, entries, NOW, {}, { enrichment }),
			seeds: entries
				.filter((one) => one.ref)
				.map((one) => ({ entry: one, strength: 0.9 })),
		};
	}

	const planStudied = (round = 0) => {
		const { profile, seeds } = studied();
		return planRound(
			{
				profile,
				seeds,
				kinds: ["movie"] as MediaKind[],
				facts: facts(),
				enrichment,
			},
			round,
		);
	};

	// The sentence eighteen genres can never produce.
	it("goes looking for the thing you keep going for", () => {
		const keyword = planStudied().find((one) => one.origin.strategy === "keyword");
		expect(keyword?.origin.label).toBe("time loop");
		expect(keyword?.query?.keywords?.[0]?.id).toBe("4565");
	});

	it("says nothing about keywords before anything has read up on the library", () => {
		const bare = plan([seed("Arrival", "1")]);
		expect(bare.some((one) => one.origin.strategy === "keyword")).toBe(false);
	});

	// A strong director affinity used to produce no candidates whatsoever.
	it("goes looking for more from a name you keep coming back to", () => {
		const person = planStudied().find((one) => one.origin.strategy === "person");
		expect(person?.origin.label).toBe("Denis Villeneuve");
		expect(person?.query?.crew?.[0]?.id).toBe("137427");
	});

	it("needs more than one film before it follows a director", () => {
		const once = [
			entry({
				tags: ["Drama"],
				rating: 9,
				status: "Watched",
				authored: ["Someone Once"],
				people: ["Someone Once"],
			}),
			entry({ tags: ["Romance"], rating: 3, status: "Watched" }),
		];
		const requests = planRound(
			{
				profile: buildTaste(config, once, NOW),
				seeds: [],
				kinds: ["movie"] as MediaKind[],
				facts: facts(),
			},
			0,
		);
		expect(requests.some((one) => one.origin.strategy === "person")).toBe(false);
	});

	it("asks about a series you have several of", () => {
		const series = planStudied().find((one) => one.op === "series");
		expect(series?.origin.strategy).toBe("franchise");
		expect(series?.origin.label).toBe("More of Alien");
	});

	it("asks about no series when nothing has told it about one", () => {
		expect(plan([seed("Arrival", "1")]).some((one) => one.op === "series")).toBe(
			false,
		);
	});

	// A row that only confirms what it already believes narrows for as long as
	// you use it.
	it("always plans exactly one punt", () => {
		const punts = planStudied().filter(
			(one) => one.origin.strategy === "wildcard",
		);
		expect(punts).toHaveLength(1);
	});

	it("punts at something the library does not already have", () => {
		const punt = planStudied().find((one) => one.origin.strategy === "wildcard");
		expect(punt?.query?.genres).not.toContain("Science Fiction");
	});

	/**
	 * The row went looking for the genres in its own "steering away from"
	 * column. `topTraits(…, "liked")` returns only what scores above your
	 * average, so a genre you had rated 3 twice was not in the list of genres it
	 * knew about, and "you have little Romance" is not a true sentence about
	 * somebody who has two of them and did not enjoy either.
	 */
	it("does not punt at something you have turned down", () => {
		// Every round the list has, since the punt walks it one door per press.
		const genres = [0, 1, 2, 3, 4, 5, 6, 7].map(
			(round) =>
				planStudied(round).find((one) => one.origin.strategy === "wildcard")
					?.query?.genres?.[0],
		);
		expect(genres.filter(Boolean).length).toBeGreaterThan(0);
		expect(genres).not.toContain("Romance");
	});

	// Otherwise "show me others" asks the identical questions and gets the
	// identical answers.
	it("asks about different things on a later round", () => {
		const first = planStudied(0).find((one) => one.origin.strategy === "wildcard");
		const second = planStudied(1).find((one) => one.origin.strategy === "wildcard");
		expect(second?.query?.genres?.[0]).not.toBe(first?.query?.genres?.[0]);
	});

	/**
	 * A thumbs-up used to produce no candidates at all: it nudged a dozen trait
	 * averages by a fraction and was otherwise inert, so the most direct thing
	 * anybody can say to a recommender did the least of anything they could do.
	 */
	it("treats something you thumbed up as a question worth asking", () => {
		const requests = planRound(
			{
				profile: buildTaste(config, [], NOW),
				seeds: [],
				kinds: ["movie"] as MediaKind[],
				facts: facts(),
				liked: [
					{
						ref: { providerId: "tmdb", kind: "movie", id: "77" },
						title: "Something you liked",
					},
				],
			},
			0,
		);
		const asked = requests.find((one) => one.ref?.id === "77");
		expect(asked?.op).toBe("similar");
		expect(asked?.origin.seed).toBe("Something you liked");
	});
});

describe("roundsAvailable", () => {
	it("keeps paging the catalogue after your own titles run out", () => {
		expect(roundsAvailable([seed("Only one", "1")], ["movie"])).toBeGreaterThan(1);
	});

	it("stops when there is neither a title nor a catalogue", () => {
		expect(roundsAvailable([], [])).toBe(0);
	});
});
