import { TFile, setIcon, type App } from "obsidian";
import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { coverSrcSet } from "../../core/coverSizes";
import { isAbortError } from "../../core/http";
import type { LibraryEntry } from "../../core/library/entry";
import type { LibraryIndex } from "../../core/library/indexer";
import type { ScoutSettings } from "../../core/settings/store";
import { MEDIA_KIND_LABELS, type MediaKind } from "../../core/types";

/** Small pieces the search modal, the detail dialog, and the library all use. */

/** Renders one of Obsidian's own icons inside React. */
export function Icon({
	name,
	size,
}: {
	name: string;
	size?: number;
}): React.ReactElement {
	const ref = useRef<HTMLSpanElement>(null);
	// Before paint: drawn after it, every icon was an empty box for a frame and
	// then took its room, nudging the label beside it and the line after it.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.empty();
		setIcon(el, name);
	}, [name]);
	/**
	 * Sized through `--icon-size`, not through width and height on the `<svg>`.
	 * Obsidian sizes its icons from that variable in CSS, and a CSS rule beats a
	 * presentation attribute — so setting the attributes did nothing at all and
	 * every icon came out at the theme's default, whatever was asked for.
	 */
	return (
		<span
			className="scout-icon"
			ref={ref}
			style={
				size
					? ({ "--icon-size": `${size}px` } as React.CSSProperties)
					: undefined
			}
		/>
	);
}

/* --------------------------------------------------------------- kinds */

/**
 * A glyph per media type.
 *
 * A shelf holds films, books, and games side by side, and a poster does not
 * say which — a book cover and a game cover are the same rectangle. The word
 * is on the card already, in eleven-point grey, which is a thing you read
 * rather than a thing you see.
 *
 * All seven are icons Obsidian has shipped for years; a name it does not know
 * renders as nothing at all, which is worth more care than it looks.
 */
export const KIND_ICONS: Record<MediaKind, string> = {
	movie: "film",
	tv: "tv",
	book: "book",
	game: "gamepad-2",
	anime: "sparkles",
	manga: "book-open",
	album: "music",
	link: "link",
};

/** The type of a thing, at a glance. Sits on the artwork in the grid. */
export function KindBadge({
	kind,
	size = 12,
	className = "",
}: {
	kind: MediaKind;
	size?: number;
	className?: string;
}): React.ReactElement {
	return (
		<span
			className={`scout-kind-badge ${className}`.trim()}
			title={MEDIA_KIND_LABELS[kind]}
			aria-label={MEDIA_KIND_LABELS[kind]}
		>
			<Icon name={KIND_ICONS[kind]} size={size} />
		</span>
	);
}

/**
 * Turns a cover value into something an `<img>` can load.
 *
 * A note's cover may be a remote URL, a data URI, a vault-relative path, or a
 * `![[embed]]` — all four are common in existing media notes, and only the
 * first works without help.
 */
export function resolveImage(
	app: App,
	value: string | undefined,
	sourcePath = "",
): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (/^(https?:|data:|app:|capacitor:)/i.test(trimmed)) return trimmed;

	const embed = /^!?\[\[(.+?)(\|.*)?\]\]$/.exec(trimmed);
	const inline = /^!\[.*?\]\((.+?)\)$/.exec(trimmed);
	const path = embed?.[1] ?? inline?.[1] ?? trimmed;
	if (/^https?:/i.test(path)) return path;

	const file =
		app.metadataCache.getFirstLinkpathDest(path, sourcePath) ??
		app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? app.vault.getResourcePath(file) : undefined;
}

/** Cover art with a graceful fallback when the image is missing or broken. */
export function Cover({
	src,
	alt,
	title,
	className = "",
}: {
	src: string | undefined;
	alt: string;
	title: string;
	className?: string;
}): React.ReactElement {
	const [failed, setFailed] = useState<string | undefined>();
	if (!src || failed === src) {
		return (
			<div className={`scout-cover scout-cover-empty ${className}`}>
				<span>{title.slice(0, 2).toUpperCase()}</span>
			</div>
		);
	}
	return (
		<CoverImage
			// A new picture starts its own arrival rather than inheriting the
			// last one's finished state.
			key={src}
			src={src}
			alt={alt}
			className={className}
			onFail={() => setFailed(src)}
		/>
	);
}

