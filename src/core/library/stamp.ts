import { statusTone, type LibraryConfig, type StatusTone } from "./config";
import type { LibraryEntry } from "./entry";

/**
 * Which dates a status change can honestly fill in.
 *
 * The rule: only date what the plugin saw happen. Going from "to watch" to
 * "watching" happens today, so the start date is today. Going from "watching"
 * to "watched" finishes today, so the finish date is today.
 *
 * Going straight from nothing (or "to watch") to "watched" is different. That
 * is usually you logging something you finished at some point in the past, so
 * any date would be made up. Nothing is written, and `undated` tells the caller
 * to offer "finished today" as a one-tap choice for when it really was today.
 *
 * A date already on the note is never overwritten. A missing start date is
 * never invented when something finishes either. "Finished on the 3rd, start
 * unknown" is true; "started and finished on the 3rd" usually is not.
 *
 * Pure, so the rules can be tested without a vault.
 */
export interface StatusDates {
	patch: Record<string, unknown>;
	/** Marked done without having been in progress, so no finish date was set. */
	undated: boolean;
}

/** Tones that mean you were part-way through, so finishing now is real. */
const UNDERWAY: ReadonlySet<StatusTone> = new Set(["active", "paused"]);

export function statusDates(
	config: LibraryConfig,
	entry: LibraryEntry,
	next: string | null | undefined,
	today: string,
): StatusDates {
	const patch: Record<string, unknown> = {};
	const none = { patch, undated: false };
	if (!config.autoTimestamps || !next) return none;

	const fields = config.fields;
	const from = statusTone(config, entry.status);
	const to = statusTone(config, next);

	if (to === "active") {
		if (!entry.started && (from === null || from === "planned")) {
			patch[fields.started] = today;
		}
		return none;
	}

	if (to === "done" && from !== "done" && !entry.finished) {
		if (from !== null && UNDERWAY.has(from)) {
			patch[fields.finished] = today;
			return none;
		}
		return { patch, undated: true };
	}

	return none;
}
