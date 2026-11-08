import { Notice } from "obsidian";
import React, {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ScoutContext } from "../../core/context";
import { assembleScores, hasMore } from "../../core/detail/scores";
import type { DetailResult } from "../../core/detail/service";
import { emptyExtras } from "../../core/detail/types";
import { oneDecimal } from "../../core/format";
import { isAbortError } from "../../core/http";
import { feedbackKey, recordFor } from "../../core/library/feedback";
import { rankReasons, reasonIcon, type Reason } from "../../core/library/reasons";
import { isDetailable } from "../../core/provider";
import type { MediaItem, MediaRef } from "../../core/types";
import { hasEpisodes } from "../episodes";
import { hasProgressCard, ProgressCard, UpNextCard } from "./detail/Cards";
import { EpisodesPane } from "./detail/EpisodesPane";
import { EpisodeToolbar } from "./detail/EpisodeToolbar";
import { Hero } from "./detail/Hero";
import { MediaPane, MorePane } from "./detail/More";
import { linkExtras, peopleToShow, present, recordFrom } from "./detail/present";
import { gridHasScores } from "./detail/RatingsGrid";
import { CreditSkeleton } from "./detail/Skeleton";
import { Tabs } from "./detail/Tabs";
import { TracksPane } from "./detail/Tracks";
import { useEpisodeView } from "./detail/useEpisodeView";
import { useShow } from "./detail/useShow";
import { Where } from "./detail/Where";
import ManagePanel from "./ManagePanel";
import { Icon, resolveImage, useLibraryEntries, useProviderData } from "./shared";

/**
 * One item, in full.
 *
 * The same view serves a search result and a note already in the vault, because
 * they are the same thing at different stages. A header stays put on every tab:
 * the artwork, the facts, the scores, and what you can do. Below it the tabs turn
 * over, and they stick to the top of the dialog as it scrolls.
 */

export interface ItemDetailProps {
	ctx: ScoutContext;
	/** A search result, when opened from the search modal. */
	item?: MediaItem;
	/** A note, when opened from the library. Kept as a path so it stays live. */
	entryPath?: string;
	/** Why the suggestion row put this up, when that is where it came from. */
	reasons?: readonly Reason[];
	onClose: () => void;
}

type TabId = "overview" | "episodes" | "media" | "tracks" | "more";

/** Where the scroll position goes when the tab changes. */
type Settle = "clamp" | "pin";

