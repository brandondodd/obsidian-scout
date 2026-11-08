import type { ItemExtras, PersonCredit } from "../../../core/detail/types";
import type { LibraryEntry } from "../../../core/library/entry";
import { readableTag } from "../../../core/library/tags";
import type { MediaItem, MediaKind, MediaRef } from "../../../core/types";

/** Everything the hero needs, whichever source it came from. */
export interface Presented {
	title: string;
	subtitle?: string;
	kind: MediaKind;
	year?: number;
	/** As written, so a countdown can tell a known day from a bare year. */
	releaseDate?: string;
	/** The source's production status — "Planned", "In production". */
	releaseStatus?: string;
	sourceRating?: number;
	cover?: string;
	description?: string;
	tags: string[];
	people: string[];
	url?: string;
}

/**
 * Merged, not chosen between.
 *
 * The note is the user's own record and wins wherever it says anything; the
 * source fills the gaps. Picking one or the other is what made the dialog look
 * different depending on whether it was opened from a search result or from
 * the library, when it is the same item either way.
 */
export function present(
	item: MediaItem | undefined,
	entry: LibraryEntry | undefined,
): Presented | null {
	const title = entry?.title ?? item?.title;
	const kind = entry?.kind ?? item?.ref.kind;
	if (!title || !kind) return null;

	const pick = <T,>(mine: T[] | undefined, theirs: T[] | undefined): T[] =>
		mine && mine.length > 0 ? mine : (theirs ?? []);

	return {
		title,
		kind,
		subtitle: item?.subtitle,
		year: entry?.year ?? item?.year,
		releaseDate: entry?.releaseDate ?? item?.releaseDate,
		releaseStatus:
			typeof item?.extra?.status === "string" ? item.extra.status : undefined,
		// The live figure when a source answered, otherwise whatever the note
		// recorded on the day it was made.
		sourceRating: item?.rating ?? entry?.sourceRating,
		cover: entry?.cover ?? item?.imageUrl ?? item?.thumbnailUrl,
		description: entry?.description ?? item?.description,
		// A note may hold the tag-safe spelling; the header shows the genre's name.
		tags: pick(entry?.tags, item?.tags).map((tag) =>
			readableTag(tag, item?.tags),
		),
		people: pick(entry?.people, item?.people),
		url: entry?.url ?? item?.externalUrl,
	};
}

/** `fieldnotes.example`, from a saved link. */
export function linkDomain(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return undefined;
	}
}

/**
 * The header of a web link, from what is already known.
 *
 * Worked out rather than fetched: going back to the page every time the dialog
 * opened would be a request to a stranger's server nobody asked for.
 */
export function linkExtras(
	view: Presented,
	item: MediaItem | undefined,
): Pick<ItemExtras, "byline" | "headerFacts"> {
	const site = item?.extra?.site_name;
	const author = item?.extra?.author ?? view.people[0];
	const domain = linkDomain(view.url);
	const line = [
		typeof site === "string" && site !== domain ? site : null,
		typeof author === "string" ? author : null,
	]
		.filter(Boolean)
		.join(" · ");
	return {
		...(line ? { byline: line } : {}),
		headerFacts: domain ? [domain] : [],
	};
}

/**
 * Just enough of a record for the services that search by name.
 *
 * Some sources have no separate detail call, so a note opened from the library
 * may have no fetched record to hand. What the note says will do.
 */
export function recordFrom(
	ref: MediaRef,
	view: Presented,
	item: MediaItem | undefined,
): MediaItem {
	return (
		item ?? {
			ref,
			title: view.title,
			tags: view.tags,
			people: view.people,
			extra: {},
			...(view.year ? { year: view.year } : {}),
		}
	);
}

/**
 * Kinds whose note names are a cast worth a grid of faces.
 *
 * Everywhere else the names a note holds are its authors, artists or studios,
 * which the header and "About the author" already say. A grid of the same name
 * in a grey circle adds nothing.
 */
const CAST_KINDS: ReadonlySet<MediaKind> = new Set(["movie", "tv", "anime"]);

/**
 * Who goes in the people grid.
 *
 * The source's own list wins: it has faces and roles. The note's names stand in
 * only where they are a cast.
 */
export function peopleToShow(
	kind: MediaKind,
	sourced: readonly PersonCredit[],
	noted: readonly string[],
): readonly PersonCredit[] {
	if (sourced.length > 0) return sourced;
	return CAST_KINDS.has(kind) ? noted.map((name) => ({ name })) : [];
}
