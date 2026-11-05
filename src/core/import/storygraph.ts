import type { StatusTone } from "../library/config";
import { field, parseCsvRecords } from "./csv";
import type { ImportRecord } from "./types";
import {
	allDates,
	cleanIsbn,
	isoDate,
	plainText,
	positive,
	splitFinishes,
	titleKey,
	yearOf,
} from "./util";

/**
 * The StoryGraph's CSV export.
 *
 * Unlike Goodreads it keeps every read: `Dates Read` lists each time through
 * as `start-end` pairs, which is exactly what Scout's history is. Star ratings
 * go in quarter steps out of five. `ISBN/UID` is an ISBN when the edition has
 * one and an opaque StoryGraph id when it does not.
 */

export function readStatusTone(status: string): StatusTone {
	const name = status.trim().toLowerCase();
	if (name === "read") return "done";
	if (name === "currently-reading" || name === "reading") return "active";
	if (name === "did-not-finish" || name === "dnf") return "dropped";
	if (name === "paused") return "paused";
	return "planned";
}

/** One read, from a `start-end` segment of `Dates Read`. */
interface Read {
	start?: string;
	end?: string;
}

/**
 * Each time through, in the order written.
 *
 * Written `2023/01/05-2023/01/20, 2022/06/01-2022/06/09`. A read still going
 * ends in a dash with nothing after it; a lone date is a finish on its own.
 */
export function readsOf(cell: string): Read[] {
	return cell
		.split(",")
		.map((segment) => {
			const dates = allDates(segment);
			if (dates.length === 0) return null;
			if (/-\s*$/.test(segment.trim())) return { start: dates[0] };
			if (dates.length === 1) return { end: dates[0] };
			return { start: dates[0], end: dates[dates.length - 1] };
		})
		.filter((read): read is Read => read !== null);
}

export function parseStoryGraph(text: string): ImportRecord[] {
	const out: ImportRecord[] = [];
	for (const row of parseCsvRecords(text)) {
		const title = field(row, "title");
		if (!title) continue;
		const tone = readStatusTone(field(row, "read status"));
		const uid = field(row, "isbn/uid", "isbn");
		const isbn = cleanIsbn(uid);
		const stars = positive(field(row, "star rating"));

		const reads = readsOf(field(row, "dates read"));
		const ends = reads.map((read) => read.end).filter((d): d is string => Boolean(d));
		const last = isoDate(field(row, "last date read"));
		if (last && !ends.includes(last)) ends.push(last);
		// Finished: the latest is this run and the rest are history. Otherwise
		// every finish is an earlier time through.
		const done = tone === "done";
		const { finished, history } = done
			? splitFinishes(ends)
			: { finished: undefined, history: [...new Set(ends)].sort() };
		const current = done
			? reads.find((read) => read.end === finished)
			: reads.find((read) => read.start && !read.end);

		out.push({
			key: isbn ? `isbn:${isbn}` : uid ? `storygraph:${uid}` : titleKey("book", title),
			kind: "book",
			title,
			year: yearOf(field(row, "year published", "original publication year")),
			authors: field(row, "authors", "author")
				.split(",")
				.map((name) => name.trim())
				.filter(Boolean),
			isbns: isbn ? [isbn] : [],
			tone,
			rating: stars !== undefined ? Math.min(stars / 5, 1) : undefined,
			started: current?.start,
			finished,
			history,
			added: isoDate(field(row, "date added")),
			favorite: false,
			review: plainText(field(row, "review")),
		});
	}
	return out;
}
