import { normalizeTitle } from "../title";
import type { MediaItem, MediaKind } from "../types";
import {
	ratingFraction,
	statusTone,
	SUGGESTION_STANDARD,
	type LibraryConfig,
} from "./config";
import { rankReasons, type Reason } from "./reasons";
import type { TraitKey } from "./traits";
import type { LibraryEntry } from "./entry";
import {
	activeVerdict,
	feedbackKey,
	type FeedbackLog,
	type FeedbackVerdict,
	type ShownLog,
} from "./feedback";
import { neighbourBoost, type Anchor } from "./neighbours";
import {
	candidateOfItem,
	entrySignal,
	kindShare,
	rankDiverse,
	scoreCandidate,
	type KindStat,
	type TasteProfile,
} from "./taste";
import { parseTrait } from "./traits";

/**
 * Turning a heap of candidates into a row of eight.
 *
 * The fetching lives in the view; everything that decides *what* to fetch and
 * what to do with the answers lives here, where it can be reasoned about and
 * tested without a network.
 *
 * Two questions get asked, and asking only the first was the old row's real
 * problem. "What else is like the things you liked most" can only ever return
 * neighbours of what you already own — ask it repeatedly and it walks in
 * ever-decreasing circles around a handful of favourites, which is why the row
 * felt like it knew one thing about you. "What does this catalogue have a lot
 * of people liking, in the genres you go for" reaches the whole source,
 * including the parts nothing on your shelf happens to border. The first is
 * precise and narrow, the second broad and vague, and a good row is made of
 * both.
 */

/* ------------------------------------------------------------------ seeds */

/**
 * How much this entry is worth asking the source about, or null for one that
 * is not worth asking about at all.
 *
 * Not simply "your highest rated". A recommender fed only 9s and 10s has about
 * six things to work with on a normal library and returns the same neighbours
 * every time; one fed everything you finished and did not dislike has fifty,
 * and the difference is the difference between a row that changes and a row
 * that does not. What the ratings buy is *ordering*, not membership.
 *
 * Which is why what you have merely *added* now counts too, at a fraction of
 * what watching it counts for. Putting something on the shelf is a choice you
 * made about it — a weaker statement than finishing it and a far stronger one
 * than silence — and excluding it cost the row most of the library it had to
 * draw on. A hundred and thirty things worth asking about became three hundred,
 * and the questions the row can ask are the whole of what it can answer.
 *
 * The one exclusion left is the one that means something: a score below halfway
 * is a considered opinion that it was not good, and a drop is the same opinion
 * with the evidence.
 */
const PLANNED_STRENGTH = 0.42;

export function seedStrength(
	config: LibraryConfig,
	entry: LibraryEntry,
	now: Date,
): number | null {
	if (!entry.ref) return null;
	const tone = statusTone(config, entry.status);
	if (tone === "dropped") return null;

	const fraction = ratingFraction(config, entry.kind, entry.rating);
	// A middling score is a considered opinion that it was middling. Asking for
	// more of it is asking for more middling things.
	if (fraction !== undefined && fraction < 0.5) return null;

	const signal = entrySignal(config, entry, now);
	const recency = signal?.weight ?? 0.5;
	// Unrated and unstarted: worth asking about, and worth less than the things
	// you actually sat through. Ranked below every finished title, so it fills
	// the tail of the seed list rather than the head of it.
	const base =
		fraction ??
		(tone === "done" || tone === "active" || entry.favorite
			? (signal?.value ?? 0.6)
			: PLANNED_STRENGTH);
	// Weighted towards how much you liked it, nudged by how recently it mattered
	// — a favourite from last month is the best question to ask a source.
	return base * 0.8 + recency * 0.2 + (entry.favorite ? 0.12 : 0);
}

/**
 * Seeds for the "what else is like this" half, best first.
 *
 * Spread across genres for the same reason the results are: three seeds from
 * one trilogy return one trilogy's worth of suggestions.
 */
export function recommendationSeeds(
	config: LibraryConfig,
	entries: readonly LibraryEntry[],
	limit = 15,
	now: Date = new Date(),
): { entry: LibraryEntry; strength: number }[] {
	const scored: { entry: LibraryEntry; strength: number }[] = [];
	for (const entry of entries) {
		const strength = seedStrength(config, entry, now);
		if (strength !== null) scored.push({ entry, strength });
	}
	return rankDiverse(
		scored,
		(at) => ({
			score: at.strength,
			tags: at.entry.tags,
			// Spread across the shelf as well as across its subjects. On a library
			// that is mostly film, seeds ranked on genre alone are all films, and a
			// row asked only about films can only ever answer about films.
			family: at.entry.kind,
		}),
		limit,
		0.3,
	);
}

/* --------------------------------------------------------------- discovery */

export interface DiscoverPlan {
	kind: MediaKind;
	genres: string[];
	without: string[];
	minRating: number;
	page: number;
}

/**
 * Genres the model has an opinion about, strongest first.
 *
 * Affinity is a comparison against your own average, which means a library
 * with only one genre in it has no genre that stands out — everything you own
 * being science fiction makes science fiction your baseline rather than your
 * preference, and the arithmetic correctly reports zero. That is the right
 * answer to "what do you like more than usual" and the wrong answer to "what
 * should we go and look for", so what you simply keep most of stands behind it.
 * Weaker evidence, but it is the evidence there is, and asking a catalogue for
 * nothing in particular is worse.
 *
 * The two are one list rather than a fallback, and that is the fix for a row
 * that could only think of one thing. Standing out is a comparison against your
 * own average, so a person with one big habit and a few smaller ones has two or
 * three genres clearing it at most — and taking only those meant the discovery
 * half asked about the same pair every round while the rest of what they
 * actually watch was never mentioned to a catalogue at all. What stands out
 * still comes first, so nothing that was ranked ahead has been demoted; there
 * is simply something behind it now.
 */
