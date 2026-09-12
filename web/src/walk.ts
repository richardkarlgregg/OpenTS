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
import { graph_cell, tube_at, type PathGraph } from "./zone";
import { PATH_NONE } from "./waypoint";

export const CELL_LEPTON = 256;
export const FACING_COUNT = 8;
export const FACING_NONE = -1;
export const TUNNEL = FACING_COUNT;
export const CLOSE_ENOUGH = 17;
export const WALK_RATE = 3;
export const MPH_LIGHT_SPEED = 255;
export const BRIDGE_CELL_HEIGHT = 4;
export const RAMP_NONE = 0;

export const LAND_CLEAR = 0;
export const LAND_ROAD = 1;
export const LAND_WATER = 2;
export const LAND_ROCK = 3;
export const LAND_WALL = 4;
export const LAND_TIBERIUM = 5;
export const LAND_BEACH = 6;
export const LAND_ROUGH = 7;
export const LAND_ICE = 8;
export const LAND_RAILROAD = 9;
export const LAND_TUNNEL = 10;
export const LAND_WEEDS = 11;
export const LAND_COUNT = 12;

export const SPEED_FOOT = 0;
export const SPEED_TRACK = 1;
export const SPEED_WHEEL = 2;
export const SPEED_HOVER = 3;
export const SPEED_WINGED = 4;
export const SPEED_FLOAT = 5;
export const SPEED_AMPHIBIOUS = 6;
export const SPEED_CREEP = 7;
export const SPEED_COUNT = 8;

export const LAND_NAMES = [
	"Clear",
	"Road",
	"Water",
	"Rock",
	"Wall",
	"Tiberium",
	"Beach",
	"Rough",
	"Ice",
	"Railroad",
	"Tunnel",
	"Weeds",
] as const;

export const SPEED_NAMES = ["Foot", "Track", "Wheel", "Hover", "Winged", "Float", "Amphibious", "Creep"] as const;

export type { PathEnter };

export type CellTerrain = {
	height: number;
	ramp: number;
	land: number;
	tile: number;
	subtile: number;
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
	walked: number;
	timer: number;
	max_speed: number;
	height_agl: number;
	current_path: number;
	next_waypoint: number;
	waypoint_target: Point2D | null;
	track_number: number;
	track_index: number;
	speed_accum: number;
	is_driving: boolean;
	is_on_short_track: boolean;
	target_speed: number;
	speed: number;
	desired_body: number;
	start_body: number;
	rot_body: number;
	rotation_timer: number;
	is_taking_off: boolean;
	is_landing: boolean;
	commenced_landing: boolean;
	flight_level: number;
	left_map: boolean;
	is_drop_pod: boolean;
	drop_pod_dir: number;
	drop_pod_dest: Point2D | null;
	is_on_bridge: boolean;
};

export type ClaimHead = (cell: Point2D) => Point2D | null;

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

