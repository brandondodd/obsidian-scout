import { Platform } from "obsidian";
import type { LibraryEntry } from "../library/entry";
import type { LibraryIndex } from "../library/indexer";
import type { LibraryMutator, NoteRef } from "../library/mutate";
import type { ScoutSettings } from "../settings/store";
import type { MediaItem } from "../types";
import { AI_SCOPE, type Assistant } from "./assistant";
import {
	BATCH_SIZE,
	RUN_CAP,
	chunk,
	needsTags,
	readTags,
	tagInputOf,
	tagInputOfItem,
	tagRequest,
	tagValues,
	taggable,
	type TagInput,
	type TitleTags,
} from "./tagger";

/**
 * Running tagging against the vault: a whole library on request, one note on
 * request, and each new addition as it is made.
 *
 * Nothing here starts by itself except tag-on-add, and that only when the
 * person has allowed their library to be shared and left "Tag new additions"
 * on. Every write goes through `fillEmpty`, so a mood typed by hand is never
 * replaced — re-running simply carries on where the last run stopped.
 */

export interface TagRun {
	total: number;
	done: number;
	tagged: number;
	failed: number;
	/** Set once it has finished, been stopped, or given up. */
	finished: boolean;
	stopped: boolean;
	error: string | null;
}

/** Two failed calls in a row is a service saying no, not a bad batch. */
const GIVE_UP_AFTER = 2;
/** How long new additions wait, so an import's two hundred notes share a few calls. */
const ADD_DELAY_MS = 2500;

export class LibraryTagger {
	private run: TagRun | null = null;
	private controller: AbortController | null = null;
	private readonly listeners = new Set<() => void>();
	private queue: { item: MediaItem; note: NoteRef }[] = [];
	private timer: number | null = null;

	constructor(
		private readonly settings: ScoutSettings,
		private readonly library: LibraryIndex,
		private readonly mutator: LibraryMutator,
		private readonly assistant: Assistant,
		/** After a whole-library run completes: write threads from the new tags. */
		private readonly afterRun: () => Promise<void>,
	) {}

	private get scope() {
		return this.settings.scopeFor(AI_SCOPE);
	}

	/** The run in progress or last finished, for a settings row to show. */
	state(): Readonly<TagRun> | null {
		return this.run;
	}