export function tasteGenres(
	profile: TasteProfile,
	direction: "liked" | "disliked",
	limit = 4,
): string[] {
	// Lower-cased values rather than labels, because both catalogues match their
	// genre vocabularies case-insensitively and always have.
	const all = [...profile.traits.entries()].flatMap(([key, at]) => {
		const parsed = parseTrait(key);
		return parsed?.ns === "genre" ? [[parsed.value, at] as const] : [];
	});

	if (direction === "disliked") {
		return all
			.filter(([, at]) => at.score < -0.05)
			.sort((a, b) => a[1].score - b[1].score)
			.slice(0, limit)
			.map(([name]) => name);
	}

	const liked = all
		.filter(([, at]) => at.score > 0.015)
		.sort((a, b) => b[1].score - a[1].score)
		.map(([name]) => name);

	const common = all
		// Anything actively rated below your average stays out: keeping a lot of
		// something you keep not enjoying is not a reason to be sent more of it.
		.filter(([name, at]) => at.score > -0.02 && !liked.includes(name))
		.sort((a, b) => b[1].count - a[1].count)
		.map(([name]) => name);

	return [...liked, ...common].slice(0, limit);
}

/**
 * What to ask each catalogue for.
 *
 * One plan per kind you actually keep, because a library of films and manga is
 * two catalogues and asking either about the other returns nothing. Kinds are
 * taken in order of how much of the library they are.
 *
 * The cap used to be two, on the reasoning that a row of eight split three ways
 * is a sampler rather than a recommendation. That reasoning was about the *row*,
 * and putting it here instead meant the two kinds you keep most of won every
 * round and the rest of the library was never asked about at all. How many kinds
 * reach the row is `fillSlots`' business; this end's job is to have something of
 * each to choose from.
 */
export const DISCOVER_KINDS = 4;

/**
 * How much of the library a kind counts for when deciding what to go looking for.
 *
 * What you engage with, not what you own — a backlog is not a preference, and
 * forty unread books say you mean to read books rather than that finding a
 * forty-first would help. `at.engaged || at.owned` was meant to say that and said
 * the opposite: read per kind, a shelf of forty unopened books outranked three
 * films you actually watched, so the one case the comment warned about was the
 * one the code produced. Falling back to what is owned is right only when
 * *nothing anywhere* has been engaged with, which is a library nobody has
 * started rather than a corner of one nobody has got to.
 */
export function kindWeight(profile: TasteProfile): (at: KindStat) => number {
	for (const at of profile.kinds.values()) {
		if (at.engaged > 0) return (one) => one.engaged;
	}
	return (one) => one.owned;
}

/**
 * How far down a catalogue the row walks before coming round to the top.
 *
 * The page used to be the round number and nothing else, which was right while
 * a round only ever counted presses of "show me others" and wrong the moment the
 * round carries a rotation across sessions too: the ninetieth round asked for
 * page ninety-one, and no catalogue has one. Eight pages sorted by rating is
 * about a hundred and sixty titles per kind per genre — deeper than the row can
 * exhaust in a session, and shallow enough that every page of it is worth
 * seeing.
 */
export const DISCOVER_PAGES = 8;

/**
 * The `round`th window of `size` items, coming round again at the end.
 *
 * Wrapping rather than running off the end is what lets "show me others" be
 * pressed indefinitely. Slicing meant the fifth press asked about seeds
 * twenty-one to twenty-four of a list of eighteen — that is, about nothing — and
 * the row simply stopped having anything to say. Coming round to the start asks
 * a question already asked, which the day-long HTTP cache answers for free, and
 * the pool it lands in has moved on: the seven things on screen have been stood
 * aside, so the same answers produce a different row.
 */
export function wrap<T>(all: readonly T[], round: number, size: number): T[] {
	if (all.length === 0) return [];
	const start = (round * size) % all.length;
	return [...all, ...all].slice(start, start + Math.min(size, all.length));
}

/**
 * How many genres the discovery half keeps in rotation, and how many of them
 * one question carries.
 *
 * Asking about the same top three every round was the discovery half quietly
 * agreeing with the exploit half instead of counterbalancing it. Someone who
 * mostly watches horror has horror at the top of this list every time, so the
 * one part of the row that reaches past the library reached into the same
 * corner of it — and the catalogues cap what they will take anyway (TMDB ORs
 * three), so the fourth genre was never once asked about. A window that moves
 * with the round asks about all of them across a few presses, which is the
 * difference between "more of your favourite genre" and "more of what you go
 * for".
 */
const DISCOVER_GENRES = 6;
const GENRES_PER_PLAN = 3;

/**
 * How far below the asking standard a model with little to go on may drop.
 *
 * A strict floor plus a genre it guessed at can return an empty list, and an
 * empty row teaches nobody anything. Applied as a relief from wherever the
 * standard has been set rather than as a number of its own, so somebody who
 * asked for the acclaimed end still gets the acclaimed end on their fourth
 * note.
 */
export const UNSURE_RELIEF = 0.4;

/** And how far above it the punt asks, being off-profile by construction. */
export const WILDCARD_PREMIUM = 0.4;

