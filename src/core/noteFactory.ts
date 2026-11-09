import { App, Notice, TFile, normalizePath } from "obsidian";
import { assignedPropertyType } from "./library/mutate";
import { needsTagSafeNames, tagSafeList } from "./library/tags";
import {
	NoteWriter,
	noticeForOutcome,
	type CollisionPolicy,
	type WriteOutcome,
} from "./noteWriter";
import { isDetailable, type MediaProvider } from "./provider";
import type { ProviderRegistry } from "./registry";
import type { ScoutSettings } from "./settings/store";
import { renderTemplate } from "./template/engine";
import {
	toTemplateContext,
	type MediaItem,
	type TemplateValue,
} from "./types";
import { defaultTemplateFor } from "../templates/defaults";

/**
 * How one creation departs from the user's settings.
 *
 * For a batch — an import writing two hundred notes — which must not open
 * two hundred tabs, stack two hundred notices, or stop to ask about each
 * same-named note.
 */
export interface CreateOptions {
	/** No notices; the caller reports the batch itself. */
	quiet?: boolean;
	/** Overrides "open after create". */
	open?: boolean;
	/** Overrides the collision policy. */
	policy?: Exclude<CollisionPolicy, "prompt">;
}

/**
 * Turns a chosen search result into a note.
 *
 * This is the flow that used to live inside each modal's click handler,
 * duplicated between the TV and book modals. Having it here means every
 * provider gets folder creation, collision handling, YAML-safe rendering, and
 * missing-field warnings for free.
 */
/** Told about each note a creation actually wrote. */
export type CreatedListener = (item: MediaItem, note: { path: string; title: string }) => void;

export class NoteFactory {
	private readonly writer: NoteWriter;
	private readonly created = new Set<CreatedListener>();

	constructor(
		private readonly app: App,
		private readonly settings: ScoutSettings,
		private readonly registry: ProviderRegistry,
	) {
		this.writer = new NoteWriter(app);
	}

	/**
	 * Genre names, in whatever form the property they land in will accept.
	 *
	 * The template decides which property that is — the built-in ones write
	 * `genres:`, an ordinary list, which keeps "Sci-Fi & Fantasy" as its own
	 * name. A vault that has typed that property as Tags, or a template that
	 * writes `tags:` instead, needs names Obsidian's tag grammar allows, or
	 * every genre with a space or an ampersand in it arrives struck through.
	 */
	private withTagSafeGenres(
		context: Record<string, TemplateValue>,
	): Record<string, TemplateValue> {
		const property = this.settings.library().fields.tags?.trim();
		const asTags = ["tags", "genres", property]
			.filter((name): name is string => Boolean(name))
			.some((name) =>
				needsTagSafeNames(name, (key) =>
					assignedPropertyType(this.app, key),
				),
			);
		if (!asTags) return context;

		const safe = { ...context };
		for (const key of ["tags", "genres"]) {
			const value = safe[key];
			if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
				safe[key] = tagSafeList(value as string[]);
			}
		}
		return safe;
	}

	/**
	 * Hears about every note written, however it was asked for — search,
	 * suggestions, a link, an import. Listeners must not throw or wait: the
	 * creation is already done and returns without them.
	 */
	onCreated(listener: CreatedListener): () => void {
		this.created.add(listener);
		return () => this.created.delete(listener);
	}

	/**
	 * Enriches the item via the provider's detail endpoint (when it has one),
	 * renders the template for its kind, and writes the note.
	 */
	async create(
		item: MediaItem,
		signal: AbortSignal,
		options: CreateOptions = {},
	): Promise<WriteOutcome | null> {
		const kind = item.ref.kind;
		const config = this.settings.kind(kind);
		const quiet = options.quiet === true;

		if (!config.outputFolder) {
			if (quiet) return null;
			new Notice(
				`Set an output folder for ${kind} notes in Scout's settings first.`,
			);
			return null;
		}

		const provider = this.registry.get(item.ref.providerId);
		const enriched = await this.enrich(provider, item, signal);
		const template = await this.resolveTemplate(kind, config.templatePath, quiet);

		const { content, missing } = renderTemplate(
			template,
			this.withTagSafeGenres(toTemplateContext(enriched)),
		);

		if (
			!quiet &&
			missing.length > 0 &&
			this.settings.core("warnOnMissingFields")
		) {
			new Notice(
				`Template used ${missing.length} unknown field${
					missing.length === 1 ? "" : "s"
				}: ${missing.join(", ")}`,
			);
		}

		const outcome = await this.writer.write({
			folder: config.outputFolder,
			title: enriched.title,
			content,
			policy: options.policy ?? this.settings.core("collisionPolicy"),
			openAfterCreate: options.open ?? this.settings.core("openAfterCreate"),
		});

		if (outcome && !quiet) noticeForOutcome(outcome);
		if (outcome && outcome.action !== "opened-existing") {
			const note = { path: outcome.file.path, title: enriched.title };
			for (const listener of this.created) {
				try {
					listener(enriched, note);
				} catch (err) {
					console.warn("Scout: a listener failed after creating a note", err);
				}
			}
		}
		return outcome;
	}

	/** Second-stage fetch, if the provider offers one. Failure is non-fatal. */
	private async enrich(
		provider: MediaProvider | undefined,
		item: MediaItem,
		signal: AbortSignal,
	): Promise<MediaItem> {
		if (!provider || !isDetailable(provider)) return item;
		try {
			return await provider.details(item.ref, { signal, previous: item });
		} catch (err) {
			// The search result alone is still enough to make a useful note.
			console.warn("Scout: detail fetch failed, using search result", err);
			return item;
		}
	}

	private async resolveTemplate(
		kind: MediaItem["ref"]["kind"],
		templatePath: string,
		quiet = false,
	): Promise<string> {
		if (!templatePath) return defaultTemplateFor(kind);

		const file = this.app.vault.getAbstractFileByPath(
			normalizePath(templatePath),
		);
		if (!(file instanceof TFile)) {
			if (quiet) return defaultTemplateFor(kind);
			new Notice(
				`Template "${templatePath}" not found — using the built-in template.`,
			);
			return defaultTemplateFor(kind);
		}
		return this.app.vault.cachedRead(file);
	}
}
