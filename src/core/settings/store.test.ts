import type { Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, SCHEMA_VERSION, ScoutSettings } from "./store";

/** The exact shape found in this vault's data.json before the refactor. */
const REAL_V1_DATA = {
	enableTvFeatures: true,
	enableBookFeatures: true,
	movieTemplateFilePath: "X/Templates/Media/Movie.md",
	movieOutputLocation: "Atlas/Media/Movies",
	tvShowTemplateFilePath: "X/Templates/Media/TV Show.md",
	tvShowOutputLocation: "Atlas/Media/TV Shows",
	bookTemplateFilePath: "",
	bookOutputLocation: "Atlas/Media/Books",
	lastViewMode: "grid",
	lastBookViewMode: "list",
	tvFeatures: true,
	tvTemplateFilePath: "X/Templates/Media/TV Show.md",
	tvOutputLocation: "Atlas/Media/TV Shows",
	tmdbAccessToken: "test-token",
};

describe("settings migration", () => {
	it("carries every configured path across from the real v1 blob", () => {
		const out = migrate(REAL_V1_DATA);

		expect(out.schemaVersion).toBe(SCHEMA_VERSION);
		expect(out.kinds.movie).toEqual({
			templatePath: "X/Templates/Media/Movie.md",
			outputFolder: "Atlas/Media/Movies",
		});
		expect(out.kinds.tv).toEqual({
			templatePath: "X/Templates/Media/TV Show.md",
			outputFolder: "Atlas/Media/TV Shows",
		});
		// Book template was empty, so only the folder carries over.
		expect(out.kinds.book?.outputFolder).toBe("Atlas/Media/Books");
	});

	it("moves the token into the tmdb namespace", () => {
		const out = migrate(REAL_V1_DATA);
		expect(out.providers.tmdb?.accessToken).toBe("test-token");
		expect(out.providers.tmdb?.enabled).toBe(true);
	});

	it("drops the stale duplicate keys entirely", () => {
		const out = migrate(REAL_V1_DATA) as unknown as Record<string, unknown>;
		for (const stale of [
			"enableTvFeatures",
			"tvFeatures",
			"tvTemplateFilePath",
			"lastViewMode",
			"lastBookViewMode",
		]) {
			expect(out[stale]).toBeUndefined();
		}
	});

	it("preserves the view mode preference", () => {
		expect(migrate(REAL_V1_DATA).core.defaultViewMode).toBe("grid");
	});

	it("prefers the newer tvShow* keys over the legacy tv* ones", () => {
		const out = migrate({
			tvShowOutputLocation: "New/TV",
			tvOutputLocation: "Old/TV",
		});
		expect(out.kinds.tv?.outputFolder).toBe("New/TV");
	});

	it("is idempotent — migrating twice changes nothing", () => {
		const once = migrate(REAL_V1_DATA);
		const twice = migrate(once as unknown as Record<string, unknown>);
		expect(twice).toEqual(once);
	});

	it("handles a first run with no saved data", () => {
		const out = migrate(null);
		expect(out.schemaVersion).toBe(SCHEMA_VERSION);
		expect(out.kinds).toEqual({});
		expect(out.core.collisionPolicy).toBe("prompt");
	});

	it("backfills newly added core defaults on an existing v2 blob", () => {
		const out = migrate({
			schemaVersion: 2,
			core: { collisionPolicy: "overwrite" },
			kinds: {},
			providers: {},
		});
		expect(out.core.collisionPolicy).toBe("overwrite");
		expect(out.core.openAfterCreate).toBe(true);
	});
});

/* ------------------------------------------------------------- cache file */

