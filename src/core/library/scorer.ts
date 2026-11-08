import type { Plugin } from "obsidian";
import { readingsOf } from "../detail/scores";
import type { Score, TitleScores } from "../detail/types";
import { isAbortError } from "../http";
import type { Outlook } from "../hype";
import { isUnreleased, scoreKey, type Reading } from "../scout-score";
import type { ScoutSettings } from "../settings/store";
import type { ScoreLog, ScoreRecord } from "../settings/cacheFile";
import type { MediaRef } from "../types";
import type { HttpClient } from "../http";
import type { MdbListClient } from "../../providers/mdblist/client";
import { bookReadings, RATINGS_PER_REQUEST } from "../../providers/openlibrary/ratings";
import type { LibraryEntry } from "./entry";
import type { LibraryIndex } from "./indexer";

/**
 * Keeping the library's Scout scores the same as the detail dialog's.
 *
 * A note holds only its own source's score, but the blend needs Rotten
 * Tomatoes, IMDb and Metacritic too. So the blend is worked out once per title
 * and kept in Scout's cache: whenever the dialog opens a title, and in the
 * background for everything else, one MDBList request each. Books are asked
 * about too, fifty to an Open Library request, for the rating count a note
 * does not keep. Nothing is written to a note; with background refresh off,
 * nothing is asked for in the background at all, and films only with a key.
 */

const DAY = 24 * 60 * 60 * 1000;

/** A settled score is re-asked about monthly; anything out in the last four months weekly. */
const SETTLED_DAYS = 30;
const FRESH_DAYS = 7;
const RECENT_RELEASE_DAYS = 120;
/** MDBList leaves Rotten Tomatoes blank now and then; a title without it is asked again soon. */
const GAP_DAYS = 2;

/**
 * Bumped whenever MDBList is read for more than before: 2 added Letterboxd and
 * Trakt. Records from before are asked about again, oldest first.
 */
export const SCORE_VERSION = 2;

/**
 * How often a film not out yet has its outlook asked again: its series and
 * directors seldom gain a film, but its genres and budget fill in as release
 * nears. There are only ever a few.
 */
const OUTLOOK_DAYS = 14;

/** Per run: a library of a few hundred is caught up in one, well inside the free 1,000 a day. */
export const SCORE_BUDGET = 500;

const FIRST_RUN_DELAY_MS = 120_000;
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const BETWEEN_REQUESTS_MS = 300;

/* ------------------------------------------------------------------ policy */

function releasedWithin(entry: LibraryEntry, days: number, now: number): boolean {
	const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(entry.releaseDate ?? "");
	if (!day) return entry.year !== undefined && entry.year >= new Date(now).getFullYear();
	const at = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime();
	return now - at < days * DAY;
}

/** Films and shows from TMDB, which MDBList can be asked about. */
function filmOrShow(entry: LibraryEntry): boolean {
	return (
		entry.ref?.providerId === "tmdb" &&
		(entry.ref.kind === "movie" || entry.ref.kind === "tv")
	);
}

/** Books from Open Library, whose rating counts it can be asked for. */
function book(entry: LibraryEntry): boolean {
	return entry.ref?.providerId === "openlibrary" && entry.ref.kind === "book";
}

/** What there is anyone to ask about. */
export function scorable(entry: LibraryEntry): entry is LibraryEntry & { ref: MediaRef } {
	return filmOrShow(entry) || book(entry);
}

/** Which notes to ask about now: never asked first, then the stalest. */
export function scoresDue(
	entries: readonly LibraryEntry[],
	log: Readonly<ScoreLog>,
	now: number,
	budget: number,
): (LibraryEntry & { ref: MediaRef })[] {
	const due: { entry: LibraryEntry & { ref: MediaRef }; at: number }[] = [];
	for (const entry of entries) {
		if (!scorable(entry)) continue;
		const record = log[scoreKey(entry.ref)];
		if (!record) {
			due.push({ entry, at: 0 });
			continue;
		}
		// Filed before Scout read everything it now reads.
		if (record.full && filmOrShow(entry) && record.v !== SCORE_VERSION) {
			due.push({ entry, at: record.at - 365 * DAY });
			continue;
		}
		// Worked out without MDBList — no key then, or no answer: try again daily.
		if (!record.full) {
			if (now - record.at >= DAY) due.push({ entry, at: record.at });
			continue;
		}
		const gap = filmOrShow(entry) && !record.readings.some((one) => one.source.startsWith("rt-"));
		const every = gap
			? GAP_DAYS
			: releasedWithin(entry, RECENT_RELEASE_DAYS, now)
				? FRESH_DAYS
				: SETTLED_DAYS;
		if (now - record.at >= every * DAY) due.push({ entry, at: record.at });
	}
	due.sort((a, b) => a.at - b.at);
	return due.slice(0, budget).map((one) => one.entry);
}