export function discoverPlans(
	profile: TasteProfile,
	round: number,
	kinds: readonly MediaKind[],
	standard: number = SUGGESTION_STANDARD.default,
): DiscoverPlan[] {
	const weight = kindWeight(profile);
	const share = [...profile.kinds.entries()]
		.filter(([kind, at]) => kinds.includes(kind) && weight(at) > 0)
		.sort((a, b) => weight(b[1]) - weight(a[1]))
		.slice(0, DISCOVER_KINDS)
		.map(([kind]) => kind);
	// A library with nothing in a discoverable kind still gets asked about the
	// kinds the sources can answer for, rather than nothing at all.
	const targets = share.length > 0 ? share : kinds.slice(0, 1);

	const liked = tasteGenres(profile, "liked", DISCOVER_GENRES);
	const avoid = tasteGenres(profile, "disliked", 2);

	return targets.map((kind) => ({
		kind,
		genres: wrap(liked, round, GENRES_PER_PLAN),
		without: avoid,
		// Loosened when the model has little to go on: a strict floor plus a
		// genre it guessed at can return an empty list, and an empty row teaches
		// nobody anything.
		minRating: standard - (profile.sampled >= 4 ? 0 : UNSURE_RELIEF),
		page: (round % DISCOVER_PAGES) + 1,
	}));
}

/* ---------------------------------------------------------------- origins */

/**
 * How a suggestion was arrived at.
 *
 * Declared here rather than in `strategies.ts` because a pooled suggestion
 * remembers it long after the request that produced it is forgotten, and
 * because the planner imports this file for `discoverPlans`.
 */
export type StrategyId =
	| "exploit"
	| "franchise"
	| "person"
	| "keyword"
	| "explore"
	| "wildcard";

export interface Origin {
	strategy: StrategyId;
	/** The title of yours this came from, when it came from one. */
	seed?: string;
	/** How much you liked that title, 0–1. */
	strength?: number;
	/** The trait that made this worth asking about, for the strategies that ask. */
	trait?: TraitKey;
	/** That trait as a person would say it. */
	label?: string;
}

/* ----------------------------------------------------------------- merging */

export interface RawSuggestion {
	item: MediaItem;
	/** Titles of yours that led here. More than one is a much stronger signal. */
	seeds: string[];
	/** The best of those seeds, 0–1, so a 10/10's neighbours outrank a 7's. */
	seedStrength: number;
	/** True when the catalogue offered it rather than one of your titles. */
	explored: boolean;
	/** How it was found — which slot in the row it is eligible for. */
	strategy: StrategyId;
	/** Whatever the strategy wanted said about it, when it had something. */
	origins: Origin[];
}

export interface SuggestionPool {
	by: Map<string, RawSuggestion>;
	/**
	 * Title-and-year to the key already holding it.
	 *
	 * The same anime comes back from TMDB and from AniList under two ids, and
	 * two of the seven places went to one show. The keys themselves cannot be
	 * changed to fix this — `providerId:id` is also the feedback key, and
	 * rewriting it would orphan every verdict already recorded — so the pool
	 * carries a second index and folds collisions into whichever arrived first.
	 */
	byIdentity: Map<string, string>;
}

export function emptyPool(): SuggestionPool {
	return { by: new Map(), byIdentity: new Map() };
}

export function suggestionKey(item: MediaItem): string {
	return feedbackKey(item.ref);
}

/** Anime is television and manga is a book, as far as being a duplicate goes. */
function kindFamily(kind: MediaKind): string {
	if (kind === "anime") return "tv";
	if (kind === "manga") return "book";
	return kind;
}

/** What makes two records from different catalogues the same work. */
export function identityKey(item: MediaItem): string {
	return `${kindFamily(item.ref.kind)}|${normalizeTitle(item.title)}|${
		item.year ?? "?"
	}`;
}

/**
 * Folds a batch of answers into the pool.
 *
 * The important line is the one that does *not* skip a title already there.
 * Three of your favourites independently pointing at the same film is the
 * single strongest thing a source ever tells you, and the previous version
 * threw it away as a duplicate — it kept the first mention and dropped every
 * corroboration. Now each repeat is recorded, and the count is worth more to
 * the ranking than any one source score.
 */
export function mergeSuggestions(
	pool: SuggestionPool,
	items: readonly MediaItem[],
	origin: Origin,
): void {
	for (const item of items) {
		const key = suggestionKey(item);
		const identity = identityKey(item);
		// A record already here under this exact id, or the same work already
		// here under another catalogue's id.
		const at = pool.by.get(key) ?? pool.by.get(pool.byIdentity.get(identity) ?? "");

		if (!at) {
			pool.by.set(key, {
				item,
				seeds: origin.seed ? [origin.seed] : [],
				seedStrength: origin.strength ?? 0,
				explored: origin.seed === undefined,
				strategy: origin.strategy,
				origins: [origin],
			});
			pool.byIdentity.set(identity, key);
			continue;
		}

		if (origin.seed && !at.seeds.includes(origin.seed)) at.seeds.push(origin.seed);
		at.seedStrength = Math.max(at.seedStrength, origin.strength ?? 0);
		// Something both a neighbour and a catalogue pick is no longer a shot in
		// the dark, so it stops being counted as one.
		if (origin.seed) at.explored = false;
		if (!at.origins.some((one) => one.strategy === origin.strategy)) {
			at.origins.push(origin);
		}
		// The narrower strategy wins the slot. A film that a catalogue also
		// happened to return is still the film that completes your series.
		if (STRATEGY_RANK[origin.strategy] < STRATEGY_RANK[at.strategy]) {
			at.strategy = origin.strategy;
		}
		// Prefer whichever record carries more, since list endpoints differ in
		// what they return and the fuller one makes a better card.
		if (item.tags.length > at.item.tags.length) at.item = item;
	}
}

/** Lower is more specific — used to decide which strategy owns a suggestion. */
const STRATEGY_RANK: Record<StrategyId, number> = {
	franchise: 0,
	exploit: 1,
	person: 2,
	keyword: 3,
	explore: 4,
	wildcard: 5,
};

/* ----------------------------------------------------------------- ranking */

