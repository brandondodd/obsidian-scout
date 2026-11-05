import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutContext } from "../core/context";
import type { LibraryQuery } from "../core/library/filter";
import LibraryViewComponent from "./components/LibraryView";

export const LIBRARY_VIEW_TYPE = "scout-library";

/**
 * A narrowing to open the library at — what the stats page asks for when a
 * genre or a person is clicked. Applied on top of the whole library, never a
 * saved view, and never saved itself: it is a question asked once.
 */
export type LibraryFocus = Partial<
	Pick<LibraryQuery, "kinds" | "statuses" | "tags" | "text">
>;

/** Workspace view hosting the React library browser. */
export class ScoutLibraryView extends ItemView {
	private root: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: ScoutContext,
	) {
		super(leaf);
	}

	getViewType(): string {
		return LIBRARY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Library";
	}

	getIcon(): string {
		return "library-big";
	}

	private focus: { query: LibraryFocus; nonce: number } | null = null;

	protected async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("scout-library-container");

		this.root = createRoot(container);
		this.render();
	}

	/** Narrows the open library, whatever it was showing. */
	show(query: LibraryFocus): void {
		this.focus = { query, nonce: (this.focus?.nonce ?? 0) + 1 };
		this.render();
	}

	private render(): void {
		this.root?.render(
			React.createElement(LibraryViewComponent, {
				ctx: this.ctx,
				focus: this.focus,
			}),
		);
	}

	protected async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}

/** Focuses the library, reusing the open one rather than stacking duplicates. */
export async function openLibrary(app: App, focus?: LibraryFocus): Promise<void> {
	const existing = app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
	const leaf = existing[0] ?? app.workspace.getLeaf("tab");
	if (!existing[0]) {
		await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
	}
	await app.workspace.revealLeaf(leaf);
	if (focus && leaf.view instanceof ScoutLibraryView) leaf.view.show(focus);
}
