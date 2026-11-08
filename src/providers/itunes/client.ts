import type { HttpClient } from "../../core/http";

/**
 * Apple's prices, from the keyless iTunes Search API.
 *
 * Opt-in, because it sends a title to Apple. Everything that comes back is a
 * price Apple quoted for your region, and anything it does not know is left out
 * rather than estimated.
 *
 * Checked live on 2026-11-05. `media=ebook`, `audiobook`, and `music` all answer.
 * `media=movie` and `tvShow` returned zero results for every title tried, in
 * both the UK and US stores, so film prices may never appear. The call is kept
 * because it costs nothing when empty and starts working if Apple restores it.
 */

const API = "https://itunes.apple.com/search";

const CACHE_MS = 24 * 60 * 60 * 1000;

export interface ItunesResult {
	wrapperType?: string;
	kind?: string;
	collectionType?: string;
	artistName?: string;
	trackName?: string;
	collectionName?: string;
	trackViewUrl?: string;
	collectionViewUrl?: string;
	formattedPrice?: string;
	price?: number;
	collectionPrice?: number;
	trackPrice?: number;
	trackRentalPrice?: number;
	trackHdPrice?: number;
	trackHdRentalPrice?: number;
	currency?: string;
	releaseDate?: string;
}

/** A price, and where to pay it. */
export interface ApplePrice {
	price: string;
	url?: string;
}

/** Everything but letters and digits, for comparing titles across catalogues. */
const fold = (text: string | undefined) =>
	(text ?? "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/\([^)]*\)/g, " ")
		.replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The result that is really this title.
 *
 * iTunes search is fuzzy and will return a study guide for a novel as readily as
 * the novel. A wrong price is worse than none, so a name that does not match on
 * both title and creator is treated as no result.
 */
export function pickResult(
	results: readonly ItunesResult[],
	title: string,
	creator: string | undefined,
): ItunesResult | undefined {
	const wanted = fold(title);
	const by = fold(creator);
	if (!wanted) return undefined;
	return results.find((one) => {
		const name = fold(one.trackName ?? one.collectionName);
		const titled = name === wanted || name.startsWith(wanted);
		if (!titled) return false;
		if (!by) return true;
		const artist = fold(one.artistName);
		return artist.includes(by) || by.includes(artist);
	});
}

/** A number in a currency, the way that country writes it. Zero reads `Free`. */
export function formatPrice(
	amount: number | undefined,
	currency: string | undefined,
	region: string,
): string | undefined {
	if (amount === undefined || amount < 0 || !currency) return undefined;
	if (amount === 0) return "Free";
	try {
		return new Intl.NumberFormat(`en-${region}`, {
			style: "currency",
			currency,
		}).format(amount);
	} catch {
		return `${amount.toFixed(2)} ${currency}`;
	}
}

function priced(
	one: ItunesResult | undefined,
	amount: number | undefined,
	region: string,
): ApplePrice | undefined {
	const price = formatPrice(amount, one?.currency, region);
	if (!one || !price) return undefined;
	const url = one.trackViewUrl ?? one.collectionViewUrl;
	return { price, ...(url ? { url } : {}) };
}

export interface BookPrices {
	ebook?: ApplePrice;
	audiobook?: ApplePrice;
}

export interface FilmPrices {
	rent?: ApplePrice;
	buy?: ApplePrice;
}

export class ItunesClient {
	constructor(
		private readonly http: HttpClient,
		private readonly enabled: () => boolean,
	) {}

	isEnabled(): boolean {
		return this.enabled();
	}

	private async search(
		params: Record<string, string>,
		region: string,
		signal: AbortSignal,
	): Promise<ItunesResult[]> {
		const query = new URLSearchParams({
			...params,
			country: region,
			limit: "10",
		});
		const raw = await this.http.getJson<{ results?: ItunesResult[] }>(
			`${API}?${query.toString()}`,
			{ signal, cacheTtlMs: CACHE_MS, retries: 0 },
		);
		return raw.results ?? [];
	}

	async book(
		title: string,
		author: string | undefined,
		region: string,
		signal: AbortSignal,
	): Promise<BookPrices> {
		if (!this.enabled()) return {};
		const term = [title, author].filter(Boolean).join(" ");
		const [ebooks, audiobooks] = await Promise.all([
			this.search({ term, media: "ebook" }, region, signal),
			this.search({ term, media: "audiobook" }, region, signal),
		]);
		const ebook = pickResult(ebooks, title, author);
		const audio = pickResult(audiobooks, title, author);
		const ebookPrice = priced(ebook, ebook?.price, region);
		const audioPrice = priced(audio, audio?.collectionPrice, region);
		return {
			...(ebookPrice ? { ebook: ebookPrice } : {}),
			...(audioPrice ? { audiobook: audioPrice } : {}),
		};
	}

	async album(
		title: string,
		artist: string | undefined,
		region: string,
		signal: AbortSignal,
	): Promise<ApplePrice | undefined> {
		if (!this.enabled()) return undefined;
		const term = [title, artist].filter(Boolean).join(" ");
		const found = await this.search(
			{ term, media: "music", entity: "album" },
			region,
			signal,
		);
		const album = pickResult(found, title, artist);
		return priced(album, album?.collectionPrice, region);
	}

	async film(
		title: string,
		year: number | undefined,
		region: string,
		signal: AbortSignal,
	): Promise<FilmPrices> {
		if (!this.enabled()) return {};
		const found = await this.search(
			{ term: title, media: "movie", entity: "movie" },
			region,
			signal,
		);
		const film = found.find(
			(one) =>
				fold(one.trackName) === fold(title) &&
				(year === undefined || one.releaseDate?.startsWith(String(year))),
		);
		const rent = priced(
			film,
			film?.trackRentalPrice ?? film?.trackHdRentalPrice,
			region,
		);
		const buy = priced(film, film?.trackPrice ?? film?.trackHdPrice, region);
		return { ...(rent ? { rent } : {}), ...(buy ? { buy } : {}) };
	}
}
