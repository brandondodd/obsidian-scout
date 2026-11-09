/**
 * The words Scout describes a title's feel and subject in.
 *
 * Fixed and versioned, because these words become taste traits, filters and
 * threads, and all three only work when two titles tagged a year apart — by
 * different models, even — land on the *same* word. A model left to choose
 * freely calls one film "melancholic", the next "melancholy" and a third
 * "wistful and sad", and the profile learns three weak facts instead of one
 * strong one.
 *
 * Moods are closed: the model must pick from the list (it is the schema's
 * enum), so a mood is always one of these. Themes are open, because no list
 * of subjects is ever complete: the model writes its own words, and they are
 * snapped here onto the canonical list when they plainly mean one of its
 * entries. Whatever does not snap is kept on the note for you to read, but is
 * never a trait — see `traitsOfEntry`.
 *
 * Bump the version when either list changes meaning, not merely grows.
 */
export const VOCABULARY_VERSION = 1;

export const MOODS = [
	"adventurous",
	"atmospheric",
	"bittersweet",
	"bleak",
	"brooding",
	"calm",
	"cerebral",
	"chaotic",
	"charming",
	"cold",
	"comforting",
	"contemplative",
	"cozy",
	"creepy",
	"cynical",
	"dark",
	"dreamy",
	"eerie",
	"emotional",
	"empowering",
	"epic",
	"energetic",
	"escapist",
	"funny",
	"gentle",
	"gritty",
	"haunting",
	"heartwarming",
	"hopeful",
	"intense",
	"intimate",
	"inspiring",
	"lighthearted",
	"lonely",
	"melancholy",
	"menacing",
	"mysterious",
	"nostalgic",
	"offbeat",
	"optimistic",
	"paranoid",
	"playful",
	"poignant",
	"provocative",
	"quirky",
	"raw",
	"reflective",
	"romantic",
	"sad",
	"satirical",
	"slow-burn",
	"sombre",
	"surreal",
	"suspenseful",
	"tender",
	"tense",
	"thought-provoking",
	"tragic",
	"uplifting",
	"violent",
	"whimsical",
	"wistful",
] as const;

export type Mood = (typeof MOODS)[number];

export const THEMES = [
	// People and the ties between them
	"family",
	"found family",
	"parenthood",
	"siblings",
	"friendship",
	"first love",
	"forbidden love",
	"unrequited love",
	"marriage",
	"divorce",
	"loneliness",
	"belonging",
	"betrayal",
	"loyalty",
	"jealousy",
	"obsession",
	"rivalry",
	"mentorship",
	"community",
	"generational conflict",
	// Growing, changing, ending
	"coming of age",
	"childhood",
	"adolescence",
	"ageing",
	"midlife crisis",
	"grief",
	"loss",
	"death",
	"mortality",
	"illness",
	"mental health",
	"addiction",
	"trauma",
	"healing",
	"redemption",
	"forgiveness",
	"guilt",
	"regret",
	"second chances",
	"self-discovery",
	"identity",
	"memory",
	"nostalgia",
	"ambition",
	"sacrifice",
	"survival",
	"resilience",
	"hope",
	"faith",
	"doubt",
	"morality",
	"free will",
	"fate",
	"time",
	// Power, society, the world
	"power",
	"corruption",
	"politics",
	"war",
	"revolution",
	"rebellion",
	"oppression",
	"freedom",
	"justice",
	"revenge",
	"crime",
	"organised crime",
	"heist",
	"con artists",
	"murder mystery",
	"detective",
	"serial killer",
	"conspiracy",
	"espionage",
	"surveillance",
	"terrorism",
	"class",
	"wealth",
	"poverty",
	"capitalism",
	"work",
	"race",
	"racism",
	"immigration",
	"colonialism",
	"gender",
	"feminism",
	"sexuality",
	"lgbtq",
	"religion",
	"cults",
	"media",
	"fame",
	"art",
	"music",
	"sport",
	"education",
	"science",
	"technology",
	"social media",
	"isolation",
	"small town",
	"city life",
	"road trip",
	"travel",
	"nature",
	"environment",
	"animals",
	"food",
	// Genre furniture
	"artificial intelligence",
	"robots",
	"space exploration",
	"first contact",
	"aliens",
	"time travel",
	"time loop",
	"alternate history",
	"dystopia",
	"utopia",
	"post-apocalypse",
	"pandemic",
	"virtual reality",
	"cyberpunk",
	"genetic engineering",
	"superheroes",
	"magic",
	"mythology",
	"fairy tale",
	"dragons",
	"quest",
	"chosen one",
	"prophecy",
	"monsters",
	"vampires",
	"zombies",
	"ghosts",
	"haunted house",
	"possession",
	"witchcraft",
	"the supernatural",
	"body horror",
	"cosmic horror",
	"folk horror",
	"psychological horror",
	"madness",
	"dreams",
	"parallel worlds",
	"exploration",
	"pirates",
	"the sea",
	"the wild west",
	"samurai",
	"martial arts",
	"military",
	"prison",
	"escape",
	"courtroom",
	"medicine",
	"school",
	"workplace",
	"underdog",
	"outsiders",
	"unlikely friendship",
	"anti-hero",
	"moral ambiguity",
	"unreliable narrator",
	"secrets",
	"lies",
	"deception",
	"heritage",
	"history",
	"biography",
	"true story",
] as const;

