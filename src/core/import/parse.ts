import { parseGoodreads } from "./goodreads";
import { parseLetterboxd } from "./letterboxd";
import { parseStoryGraph } from "./storygraph";
import type { ImportFile, ImportRecord, ImportSource } from "./types";

/** The file-based imports, behind one call. AniList reads a username instead. */

export interface ParsedImport {
	records: ImportRecord[];
	/** Files that did not look like part of this export. */
	ignored: string[];
}

export type FileSource = Exclude<ImportSource, "anilist">;

export function parseImportFiles(
	source: FileSource,
	files: readonly ImportFile[],
): ParsedImport {
	if (source === "letterboxd") return parseLetterboxd(files);

	const parse = source === "goodreads" ? parseGoodreads : parseStoryGraph;
	const records: ImportRecord[] = [];
	const ignored: string[] = [];
	const seen = new Set<string>();
	for (const file of files) {
		const found = parse(file.text);
		if (found.length === 0) ignored.push(file.name);
		for (const record of found) {
			if (seen.has(record.key)) continue;
			seen.add(record.key);
			records.push(record);
		}
	}
	return { records, ignored };
}
