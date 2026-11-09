import { Platform, type ButtonComponent, type Setting, type SettingGroup } from "obsidian";
import { confirmModal } from "../../../ui/confirm";
import { AI_SCOPE } from "../../ai/assistant";
import type { TagRun } from "../../ai/tagRunner";
import { estimate } from "../../ai/tagger";
import { toggle } from "../controls";
import type { SectionContext } from "./types";

/**
 * The second tier of AI: what needs to see the library.
 *
 * Only drawn once the AI is on and set up. Everything past the sharing switch
 * appears only once sharing is allowed, so the section stays one line long for
 * anybody who has not chosen it.
 */
export function aiLibrarySettings(group: SettingGroup, ctx: SectionContext): void {
	const { settings, assistant, tagger, threads, rerender } = ctx;
	const scope = settings.scopeFor(AI_SCOPE);
	const sharing = assistant.sharing();

	group.addSetting(
		toggle({
			name: "Share your library",
			desc: "Lets the AI tag your titles with moods and themes, find the threads running through what you love, pick from your shelf, suggest new things, and give its take on a title. Sends titles, years, types, genres, statuses, your ratings, moods and themes, the first few people credited and the source's short description. Never your notes' text or your thoughts. Moods and themes are written into your notes. Off by default.",
			value: sharing,
			onChange: async (v) => {
				await scope.set("shareLibrary", v);
				rerender();
			},
		}),
	);
	if (!sharing) return;

	group.addSetting(
		toggle({
			name: "Tag new additions",
			desc: "Describes each title you add through Scout — from search, suggestions or an import — with one small call. Only fills empty moods and themes.",
			value: tagger.tagsNew(),
			onChange: (v) => void scope.set("tagNew", v),
		}),
	);

	group.addSetting((s) => tagRow(s, ctx));

	group.addSetting((s) =>
		s
			.setName("Retag all")
			.setDesc("Empties every note's moods and themes and describes them again. Anything you wrote in those properties by hand is replaced.")
			.addButton((b) =>
				b
					.setButtonText("Retag all")
					.setWarning()
					.setDisabled(!tagger.canRunBatch() || tagger.busy())
					.onClick(async () => {
						const sure = await confirmModal(ctx.app, {
							title: "Retag your whole library?",
							body: "Every note's moods and themes will be cleared and filled again by the AI, including any you edited by hand. This can take a while and uses your AI service.",
							confirmText: "Retag all",
							danger: true,
						});
						if (!sure) return;
						void tagger.retagAll();
						rerender();
					}),
			),
	);

	group.addSetting((s) => {
		const count = threads.shown().length;
		const describe = () =>
			threads.busy()
				? "Writing threads…"
				: (threads.lastError() ??
					(count > 0
						? `${count} thread${count === 1 ? "" : "s"} on Home. Pinned ones are kept.`
						: "Finds the strands running through the titles you love, shown on Home. Written after tagging, or here."));
		s.setName("Threads")
			.setDesc(describe())
			.addButton((b) =>
				b
					.setButtonText("Refresh threads")
					.setDisabled(threads.busy() || tagger.busy())
					.onClick(async () => {
						b.setDisabled(true);
						s.setDesc("Writing threads…");
						await threads.refresh();
						rerender();
					}),
			);
	});

	const saved = settings.answerCount();
	group.addSetting((s) =>
		s
			.setName("Saved answers")
			.setDesc(
				saved > 0
					? `${saved} take${saved === 1 ? "" : "s"} and “If you loved this…” answers, kept 30 days so reopening a page is instant.`
					: "Takes and “If you loved this…” answers are kept 30 days so reopening a page is instant.",
			)
			.addButton((b) =>
				b
					.setButtonText("Clear")
					.setWarning()
					.setDisabled(saved === 0)
					.onClick(() => {
						settings.clearAnswers();
						rerender();
					}),
			),
	);
}

/** "Tag your library": an estimate first, then live progress, and a stop button. */
function tagRow(s: Setting, ctx: SectionContext): void {
	const { tagger, rerender } = ctx;
	s.setName("Tag your library");
	if (!Platform.isDesktopApp) {
		s.setDesc("Runs on a desktop. New additions are still tagged here.");
		return;
	}

	let button: ButtonComponent | null = null;
	const draw = () => {
		const run = tagger.state();
		if (tagger.busy() && run) {
			s.setDesc(`Tagging… ${run.done} of ${run.total} titles.`);
			button?.setButtonText("Stop");
			return;
		}
		const left = tagger.untagged().length;
		const plan = estimate(left);
		const last = run ? summary(run) : "";
		s.setDesc(
			left === 0
				? `${last}Every title has moods and themes.`
				: `${last}About ${plan.calls} call${plan.calls === 1 ? "" : "s"} for ${plan.titles} untagged title${plan.titles === 1 ? "" : "s"}${plan.capped ? " (at most 1,000 a run — run again to continue)" : ""}. Only empty properties are filled.`,
		);
		button?.setButtonText(run && !run.finished ? "Stop" : "Tag").setDisabled(left === 0);
	};

	s.addButton((b) => {
		button = b;
		b.setCta().onClick(() => {
			if (tagger.busy()) tagger.stop();
			else void tagger.tagLibrary();
		});
	});
	draw();

	// Live while the page is open; the listener drops itself once the row is
	// gone, since a redraw of the page makes a new one.
	const stop = tagger.subscribe(() => {
		if (!s.settingEl.isConnected) {
			stop();
			return;
		}
		if (tagger.state()?.finished) {
			stop();
			rerender();
			return;
		}
		draw();
	});
}

function summary(run: Readonly<TagRun>): string {
	if (run.error) return `Stopped: ${run.error} `;
	if (run.stopped) return `Stopped after ${run.done} of ${run.total}. `;
	return run.tagged > 0 ? `Tagged ${run.tagged} title${run.tagged === 1 ? "" : "s"}. ` : "";
}
