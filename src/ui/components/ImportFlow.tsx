import React, { useEffect, useRef, useState } from "react";
import type { ScoutContext } from "../../core/context";
import { isAbortError } from "../../core/http";
import { parseImportFiles, type FileSource } from "../../core/import/parse";
import {
	planImport,
	writeImport,
	type ImportSummary,
	type PlanRow,
} from "../../core/import/runner";
import {
	IMPORT_SOURCE_LABELS,
	type ImportRecord,
	type ImportSource,
} from "../../core/import/types";
import { isListSource } from "../../core/provider";
import { ImportReview, ImportSummaryView } from "./ImportReview";
import { Icon } from "./shared";

/**
 * Bringing a library in from somewhere else.
 *
 * Choose, look up, review, write, report — and nothing reaches the vault
 * before the review. Every long step shows how far it has got and can be
 * cancelled; closing the dialog cancels too.
 */

type Step =
	| { name: "choose"; error?: string }
	| { name: "working"; label: string; done: number; total: number }
	| { name: "review"; rows: PlanRow[]; ignored: string[] }
	| { name: "done"; rows: PlanRow[]; summary: ImportSummary };

const HINTS: Record<ImportSource, string> = {
	letterboxd:
		"Settings → Import & export → Export your data. Unzip it and pick the CSV files — watched, ratings, diary, watchlist, reviews, and likes/films.",
	goodreads: "My Books → Import and export → Export library. Pick goodreads_library_export.csv.",
	storygraph: "Manage account → Export StoryGraph library. Pick the CSV it emails you.",
	anilist: "Your profile must be public. Anime and manga lists are both read.",
};

export interface ImportFlowProps {
	ctx: ScoutContext;
	onClose: () => void;
}

export default function ImportFlow({ ctx, onClose }: ImportFlowProps): React.ReactElement {
	const [source, setSource] = useState<ImportSource>("letterboxd");
	const [files, setFiles] = useState<File[]>([]);
	const [username, setUsername] = useState("");
	const [step, setStep] = useState<Step>({ name: "choose" });
	const controller = useRef<AbortController | null>(null);

	// Closing the dialog is cancelling it.
	useEffect(() => () => controller.current?.abort(), []);

	const begin = (): AbortSignal => {
		controller.current?.abort();
		controller.current = new AbortController();
		return controller.current.signal;
	};
	const progress = (label: string) => (done: number, total: number) =>
		setStep({ name: "working", label, done, total });

	const readRecords = async (signal: AbortSignal): Promise<{
		records: ImportRecord[];
		ignored: string[];
	}> => {
		if (source === "anilist") {
			const provider = ctx.registry.get("anilist");
			if (!provider || !isListSource(provider)) throw new Error("AniList is not available.");
			return { records: await provider.userList(username, { signal }), ignored: [] };
		}
		const read = await Promise.all(
			files.map(async (file) => ({ name: file.name, text: await file.text() })),
		);
		return parseImportFiles(source as FileSource, read);
	};

	const lookUp = async () => {
		const signal = begin();
		setStep({ name: "working", label: "Reading", done: 0, total: 0 });
		try {
			const { records, ignored } = await readRecords(signal);
			if (records.length === 0) {
				setStep({ name: "choose", error: "Nothing to import was found in that." });
				return;
			}
			const rows = await planImport(ctx, records, signal, progress("Looking up"));
			if (signal.aborted) {
				setStep({ name: "choose", error: "Cancelled. Nothing was written." });
				return;
			}
			setStep({ name: "review", rows, ignored });
		} catch (err) {
			setStep({
				name: "choose",
				error: isAbortError(err)
					? "Cancelled. Nothing was written."
					: `Could not read that: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	};

	const write = async (rows: PlanRow[]) => {
		const signal = begin();
		const summary = await writeImport(ctx, rows, signal, progress("Writing notes"));
		setStep({ name: "done", rows, summary });
	};

	if (step.name === "working") {
		const fraction = step.total > 0 ? step.done / step.total : 0;
		return (
			<div className="scout-import">
				<p>
					{step.label}
					{step.total > 0 ? ` — ${step.done} of ${step.total}` : "…"}
				</p>
				<progress
					className="scout-import-progress"
					value={fraction}
					max={1}
					aria-label={step.label}
				/>
				<div className="modal-button-container">
					<button onClick={() => controller.current?.abort()}>Cancel</button>
				</div>
			</div>
		);
	}

	if (step.name === "review") {
		return (
			<ImportReview
				ctx={ctx}
				rows={step.rows}
				ignored={step.ignored}
				onBack={() => setStep({ name: "choose" })}
				onImport={(rows) => void write(rows)}
			/>
		);
	}

	if (step.name === "done") {
		return (
			<ImportSummaryView
				ctx={ctx}
				rows={step.rows}
				summary={step.summary}
				onClose={onClose}
				onResume={() => void write(step.rows)}
			/>
		);
	}

	const ready = source === "anilist" ? username.trim().length > 0 : files.length > 0;
	return (
		<div className="scout-import">
			<div className="scout-import-sources" role="radiogroup" aria-label="Import from">
				{(Object.keys(IMPORT_SOURCE_LABELS) as ImportSource[]).map((one) => (
					<button
						key={one}
						role="radio"
						aria-checked={one === source}
						className={one === source ? "is-active" : ""}
						onClick={() => {
							setSource(one);
							setFiles([]);
						}}
					>
						{IMPORT_SOURCE_LABELS[one]}
					</button>
				))}
			</div>
			<p className="scout-import-hint">{HINTS[source]}</p>

			{source === "anilist" ? (
				<input
					type="text"
					placeholder="AniList username"
					aria-label="AniList username"
					value={username}
					onChange={(e) => setUsername(e.target.value)}
				/>
			) : (
				<input
					// Re-mounted per source so a switch clears the picked files.
					key={source}
					type="file"
					accept=".csv,text/csv"
					multiple={source === "letterboxd"}
					aria-label="Export files"
					onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
				/>
			)}

			{step.error && <p className="scout-setting-warning">{step.error}</p>}
			<p className="scout-import-hint">
				Each title is looked up at its source so the note matches one made from a
				search. You will see everything before anything is written.
			</p>

			<div className="modal-button-container">
				<button onClick={onClose}>Cancel</button>
				<button className="mod-cta" disabled={!ready} onClick={() => void lookUp()}>
					<Icon name="search" size={14} /> Look up
				</button>
			</div>
		</div>
	);
}
