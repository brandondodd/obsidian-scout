import { Menu, Notice } from "obsidian";
import React, { useEffect, useMemo, useReducer, useState } from "react";
import type { ScoutContext } from "../../core/context";
import { ratingScaleFor } from "../../core/library/config";
import { SHOWN, SuggestionEngine } from "../../core/library/engine";
import type { LibraryEntry } from "../../core/library/entry";
import { episodeLabel } from "../../core/library/episodes";
import {
	countVerdicts,
	feedbackKey,
	recordFor,
	type FeedbackVerdict,
} from "../../core/library/feedback";
import { buildHome, type HomeData } from "../../core/library/home";
import { goalProgress } from "../../core/library/stats";
import {
	rankReasons,
	reasonChip,
	reasonIcon,
	type Reason,
} from "../../core/library/reasons";
import {
	suggestionKey,
	type Suggestion,
} from "../../core/library/recommend";
import {
	affinity,
	buildTaste,
	topTraits,
	type TasteProfile,
	type TraitSummary,
} from "../../core/library/taste";
import { traitKey } from "../../core/library/traits";
import { hypeOfItem } from "../../core/hype";
import { scoutOfItem } from "../../core/scout-score";
import { MEDIA_KIND_LABELS, type MediaItem } from "../../core/types";
import { ScoutDetailModal } from "../detailModal";
import { ScoutImportModal } from "../importModal";
import { openLibrary } from "../libraryView";
import { openStats } from "../statsView";
import { ScoutSearchModal } from "../searchModal";
import { discoverableKinds, suggestionPort } from "../suggestionPort";
import MediaCard from "./Card";
import Rating, { formatRating } from "./Rating";
import StatusBadge, { progressFraction, statusClass } from "./Status";
import {
	Cover,
	Icon,
	resolveImage,
	useLibraryEntries,
	useSettingsVersion,
} from "./shared";

/**
 * The hub.
 *
 * A library view answers "what have I got". This answers "what now", which is a
 * different question and the one anyone actually opens a media tracker to ask.
 *
 * Every row is built from the vault and every row may be empty, and the page is
 * assembled from whichever ones are not. That is not tidiness — it is the whole
 * design. Somebody three episodes into two shows opens this and sees those two
 * shows; somebody who has just finished everything opens it and sees their
 * shelf, ranked; somebody waiting on a release sees the countdown at the top.
 * Nothing here is per-kind either: a book part-read and a game part-played are
 * both things on the go, and they share the row.
 */

/* `SHOWN`, `SEEDS_PER_ROUND` and `EXPLORE_ROUNDS` were declared here and left
   behind when the row's machinery moved into `engine.ts` and `strategies.ts`.
   Nothing read them; two copies of a number that has to agree is a bug waiting
   for somebody to change one of them. `SHOWN` is imported from the engine, which
   is the one that decides how many there are. */

export interface HomeViewProps {
	ctx: ScoutContext;
}

