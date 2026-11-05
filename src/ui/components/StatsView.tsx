import React, { useMemo, useState } from "react";
import type { ScoutContext } from "../../core/context";
import { allStatuses, statusTone } from "../../core/library/config";
import { buildStats, statsYears, type StatsData, type TraitStat } from "../../core/library/stats";
import { ALL_MEDIA_KINDS, MEDIA_KIND_PLURALS, type MediaKind } from "../../core/types";
import { ScoutDetailModal } from "../detailModal";
import { openLibrary, type LibraryFocus } from "../libraryView";
import { BarChart, HeatmapChart, Meter } from "./Charts";
import { formatRating } from "./Rating";
import { Icon, useLibraryEntries, useSettingsVersion } from "./shared";
import { Goals } from "./StatsGoals";

/**
 * The stats page: what you finished, when, how much of your time it took, and
 * what you made of it. Built from the notes alone — see `stats.ts`.
 */

const UNITS = { minutes: "watched", pages: "read", hours: "played" } as const;

function amountText(amount: number, unit: keyof typeof UNITS): string {
	if (unit === "minutes") {
		const hours = amount / 60;
		return hours >= 48 ? `${Math.round(hours / 24)} days` : `${Math.round(hours)} hours`;
	}
	return `${Math.round(amount).toLocaleString()} ${unit}`;
}

/** A delta as a fraction, in points out of ten, signed. */
function deltaText(delta: number | null): string {
	if (delta === null) return "";
	const points = Math.round(delta * 100) / 10;
	if (points === 0) return "your average";
	return `${points > 0 ? "+" : ""}${points.toFixed(1)} vs your average`;
}

