import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HypeBox, ScoreRow, ScoutBox } from "../../../core/detail/scores";
import type { Score } from "../../../core/detail/types";
import { oneDecimal } from "../../../core/format";
import { Icon } from "../shared";
import { ScoresSkeleton } from "./Skeleton";

/**
 * The score boxes.
 *
 * The tomato and popcorn are hand-drawn stand-ins for the two Rotten Tomatoes
 * numbers. They are deliberately not its artwork, which is a trademark.
 */

const Tomato = (): React.ReactElement => (
	<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
		<circle cx="12" cy="14" r="9.5" fill="#fa320a" />
		<path
			d="M12 7C10 3 6.500 3 5 4c1.500.2 2.500 1 3 2-2 0-3.500 1-4.500 2.500 2.500.2 5.500 0 8.500-1 3 1 6 1.200 8.500 1C19.500 7 18 6 16 6c.5-1 1.500-1.800 3-2-1.500-1-5-1-7 3Z"
			fill="#0a9b3c"
		/>
	</svg>
);

const Popcorn = (): React.ReactElement => (
	<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
		<circle cx="7.500" cy="7" r="3.800" fill="#f6e6b0" />
		<circle cx="12" cy="5" r="3.800" fill="#fff3cf" />
		<circle cx="16.500" cy="7" r="3.800" fill="#f6e6b0" />
		<path d="M4.500 9h15l-2 14h-11Z" fill="#fa320a" />
		<path
			d="M9 9h2.200l.2 14H9.800ZM12.800 9H15l-.8 14h-1.600Z"
			fill="#fff"
		/>
	</svg>
);

/**
 * The small caption under a number. The words get a box of their own so CSS
 * can trim it to the capitals, which is what centres an icon on the letters
 * rather than on a line box that keeps room for descenders capitals never use.
 */
function Caption({
	icon,
	hidden,
	children,
}: {
	icon?: React.ReactNode;
	/** Left unspoken, when the box speaks for itself. */
	hidden?: boolean;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<span {...(hidden ? { "aria-hidden": true } : {})}>
			{icon}
			<em className="sd-caption">{children}</em>
		</span>
	);
}

/**
 * A score box with a popover drawn on the document body.
 *
 * On the body because the header clips whatever hangs out of it, and opening
 * in place wrapped the row. Hover, focus, or a tap opens it; scrolling closes
 * it, since it is pinned to where the box was. What the popover says is also
 * spoken from inside the box: an `aria-label` would bring Obsidian's own
 * tooltip too, a second, later copy of the popover.
 */
function PopBox({
	className,
	spoken,
	pop,
	popClass,
	children,
}: {
	className: string;
	spoken: string;
	pop: React.ReactNode;
	popClass?: string;
	children: React.ReactNode;
}): React.ReactElement {
	const ref = useRef<HTMLDivElement>(null);
	const [at, setAt] = useState<{ left: number; top: number } | null>(null);

	const open = () => {
		const el = ref.current;
		if (!el) return;
		const box = el.getBoundingClientRect();
		const width = el.ownerDocument.defaultView?.innerWidth ?? box.right;
		const centre = box.left + box.width / 2;
		const half = popClass ? 150 : 90;
		setAt({ left: Math.min(Math.max(centre, half), width - half), top: box.bottom + 6 });
	};
	const close = () => setAt(null);

	useEffect(() => {
		if (!at) return;
		const view = ref.current?.ownerDocument.defaultView;
		const shut = () => setAt(null);
		view?.addEventListener("scroll", shut, true);
		view?.addEventListener("resize", shut);
		return () => {
			view?.removeEventListener("scroll", shut, true);
			view?.removeEventListener("resize", shut);
		};
	}, [at]);

	const body = ref.current?.ownerDocument.body;
	return (
		<div
			ref={ref}
			className={className}
			tabIndex={0}
			onMouseEnter={open}
			onMouseLeave={close}
			onFocus={open}
			onBlur={close}
		>
			<span className="scout-sr-only">{spoken}</span>
			{children}
			{at &&
				body &&
				createPortal(
					<div
						className={`scout-score-pop${popClass ? ` ${popClass}` : ""}`}
						role="tooltip"
						style={{ left: at.left, top: at.top }}
					>
						{pop}
					</div>,
					body,
				)}
		</div>
	);
}

/** "+2 More", and the scores behind it. */
function MoreBox({ more }: { more: Score[] }): React.ReactElement {
	return (
		<PopBox
			className="sd-score sd-more"
			spoken={`More scores: ${more.map((one) => `${one.label} ${one.value}`).join(", ")}`}
			pop={more.map((one) => (
				<div key={one.id} className="scout-score-pop-row">
					<span>{one.label}</span>
					<b>{one.value}</b>
				</div>
			))}
		>
			<b aria-hidden="true">+{more.length}</b>
			<span aria-hidden="true">
				<em className="sd-caption">More</em>
			</span>
		</PopBox>
	);
}

/**
 * The Scout score, and how it was worked out: each source's own number and
 * what it is on Scout's scale, the sources with the most say first.
 */
