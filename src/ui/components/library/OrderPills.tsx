import { Menu } from "obsidian";
import React from "react";
import {
	GROUP_LABELS,
	GROUP_SECTIONS,
	SORT_FIELDS,
	sortFieldOf,
	sortIsDescending,
	type LibraryGroupBy,
	type LibrarySort,
} from "../../../core/library/config";
import { Icon } from "../shared";

/**
 * Sort and grouping, one pill each.
 *
 * Sort is a field and a direction: the pill names the field and the arrow
 * beside it flips the order, so "oldest first" is one press away from "newest
 * first" rather than a second entry in a long list. Grouping is the field the
 * shelves are cut by, and nothing else.
 */
export function OrderPills({
	sortBy,
	groupBy,
	onSort,
	onGroup,
}: {
	sortBy: LibrarySort;
	groupBy: LibraryGroupBy;
	onSort: (sort: LibrarySort) => void;
	onGroup: (group: LibraryGroupBy) => void;
}): React.ReactElement {
	const { field, reversed } = sortFieldOf(sortBy);
	const down = sortIsDescending(sortBy);

	const sortMenu = (event: React.MouseEvent) => {
		const menu = new Menu();
		for (const one of SORT_FIELDS) {
			menu.addItem((item) =>
				item
					.setTitle(one.label)
					.setChecked(one.id === field.id)
					.onClick(() => onSort(one.id === field.id ? sortBy : one.first)),
			);
		}
		menu.showAtMouseEvent(event.nativeEvent);
	};

	const groupMenu = (event: React.MouseEvent) => {
		const menu = new Menu();
		GROUP_SECTIONS.forEach((section, at) => {
			if (at > 0) menu.addSeparator();
			for (const group of section) {
				menu.addItem((item) =>
					item
						.setTitle(groupName(group))
						.setChecked(group === groupBy)
						.onClick(() => onGroup(group)),
				);
			}
		});
		menu.showAtMouseEvent(event.nativeEvent);
	};

	return (
		<div className="scout-order">
			<span className="scout-order-pill">
				<button onClick={sortMenu} title="Sort by">
					<Icon name="arrow-up-down" size={13} />
					{field.label}
				</button>
				{field.other && (
					<button
						className="scout-order-flip"
						aria-label={down ? "Descending — select to reverse" : "Ascending — select to reverse"}
						title="Reverse the order"
						onClick={() =>
							onSort(reversed ? field.first : (field.other as LibrarySort))
						}
					>
						<Icon name={down ? "arrow-down" : "arrow-up"} size={13} />
					</button>
				)}
			</span>
			<span className={`scout-order-pill${groupBy !== "none" ? " is-on" : ""}`}>
				<button onClick={groupMenu} title="Group by">
					<Icon name="rows-3" size={13} />
					{groupBy === "none" ? "No groups" : groupName(groupBy)}
				</button>
			</span>
		</div>
	);
}

/** "By main genre" reads as a menu item; on the pill it is just "Main genre". */
function groupName(group: LibraryGroupBy): string {
	if (group === "none") return "No grouping";
	const label = GROUP_LABELS[group].replace(/^By /, "");
	return label.charAt(0).toUpperCase() + label.slice(1);
}
