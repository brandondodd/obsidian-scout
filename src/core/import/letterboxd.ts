import { csvHeader, field, parseCsvRecords } from "./csv";
import type { ImportFile, ImportRecord } from "./types";
import {
	isoDate,
	plainText,
	positive,
	splitFinishes,
	titleKey,
	yearOf,
} from "./util";

/**
 * Letterboxd's data export.
 *
 * It arrives as a ZIP of several CSVs that each describe one side of the same
 * films: what you watched, what you rated, the diary of when, what you want to
 * see, what you wrote. Any subset may be picked, and they are merged by name
 * and year — not by the URI column, which in the diary and reviews points at
 * the diary entry rather than at the film, so the same film has a different
 * one in every file.
 *
 * Ratings are 0.5–5 in half steps.
 */

type FileRole = "watched" | "ratings" | "diary" | "watchlist" | "reviews" | "likes";

const BY_NAME: Record<string, FileRole> = {
	"watched.csv": "watched",
	"ratings.csv": "ratings",
	"diary.csv": "diary",
	"watchlist.csv": "watchlist",
	"reviews.csv": "reviews",
	// `likes/films.csv` inside the ZIP; a picked file only carries its basename.
	"films.csv": "likes",
	"likes.csv": "likes",
};

/** Which file this is, by name first and by its columns when renamed. */
export function letterboxdRole(file: ImportFile): FileRole | null {
	const base = file.name.split(/[\\/]/).pop()?.toLowerCase() ?? "";
	const named = BY_NAME[base];
	if (named) return named;
	const header = csvHeader(file.text);
	if (!header.includes("letterboxd uri")) return null;
	if (header.includes("review")) return "reviews";
	if (header.includes("watched date")) return "diary";
	if (header.includes("rating")) return "ratings";
	return null;
}

interface Film {
	title: string;
	year?: number;
	watched?: string;
	inWatchlist: boolean;
	added?: string;
	liked: boolean;
	rating?: { date: string; value: number };
	diary: { date: string; rating?: number }[];
	reviews: { date: string; text: string }[];
}

export interface LetterboxdResult {
	records: ImportRecord[];
	/** Files that were not recognised as part of an export. */
	ignored: string[];
}

export function parseLetterboxd(files: readonly ImportFile[]): LetterboxdResult {
	const films = new Map<string, Film>();
	const ignored: string[] = [];

	const filmFor = (title: string, year: number | undefined): Film => {
		const key = titleKey("movie", title, year);
		let film = films.get(key);
		if (!film) {
			film = { title, year, inWatchlist: false, liked: false, diary: [], reviews: [] };
			films.set(key, film);
		}
		return film;
	};

	for (const file of files) {
		const role = letterboxdRole(file);
		if (!role) {
			ignored.push(file.name);
			continue;
		}
		for (const row of parseCsvRecords(file.text)) {
			const title = field(row, "name", "title");
			if (!title) continue;
			const film = filmFor(title, yearOf(field(row, "year")));
			const date = isoDate(field(row, "date")) ?? "";
			const watchedOn = isoDate(field(row, "watched date")) ?? date;
			const rating = positive(field(row, "rating"));

			switch (role) {
				case "watched":
					film.watched = date || film.watched || "";
					break;
				case "watchlist":
					film.inWatchlist = true;
					film.added = date || film.added;
					break;
				case "likes":
					film.liked = true;
					break;
				case "ratings":
					if (rating !== undefined && (!film.rating || date >= film.rating.date)) {
						film.rating = { date, value: rating };
					}
					break;
				case "diary":
					film.diary.push({ date: watchedOn, rating });
					break;
				case "reviews": {
					const text = plainText(field(row, "review"));
					if (text) film.reviews.push({ date: watchedOn, text });
					break;
				}
			}
		}
	}

	return { records: [...films.values()].map(toRecord), ignored };
}

function toRecord(film: Film): ImportRecord {
	const diary = [...film.diary].sort((a, b) => a.date.localeCompare(b.date));
	// The diary is the only file that says *when*. Without it, the day a film
	// was marked as watched is the best date there is.
	const dates = diary.map((one) => one.date).filter(Boolean);
	if (dates.length === 0 && film.watched) dates.push(film.watched);
	const { finished, history } = splitFinishes(dates);

	const lastDiaryRating = [...diary].reverse().find((one) => one.rating)?.rating;
	const stars = film.rating?.value ?? lastDiaryRating;
	const seen =
		film.watched !== undefined || diary.length > 0 || stars !== undefined;

	return {
		key: titleKey("movie", film.title, film.year),
		kind: "movie",
		title: film.title,
		year: film.year,
		authors: [],
		isbns: [],
		tone: seen ? "done" : "planned",
		rating: stars !== undefined ? Math.min(stars / 5, 1) : undefined,
		started: undefined,
		finished: seen ? finished : undefined,
		history: seen ? history : [],
		added: film.added,
		favorite: film.liked,
		review: reviewText(film.reviews),
	};
}

/** One review as written; several, each under the day it was written for. */
function reviewText(reviews: Film["reviews"]): string | undefined {
	if (reviews.length === 0) return undefined;
	if (reviews.length === 1) return reviews[0]?.text;
	return [...reviews]
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((one) => (one.date ? `**${one.date}**\n\n${one.text}` : one.text))
		.join("\n\n");
}
