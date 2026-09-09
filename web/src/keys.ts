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

export const KN_LMOUSE = 0x01;
export const KN_RETURN = 0x0d;
export const KN_ESC = 0x1b;
export const KN_BACKSPACE = 0x08;
export const KN_SHIFT_BIT = 0x100;
export const KN_CTRL_BIT = 0x200;
export const KN_ALT_BIT = 0x400;

export function key_from_event(event: KeyboardEvent): number {
	let modifiers = 0;
	if (event.shiftKey) {
		modifiers |= KN_SHIFT_BIT;
	}
	if (event.ctrlKey) {
		modifiers |= KN_CTRL_BIT;
	}
	if (event.altKey) {
		modifiers |= KN_ALT_BIT;
	}

	if (event.key === "Escape") {
		return modifiers | KN_ESC;
	}
	if (event.key === "Enter") {
		return modifiers | KN_RETURN;
	}
	if (event.key === "Backspace") {
		return modifiers | KN_BACKSPACE;
	}
	if (event.key.length === 1) {
		const code = event.key.charCodeAt(0);
		if (code >= 97 && code <= 122) {
			return modifiers | (code - 32);
		}
		return modifiers | code;
	}
	return 0;
}

export function key_from_description(list: string): number {
	let lst = list.trim();
	let modifiers = 0;
	const lower = lst.toLowerCase();
	if (lower.startsWith("ctrl-")) {
		modifiers |= KN_CTRL_BIT;
		lst = lst.slice(5);
	}
	if (lst.toLowerCase().startsWith("alt-")) {
		modifiers |= KN_ALT_BIT;
		lst = lst.slice(4);
	}
	if (lst.toLowerCase().startsWith("shift-")) {
		modifiers |= KN_SHIFT_BIT;
		lst = lst.slice(6);
	}

	if (lst.length === 0) {
		return 0;
	}
	if (lst.length === 1) {
		const ch = lst.charCodeAt(0);
		const key = ch >= 97 && ch <= 122 ? ch - 32 : ch;
		return modifiers | key;
	}
	if (lst.toUpperCase() === "ESC") {
		return modifiers | KN_ESC;
	}
	if (lst.toUpperCase() === "BACKSPACE") {
		return modifiers | KN_BACKSPACE;
	}
	return 0;
}
