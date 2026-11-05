import {
	App,
	FuzzySuggestModal,
	SecretComponent,
	Setting,
	TFile,
	TFolder,
} from "obsidian";
import type { SettingDescriptor, SettingsScope } from "./types";

/**
 * Reusable settings controls.
 *
 * Each helper returns a function that fills in a `Setting`, so the same helper
 * works inside a `SettingGroup` (`group.addSetting(toggle({...}))`) and on a
 * bare container in a subpage (`toggle({...})(new Setting(el))`).
 */
export type Row = (setting: Setting) => void;

/* ------------------------------------------------------------ path pickers */

class FilePickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly extensions: string[] | undefined,
		private readonly onChoose: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("Type to search for files…");
	}

	getItems(): TFile[] {
		const files = this.app.vault.getFiles();
		return this.extensions
			? files.filter((f) => this.extensions?.includes(f.extension))
			: files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private readonly onChoose: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder("Type to search for folders…");
	}

	getItems(): TFolder[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder);
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}

/**
 * Text field plus a folder/file browse button. Holds a direct reference to its
 * own input rather than looking the input up among its siblings.
 */
export function path(
	app: App,
	options: {
		name: string;
		desc?: string;
		placeholder?: string;
		value: string;
		type: "file" | "folder";
		extensions?: string[];
		onChange: (value: string) => void;
	},
): Row {
	return (setting) => {
		let inputEl: HTMLInputElement | null = null;
		setting
			.setName(options.name)
			.setDesc(options.desc ?? "")
			.addText((text) => {
				inputEl = text.inputEl;
				text.setPlaceholder(options.placeholder ?? "")
					.setValue(options.value)
					.onChange(options.onChange);
			})
			.addExtraButton((btn) =>
				btn
					.setIcon(options.type === "file" ? "file-search" : "folder-search")
					.setTooltip("Browse")
					.onClick(() => {
						const apply = (p: string) => {
							if (!inputEl) return;
							inputEl.value = p;
							options.onChange(p);
						};
						if (options.type === "file") {
							new FilePickerModal(app, options.extensions, (f) =>
								apply(f.path),
							).open();
						} else {
							new FolderPickerModal(app, (f) => apply(f.path)).open();
						}
					}),
			);
	};
}

/* ------------------------------------------------------------- shorthands */

export function text(options: {
	name: string;
	desc?: string;
	value: string;
	placeholder?: string;
	wide?: boolean;
	onChange: (value: string) => void;
}): Row {
	return (setting) =>
		setting
			.setName(options.name)
			.setDesc(options.desc ?? "")
			.addText((t) => {
				t.setPlaceholder(options.placeholder ?? "")
					.setValue(options.value)
					.onChange(options.onChange);
				if (options.wide) t.inputEl.addClass("scout-input-wide");
			});
}

export function toggle(options: {
	name: string;
	desc?: string;
	value: boolean;
	onChange: (value: boolean) => void;
}): Row {
	return (setting) =>
		setting
			.setName(options.name)
			.setDesc(options.desc ?? "")
			.addToggle((t) => t.setValue(options.value).onChange(options.onChange));
}

export function dropdown<T extends string>(options: {
	name: string;
	desc?: string;
	value: T;
	options: Record<string, string>;
	onChange: (value: T) => void;
}): Row {
	return (setting) =>
		setting
			.setName(options.name)
			.setDesc(options.desc ?? "")
			.addDropdown((d) =>
				d
					.addOptions(options.options)
					.setValue(options.value)
					.onChange((v) => options.onChange(v as T)),
			);
}

/**
 * A slider that saves once, when the handle is let go.
 *
 * Saving on every step of a drag means a write and a full notify per pixel, and
 * every listening view re-renders under the pointer. `describe`, if given,
 * rewords the description live as the handle moves, without re-rendering.
 */
export function slider(options: {
	name: string;
	desc?: string;
	describe?: (value: number) => string;
	value: number;
	min: number;
	max: number;
	step: number;
	onCommit: (value: number) => void;
}): Row {
	return (setting) => {
		const describe = options.describe;
		setting
			.setName(options.name)
			.setDesc(describe ? describe(options.value) : (options.desc ?? ""))
			.addSlider((s) => {
				s.setLimits(options.min, options.max, options.step)
					.setValue(options.value)
					.setDynamicTooltip()
					.onChange((v) => {
						if (describe) setting.setDesc(describe(v));
					});
				s.sliderEl.addEventListener("change", () =>
					options.onCommit(Number(s.sliderEl.value)),
				);
			});
	};
}

/**
 * A row that opens a subpage, the way Sync's "Excluded folders → Manage" does.
 * The description should summarise what is behind the button.
 */
export function manage(options: {
	name: string;
	desc: string;
	buttonText?: string;
	onClick: () => void;
}): Row {
	return (setting) =>
		setting
			.setName(options.name)
			.setDesc(options.desc)
			.addButton((b) =>
				b.setButtonText(options.buttonText ?? "Manage").onClick(options.onClick),
			);
}

/* ----------------------------------------------------- descriptor renderer */

/** Renders one provider-declared setting. Providers never touch the DOM. */
export function renderDescriptor(
	app: App,
	container: HTMLElement,
	descriptor: SettingDescriptor,
	scope: SettingsScope,
	rerender: () => void,
): void {
	if (descriptor.visibleWhen && !descriptor.visibleWhen(scope)) return;

	const commit = async (value: unknown) => {
		await scope.set(descriptor.key, value);
		if (descriptor.rerenderOnChange) rerender();
	};
	const setting = () =>
		new Setting(container)
			.setName(descriptor.name)
			.setDesc(descriptor.desc ?? "");

	switch (descriptor.type) {
		case "toggle":
			setting().addToggle((t) =>
				t.setValue(scope.get(descriptor.key, descriptor.default)).onChange(commit),
			);
			break;

		case "text":
			setting().addText((t) => {
				t.setPlaceholder(descriptor.placeholder ?? "")
					.setValue(scope.get(descriptor.key, descriptor.default))
					.onChange(commit);
			});
			break;

		case "secret":
			setting().addComponent((el) =>
				new SecretComponent(app, el)
					.setValue(scope.get(descriptor.key, ""))
					.onChange(commit),
			);
			break;

		case "file":
		case "folder":
			path(app, {
				name: descriptor.name,
				desc: descriptor.desc,
				placeholder: descriptor.placeholder,
				value: scope.get(descriptor.key, descriptor.default),
				type: descriptor.type,
				extensions:
					descriptor.type === "file" ? descriptor.extensions : undefined,
				onChange: commit,
			})(new Setting(container));
			break;

		case "dropdown":
			setting().addDropdown((d) =>
				d
					.addOptions(descriptor.options)
					.setValue(scope.get(descriptor.key, descriptor.default))
					.onChange(commit),
			);
			break;

		case "button":
			setting().addButton((b) => {
				b.setButtonText(descriptor.buttonText).onClick(() =>
					descriptor.onClick(scope),
				);
				if (descriptor.cta) b.setCta();
			});
			break;

		case "info": {
			const el = container.createDiv({ cls: "scout-setting-info" });
			descriptor.render(el);
			break;
		}
	}
}