export interface Suggestion {
	item: MediaItem;
	score: number;
	/** The profile's own part of that score — see `Verdict.fit`. */
	fit: number;
	/** What its own source makes of it — see `Verdict.merit`. */
	merit: number;
	/** That, out of ten — see `Verdict.rating`. What the standard is read against. */
	rating?: number;
	/** Why, strongest first — see `rankReasons`. */
	reasons: Reason[];
	seeds: string[];
	strategy: StrategyId;
	/** Set when you have already told the model what you think of this one. */
	verdict?: FeedbackVerdict;
}

/** Weight on each extra title of yours that pointed at the same suggestion. */
const AGREEMENT = 0.4;

/** Weight on how much you liked the title it came from. */
const SEED_WEIGHT = 0.5;

/**
 * What a catalogue pick gives up against a neighbour of something you loved.
 *
 * Not zero and not large. Discovery is the half of the row that can surprise
 * you, and a penalty big enough to keep it out entirely would leave the same
 * closed circle the row had before.
 */
const EXPLORE_COST = 0.12;

export function scoreSuggestion(
	profile: TasteProfile,
	raw: RawSuggestion,
	now: Date = new Date(),
	anchors: readonly Anchor[] = [],
	standard: number = SUGGESTION_STANDARD.default,
): {
	score: number;
	fit: number;
	merit: number;
	rating?: number;
	reasons: Reason[];
} {
	const candidate = candidateOfItem(raw.item);
	const verdict = scoreCandidate(profile, candidate, now);
	const near = neighbourBoost(
		anchors,
		(candidate.traits ?? []).map((one) => one.key),
		now,
	);

	// Diminishing: the second title agreeing is a revelation, the fifth is
	// confirmation of something already known.
	const agreement = AGREEMENT * Math.log2(1 + Math.max(0, raw.seeds.length - 1));

	const score =
		verdict.score +
		agreement +
		near.boost +
		qualityLean(standard) * verdict.merit +
		SEED_WEIGHT * raw.seedStrength -
		(raw.explored ? EXPLORE_COST : 0);

	const reasons = [...verdict.reasons];
	if (near.reason) reasons.push(near.reason);
	if (raw.seeds.length > 1) {
		reasons.push({
			kind: "agreement",
			label: `${raw.seeds.length} things you liked point here`,
			short: `${raw.seeds.length} of yours agree`,
			strength: Math.min(1, raw.seeds.length / 4),
		});
	} else if (raw.seeds[0]) {
		reasons.push({
			kind: "seed",
			label: `Because you liked ${raw.seeds[0]}`,
			// The title alone in the short form. "Like " spent five of a card's
			// twenty-two characters saying what the heart icon beside it already
			// says, and it was five characters off the end of the title.
			short: raw.seeds[0],
			strength: raw.seedStrength,
		});
	}
	for (const origin of raw.origins) {
		if (origin.strategy === "wildcard") {
			// Said out loud on purpose. An unexplained off-profile pick reads as
			// the model being wrong; a labelled one reads as it being generous.
			// "A punt" was the wrong word for that: it says the model is
			// gambling, where the point is that it is deliberately looking
			// somewhere it does not usually look.
			reasons.push({
				kind: "wildcard",
				label: origin.label
					? `Branching out — you have little ${origin.label.toLowerCase()}`
					: "Branching out — outside your usual",
				short: "Branching out",
				strength: 0.4,
			});
		} else if (origin.label && origin.trait) {
			reasons.push({
				kind: origin.strategy === "franchise" ? "series" : "keyword",
				label: origin.label,
				strength: 0.6,
				ref: { trait: origin.trait },
			});
		}
	}
	// A card shows what is *for* something, so a candidate whose only recognised
	// traits are marks against it left the line under its title empty — and an
	// empty foot collapses, so one unexplained card made a row of seven ragged by
	// eighteen pixels. Tested for a reason in favour rather than for any reason at
	// all: "there is nothing good to say about this" is not the same fact as
	// "there is nothing to say".
	if (!reasons.some((one) => !one.against)) {
		reasons.push({
			kind: "explore",
			label: "Well liked, and in your line",
			short: "In your line",
			strength: 0.2,
		});
	}

	return {
		score,
		fit: verdict.fit,
		merit: verdict.merit,
		...(verdict.rating === undefined ? {} : { rating: verdict.rating }),
		reasons,
	};
}

/**
 * Extra weight on what the source thinks, for somebody who has said that is
 * what they care about.
 *
 * A gate alone was not enough, and the arithmetic says why. A neighbour of a
 * favourite carries `SEED_WEIGHT * strength` — up to half a point — before
 * anything else is counted, where the whole spread between a mediocre title and
 * an acclaimed one is `0.75 * merit`, about a sixth of a point. So the row is
 * ordered by *where a suggestion came from* and barely at all by whether it is
 * any good: a 6.3 that a favourite pointed at outscored an 8.3 by nearly three
 * to one. That is defensible as a default — provenance really is the better
 * predictor of whether you will like something — and indefensible for somebody
 * who has just said, in as many words, that they want the good ones.
 *
 * Zero at the default and growing from there, on top of the fixed weight rather
 * than in place of it: this is an adjustment to a ranking that works, not a
 * different ranking.
 *
 * One-sided on purpose. Dragging the slider down means "do not keep these from
 * me", which the gate already does by admitting them; it does not mean "prefer
 * the worse ones", and a symmetric lean read it that way — it went negative and
 * actively pushed the acclaimed end of somebody's own pool *down* the row.
 * Nobody has ever wanted that. Below the default this is simply zero and the
 * ordering is the one the model would have used anyway.
 */
const LEAN_PER_POINT = 3;

export function qualityLean(
	standard: number = SUGGESTION_STANDARD.default,
): number {
	return LEAN_PER_POINT * Math.max(0, standard - SUGGESTION_STANDARD.default);
}

