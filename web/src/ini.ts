/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 * EA's GPLv3 Section 7 additional terms and supplemental warranty
 * disclaimers apply; see LICENSE.md.
 ******************************************************************************/

export type Point2D = {
	x: number;
	y: number;
};

export type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

const BAD = 0xfe;
const END = 0xff;
const DECODER = new Uint8Array(256);

for (let i = 0; i < 256; i++) {
	DECODER[i] = BAD;
}
for (let i = 0; i < 26; i++) {
	DECODER[65 + i] = i;
	DECODER[97 + i] = 26 + i;
}
for (let i = 0; i < 10; i++) {
	DECODER[48 + i] = 52 + i;
}
DECODER[43] = 62;
DECODER[47] = 63;
DECODER[61] = END;

export function base64_decode(source: string): Uint8Array {
	const out: number[] = [];
	let i = 0;
	while (i < source.length) {
		const codes = [0, 0, 0, 0];
		let pcount = 0;
		while (pcount < 4 && i < source.length) {
			const code = DECODER[source.charCodeAt(i++) & 0xff]!;
			if (code === BAD) {
				continue;
			}
			if (code === END) {
				i = source.length;
				break;
			}
			codes[pcount++] = code;
		}
		if (pcount === 0) {
			break;
		}
		const c1 = ((codes[0]! << 2) | (codes[1]! >> 4)) & 0xff;
		out.push(c1);
		if (pcount > 2) {
			out.push(((codes[1]! << 4) | (codes[2]! >> 2)) & 0xff);
		}
		if (pcount > 3) {
			out.push(((codes[2]! << 6) | codes[3]!) & 0xff);
		}
	}
	return Uint8Array.from(out);
}

function decode_ini_bytes(bytes: Uint8Array): string {
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return new TextDecoder("utf-8").decode(bytes.subarray(3));
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder("windows-1252").decode(bytes);
	}
}

function trim_text(text: string): string {
	return text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function strip_comments(line: string): string {
	const comment = line.indexOf(";");
	if (comment < 0) {
		return line;
	}
	return trim_text(line.slice(0, comment));
}

function is_a_section(line: string): boolean {
	let i = 0;
	while (i < line.length && line.charCodeAt(i) <= 32) {
		i++;
	}
	return line.charAt(i) === "[" && line.indexOf("]", i) >= 0;
}

function parse_int_token(value: string): number {
	if (value.startsWith("$")) {
		return Number.parseInt(value.slice(1), 16) | 0;
	}
	if (value.length > 0 && value[value.length - 1]!.toLowerCase() === "h") {
		return Number.parseInt(value.slice(0, -1), 16) | 0;
	}
	return Number.parseInt(value, 10) | 0;
}

export class INIClass {
	private readonly sections = new Map<string, Map<string, string>>();

	load(bytes: Uint8Array, merge = false): boolean {
		return this.load_text(decode_ini_bytes(bytes), merge);
	}

	load_text(text: string, merge = false): boolean {
		if (!merge) {
			this.sections.clear();
		}
		let current: Map<string, string> | null = null;
		let current_name = "";
		let saw_section = false;

		for (const raw of text.split(/\n/)) {
			const line = raw.replace(/\r$/, "");
			if (is_a_section(line)) {
				const trimmed = trim_text(line);
				const close = trimmed.indexOf("]");
				current_name = trimmed.slice(1, close);
				saw_section = true;
				current = this.sections.get(current_name) ?? null;
				continue;
			}

			if (!saw_section) {
				continue;
			}

			const stripped = strip_comments(line);
			if (stripped.length === 0 || stripped.charAt(0) === ";" || stripped.charAt(0) === "=") {
				continue;
			}

			const divider = stripped.indexOf("=");
			if (divider < 0) {
				continue;
			}

			const entry = trim_text(stripped.slice(0, divider));
			const value = trim_text(stripped.slice(divider + 1));
			if (entry.length === 0 || value.length === 0) {
				continue;
			}

			if (!current) {
				current = new Map();
				this.sections.set(current_name, current);
			}
			current.set(entry, value);
		}

		return saw_section;
	}

	is_present(section: string, entry?: string): boolean {
		if (entry === undefined) {
			return this.sections.has(section);
		}
		return this.sections.get(section)?.has(entry) === true;
	}

	get_string(section: string, entry: string, defvalue = ""): string {
		const found = this.sections.get(section)?.get(entry);
		return found !== undefined ? found : defvalue;
	}

	get_int(section: string, entry: string, defvalue = 0): number {
		const found = this.sections.get(section)?.get(entry);
		if (found === undefined) {
			return defvalue;
		}
		return parse_int_token(found);
	}

	get_float(section: string, entry: string, defvalue = 0): number {
		const found = this.sections.get(section)?.get(entry);
		if (found === undefined) {
			return defvalue;
		}
		const value = Number.parseFloat(found);
		if (!Number.isFinite(value)) {
			return defvalue;
		}
		return found.includes("%") ? value / 100 : value;
	}

	get_lepton(section: string, entry: string, defvalue = 0): number {
		const found = this.sections.get(section)?.get(entry);
		if (found === undefined) {
			return defvalue;
		}
		const value = Number.parseFloat(found);
		if (!Number.isFinite(value)) {
			return defvalue;
		}
		return Math.trunc(value * 256);
	}

	get_point(section: string, entry: string, defvalue: Point2D): Point2D {
		const values = this.read_numbers(section, entry, 2);
		if (!values) {
			return { ...defvalue };
		}
		return { x: values[0]!, y: values[1]! };
	}

	get_rect(section: string, entry: string, defvalue: Rect): Rect {
		const values = this.read_numbers(section, entry, 4);
		if (!values) {
			return { ...defvalue };
		}
		return { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! };
	}

	entry_count(section: string): number {
		return this.sections.get(section)?.size ?? 0;
	}

	get_entry(section: string, index: number): string {
		const map = this.sections.get(section);
		if (!map || index < 0 || index >= map.size) {
			return "";
		}
		return Array.from(map.keys())[index] ?? "";
	}

	get_bool(section: string, entry: string, defvalue = false): boolean {
		const found = this.sections.get(section)?.get(entry);
		if (found === undefined || found.length === 0) {
			return defvalue;
		}
		switch (found.charAt(0).toUpperCase()) {
			case "Y":
			case "T":
			case "1":
				return true;
			case "N":
			case "F":
			case "0":
				return false;
			default:
				return defvalue;
		}
	}

	get_uublock(section: string): Uint8Array {
		const count = this.entry_count(section);
		let text = "";
		for (let i = 0; i < count; i++) {
			text += this.get_string(section, this.get_entry(section, i));
		}
		return base64_decode(text);
	}

	private read_numbers(section: string, entry: string, count: number): number[] | null {
		const found = this.sections.get(section)?.get(entry);
		if (found === undefined) {
			return null;
		}
		const parts = found.split(",");
		if (parts.length < count) {
			return null;
		}
		const values: number[] = [];
		for (let i = 0; i < count; i++) {
			const token = trim_text(parts[i]!);
			if (token.length === 0) {
				return null;
			}
			values.push(Number.parseInt(token, 10) | 0);
		}
		return values;
	}
}
