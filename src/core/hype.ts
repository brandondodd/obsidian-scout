import type { ScoreLog } from "./settings/cacheFile";
import type { MediaItem } from "./types";
import {
	explainScout,
	exactScoutOfEntry,
	isUnreleased,
	scoreKey,
	scoutOfItem,
	settledShare,
	type ScoredEntry,
} from "./scout-score";

/**
 * Hype: the Scout score a film not out yet is likely to settle at, once its
 * reviews are in and have stopped moving.
 *
 * A handful of early star ratings says little — seven people on Trakt gave a
 * film seven months off its score — so this reads what is known before
 * release instead: how the earlier films in its series did, how its
 * directors' earlier films did, its genres and its budget. Fitted on 2,400
 * films from 2010 to 2024 at their settled TMDB averages, each predicted from
 * only what had come out before it: off by 0.47 of a TMDB point on a typical
 * film, cross-validated, where guessing every film average is off by 0.59.
 * The directors' weight has since been raised by hand (see below).
 * That prediction is then read the way Scout reads a settled TMDB average.
 *
 * An earlier film is measured against what its own genres usually get, not
 * against every film: a horror director whose films sit at 7.3 is doing very
 * well, and reading that 7.3 against the average film, then taking horror's
 * discount off again in the genre step, wrote them down twice.
 *
 * Only ever shown where a Scout score is not: a film that is out, or has
 * reviews in, has a verdict to show instead. Films only; a series not out yet
 * has no earlier seasons to go on.
 */

/** A film out before the one being foreseen, at its TMDB average. */
export interface EarlierFilm {
	title: string;
	rating: number;
	/** TMDB's genre names: what the film is measured against. */
	genres?: string[];
	/** `YYYY-MM-DD`: how long before the new film it came out. */
	released?: string;
	/** TMDB votes behind `rating`: how settled it is. */
	votes?: number;
}

/** What is known about a film before it is out: what Scout's hype is worked out from. */
export interface Outlook {
	/** The films of its series out before it, oldest first. */
	series?: { name: string; films: EarlierFilm[] };
	/** Its directors' earlier films, oldest first. */
	directors?: { names: string[]; films: EarlierFilm[] };
	/** TMDB's genre names. */
	genres: string[];
	/** In US dollars, when TMDB has it. */
	budget?: number;
}

/** A film with nothing else known, on TMDB's scale. */
const TYPICAL = 7.0;
/** The average film, which an earlier film's genres are measured from. */
const AVERAGE = 6.96;

/**
 * Half of how far its series has run above or below what its genres get, the
 * latest film counting as much as all the others: Into and Across the
 * Spider-Verse's 8.4s say a lot about Beyond, and Shrek the Third about Shrek
 * Forever After. Even one earlier film says nearly all it ever will.
 */
const SERIES_SAY = 0.51;
const SERIES_SHRINK = 0.1;
const LATEST_SHARE = 0.5;

/**
 * Up to this much, for a series whose films have agreed with each other.
 * Into and Across the Spider-Verse sit 0.05 apart, and a third is likely to
 * land near them; Shrek has swung by a point and a half, and says only the
 * half it always did. Set by hand: the fit had no notion of agreement, and
 * held Beyond two thirds of a point below both films before it. Agreement
 * is full with no spread and gone at `SERIES_SPREAD` of a TMDB point.
 */
const SERIES_AGREED_SAY = 0.85;
const SERIES_SPREAD = 0.5;

/**
 * And this much more when a director of the series comes back: the same
 * people making more of the same. A Minecraft Movie's director making its
 * sequel says more about it than a new hand would, and held only to the half,
 * the sequel drifted half a point above the film it follows. Their other
 * films then count for half: the series is already their work, in this very
 * world, and adding all of Villeneuve's career on top put Dune: Part Three
 * above Part Two.
 */
const SERIES_SAME_TEAM = 0.3;
const SAME_TEAM_DIRECTORS = 0.5;

