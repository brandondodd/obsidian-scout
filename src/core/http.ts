import { requestUrl } from "obsidian";
import type { RequestUrlParam } from "obsidian";
import { TtlCache } from "./cache";

/**
 * Every network call in Scout goes through here.
 *
 * Uses Obsidian's `requestUrl` rather than `fetch` so requests are not subject
 * to the webview's CORS policy — this is what lets the plugin work on mobile.
 * Centralizing transport also gives one place for caching, backoff on rate
 * limits, and cancellation.
 */

export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly url: string,
		readonly body: string,
	) {
		const said = explain(body);
		super(said ? `${said} (HTTP ${status})` : `HTTP ${status} for ${url}`);
		this.name = "HttpError";
	}
}

/**
 * Whatever the source said about why, if it said anything.
 *
 * GraphQL puts its real complaint in the body and answers 400, so an AniList
 * failure used to surface as "HTTP 400 for https://graphql.anilist.co" — a
 * message that names the one thing the reader already knows and hides the one
 * thing they need. TMDB and Open Library both do the same in their own shape.
 */
function explain(body: string): string | null {
	if (!body) return null;
	try {
		const json = JSON.parse(body) as unknown;
		// IGDB answers with a list: `[{ "title": "Syntax Error", "cause": … }]`.
		const parsed = (Array.isArray(json)
			? { message: json[0]?.cause ?? json[0]?.title }
			: json) as {
			errors?: { message?: string }[];
			status_message?: string;
			error?: string | { message?: string };
			message?: string;
		};
		const said =
			parsed.errors?.[0]?.message ??
			parsed.status_message ??
			(typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ??
			parsed.message;
		return typeof said === "string" && said.trim() ? said.trim() : null;
	} catch {
		return null;
	}
}

export class AbortError extends Error {
	constructor() {
		super("Request aborted");
		this.name = "AbortError";
	}
}

export function isAbortError(err: unknown): boolean {
	return err instanceof AbortError || (err as Error)?.name === "AbortError";
}

export interface RequestOptions {
	headers?: Record<string, string>;
	/** Aborting discards the response; the in-flight request itself is not killed. */
	signal?: AbortSignal;
	/** Cache successful GETs for this long. Omit to skip the cache. */
	cacheTtlMs?: number;
	/** Retries on 429 and 5xx. Default 2. */
	retries?: number;
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class HttpClient {
	private readonly cache = new TtlCache<unknown>();

	/** Most recent rate-limit hint seen, surfaced in settings for diagnosis. */
	lastRateLimitAt: number | null = null;

	/** Whether a GET would be answered from the cache, without asking the source. */
	isCached(url: string, options: RequestOptions = {}): boolean {
		return (
			this.cache.get(`GET ${url} ${JSON.stringify(options.headers ?? {})}`) !==
			undefined
		);
	}

	async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
		const cacheKey = options.cacheTtlMs
			? `GET ${url} ${JSON.stringify(options.headers ?? {})}`
			: null;
		if (cacheKey) {
			const hit = this.cache.get(cacheKey);
			if (hit !== undefined) return hit as T;
		}

		const body = await this.send(
			{ url, method: "GET", headers: options.headers },
			options,
		);
		const parsed = JSON.parse(body) as T;
		if (cacheKey) this.cache.set(cacheKey, parsed, options.cacheTtlMs);
		return parsed;
	}

	/**
	 * Cached on the payload as well as the URL.
	 *
	 * It was not, and every caller passing `cacheTtlMs` to a GraphQL endpoint
	 * was having it silently ignored — which for AniList is every request it
	 * makes, since one URL serves every query. So opening the hub re-asked
	 * AniList about every seed, every time, and pressing "show me others"
	 * asked again. That is a great deal of traffic for a keyless API with a
	 * published limit of ninety requests a minute, and rate limiting is what
	 * AniList answers with when it has had enough.
	 */
	async postJson<T>(
		url: string,
		payload: unknown,
		options: RequestOptions = {},
	): Promise<T> {
		return this.post<T>(url, JSON.stringify(payload), "application/json", options);
	}

	/** A plain-text body answered with JSON, as IGDB's query language is sent. */
	async postText<T>(url: string, body: string, options: RequestOptions = {}): Promise<T> {
		return this.post<T>(url, body, "text/plain", options);
	}

	private async post<T>(
		url: string,
		serialized: string,
		contentType: string,
		options: RequestOptions,
	): Promise<T> {
		const cacheKey = options.cacheTtlMs
			? `POST ${url} ${serialized} ${JSON.stringify(options.headers ?? {})}`
			: null;
		if (cacheKey) {
			const hit = this.cache.get(cacheKey);
			if (hit !== undefined) return hit as T;
		}

		const body = await this.send(
			{
				url,
				method: "POST",
				contentType,
				headers: { "Content-Type": contentType, ...options.headers },
				body: serialized,
			},
			options,
		);
		const parsed = JSON.parse(body) as T;
		if (cacheKey) this.cache.set(cacheKey, parsed, options.cacheTtlMs);
		return parsed;
	}

	/** A JSON payload whose answer is read as text — a streamed reply, say. */
	async postJsonText(url: string, payload: unknown, options: RequestOptions = {}): Promise<string> {
		return this.send(
			{
				url,
				method: "POST",
				contentType: "application/json",
				headers: { "Content-Type": "application/json", ...options.headers },
				body: JSON.stringify(payload),
			},
			options,
		);
	}

	async postForm<T>(
		url: string,
		form: Record<string, string>,
		options: RequestOptions = {},
	): Promise<T> {
		return JSON.parse(await this.postFormText(url, form, options)) as T;
	}

	/** A form post whose answer may be empty, as a token revocation's is. */
	async postFormText(
		url: string,
		form: Record<string, string>,
		options: RequestOptions = {},
	): Promise<string> {
		return this.send(
			{
				url,
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					...options.headers,
				},
				body: new URLSearchParams(form).toString(),
			},
			options,
		);
	}

	/** Raw text, for HTML scraping (Open Graph tags). */
	async getText(url: string, options: RequestOptions = {}): Promise<string> {
		return this.send({ url, method: "GET", headers: options.headers }, options);
	}

	clearCache(): void {
		this.cache.clear();
	}

	private async send(
		request: RequestUrlParam,
		options: RequestOptions,
	): Promise<string> {
		const maxAttempts = (options.retries ?? 2) + 1;
		let lastError: unknown;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			this.throwIfAborted(options.signal);

			try {
				// `throw: false` so non-2xx responses are inspectable rather than
				// collapsing into an opaque exception.
				const response = await requestUrl({ ...request, throw: false });
				this.throwIfAborted(options.signal);

				if (response.status >= 200 && response.status < 300) {
					return response.text;
				}
				if (response.status === 429) this.lastRateLimitAt = Date.now();

				const error = new HttpError(
					response.status,
					request.url,
					response.text?.slice(0, 500) ?? "",
				);
				if (!RETRYABLE(response.status) || attempt === maxAttempts - 1) {
					throw error;
				}
				lastError = error;
				await this.backoff(attempt, response.headers, options.signal);
			} catch (err) {
				if (isAbortError(err) || err instanceof HttpError) throw err;
				// Network-level failure: retry, then give up with the real cause.
				lastError = err;
				if (attempt === maxAttempts - 1) throw err;
				await this.backoff(attempt, undefined, options.signal);
			}
		}

		throw lastError instanceof Error
			? lastError
			: new Error(String(lastError));
	}

	private async backoff(
		attempt: number,
		headers: Record<string, string> | undefined,
		signal?: AbortSignal,
	): Promise<void> {
		const retryAfter = Number(headers?.["retry-after"]);
		const delayMs = Number.isFinite(retryAfter)
			? Math.min(retryAfter * 1000, 10_000)
			: Math.min(2 ** attempt * 500, 4000);

		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				signal?.removeEventListener("abort", onAbort);
				resolve();
			}, delayMs);
			const onAbort = () => {
				window.clearTimeout(timer);
				reject(new AbortError());
			};
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private throwIfAborted(signal?: AbortSignal): void {
		if (signal?.aborted) throw new AbortError();
	}
}
