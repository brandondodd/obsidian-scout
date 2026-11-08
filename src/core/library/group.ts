import { entryGenres, entryMainGenres } from "../genres/genres";
import { MEDIA_KIND_LABELS, type MediaKind } from "../types";
import {
	ratingFraction,
	statusesFor,
	statusTone,
	type LibraryConfig,
	type LibraryGroupBy,
	type StatusTone,
} from "./config";
import { exactScoutOrHypeOfEntry } from "../hype";
import type { LibraryEntry } from "./entry";
import { isReleased, TONE_LABELS } from "./rules";

/**
 * Grouping the library into shelves.
 *
 * Pure, like the filtering beside it. Groups come out in an order that suits
 * what they are — statuses in your own order, years newest first, genres
 * biggest first — with the "has none" shelf always last.
 */

export interface LibraryGroup {
	key: string;
	label: string;
	entries: LibraryEntry[];
}

interface GroupKey {
	key: string;
	label: string;
}

/** The reserved key for "this entry has nothing to group by"; always last. */
const NONE = "~none";

const lower = (value: string) => value.toLowerCase();
const compareText = (a: string, b: string) => a.localeCompare(b);

/** Progress shelves read as a queue: what you are on, what is next, what is done. */
const TONE_ORDER: readonly StatusTone[] = ["active", "planned", "paused", "done", "dropped"];

/**
 * Scout scores in bands. A typical title is 7 on Scout's scale and 8.7 is
 * top-250 territory, so the bands step by a point from "poor" to "excellent".
 */
const SOURCE_BANDS: readonly { min: number; label: string }[] = [
	{ min: 8, label: "8 and up" },
	{ min: 7, label: "7 to 8" },
	{ min: 6, label: "6 to 7" },
	{ min: 5, label: "5 to 6" },
	{ min: 0, label: "Below 5" },
];

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** Deduplicated case-insensitively, keeping the casing given. */
function fromList(values: readonly string[], empty: string): GroupKey[] {
	const seen = new Map<string, GroupKey>();
	for (const value of values) {
		const key = lower(value.trim());
		if (key && !seen.has(key)) seen.set(key, { key, label: value.trim() });
	}
	return seen.size > 0 ? [...seen.values()] : [{ key: NONE, label: empty }];
}

/**
 * Which shelves an entry belongs on.
 *
 * Usually one, but a film with four genres belongs on four of them — which is
 * the whole point of grouping by every genre, and why this returns a list.
 */
function groupKeysOf(
	entry: LibraryEntry,
	groupBy: LibraryGroupBy,
	config: LibraryConfig,
	now: Date,
): GroupKey[] {
	switch (groupBy) {
		case "kind":
			return [{ key: entry.kind, label: MEDIA_KIND_LABELS[entry.kind] }];
		case "status":
			return entry.status
				? [{ key: lower(entry.status), label: entry.status }]
				: [{ key: NONE, label: "No status" }];
		case "tone": {
			// One shelf per meaning, across kinds: "Watching" and "Reading" are
			// both in progress, which grouping by status keeps apart.
			const tone = statusTone(config, entry.status);
			return tone
				? [{ key: tone, label: TONE_LABELS[tone] }]
				: [{ key: NONE, label: "No status" }];
		}
		case "rating": {
			const fraction = ratingFraction(config, entry.kind, entry.rating);
			if (fraction === undefined) return [{ key: NONE, label: "Unrated" }];
			// Bucketed on the default scale, so mixed scales share shelves.
			const rounded = Math.floor(fraction * config.ratingScale);
			return [{ key: `r${rounded}`, label: `${rounded}+` }];
		}
		case "source": {
			// A film not out yet by its hype, the number its card shows instead,
			// rounded as shown so a 7.0 is never shelved under "6+".
			const exact = exactScoutOrHypeOfEntry(entry);
			if (exact === undefined) return [{ key: NONE, label: "No score" }];
			const score = Math.round(exact * 10) / 10;
			const band = SOURCE_BANDS.findIndex((one) => score >= one.min);
			const at = band < 0 ? SOURCE_BANDS.length - 1 : band;
			return [{ key: `s${at}`, label: SOURCE_BANDS[at]?.label ?? "" }];
		}
		case "year":
			return entry.year
				? [{ key: String(entry.year), label: String(entry.year) }]
				: [{ key: NONE, label: "No year" }];
		case "decade": {
			if (!entry.year) return [{ key: NONE, label: "No year" }];
			const decade = Math.floor(entry.year / 10) * 10;
			return [{ key: String(decade), label: `${decade}s` }];
		}
		case "release": {
			const out = isReleased(entry, now);
			if (out === undefined) return [{ key: NONE, label: "Date unknown" }];
			return [out ? { key: "out", label: "Out now" } : { key: "soon", label: "Coming soon" }];
		}
		case "added": {
			if (!entry.created) return [{ key: NONE, label: "Date unknown" }];
			const at = new Date(entry.created);
			const month = at.getMonth();
			return [
				{
					key: `${at.getFullYear()}-${String(month + 1).padStart(2, "0")}`,
					label: `${MONTHS[month]} ${at.getFullYear()}`,
				},
			];
		}
		case "finished": {
			const parsed = entry.finished ? Date.parse(entry.finished) : NaN;
			if (!Number.isFinite(parsed)) return [{ key: NONE, label: "Not finished" }];
			const year = String(new Date(parsed).getFullYear());
			return [{ key: year, label: year }];
		}
		case "genre":
			return fromList(entryGenres(entry), "No genre");
		case "genre-main": {
			// The first main genre, which sources list most-defining first — so a
			// library grouped this way has every item exactly once.
			const main = entryMainGenres(entry)[0];
			return main ? [{ key: lower(main), label: main }] : [{ key: NONE, label: "No genre" }];
		}
		case "person":
			return fromList(entry.people, "No one credited");
		case "collection":
			return fromList(entry.collections, "In no collection");
		case "favorite":
			return [
				entry.favorite
					? { key: "fav", label: "Favourites" }
					: { key: NONE, label: "Everything else" },
			];
		default:
			return [{ key: "all", label: "" }];
	}
}

