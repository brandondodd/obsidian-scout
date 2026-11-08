/**
 * Where you are, for the things that depend on it.
 *
 * Age ratings, where something is streaming, and what it costs are all answers
 * that change at a border. One setting drives all three, pre-filled from the
 * system locale so most people never have to look at it.
 *
 * Pure: the locale is passed in, so none of this needs a browser to test.
 */

/** Used when the locale names no country at all, like a bare `en`. */
export const FALLBACK_REGION = "US";

/** The regions offered in settings. */
export const REGION_CODES: readonly string[] = [
	"AR", "AT", "AU", "BE", "BR", "CA", "CH", "CL", "CO", "CZ", "DE", "DK", "ES",
	"FI", "FR", "GB", "GR", "HK", "HU", "ID", "IE", "IL", "IN", "IT", "JP", "KR",
	"MX", "MY", "NL", "NO", "NZ", "PH", "PL", "PT", "RO", "SE", "SG", "TH", "TR",
	"TW", "UA", "US", "ZA",
];

/** `en-GB` → `GB`. Scripts and variants are skipped; no country gives the fallback. */
export function regionFromLocale(locale: string | undefined): string {
	for (const part of (locale ?? "").replace(/_/g, "-").split("-").slice(1)) {
		if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase();
	}
	return FALLBACK_REGION;
}

/** The setting if it says anything, otherwise whatever the system says. */
export function resolveRegion(
	setting: string | undefined,
	locale: string | undefined,
): string {
	const chosen = (setting ?? "").trim().toUpperCase();
	return /^[A-Z]{2}$/.test(chosen) ? chosen : regionFromLocale(locale);
}

/** `GB` → `United Kingdom`. */
export function regionName(code: string): string {
	try {
		return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
	} catch {
		return code;
	}
}

/** The short form people write in brackets: `15 (UK)`, not `15 (GB)`. */
export function regionTag(code: string): string {
	return code === "GB" ? "UK" : code;
}

/** One country's rating of one title. */
export interface RegionalRating {
	region: string;
	label: string;
}

/** The rating to show, and whether it had to come from somewhere else. */
export interface AgeRating extends RegionalRating {
	fallback: boolean;
}

/** Tried in order when your region has no rating of its own. */
const FALLBACK_ORDER: readonly string[] = ["US", "GB"];

/**
 * Your region's rating, or a labelled stand-in.
 *
 * Stand-ins are labelled because a bare `TV-MA` in a list of UK ratings reads as
 * a UK rating, and a certificate from the wrong country presented as yours is
 * worse than none.
 */
export function pickAgeRating(
	ratings: readonly RegionalRating[],
	region: string,
): AgeRating | undefined {
	const usable = ratings.filter((one) => one.label.trim().length > 0);
	const own = usable.find((one) => one.region === region);
	if (own) return { ...own, fallback: false };
	for (const code of FALLBACK_ORDER) {
		const hit = usable.find((one) => one.region === code);
		if (hit) return { ...hit, fallback: true };
	}
	const first = usable[0];
	return first ? { ...first, fallback: true } : undefined;
}

/** For the header: bare when it is yours, tagged when it is not. */
export function ageRatingBadge(rating: AgeRating): string {
	return rating.fallback
		? `${rating.label} (${regionTag(rating.region)})`
		: rating.label;
}

/** For Details, which always says whose rating it is. */
export function ageRatingFact(rating: AgeRating): string {
	return `${rating.label} (${regionTag(rating.region)})`;
}
