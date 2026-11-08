import type { MediaItem, MediaKind } from "./types";

/**
 * Scout's own score: what everybody thinks of a title, on one 0–10 scale.
 *
 * Every source grades on its own curve. IMDb's average film sits at 6.5 and
 * almost nothing passes 9; TMDB is the same story squeezed tighter; Metacritic
 * is a plain critical average; Rotten Tomatoes counts *how many* liked it, not
 * how much. Averaging the raw numbers would mostly measure which sources
 * happened to answer. So each reading is first moved onto one shared scale,
 * then the readings are blended by how much each one deserves to be believed.
 *
 * The blend works on a scale that reads the way people talk:
 *
 * - **10** the best thing you are likely ever to see — the very top of the canon
 * - **8** excellent, the territory of a top-250 list
 * - **5.5** the typical title; nothing wrong with it, nothing memorable
 * - **3** bad
 * - **0** among the worst things ever made
 *
 * What is shown is that scale lifted to sit where the sites people know put
 * things — see `shown`: a typical title reads 7 and a top-250 film 8.7.
 *
 * Pure: no network, and no clock but the one `scoutOfEntry` is handed for a
 * note that has only its own score.
 */

/** One source's opinion, out of ten whatever its native scale (87% is 8.7). */
export interface Reading {
	/** `imdb`, `rt-critics`, `tmdb`, … — the keys of `SOURCES`. */
	source: string;
	value: number;
	/** How many votes, reviews, or critics it is an average of, when known. */
	votes?: number;
}

/** Native out-of-ten value to Scout scale, as anchors joined by straight lines. */
export type Curve = readonly (readonly [number, number])[];

interface SourceProfile {
	curve: Curve;
	/**
	 * How much one full-strength reading counts against the others.
	 *
	 * IMDb is the widest audience sample and the best at telling films apart.
	 * Metacritic is a true critical average, nearly as discriminating. The
	 * Tomatometer is a critics' head count, strong at the bottom and blunt at the
	 * top; the Popcornmeter is the same for audiences and skews generous. TMDB
	 * is a smaller audience that largely overlaps IMDb's, so it mostly confirms.
	 * Rotten Tomatoes' pair has the most say between them: the two numbers most
	 * people check, and a Scout score usually lands between them — though never
	 * by rule, since everyone else is still a little over half of the say.
	 */
	weight: number;
	/** Votes at which a reading is half believed, the rest pulled to the middle. */
	halfVotes: number;
	/**
	 * A share of positive verdicts rather than an average. Near either end it
	 * stops saying how good or bad — a 98% only says nearly every critic liked
	 * it — so it can push the blend outwards but never drag it back in.
	 * The value is the share past which it stops separating titles.
	 */
	share?: number;
	/**
	 * TV on a scale of its own. Series are rated by the people who stayed for
	 * them, so a TV score runs higher than the same film score — by most in the
	 * middle, where an ordinary show sits a whole point above an ordinary film,
	 * and by least at the top, where Breaking Bad and The Shawshank Redemption
	 * meet. A flat allowance cannot do both, so the curve is drawn again.
	 */
	tvCurve?: Curve;
	/** The weight on TV, where it differs. */
	tvWeight?: number;
	/**
	 * A large, open audience: anyone can vote, any time after release — and so
	 * plenty who do not care for a genre mark it down. See `HORROR_LIFT`.
	 */
	broad?: true;
	/** How far it may stray from the crowds' averages, on Scout's scale; see `leash`. */
	leash?: number;
}

/** Where a typical title lands, and where thinly voted readings drift to. */
const MIDDLE = 5.5;

/**
 * The scale as shown: the blend's, lifted so a typical title reads 7.
 *
 * Every site people know puts its typical title well above the middle of its
 * scale — IMDb's at 6.5, Rotten Tomatoes' at 80% — so a 5.5 read as poor, and
 * a show every source rated in the low 80s read as a 7.5 that looked like a
 * mistake. The lift is greatest from the middle up, so the well-liked and the
 * acclaimed read the way their scores look; below the middle it falls away
 * steeply, so a film critics savaged and audiences shrugged at reads as bad,
 * not as merely below average. Above 8 it flattens again, so the top of a
 * well-chosen library does not crowd against 10: a top-250 film reads about
 * 8.7, a well-liked one about 8, and only the canon passes 9.4. The order of
 * anything never changes.
 */
const SHOWN: Curve = [
	[0, 0], [2, 1.8], [3, 2.8], [3.5, 3.5], [3.8, 4.2], [4.4, 5.6], [5, 6.5], [5.5, 7],
	[6, 7.35], [7, 8.05], [8, 8.7], [9, 9.22], [9.5, 9.5], [10, 10],
];

/** A value on the blend's scale, as Scout shows it. */
export function shown(value: number): number {
	return along(SHOWN, clamp(value));
}

