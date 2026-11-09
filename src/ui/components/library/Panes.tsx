import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LibraryConfig, LibraryGroupBy, LibraryLayout, LibrarySort } from "../../../core/library/config";
import type { LibraryEntry } from "../../../core/library/entry";
import { filterEntries, groupEntries, type LibraryGroup } from "../../../core/library/filter";
import { emptyFilters, filtersFromRule } from "../../../core/library/lens";
import { emptyRule } from "../../../core/library/rules";
import { viewEntries, type SavedView } from "../../../core/library/views";
import type { ScoutContext } from "../../../core/context";
import { Icon } from "../shared";
import { Board } from "./Board";
import { EntryTable } from "./EntryTable";

/**
 * Views kept drawn, so switching to one is showing it rather than building it.
 *
 * A view of a hundred cards took most of a tenth of a second to come up, nearly
 * all of it the browser styling every card for the first time, under every
 * rule the theme and each plugin has for the whole window. A view of five came
 * up at once. So each view, once drawn, stays in the page, hidden; the saved
 * views not yet opened are drawn while nothing else is happening; and switching
 * tab shows the one that is already there, and lets React bring it up to date.
 *
 * Kept eight at a time, enough for All and a row of saved views, the least
 * recently looked at going first.
 */
const KEPT = 8;

/**
 * Runs `work` once the window has nothing better to do, and returns how to
 * call it off.
 *
 * iOS has no `requestIdleCallback`, so there a short wait stands in for it:
 * enough to keep the drawing ahead out of the way of the first paint.
 */
function whenIdle(work: () => void): () => void {
	if (typeof window.requestIdleCallback === "function") {
		const idle = window.requestIdleCallback(work, { timeout: 4000 });
		return () => window.cancelIdleCallback(idle);
	}
	const timer = window.setTimeout(work, 200);
	return () => window.clearTimeout(timer);
}

/** Everything a view's shelves are drawn from, as it was when last shown. */
export interface PaneState {
	groups: readonly LibraryGroup[];
	limit: number;
	collapsed: ReadonlySet<string>;
	drawnAs: LibraryLayout;
	cardSize: number;
	scoutFirst: boolean;
	sortBy: LibrarySort;
}

/** How each card is drawn, which the view supplies. */
export type CardRenderer = (
	entry: LibraryEntry,
	layout: LibraryLayout,
	scoutFirst: boolean,
) => React.ReactNode;

/** A view's key: its id, or the whole library's. */
export const paneKey = (viewId: string | null): string => viewId ?? "all";

const NO_FOLDS: ReadonlySet<string> = new Set();

/** The shelves for a saved view, or for All, as opening it would draw them. */
export function paneFor(
	view: SavedView | null,
	entries: readonly LibraryEntry[],
	config: LibraryConfig,
	limit: number,
): PaneState {
	const lens = view ? filtersFromRule(view.rule) : { filters: emptyFilters(), extra: emptyRule() };
	const sortBy = view?.sortBy ?? config.sortBy;
	const groupBy: LibraryGroupBy = view?.groupBy ?? config.groupBy;
	const visible = viewEntries(
		filterEntries(entries, { ...lens.filters, text: "", sortBy, groupBy }, config),
		{ rule: lens.extra, sortBy, ...(view?.limit ? { limit: view.limit } : {}) },
		config,
	);
	const layout = view?.layout ?? config.layout;
	return {
		groups: groupEntries(visible, groupBy, config),
		limit,
		collapsed: NO_FOLDS,
		drawnAs: layout === "board" && groupBy === "none" ? "list" : layout,
		cardSize: view?.cardSize ?? config.cardSize,
		scoutFirst: sortBy === "source-desc" || sortBy === "source-asc" || groupBy === "source",
		sortBy,
	};
}

interface Kept {
	state: PaneState;
	/** Styled once, out of sight, so showing it does not style it for the first time. */
	warm: boolean;
}

/**
 * The panes to draw: every kept view, and the live one.
 *
 * `live` is the view on screen and how it is drawn now. It is kept as it is
 * once the frame is drawn, so leaving it leaves it as it was. `prepare` lists
 * the views worth drawing ahead, with how to work each out; they are drawn one
 * at a time when the window is idle.
 */
