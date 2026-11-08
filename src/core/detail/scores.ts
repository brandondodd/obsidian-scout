import { oneDecimal } from "../format";
import { hypeOf, type HypeReason, type Outlook } from "../hype";
import {
	explainScout,
	isHype,
	type Reading,
	type ScoutAdjustment,
	type TitleFacts,
} from "../scout-score";
import type { MediaKind } from "../types";
import type {
	Availability,
	ItemExtras,
	Score,
	ServiceTile,
	TitleScores,
} from "./types";

/** Putting scores and services into the order the dialog shows them in. Pure. */

/** One box of Rotten Tomatoes, holding both of its numbers. */
export interface RottenTomatoes {
	critics?: string;
	audience?: string;
}

/** One line of the blend's working: a source's own number, and what Scout made of it. */
export interface ScoutLine {
	id: string;
	label: string;
	/** As the source shows it: `94%`, `8.2`, `4.0/5`. */
	says: string;
	/** On Scout's scale, one decimal. */
	countsAs: string;
	/** Its share of the say, 0–1. */
	share: number;
	/** `6 reviews`, when so few that it counts for visibly less. */
	few?: string;
}

/** One thing that moved the blend after the sources were weighed. */
export interface ScoutStep {
	label: string;
	/** Signed, one decimal: `−0.2`. */
	by: string;
}

/** Scout's own blend, the names of what went into it, and how. */
export interface ScoutBox {
	value: string;
	from: string[];
	/** Biggest say first. */
	parts: ScoutLine[];
	/** The sources' weighted blend, one decimal, before any step. */
	blended: string;
	/**
	 * What took the blend to the value, in order. Each is the change in the
	 * shown, rounded number, so the blend and the steps add up to it exactly.
	 */
	steps: ScoutStep[];
}

/** One thing known about a film not out yet, and how far it moved the hype. */
export interface HypeLine {
	reason: HypeReason;
	label: string;
	/** What exactly: the films, the names, the genres, the money. */
	detail: string;
	/** Signed, one decimal: `+0.6`, `−0.1`, `0.0`. */
	by: string;
}

/** The Scout score a film not out yet is likely to settle at, and what it is worked out from. */
export interface HypeBox {
	value: string;
	/** A film with nothing else known, one decimal. */
	typical: string;
	/**
	 * In order. Each is the change in the shown, rounded number, so the typical
	 * film and the steps add up to the value exactly.
	 */
	steps: HypeLine[];
}

export interface ScoreRow {
	scout?: ScoutBox;
	/** In place of `scout`, never beside it: something not out yet has no verdict. */
	hype?: HypeBox;
	rt?: RottenTomatoes;
	/** IMDb and the source's own headline scores, in order. */
	boxes: Score[];
	/**
	 * Scores folded into one box that lists them on hover. Only ever two or
	 * more: a single one is shown as an ordinary box instead.
	 */
	more?: Score[];
}

/** Below this, a source's vote count is worth showing: it is visibly held back. */
const THIN_TRUST = 0.8;

const STEP_LABELS: Record<ScoutAdjustment["reason"], string> = {
	crowds: "IMDb and Letterboxd lower",
	fresh: "Just released",
	votes: "Few IMDb votes",
};

