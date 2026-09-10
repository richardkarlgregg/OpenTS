/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 * EA's GPLv3 Section 7 additional terms and warranty disclaimers apply; see LICENSE.md.
 ******************************************************************************/

export const POWER_X = 8;
export const POWER_Y = 25;
export const POWER_PIP_HEIGHT = 4;
export const POWER_PIP_EMPTY = 0;
export const POWER_PIP_GREEN = 1;
export const POWER_PIP_YELLOW = 2;
export const POWER_PIP_RED = 3;
const OBJECT_HEIGHT = 51;

export type PowerPips = {
	empty: number;
	green: number;
	yellow: number;
	red: number;
};

export function Max_Power_Height(max_visible: number): number {
	return ((OBJECT_HEIGHT * max_visible) / POWER_PIP_HEIGHT) | 0;
}

export function Desired_Power_Height(output: number, drain: number, max_visible: number): number {
	const max_pips = Max_Power_Height(max_visible);
	let empty = (400 / (drain + output + 400)) * max_pips;
	empty = Math.max(empty, 0);
	empty = Math.min(empty, max_pips - 1);
	return max_pips - (empty | 0);
}

export function Desired_Levels(output: number, drain: number, max_visible: number): PowerPips {
	const max_pips = Max_Power_Height(max_visible);
	const desired = Desired_Power_Height(output, drain, max_visible);
	const delta = output - drain;
	let yellow_power = 100;
	let green_power = 0;
	if (delta < 0) {
		yellow_power = 0;
		green_power = 0;
	} else if (delta < 100) {
		yellow_power = delta;
		green_power = 0;
	} else {
		green_power = delta - yellow_power;
	}
	const total = drain + yellow_power + green_power;
	let red_fraction = 1;
	let green_fraction = 0;
	let yellow_fraction = 0;
	if (total > 0) {
		red_fraction = drain / total;
		green_fraction = green_power / total;
		yellow_fraction = yellow_power / total;
	}
	let red = (desired * red_fraction) | 0;
	let yellow = (desired * yellow_fraction) | 0;
	let green = (desired * green_fraction) | 0;
	red +=
		((desired * green_fraction - green) + (desired * yellow_fraction - yellow) + (desired * red_fraction - red) + 0.01) | 0;
	const used = Math.max(0, green + yellow + red);
	return {
		empty: Math.max(0, max_pips - used),
		green,
		yellow,
		red,
	};
}
