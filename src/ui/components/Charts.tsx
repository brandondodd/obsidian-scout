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

export function BarChart({
	bars,
	label,
	asTable,
	onSelect,
}: {
	bars: readonly Bar[];
	label: string;
	asTable: boolean;
	onSelect?: (bar: Bar) => void;
}): React.ReactElement {
	if (asTable) {
		return (
			<table className="scout-stats-table">
				<caption>{label}</caption>
				<tbody>
					{bars.map((bar) => (
						<tr key={bar.key}>
							<th scope="row">{bar.label}</th>
							<td>{bar.count}</td>
						</tr>
					))}
				</tbody>
			</table>
		);
	}
	const max = Math.max(1, ...bars.map((bar) => bar.count));
	return (
		<div
			className="scout-bars"
			role="img"
			aria-label={`${label}: ${bars.map((bar) => `${bar.label} ${bar.count}`).join(", ")}`}
		>
			{bars.map((bar) => {
				const body = (
					<>
						<span className="scout-bar-value">{bar.count || ""}</span>
						<span
							className="scout-bar-fill"
							style={{ height: `${(bar.count / max) * 100}%` }}
						/>
						<span className="scout-bar-label">{bar.label}</span>
					</>
				);
				return onSelect ? (
					<button
						key={bar.key}
						className="scout-bar is-clickable"
						title={`${bar.label}: ${bar.count}`}
						onClick={() => onSelect(bar)}
					>
						{body}
					</button>
				) : (
					<div key={bar.key} className="scout-bar" title={`${bar.label}: ${bar.count}`}>
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
	if (asTable) {
		return (
			<table className="scout-stats-table">
				<caption>{label}</caption>
				<tbody>
					{active.map((day) => (
						<tr key={day.date}>
							<th scope="row">{day.date}</th>
							<td>{day.count}</td>
						</tr>
					))}
					{active.length === 0 && (
						<tr>
							<td>Nothing finished</td>
						</tr>
					)}
				</tbody>
			</table>
		);
	}
	return (
		<div className="scout-heatmap-scroll">
			<div
				className="scout-heatmap"
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
							title={`${day.date}: ${day.count}`}
						/>
					),
				)}
			</div>
		</div>
	);
}

/** A goal or a share, as a bar that fills. */
export function Meter({
	value,
	max,
	label,
}: {
	value: number;
	max: number;
	label: string;
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
		>
			<span className="scout-meter-fill" style={{ width: `${fraction * 100}%` }} />
		</div>
	);
}
