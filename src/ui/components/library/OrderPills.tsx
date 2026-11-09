import { Menu } from "obsidian";
import React from "react";
import {
	GROUP_LABELS,
	GROUP_SECTIONS,
	LAYOUT_LABELS,
	LIBRARY_LAYOUTS,
	SORT_FIELDS,
	sortFieldOf,
	sortIsDescending,
	type LibraryGroupBy,
	type LibraryLayout,
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
		addSortItems(menu, sortBy, onSort);
		menu.showAtMouseEvent(event.nativeEvent);
	};

	const groupMenu = (event: React.MouseEvent) => {
		const menu = new Menu();
		addGroupItems(menu, groupBy, onGroup);
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

export const LAYOUT_ICONS: Record<LibraryLayout, string> = {
	grid: "layout-grid",
	list: "rows",
	table: "table",
	board: "kanban",
};

/**
 * Layout, sort and grouping as one button, for a phone.
 *
 * The desktop's two pills and four-way layout toggle are the same three
 * questions; side by side they cost a whole row of a phone screen and still
 * did not fit. Here they are one press away, in the sheet Obsidian already
 * uses for every menu on a phone, with the same names and the same ticks.
 * The button's icon is the layout you are in, so the row still says it.
 */
export function DisplayButton({
	layout,
	sortBy,
	groupBy,
	onLayout,
	onSort,
	onGroup,
}: {
	layout: LibraryLayout;
	sortBy: LibrarySort;
	groupBy: LibraryGroupBy;
	onLayout: (layout: LibraryLayout) => void;
	onSort: (sort: LibrarySort) => void;
	onGroup: (group: LibraryGroupBy) => void;
}): React.ReactElement {
	const open = (event: React.MouseEvent) => {
		const menu = new Menu();
		addLabel(menu, "Layout");
		for (const option of LIBRARY_LAYOUTS) {
			menu.addItem((item) =>
				item
					.setTitle(LAYOUT_LABELS[option])
					.setIcon(LAYOUT_ICONS[option])
					.setChecked(option === layout)
					.onClick(() => onLayout(option)),
			);
		}
		menu.addSeparator();
		addLabel(menu, "Sort by");
		addSortItems(menu, sortBy, onSort);
		const { field, reversed } = sortFieldOf(sortBy);
		if (field.other) {
			const other = field.other;
			menu.addItem((item) =>
				item
					.setTitle("Reverse the order")
					.setIcon(sortIsDescending(sortBy) ? "arrow-up" : "arrow-down")
					.onClick(() => onSort(reversed ? field.first : other)),
			);
		}
		menu.addSeparator();
		addLabel(menu, "Group by");
		addGroupItems(menu, groupBy, onGroup);
		menu.showAtMouseEvent(event.nativeEvent);
	};

	return (
		<button
			className="scout-display-button"
			aria-label="Layout, sort and grouping"
			onClick={open}
		>
			<Icon name={LAYOUT_ICONS[layout]} size={16} />
		</button>
	);
}

function addLabel(menu: Menu, title: string): void {
	menu.addItem((item) => item.setTitle(title).setIsLabel(true));
}

/** One item per field; picking the field already on keeps its direction. */
function addSortItems(
	menu: Menu,
	sortBy: LibrarySort,
	onSort: (sort: LibrarySort) => void,
): void {
	const { field } = sortFieldOf(sortBy);
	for (const one of SORT_FIELDS) {
		menu.addItem((item) =>
			item
				.setTitle(one.label)
				.setChecked(one.id === field.id)
				.onClick(() => onSort(one.id === field.id ? sortBy : one.first)),
		);
	}
}

function addGroupItems(
	menu: Menu,
	groupBy: LibraryGroupBy,
	onGroup: (group: LibraryGroupBy) => void,
): void {
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
}

/** "By main genre" reads as a menu item; on the pill it is just "Main genre". */
function groupName(group: LibraryGroupBy): string {
	if (group === "none") return "No grouping";
	const label = GROUP_LABELS[group].replace(/^By /, "");
	return label.charAt(0).toUpperCase() + label.slice(1);
}
