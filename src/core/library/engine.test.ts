import { describe, expect, it } from "vitest";
import { entry, item, NOW, testConfig } from "../../test/fixtures";
import type { MediaItem, MediaKind } from "../types";
import {
	SuggestionEngine,
	type EngineInput,
	type SuggestionPort,
} from "./engine";
import type { LibraryEntry } from "./entry";
import type { FeedbackLog, ShownLog } from "./feedback";
import type { Suggestion } from "./recommend";
import type { RegistryFacts } from "./strategies";
import { buildTaste } from "./taste";

/**
 * The coverage that could not exist before.
 *
 * All of this lived in a `.tsx`, which vitest does not collect, so the row's
 * whole lifecycle — abandoning a round, surviving a source that throws,
 * re-ranking without re-asking — was untested. None of it needs a DOM; it
 * needed the code to not be inside a component.
 */

const config = testConfig();

/** A source that answers from a script and counts what it was asked. */
class FakeSource implements SuggestionPort {
	readonly asked: string[] = [];
	throws = false;
	private readonly answers: Map<string, MediaItem[]>;

	constructor(
		answers: Record<string, MediaItem[]> = {},
		readonly ownedTitles: ReadonlySet<string> = new Set(),
	) {
		this.answers = new Map(Object.entries(answers));
	}

	facts: RegistryFacts = {
		recommendable: () => ["tmdb"],
		discoverable: () => ["tmdb"],
		seriesAware: () => ["tmdb"],
	};

	async similar(
		providerId: string,
		ref: { id: string },
		signal: AbortSignal,
	): Promise<MediaItem[]> {
		this.asked.push(`similar:${ref.id}`);
		if (this.throws) throw new Error("the source is down");
		if (signal.aborted) return [];
		return this.answers.get(`similar:${ref.id}`) ?? [];
	}

	/** Answers by page number, for tests about how far down a catalogue it walks. */
	deep: ((page: number) => MediaItem[]) | null = null;

	async discover(
		providerId: string,
		query: { kind: MediaKind; page?: number },
	): Promise<MediaItem[]> {
		const page = query.page ?? 1;
		this.asked.push(`discover:${page}`);
		if (this.throws) throw new Error("the source is down");
		if (this.deep) return this.deep(page);
		return this.answers.get(`discover:${page}`) ?? [];
	}

	async series(providerId: string, ref: { id: string }): Promise<MediaItem[]> {
		this.asked.push(`series:${ref.id}`);
		if (this.throws) throw new Error("the source is down");
		return this.answers.get(`series:${ref.id}`) ?? [];
	}

	owned = (one: MediaItem) => this.ownedTitles.has(one.title);
}

function seeded(title: string, id: string): LibraryEntry {
	return entry({
		title,
		rating: 9,
		status: "Watched",
		tags: ["Science Fiction"],
		ref: { providerId: "tmdb", kind: "movie", id },
	});
}

function drive(
	port: SuggestionPort,
	entries: readonly LibraryEntry[],
	feedback: FeedbackLog = {},
	extra: Partial<EngineInput> = {},
): SuggestionEngine {
	const engine = new SuggestionEngine(port);
	engine.update({
		config,
		entries,
		profile: buildTaste(config, entries, NOW, feedback),
		feedback,
		kinds: ["movie"] as MediaKind[],
		now: NOW,
		...extra,
	});
	return engine;
}