	busy(): boolean {
		return this.run !== null && !this.run.finished;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	/** Whether a whole-library run may start on this device. */
	canRunBatch(): boolean {
		return Platform.isDesktopApp && this.assistant.canShare();
	}

	untagged(): LibraryEntry[] {
		return this.library.all().filter(needsTags);
	}

	/** "Tag new additions": on once a whole run has finished, unless set. */
	tagsNew(): boolean {
		return this.scope.get<boolean>("tagNew", this.scope.get("batchCompleted", false));
	}

	/* ------------------------------------------------------------ the batch */

	/** Tags every note with an empty mood or theme, up to the cap. */
	async tagLibrary(): Promise<void> {
		if (this.busy() || !this.canRunBatch()) return;
		await this.runBatch(this.untagged().slice(0, RUN_CAP));
	}

	private async runBatch(todo: readonly LibraryEntry[]): Promise<void> {
		const controller = new AbortController();
		this.controller = controller;
		const run: TagRun = {
			total: todo.length,
			done: 0,
			tagged: 0,
			failed: 0,
			finished: false,
			stopped: false,
			error: null,
		};
		this.run = run;
		this.emit();

		let failures = 0;
		for (const batch of chunk(todo, BATCH_SIZE)) {
			if (controller.signal.aborted) break;
			try {
				run.tagged += await this.tagEntries(batch, controller.signal);
				failures = 0;
			} catch (err) {
				if (controller.signal.aborted) break;
				run.failed += batch.length;
				run.error = message(err);
				failures += 1;
				if (failures >= GIVE_UP_AFTER) break;
			}
			run.done += batch.length;
			this.emit();
		}

		run.stopped = controller.signal.aborted;
		run.finished = true;
		this.controller = null;
		const complete = !run.stopped && run.failed === 0 && run.total > 0;
		if (complete) {
			await this.scope.set("batchCompleted", true);
			try {
				await this.afterRun();
			} catch (err) {
				run.error = `Tagged, but could not write threads: ${message(err)}`;
			}
		}
		this.emit();
	}

	stop(): void {
		this.controller?.abort();
	}

	/**
	 * Empties every note's moods and themes, then tags the library again.
	 *
	 * Cleared first rather than overwritten in place, so a run stopped halfway
	 * leaves notes empty — which the next "Tag your library" fills — rather than
	 * half the library on one description and half on another with no way of
	 * telling which.
	 */
	async retagAll(): Promise<void> {
		if (this.busy() || !this.canRunBatch()) return;
		const fields = this.settings.library().fields;
		const todo = this.library.all().filter((entry) => taggable(entry.kind)).slice(0, RUN_CAP);
		for (const entry of todo) {
			if (entry.moods.length === 0 && entry.themes.length === 0) continue;
			await this.mutator.patch(entry, { [fields.moods]: null, [fields.themes]: null }, true);
		}
		await this.runBatch(todo);
	}

	/* -------------------------------------------------------------- one note */

	/** Clears one note's moods and themes and fills them again. */
	async retag(entry: LibraryEntry): Promise<void> {
		if (!this.assistant.canShare()) return;
		const tags = await this.ask([tagInputOf(entry, "1")]);
		const found = tags.get("1");
		if (!found) throw new Error("The model had nothing to say about it.");
		const fields = this.settings.library().fields;
		await this.mutator.patch(entry, { [fields.moods]: null, [fields.themes]: null }, true);
		await this.mutator.fillEmpty(entry, tagValues(null, found, fields));
	}

	/* ------------------------------------------------------------ new notes */

	/**
	 * A note Scout has just made. Queued briefly and sent with any others made
	 * in the same moment; never awaited by the creation itself.
	 */
	noteCreated(item: MediaItem, note: NoteRef): void {
		if (!taggable(item.ref.kind) || !this.tagsNew() || !this.assistant.canShare()) return;
		this.queue.push({ item, note });
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.flushNew();
		}, ADD_DELAY_MS);
	}

	private async flushNew(): Promise<void> {
		const pending = this.queue;
		this.queue = [];
		for (const batch of chunk(pending, BATCH_SIZE)) {
			try {
				const inputs = batch.map((one, at) => tagInputOfItem(one.item, String(at + 1)));
				const tags = await this.ask(inputs);
				const fields = this.settings.library().fields;
				for (const [at, one] of batch.entries()) {
					const found = tags.get(String(at + 1));
					if (found) await this.mutator.fillEmpty(one.note, tagValues(null, found, fields));
				}
			} catch (err) {
				// Quiet on purpose: the note was made, which is what was asked.
				// It stays untagged for the next library run to pick up.
				console.warn("Scout: could not tag new additions", err);
			}
		}
	}

	dispose(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.queue = [];
		this.controller?.abort();
		this.listeners.clear();
	}

	/* ------------------------------------------------------------- helpers */

	/** Tags one batch of library notes and writes what came back. */
	private async tagEntries(batch: readonly LibraryEntry[], signal: AbortSignal): Promise<number> {
		const inputs = batch.map((entry, at) => tagInputOf(entry, String(at + 1)));
		const tags = await this.ask(inputs, signal);
		const fields = this.settings.library().fields;
		let tagged = 0;
		for (const [at, entry] of batch.entries()) {
			if (signal.aborted) break;
			const found = tags.get(String(at + 1));
			if (!found) continue;
			try {
				// Against nothing rather than the entry: the entry may be from
				// before a "Retag all" emptied it, and `fillEmpty` checks the
				// note itself at the moment of writing anyway.
				const written = await this.mutator.fillEmpty(entry, tagValues(null, found, fields));
				if (written.length > 0) tagged += 1;
			} catch (err) {
				console.warn(`Scout: could not write tags to ${entry.path}`, err);
			}
		}
		return tagged;
	}

	private async ask(inputs: readonly TagInput[], signal?: AbortSignal): Promise<Map<string, TitleTags>> {
		const answer = await this.assistant.ask<unknown>(tagRequest(inputs), { tier: "fast", signal });
		return readTags(answer, inputs.map((one) => one.id));
	}
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
