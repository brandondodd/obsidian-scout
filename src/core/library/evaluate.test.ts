import { describe, expect, it } from "vitest";
import { entry, item, NOW, testConfig } from "../../test/fixtures";
import type { MediaItem } from "../types";
import type { SuggestionPort } from "./engine";
import {
	auc,
	formatReport,
	holdOut,
	pipelineCheck,
	recordingPort,
	tasteCheck,
	type Recording,
} from "./evaluate";

const config = testConfig();

function port(answers: Record<string, MediaItem[]>, asked: string[] = []): SuggestionPort {
	return {
		facts: {
			recommendable: () => ["tmdb"],
			discoverable: () => [],
			seriesAware: () => [],
		},
		similar: async (_provider, ref) => {
			asked.push(`similar:${ref.id}`);
			return answers[`similar:${ref.id}`] ?? [];
		},
		discover: async () => [],
		series: async () => [],
		owned: () => false,
	};
}

describe("auc", () => {
	it("is 1 when every positive outscores every negative, 0.5 on ties", () => {
		expect(auc([3, 4], [1, 2])).toBe(1);
		expect(auc([1], [1])).toBe(0.5);
		expect(auc([], [1])).toBeNull();
	});
});

describe("tasteCheck", () => {
	it("ranks a hidden liked title above a hidden disliked one when the library is consistent", () => {
		const entries = [];
		for (let i = 0; i < 12; i++) {
			entries.push(entry({ rating: 9, status: "Watched", tags: ["Science Fiction"], people: ["Villeneuve"] }));
			entries.push(entry({ rating: 2, status: "Watched", tags: ["Romance"], people: ["Someone"] }));
		}
		const result = tasteCheck(config, entries, { now: NOW, folds: 4 });
		expect(result.liked).toBe(12);
		expect(result.disliked).toBe(12);
		expect(result.score).toBeGreaterThan(0.9);
		expect(result.fit).toBeGreaterThan(0.9);
	});
});

describe("holdOut", () => {
	it("hides the most recently finished liked titles only", () => {
		const old = entry({ title: "Old", rating: 9, status: "Watched", finished: "2024-01-01", ref: { providerId: "tmdb", kind: "movie", id: "1" } });
		const recent = entry({ title: "Recent", rating: 9, status: "Watched", finished: "2026-01-01", ref: { providerId: "tmdb", kind: "movie", id: "2" } });
		const disliked = entry({ title: "Bad", rating: 2, status: "Watched", finished: "2026-02-01", ref: { providerId: "tmdb", kind: "movie", id: "3" } });
		const { held, train } = holdOut(config, [old, recent, disliked], 1);
		expect(held.map((e) => e.title)).toEqual(["Recent"]);
		expect(train).toHaveLength(2);
	});
});

describe("pipelineCheck", () => {
	it("counts hidden favourites the engine suggests back", async () => {
		const seed = entry({ title: "Dune", rating: 9, status: "Watched", finished: "2025-01-01", tags: ["Science Fiction"], ref: { providerId: "tmdb", kind: "movie", id: "1" } });
		const hidden = entry({ title: "Arrival", year: 2016, rating: 9, status: "Watched", finished: "2026-03-01", tags: ["Science Fiction"], ref: { providerId: "tmdb", kind: "movie", id: "2" } });
		const answers = {
			"similar:1": [
				item({ title: "Arrival", year: 2016, ref: { providerId: "tmdb", kind: "movie", id: "2" }, rating: 8, tags: ["Science Fiction"] }),
				item({ title: "Sicario", year: 2015, rating: 7.6, tags: ["Thriller"] }),
			],
		};
		const result = await pipelineCheck({
			config,
			entries: [seed, hidden],
			port: port(answers),
			kinds: ["movie"],
			hold: 1,
			rows: 1,
			now: NOW,
		});
		expect(result.held).toBe(1);
		expect(result.inAll).toBe(1);
		expect(result.found[0]?.title).toBe("Arrival");
		expect(formatReport(null, result)).toContain("Arrival (#");
	});
});

describe("recordingPort", () => {
	it("asks once while recording, then replays offline and counts misses", async () => {
		const asked: string[] = [];
		const recording: Recording = {};
		const ref = { providerId: "tmdb", kind: "movie" as const, id: "1" };
		const signal = new AbortController().signal;

		const record = recordingPort(port({ "similar:1": [item({ title: "A" })] }, asked), recording, "record");
		await record.port.similar("tmdb", ref, signal);
		await record.port.similar("tmdb", ref, signal);
		expect(asked).toEqual(["similar:1"]);

		const replay = recordingPort(port({}, asked), recording, "replay");
		expect((await replay.port.similar("tmdb", ref, signal)).map((i) => i.title)).toEqual(["A"]);
		await replay.port.similar("tmdb", { ...ref, id: "9" }, signal);
		expect(replay.misses()).toBe(1);
		expect(asked).toEqual(["similar:1"]);
	});
});
