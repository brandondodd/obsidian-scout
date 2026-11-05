import { Notice } from "obsidian";
import React, { useMemo, useState } from "react";
import type { ScoutContext } from "../../core/context";
import {
	kindsWithoutFolder,
	unmatchedList,
	type ImportSummary,
	type PlanRow,
} from "../../core/import/runner";
import { MEDIA_KIND_PLURALS } from "../../core/types";
import { openLibrary } from "../libraryView";

/**
 * The review before an import writes, and the report after.
 *
 * Guesses are listed first and start unticked: a wrong match is a wrong note
 * in the vault, and the person who knows which "Dune" they meant is the one
 * looking at this list.
 */

function describe(row: PlanRow): string {
	const { title, year } = row.record;
	return `${title}${year ? ` (${year})` : ""}`;
}

function matchedAs(row: PlanRow): string | null {
	const item = row.item;
	if (!item) return null;
	const year = item.year ? ` (${item.year})` : "";
	const by = item.subtitle ? ` — ${item.subtitle}` : "";
	return `${item.title}${year}${by}`;
}

export function ImportReview({
	ctx,
	rows,
	ignored,
	onBack,
	onImport,
}: {
	ctx: ScoutContext;
	rows: PlanRow[];
	ignored: string[];
	onBack: () => void;
	onImport: (rows: PlanRow[]) => void;
}): React.ReactElement {
	// One tick per row, kept here rather than on the rows so Back discards it.
	const [ticked, setTicked] = useState<Set<PlanRow>>(
		() => new Set(rows.filter((row) => row.include)),
	);
	const blocked = useMemo(() => new Set(kindsWithoutFolder(ctx, rows)), [ctx, rows]);

	const fresh = rows
		.filter((row) => row.state === "new")
		// The ones that need a look go first.
		.sort((a, b) => Number(b.confidence === "likely") - Number(a.confidence === "likely"));
	const existing = rows.filter((row) => row.state === "existing").length;
	const missing = rows.filter((row) => row.state === "unmatched");
	const writable = (row: PlanRow) => !!row.item && !blocked.has(row.item.ref.kind);
	const chosen = fresh.filter((row) => ticked.has(row) && writable(row));

	const toggle = (row: PlanRow) =>
		setTicked((current) => {
			const next = new Set(current);
			if (next.has(row)) next.delete(row);
			else next.add(row);
			return next;
		});

	return (
		<div className="scout-import">
			<p className="scout-import-counts">
				<strong>{fresh.length}</strong> new · <strong>{existing}</strong> already in
				the library · <strong>{missing.length}</strong> not found
			</p>

			{[...blocked].map((kind) => (
				<p key={kind} className="scout-setting-warning">
					{MEDIA_KIND_PLURALS[kind]} have no output folder, so they cannot be written.
					Set one under <strong>Settings → Scout → Notes</strong> and look up again.
				</p>
			))}
			{ignored.length > 0 && (
				<p className="scout-import-hint">Not part of this export: {ignored.join(", ")}</p>
			)}

			{fresh.length > 0 && (
				<div className="scout-import-list" role="group" aria-label="Titles to add">
					<label className="scout-import-row scout-import-all">
						<input
							type="checkbox"
							checked={chosen.length === fresh.filter(writable).length}
							onChange={(e) =>
								setTicked(new Set(e.target.checked ? fresh.filter(writable) : []))
							}
						/>
						<span>Select all</span>
					</label>
					{fresh.map((row) => (
						<label
							key={row.record.key}
							className={`scout-import-row${writable(row) ? "" : " is-disabled"}`}
						>
							<input
								type="checkbox"
								disabled={!writable(row)}
								checked={ticked.has(row) && writable(row)}
								onChange={() => toggle(row)}
							/>
							<span className="scout-import-title">{describe(row)}</span>
							{row.confidence === "likely" && (
								<span className="scout-import-match">
									<span className="scout-import-badge">Check</span> as {matchedAs(row)}
								</span>
							)}
						</label>
					))}
				</div>
			)}

			{missing.length > 0 && (
				<details className="scout-import-missing">
					<summary>Not found ({missing.length})</summary>
					<ul>
						{missing.map((row) => (
							<li key={row.record.key}>
								{describe(row)}
								{row.error && <span className="scout-import-hint"> — {row.error}</span>}
							</li>
						))}
					</ul>
				</details>
			)}

			<div className="modal-button-container">
				<button onClick={onBack}>Back</button>
				<button
					className="mod-cta"
					disabled={chosen.length === 0}
					onClick={() => {
						for (const row of rows) row.include = ticked.has(row) && writable(row);
						onImport(rows);
					}}
				>
					Import {chosen.length}
				</button>
			</div>
		</div>
	);
}

export function ImportSummaryView({
	ctx,
	rows,
	summary,
	onClose,
	onResume,
}: {
	ctx: ScoutContext;
	rows: PlanRow[];
	summary: ImportSummary;
	onClose: () => void;
	onResume: () => void;
}): React.ReactElement {
	const missing = unmatchedList(rows);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(missing);
			new Notice("Copied the list of titles not found");
		} catch {
			new Notice("Could not copy. Select the text and copy it instead.");
		}
	};

	return (
		<div className="scout-import">
			<p className="scout-import-counts">
				<strong>{summary.created}</strong> created
				{summary.skipped > 0 && <> · <strong>{summary.skipped}</strong> already there</>}
				{summary.failed.length > 0 && <> · <strong>{summary.failed.length}</strong> failed</>}
			</p>
			{summary.remaining > 0 && (
				<p className="scout-setting-warning">
					Cancelled with {summary.remaining} left. Resuming skips everything already
					written.
				</p>
			)}
			{summary.failed.length > 0 && (
				<ul className="scout-import-hint">
					{summary.failed.map((one, at) => (
						<li key={at}>
							{one.title} — {one.reason}
						</li>
					))}
				</ul>
			)}
			{missing && (
				<div className="scout-import-missing">
					<p>Not found — add these by hand, or search for them:</p>
					<textarea readOnly value={missing} rows={6} aria-label="Titles not found" />
					<button onClick={() => void copy()}>Copy list</button>
				</div>
			)}
			<div className="modal-button-container">
				{summary.remaining > 0 && <button onClick={onResume}>Resume</button>}
				<button
					className="mod-cta"
					onClick={() => {
						onClose();
						void openLibrary(ctx.app);
					}}
				>
					Open library
				</button>
			</div>
		</div>
	);
}