/**
 * Most of how its directors' earlier films did, each counting half as much
 * for every six years before this one, with the latest film alone making up
 * two fifths: a director's last two films say more than the comedy they made
 * twenty years ago. Zach Cregger's Barbarian and Weapons, both well above
 * what horror gets, outweigh Miss March, so his next film is expected to be
 * good. A single recent film counts for most of what a career would.
 *
 * Set by hand above the fit, which was cautious with directors: fitted, a
 * director whose last two films were among the best of their genre moved the
 * next one by barely a tenth of a point on Scout's scale.
 */
const DIRECTORS_SAY = 0.9;
const DIRECTORS_SHRINK = 0.4;
const DIRECTORS_LATEST = 0.4;
const DIRECTORS_HALF_LIFE_YEARS = 6;

/**
 * How each genre's films run against the average film, on TMDB, among genres
 * with at least fifteen of the 2,100. A film in several gets their mean, and
 * a genre matters more than the gap alone suggests: a war film or an
 * animation is seldom made carelessly, and an action thriller often is.
 */
const GENRE_SAY = 1.66;
const GENRES: Readonly<Record<string, number>> = {
	Action: -0.14,
	Adventure: -0.02,
	Animation: 0.4,
	Comedy: -0.07,
	Crime: 0.05,
	Drama: 0.27,
	Family: 0.16,
	Fantasy: -0.03,
	History: 0.36,
	Horror: -0.36,
	Music: 0.48,
	Mystery: -0.15,
	Romance: 0.12,
	"Science Fiction": -0.12,
	Thriller: -0.13,
	War: 0.46,
	Western: 0.32,
};

/**
 * A big budget is a slightly worse sign than a small one: an eighth of a point
 * for each tenfold over $100 million. And a film whose money is on record runs
 * a little under one whose is not — the films nobody reports a budget for
 * lean towards the smaller, more personal ones.
 */
const BUDGET_PER_TENFOLD = -0.12;
const BUDGET_PIVOT = 100_000_000;
const BUDGET_KNOWN = -0.2;
/** Below this TMDB's budget is a placeholder, not a budget. */
const BUDGET_FLOOR = 100_000;

export type HypeReason = "series" | "directors" | "genres" | "budget";

export interface HypeStep {
	reason: HypeReason;
	/** On Scout's scale, unrounded. */
	by: number;
}

export interface Hype {
	/** The predicted Scout score, unrounded. */
	value: number;
	/** A film with nothing else known, on Scout's scale. */
	typical: number;
	/** How each thing known moved it, in order; they add up to `value - typical`. */
	steps: HypeStep[];
}

const mean = (values: readonly number[]): number =>
	values.reduce((sum, one) => sum + one, 0) / values.length;

/** How far genres run from the average film; undefined when none of them is counted. */
function genreLean(genres: readonly string[]): number | undefined {
	const known = genres.flatMap((one) => (one in GENRES ? [GENRES[one] as number] : []));
	return known.length > 0 ? mean(known) : undefined;
}

/**
 * Votes at which an earlier film's average is half believed. A short with
 * sixty votes says little about its director; Obsession's 8.2 on six and a
 * half thousand, months after release, is as settled as Barbarian's.
 */
const HALF_VOTES = 200;

/**
 * How far an earlier film ran above or below what its genres usually get,
 * held back while its score has few votes behind it. A film filed before
 * votes were kept falls back on its age, as a note's score does.
 */
const beyond = (film: EarlierFilm, now: number): number =>
	(film.rating - (AVERAGE + (genreLean(film.genres ?? []) ?? 0))) * trust(film, now);

/** How far an earlier film's average is believed, 0–1. */
const trust = (film: EarlierFilm, now: number): number =>
	film.votes !== undefined
		? film.votes / (film.votes + HALF_VOTES)
		: settledShare(film.released, undefined, now);

