import { useEffect, type RefObject } from "react";

/**
 * Closes a popover on Escape or on a press outside it.
 *
 * Listened for on the popover's own document, which is not the main window's
 * when the library is open in a pop-out window.
 */
export function useDismiss(
	ref: RefObject<HTMLElement | null>,
	open: boolean,
	onClose: () => void,
	/** Presses inside this element (the button that opened it) do not count. */
	anchor?: RefObject<HTMLElement | null>,
): void {
	useEffect(() => {
		if (!open) return;
		const doc = ref.current?.ownerDocument ?? document;
		const press = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (ref.current?.contains(target) || anchor?.current?.contains(target)) return;
			onClose();
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		};
		doc.addEventListener("pointerdown", press, true);
		doc.addEventListener("keydown", key, true);
		return () => {
			doc.removeEventListener("pointerdown", press, true);
			doc.removeEventListener("keydown", key, true);
		};
	}, [ref, anchor, open, onClose]);
}
