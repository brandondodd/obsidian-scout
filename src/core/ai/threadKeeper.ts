import type { LibraryIndex } from "../library/indexer";
import type { ScoutSettings } from "../settings/store";
import { AI_SCOPE, type Assistant } from "./assistant";
import {
	THREADS_MAX,
	THREADS_WANTED,
	lovedDigest,
	normaliseThreads,
	readThreads,
	threadRequest,
	type Thread,
} from "./threads";

/**
 * Where threads are kept, and the one call that writes them.
 *
 * In Scout's own data rather than in notes: a thread is a way of looking at
 * the library, like a saved view, and owns no titles — membership is worked
 * out from the notes each time (`threadMembers`).
 */
export class ThreadKeeper {
	private refreshing = false;
	private error: string | null = null;

	constructor(
		private readonly settings: ScoutSettings,
		private readonly library: LibraryIndex,
		private readonly assistant: Assistant,
	) {}

	private get scope() {
		return this.settings.scopeFor(AI_SCOPE);
	}

	all(): Thread[] {
		return normaliseThreads(this.scope.get<unknown>("threads", []));
	}

	/** What Home shows: pinned first, hidden left out. */
	shown(): Thread[] {
		return this.all()
			.filter((one) => !one.hidden)
			.sort((a, b) => Number(b.pinned) - Number(a.pinned));
	}

	busy(): boolean {
		return this.refreshing;
	}

	lastError(): string | null {
		return this.error;
	}

	private async save(threads: readonly Thread[]): Promise<void> {
		await this.scope.set("threads", threads.map((one) => ({ ...one })));
	}

	private async edit(id: string, change: (thread: Thread) => Thread): Promise<void> {
		await this.save(this.all().map((one) => (one.id === id ? change(one) : one)));
	}

	rename(id: string, name: string): Promise<void> {
		const clean = name.trim();
		if (!clean) return Promise.resolve();
		return this.edit(id, (one) => ({ ...one, name: clean.slice(0, 48) }));
	}

	setPinned(id: string, pinned: boolean): Promise<void> {
		return this.edit(id, (one) => ({ ...one, pinned, hidden: pinned ? false : one.hidden }));
	}

	setHidden(id: string, hidden: boolean): Promise<void> {
		return this.edit(id, (one) => ({ ...one, hidden, pinned: hidden ? false : one.pinned }));
	}

	/**
	 * Asks the main model for new threads around the pinned ones.
	 *
	 * Unpinned threads are replaced, hidden ones included — hiding one is how
	 * you say it was wrong. If the answer yields nothing usable, the old threads
	 * stay rather than leaving Home with none.
	 */
	async refresh(): Promise<void> {
		if (this.refreshing || !this.assistant.canShare()) return;
		this.refreshing = true;
		this.error = null;
		this.settings.touch();
		try {
			const config = this.settings.library();
			const entries = this.library.all();
			const kept = this.all().filter((one) => one.pinned);
			const wanted = Math.min(THREADS_WANTED, THREADS_MAX - kept.length);
			if (wanted <= 0) return;
			const digest = lovedDigest(config, entries);
			if (digest.loved < 3) {
				throw new Error("Rate or favourite a few tagged titles first.");
			}
			const answer = await this.assistant.ask<unknown>(threadRequest(digest, kept, wanted), {
				tier: "main",
			});
			const stamp = Date.now().toString(36);
			const fresh = readThreads(answer, entries, kept, wanted, (at) => `t-${stamp}-${at}`);
			if (fresh.length === 0) throw new Error("No threads came back that your library could fill.");
			await this.save([...kept, ...fresh]);
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.refreshing = false;
			this.settings.touch();
		}
	}
}