/**
 * How a cover is getting on.
 *
 * `loading` until its entrance comes, which is once the picture is in and in
 * view, whether it came off the network or out of the cache; `ready` once it
 * has come into focus; `shown` when it made its entrance earlier this session,
 * which replays nothing.
 */
type Arrival = "loading" | "ready" | "shown";

/**
 * Pictures that have already made their entrance in this session.
 *
 * Switching tabs, or a view rebuilding itself, mounts every cover afresh; one
 * already seen is shown as it was rather than fading, or worse, shimmering and
 * coming into focus all over again because it had not finished decoding yet.
 */
const SHOWN_LIMIT = 4000;
const shown = new Set<string>();

function markShown(src: string): void {
	if (shown.has(src)) return;
	if (shown.size >= SHOWN_LIMIT) {
		const oldest = shown.values().next().value;
		if (oldest !== undefined) shown.delete(oldest);
	}
	shown.add(src);
}

/**
 * Covers making their entrance, and the order they make it in.
 *
 * Each entrance is a blur redrawn every frame until it settles, so it is only
 * played where someone can see it: a cover the browser fetched ahead of the
 * scroll is held until it comes into view.
 *
 * The browser fetches a shelf's covers side by side and they finish in any
 * order, so taken as they landed they came in scattered across the grid. They
 * are let in in reading order instead: a cover that is in waits for any in
 * view before it that is still loading, though not for long, so one slow
 * picture does not hold up the shelf. A few are let in a frame, which spreads
 * the cost and reads as a cascade.
 */
const REVEALS_PER_FRAME = 4;
/** How long an arrived cover waits on a slower one ahead of it. */
const ORDER_PATIENCE_MS = 500;

interface Entrance {
	el: HTMLElement;
	inView: boolean;
	/** When the picture finished loading, or null while it is still on its way. */
	arrivedAt: number | null;
	reveal: () => void;
	/** Marks it as slow, once it has been in view and still loading a while. */
	slowTimer: number;
}

/**
 * How long a cover in view may keep loading before its placeholder breathes.
 *
 * Not from the start: every breathing placeholder is drawn on a layer of its
 * own, and a shelf of them alongside the covers coming into focus made each
 * frame several times the work. Only a cover genuinely kept waiting gets one,
 * and it is set from here, rather than declared in the stylesheet with a delay,
 * because a declared animation is given its layer even while it waits.
 */
const SLOW_MS = 1200;

const entrances = new Map<Element, Entrance>();
const watchers = new WeakMap<Document, IntersectionObserver>();
let entranceFrame = 0;

/** One watcher per window, shared by every cover in it. */
function watcherFor(doc: Document): IntersectionObserver {
	let watcher = watchers.get(doc);
	if (!watcher) {
		watcher = new IntersectionObserver(
			(seen) => {
				for (const one of seen) {
					const entrance = entrances.get(one.target);
					if (!entrance) continue;
					entrance.inView = one.isIntersecting;
					// Set on the element directly: it changes with every scroll, and
					// is not worth a render of the cover each time it does.
					window.clearTimeout(entrance.slowTimer);
					const frame = entrance.el.parentElement;
					if (!one.isIntersecting) frame?.removeAttribute("data-slow");
					else if (entrance.arrivedAt === null) {
						entrance.slowTimer = window.setTimeout(() => {
							if (entrance.arrivedAt === null) frame?.setAttribute("data-slow", "");
						}, SLOW_MS);
					}
				}
				wakeEntrances();
			},
			{ threshold: 0.05 },
		);
		watchers.set(doc, watcher);
	}
	return watcher;
}

