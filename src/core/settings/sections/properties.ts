import { Setting, SettingGroup } from "obsidian";
import {
	DEFAULT_FIELD_MAP,
	FIELD_INFO,
	type CustomField,
	type CustomFieldType,
	type FieldKey,
} from "../../library/config";
import { ALL_MEDIA_KINDS, MEDIA_KIND_LABELS, type MediaKind } from "../../types";
import { dropdown, manage, text } from "../controls";
import { openSubpage } from "../subpage";
import { kindsInUse } from "./kinds";
import type { SectionContext, SettingsSection } from "./types";

/**
 * The vocabulary: which frontmatter properties mean what, which values name a
 * media type, and any extra fields. Set once and left alone, so each lives on
 * its own subpage.
 */
export const propertiesSection: SettingsSection = (container, ctx) => {
	const { settings } = ctx;
	const config = settings.library();
	const renamed = (Object.keys(DEFAULT_FIELD_MAP) as FieldKey[]).filter(
		(k) => config.fields[k] !== DEFAULT_FIELD_MAP[k],
	).length;
	const custom = config.customFields.length;

	new SettingGroup(container)
		.setHeading("Properties")
		.addSetting(
			manage({
				name: "Property names",
				desc:
					renamed === 0
						? "Scout uses its default frontmatter names, plus the obvious alternatives."
						: `${renamed} renamed to match your notes.`,
				onClick: () => openFieldMap(ctx),
			}),
		)
		.addSetting(
			manage({
				name: "Media type values",
				desc: `Values of the "${config.fields.kind}" property that put a note on each shelf.`,
				onClick: () => openKindAliases(ctx),
			}),
		)
		.addSetting(
			manage({
				name: "Custom fields",
				desc:
					custom === 0
						? "Track anything else, like rewatch count or who recommended it."
						: `${custom} custom field${custom === 1 ? "" : "s"}.`,
				onClick: () => openCustomFields(ctx),
			}),
		);
};

/* ------------------------------------------------------------- field names */

function openFieldMap(ctx: SectionContext): void {
	const { app, settings, rerender } = ctx;
	openSubpage(app, {
		title: "Property names",
		intro: "Point Scout at the property names your notes already use. It also accepts the obvious alternatives — poster for cover, overview for description — so most vaults need no changes.",
		render: (el) => {
			const config = settings.library();
			for (const key of Object.keys(DEFAULT_FIELD_MAP) as FieldKey[]) {
				const info = FIELD_INFO[key];
				text({
					name: info.name,
					desc: info.writes ? `${info.desc} Scout writes this one.` : info.desc,
					value: config.fields[key],
					placeholder: DEFAULT_FIELD_MAP[key],
					onChange: (v) =>
						settings.setLibraryEntry("fields", key, v.trim() || DEFAULT_FIELD_MAP[key]),
				})(new Setting(el));
			}
			text({
				name: "Progress totals",
				desc: "Properties to read a total from for the progress bar, in order of preference.",
				value: config.progressTotalFields,
				placeholder: "number_of_episodes, pages",
				wide: true,
				onChange: (v) => settings.setLibrary("progressTotalFields", v),
			})(new Setting(el));
		},
		onClose: rerender,
	});
}

/* ----------------------------------------------------------- kind aliases */

function openKindAliases(ctx: SectionContext): void {
	const { app, settings } = ctx;
	openSubpage(app, {
		title: "Media type values",
		intro: `Values of the "${settings.library().fields.kind}" property that put a note on each shelf, separated by commas. The type's own name always counts.`,
		render: (el) => {
			const config = settings.library();
			for (const kind of kindsInUse(ctx)) {
				text({
					name: MEDIA_KIND_LABELS[kind],
					value: config.kindAliases[kind],
					wide: true,
					onChange: (v) => settings.setLibraryEntry("kindAliases", kind, v),
				})(new Setting(el));
			}
		},
	});
}

/* ---------------------------------------------------------- custom fields */

const TYPE_LABELS: Record<CustomFieldType, string> = {
	text: "Text",
	number: "Number",
	date: "Date",
	checkbox: "Yes / no",
	select: "Choice",
};

function newField(): CustomField {
	return {
		id: `f${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
		key: "",
		label: "",
		type: "text",
		options: "",
		kinds: [],
	};
}

function openCustomFields(ctx: SectionContext): void {
	const { app, settings, rerender } = ctx;
	openSubpage(app, {
		title: "Custom fields",
		intro: "Each field appears in the manage panel and is written to the note's frontmatter.",
		render: (el, redraw) => {
			/**
			 * Replaces one field and saves, reading the list fresh each time — a
			 * captured list goes stale the moment any control writes, and editing
			 * two fields in a row would otherwise undo the first edit.
			 */
			const update = (id: string, patch: Partial<CustomField>) =>
				settings.setLibrary(
					"customFields",
					settings.library().customFields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
				);

			for (const field of settings.library().customFields) {
				const group = new SettingGroup(el)
					.setHeading(field.label || field.key || "New field")
					.addExtraButton((b) =>
						b
							.setIcon("trash-2")
							.setTooltip("Remove field")
							.onClick(() => {
								settings.setLibrary(
									"customFields",
									settings.library().customFields.filter((f) => f.id !== field.id),
								);
								redraw();
							}),
					)
					.addSetting(
						text({
							name: "Label",
							desc: "Shown next to the control.",
							value: field.label,
							placeholder: "Rewatch count",
							onChange: (v) => update(field.id, { label: v }),
						}),
					)
					.addSetting(
						text({
							name: "Property",
							desc: "The frontmatter key it is stored under.",
							value: field.key,
							placeholder: "rewatches",
							onChange: (v) => update(field.id, { key: v.trim() }),
						}),
					)
					.addSetting(
						dropdown<CustomFieldType>({
							name: "Type",
							value: field.type,
							options: TYPE_LABELS,
							onChange: (v) => {
								update(field.id, { type: v });
								redraw();
							},
						}),
					);

				if (field.type === "select") {
					group.addSetting(
						text({
							name: "Choices",
							desc: "Separated by commas.",
							value: field.options,
							placeholder: "Cinema, Streaming, Disc",
							onChange: (v) => update(field.id, { options: v }),
						}),
					);
				}

				group.addSetting((s) => {
					s.setName("Applies to").setDesc("Leave all unticked to use it for every media type.");
					const checks = s.settingEl.createDiv({ cls: "scout-kind-checks" });
					for (const kind of ALL_MEDIA_KINDS) {
						const label = checks.createEl("label");
						const input = label.createEl("input", { type: "checkbox" });
						input.checked = field.kinds.includes(kind);
						label.appendText(MEDIA_KIND_LABELS[kind]);
						input.onchange = () => {
							const current =
								settings.library().customFields.find((f) => f.id === field.id)?.kinds ?? [];
							const next: MediaKind[] = input.checked
								? [...current, kind]
								: current.filter((k) => k !== kind);
							update(field.id, { kinds: next });
						};
					}
				});
			}

			new Setting(el).addButton((b) =>
				b
					.setButtonText("Add field")
					.setCta()
					.onClick(() => {
						settings.setLibrary("customFields", [...settings.library().customFields, newField()]);
						redraw();
					}),
			);
		},
		onClose: rerender,
	});
}
