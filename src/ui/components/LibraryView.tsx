import { Menu, Notice, Platform } from "obsidian";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ScoutContext } from "../../core/context";
import {
	admits,
	collectionNames,
	isMember,
	withCollection,
	withoutCollection,
} from "../../core/library/collections";
import {
	allStatuses,
	ratingScaleFor,
	statusesFor,
	LAYOUT_LABELS,
	LIBRARY_LAYOUTS,
	type LibraryGroupBy,
	type LibraryLayout,
	type LibrarySort,
} from "../../core/library/config";
import type { LibraryEntry } from "../../core/library/entry";
import { scoutOfEntry } from "../../core/scout-score";
import { suggestedName, type Preset } from "../../core/library/chips";
import {
	filterEntries,
	groupEntries,
	libraryStats,
	type LibraryQuery,
} from "../../core/library/filter";
import {
	emptyFilters,
	filtersFromRule,
	lensRule,
	sameFilters,
	type LensFilters,
} from "../../core/library/lens";
import { activeFilterCount } from "../../core/library/query";
import { releaseCountdown } from "../../core/library/release";
import { emptyRule, ruleIsEmpty, type RuleGroup } from "../../core/library/rules";
import { emptyView, viewEntries, type SavedView } from "../../core/library/views";
import {
	MEDIA_KIND_LABELS,
	MEDIA_KIND_PLURALS,
	type MediaKind,
} from "../../core/types";
import { addToCollection } from "../collections";
import { promptModal } from "../confirm";
import { ScoutDetailModal } from "../detailModal";
import { ScoutImportModal } from "../importModal";
import type { LibraryFocus } from "../libraryView";
import { ScoutOrganiseModal } from "../organiseModal";
import { ScoutSearchModal } from "../searchModal";
import MediaCard from "./Card";
import { FilterBar, type SaveState } from "./library/FilterBar";
import { AiNoteLine, SparkleButton, useLibraryAsk } from "./library/AskSparkle";
import { DisplayButton, LAYOUT_ICONS, OrderPills } from "./library/OrderPills";
import {
	cutShelves,
	Pane,
	paneFor,
	paneKey,
	Shelves,
	usePanes,
	type CardRenderer,
	type PaneState,
} from "./library/Panes";
import { SourceRating } from "./library/EntryTable";
import { entryMainGenres } from "../../core/genres/genres";
import CollectionsPage from "./Collections";
import Rating, { formatRating } from "./Rating";
import StatusBadge, {
	progressFraction,
	statusClass,
	statusIconName,
} from "./Status";
import {
	Icon,
	KIND_ICONS,
	resolveImage,
	useDebounced,
	useLibraryEntries,
	useRenderWindow,
	useSettingsVersion,
} from "./shared";

/**
 * The library.
 *
 * Reads entirely from the index, which reads entirely from the vault — there
 * is no separate database, so a note edited by hand, by Dataview, or on
 * another device shows up here with no sync step.
 */

/**
 * How many cards go in at a time.
 *
 * Comfortably more than a tall screen of the smallest grid, so the first page
 * is never the whole of what you can see — the point is that the widening
 * happens out of sight, not that the list is short.
 */
const PAGE = 120;

/** The grid's gap, as `.scout-entries-grid` sets it. */
const GRID_GAP = 14;
/** A card's title, meta line and foot, under its 2:3 cover. */
const CARD_TEXT = 80;
/**
 * A phone's grid is three across whatever the card size says, as
 * `body.is-phone .scout-library .scout-entries-grid` sets it — the size is a
 * desktop preference, and on a phone it would mean one card or two.
 */
const PHONE_COLUMNS = 3;
/** A list row, at its tallest. */
const LIST_ROW = 64;

/**
 * Roughly how many cards fill the view, with a row to spare.
 *
 * Over rather than under: a card short shows an empty corner for a frame, a
 * card over costs one card. A table or board, or a view not measured yet, has
 * the whole first page.
 */
function screenful(layout: LibraryLayout, cardSize: number, room: Room | null): number {
	if (!room || room.width <= 0) return PAGE;
	if (layout === "list") return Math.ceil(room.height / LIST_ROW) + 2;
	if (layout !== "grid") return PAGE;
	const columns = Platform.isPhone
		? PHONE_COLUMNS
		: Math.max(1, Math.floor((room.width + GRID_GAP) / (cardSize + GRID_GAP)));
	const cardWidth = (room.width - (columns - 1) * GRID_GAP) / columns;
	const row = cardWidth * 1.5 + CARD_TEXT + GRID_GAP;
	return columns * (Math.ceil(room.height / row) + 1);
}

interface Room {
	width: number;
	height: number;
}

/**
 * How much room the list has: its width, and the height of the window it is
 * in, which is as much of it as can be on screen. Watched rather than measured
 * on a switch, so a switch never waits on a layout to find out.
 */
