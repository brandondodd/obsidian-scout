import { Modal, Notice, Setting } from "obsidian";
import { askPrompt, askSchema, askVocabulary, ASK_SYSTEM, toFocus, type AskAnswer } from "../core/ai/ask";
import type { ScoutContext } from "../core/context";
import { openLibrary } from "./libraryView";

/** "Ask your library": a question in, the library filtered to the answer out. */
export class ScoutAskModal extends Modal {
	private question = "";
	private busy = false;
	private error = "";
	private closed = false;

	constructor(private readonly ctx: ScoutContext) {
		super(ctx.app);
	}

	onOpen(): void {
		this.setTitle("Ask your library");
		this.draw();
	}

	onClose(): void {
		this.closed = true;
		this.contentEl.empty();
	}

	private draw(): void {
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl)
			.setClass("scout-ask")
			.addText((t) => {
				t.setPlaceholder("Sci-fi I loved from the 90s")
					.setValue(this.question)
					.setDisabled(this.busy)
					.onChange((v) => (this.question = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.isComposing) {
						e.preventDefault();
						void this.ask();
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			})
			.addButton((b) =>
				b
					.setButtonText(this.busy ? "Asking…" : "Ask")
					.setCta()
					.setDisabled(this.busy)
					.onClick(() => void this.ask()),
			);
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: `Sends your question and your library's genre, status and collection names to ${this.ctx.assistant.provider().name}. Titles, notes and ratings stay here.`,
		});
		if (this.error) contentEl.createEl("p", { cls: "mod-warning", text: this.error });
	}

	private async ask(): Promise<void> {
		const question = this.question.trim();
		if (!question || this.busy) return;
		this.busy = true;
		this.error = "";
		this.draw();

		const { settings, library } = this.ctx;
		const config = settings.library();
		const entries = library.all();
		const vocabulary = askVocabulary(
			config,
			entries,
			settings.collections().map((c) => c.name),
		);
		try {
			const answer = await this.ctx.assistant.ask<AskAnswer>({
				system: ASK_SYSTEM,
				prompt: askPrompt(question, vocabulary, new Date()),
				schema: askSchema(vocabulary),
			});
			if (this.closed) return;
			const result = toFocus(answer, vocabulary, config, entries);
			await openLibrary(this.app, result.focus);
			const missing = result.unknown.length
				? ` Nothing in your library matches ${result.unknown.join(", ")}, so it was left out.`
				: "";
			new Notice(`${result.summary || "Filtered your library."}${missing}`, 8000);
			this.close();
		} catch (err) {
			if (this.closed) return;
			this.error = `Could not ask: ${err instanceof Error ? err.message : String(err)}`;
			this.busy = false;
			this.draw();
		}
	}
}
