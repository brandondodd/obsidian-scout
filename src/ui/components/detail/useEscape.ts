import { Scope, type App } from "obsidian";
import { useEffect, useRef } from "react";

/**
 * Escape, taken for something open inside the dialog while it is open.
 *
 * Obsidian hands Escape to the modal's keymap scope before any DOM listener sees
 * it, so a listener alone lost the race and the whole dialog closed under a
 * picker you meant to put away. A scope pushed on top is asked first.
 */
export function useEscape(app: App, active: boolean, onEscape: () => void): void {
	const handler = useRef(onEscape);
	handler.current = onEscape;

	useEffect(() => {
		if (!active) return;
		const scope = new Scope(app.scope);
		scope.register([], "Escape", () => {
			handler.current();
			return false;
		});
		app.keymap.pushScope(scope);
		return () => app.keymap.popScope(scope);
	}, [app, active]);
}
