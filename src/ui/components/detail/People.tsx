import React, { useMemo, useState } from "react";
import type { ScoutContext } from "../../../core/context";
import { peopleInLibrary } from "../../../core/detail/library";
import type { PersonCredit } from "../../../core/detail/types";
import type { LibraryEntry } from "../../../core/library/entry";
import { ScoutDetailModal } from "../../detailModal";
import { resolveImage, useLibraryEntries } from "../shared";
import { Dotted, initials, Picture, Section } from "./bits";

/** How many show before "All 24". Eight is four rows of the two columns. */
const FOLDED = 8;

const caption = (person: PersonCredit) =>
	[person.role, person.more].filter(Boolean).join(" · ");

function Face({
	person,
	count,
}: {
	person: PersonCredit;
	count: number;
}): React.ReactElement {
	return (
		<Picture src={person.imageUrl} seed={person.name} className="sd-av">
			{!person.imageUrl && initials(person.name)}
			{count > 0 && (
				<span className="sd-lb" title={`In ${count} of yours`}>
					{count}
				</span>
			)}
		</Picture>
	);
}

/**
 * Cast and crew, as one list.
 *
 * Crew are the same kind of entry as cast. The blue number on a photo is how many
 * other titles in your library they are in, and selecting someone names them.
 */
export function People({
	ctx,
	title,
	people,
	entry,
	onClose,
}: {
	ctx: ScoutContext;
	title: string;
	people: readonly PersonCredit[];
	entry: LibraryEntry | undefined;
	onClose: () => void;
}): React.ReactElement | null {
	const [picked, setPicked] = useState<string | null>(null);
	const [all, setAll] = useState(false);
	const entries = useLibraryEntries(ctx.library);

	const shelves = useMemo(
		() =>
			peopleInLibrary(
				people.map((one) => one.name),
				entries,
				entry?.path,
			),
		[people, entries, entry?.path],
	);

	if (people.length === 0) return null;
	const shown = all ? people : people.slice(0, FOLDED);
	const more = people.length > FOLDED;
	const chosen = shown.find((one) => one.name === picked);
	const titles = chosen ? (shelves.get(chosen.name) ?? []) : [];

	const openEntry = (path: string) => {
		onClose();
		new ScoutDetailModal(ctx, { entryPath: path }).open();
	};

	return (
		<Section
			id="people"
			title={title}
			link={more ? (all ? "Show fewer" : `All ${people.length}`) : undefined}
			onLink={() => setAll(!all)}
		>
			<div className="sd-pgrid">
				{shown.map((person, at) => {
					const on = person.name === picked;
					const line = caption(person);
					return (
						<button
							key={`${person.name}:${at}`}
							className={`sd-pp${on ? " sd-sel" : ""}`}
							aria-pressed={on}
							onClick={() => setPicked(on ? null : person.name)}
						>
							<Face
								person={person}
								count={shelves.get(person.name)?.length ?? 0}
							/>
							<span className="sd-pt">
								<b>{person.name}</b>
								{line && (
									<span className="sd-d">
										<Dotted text={line} />
									</span>
								)}
							</span>
						</button>
					);
				})}
			</div>
			{chosen && (
				<div className="sd-pdet">
					<div>
						<b>{chosen.name}</b>
						{caption(chosen) && (
							<span className="sd-pd">
								<Dotted text={caption(chosen)} />
							</span>
						)}
						{titles.length > 0 && (
							<div className="sd-plib">
								<span>Also in your library</span>
								{titles.map((one) => (
									<button
										key={one.path}
										className="sd-ptitle"
										onClick={() => openEntry(one.path)}
									>
										<Picture
											src={resolveImage(ctx.app, one.cover, one.path)}
											seed={one.title}
											className="sd-pthumb"
										/>
										{one.title}
									</button>
								))}
							</div>
						)}
					</div>
				</div>
			)}
		</Section>
	);
}
