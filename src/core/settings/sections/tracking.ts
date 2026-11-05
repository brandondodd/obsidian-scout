import { Setting, SettingGroup } from "obsidian";
import { statusesFor, type RatingIcon } from "../../library/config";
import { MEDIA_KIND_LABELS } from "../../types";
import { dropdown, manage, text, toggle } from "../controls";
import { openSubpage } from "../subpage";
import { kindsInUse } from "./kinds";
import type { SectionContext, SettingsSection } from "./types";

const SCALE_OPTIONS: Record<string, string> = {
	"5": "Out of 5",
	"10": "Out of 10",
	"100": "Out of 100",
};

/** Ratings, statuses, and the parts of a note Scout tracks for you. */
export const trackingSection: SettingsSection = (container, ctx) => {
	const { settings } = ctx;
	const config = settings.library();

	new SettingGroup(container)
		.setHeading("Ratings and statuses")
		.addSetting(
			dropdown<string>({
				name: "Rating scale",
				desc: "How the numbers in your notes are read. Changing it never rewrites a note.",
				value: String(config.ratingScale),
				options: SCALE_OPTIONS,
				onChange: (v) => settings.setLibrary("ratingScale", Number(v)),
			}),
		)
		.addSetting(
			manage({
				name: "Scale per media type",
				desc: describeScales(ctx),
				onClick: () => openScales(ctx),
			}),
		)
		.addSetting(
			dropdown<string>({
				name: "Rating increment",
				desc: "The smallest step a rating can move, in its own scale's units.",
				value: String(config.ratingStep),
				options: { "1": "Whole only", "0.5": "Halves", "0.1": "Tenths" },
				onChange: (v) => settings.setLibrary("ratingStep", Number(v)),
			}),
		)
		.addSetting(
			dropdown<RatingIcon>({
				name: "Rating icon",
				desc: "Always five icons, so 8 out of 10 fills four.",
				value: config.ratingIcon,
				options: { star: "Stars", heart: "Hearts", circle: "Dots", number: "A number" },
				onChange: (v) => settings.setLibrary("ratingIcon", v),
			}),
		)
		.addSetting(
			manage({
				name: "Statuses",
				desc: "The shelves each media type can be on, and what each one means.",
				onClick: () => openStatuses(ctx),
			}),
		)
		.addSetting(
			toggle({
				name: "Stamp dates automatically",
				desc: "Fill in start and finish dates when a status moves to started or finished.",
				value: config.autoTimestamps,
				onChange: (v) => settings.setLibrary("autoTimestamps", v),
			}),
		)
		.addSetting(
			text({
				name: "Thoughts heading",
				desc: "The section of the note the thoughts box reads and writes. Created if missing.",
				value: config.thoughtsHeading,
				placeholder: "Thoughts",
				onChange: (v) => settings.setLibrary("thoughtsHeading", v),
			}),
		);
};

/* ------------------------------------------------------------ scales */

function describeScales(ctx: SectionContext): string {
	const scales = ctx.settings.library().ratingScales;
	const own = kindsInUse(ctx).filter((k) => scales[k] !== undefined);
	if (own.length === 0) return "Every media type uses the rating scale above.";
	return own.map((k) => `${MEDIA_KIND_LABELS[k]} out of ${scales[k]}`).join(" · ");
}

/**
 * Vaults are rarely consistent — films copied from a source are usually out of
 * ten while books are out of five — so the scale follows the notes rather than
 * converting them.
 */
function openScales(ctx: SectionContext): void {
	const { app, settings, rerender } = ctx;
	openSubpage(app, {
		title: "Scale per media type",
		intro: "Use a different scale where your notes do. Changing a scale never rewrites a note.",
		render: (el) => {
			const config = settings.library();
			for (const kind of kindsInUse(ctx)) {
				const own = config.ratingScales[kind];
				dropdown<string>({
					name: MEDIA_KIND_LABELS[kind],
					value: own === undefined ? "" : String(own),
					options: { "": `Default (out of ${config.ratingScale})`, ...SCALE_OPTIONS },
					onChange: (v) => {
						const next = { ...settings.library().ratingScales };
						if (v) next[kind] = Number(v);
						else delete next[kind];
						settings.setLibrary("ratingScales", next);
					},
				})(new Setting(el));
			}
		},
		onClose: rerender,
	});
}

/* ---------------------------------------------------------- statuses */

function openStatuses(ctx: SectionContext): void {
	const { app, settings } = ctx;
	openSubpage(app, {
		title: "Statuses",
		render: (el) => {
			const config = settings.library();

			new Setting(el)
				.setName("Shelves")
				.setDesc("In order, separated by commas.")
				.setHeading();
			for (const kind of kindsInUse(ctx)) {
				text({
					name: MEDIA_KIND_LABELS[kind],
					value: config.statuses[kind],
					placeholder: statusesFor(config, kind).join(", "),
					wide: true,
					onChange: (v) => settings.setLibraryEntry("statuses", kind, v),
				})(new Setting(el));
			}

			new Setting(el)
				.setName("What they mean")
				.setDesc("Sets each status's icon and colour, and when dates are stamped. Anything not listed counts as not started.")
				.setHeading();
			const meanings = [
				["Started", "inProgressStatuses", "Shown with a ring when the note records progress."],
				["Finished", "finishedStatuses", ""],
				["Set aside", "pausedStatuses", ""],
				["Given up on", "droppedStatuses", ""],
			] as const;
			for (const [name, key, desc] of meanings) {
				text({
					name,
					desc,
					value: config[key],
					wide: true,
					onChange: (v) => settings.setLibrary(key, v),
				})(new Setting(el));
			}
		},
	});
}
