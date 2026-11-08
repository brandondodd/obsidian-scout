import React, { useMemo, useState } from "react";
import type { LibraryEntry } from "../../../core/library/entry";
import { genreFacets, type GenreFacet } from "../../../core/library/facets";
import type { LensFilters } from "../../../core/library/lens";
import { Icon } from "../shared";

/**
 * Genres, a family at a time.
 *
 * Film genres and music genres are different vocabularies, so each family has
 * its own tab — and only the families of the types being filtered to, so with
 * Movies picked there is no "Rock" in the way. Main genres come first; the
 * sub-genres under one open beneath it on request, so the list stays short.
 *
 * One click shows a genre, and in "Hide" mode one click hides it. Several
 * shown genres can mean any or all of them.
 */
export function GenrePane({
	entries,
	filters,
	onChange,
}: {
	entries: readonly LibraryEntry[];
	filters: LensFilters;
	onChange: (patch: Partial<LensFilters>) => void;
}): React.ReactElement {
	const families = useMemo(() => {
		const scoped =
			filters.kinds.length > 0
				? entries.filter((entry) => filters.kinds.includes(entry.kind))
				: entries;
		return genreFacets(scoped);
	}, [entries, filters.kinds]);

	const [familyAt, setFamilyAt] = useState(0);
	const [open, setOpen] = useState<string | null>(null);
	const [mode, setMode] = useState<"show" | "hide">("show");
	const family = families[Math.min(familyAt, families.length - 1)];

	const has = (list: readonly string[], label: string) =>
		list.some((one) => one.toLowerCase() === label.toLowerCase());
	const without = (list: readonly string[], label: string) =>
		list.filter((one) => one.toLowerCase() !== label.toLowerCase());

	const toggle = (label: string) => {
		if (mode === "show") {
			onChange({
				tags: has(filters.tags, label)
					? without(filters.tags, label)
					: [...filters.tags, label],
				notTags: without(filters.notTags, label),
			});
		} else {
			onChange({
				notTags: has(filters.notTags, label)
					? without(filters.notTags, label)
					: [...filters.notTags, label],
				tags: without(filters.tags, label),
			});
		}
	};

	const chip = (label: string, count: number, facet?: GenreFacet) => {
		const shown = has(filters.tags, label);
		const hidden = has(filters.notTags, label);
		const subs = facet?.subs.length ?? 0;
		return (
			<span
				key={label}
				className={`scout-pick-chip${shown ? " is-on" : ""}${hidden ? " is-off" : ""}`}
			>
				<button onClick={() => toggle(label)} aria-pressed={shown || hidden}>
					{hidden && <Icon name="eye-off" size={12} />}
					{label}
					<span className="scout-pick-count">{count}</span>
				</button>
				{subs > 0 && (
					<button
						className="scout-pick-more"
						aria-label={`${open === label ? "Hide" : "Show"} kinds of ${label}`}
						aria-expanded={open === label}
						onClick={() => setOpen(open === label ? null : label)}
					>
						<Icon name={open === label ? "chevron-up" : "chevron-down"} size={12} />
					</button>
				)}
			</span>
		);
	};

	if (!family) {
		return <p className="scout-pick-empty">Nothing here has a genre yet.</p>;
	}

	const opened = family.genres.find((genre) => genre.label === open);

	return (
		<div className="scout-pick-genres">
			<div className="scout-pick-row">
				<div className="scout-segment" role="group" aria-label="Show or hide">
					<button className={mode === "show" ? "is-on" : ""} onClick={() => setMode("show")}>
						Show
					</button>
					<button className={mode === "hide" ? "is-on" : ""} onClick={() => setMode("hide")}>
						Hide
					</button>
				</div>
				{filters.tags.length > 1 && (
					<div className="scout-segment" role="group" aria-label="How genres combine">
						<button
							className={filters.genreMatch === "any" ? "is-on" : ""}
							onClick={() => onChange({ genreMatch: "any" })}
						>
							Any of them
						</button>
						<button
							className={filters.genreMatch === "all" ? "is-on" : ""}
							onClick={() => onChange({ genreMatch: "all" })}
						>
							All of them
						</button>
					</div>
				)}
			</div>
			{families.length > 1 && (
				<div className="scout-pick-families" role="tablist">
					{families.map((one, at) => (
						<button
							key={one.label}
							role="tab"
							aria-selected={one === family}
							className={one === family ? "is-on" : ""}
							onClick={() => {
								setFamilyAt(at);
								setOpen(null);
							}}
						>
							{one.label}
						</button>
					))}
				</div>
			)}
			<div className="scout-pick-chips">
				{family.genres.map((genre) => chip(genre.label, genre.count, genre))}
			</div>
			{opened && (
				<div className="scout-pick-subs">
					<span className="scout-pick-label">Kinds of {opened.label}</span>
					<div className="scout-pick-chips">
						{opened.subs.map((sub) => chip(sub.label, sub.count))}
					</div>
				</div>
			)}
		</div>
	);
}
