import Anthropic from "@anthropic-ai/sdk";
import type { ScoutSettings } from "../settings/store";

/**
 * The one place Scout talks to Claude.
 *
 * Off unless switched on in settings with the person's own Anthropic key, which
 * lives in Obsidian's secret storage rather than in data.json.
 */

export const AI_SCOPE = "ai";
export const AI_MODEL = "claude-opus-5-5";

/** The key to ask with, or null when the feature is off or has no key. */
export function aiKey(settings: ScoutSettings): string | null {
	const scope = settings.scopeFor(AI_SCOPE);
	if (!scope.get("enabled", false)) return null;
	return scope.secret("apiKey") || null;
}

/** Asks for one JSON answer matching `schema`. */
export async function askJson<T>(
	apiKey: string,
	request: { system: string; prompt: string; schema: Record<string, unknown> },
	signal?: AbortSignal,
): Promise<T> {
	const client = new Anthropic({
		apiKey,
		// Obsidian is a browser; the key is the user's own, kept on their device.
		dangerouslyAllowBrowser: true,
		maxRetries: 1,
	});
	const message = await client.beta.messages.create(
		{
			model: AI_MODEL,
			max_tokens: 2048,
			system: request.system,
			messages: [{ role: "user", content: request.prompt }],
			output_config: {
				format: { type: "json_schema", schema: request.schema },
				effort: "low",
			},
			fallbacks: "default",
			betas: ["server-side-fallback-2026-07-01"],
		},
		{ signal },
	);
	if (message.stop_reason === "refusal") throw new Error("Claude would not answer that.");
	if (message.stop_reason === "max_tokens") throw new Error("The answer was cut short.");
	const text = message.content
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
	return JSON.parse(text) as T;
}
