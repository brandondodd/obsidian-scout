import type { SecretStorage } from "obsidian";
import type { HttpClient } from "../http";
import type { SettingsScope } from "../settings/types";
import type { AiModel, AiRequest } from "./providers";
import { modelList, parseAnswer, responsesBody, responsesText } from "./wire";

/**
 * "Continue with ChatGPT": answers drawn from the person's own ChatGPT plan.
 *
 * OpenAI's sign-in for open-source and local apps. The plugin registers itself
 * on first sign-in (there is no client secret to ship), listens once on a
 * loopback port for the browser to come back, and keeps the tokens in
 * Obsidian's secret storage. Desktop only: a phone has no loopback listener.
 *
 * https://developers.openai.com/siwc/token-sharing-open-source
 */

export const ISSUER = "https://auth.openai.com";
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const RESOURCE = "https://api.openai.com/v1";
const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const AGENT_NAME = "Scout for Obsidian";
const CALLBACK_PATH = "/auth/callback";
const PREFERRED_PORT = 1455;
const SECRET_ID = "scout-chatgpt-session";
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
export const MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage";

/** What the token endpoint answers. */
interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	id_token?: string;
	expires_in?: number;
	scope?: string;
}

/** Kept in secret storage, never in data.json. */
interface Session {
	accessToken: string;
	refreshToken: string;
	idToken: string;
	expiresAt: number;
}

export interface Pkce {
	verifier: string;
	challenge: string;
}

/* ------------------------------------------------------------ pure helpers */

