import { Platform } from "obsidian";
import React, { useMemo, useState } from "react";
import type { ScoutContext } from "../../core/context";
import { allStatuses, statusTone } from "../../core/library/config";
import { buildStats, statsYears, type StatsData } from "../../core/library/stats";
import { ALL_MEDIA_KINDS, MEDIA_KIND_PLURALS, type MediaKind } from "../../core/types";
import { openLibrary, type LibraryFocus } from "../libraryView";
import { BarChart, HeatmapChart, kindColor } from "./Charts";
import { Icon, KIND_ICONS, useLibraryEntries, useSettingsVersion } from "./shared";
import { Goals } from "./StatsGoals";
import { CardHead, Ratings, Shelves, Traits } from "./StatsSections";

/**
 * The stats page: what you finished, when, how much of your time it took, and
 * what you made of it. Built from the notes alone — see `stats.ts`.
 */

const UNITS = { minutes: "watched", pages: "read", hours: "played" } as const;

/** A figure as a big number and the word under it: ["38", "hours"]. */
function amountParts(amount: number, unit: keyof typeof UNITS): [string, string] {
	if (unit === "minutes") {
		const hours = amount / 60;
		if (hours >= 72) return [String(Math.round(hours / 24)), "days"];
		return [String(Math.round(hours)), Math.round(hours) === 1 ? "hour" : "hours"];
	}
	return [Math.round(amount).toLocaleString(), unit];
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
	const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

	return (
		<div className="scout-stats-page">
			<header className="scout-stats-head">
				<div className="scout-stats-title">
					<h2>{year === null ? "All time" : year === now.getFullYear() ? `${year} so far` : `${year} in review`}</h2>
					<span>{kind ? MEDIA_KIND_PLURALS[kind] : "Everything you finished"}</span>
				</div>
				<div className="scout-stats-filters">
					{kinds.length > 1 && (
						<div className="scout-segment" role="group" aria-label="Type">
							{[null, ...kinds].map((k) => (
								<button
									key={k ?? "all"}
									className={`scout-plain${kind === k ? " is-on" : ""}`}
									aria-pressed={kind === k}
									onClick={() => setKind(k)}
								>
									{k ? MEDIA_KIND_PLURALS[k] : "All"}
								</button>
							))}
						</div>
					)}
					<select
						className="dropdown"
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
					<button
						className={`scout-stats-icon scout-plain${asTable ? " is-on" : ""}`}
						aria-pressed={asTable}
						aria-label="Show as tables"
						title="Show as tables"
						onClick={() => setAsTable(!asTable)}
					>
						<Icon name="table" />
					</button>
				</div>
			</header>

			<Overview
				stats={stats}
				period={period}
				asTable={asTable}
				onKind={(k) => void openLibrary(ctx.app, { kinds: [k], statuses: doneStatuses })}
			/>

			<Goals ctx={ctx} goals={stats.goals} kinds={kind ? [kind] : kinds} now={now} />

			<div className="scout-stats-grid">
				{stats.bars.length > 0 && (
					<section className="scout-stats-card is-wide">
						<CardHead title={year === null ? "Finished per year" : "Finished per month"} />
						<BarChart
							// Twelve months across a phone is two dozen pixels a
							// bar, and "Jan" came out as "J…". The initial alone
							// is how a calendar prints it at that size; the full
							// name is still each bar's title and its table row.
							bars={
								year !== null && Platform.isPhone
									? stats.bars.map((bar) => ({ ...bar, tick: bar.label.charAt(0) }))
									: stats.bars
							}
							label={`Finished per ${year === null ? "year" : "month"}`}
							asTable={asTable}
							current={year === null ? String(now.getFullYear()) : thisMonth}
						/>
					</section>
				)}

				<section className="scout-stats-card is-wide">
					<CardHead
						title={year === null ? "The last twelve months" : "Day by day"}
						aside={
							stats.heatmap.active > 0
								? `${stats.heatmap.active} active ${stats.heatmap.active === 1 ? "day" : "days"} · longest streak ${stats.heatmap.streak}`
								: undefined
						}
					/>
					<HeatmapChart heatmap={stats.heatmap} label="Days something was finished" asTable={asTable} />
				</section>

				<Ratings ratings={stats.ratings} asTable={asTable} />

				<Traits title="Top genres" icon="tags" traits={stats.genres} onSelect={(name) => show({ tags: [name] })} />
				<Traits title="Top people" icon="users" traits={stats.people} onSelect={(name) => show({ text: name })} />

				<Shelves ctx={ctx} stats={stats} />
			</div>
		</div>
	);
}