export interface RankOptions {
	limit: number;
	/** Already on a shelf — `true` for anything the library matches. */
	owned: (item: MediaItem) => boolean;
	feedback: Readonly<FeedbackLog>;
	/** Keys stood aside from this session, so "show me others" really does. */
	skipped?: ReadonlySet<string>;
	/** When each was last put in front of you — see `COOLDOWN_DAYS`. */
	shown?: Readonly<ShownLog>;
	/** Things you have said yes to, for the "because you liked X" boost. */
	anchors?: readonly Anchor[];
	/** What the row is being held to — see `LibraryConfig.suggestionStandard`. */
	standard?: number;
	now?: Date;
}

/**
 * How long something the row has already drawn is held out of it.
 *
 * A penalty on its own was not enough, and it is worth being clear about why.
 * Half a point is about what a strong genre affinity is worth — plenty to move
 * a middling suggestion down the row, and nothing at all to the one candidate
 * that keeps winning. The suggestion best placed to shrug off the charge is by
 * definition the one that was on screen yesterday, so the titles that came back
 * were precisely the titles you were most tired of, and the row read as though
 * it had four ideas.
 *
 * So being drawn recently is a *tier* rather than a discount: while there is
 * anything in the pool you have not been shown, nothing you have been shown is
 * considered at all. Past the window the decaying penalty below is all that is
 * left, so a good suggestion that has waited its turn is delayed rather than
 * lost.
 *
 * Four days, not four weeks. Long enough that a row opened twice a day is
 * different every time, short enough that a small pool is not permanently
 * holding most of itself back.
 */
export const COOLDOWN_DAYS = 4;

/**
 * And what it costs after that.
 *
 * Also what orders the tier from within: everything held back pays this, so when
 * the row has no choice but to come round, the thing you saw longest ago is the
 * thing that comes back first.
 *
 * That second job is why the charge is heavy and why it decays in a day rather
 * than a working week. Half a point with a five-day half-life meant the spread
 * between something you saw a minute ago and something you saw three days ago
 * was under two tenths — nothing at all against a suggestion the model rates
 * highly, so the come-round was ordered by score and served the same few
 * favourites every press. Ordering by *when you last saw it* is the whole of
 * what "it should be a while before that comes back" means, so it has to be
 * worth more than being a good suggestion. Past the cooldown it is spent: four
 * days out it is under a fifth of a point, which is the gentle nudge it always
 * meant to be.
 */
const SHOWN_PENALTY = 3;
const SHOWN_HALF_LIFE_DAYS = 1;

/**
 * How many of the row something you have already thumbed up may take.
 *
 * A like is not a dismissal — you said you liked the look of it, not that you
 * had dealt with it — so it stays eligible until you add it or change your mind.
 * But a row that is mostly things you have already said yes to has stopped being
 * a recommendation and become a reading list, and the reason to open it is the
 * part you have *not* seen.
 */
export const LIKED_SEATS = 2;

/**
 * How much of the row one genre may take.
 *
 * The diversity charge below was the only thing standing between a library
 * with a favourite genre and a row made entirely of it, and a charge cannot do
 * this job — the same argument `FillOptions.share` makes about the majority
 * *kind*, and it is if anything stronger here. The dominant genre arrives with
 * three separate advantages: its affinity is positive so every candidate
 * carrying it scores higher, the seeds it is asked about are mostly of it, and
 * the neighbours those seeds return corroborate each other so the agreement
 * bonus lands on it too. Half a point per repeat is nothing against that, and
 * the picks best placed to shrug it off are precisely the ones deepest in the
 * favourite genre. Someone who mostly watches horror got seven horror films and
 * no evidence the row knew they watched anything else.
 *
 * A cap rather than a ban, and a generous one: most of the row is still allowed
 * to be the thing you mostly watch, because that is what you mostly watch. It
 * is the difference between a row that leans and a row that has one idea.
 *
 * Counted per tag, so it binds on whatever a run of picks actually shares. A
 * row of four horror films that are also four thrillers has spent both.
 */
export function subjectSeats(limit: number): number {
	return Math.max(2, Math.ceil(limit / 2));
}

/** What already having said yes costs against something you have not seen. */
const LIKED_COST = 0.35;

/**
 * The pool, filtered, scored and spread out.
 *
 * Disliked titles leave for good — a thumbs-down that a row ignores is a
 * button that does nothing. So do the ones you have already seen, which is a
 * different fact and used to have to be told as a dislike. A snooze holds
 * until its date and then quietly stops applying.
 *
 * Liked ones stay, capped and discounted: see `LIKED_SEATS`. Ones the row has
 * drawn in the last few days stay too, and are only reached for once there is
 * nothing else: see `COOLDOWN_DAYS`.
 */
