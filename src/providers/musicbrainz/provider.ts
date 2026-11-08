import type { ItemExtras } from "../../core/detail/types";
import type {
	Detailable,
	Extended,
	MediaProvider,
	ProviderContext,
	RequestContext,
	Resolvable,
	Searchable,
} from "../../core/provider";
import type { SettingDescriptor } from "../../core/settings/types";
import type {
	FieldSchema,
	MediaItem,
	MediaKind,
	MediaRef,
} from "../../core/types";
import {
	toExtras,
	toItem,
	type MbRelease,
	type MbReleaseGroup,
} from "./map";

/**
 * MusicBrainz (albums), with covers from the Cover Art Archive.
 *
 * Keyless, but it has two conditions, and both are enforced here rather than
 * left to chance: a User-Agent that says who is asking, and no more than one
 * request a second. Going over gets the whole address blocked, not just slowed.
 *
 * Off until you turn it on under Sources, like any source that would otherwise
 * start receiving your searches the day it shipped.
 */

const API = "https://musicbrainz.org/ws/2";
const SITE = "https://musicbrainz.org";

/** MusicBrainz's required format: application/version ( contact ). */
export const USER_AGENT =
	"Scout-Obsidian/1.0.0 ( https://github.com/DefineDoddy/obsidian-scout )";

/** A touch over a second, so timer drift cannot make two land inside one. */
export const MIN_GAP_MS = 1100;

const DAY = 24 * 60 * 60 * 1000;

const FIELDS: FieldSchema = [
	{ name: "artist", type: "string", description: "Artist as credited" },
	{ name: "type", type: "string", description: "Album, EP, single…" },
];

export class MusicBrainzProvider
	implements MediaProvider, Searchable, Detailable, Extended, Resolvable
{
	readonly id = "musicbrainz";
	readonly name = "MusicBrainz (albums)";
	readonly kinds: readonly MediaKind[] = ["album"];
	readonly fields = FIELDS;

	/** Every request goes through this one queue, however many dialogs are open. */
	private queue: Promise<unknown> = Promise.resolve();
	private lastSent = 0;

	constructor(private readonly ctx: ProviderContext) {}

	isConfigured(): boolean {
		return true;
	}

	settingsSchema(): readonly SettingDescriptor[] {
		return [
			{
				type: "info",
				key: "attribution",
				name: "About this source",
				render: (el) => {
					el.appendText("Album data from ");
					el.createEl("a", { text: "MusicBrainz", href: SITE });
					el.appendText(
						", covers from the Cover Art Archive. Your searches and the albums you open are sent to them. Limited to one request a second, so albums can take a moment to load.",
					);
				},
			},
		];
	}

	/** One at a time, a second apart. Cached answers skip the wait entirely. */
	private get<T>(path: string, ctx: RequestContext, ttl: number): Promise<T> {
		const url = `${API}/${path}`;
		const options = {
			headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
			signal: ctx.signal,
			cacheTtlMs: ttl,
		};
		if (this.ctx.http.isCached(url, options)) {
			return this.ctx.http.getJson<T>(url, options);
		}
		const run = async (): Promise<T> => {
			const wait = this.lastSent + MIN_GAP_MS - Date.now();
			if (wait > 0) {
				await new Promise((resolve) => window.setTimeout(resolve, wait));
			}
			this.lastSent = Date.now();
			return this.ctx.http.getJson<T>(url, options);
		};
		const result = this.queue.then(run, run);
		this.queue = result.catch(() => undefined);
		return result;
	}

	async search(query: string, ctx: RequestContext): Promise<MediaItem[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];
		const lucene = `${trimmed.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ")} AND primarytype:album`;
		const raw = await this.get<{ "release-groups"?: MbReleaseGroup[] }>(
			`release-group?query=${encodeURIComponent(lucene)}&limit=20&fmt=json`,
			ctx,
			5 * 60 * 1000,
		);
		return (raw["release-groups"] ?? []).map(toItem);
	}

	private group(id: string, ctx: RequestContext): Promise<MbReleaseGroup> {
		return this.get<MbReleaseGroup>(
			`release-group/${encodeURIComponent(id)}?inc=artist-credits+genres+tags+ratings&fmt=json`,
			ctx,
			DAY,
		);
	}

	async details(ref: MediaRef, ctx: RequestContext): Promise<MediaItem> {
		return toItem(await this.group(ref.id, ctx));
	}

	async extras(ref: MediaRef, ctx: RequestContext): Promise<ItemExtras> {
		const group = await this.group(ref.id, ctx);
		const releases = await this.get<{ releases?: MbRelease[] }>(
			`release?release-group=${encodeURIComponent(ref.id)}&status=official&limit=15&inc=labels+recordings+artist-credits+url-rels+artist-rels+recording-level-rels&fmt=json`,
			ctx,
			DAY,
		);

		const artistId = group["artist-credit"]?.[0]?.artist?.id;
		let others: MbReleaseGroup[] = [];
		if (artistId) {
			try {
				const raw = await this.get<{ "release-groups"?: MbReleaseGroup[] }>(
					`release-group?artist=${encodeURIComponent(artistId)}&type=album&limit=25&fmt=json`,
					ctx,
					DAY,
				);
				others = (raw["release-groups"] ?? [])
					.filter((one) => one.id !== ref.id)
					.sort((a, b) =>
						(b["first-release-date"] ?? "").localeCompare(
							a["first-release-date"] ?? "",
						),
					)
					.slice(0, 12);
			} catch (err) {
				if (ctx.signal.aborted) throw err;
			}
		}
		return toExtras({ group, releases: releases.releases ?? [], others });
	}

	canResolve(url: string): boolean {
		return /musicbrainz\.org\/release-group\/[\da-f-]{36}/.test(url);
	}

	async resolve(url: string, ctx: RequestContext): Promise<MediaItem> {
		const match = /musicbrainz\.org\/release-group\/([\da-f-]{36})/.exec(url);
		if (!match?.[1]) throw new Error("Not a MusicBrainz album URL");
		return toItem(await this.group(match[1], ctx));
	}
}