/**
 * A share at or beyond these says "at least" or "at most", not "exactly".
 *
 * 85% is where a Tomatometer stops separating films: The Shawshank Redemption
 * sits at 89% and Paddington 2 at 99%, and nobody thinks that gap is the right
 * way round. Below it, a share still says plenty, and counts as it stands.
 * Audiences are kinder, so their Popcornmeter runs out of room later, at 88%.
 */
const SHARE_HIGH = 8.5;
const AUDIENCE_HIGH = 8.8;
const SHARE_LOW = 1.5;

/*
 * Letterboxd and Trakt are fitted, not guessed: each percentile of their scores
 * across a 300-title library is mapped onto the same percentile of what the
 * other sources blended to for those titles. Mapping whole distributions keeps
 * each source's spread; averaging the blend per score band would have squashed
 * it, since a noisy average always slides toward the middle.
 */

/** Letterboxd, out of ten (stars doubled): 3.1 stars is a typical film, 4.5 the canon. */
const LETTERBOXD: Curve = [
	[2, 0], [3, 0.8], [4.4, 3.5], [5.2, 4.6], [6.1, 5.4], [7, 6.5], [7.8, 7.4],
	[8.4, 8.2], [9, 9], [9.6, 10],
];
const LETTERBOXD_TV: Curve = [
	[4, 1.5], [5.7, 4.2], [7, 5.2], [7.6, 6.2], [8.2, 7.4], [9, 8.8], [9.5, 10],
];

/** Trakt, out of ten (its percentage over ten): high, and bunched. */
const TRAKT: Curve = [
	[4, 0.6], [5.9, 3.5], [6.3, 4.6], [6.8, 5.3], [7.5, 6.5], [8, 7.4], [8.35, 8.2],
	[8.8, 9], [9.2, 10],
];
const TRAKT_TV: Curve = [
	[5.5, 2], [6.8, 4.25], [7.2, 5.1], [7.5, 5.95], [7.9, 6.85], [8.22, 7.7],
	[8.55, 8.1], [9, 8.85], [9.5, 10],
];

/**
 * The curves, anchored on where each source's own percentiles fall: its
 * typical title at 5.5, the score that gets onto its top-250 near 8, its
 * all-time best near 10.
 */