export function rankSuggestions(
	pool: SuggestionPool,
	profile: TasteProfile,
	options: RankOptions,
): Suggestion[] {
	const now = options.now ?? new Date();
	const standard = options.standard ?? SUGGESTION_STANDARD.default;
	const scored: Suggestion[] = [];

	for (const [key, raw] of pool.by) {
		if (!considered(key, raw, options, now)) continue;
		const verdict = activeVerdict(options.feedback[key], now);

		const { score, fit, merit, rating, reasons } = scoreSuggestion(
			profile,
			raw,
			now,
			options.anchors,
			standard,
		);
		scored.push({
			item: raw.item,
			fit,
			merit,
			...(rating === undefined ? {} : { rating }),
			score:
				score -
				shownPenalty(options.shown?.[key], now) -
				(verdict === "liked" ? LIKED_COST : 0),
			reasons: rankReasons(reasons, 4),
			seeds: raw.seeds,
			strategy: raw.strategy,
			...(verdict ? { verdict } : {}),
		});
	}

	return fillSlots(
		worthShowing(scored, options.limit, standard).map((at) => ({
			...at,
			tags: at.item.tags,
			// The kind itself rather than `kindFamily`: folding anime into
			// television is right for spotting a duplicate and wrong here, where
			// the whole point is that the row should not be seven of one thing.
			family: at.item.ref.kind,
			held: heldBack(options.shown?.[suggestionKey(at.item)], now),
		})),
		options.limit,
		{
			held: (one) => one.held,
			// The row's mix follows what you actually engage with, with a seat's
			// worth of allowance for anything you engage with at all.
			share: (family) => kindShare(profile, family as MediaKind),
			subjectSeats: subjectSeats(options.limit),
			quota: {
				of: (one) => (one.verdict === "liked" ? "liked" : undefined),
				max: LIKED_SEATS,
			},
		},
	);
}

/**
 * What the model thinks you will actively dislike, dropped while it can afford
 * to drop it.
 *
 * A trim, not a truncation. This used to be willing to leave the row short on
 * the reasoning that six good suggestions beat seven — which is true of six good
 * ones and a bad one, and not true of the row it actually produced: a rail of
 * two cards and five card-widths of nothing, which reads as broken rather than
 * as discerning. So the floors take out what they can while a full row survives
 * them, and the moment they cannot, the row is filled from the top of what is
 * left. Something you would probably pass over is a worse suggestion than a good
 * one and a better row than a gap.
 *
 * Measured on `fit` rather than on the total, and that is the whole of why it
 * works. A neighbour of a favourite carries `SEED_WEIGHT * strength` before
 * anything else is counted, which is comfortably more than a genre you have
 * turned down three times is worth against it — so on the total, "people who
 * liked Arrival also liked this musical" outscored the floor every time, which
 * is exactly the recommendation the floor exists to stop.
 *
 * A floor rather than a proportion, and a low one: this is meant to catch what
 * you have demonstrably avoided, not to trim the merely unremarkable.
 *
 * The punt used to be exempt from it, on the reasoning that being outside the
 * profile is the whole premise of the punt. That was the wrong reading of its
 * own number: something genuinely outside the profile scores *zero* here, which
 * clears the floor comfortably. The only picks the exemption ever rescued were
 * the ones scoring below it — the ones actively against your taste — so a row
 * that had learned you turn down musicals put one on screen every day and
 * captioned it "branching out". Being unknown is a reason to show somebody
 * something. Being disliked is not, and no label makes it one.
 */
const FIT_FLOOR = -0.05;

/**
 * And what its own source makes of it, read against what you asked for.
 *
 * This used to be a floor on `merit` — points above the average thing the
 * catalogue carries — sitting about a point below that average, with a bypass
 * for anything the profile felt sure enough about. Two things were wrong with
 * it the moment the standard became a setting. It was expressed in a unit
 * nobody sets a preference in, so a stated 7.5 had to be translated into an
 * offset, and the translation carried a point and a quarter of slack: the row
 * served 6.3s to somebody who had asked for 7.5s, which is worse than having no
 * setting at all, because a setting is a promise. And the bypass let a high fit
 * override the number outright — so the suggestions best placed to ignore the
 * standard were the ones the row was most enthusiastic about, which are exactly
 * the ones filling it.
 *
 * So it is read against `rating` instead: the source's own score out of ten,
 * shrunk for a thin vote count. The number on the setting, the number on the
 * card, and the number a person means. No bypass. What keeps the row from
 * emptying is the stand-down below, which was always the honest mechanism for
 * that.
 *
 * A candidate the source gave no score at all is let through. Unknown is not
 * bad — the same rule the trait model runs on — and on catalogues where half
 * the entries carry no score, gating on silence would filter by paperwork.
 */
function meetsStandard(at: Suggestion, standard: number): boolean {
	return at.rating === undefined || at.rating >= standard;
}

function worthShowing(
	scored: readonly Suggestion[],
	limit: number,
	standard: number,
): Suggestion[] {
	const kept = scored.filter(
		(at) => at.fit > FIT_FLOOR && meetsStandard(at, standard),
	);
	if (kept.length >= limit || kept.length === scored.length) return kept;
	// Not enough got through to make a row of it, so the floors stand down as far
	// as they have to and no further: everything that cleared them, then the best
	// of what did not. Same reasoning as `discoverPlans` loosening its rating
	// filter on a library it knows little about.
	// Spread rather than sorted, and that is the whole of why the slate helps.
	// Ordering the also-rans by score hands back the same lopsidedness that made
	// them also-rans: score leans on provenance, provenance is your favourite
	// genre, so the fallback slate was seven neighbours of one film and the caps
	// had nothing to prefer over them. `rankDiverse` picks the best of each
	// subject in turn, so what reaches `fillSlots` is the better end of the pool
	// *and* a cross-section of it.
	const rest = scored.filter((at) => !kept.includes(at));
	return [
		...kept,
		...rankDiverse(
			rest,
			(at) => ({ score: at.score, tags: at.item.tags, family: at.item.ref.kind }),
			limit * SLATE - kept.length,
		),
	];
}

/**
 * How many candidates a row of `limit` is chosen from when the floors give way.
 *
 * Topping up to exactly `limit` was the obvious reading of "enough to fill the
 * row" and the wrong one, because filling the row is not the same job as
 * choosing what goes in it. Handing `fillSlots` exactly seven candidates leaves
 * it nothing to choose *between*: the strategy budget, the kind allowance and
 * the subject cap all work by preferring one candidate over another, and with
 * no alternatives every one of them stands down in turn and takes what it is
 * given. Which is ordered by score, and score leans on provenance — so somebody
 * who set the standard higher than their pool could meet got a row of seven
 * neighbours of one favourite, all of the same genre. The strictest setting
 * produced the least varied row, which is precisely backwards.
 *
 * Three rows' worth is enough for the caps to bind and still narrow enough that
 * the row is drawn from the better end of what there is.
 */
