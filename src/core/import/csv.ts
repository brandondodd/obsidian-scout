/**
 * A small RFC 4180 reader.
 *
 * Every export Scout imports is a CSV written by somebody else's code, and
 * the parts that break a naive `split(",")` all turn up in practice: quoted
 * commas in titles, doubled quotes, reviews that run over several lines, a
 * byte-order mark at the front, and Windows line endings.
 */

/** Rows of cells, exactly as written. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
	const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	let at = 0;

	const endRow = () => {
		row.push(cell);
		cell = "";
		// A line with nothing on it is not a record with one empty field.
		if (row.length > 1 || row[0] !== "") rows.push(row);
		row = [];
	};

	while (at < input.length) {
		const char = input[at];
		if (quoted) {
			if (char === '"') {
				if (input[at + 1] === '"') {
					cell += '"';
					at += 2;
					continue;
				}
				quoted = false;
				at++;
				continue;
			}
			cell += char;
			at++;
			continue;
		}

		if (char === '"' && cell === "") {
			quoted = true;
		} else if (char === ",") {
			row.push(cell);
			cell = "";
		} else if (char === "\r") {
			endRow();
			if (input[at + 1] === "\n") at++;
		} else if (char === "\n") {
			endRow();
		} else {
			cell += char;
		}
		at++;
	}
	if (cell !== "" || row.length > 0) endRow();
	return rows;
}

/**
 * The rows as objects keyed by the header line.
 *
 * Keys are matched case-insensitively and trimmed by `field`, because the
 * same export has been seen with "My Rating" and "my rating" depending on
 * which year it was made.
 */
export type CsvRecord = Map<string, string>;

export function parseCsvRecords(text: string): CsvRecord[] {
	const [header, ...body] = parseCsv(text);
	if (!header) return [];
	const keys = header.map((name) => name.trim().toLowerCase());
	return body.map((cells) => {
		const record: CsvRecord = new Map();
		keys.forEach((key, at) => record.set(key, (cells[at] ?? "").trim()));
		return record;
	});
}

/** One cell, by any of several header names. Empty string when absent. */
export function field(record: CsvRecord, ...names: string[]): string {
	for (const name of names) {
		const value = record.get(name.toLowerCase());
		if (value) return value;
	}
	return "";
}

/** The header names a file carries, for telling one export from another. */
export function csvHeader(text: string): string[] {
	const first = parseCsv(text.slice(0, 4096))[0] ?? [];
	return first.map((name) => name.trim().toLowerCase());
}
