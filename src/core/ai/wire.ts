import type { AiModel, AiRequest } from "./providers";

/**
 * Request bodies and answer parsing for each way of talking to a model.
 *
 * Pure, so the shapes can be tested without a network. Transport, keys and
 * tokens live in `assistant.ts` and `chatgpt.ts`.
 */

const SCHEMA_NAME = "answer";

/** Anthropic's Messages API with structured output. */
export function anthropicBody(model: string, request: AiRequest): unknown {
	return {
		model,
		max_tokens: request.maxTokens ?? 2048,
		system: request.system,
		messages: [{ role: "user", content: request.prompt }],
		output_config: { format: { type: "json_schema", schema: request.schema } },
	};
}

export function anthropicText(body: unknown): string {
	const message = body as { stop_reason?: string; content?: { type: string; text?: string }[] };
	if (message.stop_reason === "refusal") throw new Error("The model would not answer that.");
	if (message.stop_reason === "max_tokens") throw new Error("The answer was cut short.");
	return (message.content ?? []).map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
}

/**
 * OpenAI chat completions, which nearly every other service also speaks.
 *
 * With `schema` off — a service with JSON mode but no schemas — the schema goes
 * into the prompt instead and the answer is checked locally either way.
 */
export function chatBody(model: string, request: AiRequest, schema: boolean): unknown {
	const system = schema
		? request.system
		: `${request.system}\n\nAnswer with only a JSON object matching this JSON schema:\n${JSON.stringify(request.schema)}`;
	return {
		model,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: request.prompt },
		],
		response_format: schema
			? { type: "json_schema", json_schema: { name: SCHEMA_NAME, strict: true, schema: request.schema } }
			: { type: "json_object" },
	};
}

export function chatText(body: unknown): string {
	const choice = (body as { choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[] }).choices?.[0];
	if (!choice) throw new Error("The model sent no answer.");
	if (choice.message?.refusal) throw new Error("The model would not answer that.");
	if (choice.finish_reason === "length") throw new Error("The answer was cut short.");
	return choice.message?.content ?? "";
}

/**
 * The Responses API as a ChatGPT plan token must use it: streamed, not stored,
 * no system item and no output cap.
 */
export function responsesBody(model: string, request: AiRequest): unknown {
	return {
		model,
		store: false,
		stream: true,
		instructions: request.system,
		input: [{ type: "message", role: "user", content: [{ type: "input_text", text: request.prompt }] }],
		text: { format: { type: "json_schema", name: SCHEMA_NAME, strict: true, schema: request.schema } },
	};
}

/** Reads a whole server-sent event stream from the Responses API. */
export function responsesText(stream: string): string {
	let text = "";
	for (const line of stream.split(/\r?\n/)) {
		if (!line.startsWith("data:")) continue;
		const data = line.slice(5).trim();
		if (!data || data === "[DONE]") continue;
		let event: { type?: string; delta?: string; response?: { error?: { message?: string; code?: string } }; error?: { message?: string } };
		try {
			event = JSON.parse(data);
		} catch {
			continue;
		}
		if (event.type === "response.output_text.delta" && event.delta) text += event.delta;
		if (event.type === "response.failed" || event.type === "error") {
			const error = event.response?.error ?? event.error;
			throw new Error(planError(error?.message, (error as { code?: string } | undefined)?.code));
		}
		if (event.type === "response.completed") return text;
	}
	throw new Error("The answer stopped before it was finished.");
}

/** Plain words for the ways a plan can say no. */
export function planError(message: string | undefined, code: string | undefined): string {
	switch (code) {
		case "subscription_sharing_usage_limit_exceeded":
			return "Your ChatGPT plan's usage limit is reached for now.";
		case "subscription_sharing_user_not_eligible":
			return "This ChatGPT plan can't be used in other apps.";
		case "subscription_sharing_usage_unavailable":
			return "ChatGPT plan usage is unavailable right now. Try again shortly.";
		default:
			return message || "The model could not answer.";
	}
}

/**
 * The JSON object in an answer.
 *
 * Schema-following services send exactly that; JSON-mode ones sometimes wrap it
 * in a code fence or a sentence, so the outermost braces are taken.
 */
export function parseAnswer<T>(text: string): T {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed) as T;
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
		throw new Error("The model's answer was not the JSON it was asked for.");
	}
}

/** Model lists, whichever shape they come in. */
export function modelList(body: unknown): AiModel[] {
	const raw = body as { data?: unknown[]; models?: unknown[] } | unknown[];
	const list = Array.isArray(raw) ? raw : (raw.data ?? raw.models ?? []);
	const out: AiModel[] = [];
	for (const one of list as Record<string, unknown>[]) {
		// The ChatGPT plan list marks the ones meant to be offered.
		if (typeof one.visibility === "string" && one.visibility !== "list") continue;
		const id = (one.slug ?? one.id) as string | undefined;
		if (typeof id !== "string" || !id) continue;
		const name = (one.display_name ?? one.name ?? id) as string;
		out.push({ id, name: typeof name === "string" ? name : id });
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}
