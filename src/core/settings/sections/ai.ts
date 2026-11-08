import { SecretComponent, SettingGroup } from "obsidian";
import { AI_SCOPE } from "../../ai/claude";
import { toggle } from "../controls";
import type { SettingsSection } from "./types";

/** Opt-in features that call Claude. Nothing here runs until switched on. */
export const aiSection: SettingsSection = (container, ctx) => {
	const { app, settings, rerender } = ctx;
	const scope = settings.scopeFor(AI_SCOPE);
	const enabled = scope.get("enabled", false);
	const group = new SettingGroup(container).setHeading("AI");

	group.addSetting(
		toggle({
			name: "Ask your library",
			desc: "Type a question like “sci-fi I loved from the 90s” and open the library filtered to the answer. Sends the question, plus the types, statuses, genres and collection names your library uses, to Anthropic's Claude API with your own key. Never sends titles, notes, ratings or people. Off by default.",
			value: enabled,
			onChange: async (v) => {
				await scope.set("enabled", v);
				rerender();
			},
		}),
	);
	if (!enabled) return;

	group.addSetting((s) =>
		s
			.setName("Anthropic API key")
			.setDesc("From console.anthropic.com. Kept in Obsidian's secret storage, not in Scout's settings file. Questions are billed to this key.")
			.addComponent((el) =>
				new SecretComponent(app, el)
					.setValue(scope.get("apiKey", ""))
					.onChange((name) => void scope.set("apiKey", name)),
			),
	);
};