export function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkce(): Promise<Pkce> {
	const verifier = randomToken(48);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function authorizeUrl(options: {
	clientId: string | null;
	hostId: string;
	redirectUri: string;
	state: string;
	nonce: string;
	challenge: string;
	idTokenHint?: string;
}): string {
	const params = new URLSearchParams({
		client_id: options.clientId ?? "dynamic_agent_client",
		ext_agent_host_id: options.hostId,
		response_type: "code",
		redirect_uri: options.redirectUri,
		scope: SCOPE,
		resource: RESOURCE,
		state: options.state,
		nonce: options.nonce,
		code_challenge_method: "S256",
		code_challenge: options.challenge,
	});
	// A first sign-in names the app; a returning one names the account instead.
	if (!options.clientId) params.set("agent_name_hint", AGENT_NAME);
	else if (options.idTokenHint) params.set("id_token_hint", options.idTokenHint);
	return `${AUTHORIZE}?${params.toString()}`;
}

export interface IdClaims {
	sub: string;
	email?: string;
}

/**
 * Checks an ID token's claims.
 *
 * The signature is not checked: the token came straight from OpenAI's token
 * endpoint over TLS, which OpenID Connect Core (3.1.3.7) allows in its place.
 */
export function checkIdToken(
	token: string,
	expected: { clientId: string; nonce?: string; now: number },
): IdClaims {
	const payload = token.split(".")[1];
	if (!payload) throw new Error("ChatGPT sent an unreadable sign-in token.");
	const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
	const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
	const claims = JSON.parse(json) as {
		iss?: string;
		aud?: string | string[];
		exp?: number;
		nonce?: string;
		sub?: string;
		email?: string;
	};
	const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	const fail = (why: string) => new Error(`ChatGPT sign-in could not be verified (${why}).`);
	if (claims.iss !== ISSUER) throw fail("issuer");
	if (!audience.includes(expected.clientId)) throw fail("audience");
	if (!claims.exp || claims.exp * 1000 < expected.now) throw fail("expired");
	if (expected.nonce !== undefined && claims.nonce !== expected.nonce) throw fail("nonce");
	if (!claims.sub) throw fail("subject");
	return { sub: claims.sub, email: claims.email };
}

/* --------------------------------------------------------------- session */

export class ChatGptSession {
	private refreshing: Promise<Session> | null = null;

	constructor(
		private readonly http: HttpClient,
		private readonly scope: SettingsScope,
		private readonly secrets: SecretStorage | undefined,
	) {}

	/** The signed-in account's email, or null when signed out. */
	account(): string | null {
		return this.session() ? this.scope.get<string>("chatgptEmail", "") || "your ChatGPT account" : null;
	}

	private session(): Session | null {
		const raw = this.secrets?.getSecret(SECRET_ID);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as Session;
		} catch {
			return null;
		}
	}

	private store(session: Session | null): void {
		this.secrets?.setSecret(SECRET_ID, session ? JSON.stringify(session) : "");
	}

	private hostId(): string {
		let id = this.scope.get<string>("chatgptHostId", "");
		if (!id) {
			id = `urn:uuid:${crypto.randomUUID()}`;
			void this.scope.set("chatgptHostId", id);
		}
		return id;
	}

	/** Opens the browser to sign in, and waits for it to come back. */
	async signIn(): Promise<string> {
		if (!this.secrets) throw new Error("This version of Obsidian has no secret storage.");
		const savedClient = this.scope.get<string>("chatgptClientId", "") || null;
		const previous = this.session();
		const state = randomToken();
		const nonce = randomToken();
		const { verifier, challenge } = await pkce();
		const hostId = this.hostId();

		const listener = await listenOnce(state);
		try {
			const url = authorizeUrl({
				clientId: savedClient,
				hostId,
				redirectUri: listener.redirectUri,
				state,
				nonce,
				challenge,
				idTokenHint: previous?.idToken,
			});
			window.open(url);
			const callback = await listener.result;

			const issued = callback.get("client_id") ?? "";
			if (savedClient && issued && issued !== savedClient) {
				throw new Error("ChatGPT answered for a different registration. Try again.");
			}
			const clientId = savedClient ?? issued;
			if (!clientId || clientId === "dynamic_agent_client") {
				throw new Error("ChatGPT did not register Scout. Try again.");
			}
			// Saved before the exchange, so a failed exchange can retry with it.
			if (!savedClient) await this.scope.set("chatgptClientId", clientId);

			const tokens = await this.http.postForm<TokenResponse>(
				TOKEN,
				{
					grant_type: "authorization_code",
					client_id: clientId,
					code: callback.get("code") ?? "",
					code_verifier: verifier,
					redirect_uri: listener.redirectUri,
					resource: RESOURCE,
				},
				{ retries: 0 },
			);
			if (!tokens.id_token || !tokens.refresh_token) throw new Error("ChatGPT sent an incomplete sign-in.");
			const claims = checkIdToken(tokens.id_token, { clientId, nonce, now: Date.now() });
			if (!(tokens.scope ?? "").split(" ").includes(PLAN_SCOPE)) {
				throw new Error("Signed in, but plan usage was not allowed. Allow it to use your ChatGPT plan.");
			}
			this.store({
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token,
				idToken: tokens.id_token,
				expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			});
			await this.scope.set("chatgptEmail", claims.email ?? "");
			return claims.email ?? "your ChatGPT account";
		} finally {
			listener.close();
		}
	}

	/** Revokes the refresh token and forgets the session. Keeps the registration. */
	async signOut(): Promise<boolean> {
		const session = this.session();
		const clientId = this.scope.get<string>("chatgptClientId", "");
		let revoked = false;
		if (session && clientId) {
			try {
				const discovery = await this.http.getJson<{ revocation_endpoint?: string }>(DISCOVERY);
				if (discovery.revocation_endpoint) {
					await this.http.postFormText(discovery.revocation_endpoint, {
						token: session.refreshToken,
						token_type_hint: "refresh_token",
						client_id: clientId,
					});
					revoked = true;
				}
			} catch {
				revoked = false;
			}
		}
		this.store(null);
		await this.scope.set("chatgptEmail", undefined);
		return revoked;
	}

	private async accessToken(): Promise<string> {
		const session = this.session();
		if (!session) throw new Error("Sign in with ChatGPT first, in Settings → Scout → AI.");
		if (session.expiresAt - Date.now() > 60_000) return session.accessToken;
		// One refresh at a time: the refresh token rotates, so a second
		// concurrent one would spend a token that is already used.
		this.refreshing ??= this.refresh(session).finally(() => (this.refreshing = null));
		return (await this.refreshing).accessToken;
	}

	private async refresh(session: Session): Promise<Session> {
		const clientId = this.scope.get<string>("chatgptClientId", "");
		try {
			const tokens = await this.http.postForm<TokenResponse>(
				TOKEN,
				{
					grant_type: "refresh_token",
					client_id: clientId,
					refresh_token: session.refreshToken,
					resource: RESOURCE,
				},
				{ retries: 1 },
			);
			const next: Session = {
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token ?? session.refreshToken,
				idToken: tokens.id_token ?? session.idToken,
				expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			};
			this.store(next);
			return next;
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (status === 400 || status === 401) {
				// Expired, revoked, or disconnected in ChatGPT's settings.
				this.store(null);
				throw new Error("Your ChatGPT sign-in has ended. Sign in again in Settings → Scout → AI.");
			}
			throw err;
		}
	}

	private async headers(): Promise<Record<string, string>> {
		return { Authorization: `Bearer ${await this.accessToken()}` };
	}

	async models(): Promise<AiModel[]> {
		return modelList(await this.http.getJson(`${RESOURCE}/models`, { headers: await this.headers(), retries: 0 }));
	}

	async complete<T>(model: string, request: AiRequest, signal?: AbortSignal): Promise<T> {
		const stream = await this.http.postJsonText(`${RESOURCE}/responses`, responsesBody(model, request), {
			headers: await this.headers(),
			retries: 0,
			signal,
		});
		return parseAnswer<T>(responsesText(stream));
	}
}