export const SOURCES: Readonly<Record<string, SourceProfile>> = {
	imdb: {
		// Median film 6.5, the top 250 starts near 8.0, The Shawshank
		// Redemption is 9.3 and nothing has ever held 9.5.
		curve: [
			[1, 0], [2, 0.5], [3, 1.4], [4, 2.4], [5, 3.5], [5.5, 4.1], [6, 4.8],
			[6.5, 5.5], [7, 6.3], [7.5, 7.1], [8, 7.9], [8.5, 8.7], [9, 9.4], [9.5, 10],
		],
		// The median series sits near 7.3, a point above the median film; the
		// IMDb top 250 for TV starts near 8.4, as the film one does near 8.0;
		// Breaking Bad, Chernobyl and The Wire are 9.3–9.5.
		tvCurve: [
			[1, 0], [3, 0.7], [5, 2], [6, 3.2], [6.5, 4], [7, 5], [7.3, 5.7],
			[7.6, 6.35], [8, 7.1], [8.4, 7.9], [9, 9.1], [9.3, 9.6], [9.5, 10],
		],
		weight: 1,
		halfVotes: 500,
		broad: true,
	},
	metacritic: {
		// A weighted critical average, so close to linear; 81 and up is
		// Metacritic's own "universal acclaim".
		curve: [
			[0, 0], [2, 1], [3, 2], [4, 3.1], [5, 4.3], [6, 5.5], [7, 6.7], [8, 7.9],
			[9, 9.1], [10, 10],
		],
		weight: 0.85,
		halfVotes: 5,
		// One curve for films and series alike. Critics do grade series a little
		// lower — Chernobyl is 82, Breaking Bad 87 — but so does everyone else,
		// on their own TV curves, so read as it stands a Metacritic lands level
		// with the other sources on a series. A lift for TV read half a point
		// high, and carried acclaimed-but-quieter shows past better-loved ones.
	},
	"rt-critics": {
		curve: [
			[0, 0.3], [1, 1.2], [2, 2], [3, 2.8], [4, 3.5], [5, 4.2], [6, 4.9],
			[7, 5.7], [8, 6.6], [9, 7.6], [9.5, 8.2], [10, 8.8],
		],
		weight: 1.15,
		// A share of reviews, not an average: 94% of 44 critics is already
		// within a few points of the truth. Series draw far fewer reviews than
		// films (about 100 to a film's 250), so only a handful is held back.
		halfVotes: 5,
		share: SHARE_HIGH,
	},
	"rt-audience": {
		// Audiences are kinder than critics: a forgettable blockbuster still
		// pulls 80%, so the same percentage is worth less here.
		curve: [
			[0, 0.3], [2, 1.4], [3, 2.1], [4, 2.9], [5, 3.7], [6, 4.5], [7, 5.3],
			[8, 6.2], [8.5, 6.8], [9, 7.5], [9.5, 8.3], [10, 9],
		],
		// A series' Popcornmeter averages its seasons, and a late season is
		// where an audience airs its grievances: Severance's second, The Last of
		// Us's. So a series' percentage runs lower than the show it describes,
		// and is read on its own, kinder curve.
		tvCurve: [
			[0, 0.3], [3, 2.6], [4.4, 4.2], [5.7, 5.1], [6.7, 5.8], [7.75, 6.8],
			[8.45, 7.6], [9.2, 8.2], [9.7, 9], [10, 9.4],
		],
		// Nearly as much say as the critics: what an audience thought matters.
		// Not quite as much, as it is the share most swayed by fans — Five
		// Nights at Freddy's 2 has 81% here beside IMDb's 5.1.
		weight: 1.05,
		halfVotes: 100,
		// Kinder graders run out of room later: 88% here is where 85% is for
		// critics. So between them it still tells The Dark Knight's 94% from
		// The Return of the King's 86%, which a cut at 85% treated alike.
		share: AUDIENCE_HIGH,
		leash: 0.5,
	},
	tmdb: {
		// IMDb's distribution pressed into a narrower band, and set a little
		// higher: a typical film is 7.2 here to IMDb's 7.1, and the canon tops
		// out near 8.7. Fitted like Letterboxd's, percentile for percentile.
		curve: [
			[1, 0], [3, 0.8], [4, 1.9], [5, 2.6], [5.8, 3.2], [6.2, 4.5], [6.7, 5.15],
			[7.2, 6.45], [7.6, 7.3], [8.1, 8.1], [8.5, 9], [8.9, 9.8], [9.1, 10],
		],
		// TMDB's series bunch higher still, and barely apart: a forgettable
		// procedural and an acclaimed drama both sit at 8.2–8.4. So on TV it is
		// read with that in mind, and counts for less than on films.
		tvCurve: [
			[3, 0.5], [5, 2], [6, 3], [6.6, 4.1], [7.1, 5], [7.5, 5.8], [7.9, 6.65],
			[8.2, 7.6], [8.4, 8.1], [8.7, 8.9], [9.1, 10],
		],
		tvWeight: 0.3,
		weight: 0.55,
		halfVotes: 100,
		broad: true,
	},
	letterboxd: {
		// Stars out of five, doubled. An average, not a head count, from an
		// audience that rates nearly everything it watches — so it tells a good
		// film from a great one, which a Tomatometer cannot. Of all the
		// audience sources it agrees best with the critics (r 0.77 against
		// Metacritic, to IMDb's 0.75), so it counts nearly as much as IMDb.
		curve: LETTERBOXD,
		tvCurve: LETTERBOXD_TV,
		weight: 0.8,
		halfVotes: 500,
	},
	trakt: {
		// A percentage average from an audience much like TMDB's: high, and
		// bunched, and no closer to the critics (r 0.67), so it mostly confirms.
		curve: TRAKT,
		tvCurve: TRAKT_TV,
		weight: 0.35,
		halfVotes: 200,
		broad: true,
	},
		anilist: {
		// Typical show around 70%; Frieren and Fullmetal Alchemist:
		// Brotherhood are 90–91%.
		curve: [
			[2, 0], [4, 1.8], [5, 3], [6, 4.3], [6.5, 5], [7, 5.7], [7.5, 6.5],
			[8, 7.4], [8.5, 8.4], [9, 9.4], [9.4, 10],
		],
		weight: 1,
		halfVotes: 1000,
	},
	"igdb-critics": {
		// Games critics grade high: 75 is ordinary, 90 is game of the year talk.
		curve: [
			[2, 0], [4, 1.8], [5, 2.8], [6, 3.9], [7, 5.1], [7.5, 5.8], [8, 6.6],
			[8.5, 7.5], [9, 8.5], [9.5, 9.5], [9.8, 10],
		],
		weight: 1,
		halfVotes: 4,
	},
	igdb: {
		// Players, and the blended `total_rating` a game note keeps.
		curve: [
			[1, 0], [3, 1], [4, 1.9], [5, 3], [6, 4.2], [7, 5.5], [7.5, 6.2], [8, 7],
			[8.5, 7.9], [9, 8.8], [9.5, 9.6], [10, 10],
		],
		weight: 0.8,
		halfVotes: 30,
	},
	openlibrary: {
		// Star ratings bunch up high: 3.8 stars (7.6 here) is a typical book.
		curve: [
			[2, 0], [4, 1.2], [5, 2.2], [6, 3.3], [7, 4.6], [7.5, 5.3], [8, 6.2],
			[8.5, 7.2], [9, 8.4], [9.5, 9.4], [10, 10],
		],
		weight: 1,
		halfVotes: 20,
	},
	goodreads: {
		// The same stars, from a far larger crowd: a note made elsewhere that
		// kept only Goodreads' average.
		curve: [
			[2, 0], [4, 1.2], [5, 2.2], [6, 3.3], [7, 4.6], [7.5, 5.3], [8, 6.2],
			[8.5, 7.2], [9, 8.4], [9.5, 9.4], [10, 10],
		],
		weight: 1,
		halfVotes: 20,
	},
	musicbrainz: {
		curve: [
			[2, 0], [4, 1.2], [5, 2.2], [6, 3.3], [7, 4.6], [7.5, 5.3], [8, 6.2],
			[8.5, 7.2], [9, 8.4], [9.5, 9.4], [10, 10],
		],
		weight: 1,
		halfVotes: 5,
	},
};