/**
 * Whether a new reading should replace the stored one.
 *
 * A blend MDBList took part in is not replaced by one it did not — a spent
 * daily quota would otherwise quietly undo the library's scores — until it is
 * stale enough that any answer beats it.
 */
export function replaces(
	before: ScoreRecord | undefined,
	next: ScoreRecord,
	now: number,
): boolean {
	if (!before || next.full || !before.full) return true;
	return now - before.at >= SETTLED_DAYS * DAY;
}

/**
 * A full answer, with any source it is missing carried over from the full
 * answer before it: a source MDBList answers blank is a gap in its data — see
 * `fillGaps` — not a title losing its scores.
 */
export function keepKnown(before: ScoreRecord | undefined, next: Reading[]): Reading[] {
	if (!before?.full) return next;
	const have = new Set(next.map((one) => one.source));
	return [...next, ...before.readings.filter((one) => !have.has(one.source))];
}

/** Films not out yet whose outlook is unknown or stale, stalest first. */
export function outlookDue(
	entries: readonly LibraryEntry[],
	log: Readonly<ScoreLog>,
	now: number,
): (LibraryEntry & { ref: MediaRef })[] {
	const due: { entry: LibraryEntry & { ref: MediaRef }; at: number }[] = [];
	for (const entry of entries) {
		const ref = entry.ref;
		if (ref?.providerId !== "tmdb" || ref.kind !== "movie" || !isUnreleased(entry, now)) continue;
		const at = log[scoreKey(ref)]?.outlook?.at ?? 0;
		if (now - at >= OUTLOOK_DAYS * DAY) due.push({ entry: { ...entry, ref }, at });
	}
	return due.sort((a, b) => a.at - b.at).map((one) => one.entry);
}

/** Drops scores for titles no note holds any more. */
export function pruneScores(
	log: Readonly<ScoreLog>,
	entries: readonly LibraryEntry[],
): ScoreLog {
	const held = new Set(entries.flatMap((one) => (one.ref ? [scoreKey(one.ref)] : [])));
	const out: ScoreLog = {};
	for (const [key, record] of Object.entries(log)) if (held.has(key)) out[key] = record;
	return out;
}

/** The readings in one MDBList answer, with the note's own score as TMDB's fallback. */
export function readingsFor(title: TitleScores, sourceRating: number | undefined): Reading[] {
	const tmdb = title.tmdb ?? sourceRating;
	const own: Score[] =
		tmdb !== undefined && tmdb > 0
			? [
					{
						id: "tmdb",
						label: "TMDB",
						value: "",
						outOfTen: tmdb,
						...(title.tmdb !== undefined && title.votes?.tmdb !== undefined
							? { votes: title.votes.tmdb }
							: {}),
					},
				]
			: [];
	return readingsOf(own, title);
}

/* ------------------------------------------------------------------ runner */

export class ScoreKeeper {
	private timer: number | null = null;
	private running = false;

	constructor(
		private readonly settings: ScoutSettings,
		private readonly library: LibraryIndex,
		private readonly mdblist: MdbListClient,
		private readonly http: HttpClient,
		/** Books are asked about only while Open Library is a source you use. */
		private readonly booksOn: () => boolean,
		/** What is known of a film not out yet, or undefined while TMDB is off or keyless. */
		private readonly outlookOf: (
			ref: MediaRef,
			signal: AbortSignal,
		) => Promise<Outlook | null | undefined> = async () => undefined,
	) {}

	start(plugin: Plugin): void {
		this.timer = window.setTimeout(() => {
			void this.runDue();
			this.timer = window.setInterval(() => void this.runDue(), RUN_EVERY_MS);
			plugin.register(() => {
				if (this.timer !== null) window.clearInterval(this.timer);
			});
		}, FIRST_RUN_DELAY_MS);
		plugin.register(() => {
			if (this.timer !== null) window.clearTimeout(this.timer);
			this.timer = null;
		});
	}