/* ---------------------------------------------------- loopback listener */

interface Listener {
	redirectUri: string;
	result: Promise<URLSearchParams>;
	close(): void;
}

/**
 * A one-shot HTTP listener on 127.0.0.1 for the browser's return trip.
 *
 * Node's `http`, loaded only when signing in, so nothing about it touches
 * mobile, where this path is never offered.
 */
async function listenOnce(state: string): Promise<Listener> {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node builtin, desktop only, loaded on demand
	const http = require("http") as typeof import("http");
	let settle!: (params: URLSearchParams) => void;
	let fail!: (err: Error) => void;
	const result = new Promise<URLSearchParams>((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});

	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== CALLBACK_PATH) {
			res.writeHead(404).end();
			return;
		}
		const params = url.searchParams;
		const ok = params.get("state") === state && !params.get("error") && !!params.get("code");
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
			`<!doctype html><meta charset="utf-8"><title>Scout</title><body style="font:16px system-ui;padding:3em">${
				ok ? "Signed in. You can close this tab and go back to Obsidian." : "Sign-in did not finish. You can close this tab."
			}</body>`,
		);
		if (params.get("state") !== state) fail(new Error("Sign-in answer did not match. Try again."));
		else if (params.get("error") === "access_denied") fail(new Error("Sign-in was cancelled."));
		else if (params.get("error")) fail(new Error(`ChatGPT said: ${params.get("error_description") ?? params.get("error")}`));
		else settle(params);
	});

	const port = await new Promise<number>((resolve, reject) => {
		const tryPort = (wanted: number) => {
			server.once("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE" && wanted !== 0) tryPort(0);
				else reject(err);
			});
			server.listen(wanted, "127.0.0.1", () => {
				const address = server.address();
				resolve(typeof address === "object" && address ? address.port : wanted);
			});
		};
		tryPort(PREFERRED_PORT);
	});

	const timer = setTimeout(() => fail(new Error("Sign-in timed out.")), SIGN_IN_TIMEOUT_MS);
	return {
		redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
		result,
		close: () => {
			clearTimeout(timer);
			server.close();
		},
	};
}
