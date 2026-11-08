import React from "react";
import type { Bar, Heatmap } from "../../core/library/stats";

/**
 * The stats page's charts, in plain CSS.
 *
 * Divs rather than a chart library: a bar is a box with a height, and boxes
 * follow the theme's variables, wrap at phone width and stay crisp without a
 * kilobyte of dependency. Each chart has a table form for screen readers and
 * for anybody who would rather read the numbers — `asTable` switches to it.
 */

/** A bar, with an optional shorter tick to print under it. */
export type ChartBar = Bar & { tick?: string };

function Table({ label, rows }: { label: string; rows: [string, number][] }): React.ReactElement {
	return (
		<table className="scout-stats-table">
			<caption>{label}</caption>
			<tbody>
				{rows.map(([name, count]) => (
					<tr key={name}>
						<th scope="row">{name}</th>
						<td>{count}</td>
					</tr>
				))}
				{rows.length === 0 && (
					<tr>
						<td>Nothing yet</td>
					</tr>
				)}
			</tbody>
		</table>
	);
}

export function BarChart({
	bars,
	label,
	asTable,
	current,
	compact,
	color,
	onSelect,
}: {
	bars: readonly ChartBar[];
	label: string;
	asTable: boolean;
	/** The key of the bar to pick out — this month, say. */
	current?: string;
	compact?: boolean;
	/** A CSS colour for the fill; the accent otherwise. */
	color?: string;
	onSelect?: (bar: Bar) => void;
}): React.ReactElement {
	if (asTable) return <Table label={label} rows={bars.map((bar) => [bar.label, bar.count])} />;
	const max = Math.max(1, ...bars.map((bar) => bar.count));
	return (
		<div
			className={`scout-bars${compact ? " is-compact" : ""}`}
			style={color ? ({ "--scout-bar-color": color } as React.CSSProperties) : undefined}
			role="img"
			aria-label={`${label}: ${bars.map((bar) => `${bar.label} ${bar.count}`).join(", ")}`}
		>
			{bars.map((bar) => {
				const className = [
					"scout-bar",
					bar.count === 0 ? "is-empty" : "",
					bar.key === current ? "is-current" : "",
				]
					.filter(Boolean)
					.join(" ");
				const body = (
					<>
						<span className="scout-bar-track">
							<span className="scout-bar-fill" style={{ height: `${(bar.count / max) * 100}%` }}>
								{bar.count > 0 && <span className="scout-bar-value">{bar.count}</span>}
							</span>
						</span>
						<span className="scout-bar-label">{bar.tick ?? bar.label}</span>
					</>
				);
				return onSelect ? (
					<button
						key={bar.key}
						className={`${className} scout-plain`}
						title={`${bar.label}: ${bar.count}`}
						onClick={() => onSelect(bar)}
					>
						{body}
					</button>
				) : (
					<div key={bar.key} className={className} title={`${bar.label}: ${bar.count}`}>
						{body}
					</div>
				);
			})}
		</div>
	);
}

/** Four steps of the accent colour, and none for an empty day. */
function level(count: number, max: number): number {
	if (count <= 0 || max <= 0) return 0;
	return Math.min(4, Math.ceil((count / max) * 4));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Which week column each month starts in, skipping a label that would crowd the next. */
function monthTicks(days: Heatmap["days"]): { week: number; label: string }[] {
	const ticks: { week: number; label: string }[] = [];
	days.forEach((day, at) => {
		if (!day) return;
		const first = ticks.length === 0;
		if (!first && !day.date.endsWith("-01")) return;
		ticks.push({ week: Math.floor(at / 7), label: MONTHS[Number(day.date.slice(5, 7)) - 1] ?? "" });
	});
	// A partial first month gets no label if the next one starts right after it.
	if (ticks.length > 1 && (ticks[1]?.week ?? 0) - (ticks[0]?.week ?? 0) < 3) ticks.shift();
	return ticks;
}

export function HeatmapChart({
	heatmap,
	label,
	asTable,
}: {
	heatmap: Heatmap;
	label: string;
	asTable: boolean;
}): React.ReactElement {
	const active = heatmap.days.filter(
		(day): day is { date: string; count: number } => day !== null && day.count > 0,
	);
	if (asTable) return <Table label={label} rows={active.map((day) => [day.date, day.count])} />;
	const weeks = Math.ceil(heatmap.days.length / 7);
	const columns = { gridTemplateColumns: `repeat(${weeks}, minmax(9px, 1fr))` };
	return (
		<div className="scout-heatmap-wrap">
			<div className="scout-heatmap-scroll">
				<div className="scout-heatmap-frame">
					<div className="scout-heatmap-days" aria-hidden>
						<span>Mon</span>
						<span />
						<span>Wed</span>
						<span />
						<span>Fri</span>
						<span />
						<span />
					</div>
					<div className="scout-heatmap-body">
						<div className="scout-heatmap-months" style={columns} aria-hidden>
							{monthTicks(heatmap.days).map((tick) => (
								<span key={tick.week} style={{ gridColumn: tick.week + 1 }}>
									{tick.label}
								</span>
							))}
						</div>
						<div
							className="scout-heatmap"
							style={columns}
							role="img"
							aria-label={`${label}: ${active.length} days with something finished`}
						>
							{heatmap.days.map((day, at) =>
								day === null ? (
									<span key={at} className="scout-heat is-outside" />
								) : (
									<span
										key={at}
										className={`scout-heat is-level-${level(day.count, heatmap.max)}`}
										title={`${day.date}: ${day.count} finished`}
									/>
								),
							)}
						</div>
					</div>
				</div>
			</div>
			<div className="scout-heatmap-legend" aria-hidden>
				Less
				{[0, 1, 2, 3, 4].map((step) => (
					<span key={step} className={`scout-heat is-level-${step}`} />
				))}
				More
			</div>
		</div>
	);
}

/** A goal or a share, as a bar that fills. */
export function Meter({
	value,
	max,
	label,
	color,
	marker,
}: {
	value: number;
	max: number;
	label: string;
	color?: string;
	/** Where a tick goes along the bar, as a fraction — the pace a goal needs. */
	marker?: number;
}): React.ReactElement {
	const fraction = max > 0 ? Math.min(1, value / max) : 0;
	return (
		<div
			className="scout-meter"
			role="meter"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={value}
			style={color ? ({ "--scout-bar-color": color } as React.CSSProperties) : undefined}
		>
			<span className="scout-meter-fill" style={{ width: `${fraction * 100}%` }} />
			{marker !== undefined && (
				<span className="scout-meter-marker" style={{ left: `${Math.min(1, marker) * 100}%` }} />
			)}
		</div>
	);
}

/** Each kind's own colour, so a kind reads the same in every chart. Set in styles.css. */
export function kindColor(kind: string): string {
	return `var(--scout-kind-${kind}, var(--interactive-accent))`;
}