/** The headline: how many, of what, and the figures that go with it. */
function Overview({
	stats,
	period,
	asTable,
	onKind,
}: {
	stats: StatsData;
	period: string;
	asTable: boolean;
	onKind: (kind: MediaKind) => void;
}): React.ReactElement {
	const { dropped } = stats;
	const ratedCount = stats.ratings.reduce((sum, one) => sum + one.count, 0);
	return (
		<section className="scout-stats-hero">
			<div className="scout-stats-total">
				<div className="scout-stats-big">
					<strong>{stats.finished}</strong>
					<span>
						finished {period === "all time" ? "all time" : `in ${period}`}
						{stats.again > 0 && <em> · {stats.again} revisited</em>}
					</span>
				</div>
				{stats.finished === 0 ? (
					<p className="scout-stats-note">Nothing finished in this period yet. Mark something done and it shows up here.</p>
				) : asTable ? (
					<table className="scout-stats-table">
						<caption>Finished by type</caption>
						<tbody>
							{stats.byKind.map(({ kind, count }) => (
								<tr key={kind}>
									<th scope="row">{MEDIA_KIND_PLURALS[kind]}</th>
									<td>{count}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<>
						<div className="scout-stats-split" aria-hidden>
							{stats.byKind.map(({ kind, count }) => (
								<span key={kind} style={{ flexGrow: count, background: kindColor(kind) }} />
							))}
						</div>
						<ul className="scout-stats-legend">
							{stats.byKind.map(({ kind, count }) => (
								<li key={kind}>
									<button className="scout-plain" onClick={() => onKind(kind)} title={`Open finished ${MEDIA_KIND_PLURALS[kind].toLowerCase()}`}>
										<span className="scout-stats-swatch" style={{ background: kindColor(kind) }} />
										<Icon name={KIND_ICONS[kind]} size={14} />
										<span>{MEDIA_KIND_PLURALS[kind]}</span>
										<strong>{count}</strong>
										<span className="scout-stats-note">{Math.round((count / stats.finished) * 100)}%</span>
									</button>
								</li>
							))}
						</ul>
					</>
				)}
			</div>
			<dl className="scout-stats-kpis">
				{stats.time.map((figure) => {
					const [value, unit] = amountParts(figure.amount, figure.unit);
					return (
						<div
							key={figure.kind}
							title={
								figure.known < figure.of
									? `Worked out from ${figure.known} of ${figure.of} that record it`
									: undefined
							}
						>
							<dt>
								<Icon name={KIND_ICONS[figure.kind]} size={13} /> {MEDIA_KIND_PLURALS[figure.kind]}
							</dt>
							<dd>
								<strong>{value}</strong> {unit} {UNITS[figure.unit]}
								{figure.known < figure.of && <span className="scout-stats-note"> · {figure.known} of {figure.of}</span>}
							</dd>
						</div>
					);
				})}
				{stats.average !== null && (
					<div>
						<dt>
							<Icon name="star" size={13} /> Average rating
						</dt>
						<dd>
							<strong>{(Math.round(stats.average * 100) / 10).toFixed(1)}</strong> / 10
							<span className="scout-stats-note"> · {ratedCount} rated</span>
						</dd>
					</div>
				)}
				{dropped.of > 0 && (
					<div>
						<dt>
							<Icon name="circle-slash" size={13} /> Given up on
						</dt>
						<dd>
							<strong>{Math.round((dropped.count / dropped.of) * 100)}%</strong>
							<span className="scout-stats-note">
								{" "}
								· {dropped.count} of {dropped.of}
							</span>
						</dd>
					</div>
				)}
			</dl>
		</section>
	);
}
