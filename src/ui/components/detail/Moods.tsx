import React, { useState } from "react";
import type { ScoutContext } from "../../../core/context";
import type { LibraryEntry } from "../../../core/library/entry";
import { taggable } from "../../../core/ai/tagger";
import { Icon, useSettingsVersion } from "../shared";

/**
 * How it feels and what it is about, in the manage panel.
 *
 * Read-only chips: the words live in the note's `moods` and `themes`, where
 * they are edited like any other property. The one control is Retag, which
 * clears this note's two properties and asks again — only offered once the AI
 * may see the library. With the AI on but sharing not yet allowed, the row is
 * where the single offer to allow it appears; "Not now" is remembered.
 */
export function MoodsRow({ ctx, entry }: { ctx: ScoutContext; entry: LibraryEntry }): React.ReactElement | null {
	const { assistant, tagger } = ctx;
	// Allowing or declining from here changes what this row shows.
	useSettingsVersion(ctx.settings);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	if (!assistant.enabled() || !taggable(entry.kind)) return null;
	const tagged = entry.moods.length > 0 || entry.themes.length > 0;
	const canTag = assistant.canShare();
	const offer = !tagged && assistant.shouldOfferSharing();
	if (!tagged && !canTag && !offer) return null;

	const retag = async () => {
		setBusy(true);
		setError("");
		try {
			await tagger.retag(entry);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="sd-row scout-ai-row">
			<span className="sd-lbl">Feel</span>
			<div className="sd-ctl">
				{entry.moods.map((mood) => (
					<span key={`m:${mood}`} className="scout-ai-chip is-mood">
						{mood}
					</span>
				))}
				{entry.themes.map((theme) => (
					<span key={`t:${theme}`} className="scout-ai-chip">
						{theme}
					</span>
				))}
				{canTag && (
					<button
						className="sd-chip sd-add scout-ai-action"
						disabled={busy}
						title={tagged ? "Clear these and describe it again" : "Describe its moods and themes"}
						onClick={() => void retag()}
					>
						<Icon name="sparkles" size={13} />
						{busy ? "Tagging…" : tagged ? "Retag" : "Tag"}
					</button>
				)}
				{offer && (
					<span className="scout-ai-offer">
						<Icon name="sparkles" size={13} />
						To tag your library, Scout needs to see your titles.
						<button className="scout-ai-link" onClick={() => void assistant.allowSharing()}>
							Allow
						</button>
						<span aria-hidden>·</span>
						<button className="scout-ai-link" onClick={() => void assistant.declineSharing()}>
							Not now
						</button>
					</span>
				)}
				{error && <span className="scout-ai-error">{error}</span>}
			</div>
		</div>
	);
}
