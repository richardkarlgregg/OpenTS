/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import language_h from "../../code/language/language.h?raw";
import language_rc from "../../code/language/language.rc?raw";

export const TXT_NONE = 0;
export const TXT_COPYRIGHT = 1;
export const TXT_READY = 6;
export const TXT_HOLD = 7;
export const TXT_OK = 10;
export const TXT_TAB_BUTTON_CONTROLS = 129;
export const TXT_EASY = 148;
export const TXT_NORMAL = 149;
export const TXT_HARD = 150;
export const TXT_MEDIUM = 158;
export const TXT_DIFFICULTY_LEVEL = 1117;
export const TXT_LOADING_GAME1A = 818;
export const TXT_LOADING_GAME1C = 819;
export const TXT_LOADING_GAME1D = 820;
export const TXT_LOADING_GAME1E = 821;
export const TXT_LOADING_GAME1F = 822;
export const TXT_LOADING_GAME1G = 823;
export const TXT_LOADING_GAME1H = 824;
export const TXT_LOADING_GAME1B = 848;

export type DialogControlKind = "button" | "list" | "slider" | "static";

export type DialogControl = {
	caption: string;
	id: number;
	x: number;
	y: number;
	width: number;
	height: number;
	kind: DialogControlKind;
	align: "left" | "center" | "right";
};

export type DialogTemplate = {
	name: string;
	id: number;
	x: number;
	y: number;
	width: number;
	height: number;
	controls: DialogControl[];
};

const names = parse_defines(language_h);
const strings = parse_string_tables(language_rc, names);
const dialogs = parse_dialogs(language_rc, names);
const dialogs_by_id = new Map<number, DialogTemplate>();
for (const dialog of dialogs) {
	dialogs_by_id.set(dialog.id, dialog);
}

export function language_stats(): { strings: number; dialogs: number } {
	return { strings: strings.size, dialogs: dialogs.length };
}

export function Fetch_String(id: number): string {
	if (id === -1 || id === TXT_NONE) {
		return "";
	}
	return strings.get(id) ?? "";
}

export function Fetch_Dialog(id: number): DialogTemplate | null {
	return dialogs_by_id.get(id) ?? null;
}

export function dialog_name_id(name: string): number {
	return names.get(name) ?? -1;
}

export function map_dialog_rect(x: number, y: number, width: number, height: number): DialogControl {
	return {
		caption: "",
		id: 0,
		x: Math.round((x * 6) / 4),
		y: Math.round((y * 13) / 8),
		width: Math.round((width * 6) / 4),
		height: Math.round((height * 13) / 8),
		kind: "button",
		align: "center",
	};
}

function parse_defines(text: string): Map<string, number> {
	const out = new Map<string, number>();
	const re = /^#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(-?\d+)\b/gm;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		out.set(match[1]!, Number.parseInt(match[2]!, 10));
	}
	if (!out.has("IDOK")) {
		out.set("IDOK", 1);
	}
	if (!out.has("IDCANCEL")) {
		out.set("IDCANCEL", 2);
	}
	return out;
}

function unescape_rc_string(text: string): string {
	return text.replaceAll('""', '"');
}

function parse_string_tables(text: string, defines: Map<string, number>): Map<number, string> {
	const out = new Map<number, string>();
	const blocks = text.split(/STRINGTABLE\b/i);
	for (let i = 1; i < blocks.length; i++) {
		const block = blocks[i]!;
		const begin = block.search(/\bBEGIN\b/);
		const end = block.search(/\bEND\b/);
		if (begin < 0 || end < 0 || end <= begin) {
			continue;
		}
		const body = block.slice(begin + 5, end);
		let pending_id: number | null = null;
		let pending = "";
		const flush = (): void => {
			if (pending_id !== null) {
				out.set(pending_id, pending);
			}
			pending_id = null;
			pending = "";
		};

		for (const raw of body.split(/\n/)) {
			const line = raw.replace(/\r$/, "");
			const named = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+"(.*)"\s*$/.exec(line);
			if (named) {
				flush();
				const id = defines.get(named[1]!);
				if (id === undefined) {
					continue;
				}
				pending_id = id;
				pending = unescape_rc_string(named[2]!);
				continue;
			}
			const cont = /^\s+"(.*)"\s*$/.exec(line);
			if (cont && pending_id !== null) {
				pending += unescape_rc_string(cont[1]!);
			}
		}
		flush();
	}
	return out;
}

