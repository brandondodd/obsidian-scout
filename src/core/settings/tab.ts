import { App, Plugin, PluginSettingTab } from "obsidian";
import type { ScoutContext } from "../context";
import { backgroundSection } from "./sections/background";
import { librarySection } from "./sections/library";
import { notesSection } from "./sections/notes";
import { propertiesSection } from "./sections/properties";
import { sourcesSection } from "./sections/sources";
import { suggestionsSection } from "./sections/suggestions";
import { trackingSection } from "./sections/tracking";
import type { SectionContext, SettingsSection } from "./sections/types";

/**
 * The settings tab: one page of native setting groups, in the order somebody
 * setting Scout up would need them. Set-once configuration sits behind
 * "Manage" buttons that open subpages, so the page stays scannable.
 */
const SECTIONS: readonly SettingsSection[] = [
	sourcesSection,
	notesSection,
	librarySection,
	trackingSection,
	propertiesSection,
	suggestionsSection,
	backgroundSection,
];

export class ScoutSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private readonly scout: ScoutContext,
	) {
		super(app, plugin);
		this.icon = "clapperboard";
	}

	display(): void {
		const { containerEl } = this;
		// A redraw after a reveal/hide toggle must not throw you back to the top.
		const scroll = containerEl.scrollTop;
		containerEl.empty();
		containerEl.addClass("scout-settings");

		const ctx: SectionContext = {
			...this.scout,
			rerender: () => this.display(),
		};
		for (const section of SECTIONS) section(containerEl, ctx);

		containerEl.scrollTop = scroll;
	}
}
