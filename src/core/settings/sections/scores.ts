import { SecretComponent, SettingGroup } from "obsidian";
import { REGION_CODES, regionFromLocale, regionName } from "../../region";
import { dropdown, toggle } from "../controls";
import type { SectionContext, SettingsSection } from "./types";

/**
 * Region, and the optional services the detail dialog can draw on.
 *
 * None of these is a media source: they make no notes and answer no searches.
 * Each one is off until you give it a key or turn it on, and each says here what
 * it receives, because it is the place somebody is deciding whether to let it.
 */

function regionOptions(): Record<string, string> {
	const system = regionFromLocale(navigator.language);
	const options: Record<string, string> = {
		"": `Automatic (${regionName(system)})`,
	};
	const named = REGION_CODES.map((code) => [code, regionName(code)] as const);
	named.sort(([, a], [, b]) => a.localeCompare(b));
	for (const [code, name] of named) options[code] = name;
	return options;
}

function secretRow(
	ctx: SectionContext,
	group: SettingGroup,
	provider: string,
	name: string,
	desc: string,
): void {
	const scope = ctx.settings.scopeFor(provider);
	// Sync carries which secret was chosen, but secret storage is per device:
	// a phone can show the name of a key it does not have, and quietly go
	// without everything the key fetches.
	const missing =
		scope.get("apiKeySecret", "") !== "" && scope.secret("apiKeySecret").trim() === "";
	group.addSetting((setting) =>
		setting
			.setName(name)
			.setDesc(
				missing
					? `${desc} This device has no key saved under that name yet. Keys aren't synced, so enter it here too.`
					: desc,
			)
			.addComponent((el) =>
				new SecretComponent(ctx.app, el)
					.setValue(scope.get("apiKeySecret", ""))
					.onChange((value) => void scope.set("apiKeySecret", value)),
			),
	);
}

export const scoresSection: SettingsSection = (container, ctx) => {
	const { settings } = ctx;
	const config = settings.library();

	const group = new SettingGroup(container)
		.setHeading("Scores and availability")
		.addSetting(
			dropdown<string>({
				name: "Region",
				desc: "Sets age ratings, where to watch, and prices. Follows your system until you pick one.",
				value: config.region,
				options: regionOptions(),
				onChange: (value) => settings.setLibrary("region", value),
			}),
		);

	secretRow(
		ctx,
		group,
		"mdblist",
		"MDBList key",
		"Optional. Adds Rotten Tomatoes, IMDb, Metacritic, Letterboxd, and Trakt scores to films and shows, and folds them into the Scout score. Sends mdblist.com the TMDB id of each title you open. Free key from mdblist.com/preferences, kept in Obsidian's secret storage.",
	);
	secretRow(
		ctx,
		group,
		"omdb",
		"OMDb key",
		"Optional. Adds IMDb scores for each episode. Sends omdbapi.com the IMDb id and season when you open a show's episodes. Free key from omdbapi.com, kept in Obsidian's secret storage.",
	);

	group.addSetting(
		toggle({
			name: "Apple prices",
			desc: "Optional, off by default. Shows Apple Books and iTunes prices for your region. Sends Apple the title and author or artist of each book or album you open.",
			value: settings.scopeFor("itunes").get("enabled", false),
			onChange: (value) => void settings.scopeFor("itunes").set("enabled", value),
		}),
	);
};
