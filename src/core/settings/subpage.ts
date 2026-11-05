import { App, Modal } from "obsidian";

/**
 * A settings page opened from a "Manage" row.
 *
 * Set-once configuration (property names, statuses, custom fields, a source's
 * options) lives here instead of on the main page, which keeps the main page
 * short enough to scan — the same arrangement as Sync's excluded folders.
 */
export interface SubpageOptions {
	title: string;
	/** One line under the title saying what the page is for. */
	intro?: string;
	render(container: HTMLElement, rerender: () => void): void;
	/** Usually the settings tab's rerender, so the row's summary catches up. */
	onClose?: () => void;
}

class SettingsSubpage extends Modal {
	constructor(
		app: App,
		private readonly options: SubpageOptions,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.modalEl.addClass("scout-settings", "scout-settings-subpage");
		this.draw();
	}

	private draw(): void {
		const { contentEl } = this;
		const scroll = this.modalEl.scrollTop;
		contentEl.empty();
		if (this.options.intro) {
			contentEl.createEl("p", {
				text: this.options.intro,
				cls: "scout-subpage-intro",
			});
		}
		this.options.render(contentEl, () => this.draw());
		this.modalEl.scrollTop = scroll;
	}

	onClose(): void {
		this.contentEl.empty();
		this.options.onClose?.();
	}
}

export function openSubpage(app: App, options: SubpageOptions): void {
	new SettingsSubpage(app, options).open();
}
