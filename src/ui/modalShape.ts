import { Platform, type Modal } from "obsidian";

/**
 * Marks a modal as one of Scout's dialogs, with any classes of its own.
 *
 * On a phone it also takes Obsidian's large-dialog shape, `mod-lg`: the sheet
 * that rises to just under the status bar with its top corners rounded, which
 * is how Obsidian's own settings open. A phone's ordinary modal is sized to
 * what is in it, which put the search box in a card halfway down the screen
 * and grew it under your thumb as results arrived. Desktop dialogs keep the
 * sizes the stylesheet gives them.
 */
export function shapeScoutModal(modal: Modal, ...classes: string[]): void {
	modal.modalEl.addClass("scout-modal", ...classes);
	if (Platform.isPhone) modal.modalEl.addClass("mod-lg");
}
