import React, { useEffect, useRef, useState } from "react";
import type { ScoutContext } from "../../../core/context";
import { Icon } from "../shared";
import type { Ask } from "./useAsk";

/**
 * The Ask bar, under Home's greeting. Only drawn when the AI is on and set up.
 *
 * Enter asks; Escape puts away the answer. While an answer is showing, what you
 * type refines it — the placeholder says so.
 */
export function AskBar({
	ctx,
	ask,
	focusNonce,
}: {
	ctx: ScoutContext;
	ask: Ask;
	/** Bumped by the "Ask Scout" command to put the cursor here. */
	focusNonce: number;
}): React.ReactElement {
	const [text, setText] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const busy = ask.state.phase === "asking";

	useEffect(() => {
		if (focusNonce > 0) input.current?.focus();
	}, [focusNonce]);

	const submit = () => {
		if (busy || !text.trim()) return;
		ask.submit(text);
		setText("");
	};

	const placeholder = ask.refining
		? "Refine it — “something shorter”, “but a book”…"
		: ctx.assistant.sharing()
			? "Ask Scout — “something cosy for tonight”, “a book like Hades”…"
			: "Ask your library — “sci-fi I loved from the 90s”…";

	return (
		<form
			className={`scout-ask-bar${busy ? " is-busy" : ""}`}
			role="search"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<Icon name="sparkles" size={15} />
			<input
				ref={input}
				type="text"
				className="scout-ask-input"
				aria-label="Ask Scout"
				placeholder={placeholder}
				value={text}
				enterKeyHint="send"
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Escape") return;
					if (text) setText("");
					else if (ask.state.phase !== "idle") ask.dismiss();
					else return;
					event.preventDefault();
					event.stopPropagation();
				}}
			/>
			<button
				type="submit"
				className="scout-ask-go"
				disabled={busy || !text.trim()}
				aria-label={busy ? "Asking" : "Ask"}
				title="Ask"
			>
				<Icon name={busy ? "loader" : "arrow-up"} size={14} />
			</button>
		</form>
	);
}