export function along(curve: Curve, value: number): number {
	const first = curve[0];
	const last = curve[curve.length - 1];
	if (!first || !last) return value;
	if (value <= first[0]) return first[1];
	if (value >= last[0]) return last[1];
	for (let i = 1; i < curve.length; i++) {
		const [x1, y1] = curve[i] as readonly [number, number];
		const [x0, y0] = curve[i - 1] as readonly [number, number];
		if (value <= x1) return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
	}
	return last[1];
}

/** One reading on Scout's scale, before it is weighed against anything. */
export function calibrate(reading: Reading, kind: MediaKind): number {
	const profile = SOURCES[reading.source];
	// A source Scout has no curve for, such as a hand-written note, is taken at
	// its word: it is already out of ten, and there is nothing better to do.
	if (!profile) return clamp(reading.value);
	if (kind === "tv" && profile.tvCurve) return along(profile.tvCurve, reading.value);
	return along(profile.curve, reading.value);
}

const clamp = (value: number): number => Math.min(10, Math.max(0, value));

/** What is known about the title besides its scores. */
export interface TitleFacts {
	/** Genres, as the source or the note names them. */
	genres?: readonly string[];
	/** ISO date, or failing that the year. */
	releaseDate?: string;
	year?: number;
}

/**
 * Horror, read by the broad audience, is read a little up.
 *
 * Anyone can vote on IMDb, and plenty who do not care for horror watch it
 * anyway and mark it down; critics, who review everything, do not. Measured on
 * this library, the broad audience sits half a point lower on horror than on
 * anything else for the same critical standing — The Babadook, It Follows and
 * Hereditary are MC 83–87 and IMDb 6.8–7.3, where a drama of that standing is
 * near 8. Most of that gap is put back. A horror fan's own Popcornmeter is not
 * touched: it has no such skew.
 */
const HORROR_LIFT = 0.4;
const isHorror = (facts: TitleFacts): boolean =>
	(facts.genres ?? []).some((one) => /horror/i.test(one));

/**
 * Reality TV is read closer to the middle, from both ends.
 *
 * Its scores spread wider than its quality does: the people who rate a reality
 * show are its fans, rating the format as much as the series, and the handful
 * of critics who review one grade it against other reality TV. So The Traitors
 * reads like Sherlock on IMDb and Metacritic alike, and Beast Games — which its
 * audience mostly enjoys — reads like a panned film. Each source keeps 60% of
 * its distance from the middle, which puts the best of the genre among very
 * good television rather than among the best ever made, and the worst of it
 * above the films that fail at being films.
 */
const REALITY_SPREAD = 0.6;
const isReality = (facts: TitleFacts): boolean =>
	(facts.genres ?? []).some((one) => /reality/i.test(one));

interface Weighed {
	source: string;
	value: number;
	/** What it says before its vote count is taken into account. */
	heard: number;
	/** How far its vote count lets it get from the middle, 0–1. */
	trust: number;
	weight: number;
	/** -1 says "at most", 1 says "at least", 0 says "this". */
	bound: -1 | 0 | 1;
}

function weigh(reading: Reading, kind: MediaKind, facts: TitleFacts): Weighed | undefined {
	if (!Number.isFinite(reading.value) || reading.value <= 0) return undefined;
	// Zero votes is nobody having voted, which is not an opinion.
	if (reading.votes !== undefined && reading.votes <= 0) return undefined;
	const profile = SOURCES[reading.source];
	const base =
		(kind === "tv" ? (profile?.tvWeight ?? profile?.weight) : profile?.weight) ?? 1;
	const lift = profile?.broad && isHorror(facts) ? HORROR_LIFT : 0;
	const read = clamp(calibrate(reading, kind) + lift);
	const calibrated = isReality(facts) ? MIDDLE + (read - MIDDLE) * REALITY_SPREAD : read;
	// The same shrinkage IMDb applies to its own top 250: a handful of votes
	// is a handful of people, so the reading only gets partway from the middle.
	// `anchorThin` moves that pull onto the other sources when there are any.
	const votes = reading.votes;
	const half = profile?.halfVotes ?? 0;
	const trust = votes === undefined || half === 0 ? 1 : votes / (votes + half);
	const bound = !profile?.share
		? 0
		: reading.value >= profile.share
			? 1
			: reading.value <= SHARE_LOW
				? -1
				: 0;
	return {
		source: reading.source,
		value: MIDDLE + (calibrated - MIDDLE) * trust,
		heard: calibrated,
		trust,
		weight: base * trust,
		bound,
	};
}

