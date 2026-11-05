import { describe, expect, it } from "vitest";
import { csvHeader, field, parseCsv, parseCsvRecords } from "./csv";

describe("parseCsv", () => {
	it("reads plain rows", () => {
		expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
			["a", "b", "c"],
			["1", "2", "3"],
		]);
	});

	it("keeps commas, doubled quotes and newlines inside quotes", () => {
		const text = 'Name,Review\n"Crouching Tiger, Hidden Dragon","He said ""wow""\nand left"\n';
		expect(parseCsv(text)).toEqual([
			["Name", "Review"],
			["Crouching Tiger, Hidden Dragon", 'He said "wow"\nand left'],
		]);
	});

	it("strips a byte-order mark and handles CRLF", () => {
		expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	it("keeps empty cells and drops blank lines", () => {
		expect(parseCsv("a,,c\n\n,,\n")).toEqual([
			["a", "", "c"],
			["", "", ""],
		]);
	});

	it("reads a last line with no newline", () => {
		expect(parseCsv("a,b\n1,2")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});
});

describe("parseCsvRecords", () => {
	it("keys cells by header, case-insensitively", () => {
		const [row] = parseCsvRecords("Title,My Rating\nDune,4\n");
		expect(row && field(row, "title")).toBe("Dune");
		expect(row && field(row, "MY RATING")).toBe("4");
		expect(row && field(row, "missing", "title")).toBe("Dune");
	});

	it("reads the header alone", () => {
		expect(csvHeader("Date,Name,Year,Letterboxd URI\n2020-01-01,X,2000,u")).toEqual([
			"date",
			"name",
			"year",
			"letterboxd uri",
		]);
	});
});
