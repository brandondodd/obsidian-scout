import React from "react";

/**
 * Placeholders for what the source has yet to send.
 *
 * Each one holds roughly the room the real thing takes, so when the answer
 * lands it fades in where the placeholder was instead of shoving the rest of
 * the dialog down. Hidden from screen readers, which hear the result instead.
 */

/** One shimmering block. */
export function Bone({
	w,
	h,
	round,
	className,
}: {
	w?: number | string;
	h?: number | string;
	round?: boolean;
	className?: string;
}): React.ReactElement {
	return (
		<span
			className={`sd-bone${round ? " sd-round" : ""}${className ? ` ${className}` : ""}`}
			style={{ width: w, height: h }}
		/>
	);
}

const range = (count: number): number[] =>
	Array.from({ length: count }, (_, at) => at);

/** The score boxes beside "You", while the scores are on their way. */
export function ScoresSkeleton(): React.ReactElement {
	return (
		<>
			{range(3).map((at) => (
				<span key={at} className="sd-score sd-score-bone" aria-hidden="true">
					<Bone w={34} h={15} />
					<Bone w={44} h={9} />
				</span>
			))}
		</>
	);
}

/** The "Created by" line under the description. */
export function CreditSkeleton(): React.ReactElement {
	return (
		<p className="sd-credits" aria-hidden="true">
			<Bone w={170} h={12} />
		</p>
	);
}

/** A section heading and a row of service tiles. */
export function WhereSkeleton(): React.ReactElement {
	return (
		<section className="sd-sec sd-skel" aria-hidden="true">
			<div className="sd-sec-h">
				<Bone w={130} h={16} />
			</div>
			<Bone w={64} h={9} className="sd-skel-lab" />
			<div className="sd-tiles">
				{[118, 96, 132].map((w) => (
					<Bone key={w} w={w} h={38} className="sd-skel-tile" />
				))}
			</div>
		</section>
	);
}

/** The Up next card, while the episode it points at loads. */
export function UpNextSkeleton(): React.ReactElement {
	return (
		<div className="sd-cont sd-skel" aria-hidden="true">
			<Bone className="sd-still" />
			<div className="sd-skel-col">
				<Bone w={90} h={10} />
				<Bone w="70%" h={16} />
				<Bone w={110} h={11} />
				<Bone w={150} h={30} />
			</div>
		</div>
	);
}

/** The people grid and a rail, for the Cast & more tab. */
export function MoreSkeleton({
	people,
}: {
	people: boolean;
}): React.ReactElement {
	return (
		<>
			{people && (
				<section className="sd-sec sd-skel" aria-hidden="true">
					<div className="sd-sec-h">
						<Bone w={110} h={16} />
					</div>
					<div className="sd-pgrid">
						{range(6).map((at) => (
							<span key={at} className="sd-pp">
								<Bone round className="sd-av" />
								<span className="sd-skel-col">
									<Bone w="62%" h={13} />
									<Bone w="44%" h={10} />
								</span>
							</span>
						))}
					</div>
				</section>
			)}
			<section className="sd-sec sd-skel" aria-hidden="true">
				<div className="sd-sec-h">
					<Bone w={140} h={16} />
				</div>
				<div className="sd-rail">
					{range(5).map((at) => (
						<span key={at} className="sd-card">
							<Bone className="sd-pimg2" />
							<Bone w="80%" h={12} className="sd-skel-t" />
							<Bone w="50%" h={10} />
						</span>
					))}
				</div>
			</section>
		</>
	);
}

/** Episode rows, while a season loads. */
export function EpisodesSkeleton(): React.ReactElement {
	return (
		<div className="sd-ep-page sd-skel" aria-hidden="true">
			<Bone w={120} h={16} className="sd-skel-head" />
			{range(5).map((at) => (
				<div key={at} className="sd-skel-ep">
					<Bone round w={26} h={26} />
					<span className="sd-skel-col">
						<Bone w="45%" h={14} />
						<Bone w="30%" h={10} />
						<Bone w="85%" h={10} />
					</span>
				</div>
			))}
		</div>
	);
}
