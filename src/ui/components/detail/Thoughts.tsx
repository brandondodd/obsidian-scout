import { Component, MarkdownRenderer } from "obsidian";
import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { ScoutContext } from "../../../core/context";
import type { LibraryEntry } from "../../../core/library/entry";
import { useEscape } from "./useEscape";

/** Autosave delay. Long enough not to fight typing. */
const SAVE_DELAY = 700;

/**
 * Rendered by Obsidian, so links and emphasis look the way they do in the note.
 * The component exists only to own whatever the renderer attaches.
 */
function RenderedThoughts({
	ctx,
	text,
	path,
	onEdit,
	onClose,
}: {
	ctx: ScoutContext;
	text: string;
	path: string;
	onEdit: () => void;
	onClose: () => void;
}): React.ReactElement {
	const box = useRef<HTMLDivElement>(null);

	// Before paint: rendered after it, the box was drawn empty for a frame and
	// then grew, pushing everything under it down.
	useLayoutEffect(() => {
		const el = box.current;
		if (!el) return;
		const owner = new Component();
		owner.load();
		el.empty();
		void MarkdownRenderer.render(ctx.app, text, el, path, owner);
		return () => owner.unload();
	}, [ctx.app, text, path]);

	return (
		<div
			ref={box}
			className="sd-md"
			title="Select to edit"
			onClick={(event) => {
				const link = (event.target as HTMLElement).closest("a");
				if (!link) {
					onEdit();
					return;
				}
				event.preventDefault();
				const target =
					link.getAttribute("data-href") ?? link.getAttribute("href") ?? "";
				if (link.classList.contains("internal-link")) {
					void ctx.app.workspace.openLinkText(target, path);
					onClose();
				} else if (target) {
					window.open(target, "_blank", "noopener");
				}
			}}
		/>
	);
}

/**
 * The text under the note's thoughts heading.
 *
 * Reads as the note would until selected, then it is a text area that saves as
 * you go. Closing the dialog flushes anything still waiting to save.
 */
export function Thoughts({
	ctx,
	entry,
	onClose,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	onClose: () => void;
}): React.ReactElement {
	const heading = ctx.settings.library().thoughtsHeading;
	const [text, setText] = useState("");
	const [editing, setEditing] = useState(false);
	const [state, setState] = useState<"loading" | "clean" | "dirty" | "saved">(
		"loading",
	);
	const timer = useRef<number | null>(null);
	const box = useRef<HTMLTextAreaElement>(null);
	const pending = useRef<string | null>(null);
	/**
	 * The entry object is replaced on every index update, including the ones this
	 * panel's own writes cause, so the load effect keys off the path alone and
	 * reads the current entry through a ref. Keying off the object would reload
	 * from disk mid-sentence and discard what was being typed.
	 */
	const current = useRef(entry);
	current.current = entry;

	useEffect(() => {
		let cancelled = false;
		setState("loading");
		void ctx.mutator.readThoughts(current.current).then((value) => {
			if (cancelled) return;
			setText(value);
			setState("clean");
		});
		return () => {
			cancelled = true;
		};
	}, [ctx.mutator, entry.path]);

	const save = useCallback(
		async (value: string) => {
			pending.current = null;
			await ctx.mutator.writeThoughts(current.current, value);
			setState("saved");
		},
		[ctx.mutator],
	);

	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
			if (pending.current !== null) {
				void ctx.mutator.writeThoughts(current.current, pending.current);
			}
		},
		[ctx.mutator],
	);

	useEffect(() => {
		const el = box.current;
		if (!editing || !el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}, [editing]);

	const onChange = (value: string) => {
		setText(value);
		setState("dirty");
		pending.current = value;
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			timer.current = null;
			void save(value);
		}, SAVE_DELAY);
	};

	const leave = () => {
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
			void save(text);
		}
		setEditing(false);
	};
	// Escape puts the text area away, keeping what was written, rather than
	// closing the dialog around it.
	useEscape(ctx.app, editing, leave);

	return (
		<div className="sd-row sd-stack">
			<span className="sd-lbl">
				{heading}
				<span className="sd-saved">
					{state === "dirty" ? "Saving…" : state === "saved" ? "Saved" : ""}
				</span>
			</span>
			<div className="sd-ctl">
				{editing ? (
					<textarea
						ref={box}
						className="sd-md"
						value={text}
						aria-label={heading}
						placeholder="Write your thoughts…"
						onChange={(e) => onChange(e.target.value)}
						onBlur={leave}
					/>
				) : text.trim() ? (
					<RenderedThoughts
						ctx={ctx}
						text={text}
						path={entry.path}
						onEdit={() => setEditing(true)}
						onClose={onClose}
					/>
				) : (
					<button
						className="sd-md sd-empty"
						disabled={state === "loading"}
						onClick={() => setEditing(true)}
					>
						Write your thoughts…
					</button>
				)}
			</div>
		</div>
	);
}
