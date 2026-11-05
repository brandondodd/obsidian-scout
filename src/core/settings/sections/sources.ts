import { SettingGroup } from "obsidian";
import type { MediaProvider } from "../../provider";
import { MEDIA_KIND_LABELS } from "../../types";
import { renderDescriptor } from "../controls";
import { openSubpage } from "../subpage";
import type { SectionContext, SettingsSection } from "./types";

/**
 * One row per registered source: a toggle, and a gear that opens whatever the
 * source declares — the same shape as the community plugins list.
 */
export const sourcesSection: SettingsSection = (container, ctx) => {
	const { settings, registry, rerender } = ctx;
	const group = new SettingGroup(container).setHeading("Sources");

	for (const provider of registry.all()) {
		const enabled = settings.isProviderEnabled(provider.id);
		const kinds = provider.kinds.map((k) => MEDIA_KIND_LABELS[k]).join(", ");
		const needsSetup = enabled && !provider.isConfigured();

		group.addSetting((s) => {
			s.setName(provider.name).setDesc(
				needsSetup ? `${kinds} · Needs setting up before it can be used.` : kinds,
			);
			if (needsSetup) s.descEl.addClass("scout-setting-warning");

			if (enabled && provider.settingsSchema().length > 0) {
				s.addExtraButton((b) =>
					b
						.setIcon("settings")
						.setTooltip("Options")
						.onClick(() => openProviderOptions(ctx, provider)),
				);
			}
			s.addToggle((t) =>
				t.setValue(enabled).onChange(async (v) => {
					await settings.scopeFor(provider.id).set("enabled", v);
					rerender();
				}),
			);
		});
	}
};

function openProviderOptions(ctx: SectionContext, provider: MediaProvider): void {
	const { app, settings, rerender } = ctx;
	const scope = settings.scopeFor(provider.id);
	openSubpage(app, {
		title: provider.name,
		intro: "Contacted when you search or resolve a link, and by any background job you turn on.",
		render: (el, redraw) => {
			for (const descriptor of provider.settingsSchema()) {
				renderDescriptor(app, el, descriptor, scope, redraw);
			}
		},
		onClose: rerender,
	});
}