function wakeEntrances(): void {
	if (!entranceFrame) entranceFrame = window.requestAnimationFrame(letEntrancesIn);
}

const inReadingOrder = (a: Entrance, b: Entrance): number =>
	a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

function letEntrancesIn(): void {
	entranceFrame = 0;
	const now = performance.now();
	const inView = [...entrances.values()].filter((one) => one.inView).sort(inReadingOrder);
	let letIn = 0;
	let waiting = false;
	let blocked = false;
	for (const one of inView) {
		// In a view being drawn ahead, out of sight: in the window as far as the
		// watcher is concerned, but nobody has seen it, so its entrance waits.
		if (!one.el.checkVisibility({ visibilityProperty: true })) continue;
		if (one.arrivedAt === null) {
			blocked = true;
			continue;
		}
		const patient = now - one.arrivedAt < ORDER_PATIENCE_MS;
		if ((blocked && patient) || letIn >= REVEALS_PER_FRAME) {
			waiting = true;
			continue;
		}
		letIn++;
		leave(one.el);
		one.reveal();
	}
	if (waiting) wakeEntrances();
}

function leave(el: Element): void {
	const entrance = entrances.get(el);
	if (entrance) window.clearTimeout(entrance.slowTimer);
	entrances.delete(el);
	watchers.get(el.ownerDocument)?.unobserve(el);
}

/**
 * Lines a cover up for its entrance from the moment it is drawn, so the ones
 * after it know to wait while it loads. Returns how to say it has arrived, and
 * how to give up its place.
 */
function awaitEntrance(
	el: HTMLElement,
	reveal: () => void,
): { arrived: () => void; leave: () => void } {
	const entrance: Entrance = { el, inView: false, arrivedAt: null, reveal, slowTimer: 0 };
	entrances.set(el, entrance);
	watcherFor(el.ownerDocument).observe(el);
	return {
		arrived: () => {
			if (entrance.arrivedAt !== null) return;
			entrance.arrivedAt = performance.now();
			wakeEntrances();
		},
		leave: () => {
			if (entrances.get(el) !== entrance) return;
			leave(el);
			wakeEntrances();
		},
	};
}

/**
 * The picture itself, in a frame that shimmers until it arrives.
 *
 * It comes into focus as it lands: blurred and a touch large, settling sharp
 * and to size.
 */
function CoverImage({
	src,
	alt,
	className,
	onFail,
}: {
	src: string;
	alt: string;
	className: string;
	onFail: () => void;
}): React.ReactElement {
	const img = useRef<HTMLImageElement>(null);
	const [arrival, setArrival] = useState<Arrival>(() => (shown.has(src) ? "shown" : "loading"));
	const entrance = useRef<{ arrived: () => void; leave: () => void } | null>(null);
	const srcSet = useMemo(() => coverSrcSet(src), [src]);
	useLayoutEffect(() => {
		const el = img.current;
		if (!el || shown.has(src)) return;
		const lined = awaitEntrance(el, () => {
			markShown(src);
			setArrival("ready");
		});
		entrance.current = lined;
		// Out of the cache it is already in, and takes its turn like the rest,
		// rather than jumping the queue or skipping its entrance.
		if (el.complete && el.naturalWidth > 0) lined.arrived();
		return () => {
			entrance.current = null;
			lined.leave();
		};
	}, []);
	// It keeps its shimmer until its turn comes, rather than going blank.
	const arrived = (): void => entrance.current?.arrived();
	return (
		<span className={`scout-cover scout-cover-frame is-${arrival} ${className}`}>
			<img
				ref={img}
				className="scout-cover-img"
				src={src}
				// The host's smaller cuts, for the browser to pick the one that fits
				// where the cover is drawn: a card is a fraction of the size a
				// note's cover is stored at.
				srcSet={srcSet}
				sizes={srcSet ? "auto, 160px" : undefined}
				alt={alt}
				draggable={false}
				loading="lazy"
				// Decoded off the main thread, so a shelf being scrolled into view
				// does not pay for its covers in dropped frames.
				decoding="async"
				onLoad={arrived}
				onError={onFail}
			/>
		</span>
	);
}

