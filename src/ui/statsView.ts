import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScoutContext } from "../core/context";
import StatsViewComponent from "./components/StatsView";

export const STATS_VIEW_TYPE = "scout-stats";

/** The stats page, as a workspace tab. */
export class ScoutStatsView extends ItemView {
	private root: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: ScoutContext,
	) {
		super(leaf);
	}

	getViewType(): string {
		return STATS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Stats";
	}

	getIcon(): string {
		return "bar-chart-3";
	}

	protected async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("scout-stats-container");
		this.root = createRoot(container);
		this.root.render(React.createElement(StatsViewComponent, { ctx: this.ctx }));
	}

	protected async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}

export async function openStats(app: App): Promise<void> {
	const existing = app.workspace.getLeavesOfType(STATS_VIEW_TYPE);
	const leaf = existing[0] ?? app.workspace.getLeaf("tab");
	if (!existing[0]) {
		await leaf.setViewState({ type: STATS_VIEW_TYPE, active: true });
	}
	await app.workspace.revealLeaf(leaf);
}