export default function HomeView({ ctx }: HomeViewProps): React.ReactElement {
	const entries = useLibraryEntries(ctx.library);
	useSettingsVersion(ctx.settings);
	const config = ctx.settings.library();

	// Rebuilt when the library changes, which is what makes the page move as
	// you use it: tick an episode and the row you are in reorders behind you.
	// Feedback is in here too, so a thumbs-down re-ranks the row it was in.
	const feedback = ctx.settings.feedback();
	// What the sources have said about your library beyond what its notes hold.
	// Without this the model is back to eighteen genres and a director.
	const enrichment = ctx.settings.enrichment();
	const collections = ctx.settings.collections();
	const { home, profile } = useMemo(() => {
		const now = new Date();
		const manualCollections = new Set(
			collections
				.filter((one) => !one.auto)
				.map((one) => one.name.trim().toLowerCase()),
		);
		const taste = buildTaste(config, entries, now, feedback, {
			enrichment,
			manualCollections,
		});
		return { home: buildHome(config, entries, taste, now), profile: taste };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [entries, config, feedback, enrichment, collections]);

	if (entries.length === 0) {
		return <EmptyLibrary ctx={ctx} />;
	}

	return (
		<div className="scout-home">
			<Header ctx={ctx} home={home} entries={entries} />

			<Row
				title="On the go"
				icon="play"
				note={sentence(home.continuing.length, "thing", "on the go")}
				entries={home.continuing}
				ctx={ctx}
			/>

			<Upcoming ctx={ctx} home={home} />

			<Row
				title="Start something"
				icon="sparkles"
				note="From your shelf, ordered by what you keep coming back to"
				entries={home.upNext}
				ctx={ctx}
			/>

			<Suggestions ctx={ctx} entries={entries} profile={profile} />

			<Row
				title="Picked back up?"
				icon="pause"
				note="Set aside, not given up on"
				entries={home.onHold}
				ctx={ctx}
			/>

			<Row
				title="Recently finished"
				icon="check"
				entries={home.recent}
				ctx={ctx}
				showRating
			/>

			<Row
				title="Your best"
				icon="star"
				note="Everything you rated highest"
				entries={home.best}
				ctx={ctx}
				showRating
			/>

			<Taste ctx={ctx} profile={profile} />
		</div>
	);
}

/* --------------------------------------------------------------- header */

function greeting(now: Date): string {
	const hour = now.getHours();
	if (hour < 5) return "Still up";
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}

function Header({
	ctx,
	home,
	entries,
}: {
	ctx: ScoutContext;
	home: HomeData;
	entries: readonly LibraryEntry[];
}): React.ReactElement {
	const { summary } = home;
	const goals = useMemo(
		() => goalProgress(ctx.settings.library(), entries, new Date().getFullYear()),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[entries, ctx.settings.library().goals],
	);
	const average =
		summary.averageFraction !== null
			? formatRating(summary.averageFraction * 10)
			: null;

	return (
		<header className="scout-home-head">
			<div className="scout-home-hello">
				<h2>{greeting(new Date())}</h2>
				<p>
					{[
						summary.onTheGo > 0
							? `${summary.onTheGo} on the go`
							: null,
						summary.planned > 0 ? `${summary.planned} waiting` : null,
						summary.finishedThisYear > 0
							? `${summary.finishedThisYear} finished this year`
							: `${summary.finished} finished`,
					]
						.filter(Boolean)
						.join(" · ")}
				</p>
			</div>

			<div className="scout-home-actions">
				<button
					className="mod-cta"
					onClick={() => new ScoutSearchModal(ctx).open()}
				>
					<Icon name="search" size={15} /> Add something
				</button>
				<button onClick={() => void openLibrary(ctx.app)}>
					<Icon name="library-big" size={15} /> Whole library
				</button>
				<button onClick={() => void openStats(ctx.app)}>
					<Icon name="bar-chart-3" size={15} /> Stats
				</button>
			</div>

			<dl className="scout-home-figures">
				<Figure label="In the library" value={String(summary.total)} />
				{average && <Figure label="Average score" value={`${average}/10`} />}
				{goals.map((goal) => (
					<Figure
						key={`goal-${goal.kind}`}
						label={`${MEDIA_KIND_LABELS[goal.kind]} goal`}
						value={`${goal.done}/${goal.target}`}
					/>
				))}
				{summary.byKind.slice(0, 3).map((at) => (
					<Figure
						key={at.kind}
						label={at.label}
						value={String(at.count)}
					/>
				))}
			</dl>
		</header>
	);
}

function Figure({
	label,
	value,
}: {
	label: string;
	value: string;
}): React.ReactElement {
	return (
		<div className="scout-figure">
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

/* ----------------------------------------------------------------- rows */

function sentence(count: number, noun: string, tail: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"} ${tail}`;
}

function Row({
	title,
	icon,
	note,
	entries,
	ctx,
	showRating = false,
}: {
	title: string;
	icon: string;
	note?: string;
	entries: readonly LibraryEntry[];
	ctx: ScoutContext;
	showRating?: boolean;
}): React.ReactElement | null {
	if (entries.length === 0) return null;
	return (
		<section className="scout-home-section">
			<SectionHead title={title} icon={icon} note={note} />
			{/* The library's own grid, so a shelf looks like a shelf wherever
			    it appears. */}
			<div className="scout-entries scout-entries-grid scout-home-rail">
				{entries.map((entry) => (
					<EntryCard
						key={entry.path}
						ctx={ctx}
						entry={entry}
						showRating={showRating}
					/>
				))}
			</div>
		</section>
	);
}

function SectionHead({
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

/**
 * One library note, as a card.
 *
 * The second line is chosen rather than fixed: where you are in a show is worth
 * more than the year it came out, and it is only worth anything on a show you
 * are part-way through.
 */
function EntryCard({
	ctx,
	entry,
	showRating,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	showRating: boolean;
}): React.ReactElement {
	const config = ctx.settings.library();
	const fraction = progressFraction(entry.progress, entry.progressTotal);
	const marker = entry.currentEpisode;

	const line = marker
		? `Up to ${episodeLabel(marker.season, marker.episode)}`
		: entry.progress !== undefined && entry.progressTotal
			? `${entry.progress} of ${entry.progressTotal}`
			: [MEDIA_KIND_LABELS[entry.kind], entry.year].filter(Boolean).join(" · ");

	return (
		<MediaCard
			title={entry.title}
			kind={entry.kind}
			cover={resolveImage(ctx.app, entry.cover, entry.path)}
			tone={statusClass(config, entry.status)}
			favorite={entry.favorite}
			meta={line}
			onOpen={() =>
				new ScoutDetailModal(ctx, { entryPath: entry.path }).open()
			}
			overlay={
				entry.status ? (
					<StatusBadge
						config={config}
						status={entry.status}
						progress={fraction}
						className="scout-entry-status"
						size={11}
					/>
				) : undefined
			}
			foot={
				showRating && entry.rating !== undefined ? (
					<Rating
						value={entry.rating}
						scale={ratingScaleFor(config, entry.kind)}
						step={config.ratingStep}
						icon={config.ratingIcon}
						size={13}
						readOnly
					/>
				) : undefined
			}
		/>
	);
}

/* ------------------------------------------------------------- upcoming */

/**
 * Things dated in the future.
 *
 * Its own shape rather than another rail: a countdown is the one fact on the
 * page that is about a day rather than about a title, and it reads as a list.
 */
function Upcoming({
	ctx,
	home,
}: {
	ctx: ScoutContext;
	home: HomeData;
}): React.ReactElement | null {
	if (home.upcoming.length === 0) return null;
	return (
		<section className="scout-home-section">
			<SectionHead
				title="Coming up"
				icon="calendar-clock"
				note="Dated, and not out yet"
			/>
			<ul className="scout-home-soon">
				{home.upcoming.map(({ entry, when }) => (
					<li key={entry.path}>
						<button
							onClick={() =>
								new ScoutDetailModal(ctx, {
									entryPath: entry.path,
								}).open()
							}
						>
							<Cover
								src={resolveImage(ctx.app, entry.cover, entry.path)}
								alt=""
								title={entry.title}
							/>
							<span className="scout-home-soon-text">
								<strong>{entry.title}</strong>
								<span>{MEDIA_KIND_LABELS[entry.kind]}</span>
							</span>
							<span className="scout-home-soon-when">{when}</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

/* -------------------------------------------------------- recommendations */

/**
 * Things you do not have yet.
 *
 * Two questions, asked of the sources in parallel and answered by Scout.
 *
 * The first is the one a catalogue is uniquely good at: "what did people who
 * liked this go on to like", asked of a handful of your own titles. The second
 * is the one that stops the first from going round in circles: "what does this
 * catalogue have plenty of people liking, in the genres I go for" — because
 * neighbours-of-what-you-own can only ever return more of what you own, and on
 * a small library that is a very small world.
 *
 * Scout does everything neither source can. It picks which of your titles are
 * worth asking about and how much each one's answer is worth; it notices when
 * several of them point at the same thing, which is the strongest signal any
 * source ever gives and which the old version discarded as a duplicate; it
 * drops what you already own and what you have said no to; and it ranks the
 * rest against a model of your own library before spreading the winners across
 * genres. A source's list for one film is a list about that film. Ranked this
 * way, it is a list about you.
 */
function Suggestions({
	ctx,
	entries,
	profile,
}: {
	ctx: ScoutContext;
	entries: readonly LibraryEntry[];
	profile: TasteProfile;
}): React.ReactElement | null {
	const config = ctx.settings.library();
	const feedback = ctx.settings.feedback();
	const kinds = useMemo(() => discoverableKinds(ctx), [ctx]);

	// One engine for the life of the view. Everything it does — asking, pooling,
	// ranking, standing things aside — lives in `engine.ts`, where it is tested.
	const engine = useMemo(() => new SuggestionEngine(suggestionPort(ctx)), [ctx]);
	const [, repaint] = useReducer((n: number) => n + 1, 0);
	useEffect(() => {
		const stop = engine.subscribe(repaint);
		return () => {
			stop();
			engine.dispose();
		};
	}, [engine]);

	engine.update({
		config,
		entries,
		profile,
		feedback,
		kinds,
		rotation: ctx.settings.rotation(),
		shown: ctx.settings.shownLog(),
		onShown: (keys) => ctx.settings.markShown(keys),
	});
	const { shown, loading, error, idle } = engine.state();
	if (idle) return null;

	/** A verdict, or the same verdict again to take it back. */
	const vote = (item: MediaItem, verdict: FeedbackVerdict) => {
		const key = feedbackKey(item.ref);
		const current = ctx.settings.feedback()[key]?.verdict;
		ctx.settings.setFeedback(
			key,
			current === verdict ? null : recordFor(item, verdict),
		);
	};

	/**
	 * Adding it is the strongest yes there is, so it counts as one.
	 *
	 * Adding used to teach the row nothing at all. The note lands in the library
	 * and the library is what the taste model is built from — but a note carries
	 * a title, a year and whatever tags the template wrote, where a verdict
	 * carries the traits the source knew at the moment you said yes: the
	 * keywords, the crew, the studio. You went to the trouble of pressing the one
	 * button that means "I want this", and the row would have taken a thumbs-up
	 * more seriously than the act itself.
	 *
	 * Not a toggle, unlike the thumbs: a second press of add is not somebody
	 * taking it back.
	 */
	const liked = (item: MediaItem) => {
		const key = feedbackKey(item.ref);
		if (ctx.settings.feedback()[key]?.verdict === "liked") return;
		ctx.settings.setFeedback(key, recordFor(item, "liked"));
	};

	const trained = countVerdicts(feedback);
	const told = trained.liked + trained.disliked + trained.seen;
	const note =
		told > 0
			? `Learning from your library and ${told} verdict${told === 1 ? "" : "s"}`
			: profile.sampled < 4
				? "Rate a few things, or use the thumbs below, and this sharpens up"
				: "Weighed against what your library says you like";

	return (
		<section className="scout-home-section">
			<SectionHead
				title="You might like"
				icon="wand-sparkles"
				note={note}
				action={
					<button
						className="scout-home-more"
						disabled={loading}
						onClick={() => engine.more()}
					>
						<Icon name="refresh-cw" size={13} />
						{loading ? "Looking…" : "Show me others"}
					</button>
				}
			/>

			{/* Off by default: it contacts sources about the whole library. */}
			{!config.enrichSuggestions && (
				<p className="scout-message scout-home-optin">
					Suggestions improve if Scout reads up on your titles in the background.{" "}
					<button
						className="mod-cta"
						onClick={() => ctx.settings.setLibrary("enrichSuggestions", true)}
					>
						Turn on
					</button>
				</p>
			)}

			{error && shown.length === 0 && <p className="scout-error">{error}</p>}
			{!error && shown.length === 0 && (
				<p className="scout-message">
					{loading
						? "Reading your library…"
						: "Nothing to suggest yet — add a few things and this fills in."}
				</p>
			)}

			<div
				className={`scout-entries scout-entries-grid scout-home-rail${
					loading ? " is-waiting" : ""
				}`}
			>
				{shown.map((at) => (
					<SuggestionCard
						key={suggestionKey(at.item)}
						ctx={ctx}
						suggestion={at}
						onAdded={liked}
						onVote={vote}
					/>
				))}
				{/* The seats it is still out looking for.
				    A press can take several rounds now, and without these the row
				    silently shrank to two cards and then grew back — which reads
				    as a bug, where a row of waiting cards reads as an answer on
				    its way. Hidden from the screen reader: there is nothing here
				    to read, and the button already says "Looking…". */}
				{loading &&
					Array.from(
						{ length: Math.max(0, SHOWN - shown.length) },
						(_, at) => (
							<div
								key={`waiting-${at}`}
								className="scout-entry scout-suggestion is-waiting"
								aria-hidden="true"
							>
								<div className="scout-entry-art" />
								<div className="scout-entry-info">
									<h4 />
									<div className="scout-entry-meta" />
									<div className="scout-entry-foot" />
								</div>
							</div>
						),
					)}
			</div>
		</section>
	);
}

function SuggestionCard({
	ctx,
	suggestion,
	onAdded,
	onVote,
}: {
	ctx: ScoutContext;
	suggestion: Suggestion;
	/** Told once the note exists, so adding counts as a yes — see `Suggestions`. */
	onAdded: (item: MediaItem) => void;
	onVote: (item: MediaItem, verdict: FeedbackVerdict) => void;
}): React.ReactElement {
	const { item, reasons, verdict } = suggestion;
	const [busy, setBusy] = useState(false);

	// The meta line goes back to being what a meta line is. Reasons used to be
	// crammed in here, into a `white-space: nowrap` line on a 112px card, which
	// meant the model explained itself and the explanation was then ellipsed
	// out of existence. They belong in the foot, where they can wrap.
	const meta = [
		item.year ? String(item.year) : null,
		MEDIA_KIND_LABELS[item.ref.kind],
	]
		.filter(Boolean)
		.join(" · ");
	// One, and a line rather than a pill.
	//
	// Two was the first try, and on a rail card — a hundred and fifty-eight
	// pixels wide with seven across — two chips always wrapped onto a second
	// line, but only on the cards that had two, so a row came out ragged by
	// forty pixels. Then one pill, which could not truncate: `text-overflow`
	// does nothing to the anonymous flex item a bare text node becomes, so
	// "Like Insidious: The Red Door" ran out past its own background instead of
	// ellipsing. A line gives the sentence the whole width of the card, and the
	// whole account is in the dialog, which is where the room is.
	// Always something, even if only "you might like this". The foot collapses
	// when it is empty, so one unexplained card in a rail of seven makes the row
	// ragged by eighteen pixels — and a suggestion that will not say why it is
	// there is the one thing this whole row was rebuilt to stop.
	const best: Reason = rankReasons(
		reasons.filter((one) => !one.against),
		1,
	)[0] ?? {
		kind: "explore",
		label: "Worth a look",
		strength: 0.2,
	};
	const why = reasons
		.filter((one) => !one.against)
		.map((one) => one.label)
		.join(" · ");

	const add = async (event: React.MouseEvent) => {
		event.stopPropagation();
		if (busy) return;
		setBusy(true);
		try {
			await ctx.factory.create(item, new AbortController().signal);
			onAdded(item);
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

	const press = (event: React.MouseEvent, next: FeedbackVerdict) => {
		event.stopPropagation();
		onVote(item, next);
	};

	return (
		<MediaCard
			className={`scout-suggestion${verdict === "liked" ? " is-liked" : ""}`}
			title={item.title}
			kind={item.ref.kind}
			cover={resolveImage(ctx.app, item.thumbnailUrl ?? item.imageUrl)}
			hint={`${item.title}${why ? ` — ${why}` : ""}`}
			meta={meta}
			foot={
				<span
					className={`scout-why${best.strength > 0.5 ? " is-strong" : ""}`}
					title={best.label}
				>
					<Icon name={reasonIcon(best.kind)} size={10} />
					<span className="scout-why-text">{reasonChip(best)}</span>
				</span>
			}
			onOpen={() => new ScoutDetailModal(ctx, { item, reasons }).open()}
			overlay={
				<>
					{scoutOfItem(item) !== undefined && (
						<span className="scout-home-badge" title="Scout score, out of 10">
							<Icon name="compass" size={10} />
							{formatRating(scoutOfItem(item) ?? 0)}
						</span>
					)}
					{hypeOfItem(item, ctx.settings.scores()) !== undefined && (
						<span
							className="scout-home-badge scout-hype"
							title="Forecast: not out yet, so the Scout score it is likely to settle at"
						>
							<Icon name="telescope" size={10} />
							{formatRating(hypeOfItem(item, ctx.settings.scores()) ?? 0)}
						</span>
					)}
					{/* On the artwork and only under the pointer: eight always-on
					    button clusters down a row is a row of buttons with some
					    posters behind it. */}
					<div className="scout-suggest-actions">
						<button
							className={`scout-suggest-vote${
								verdict === "liked" ? " is-on" : ""
							}`}
							aria-pressed={verdict === "liked"}
							aria-label={`More like ${item.title}`}
							title="More like this"
							onClick={(e) => press(e, "liked")}
						>
							<Icon name="thumbs-up" size={13} />
						</button>
						<button
							className="scout-suggest-add"
							disabled={busy}
							aria-label={`Add ${item.title} to your library`}
							title="Add to library"
							onClick={(event) => void add(event)}
						>
							<Icon name={busy ? "loader" : "plus"} size={14} />
						</button>
						<button
							className="scout-suggest-vote"
							aria-label={`Not for me: ${item.title}`}
							title="Not for me — and less like it"
							onClick={(e) => press(e, "disliked")}
						>
							<Icon name="thumbs-down" size={13} />
						</button>
					</div>
					{/* Opposite the score, in the corner the bar cannot reach.
					    A fourth round button in the bar below would be 122px of
					    controls inside artwork that narrows to about 107px on a
					    packed rail. */}
					<button
						className="scout-suggest-more"
						aria-label={`More for ${item.title}`}
						title="More"
						onClick={(event) => {
							event.stopPropagation();
							const menu = new Menu();
							menu.addItem((i) =>
								i
									.setTitle("I've seen this")
									.setIcon("eye")
									.onClick(() => onVote(item, "seen")),
							);
							menu.addItem((i) =>
								i
									.setTitle("Not now — ask again in a month")
									.setIcon("clock")
									.onClick(() => onVote(item, "snoozed")),
							);
							menu.addItem((i) =>
								i
									.setTitle("Never show this again")
									.setIcon("x")
									.onClick(() => onVote(item, "disliked")),
							);
							menu.showAtMouseEvent(event.nativeEvent);
						}}
					>
						<Icon name="more-horizontal" size={12} />
					</button>
				</>
			}
		/>
	);
}

/* ---------------------------------------------------------------- taste */

/**
 * What Scout has learned, shown rather than hidden.
 *
 * This row used to list the genres your library holds *most of*, with a heart
 * on the ones it rated well. That is a fact about your shelf and not about the
 * model — and the difference between the two is the entire feature. Owning
 * forty dramas because forty dramas got made is not liking drama, and the row
 * that cannot tell those apart is the row that keeps handing you more drama.
 *
 * Three columns, because a taste has three interesting parts: what you go for,
 * who you follow, and what the model is steering you away from. The last is
 * the one nothing has ever shown you, and it is the one most worth being able
 * to check — a recommender quietly avoiding something you actually like is a
 * failure you can only find if it will tell you.
 */
/** Two titles minimum, or the panel reports the model's flukes back as facts. */
const TASTE_EVIDENCE = 2;

/**
 * The rows a column actually shows: one per thing, however many ways the model
 * knows it.
 *
 * A trait is a namespace and a value, and these columns deliberately draw from
 * more than one namespace at a time — so "fiction, thrillers" learned as a genre
 * off a book's frontmatter and "fiction, thrillers" harvested as a keyword are
 * two different traits with the same name, and the panel listed both, with
 * different counts, one above the other. To a reader that is not two facts. It
 * is the same fact, printed twice, apparently disagreeing with itself.
 *
 * Kept rather than added together: the two were learned from overlapping titles,
 * and summing them would claim more evidence than exists. The stronger one wins,
 * which is the one that was moving the recommendations anyway.
 */
function shownRows(
	rows: readonly TraitSummary[],
	limit: number,
): TraitSummary[] {
	const by = new Map<string, TraitSummary>();
	for (const row of rows) {
		const name = row.label.trim().toLowerCase();
		const held = by.get(name);
		if (!held || Math.abs(row.affinity.score) > Math.abs(held.affinity.score)) {
			by.set(name, row);
		}
	}
	// Which rows appear is decided by how strongly the model feels about them —
	// that is the interesting ranking, and `topTraits` has already done it. What
	// order they are drawn in is decided by the bars, because a column of bars
	// that does not descend reads as a broken chart whatever it is sorted by.
	return [...by.values()]
		.slice(0, limit)
		.sort((a, b) => b.affinity.count - a.affinity.count);
}

/** The longest bar in a column — see the note on `scout-taste-fill`. */
function most(rows: readonly TraitSummary[]): number {
	return Math.max(1, ...rows.map((one) => one.affinity.count));
}

/**
 * Sentence case, because the model learns its vocabulary from four places and
 * they do not agree.
 *
 * A genre off your own frontmatter keeps your spelling; a keyword harvested from
 * a source arrives lower-cased; and a trait recovered from an old thumbs-down
 * has no spelling at all beyond the key it was stored under, which is folded.
 * So one column read "Mystery, grim, clown makeup, Fiction" — which says nothing
 * about the model and a great deal about where each row came from, and the
 * reader is owed neither.
 */
function capitalised(label: string): string {
	const text = label.trim();
	if (!text) return text;
	return `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

function Taste({
	ctx,
	profile,
}: {
	ctx: ScoutContext;
	profile: TasteProfile;
}): React.ReactElement | null {
	// `minCount` inside `topTraits`, not a `.filter` after it. Filtering after
	// meant the slice happened first, so on a library with hundreds of harvested
	// keywords the five best-scoring were five one-off flukes and every one of
	// them was then thrown away — which is why this column came out empty on a
	// library of a hundred and thirty rated titles.
	const liked = shownRows(
		topTraits(profile, ["genre", "keyword"], 12, "liked", TASTE_EVIDENCE),
		6,
	);
	const followed = shownRows(
		topTraits(
			profile,
			["director", "studio", "person"],
			10,
			"liked",
			TASTE_EVIDENCE,
		),
		5,
	);
	const avoided = shownRows(
		topTraits(profile, ["genre", "keyword"], 8, "disliked", TASTE_EVIDENCE),
		4,
	);

	if (liked.length === 0 && followed.length === 0 && avoided.length === 0) {
		return null;
	}

	const column = (
		title: string,
		icon: string,
		blurb: string,
		rows: typeof liked,
		against = false,
	): React.ReactElement | null =>
		rows.length === 0 ? null : (
			<div className={`scout-taste-col${against ? " is-against" : ""}`}>
				<h4>
					<Icon name={icon} size={13} />
					{title}
				</h4>
				<p className="scout-taste-blurb">{blurb}</p>
				<ul className="scout-taste-rows">
					{rows.map((one) => (
						<li key={one.key}>
							{/* The bar is the row's own background rather than a
							    strip beside it. Ten of these stacked in three
							    columns is a lot of furniture for one number each,
							    and a labelled bar is one object where a bar plus a
							    label is two.

							    It measures the number printed at the end of it,
							    which sounds too obvious to write down and was not
							    true: it used to measure the affinity, which is not
							    printed anywhere, so a row reading "14" sat beside a
							    shorter bar than one reading "10" and the panel
							    looked simply wrong. Two quantities, one of them
							    invisible, is a chart nobody can read. */}
							<span
								className="scout-taste-fill"
								style={{
									width: `${Math.max(
										8,
										Math.round((one.affinity.count / most(rows)) * 100),
									)}%`,
								}}
							/>
							<span className="scout-taste-label">{capitalised(one.label)}</span>
							<span
								className="scout-taste-count"
								title={`Learned from ${one.affinity.count} of your titles`}
							>
								{one.affinity.count}
							</span>
						</li>
					))}
				</ul>
			</div>
		);

	const studied = profile.labels.size;
	const told = countVerdicts(ctx.settings.feedback());
	const verdicts = told.liked + told.disliked + told.seen;

	return (
		<section className="scout-home-section scout-taste-section">
			<SectionHead
				title="What Scout has learned"
				icon="chart-no-axes-column"
				note={
					profile.sampled > 0
						? [
								`${profile.sampled} title${profile.sampled === 1 ? "" : "s"} you have an opinion on`,
								`${studied} thing${studied === 1 ? "" : "s"} it knows about them`,
								verdicts > 0
									? `${verdicts} verdict${verdicts === 1 ? "" : "s"}`
									: null,
							]
								.filter(Boolean)
								.join(" · ")
						: undefined
				}
				action={
					<button
						className="scout-home-more"
						onClick={() => void openLibrary(ctx.app)}
					>
						<Icon name="library-big" size={13} /> Whole library
					</button>
				}
			/>
			<div className="scout-taste">
				{column(
					"What you go for",
					"heart",
					"Rated above your own average, more than once",
					liked,
				)}
				{column(
					"Who you follow",
					"user",
					"Names and studios you keep coming back to",
					followed,
				)}
				{/* The column nothing has ever shown anybody, and the one most
				    worth being able to check: a recommender quietly avoiding
				    something you actually like is a failure you can only find if
				    it will tell you it is doing it. */}
				{column(
					"Steering away from",
					"thumbs-down",
					"Held against a suggestion that carries it",
					avoided,
					true,
				)}
			</div>
		</section>
	);
}

/* ---------------------------------------------------------------- empty */

function EmptyLibrary({ ctx }: { ctx: ScoutContext }): React.ReactElement {
	return (
		<div className="scout-home scout-home-empty">
			<Icon name="clapperboard" size={44} />
			<h2>Nothing on the shelf yet</h2>
			<p>
				Add the last film you watched or the book on your bedside table.
				This page fills itself in from your notes — what you are part-way
				through, what to start next, and what you might like — and it gets
				better at the last one the more you rate.
			</p>
			<div className="scout-empty-actions">
				<button
					className="mod-cta"
					onClick={() => new ScoutSearchModal(ctx).open()}
				>
					<Icon name="search" size={15} /> Search for something
				</button>
				<button onClick={() => new ScoutImportModal(ctx).open()}>
					<Icon name="import" size={15} /> Import a library
				</button>
			</div>
		</div>
	);
}
