import type { ScoutContext } from "../../context";

/**
 * One group of the settings page.
 *
 * The tab knows nothing but the ordered list of these, so a new group is a new
 * file plus one entry in `SECTIONS` — the same open/closed arrangement the
 * provider registry uses.
 */

/**
 * The whole plugin context, because a settings page is not only a list of
 * values: the library group also runs the same maintenance actions the command
 * palette offers, and those need the note writer as much as the index.
 */
export interface SectionContext extends ScoutContext {
	/** Redraws the whole page, for settings that reveal or hide others. */
	rerender: () => void;
}

/** Renders one or more `SettingGroup`s into the page. */
export type SettingsSection = (container: HTMLElement, ctx: SectionContext) => void;
