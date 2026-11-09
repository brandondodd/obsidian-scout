import React, { useEffect, useRef, useState } from "react";
import { missingNote } from "../../../core/ai/discover";
import { acrossEligible, FIT_LABELS, takeEligible, type Take, type TitleFacts } from "../../../core/ai/take";
import { askAcross, askTake, cachedAcross, cachedTake, titleKey, type Across } from "../../../core/ai/takes";
import type { ScoutContext } from "../../../core/context";
import { isAbortError } from "../../../core/http";
import type { LibraryEntry } from "../../../core/library/entry";
import type { MediaItem } from "../../../core/types";
import { FoundCard, stillWanted } from "../ask/FoundCard";
import { Icon, useSettingsVersion } from "../shared";
import type { Presented } from "./present";

/**
 * Scout's take and Across kinds, on the Overview.
 *
 * Each is one quiet line until it is asked for, and asking is the only thing
 * that calls a model — opening the page never does. An answer from the last
 * thirty days is shown straight away, since it costs nothing to show again.
 * Both need sharing; with the AI on and sharing not yet allowed, asking shows
 * the one offer to allow it instead.
 */
export function AiTakes({
	ctx,
	item,
	entry,
	view,
}: {
	ctx: ScoutContext;
	item: MediaItem | undefined;
	entry: LibraryEntry | undefined;
	view: Presented;
}): React.ReactElement | null {
	useSettingsVersion(ctx.settings);
	const { assistant } = ctx;
	if (!assistant.ready()) return null;
	const title = titleKey(item?.ref ?? entry?.ref, entry);
	if (!title) return null;
	const config = ctx.settings.library();
	const take = takeEligible(config, entry, view.kind);
	const across = acrossEligible(config, entry);
	if (!take && !across) return null;
	if (!assistant.canShare() && !assistant.shouldOfferSharing()) return null;

	const facts: TitleFacts = {
		title: view.title,
		...(view.year ? { year: view.year } : {}),
		kind: view.kind,
		genres: view.tags,
		people: view.people,
		moods: entry?.moods ?? [],
		themes: entry?.themes ?? [],
		...(view.description ? { description: view.description } : {}),
		...(view.sourceRating !== undefined ? { score: view.sourceRating } : {}),
	};

	return (
		<>
			{take && <TakeSection key={`take:${title}`} ctx={ctx} title={title} facts={facts} />}
			{across && <AcrossSection key={`across:${title}`} ctx={ctx} title={title} facts={facts} />}
		</>
	);
}

/** Asking, aborting on close, and the offer when sharing is needed first. */
function useAsking<T>(ctx: ScoutContext, initial: T | null, call: (signal: AbortSignal) => Promise<T>) {
	const [value, setValue] = useState<T | null>(initial);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [offering, setOffering] = useState(false);
	const running = useRef<AbortController | null>(null);
	useEffect(() => () => running.current?.abort(), []);

	const ask = async () => {
		if (busy) return;
		if (!ctx.assistant.canShare()) {
			setOffering(true);
			return;
		}
		setOffering(false);
		const controller = new AbortController();
		running.current = controller;
		setBusy(true);
		setError("");
		try {
			const next = await call(controller.signal);
			if (!controller.signal.aborted) setValue(next);
		} catch (err) {
			if (controller.signal.aborted || isAbortError(err)) return;
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			if (running.current === controller) running.current = null;
			setBusy(false);
		}
	};

	const allow = async () => {
		await ctx.assistant.allowSharing();
		await ask();
	};

	return { value, busy, error, offering, ask, allow };
}

function AskLine({
	ctx,
	label,
	state,
}: {
	ctx: ScoutContext;
	label: string;
	state: { busy: boolean; error: string; offering: boolean; ask: () => Promise<void>; allow: () => Promise<void> };
}): React.ReactElement {
	if (state.offering) {
		return (
			<p className="scout-ai-ask-line is-offer">
				<span className="scout-ai-offer">
					<Icon name="sparkles" size={13} />
					To answer that, Scout needs to see your titles.
					<button className="scout-ai-link" onClick={() => void state.allow()}>
						Allow
					</button>
					<span aria-hidden>·</span>
					<button className="scout-ai-link" onClick={() => void ctx.assistant.declineSharing()}>
						Not now
					</button>
				</span>
			</p>
		);
	}
	return (
		<p className="scout-ai-ask-line">
			<button className="scout-ai-ask" disabled={state.busy} aria-busy={state.busy} onClick={() => void state.ask()}>
				<Icon name={state.busy ? "loader" : "sparkles"} size={13} />
				{state.busy ? "Thinking…" : label}
			</button>
			{state.error && <span className="scout-ai-error-line" role="status">{state.error}</span>}
		</p>
	);
}

function TakeSection({ ctx, title, facts }: { ctx: ScoutContext; title: string; facts: TitleFacts }): React.ReactElement {
	const state = useAsking<Take>(ctx, cachedTake(ctx, title), (signal) => askTake(ctx, title, facts, signal));
	const take = state.value;
	if (!take) return <AskLine ctx={ctx} label="What would I make of this?" state={state} />;
	return (
		<section className="sd-sec scout-ai-take" aria-live="polite">
			<h3 className="scout-section-title">
				<Icon name="sparkles" size={14} />
				Scout's take
				<span className={`scout-ai-fit is-${take.fit}`}>{FIT_LABELS[take.fit]}</span>
			</h3>
			{take.headline && <p className="scout-ai-take-headline">{take.headline}</p>}
			{take.why && <p className="scout-ai-take-why">{take.why}</p>}
			<button className="scout-ai-link scout-ai-again" disabled={state.busy} onClick={() => void state.ask()}>
				{state.busy ? "Thinking…" : "Ask again"}
			</button>
			{state.error && <span className="scout-ai-error-line">{state.error}</span>}
		</section>
	);
}

function AcrossSection({ ctx, title, facts }: { ctx: ScoutContext; title: string; facts: TitleFacts }): React.ReactElement {
	const state = useAsking<Across>(ctx, cachedAcross(ctx, title), (signal) => askAcross(ctx, title, facts, signal));
	const across = state.value;
	if (!across) return <AskLine ctx={ctx} label="If you loved this…" state={state} />;
	const shown = stillWanted(ctx, across.found);
	const note = missingNote(across.missing);
	return (
		<section className="sd-sec scout-ai-across" aria-live="polite">
			<h3 className="scout-section-title">
				<Icon name="sparkles" size={14} />
				If you loved this…
			</h3>
			<div className="scout-entries scout-entries-grid scout-ai-across-rail">
				{shown.map((found) => (
					<FoundCard key={`${found.item.ref.providerId}:${found.item.ref.id}`} ctx={ctx} found={found} />
				))}
			</div>
			{note && <p className="scout-ask-foot">{note}</p>}
		</section>
	);
}