/** Lets the in-flight round settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SuggestionEngine", () => {
	it("asks about your titles and shows what comes back", async () => {
		const port = new FakeSource({
			"similar:1": [item({ title: "Arrival" }), item({ title: "Sicario" })],
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		expect(port.asked).toContain("similar:1");
		expect(engine.state().shown.map((at) => at.item.title)).toEqual(
			expect.arrayContaining(["Arrival", "Sicario"]),
		);
	});

	it("draws nothing at all when there is nobody to ask", () => {
		const engine = new SuggestionEngine(new FakeSource());
		engine.update({
			config,
			entries: [],
			profile: buildTaste(config, [], NOW),
			feedback: {},
			kinds: [],
			now: NOW,
		});
		expect(engine.state().idle).toBe(true);
	});

	it("leaves out what is already on a shelf", async () => {
		const port = new FakeSource(
			{ "similar:1": [item({ title: "Arrival" }), item({ title: "Have it" })] },
			new Set(["Have it"]),
		);
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();
		expect(engine.state().shown.map((at) => at.item.title)).not.toContain(
			"Have it",
		);
	});

	// One source being unreachable must not empty the row.
	it("still returns a row when a source throws", async () => {
		const port = new FakeSource({ "similar:1": [item({ title: "Arrival" })] });
		port.throws = true;
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		const state = engine.state();
		expect(state.loading).toBe(false);
		expect(state.error).toBe("the source is down");
	});

	/**
	 * A thumbs-up changes how the answers already in hand are ordered. Asking
	 * again would make the button feel as though it had thrown the row away.
	 */
	it("re-ranks on a verdict without asking anything again", async () => {
		const port = new FakeSource({
			"similar:1": [item({ title: "Arrival" }), item({ title: "Nope" })],
		});
		const entries = [seeded("Dune", "1")];
		const engine = drive(port, entries);
		await settle();
		const asked = port.asked.length;

		const nope = engine.state().shown.find((at) => at.item.title === "Nope");
		const feedback: FeedbackLog = {
			[`${nope?.item.ref.providerId}:${nope?.item.ref.id}`]: {
				verdict: "disliked",
				at: NOW.getTime(),
				kind: "movie",
				title: "Nope",
				tags: [],
				people: [],
			},
		};
		engine.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW, feedback),
			feedback,
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});

		expect(port.asked.length).toBe(asked);
		expect(engine.state().shown.map((at) => at.item.title)).not.toContain("Nope");
	});

	it("stands the whole row aside when you ask for others", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 12 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		const first = engine.state().shown.map((at) => at.item.title);
		engine.more();
		const second = engine.state().shown.map((at) => at.item.title);
		expect(second.some((title) => first.includes(title))).toBe(false);
	});

	it("goes back and asks for more once the pool runs thin", async () => {
		const port = new FakeSource({
			"similar:1": [item({ title: "Only one" })],
			"discover:1": [],
			"discover:2": [item({ title: "Found later" })],
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		engine.more();
		await settle();
		expect(port.asked).toContain("discover:2");
	});

	// A new rating changes what the row should be asking about, so the answers
	// to the old questions are dropped rather than left lying around.
	it("abandons what it was asking when the seeds change underneath it", async () => {
		const port = new FakeSource({
			"similar:1": [item({ title: "From Dune" })],
			"similar:2": [item({ title: "From Arrival" })],
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		engine.update({
			config,
			entries: [seeded("Arrival", "2")],
			profile: buildTaste(config, [seeded("Arrival", "2")], NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();

		const titles = engine.state().shown.map((at) => at.item.title);
		expect(titles).toContain("From Arrival");
		expect(titles).not.toContain("From Dune");
	});

	it("does not ask again when nothing about the library changed", async () => {
		const port = new FakeSource({ "similar:1": [item({ title: "Arrival" })] });
		const entries = [seeded("Dune", "1")];
		const engine = drive(port, entries);
		await settle();
		const asked = port.asked.length;

		engine.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();
		expect(port.asked.length).toBe(asked);
	});

	/**
	 * The row used to keep this in memory only, so shutting Obsidian and
	 * opening it again brought back the same seven titles — which reads as
	 * "this is not learning" more loudly than any ranking error.
	 */
	it("does not show the same row again after a reload", async () => {
		const answers = {
			"similar:1": Array.from({ length: 14 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		};
		const entries = [seeded("Dune", "1")];

		const shown: Record<string, number> = {};
		const first = new SuggestionEngine(new FakeSource(answers));
		first.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
			shown,
			onShown: (keys) => {
				for (const key of keys) shown[key] = NOW.getTime();
			},
		});
		await settle();
		const before = first.state().shown.map((at) => at.item.title);
		expect(Object.keys(shown).length).toBe(before.length);

		// A whole new session, reading the log the last one left behind.
		const second = new SuggestionEngine(new FakeSource(answers));
		second.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
			shown,
		});
		await settle();
		const after = second.state().shown.map((at) => at.item.title);

		// Not "fewer of them": none of them. Fourteen answers, seven of which have
		// never been drawn, so there is no reason for the row to repeat itself and
		// it does not — a decaying penalty used to let its most confident picks
		// pay the charge and come straight back.
		expect(after.filter((title) => before.includes(title))).toEqual([]);
	});

	// The penalty decays rather than filtering, so a good suggestion is delayed
	// rather than lost for good.
	it("lets something shown a fortnight ago come back", async () => {
		const answers = { "similar:1": [item({ title: "Only one" })] };
		const entries = [seeded("Dune", "1")];
		const engine = new SuggestionEngine(new FakeSource(answers));
		engine.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
			shown: { "tmdb:whatever": NOW.getTime() - 14 * 86_400_000 },
		});
		await settle();
		expect(engine.state().shown.map((at) => at.item.title)).toContain("Only one");
	});

	it("keeps a snoozed title out until its date, and lets it back after", async () => {
		const answers = { "similar:1": [item({ title: "Not tonight" })] };
		const entries = [seeded("Dune", "1")];

		const build = (until: number, now: Date) => {
			const port = new FakeSource(answers);
			const engine = new SuggestionEngine(port);
			const first = answers["similar:1"][0];
			const feedback: FeedbackLog = {
				[`${first?.ref.providerId}:${first?.ref.id}`]: {
					verdict: "snoozed",
					at: NOW.getTime(),
					until,
					kind: "movie",
					title: "Not tonight",
					tags: [],
					people: [],
				},
			};
			engine.update({
				config,
				entries,
				profile: buildTaste(config, entries, now, feedback),
				feedback,
				kinds: ["movie"] as MediaKind[],
				now,
			});
			return engine;
		};

		const holding = build(NOW.getTime() + 30 * 86_400_000, NOW);
		await settle();
		expect(holding.state().shown).toHaveLength(0);

		const later = new Date(NOW.getTime() + 40 * 86_400_000);
		const lapsed = build(NOW.getTime() + 30 * 86_400_000, later);
		await settle();
		expect(lapsed.state().shown.map((at) => at.item.title)).toContain(
			"Not tonight",
		);
	});

	// Used to require a thumbs-down, which taught the model the opposite.
	it("takes away something you have already seen without holding it against it", async () => {
		const answers = {
			"similar:1": [item({ title: "Seen it" }), item({ title: "New" })],
		};
		const entries = [seeded("Dune", "1")];
		const port = new FakeSource(answers);
		const engine = new SuggestionEngine(port);
		const gone = answers["similar:1"][0];
		const feedback: FeedbackLog = {
			[`${gone?.ref.providerId}:${gone?.ref.id}`]: {
				verdict: "seen",
				at: NOW.getTime(),
				kind: "movie",
				title: "Seen it",
				tags: [],
				people: [],
			},
		};
		engine.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW, feedback),
			feedback,
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();
		const titles = engine.state().shown.map((at) => at.item.title);
		expect(titles).not.toContain("Seen it");
		expect(titles).toContain("New");
	});

	/**
	 * "Show me others" used to stop working after four presses, and not because
	 * anything had run out: exhaustion was counted rather than observed, so the
	 * button disabled itself on a schedule regardless of what the sources still
	 * had. A row that can be refreshed three times is a row with a bottom, and a
	 * bottom is the thing that makes people stop pressing.
	 */
	it("keeps giving you others however many times you ask", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 30 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		const rows: string[][] = [];
		for (let press = 0; press < 8; press++) {
			rows.push(engine.state().shown.map((at) => at.item.title));
			engine.more();
			await settle();
		}
		for (const row of rows) expect(row.length).toBeGreaterThan(0);
	});

	/**
	 * And when it genuinely has asked everything it can think of, it comes round
	 * again rather than sitting there. Going round is a worse answer than a new
	 * answer and a far better one than nothing.
	 */
	it("comes round again rather than running out", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 9 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		const first = engine.state().shown.map((at) => at.item.title);
		// Enough presses to walk past everything the one source ever had.
		for (let press = 0; press < 6; press++) {
			engine.more();
			await settle();
		}
		const later = engine.state().shown.map((at) => at.item.title);
		expect(later.length).toBeGreaterThan(0);
		// It has come back round to titles it stood aside several presses ago,
		// which is the whole point: the alternative was a blank row.
		expect(later.some((title) => first.includes(title))).toBe(true);
	});

	/**
	 * And what it comes round to is what you saw longest ago. Dropping the whole
	 * hold at once brought back the row you had just skipped past along with
	 * everything else, which is the difference between coming round and going in
	 * circles.
	 */
	it("brings the oldest row back before a newer one", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 21 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		// Three full rows, which is the whole pool.
		const rows: string[][] = [];
		for (let press = 0; press < 3; press++) {
			rows.push(engine.state().shown.map((at) => at.item.title));
			engine.more();
			await settle();
		}

		const again = engine.state().shown.map((at) => at.item.title);
		expect(again.length).toBeGreaterThan(0);
		expect(again.every((title) => rows[0]?.includes(title))).toBe(true);
		expect(again.some((title) => rows[1]?.includes(title))).toBe(false);
	});

	/**
	 * And it keeps working forwards through the pool rather than settling into a
	 * pair of rows.
	 *
	 * The bug this is here for, and the one people actually reported: past the
	 * third press the row alternated between the same two sets of seven for as
	 * long as anybody kept pressing. Both halves of it were wrong. The hold came
	 * off one stood-aside row at a time, so what came back was a *block* of seven
	 * — the same seven as last time — and whether to go and ask the sources for
	 * more was decided by counting the pool rather than by looking at the row it
	 * was about to draw, so on a pool it could not seat it never asked at all.
	 *
	 * Sixteen titles and seven seats: deliberately not a round number, because
	 * the ragged remainder is what tipped the old row into the alternation.
	 */
	it("keeps working through the pool instead of alternating two rows", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 16 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const entries = [seeded("Dune", "1")];
		const engine = new SuggestionEngine(port);
		const profile = buildTaste(config, entries, NOW);
		const shown: ShownLog = {};
		// A clock that moves, because how long ago you saw a thing is the whole of
		// what orders the come-round, and a fixed `now` cannot tell it anything.
		let now = NOW;
		const push = () =>
			engine.update({
				config,
				entries,
				profile,
				feedback: {},
				kinds: ["movie"] as MediaKind[],
				now,
				shown,
				onShown: (keys) => {
					for (const key of keys) shown[key] = now.getTime();
				},
			});
		push();
		await settle();

		const rows: string[][] = [];
		for (let press = 0; press < 8; press++) {
			push();
			rows.push(engine.state().shown.map((at) => at.item.title));
			engine.more();
			await settle();
			now = new Date(now.getTime() + 10 * 60 * 1000);
		}

		for (let at = 2; at < rows.length; at++) {
			expect(rows[at]).not.toEqual(rows[at - 2]);
		}
		// Every title in the catalogue gets its turn rather than two thirds of
		// them holding the row between them.
		const drawn = new Set(rows.flat());
		expect(drawn.size).toBe(16);
	});

	/**
	 * And what comes round comes round oldest first, which only works if being
	 * drawn again counts as being seen again.
	 *
	 * Each key used to be stamped once for the life of the engine, so a title the
	 * row had come back to four times in ten minutes still looked, to the
	 * cooldown, like something last seen when it first appeared — and the queue
	 * that decides what comes round next was ordered by a lie.
	 */
	it("stamps a title again when it comes back round", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 9 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const entries = [seeded("Dune", "1")];
		const engine = new SuggestionEngine(port);
		const profile = buildTaste(config, entries, NOW);
		const shown: ShownLog = {};
		let now = NOW;
		const push = () =>
			engine.update({
				config,
				entries,
				profile,
				feedback: {},
				kinds: ["movie"] as MediaKind[],
				now,
				shown,
				onShown: (keys) => {
					for (const key of keys) shown[key] = now.getTime();
				},
			});
		push();
		await settle();
		const first = engine.state().shown.map((at) => at.item.title);
		const stamps = { ...shown };

		// Press until the row has come round to something from the first one.
		let back: Suggestion[] = [];
		for (let press = 0; press < 6 && back.length === 0; press++) {
			engine.more();
			await settle();
			now = new Date(now.getTime() + 10 * 60 * 1000);
			push();
			back = engine
				.state()
				.shown.filter((at) => first.includes(at.item.title));
		}
		expect(back.length).toBeGreaterThan(0);
		for (const one of back) {
			const key = `${one.item.ref.providerId}:${one.item.ref.id}`;
			expect(shown[key]).toBeGreaterThan(stamps[key] ?? 0);
		}
	});

	/**
	 * The one the row was actually failing on.
	 *
	 * Whether to go and ask again was decided on the size of the pool, and a pool
	 * is never small — a hundred and forty candidates, every one of them already
	 * on screen this week. So the press never asked anybody anything, and the row
	 * shuffled the same hundred and forty until it gave up and repeated them.
	 * What has to be counted is what is left that you have *not* seen.
	 */
	it("asks again when everything left in the pool has already been shown", async () => {
		const answers = Array.from({ length: 40 }, (_, at) =>
			item({ title: `Film ${at}` }),
		);
		const port = new FakeSource({ "similar:1": answers });
		const shown = Object.fromEntries(
			answers.map((one) => [`${one.ref.providerId}:${one.ref.id}`, NOW.getTime()]),
		);
		const engine = drive(port, [seeded("Dune", "1")], {}, { shown });
		await settle();

		const before = port.asked.length;
		engine.more();
		await settle();
		expect(port.asked.length).toBeGreaterThan(before);
	});

	/**
	 * And a session that opens where the last one opened asks the same first four
	 * questions, gets the same answers, and has nothing but the same pool to make
	 * a row out of. The rotation is what makes reopening the hub different from
	 * never having closed it.
	 */
	it("asks about other titles of yours on a later session", async () => {
		const library = Array.from({ length: 8 }, (_, at) =>
			seeded(`Film ${at}`, String(at + 1)),
		);
		const first = new FakeSource();
		drive(first, library, {}, { rotation: 0 });
		const later = new FakeSource();
		drive(later, library, {}, { rotation: 1 });
		await settle();

		// The first round of each, not everything they eventually walked: with
		// nothing coming back they both keep asking until they run out of chase,
		// and where a session *starts* is the whole of what the rotation moves.
		const opened = (port: FakeSource) =>
			port.asked.filter((one) => one.startsWith("similar:")).slice(0, 4);
		expect(opened(first).length).toBeGreaterThan(0);
		expect(opened(later)).not.toEqual(opened(first));
	});

	/**
	 * The row reloading while you are reading it.
	 *
	 * A fetch was fired whenever the list of titles worth asking about changed at
	 * all, and that list is longer and livelier than it looks: strength is nudged
	 * by how recently something mattered, that is measured against the clock, and
	 * two seeds a hair apart swap places between one render and the next. Every
	 * swap threw away the row and put up a spinner. New seeds change what to ask
	 * *next*, which matters when the row needs more and not before.
	 */
	it("does not go back to the sources when the row is still full", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 40 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const entries = [seeded("Dune", "1")];
		const engine = drive(port, entries);
		await settle();

		const before = port.asked.length;
		const wider = [...entries, seeded("Blade Runner", "2")];
		engine.update({
			config,
			entries: wider,
			profile: buildTaste(config, wider, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();
		expect(port.asked.length).toBe(before);
		expect(engine.state().shown.length).toBeGreaterThan(0);
	});

	/**
	 * The row is not a repeat of itself.
	 *
	 * Drawing a row stamps it as shown, and anything shown lately is held out of
	 * the row while there is something fresh to take its place — so the moment
	 * the hub repainted for any reason at all, every card on screen was a card
	 * the row had "already shown you" and all seven were replaced. What the
	 * cooldown is for is the row you see *next*, not the one you are reading.
	 */
	it("holds the row still while you are looking at it", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 40 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const log: Record<string, number> = {};
		const entries = [seeded("Dune", "1")];
		const engine = drive(port, entries, {}, {
			shown: log,
			onShown: (keys) => {
				for (const key of keys) log[key] = NOW.getTime();
			},
		});
		await settle();

		const first = engine.state().shown.map((at) => at.item.title);
		// A repaint: same world, same engine, nothing asked for.
		engine.update({
			config,
			entries,
			profile: buildTaste(config, entries, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
			shown: log,
		});
		expect(engine.state().shown.map((at) => at.item.title)).toEqual(first);
	});

	/**
	 * One press, asked until it has an answer.
	 *
	 * A press asked exactly once, and a source asked about the same film twice
	 * answers the same twenty titles — so most rounds taught the row nothing, the
	 * press had nothing to show for itself, and the row came round to what it
	 * already had. Three presses to reach a rotation, all three looking like it
	 * was cycling.
	 *
	 * The catalogue rather than the seeds, because the page is what walks: round
	 * one asks page two, and nothing here is new until page four.
	 */
	it("keeps asking on one press until it has things you have not seen", async () => {
		const deeper = Array.from({ length: 9 }, (_, at) =>
			item({ title: `Deeper ${at}` }),
		);
		const first = Array.from({ length: 8 }, (_, at) =>
			item({ title: `Film ${at}` }),
		);
		const port = new FakeSource();
		// A full row up front, then nothing worth having until several pages down.
		port.deep = (page) => (page === 1 ? first : page >= 3 ? deeper : []);
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();
		expect(port.asked.filter((one) => one === "discover:3")).toHaveLength(0);

		engine.more();
		await settle();
		const pages = new Set(
			port.asked.filter((one) => one.startsWith("discover:")),
		);
		expect(pages.size).toBeGreaterThan(2);
		expect(engine.state().shown.map((at) => at.item.title).join()).toContain(
			"Deeper",
		);
	});

	/**
	 * And while it is still asking, it does not put back the row you just
	 * skipped. Coming round is the answer to "there is nothing else", and a
	 * question still out with the sources is not nothing else — so a press that
	 * had new titles seconds away spent those seconds showing the old ones, which
	 * is precisely what cycling looks like.
	 */
	it("does not come round while it is still asking", async () => {
		const port = new FakeSource({
			"similar:1": Array.from({ length: 16 }, (_, at) =>
				item({ title: `Film ${at}` }),
			),
		});
		const engine = drive(port, [seeded("Dune", "1")]);
		await settle();

		// Two rows stood aside, so there is something for it to come round to.
		const first = engine.state().shown.map((at) => at.item.title);
		engine.more();
		await settle();
		engine.state();
		engine.more();

		const during = engine.state();
		expect(during.loading).toBe(true);
		expect(during.shown.length).toBeLessThan(first.length);
		expect(during.shown.some((at) => first.includes(at.item.title))).toBe(false);
	});

	it("does ask when the seeds change and it has nothing left to show", async () => {
		const port = new FakeSource();
		const entries = [seeded("Dune", "1")];
		const engine = drive(port, entries);
		await settle();

		const before = port.asked.length;
		const wider = [...entries, seeded("Blade Runner", "2")];
		engine.update({
			config,
			entries: wider,
			profile: buildTaste(config, wider, NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();
		expect(port.asked.length).toBeGreaterThan(before);
	});

	it("tells whoever is watching when the answers land", async () => {
		const port = new FakeSource({ "similar:1": [item({ title: "Arrival" })] });
		let told = 0;
		const engine = new SuggestionEngine(port);
		engine.subscribe(() => {
			told += 1;
		});
		engine.update({
			config,
			entries: [seeded("Dune", "1")],
			profile: buildTaste(config, [seeded("Dune", "1")], NOW),
			feedback: {},
			kinds: ["movie"] as MediaKind[],
			now: NOW,
		});
		await settle();
		expect(told).toBeGreaterThan(0);
	});
});
