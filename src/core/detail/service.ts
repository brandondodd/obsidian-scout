import type { LibraryConfig } from "../library/config";
import { isAbortError } from "../http";
import type { Outlook } from "../hype";
import { isDiscoverable, isExtended, isForeseeing, isRecommendable } from "../provider";
import type { MediaProvider } from "../provider";
import type { ProviderRegistry } from "../registry";
import { resolveRegion } from "../region";
import type { MediaItem, MediaRef } from "../types";
import type { ItunesClient } from "../../providers/itunes/client";
import type { MdbListClient } from "../../providers/mdblist/client";
import type { OmdbClient } from "../../providers/omdb/client";
import { withAlbumPrice, withBookPrices, withFilmPrices } from "./apple";
import { isUnreleased, type Reading } from "../scout-score";
import { fillGaps, readingsOf } from "./scores";
import { emptyExtras, type ItemExtras, type TitleScores } from "./types";

/**
 * Gathers everything the detail dialog shows for one title.
 *
 * The source's own extras, then whichever opt-in services you have turned on.
 * Each addition is best-effort: a failed or absent one leaves the dialog as it
 * would have been without it, so a spent MDBList quota costs a score box rather
 * than the whole page.
 */

export interface DetailResult {
	extras: ItemExtras;
	scores: TitleScores | null;
}

/** Runs an addition, and treats every failure but cancelling as "no answer". */
async function optional<T>(run: () => Promise<T>): Promise<T | null> {
	try {
		return await run();
	} catch (err) {
		if (isAbortError(err)) throw err;
		// Status only: a message built from a URL would carry the API key.
		console.warn(
			"Scout: an optional detail source did not answer",
			(err as { status?: number })?.status ?? "",
		);
		return null;
	}
}

export class DetailService {
	constructor(
		private readonly registry: ProviderRegistry,
		private readonly config: () => LibraryConfig,
		private readonly mdblist: MdbListClient,
		private readonly omdb: OmdbClient,
		private readonly itunes: ItunesClient,
		private readonly isEnabled: (providerId: string) => boolean,
		/** Files the readings this dialog blends, so the library blends the same. */
		private readonly recordScore: (
			ref: MediaRef,
			readings: Reading[],
			full: boolean,
		) => void = () => {},
		/** What was last filed for a title, to fill any source MDBList leaves blank. */
		private readonly storedReadings: (ref: MediaRef) => readonly Reading[] | undefined = () =>
			undefined,
		/** Files what is known of a film not out yet, so the library shows the same hype. */
		private readonly recordOutlook: (ref: MediaRef, outlook: Outlook) => void = () => {},
	) {}

	/** Whether a title has an outlook to ask about: a TMDB film not out yet. */
	foresees(ref: MediaRef, facts: { releaseDate?: string; year?: number }): boolean {
		return ref.providerId === "tmdb" && ref.kind === "movie" && isUnreleased(facts);
	}

	/**
	 * What is known of a film not out yet, for its hype; filed, so the library
	 * shows the same. Null when its source is off, keyless, or did not answer.
	 */
	async outlook(ref: MediaRef, signal: AbortSignal): Promise<Outlook | null> {
		const found = this.registry.get(ref.providerId);
		if (!found || !this.isEnabled(found.id) || !found.isConfigured() || !isForeseeing(found)) {
			return null;
		}
		const outlook = await optional(() => found.outlook(ref, { signal }));
		if (outlook) this.recordOutlook(ref, outlook);
		return outlook;
	}

	region(): string {
		return resolveRegion(
			this.config().region,
			typeof navigator === "undefined" ? undefined : navigator.language,
		);
	}

	hasEpisodeImdb(): boolean {
		return this.omdb.isConfigured();
	}

	imdbSeason(
		imdbId: string,
		season: number,
		signal: AbortSignal,
	): Promise<Map<number, number>> {
		return this.omdb.seasonScores(imdbId, season, signal);
	}

	async load(
		ref: MediaRef,
		item: MediaItem | undefined,
		signal: AbortSignal,
	): Promise<DetailResult> {
		const found = this.registry.get(ref.providerId);
		// A note can outlive its source being switched off, or never having had
		// its key filled in, and neither is a reason to go knocking.
		const provider =
			found && this.isEnabled(found.id) && found.isConfigured()
				? found
				: undefined;
		const region = this.region();

		const base =
			provider && isExtended(provider)
				? await provider.extras(ref, {
						signal,
						region,
						...(item ? { previous: item } : {}),
					})
				: emptyExtras();

		const [answered, like, priced] = await Promise.all([
			optional(() => this.mdblist.titleScores(ref, signal)),
			provider && item
				? optional(() => this.moreLike(provider, ref, item, signal))
				: Promise.resolve(null),
			item
				? optional(() => this.withPrices(base, ref, item, region, signal))
				: Promise.resolve(null),
		]);

		const extras = priced ?? base;
		const scores = answered && fillGaps(answered, this.storedReadings(ref));
		const readings = readingsOf(base.scores, scores);
		if (readings.length > 0) {
			const full = scores !== null && Object.keys(scores).length > 0;
			this.recordScore(ref, readings, full);
		}
		return {
			scores,
			extras: {
				...extras,
				rails:
					like && like.length > 0
						? [
								...extras.rails,
								{
									id: "like",
									title: "More like this",
									items: like,
									...(extras.shape ? { shape: extras.shape } : {}),
								},
							]
						: extras.rails,
			},
		};
	}

	/**
	 * Similar titles, from wherever this source can get them.
	 *
	 * Sources without a "more like this" endpoint are asked for well-liked
	 * titles in the same genres, which is a weaker answer but not a wrong one.
	 */
	private async moreLike(
		provider: MediaProvider,
		ref: MediaRef,
		item: MediaItem,
		signal: AbortSignal,
	): Promise<MediaItem[]> {
		const found = isRecommendable(provider)
			? await provider.similar(ref, { signal })
			: isDiscoverable(provider) && item.tags.length > 0
				? await provider.discover(
						{ kind: ref.kind, genres: item.tags.slice(0, 2) },
						{ signal },
					)
				: [];
		return found.filter((one) => one.ref.id !== ref.id).slice(0, 12);
	}

	private async withPrices(
		base: ItemExtras,
		ref: MediaRef,
		item: MediaItem,
		region: string,
		signal: AbortSignal,
	): Promise<ItemExtras> {
		if (!this.itunes.isEnabled()) return base;
		if (ref.kind === "book") {
			const author = item.people[0];
			const prices = await this.itunes.book(item.title, author, region, signal);
			return withBookPrices(base, prices);
		}
		if (ref.kind === "album") {
			const price = await this.itunes.album(
				item.title,
				item.subtitle,
				region,
				signal,
			);
			return withAlbumPrice(base, price);
		}
		if (ref.kind === "movie" && base.availability) {
			const prices = await this.itunes.film(
				item.title,
				item.year,
				region,
				signal,
			);
			return withFilmPrices(base, prices);
		}
		return base;
	}
}
