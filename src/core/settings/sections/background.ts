import { SettingGroup } from "obsidian";
import { refreshLibrary } from "../../../ui/refreshNotes";
import { slider, toggle } from "../controls";
import type { SettingsSection } from "./types";

/** Keeping source-owned facts in your notes current. */
export const backgroundSection: SettingsSection = (container, ctx) => {
	const { settings, refresher, rerender } = ctx;
	const config = settings.library();
	const group = new SettingGroup(container).setHeading("Keeping notes up to date");

	group.addSetting(
		toggle({
			name: "Refresh in the background",
			desc: "Updates facts the source owns, like scores, dates, and seasons. Sends only source ids already in your notes, and never touches your ratings, statuses, or thoughts.",
			value: config.autoRefresh,
			onChange: (v) => {
				settings.setLibrary("autoRefresh", v);
				rerender();
			},
		}),
	);
	if (config.autoRefresh) {
		group.addSetting(
			slider({
				name: "Notes per run",
				desc: "One request each. Runs after startup and every six hours.",
				value: config.refreshBudget,
				min: 5,
				max: 100,
				step: 5,
				onCommit: (v) => settings.setLibrary("refreshBudget", v),
			}),
		);
	}

	const due = refresher.dueCount();
	const linked = refresher.eligibleCount();
	group.addSetting((s) =>
		s
			.setName("Refresh now")
			.setDesc(
				linked === 0
					? "No note records its source yet, so there is nothing to ask about."
					: due === 0
						? `Nothing is due. All ${linked} linked notes were checked recently.`
						: `${due} of ${linked} linked notes are due a check.`,
			)
			.addButton((b) =>
				b
					.setButtonText("Refresh due")
					.setDisabled(due === 0)
					.onClick(async () => {
						await refreshLibrary(ctx);
						rerender();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText("Refresh all")
					.setWarning()
					.setDisabled(linked === 0)
					.onClick(async () => {
						await refreshLibrary(ctx, { all: true });
						rerender();
					}),
			),
	);
};
