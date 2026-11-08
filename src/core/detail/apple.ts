import type {
	ApplePrice,
	BookPrices,
	FilmPrices,
} from "../../providers/itunes/client";
import type { Availability, ItemExtras, ServiceGroup } from "./types";

/**
 * Folding Apple's prices into what a source already said. Pure.
 *
 * Only ever adds a price to something Apple actually quoted. A service without
 * one stays exactly as the source described it, with no price on the tile.
 */

function tile(name: string, price: string, one: ApplePrice) {
	return { name, price, ...(one.url ? { url: one.url } : {}) };
}

/** Buy goes first: for a book, it is the offer the bar under the cover names. */
function prepend(
	extras: ItemExtras,
	title: string,
	group: ServiceGroup,
): ItemExtras {
	const availability: Availability = extras.availability
		? {
				...extras.availability,
				groups: [group, ...extras.availability.groups],
				regional: true,
			}
		: { title, groups: [group], regional: true };
	return { ...extras, availability };
}

export function withBookPrices(
	extras: ItemExtras,
	prices: BookPrices,
): ItemExtras {
	const tiles = [];
	if (prices.ebook) {
		tiles.push(
			tile("Apple Books", `Ebook ${prices.ebook.price}`, prices.ebook),
		);
	}
	if (prices.audiobook) {
		tiles.push(
			tile(
				"Apple Books",
				`Audiobook ${prices.audiobook.price}`,
				prices.audiobook,
			),
		);
	}
	if (tiles.length === 0) return extras;
	return prepend(extras, "Where to read", { id: "buy", label: "Buy", tiles });
}

export function withAlbumPrice(
	extras: ItemExtras,
	price: ApplePrice | undefined,
): ItemExtras {
	if (!price) return extras;
	const buy: ServiceGroup = {
		id: "buy",
		label: "Buy",
		tiles: [tile("iTunes", price.price, price)],
	};
	const availability: Availability = extras.availability
		? {
				...extras.availability,
				groups: [...extras.availability.groups, buy],
				regional: true,
			}
		: { title: "Where to listen", groups: [buy], regional: true };
	return { ...extras, availability };
}

const isApple = (name: string) => /^apple\s*tv|^itunes/i.test(name.trim());

/** Prices go on the Apple tiles TMDB already listed, and nowhere else. */
export function withFilmPrices(
	extras: ItemExtras,
	prices: FilmPrices,
): ItemExtras {
	const availability = extras.availability;
	if (!availability) return extras;
	const quote = (id: string) =>
		id === "rent" ? prices.rent : id === "buy" ? prices.buy : undefined;
	return {
		...extras,
		availability: {
			...availability,
			groups: availability.groups.map((group) => {
				const price = quote(group.id)?.price;
				if (!price) return group;
				return {
					...group,
					tiles: group.tiles.map((one) =>
						isApple(one.name) ? { ...one, price } : one,
					),
				};
			}),
		},
	};
}
