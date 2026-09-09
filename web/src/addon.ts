/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import { cc_available } from "./ccfile";
import type { GameDirectory } from "./files";

export const ADDON_BASE_GAME = 0;
export const ADDON_FIRESTORM = 1;
export const ADDON_COUNT = 2;
export const ADDON_ANY = -1;

let available = 1 << ADDON_BASE_GAME;
let active = 1 << ADDON_BASE_GAME;
let required = ADDON_BASE_GAME;

export function Detect_Addons(directory: GameDirectory): void {
	available = 1 << ADDON_BASE_GAME;
	active = 1 << ADDON_BASE_GAME;
	if (cc_available(directory, "FIRESTRM.INI")) {
		available |= 1 << ADDON_FIRESTORM;
	}
}

export function Addon_Installed(addon: number): boolean {
	if (addon === ADDON_ANY) {
		return (available & ~(1 << ADDON_BASE_GAME)) !== 0;
	}
	return (available & (1 << addon)) !== 0;
}

export function Enable_Addon(addon: number): void {
	if (addon === ADDON_ANY) {
		active = available;
		return;
	}
	if ((available & (1 << addon)) !== 0) {
		active |= 1 << addon;
	}
}

export function Addon_Enabled(addon: number): boolean {
	if (addon === ADDON_ANY) {
		return (active & available & ~(1 << ADDON_BASE_GAME)) !== 0;
	}
	return (active & available & (1 << addon)) !== 0;
}

export function Disable_Addon(addon: number): void {
	if (addon === ADDON_ANY) {
		active = 1 << ADDON_BASE_GAME;
		return;
	}
	active &= ~(1 << addon);
}

export function Set_Required_Addon(addon: number): void {
	required = addon;
}

export function Get_Required_Addon(): number {
	return required;
}
