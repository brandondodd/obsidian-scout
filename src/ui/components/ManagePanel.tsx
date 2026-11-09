import { Menu } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import type { ScoutContext } from "../../core/context";
import {
	admits,
	isMember,
	withCollection,
	withoutCollection,
	type CollectionDef,
} from "../../core/library/collections";
import {
	customFieldsFor,
	ratingScaleFor,
	splitList,
	statusesFor,
	statusTone,
	type CustomField,
} from "../../core/library/config";
import { customValue, type LibraryEntry } from "../../core/library/entry";
import { longDate } from "../../core/format";
import { newCollection } from "../collections";
import { hasEpisodes } from "../episodes";
import { hasProgressCard } from "./detail/Cards";
import { MoodsRow } from "./detail/Moods";
import { Thoughts } from "./detail/Thoughts";
import Rating from "./Rating";
import { progressFraction, StatusIcon, statusClass } from "./Status";
import { Icon } from "./shared";

/**
 * Editing one library note.
 *
 * Every control writes straight through to the note's frontmatter, so the note
 * stays the source of truth and Dataview, Bases, and hand edits all keep
 * working. Nothing is cached in a side database.
 */

export interface ManagePanelProps {
	ctx: ScoutContext;
	entry: LibraryEntry;
	/** Closes the dialog, for a link in your thoughts that leads elsewhere. */
	onClose: () => void;
}

/** Writes are fire-and-forget: the index change re-renders with the new value. */
const set = (run: () => Promise<void>): void => void run();

export default function ManagePanel({
	ctx,
	entry,
	onClose,
}: ManagePanelProps): React.ReactElement {
	const config = ctx.settings.library();
	const statuses = statusesFor(config, entry.kind);
	const custom = customFieldsFor(config, entry.kind);
	const fraction = progressFraction(entry.progress, entry.progressTotal);
	/**
	 * Only while you are part-way through it.
	 *
	 * Which statuses those are is not something Scout can know from the words
	 * themselves — they are yours — so it goes by the tone the four lists under
	 * "What your statuses mean" sort each one into: started and set aside are
	 * mid-way, planned and finished and given up on are not. A note that
	 * already records a number keeps the row whatever its status, because
	 * hiding a value the note holds would be hiding your own data.
	 */
	const tone = statusTone(config, entry.status);
	/**
	 * Books, manga, and games count on a card above this panel while they are in
	 * progress, and a show counts in the header. The row stays for everything
	 * else, including a book set aside part-way, whose number would otherwise
	 * have nowhere to be seen.
	 */
	const onCard = tone === "active" && hasProgressCard(entry.kind);
	const showProgress =
		!onCard &&
		(entry.progress !== undefined || tone === "active" || tone === "paused");
	/**
	 * A show whose episodes can be listed is counted by ticking them off, not by
	 * typing a number, so the row loses its stepper and keeps the bar.
	 *
	 * Both halves of the condition are doing work: the source has to be able to
	 * serve the guide that would do the counting, and the note has to record how
	 * many there are — without a total there is no bar to show instead, and a
	 * row with neither a control nor a reading is worse than the stepper.
	 */
	const episodic = hasEpisodes(ctx, entry.ref, entry.kind);
	const guided = entry.progressTotal !== undefined && episodic;

	const scale = ratingScaleFor(config, entry.kind);
	/**
	 * One star per point where the dialog has room for it — five standing in
	 * for ten means every rating needs dividing in your head. Past ten they
	 * stop fitting, and the typed field is the better control anyway.
	 */
	const ratingSlots = scale <= 10 ? scale : 5;

	return (
		<div className="sd-yours" data-sd="yours">
			<div className="sd-row">
				<span className="sd-lbl">Your rating</span>
				<div className="sd-ctl">
					<Rating
						value={entry.rating}
						scale={scale}
						step={config.ratingStep}
						icon={config.ratingIcon}
						slots={ratingSlots}
						// Ten of them are narrower than five, so they can
						// afford to be a little larger than the five would be
						// — the row still comes out shorter than the status
						// buttons above it.
						size={ratingSlots > 5 ? 22 : 24}
						// The panel has room for the field, so it always gets
						// one: an exact score should never depend on hitting a
						// quarter of a star.
						exact
						onChange={(value) =>
							set(() => ctx.mutator.setRating(entry, value))
						}
					/>
				</div>
			</div>

			{statuses.length > 0 && (
				<div className="sd-row">
					<span className="sd-lbl">Status</span>
					<StatusControl
						ctx={ctx}
						entry={entry}
						fraction={fraction}
					/>
				</div>
			)}

			{showProgress && !episodic && (
				<ProgressRow ctx={ctx} entry={entry} guided={guided} />
			)}

			<DatesRow ctx={ctx} entry={entry} />

			<CollectionRow ctx={ctx} entry={entry} />

			<MoodsRow ctx={ctx} entry={entry} />

			{custom.map((field) => (
				<CustomFieldRow
					key={field.id}
					ctx={ctx}
					entry={entry}
					field={field}
				/>
			))}

			<Thoughts ctx={ctx} entry={entry} onClose={onClose} />
		</div>
	);
}

