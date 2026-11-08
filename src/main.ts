import { Notice, Plugin } from "obsidian";
import { registerCommands } from "./commands";
import { scoreKey } from "./core/scout-score";
import type { ScoutContext } from "./core/context";
import { DetailService } from "./core/detail/service";
import { HttpClient } from "./core/http";
import { CollectionKeeper } from "./core/library/collector";
import { LibraryIndex } from "./core/library/indexer";
import { LibraryMutator } from "./core/library/mutate";
import { LibraryEnricher } from "./core/library/enricher";
import { LibraryRefresher } from "./core/library/refresher";
import { ScoreKeeper } from "./core/library/scorer";
import { NoteFactory } from "./core/noteFactory";
import { isForeseeing, type MediaProvider, type ProviderContext } from "./core/provider";
import { ProviderRegistry } from "./core/registry";
import { adoptPlainSecrets } from "./core/settings/secrets";
import { ScoutSettings } from "./core/settings/store";
import { ScoutSettingTab } from "./core/settings/tab";
import { AniListProvider } from "./providers/anilist/provider";
import { ItunesClient } from "./providers/itunes/client";
import { MdbListClient } from "./providers/mdblist/client";
import { OmdbClient } from "./providers/omdb/client";
import { MusicBrainzProvider } from "./providers/musicbrainz/provider";
import { OpenLibraryProvider } from "./providers/openlibrary/provider";
import { IgdbProvider } from "./providers/igdb/provider";
import { TmdbProvider } from "./providers/tmdb/provider";
import { WebLinkProvider } from "./providers/weblink/provider";
import { HOME_VIEW_TYPE, ScoutHomeView, openHome } from "./ui/homeView";
import { LIBRARY_VIEW_TYPE, ScoutLibraryView, openLibrary } from "./ui/libraryView";
import { ScoutSearchModal } from "./ui/searchModal";
import { STATS_VIEW_TYPE, ScoutStatsView } from "./ui/statsView";

/**
 * The provider table — the one place a new source is added.
 *
 * The id is declared here rather than read off the instance so the settings
 * scope can be built before construction.
 *
 * Order matters for URL resolution: the registry picks the first provider that
 * claims a link, and WebLink claims *any* http(s) URL, so it stays last as the
 * catch-all.
 */
const PROVIDERS: {
	id: string;
	create: (ctx: ProviderContext) => MediaProvider;
}[] = [
	{ id: "tmdb", create: (ctx) => new TmdbProvider(ctx) },
	{ id: "openlibrary", create: (ctx) => new OpenLibraryProvider(ctx) },
	{ id: "anilist", create: (ctx) => new AniListProvider(ctx) },
	{ id: "igdb", create: (ctx) => new IgdbProvider(ctx) },
	{ id: "musicbrainz", create: (ctx) => new MusicBrainzProvider(ctx) },
	{ id: "weblink", create: (ctx) => new WebLinkProvider(ctx) },
];

/**
 * Plugin lifecycle only. Feature logic lives in `core/`, `providers/`, and `ui/`.
 */
export default class ScoutPlugin extends Plugin {
	private settings!: ScoutSettings;
	private context!: ScoutContext;

	/**
	 * Loading, and saying so when it does not.
	 *
	 * Obsidian reports a plugin that threw during load as "failed to load" and
	 * puts the reason in the console — which on a desktop is one keystroke away
	 * and on a phone is nowhere at all. Since a phone is exactly where a load
	 * failure is hardest to diagnose, the reason is put on screen. Rethrown
	 * afterwards, so Obsidian still counts the plugin as failed rather than as
	 * loaded and quietly broken.
	 */
	async onload(): Promise<void> {
		try {
			await this.start();
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			new Notice(`Scout could not start: ${reason}`, 15_000);
			throw err;
		}
	}