function parse_dialogs(text: string, defines: Map<string, number>): DialogTemplate[] {
	const out: DialogTemplate[] = [];
	const header =
		/^([A-Za-z_][A-Za-z0-9_]*)\s+DIALOG(?:EX)?(?:\s+DISCARDABLE)?\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gm;
	let match: RegExpExecArray | null;
	while ((match = header.exec(text)) !== null) {
		const name = match[1]!;
		const start = match.index + match[0].length;
		const begin = text.indexOf("BEGIN", start);
		const end = text.indexOf("\nEND", begin);
		if (begin < 0 || end < 0) {
			continue;
		}
		const body = text.slice(begin + 5, end);
		out.push({
			name,
			id: defines.get(name) ?? -1,
			x: Number.parseInt(match[2]!, 10),
			y: Number.parseInt(match[3]!, 10),
			width: Number.parseInt(match[4]!, 10),
			height: Number.parseInt(match[5]!, 10),
			controls: parse_controls(body, defines),
		});
	}
	return out;
}

function resolve_control_id(token: string, defines: Map<string, number>): number {
	if (/^-?\d+$/.test(token)) {
		return Number.parseInt(token, 10);
	}
	return defines.get(token) ?? -1;
}

function control_kind(class_name: string): DialogControlKind {
	const lower = class_name.toLowerCase();
	if (lower === "static") {
		return "static";
	}
	if (lower === "msctls_trackbar32") {
		return "slider";
	}
	if (lower.includes("listbox")) {
		return "list";
	}
	return "button";
}

function push_control(
	controls: DialogControl[],
	caption: string,
	id: number,
	x: string,
	y: string,
	width: string,
	height: string,
	kind: DialogControlKind,
	align: DialogControl["align"],
): void {
	controls.push({
		caption,
		id,
		x: Number.parseInt(x, 10),
		y: Number.parseInt(y, 10),
		width: Number.parseInt(width, 10),
		height: Number.parseInt(height, 10),
		kind,
		align,
	});
}

function parse_controls(body: string, defines: Map<string, number>): DialogControl[] {
	const joined = body.replace(/,\s*\r?\n\s*/g, ", ");
	const controls: DialogControl[] = [];
	let match: RegExpExecArray | null;
	const control_re =
		/CONTROL\s+"((?:[^"]|"")*)"\s*,\s*(-?\d+|[A-Za-z_][A-Za-z0-9_]*)\s*,\s*"([^"]*)"\s*,\s*[^,]+,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
	while ((match = control_re.exec(joined)) !== null) {
		push_control(
			controls,
			unescape_rc_string(match[1]!),
			resolve_control_id(match[2]!, defines),
			match[4]!,
			match[5]!,
			match[6]!,
			match[7]!,
			control_kind(match[3]!),
			match[3]!.toLowerCase() === "static" ? "left" : "center",
		);
	}
	const ctext_re =
		/CTEXT\s+"((?:[^"]|"")*)"\s*,\s*(-?\d+|[A-Za-z_][A-Za-z0-9_]*)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
	while ((match = ctext_re.exec(joined)) !== null) {
		push_control(
			controls,
			unescape_rc_string(match[1]!),
			resolve_control_id(match[2]!, defines),
			match[3]!,
			match[4]!,
			match[5]!,
			match[6]!,
			"static",
			"center",
		);
	}
	const rtext_re =
		/RTEXT\s+"((?:[^"]|"")*)"\s*,\s*(-?\d+|[A-Za-z_][A-Za-z0-9_]*)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
	while ((match = rtext_re.exec(joined)) !== null) {
		push_control(
			controls,
			unescape_rc_string(match[1]!),
			resolve_control_id(match[2]!, defines),
			match[3]!,
			match[4]!,
			match[5]!,
			match[6]!,
			"static",
			"right",
		);
	}
	const ltext_re =
		/LTEXT\s+"((?:[^"]|"")*)"\s*,\s*(-?\d+|[A-Za-z_][A-Za-z0-9_]*)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
	while ((match = ltext_re.exec(joined)) !== null) {
		push_control(
			controls,
			unescape_rc_string(match[1]!),
			resolve_control_id(match[2]!, defines),
			match[3]!,
			match[4]!,
			match[5]!,
			match[6]!,
			"static",
			"left",
		);
	}
	const list_re =
		/LISTBOX\s+(-?\d+|[A-Za-z_][A-Za-z0-9_]*)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
	while ((match = list_re.exec(joined)) !== null) {
		push_control(controls, "", resolve_control_id(match[1]!, defines), match[2]!, match[3]!, match[4]!, match[5]!, "list", "left");
	}
	return controls;
}
