import type { AgeRating } from "../region";
import type { MediaItem } from "../types";

/**
 * What the detail dialog knows beyond the record a note is made from.
 *
 * Provider-agnostic, like `MediaItem`: each source fills in what it has and the
 * dialog hides whatever comes back empty. Nothing here is written to a note.
 */

/** One score box after the "You" box. */
export interface Score {
	/** Doubles as the source's key in `SOURCES`, which is how Scout weighs it. */
	id: string;
	label: string;
	value: string;
	/** The same score out of ten, for Scout's blend. Absent when it should stay out. */
	outOfTen?: number;
	/** How many it is an average of, when the source says. */
	votes?: number;
}

/** The title-level scores MDBList can add. */
export interface TitleScores {
	/** Percent. */
	rtCritics?: number;
	/** Percent. */
	rtAudience?: number;
	/** Out of ten. */
	imdb?: number;
	/** Out of a hundred. */
	metacritic?: number;
	/**
	 * Out of ten. Not drawn — the dialog shows TMDB's own answer — but it is
	 * what lets the library's background scoring blend from one request.
	 */
	tmdb?: number;
	/** Out of ten (Letterboxd's own stars, doubled). */
	letterboxd?: number;
	/** Out of ten (Trakt's own percentage, over ten). */
	trakt?: number;
	/** Reviews, ratings, or critics behind each, when MDBList says. */
	votes?: {
		rtCritics?: number;
		rtAudience?: number;
		imdb?: number;
		metacritic?: number;
		tmdb?: number;
		letterboxd?: number;
		trakt?: number;
	};
}

/** One entry in the people grid. Crew and cast are the same kind of thing. */
export interface PersonCredit {
	name: string;
	/** The character, or the job. */
	role?: string;
	/** `10 episodes`, `Voiced by Kana Mori`. */
	more?: string;
	imageUrl?: string;
}

/** A service you can get the thing from. */
export interface ServiceTile {
	name: string;
	logoUrl?: string;
	/** Behind a logo that is drawn on transparency. */
	logoBackground?: string;
	/** Only ever a price somebody quoted, never a guess. */
	price?: string;
	url?: string;
}

export type ServiceGroupId =
	| "stream"
	| "free"
	| "ads"
	| "rent"
	| "buy"
	| "borrow"
	| "read"
	| "listen"
	| "stores";

export interface ServiceGroup {
	id: ServiceGroupId;
	label: string;
	tiles: ServiceTile[];
}

/** The "Where to watch" section, under whichever verb suits the kind. */
export interface Availability {
	title: string;
	groups: ServiceGroup[];
	/** The source's page for this title in your region. */
	link?: string;
	/**
	 * Region-specific, and supplied by JustWatch through TMDB. That is what puts
	 * the region in the heading and the required credit in the corner.
	 */
	justWatch?: boolean;
	/**
	 * Holds prices quoted for the reader's region, so the heading names the
	 * region as the design does. No credit line: the prices are Apple's.
	 */
	regional?: boolean;
}

export interface Video {
	name: string;
	url: string;
	thumbnailUrl?: string;
}

export type ArtShape = "poster" | "wide" | "square";

/** A shelf of other titles: more by the author, DLC, related, and so on. */
export interface Rail {
	id: string;
	title: string;
	items: MediaItem[];
	/** Overrides the card's caption, keyed by the item's id. */
	captions?: Record<string, string>;
	shape?: ArtShape;
	/** A link at the end of the heading, like "All 6". */
	more?: { label: string; url: string };
}

export interface AuthorBio {
	name: string;
	bio?: string;
	/** `Born 1971 · 6 books`. */
	facts?: string;
	imageUrl?: string;
}

export interface Track {
	number: number;
	title: string;
	/** `4:12`. */
	length?: string;
	/** A guest credit, shown as `with Ada Holm`. */
	featuring?: string;
}

/** How a kind without episodes counts how far through you are. */
export interface ProgressUnit {
	unit: "page" | "chapter" | "hour";
	total?: number;
}

export interface ItemExtras {
	shape?: ArtShape;
	/** Author, developer, artist, or native title, under the main title. */
	byline?: string;
	backdropUrl?: string;
	tagline?: string;
	/** Replaces the plain year: `Fall 2026`. */
	when?: string;
	ageRating?: AgeRating;
	/** Short facts for the header, after the year and rating. */
	headerFacts: string[];
	/** `Directed by`, `Created by`. */
	credit?: { prefix: string; names: string[] };
	/** The source's own scores, already in display form. */
	scores: Score[];
	imdbId?: string;
	/** Air date of the next episode, for "New episodes Thursdays". */
	nextAirDate?: string;
	/** The tab's label. Defaults to "Cast & more". */
	moreLabel?: string;
	peopleTitle?: string;
	people: PersonCredit[];
	author?: AuthorBio;
	availability?: Availability;
	videos: Video[];
	screenshots: string[];
	screenshotTotal?: number;
	rails: Rail[];
	facts: { label: string; value: string }[];
	/** Who did what on an album. */
	credits?: { label: string; value: string }[];
	keywords: string[];
	links: { label: string; url: string }[];
	tracks?: Track[];
	progress?: ProgressUnit;
}

export const emptyExtras = (): ItemExtras => ({
	headerFacts: [],
	scores: [],
	people: [],
	videos: [],
	screenshots: [],
	rails: [],
	facts: [],
	keywords: [],
	links: [],
});
