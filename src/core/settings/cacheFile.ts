import { normalizePath, type Plugin } from "obsidian";
import { normalizeAnswers, type AnswerLog } from "../ai/answerCache";
import { normalizeEnrichment, type EnrichmentCache } from "../library/enrich";
import { normalizeShown, type ShownLog } from "../library/feedback";
import type { EarlierFilm, Outlook } from "../hype";
import type { Reading } from "../scout-score";

/**
 * Scout's rebuildable working state, kept in `cache.json` beside `data.json`.
 *
 * Split out because `data.json` is synced and rewritten whole on every save:
 * the enrichment cache alone is hundreds of kilobytes, and the rotation counter
 * changes on every load. Nothing here is yours — deleting the file costs a few
 * repeated suggestions and some background re-reading, and nothing else.
 */
export interface ScoutCache {
	/**
	 * When each note was last asked about, `YYYY-MM-DD` by note path. Kept
	 * outside the notes so a check that finds nothing does not touch the note.
	 */
	checked: Record<string, string>;
	/** When each suggestion was last shown, `providerId:id` to epoch ms. */
	shown: ShownLog;
	/** What the sources said about your library beyond what its notes hold. */
	enrichment: EnrichmentCache;
	/** How many times the plugin has loaded; seeds each session's suggestions. */
	rotation: number;
	/**
	 * Scout's blended score for each title, keyed `providerId:kind:id`.
	 *
	 * A note keeps only its own source's score, and the blend needs Rotten
	 * Tomatoes, IMDb, and Metacritic as well, so the library reads it from here.
	 */
	scores: ScoreLog;
	/** Scout's take and Across kinds, kept a month — see `answerCache.ts`. */
	answers: AnswerLog;
}

export interface ScoreRecord {
	/**
	 * What the blend is made from, not the blend: the blend is worked out when
	 * shown, so a better blend reaches every title the moment it ships. Empty
	 * when nothing beyond the note's own score was found.
	 */
	readings: Reading[];
	/** Epoch ms of the reading; 0 when only `outlook` has been filed. */
	at: number;
	/**
	 * What was known of a film not out yet when `at` says: what its hype is
	 * worked out from. Kept apart from the readings, since it is not a score.
	 */
	outlook?: Outlook & { at: number };
	/** MDBList answered, so the blend saw more than the source's own score. */
	full?: true;
	/**
	 * Which sources were being read when it was filed — see `SCORE_VERSION`.
	 * Older records are asked about again first, and kept until they are.
	 */
	v?: number;
}

export type ScoreLog = Record<string, ScoreRecord>;

function normalizeScores(raw: unknown): ScoreLog {
	const out: ScoreLog = {};
	if (!raw || typeof raw !== "object") return out;
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const one = value as Partial<ScoreRecord> | null;
		// Records from builds that kept only the finished number have no
		// readings; dropped, they are simply asked about again.
		if (!one || !Array.isArray(one.readings) || typeof one.at !== "number") continue;
		const readings = one.readings.flatMap((raw: unknown): Reading[] => {
			const r = raw as Partial<Reading> | null;
			if (!r || typeof r.source !== "string") return [];
			if (typeof r.value !== "number" || !Number.isFinite(r.value)) return [];
			const votes =
				typeof r.votes === "number" && Number.isFinite(r.votes) ? { votes: r.votes } : {};
			return [{ source: r.source, value: r.value, ...votes }];
		});
		out[key] = {
			readings,
			at: one.at,
			...(one.full ? { full: true } : {}),
			...(typeof one.v === "number" ? { v: one.v } : {}),
			...outlookOf(one.outlook),
		};
	}
	return out;
}

const isRating = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10;
const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];

/** Earlier films, keeping only those with a title and a rating. */
function earlierFilms(raw: unknown): EarlierFilm[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((film: unknown) => {
		const f = film as {
			title?: unknown;
			rating?: unknown;
			genres?: unknown;
			released?: unknown;
			votes?: unknown;
		} | null;
		if (!f || typeof f.title !== "string" || !isRating(f.rating)) return [];
		return [
			{
				title: f.title,
				rating: f.rating,
				...(Array.isArray(f.genres) ? { genres: strings(f.genres) } : {}),
				...(typeof f.released === "string" ? { released: f.released } : {}),
				...(typeof f.votes === "number" && f.votes > 0 ? { votes: f.votes } : {}),
			},
		];
	});
}

