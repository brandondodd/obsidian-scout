import { describe, expect, it } from "vitest";
import { MOODS, THEMES, isMood, snapMood, snapTheme, snapThemes } from "./vocabulary";

describe("vocabulary", () => {
	it("has about sixty moods and about a hundred and fifty themes, none repeated", () => {
		expect(MOODS.length).toBeGreaterThanOrEqual(55);
		expect(THEMES.length).toBeGreaterThanOrEqual(150);
		expect(new Set(MOODS).size).toBe(MOODS.length);
		expect(new Set(THEMES).size).toBe(THEMES.length);
		// Every word is already in the folded form a lookup compares against.
		for (const word of [...MOODS, ...THEMES]) expect(word).toBe(word.trim().toLowerCase());
	});

	it("only accepts moods on the list", () => {
		expect(snapMood(" Cozy ")).toBe("cozy");
		expect(isMood("melancholy")).toBe(true);
		expect(snapMood("melancholic")).toBeNull();
	});
});

describe("snapTheme", () => {
	it("folds case, plurals, hyphens and a leading 'the'", () => {
		expect(snapTheme("Grief")).toBe("grief");
		expect(snapTheme("heists")).toBe("heist");
		expect(snapTheme("coming-of-age")).toBe("coming of age");
		expect(snapTheme("time loops")).toBe("time loop");
		expect(snapTheme("supernatural")).toBe("the supernatural");
		expect(snapTheme("The Sea")).toBe("the sea");
		expect(snapTheme("organized crime")).toBe("organised crime");
	});

	it("maps the short list of synonyms", () => {
		expect(snapTheme("chosen family")).toBe("found family");
		expect(snapTheme("AI")).toBe("artificial intelligence");
		expect(snapTheme("Mafia")).toBe("organised crime");
		expect(snapTheme("whodunit")).toBe("murder mystery");
	});

	it("leaves a word that means none of them alone", () => {
		expect(snapTheme("the weight of inherited silence")).toBeNull();
		expect(snapTheme("")).toBeNull();
	});
});

describe("snapThemes", () => {
	it("keeps canonical themes once and at most two leftovers", () => {
		const out = snapThemes(["Grief", "grief", "heists", "inherited silence", "Inherited Silence", "bees", "kites"]);
		expect(out.canonical).toEqual(["grief", "heist"]);
		expect(out.loose).toEqual(["inherited silence", "bees"]);
	});
});