/**
 * A director with one film that has settled says less than one with a run of
 * them: Curry Barker's Obsession is a single great film, where Zach Cregger
 * has Barbarian, Weapons and Resident Evil. One counts this much of what two
 * or more would, much as one film in a series shows no agreement.
 */
const DIRECTORS_ONE_FILM = 0.75;

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/**
 * How far `films` ran beyond their genres, shrunk by how little weight there
 * is: `latest` is the share the newest film gets on its own, and with
 * `halfLife` a film's weight halves for each that many years before `from`. A
 * film with no date counts in full.
 */
function lean(
	films: readonly EarlierFilm[],
	shrink: number,
	latest: number,
	now: number,
	halfLife?: { years: number; from: number | undefined },
): number {
	if (films.length === 0) return 0;
	const weights = films.map((film) => {
		const at = film.released ? Date.parse(film.released) : NaN;
		if (!halfLife || halfLife.from === undefined || !Number.isFinite(at)) return 1;
		return 0.5 ** (Math.max(0, halfLife.from - at) / YEAR_MS / halfLife.years);
	});
	const total = weights.reduce((sum, one) => sum + one, 0);
	const leans = films.map((film) => beyond(film, now));
	const weighted = leans.reduce((sum, one, at) => sum + one * (weights[at] as number), 0) / total;
	const centre = latest * (leans[leans.length - 1] as number) + (1 - latest) * weighted;
	return (centre * total) / (total + shrink);
}

/**
 * How much a series' films have agreed, 0–1: none for a single film, which
 * cannot show it, and less the further its films spread.
 */
function agreement(films: readonly EarlierFilm[]): number {
	if (films.length < 2) return 0;
	const average = mean(films.map((film) => film.rating));
	const spread = Math.sqrt(mean(films.map((film) => (film.rating - average) ** 2)));
	return Math.max(0, 1 - spread / SERIES_SPREAD);
}

/** TMDB-scale nudges, each with its reason, in the order they are shown. */
function nudges(
	outlook: Outlook,
	released: number | undefined,
	now: number,
): { reason: HypeReason; by: number }[] {
	const out: { reason: HypeReason; by: number }[] = [];
	const series = outlook.series?.films ?? [];
	const directedTitles = new Set((outlook.directors?.films ?? []).map((film) => film.title));
	const sameTeam = series.some((film) => directedTitles.has(film.title));
	if (series.length > 0) {
		// Never past what agreement alone can reach: a forecast, still.
		const say = Math.min(
			SERIES_AGREED_SAY,
			SERIES_SAY +
				(SERIES_AGREED_SAY - SERIES_SAY) * agreement(series) +
				(sameTeam ? SERIES_SAME_TEAM : 0),
		);
		out.push({ reason: "series", by: say * lean(series, SERIES_SHRINK, LATEST_SHARE, now) });
	}
	// Their other films only: the series already counted the ones in it, and
	// counting Into and Across the Spider-Verse a second time under their
	// directors' names put Beyond above both.
	const inSeries = new Set(series.map((film) => film.title));
	const directed = (outlook.directors?.films ?? []).filter((film) => !inSeries.has(film.title));
	if (directed.length > 0) {
		const halfLife = { years: DIRECTORS_HALF_LIFE_YEARS, from: released };
		const proven = directed.reduce((sum, film) => sum + trust(film, now), 0);
		const record = DIRECTORS_ONE_FILM + (1 - DIRECTORS_ONE_FILM) * Math.min(1, Math.max(0, proven - 1));
		out.push({
			reason: "directors",
			by: record * (sameTeam ? SAME_TEAM_DIRECTORS : 1) * DIRECTORS_SAY * lean(directed, DIRECTORS_SHRINK, DIRECTORS_LATEST, now, halfLife),
		});
	}
	const genres = genreLean(outlook.genres);
	if (genres !== undefined) out.push({ reason: "genres", by: GENRE_SAY * genres });
	// Not for a sequel: its series was made on much the same money, and their
	// scores already carry what that money says. Counted again, it put
	// Sunrise on the Reaping half a point below every Hunger Games film.
	const budget = series.length > 0 ? undefined : outlook.budget;
	if (budget !== undefined && budget >= BUDGET_FLOOR) {
		out.push({
			reason: "budget",
			by: BUDGET_KNOWN + BUDGET_PER_TENFOLD * Math.log10(budget / BUDGET_PIVOT),
		});
	}
	return out;
}