/** Each status's place in your settings, across the kinds present. */
function statusOrder(entries: readonly LibraryEntry[], config: LibraryConfig): Map<string, number> {
	const order = new Map<string, number>();
	const kinds = new Set<MediaKind>();
	for (const entry of entries) kinds.add(entry.kind);
	let next = 0;
	for (const kind of kinds) {
		for (const status of statusesFor(config, kind)) {
			const key = lower(status);
			if (!order.has(key)) order.set(key, next++);
		}
	}
	return order;
}

/** Puts the groups in the order that suits what they are. */
function orderGroups(
	groups: LibraryGroup[],
	groupBy: LibraryGroupBy,
	entries: readonly LibraryEntry[],
	config: LibraryConfig,
): void {
	const byKey = (rank: (key: string) => number) =>
		groups.sort((a, b) => rank(a.key) - rank(b.key));
	switch (groupBy) {
		case "status": {
			// Your configured order, so shelves read "To watch → Watching → Watched".
			const order = statusOrder(entries, config);
			byKey((key) => order.get(key) ?? 900);
			break;
		}
		case "tone":
			byKey((key) => {
				const at = TONE_ORDER.indexOf(key as StatusTone);
				return at < 0 ? 900 : at;
			});
			break;
		case "year":
		case "decade":
		case "finished":
			byKey((key) => -Number(key || 0));
			break;
		case "rating":
			byKey((key) => -Number(key.slice(1) || -1));
			break;
		case "source":
			byKey((key) => Number(key.slice(1) || 900));
			break;
		case "release":
			// What is coming is the news; what is out is the rest of the shelf.
			byKey((key) => (key === "soon" ? 0 : 1));
			break;
		case "added":
			groups.sort((a, b) => compareText(b.key, a.key));
			break;
		case "genre":
		case "genre-main":
		case "person":
		case "collection":
			// Discovery order means nothing here, and there can be a lot of these:
			// biggest shelf first, alphabetical to break ties.
			groups.sort(
				(a, b) => b.entries.length - a.entries.length || compareText(a.label, b.label),
			);
			break;
		default:
			break;
	}
}

/**
 * Groups without re-sorting: the caller has already ordered the entries, and
 * within each group they keep that order.
 */
export function groupEntries(
	entries: readonly LibraryEntry[],
	groupBy: LibraryGroupBy,
	config: LibraryConfig,
	now: Date = new Date(),
): LibraryGroup[] {
	if (groupBy === "none") return [{ key: "all", label: "", entries: [...entries] }];

	const groups = new Map<string, LibraryGroup>();
	for (const entry of entries) {
		for (const { key, label } of groupKeysOf(entry, groupBy, config, now)) {
			const group = groups.get(key);
			if (group) group.entries.push(entry);
			else groups.set(key, { key, label, entries: [entry] });
		}
	}

	const out = [...groups.values()];
	orderGroups(out, groupBy, entries, config);
	return [...out.filter((g) => g.key !== NONE), ...out.filter((g) => g.key === NONE)];
}
