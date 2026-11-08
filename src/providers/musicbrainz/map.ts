import { canonicalGenres } from "../../core/genres/genres";
import { emptyExtras } from "../../core/detail/types";
import type {
	ItemExtras,
	ServiceTile,
	Track,
} from "../../core/detail/types";
import { longDate, oneDecimal, plural } from "../../core/format";
import type { MediaItem } from "../../core/types";

/**
 * MusicBrainz's shapes, and turning them into Scout's. Pure.
 *
 * Every field here was checked against live responses. An album is a "release
 * group": the idea of the album, holding each edition ever pressed.
 */

const SITE = "https://musicbrainz.org";
const COVERS = "https://coverartarchive.org/release-group";

interface ArtistCredit {
	name?: string;
	joinphrase?: string;
	artist?: { id?: string; name?: string };
}

interface Named {
	name?: string;
	count?: number;
}

export interface MbReleaseGroup {
	id: string;
	title?: string;
	"primary-type"?: string;
	"first-release-date"?: string;
	"artist-credit"?: ArtistCredit[];
	rating?: { value?: number | null; "votes-count"?: number };
	genres?: Named[];
	tags?: Named[];
}

interface MbRelation {
	type?: string;
	url?: { resource?: string };
	artist?: { name?: string };
	attributes?: string[];
}

interface MbTrack {
	number?: string;
	title?: string;
	length?: number | null;
	"artist-credit"?: ArtistCredit[];
	recording?: { relations?: MbRelation[] };
}

export interface MbRelease {
	id: string;
	date?: string;
	status?: string;
	media?: { format?: string; tracks?: MbTrack[] }[];
	"label-info"?: { label?: { name?: string } }[];
	relations?: MbRelation[];
}

/** The artist as credited, including the "&" and "feat." between names. */
export function creditLine(credit: ArtistCredit[] | undefined): string {
	return (credit ?? [])
		.map((one) => `${one.name ?? one.artist?.name ?? ""}${one.joinphrase ?? ""}`)
		.join("")
		.trim();
}

const topNames = (list: Named[] | undefined, most: number) =>
	[...(list ?? [])]
		.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
		.map((one) => one.name ?? "")
		.filter(Boolean)
		.slice(0, most);

/** Sentence case: MusicBrainz's genres are all lower case. */
const capital = (text: string) =>
	text.charAt(0).toUpperCase() + text.slice(1);

export function toItem(raw: MbReleaseGroup): MediaItem {
	const artist = creditLine(raw["artist-credit"]);
	const date = raw["first-release-date"] || undefined;
	const year = date ? Number.parseInt(date.slice(0, 4), 10) : undefined;
	const genres = topNames(raw.genres?.length ? raw.genres : raw.tags, 3);
	const score = raw.rating?.value;

	return {
		ref: { providerId: "musicbrainz", kind: "album", id: raw.id },
		title: raw.title ?? "Untitled",
		...(artist ? { subtitle: artist } : {}),
		...(year && Number.isFinite(year) ? { year } : {}),
		// MusicBrainz rates out of five; Scout normalizes every source to ten.
		...(typeof score === "number" && score > 0
			? { rating: Math.round(score * 20) / 10 }
			: {}),
		...(raw.rating?.["votes-count"]
			? { ratingCount: raw.rating["votes-count"] }
			: {}),
		imageUrl: `${COVERS}/${raw.id}/front-500`,
		thumbnailUrl: `${COVERS}/${raw.id}/front-250`,
		tags: canonicalGenres("album", genres),
		people: artist ? [artist] : [],
		externalUrl: `${SITE}/release-group/${raw.id}`,
		...(date ? { releaseDate: date } : {}),
		extra: {
			artist,
			type: raw["primary-type"],
		},
	};
}

/**
 * The edition to read the tracks from.
 *
 * A group can hold a dozen pressings, and the first one listed may be a four-disc
 * box. Fewest discs picks the album proper, and earliest among those picks the
 * original over a reissue with bonus tracks.
 */
export function pickRelease(
	releases: readonly MbRelease[],
): MbRelease | undefined {
	const discs = (one: MbRelease) => one.media?.length ?? 99;
	return [...releases]
		.filter((one) => (one.media ?? []).some((m) => m.tracks?.length))
		.sort(
			(a, b) =>
				discs(a) - discs(b) ||
				(a.date ?? "9999").localeCompare(b.date ?? "9999"),
		)[0];
}

function clock(ms: number | null | undefined): string | undefined {
	if (!ms || ms <= 0) return undefined;
	const seconds = Math.round(ms / 1000);
	const rest = String(seconds % 60).padStart(2, "0");
	return `${Math.floor(seconds / 60)}:${rest}`;
}

/** Numbered straight through, so a double album's side two carries on. */
export function toTracks(
	release: MbRelease,
	albumArtist: string,
): Track[] {
	const out: Track[] = [];
	for (const disc of release.media ?? []) {
		for (const track of disc.tracks ?? []) {
			const guest = creditLine(track["artist-credit"]);
			const length = clock(track.length);
			out.push({
				number: out.length + 1,
				title: track.title ?? `Track ${out.length + 1}`,
				...(length ? { length } : {}),
				...(guest && guest !== albumArtist ? { featuring: guest } : {}),
			});
		}
	}
	return out;
}