/** A plugin whose data.json and adapter live in memory. */
function fakePlugin(data: Record<string, unknown> | null, files: Record<string, string> = {}) {
	const saved: { data: unknown } = { data };
	const plugin = {
		manifest: { id: "scout", dir: ".obsidian/plugins/scout" },
		app: {
			vault: {
				configDir: ".obsidian",
				adapter: {
					exists: async (path: string) => path in files,
					read: async (path: string) => files[path] ?? "",
					write: async (path: string, text: string) => {
						files[path] = text;
					},
				},
			},
		},
		loadData: async () => saved.data,
		saveData: async (next: unknown) => {
			saved.data = JSON.parse(JSON.stringify(next));
		},
	};
	return { plugin: plugin as unknown as Plugin, saved, files };
}

const CACHE_PATH = ".obsidian/plugins/scout/cache.json";

describe("cache file", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", globalThis);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	const enrichment = {
		"tmdb:1": { v: 1, at: 1, keywords: [], people: [], directors: [], studios: [] },
	};

	it("moves the cache out of data.json without losing anything", async () => {
		const { plugin, saved, files } = fakePlugin({
			schemaVersion: SCHEMA_VERSION,
			core: {},
			kinds: {},
			providers: {},
			feedback: { "tmdb:9": { verdict: "liked", at: 5 } },
			checked: { "Films/A.md": "2026-01-01" },
			shown: { "tmdb:2": 10 },
			enrichment,
			rotation: 7,
		});
		const settings = new ScoutSettings(plugin);
		await settings.load();

		const data = saved.data as Record<string, unknown>;
		for (const key of ["checked", "shown", "enrichment", "rotation"]) {
			expect(data[key]).toBeUndefined();
		}
		expect(Object.keys(data.feedback as object)).toEqual(["tmdb:9"]);

		const cache = JSON.parse(files[CACHE_PATH] ?? "{}");
		expect(cache.checked).toEqual({ "Films/A.md": "2026-01-01" });
		expect(cache.shown).toEqual({ "tmdb:2": 10 });
		expect(Object.keys(cache.enrichment)).toEqual(["tmdb:1"]);
		expect(cache.rotation).toBe(8);
		expect(settings.checkLog()).toEqual({ "Films/A.md": "2026-01-01" });
	});

	it("prefers the cache file when both hold an entry", async () => {
		const { plugin, files } = fakePlugin(
			{ schemaVersion: SCHEMA_VERSION, checked: { a: "old", b: "kept" }, rotation: 2 },
			{ [CACHE_PATH]: JSON.stringify({ checked: { a: "new" }, rotation: 5 }) },
		);
		const settings = new ScoutSettings(plugin);
		await settings.load();
		expect(settings.checkLog()).toEqual({ a: "new", b: "kept" });
		expect(settings.rotation()).toBe(6);
		expect(JSON.parse(files[CACHE_PATH] ?? "{}").rotation).toBe(6);
	});

	it("does not rewrite data.json on an ordinary load", async () => {
		const blob = { schemaVersion: SCHEMA_VERSION, core: {}, kinds: {}, providers: {} };
		const { plugin, saved, files } = fakePlugin(blob, {
			[CACHE_PATH]: JSON.stringify({ rotation: 1 }),
		});
		const settings = new ScoutSettings(plugin);
		await settings.load();
		settings.markChecked("x.md", "2026-02-02");
		await vi.runAllTimersAsync();
		expect(saved.data).toBe(blob);
		expect(JSON.parse(files[CACHE_PATH] ?? "{}").checked).toEqual({ "x.md": "2026-02-02" });
	});

	it("starts over when the cache file is corrupt", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { plugin } = fakePlugin(null, { [CACHE_PATH]: "{not json" });
		const settings = new ScoutSettings(plugin);
		await settings.load();
		expect(settings.enrichment()).toEqual({});
		expect(settings.rotation()).toBe(1);
	});

	it("flushes a pending cache write on saveNow", async () => {
		const { plugin, files } = fakePlugin(null);
		const settings = new ScoutSettings(plugin);
		await settings.load();
		settings.markShown(["tmdb:3"], new Date(1000));
		await settings.saveNow();
		expect(JSON.parse(files[CACHE_PATH] ?? "{}").shown).toEqual({ "tmdb:3": 1000 });
	});
});
