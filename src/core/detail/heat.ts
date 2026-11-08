/**
 * The ratings grid's shading.
 *
 * Five shades of one hue, chosen by rank within this show rather than by the
 * score itself. A show whose episodes all land between 7.8 and 8.8 would come
 * out as one flat colour on any fixed scale, when the thing the grid is for is
 * telling those episodes apart. Binning the distinct scores spreads them across
 * the whole ramp, and equal scores always share a shade.
 *
 * Pure.
 */

/** Background and text colour for each shade, darkest first. */
export const HEAT_RAMP: readonly (readonly [string, string])[] = [
	["oklch(.31 .045 250)", "#c9d3dc"],
	["oklch(.41 .075 247)", "#ffffff"],
	["oklch(.52 .105 243)", "#ffffff"],
	["oklch(.65 .115 237)", "#0e1a24"],
	["oklch(.79 .095 224)", "#0e1a24"],
];

/** A function from score to shade index, ranked across these scores. */
export function heatBins(scores: readonly number[]): (score: number) => number {
	const unique = [...new Set(scores)].sort((a, b) => a - b);
	const top = HEAT_RAMP.length - 1;
	return (score) => {
		// One distinct score says nothing about better or worse, so it takes the
		// middle of the ramp rather than either end.
		if (unique.length < 2) return Math.floor(top / 2);
		const rank = unique.indexOf(score);
		return Math.min(top, Math.floor((rank / (unique.length - 1)) * 4.999));
	};
}

/** The average of the scores present, or undefined when there are none. */
export function average(scores: readonly number[]): number | undefined {
	if (scores.length === 0) return undefined;
	return scores.reduce((sum, one) => sum + one, 0) / scores.length;
}

/** Height in pixels of one bar in the strip, for a score out of ten. */
export function barHeight(score: number): number {
	return Math.max(8, Math.round(((score - 4) / 6) * 54));
}
