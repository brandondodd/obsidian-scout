import type { StatusTone } from "../library/config";
import type { MediaItem, MediaKind } from "../types";

/**
 * One thing somebody had in another app, in Scout's terms.
 *
 * Every parser produces these and nothing downstream knows which app they
 * came from. The user's own data is kept in units that do not depend on
 * their settings — a status *tone*, a rating as a fraction — so the words and
 * the scale are chosen at write time from whatever the vault is configured
 * with, never hard-coded here.
 */
export interface ImportRecord {
	/** Stable within one export, so re-reading the same file merges the same rows. */
	key: string;
	kind: MediaKind;
	title: string;
	year?: number;
	/** Authors, for a book. Helps a title search find the right edition. */
	authors: string[];
	/** ISBN-10 or -13s, best first. */
	isbns: string[];
	/** Already resolved — a source that hands over its own ids needs no search. */
	item?: MediaItem;

	tone: StatusTone;
	/** 0–1 of the source's own scale. Absent when unrated. */
	rating?: number;
	/** ISO `YYYY-MM-DD`. */
	started?: string;
	/** The latest time it was finished. */
	finished?: string;
	/** Earlier finish dates, oldest first. */
	history: string[];
	progress?: number;
	/** When it went on the list, written as the note's `created` date. */
	added?: string;
	favorite: boolean;
	/** Plain text for the thoughts section. */
	review?: string;
}

/** The apps Scout can read an export from. */
export type ImportSource = "letterboxd" | "goodreads" | "storygraph" | "anilist";

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
	letterboxd: "Letterboxd",
	goodreads: "Goodreads",
	storygraph: "The StoryGraph",
	anilist: "AniList",
};

/** A file the user picked, already read as text. */
export interface ImportFile {
	name: string;
	text: string;
}
