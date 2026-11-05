import type { StatusTone } from "../library/config";
import { field, parseCsvRecords } from "./csv";
import type { ImportRecord } from "./types";
import {
	cleanIsbn,
	isoDate,
	plainText,
	positive,
	stripSeries,
	titleKey,
	yearOf,
} from "./util";

/**
 * Goodreads' "Export library" CSV.
 *
 * ISBNs come wrapped as `="0439023483"` so a spreadsheet keeps the leading
 * zero; ratings are whole stars out of five with 0 meaning unrated; the shelf
 * that says read / reading / want to read is `Exclusive Shelf`, and any custom
 * exclusive shelf is the user's own word for something else.
 *
 * Only one read date is exported, so a reread count of three cannot become
 * three dates — inventing them would put false days in the user's history.
 */

/** A custom exclusive shelf's name, read for what it most likely means. */
export function shelfTone(shelf: string): StatusTone {
	const name = shelf.trim().toLowerCase();
	if (name === "read") return "done";
	if (name === "currently-reading" || name === "reading") return "active";
	if (name === "to-read" || name === "") return "planned";
	if (/dnf|did-?not-?finish|abandon|drop|gave-?up/.test(name)) return "dropped";
	if (/hold|pause|later|hiatus/.test(name)) return "paused";
	return "planned";
}

export function parseGoodreads(text: string): ImportRecord[] {
	const out: ImportRecord[] = [];
	for (const row of parseCsvRecords(text)) {
		const raw = field(row, "title");
		if (!raw) continue;
		const title = stripSeries(raw);
		const year = yearOf(field(row, "original publication year", "year published"));
		const authors = [field(row, "author")]
			.concat(field(row, "additional authors").split(","))
			.map((name) => name.trim())
			.filter(Boolean);
		const isbns = [field(row, "isbn13"), field(row, "isbn")]
			.map(cleanIsbn)
			.filter((isbn): isbn is string => Boolean(isbn));
		const tone = shelfTone(field(row, "exclusive shelf"));
		const stars = positive(field(row, "my rating"));
		const finished = isoDate(field(row, "date read"));

		out.push({
			key: field(row, "book id")
				? `goodreads:${field(row, "book id")}`
				: titleKey("book", title, year),
			kind: "book",
			title,
			year,
			authors,
			isbns,
			tone,
			rating: stars !== undefined ? Math.min(stars / 5, 1) : undefined,
			finished: tone === "done" ? finished : undefined,
			history: [],
			added: isoDate(field(row, "date added")),
			favorite: false,
			review: plainText(field(row, "my review")),
		});
	}
	return out;
}