/* ------------------------------------------------------------------- dates */

/**
 * When you started and finished.
 *
 * A line of text once there is something to say, and one quiet link when there
 * is not. Two empty date boxes on every note was a form nobody had asked for.
 */
function DatesRow({
	ctx,
	entry,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const started = dateValue(entry.started);
	const finished = dateValue(entry.finished);
	const write = (key: "started" | "finished", value: string | null) =>
		set(() => ctx.mutator.setField(entry, key, value));

	return (
		<div className="sd-row">
			<span className="sd-lbl">Dates</span>
			{open ? (
				<div className="sd-ctl sd-dates">
					<label>
						Started
						<DateField
							value={started}
							label="Started"
							onCommit={(value) => write("started", value)}
						/>
					</label>
					<label>
						Finished
						<DateField
							value={finished}
							label="Finished"
							onCommit={(value) => write("finished", value)}
						/>
					</label>
				</div>
			) : started || finished ? (
				<div className="sd-ctl">
					{started && (
						<span>
							Started <b>{longDate(started)}</b>
						</span>
					)}
					{finished && (
						<span>
							Finished <b>{longDate(finished)}</b>
						</span>
					)}
					<button className="sd-linkbtn" onClick={() => setOpen(true)}>
						<Icon name="pencil" size={13} /> Edit
					</button>
				</div>
			) : (
				<div className="sd-ctl">
					<button className="sd-linkbtn" onClick={() => setOpen(true)}>
						<Icon name="calendar" size={15} /> Add dates
					</button>
				</div>
			)}
		</div>
	);
}

/* ------------------------------------------------------------- collections */

/**
 * Which shelves this is on.
 *
 * The shelves it is *on*, and only those. The row used to list every collection
 * in the vault with the members highlighted, which answers a question nobody
 * asked of a single item: on twenty shelves it was twenty chips of which two
 * meant anything, and the two that did were the hardest to find. Membership is a
 * short fact and reads as one. Everything else has moved behind the button, where
 * a list of shelves this is *not* on belongs — and which was already there.
 *
 * The row stays even when it is empty, because the first collection has to be
 * creatable from the item you wanted it for; an empty row hidden until you had
 * been somewhere else and made one was a chicken and an egg.
 */
function CollectionRow({
	ctx,
	entry,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
}): React.ReactElement | null {
	const collections = ctx.settings.collections();
	const member = collections.filter((one) => isMember(entry, one));

	const remove = (collection: CollectionDef) => {
		void ctx.mutator.setCollections(
			entry,
			withoutCollection(entry, collection),
		);
		// Taking something out by hand has to stick, or the standing order puts
		// it back within the second.
		if (!collection.auto) return;
		ctx.settings.saveCollection({
			...collection,
			excluded: [...new Set([...collection.excluded, entry.path])],
		});
	};

	return (
		<div className="sd-row">
			<span className="sd-lbl">Collections</span>
			<div className="sd-ctl">
				{member.map((collection) => (
					<button
						key={collection.id}
						className="sd-chip sd-on"
						aria-pressed
						title={`${collection.description || collection.name} — click to take it off this shelf`}
						onClick={() => remove(collection)}
					>
						<Icon name={collection.icon} size={13} />
						{collection.name}
					</button>
				))}
				{/* The way in. Shelves this could join and the one you are about to
				    invent are both here, which is most often what "put this on a
				    shelf" means the first few times. */}
				<button
					className="sd-chip sd-add"
					title="Put this in a collection"
					onClick={(event) => addMenu(ctx, entry, event)}
				>
					<Icon name="plus" size={13} />
					{member.length === 0 ? "Add to a collection" : "Add…"}
				</button>
			</div>
		</div>
	);
}

/**
 * Collections this item could join, and the option of making one.
 *
 * A menu rather than more chips: the chips answer "which shelves is this on",
 * which is a question about this item, and a list of every shelf it is *not* on
 * is a different question that gets longer the more collections you keep.
 */
function addMenu(
	ctx: ScoutContext,
	entry: LibraryEntry,
	event: React.MouseEvent,
): void {
	const config = ctx.settings.library();
	const menu = new Menu();
	const joinable = ctx.settings
		.collections()
		.filter(
			(collection) =>
				!isMember(entry, collection) && admits(entry, collection, config),
		);

	for (const collection of joinable) {
		menu.addItem((i) =>
			i
				.setTitle(collection.name)
				.setIcon(collection.icon)
				.onClick(() =>
					void ctx.mutator.setCollections(
						entry,
						withCollection(entry, collection),
					),
				),
		);
	}
	if (joinable.length > 0) menu.addSeparator();
	menu.addItem((i) =>
		i
			.setTitle("New collection…")
			.setIcon("plus")
			// Made with this already in it: "put this in a new collection" is
			// one thought, and creating an empty one first splits it in two.
			.onClick(() => void newCollection(ctx, entry)),
	);
	menu.showAtMouseEvent(event.nativeEvent);
}

/* ------------------------------------------------------------------ status */

/**
 * How many shelves stay as buttons.
 *
 * The segmented control is the better thing to look at and the faster thing to
 * click, and it wraps onto a second line without looking broken — so this is
 * not about what fits. It is about a control that would take four rows of the
 * dialog to show every shelf: past this many, the same choice reads better as
 * a list, and a list has no limit, which the buttons never will.
 */
const MAX_INLINE_STATUSES = 7;

function StatusControl({
	ctx,
	entry,
	fraction,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	fraction: number | undefined;
}): React.ReactElement {
	const config = ctx.settings.library();
	const statuses = statusesFor(config, entry.kind);
	const current = entry.status ?? "";
	const isCurrent = (status: string) =>
		current.toLowerCase() === status.toLowerCase();

	// A status the note carries that is not in the vocabulary — an older word,
	// or one the settings have since dropped — still has to be selectable, or
	// the control would silently show the note as having no status at all.
	const options = current && !statuses.some(isCurrent)
		? [...statuses, current]
		: statuses;

	if (options.length > MAX_INLINE_STATUSES) {
		return (
			<div className="sd-ctl scout-status-picker">
				<StatusIcon
					config={config}
					status={current}
					progress={fraction}
					size={14}
				/>
				<select
					className={statusClass(config, current).trim()}
					aria-label="Status"
					value={current}
					onChange={(e) =>
						set(() =>
							ctx.mutator.setStatus(entry, e.target.value || null),
						)
					}
				>
					<option value="">No status</option>
					{options.map((status) => (
						<option key={status} value={status}>
							{status}
						</option>
					))}
				</select>
			</div>
		);
	}

	return (
		<div className="sd-ctl">
			<div className="sd-seg">
			{options.map((status) => {
				const active = isCurrent(status);
				const foreign = !statuses.some(
					(s) => s.toLowerCase() === status.toLowerCase(),
				);
				return (
					<button
						key={status}
						className={`${statusClass(config, status).trim()}${
							active ? " sd-on" : ""
						}${active && statusTone(config, status) === "done" ? " sd-done" : ""}${
							foreign ? " is-foreign" : ""
						}`}
						aria-pressed={active}
						title={status}
						onClick={() =>
							set(() =>
								ctx.mutator.setStatus(
									entry,
									active ? null : status,
								),
							)
						}
					>
						{status.toLowerCase() === "archived" ? (
							<Icon name="archive" size={14} />
						) : (
							<StatusIcon config={config} status={status} size={14} />
						)}
						{status}
					</button>
				);
			})}
			</div>
		</div>
	);
}

/* ---------------------------------------------------------------- progress */

function ProgressRow({
	ctx,
	entry,
	guided,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	/** Counted by ticking episodes off the guide, so there is nothing to type. */
	guided: boolean;
}): React.ReactElement {
	const total = entry.progressTotal;
	const current = entry.progress ?? 0;
	const percent = total ? Math.min(100, (current / total) * 100) : 0;

	const step = (delta: number) => {
		const next = Math.max(0, current + delta);
		void ctx.mutator.setProgress(entry, next === 0 ? null : next);
	};

	return (
		<div className="sd-row">
			<span className="sd-lbl">Progress</span>
			<div className="sd-ctl scout-progress">
				{guided ? (
					// A reading rather than a control. Two ways to set the same
					// number, one of which knows what episode nine is called and
					// one of which does not, is a way to get them disagreeing.
					<span
						className="scout-progress-read"
						title="Set by ticking episodes off under Seasons &amp; episodes"
					>
						{current} of {total} episodes
					</span>
				) : (
					/* One segmented control, the same shape as the status row:
					   the two buttons, the value, and the total it counts
					   towards are one thing, not four loose parts on a line. */
					<span className="scout-stepper">
						<button
							aria-label="Decrease progress"
							onClick={() => step(-1)}
							disabled={current <= 0}
						>
							<Icon name="minus" size={14} />
						</button>
						<input
							type="number"
							min={0}
							value={entry.progress ?? ""}
							placeholder="0"
							aria-label="Progress"
							onChange={(e) => {
								const text = e.target.value;
								void ctx.mutator.setProgress(
									entry,
									text ? Number(text) : null,
								);
							}}
						/>
						<button
							aria-label="Increase progress"
							onClick={() => step(1)}
						>
							<Icon name="plus" size={14} />
						</button>
						{total ? (
							<span className="scout-stepper-total">of {total}</span>
						) : null}
					</span>
				)}
				{total ? (
					<>
						<span
							className="scout-progress-bar"
							role="progressbar"
							aria-valuenow={current}
							aria-valuemin={0}
							aria-valuemax={total}
						>
							<span style={{ width: `${percent}%` }} />
						</span>
						<span className="scout-progress-percent">
							{Math.round(percent)}%
						</span>
					</>
				) : null}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------ custom fields */

function CustomFieldRow({
	ctx,
	entry,
	field,
}: {
	ctx: ScoutContext;
	entry: LibraryEntry;
	field: CustomField;
}): React.ReactElement {
	const raw = customValue(entry, field.key);
	const write = (value: string | number | boolean | null) =>
		void ctx.mutator.setCustom(entry, field, value);

	let control: React.ReactElement;
	switch (field.type) {
		case "checkbox":
			control = (
				<input
					type="checkbox"
					checked={raw === true || raw === "true"}
					onChange={(e) => write(e.target.checked ? true : null)}
				/>
			);
			break;
		case "number":
			control = (
				<input
					type="number"
					value={typeof raw === "number" ? raw : (raw as string) ?? ""}
					onChange={(e) =>
						write(e.target.value ? Number(e.target.value) : null)
					}
				/>
			);
			break;
		case "date":
			control = (
				<DateField
					value={dateValue(typeof raw === "string" ? raw : undefined)}
					label={field.label || field.key}
					onCommit={(value) => write(value)}
				/>
			);
			break;
		case "select":
			control = (
				<select
					value={typeof raw === "string" ? raw : ""}
					onChange={(e) => write(e.target.value || null)}
				>
					<option value="">—</option>
					{splitList(field.options).map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			);
			break;
		default:
			control = (
				<input
					type="text"
					value={typeof raw === "string" ? raw : String(raw ?? "")}
					onChange={(e) => write(e.target.value || null)}
				/>
			);
	}

	return (
		<div className="sd-row">
			<span className="sd-lbl">{field.label || field.key}</span>
			<div className="sd-ctl">{control}</div>
		</div>
	);
}

/**
 * A date field that survives being typed into.
 *
 * `<input type="date">` reports an empty value for every keystroke until all
 * three parts are filled in, so writing straight through on change meant typing
 * "1" into the day box cleared the property, which rewrote the note, which
 * rebuilt the entry, which re-rendered the field out from under the half-typed
 * date. The value looked like it was resetting itself because it was.
 *
 * So: incomplete is a state this holds locally and says nothing about. Only a
 * whole date is written, and clearing one is committed on the way out, which is
 * the only moment an empty box means "no date" rather than "not finished
 * typing".
 */
function DateField({
	value,
	label,
	onCommit,
}: {
	value: string;
	label: string;
	onCommit: (value: string | null) => void;
}): React.ReactElement {
	const [text, setText] = useState(value);
	const committed = useRef(value);

	// Follows the note when it changes underneath — an edit in the file, or the
	// panel being reused for a different item.
	useEffect(() => {
		if (value === committed.current) return;
		committed.current = value;
		setText(value);
	}, [value]);

	return (
		<input
			type="date"
			value={text}
			aria-label={label}
			onChange={(e) => {
				const next = e.target.value;
				setText(next);
				if (!next) return;
				committed.current = next;
				onCommit(next);
			}}
			onBlur={() => {
				if (text || !committed.current) return;
				committed.current = "";
				onCommit(null);
			}}
		/>
	);
}

/** `<input type="date">` only accepts `YYYY-MM-DD`. */
function dateValue(value: string | undefined): string {
	if (!value) return "";
	const match = /\d{4}-\d{2}-\d{2}/.exec(value);
	return match ? match[0] : "";
}