/* -------------------------------------------------------------------- hooks */

/**
 * Re-renders whenever the index changes, and hands back the current entries.
 *
 * A version counter rather than `useSyncExternalStore`, because `all()` builds
 * a fresh array every call and so can never be a stable snapshot.
 */
export function useLibraryEntries(index: LibraryIndex): readonly LibraryEntry[] {
	const [, setVersion] = useState(0);
	useEffect(() => index.subscribe(() => setVersion((v) => v + 1)), [index]);
	return index.all();
}

/** Cards added a frame while a view's first page fills in below the fold. */
const FILL_CHUNK = 24;

/**
 * How much of a long list to actually put in the page.
 *
 * A library of a few thousand items is a few thousand cards, each with an
 * image, an icon or two and a handful of nodes — enough DOM to make scrolling
 * stutter on a phone and to hold a great deal of memory for rows nobody has
 * looked at. So the list renders a screenful or three and grows when the
 * bottom comes into view, which is a scroll nobody notices.
 *
 * `reset` is anything that means "a different list now" — a new filter, a new
 * view — and puts the window back to the first page.
 */
export function useRenderWindow(
	reset: unknown,
	step: number,
	first: number = step,
): [number, (el: HTMLElement | null) => void] {
	const opening = Math.max(1, Math.min(first, step));
	// Put back in the same render as the change, not in an effect after it: by
	// then the new list had already been drawn at the old length, so a switch
	// made far down a long view drew all of it once before drawing a page.
	const [page, setPage] = useState({ reset, limit: opening });
	const current = Object.is(page.reset, reset);
	if (!current) setPage({ reset, limit: opening });
	const limit = current ? page.limit : opening;

	/**
	 * A switch draws a screenful, and the rest of the first page after it.
	 *
	 * Every card put in the page is styled before anything is shown, and with a
	 * vault's worth of themes and plugins each card costs real time to style; a
	 * page of them was most of the wait for a view to come up. The ones below
	 * the fold follow a few at a time, frame by frame, where nobody sees them
	 * arrive.
	 */
	useEffect(() => {
		if (limit >= step) return;
		let timer = 0;
		const frame = window.requestAnimationFrame(() => {
			timer = window.setTimeout(() =>
				setPage((was) => ({ ...was, limit: Math.min(step, was.limit + FILL_CHUNK) })),
			);
		});
		return () => {
			window.cancelAnimationFrame(frame);
			window.clearTimeout(timer);
		};
	}, [limit, step]);

	const observer = useRef<IntersectionObserver | null>(null);
	const pending = useRef(0);
	useEffect(
		() => () => {
			observer.current?.disconnect();
			window.cancelAnimationFrame(pending.current);
		},
		[],
	);

	/**
	 * The sentinel is re-keyed on every widening, so React hands this a new
	 * element and the observer starts again. An observer left watching a
	 * sentinel that is *still* on screen never fires a second time, which would
	 * stop the list one page short of wherever you had scrolled to.
	 *
	 * It is watched from the next frame. Finding the pane that scrolls reads
	 * styles, and read as the new page was being put in, it made the browser
	 * style the whole view early, in the middle of the switch.
	 */
	const sentinel = useCallback(
		(el: HTMLElement | null) => {
			observer.current?.disconnect();
			observer.current = null;
			window.cancelAnimationFrame(pending.current);
			if (!el) return;
			pending.current = window.requestAnimationFrame(() => {
				if (!el.isConnected) return;
				const io = new IntersectionObserver(
					(records) => {
						if (records.some((record) => record.isIntersecting)) {
							// Not while the first page is still filling in behind
							// the screenful: that is already on its way.
							setPage((was) =>
								was.limit < step ? was : { ...was, limit: was.limit + step },
							);
						}
					},
					// Well before the bottom, so the next page is there by the
					// time the scroll reaches it. Measured against the pane that
					// scrolls: against the window, the margin reaches past the
					// pane's edge, where its overflow already clips the sentinel
					// out of view, so the next page waited for the bottom and drew
					// in a half row.
					{ root: scroller(el), rootMargin: "800px 0px" },
				);
				io.observe(el);
				observer.current = io;
			});
		},
		[step],
	);

	return [limit, sentinel];
}