export default function StatsView({ ctx }: { ctx: ScoutContext }): React.ReactElement {
	const entries = useLibraryEntries(ctx.library);
	const version = useSettingsVersion(ctx.settings);
	const config = ctx.settings.library();
	const now = new Date();
	const years = useMemo(() => {
		const found = statsYears(entries);
		return found.includes(now.getFullYear()) ? found : [now.getFullYear(), ...found];
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [entries]);
	const kinds = useMemo(
		() => ALL_MEDIA_KINDS.filter((kind) => entries.some((e) => e.kind === kind)),
		[entries],
	);

	const [year, setYear] = useState<number | null>(now.getFullYear());
	const [kind, setKind] = useState<MediaKind | null>(null);
	const [asTable, setAsTable] = useState(false);

	const stats = useMemo(
		() => buildStats(config, entries, { year, kind }, now),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[config, entries, year, kind, version],
	);

	const show = (focus: LibraryFocus) =>
		void openLibrary(ctx.app, kind ? { kinds: [kind], ...focus } : focus);
	const doneStatuses = allStatuses(config).filter((s) => statusTone(config, s) === "done");
	const period = year === null ? "all time" : String(year);

	return (
		<div className="scout-stats-page">
			<header className="scout-stats-head">
				<h2>Stats</h2>
				<div className="scout-stats-filters">
					<select
						aria-label="Year"
						value={year ?? "all"}
						onChange={(e) => setYear(e.target.value === "all" ? null : Number(e.target.value))}
					>
						<option value="all">All time</option>
						{years.map((y) => (
							<option key={y} value={y}>
								{y}
							</option>
						))}
					</select>
					<select
						aria-label="Type"
						value={kind ?? "all"}
						onChange={(e) =>
							setKind(e.target.value === "all" ? null : (e.target.value as MediaKind))
						}
					>
						<option value="all">Everything</option>
						{kinds.map((k) => (
							<option key={k} value={k}>
								{MEDIA_KIND_PLURALS[k]}
							</option>
						))}
					</select>
					<label className="scout-stats-toggle">
						<input type="checkbox" checked={asTable} onChange={(e) => setAsTable(e.target.checked)} />
						Show as tables
					</label>
				</div>
			</header>

			<Goals ctx={ctx} goals={stats.goals} kinds={kind ? [kind] : kinds} />

			<section className="scout-stats-card">
				<h3>
					{stats.finished} finished in {period}
					{stats.again > 0 && <span className="scout-stats-note"> · {stats.again} again</span>}
				</h3>
				<BarChart
					label={`Finished by type, ${period}`}
					asTable={asTable}
					bars={stats.byKind.map(({ kind: k, count }) => ({
						key: k,
						label: MEDIA_KIND_PLURALS[k],
						count,
					}))}
					onSelect={(bar) =>
						void openLibrary(ctx.app, { kinds: [bar.key as MediaKind], statuses: doneStatuses })
					}
				/>
			</section>

			{stats.bars.length > 0 && (
				<section className="scout-stats-card">
					<h3>{year === null ? "Finished per year" : "Finished per month"}</h3>
					<BarChart bars={stats.bars} label={`Finished per ${year === null ? "year" : "month"}`} asTable={asTable} />
				</section>
			)}

			<section className="scout-stats-card">
				<h3>{year === null ? "The last twelve months" : `Every day of ${year}`}</h3>
				<HeatmapChart heatmap={stats.heatmap} label="Days something was finished" asTable={asTable} />
			</section>

			<TimeAndRatings stats={stats} asTable={asTable} />

			<div className="scout-stats-pair">
				<Traits title="Top genres" traits={stats.genres} onSelect={(name) => show({ tags: [name] })} />
				<Traits title="Top people" traits={stats.people} onSelect={(name) => show({ text: name })} />
			</div>

			<Habits ctx={ctx} stats={stats} />
		</div>
	);
}

function TimeAndRatings({ stats, asTable }: { stats: StatsData; asTable: boolean }): React.ReactElement {
	return (
		<div className="scout-stats-pair">
			{stats.time.length > 0 && (
				<section className="scout-stats-card">
					<h3>Time spent</h3>
					<dl className="scout-stats-figures">
						{stats.time.map((figure) => (
							<div key={figure.kind}>
								<dt>{MEDIA_KIND_PLURALS[figure.kind]}</dt>
								<dd>
									{amountText(figure.amount, figure.unit)} {UNITS[figure.unit]}
								</dd>
								<dd className="scout-stats-note">
									From {figure.known} of {figure.of} with{" "}
									{figure.unit === "pages" ? "a page count" : figure.unit === "hours" ? "hours logged" : "a runtime"}
								</dd>
							</div>
						))}
					</dl>
				</section>
			)}
			{stats.ratings.map((spread) => (
				<section key={spread.kind} className="scout-stats-card">
					<h3>
						{MEDIA_KIND_PLURALS[spread.kind]} rated
						<span className="scout-stats-note">
							{" "}· {spread.count}, averaging {formatRating(Math.round(spread.average * 10) / 10)}/{spread.scale}
						</span>
					</h3>
					<BarChart
						label={`${MEDIA_KIND_PLURALS[spread.kind]} by rating out of ${spread.scale}`}
						asTable={asTable}
						bars={spread.buckets.map((bucket) => ({
							key: String(bucket.upTo),
							label: formatRating(bucket.upTo),
							count: bucket.count,
						}))}
					/>
				</section>
			))}
		</div>
	);
}

function Traits({
	title,
	traits,
	onSelect,
}: {
	title: string;
	traits: TraitStat[];
	onSelect: (name: string) => void;
}): React.ReactElement | null {
	if (traits.length === 0) return null;
	const max = Math.max(...traits.map((one) => one.count));
	return (
		<section className="scout-stats-card">
			<h3>{title}</h3>
			<ul className="scout-stats-traits">
				{traits.map((one) => (
					<li key={one.name}>
						<button className="scout-stats-trait" onClick={() => onSelect(one.name)}>
							<span className="scout-stats-trait-name">{one.name}</span>
							<span className="scout-stats-note">
								{one.count} · {deltaText(one.delta)}
							</span>
							<Meter value={one.count} max={max} label={`${one.name}: ${one.count}`} />
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

function Habits({ ctx, stats }: { ctx: ScoutContext; stats: StatsData }): React.ReactElement {
	const open = (path: string) => new ScoutDetailModal(ctx, { entryPath: path }).open();
	const { dropped } = stats;
	return (
		<div className="scout-stats-pair">
			<section className="scout-stats-card">
				<h3>Given up on</h3>
				<p>
					{dropped.of === 0
						? "Nothing finished or dropped yet."
						: `${dropped.count} of ${dropped.of} (${Math.round((dropped.count / dropped.of) * 100)}%) dropped rather than finished.`}
				</p>
				{stats.replays.length > 0 && (
					<>
						<h3>Again and again</h3>
						<ul className="scout-stats-list">
							{stats.replays.map(({ entry, times }) => (
								<li key={entry.path}>
									<button className="scout-link-button" onClick={() => open(entry.path)}>
										{entry.title}
									</button>{" "}
									<span className="scout-stats-note">{times} times</span>
								</li>
							))}
						</ul>
					</>
				)}
			</section>
			{stats.shelf.length > 0 && (
				<section className="scout-stats-card">
					<h3>
						<Icon name="hourglass" size={14} /> Waiting longest
					</h3>
					<ul className="scout-stats-list">
						{stats.shelf.map(({ entry, since, days }) => (
							<li key={entry.path}>
								<button className="scout-link-button" onClick={() => open(entry.path)}>
									{entry.title}
								</button>{" "}
								<span className="scout-stats-note" title={`Since ${since}`}>
									{days >= 365 ? `${Math.floor(days / 365)} yr` : `${days} days`}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}
