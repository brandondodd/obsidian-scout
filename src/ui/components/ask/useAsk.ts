import { useEffect, useRef, useState } from "react";
import type { AskResult } from "../../../core/ai/ask";
import { askScout, shownLines, type AskOutcome } from "../../../core/ai/asker";
import { HISTORY_MAX, turnOf, type AskTurn } from "../../../core/ai/askModes";
import type { ScoutContext } from "../../../core/context";
import { isAbortError } from "../../../core/http";
import type { TasteProfile } from "../../../core/library/taste";
import { openLibrary } from "../../libraryView";

/**
 * The Ask bar's conversation: what is being asked, what came back, and the
 * turns before it that a follow-up refines.
 *
 * Nothing here outlives the page. Dismissing the answer drops the thread, and
 * closing Home aborts whatever was in flight.
 */

export type AskState =
	| { phase: "idle" }
	| { phase: "asking"; question: string; followUp: boolean }
	| { phase: "shown"; question: string; outcome: AskOutcome }
	| { phase: "error"; question: string; message: string };

export interface Ask {
	state: AskState;
	/** A follow-up refines what is showing rather than starting again. */
	refining: boolean;
	submit: (question: string) => void;
	dismiss: () => void;
	/** The sharing offer's two answers. */
	allow: () => void;
	notNow: () => void;
}

/** Opens the library at a filter, carrying the summary for its quiet line. */
export function showFind(ctx: ScoutContext, find: AskResult): void {
	void openLibrary(ctx.app, { ...find.focus, note: { summary: find.summary, unknown: find.unknown } });
}

export function useAsk(ctx: ScoutContext, profile: TasteProfile): Ask {
	const [state, setState] = useState<AskState>({ phase: "idle" });
	const history = useRef<AskTurn[]>([]);
	const running = useRef<AbortController | null>(null);
	const profileRef = useRef(profile);
	profileRef.current = profile;

	useEffect(() => () => running.current?.abort(), []);

	const run = async (question: string, turns: readonly AskTurn[]) => {
		running.current?.abort();
		const controller = new AbortController();
		running.current = controller;
		setState({ phase: "asking", question, followUp: turns.length > 0 });
		try {
			const outcome = await askScout(ctx, question, turns, controller.signal, profileRef.current);
			if (controller.signal.aborted) return;
			if (outcome.mode !== "offer") {
				history.current = [...turns, turnOf(question, outcome, shownLines(ctx, outcome))].slice(-HISTORY_MAX);
			}
			if (outcome.mode === "find") showFind(ctx, outcome.find);
			setState({ phase: "shown", question, outcome });
		} catch (err) {
			if (controller.signal.aborted || isAbortError(err)) return;
			setState({ phase: "error", question, message: err instanceof Error ? err.message : String(err) });
		} finally {
			if (running.current === controller) running.current = null;
		}
	};

	const refining = state.phase === "shown" && state.outcome.mode !== "offer";

	return {
		state,
		refining,
		submit: (question) => {
			const clean = question.trim();
			if (!clean) return;
			void run(clean, refining ? history.current : []);
		},
		dismiss: () => {
			running.current?.abort();
			running.current = null;
			history.current = [];
			setState({ phase: "idle" });
		},
		allow: () => {
			if (state.phase !== "shown") return;
			const { question } = state;
			void ctx.assistant.allowSharing().then(() => run(question, history.current));
		},
		notNow: () => {
			if (state.phase !== "shown" || state.outcome.mode !== "offer") return;
			const { question, outcome } = state;
			void ctx.assistant.declineSharing();
			// Answered as well as it can be without the library: as a filter.
			const find: AskOutcome = { mode: "find", summary: outcome.find.summary, find: outcome.find };
			history.current = [turnOf(question, find, [])];
			showFind(ctx, outcome.find);
			setState({ phase: "shown", question, outcome: find });
		},
	};
}