export function usePanes(
	liveKey: string | null,
	live: PaneState | null,
	prepare: ReadonlyArray<{ key: string; make: () => PaneState }>,
): {
	panes: Array<{ key: string; state: PaneState; live: boolean; warm: boolean }>;
	kept: (key: string) => PaneState | undefined;
} {
	const store = useRef(new Map<string, Kept>());
	const used = useRef(new Map<string, number>());
	const [, redraw] = useState(0);

	// The live view, kept as drawn, and the oldest let go past the limit.
	useLayoutEffect(() => {
		if (liveKey === null || !live) return;
		store.current.set(liveKey, { state: live, warm: true });
		used.current.set(liveKey, performance.now());
		if (store.current.size <= KEPT) return;
		const oldest = [...used.current.entries()]
			.filter(([key]) => key !== liveKey)
			.sort((a, b) => a[1] - b[1])[0]?.[0];
		if (oldest !== undefined) {
			store.current.delete(oldest);
			used.current.delete(oldest);
			redraw((n) => n + 1);
		}
	});

	// Views that no longer exist are let go.
	const wanted = prepare.map((one) => one.key).join("\n");
	useEffect(() => {
		const keys = new Set(wanted.split("\n"));
		let dropped = false;
		for (const key of [...store.current.keys()]) {
			if (key !== liveKey && !keys.has(key)) {
				store.current.delete(key);
				used.current.delete(key);
				dropped = true;
			}
		}
		if (dropped) redraw((n) => n + 1);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [wanted]);

	// The next view not drawn yet, drawn while nothing else is happening.
	const latest = useRef(prepare);
	latest.current = prepare;
	const cold = [...store.current.values()].some((one) => !one.warm);
	useEffect(() => {
		if (cold || store.current.size >= KEPT) return;
		return whenIdle(() => {
			const next = latest.current.find((one) => !store.current.has(one.key));
			if (!next) return;
			store.current.set(next.key, { state: next.make(), warm: false });
			used.current.set(next.key, 0);
			redraw((n) => n + 1);
		});
	});

	// A view drawn ahead is styled out of sight for a frame, then put away.
	useEffect(() => {
		if (!cold) return;
		let second = 0;
		const first = window.requestAnimationFrame(() => {
			second = window.requestAnimationFrame(() => {
				for (const one of store.current.values()) one.warm = true;
				redraw((n) => n + 1);
			});
		});
		return () => {
			window.cancelAnimationFrame(first);
			window.cancelAnimationFrame(second);
		};
	}, [cold]);

	const panes: Array<{ key: string; state: PaneState; live: boolean; warm: boolean }> = [];
	for (const [key, one] of store.current) {
		if (key === liveKey && live) panes.push({ key, state: live, live: true, warm: true });
		else panes.push({ key, state: one.state, live: false, warm: one.warm });
	}
	if (liveKey !== null && live && !store.current.has(liveKey)) {
		panes.push({ key: liveKey, state: live, live: true, warm: true });
	}
	return { panes, kept: (key) => store.current.get(key)?.state };
}

/** One view's shelves, in a box that is shown, put away, or being styled ahead. */
export const Pane = React.memo(function Pane({
	shown,
	warm,
	children,
}: {
	shown: boolean;
	warm: boolean;
	children: React.ReactNode;
}): React.ReactElement {
	const state = shown ? "is-shown" : warm ? "is-kept" : "is-warming";
	return (
		<div className={`scout-pane ${state}`} aria-hidden={shown ? undefined : true}>
			{children}
		</div>
	);
});

/** A view's shelves, cut to the window that is drawn. */
export const Shelves = React.memo(function Shelves({
	ctx,
	state,
	card,
	onToggleFold,
	onSort,
	onOpen,
	onMenu,
}: {
	ctx: ScoutContext;
	state: PaneState;
	card: CardRenderer;
	onToggleFold: (key: string) => void;
	onSort: (next: LibrarySort) => void;
	onOpen: (entry: LibraryEntry, event?: React.MouseEvent) => void;
	onMenu: (entry: LibraryEntry, event: React.MouseEvent) => void;
}): React.ReactElement {
	const { groups, limit, collapsed, drawnAs, cardSize, scoutFirst, sortBy } = state;
	const shelves = useMemo(() => cutShelves(groups, limit, collapsed), [groups, limit, collapsed]);

	if (drawnAs === "board") {
		return <Board groups={groups} card={(entry) => card(entry, "board", scoutFirst)} />;
	}
	return (
		<>
			{shelves.map((group) => {
				const folded = collapsed.has(group.key);
				return (
					<section key={group.key} className={`scout-group${folded ? " is-folded" : ""}`}>
						{group.label && (
							<button
								className="scout-group-title"
								aria-expanded={!folded}
								onClick={() => onToggleFold(group.key)}
							>
								<Icon name="chevron-down" size={14} />
								{group.label}
								<span className="scout-count">{group.total}</span>
							</button>
						)}
						{folded ? null : drawnAs === "table" ? (
							<EntryTable
								ctx={ctx}
								entries={group.entries}
								sortBy={sortBy}
								onSort={onSort}
								onOpen={onOpen}
								onMenu={onMenu}
							/>
						) : (
							<div
								className={`scout-entries scout-entries-${drawnAs}`}
								// Only the size: the columns are the stylesheet's, so a
								// phone can set its own count without fighting this.
								style={
									drawnAs === "grid"
										? ({ "--scout-card-size": `${cardSize}px` } as React.CSSProperties)
										: undefined
								}
							>
								{group.entries.map((entry) => card(entry, drawnAs, scoutFirst))}
							</div>
						)}
					</section>
				);
			})}
		</>
	);
});

/**
 * The shelves as far as the window reaches. The headings keep their real
 * counts, because "Horror 59" is a fact about the library and not about how
 * far down the page you have got.
 */
export function cutShelves(
	groups: readonly LibraryGroup[],
	limit: number,
	collapsed: ReadonlySet<string>,
): Array<{ key: string; label: string; total: number; entries: readonly LibraryEntry[] }> {
	const out: Array<{ key: string; label: string; total: number; entries: readonly LibraryEntry[] }> = [];
	let room = limit;
	for (const group of groups) {
		if (room <= 0) break;
		if (collapsed.has(group.key)) {
			out.push({ key: group.key, label: group.label, total: group.entries.length, entries: [] });
			continue;
		}
		out.push({
			key: group.key,
			label: group.label,
			total: group.entries.length,
			entries: group.entries.length <= room ? group.entries : group.entries.slice(0, room),
		});
		room -= group.entries.length;
	}
	return out;
}