export type Theme = (typeof THEMES)[number];

const MOOD_SET: ReadonlySet<string> = new Set(MOODS);
const THEME_SET: ReadonlySet<string> = new Set(THEMES);

/**
 * Words that mean a canonical theme but share no spelling with it.
 *
 * Kept short on purpose: every entry is a claim that two words mean the same
 * thing to a reader choosing what to watch next, and a long list of loose ones
 * would quietly merge subjects that a person keeps apart.
 */
const THEME_SYNONYMS: Readonly<Record<string, Theme>> = {
	"found families": "found family",
	"chosen family": "found family",
	"coming-of-age": "coming of age",
	"growing up": "coming of age",
	bereavement: "grief",
	mourning: "grief",
	"ai": "artificial intelligence",
	"a.i.": "artificial intelligence",
	"machine intelligence": "artificial intelligence",
	androids: "robots",
	"alien contact": "first contact",
	"alien invasion": "aliens",
	extraterrestrials: "aliens",
	"space travel": "space exploration",
	"time loops": "time loop",
	"groundhog day": "time loop",
	apocalypse: "post-apocalypse",
	"end of the world": "post-apocalypse",
	"post-apocalyptic": "post-apocalypse",
	dystopian: "dystopia",
	"robbery": "heist",
	"bank robbery": "heist",
	"mafia": "organised crime",
	"organized crime": "organised crime",
	"the mob": "organised crime",
	"gangsters": "organised crime",
	"whodunit": "murder mystery",
	"whodunnit": "murder mystery",
	"spies": "espionage",
	"spy": "espionage",
	"vengeance": "revenge",
	"retribution": "revenge",
	"mental illness": "mental health",
	"depression": "mental health",
	"drugs": "addiction",
	"substance abuse": "addiction",
	"lgbt": "lgbtq",
	"lgbtq+": "lgbtq",
	"queer": "lgbtq",
	"queer identity": "lgbtq",
	"social class": "class",
	"class struggle": "class",
	"inequality": "class",
	"greed": "wealth",
	"money": "wealth",
	"aging": "ageing",
	"old age": "ageing",
	"fatherhood": "parenthood",
	"motherhood": "parenthood",
	"parenting": "parenthood",
	"brothers": "siblings",
	"sisters": "siblings",
	"self discovery": "self-discovery",
	"finding yourself": "self-discovery",
	"sorcery": "magic",
	"wizards": "magic",
	"witches": "witchcraft",
	"myth": "mythology",
	"myths": "mythology",
	"folklore": "mythology",
	"haunted houses": "haunted house",
	"lovecraftian": "cosmic horror",
	"insanity": "madness",
	"multiverse": "parallel worlds",
	"alternate reality": "parallel worlds",
	"alternate universe": "parallel worlds",
	"vr": "virtual reality",
	"simulation": "virtual reality",
	"climate change": "environment",
	"ecology": "environment",
	"wilderness": "nature",
	"ocean": "the sea",
	"sailing": "the sea",
	"western": "the wild west",
	"cowboys": "the wild west",
	"kung fu": "martial arts",
	"army": "military",
	"soldiers": "military",
	"jail": "prison",
	"incarceration": "prison",
	"trial": "courtroom",
	"legal drama": "courtroom",
	"lawyers": "courtroom",
	"doctors": "medicine",
	"hospital": "medicine",
	"high school": "school",
	"boarding school": "school",
	"office": "workplace",
	"the underdog": "underdog",
	"misfits": "outsiders",
	"antihero": "anti-hero",
	"moral greyness": "moral ambiguity",
	"moral grey areas": "moral ambiguity",
	"based on a true story": "true story",
	"real events": "true story",
	"biopic": "biography",
	"celebrity": "fame",
	"hollywood": "fame",
	"journalism": "media",
	"the press": "media",
	"internet": "technology",
	"cults and sects": "cults",
	"religious faith": "faith",
	"spirituality": "faith",
	"destiny": "fate",
	"remorse": "regret",
	"atonement": "redemption",
	"homecoming": "belonging",
	"heritage and roots": "heritage",
	"immigrant experience": "immigration",
	"migration": "immigration",
	"empire": "colonialism",
	"imperialism": "colonialism",
	"resistance": "rebellion",
	"uprising": "rebellion",
	"tyranny": "oppression",
	"authoritarianism": "oppression",
	"totalitarianism": "dystopia",
	"surviving": "survival",
	"wartime": "war",
	"world war ii": "war",
	"world war i": "war",
	"ww2": "war",
	"lost love": "unrequited love",
	"star-crossed lovers": "forbidden love",
	"sibling rivalry": "siblings",
	"father and son": "family",
	"mother and daughter": "family",
	"family drama": "family",
	"dysfunctional family": "family",
};

