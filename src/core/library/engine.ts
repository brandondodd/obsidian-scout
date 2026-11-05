import { isAbortError } from "../http";
import type { DiscoverQuery } from "../provider";
import type { MediaItem, MediaKind, MediaRef } from "../types";
import type { LibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";
import { likedSeeds, type FeedbackLog, type ShownLog } from "./feedback";
import { anchorsOf, type Anchor } from "./neighbours";
import type { TraitOptions } from "./traits";
import {
	emptyPool,
	heldBack,
	mergeSuggestions,
	rankSuggestions,
	recommendationSeeds,
	suggestionKey,
	type Suggestion,
	type SuggestionPool,
} from "./recommend";
import {
	planRound,
	roundsAvailable,
	type RegistryFacts,
	type Request,
	type Seed,
} from "./strategies";
import type { TasteProfile } from "./taste";

/**
 * The part that actually asks, and remembers what came back.
 *
 * This lived inside `HomeView.tsx` — a pool in a `useRef`, a `useReducer` used
 * as a repaint trigger, an `AbortController` in another ref, and a fetch
 * function rebuilt by `useCallback` on every profile change. It worked, and it
 * had no tests, because vitest collects `src/**\/*.test.ts` and it was sitting
 * in a `.tsx`. Every question worth asking about the row — does it abandon a
 * round when the seeds change under it, does it survive one source throwing,
 * does it re-rank on a thumbs-up without asking anything again — was
 * unanswerable without standing up a DOM.
 *
 * Out here it is an object with a `subscribe`, which is what the component
 * needed from it all along.
 */

/** One full rail. */
export const SHOWN = 7;

/**
 * How many of your own titles are in play across all rounds.
 *
 * Fifteen, with four asked about per round, is under four presses of "show me
 * others" before the row comes round to seeds it has already asked about. On a
 * library with a hundred and thirty things worth asking about, that is a strange
 * thing to run out of.
 *
 * A hundred and twenty-eight is thirty-two rounds of questions nobody has been
 * asked yet, and on a library of this size it is very nearly all of it rather
 * than a quarter. It costs nothing to widen: the seeds are ranked here and spent
 * four at a time, so depth buys variety across presses and not one extra request.
 *
 * Depth only started mattering once the window moved. While every session began
 * at seed nought, the eighteenth seed was as unreachable at a depth of sixty-four
 * as at a depth of eight — see `EngineInput.rotation`.
 */
const SEED_DEPTH = 128;

/**
 * Fetches that came back with nothing new before the row admits defeat.
 *
 * Exhaustion used to be counted rather than observed: `round + 1 >=
 * roundsAvailable(...)` capped the row at four presses whether or not there was
 * anything left, and the button then disabled itself on a library that had
 * plenty more to say. Two barren fetches in a row is the real signal, and it is
 * the only one that can be right on both a library of nine and a library of nine
 * hundred.
 */
const BARREN_LIMIT = 2;

/**
 * Everything the engine needs from the outside world, as functions.
 *
 * Deliberately not the provider registry and not `ScoutContext`: a test hands
 * this an object with three scripted methods and never touches Obsidian.
 */
export interface SuggestionPort {
	facts: RegistryFacts;
	similar(
		providerId: string,
		ref: MediaRef,
		signal: AbortSignal,
	): Promise<MediaItem[]>;
	discover(
		providerId: string,
		query: DiscoverQuery,
		signal: AbortSignal,
	): Promise<MediaItem[]>;
	/** The rest of the series this one belongs to. */
	series(
		providerId: string,
		ref: MediaRef,
		signal: AbortSignal,
	): Promise<MediaItem[]>;
	/** True for anything already on a shelf. */
	owned(item: MediaItem): boolean;
}

export interface EngineInput {
	config: LibraryConfig;
	entries: readonly LibraryEntry[];
	profile: TasteProfile;
	feedback: Readonly<FeedbackLog>;
	/** When each suggestion was last drawn, so a reload rotates the row. */
	shown?: Readonly<ShownLog>;
	/** Kinds some configured source can be asked to browse. */
	kinds: readonly MediaKind[];
	/**
	 * Where in the seed list this session starts asking.
	 *
	 * Every round is planned from the round number — which seeds get asked
	 * about, which series, which keyword, how far down the catalogue — and the
	 * round number started at nought every time the hub was opened. So the row
	 * asked the same four titles about the same four things, got back what it got
	 * back last time, and then had to choose seven from a pool it had already
	 * shown you. The rotation is carried across sessions and added to the round,
	 * which turns "the same questions in a different order" into different
	 * questions.
	 */
	rotation?: number;
	/** So the favourites the anchors are built from get their full traits. */
	traitOptions?: TraitOptions;
	now?: Date;
	/**
	 * Told what the row has just drawn, so it can be written down.
	 *
	 * A callback rather than the engine reaching for the settings store,
	 * because a test then has no store to stand up — and because it makes the
	 * one direction this can flow obvious.
	 */
	onShown?: (keys: readonly string[]) => void;
}

export interface EngineState {
	shown: Suggestion[];
	loading: boolean;
	error: string | null;
	/** Nothing left to ask anybody. */
	exhausted: boolean;
	/** No seeds and no catalogue: the row should not be drawn at all. */
	idle: boolean;
}

const IDLE: EngineState = {
	shown: [],
	loading: false,
	error: null,
	exhausted: true,
	idle: true,
};

export class SuggestionEngine {
	private readonly listeners = new Set<() => void>();
	private pool: SuggestionPool = emptyPool();
	/**
	 * The rows stood aside this session, oldest first.
	 *
	 * A list of rows rather than one set of keys, so that when the pool runs thin
	 * enough that something has to come back, what comes back is the row you were
	 * looking at longest ago rather than all of them at once.
	 */
	private aside: string[][] = [];
	private live: AbortController | null = null;

	private input: EngineInput | null = null;
	private anchors: Anchor[] = [];
	/**
	 * The row last written to the shown log, so a redraw does not restamp it.
	 *
	 * The last row and not every row this session, which is a fix rather than a
	 * simplification. Stamping each key once for the life of the engine meant a
	 * title's stamp said when it *first* appeared, so something the row had come
	 * round to four times in ten minutes still looked, to the cooldown, like
	 * something last seen this morning — and knowing how long it has actually
	 * been since you saw a thing is the whole job of that stamp. Anything that
	 * leaves the row and comes back is stamped again on the way in.
	 */
	private recorded: ReadonlySet<string> = new Set();
	/**
	 * What is on screen this moment, which its own cooldown must not hold back.
	 *
	 * Drawing a row writes it down as shown, and anything shown lately is held
	 * out of the row while there is anything fresh to take its place. Those two
	 * true things together meant that the instant the hub repainted — a rating
	 * saved, a note indexed, a window focused — every card on screen was a card
	 * the row had already shown you, and all seven were swapped out from under
	 * you. The cooldown is about the row you get *next*. This is the row you are
	 * reading, and it stays where it is until you ask for another.
	 */
	private showing: ReadonlySet<string> = new Set();
	private seeds: Seed[] = [];
	private seedKey = "";
	private round = 0;
	/**
	 * Added to every round before it is planned — see `EngineInput.rotation`.
	 *
	 * Owned by the engine after the first update rather than read from the input
	 * each time, because it also moves on its own: a row that has run the sources
	 * dry renews it rather than coming round to what it has already shown.
	 */
	private rotation = 0;
	/** Consecutive fetches that added nothing to the pool — see `BARREN_LIMIT`. */
	private barren = 0;
	private loading = false;
	private error: string | null = null;
	private cached: EngineState | null = null;

	constructor(private readonly port: SuggestionPort) {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Hands the engine the current world.
	 *
	 * Called on every render. Refetching happens only when the *seeds* change,
	 * because a new rating can change what the row should be asking about,
	 * while a thumbs-up only changes how the answers already in hand are
	 * ordered — and re-asking on a thumbs-up would make the button feel like it
	 * had thrown the row away.
	 */
	update(input: EngineInput): void {
		const previous = this.seedKey;
		const first = this.input === null;
		this.input = input;
		if (first) this.rotation = input.rotation ?? 0;
		this.anchors = anchorsOf(
			input.config,
			input.entries,
			input.feedback,
			input.traitOptions ?? {},
		);
		this.seeds = recommendationSeeds(
			input.config,
			input.entries,
			SEED_DEPTH,
			input.now ?? new Date(),
		);
		// Sorted, so this is the *set* of titles worth asking about and not the
		// order they came in. The order moves on its own: strength is nudged by
		// how recently something mattered, that is measured against the clock,
		// and the clock moves between renders. Two seeds a hair apart swapping
		// places is not news, and treating it as news is what made the row
		// reload while you were looking at it.
		this.seedKey = this.seeds
			.map((at) => at.entry.path)
			.sort()
			.join("|");
		this.cached = null;

		if (this.seedKey !== previous) {
			// The pool stays, and so does the row. What changed is which of your
			// titles are worth asking about *next* — which matters when the row
			// needs more and not before. Asking straight away meant every note
			// you added, every rating you changed, and every entry that drifted
			// past the end of the seed list threw away the row you were reading
			// and put up a spinner.
			this.round = 0;
			this.barren = 0;
			this.error = null;
			if (this.unseen() < SHOWN) void this.fetch(0);
		}
	}

	state(): EngineState {
		const input = this.input;
		if (!input) return IDLE;
		if (this.seeds.length === 0 && input.kinds.length === 0) return IDLE;
		if (this.cached) return this.cached;

		// What has been stood aside is a preference, not a rule. Treated as a rule
		// it emptied the row: press "show me others" as many times as the pool is
		// deep and every candidate is on the list, so the row went blank and the
		// button stopped doing anything — on a row whose whole promise is that
		// there is always something else.
		//
		// The hold comes off in one go, save for the row you were just looking at,
		// and what orders what comes back is the shown log: everything released
		// pays for how recently you saw it, heavily — see `COOLDOWN_DAYS` — so the
		// row comes round to what you saw longest ago and works forwards from
		// there. Releasing a row at a time was meant to do that and did the
		// opposite. The oldest row was released as a *block*, so the seven titles
		// that came back were the seven that came back last time, and the press
		// alternated between two rows for as long as anybody kept pressing.
		// Coming round has to be a queue, not a pair.
		//
		// And not while a fetch is in flight. Coming round is the answer to "there
		// is nothing else", and a question still out with the sources is not
		// nothing else — releasing then put the row you had just skipped back on
		// screen for as long as the request took, so every press looked like it
		// had cycled even when new titles were seconds away.
		let shown = this.rank(input, this.held());
		if (!this.loading && shown.length < SHOWN && this.aside.length > 1) {
			const last = this.aside[this.aside.length - 1] ?? [];
			const wider = this.rank(input, new Set(last));
			if (wider.length > shown.length) shown = wider;
		}
		this.record(shown);
		this.showing = new Set(shown.map((at) => suggestionKey(at.item)));

		this.cached = {
			shown,
			loading: this.loading,
			error: this.error,
			exhausted: this.exhausted(),
			idle: false,
		};
		return this.cached;
	}

	/**
	 * Everything on screen steps aside and the next best takes its place.
	 *
	 * Another round is only asked for once the pool actually runs thin — the
	 * answers already in hand are usually deeper than seven.
	 *
	 * The press always does something. Once the sources have genuinely run out
	 * the row comes round again rather than going blank: `state` gives back the
	 * rows you saw longest ago, a row at a time, and never the one you were just
	 * looking at. Going round is a worse answer than a new answer and a far
	 * better one than nothing.
	 */
	more(): void {
		const state = this.state();
		const row = state.shown.map((at) => suggestionKey(at.item));
		if (row.length > 0) this.aside.push(row);
		// It is not on screen any more, so its stamp goes back to meaning what it
		// says: this was shown, hold it back.
		this.showing = new Set();
		this.cached = null;

		// Whether the row it is about to draw is a row of things you have not
		// seen — asked of the row itself, which is the only measure that can
		// agree with the one deciding whether to come round.
		//
		// It used to be asked of the *pool*: how many candidates are left that
		// are neither stood aside nor shown lately. The two questions have
		// different answers, and the gap between them is where the cycling lived.
		// A pool can hold forty eligible candidates the row cannot seat — a quota
		// spent, a kind that has had its share — so the count said "plenty left,
		// no need to ask anybody" while the row it then drew came up short and
		// fell back on what you had already seen. Nobody was ever asked again,
		// and the press alternated between two rows forever.
		if (this.unseen() < SHOWN && this.canAsk()) {
			this.round += 1;
			void this.fetch(this.round);
			return;
		}
		this.emit();
	}

	/** Forgets what has been stood aside, so the whole pool is back in play. */
	reset(): void {
		this.aside = [];
		this.cached = null;
		this.emit();
	}

	/** Everything stood aside this session. */
	private held(): Set<string> {
		const out = new Set<string>();
		for (const row of this.aside) {
			for (const key of row) out.add(key);
		}
		return out;
	}

	/**
	 * How much of the row it would draw right now is something you have not seen.
	 *
	 * The ranker pads a short row with things you have already been shown rather
	 * than leaving gaps, so how long that row is says nothing; what it is made of
	 * says everything. Seven means the press has a full row of new titles to give
	 * you and needs to ask nobody. Anything less is the row about to repeat
	 * itself, which is the moment to go and ask.
	 */
	private unseen(): number {
		const input = this.input;
		if (!input) return 0;
		const now = input.now ?? new Date();
		return this.rank(input, this.held()).filter(
			(at) => !heldBack(input.shown?.[suggestionKey(at.item)], now),
		).length;
	}

	/** Whether there is anybody to ask at all. */
	private canAsk(): boolean {
		return roundsAvailable(this.seeds, this.input?.kinds ?? []) > 0;
	}

	/** The shown log as the ranking should read it — see `showing`. */
	private cooldown(log: Readonly<ShownLog> | undefined): ShownLog | undefined {
		if (!log || this.showing.size === 0) return log;
		const out: ShownLog = {};
		for (const [key, at] of Object.entries(log)) {
			if (!this.showing.has(key)) out[key] = at;
		}
		return out;
	}

	private rank(
		input: EngineInput,
		skipped: ReadonlySet<string>,
	): Suggestion[] {
		const shown = this.cooldown(input.shown);
		return rankSuggestions(this.pool, input.profile, {
			limit: SHOWN,
			owned: (item) => this.port.owned(item),
			feedback: input.feedback,
			skipped,
			...(shown ? { shown } : {}),
			anchors: this.anchors,
			standard: input.config.suggestionStandard,
			...(input.now ? { now: input.now } : {}),
		});
	}

	dispose(): void {
		this.live?.abort();
		this.live = null;
		this.listeners.clear();
	}

	/**
	 * Whether there is any point asking again.
	 *
	 * `roundsAvailable` is consulted for whether there is anybody to ask at all
	 * rather than for how many times they may be asked: the planners come round
	 * to the start of their lists, so there is always another question, and
	 * whether it is worth putting is answered by what the last two came back
	 * with.
	 */
	private exhausted(): boolean {
		const kinds = this.input?.kinds ?? [];
		if (roundsAvailable(this.seeds, kinds) === 0) return true;
		return this.barren >= BARREN_LIMIT;
	}

	/**
	 * How many rounds one press will walk before it stops.
	 *
	 * A press used to ask exactly once. If that round came back with nothing the
	 * row had not already pooled — which is most rounds, since a source asked
	 * about the same film twice answers the same twenty titles — the press had
	 * nothing to show for itself and the row came round to what it had. Pressing
	 * again asked once more, so it took three presses to reach a rotation, and
	 * all three looked like the row cycling.
	 *
	 * Now one press keeps asking until it has a row's worth of things you have
	 * not seen, and says out loud that it is doing so. Bounded, because a source
	 * with nothing left must not become an infinite loop of requests: four rounds
	 * is deep enough to walk past a barren stretch and shallow enough that the
	 * sources notice nothing.
	 */
	private static readonly CHASE = 4;

	private async fetch(round: number, tries = 0): Promise<void> {
		const input = this.input;
		if (!input) return;

		const requests = planRound(
			{
				profile: input.profile,
				seeds: this.seeds,
				kinds: input.kinds,
				facts: this.port.facts,
				liked: likedSeeds(input.feedback, (ref) =>
					this.port.owned({
						ref,
						title: "",
						tags: [],
						people: [],
						extra: {},
					}),
				),
				...(input.traitOptions?.enrichment
					? { enrichment: input.traitOptions.enrichment }
					: {}),
				standard: input.config.suggestionStandard,
			},
			this.rotation + round,
		);
		if (requests.length === 0) {
			this.barren += 1;
			return;
		}

		const before = this.pool.by.size;
		this.live?.abort();
		const controller = new AbortController();
		this.live = controller;
		this.loading = true;
		this.error = null;
		this.cached = null;
		this.emit();

		// One source being unreachable must not empty the row, so a failure is
		// remembered and only shown if nothing at all came back.
		let failure: string | null = null;
		const note = (err: unknown) => {
			if (controller.signal.aborted || isAbortError(err)) return;
			console.warn("Scout: could not ask a source for suggestions", err);
			failure ??=
				err instanceof Error ? err.message : "Could not reach the source.";
		};

		await Promise.all(
			requests.map((request) =>
				this.run(request, controller.signal)
					.then((items) => {
						if (controller.signal.aborted) return;
						mergeSuggestions(this.pool, items, request.origin);
					})
					.catch(note),
			),
		);

		if (controller.signal.aborted) return;
		this.live = null;
		this.error = failure;
		// A round that asked and learned nothing is the only honest sign that the
		// sources have run dry. Counted rather than reset on the first miss,
		// because one round can legitimately return only titles already pooled.
		if (this.pool.by.size > before) this.barren = 0;
		else this.barren += 1;

		// Still nothing to show for the press, and somebody left to ask.
		const chase =
			this.unseen() < SHOWN &&
			tries + 1 < SuggestionEngine.CHASE &&
			this.canAsk() &&
			failure === null;
		this.loading = chase;
		this.cached = null;
		this.emit();
		if (!chase) return;

		// Two rounds that taught it nothing means asking the same sort of question
		// again will not help. Different ones might: the rotation moves the whole
		// round on — other seeds, another series, the next keywords, a different
		// page of each catalogue — and what counts as barren starts again with it.
		if (this.barren >= BARREN_LIMIT) {
			this.rotation += 1;
			this.barren = 0;
		}
		this.round += 1;
		await this.fetch(this.round, tries + 1);
	}

	private run(request: Request, signal: AbortSignal): Promise<MediaItem[]> {
		if (request.op === "similar" && request.ref) {
			return this.port.similar(request.providerId, request.ref, signal);
		}
		if (request.op === "series" && request.ref) {
			return this.port.series(request.providerId, request.ref, signal);
		}
		if (request.op === "discover" && request.query) {
			return this.port.discover(request.providerId, request.query, signal);
		}
		return Promise.resolve([]);
	}

	/**
	 * Writes down what is on screen, once per key.
	 *
	 * Stamped when the row is *drawn* rather than when "show me others" is
	 * pressed, which is what makes a reload alone rotate it: the seven you saw
	 * last night were seen, whether or not you did anything about them.
	 */
	private record(shown: readonly Suggestion[]): void {
		const report = this.input?.onShown;
		if (!report) return;
		const keys = shown.map((at) => suggestionKey(at.item));
		const fresh = keys.filter((key) => !this.recorded.has(key));
		this.recorded = new Set(keys);
		if (fresh.length === 0) return;
		report(fresh);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}
