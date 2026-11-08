import React, { useState } from "react";
import type { LibraryEntry } from "../../../core/library/entry";
import type { LibraryGroup } from "../../../core/library/group";

/**
 * The board: one column per group, side by side.
 *
 * What the grid and the list cannot do is show where everything stands at
 * once. Grouped by progress it is a to-do board — in progress, not started,
 * on hold, finished — and by type or genre it is the library laid out as
 * piles on a table. Each column scrolls on its own, so a long "Finished" does
 * not push "In progress" off the screen.
 */

/** Cards drawn per column before "Show more" — a column is read from the top. */
const STEP = 40;

export function Board({
	groups,
	card,
}: {
	groups: readonly LibraryGroup[];
	card: (entry: LibraryEntry) => React.ReactNode;
}): React.ReactElement {
	return (
		<div className="scout-board">
			{groups.map((group) => (
				<Column key={group.key} group={group} card={card} />
			))}
		</div>
	);
}

function Column({
	group,
	card,
}: {
	group: LibraryGroup;
	card: (entry: LibraryEntry) => React.ReactNode;
}): React.ReactElement {
	const [shown, setShown] = useState(STEP);
	const rest = group.entries.length - shown;
	return (
		<section className="scout-board-col" aria-label={group.label}>
			<header className="scout-board-head">
				<span>{group.label || "Everything"}</span>
				<span className="scout-count">{group.entries.length}</span>
			</header>
			<div className="scout-board-cards scout-entries scout-entries-list">
				{group.entries.slice(0, shown).map(card)}
				{rest > 0 && (
					<button className="scout-board-more" onClick={() => setShown(shown + STEP * 2)}>
						Show {Math.min(rest, STEP * 2)} more
					</button>
				)}
			</div>
		</section>
	);
}
