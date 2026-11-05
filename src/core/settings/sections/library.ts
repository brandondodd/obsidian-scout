import { SettingGroup } from "obsidian";
import { ScoutImportModal } from "../../../ui/importModal";
import { findMissingSourceIds } from "../../../ui/linkNotes";
import { dropdown, slider, text, toggle } from "../controls";
import type { SettingsSection } from "./types";

/** Which notes the library finds, and how it shows them. */
export const librarySection: SettingsSection = (container, ctx) => {
	const { settings, library, rerender } = ctx;
	const config = settings.library();

	const contents = new SettingGroup(container).setHeading("Library");

	contents.addSetting(
		dropdown<"vault" | "folders">({
			name: "Look in",
			desc: "Every note with a recognized media type, or only the folders Scout creates notes in.",
			value: config.scope,
			options: { vault: "The whole vault", folders: "Scout's folders only" },
			onChange: (v) => {
				settings.setLibrary("scope", v);
				rerender();
			},
		}),
	);
	if (config.scope === "folders") {
		contents.addSetting(
			text({
				name: "Also look in",
				desc: "Extra folders, separated by commas.",
				value: config.includeFolders,
				placeholder: "Archive/Films, Inbox",
				wide: true,
				onChange: (v) => settings.setLibrary("includeFolders", v),
			}),
		);
	}
	contents.addSetting(
		text({
			name: "Excluded folders",
			desc: "Never indexed, separated by commas. Useful for templates and archives.",
			value: config.excludeFolders,
			placeholder: "Templates, Archive",
			wide: true,
			onChange: (v) => settings.setLibrary("excludeFolders", v),
		}),
	);

	const entries = library.all();
	const unlinked = entries.filter((entry) => !entry.ref).length;
	contents.addSetting((s) => {
		s.setName("Indexed notes")
			.setDesc(
				unlinked === 0
					? `${entries.length} notes in the library.`
					: `${entries.length} notes in the library. ${unlinked} have no source id, so they match search results by title and year only.`,
			)
			.addButton((b) =>
				b.setButtonText("Rebuild").onClick(() => {
					library.rebuild();
					rerender();
				}),
			);
		// A rebuild cannot invent ids — they belong to the source — so the fix
		// is a search, offered only when there is something to fix.
		if (unlinked > 0) {
			s.addButton((b) =>
				b.setButtonText("Find missing ids").onClick(async () => {
					await findMissingSourceIds(ctx);
					rerender();
				}),
			);
		}
	});

	contents.addSetting((s) =>
		s
			.setName("Import")
			.setDesc("From Letterboxd, Goodreads, The StoryGraph, or AniList. You review everything before a note is written.")
			.addButton((b) =>
				b.setButtonText("Import…").onClick(() => new ScoutImportModal(ctx).open()),
			),
	);

	new SettingGroup(container)
		.setHeading("Library view")
		.addSetting(
			slider({
				name: "Cover size",
				desc: "Minimum width of a grid card, in pixels. A saved view can override it.",
				value: config.cardSize,
				min: 90,
				max: 260,
				step: 10,
				onCommit: (v) => settings.setLibrary("cardSize", v),
			}),
		)
		.addSetting(
			toggle({
				name: "Show cover art",
				value: config.showCovers,
				onChange: (v) => settings.setLibrary("showCovers", v),
			}),
		)
		.addSetting(
			toggle({
				name: "Show ratings on cards",
				value: config.showRatings,
				onChange: (v) => settings.setLibrary("showRatings", v),
			}),
		)
		.addSetting(
			toggle({
				name: "Show status on cards",
				value: config.showStatus,
				onChange: (v) => settings.setLibrary("showStatus", v),
			}),
		)
		.addSetting(
			toggle({
				name: "Show summary bar",
				desc: "Counts and average rating above the list.",
				value: config.showStats,
				onChange: (v) => settings.setLibrary("showStats", v),
			}),
		)
		.addSetting(
			dropdown<"detail" | "note">({
				name: "Clicking an item",
				desc: "Ctrl or Cmd click always opens the note.",
				value: config.openDetailOnClick ? "detail" : "note",
				options: { detail: "Show details", note: "Open the note" },
				onChange: (v) => settings.setLibrary("openDetailOnClick", v === "detail"),
			}),
		)
		.addSetting(
			toggle({
				name: "Open notes in a new tab",
				value: config.openInNewTab,
				onChange: (v) => settings.setLibrary("openInNewTab", v),
			}),
		)
		.addSetting(
			toggle({
				name: "Confirm before deleting",
				value: config.confirmDelete,
				onChange: (v) => settings.setLibrary("confirmDelete", v),
			}),
		);
};
