import type { Plugin } from "obsidian";

/**
 * A background job's timetable: one run a while after load, then one every
 * `everyMs` for as long as Obsidian stays open.
 *
 * A phone breaks the second half. Its timers stop whenever Obsidian is in the
 * background, and Obsidian is seldom in the foreground for long, so a six-hour
 * interval may never come round. Coming back to the app therefore also runs
 * the job, when the clock says a run is overdue. Before the first run, coming
 * back changes nothing: that timer is still pending and resumes by itself.
 */
export function scheduleRuns(
	plugin: Plugin,
	firstDelayMs: number,
	everyMs: number,
	run: () => void,
): void {
	let last: number | null = null;
	const fire = () => {
		last = Date.now();
		run();
	};

	const first = window.setTimeout(() => {
		fire();
		plugin.registerInterval(
			window.setInterval(() => {
				if (last !== null && Date.now() - last >= everyMs) fire();
			}, everyMs),
		);
	}, firstDelayMs);
	plugin.register(() => window.clearTimeout(first));

	plugin.registerDomEvent(document, "visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		if (last !== null && Date.now() - last >= everyMs) fire();
	});
}
