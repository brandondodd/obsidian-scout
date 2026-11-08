import { emptyExtras } from "../../core/detail/types";
import type {
	Availability,
	ItemExtras,
	Rail,
	ServiceGroup,
} from "../../core/detail/types";
import { languageName, oneDecimal, plural } from "../../core/format";
import type { MediaItem } from "../../core/types";

/**
 * The detail dialog's view of a book.
 *
 * `ebook_access`, `author_key`, the author record, and `author_key:` searches
 * were all checked live. Apple Books prices are added on top of this by the
 * detail service, because they are opt-in and not Open Library's to know.
 */

const SITE = "https://openlibrary.org";
const PHOTOS = "https://covers.openlibrary.org/a/olid";

export interface OpenLibraryDoc {
	ebook_access?: string;
	ia?: string[];
	author_key?: string[];
	author_name?: string[];
	first_publish_year?: number;
	number_of_pages_median?: number;
	isbn?: string[];
	publisher?: string[];
	language?: string[];
	ratings_average?: number;
	ratings_count?: number;
	subject?: string[];
	/** The edition that best matches your language, when asked for with `lang`. */
	editions?: {
		docs?: {
			publisher?: string[];
			isbn?: string[];
			language?: string[];
		}[];
	};
}

export interface OpenLibraryAuthor {
	bio?: string | { value?: string };
	birth_date?: string;
	photos?: number[];
}

export interface OpenLibraryParts {
	doc: OpenLibraryDoc;
	author?: OpenLibraryAuthor | null;
	authorKey?: string;
	/** Other books by the same author, best rated first. */
	others?: MediaItem[];
	/** How many books the author has in all. */
	worksTotal?: number;
}

/**
 * Whether a copy can actually be borrowed.
 *
 * `printdisabled` looks like access and is not: it is only open to readers with
 * a registered print disability, so listing it would be a dead end for most.
 */
function toAvailability(doc: OpenLibraryDoc): Availability | undefined {
	const access = doc.ebook_access;
	if (access !== "borrowable" && access !== "public") return undefined;
	const id = doc.ia?.[0];
	const borrow: ServiceGroup = {
		id: "borrow",
		label: access === "public" ? "Read free" : "Borrow",
		tiles: [
			{
				name: "Open Library",
				...(id ? { url: `https://archive.org/details/${id}` } : {}),
			},
		],
	};
	return { title: "Where to read", groups: [borrow] };
}

function authorRail(parts: OpenLibraryParts, name: string | undefined): Rail[] {
	const others = parts.others ?? [];
	if (others.length === 0 || !name) return [];
	const total = parts.worksTotal ?? 0;
	return [
		{
			id: "by-author",
			title: `More by ${name}`,
			items: others,
			...(parts.authorKey && total > others.length
				? {
						more: {
							label: `All ${total}`,
							url: `${SITE}/authors/${parts.authorKey}`,
						},
					}
				: {}),
		},
	];
}

export function toExtras(parts: OpenLibraryParts): ItemExtras {
	const { doc, author, authorKey } = parts;
	const name = doc.author_name?.[0];
	const bio =
		typeof author?.bio === "string" ? author.bio : author?.bio?.value;
	const pages = doc.number_of_pages_median;
	const availability = toAvailability(doc);

	const facts: ItemExtras["facts"] = [];
	const add = (label: string, value: string | undefined) => {
		if (value) facts.push({ label, value });
	};
	add("First published", doc.first_publish_year?.toString());
	// From one edition, not the work: a work's own lists run across every
	// translation in no useful order, which is how The Martian came out as a
	// Belarusian book from a Dutch publisher. No edition, no claim.
	const edition = doc.editions?.docs?.[0];
	add("Publisher", edition?.publisher?.[0]);
	add("Pages", pages?.toString());
	add("ISBN", edition?.isbn?.[0]);
	add("Language", languageName(edition?.language?.[0]));

	const authorFacts = [
		author?.birth_date ? `Born ${author.birth_date}` : undefined,
		parts.worksTotal ? plural(parts.worksTotal, "book") : undefined,
	]
		.filter(Boolean)
		.join(" · ");

	return {
		...emptyExtras(),
		headerFacts: pages ? [`${pages} pages`] : [],
		scores:
			typeof doc.ratings_average === "number" && doc.ratings_average > 0
				? [
						{
							id: "openlibrary",
							label: "Open Library",
							value: oneDecimal(doc.ratings_average * 2),
							outOfTen: doc.ratings_average * 2,
							// Open Library ratings run thin — a dozen is common — so
							// the count decides how far the average is believed.
							...(typeof doc.ratings_count === "number" && doc.ratings_count > 0
								? { votes: doc.ratings_count }
								: {}),
						},
					]
				: [],
		moreLabel: "Author & more",
		rails: authorRail(parts, name),
		facts,
		keywords: (doc.subject ?? []).slice(0, 8).map((one) => one.toLowerCase()),
		progress: { unit: "page", ...(pages ? { total: pages } : {}) },
		...(name ? { byline: doc.author_name?.join(", ") } : {}),
		...(name && (bio || authorFacts)
			? {
					author: {
						name,
						...(bio ? { bio } : {}),
						...(authorFacts ? { facts: authorFacts } : {}),
						...(authorKey && author?.photos?.length
							? { imageUrl: `${PHOTOS}/${authorKey}-M.jpg` }
							: {}),
					},
				}
			: {}),
		...(availability ? { availability } : {}),
	};
}
