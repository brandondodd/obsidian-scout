import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TabDef<T extends string> {
	id: T;
	label: string;
	count?: number;
}

/**
 * The tab row, with one underline that slides to the tab you pick.
 *
 * The underline is measured rather than drawn on each tab, so it can travel
 * between them. It appears in place the first time, with no slide, so opening
 * the dialog does not start with it flying in from the left.
 */
export function Tabs<T extends string>({
	tabs,
	active,
	title,
	onPick,
}: {
	tabs: readonly TabDef<T>[];
	active: T;
	/** Shown at the end of the row once it sticks. */
	title: string;
	onPick: (id: T) => void;
}): React.ReactElement {
	const row = useRef<HTMLDivElement>(null);
	const [line, setLine] = useState<{ x: number; w: number } | null>(null);
	const [moving, setMoving] = useState(false);

	const measure = () => {
		const on = row.current?.querySelector<HTMLElement>(".sd-tab.sd-on");
		if (!on) return;
		setLine((was) =>
			was && was.x === on.offsetLeft && was.w === on.offsetWidth
				? was
				: { x: on.offsetLeft, w: on.offsetWidth },
		);
	};

	// Before paint, so the underline is never a frame behind the tab.
	useLayoutEffect(measure);

	// Tabs come and go as the source answers, and fonts settle after the first
	// paint. Either moves the active tab without a render of this row.
	useEffect(() => {
		const el = row.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const watcher = new ResizeObserver(measure);
		for (const child of Array.from(el.children)) watcher.observe(child);
		return () => watcher.disconnect();
	});

	// Slide only after the first placement has painted.
	useEffect(() => {
		if (line && !moving) {
			const frame = requestAnimationFrame(() => setMoving(true));
			return () => cancelAnimationFrame(frame);
		}
	}, [line, moving]);

	return (
		<div className="sd-tabs" role="tablist" ref={row}>
			{tabs.map((one) => (
				<button
					key={one.id}
					className={`sd-tab${one.id === active ? " sd-on" : ""}`}
					role="tab"
					aria-selected={one.id === active}
					onClick={() => onPick(one.id)}
				>
					{one.label}
					{one.count ? <span>{one.count}</span> : null}
				</button>
			))}
			<span className="sd-stuck-t">{title}</span>
			{line && (
				<span
					className={`sd-tabline${moving ? " sd-moving" : ""}`}
					aria-hidden="true"
					style={{ width: line.w, transform: `translateX(${line.x}px)` }}
				/>
			)}
		</div>
	);
}