/** The nearest ancestor that scrolls, or null for the window. */
function scroller(el: HTMLElement): HTMLElement | null {
	const view = el.ownerDocument.defaultView;
	for (let at = el.parentElement; at; at = at.parentElement) {
		const overflow = view?.getComputedStyle(at).overflowY;
		if (overflow === "auto" || overflow === "scroll") return at;
	}
	return null;
}

/** Bumps a counter whenever settings change, to re-read config in a render. */
export function useSettingsVersion(settings: ScoutSettings): number {
	const [version, setVersion] = useState(0);
	useEffect(
		() => settings.onChange(() => setVersion((v) => v + 1)),
		[settings],
	);
	return version;
}

/** Sensible "N and above" steps for whatever scale is configured. */
export function ratingThresholds(scale: number): number[] {
	if (scale <= 5) return [1, 2, 3, 4, 5];
	if (scale <= 10) return [2, 4, 6, 7, 8, 9];
	return [20, 40, 60, 70, 80, 90];
}

/* ------------------------------------------------------------ provider calls */

export interface Async<T> {
	data: T | null;
	loading: boolean;
	error: string | null;
}

/**
 * Runs a provider call, keyed by a string.
 *
 * By value rather than by function identity: the loader closes over props that
 * are rebuilt on every render — an entry is a fresh object after each write —
 * so keying on the closure would refetch forever.
 */
export function useProviderData<T>(
	load: ((signal: AbortSignal) => Promise<T>) | null,
	key: string,
): Async<T> {
	// Loading from the first render when there is something to load, so a
	// placeholder shows at once rather than after an empty frame.
	const [state, setState] = useState<Async<T> & { key: string }>({
		data: null,
		loading: load !== null,
		error: null,
		key,
	});
	const latest = useRef(load);
	latest.current = load;

	useEffect(() => {
		const run = latest.current;
		if (!run) {
			setState({ data: null, loading: false, error: null, key });
			return;
		}
		const controller = new AbortController();
		setState({ data: null, loading: true, error: null, key });

		run(controller.signal)
			.then((data) => {
				if (!controller.signal.aborted) {
					setState({ data, loading: false, error: null, key });
				}
			})
			.catch((err: unknown) => {
				if (isAbortError(err) || controller.signal.aborted) return;
				console.warn("Scout: provider fetch failed", err);
				setState({
					data: null,
					loading: false,
					error:
						err instanceof Error
							? err.message
							: "Could not load this from the source.",
					key,
				});
			});

		return () => controller.abort();
	}, [key]);

	// The render after the key changes comes before the effect that fetches for
	// it. Answering with the old key's state there showed the previous answer for
	// a frame, and said nothing was loading when something was about to.
	if (state.key !== key) {
		return { data: null, loading: load !== null, error: null };
	}
	return state;
}

/** A value that lags its input, for search boxes. */
export function useDebounced<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delayMs);
		return () => window.clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}

/** A Home section's heading: icon, title, a quiet note, and an action at the end. */
export function SectionHead({
	title,
	icon,
	note,
	action,
}: {
	title: string;
	icon: string;
	note?: string;
	action?: React.ReactNode;
}): React.ReactElement {
	return (
		<div className="scout-home-section-head">
			<h3>
				<Icon name={icon} size={14} />
				{title}
			</h3>
			{note && <span className="scout-home-note">{note}</span>}
			{action}
		</div>
	);
}
