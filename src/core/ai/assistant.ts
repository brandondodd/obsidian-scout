import { Platform, type SecretStorage } from "obsidian";
import { HttpError, type HttpClient } from "../http";
import type { ScoutSettings } from "../settings/store";
import { ChatGptSession } from "./chatgpt";
import { ClaudeCode } from "./claudeCode";
import { AI_PROVIDERS, aiProvider, type AiModel, type AiProvider, type AiRequest } from "./providers";
import { anthropicBody, anthropicText, chatBody, chatText, modelList, parseAnswer } from "./wire";

export const AI_SCOPE = "ai";
const ANTHROPIC_VERSION = "2026-10-21";

/**
 * The one place Scout talks to an AI model.
 *
 * Nothing here runs until the person turns it on and picks a service: their own
 * key for most, or their ChatGPT plan. Keys live in Obsidian's secret storage;
 * the settings only record which secret holds each one.
 */
export class Assistant {
	readonly chatgpt: ChatGptSession;
	readonly claudeCode: ClaudeCode;

	constructor(
		private readonly http: HttpClient,
		private readonly settings: ScoutSettings,
		secrets: SecretStorage | undefined,
	) {
		this.chatgpt = new ChatGptSession(http, settings.scopeFor(AI_SCOPE), secrets);
		this.claudeCode = new ClaudeCode(settings.scopeFor(AI_SCOPE));
	}

	private get scope() {
		return this.settings.scopeFor(AI_SCOPE);
	}

	enabled(): boolean {
		return this.scope.get("enabled", false);
	}

	/** Services this device can use. A plan sign-in needs a desktop. */
	providers(): AiProvider[] {
		return AI_PROVIDERS.filter((p) => !p.desktopOnly || Platform.isDesktopApp);
	}

	provider(): AiProvider {
		const chosen = aiProvider(this.scope.get("provider", ""));
		return chosen && this.providers().includes(chosen) ? chosen : this.providers()[0]!;
	}

	model(provider = this.provider()): string {
		return this.scope.get<string>(`model:${provider.id}`, "").trim();
	}

	key(provider = this.provider()): string {
		return this.scope.secret(`key:${provider.id}`).trim();
	}

	baseUrl(provider = this.provider()): string {
		const url = provider.baseUrl || this.scope.get<string>("customBaseUrl", "");
		return url.trim().replace(/\/+$/, "");
	}

	/** What is still missing before a question can be asked, or null when ready. */
	missing(provider = this.provider()): string | null {
		// Claude Code keeps its own sign-in and picks its own model when none is
		// named; whether it is signed in shows when it is asked.
		if (provider.wire === "claude-code") return null;
		if (provider.wire === "chatgpt") {
			if (!this.chatgpt.account()) return "Sign in with ChatGPT.";
		} else {
			if (!this.baseUrl(provider)) return "Add the service's address.";
			if (!provider.keyOptional && !this.key(provider)) return `Add your ${provider.name} key.`;
		}
		if (!this.model(provider)) return "Choose a model.";
		return null;
	}

	ready(): boolean {
		return this.enabled() && this.missing() === null;
	}

	async models(provider = this.provider()): Promise<AiModel[]> {
		if (provider.wire === "chatgpt") return this.chatgpt.models();
		if (provider.wire === "claude-code") return this.claudeCode.models();
		const body = await this.http.getJson(`${this.baseUrl(provider)}/models`, {
			headers: this.headers(provider),
			retries: 0,
		});
		return modelList(body);
	}

	/** Asks the chosen model one question and returns its JSON answer. */
	async ask<T>(request: AiRequest): Promise<T> {
		const provider = this.provider();
		const model = this.model(provider);
		const missing = this.missing(provider);
		if (missing) throw new Error(missing);

		if (provider.wire === "chatgpt") return this.chatgpt.complete<T>(model, request);
		if (provider.wire === "claude-code") return this.claudeCode.complete<T>(model, request);

		const url = this.baseUrl(provider);
		const options = { headers: this.headers(provider), retries: 1 };
		if (provider.wire === "anthropic") {
			const body = await this.http.postJson(`${url}/messages`, anthropicBody(model, request), options);
			return parseAnswer<T>(anthropicText(body));
		}
		try {
			const body = await this.http.postJson(`${url}/chat/completions`, chatBody(model, request, provider.schema), options);
			return parseAnswer<T>(chatText(body));
		} catch (err) {
			// A model behind a schema-capable service may still lack schemas
			// (common on OpenRouter and local servers): fall back to JSON mode.
			if (!(provider.schema && err instanceof HttpError && err.status === 400)) throw err;
			const body = await this.http.postJson(`${url}/chat/completions`, chatBody(model, request, false), options);
			return parseAnswer<T>(chatText(body));
		}
	}

	private headers(provider: AiProvider): Record<string, string> {
		const key = this.key(provider);
		if (provider.wire === "anthropic") {
			return { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION };
		}
		const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
		if (provider.id === "openrouter") {
			// OpenRouter's app attribution; names the plugin, nothing about you.
			headers["HTTP-Referer"] = "https://github.com/brandondodd/obsidian-scout";
			headers["X-Title"] = "Scout for Obsidian";
		}
		return headers;
	}
}