/**
 * A thin source is pulled toward what the other sources say, not toward the
 * middle.
 *
 * Shrinking a small sample toward the middle is right when it is all there is.
 * Beside well-voted sources that already agree, it is a drag: 93 TMDB votes on
 * a film every other source puts near 9.5 counted as an 8.4, and cost the film
 * its place under one with the same ratings and older, bigger samples. Pulled
 * toward the rest instead, a thin source still says little — and has less say
 * — but no longer says "average". Only sources with more votes behind them
 * than it are leaned on, read as they already stand: thin sources would
 * otherwise prop each other up, and a niche show with a few thousand votes
 * everywhere would read as surely as a classic. The best-voted source of all
 * still shrinks toward the middle. Shares that only say "at least" or "at
 * most" are left out of the anchor while anything else is there.
 */
function anchorThin(rows: readonly Weighed[]): Weighed[] {
	return rows.map((one) => {
		if (one.trust >= 1) return one;
		const others = rows.filter((other) => other !== one && other.trust > one.trust);
		const anchor =
			mean(others.filter((other) => other.bound === 0)) ?? mean(others) ?? MIDDLE;
		return { ...one, value: anchor + (one.heard - anchor) * one.trust };
	});
}

/** The averages of everyone who watched, rather than a share of who liked it. */
const CROWDS = new Set(["imdb", "letterboxd", "tmdb", "trakt"]);

/**
 * Keeps a source with a `leash` within that much of what the crowds say.
 *
 * A Popcornmeter far from IMDb, Letterboxd, TMDB and Trakt alike is measuring
 * who turned up rather than the film: the fans who bought tickets for Jigsaw
 * (88% beside IMDb's 5.7), or a review-bombing that the crowds did not join.
 */
function leash(rows: readonly Weighed[]): Weighed[] {
	const crowd = mean(rows.filter((one) => CROWDS.has(one.source)));
	return rows.map((one) => {
		const reach = SOURCES[one.source]?.leash;
		if (reach === undefined || crowd === undefined) return one;
		return { ...one, value: Math.min(crowd + reach, one.value) };
	});
}

/**
 * Gives a film's missing Tomatometer's say to its Metacritic.
 *
 * MDBList answers Rotten Tomatoes blank for some titles — Oppenheimer, The
 * Matrix — and without it the blend tips toward audiences, letting off a film
 * critics were cool on. Metacritic is the other critics' score: hiding the
 * Tomatometer on films that have one, this put them a third closer to their
 * full score. Series are left as they are, where it did not help.
 */
function standIn(rows: readonly Weighed[], kind: MediaKind): readonly Weighed[] {
	if (kind !== "movie" || rows.some((one) => one.source === "rt-critics")) return rows;
	const say = SOURCES["rt-critics"]?.weight ?? 0;
	return rows.map((one) =>
		one.source === "metacritic" ? { ...one, weight: one.weight + say * one.trust } : one,
	);
}

/**
 * How far a film's blend goes toward its two big crowds when both rate it lower.
 *
 * Critics' shares and the Popcornmeter run kind to a middling film — Good Boy
 * has 90% beside IMDb's 6.1 and Letterboxd's 6.0 — so a low IMDb barely
 * showed. Pulling most of the way toward the kinder of the two leaves a film
 * either crowd rates up to its blend untouched: Saint Maud's Letterboxd 7.0
 * keeps it near where it was, and the top of the list does not move. Against
 * your own ratings it lifted the films' fit from 0.53 to 0.55; pulling all the
 * way fitted a little better still but put more pairs in an order their
 * sources disagree with.
 */
const CROWD_PULL = 0.75;

/**
 * How much more say IMDb has on a film it rates below everyone else.
 *
 * Only ever down. More say both ways mostly lifted films critics panned and
 * IMDb shrugged at — Insurgent, Man on a Ledge — and fitted no better.
 */
const IMDB_DISSENT = 2;