function useRoom(): [Room | null, (el: HTMLElement | null) => void] {
	const [room, setRoom] = useState<Room | null>(null);
	const watcher = useRef<ResizeObserver | null>(null);
	useEffect(() => () => watcher.current?.disconnect(), []);
	const measure = useCallback((el: HTMLElement | null) => {
		watcher.current?.disconnect();
		watcher.current = null;
		if (!el) return;
		const view = el.ownerDocument.defaultView;
		const observer = new ResizeObserver((records) => {
			const box = records[records.length - 1]?.contentRect;
			if (!box) return;
			const next = { width: Math.round(box.width), height: view?.innerHeight ?? 0 };
			setRoom((was) =>
				was && was.width === next.width && was.height === next.height ? was : next,
			);
		});
		observer.observe(el);
		watcher.current = observer;
	}, []);
	return [room, measure];
}

export interface LibraryViewProps {
	ctx: ScoutContext;
	/** A narrowing asked for from elsewhere; a new nonce applies it again. */
	focus?: { query: LibraryFocus; nonce: number } | null;
}

export default function LibraryView({
	ctx,
	focus,
}: LibraryViewProps): React.ReactElement {
	/**
	 * The config object is edited in place, so its identity says nothing about
	 * whether it has changed — the version counter is what the memos and the
	 * cards below hang on instead.
	 */
	const version = useSettingsVersion(ctx.settings);
	const entries = useLibraryEntries(ctx.library);
	const config = ctx.settings.library();

	/**
	 * What is on screen: the filters, the conditions from the rule editor the
	 * chips cannot show, and the order. A saved view is this with a name, and
	 * opening one loads it here — so a view is edited where it is looked at.
	 */
	const [filters, setFilters] = useState<LensFilters>(emptyFilters);
	const [extra, setExtra] = useState<RuleGroup>(emptyRule);
	const [sortBy, setSortBy] = useState<LibrarySort>(config.sortBy);
	const [groupBy, setGroupBy] = useState<LibraryGroupBy>(config.groupBy);
	const scoutFirst =
		sortBy === "source-desc" || sortBy === "source-asc" || groupBy === "source";
	const [text, setText] = useState("");
	const debouncedText = useDebounced(text, 180);

	const effective = useMemo<LibraryQuery>(
		() => ({ ...filters, text: debouncedText, sortBy, groupBy }),
		[filters, debouncedText, sortBy, groupBy],
	);

	const views = ctx.settings.views();
	const [activeId, setActiveId] = useState<string | null>(null);
	const active = views.find((view) => view.id === activeId) ?? null;
	const layout = active?.layout ?? config.layout;

	/** The view as saved, read into filters — what "changed" is measured against. */
	const activeRule = active?.rule;
	const base = useMemo(() => (activeRule ? filtersFromRule(activeRule) : null), [activeRule]);

	/**
	 * Whether there is something to keep. On a view, any difference from what
	 * it saved; on All, any filter at all — All always opens as the whole
	 * library, so a filter there is gone when you leave unless it is saved.
	 */
	const save: SaveState = active
		? base &&
			(!sameFilters(filters, base.filters) ||
				JSON.stringify(extra) !== JSON.stringify(base.extra) ||
				sortBy !== active.sortBy ||
				groupBy !== active.groupBy)
			? "edited"
			: "none"
		: activeFilterCount(filters) > 0 || !ruleIsEmpty(extra)
			? "new"
			: "none";
	const dirty = save !== "none";

	/**
	 * Collections have a tab of their own rather than a chip each on the bar.
	 * They are the other page of the library, not a second row of views.
	 */
	const [page, setPage] = useState<"library" | "collections">("library");

	/**
	 * What is written down, and what is not.
	 *
	 * Sort, grouping and layout are settings: changed on a view they belong to
	 * that view, changed on All they are the library's own defaults, and either
	 * way they are saved as you set them. They describe how you like to look at
	 * things, and asking again every session would be tedious.
	 *
	 * Filters — the box, the three dropdowns, the favourites toggle — are not,
	 * and on All they never can be. They are a question you are asking right
	 * now, and a question that answers itself again tomorrow is a library that
	 * has quietly hidden most of itself. A view is where a narrowing is meant
	 * to be kept, which is what "New view" and the tab menu's fold are for; All
	 * is the one tab that must always mean the whole library when you open it.
	 */
	const loadLens = (view: SavedView | null) => {
		if (view) {
			const parsed = filtersFromRule(view.rule);
			setFilters(parsed.filters);
			setExtra(parsed.extra);
			setSortBy(view.sortBy);
			setGroupBy(view.groupBy);
		} else {
			setFilters(emptyFilters());
			setExtra(emptyRule());
			setSortBy(config.sortBy);
			setGroupBy(config.groupBy);
		}
	};

	/** A named set of notes from elsewhere — a thread — narrowing whatever else is set. */
	const [scope, setScope] = useState<{ label: string; paths: ReadonlySet<string> } | null>(null);

	const applyView = (view: SavedView | null) => {
		setScope(null);
		aiAsk.setLine(null);
		setActiveId(view?.id ?? null);
		setPage("library");
		setText("");
		loadLens(view);
	};

	// Opened from elsewhere with a question — a genre, a person — to answer
	// against the whole library rather than whatever tab was last open.
	const applyFocus = (query: LibraryFocus) => {
		const { text: words, scope: named, note, ...narrowing } = query;
		setScope(named ? { label: named.label, paths: new Set(named.paths) } : null);
		setActiveId(null);
		setPage("library");
		setText(words ?? "");
		setFilters({ ...emptyFilters(), ...narrowing });
		setExtra(emptyRule());
		aiAsk.setLine(note ? { summary: note.summary, unknown: note.unknown } : null);
	};
	// The search box's sparkle: the typed words as filters, here and now.
	const aiAsk = useLibraryAsk(ctx, applyFocus);
	const focusNonce = focus?.nonce;
	useEffect(() => {
		if (focus) applyFocus(focus.query);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [focusNonce]);

	/**
	 * A view edited somewhere else — its conditions in the organise dialog, or
	 * saved from here — is loaded again, so the chips show what it now says.
	 */
	const saved = active
		? JSON.stringify([active.id, active.rule, active.sortBy, active.groupBy])
		: null;
	const lastSaved = useRef<string | null>(null);
	useEffect(() => {
		if (saved !== null && lastSaved.current !== null && lastSaved.current !== saved) {
			loadLens(active);
		}
		lastSaved.current = saved;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [saved]);

	/** The filters, then the conditions only the rule editor can show. */
	const visible = useMemo(
		() =>
			viewEntries(
				filterEntries(
					scope ? entries.filter((entry) => scope.paths.has(entry.path)) : entries,
					effective,
					config,
				),
				{
					rule: extra,
					sortBy,
					...(active?.limit ? { limit: active.limit } : {}),
				},
				config,
			),
		[entries, scope, effective, extra, sortBy, config, version, active?.limit],
	);

	const groups = useMemo(
		() => groupEntries(visible, groupBy, config),
		[visible, groupBy, config, version],
	);

	/**
	 * Only as much of it as anybody is looking at.
	 *
	 * The window widens as you reach the bottom; the shelf headings keep their
	 * real counts, because "Horror 59" is a fact about the library and not about
	 * how far down the page you have got.
	 */
	/** Shelves folded shut, by key — opened again when the grouping changes. */
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	useEffect(() => setCollapsed(new Set()), [groupBy]);
	const toggleFold = useCallback(
		(key: string) =>
			setCollapsed((was) => {
				const next = new Set(was);
				if (next.has(key)) next.delete(key);
				else next.add(key);
				return next;
			}),
		[],
	);

	/** A board needs groups to make columns of; ungrouped, it is a list. */
	const drawnAs: LibraryLayout = layout === "board" && groupBy === "none" ? "list" : layout;
	const cardSize = active?.cardSize ?? config.cardSize;

	/**
	 * Back to the first page when the question changes, not when the answer
	 * does. Keyed on the groups, any change to the library — a score filed in
	 * the background, a film opened and its outlook filed again — dropped
	 * everything past the first page and threw the scroll back up the list.
	 */
	const question = useMemo(
		() => JSON.stringify([effective, extra, activeId, active?.limit ?? null, scope?.label ?? null]),
		[effective, extra, activeId, active?.limit, scope],
	);
	const [room, measureRoom] = useRoom();

	/**
	 * Every view already drawn, kept in the page, and the saved views drawn
	 * ahead while the window is idle; see `usePanes`. Only a view as it was
	 * saved is drawn ahead, which is what opening it shows.
	 */
	const liveKey = page === "library" && visible.length > 0 ? paneKey(activeId) : null;
	const prepare = useMemo(
		() =>
			[null, ...views].map((view) => ({
				key: paneKey(view?.id ?? null),
				make: () => paneFor(view, entries, config, PAGE),
			})),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[views, entries, config, version],
	);
	const keptPanes = useRef<(key: string) => PaneState | undefined>(() => undefined);
	const keptLimit = liveKey === null ? undefined : keptPanes.current(liveKey)?.limit;

	const [limit, sentinel] = useRenderWindow(
		question,
		PAGE,
		// A view already drawn opens as long as it was, so none of it is
		// taken out and put back.
		keptLimit ?? screenful(drawnAs, cardSize, room),
	);
	const livePane = useMemo<PaneState>(
		() => ({ groups, limit, collapsed, drawnAs, cardSize, scoutFirst, sortBy }),
		[groups, limit, collapsed, drawnAs, cardSize, scoutFirst, sortBy],
	);
	const { panes, kept } = usePanes(liveKey, liveKey === null ? null : livePane, prepare);
	keptPanes.current = kept;
	const drawn = useMemo(
		() => cutShelves(groups, limit, collapsed).reduce((sum, shelf) => sum + shelf.entries.length, 0),
		[groups, limit, collapsed],
	);
	const held = groups.reduce((sum, group) => sum + group.entries.length, 0);

	const stats = useMemo(
		() => libraryStats(visible, config),
		[visible, config, version],
	);

	const collections = useMemo(
		() => collectionNames(entries, ctx.settings.collections()),
		[entries, ctx.settings, version],
	);

	/** Only the number, for the tab. The page itself works the rest out. */
	const shelfCount = collections.length;

	/**
	 * The starter views, once.
	 *
	 * The library used to open with a row of type pills — All, Films, TV,
	 * Books — which was a views bar that could not be named, reordered, given
	 * conditions or thrown away. They are seeded as ordinary views instead, for
	 * the types the vault actually holds, and from then on they are yours: two
	 * of them deleted stay deleted.
	 */
	useEffect(() => {
		if (ctx.settings.viewsSeeded() || entries.length === 0) return;
		const counts = new Map<MediaKind, number>();
		for (const entry of entries) {
			counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
		}
		const seeds = [...counts.entries()]
			.filter(([, count]) => count > 0)
			.sort((a, b) => b[1] - a[1])
			.map(([kind]) => ({
				...emptyView(config, MEDIA_KIND_PLURALS[kind]),
				icon: KIND_ICONS[kind],
				rule: {
					match: "all" as const,
					conditions: [{ field: "kind" as const, op: "is" as const, value: kind }],
					groups: [],
				},
			}));
		// One type is no choice at all, and a bar with a single tab on it says
		// less than no bar.
		ctx.settings.seedViews(seeds.length > 1 ? seeds : []);
	}, [entries, config, ctx.settings]);

	const statuses = useMemo(() => {
		const configured = allStatuses(config);
		const seen = new Set(configured.map((s) => s.toLowerCase()));
		// Statuses written by hand belong in the filter too, or the entries
		// carrying them cannot be found.
		for (const entry of entries) {
			if (entry.status && !seen.has(entry.status.toLowerCase())) {
				seen.add(entry.status.toLowerCase());
				configured.push(entry.status);
			}
		}
		return configured;
	}, [config, entries, version]);

	const patch = (next: Partial<LensFilters>) =>
		setFilters((current) => ({ ...current, ...next }));

	const applyPreset = (preset: Preset) => {
		setFilters({ ...emptyFilters(), ...preset.filters });
		setExtra(emptyRule());
		setSortBy(preset.sortBy);
		setGroupBy(preset.groupBy);
	};

	/**
	 * A view that pins a layout owns the toggle while it is on: switching would
	 * otherwise write a preference the next click of the view tab undoes.
	 */
	const setLayout = (next: LibraryLayout) => {
		if (active?.layout) ctx.settings.saveView({ ...active, layout: next });
		else ctx.settings.setLibrary("layout", next);
		// A board of one column is a list: give it the columns it is for.
		if (next === "board" && groupBy === "none") setOrder({ groupBy: "tone" });
	};

	/**
	 * On All, the sort and grouping you pick are the library's defaults and are
	 * kept as you set them. On a view they are part of the view, kept when you
	 * save it like the filters are.
	 */
	const setOrder = (next: { sortBy?: LibrarySort; groupBy?: LibraryGroupBy }) => {
		if (next.sortBy) setSortBy(next.sortBy);
		if (next.groupBy) setGroupBy(next.groupBy);
		if (active) return;
		if (next.sortBy) ctx.settings.setLibrary("sortBy", next.sortBy);
		if (next.groupBy) ctx.settings.setLibrary("groupBy", next.groupBy);
	};

	/** What is on screen, as a new view. */
	const saveAsView = async () => {
		const name = await promptModal(ctx.app, {
			title: "Save as view",
			placeholder: "On the go, Films to watch, Best of the year…",
			value: suggestedName(filters),
			confirmText: "Save",
		});
		if (!name) return;
		const view: SavedView = {
			...emptyView(config, name),
			...(active
				? {
						icon: active.icon,
						layout: active.layout,
						...(active.cardSize ? { cardSize: active.cardSize } : {}),
						...(active.limit ? { limit: active.limit } : {}),
					}
				: {}),
			rule: lensRule(filters, extra),
			sortBy,
			groupBy,
		};
		ctx.settings.saveView(view);
		setActiveId(view.id);
	};

	/** The changes, into the view they were made on. */
	const saveEdits = () => {
		if (!active) return;
		ctx.settings.saveView({ ...active, rule: lensRule(filters, extra), sortBy, groupBy });
		new Notice(`Saved "${active.name}".`);
	};

	const rename = async (view: SavedView) => {
		const name = await promptModal(ctx.app, {
			title: "Rename view",
			value: view.name,
			confirmText: "Rename",
		});
		if (!name || name === view.name) return;
		ctx.settings.saveView({ ...view, name });
	};

	/**
	 * A tab's own menu.
	 *
	 * On the right-click, and on a second click of the tab you are already on —
	 * because a right-click is not a gesture a phone has, and clicking the tab
	 * you are looking at otherwise does nothing at all.
	 */
	const viewMenu = (view: SavedView, event: React.MouseEvent) => {
		event.preventDefault();
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Rename…")
				.setIcon("pencil")
				.onClick(() => void rename(view)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Conditions and layout…")
				.setIcon("settings-2")
				.onClick(() =>
					new ScoutOrganiseModal(ctx, {
						tab: "views",
						select: view.id,
					}).open(),
				),
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Delete view")
				.setIcon("trash-2")
				.onClick(() => {
					ctx.settings.removeView(view.id);
					if (activeId === view.id) applyView(null);
				}),
		);
		menu.showAtMouseEvent(event.nativeEvent);
	};

	const openEntry = (entry: LibraryEntry, event?: React.MouseEvent) => {
		const modifier = event?.ctrlKey || event?.metaKey;
		if (modifier || !config.openDetailOnClick) {
			void ctx.mutator.open(entry, modifier ? true : undefined);
			return;
		}
		new ScoutDetailModal(ctx, { entryPath: entry.path }).open();
	};

	const contextMenu = (entry: LibraryEntry, event: React.MouseEvent) => {
		event.preventDefault();
		const menu = new Menu();

		menu.addItem((i) =>
			i
				.setTitle("Open note")
				.setIcon("file-text")
				.onClick(() => void ctx.mutator.open(entry)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Open in new tab")
				.setIcon("plus-square")
				.onClick(() => void ctx.mutator.open(entry, true)),
		);
		menu.addItem((i) =>
			i
				.setTitle("Show details")
				.setIcon("info")
				.onClick(() =>
					new ScoutDetailModal(ctx, { entryPath: entry.path }).open(),
				),
		);

		menu.addSeparator();
		for (const status of statusesFor(config, entry.kind)) {
			const on =
				(entry.status ?? "").toLowerCase() === status.toLowerCase();
			menu.addItem((i) =>
				i
					.setTitle(status)
					// The same glyph the badge uses, so a status is recognisable
					// here without reading the word.
					.setIcon(statusIconName(config, status))
					.setChecked(on)
					// Picking the status already set clears it, matching what the
					// buttons in the detail dialog do.
					.onClick(() =>
						void ctx.mutator.setStatus(entry, on ? null : status),
					),
			);
		}

		// Checked rather than two lists of "add to" and "remove from": the
		// question is which shelves this is on, and the answer is one glance.
		const defined = ctx.settings.collections();
		if (defined.length > 0) {
			menu.addSeparator();
			for (const collection of defined) {
				const on = isMember(entry, collection);
				// A collection with a rule is a shelf with a doorman: you still
				// pick what goes on it, but only from what the rule allows.
				const allowed = on || admits(entry, collection, config);
				menu.addItem((i) =>
					i
						.setTitle(
							allowed
								? collection.name
								: `${collection.name} — does not qualify`,
						)
						.setIcon(collection.icon)
						.setChecked(on)
						.setDisabled(!allowed)
						.onClick(() => {
							void ctx.mutator.setCollections(
								entry,
								on
									? withoutCollection(entry, collection)
									: withCollection(entry, collection),
							);
							// A rule cannot put back what you took out by hand.
							if (on && collection.auto) {
								ctx.settings.saveCollection({
									...collection,
									excluded: [
										...new Set([
											...collection.excluded,
											entry.path,
										]),
									],
								});
							}
						}),
				);
			}
		}

		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle(
					entry.favorite
						? "Remove from favourites"
						: "Add to favourites",
				)
				.setIcon("heart")
				.onClick(() => void ctx.mutator.toggleFavorite(entry)),
		);
		// The background refresh gets round to everything eventually; this is
		// for when you know something has changed and would rather not wait.
		menu.addItem((i) =>
			i
				.setTitle("Refresh from source")
				.setIcon("refresh-cw")
				.setDisabled(!entry.ref)
				.onClick(() => void refreshOne(ctx, entry)),
		);

		menu.showAtMouseEvent(event.nativeEvent);
	};

	/**
	 * The two handlers every card is given, as one identity for the life of the
	 * view.
	 *
	 * Both close over half the component, so they are rebuilt on every render —
	 * and a card handed a new function is a card React has to draw again, which
	 * is the whole library redrawn because somebody typed a letter. The ref is
	 * what lets the cards hold still while the handlers stay current.
	 */
	const handlers = useRef({ open: openEntry, menu: contextMenu });
	handlers.current.open = openEntry;
	handlers.current.menu = contextMenu;
	const onOpen = useCallback(
		(entry: LibraryEntry, event?: React.MouseEvent) =>
			handlers.current.open(entry, event),
		[],
	);
	const onMenu = useCallback(
		(entry: LibraryEntry, event: React.MouseEvent) =>
			handlers.current.menu(entry, event),
		[],
	);
	const sortHandler = useRef(setOrder);
	sortHandler.current = setOrder;
	const onSort = useCallback((next: LibrarySort) => sortHandler.current({ sortBy: next }), []);
	const card = useCallback<CardRenderer>(
		(entry, drawnLayout, firstScout) => (
			<EntryCard
				key={entry.path}
				ctx={ctx}
				entry={entry}
				layout={drawnLayout}
				scoutFirst={firstScout}
				version={version}
				onOpen={onOpen}
				onMenu={onMenu}
			/>
		),
		[ctx, version, onOpen, onMenu],
	);

	return (
		<div className="scout-library">
			{/* The views bar. One tab per saved question, and the library itself
			    is the first of them — "All" is a view like any other, it just
			    happens to be the one nobody had to make. */}
			<div className="scout-view-bar" role="tablist" aria-label="Views">
				<button
					role="tab"
					aria-selected={active === null}
					className={active === null ? "is-on" : ""}
					title={
						active === null && dirty
							? "The whole library — click again to clear the filters. Nothing here is saved; use “New view” to keep it."
							: "The whole library"
					}
					onClick={() => applyView(null)}
				>
					<Icon name="library-big" size={14} />
					All
					{/* The same dot a narrowed view gets, and here it is doing
					    more work: on All it is the only thing that says the
					    filters are temporary. */}
					{page === "library" && active === null && dirty && (
						<span
							className="scout-view-dirty"
							aria-label="Filtered, and not saved"
							title="These filters are not saved — press “New view” to keep them"
						/>
					)}
				</button>
				{views.map((view) => (
					<button
						key={view.id}
						role="tab"
						aria-selected={view.id === activeId}
						className={view.id === activeId ? "is-on" : ""}
						title={
							view.id === activeId
								? `${view.name} — click again to rename or edit`
								: ruleIsEmpty(view.rule)
									? view.name
									: `${view.name} — with conditions`
						}
						onClick={(event) =>
							view.id === activeId
								? viewMenu(view, event)
								: applyView(view)
						}
						onContextMenu={(event) => viewMenu(view, event)}
					>
						<Icon name={view.icon} size={14} />
						{view.name}
						{view.id === activeId && dirty && (
							<span
								className="scout-view-dirty"
								aria-label="Changed, not saved"
								title="Changed since it was saved"
							/>
						)}
					</button>
				))}
				<button
					className="scout-view-save"
					title="Save what is shown as a new view"
					onClick={() => void saveAsView()}
				>
					<Icon name="plus" size={14} />
					New view
				</button>
				{/* One tab, past the divider, rather than a chip per collection.
				    A shelf you made is worth as much of the screen as a rule is
				    — but as a row of chips they turned the views bar into two
				    tab systems sharing a line, and the line grew with every
				    shelf. They get a page instead. */}
				<span className="scout-view-split" aria-hidden="true" />
				<button
					role="tab"
					aria-selected={page === "collections"}
					className={`scout-view-shelves${
						page === "collections" ? " is-on" : ""
					}`}
					title="Sets you keep by hand, or by rule"
					onClick={() => setPage("collections")}
				>
					<Icon name="layers" size={14} />
					Collections
					{shelfCount > 0 && (
						<span className="scout-count">{shelfCount}</span>
					)}
				</button>
				<button
					className="scout-view-manage"
					aria-label="Views and collections"
					title="Views and collections"
					onClick={() => new ScoutOrganiseModal(ctx).open()}
				>
					<Icon name="settings-2" size={14} />
				</button>
			</div>

			{page === "collections" ? (
				<CollectionsPage
					ctx={ctx}
					entries={entries}
					version={version}
					onShow={(name) => {
						// Straight back to the shelf, showing that collection and
						// nothing else — which is what clicking one is asking for.
						setPage("library");
						setActiveId(null);
						setText("");
						setFilters({ ...emptyFilters(), collections: [name] });
						setExtra(emptyRule());
					}}
				/>
			) : (
				<>
				{/* One strip: the box you type in, the dropdowns that narrow it, and
				    the two controls that are not filters at all, pushed to the far
				    end. The dropdowns used to have a line of their own, which spent a
				    whole row on five controls that fit beside the search box. */}
				<div className="scout-library-toolbar">
					<div className={`scout-search-wrap${text && ctx.assistant.ready() ? " has-ai" : ""}`}>
						<Icon name="search" />
						<input
							type="text"
							className="scout-library-search"
							placeholder="Filter your library…"
							value={text}
							aria-label="Filter the library"
							onChange={(e) => setText(e.target.value)}
						/>
						{text && ctx.assistant.ready() && (
							<SparkleButton busy={aiAsk.busy} onClick={() => void aiAsk.ask(text)} />
						)}
						{text && (
							<button
								className="scout-clear"
								aria-label="Clear filter"
								onClick={() => setText("")}
							>
								<Icon name="x" />
							</button>
						)}
					</div>

					{Platform.isPhone ? (
						<DisplayButton
							layout={layout}
							sortBy={sortBy}
							groupBy={groupBy}
							onLayout={setLayout}
							onSort={(next) => setOrder({ sortBy: next })}
							onGroup={(next) => setOrder({ groupBy: next })}
						/>
					) : (
						<OrderPills
							sortBy={sortBy}
							groupBy={groupBy}
							onSort={(next) => setOrder({ sortBy: next })}
							onGroup={(next) => setOrder({ groupBy: next })}
						/>
					)}

					<button
						className="mod-cta scout-add"
						onClick={() => new ScoutSearchModal(ctx).open()}
					>
						<Icon name="plus" />
						<span className="scout-add-label">Add</span>
					</button>

					{!Platform.isPhone && (
						<div className="scout-layout-toggle" role="group" aria-label="Layout">
							{LIBRARY_LAYOUTS.map((option) => (
								<button
									key={option}
									className={layout === option ? "is-on" : ""}
									aria-pressed={layout === option}
									aria-label={`${LAYOUT_LABELS[option]} layout`}
									title={LAYOUT_LABELS[option]}
									onClick={() => setLayout(option)}
								>
									<Icon name={LAYOUT_ICONS[option]} />
								</button>
							))}
						</div>
					)}
				</div>

				<AiNoteLine line={aiAsk.line} onDismiss={() => aiAsk.setLine(null)} />

				<FilterBar
					entries={entries}
					config={config}
					filters={filters}
					extra={extra}
					statuses={statuses}
					collections={collections}
					showPresets={active === null}
					save={save}
					onChange={patch}
					onPreset={applyPreset}
					onEditExtra={() =>
						active
							? new ScoutOrganiseModal(ctx, { tab: "views", select: active.id }).open()
							: new ScoutOrganiseModal(ctx).open()
					}
					onClearExtra={() => setExtra(emptyRule())}
					scope={scope?.label ?? null}
					onClearScope={() => setScope(null)}
					onSave={saveEdits}
					onSaveNew={() => void saveAsView()}
					onRevert={() => loadLens(active)}
				/>

				<div
					className={`scout-library-body${drawnAs === "board" ? " is-board" : ""}`}
					ref={measureRoom}
				>
					{entries.length === 0 ? (
						<EmptyLibrary ctx={ctx} />
					) : visible.length === 0 ? (
						<p className="scout-message">
							Nothing matches those filters.
						</p>
					) : null}
					{panes.map((pane) => (
						<Pane key={pane.key} shown={pane.live} warm={pane.warm}>
							<Shelves
								ctx={ctx}
								state={pane.state}
								card={card}
								onToggleFold={toggleFold}
								onSort={onSort}
								onOpen={onOpen}
								onMenu={onMenu}
							/>
						</Pane>
					))}
					{/* Re-keyed so a fresh observer watches it after each widening. */}
					{drawnAs !== "board" && drawn < held && (
						<div
							key={limit}
							ref={sentinel}
							className="scout-more"
							aria-hidden="true"
						/>
					)}
				</div>

				{/* Under the list, not over it. Four small numbers about what you are
				    looking at are worth having and worth nobody's first glance; at
				    the top they sat between the controls and the shelf. */}
				{config.showStats && entries.length > 0 && (
					<div className="scout-stats scout-stats-foot">
						<span>
							<strong>{stats.total}</strong> shown
						</span>
						{stats.inProgress > 0 && (
							<span>
								<strong>{stats.inProgress}</strong> in progress
							</span>
						)}
						{stats.finished > 0 && (
							<span>
								<strong>{stats.finished}</strong> finished
							</span>
						)}
						{stats.averageRating !== null && (
							<span>
								<strong>
									{formatRating(
										Math.round(stats.averageRating * 10) / 10,
									)}
								</strong>{" "}
								/ {config.ratingScale} average
							</span>
						)}
						{stats.favorites > 0 && (
							<span>
								<strong>{stats.favorites}</strong> favourites
							</span>
						)}
					</div>
				)}
			</>
			)}
		</div>
	);
}

/** One note, asked about now. Says what happened, because nothing else will. */
async function refreshOne(
	ctx: ScoutContext,
	entry: LibraryEntry,
): Promise<void> {
	const controller = new AbortController();
	const outcome = await ctx.refresher.refreshOne(entry, controller.signal);
	new Notice(
		outcome === "updated"
			? `Updated "${entry.title}" from its source.`
			: outcome === "unchanged"
				? `"${entry.title}" is already up to date.`
				: `Could not reach the source for "${entry.title}".`,
	);
}

/* ------------------------------------------------------------------- cards */

interface EntryProps {
	ctx: ScoutContext;
	entry: LibraryEntry;
	layout: LibraryLayout;
	/**
	 * The library is ordered or shelved by Scout score, so that is the number
	 * the card shows — your own rating would make the order look random.
	 */
	scoutFirst: boolean;
	onOpen: (entry: LibraryEntry, event?: React.MouseEvent) => void;
	onMenu: (entry: LibraryEntry, event: React.MouseEvent) => void;
}

/**
 * `version` is the settings counter, and it is a prop for one reason: the card
 * reads the config for itself, and the config object is edited in place. Given
 * only the entry, a memoized card would keep its covers after you turned covers
 * off. Given the counter, it redraws exactly when the settings say something
 * different — and not when you type a letter into the filter box.
 */
const EntryCard = React.memo(function EntryCard({
	ctx,
	entry,
	layout,
	scoutFirst,
	onOpen,
	onMenu,
}: EntryProps & { version: number }): React.ReactElement {
	const config = ctx.settings.library();
	// Undefined unless the note actually records how far through it is — that
	// is what decides between a ring and a plain glyph on the status badge, and
	// since the ring says it, the artwork needs no bar underneath saying it
	// again three pixels further down.
	const fraction = progressFraction(entry.progress, entry.progressTotal);
	const countdown = releaseCountdown(entry.releaseDate);
	const score = scoutOfEntry(entry) !== undefined;
	/**
	 * No date at all, which on something nobody has scored either is what an
	 * announcement looks like — a film with a name and nothing else yet. A year
	 * on its own is enough to rule it out, because a year in the past means it
	 * happened whatever else the note is missing.
	 */
	const undated = entry.year === undefined;
	// On the poster in the grid, where the type is otherwise a guess from the
	// artwork; in the metadata line everywhere the poster is too small for it.
	const chipOnArt = config.showCovers && layout === "grid";
	/** Who made it — the director, the author — which a list has room to say. */
	const by = layout === "grid" ? undefined : (entry.authored[0] ?? entry.people[0]);
	const genres = layout === "list" ? entryMainGenres(entry).slice(0, 3) : [];

	return (
		<MediaCard
			title={entry.title}
			kind={entry.kind}
			cover={resolveImage(ctx.app, entry.cover, entry.path)}
			tone={statusClass(config, entry.status)}
			showCover={config.showCovers}
			showKindBadge={chipOnArt}
			favorite={entry.favorite}
			onOpen={(e) => onOpen(entry, e)}
			onMenu={(e) => onMenu(entry, e)}
			overlay={
				// Over the artwork in the grid, where there is room for it;
				// CSS moves it back down beside the rating in list view.
				config.showStatus && entry.status ? (
					<StatusBadge
						config={config}
						status={entry.status}
						progress={fraction}
						className="scout-entry-status"
						size={11}
					/>
				) : undefined
			}
			meta={
				<>
					{MEDIA_KIND_LABELS[entry.kind]}
					{entry.year ? ` · ${entry.year}` : ""}
					{by ? ` · ${by}` : ""}
					{entry.progress !== undefined
						? ` · ${entry.progress}${
								entry.progressTotal
									? `/${entry.progressTotal}`
									: ""
							}`
						: ""}
				</>
			}
			aside={
				genres.length > 0 ? (
					<>
						{genres.map((genre) => (
							<span key={genre} className="scout-entry-genre">
								{genre}
							</span>
						))}
					</>
				) : undefined
			}
			foot={
				<>
					{config.showRatings &&
						(scoutFirst && score ? (
							<SourceRating ctx={ctx} entry={entry} />
						) : entry.rating !== undefined ? (
							<Rating
								value={entry.rating}
								scale={ratingScaleFor(config, entry.kind)}
								step={config.ratingStep}
								icon={config.ratingIcon}
								size={13}
								readOnly
							/>
						) : countdown ? (
							// Nothing has an opinion on a film nobody has seen.
							// When it arrives is the only fact worth the row.
							// One line with its hype: the countdown gives way first.
							// A festival film with reviews in has a Scout score
							// instead, which this shows in the hype's place.
							<span className="scout-entry-soon">
								<span className="scout-entry-countdown">
									<Icon name="calendar-clock" size={12} />
									{countdown}
								</span>
								<SourceRating ctx={ctx} entry={entry} />
							</span>
						) : score ? (
							// Nothing of your own to show yet, which is most of a
							// backlog: what everyone else made of it is the next
							// most useful thing, and it is already in the note.
							<SourceRating ctx={ctx} entry={entry} />
						) : undated ? (
							// Last of all, and the quietest: no score, no date,
							// nothing to count down to. Saying so beats a blank.
							<span className="scout-entry-countdown is-vague">
								<Icon name="calendar-clock" size={12} />
								Release date TBA
							</span>
						) : null)}
					{config.showStatus && entry.status && (
						<StatusBadge
							config={config}
							status={entry.status}
							progress={fraction}
							className="scout-chip-status"
							size={11}
						/>
					)}
				</>
			}
		/>
	);
});

/* ------------------------------------------------------------- empty state */

function EmptyLibrary({ ctx }: { ctx: ScoutContext }): React.ReactElement {
	const config = ctx.settings.library();
	return (
		<div className="scout-empty">
			<Icon name="library-big" />
			<h3>Your library is empty</h3>
			<p>
				Scout lists any note whose <code>{config.fields.kind}</code>{" "}
				property names a media type — <code>movie</code>,{" "}
				<code>book</code>, <code>tv</code>, and so on. Notes it creates
				have one already.
			</p>
			<p className="scout-empty-hint">
				Using different property names? Map them under{" "}
				<strong>Settings → Scout → Library</strong>.
			</p>
			<div className="scout-empty-actions">
				<button
					className="mod-cta"
					onClick={() => new ScoutSearchModal(ctx).open()}
				>
					<Icon name="search" /> Find something to add
				</button>
				<button onClick={() => new ScoutImportModal(ctx).open()}>
					<Icon name="import" /> Import from Letterboxd, Goodreads…
				</button>
			</div>
		</div>
	);
}