export function Make_Foot(cell: Point2D, max_speed: number, rot = 0): FootState {
	const at = Cell_Center(cell);
	return {
		lx: at.x,
		ly: at.y,
		dest: null,
		head: null,
		path: [],
		moving: false,
		stage: 0,
		walked: 0,
		timer: WALK_RATE,
		max_speed: Math.max(1, max_speed),
		height_agl: 0,
		current_path: PATH_NONE,
		next_waypoint: 0,
		waypoint_target: null,
		track_number: -1,
		track_index: -1,
		speed_accum: 0,
		is_driving: false,
		is_on_short_track: false,
		target_speed: 0,
		speed: 0,
		desired_body: 0,
		start_body: 0,
		rot_body: rot > 0 ? ((Math.min(rot, 127) << 8) << 16) >> 16 : 0,
		rotation_timer: 0,
		is_taking_off: false,
		is_landing: false,
		commenced_landing: false,
		flight_level: 0,
		left_map: false,
		is_drop_pod: false,
		drop_pod_dir: 0,
		drop_pod_dest: null,
		is_on_bridge: false,
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

export function Update_On_Bridge(
	foot: FootState,
	old_cell: Point2D,
	new_cell: Point2D,
	terrain: Map<string, CellTerrain>,
	graph: PathGraph | null,
): void {
	const old_height = terrain_of(terrain, old_cell).height;
	const new_height = terrain_of(terrain, new_cell).height;
	const old_under = graph ? (graph_cell(graph, old_cell)?.under_bridge ?? false) : false;
	const new_under = graph ? (graph_cell(graph, new_cell)?.under_bridge ?? false) : false;
	if (new_height === old_height - BRIDGE_CELL_HEIGHT && new_under) {
		foot.is_on_bridge = true;
	}
	if (!new_under && old_under) {
		foot.is_on_bridge = false;
	}
}

export function Apply_Coord(foot: FootState): { x: number; y: number; ox: number; oy: number } {
	const cell = Coord_Cell(foot.lx, foot.ly);
	const offset = lepton_offset(foot.lx, foot.ly);
	return { x: cell.x, y: cell.y, ox: offset.ox, oy: offset.oy };
}

export function terrain_of(terrain: Map<string, CellTerrain>, cell: Point2D): CellTerrain {
	return terrain.get(`${cell.x},${cell.y}`) ?? { height: 0, ramp: RAMP_NONE, land: LAND_CLEAR, tile: 0, subtile: 0 };
}

export function Can_Reach(
	from: Point2D,
	to: Point2D,
	terrain: Map<string, CellTerrain>,
	graph: PathGraph | null = null,
): boolean {
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
			if (graph) {
				const from_cell = graph_cell(graph, from);
				const to_cell = graph_cell(graph, to);
				if (from_cell?.under_bridge && to_cell?.under_bridge && to_cell.bridge_traversable) {
					return true;
				}
				if (!from_cell?.under_bridge && to_cell?.under_bridge && to_cell.bridge_traversable) {
					return true;
				}
				if (from_cell?.under_bridge && from_cell.bridge_traversable && !to_cell?.under_bridge) {
					return true;
				}
			}
			return false;
		default:
			return false;
	}
}

export function Find_Path(
	from: Point2D,
	to: Point2D,
	can_enter: PathEnter,
	maxlen = 200,
	graph: PathGraph | null = null,
	avoid = 0,
): number[] {
	return Find_Path_Regular(from, to, can_enter, maxlen, graph, avoid);
}

export function Assign_Destination(foot: FootState, cell: Point2D | null): void {
	const same = !!cell && !!foot.dest && foot.dest.x === cell.x && foot.dest.y === cell.y;
	foot.dest = cell ? { ...cell } : null;
	foot.path = [];
	foot.head = null;
	foot.moving = cell !== null;
	foot.track_number = -1;
	foot.track_index = -1;
	foot.speed_accum = 0;
	foot.is_driving = false;
	foot.is_on_short_track = false;
	if (foot.height_agl <= 0) {
		foot.target_speed = 0;
		foot.speed = 0;
	}
	if (cell && !same) {
		foot.is_landing = false;
		foot.left_map = false;
	}
}

export function Movement_AI(
	foot: FootState,
	can_enter: PathEnter,
	try_gate?: (cell: Point2D) => boolean,
	can_path?: PathEnter,
	graph: PathGraph | null = null,
	avoid = 0,
	claim_head?: ClaimHead,
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
			if (claim_head) {
				const claimed = claim_head(foot.dest);
				if (claimed && (claimed.x !== foot.lx || claimed.y !== foot.ly)) {
					foot.head = claimed;
					return true;
				}
				if (!claimed) {
					return false;
				}
			}
			foot.dest = null;
			foot.moving = false;
			foot.path = [];
			return true;
		}
		const walkable = can_path ?? can_enter;
		if (foot.path.length === 0) {
			foot.path = Find_Path(here, foot.dest, walkable, 200, graph, avoid);
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
		if (dir === TUNNEL && graph) {
			const tube = tube_at(graph, here);
			if (!tube) {
				foot.path = Find_Path(here, foot.dest, walkable, 200, graph, avoid);
				return false;
			}
			const exit = tube.exit;
			if (!can_enter(here, exit, dir)) {
				foot.path = Find_Path(here, foot.dest, walkable, 200, graph, avoid);
				return false;
			}
			const claimed = claim_head ? claim_head(exit) : Cell_Center(exit);
			if (!claimed) {
				return false;
			}
			foot.head = claimed;
			return true;
		}
		const next = Adjacent_Cell(here, dir);
		if (!can_enter(here, next, dir)) {
			if (try_gate?.(next)) {
				return false;
			}
			if (foot.dest.x === next.x && foot.dest.y === next.y) {
				return false;
			}
			foot.path = Find_Path(here, foot.dest, walkable, 200, graph, avoid);
			return false;
		}
		const claimed = claim_head ? claim_head(next) : Cell_Center(next);
		if (!claimed) {
			if (foot.dest.x === next.x && foot.dest.y === next.y) {
				return false;
			}
			foot.path = Find_Path(here, foot.dest, walkable, 200, graph, avoid);
			return false;
		}
		foot.head = claimed;
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