function ScoutBoxView({ scout }: { scout: ScoutBox }): React.ReactElement {
	const spoken = `Scout score ${scout.value}. ${scout.parts
		.map(
			(one) =>
				`${one.label} ${one.says} counts as ${one.countsAs}, ${Math.round(one.share * 100)}% of the say`,
		)
		.join(". ")}.${scout.steps.map((one) => ` ${one.label} ${one.by}.`).join("")}`;
	// Bars against the biggest say, so the gap between sources is what shows.
	const most = Math.max(...scout.parts.map((one) => one.share), 0.01);
	return (
		<PopBox
			className="sd-score sd-scout"
			spoken={spoken}
			popClass="scout-blend"
			pop={
				<>
					<div className="scout-blend-row scout-blend-head">
						<span>Source</span>
						<span>Score</span>
						<span>Weight</span>
					</div>
					{scout.parts.map((one) => (
						<div key={one.id} className="scout-blend-row">
							<span className="scout-blend-name">
								{one.label}
								{one.few && <small>{one.few}</small>}
							</span>
							<span className="scout-blend-score">
								<span className="scout-blend-says">{one.says}</span>
								<span className="scout-blend-to">→</span>
								<b>{one.countsAs}</b>
							</span>
							<span className="scout-blend-weight">
								<span className="scout-blend-bar">
									<i style={{ width: `${(one.share / most) * 100}%` }} />
								</span>
								{Math.round(one.share * 100)}%
							</span>
						</div>
					))}
					<div className="scout-blend-sum">
						{scout.steps.length > 0 && (
							<>
								<div className="scout-blend-line">
									<span>Weighted blend</span>
									<span>{scout.blended}</span>
								</div>
								{scout.steps.map((one) => (
									<div key={one.label} className="scout-blend-line is-step">
										<span>{one.label}</span>
										<span>{one.by}</span>
									</div>
								))}
							</>
						)}
						<div className="scout-blend-line is-total">
							<span>
								<Icon name="compass" size={12} />
								Scout
							</span>
							<b>{scout.value}</b>
						</div>
					</div>
				</>
			}
		>
			<b aria-hidden="true">{scout.value}</b>
			<Caption hidden icon={<Icon name="compass" size={11} />}>
				Scout
			</Caption>
		</PopBox>
	);
}

/**
 * Hype, for a film not out yet: the Scout score it is likely to settle at,
 * worked out from a typical film and what is known of this one.
 */
function HypeBoxView({ hype }: { hype: HypeBox }): React.ReactElement {
	const spoken = `Forecast ${hype.value}: the Scout score this is likely to settle at. A typical film ${
		hype.typical
	}.${hype.steps.map((one) => ` ${one.label}, ${one.detail}, ${one.by}.`).join("")}`;
	return (
		<PopBox
			className="sd-score sd-scout sd-hype"
			spoken={spoken}
			popClass="scout-blend is-hype"
			pop={
				<div className="scout-blend-sum is-alone">
					<div className="scout-blend-note">Likely Scout score once reviews settle</div>
					<div className="scout-blend-line">
						<span>A typical film</span>
						<span>{hype.typical}</span>
					</div>
					{hype.steps.map((one) => (
						<div key={one.reason} className="scout-blend-line is-step">
							<span className="scout-blend-name">
								{one.label}
								<small>{one.detail}</small>
							</span>
							<span>{one.by}</span>
						</div>
					))}
					<div className="scout-blend-line is-total">
						<span>
							<Icon name="telescope" size={12} />
							Forecast
						</span>
						<b>{hype.value}</b>
					</div>
				</div>
			}
		>
			<b aria-hidden="true">{hype.value}</b>
			<Caption hidden icon={<Icon name="telescope" size={11} />}>
				Forecast
			</Caption>
		</PopBox>
	);
}

export function ScoreBoxes({
	yours,
	showYours,
	row,
	loading,
	onRate,
}: {
	yours: number | undefined;
	/** A search result has no note yet, so there is nothing of yours to show. */
	showYours: boolean;
	row: ScoreRow;
	/** The source has yet to answer, so hold room for its scores. */
	loading: boolean;
	onRate: () => void;
}): React.ReactElement | null {
	const empty = !row.scout && !row.hype && !row.rt && row.boxes.length === 0 && !row.more;
	const waiting = loading && empty;
	if (!showYours && !waiting && empty) return null;
	return (
		<div className="sd-scores">
			{showYours && (
				<button
					className={`sd-score sd-you${yours === undefined ? " sd-empty" : ""}`}
					onClick={onRate}
				>
					<b>{yours === undefined ? "Rate" : oneDecimal(yours)}</b>
					<Caption icon={<Icon name="star" size={11} />}>You</Caption>
				</button>
			)}
			{row.scout && <ScoutBoxView scout={row.scout} />}
			{row.hype && <HypeBoxView hype={row.hype} />}
			{row.rt && (
				<div className="sd-score sd-rt" title="Rotten Tomatoes">
					{row.rt.critics && (
						<div>
							<b>{row.rt.critics}</b>
							<Caption icon={<Tomato />}>Critics</Caption>
						</div>
					)}
					{row.rt.audience && (
						<div>
							<b>{row.rt.audience}</b>
							<Caption icon={<Popcorn />}>Audience</Caption>
						</div>
					)}
				</div>
			)}
			{row.boxes.map((box) => (
				<div className="sd-score" key={box.id}>
					<b>{box.value}</b>
					<Caption>{box.label}</Caption>
				</div>
			))}
			{row.more && <MoreBox more={row.more} />}
			{waiting && <ScoresSkeleton />}
		</div>
	);
}
