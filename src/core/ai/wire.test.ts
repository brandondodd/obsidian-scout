import { describe, expect, it } from "vitest";
import { authorizeUrl, checkIdToken, ISSUER, pkce } from "./chatgpt";
import { anthropicText, chatBody, chatText, modelList, parseAnswer, responsesText } from "./wire";

const request = { system: "sys", prompt: "q", schema: { type: "object" } };

describe("chat completions", () => {
	it("asks for a schema, or puts it in the prompt for JSON-mode services", () => {
		const withSchema = chatBody("m", request, true) as { response_format: { type: string } };
		expect(withSchema.response_format.type).toBe("json_schema");
		const jsonMode = chatBody("m", request, false) as { response_format: { type: string }; messages: { content: string }[] };
		expect(jsonMode.response_format.type).toBe("json_object");
		expect(jsonMode.messages[0]!.content).toContain('{"type":"object"}');
	});

	it("reads the answer and names refusals and truncation", () => {
		expect(chatText({ choices: [{ message: { content: "{}" } }] })).toBe("{}");
		expect(() => chatText({ choices: [{ message: { refusal: "no" } }] })).toThrow("would not");
		expect(() => chatText({ choices: [{ finish_reason: "length", message: { content: "{" } }] })).toThrow("cut short");
	});
});

describe("anthropic", () => {
	it("joins text blocks and names refusals", () => {
		expect(anthropicText({ content: [{ type: "text", text: '{"a":' }, { type: "text", text: "1}" }] })).toBe('{"a":1}');
		expect(() => anthropicText({ stop_reason: "refusal", content: [] })).toThrow("would not");
	});
});

describe("responses stream", () => {
	it("joins deltas and finishes on completion", () => {
		const stream = [
			'data: {"type":"response.output_text.delta","delta":"{\\"a\\""}',
			"",
			'data: {"type":"response.output_text.delta","delta":":1}"}',
			'data: {"type":"response.completed","response":{}}',
		].join("\n");
		expect(responsesText(stream)).toBe('{"a":1}');
	});

	it("explains a plan limit, and a stream cut off before completion", () => {
		const failed = 'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}';
		expect(() => responsesText(failed)).toThrow("usage limit");
		expect(() => responsesText('data: {"type":"response.output_text.delta","delta":"{"}')).toThrow("stopped");
	});
});

describe("parseAnswer", () => {
	it("takes the object out of a fenced or chatty answer", () => {
		expect(parseAnswer('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
		expect(() => parseAnswer("no json")).toThrow("not the JSON");
	});
});

describe("modelList", () => {
	it("reads OpenAI, Anthropic and ChatGPT plan lists", () => {
		expect(modelList({ data: [{ id: "b" }, { id: "a", display_name: "A" }] })).toEqual([
			{ id: "a", name: "A" },
			{ id: "b", name: "b" },
		]);
		expect(modelList({ data: [{ slug: "x", display_name: "X", visibility: "list" }, { slug: "h", visibility: "hide" }] })).toEqual([
			{ id: "x", name: "X" },
		]);
	});
});

describe("ChatGPT sign-in", () => {
	it("registers on first sign-in and names the account on return", () => {
		const base = { hostId: "urn:uuid:1", redirectUri: "http://127.0.0.1:1455/auth/callback", state: "s", nonce: "n", challenge: "c" };
		const first = new URL(authorizeUrl({ ...base, clientId: null }));
		expect(first.searchParams.get("client_id")).toBe("dynamic_agent_client");
		expect(first.searchParams.get("agent_name_hint")).toBeTruthy();
		expect(first.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
		const again = new URL(authorizeUrl({ ...base, clientId: "oaiapp_1", idTokenHint: "t" }));
		expect(again.searchParams.get("client_id")).toBe("oaiapp_1");
		expect(again.searchParams.get("agent_name_hint")).toBeNull();
		expect(again.searchParams.get("id_token_hint")).toBe("t");
	});

	it("makes an S256 challenge", async () => {
		const { verifier, challenge } = await pkce();
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("checks the ID token's issuer, audience, expiry and nonce", () => {
		const token = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
		const good = { iss: ISSUER, aud: "oaiapp_1", exp: 2e9, nonce: "n", sub: "u", email: "me@example.com" };
		expect(checkIdToken(token(good), { clientId: "oaiapp_1", nonce: "n", now: 0 }).email).toBe("me@example.com");
		expect(() => checkIdToken(token({ ...good, nonce: "other" }), { clientId: "oaiapp_1", nonce: "n", now: 0 })).toThrow("nonce");
		expect(() => checkIdToken(token({ ...good, aud: "else" }), { clientId: "oaiapp_1", nonce: "n", now: 0 })).toThrow("audience");
	});
});

describe("Claude Code", () => {
	it("runs fenced in: no tools, no MCP, no saved session, schema enforced", async () => {
		const { claudeArgs } = await import("./claudeCode");
		const args = claudeArgs("haiku", request);
		expect(args).toEqual(expect.arrayContaining(["-p", "--safe-mode", "--strict-mcp-config", "--no-session-persistence"]));
		expect(args[args.indexOf("--tools") + 1]).toBe("");
		expect(args[args.indexOf("--json-schema") + 1]).toBe('{"type":"object"}');
		expect(args.slice(-2)).toEqual(["--model", "haiku"]);
		expect(claudeArgs("", request)).not.toContain("--model");
	});

	it("reads structured output, and says why a run failed", async () => {
		const { claudeAnswer } = await import("./claudeCode");
		expect(claudeAnswer('{"type":"result","subtype":"success","result":"{}","structured_output":{"a":1}}')).toEqual({ a: 1 });
		expect(claudeAnswer('{"subtype":"success","result":"{\\"b\\":2}"}')).toEqual({ b: 2 });
		expect(() => claudeAnswer('{"is_error":true,"result":"Not logged in"}')).toThrow("Not logged in");
	});
});
