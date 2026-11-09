import type { SettingsScope } from "../settings/types";
import type { AiModel, AiRequest } from "./providers";
import { parseAnswer } from "./wire";

/**
 * Answers from the Claude Code you already have installed and signed in.
 *
 * Scout never sees a token: it runs the official `claude` program in its
 * headless mode, and that program uses whatever account you signed it into —
 * your Claude plan, or a key you gave it. This is the same arrangement as other
 * local tools that wrap Claude Code. Desktop only.
 *
 * The run is fenced in: no tools, no MCP servers, no CLAUDE.md, skills, hooks
 * or plugins, nothing saved as a session, and started in the system's temp
 * folder rather than the vault. It can only answer.
 */

// A batch of forty titles takes a slow model a while; a single question never comes close.
const TIMEOUT_MS = 180_000;

export interface ClaudeCodeStatus {
	loggedIn: boolean;
	email?: string;
	plan?: string;
	method?: string;
}

/** The arguments for one fenced, headless question. Pure, for testing. */
export function claudeArgs(model: string, request: AiRequest): string[] {
	const args = [
		"-p",
		"--safe-mode",
		"--tools",
		"",
		"--strict-mcp-config",
		"--no-session-persistence",
		"--output-format",
		"json",
		"--system-prompt",
		request.system,
		"--json-schema",
		JSON.stringify(request.schema),
	];
	if (model) args.push("--model", model);
	return args;
}

/** Reads `claude -p --output-format json`'s result. Pure, for testing. */
export function claudeAnswer<T>(stdout: string): T {
	let result: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown };
	try {
		result = JSON.parse(stdout.trim());
	} catch {
		throw new Error("Claude Code answered with something unreadable.");
	}
	if (result.is_error || (result.subtype && result.subtype !== "success")) {
		throw new Error(result.result?.trim() || "Claude Code could not answer.");
	}
	if (result.structured_output && typeof result.structured_output === "object") {
		return result.structured_output as T;
	}
	return parseAnswer<T>(result.result ?? "");
}

export class ClaudeCode {
	private found: Promise<string> | null = null;

	constructor(private readonly scope: SettingsScope) {}

	/** Model aliases Claude Code always understands; a full model id works too. */
	models(): AiModel[] {
		return [
			{ id: "haiku", name: "Haiku — quickest, lightest on your plan" },
			{ id: "sonnet", name: "Sonnet" },
			{ id: "opus", name: "Opus" },
		];
	}

	/** Forgets where `claude` was found, after the path setting changes. */
	reset(): void {
		this.found = null;
	}

	async status(): Promise<ClaudeCodeStatus> {
		const out = await run(await this.binary(), ["auth", "status", "--json"], "", 20_000);
		const json = JSON.parse(out) as {
			loggedIn?: boolean;
			email?: string;
			subscriptionType?: string;
			authMethod?: string;
		};
		return {
			loggedIn: json.loggedIn === true,
			email: json.email,
			plan: json.subscriptionType,
			method: json.authMethod,
		};
	}

	async complete<T>(model: string, request: AiRequest, signal?: AbortSignal): Promise<T> {
		const out = await run(await this.binary(), claudeArgs(model, request), request.prompt, TIMEOUT_MS, signal);
		return claudeAnswer<T>(out);
	}

	/**
	 * Where `claude` is.
	 *
	 * Obsidian started from a dock or Start menu does not get the PATH a
	 * terminal has, so the usual install places are tried after the setting
	 * and the bare name.
	 */
	private binary(): Promise<string> {
		this.found ??= this.locate().catch((err: unknown) => {
			this.found = null;
			throw err;
		});
		return this.found;
	}

	private async locate(): Promise<string> {
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const home = os.homedir();
		const exe = process.platform === "win32" ? "claude.exe" : "claude";
		const candidates = [
			this.scope.get<string>("claudePath", "").trim(),
			exe,
			path.join(home, ".local", "bin", exe),
			path.join(home, ".claude", "local", exe),
			"/opt/homebrew/bin/claude",
			"/usr/local/bin/claude",
		].filter((c) => c.length > 0);
		for (const candidate of candidates) {
			try {
				await run(candidate, ["--version"], "", 10_000);
				return candidate;
			} catch {
				// Not there; try the next place.
			}
		}
		throw new Error("Claude Code was not found. Install it, or set where it is in Settings → Scout → AI.");
	}
}

/** Runs a program without a shell, feeding `input` and returning its output. */
function run(file: string, args: string[], input: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
	const { execFile } = require("child_process") as typeof import("child_process");
	const os = require("os") as typeof import("os");
	return new Promise((resolve, reject) => {
		const child = execFile(
			file,
			args,
			{ cwd: os.tmpdir(), timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true, signal },
			(err, stdout, stderr) => {
				if (signal?.aborted) {
					reject(new Error("Stopped."));
					return;
				}
				// A failed answer still prints its JSON; let the caller read it.
				if (err && !stdout.trim()) {
					const reason = (err as { killed?: boolean }).killed ? "Claude Code took too long to answer." : stderr.trim() || err.message;
					reject(new Error(reason));
					return;
				}
				resolve(stdout);
			},
		);
		child.stdin?.end(input);
	});
}