/** A filed outlook, rebuilt from only the parts that are what they say they are. */
function outlookOf(raw: unknown): { outlook?: Outlook & { at: number } } {
	const one = raw as Partial<Record<keyof Outlook | "at", unknown>> | null | undefined;
	if (!one || typeof one.at !== "number") return {};
	const series = one.series as { name?: unknown; films?: unknown } | undefined;
	const films = earlierFilms(series?.films);
	const directors = one.directors as
		| { names?: unknown; films?: unknown; ratings?: unknown }
		| undefined;
	// Older builds kept only the directors' ratings, with no genres or dates to
	// weigh them by: read as films, and filed as long ago so they are asked again.
	const bare = Array.isArray(directors?.ratings) ? directors.ratings.filter(isRating) : [];
	const directed: EarlierFilm[] =
		bare.length > 0
			? bare.map((rating) => ({ title: "", rating }))
			: earlierFilms(directors?.films);
	// Filed before votes were kept: asked again, so a settled film is read as one.
	const voteless = [...films, ...directed].some((film) => film.votes === undefined);
	return {
		outlook: {
			at: bare.length > 0 || voteless ? 0 : one.at,
			genres: strings(one.genres),
			...(typeof series?.name === "string" && films.length > 0
				? { series: { name: series.name, films } }
				: {}),
			...(directed.length > 0
				? { directors: { names: strings(directors?.names), films: directed } }
				: {}),
			...(typeof one.budget === "number" && Number.isFinite(one.budget) && one.budget > 0
				? { budget: one.budget }
				: {}),
		},
	};
}

/** Keys older builds kept in `data.json`. */
export const CACHE_KEYS = ["checked", "shown", "enrichment", "rotation"] as const;

export function emptyCache(): ScoutCache {
	return { checked: {}, shown: {}, enrichment: {}, rotation: 0, scores: {}, answers: {} };
}

/** Reads a stored blob defensively — it is hand-editable. */
export function normalizeCache(raw: unknown): ScoutCache {
	if (!raw || typeof raw !== "object") return emptyCache();
	const at = raw as Record<string, unknown>;
	const checked: Record<string, string> = {};
	if (at.checked && typeof at.checked === "object") {
		for (const [path, day] of Object.entries(at.checked)) {
			if (typeof day === "string") checked[path] = day;
		}
	}
	const rotation =
		typeof at.rotation === "number" && Number.isFinite(at.rotation)
			? Math.max(0, Math.floor(at.rotation))
			: 0;
	return {
		checked,
		shown: normalizeShown(at.shown),
		enrichment: normalizeEnrichment(at.enrichment),
		rotation,
		scores: normalizeScores(at.scores),
		answers: normalizeAnswers(at.answers),
	};
}

/**
 * Combines the cache file with whatever an older build left in `data.json`.
 * The file is the newer of the two, so its entries win.
 */
export function mergeCaches(file: ScoutCache, legacy: ScoutCache): ScoutCache {
	return {
		checked: { ...legacy.checked, ...file.checked },
		shown: { ...legacy.shown, ...file.shown },
		enrichment: { ...legacy.enrichment, ...file.enrichment },
		rotation: Math.max(file.rotation, legacy.rotation),
		scores: { ...legacy.scores, ...file.scores },
		answers: { ...legacy.answers, ...file.answers },
	};
}

/** Whether a `data.json` blob still carries any of the cache keys. */
export function hasLegacyCache(raw: Record<string, unknown> | null): boolean {
	return !!raw && CACHE_KEYS.some((key) => key in raw);
}

/** `cache.json` in the plugin's own folder. */
export class CacheFile {
	constructor(private readonly plugin: Plugin) {}

	private path(): string {
		const { manifest, app } = this.plugin;
		const dir = manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`;
		return normalizePath(`${dir}/cache.json`);
	}

	/** The stored blob, or null when there is none or it cannot be read. */
	async read(): Promise<unknown> {
		const adapter = this.plugin.app.vault.adapter;
		const path = this.path();
		try {
			if (!(await adapter.exists(path))) return null;
			return JSON.parse(await adapter.read(path)) as unknown;
		} catch (err) {
			// Rebuildable by definition, so a corrupt file starts over.
			console.warn("Scout: could not read cache.json, starting fresh", err);
			return null;
		}
	}

	async write(cache: ScoutCache): Promise<void> {
		await this.plugin.app.vault.adapter.write(this.path(), JSON.stringify(cache));
	}
}

/** Coalesces bursts of writes (e.g. typing in a text field) into one save. */
export class DebouncedSave {
	private timer: number | null = null;

	constructor(
		private readonly write: () => Promise<void>,
		private readonly delayMs = 400,
	) {}

	schedule(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.write();
		}, this.delayMs);
	}

	/** Writes now, cancelling any pending write. */
	async now(): Promise<void> {
		this.cancel();
		await this.write();
	}

	/** Writes now only if a write is pending. */
	async flush(): Promise<void> {
		if (this.timer === null) return;
		await this.now();
	}

	private cancel(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
	}
}
