import { Notice, Setting } from "obsidian";
import { SUGGESTION_STANDARD } from "../../library/config";
import { countVerdicts } from "../../library/feedback";
import { addSlider } from "../controls";
import type { SettingsSection } from "./types";

/**
 * What the number on the slider means, in the words a person would use.
 *
 * A rating out of ten is the one unit everybody already has an intuition for,
 * so the control is set in source points rather than in five nameless notches
 * — but the intuition is for *IMDb's* ten, and a catalogue's average sits
 * higher than people expect. Saying which band the handle is currently in is
 * the difference between a number and a decision.
 */
function standardBand(value: number): string {
	if (value < 6) return "Anything watchable — the row will turn up oddities.";
	if (value < 6.6) return "Around average and up. The widest sensible net.";
	if (value < 7.1) return "A little above average — where the row usually sits.";
	if (value < 7.6) return "Solidly liked. Mainstream hits and good genre films.";
	if (value < 8.1) return "Well reviewed only, and ordered by how well.";
	return "The acclaimed end. Classics, award winners, top-250 territory.";
}

/**
 * What Scout has learned, and how much it is allowed to go and learn.
 *
 * Its own page rather than three more rows on the Library tab, which is
 * already the longest one. It is also the only place any of this is
 * inspectable: the feedback log has been collectable since it was written and
 * there has never been a way to see how much of it there is, let alone clear
 * it.
 */
export const suggestionsSection: SettingsSection = {
	id: "suggestions",
	label: "Suggestions",
	icon: "wand-sparkles",
	intro:
		"How the row on the home hub picks what to show you. Background reading-up lives under Background.",

	render(container, ctx) {
		const { settings, rerender } = ctx;
		const config = settings.library();

		new Setting(container).setName("How picky to be").setHeading();

		container.createEl("p", {
			cls: "scout-tab-intro",
			text:
				"The minimum source score out of ten. If too little clears it, the row fills from the best of the rest.",
		});

		const standard = addSlider(container, {
			name: "Standard for suggestions",
			desc: standardBand(config.suggestionStandard),
			value: config.suggestionStandard,
			min: SUGGESTION_STANDARD.min,
			max: SUGGESTION_STANDARD.max,
			step: SUGGESTION_STANDARD.step,
			// Reworded in place rather than by re-rendering the tab, which would
			// tear the slider out from under the pointer mid-drag.
			onChange: (v) => standard.setDesc(standardBand(v)),
			onCommit: (v) => settings.setLibrary("suggestionStandard", v),
		});

		new Setting(container).setName("What you have told it").setHeading();

		const counts = countVerdicts(settings.feedback());
		const total = counts.liked + counts.disliked + counts.seen + counts.snoozed;
		new Setting(container)
			.setName("Your verdicts")
			.setDesc(
				total === 0
					? "Nothing yet. The thumbs on each suggestion are how you correct it."
					: `${counts.liked} liked · ${counts.disliked} not for me · ${counts.seen} already seen · ${counts.snoozed} put off`,
			)
			.addButton((b) =>
				b
					.setButtonText("Clear verdicts")
					.setWarning()
					.setDisabled(total === 0)
					.onClick(() => {
						settings.clearFeedback();
						new Notice("Verdicts cleared.");
						rerender();
					}),
			);

		new Setting(container)
			.setName("What it has already shown you")
			.setDesc(
				"Recently suggested titles are held back so the row moves on. Clearing this lets them all come round again.",
			)
			.addButton((b) =>
				b
					.setButtonText("Show everything again")
					.setDisabled(Object.keys(settings.shownLog()).length === 0)
					.onClick(() => {
						settings.clearShown();
						rerender();
					}),
			);
	},
};
