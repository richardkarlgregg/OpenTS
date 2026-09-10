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

import { Find_Path_Regular, type PathEnter } from "./astar";
import type { Point2D } from "./ini";
import { ISO_TILE_PIXEL_H, ISO_TILE_PIXEL_W } from "./isotile";

export const CELL_LEPTON = 256;
export const FACING_COUNT = 8;
export const FACING_NONE = 8;
export const CLOSE_ENOUGH = 17;
export const WALK_RATE = 3;
export const MPH_LIGHT_SPEED = 255;
export const BRIDGE_CELL_HEIGHT = 4;
export const RAMP_NONE = 0;

export type { PathEnter };

export type CellTerrain = {
	height: number;
	ramp: number;
};

export const ADJACENT_CELL: readonly [number, number][] = [
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
];

export type FootState = {
	lx: number;
	ly: number;
	dest: Point2D | null;
	head: Point2D | null;
	path: number[];
	moving: boolean;
	stage: number;
	timer: number;
	max_speed: number;
};

export function Scale_To_256(val: number): number {
	const speed = ((val * (MPH_LIGHT_SPEED + 1)) / 100) | 0;
	return speed > MPH_LIGHT_SPEED ? MPH_LIGHT_SPEED : speed;
}

export function Cell_Center(cell: Point2D): Point2D {
	return { x: cell.x * CELL_LEPTON + CELL_LEPTON / 2, y: cell.y * CELL_LEPTON + CELL_LEPTON / 2 };
}

export function Coord_Cell(lx: number, ly: number): Point2D {
	return { x: Math.trunc(lx / CELL_LEPTON), y: Math.trunc(ly / CELL_LEPTON) };
}

export function Adjacent_Cell(cell: Point2D, dir: number): Point2D {
	const delta = ADJACENT_CELL[dir & 7];
	if (!delta) {
		return { ...cell };
	}
	return { x: cell.x + delta[0], y: cell.y + delta[1] };
}

export function Direction_Facing(from: Point2D, to: Point2D): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (dx === 0 && dy === 0) {
		return 0;
	}
	let best = 0;
	let best_dot = -1e12;
	for (let dir = 0; dir < FACING_COUNT; dir++) {
		const delta = ADJACENT_CELL[dir]!;
		const dot = dx * delta[0] * CELL_LEPTON + dy * delta[1] * CELL_LEPTON;
		if (dot > best_dot) {
			best_dot = dot;
			best = dir;
		}
	}
	return best;
}

export function Facing_Dir256(dir: number): number {
	return ((dir & 7) * 32) & 255;
}

export function Make_Foot(cell: Point2D, max_speed: number): FootState {
	const at = Cell_Center(cell);
	return {
		lx: at.x,
		ly: at.y,
		dest: null,
		head: null,
		path: [],
		moving: false,
		stage: 0,
		timer: WALK_RATE,
		max_speed: Math.max(1, max_speed),
	};
}

export function lepton_offset(lx: number, ly: number): { ox: number; oy: number } {
	const dx = (lx & (CELL_LEPTON - 1)) - CELL_LEPTON / 2;
	const dy = (ly & (CELL_LEPTON - 1)) - CELL_LEPTON / 2;
	return {
		ox: Math.trunc((dx * (ISO_TILE_PIXEL_W >> 1) - dy * (ISO_TILE_PIXEL_W >> 1)) / CELL_LEPTON),
		oy: Math.trunc((dx * (ISO_TILE_PIXEL_H >> 1) + dy * (ISO_TILE_PIXEL_H >> 1)) / CELL_LEPTON),
	};
}

export function Apply_Coord(foot: FootState): { x: number; y: number; ox: number; oy: number } {
	const cell = Coord_Cell(foot.lx, foot.ly);
	const offset = lepton_offset(foot.lx, foot.ly);
	return { x: cell.x, y: cell.y, ox: offset.ox, oy: offset.oy };
}

export function terrain_of(terrain: Map<string, CellTerrain>, cell: Point2D): CellTerrain {
	return terrain.get(`${cell.x},${cell.y}`) ?? { height: 0, ramp: RAMP_NONE };
}

export function Can_Reach(from: Point2D, to: Point2D, terrain: Map<string, CellTerrain>): boolean {
	const adjacent = terrain_of(terrain, from);
	const current = terrain_of(terrain, to);
	const height_difference = adjacent.height;
	const current_height = current.height;
	switch (Math.abs(height_difference - current_height)) {
		case 0:
			return true;
		case 1:
			if (height_difference - current_height > 0) {
				return current.ramp !== RAMP_NONE;
			}
			return adjacent.ramp !== RAMP_NONE;
		case BRIDGE_CELL_HEIGHT:
			return false;
		default:
			return false;
	}
}

export function Find_Path(from: Point2D, to: Point2D, can_enter: PathEnter, maxlen = 200): number[] {
	return Find_Path_Regular(from, to, can_enter, maxlen);
}

export function Assign_Destination(foot: FootState, cell: Point2D | null): void {
	foot.dest = cell ? { ...cell } : null;
	foot.path = [];
	foot.head = null;
	foot.moving = cell !== null;
}

export function Movement_AI(
	foot: FootState,
	can_enter: PathEnter,
	try_gate?: (cell: Point2D) => boolean,
	can_path?: PathEnter,
): boolean {
	if (!foot.moving && !foot.head) {
		return false;
	}
	if (!foot.head) {
		if (!foot.dest) {
			foot.moving = false;
			return false;
		}
		const here = Coord_Cell(foot.lx, foot.ly);
		if (here.x === foot.dest.x && here.y === foot.dest.y) {
			const at = Cell_Center(foot.dest);
			foot.lx = at.x;
			foot.ly = at.y;
			foot.dest = null;
			foot.moving = false;
			foot.path = [];
			return true;
		}
		const walkable = can_path ?? can_enter;
		if (foot.path.length === 0) {
			foot.path = Find_Path(here, foot.dest, walkable);
			if (foot.path.length === 0) {
				foot.dest = null;
				foot.moving = false;
				return false;
			}
		}
		const dir = foot.path[0];
		if (dir === undefined || dir === FACING_NONE) {
			foot.path = [];
			foot.dest = null;
			foot.moving = false;
			return false;
		}
		const next = Adjacent_Cell(here, dir);
		if (!can_enter(here, next, dir)) {
			if (try_gate?.(next)) {
				return false;
			}
			foot.path = Find_Path(here, foot.dest, walkable);
			return false;
		}
		foot.head = Cell_Center(next);
		return true;
	}
	const dx = foot.head.x - foot.lx;
	const dy = foot.head.y - foot.ly;
	const dist = Math.hypot(dx, dy);
	if (dist < CLOSE_ENOUGH) {
		foot.lx = foot.head.x;
		foot.ly = foot.head.y;
		foot.head = null;
		foot.path.shift();
		if (foot.path.length === 0) {
			foot.dest = null;
			foot.moving = false;
		}
		return true;
	}
	const speed = Math.min(foot.max_speed, dist);
	foot.lx += (dx / dist) * speed;
	foot.ly += (dy / dist) * speed;
	if (foot.timer > 0) {
		foot.timer -= 1;
	}
	if (foot.timer === 0) {
		foot.stage += 1;
		foot.timer = WALK_RATE;
	}
	return true;
}
