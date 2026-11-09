import React, { useEffect, useRef, useState } from "react";
import { askFind } from "../../../core/ai/asker";
import type { ScoutContext } from "../../../core/context";
import { isAbortError } from "../../../core/http";
import type { LibraryFocus, LibraryNote } from "../../libraryView";
import { Icon } from "../shared";

/**
 * The sparkle in the library's search box: what you typed, turned into the
 * library's own filters where you are, rather than matched as text.
 *
 * The fast model, and only the question and the filter names are sent — the
 * same first tier as "Ask your library". What it made of the words shows as
 * one quiet line under the toolbar.
 */

export type AiLine = (LibraryNote & { error?: undefined }) | { error: string };

export function useLibraryAsk(ctx: ScoutContext, apply: (focus: LibraryFocus) => void) {
	const [busy, setBusy] = useState(false);
	const [line, setLine] = useState<AiLine | null>(null);
	const running = useRef<AbortController | null>(null);
	useEffect(() => () => running.current?.abort(), []);

	const ask = async (question: string) => {
		const clean = question.trim();
		if (!clean || busy) return;
		const controller = new AbortController();
		running.current = controller;
		setBusy(true);
		try {
			const result = await askFind(ctx, clean, controller.signal);
			if (controller.signal.aborted) return;
			apply({ ...result.focus, note: { summary: result.summary, unknown: result.unknown } });
		} catch (err) {
			if (controller.signal.aborted || isAbortError(err)) return;
			setLine({ error: err instanceof Error ? err.message : String(err) });
		} finally {
			if (running.current === controller) running.current = null;
			setBusy(false);
		}
	};

	return { busy, line, setLine, ask };
}

export function SparkleButton({ busy, onClick }: { busy: boolean; onClick: () => void }): React.ReactElement {
	return (
		<button
			className="scout-search-ai"
			aria-label="Turn this into filters with AI"
			title="Turn into filters"
			disabled={busy}
			onClick={onClick}
		>
			<Icon name={busy ? "loader" : "sparkles"} />
		</button>
	);
}

/** One quiet line under the toolbar: what the filters mean, or why there are none. */
export function AiNoteLine({ line, onDismiss }: { line: AiLine | null; onDismiss: () => void }): React.ReactElement | null {
	if (!line) return null;
	const text = line.error !== undefined
		? `Couldn't ask: ${line.error}`
		: `${line.summary || "Filtered your library."}${
				line.unknown.length ? ` Nothing in your library matches ${line.unknown.join(", ")}, so it was left out.` : ""
			}`;
	return (
		<div className={`scout-ai-line${line.error !== undefined ? " is-error" : ""}`} aria-live="polite">
			<Icon name="sparkles" size={13} />
			<span>{text}</span>
			<button className="scout-ai-line-close clickable-icon" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
				<Icon name="x" size={12} />
			</button>
		</div>
	);
}