const totalMs = (release: MbRelease) =>
	(release.media ?? []).reduce(
		(sum, disc) =>
			sum +
			(disc.tracks ?? []).reduce((one, t) => one + (t.length ?? 0), 0),
		0,
	);

/** Known services, by the host MusicBrainz links them on. */
const SERVICES: readonly [RegExp, string][] = [
	[/(^|\.)music\.apple\.com$/, "Apple Music"],
	[/(^|\.)spotify\.com$/, "Spotify"],
	[/(^|\.)bandcamp\.com$/, "Bandcamp"],
	[/(^|\.)tidal\.com$/, "Tidal"],
	[/(^|\.)deezer\.com$/, "Deezer"],
	[/(^|\.)soundcloud\.com$/, "SoundCloud"],
	[/(^|\.)music\.youtube\.com$/, "YouTube Music"],
];

/** Links to where it can be heard, once per service, across every edition. */
export function toServices(releases: readonly MbRelease[]): ServiceTile[] {
	const out = new Map<string, ServiceTile>();
	for (const release of releases) {
		for (const relation of release.relations ?? []) {
			const url = relation.url?.resource;
			if (!url) continue;
			let host = "";
			try {
				host = new URL(url).hostname;
			} catch {
				continue;
			}
			const name = SERVICES.find(([pattern]) => pattern.test(host))?.[1];
			if (name && !out.has(name)) out.set(name, { name, url });
		}
	}
	return [...out.values()];
}

/** Credit types worth a line, and what to call them. */
const CREDIT_TYPES: Record<string, string> = {
	producer: "Producer",
	mix: "Mixing",
	mastering: "Mastering",
	engineer: "Engineer",
	"art direction": "Art direction",
};

const MAX_CREDITED = 3;

/**
 * Who did what, from every edition.
 *
 * Most of these credits are on the individual recordings rather than the release
 * and on some pressings rather than others, so reading only the chosen edition's
 * own relations came back empty even for a thoroughly documented album.
 */
export function toCredits(
	releases: readonly MbRelease[],
): { label: string; value: string }[] {
	const byRole = new Map<string, Set<string>>();
	const note = (relation: MbRelation) => {
		const role = CREDIT_TYPES[relation.type ?? ""];
		const name = relation.artist?.name;
		if (!role || !name) return;
		const names = byRole.get(role) ?? new Set<string>();
		names.add(name);
		byRole.set(role, names);
	};
	for (const release of releases) {
		(release.relations ?? []).forEach(note);
		for (const disc of release.media ?? []) {
			for (const track of disc.tracks ?? []) {
				(track.recording?.relations ?? []).forEach(note);
			}
		}
	}
	return Object.values(CREDIT_TYPES)
		.filter((label) => byRole.has(label))
		.map((label) => ({
			label,
			value: [...(byRole.get(label) ?? [])]
				.slice(0, MAX_CREDITED)
				.join(", "),
		}));
}

export interface AlbumParts {
	group: MbReleaseGroup;
	releases: readonly MbRelease[];
	/** Other albums by the first credited artist. */
	others: readonly MbReleaseGroup[];
}

export function toExtras(parts: AlbumParts): ItemExtras {
	const { group, releases, others } = parts;
	const artist = creditLine(group["artist-credit"]);
	const release = pickRelease(releases);
	const tracks = release ? toTracks(release, artist) : [];
	const minutes = release ? Math.round(totalMs(release) / 60000) : 0;
	const date = group["first-release-date"];
	const label = release?.["label-info"]?.[0]?.label?.name;
	const services = toServices(releases);
	const score = group.rating?.value;

	const headerFacts: string[] = [];
	if (tracks.length > 0) headerFacts.push(plural(tracks.length, "track"));
	if (minutes > 0) headerFacts.push(`${minutes} min`);

	const facts: ItemExtras["facts"] = [];
	const add = (name: string, value: string | undefined) => {
		if (value) facts.push({ label: name, value });
	};
	add("Released", date && date.length === 10 ? longDate(date) : date);
	add("Label", label && label !== "[no label]" ? label : undefined);
	add("Type", group["primary-type"]);
	add("Length", minutes > 0 ? `${minutes} min` : undefined);

	return {
		...emptyExtras(),
		shape: "square",
		headerFacts,
		scores:
			typeof score === "number" && score > 0
				? [
						{
							id: "musicbrainz",
							label: "MusicBrainz",
							value: oneDecimal(score * 2),
							outOfTen: score * 2,
							...(group.rating?.["votes-count"]
								? { votes: group.rating["votes-count"] }
								: {}),
						},
					]
				: [],
		moreLabel: "Artist & more",
		rails:
			others.length > 0 && artist
				? [
						{
							id: "by-artist",
							title: `More by ${artist}`,
							items: others.map(toItem),
							shape: "square",
						},
					]
				: [],
		facts,
		credits: toCredits(releases),
		links: [
			{
				label: "MusicBrainz",
				url: `${SITE}/release-group/${group.id}`,
			},
		],
		tracks,
		...(artist ? { byline: artist } : {}),
		...(services.length > 0
			? {
					availability: {
						title: "Where to listen",
						groups: [{ id: "listen", label: "Stream", tiles: services }],
					},
				}
			: {}),
	};
}
