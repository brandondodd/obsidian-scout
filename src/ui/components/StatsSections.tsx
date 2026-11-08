import React from "react";
import type { ScoutContext } from "../../core/context";
import type { RatingSpread, StatsData, TraitStat } from "../../core/library/stats";
import { MEDIA_KIND_PLURALS } from "../../core/types";
import { ScoutDetailModal } from "../detailModal";
import { BarChart, kindColor } from "./Charts";
import { formatRating } from "./Rating";
import { Icon, KIND_ICONS } from "./shared";

/** The stats page's cards below the headline: ratings, rankings and shelves. */

export function CardHead({ title, icon, aside }: { title: string; icon?: string; aside?: string }): React.ReactElement {
	return (
		<header className="scout-stats-card-head">
			<h3>
				{icon && <Icon name={icon} size={15} />}
				{title}
			</h3>
			{aside && <span className="scout-stats-note">{aside}</span>}
		</header>
	);
}

/** One block per kind: the average, big, beside how the ratings spread. */
export function Ratings({ ratings, asTable }: { ratings: RatingSpread[]; asTable: boolean }): React.ReactElement | null {
	if (ratings.length === 0) return null;
	return (
		<section className="scout-stats-card is-wide">
			<CardHead title="How you rated" icon="star" />
			<div className="scout-stats-ratings">
				{ratings.map((spread) => {
					const name = MEDIA_KIND_PLURALS[spread.kind];
					return (
						<div key={spread.kind} className="scout-stats-rating">
							<div className="scout-stats-rating-sum">
								<span className="scout-stats-rating-kind">
									<Icon name={KIND_ICONS[spread.kind]} size={13} /> {name}
								</span>
								<span className="scout-stats-rating-avg">
									<strong>{formatRating(Math.round(spread.average * 10) / 10)}</strong>/{spread.scale}
								</span>
								<span className="scout-stats-note">
									{spread.count} rated
								</span>
							</div>
							<BarChart
								compact
								color={kindColor(spread.kind)}
								label={`${name} by rating out of ${spread.scale}`}
								asTable={asTable}
								bars={spread.buckets.map((bucket) => ({
									key: String(bucket.upTo),
									label: formatRating(bucket.upTo),
									// Halves stay unlabelled so the whole numbers can breathe.
									tick: Number.isInteger(bucket.upTo) ? String(bucket.upTo) : "",
									count: bucket.count,
								}))}
							/>
						</div>
					);
				})}
			</div>
		</section>
	);
}

/** A delta as a fraction, in points out of ten, signed. */
function Delta({ delta }: { delta: number | null }): React.ReactElement | null {
	if (delta === null) return null;
	const points = Math.round(delta * 100) / 10;
	const tone = points > 0 ? "is-up" : points < 0 ? "is-down" : "is-even";
	return (
		<span className={`scout-stats-delta ${tone}`} title="Average rating against your overall average, out of 10">
			{points === 0 ? "±0" : `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(1)}`}
		</span>
	);
}

export function Traits({
	title,
	icon,
	traits,
	onSelect,
}: {
	title: string;
	icon: string;
	traits: TraitStat[];
	onSelect: (name: string) => void;
}): React.ReactElement | null {
	if (traits.length === 0) return null;
	const max = Math.max(...traits.map((one) => one.count));
	return (
		<section className="scout-stats-card">
			<CardHead title={title} icon={icon} aside="vs your average" />
			<ol className="scout-stats-ranks">
				{traits.map((one, at) => (
					<li key={one.name}>
						<button className="scout-plain" onClick={() => onSelect(one.name)} title={`Show ${one.name} in the library`}>
							<span className="scout-stats-rank">{at + 1}</span>
							<span className="scout-stats-rank-main">
								<span className="scout-stats-rank-name">{one.name}</span>
								<span className="scout-stats-rank-bar">
									<span style={{ width: `${(one.count / max) * 100}%` }} />
								</span>
							</span>
							<Delta delta={one.delta} />
							<span className="scout-stats-rank-count">{one.count}</span>
						</button>
					</li>
				))}
			</ol>
		</section>
	);
}

/** Things watched more than once, and things left waiting. */
export function Shelves({ ctx, stats }: { ctx: ScoutContext; stats: StatsData }): React.ReactElement | null {
	const open = (path: string) => new ScoutDetailModal(ctx, { entryPath: path }).open();
	const list = (rows: { path: string; title: string; kind: string; value: string; hint?: string }[]) => (
		<ul className="scout-stats-rows">
			{rows.map((row) => (
				<li key={row.path}>
					<button className="scout-plain" onClick={() => open(row.path)} title={row.hint}>
						<Icon name={KIND_ICONS[row.kind as keyof typeof KIND_ICONS] ?? "file"} size={14} />
						<span className="scout-stats-row-title">{row.title}</span>
						<span className="scout-stats-row-value">{row.value}</span>
					</button>
				</li>
			))}
		</ul>
	);
	return (
		<>
			{stats.replays.length > 0 && (
				<section className="scout-stats-card">
					<CardHead title="Again and again" icon="repeat" />
					{list(
						stats.replays.map(({ entry, times }) => ({
							path: entry.path,
							title: entry.title,
							kind: entry.kind,
							value: `${times}×`,
						})),
					)}
				</section>
			)}
			{stats.shelf.length > 0 && (
				<section className="scout-stats-card">
					<CardHead title="Waiting longest" icon="hourglass" />
					{list(
						stats.shelf.map(({ entry, since, days }) => ({
							path: entry.path,
							title: entry.title,
							kind: entry.kind,
							value: days >= 365 ? `${Math.floor(days / 365)} yr` : `${days} days`,
							hint: `On the list since ${since}`,
						})),
					)}
				</section>
			)}
		</>
	);
}
