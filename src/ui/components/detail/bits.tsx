import React, { useEffect, useState } from "react";
import type { ScoutContext } from "../../../core/context";
import type { MediaItem } from "../../../core/types";
import { ScoutDetailModal } from "../../detailModal";
import { Icon } from "../shared";

/** Small pieces shared across the detail dialog's sections. */

/**
 * A separator. Thin rule between facts, dot inside small captions.
 *
 * Which one is decided in the stylesheet by where it sits, so a caption and a
 * header can share this rather than each having to remember the rule.
 */
export const Sep = (): React.ReactElement => (
	<span className="sd-sep" aria-hidden="true" />
);

/**
 * Facts in a row with a thin rule between each.
 *
 * Every fact carries the rule in front of it, and the row is drawn one rule to
 * the left of its box and clipped. So whichever fact starts a line, its rule
 * falls outside and the line starts clean, rather than a rule being left
 * hanging at the end of the line above when the row wraps.
 */
export function Facts({
	className,
	children,
}: {
	className: string;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<div className={`${className} sd-frow`}>
			<div className="sd-frow-in">
				{React.Children.toArray(children).map((fact, at) => (
					// The child's own key holds its slot, so a fact that arrives
					// late is the one that fades in, not whichever sits last.
					<span
						className="sd-fact"
						key={React.isValidElement(fact) && fact.key !== null ? fact.key : at}
					>
						<Sep />
						{fact}
					</span>
				))}
			</div>
		</div>
	);
}

/** Text with its ` · ` turned into separators. */
export function Dotted({ text }: { text: string }): React.ReactElement {
	const parts = text.split(" · ");
	return (
		<>
			{parts.map((part, at) => (
				<React.Fragment key={at}>
					{at > 0 && <Sep />}
					{part}
				</React.Fragment>
			))}
		</>
	);
}

export function openUrl(url: string): void {
	window.open(url, "_blank", "noopener");
}

/** A section with a heading, and an optional link at the end of it. */
export function Section({
	id,
	title,
	count,
	link,
	onLink,
	children,
}: {
	id?: string;
	title: string;
	count?: number;
	link?: string;
	onLink?: () => void;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<section className="sd-sec" data-sd={id}>
			<div className="sd-sec-h">
				<h3>
					{title}
					{count ? <span className="sd-cnt">{count}</span> : null}
				</h3>
				{link &&
					(onLink ? (
						<button className="sd-more" onClick={onLink}>
							{link}
							<Icon name="chevron-right" size={14} />
						</button>
					) : (
						/* Says which region the prices are for, with nowhere to go. */
						<span className="sd-more sd-static">{link}</span>
					))}
			</div>
			{children}
		</section>
	);
}

/** A stable hash, so a name always gets the same placeholder colours. */
function hash(text: string): number {
	let value = 7;
	for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
	return value;
}

/** Soft colour for artwork that is missing. Stands in, never pretends. */
export function seedArt(seed: string): string {
	const h = hash(seed);
	const a = h % 360;
	const b = (h >> 8) % 360;
	const c = (h >> 16) % 360;
	return (
		`radial-gradient(110% 80% at 25% 15%,hsl(${a} 45% 40%),transparent 60%),` +
		`radial-gradient(90% 90% at 85% 85%,hsl(${b} 50% 32%),transparent 65%),` +
		`linear-gradient(160deg,hsl(${c} 28% 20%),hsl(${c} 28% 9%))`
	);
}

/** Up to two initials. */
export function initials(name: string): string {
	return name
		.split(/\s+/)
		.map((word) => word[0] ?? "")
		.slice(0, 2)
		.join("")
		.toUpperCase();
}

/**
 * An image that fades in once it has arrived, and gives way to a placeholder
 * if it will not load. Until then its frame shimmers, so the space is held.
 */
export function Picture({
	src,
	seed,
	className,
	children,
}: {
	src: string | undefined;
	seed: string;
	className?: string;
	children?: React.ReactNode;
}): React.ReactElement {
	const [failed, setFailed] = useState(false);
	const [loaded, setLoaded] = useState<string | null>(null);
	const shown = src && !failed;
	const ready = loaded === src;
	return (
		<span
			className={`${className ?? ""}${shown && !ready ? " sd-loading" : ""}`}
			style={shown ? undefined : { background: seedArt(seed) }}
		>
			{shown && (
				<img
					// Already decoded when it comes from the cache, in which case
					// the load event can fire before React is listening.
					ref={(img) => {
						if (img?.complete && img.naturalWidth > 0) setLoaded(src);
					}}
					className={`sd-fillimg${ready ? " sd-ready" : ""}`}
					src={src}
					alt=""
					loading="lazy"
					decoding="async"
					draggable={false}
					onLoad={() => setLoaded(src)}
					onError={() => setFailed(true)}
				/>
			)}
			{children}
		</span>
	);
}

/**
 * Whether an image has arrived, for artwork drawn as a CSS background, which
 * has no load event of its own. The browser fetches it once and the background
 * reuses that copy.
 */
export function useImageReady(src: string | undefined): boolean {
	const [ready, setReady] = useState<string | null>(null);
	useEffect(() => {
		if (!src) return;
		let live = true;
		const img = new Image();
		// A backdrop that will not load is left out either way; settling here
		// just stops anything waiting on it.
		img.onload = img.onerror = () => {
			if (live) setReady(src);
		};
		img.src = src;
		return () => {
			live = false;
		};
	}, [src]);
	return ready === src;
}

/** Opens another title in a fresh dialog, as its note if there is one. */
export function openTitle(
	ctx: ScoutContext,
	item: MediaItem,
	onClose: () => void,
): void {
	const owned = ctx.library.match(item);
	onClose();
	new ScoutDetailModal(
		ctx,
		owned ? { entryPath: owned.path } : { item },
	).open();
}
