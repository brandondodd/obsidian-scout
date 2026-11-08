import { Notice, SecretComponent, SettingGroup } from "obsidian";
import { AI_SCOPE } from "../../ai/assistant";
import { MANAGE_USAGE_URL } from "../../ai/chatgpt";
import type { AiModel } from "../../ai/providers";
import { toggle } from "../controls";
import type { SettingsSection } from "./types";

/** Model lists fetched this session, so a redraw does not ask again. */
const loadedModels = new Map<string, AiModel[]>();

/** Opt-in features that call an AI model. Nothing here runs until switched on. */
export const aiSection: SettingsSection = (container, ctx) => {
	const { app, settings, assistant, rerender } = ctx;
	const scope = settings.scopeFor(AI_SCOPE);
	const enabled = assistant.enabled();
	const group = new SettingGroup(container).setHeading("AI");

	group.addSetting(
		toggle({
			name: "Ask your library",
			desc: "Type a question like “sci-fi I loved from the 90s” and open the library filtered to the answer. Sends only the question and the names of the types, statuses, genres and collections your library uses — never titles, notes, ratings or people. Off by default.",
			value: enabled,
			onChange: async (v) => {
				await scope.set("enabled", v);
				rerender();
			},
		}),
	);
	if (!enabled) return;

	const provider = assistant.provider();
	group.addSetting((s) =>
		s
			.setName("Service")
			.setDesc(
				provider.subscription
					? "Uses your ChatGPT Plus or Pro plan's allowance instead of a paid key."
					: "Questions are billed to your own key with this service.",
			)
			.addDropdown((d) => {
				for (const p of assistant.providers()) d.addOption(p.id, p.name);
				d.setValue(provider.id).onChange(async (id) => {
					await scope.set("provider", id);
					rerender();
				});
			}),
	);

	if (provider.subscription) {
		const account = assistant.chatgpt.account();
		group.addSetting((s) => {
			s.setName("ChatGPT account").setDesc(
				account ? `Using ChatGPT plan as ${account}.` : "Signs in through your browser. Scout never sees your password.",
			);
			if (!account) {
				s.addButton((b) =>
					b
						.setButtonText("Continue with ChatGPT")
						.setCta()
						.onClick(async () => {
							b.setDisabled(true).setButtonText("Waiting for browser…");
							try {
								const who = await assistant.chatgpt.signIn();
								new Notice(`Signed in as ${who}.`);
							} catch (err) {
								new Notice(err instanceof Error ? err.message : String(err), 8000);
							}
							rerender();
						}),
				);
				return;
			}
			s.addButton((b) => b.setButtonText("Manage usage").onClick(() => window.open(MANAGE_USAGE_URL)));
			s.addButton((b) =>
				b
					.setButtonText("Sign out")
					.setWarning()
					.onClick(async () => {
						const revoked = await assistant.chatgpt.signOut();
						new Notice(revoked ? "Signed out." : "Signed out here, but ChatGPT could not be told. Remove Scout in ChatGPT's settings to be sure.", 8000);
						rerender();
					}),
			);
		});
	} else {
		if (!provider.baseUrl) {
			group.addSetting((s) =>
				s
					.setName("Address")
					.setDesc("The service's OpenAI-compatible base URL — for Ollama, http://localhost:11434/v1.")
					.addText((t) =>
						t
							.setPlaceholder("http://localhost:11434/v1")
							.setValue(scope.get("customBaseUrl", ""))
							.onChange((v) => void scope.set("customBaseUrl", v.trim())),
					),
			);
		}
		group.addSetting((s) => {
			s.setName(`${provider.name} key`);
			const frag = createFragment((f) => {
				f.appendText(provider.keyOptional ? "Optional for a model on your own machine. " : "Kept in Obsidian's secret storage. ");
				if (provider.keyUrl) f.createEl("a", { text: "Get a key", href: provider.keyUrl });
			});
			s.setDesc(frag).addComponent((el) =>
				new SecretComponent(app, el)
					.setValue(scope.get(`key:${provider.id}`, ""))
					.onChange((name) => void scope.set(`key:${provider.id}`, name)),
			);
		});
	}

	const models = loadedModels.get(provider.id) ?? [];
	group.addSetting((s) => {
		s.setName("Model").setDesc(
			models.length ? `${models.length} available. Start typing to pick one.` : "Type a model id, or load the list from the service.",
		);
		s.addText((t) => {
			t.setPlaceholder("Model id")
				.setValue(assistant.model(provider))
				.onChange((v) => void scope.set(`model:${provider.id}`, v.trim()));
			if (models.length) {
				const list = t.inputEl.createEl("datalist");
				list.id = `scout-ai-models-${provider.id}`;
				for (const m of models) list.createEl("option", { value: m.id, text: m.name });
				t.inputEl.parentElement?.appendChild(list);
				t.inputEl.setAttr("list", list.id);
			}
		});
		s.addButton((b) =>
			b.setButtonText(models.length ? "Reload" : "Load models").onClick(async () => {
				b.setDisabled(true);
				try {
					loadedModels.set(provider.id, await assistant.models(provider));
				} catch (err) {
					new Notice(`Could not load models: ${err instanceof Error ? err.message : String(err)}`, 8000);
				}
				rerender();
			}),
		);
	});

	const missing = assistant.missing(provider);
	if (missing) group.addSetting((s) => s.setName("Not ready yet").setDesc(missing));
};
