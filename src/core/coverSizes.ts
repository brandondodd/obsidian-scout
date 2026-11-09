/**
 * The other sizes a cover's image host will serve, as a `srcset`.
 *
 * Notes keep one cover URL, usually a large one, because the detail page shows
 * it large. A card draws it at about a third of that, and a shelf fetching,
 * decoding and repainting a few hundred full-size posters to show them small is
 * most of why a shelf is slow to fill. The hosts covers come from all serve
 * smaller cuts of the same picture by URL, so the browser is offered those and
 * picks the one that fits where the cover is drawn.
 *
 * Sizes are only offered up to the one the note asked for: a smaller picture
 * is the point, and a larger one may not exist.
 */

interface Cut {
	url: string;
	width: number;
}

/** TMDB's poster widths, smallest first. */
const TMDB_WIDTHS = [92, 154, 185, 342, 500, 780];
/** The largest asked of TMDB when the note names its original upload. */
const TMDB_ORIGINAL_CAP = 780;
/** Below this a cut is too coarse for any cover Scout draws. */
const TMDB_SMALLEST = 185;

function tmdb(url: string): Cut[] | undefined {
	const match = /^(https:\/\/(?:image\.tmdb\.org|www\.themoviedb\.org)\/t\/p\/)(w\d+|original)(\/[^?#]+)$/.exec(
		url,
	);
	const [, base = "", size = "", file = ""] = match ?? [];
	if (!match) return undefined;
	const most = size === "original" ? TMDB_ORIGINAL_CAP : Number(size.slice(1));
	return TMDB_WIDTHS.filter((width) => width >= TMDB_SMALLEST && width <= most).map(
		(width) => ({ url: `${base}w${width}${file}`, width }),
	);
}

/** OpenLibrary's cuts; their widths vary by scan, these are typical. */
const OPENLIBRARY_CUTS: Array<[letter: string, width: number]> = [
	["M", 180],
	["L", 500],
];

function openLibrary(url: string): Cut[] | undefined {
	const match = /^(https:\/\/covers\.openlibrary\.org\/[ab]\/\w+\/[^-/]+)-([SML])(\.jpg)$/.exec(url);
	const [, base = "", letter = "", ext = ""] = match ?? [];
	if (!match) return undefined;
	const most = OPENLIBRARY_CUTS.findIndex(([cut]) => cut === letter);
	// A note that asked for the small cut gets nothing larger offered.
	if (most < 0) return undefined;
	return OPENLIBRARY_CUTS.slice(0, most + 1).map(([cut, width]) => ({
		url: `${base}-${cut}${ext}`,
		width,
	}));
}

/** IGDB's cover cuts, smallest first. */
const IGDB_CUTS: Array<[name: string, width: number]> = [
	["cover_big", 264],
	["cover_big_2x", 528],
];

function igdb(url: string): Cut[] | undefined {
	const match = /^(https:\/\/images\.igdb\.com\/igdb\/image\/upload\/t_)(cover_big(?:_2x)?)(\/[^?#]+)$/.exec(
		url,
	);
	const [, base = "", size = "", file = ""] = match ?? [];
	if (!match) return undefined;
	const most = IGDB_CUTS.findIndex(([cut]) => cut === size);
	return IGDB_CUTS.slice(0, most + 1).map(([cut, width]) => ({
		url: `${base}${cut}${file}`,
		width,
	}));
}

/**
 * A `srcset` for the cover at `url`, or undefined when its host is not one
 * that serves other sizes, or only one size would be offered.
 */
export function coverSrcSet(url: string): string | undefined {
	const cuts = tmdb(url) ?? openLibrary(url) ?? igdb(url);
	if (!cuts || cuts.length < 2) return undefined;
	return cuts.map((cut) => `${cut.url} ${cut.width}w`).join(", ");
}