const SLATE = 3;

/**
 * Who gets a guaranteed seat in the row of seven.
 *
 * A budget rather than one flat ranking, and this is the part that makes the
 * row feel different. Ranking everything together sounds fairer and is not: a
 * sequel shares its predecessor's genres, so the diversity pass docks it and a
 * franchise pick essentially never wins a seat — the suggestion a person would
 * find most obviously right is the one a single ordering reliably excludes.
 * The same goes for the punt, which is off-profile by construction and so
 * always ranks last.
 *
 * Order matters: earlier slots choose first.
 */
export const SLOTS: readonly { strategy: StrategyId; count: number }[] = [
	{ strategy: "exploit", count: 2 },
	{ strategy: "franchise", count: 1 },
	{ strategy: "person", count: 1 },
	{ strategy: "keyword", count: 1 },
	{ strategy: "explore", count: 1 },
	{ strategy: "wildcard", count: 1 },
];

/** What a repeated subject, a repeated kind, and a spent quota cost a pick. */
export interface FillOptions<T> {
	slots?: readonly { strategy: StrategyId; count: number }[];
	/** Charged per subject the pick shares with something already placed. */
	penalty?: number;
	/**
	 * Charged per thing of the same *kind* already placed.
	 *
	 * Gentler than the subject penalty and doing a different job. Without it a
	 * library that is four-fifths film gets a row that is entirely film, however
	 * many books and shows came back — the row's own answer to "what about the
	 * other types" was that they were always the eighth-best thing on it.
	 *
	 * Gentle on purpose: it must be enough to seat a near-miss of another kind
	 * and not enough to seat a bad one. When the pool is all of one kind it
	 * charges everything equally and so changes nothing at all.
	 */
	kindPenalty?: number;
	/**
	 * How much of the row each kind has earned, 0–1, summing to about one.
	 *
	 * A flat charge per thing of the same kind already placed was the same rule
	 * for a library that is nine-tenths film and one that is evenly split, and it
	 * was wrong for both: it fought the majority kind down out of seats it had
	 * fairly earned, and did nothing to guarantee the small ones any. So the mix
	 * is drawn from what you actually engage with — five films and a show and a
	 * book, rather than four and four and four — and each kind gets that many
	 * seats free of charge before the charge starts.
	 *
	 * The rounding is deliberately generous at the bottom: a kind that has earned
	 * a third of a seat is allowed one, which is what "still suggest some of
	 * everything" means arithmetically. It is an allowance and not a reservation
	 * — nothing is held open for a kind that has nothing worth showing.
	 */
	share?: (family: string) => number;
	/**
	 * The most of the row any one subject may take — see `subjectSeats`.
	 *
	 * Stands down with the rest of the mix when nothing else will fill a seat,
	 * because a row short of a card is worse than a row leaning on one genre.
	 */
	subjectSeats?: number;
	/**
	 * Shown to you recently — see `COOLDOWN_DAYS`.
	 *
	 * Not a penalty and not a filter. Held-back picks are simply not considered
	 * while anything else can fill the seat, including a budgeted seat: a slot
	 * whose only candidates have all been seen donates it rather than spending it
	 * on a repeat, which is the difference between a row that has moved on and a
	 * row that has moved five of seven places on.
	 *
	 * When *nothing* in the pool is fresh the hold lifts entirely, budget and
	 * all. Holding things back to keep the row moving is pointless once there is
	 * nowhere for it to move to, and a well-ordered repeat beats an empty row.
	 */
	held?: (one: T) => boolean;
	/** A group that may only have so many seats — see `LIKED_SEATS`. */
	quota?: { of: (one: T) => string | undefined; max: number };
}

/**
 * Fills the row against the budget, then fills what is left by plain merit.
 *
 * A slot nobody can fill — no series has a gap, nothing has been read up on
 * yet — donates its seat rather than leaving a hole, so the row is always as
 * full as the pool allows. Every pick, budgeted or not, still pays the
 * diversity penalty against what is already placed, so guaranteeing the
 * franchise strategy a seat does not mean guaranteeing three films of one
 * series — and no budgeted seat is exempt from the subject cap, which is the
 * one rule the favourite genre could otherwise buy its way past.
 */
export function fillSlots<
	T extends {
		score: number;
		strategy: StrategyId;
		tags: readonly string[];
		/** Which kind of thing this is, when the caller cares that they differ. */
		family?: string;
	},
