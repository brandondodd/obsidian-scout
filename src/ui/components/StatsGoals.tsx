import React, { useState } from "react";
import type { ScoutContext } from "../../core/context";
import { cleanGoals } from "../../core/library/config";
import type { StatsData } from "../../core/library/stats";
import { MEDIA_KIND_PLURALS, type MediaKind } from "../../core/types";
import { Meter } from "./Charts";

/**
 * Yearly goals — "52 books" — shown as progress, and set right here.
 *
 * Stored in the plugin settings, one number per kind. Editing is tucked behind
 * a button so the card reads as progress, not as a form.
 */
export function Goals({
	ctx,
	goals,
	kinds,
}: {
	ctx: ScoutContext;
	goals: StatsData["goals"];
	kinds: readonly MediaKind[];
}): React.ReactElement | null {
	const [editing, setEditing] = useState(false);
	const config = ctx.settings.library();

	const setGoal = (kind: MediaKind, raw: string) => {
		const value = Number.parseInt(raw, 10);
		const next = { ...config.goals };
		if (Number.isFinite(value) && value > 0) next[kind] = value;
		else delete next[kind];
		ctx.settings.setLibrary("goals", cleanGoals(next));
	};

	if (goals.length === 0 && !editing) {
		return (
			<div className="scout-stats-goal-prompt">
				<button onClick={() => setEditing(true)}>Set a yearly goal</button>
			</div>
		);
	}

	return (
		<section className="scout-stats-card">
			<h3>
				Goals for {goals[0]?.year ?? new Date().getFullYear()}
				<button className="scout-stats-edit" onClick={() => setEditing(!editing)}>
					{editing ? "Done" : "Edit"}
				</button>
			</h3>
			{editing ? (
				<div className="scout-stats-goal-edit">
					{kinds.map((kind) => (
						<label key={kind}>
							{MEDIA_KIND_PLURALS[kind]}
							<input
								type="number"
								min={0}
								inputMode="numeric"
								placeholder="No goal"
								defaultValue={config.goals[kind] ?? ""}
								onBlur={(e) => setGoal(kind, e.target.value)}
							/>
						</label>
					))}
				</div>
			) : (
				<ul className="scout-stats-goals">
					{goals.map((goal) => {
						const label = `${goal.done} of ${goal.target} ${MEDIA_KIND_PLURALS[goal.kind].toLowerCase()}`;
						return (
							<li key={goal.kind}>
								<span>{label}</span>
								<Meter value={goal.done} max={goal.target} label={label} />
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