/** A film's IMDb, given more say when it rates the film lower than the rest do. */
function dissent(rows: readonly Weighed[], kind: MediaKind): readonly Weighed[] {
	const blend = mean(rows);
	if (kind !== "movie" || blend === undefined) return rows;
	return rows.map((one) =>
		one.source === "imdb" && one.value < blend
			? { ...one, weight: one.weight * IMDB_DISSENT }
			: one,
	);
}

/**
 * The blend, pulled toward IMDb and Letterboxd when they agree it is lower.
 *
 * Films only: series rarely have a Letterboxd to corroborate IMDb, and those
 * that do fitted no better.
 */
function heed(mixed: number, rows: readonly Weighed[], kind: MediaKind): number {
	if (kind !== "movie") return mixed;
	const imdb = rows.find((one) => one.source === "imdb");
	const letterboxd = rows.find((one) => one.source === "letterboxd");
	if (!imdb || !letterboxd) return mixed;
	const kinder = Math.max(imdb.value, letterboxd.value);
	if (kinder >= mixed) return mixed;
	return mixed - CROWD_PULL * Math.min(imdb.trust, letterboxd.trust) * (mixed - kinder);
}

function mean(rows: readonly Weighed[]): number | undefined {
	const total = rows.reduce((sum, one) => sum + one.weight, 0);
	if (total <= 0) return undefined;
	return rows.reduce((sum, one) => sum + one.value * one.weight, 0) / total;
}

/** One source's part in a blend: what it counted as, and how much of the say it had. */
export interface ScoutPart {
	source: string;
	/** On Scout's scale, after everything the blend does to it. */
	value: number;
	/** Its share of the weight, 0–1; the shares add up to 1. */
	share: number;
	/** How far its vote count let it get from the middle, 0–1. */
	trust: number;
}

/** One thing that moved the blend after the sources were weighed, on Scout's scale. */
export interface ScoutAdjustment {
	/**
	 * `crowds`: IMDb and Letterboxd both rate a film lower. `fresh`: out less
	 * than two months. `votes`: fewer IMDb votes than a title everyone has seen.
	 */
	reason: "crowds" | "fresh" | "votes";
	/** Negative: every adjustment only ever holds a score back. */
	by: number;
}

/**
 * The blend, to one decimal, with each source's part in it — or undefined when
 * nobody has said anything.
 *
 * Saturated shares are settled against everything else first: a 97%
 * Tomatometer beside a 9.6 from everywhere else agrees with the 9.6 rather
 * than dragging it down to what 97% means for an ordinary crowd-pleaser.
 */
export function explainScout(
	readings: readonly Reading[],
	kind: MediaKind,
	facts: TitleFacts = {},
	now: number = Date.now(),
): {
	score: number;
	exact: number;
	held: number;
	/** How far it was held toward the middle for having few IMDb votes, 0–1. */
	unproven: number;
	/** How far IMDb and Letterboxd pulled it down, on the blend's scale. */
	heeded: number;
	/** The sources' weighted blend on Scout's scale, before any adjustment. */
	blended: number;
	/** What took the blend to the score, in order, on Scout's scale. */
	adjustments: ScoutAdjustment[];
	parts: ScoutPart[];
} | undefined {
	const rows = standIn(
		leash(
			anchorThin(
				readings
					.map((one) => weigh(one, kind, facts))
					.filter((one): one is Weighed => one !== undefined),
			),
		),
		kind,
	);
	const exact = mean(rows.filter((one) => one.bound === 0));
	const bounded =
		exact === undefined
			? rows
			: rows.map((one) =>
					one.bound === 1
						? { ...one, value: Math.max(one.value, exact) }
						: one.bound === -1
							? { ...one, value: Math.min(one.value, exact) }
							: one,
				);
	const final = dissent(bounded, kind);
	const total = final.reduce((sum, one) => sum + one.weight, 0);
	if (total <= 0) return undefined;
	// The blend is lifted onto the shown scale as a whole, so one title's order
	// against another is exactly the blend's. Each part is shown as what it
	// would have counted for on its own: near the headline when the sources
	// agree, and spread around it when they do not.
	// A title in its first months is held a little toward the middle as a whole,
	// since even a well-voted early score is mostly keen first viewers. Only
	// ever down: keen first viewers flatter a bad film too, never the reverse.
	const raw = final.reduce((sum, one) => sum + one.value * one.weight, 0) / total;
	const mixed = heed(raw, final, kind);
	const held =
		mixed > MIDDLE
			? FRESH_HOLD * (1 - settled(facts.releaseDate, facts.year, now, HOLD_DAYS))
			: 0;
	// So is one fewer people have rated, however keen: a top score from 27,000
	// voters has not been tested the way one from three million has.
	const unproven = mixed > MIDDLE ? VOTE_HOLD * (1 - proven(readings, kind)) : 0;
	const settling = MIDDLE + (mixed - MIDDLE) * (1 - held);
	const blend = MIDDLE + (settling - MIDDLE) * (1 - unproven);
	const precise = shown(blend);
	const steps: [ScoutAdjustment["reason"], number, number][] = [
		["crowds", raw, mixed],
		["fresh", mixed, settling],
		["votes", settling, blend],
	];
	return {
		score: tenths(precise),
		exact: precise,
		held,
		unproven,
		heeded: raw - mixed,
		blended: shown(raw),
		adjustments: steps
			.filter(([, from, to]) => from !== to)
			.map(([reason, from, to]) => ({ reason, by: shown(to) - shown(from) })),
		parts: final.map((one) => ({
			source: one.source,
			value: shown(one.value),
			share: one.weight / total,
			trust: one.trust,
		})),
	};
}

