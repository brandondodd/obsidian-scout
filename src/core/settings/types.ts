/**
 * Declarative settings. A provider describes the settings it needs; the
 * settings tab renders them. Providers never touch the DOM, and the tab never
 * needs to know a provider exists.
 */

/**
 * A namespaced view onto the settings store. A provider is handed a scope
 * bound to its own id and cannot read or write another provider's keys.
 */
export interface SettingsScope {
	get<T>(key: string, fallback: T): T;
	set(key: string, value: unknown): Promise<void>;
	/**
	 * The value of a `secret` setting, read from Obsidian's secret storage.
	 * The setting itself only holds the secret's name. Empty when unset.
	 */
	secret(key: string): string;
}

interface BaseDescriptor {
	key: string;
	name: string;
	desc?: string;
	/** Hide this setting unless the predicate passes (e.g. a master toggle). */
	visibleWhen?: (scope: SettingsScope) => boolean;
	/** Re-render the whole tab after a change, for settings that reveal others. */
	rerenderOnChange?: boolean;
}

export type SettingDescriptor =
	| (BaseDescriptor & { type: "toggle"; default: boolean })
	| (BaseDescriptor & {
			type: "text";
			default: string;
			placeholder?: string;
	  })
	| (BaseDescriptor & {
			/**
			 * A credential, kept in Obsidian's secret storage rather than in
			 * data.json. The setting stores the secret's name; read the value
			 * with `SettingsScope.secret`.
			 */
			type: "secret";
			/** Where an older build kept the value itself, in plain text. */
			legacyKey?: string;
	  })
	| (BaseDescriptor & {
			type: "file";
			default: string;
			placeholder?: string;
			/** Restrict the picker, e.g. `["md"]`. */
			extensions?: string[];
	  })
	| (BaseDescriptor & { type: "folder"; default: string; placeholder?: string })
	| (BaseDescriptor & {
			type: "dropdown";
			default: string;
			options: Record<string, string>;
	  })
	| (BaseDescriptor & {
			type: "button";
			buttonText: string;
			onClick: (scope: SettingsScope) => void | Promise<void>;
			/** Rendered as informational text rather than a labelled control. */
			cta?: boolean;
	  })
	| (BaseDescriptor & { type: "info"; render: (el: HTMLElement) => void });

/** Pulls the defaults out of a descriptor list for store initialization. */
export function defaultsOf(
	descriptors: readonly SettingDescriptor[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const d of descriptors) {
		if ("default" in d) out[d.key] = d.default;
	}
	return out;
}
