import { emptyExtras } from "../../core/detail/types";
import type { ItemExtras, ServiceTile, Video } from "../../core/detail/types";
import { longDate, oneDecimal } from "../../core/format";
import {
	image,
	isOfficial,
	makers,
	pageUrl,
	releaseDate,
	toHours,
	toItem,
	type IgdbGame,
} from "./provider";

/**
 * The detail dialog's view of a game.
 *
 * Everything but the time to beat comes from the game's own record, expanded,
 * so one request fills the dialog. Whatever is missing leaves its section
 * empty and the section hides itself.
 */

export interface IgdbTimeToBeat {
	hastily?: number;
	normally?: number;
	completely?: number;
}

export interface IgdbParts {
	game: IgdbGame;
	timeToBeat?: IgdbTimeToBeat | null;
}

/** Stores by the address IGDB links them at, which outlasts its type numbers. */
const STORES: [RegExp, string][] = [
	[/store\.steampowered\.com/, "Steam"],
	[/gog\.com/, "GOG"],
	[/epicgames\.com/, "Epic Games Store"],
	[/itch\.io/, "itch.io"],
	[/apps\.apple\.com|itunes\.apple\.com/, "App Store"],
	[/play\.google\.com/, "Google Play"],
	[/xbox\.com|microsoft\.com/, "Xbox"],
	[/playstation\.com/, "PlayStation Store"],
	[/nintendo\.com/, "Nintendo eShop"],
];

function toTiles(game: IgdbGame): ServiceTile[] {
	const out: ServiceTile[] = [];
	for (const site of game.websites ?? []) {
		const name = site.url && STORES.find(([host]) => host.test(site.url ?? ""))?.[1];
		if (name && site.url && !out.some((one) => one.name === name)) {
			out.push({ name, url: site.url });
		}
	}
	return out;
}

function toVideos(game: IgdbGame): Video[] {
	return (game.videos ?? [])
		.filter((one) => one.video_id)
		.map((one) => ({
			name: one.name || "Trailer",
			url: `https://www.youtube.com/watch?v=${one.video_id}`,
			thumbnailUrl: `https://i.ytimg.com/vi/${one.video_id}/hqdefault.jpg`,
		}));
}

const score = (value: number | null | undefined) =>
	typeof value === "number" && value > 0 ? oneDecimal(value / 10) : undefined;

export function toExtras(parts: IgdbParts): ItemExtras {
	const { game, timeToBeat } = parts;
	const { developers, publishers } = makers(game);
	const platforms = (game.platforms ?? []).map((one) => one.name);
	const tiles = toTiles(game);
	const screenshots = (game.screenshots ?? [])
		.map((one) => image(one, "screenshot_big"))
		.filter((one): one is string => Boolean(one));

	const headerFacts: string[] = [];
	const normally = toHours(timeToBeat?.normally);
	if (normally) headerFacts.push(`About ${normally}h to beat`);

	const scores: ItemExtras["scores"] = [];
	const critics = score(game.aggregated_rating);
	if (critics) {
		scores.push({
			id: "igdb-critics",
			label: "Critics",
			value: critics,
			outOfTen: (game.aggregated_rating ?? 0) / 10,
			...(game.aggregated_rating_count ? { votes: game.aggregated_rating_count } : {}),
		});
	}
	const players = score(game.rating);
	if (players) {
		scores.push({
			id: "igdb",
			label: "IGDB",
			value: players,
			outOfTen: (game.rating ?? 0) / 10,
			...(game.rating_count ? { votes: game.rating_count } : {}),
		});
	}

	const facts: ItemExtras["facts"] = [];
	const add = (label: string, value: string | undefined) => {
		if (value) facts.push({ label, value });
	};
	const released = releaseDate(game);
	add("Developer", developers.join(", "));
	add("Publisher", publishers.join(", "));
	add("Released", released ? longDate(released) : undefined);
	add("Platforms", platforms.join(", "));
	const rushed = toHours(timeToBeat?.hastily);
	const completed = toHours(timeToBeat?.completely);
	add("Rushed", rushed ? `${rushed}h` : undefined);
	add("Completionist", completed ? `${completed}h` : undefined);

	const links: ItemExtras["links"] = [{ label: "IGDB", url: pageUrl(game) }];
	if (game.slug) {
		links.push({ label: "Backloggd", url: `https://backloggd.com/games/${game.slug}/` });
	}
	const official = (game.websites ?? []).find(isOfficial)?.url;
	if (official) links.push({ label: "Official site", url: official });

	const dlc = [...(game.dlcs ?? []), ...(game.expansions ?? [])].map(toItem);
	const series = (game.collections?.[0]?.games ?? [])
		.filter((one) => one.id !== game.id)
		.map(toItem);
	const backdrop =
		image(game.artworks?.[0], "1080p") ?? image(game.screenshots?.[0], "1080p");
	const developer = developers[0];

	return {
		...emptyExtras(),
		shape: "poster",
		headerFacts,
		scores,
		moreLabel: "More",
		videos: toVideos(game),
		screenshots,
		screenshotTotal: screenshots.length,
		rails: [
			{ id: "dlc", title: "DLC and expansions", items: dlc, shape: "poster" },
			{
				id: "series",
				title: game.collections?.[0]?.name
					? `In the ${game.collections[0].name} series`
					: "In this series",
				items: series,
				shape: "poster",
			},
		],
		facts,
		keywords: [...(game.themes ?? []), ...(game.keywords ?? [])]
			.slice(0, 10)
			.map((one) => one.name.toLowerCase()),
		links,
		progress: { unit: "hour", ...(normally ? { total: normally } : {}) },
		...(developer ? { byline: developer } : {}),
		...(backdrop ? { backdropUrl: backdrop } : {}),
		...(tiles.length > 0
			? {
					availability: {
						title: "Where to play",
						groups: [{ id: "stores", label: "Stores", tiles }],
					},
				}
			: {}),
	};
}
