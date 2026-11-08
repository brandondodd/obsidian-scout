import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { seasonFraction } from "../../../core/detail/episodes";
import { HEAT_RAMP } from "../../../core/detail/heat";
import { Icon } from "../shared";
import type { EpisodeView } from "./useEpisodeView";
import type { Show } from "./useShow";

/**
 * The bar under the tabs on a show with more than one season.
 *
 * List / Ratings comes first and never moves. List puts the season picker beside
 * it; Ratings swaps that for the score source and the key.
 */
export function EpisodeToolbar({
	view,
	show,
	hasScores,
}: {
	view: EpisodeView;
	show: Show;
	/** The key says nothing on an empty grid, so it waits for scores. */
	hasScores: boolean;
}): React.ReactElement | null {
	if (show.seasons.length < 2) return null;
	const list = view.mode === "list";

	return (
		<div className="sd-tool">
			<div className="sd-seg sd-modes">
				<button
					className={list ? "sd-on" : ""}
					onClick={() => view.setMode("list")}
				>
					<Icon name="list" size={14} /> List
				</button>
				<button
					className={list ? "" : "sd-on"}
					onClick={() => view.setMode("grid")}
				>
					<Icon name="layout-grid" size={14} /> Ratings
				</button>
			</div>

			{list ? (
				<SeasonStrip view={view} show={show} />
			) : (
				<>
					<div className="sd-srcl">
						<span>Scores from</span>
						<div className="sd-seg">
							{view.sources.map((source) => (
								<button
									key={source}
									className={view.source === source ? "sd-on" : ""}
									onClick={() => view.setSource(source)}
								>
									{view.sourceName(source)}
								</button>
							))}
						</div>
					</div>
					{hasScores && (
						<div
							className="sd-legend"
							title="Shades compare this show’s own episodes"
						>
							<span>Lower</span>
							<span className="sd-g">
								{HEAT_RAMP.map(([colour]) => (
									<i key={colour} style={{ background: colour }} />
								))}
							</span>
							<span>Higher</span>
						</div>
					)}
				</>
			)}
		</div>
	);
}

/**
 * The season picker. A long-running show has more seasons than the bar has
 * room for, so the numbers scroll on their own, the chosen one is kept in the
 * middle, and a chevron over a fade marks each end that has more beyond it.
 */
function SeasonStrip({
	view,
	show,
}: {
	view: EpisodeView;
	show: Show;
}): React.ReactElement {
	const rail = useRef<HTMLDivElement>(null);
	const [ends, setEnds] = useState({ back: false, more: false });
	const centred = useRef(false);

	// Which ends have seasons past them: on scroll, and whenever the bar resizes.
	useEffect(() => {
		const el = rail.current;
		if (!el) return;
		const measure = () => {
			const back = el.scrollLeft > 1;
			const more = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
			setEnds((was) => (was.back === back && was.more === more ? was : { back, more }));
		};
		measure();
		el.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => {
			el.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, [show.seasons.length]);

	// The chosen season to the middle: at once on opening, smoothly after.
	useLayoutEffect(() => {
		const el = rail.current;
		const on = el?.querySelector<HTMLElement>(".sd-sbtn.sd-on");
		if (!el || !on) return;
		const left = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
		const smooth =
			centred.current &&
			!el.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches;
		el.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
		centred.current = true;
	}, [view.season]);

	const page = (direction: 1 | -1) => {
		const el = rail.current;
		if (el) el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
	};

	return (
		<div className="sd-seg sd-seasons">
			<span className="sd-seg-l">Season</span>
			<div className="sd-season-rail">
				<div className="sd-season-scroll" ref={rail} role="tablist" aria-label="Season">
					{show.seasons.map((season) => {
						const fraction = seasonFraction(season, show.state);
						const on = season.number === view.season;
						const special = season.number <= 0;
						return (
							<button
								key={season.number}
								className={`sd-sbtn${on ? " sd-on" : ""}`}
								role="tab"
								aria-selected={on}
								title={`${season.name} · ${Math.round(fraction * 100)}% watched`}
								onClick={() => view.setSeason(season.number)}
							>
								{special ? "Sp" : season.number}
								{fraction > 0 && (
									<i
										className={fraction === 1 ? "sd-full" : ""}
										style={{
											width: `calc((100% - 12px) * ${fraction.toFixed(2)})`,
										}}
									/>
								)}
							</button>
						);
					})}
				</div>
				{/* Pointer help only: the tabs themselves are reachable by keyboard,
				    and focusing one scrolls it into view. */}
				{ends.back && (
					<button
						className="sd-snav sd-snav-back"
						tabIndex={-1}
						aria-hidden="true"
						onClick={() => page(-1)}
					>
						<Icon name="chevron-left" size={14} />
					</button>
				)}
				{ends.more && (
					<button
						className="sd-snav sd-snav-more"
						tabIndex={-1}
						aria-hidden="true"
						onClick={() => page(1)}
					>
						<Icon name="chevron-right" size={14} />
					</button>
				)}
			</div>
		</div>
	);
}
