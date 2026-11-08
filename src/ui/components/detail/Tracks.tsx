import React, { useState } from "react";
import type { ScoutContext } from "../../../core/context";
import {
	FAVORITE_TRACKS_KEY,
	readFavoriteTracks,
	toggleTrack,
	TRACK_SEASON,
} from "../../../core/detail/tracks";
import type { Track } from "../../../core/detail/types";
import { oneDecimal } from "../../../core/format";
import { ratingScaleFor } from "../../../core/library/config";
import type { LibraryEntry } from "../../../core/library/entry";
import { episodeKey } from "../../../core/library/episodes";
import Rating from "../Rating";
import { Icon } from "../shared";

/** An album's track list, each with a score and a favourite of its own. */
export function TracksPane({
	ctx,
	entry,
	tracks,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry | undefined;
	tracks: readonly Track[];
}): React.ReactElement {
	const [open, setOpen] = useState<number | null>(null);
	const config = ctx.settings.library();
	const liked = readFavoriteTracks(entry?.frontmatter[FAVORITE_TRACKS_KEY]);

	const rate = (code: string, rating: number | null) => {
		if (!entry) return;
		const note = entry.episodeLog[code]?.note;
		void ctx.mutator.setEpisodeMark(entry, code, {
			...(rating !== null ? { rating } : {}),
			...(note ? { note } : {}),
		});
		setOpen(null);
	};

	return (
		<div className="sd-ep-page">
			<ol className="sd-tracks">
				{tracks.map((track) => {
					const code = episodeKey(TRACK_SEASON, track.number);
					const rating = entry?.episodeLog[code]?.rating;
					const on = liked.includes(track.number);
					return (
						<li className="sd-tr" key={track.number}>
							<span className="sd-n">{track.number}</span>
							<span className="sd-tt">
								{track.title}
								{track.featuring && <small>with {track.featuring}</small>}
							</span>
							{!entry ? (
								<span />
							) : open === track.number ? (
								<span className="sd-ctl">
									<Rating
										value={rating}
										scale={ratingScaleFor(config, entry.kind)}
										step={config.ratingStep}
										icon={config.ratingIcon}
										slots={5}
										size={17}
										onChange={(value) => rate(code, value)}
									/>
								</span>
							) : rating !== undefined ? (
								<button
									className="sd-myr"
									onClick={() => setOpen(track.number)}
								>
									★ {oneDecimal(rating)}
								</button>
							) : (
								<button
									className="sd-rate"
									onClick={() => setOpen(track.number)}
								>
									<Icon name="star" size={14} /> Rate
								</button>
							)}
							{entry ? (
								<button
									className={`sd-hearts${on ? " sd-on" : ""}`}
									aria-label="Favourite track"
									aria-pressed={on}
									onClick={() =>
										void ctx.mutator.patch(entry, {
											[FAVORITE_TRACKS_KEY]: toggleTrack(
												liked,
												track.number,
											),
										})
									}
								>
									<Icon name="heart" size={15} />
								</button>
							) : (
								<span />
							)}
							<span className="sd-len">{track.length}</span>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
