import { Setting, SettingGroup } from "obsidian";
import type { CollisionPolicy } from "../../noteWriter";
import { MEDIA_KIND_LABELS, type MediaKind } from "../../types";
import { dropdown, manage, path, toggle } from "../controls";
import type { ResultAction } from "../store";
import { openSubpage } from "../subpage";
import { enabledSourceKinds } from "./kinds";
import { renderPlaceholders } from "./templates";
import type { SectionContext, SettingsSection } from "./types";

/** How a note gets made, and where each kind of note goes. */
export const notesSection: SettingsSection = (container, ctx) => {
	const { settings, app } = ctx;

	new SettingGroup(container)
		.setHeading("Creating notes")
		.addSetting(
			dropdown<ResultAction>({
				name: "Clicking a search result",
				desc: "The + button on each result always creates the note directly.",
				value: settings.core("resultAction"),
				options: { detail: "Show details", create: "Create the note" },
				onChange: (v) => settings.setCore("resultAction", v),
			}),
		)
		.addSetting(
			dropdown<CollisionPolicy>({
				name: "When a note already exists",
				desc: "A note with the same name is already in the folder.",
				value: settings.core("collisionPolicy"),
				options: {
					prompt: "Ask me",
					open: "Open the existing note",
					increment: "Create a numbered copy",
					overwrite: "Overwrite it",
				},
				onChange: (v) => settings.setCore("collisionPolicy", v),
			}),
		)
		.addSetting(
			toggle({
				name: "Open note after creating",
				value: settings.core("openAfterCreate"),
				onChange: (v) => settings.setCore("openAfterCreate", v),
			}),
		)
		.addSetting(
			toggle({
				name: "Warn about unknown template fields",
				desc: "Show a notice when a template uses a placeholder the source does not provide.",
				value: settings.core("warnOnMissingFields"),
				onChange: (v) => settings.setCore("warnOnMissingFields", v),
			}),
		);

	const locations = new SettingGroup(container).setHeading("Folders and templates");
	const kinds = enabledSourceKinds(ctx);
	if (kinds.length === 0) {
		locations.addSetting((s) =>
			s.setName("No media types yet").setDesc("Turn on a source and the media types it offers appear here."),
		);
	}
	for (const kind of kinds) {
		locations.addSetting(
			manage({
				name: MEDIA_KIND_LABELS[kind],
				desc: describeLocation(ctx, kind),
				buttonText: "Edit",
				onClick: () => openLocation(ctx, kind),
			}),
		);
	}
	locations.addSetting(
		manage({
			name: "Template placeholders",
			desc: "Fields, filters, and blocks you can use in a template file.",
			buttonText: "View",
			onClick: () =>
				openSubpage(app, {
					title: "Template placeholders",
					intro: "Frontmatter is rendered as valid YAML — values are quoted and escaped for you.",
					render: (el) => renderPlaceholders(el, ctx.registry),
				}),
		}),
	);
};

function describeLocation({ settings }: SectionContext, kind: MediaKind): string {
	const { outputFolder, templatePath } = settings.kind(kind);
	return `${outputFolder || "Vault root"} · ${templatePath || "Built-in template"}`;
}

function openLocation(ctx: SectionContext, kind: MediaKind): void {
	const { app, settings, rerender } = ctx;
	const label = MEDIA_KIND_LABELS[kind];
	openSubpage(app, {
		title: label,
		render: (el) => {
			const config = settings.kind(kind);
			path(app, {
				name: "Folder",
				desc: `Where new ${label.toLowerCase()} notes are created.`,
				placeholder: `Media/${label}`,
				value: config.outputFolder,
				type: "folder",
				onChange: (v) => settings.setKind(kind, "outputFolder", v.trim()),
			})(new Setting(el));
			path(app, {
				name: "Template",
				desc: "Leave empty to use the built-in template.",
				placeholder: `Templates/${label}.md`,
				value: config.templatePath,
				type: "file",
				extensions: ["md"],
				onChange: (v) => settings.setKind(kind, "templatePath", v.trim()),
			})(new Setting(el));
		},
		onClose: rerender,
	});
}
