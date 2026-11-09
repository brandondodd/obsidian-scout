import React, { useRef, useState } from "react";
import { filterChips, PRESETS, type Preset } from "../../../core/library/chips";
import type { LibraryConfig } from "../../../core/library/config";
import type { LibraryEntry } from "../../../core/library/entry";
import type { LensFilters } from "../../../core/library/lens";
import { activeFilterCount } from "../../../core/library/query";
import { describeRule, ruleIsEmpty, type RuleGroup } from "../../../core/library/rules";
import { Icon } from "../shared";
import { FilterPicker, paneFor } from "./FilterPicker";

/**
 * The line under the toolbar that says what you are looking at.
 *
 * Each filter is a chip in plain words — select it to change it, ✕ to drop
 * it — and the button to add one sits first. With nothing filtered, the line
 * offers starting points instead. At the far end, whatever it takes to keep
 * this: Save as view on the whole library, Save and Revert on a view you have
 * changed.
 */

export type SaveState = "none" | "new" | "edited";

export interface FilterBarProps {
	entries: readonly LibraryEntry[];
	config: LibraryConfig;
	filters: LensFilters;
	/** Conditions from the rule editor the chips cannot show. */
	extra: RuleGroup;
	statuses: readonly string[];
	collections: readonly string[];
	showPresets: boolean;
	save: SaveState;
	onChange: (patch: Partial<LensFilters>) => void;
	onPreset: (preset: Preset) => void;
	onEditExtra: () => void;
	onClearExtra: () => void;
	/** The name of a set of notes opened from elsewhere, like a thread. */
	scope?: string | null;
	onClearScope?: () => void;
	onSave: () => void;
	onSaveNew: () => void;
	onRevert: () => void;
}

export function FilterBar(props: FilterBarProps): React.ReactElement {
	const { filters, extra, save } = props;
	const [picking, setPicking] = useState<ReturnType<typeof paneFor> | null>(null);
	const anchor = useRef<HTMLDivElement>(null);
	const chips = filterChips(filters);
	const count = activeFilterCount(filters);

	return (
		<div className="scout-filter-bar">
			<div className="scout-filter-anchor" ref={anchor}>
				<button
					className={`scout-filter-add${count > 0 ? " is-on" : ""}`}
					aria-expanded={picking !== null}
					onClick={() => setPicking(picking ? null : "type")}
				>
					<Icon name="list-filter" size={14} />
					Filter
					{count > 0 && <span className="scout-count">{count}</span>}
				</button>
				{picking && (
					<FilterPicker
						key={picking}
						entries={props.entries}
						config={props.config}
						filters={filters}
						statuses={props.statuses}
						collections={props.collections}
						initial={picking}
						anchor={anchor}
						onChange={props.onChange}
						onClose={() => setPicking(null)}
					/>
				)}
			</div>

			<div className="scout-filter-chips">
				{props.scope && (
					<span className="scout-filter-chip is-scope">
						<button disabled>
							<Icon name="sparkles" size={12} />
							{props.scope}
						</button>
						<button
							className="scout-filter-chip-x"
							aria-label={`Remove ${props.scope}`}
							onClick={props.onClearScope}
						>
							<Icon name="x" size={12} />
						</button>
					</span>
				)}
				{chips.map((chip) => (
					<span key={`${chip.category}:${chip.label}`} className="scout-filter-chip">
						<button onClick={() => setPicking(paneFor(chip.category))}>{chip.label}</button>
						<button
							className="scout-filter-chip-x"
							aria-label={`Remove ${chip.label}`}
							onClick={() => props.onChange(chip.clear)}
						>
							<Icon name="x" size={12} />
						</button>
					</span>
				))}
				{!ruleIsEmpty(extra) && (
					<span className="scout-filter-chip is-extra" title={describeRule(extra)}>
						<button onClick={props.onEditExtra}>
							<Icon name="settings-2" size={12} />
							{describeRule(extra)}
						</button>
						<button
							className="scout-filter-chip-x"
							aria-label="Remove these conditions"
							onClick={props.onClearExtra}
						>
							<Icon name="x" size={12} />
						</button>
					</span>
				)}
				{props.showPresets && !props.scope && chips.length === 0 && ruleIsEmpty(extra) && (
					<>
						<span className="scout-filter-hint">Try</span>
						{PRESETS.map((preset) => (
							<button
								key={preset.id}
								className="scout-filter-preset"
								onClick={() => props.onPreset(preset)}
							>
								<Icon name={preset.icon} size={13} />
								{preset.label}
							</button>
						))}
					</>
				)}
			</div>

			{save !== "none" && (
				<div className="scout-filter-save">
					{save === "edited" && (
						<button className="scout-reset" onClick={props.onRevert}>
							Revert
						</button>
					)}
					{save === "edited" && (
						<button className="scout-reset" onClick={props.onSaveNew}>
							Save as new
						</button>
					)}
					<button
						className="mod-cta"
						onClick={save === "edited" ? props.onSave : props.onSaveNew}
					>
						<Icon name="save" size={13} />
						{save === "edited" ? "Save view" : "Save as view"}
					</button>
				</div>
			)}
		</div>
	);
}
