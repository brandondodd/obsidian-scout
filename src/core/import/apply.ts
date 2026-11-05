import {
	ratingScaleFor,
	statusWithTone,
	type LibraryConfig,
} from "../library/config";
import type { MediaKind } from "../types";
import type { ImportRecord } from "./types";

/**
 * The user's own data from an import, as frontmatter.
 *
 * Written through the same mapped properties the manage panel writes, so an
 * imported note is indistinguishable from one rated and shelved by hand.
 * Statuses come from the user's own vocabulary by tone, and a rating lands on
 * the scale that kind already uses — the vault's scale is never changed to
 * suit the import.
 */

/** A 0–1 rating on a kind's own scale, snapped to the configured step. */
export function scaledRating(
	config: LibraryConfig,
	kind: MediaKind,
	fraction: number,
): number {
	const scale = ratingScaleFor(config, kind);
	const step = config.ratingStep > 0 ? config.ratingStep : 1;
	const snapped = Math.round((fraction * scale) / step) * step;
	// Half a star out of five is still a rating, not "unrated".
	const bounded = Math.min(scale, Math.max(step, snapped));
	return Math.round(bounded * 100) / 100;
}

/** The property for when an item went on the list. Templates write `created`. */
export const ADDED_PROPERTY = "created";

export function importPatch(
	config: LibraryConfig,
	record: ImportRecord,
): Record<string, unknown> {
	const kind = record.item?.ref.kind ?? record.kind;
	const fields = config.fields;
	const patch: Record<string, unknown> = {};

	const status = statusWithTone(config, kind, record.tone);
	if (status) patch[fields.status] = status;
	if (record.rating !== undefined) {
		patch[fields.rating] = scaledRating(config, kind, record.rating);
	}
	if (record.started) patch[fields.started] = record.started;
	if (record.finished) patch[fields.finished] = record.finished;
	if (record.history.length > 0) patch[fields.history] = [...record.history];
	if (record.progress !== undefined) patch[fields.progress] = record.progress;
	if (record.favorite) patch[fields.favorite] = true;
	if (record.added) patch[ADDED_PROPERTY] = record.added;
	return patch;
}
