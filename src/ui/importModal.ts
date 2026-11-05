import { Modal } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutContext } from "../core/context";
import ImportFlow from "./components/ImportFlow";

/**
 * Obsidian modal shell hosting the import flow.
 *
 * Closing it mid-run cancels whatever is running: the flow aborts on unmount,
 * and everything already written stays, so running the import again picks up
 * where it stopped.
 */
export class ScoutImportModal extends Modal {
	private root: Root | null = null;

	constructor(private readonly ctx: ScoutContext) {
		super(ctx.app);
	}

	onOpen(): void {
		this.titleEl.setText("Import library");
		this.modalEl.addClass("scout-modal", "scout-import-modal");
		this.root = createRoot(this.contentEl);
		this.root.render(
			React.createElement(ImportFlow, {
				ctx: this.ctx,
				onClose: () => this.close(),
			}),
		);
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}
