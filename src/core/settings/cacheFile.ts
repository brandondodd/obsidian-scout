import { normalizePath, type Plugin } from "obsidian";
import { normalizeEnrichment, type EnrichmentCache } from "../library/enrich";
import { normalizeShown, type ShownLog } from "../library/feedback";

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
}

/** Keys older builds kept in `data.json`. */
export const CACHE_KEYS = ["checked", "shown", "enrichment", "rotation"] as const;

export function emptyCache(): ScoutCache {
	return { checked: {}, shown: {}, enrichment: {}, rotation: 0 };
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
