import { Notice, SettingGroup } from "obsidian";
import { SUGGESTION_STANDARD } from "../../library/config";
import { countVerdicts } from "../../library/feedback";
import { slider, toggle } from "../controls";
import type { SettingsSection } from "./types";

/**
 * What the number on the slider means, in the words a person would use. The
 * intuition people have is for IMDb's ten, and a catalogue's average sits
 * higher than expected, so naming the band turns a number into a decision.
 */
function standardBand(value: number): string {
	if (value < 6) return "Anything watchable — the row will turn up oddities.";
	if (value < 6.6) return "Around average and up. The widest sensible net.";
	if (value < 7.1) return "A little above average — where the row usually sits.";
	if (value < 7.6) return "Solidly liked. Mainstream hits and good genre films.";
	if (value < 8.1) return "Well reviewed only, and ordered by how well.";
	return "The acclaimed end. Classics, award winners, top-250 territory.";
}

/** How the home hub's suggestions are picked, and everything they have learned. */
export const suggestionsSection: SettingsSection = (container, ctx) => {
	const { settings, enricher, rerender } = ctx;
	const config = settings.library();
	const group = new SettingGroup(container).setHeading("Suggestions");

	group.addSetting(
		slider({
			name: "Minimum score",
			describe: (v) => `Out of ten. ${standardBand(v)}`,
			value: config.suggestionStandard,
			min: SUGGESTION_STANDARD.min,
			max: SUGGESTION_STANDARD.max,
			step: SUGGESTION_STANDARD.step,
			onCommit: (v) => settings.setLibrary("suggestionStandard", v),
		}),
	);

	group.addSetting(
		toggle({
			name: "Read up in the background",
			desc: "Fetches keywords, cast, and crew for your titles to sharpen suggestions. Sends only source ids already in your notes, and keeps the results in Scout's cache, never in your notes.",
			value: config.enrichSuggestions,
			onChange: (v) => {
				settings.setLibrary("enrichSuggestions", v);
				rerender();
			},
		}),
	);
	if (config.enrichSuggestions) {
		group.addSetting(
			slider({
				name: "Titles per run",
				desc: "One request each. Runs after startup and every six hours.",
				value: config.enrichBudget,
				min: 5,
				max: 40,
				step: 5,
				onCommit: (v) => settings.setLibrary("enrichBudget", v),
			}),
		);
	}

	const { eligible, known, waiting } = enricher.progress();
	group.addSetting((s) =>
		s
			.setName("Read up so far")
			.setDesc(
				eligible === 0
					? "No note records its source yet, so there is nothing to read up on."
					: waiting === 0
						? `All ${eligible} linked notes.`
						: `${known} of ${eligible} linked notes. ${waiting} waiting.`,
			)
			.addButton((b) =>
				b
					.setButtonText("Read up now")
					.setDisabled(waiting === 0)
					.onClick(async () => {
						const report = await enricher.runDue();
						new Notice(
							report ? `Read up on ${report.harvested} of ${report.asked}.` : "Already reading up.",
						);
						rerender();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText("Clear")
					.setWarning()
					.setDisabled(known === 0)
					.onClick(() => {
						settings.clearEnrichment();
						new Notice("Cleared what Scout has read.");
						rerender();
					}),
			),
	);

	const counts = countVerdicts(settings.feedback());
	const total = counts.liked + counts.disliked + counts.seen + counts.snoozed;
	group.addSetting((s) =>
		s
			.setName("Your verdicts")
			.setDesc(
				total === 0
					? "Nothing yet. The thumbs on each suggestion are how you correct it."
					: `${counts.liked} liked · ${counts.disliked} not for me · ${counts.seen} already seen · ${counts.snoozed} put off`,
			)
			.addButton((b) =>
				b
					.setButtonText("Clear")
					.setWarning()
					.setDisabled(total === 0)
					.onClick(() => {
						settings.clearFeedback();
						new Notice("Verdicts cleared.");
						rerender();
					}),
			),
	);

	group.addSetting((s) =>
		s
			.setName("Recently shown")
			.setDesc("Titles already suggested are held back so the row moves on. Reset to let them all come round again.")
			.addButton((b) =>
				b
					.setButtonText("Reset")
					.setDisabled(Object.keys(settings.shownLog()).length === 0)
					.onClick(() => {
						settings.clearShown();
						rerender();
					}),
			),
	);
};