const tenths = (value: number): number => Math.round(value * 10) / 10;

/** The blend, to one decimal, or undefined when nobody has said anything. */
export function scoutScore(
	readings: readonly Reading[],
	kind: MediaKind,
	facts: TitleFacts = {},
): number | undefined {
	return explainScout(readings, kind, facts)?.score;
}

/** A single source score — a note's, or a search result's — on Scout's scale. */
export function scoutOf(
	providerId: string | undefined,
	kind: MediaKind,
	score: number | undefined,
	votes?: number,
	facts: TitleFacts = {},
): number | undefined {
	if (score === undefined || score <= 0) return undefined;
	return scoutScore(
		[{ source: providerId ?? "", value: score, ...(votes !== undefined ? { votes } : {}) }],
		kind,
		facts,
	);
}

/**
 * A source record's score on Scout's scale.
 *
 * Scaled by its own vote count, so a four-vote 10.0 does not outrank a classic.
 * AniList's count is of members rather than voters, so it is left out there.
 */
export function scoutOfItem(item: MediaItem): number | undefined {
	const { providerId, kind } = item.ref;
	const facts: TitleFacts = { releaseDate: item.releaseDate, year: item.year };
	if (isHype([providerId], facts)) return undefined;
	return scoutOf(
		providerId,
		kind,
		item.rating,
		providerId === "anilist" ? undefined : item.ratingCount,
		{ genres: item.tags, ...facts },
	);
}

/**
 * Sources that let anyone rate a title before it is out.
 *
 * On a film months from release their score is people who want to see it, and
 * seven of them at that: Spider-Man: Beyond the Spider-Verse, more than half a
 * year off, read 8.0 from Trakt alone, above films that had opened to good
 * reviews. Such a title gets no Scout score; a film gets a hype, the score it is likely to settle at.
 */
const HYPE_SOURCES: ReadonlySet<string> = new Set(["trakt", "tmdb"]);

/**
 * Whether a title's scores are anticipation rather than a verdict: it is not
 * out yet, and every score it has comes from somewhere that takes ratings
 * before release. A festival film with reviews in is not hype, however far
 * off its opening — its critics have seen it.
 */
export function isHype(
	sources: readonly string[],
	facts: TitleFacts,
	now: number = Date.now(),
): boolean {
	return sources.every((one) => HYPE_SOURCES.has(one)) && isUnreleased(facts, now);
}

/** Not out yet: its day is still to come, or failing a day, its year. */
export function isUnreleased(facts: TitleFacts, now: number = Date.now()): boolean {
	const day = releaseDay(facts.releaseDate);
	if (day !== undefined) return day > now;
	return facts.year !== undefined && facts.year > new Date(now).getFullYear();
}

/** A `YYYY-MM-DD…` release date as local midnight, or undefined. */
export function releaseDay(releaseDate: string | undefined): number | undefined {
	const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(releaseDate ?? "");
	return day
		? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime()
		: undefined;
}

/**
 * How far a note's score has settled, 0.3–1, judged by how long it has been out.
 *
 * Notes keep no vote counts, so the release date stands in for them. A score
 * in its first weeks is a few hundred early, keen viewers — a documentary out
 * three weeks sat at TMDB 8.9, above The Shawshank Redemption — and those
 * scores fall as everyone else catches up. Trust starts at 0.3 on release and
 * is full after a year. Anything without a date is taken as settled.
 */
const FRESH_TRUST = 0.3;
/**
 * How far a full blend is held toward the middle on release, easing to none
 * over two months. Vote counts already doubt a thin sample, but a well-voted
 * first month is still mostly the keenest viewers: a documentary three weeks
 * out outranked The Shawshank Redemption on every source it had. Most scores
 * have settled within a month or two; six months held a well-loved film back
 * long after its numbers had stopped moving.
 */
const FRESH_HOLD = 0.15;
const HOLD_DAYS = 61;
const SETTLES_DAYS = 365;