/** Why the row put this up, in full. Marks against it are shown too. */
function WhyThis({
	reasons,
}: {
	reasons: readonly Reason[] | undefined;
}): React.ReactElement | null {
	if (!reasons || reasons.length === 0) return null;
	const ranked = rankReasons(reasons, 6);
	return (
		<section className="sd-sec scout-detail-why">
			<h3 className="scout-section-title">
				<Icon name="wand-sparkles" size={14} />
				Why this is here
			</h3>
			<ul>
				{ranked.map((one) => (
					<li
						key={`${one.kind}:${one.label}`}
						className={one.against ? "is-against" : undefined}
					>
						<Icon name={reasonIcon(one.kind)} size={13} />
						<span>{one.label}</span>
						{one.against && (
							<span className="scout-detail-why-mark">against</span>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

export default function ItemDetail({
	ctx,
	item,
	entryPath,
	reasons,
	onClose,
}: ItemDetailProps): React.ReactElement {
	// Subscribing keeps the panel live: create a note and the manage controls
	// appear without reopening, edit elsewhere and the values follow.
	useLibraryEntries(ctx.library);

	const [enriched, setEnriched] = useState<MediaItem | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const [tab, setTab] = useState<TabId>("overview");
	const [stuck, setStuck] = useState(false);
	const [, setScrollTick] = useState(0);
	const settle = useRef<Settle | null>(null);
	const pendingScroll = useRef<"yours" | "where" | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const hero = useRef<HTMLDivElement>(null);

	const entry = entryPath
		? ctx.library.byPath(entryPath)
		: item
			? ctx.library.match(item)
			: undefined;

	const shown = enriched ?? item;
	const view = present(shown, entry);

	/**
	 * Search results carry only what the search endpoint returned, so opening the
	 * dialog fetches the full record — for a note as much as for a result, or the
	 * two would show different things about the same item.
	 */
	const source = item?.ref ?? entry?.ref;
	/**
	 * Keyed by value. The index hands back a rebuilt entry on every change,
	 * including the ones this dialog's own writes cause, so keying on `entry.ref`
	 * itself would refetch forever.
	 */
	const sourceKey = source
		? `${source.providerId}:${source.kind}:${source.id}`
		: "";
	const latest = useRef<{ ref?: MediaRef; item?: MediaItem }>({});
	latest.current = { ref: source, item };

	useEffect(() => {
		const { ref: mediaRef, item: previous } = latest.current;
		if (!mediaRef) return;
		const provider = ctx.registry.get(mediaRef.providerId);
		if (!provider || !isDetailable(provider)) return;
		if (!ctx.settings.isProviderEnabled(provider.id)) return;

		const controller = new AbortController();
		void provider
			.details(mediaRef, { signal: controller.signal, previous })
			.then((full) => {
				if (controller.signal.aborted) return;
				setEnriched(full);
			})
			.catch((err) => {
				if (!isAbortError(err)) {
					console.warn("Scout: detail fetch failed", err);
				}
			});
		return () => controller.abort();
	}, [ctx.registry, ctx.settings, sourceKey]);

	const detail = useProviderData<DetailResult>(
		source && view
			? (signal) =>
					ctx.detail.load(source, recordFrom(source, view, shown), signal)
			: null,
		`${sourceKey}:detail`,
	);
	/** What is known of a film not out yet, for its hype: asked afresh, filed for the library. */
	const outlook = useProviderData(
		source && view && ctx.detail.foresees(source, view)
			? (signal) => ctx.detail.outlook(source, signal)
			: null,
		`${sourceKey}:outlook`,
	);
	/** The source has been asked and has yet to answer. */
	const loading = detail.loading && !detail.data;
	const isLink = view?.kind === "link";
	const extras = useMemo(
		() => ({
			...(detail.data?.extras ?? emptyExtras()),
			...(isLink && view ? linkExtras(view, shown) : {}),
		}),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `view` is rebuilt every render
		[detail.data, isLink, view?.url, view?.people, shown],
	);
	const sourceRating = view?.sourceRating;
	const kind = view?.kind ?? "movie";
	const providerId = source?.providerId;
	const row = useMemo(() => {
		// A note with no source to ask still recorded a score on the day it was
		// made, and that is worth showing. Keyed by the source it came from, so
		// Scout reads it on that source's curve.
		const own =
			extras.scores.length === 0 && sourceRating
				? [
						{
							id: providerId ?? "source",
							label: "Source",
							value: oneDecimal(sourceRating),
							outOfTen: sourceRating,
						},
					]
				: extras.scores;
		return assembleScores(
			own,
			detail.data?.scores,
			kind,
			{ genres: view?.tags, releaseDate: view?.releaseDate, year: view?.year },
			// The dialog's own fresh outlook, or failing that the library's.
			outlook.data ?? entry?.outlook,
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `view` is rebuilt every render
	}, [extras.scores, detail.data?.scores, sourceRating, providerId, kind, view?.tags, view?.releaseDate, view?.year, outlook.data, entry?.outlook]);

	const episodic = hasEpisodes(ctx, source, kind);
	const show = useShow(ctx, source, entry, kind, episodic);
	const episodeView = useEpisodeView(
		ctx,
		source,
		entry,
		extras,
		show,
		tab === "episodes",
	);

	const cover = useMemo(
		() => resolveImage(ctx.app, view?.cover, entry?.path ?? ""),
		[ctx.app, view?.cover, entry?.path],
	);

	// Offered while the seasons load, so the tab is there when they land rather
	// than pushing in between the others.
	const hasEpisodeTab = episodic && (show.run.length > 0 || show.loading);
	const hasMediaTab =
		extras.screenshots.length > 0 || (kind === "game" && extras.videos.length > 1);
	const hasTracks = (extras.tracks?.length ?? 0) > 0;
	const hasMoreTab =
		hasMore(extras) ||
		peopleToShow(kind, extras.people, view?.people ?? []).length > 0 ||
		(loading && Boolean(source));

	const moreLabel = extras.moreLabel ?? "Cast & more";
	const tabs: { id: TabId; label: string; count?: number }[] = [
		{ id: "overview", label: "Overview" },
		...(hasEpisodeTab
			? [{ id: "episodes" as const, label: "Episodes", count: show.total }]
			: []),
		...(hasMediaTab ? [{ id: "media" as const, label: "Media" }] : []),
		...(hasTracks
			? [
					{
						id: "tracks" as const,
						label: "Tracks",
						count: extras.tracks?.length,
					},
				]
			: []),
		...(hasMoreTab ? [{ id: "more" as const, label: moreLabel }] : []),
	];
	const active = tabs.some((one) => one.id === tab) ? tab : "overview";

	const heroHeight = () => hero.current?.offsetHeight ?? 0;

	const updateStuck = () => {
		const el = scroller.current;
		if (!el) return;
		setStuck(!isLink && el.scrollTop >= heroHeight() - 1);
	};

	useLayoutEffect(() => {
		const el = scroller.current;
		const how = settle.current;
		settle.current = null;
		if (el && how) {
			el.scrollTop =
				how === "pin" ? heroHeight() : Math.min(el.scrollTop, heroHeight());
		}
		const wanted = pendingScroll.current;
		pendingScroll.current = null;
		if (el && wanted) {
			const target = el.querySelector(`[data-sd="${wanted}"]`);
			if (target) {
				const top =
					target.getBoundingClientRect().top -
					el.getBoundingClientRect().top -
					56;
				el.scrollBy({ top, behavior: "smooth" });
			}
		}
	});

	const go = (next: TabId, how: Settle = "clamp") => {
		settle.current = how;
		setTab(next);
	};

	const scrollTo = (target: "yours" | "where") => {
		pendingScroll.current = target;
		if (active !== "overview") go("overview");
		// The effect that scrolls runs after a render, and being on the tab
		// already would not cause one.
		setScrollTick((value) => value + 1);
	};

	if (!view) {
		return <p className="scout-message">Nothing to show.</p>;
	}

	const create = async () => {
		if (!shown || busy) return;
		setBusy(true);
		const controller = new AbortController();
		try {
			await ctx.factory.create(shown, controller.signal);
			// Adding a suggestion counts as a yes, whichever button was pressed.
			// `reasons` is what says this dialog was opened from a suggestion.
			if (reasons && reasons.length > 0) {
				const key = feedbackKey(shown.ref);
				if (ctx.settings.feedback()[key]?.verdict !== "liked") {
					ctx.settings.setFeedback(key, recordFor(shown, "liked"));
				}
			}
		} catch (err) {
			new Notice(
				`Could not create the note: ${
					err instanceof Error ? err.message : "unknown error"
				}`,
			);
		} finally {
			setBusy(false);
		}
	};

	const overview = (
		<>
			{(view.description || extras.credit || loading) && (
				<div className="sd-body">
					{view.description && <p className="sd-desc">{view.description}</p>}
					{loading && kind !== "link" && <CreditSkeleton />}
					{extras.credit && (
						<p className="sd-credits">
							<span>
								{extras.credit.prefix}{" "}
								<b>{extras.credit.names.join(", ")}</b>
							</span>
						</p>
					)}
				</div>
			)}
			<WhyThis reasons={reasons} />
			{entry && hasEpisodeTab && (
				<UpNextCard
					entry={entry}
					show={show}
					onAllEpisodes={() => go("episodes", "pin")}
				/>
			)}
			{entry && hasProgressCard(kind) && (
				<ProgressCard ctx={ctx} entry={entry} progress={extras.progress} />
			)}
			{entry ? (
				<ManagePanel ctx={ctx} entry={entry} onClose={onClose} />
			) : (
				<p className="scout-detail-hint sd-hint">
					Add this to your library to rate it, track its status, and write
					your thoughts.
				</p>
			)}
			<Where
				availability={extras.availability}
				region={ctx.detail.region()}
				loading={loading}
			/>
		</>
	);

	return (
		<div className="sd-root scout-detail">
			<div className="sd-scroll" ref={scroller} onScroll={updateStuck}>
				<div ref={hero}>
					<Hero
						ctx={ctx}
						view={view}
						entry={entry}
						extras={extras}
						row={row}
						show={show}
						cover={cover}
						isLink={isLink}
						episodic={hasEpisodeTab}
						busy={busy}
						loading={loading}
						canCreate={Boolean(shown)}
						onCreate={() => void create()}
						onClose={onClose}
						onScrollTo={scrollTo}
					/>
				</div>

				{!isLink && (
					<div className={`sd-stick${stuck ? " is-stuck" : ""}`}>
						<Tabs
							tabs={tabs}
							active={active}
							title={view.title}
							onPick={(id) => go(id)}
						/>
						{active === "episodes" && (
							<EpisodeToolbar
								view={episodeView}
								show={show}
								hasScores={gridHasScores(episodeView, entry)}
							/>
						)}
					</div>
				)}

				{/* Keyed, so changing tab plays the pane's entrance again. */}
				<div className="sd-pane" key={active}>
					{active === "overview" && overview}
					{active === "episodes" && (
						<EpisodesPane
							ctx={ctx}
							entry={entry}
							show={show}
							view={episodeView}
							scroller={scroller}
						/>
					)}
					{active === "media" && <MediaPane extras={extras} />}
					{active === "tracks" && (
						<TracksPane
							ctx={ctx}
							entry={entry}
							tracks={extras.tracks ?? []}
						/>
					)}
					{active === "more" && (
						<MorePane
							ctx={ctx}
							extras={extras}
							source={source}
							previous={shown}
							entry={entry}
							kind={kind}
							fallbackPeople={view.people}
							loading={loading}
							onClose={onClose}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

