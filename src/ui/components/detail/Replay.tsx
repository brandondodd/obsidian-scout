import React from "react";
import type { ScoutContext } from "../../../core/context";
import { statusTone } from "../../../core/library/config";
import type { LibraryEntry } from "../../../core/library/entry";
import { timesFinished } from "../../../core/library/replay";
import type { MediaKind } from "../../../core/types";
import { Icon } from "../shared";

/**
 * What each kind calls going round again.
 *
 * Vocabulary, not decoration: "Watch again" on a book is the sort of thing
 * that makes an app feel like it was written for something else.
 */
const AGAIN_LABEL: Record<MediaKind, string> = {
	movie: "Watch again",
	tv: "Watch again",
	anime: "Watch again",
	book: "Read again",
	manga: "Read again",
	game: "Play again",
	album: "Listen again",
	link: "Read again",
};

const TIMES_VERB: Record<MediaKind, string> = {
	movie: "Watched",
	tv: "Watched",
	anime: "Watched",
	book: "Read",
	manga: "Read",
	game: "Played",
	album: "Listened",
	link: "Read",
};

/**
 * How many times round you have been.
 *
 * A badge on the poster, which is where every other at-a-glance fact about an
 * item already lives. Terse, with the rest on the tooltip, because a badge is
 * glanced at rather than read.
 */
export function ReplayCount({
	entry,
}: {
	entry: LibraryEntry;
}): React.ReactElement | null {
	const times = timesFinished(entry);
	if (times < 2) return null;

	const dates = [...entry.history, entry.finished].filter(
		(date): date is string => Boolean(date),
	);

	return (
		<span
			className="scout-replay-count"
			aria-label={`${TIMES_VERB[entry.kind]} ${times} times`}
			title={`${TIMES_VERB[entry.kind]} ${times} times${
				dates.length > 0 ? ` — finished ${dates.join(", ")}` : ""
			}`}
		>
			<Icon name="repeat" size={11} />×{times}
		</span>
	);
}

/**
 * Starting it again.
 *
 * Only appears once there is something to start again. This is also what a
 * finished show offers now that its "all caught up" card has gone.
 */
export function ReplayControl({
	ctx,
	entry,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
}): React.ReactElement | null {
	const config = ctx.settings.library();
	if (statusTone(config, entry.status) !== "done") return null;

	return (
		<button
			className="sd-btn"
			title="Files the finish date away and starts a new run from today"
			onClick={() => void ctx.mutator.replay(entry)}
		>
			<Icon name="rotate-ccw" size={15} />
			{AGAIN_LABEL[entry.kind]}
		</button>
	);
}