/**
 * How far a title with hardly anyone voting is held toward the middle, easing
 * to none once it has as many votes as the films everyone has seen.
 *
 * Vote counts already doubt a thin sample, but only up to a few thousand
 * votes; past that a 9.1 counted the same from anyone. Counted on a log scale
 * of IMDb's votes, so 100,000 is halfway from 10,000 to a million. A
 * documentary with 27,000 settles at 9.4, under The Shawshank Redemption's
 * 3.2 million, where it had read 9.5; the top of the list, all well past a
 * million, does not move.
 */
const VOTE_HOLD = 0.06;
/** Below this many IMDb votes, the hold is full. */
const PROVEN_FEW = 10_000;
/** IMDb votes at which a title has been seen by everyone; series draw fewer. */
const PROVEN_MANY: Partial<Record<MediaKind, number>> = { movie: 1_000_000, tv: 300_000 };

/** How far IMDb's vote count has proved a title, 0–1; 1 without one to judge by. */
function proven(readings: readonly Reading[], kind: MediaKind): number {
	const votes = readings.find((one) => one.source === "imdb")?.votes;
	const many = PROVEN_MANY[kind];
	if (votes === undefined || many === undefined) return 1;
	if (votes <= PROVEN_FEW) return 0;
	return Math.min(1, Math.log(votes / PROVEN_FEW) / Math.log(many / PROVEN_FEW));
}
const DAY_MS = 24 * 60 * 60 * 1000;

export function settledShare(
	releaseDate: string | undefined,
	year: number | undefined,
	now: number,
): number {
	return FRESH_TRUST + (1 - FRESH_TRUST) * settled(releaseDate, year, now, SETTLES_DAYS);
}

/** How far through its first `span` days a title is, 0 on release to 1 after; undated is 1. */
function settled(
	releaseDate: string | undefined,
	year: number | undefined,
	now: number,
	span: number,
): number {
	const today = new Date(now);
	let released = releaseDay(releaseDate);
	if (released === undefined && year !== undefined && Number.isFinite(year)) {
		// A year alone: last year or earlier has had its months; this year or
		// later is taken from the middle of it.
		if (year < today.getFullYear()) return 1;
		released = new Date(year, 6, 1).getTime();
	}
	if (released === undefined) return 1;
	const days = (now - released) / DAY_MS;
	return Math.min(1, Math.max(0, days / span));
}

/** How Scout keys a title's stored score: `providerId:kind:id`. */
export function scoreKey(ref: { providerId: string; kind: MediaKind; id: string }): string {
	return `${ref.providerId}:${ref.kind}:${ref.id}`;
}

/**
 * A library note's score on Scout's scale.
 *
 * The full blend when Scout has readings stored for the title — the same
 * readings, and so the same number, as the detail dialog. The readings are
 * kept rather than the number so a change to the blend reaches the whole
 * library at once, without asking anyone again. Otherwise the note's own source score, read on that
 * source's curve and discounted by how recently it came out, since notes keep
 * no vote counts. `now` is only for that discount; it defaults to the clock.
 */
export function scoutOfEntry(entry: ScoredEntry, now: number = Date.now()): number | undefined {
	const exact = exactScoutOfEntry(entry, now);
	return exact === undefined ? undefined : tenths(exact);
}

export interface ScoredEntry {
	kind: MediaKind;
	readings?: readonly Reading[];
	sourceRating?: number;
	/** Whose scale `sourceRating` is on, when the note says without a source. */
	ratingSource?: string;
	ref?: { providerId: string };
	tags?: readonly string[];
	releaseDate?: string;
	year?: number;
}

/**
 * `scoutOfEntry` before rounding, for ordering titles.
 *
 * Two titles that both show 9.5 can sit at 9.52 and 9.47; sorting on the shown
 * number tied them and fell back to the alphabet, so The Lord of the Rings
 * ranked above The Shawshank Redemption.
 */
export function exactScoutOfEntry(
	entry: ScoredEntry,
	now: number = Date.now(),
): number | undefined {
	const facts: TitleFacts = {
		...(entry.releaseDate ? { releaseDate: entry.releaseDate } : {}),
		...(entry.year !== undefined ? { year: entry.year } : {}),
	};
	const genres = entry.tags ? { genres: entry.tags } : {};
	const readings = entry.readings ?? [];
	const source = entry.ref?.providerId ?? entry.ratingSource;
	const from = readings.length > 0 ? readings.map((one) => one.source) : source ? [source] : [];
	if (isHype(from, facts, now)) return undefined;
	if (readings.length > 0) {
		const blend = explainScout(readings, entry.kind, { ...genres, ...facts }, now)?.exact;
		if (blend !== undefined) return blend;
	}
	// Undated here, since the release date's discount below is the stronger one.
	const read = scoutOf(source, entry.kind, entry.sourceRating, undefined, genres);
	if (read === undefined) return undefined;
	const trust = settledShare(entry.releaseDate, entry.year, now);
	return MIDDLE + (read - MIDDLE) * trust;
}