	private async start(): Promise<void> {
		this.settings = new ScoutSettings(this);
		await this.settings.load();

		const http = new HttpClient();
		const registry = new ProviderRegistry();

		for (const entry of PROVIDERS) {
			const scope = this.settings.scopeFor(entry.id);
			const provider = entry.create({ http, settings: scope });
			if (provider.id !== entry.id) {
				throw new Error(
					`Provider id mismatch: table says "${entry.id}", instance says "${provider.id}"`,
				);
			}
			registry.register(provider);
			await adoptPlainSecrets(
				this.app.secretStorage,
				entry.id,
				scope,
				provider.settingsSchema(),
			);
		}

		// The index builds itself lazily on first read, so nothing scans the
		// vault during load.
		const library = new LibraryIndex(this.app, this.settings);
		library.register(this);

		const mutator = new LibraryMutator(this.app, this.settings);
		const refresher = new LibraryRefresher(
			this.settings,
			registry,
			library,
			mutator,
		);

		const collector = new CollectionKeeper(this.settings, library, mutator);
		const enricher = new LibraryEnricher(this.settings, registry, library);

		// Not sources: none of these makes notes or answers a search. Each stays
		// silent until you give it a key or turn it on.
		const keyOf = (id: string) => () =>
			this.settings.scopeFor(id).secret("apiKeySecret").trim();
		const mdblist = new MdbListClient(http, keyOf("mdblist"));
		const scorer = new ScoreKeeper(
			this.settings,
			library,
			mdblist,
			http,
			() => this.settings.isProviderEnabled("openlibrary"),
			// For the hype of films not out yet: TMDB, only while it is a
			// source you use and have given a key.
			async (ref, signal) => {
				const tmdb = registry.get("tmdb");
				if (!tmdb || !isForeseeing(tmdb) || !this.settings.isProviderEnabled("tmdb") || !tmdb.isConfigured()) {
					return undefined;
				}
				return tmdb.outlook(ref, { signal });
			},
		);
		const detail = new DetailService(
			registry,
			() => this.settings.library(),
			mdblist,
			new OmdbClient(http, keyOf("omdb")),
			new ItunesClient(http, () =>
				this.settings.scopeFor("itunes").get("enabled", false),
			),
			(id) => this.settings.isProviderEnabled(id),
			(ref, readings, full) => scorer.record(ref, readings, full),
			(ref) => this.settings.scores()[scoreKey(ref)]?.readings,
			(ref, outlook) => scorer.recordOutlook(ref, outlook),
		);

		this.context = {
			app: this.app,
			settings: this.settings,
			registry,
			factory: new NoteFactory(this.app, this.settings, registry),
			library,
			mutator,
			refresher,
			enricher,
			collector,
			detail,
		};

		// After load, not during it: the first run waits long enough that
		// nothing about starting Obsidian is slower for it being installed.
		refresher.start(this);
		enricher.start(this);
		scorer.start(this);
		collector.register(this);

		this.registerView(
			HOME_VIEW_TYPE,
			(leaf) => new ScoutHomeView(leaf, this.context),
		);
		this.registerView(
			LIBRARY_VIEW_TYPE,
			(leaf) => new ScoutLibraryView(leaf, this.context),
		);
		this.registerView(
			STATS_VIEW_TYPE,
			(leaf) => new ScoutStatsView(leaf, this.context),
		);

		this.addSettingTab(new ScoutSettingTab(this.app, this, this.context));
		registerCommands(this, this.context);

		// The hub first, because it is the one that answers "what now" — the
		// library is where you go when you already know what you are after.
		this.addRibbonIcon("clapperboard", "Scout: home", () =>
			void openHome(this.app),
		);
		this.addRibbonIcon("library-big", "Scout: open library", () =>
			void openLibrary(this.app),
		);
		this.addRibbonIcon("search", "Scout: search", () =>
			new ScoutSearchModal(this.context).open(),
		);
	}

	async onunload(): Promise<void> {
		// Flush settings and cache changes still inside the debounce window.
		await this.settings?.saveNow();
	}
}
