import { Notice, Setting } from "obsidian";
import { refreshLibrary } from "../../../ui/refreshNotes";
import { addSlider, addToggle } from "../controls";
import type { SettingsSection } from "./types";

/**
 * Everything Scout does on its own, in one place.
 *
 * Both jobs contact sources without being asked each time, so they sit
 * together under one disclosure rather than on two different tabs.
 */
export const backgroundSection: SettingsSection = {
	id: "background",
	label: "Background",
	icon: "refresh-cw",
	intro:
		"Optional jobs that contact your sources on their own. They send only the source ids already in your notes, and never touch your ratings, statuses, or thoughts.",

	render(container, ctx) {
		const { settings, refresher, enricher, rerender } = ctx;
		const config = settings.library();

		/* ------------------------------------------------- refreshing notes */

		new Setting(container).setName("Keep notes up to date").setHeading();

		addToggle(container, {
			name: "Refresh in the background",
			desc: "Updates facts the source owns, like scores, dates, and seasons, as often as each note warrants.",
			value: config.autoRefresh,
			onChange: (v) => {
				settings.setLibrary("autoRefresh", v);
				rerender();
			},
		});

		if (config.autoRefresh) {
			addSlider(container, {
				name: "Notes per run",
				desc: "One request each. Runs after startup and every six hours.",
				value: config.refreshBudget,
				min: 5,
				max: 100,
				step: 5,
				onChange: (v) => settings.setLibrary("refreshBudget", v),
			});
		}

		const due = refresher.dueCount();
		const linked = refresher.eligibleCount();
		new Setting(container)
			.setName("Refresh now")
			.setDesc(
				linked === 0
					? "No note records its source yet, so there is nothing to ask about."
					: due === 0
						? `Nothing is due. All ${linked} linked note(s) were checked recently.`
						: `${due} of ${linked} linked note(s) are due a check.`,
			)
			.addButton((b) =>
				b
					.setButtonText("Refresh what is due")
					.setDisabled(due === 0)
					.onClick(async () => {
						await refreshLibrary(ctx);
						rerender();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText("Refresh everything")
					.setWarning()
					.setDisabled(linked === 0)
					.onClick(async () => {
						await refreshLibrary(ctx, { all: true });
						rerender();
					}),
			);

		/* ------------------------------------------------------ reading up */

		new Setting(container).setName("Read up for suggestions").setHeading();

		addToggle(container, {
			name: "Read up in the background",
			desc: "Fetches keywords, cast, and crew for your titles to sharpen suggestions. Kept in Scout's cache, never in your notes.",
			value: config.enrichSuggestions,
			onChange: (v) => {
				settings.setLibrary("enrichSuggestions", v);
				rerender();
			},
		});

		if (config.enrichSuggestions) {
			addSlider(container, {
				name: "Titles per run",
				desc: "One request each. Runs after startup and every six hours.",
				value: config.enrichBudget,
				min: 5,
				max: 40,
				step: 5,
				onChange: (v) => settings.setLibrary("enrichBudget", v),
			});
		}

		const { eligible, known, waiting } = enricher.progress();
		new Setting(container)
			.setName("What Scout has read")
			.setDesc(
				eligible === 0
					? "No note records its source yet, so there is nothing to read up on."
					: waiting === 0
						? `All ${eligible} linked note(s) have been read up on.`
						: `${known} of ${eligible} linked note(s) read up on. ${waiting} waiting.`,
			)
			.addButton((b) =>
				b
					.setButtonText("Read up now")
					.setDisabled(waiting === 0)
					.onClick(async () => {
						const report = await enricher.runDue();
						new Notice(
							report
								? `Read up on ${report.harvested} of ${report.asked}.`
								: "Already reading up.",
						);
						rerender();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText("Forget it all")
					.setWarning()
					.setDisabled(known === 0)
					.onClick(() => {
						settings.clearEnrichment();
						new Notice("Forgotten.");
						rerender();
					}),
			);
	},
};