	/** Files the readings behind a title's blend. */
	record(ref: MediaRef, readings: Reading[], full: boolean): void {
		const key = scoreKey(ref);
		const before = this.settings.scores()[key];
		const next: ScoreRecord = {
			readings: full ? keepKnown(before, readings) : readings,
			at: Date.now(),
			...(full ? { full: true, v: SCORE_VERSION } : {}),
			...(before?.outlook ? { outlook: before.outlook } : {}),
		};
		if (replaces(before, next, next.at)) {
			this.settings.setScore(key, next);
		}
	}

	/**
	 * Files what is known of a film not out yet, for its hype. A title Scout
	 * has not asked MDBList about yet is filed as never asked, so that still
	 * happens.
	 */
	recordOutlook(ref: MediaRef, outlook: Outlook): void {
		const key = scoreKey(ref);
		const before = this.settings.scores()[key] ?? { readings: [], at: 0 };
		this.settings.setScore(key, { ...before, outlook: { ...outlook, at: Date.now() } });
	}

	/** Books in fifties: one request each, keyless, for two numbers a book. */
	private async runBooks(
		due: readonly (LibraryEntry & { ref: MediaRef })[],
		signal: AbortSignal,
	): Promise<void> {
		for (let i = 0; i < due.length; i += RATINGS_PER_REQUEST) {
			const chunk = due.slice(i, i + RATINGS_PER_REQUEST);
			let found: Map<string, Reading>;
			try {
				found = await bookReadings(this.http, chunk.map((one) => one.ref.id), signal);
			} catch (err) {
				if (isAbortError(err)) throw err;
				console.warn("Scout: Open Library did not answer", (err as { status?: number })?.status ?? "");
				return;
			}
			for (const entry of chunk) {
				const reading = found.get(entry.ref.id);
				this.record(entry.ref, reading ? [reading] : [], reading !== undefined);
			}
			await new Promise((resolve) => window.setTimeout(resolve, BETWEEN_REQUESTS_MS));
		}
	}

	/** The outlook of films not out yet: a few TMDB requests each, a few films a run. */
	private async runOutlooks(
		entries: readonly LibraryEntry[],
		signal: AbortSignal,
	): Promise<void> {
		for (const entry of outlookDue(entries, this.settings.scores(), Date.now())) {
			let outlook: Outlook | null | undefined;
			try {
				outlook = await this.outlookOf(entry.ref, signal);
			} catch (err) {
				if (isAbortError(err)) throw err;
				console.warn("Scout: TMDB did not answer", (err as { status?: number })?.status ?? "");
				return;
			}
			// TMDB off or keyless: nothing more to ask this run.
			if (outlook === undefined) return;
			if (outlook) this.recordOutlook(entry.ref, outlook);
			await new Promise((resolve) => window.setTimeout(resolve, BETWEEN_REQUESTS_MS));
		}
	}

	async runDue(): Promise<void> {
		// Background asking is one with the background refresh: off, it is off.
		if (this.running || !this.settings.library().autoRefresh) return;
		const films = this.mdblist.isConfigured();
		const books = this.booksOn();
		this.running = true;
		const controller = new AbortController();
		try {
			const entries = this.library.all();
			const batch = scoresDue(entries, this.settings.scores(), Date.now(), SCORE_BUDGET);
			if (books) await this.runBooks(batch.filter(book), controller.signal);
			for (const entry of films ? batch.filter(filmOrShow) : []) {
				let title: TitleScores | null;
				try {
					title = await this.mdblist.titleScores(entry.ref, controller.signal);
				} catch (err) {
					if (isAbortError(err)) throw err;
					// A 429 is a spent daily quota: the rest of the batch would
					// only spend tomorrow's too. Status only, never the URL.
					const status = (err as { status?: number })?.status;
					console.warn("Scout: MDBList did not answer", status ?? "");
					if (status === 429) break;
					// Not a title MDBList knows, most likely: file that it was
					// asked, with nothing found, so it is tried again tomorrow
					// rather than every run. The note's own score stands meanwhile.
					this.record(entry.ref, [], false);
					continue;
				}
				if (title) this.record(entry.ref, readingsFor(title, entry.sourceRating), true);
				else this.record(entry.ref, [], false);
				await new Promise((resolve) => window.setTimeout(resolve, BETWEEN_REQUESTS_MS));
			}
			await this.runOutlooks(entries, controller.signal);
			// Quiet: a pruned score belongs to no note, so no view shows it.
			const pruned = pruneScores(this.settings.scores(), this.library.all());
			for (const key of Object.keys(this.settings.scores())) {
				if (!(key in pruned)) this.settings.setScore(key, null);
			}
		} finally {
			this.running = false;
		}
	}
}
