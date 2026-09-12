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

import type { Point2D } from "./ini";
import { Coord_Cell, Cell_Center, type FootState } from "./walk";

export const DPOD_DIR_NE = 0;
export const DPOD_DIR_NW = 1;
export const DPOD_DIR_SE = 2;
export const DPOD_DIR_SW = 3;

const DIR_S = 128;
const DIR_CIRCLE = 65534;
const DIR_BIAS = 16383;
const MAP_CELL_W = 512;
const MAP_CELL_H = 512;
const DEG = Math.PI / 180;
const ANGLE_MIN = 22.5 * DEG;
const ANGLE_MAX = 67.5 * DEG;

export function Clamp_DropPod_Angle(angle: number): number {
	return Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, angle));
}

export function DropPod_Drawing_Code(foot: FootState): number {
	return foot.drop_pod_dir % 2;
}

export function DropPod_Move_To(
	foot: FootState,
	dest: Point2D,
	height: number,
	angle: number,
	in_radar: (x: number, y: number) => boolean,
): void {
	if (foot.is_drop_pod) {
		return;
	}
	const at = Cell_Center(dest);
	const radius = height / Math.tan(angle);
	const starts: { dir: number; x: number; y: number }[] = [
		{ dir: DPOD_DIR_NE, x: at.x + radius, y: at.y },
		{ dir: DPOD_DIR_NW, x: at.x - radius, y: at.y },
		{ dir: DPOD_DIR_SE, x: at.x, y: at.y + radius },
		{ dir: DPOD_DIR_SW, x: at.x, y: at.y - radius },
	];
	let chosen = starts[3]!;
	for (let i = 0; i < 3; i++) {
		const start = starts[i]!;
		const cell = Coord_Cell(start.x, start.y);
		if (in_radar(cell.x, cell.y)) {
			chosen = start;
			break;
		}
	}
	foot.is_drop_pod = true;
	foot.drop_pod_dir = chosen.dir;
	foot.drop_pod_dest = { ...at };
	foot.lx = chosen.x;
	foot.ly = chosen.y;
	foot.height_agl = height;
	foot.moving = true;
}

export function Coord_Scatter(from: Point2D, distance: number): Point2D {
	const body = ((Math.trunc(Math.random() * 256) & 255) << 8) << 16 >> 16;
	const rad = (body - DIR_BIAS) * -((Math.PI * 2) / DIR_CIRCLE);
	const next = { x: from.x + Math.cos(rad) * distance, y: from.y - Math.sin(rad) * distance };
	const cell = Coord_Cell(next.x, next.y);
	if (cell.x < 0 || cell.y < 0 || cell.x >= MAP_CELL_W || cell.y >= MAP_CELL_H) {
		return { ...from };
	}
	return next;
}

export function DropPod_AI(foot: FootState, speed_min: number, angle: number): "falling" | "landed" {
	if (!foot.is_drop_pod) {
		return "landed";
	}
	let speed = Math.trunc(foot.height_agl / 10) + 2;
	if (speed_min > speed) {
		speed = speed_min;
	}
	const horspeed = Math.cos(angle) * speed;
	switch (foot.drop_pod_dir) {
		case DPOD_DIR_NW:
			foot.lx += horspeed;
			break;
		case DPOD_DIR_SE:
			foot.ly -= horspeed;
			break;
		case DPOD_DIR_SW:
			foot.ly += horspeed;
			break;
		default:
			foot.lx -= horspeed;
			break;
	}
	foot.height_agl -= Math.sin(angle) * speed;
	if (foot.height_agl > 0) {
		return "falling";
	}
	foot.height_agl = 0;
	foot.is_drop_pod = false;
	foot.moving = false;
	return "landed";
}

export function DropPod_Facing(): number {
	return DIR_S;
}