/** The hype's working, each step named for what it is: "Its series: Shrek, Shrek 2". */
function hypeBox(
	typical: number,
	steps: readonly { reason: HypeReason; by: number }[],
	outlook: Outlook,
): HypeBox {
	let at = typical;
	const lines = steps.map((step): HypeLine => {
		const by = Math.round((at + step.by) * 10) - Math.round(at * 10);
		at += step.by;
		return {
			reason: step.reason,
			...hypeLabel(step.reason, outlook),
			by: by === 0 ? "0.0" : signed(by / 10),
		};
	});
	return { value: oneDecimal(at), typical: oneDecimal(typical), steps: lines };
}

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? "" : "s"}`;

function hypeLabel(reason: HypeReason, outlook: Outlook): { label: string; detail: string } {
	switch (reason) {
		case "series": {
			const films = outlook.series?.films ?? [];
			const last = films[films.length - 1]?.title ?? "";
			return {
				label: "Its series",
				detail:
					films.length <= 2
						? films.map((one) => one.title).join(", ")
						: `${plural(films.length, "earlier film")}, latest ${last}`,
			};
		}
		case "directors": {
			const names = outlook.directors?.names ?? [];
			return {
				label: names.length > 1 ? "Its directors" : "Its director",
				detail: `${names.join(" & ")}, ${plural(outlook.directors?.films.length ?? 0, "earlier film")}`,
			};
		}
		case "genres":
			return {
				label: outlook.genres.length > 1 ? "Its genres" : "Its genre",
				detail: outlook.genres.join(", "),
			};
		case "budget":
			return { label: "Its budget", detail: money(outlook.budget ?? 0) };
	}
}

/** `$150M`, `$8.5M`. */
function money(dollars: number): string {
	const millions = dollars / 1_000_000;
	return `$${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`;
}

/** `−0.2`, `+0.1`: with a true minus sign, since it sits in a column of numbers. */
const signed = (value: number): string =>
	`${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(1)}`;

const voters = (source: string): string =>
	source === "rt-critics" || source === "metacritic" ? "reviews" : "ratings";

/**
 * Scores that matter to the blend but would crowd the row: Metacritic is a
 * second critics' number beside the Tomatometer, and TMDB, Letterboxd and
 * Trakt more audience numbers beside IMDb.
 */
const SECONDARY = new Set(["metacritic", "tmdb", "letterboxd", "trakt"]);

/** IMDb and Metacritic from MDBList, then the source's own scores. */
function titledScores(own: readonly Score[], title: TitleScores | null | undefined): Score[] {
	const titled: Score[] = [];
	const votes = title?.votes ?? {};
	if (title?.imdb !== undefined) {
		titled.push({
			id: "imdb",
			label: "IMDb",
			value: oneDecimal(title.imdb),
			outOfTen: title.imdb,
			...(votes.imdb !== undefined ? { votes: votes.imdb } : {}),
		});
	}
	if (title?.metacritic !== undefined) {
		titled.push({
			id: "metacritic",
			label: "Metacritic",
			value: String(Math.round(title.metacritic)),
			outOfTen: title.metacritic / 10,
			...(votes.metacritic !== undefined ? { votes: votes.metacritic } : {}),
		});
	}
	if (title?.letterboxd !== undefined) {
		titled.push({
			id: "letterboxd",
			label: "Letterboxd",
			value: `${(title.letterboxd / 2).toFixed(1)}/5`,
			outOfTen: title.letterboxd,
			...(votes.letterboxd !== undefined ? { votes: votes.letterboxd } : {}),
		});
	}
	if (title?.trakt !== undefined) {
		titled.push({
			id: "trakt",
			label: "Trakt",
			value: `${Math.round(title.trakt * 10)}%`,
			outOfTen: title.trakt,
			...(votes.trakt !== undefined ? { votes: votes.trakt } : {}),
		});
	}
	return [...titled, ...own.filter((score) => !titled.some((one) => one.id === score.id))];
}

/** Each MDBList field as a reading: the reading's source, and its scale over ten. */
const FIELDS = {
	rtCritics: { source: "rt-critics", over: 10 },
	rtAudience: { source: "rt-audience", over: 10 },
	imdb: { source: "imdb", over: 1 },
	metacritic: { source: "metacritic", over: 10 },
	tmdb: { source: "tmdb", over: 1 },
	letterboxd: { source: "letterboxd", over: 1 },
	trakt: { source: "trakt", over: 1 },
} as const;

/**
 * MDBList's answer, with any source it left blank filled in from what an
 * earlier answer said.
 *
 * MDBList now and then answers a source blank that it had a number for the
 * day before — Rotten Tomatoes most of all: The Matrix came back with no
 * Tomatometer one afternoon and an 83% that evening. A blank is a gap in its
 * data, not a title losing its reviews, so the last number known stands.
 */
export function fillGaps(
	title: TitleScores,
	earlier: readonly Reading[] | undefined,
): TitleScores {
	if (!earlier || earlier.length === 0) return title;
	const out: TitleScores = { ...title };
	const votes: NonNullable<TitleScores["votes"]> = { ...(title.votes ?? {}) };
	for (const key of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) {
		if (out[key] !== undefined) continue;
		const kept = earlier.find((one) => one.source === FIELDS[key].source);
		if (!kept) continue;
		out[key] = kept.value * FIELDS[key].over;
		if (kept.votes !== undefined && votes[key] === undefined) votes[key] = kept.votes;
	}
	return Object.keys(votes).length > 0 ? { ...out, votes } : out;
}

/**
 * Everything the Scout score is blended from: each score with a number out of
 * ten, then Rotten Tomatoes' two. What the library keeps for a title, so the
 * library and the dialog blend the very same readings.
 */
export function readingsOf(
	own: readonly Score[],
	title: TitleScores | null | undefined,
): Reading[] {
	const votes = title?.votes ?? {};
	const readings: Reading[] = titledScores(own, title).flatMap((score) =>
		score.outOfTen === undefined
			? []
			: [
					{
						source: score.id,
						value: score.outOfTen,
						...(score.votes !== undefined ? { votes: score.votes } : {}),
					},
				],
	);
	if (title?.rtCritics !== undefined) {
		readings.push({
			source: "rt-critics",
			value: title.rtCritics / 10,
			...(votes.rtCritics !== undefined ? { votes: votes.rtCritics } : {}),
		});
	}
	if (title?.rtAudience !== undefined) {
		readings.push({
			source: "rt-audience",
			value: title.rtAudience / 10,
			...(votes.rtAudience !== undefined ? { votes: votes.rtAudience } : {}),
		});
	}
	return readings;
}

/**
 * You (drawn by the dialog), Scout, Rotten Tomatoes, IMDb, then the rest —
 * with Metacritic and TMDB folded behind "More" when both are there.
 *
 * Anything MDBList did not answer for simply is not there, so with no key the
 * row is Scout's reading of the source's own score and the score itself.
 */
export function assembleScores(
	own: readonly Score[],
	title: TitleScores | null | undefined,
	kind: MediaKind,
	facts: TitleFacts = {},
	/** What is known of a film not out yet, for its hype. */
	outlook?: Outlook,
): ScoreRow {
	const all = titledScores(own, title);

	const percent = (value: number | undefined) =>
		value === undefined ? undefined : `${Math.round(value)}%`;
	const critics = percent(title?.rtCritics);
	const audience = percent(title?.rtAudience);

	const from: string[] = [];
	if (critics) from.push("Rotten Tomatoes critics");
	if (audience) from.push("Rotten Tomatoes audience");
	for (const score of all) if (score.outOfTen !== undefined) from.push(score.label);
	const readings = readingsOf(own, title);
	// Not out, and only sites that take ratings before release have any: those
	// ratings are anticipation, so there is no Scout score, only hype.
	const anticipated = isHype(
		readings.map((one) => one.source),
		facts,
	);
	const explained = anticipated ? undefined : explainScout(readings, kind, facts);
	const awaited = anticipated && kind === "movie" ? hypeOf(outlook, facts) : undefined;
	const shown = new Map<string, { label: string; says: string }>(
		all.map((one) => [one.id, { label: one.label, says: one.value }]),
	);
	if (critics) shown.set("rt-critics", { label: "RT critics", says: critics });
	if (audience) shown.set("rt-audience", { label: "RT audience", says: audience });
	const parts: ScoutLine[] = (explained?.parts ?? [])
		.map((part) => {
			const votes = readings.find((one) => one.source === part.source)?.votes;
			return {
				id: part.source,
				label: shown.get(part.source)?.label ?? part.source,
				says: shown.get(part.source)?.says ?? "",
				countsAs: oneDecimal(part.value),
				share: part.share,
				...(part.trust < THIN_TRUST && votes !== undefined
					? { few: `${votes.toLocaleString()} ${voters(part.source)}` }
					: {}),
			};
		})
		.sort((a, b) => b.share - a.share);
	// Each step as the change in the rounded number, so they add up to it.
	const steps: ScoutStep[] = [];
	if (explained) {
		let at = explained.blended;
		for (const step of explained.adjustments) {
			const by = Math.round((at + step.by) * 10) - Math.round(at * 10);
			at += step.by;
			if (by !== 0) steps.push({ label: STEP_LABELS[step.reason], by: signed(by / 10) });
		}
	}

	// In the Scout breakdown's order, most say first, so the two lists agree.
	const say = (id: string) => {
		const at = parts.findIndex((one) => one.id === id);
		return at < 0 ? parts.length : at;
	};
	const secondary = all
		.filter((one) => SECONDARY.has(one.id))
		.sort((a, b) => say(a.id) - say(b.id));
	const folded = secondary.length >= 2;
	const boxes = folded ? all.filter((one) => !SECONDARY.has(one.id)) : all;

	return {
		...(explained !== undefined
			? {
					scout: {
						value: oneDecimal(explained.score),
						from,
						parts,
						blended: oneDecimal(explained.blended),
						steps,
					},
				}
			: {}),
		...(awaited !== undefined && outlook !== undefined
			? { hype: hypeBox(awaited.typical, awaited.steps, outlook) }
			: {}),
		...(critics || audience
			? {
					rt: {
						...(critics ? { critics } : {}),
						...(audience ? { audience } : {}),
					},
				}
			: {}),
		boxes,
		...(folded ? { more: secondary } : {}),
	};
}

/** The bar under the poster. */
export interface ServiceBar {
	tile: ServiceTile;
	/** The small line: `Now streaming`, `Rent from £3.49`. */
	caption: string;
	/** The bold line: `Apple TV +1`. */
	name: string;
}

function captionFor(
	group: string,
	tile: ServiceTile,
	regional: boolean,
): string {
	switch (group) {
		case "stream":
			// "Now" is a claim about your region, which only JustWatch can make.
			return regional ? "Now streaming" : "Stream on";
		case "free":
			return "Free to watch";
		case "ads":
			return "Free with ads";
		case "rent":
			return tile.price ? `Rent from ${tile.price}` : "Available to rent";
		case "buy":
			return tile.price ?? "Available to buy";
		case "borrow":
			return "Available to borrow";
		case "read":
			return "Read on";
		case "listen":
			return "Listen on";
		default:
			return "Available on";
	}
}

/**
 * What the bar under the poster says.
 *
 * Groups arrive best first: included with a subscription before free with ads
 * before renting before buying. The count is of other services rather than
 * other offers, so one service you can both rent and buy from is not "+1".
 */
export function serviceBar(
	availability: Availability | undefined,
): ServiceBar | undefined {
	const groups =
		availability?.groups.filter((one) => one.tiles.length > 0) ?? [];
	const first = groups[0];
	const tile = first?.tiles[0];
	if (!first || !tile) return undefined;

	const names = new Set(groups.flatMap((g) => g.tiles.map((t) => t.name)));
	const others = names.size - 1;
	return {
		tile,
		name: others > 0 ? `${tile.name} +${others}` : tile.name,
		caption: captionFor(first.id, tile, Boolean(availability?.justWatch)),
	};
}

/** Whether the Cast & more tab has anything to show. */
export function hasMore(extras: ItemExtras): boolean {
	return (
		extras.people.length > 0 ||
		extras.author !== undefined ||
		extras.rails.some((rail) => rail.items.length > 0) ||
		extras.facts.length > 0 ||
		extras.keywords.length > 0 ||
		extras.links.length > 0
	);
}
