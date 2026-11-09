import { Menu } from "obsidian";
import React, { useState } from "react";
import { threadMembers, type Thread } from "../../core/ai/threads";
import type { ScoutContext } from "../../core/context";
import type { LibraryEntry } from "../../core/library/entry";
import { promptModal } from "../confirm";
import { openLibrary } from "../libraryView";
import { Cover, Icon, resolveImage, SectionHead } from "./shared";

/**
 * The threads running through what you love, as a few quiet cards on Home.
 *
 * Only there when the AI is on and threads have been written: with the AI off,
 * Home is exactly what it was. Membership is worked out here from the notes, so
 * a card's count moves as you tag and add things without asking a model again.
 * Selecting a card opens the library narrowed to its members.
 */
export default function Threads({
	ctx,
	entries,
}: {
	ctx: ScoutContext;
	entries: readonly LibraryEntry[];
}): React.ReactElement | null {
	const { assistant, threads } = ctx;
	const shown = assistant.enabled() ? threads.shown() : [];
	// Not memoised: a handful of threads over signatures cached per entry is
	// cheap, and it keeps counts right the moment a note is tagged.
	const rows = shown
		.map((thread) => ({ thread, members: threadMembers(thread, entries) }))
		.filter((row) => row.members.length > 0);
	const [busy, setBusy] = useState(false);

	if (rows.length === 0) return null;

	const refresh = async () => {
		setBusy(true);
		await threads.refresh();
		setBusy(false);
	};

	return (
		<section className="scout-home-section scout-threads-section">
			<SectionHead
				title="Threads"
				icon="sparkles"
				note={threads.lastError() ?? "What keeps running through the things you love"}
				action={
					assistant.canShare() ? (
						<button className="scout-home-more" disabled={busy} onClick={() => void refresh()}>
							<Icon name="refresh-cw" size={13} />{" "}
							<span className="scout-swap">
								<span className={busy ? "is-off" : undefined}>Refresh</span>
								<span className={busy ? undefined : "is-off"}>Writing…</span>
							</span>
						</button>
					) : undefined
				}
			/>
			<div className="scout-threads">
				{rows.map(({ thread, members }) => (
					<ThreadCard key={thread.id} ctx={ctx} thread={thread} members={members} />
				))}
			</div>
		</section>
	);
}

function ThreadCard({
	ctx,
	thread,
	members,
}: {
	ctx: ScoutContext;
	thread: Thread;
	members: readonly LibraryEntry[];
}): React.ReactElement {
	const open = () =>
		void openLibrary(ctx.app, {
			scope: { label: thread.name, paths: members.map((one) => one.path) },
		});

	const menu = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const m = new Menu();
		m.addItem((item) =>
			item
				.setTitle("Rename")
				.setIcon("pencil")
				.onClick(async () => {
					const name = await promptModal(ctx.app, {
						title: "Rename thread",
						value: thread.name,
						confirmText: "Rename",
					});
					if (name) await ctx.threads.rename(thread.id, name);
				}),
		);
		m.addItem((item) =>
			item
				.setTitle(thread.pinned ? "Unpin" : "Pin — keep when refreshed")
				.setIcon(thread.pinned ? "pin-off" : "pin")
				.onClick(() => void ctx.threads.setPinned(thread.id, !thread.pinned)),
		);
		m.addItem((item) =>
			item
				.setTitle("Hide")
				.setIcon("eye-off")
				.onClick(() => void ctx.threads.setHidden(thread.id, true)),
		);
		m.showAtMouseEvent(event.nativeEvent);
	};

	return (
		<div
			className="scout-thread"
			role="button"
			tabIndex={0}
			onClick={open}
			onContextMenu={menu}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					open();
				}
			}}
		>
			<div className="scout-thread-covers" aria-hidden>
				{members.slice(0, 4).map((entry) => (
					<Cover
						key={entry.path}
						src={resolveImage(ctx.app, entry.cover, entry.path)}
						alt=""
						title={entry.title}
						className="scout-thread-cover"
					/>
				))}
			</div>
			<div className="scout-thread-text">
				<div className="scout-thread-name">
					{thread.pinned && <Icon name="pin" size={12} />}
					<span>{thread.name}</span>
				</div>
				{thread.description && <p className="scout-thread-desc">{thread.description}</p>}
				<span className="scout-thread-count">
					{members.length} title{members.length === 1 ? "" : "s"}
				</span>
			</div>
			<button
				className="scout-thread-menu clickable-icon"
				aria-label={`Options for ${thread.name}`}
				onClick={menu}
			>
				<Icon name="more-horizontal" size={14} />
			</button>
		</div>
	);
}
