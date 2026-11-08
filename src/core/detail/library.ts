import type { LibraryEntry } from "../library/entry";

/** Which of your titles a name turns up in. Pure. */

export interface PersonTitle {
	path: string;
	title: string;
	cover?: string;
}

const fold = (name: string) => name.trim().toLowerCase();

/**
 * Each name, with the library titles that credit them.
 *
 * One pass over the library rather than one per name. The title you are looking
 * at is left out, since being in the thing you opened is not news.
 */
export function peopleInLibrary(
	names: readonly string[],
	entries: readonly LibraryEntry[],
	exceptPath: string | undefined,
): Map<string, PersonTitle[]> {
	const wanted = new Map(names.map((name) => [fold(name), name]));
	const out = new Map<string, PersonTitle[]>();

	for (const entry of entries) {
		if (entry.path === exceptPath) continue;
		for (const person of new Set(entry.people.map(fold))) {
			const name = wanted.get(person);
			if (!name) continue;
			const list = out.get(name) ?? [];
			list.push({
				path: entry.path,
				title: entry.title,
				...(entry.cover ? { cover: entry.cover } : {}),
			});
			out.set(name, list);
		}
	}
	return out;
}