/** Folded for comparison: lower case, plain spaces, no stray punctuation. */
function fold(word: string): string {
	return word
		.trim()
		.toLowerCase()
		.replace(/[’']/g, "'")
		.replace(/[_]+/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[^a-z0-9]+|[^a-z0-9+.]+$/g, "");
}

/**
 * Plural and spelling forms worth trying, cheapest first.
 *
 * No stemmer: "ghosts" → "ghost" is the only kind of change wanted here, and a
 * real stemmer would also fold "media" and "medicine" together.
 */
function variants(word: string): string[] {
	const out = [word, word.replace(/-/g, " "), word.replace(/ /g, "-")];
	if (word.endsWith("ies")) out.push(`${word.slice(0, -3)}y`);
	if (word.endsWith("es")) out.push(word.slice(0, -2));
	if (word.endsWith("s")) out.push(word.slice(0, -1));
	else out.push(`${word}s`);
	out.push(word.replace(/organized/g, "organised").replace(/aging/g, "ageing"));
	if (word.startsWith("the ")) out.push(word.slice(4));
	else out.push(`the ${word}`);
	return out;
}

export function isMood(word: string): word is Mood {
	return MOOD_SET.has(fold(word));
}

/** A mood as the list spells it, or null when it is not one. */
export function snapMood(word: string): Mood | null {
	const folded = fold(word);
	return MOOD_SET.has(folded) ? (folded as Mood) : null;
}

/** The canonical theme a word means, or null when it means none of them. */
export function snapTheme(word: string): Theme | null {
	const folded = fold(word);
	if (!folded) return null;
	for (const form of variants(folded)) {
		if (THEME_SET.has(form)) return form as Theme;
		const synonym = THEME_SYNONYMS[form];
		if (synonym) return synonym;
	}
	return null;
}

/**
 * A model's themes, sorted into canonical ones and leftovers.
 *
 * Both lists are de-duplicated, and a leftover that differs from a canonical
 * theme only in case is dropped rather than shown twice. Leftovers are capped:
 * they are for reading, and a note carrying nine idiosyncratic subjects has
 * stopped being readable.
 */
export function snapThemes(
	words: readonly string[],
	maxLoose = 2,
): { canonical: Theme[]; loose: string[] } {
	const canonical: Theme[] = [];
	const loose: string[] = [];
	const seenLoose = new Set<string>();
	for (const word of words) {
		const hit = snapTheme(word);
		if (hit) {
			if (!canonical.includes(hit)) canonical.push(hit);
			continue;
		}
		const text = word.trim().replace(/\s+/g, " ").toLowerCase();
		if (!text || text.length > 40 || seenLoose.has(text)) continue;
		seenLoose.add(text);
		loose.push(text);
	}
	return { canonical, loose: loose.slice(0, maxLoose) };
}