>(scored: readonly T[], limit: number, options: FillOptions<T> = {}): T[] {
	const slots = options.slots ?? SLOTS;
	const penalty = options.penalty ?? 0.55;
	const kindPenalty = options.kindPenalty ?? 0.3;
	const subjects = options.subjectSeats ?? limit;
	const quota = options.quota;
	const holding = options.held;
	// Whether holding anything back can achieve anything — see `FillOptions.held`.
	const anyFresh = holding ? scored.some((one) => !holding(one)) : false;
	const stale = (one: T): boolean =>
		anyFresh && holding !== undefined && holding(one);

	const pool = [...scored];
	const out: T[] = [];
	const used = new Map<string, number>();
	const families = new Map<string, number>();
	const spent = new Map<string, number>();

	// One seat for anything the profile knows at all, and its fair share of the
	// rest. Worked out once: `share` walks a map, and this is inside the loop
	// that picks every seat.
	const allowances = new Map<string, number>();
	const allowance = (family: string): number => {
		const known = allowances.get(family);
		if (known !== undefined) return known;
		const share = options.share;
		// Never the whole row, however lopsided the library: a shelf that is
		// nine-tenths film has earned most of the row and not all of it, and that
		// last seat is what "some of everything" comes down to on a library like
		// that — it costs the majority kind its seventh-best answer.
		//
		// And no cap at all without a mix to go by, leaving only the gentle charge
		// below. A caller that has not said what the library is made of has not
		// said anything this could be fair about.
		const seats = share
			? Math.min(limit - 1, Math.max(1, Math.round(share(family) * limit)))
			: limit;
		allowances.set(family, seats);
		return seats;
	};

	const take = (
		only: StrategyId | undefined,
		repeats: boolean,
		mixed = true,
		capped = true,
	): boolean => {
		let bestAt = -1;
		let best = -Infinity;
		for (let at = 0; at < pool.length; at++) {
			const one = pool[at];
			if (!one || (only && one.strategy !== only)) continue;
			if (!repeats && stale(one)) continue;
			// Its kind has had what it earned, and something else has not. A
			// charge cannot do this job: the majority kind arrives with a
			// standing advantage — it is the kind the profile is mostly built
			// from, so it scores higher and `kindShare` pays it again — and any
			// charge small enough to be fair to a near-miss is small enough for
			// the seventh film to shrug off. Lifted below when nothing else will
			// take the seat, because a kind with nothing to say does not get to
			// hold a seat empty.
			if (
				mixed &&
				one.family &&
				(families.get(one.family) ?? 0) >= allowance(one.family)
			) {
				continue;
			}
			if (quota && capped) {
				const group = quota.of(one);
				if (group && (spent.get(group) ?? 0) >= quota.max) continue;
			}
			const seen = one.tags.reduce(
				(most, tag) => Math.max(most, used.get(tag.trim().toLowerCase()) ?? 0),
				0,
			);
			// Something it is about has had its share of the row — see
			// `subjectSeats`. Checked here rather than charged below for the same
			// reason the kind allowance is: the charge is what the favourite genre
			// is best able to pay.
			if (mixed && seen >= subjects) continue;
			const alike = one.family ? (families.get(one.family) ?? 0) : 0;
			const adjusted = one.score - seen * penalty - alike * kindPenalty;
			if (adjusted > best) {
				best = adjusted;
				bestAt = at;
			}
		}
		if (bestAt < 0) return false;
		const [picked] = pool.splice(bestAt, 1);
		if (!picked) return false;
		out.push(picked);
		for (const tag of picked.tags) {
			const key = tag.trim().toLowerCase();
			used.set(key, (used.get(key) ?? 0) + 1);
		}
		if (picked.family) {
			families.set(picked.family, (families.get(picked.family) ?? 0) + 1);
		}
		const group = quota?.of(picked);
		if (group) spent.set(group, (spent.get(group) ?? 0) + 1);
		return true;
	};

	for (const slot of slots) {
		for (let n = 0; n < slot.count && out.length < limit; n++) {
			take(slot.strategy, false);
		}
	}
	// The donated seats, and any spare. In order of what is worth giving up
	// first: something you have not seen matters more than the mix, and the mix
	// matters more than filling the row with what you have already been shown.
	while (
		out.length < limit &&
		(take(undefined, false) ||
			take(undefined, false, false) ||
			take(undefined, true) ||
			take(undefined, true, false) ||
			// And the quota last of all. Every other rule here stands down rather
			// than leave a seat empty, and this one did not: a row whose pool is
			// mostly things you have thumbed up seated two of them and then went
			// short — and a short row is what makes the press come round to what
			// you have already seen. Capping how much of the row is a reading list
			// is worth doing while there is something else to put there.
			take(undefined, true, false, false))
	) {
		/* keeps going until the pool or the limit runs out */
	}
	return out;
}

/**
 * Whether this one is a candidate at all, before anything is scored.
 *
 * A dislike is permanent, "seen it" means it is dealt with, and a snooze holds
 * until its date and then stops mattering on its own. Owned is the same idea
 * arrived at from the vault instead of a button — and adding a suggestion is
 * also recorded as a like, so the row learns from it either way.
 */
function considered(
	key: string,
	raw: RawSuggestion,
	options: Pick<RankOptions, "owned" | "feedback" | "skipped">,
	now: Date,
): boolean {
	if (options.skipped?.has(key)) return false;
	if (options.owned(raw.item)) return false;
	const verdict = activeVerdict(options.feedback[key], now);
	return !verdict || verdict === "liked";
}

/* Counting the pool was how the row used to decide whether to go and ask the
   sources for more, and `freshCandidates` was that count: eligible candidates
   not stood aside and not shown to you lately. It is gone because the number was
   never the one that mattered. A pool can hold forty candidates the row cannot
   *seat* — a quota spent, a kind that has had its share of the seven — so the
   count said "plenty left, no need to ask" while the row it drew came up short
   and filled the gap with what you had already seen. Two measures that could
   disagree, and the disagreement was the cycling. The engine asks the only
   question with one answer: of the row I am about to draw, how much of it has
   this person not seen? See `SuggestionEngine.unseen`. */

function daysSince(at: number, now: Date): number {
	return Math.max(0, (now.getTime() - at) / (24 * 60 * 60 * 1000));
}

/** Drawn recently enough that drawing it again would be a repeat. */
export function heldBack(at: number | undefined, now: Date): boolean {
	return at !== undefined && daysSince(at, now) < COOLDOWN_DAYS;
}

function shownPenalty(at: number | undefined, now: Date): number {
	if (at === undefined) return 0;
	return SHOWN_PENALTY * 0.5 ** (daysSince(at, now) / SHOWN_HALF_LIFE_DAYS);
}
