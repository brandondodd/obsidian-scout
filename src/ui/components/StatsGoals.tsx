import React, { useState } from "react";
import type { ScoutContext } from "../../core/context";
import { cleanGoals } from "../../core/library/config";
import type { StatsData } from "../../core/library/stats";
import { MEDIA_KIND_PLURALS, type MediaKind } from "../../core/types";
import { Meter, kindColor } from "./Charts";
import { Icon, KIND_ICONS } from "./shared";

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
	now,
}: {
	ctx: ScoutContext;
	goals: StatsData["goals"];
	kinds: readonly MediaKind[];
	now: Date;
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
				<Icon name="target" size={16} />
				<span>Set a yearly goal and see whether you're on pace.</span>
				<button className="scout-plain" onClick={() => setEditing(true)}>
					Set a goal
				</button>
			</div>
		);
	}

	return (
		<section className="scout-stats-card">
			<header className="scout-stats-card-head">
				<h3>
					<Icon name="target" size={15} />
					Goals for {goals[0]?.year ?? now.getFullYear()}
				</h3>
				<button className="scout-plain scout-stats-edit" onClick={() => setEditing(!editing)}>
					{editing ? "Done" : "Edit"}
				</button>
			</header>
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
						const plural = MEDIA_KIND_PLURALS[goal.kind].toLowerCase();
						const label = `${goal.done} of ${goal.target} ${plural}`;
						const pace = paceFraction(goal.year, now);
						const behind = pace === null ? 0 : Math.round(goal.target * pace) - goal.done;
						const status =
							goal.done >= goal.target
								? "Goal reached"
								: pace === null
									? `${goal.target - goal.done} short`
									: behind > 0
										? `${behind} behind pace`
										: behind < 0
											? `${-behind} ahead of pace`
											: "On pace";
						return (
							<li key={goal.kind}>
								<div className="scout-stats-goal-line">
									<span className="scout-stats-goal-kind">
										<Icon name={KIND_ICONS[goal.kind]} size={14} /> {MEDIA_KIND_PLURALS[goal.kind]}
									</span>
									<span>
										<strong>{goal.done}</strong>
										<span className="scout-stats-note"> / {goal.target}</span>
									</span>
								</div>
								<Meter
									value={goal.done}
									max={goal.target}
									label={label}
									color={kindColor(goal.kind)}
									marker={pace ?? undefined}
								/>
								<span className={`scout-stats-note${behind > 0 && goal.done < goal.target ? " is-behind" : ""}`}>
									{Math.round(Math.min(1, goal.done / goal.target) * 100)}% · {status}
								</span>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

/** How far through the goal's year today is, or null for a year that is over or yet to come. */
function paceFraction(year: number, now: Date): number | null {
	if (year !== now.getFullYear()) return null;
	const start = new Date(year, 0, 1).getTime();
	const end = new Date(year + 1, 0, 1).getTime();
	return (now.getTime() - start) / (end - start);
}
