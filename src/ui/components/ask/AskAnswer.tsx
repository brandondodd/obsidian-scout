import React from "react";
import { missingNote } from "../../../core/ai/discover";
import type { ScoutContext } from "../../../core/context";
import { MEDIA_KIND_LABELS } from "../../../core/types";
import { ScoutDetailModal } from "../../detailModal";
import MediaCard from "../Card";
import { Icon, resolveImage, useSettingsVersion } from "../shared";
import StatusBadge, { progressFraction, statusClass } from "../Status";
import { AiReason, FoundCard, stillWanted } from "./FoundCard";
import { showFind, type Ask } from "./useAsk";

/**
 * What the Ask bar answered, directly under Home's header.
 *
 * One line saying what it is — sparkles, a sentence, a ✕ — then the cards, in
 * the same rail every other row uses. The line is a live region, so a screen
 * reader hears the answer arrive.
 */
export function AskAnswer({ ctx, ask }: { ctx: ScoutContext; ask: Ask }): React.ReactElement | null {
	// Thumbs and adds change what the cards show.
	useSettingsVersion(ctx.settings);
	const { state } = ask;
	if (state.phase === "idle") return null;

	const head = (text: React.ReactNode) => (
		<div className="scout-ask-head">
			<Icon name="sparkles" size={14} />
			<p className="scout-ask-summary" aria-live="polite">
				{text}
			</p>
			<button className="scout-ask-close clickable-icon" aria-label="Dismiss the answer" title="Dismiss" onClick={ask.dismiss}>
				<Icon name="x" size={14} />
			</button>
		</div>
	);

	let body: React.ReactNode = null;
	let line: React.ReactNode;
	if (state.phase === "asking") {
		line = <span className="scout-ask-thinking">{state.followUp ? "Refining…" : "Thinking…"}</span>;
		body = <Waiting />;
	} else if (state.phase === "error") {
		line = <span className="scout-ai-error-line">Couldn't ask: {state.message}</span>;
	} else {
		const { outcome } = state;
		if (outcome.mode === "offer") {
			line = (
				<span className="scout-ai-offer">
					{outcome.wanted === "pick"
						? "To pick from your shelf, Scout needs to see your titles."
						: "To suggest new things, Scout needs to see your titles."}
					<button className="scout-ai-link" onClick={ask.allow}>
						Allow
					</button>
					<span aria-hidden>·</span>
					<button className="scout-ai-link" onClick={ask.notNow}>
						Not now
					</button>
				</span>
			);
		} else if (outcome.mode === "find") {
			const left = outcome.find.unknown.length
				? ` Nothing matches ${outcome.find.unknown.join(", ")}, so it was left out.`
				: "";
			line = (
				<>
					{outcome.summary || "Filtered your library."}
					{left}{" "}
					<button className="scout-ai-link" onClick={() => showFind(ctx, outcome.find)}>
						Open in library
					</button>
				</>
			);
		} else if (outcome.mode === "pick") {
			line = outcome.summary || "From your shelf";
			const config = ctx.settings.library();
			body = (
				<div className="scout-entries scout-entries-grid scout-home-rail">
					{outcome.picks.map(({ path, reason }) => {
						const entry = ctx.library.byPath(path);
						if (!entry) return null;
						return (
							<MediaCard
								key={path}
								title={entry.title}
								kind={entry.kind}
								cover={resolveImage(ctx.app, entry.cover, entry.path)}
								tone={statusClass(config, entry.status)}
								favorite={entry.favorite}
								hint={reason ? `${entry.title} — ${reason}` : entry.title}
								meta={[MEDIA_KIND_LABELS[entry.kind], entry.year].filter(Boolean).join(" · ")}
								onOpen={() => new ScoutDetailModal(ctx, { entryPath: entry.path }).open()}
								overlay={
									entry.status ? (
										<StatusBadge
											config={config}
											status={entry.status}
											progress={progressFraction(entry.progress, entry.progressTotal)}
											className="scout-entry-status"
											size={11}
										/>
									) : undefined
								}
								foot={<AiReason reason={reason} />}
							/>
						);
					})}
				</div>
			);
		} else {
			const shown = stillWanted(ctx, outcome.found);
			line = outcome.summary || "Something new";
			body = (
				<>
					<div className="scout-entries scout-entries-grid scout-home-rail">
						{shown.map((found) => (
							<FoundCard key={`${found.item.ref.providerId}:${found.item.ref.id}`} ctx={ctx} found={found} />
						))}
					</div>
					{missingNote(outcome.missing) && <p className="scout-ask-foot">{missingNote(outcome.missing)}</p>}
				</>
			);
		}
	}

	return (
		<section className="scout-home-section scout-ask-answer" aria-label="Scout's answer">
			{head(line)}
			{body}
		</section>
	);
}

/** Seats for the cards on their way, like the suggestion row's. */
function Waiting(): React.ReactElement {
	return (
		<div className="scout-entries scout-entries-grid scout-home-rail is-waiting" aria-hidden="true">
			{Array.from({ length: 4 }, (_, at) => (
				<div key={at} className="scout-entry scout-suggestion is-waiting">
					<div className="scout-entry-art" />
					<div className="scout-entry-info">
						<h4 />
						<div className="scout-entry-meta" />
						<div className="scout-entry-foot" />
					</div>
				</div>
			))}
		</div>
	);
}
