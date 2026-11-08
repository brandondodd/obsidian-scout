/**
 * The AI services Scout can ask, and how each one is spoken to.
 *
 * Almost every service now answers the OpenAI chat-completions shape, so most
 * entries are a base URL and a link to where the key comes from. Anthropic is
 * spoken to natively, and ChatGPT plan sign-in has its own route (see
 * `chatgpt.ts`) because its token only works with the Responses API.
 */

export type AiWire = "anthropic" | "chat" | "chatgpt";

export interface AiProvider {
	id: string;
	name: string;
	wire: AiWire;
	/** No trailing slash. Empty for the custom entry, which asks for one. */
	baseUrl: string;
	/** Where a key is made. Absent when no key is needed. */
	keyUrl?: string;
	/** Whether it can be used without a key — a model running on your machine. */
	keyOptional?: boolean;
	/** Whether it accepts `response_format: json_schema`; otherwise JSON mode. */
	schema: boolean;
	/** Signs in with a subscription instead of a key. Desktop only. */
	subscription?: boolean;
	desktopOnly?: boolean;
}

export const AI_PROVIDERS: readonly AiProvider[] = [
	{
		id: "chatgpt",
		name: "ChatGPT plan",
		wire: "chatgpt",
		baseUrl: "https://api.openai.com/v1",
		schema: true,
		subscription: true,
		desktopOnly: true,
	},
	{ id: "anthropic", name: "Anthropic", wire: "anthropic", baseUrl: "https://api.anthropic.com/v1", keyUrl: "https://console.anthropic.com/settings/keys", schema: true },
	{ id: "openai", name: "OpenAI", wire: "chat", baseUrl: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", schema: true },
	{ id: "openrouter", name: "OpenRouter", wire: "chat", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/settings/keys", schema: true },
	{ id: "gemini", name: "Google Gemini", wire: "chat", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", schema: true },
	{ id: "xai", name: "xAI Grok", wire: "chat", baseUrl: "https://api.x.ai/v1", keyUrl: "https://console.x.ai", schema: true },
	{ id: "meta", name: "Meta Muse", wire: "chat", baseUrl: "https://api.meta.ai/v1", keyUrl: "https://dev.meta.ai", schema: true },
	{ id: "mistral", name: "Mistral", wire: "chat", baseUrl: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys", schema: true },
	{ id: "deepseek", name: "DeepSeek", wire: "chat", baseUrl: "https://api.deepseek.com", keyUrl: "https://platform.deepseek.com/api_keys", schema: false },
	{ id: "custom", name: "Other (OpenAI-compatible)", wire: "chat", baseUrl: "", keyOptional: true, schema: true },
];

export function aiProvider(id: string): AiProvider | undefined {
	return AI_PROVIDERS.find((p) => p.id === id);
}

/** One structured question: answer with JSON matching `schema`. */
export interface AiRequest {
	system: string;
	prompt: string;
	schema: Record<string, unknown>;
}

export interface AiModel {
	id: string;
	name: string;
}
