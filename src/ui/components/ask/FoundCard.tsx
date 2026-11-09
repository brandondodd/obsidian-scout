import { Notice } from "obsidian";
import React, { useState } from "react";
import type { Found } from "../../../core/ai/discover";
import type { ScoutContext } from "../../../core/context";
import { feedbackKey, recordFor, type FeedbackVerdict } from "../../../core/library/feedback";
import type { LibraryEntry } from "../../../core/library/entry";
import { MEDIA_KIND_LABELS, type MediaItem } from "../../../core/types";
import { ScoutDetailModal } from "../../detailModal";
import MediaCard from "../Card";
import { Icon, resolveImage } from "../shared";

/**
 * A title the AI named and a source found, as a card.
 *
 * The same three actions as the suggestion row, recorded the same way, so what
 * you say about an AI find teaches the local model exactly as a thumbs on the
 * row does: thumbs up, add (which counts as a yes), and not for me.
 */

/** A verdict, or the same verdict again to take it back. */
export function vote(ctx: ScoutContext, item: MediaItem, verdict: FeedbackVerdict): void {
	const key = feedbackKey(item.ref);
	const current = ctx.settings.feedback()[key]?.verdict;
	ctx.settings.setFeedback(key, current === verdict ? null : recordFor(item, verdict));
}

/** Adding is the strongest yes there is; not a toggle. */
export function likedByAdding(ctx: ScoutContext, item: MediaItem): void {
	const key = feedbackKey(item.ref);
	if (ctx.settings.feedback()[key]?.verdict === "liked") return;
	ctx.settings.setFeedback(key, recordFor(item, "liked"));
}

/** Shown, minus anything you have since said is not for you. */
export function stillWanted(ctx: ScoutContext, found: readonly Found[]): Found[] {
	const feedback = ctx.settings.feedback();
	return found.filter((one) => feedback[feedbackKey(one.item.ref)]?.verdict !== "disliked");
}

export function FoundCard({ ctx, found }: { ctx: ScoutContext; found: Found }): React.ReactElement {
	const { item, reason } = found;
	const [busy, setBusy] = useState(false);
	const owned: LibraryEntry | undefined = ctx.library.match(item);
	const verdict = ctx.settings.feedback()[feedbackKey(item.ref)]?.verdict;
	const meta = [item.year ? String(item.year) : null, MEDIA_KIND_LABELS[item.ref.kind]].filter(Boolean).join(" · ");

	const add = async (event: React.MouseEvent) => {
		event.stopPropagation();
		if (busy || owned) return;
		setBusy(true);
		try {
			await ctx.factory.create(item, new AbortController().signal);
			likedByAdding(ctx, item);
		} catch (err) {
			new Notice(`Could not create the note: ${err instanceof Error ? err.message : "unknown error"}`);
		} finally {
			setBusy(false);
		}
	};

	const press = (event: React.MouseEvent, next: FeedbackVerdict) => {
		event.stopPropagation();
		vote(ctx, item, next);
	};

	return (
		<MediaCard
			className={`scout-suggestion scout-ai-found${verdict === "liked" ? " is-liked" : ""}`}
			title={item.title}
			kind={item.ref.kind}
			cover={resolveImage(ctx.app, item.thumbnailUrl ?? item.imageUrl)}
			hint={reason ? `${item.title} — ${reason}` : item.title}
			meta={meta}
			foot={<AiReason reason={reason} />}
			onOpen={() =>
				owned
					? new ScoutDetailModal(ctx, { entryPath: owned.path }).open()
					: new ScoutDetailModal(ctx, { item }).open()
			}
			overlay={
				owned ? (
					<span className="scout-home-badge scout-ai-owned" title="In your library">
						<Icon name="check" size={10} /> In library
					</span>
				) : (
					<div className="scout-suggest-actions">
						<button
							className={`scout-suggest-vote${verdict === "liked" ? " is-on" : ""}`}
							aria-pressed={verdict === "liked"}
							aria-label={`More like ${item.title}`}
							title="More like this"
							onClick={(e) => press(e, "liked")}
						>
							<Icon name="thumbs-up" size={13} />
						</button>
						<button
							className="scout-suggest-add"
							disabled={busy}
							aria-label={`Add ${item.title} to your library`}
							title="Add to library"
							onClick={(event) => void add(event)}
						>
							<Icon name={busy ? "loader" : "plus"} size={14} />
						</button>
						<button
							className="scout-suggest-vote"
							aria-label={`Not for me: ${item.title}`}
							title="Not for me — and less like it"
							onClick={(e) => press(e, "disliked")}
						>
							<Icon name="thumbs-down" size={13} />
						</button>
					</div>
				)
			}
		/>
	);
}

/** The model's one-line reason, in the card's foot. */
export function AiReason({ reason }: { reason: string }): React.ReactElement {
	return (
		<span className="scout-why is-strong scout-ai-why" title={reason}>
			<Icon name="sparkles" size={10} />
			<span className="scout-why-text">{reason || "Worth a look"}</span>
		</span>
	);
}
