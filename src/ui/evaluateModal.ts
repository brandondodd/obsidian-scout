import { Component, MarkdownRenderer, Modal, Notice, Setting, normalizePath } from "obsidian";
import type { ScoutContext } from "../core/context";
import {
	formatReport,
	heldMatcher,
	holdOut,
	pipelineCheck,
	recordingPort,
	tasteCheck,
	type PipelineCheck,
	type Recording,
	type TasteCheck,
} from "../core/library/evaluate";
import { discoverableKinds, suggestionPort } from "./suggestionPort";

const HOLD = 10;
const ROWS = 5;

/**
 * Runs the recommender checks in `evaluate.ts` against this vault.
 *
 * The suggestion check asks the sources the first time and keeps every answer
 * in `eval-recordings.json` beside the plugin, so later runs — after changing a
 * constant, say — replay offline and compare like with like.
 */
export class ScoutEvaluateModal extends Modal {
	private taste: TasteCheck | null = null;
	/** The same check with moods and themes switched off, when any note has them. */
	private tasteWithoutAi: TasteCheck | null = null;
	private pipeline: PipelineCheck | null = null;
	private note = "";
	private busy = false;
	private offline = false;
	private readonly component = new Component();

	constructor(
		private readonly ctx: ScoutContext,
		private readonly pluginDir: string,
	) {
		super(ctx.app);
	}

	onOpen(): void {
		this.component.load();
		this.setTitle("Evaluate suggestions");
		this.draw();
	}

	onClose(): void {
		this.component.unload();
		this.contentEl.empty();
	}

	private get recordingPath(): string {
		return normalizePath(`${this.pluginDir}/eval-recordings.json`);
	}

	private draw(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: "Measures how well suggestions fit your own library, so a change to the recommender can be judged by a number.",
		});

		new Setting(contentEl)
			.setName("Taste check")
			.setDesc("Hides a fifth of your rated titles at a time and checks the ones you liked score above the ones you did not. No network.")
			.addButton((b) =>
				b.setButtonText("Run").setDisabled(this.busy).onClick(() => void this.runTaste()),
			);

		new Setting(contentEl)
			.setName("Suggestion check")
			.setDesc(`Hides your ${HOLD} latest liked finishes, draws ${ROWS} rows of suggestions, and counts how many come back. Asks your sources once; answers are kept for offline re-runs.`)
			.addToggle((t) =>
				t
					.setTooltip("Use kept answers only")
					.setValue(this.offline)
					.onChange((v) => (this.offline = v)),
			)
			.addButton((b) =>
				b.setButtonText("Run").setDisabled(this.busy).onClick(() => void this.runPipeline()),
			);

		if (this.busy) contentEl.createEl("p", { text: "Working…" });
		if (this.note) contentEl.createEl("p", { cls: "setting-item-description", text: this.note });

		const report = formatReport(this.taste, this.pipeline, this.tasteWithoutAi);
		if (!report) return;
		const body = contentEl.createDiv({ cls: "scout-eval-report" });
		void MarkdownRenderer.render(this.app, report, body, "", this.component);
		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Copy report").onClick(async () => {
				await navigator.clipboard.writeText(report);
				new Notice("Report copied.");
			}),
		);
	}

	private traitOptions() {
		const manualCollections = new Set(
			this.ctx.settings
				.collections()
				.filter((one) => !one.auto)
				.map((one) => one.name.trim().toLowerCase()),
		);
		return { enrichment: this.ctx.settings.enrichment(), manualCollections };
	}

	private async runTaste(): Promise<void> {
		this.busy = true;
		this.draw();
		// Yield so "Working…" paints before the synchronous run.
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		try {
			const entries = this.ctx.library.all();
			const run = (aiTraits: boolean) =>
				tasteCheck(this.ctx.settings.library(), entries, {
					feedback: this.ctx.settings.feedback(),
					traitOptions: { ...this.traitOptions(), aiTraits },
				});
			this.taste = run(true);
			// The gate for the AI traits: what the model scores with moods and
			// themes against what it scores without them, on the same split.
			const tagged = entries.some((entry) => entry.moods.length > 0 || entry.themes.length > 0);
			this.tasteWithoutAi = tagged ? run(false) : null;
		} finally {
			this.busy = false;
			this.draw();
		}
	}

	private async readRecording(): Promise<Recording> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.recordingPath))) return {};
		try {
			return JSON.parse(await adapter.read(this.recordingPath)) as Recording;
		} catch {
			return {};
		}
	}

	private async runPipeline(): Promise<void> {
		this.busy = true;
		this.note = "";
		this.draw();
		try {
			const config = this.ctx.settings.library();
			const entries = this.ctx.library.all();
			const isHeld = heldMatcher(holdOut(config, entries, HOLD).held);
			const live = suggestionPort(
				this.ctx,
				(item) => !isHeld(item) && this.ctx.library.match(item) !== undefined,
			);
			const recording = await this.readRecording();
			const recorded = recordingPort(live, recording, this.offline ? "replay" : "record");
			this.pipeline = await pipelineCheck({
				config,
				entries,
				port: recorded.port,
				kinds: discoverableKinds(this.ctx),
				hold: HOLD,
				rows: ROWS,
				feedback: this.ctx.settings.feedback(),
				traitOptions: this.traitOptions(),
			});
			if (!this.offline) {
				await this.app.vault.adapter.write(this.recordingPath, JSON.stringify(recording));
			}
			this.note = this.offline
				? `Replayed kept answers. ${recorded.misses()} new question(s) had no kept answer.`
				: `Asked the sources ${recorded.asked()} new question(s); the rest came from kept answers.`;
		} catch (err) {
			this.note = `Could not finish: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			this.busy = false;
			this.draw();
		}
	}
}