/**
 * A settled TMDB average on Scout's scale, as the blend would read it alone.
 * Genres only once they have been counted, so horror's lift lands in the
 * genre step rather than in "a typical film".
 */
const asScout = (tmdb: number, genres: readonly string[]): number =>
	explainScout([{ source: "tmdb", value: tmdb }], "movie", { genres })?.exact ?? tmdb;

/** A film's hype, or undefined when it is out. */
export function hypeOf(
	outlook: Outlook | undefined,
	facts: { releaseDate?: string; year?: number },
	now: number = Date.now(),
): Hype | undefined {
	if (!outlook || !isUnreleased(facts, now)) return undefined;
	let tmdb = TYPICAL;
	let genres: readonly string[] = [];
	const typical = asScout(tmdb, genres);
	let before = typical;
	const steps: HypeStep[] = [];
	const day = facts.releaseDate ? Date.parse(facts.releaseDate) : NaN;
	const released = Number.isFinite(day)
		? day
		: facts.year !== undefined
			? Date.UTC(facts.year, 6, 1)
			: undefined;
	for (const nudge of nudges(outlook, released, now)) {
		tmdb += nudge.by;
		if (nudge.reason === "genres") genres = outlook.genres;
		const after = asScout(tmdb, genres);
		steps.push({ reason: nudge.reason, by: after - before });
		before = after;
	}
	return { value: before, typical, steps };
}

const tenths = (value: number): number => Math.round(value * 10) / 10;

/** `hypeOfEntry` before rounding, for ordering titles. */
export function exactHypeOfEntry(
	entry: ScoredEntry & { outlook?: Outlook },
	now: number = Date.now(),
): number | undefined {
	if (entry.kind !== "movie" || exactScoutOfEntry(entry, now) !== undefined) return undefined;
	return hypeOf(entry.outlook, entry, now)?.value;
}

/** A library note's hype, to one decimal: only a film with no Scout score. */
export function hypeOfEntry(
	entry: ScoredEntry & { outlook?: Outlook },
	now: number = Date.now(),
): number | undefined {
	const hype = exactHypeOfEntry(entry, now);
	return hype === undefined ? undefined : tenths(hype);
}

/**
 * Scout's score or, for a film not out yet, its hype, unrounded: whichever the
 * card shows, so ordering and grouping by Scout score treat the two alike.
 */
export function exactScoutOrHypeOfEntry(
	entry: ScoredEntry & { outlook?: Outlook },
	now: number = Date.now(),
): number | undefined {
	return exactScoutOfEntry(entry, now) ?? exactHypeOfEntry(entry, now);
}

/**
 * A search result's or suggestion's hype, to one decimal, from what Scout has
 * filed for it: a film in the library, or one opened since the last tidy-up.
 */
export function hypeOfItem(
	item: MediaItem,
	filed: Readonly<ScoreLog>,
	now: number = Date.now(),
): number | undefined {
	if (item.ref.providerId !== "tmdb" || item.ref.kind !== "movie") return undefined;
	if (scoutOfItem(item) !== undefined) return undefined;
	const facts = {
		...(item.releaseDate ? { releaseDate: item.releaseDate } : {}),
		...(item.year !== undefined ? { year: item.year } : {}),
	};
	const hype = hypeOf(filed[scoreKey(item.ref)]?.outlook, facts, now);
	return hype === undefined ? undefined : tenths(hype.value);
}
