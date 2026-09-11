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

import { F_D, F_T, F_X, F_Y, RawTracks, TrackControl } from "./drive-tracks";
import type { Point2D } from "./ini";
import {
	Adjacent_Cell,
	CELL_LEPTON,
	Coord_Cell,
	FACING_COUNT,
	FACING_NONE,
	Find_Path,
	TUNNEL,
	type ClaimHead,
	type FootState,
	type PathEnter,
} from "./walk";
import type { PathGraph } from "./zone";

const PIXEL_LEPTON = (((CELL_LEPTON / 24) | 0) + ((CELL_LEPTON / 48) | 0)) >> 1;
const DIR_S = 128;
const DIR_W = 192;
const DIR_MAX = 255;

function as_i16(value: number): number {
	return (value << 16) >> 16;
}

function from_facing8(facing: number): number {
	return as_i16((facing & 7) << 13);
}

function from_dir256(dir: number): number {
	return as_i16((dir & 255) << 8);
}

export function Body_Dir256(foot: FootState): number {
	const raw = current_body(foot) & 0xffff;
	return ((((raw >>> 7) + 1) >>> 1) % 256);
}

function as_facing8(body: number): number {
	const raw = body & 0xffff;
	return (((((raw >>> 12) + 1) >>> 1)) % FACING_COUNT);
}

function dir_facing(dir256: number): number {
	return as_facing8(from_dir256(dir256));
}

function current_body(foot: FootState): number {
	if (foot.rot_body > 0 && foot.rotation_timer > 0) {
		const diff = as_i16(foot.desired_body - foot.start_body);
		const rot = Math.trunc(Math.abs(diff) / foot.rot_body);
		let facing = foot.desired_body;
		if (rot > 0) {
			facing = as_i16(facing - foot.rotation_timer * Math.trunc(diff / rot));
		}
		return facing;
	}
	return foot.desired_body;
}

function is_rotating(foot: FootState): boolean {
	return foot.rot_body > 0 && foot.rotation_timer > 0;
}

function set_desired(foot: FootState, body: number): void {
	if (foot.desired_body === body) {
		return;
	}
	foot.start_body = current_body(foot);
	foot.desired_body = body;
	if (foot.rot_body > 0) {
		foot.rotation_timer = Math.trunc(Math.abs(as_i16(foot.desired_body - foot.start_body)) / foot.rot_body);
	} else {
		foot.rotation_timer = 0;
	}
}

function set_body(foot: FootState, dir256: number): void {
	const body = from_dir256(dir256);
	foot.desired_body = body;
	foot.start_body = body;
	foot.rotation_timer = 0;
}

export function Set_Drive_Facing(foot: FootState, dir256: number): void {
	set_body(foot, dir256);
}

export function Set_Drive_ROT(foot: FootState, rate: number): void {
	foot.rot_body = from_dir256(Math.min(Math.max(0, rate), DIR_S - 1));
}

function adjacent_coord(lx: number, ly: number, dir: number): Point2D {
	const next = Adjacent_Cell(Coord_Cell(lx, ly), dir);
	return { x: lx + (next.x - Coord_Cell(lx, ly).x) * CELL_LEPTON, y: ly + (next.y - Coord_Cell(lx, ly).y) * CELL_LEPTON };
}

function stop_driver(foot: FootState): void {
	foot.head = null;
	foot.is_driving = false;
}

function start_driver(foot: FootState, head: Point2D): boolean {
	stop_driver(foot);
	foot.head = { ...head };
	foot.is_driving = true;
	foot.moving = true;
	return true;
}

function raw_track(foot: FootState) {
	const control = TrackControl[foot.track_number];
	if (!control) {
		return null;
	}
	const number = foot.is_on_short_track ? control.start_track : control.track;
	if (number <= 0) {
		return null;
	}
	return RawTracks[number - 1] ?? null;
}

function smooth_turn(foot: FootState, ox: number, oy: number, dir: number): { x: number; y: number; dir: number } {
	const flags = TrackControl[foot.track_number]?.flag ?? 0;
	let x = ox;
	let y = oy;
	let work = dir;
	if (flags & F_T) {
		const swap = x;
		x = y;
		y = swap;
		work = (DIR_W - work) & DIR_MAX;
	}
	if (flags & F_X) {
		x = -x;
		work = -work & DIR_MAX;
	}
	if (flags & F_Y) {
		y = -y;
		work = (DIR_S - work) & DIR_MAX;
	}
	const head = foot.head;
	return { x: (head?.x ?? foot.lx) + x, y: (head?.y ?? foot.ly) + y, dir: work };
}

function while_moving(
	foot: FootState,
	just_started: boolean,
	can_enter: PathEnter,
	try_gate: ((cell: Point2D) => boolean) | undefined,
	claim_head: ClaimHead | undefined,
): boolean {
	if ((!foot.is_driving || foot.track_number < 0) && foot.path[0] !== FACING_COUNT) {
		foot.speed_accum = 0;
		return false;
	}
	foot.speed = foot.target_speed;
	const maxspeed = Math.max(0, Math.trunc(foot.max_speed * foot.speed));
	let actual = foot.speed_accum + (just_started ? 0 : maxspeed);
	const nextface = foot.path[0] ?? FACING_NONE;
	if (actual <= PIXEL_LEPTON) {
		foot.speed_accum = actual;
		return foot.is_driving;
	}
	const raw = raw_track(foot);
	const control = TrackControl[foot.track_number];
	if (!raw || !control) {
		stop_driver(foot);
		foot.track_number = -1;
		foot.speed_accum = 0;
		return false;
	}
	const ptr = raw.track;
	let adj = nextface !== TUNNEL && nextface !== FACING_NONE && nextface !== undefined && dir_facing(control.facing) !== nextface;
	while (actual > PIXEL_LEPTON) {
		actual -= PIXEL_LEPTON;
		const step = ptr[foot.track_index];
		if (!step) {
			actual = 0;
			break;
		}
		if (step.ox !== 0 || step.oy !== 0 || foot.track_index === 0) {
			const turned = smooth_turn(foot, step.ox, step.oy, step.facing);
			foot.lx = turned.x;
			foot.ly = turned.y;
			set_body(foot, turned.dir);
			if (
				nextface !== TUNNEL &&
				nextface !== FACING_NONE &&
				nextface !== undefined &&
				adj &&
				raw.jump === foot.track_index &&
				foot.track_index
			) {
				const tnum = dir_facing(control.facing) * FACING_COUNT + nextface;
				const jumped = TrackControl[tnum];
				const jump_raw = jumped && jumped.track ? RawTracks[jumped.track - 1] : null;
				if (jump_raw && jump_raw.entry) {
					const here = Coord_Cell(foot.lx, foot.ly);
					const dest = Adjacent_Cell(Coord_Cell(foot.head?.x ?? foot.lx, foot.head?.y ?? foot.ly), nextface);
					if (can_enter(here, dest, nextface)) {
						const claimed = claim_head ? claim_head(dest) : {
							x: (foot.head?.x ?? foot.lx) + (dest.x - Coord_Cell(foot.head?.x ?? foot.lx, foot.head?.y ?? foot.ly).x) * CELL_LEPTON,
							y: (foot.head?.y ?? foot.ly) + (dest.y - Coord_Cell(foot.head?.x ?? foot.lx, foot.head?.y ?? foot.ly).y) * CELL_LEPTON,
						};
						if (claimed) {
							foot.is_on_short_track = false;
							foot.track_number = tnum;
							foot.track_index = jump_raw.entry - 1;
							adj = false;
							start_driver(foot, claimed);
							foot.path.shift();
						}
					} else {
						try_gate?.(dest);
					}
				}
			}
			foot.track_index += 1;
		} else {
			if (foot.head) {
				foot.lx = foot.head.x;
				foot.ly = foot.head.y;
			}
			stop_driver(foot);
			foot.track_number = -1;
			foot.track_index = 0;
			const here = Coord_Cell(foot.lx, foot.ly);
			if (foot.dest && here.x === foot.dest.x && here.y === foot.dest.y) {
				foot.dest = null;
				foot.moving = false;
				foot.path = [];
			}
			break;
		}
	}
	foot.speed_accum = actual;
	if (actual > 0 && foot.track_number > -1) {
		const follow = raw_track(foot);
		const step = follow?.track[foot.track_index];
		if (step && (step.ox !== 0 || step.oy !== 0 || foot.track_index === 0)) {
			const turned = smooth_turn(foot, step.ox, step.oy, step.facing);
			const mx = turned.x - foot.lx;
			const my = turned.y - foot.ly;
			const portion = actual / PIXEL_LEPTON;
			foot.lx += mx * portion;
			foot.ly += my * portion;
			set_body(foot, turned.dir);
		}
	}
	return true;
}

function start_of_move(
	foot: FootState,
	can_enter: PathEnter,
	can_path: PathEnter,
	try_gate: ((cell: Point2D) => boolean) | undefined,
	graph: PathGraph | null,
	avoid: number,
	claim_head: ClaimHead | undefined,
	force_straight: boolean,
): boolean {
	let facing = foot.path[0] ?? FACING_NONE;
	if (!foot.dest && (facing === FACING_NONE || facing === undefined)) {
		stop_driver(foot);
		foot.moving = false;
		return false;
	}
	if (!foot.dest) {
		return false;
	}
	if (facing === FACING_NONE || facing === undefined) {
		const here = Coord_Cell(foot.lx, foot.ly);
		if (here.x === foot.dest.x && here.y === foot.dest.y) {
			foot.dest = null;
			foot.moving = false;
			foot.path = [];
			stop_driver(foot);
			return false;
		}
		foot.path = Find_Path(here, foot.dest, can_path, 200, graph, avoid);
		facing = foot.path[0] ?? FACING_NONE;
		if (facing === FACING_NONE || facing === undefined || facing === TUNNEL) {
			return false;
		}
	}
	if (facing === TUNNEL) {
		return false;
	}
	if (as_i16(current_body(foot) - from_facing8(facing)) !== 0) {
		set_desired(foot, from_facing8(facing));
		return true;
	}
	const here = Coord_Cell(foot.lx, foot.ly);
	let dest = Adjacent_Cell(here, facing);
	if (!can_enter(here, dest, facing)) {
		if (try_gate?.(dest)) {
			return true;
		}
		if (foot.dest.x === dest.x && foot.dest.y === dest.y) {
			return false;
		}
		foot.path = Find_Path(here, foot.dest, can_path, 200, graph, avoid);
		return false;
	}
	let nextface = foot.path[1] ?? FACING_NONE;
	if (nextface === FACING_NONE || nextface === undefined || force_straight) {
		nextface = facing;
	}
	if (nextface === TUNNEL) {
		nextface = facing;
	}
	foot.is_on_short_track = false;
	foot.track_number = facing * FACING_COUNT + nextface;
	const picked = TrackControl[foot.track_number];
	if (!picked || picked.track === 0) {
		foot.track_number = facing * FACING_COUNT + facing;
	}
	const control = TrackControl[foot.track_number];
	if (!control || control.track === 0) {
		foot.track_number = -1;
		return false;
	}
	if (control.flag & F_D) {
		const mid = dest;
		dest = Adjacent_Cell(dest, nextface);
		if (!can_enter(mid, dest, nextface)) {
			if (try_gate?.(dest)) {
				return true;
			}
			return start_of_move(foot, can_enter, can_path, try_gate, graph, avoid, claim_head, true);
		}
		foot.path.splice(0, 2);
	} else {
		foot.path.shift();
	}
	const claimed = claim_head ? claim_head(dest) : adjacent_coord(foot.lx, foot.ly, facing);
	if (!claimed) {
		foot.track_number = -1;
		if (foot.dest.x === dest.x && foot.dest.y === dest.y) {
			return false;
		}
		foot.path = Find_Path(here, foot.dest, can_path, 200, graph, avoid);
		return false;
	}
	foot.track_index = 0;
	foot.target_speed = 1;
	foot.speed = 1;
	if (!start_driver(foot, claimed)) {
		foot.track_number = -1;
		foot.path = [];
		foot.speed = 0;
		return false;
	}
	return false;
}

export function Drive_AI(
	foot: FootState,
	can_enter: PathEnter,
	try_gate?: (cell: Point2D) => boolean,
	can_path?: PathEnter,
	graph: PathGraph | null = null,
	avoid = 0,
	claim_head?: ClaimHead,
): boolean {
	const walkable = can_path ?? can_enter;
	if (foot.rotation_timer > 0) {
		foot.rotation_timer -= 1;
	}
	if (foot.track_number !== -1 && foot.is_driving) {
		while_moving(foot, false, can_enter, try_gate, claim_head);
		if (foot.track_number === -1 && (foot.dest || (foot.path[0] !== undefined && foot.path[0] !== FACING_NONE))) {
			const delayed = start_of_move(foot, can_enter, walkable, try_gate, graph, avoid, claim_head, false);
			if (foot.is_driving) {
				while_moving(foot, true, can_enter, try_gate, claim_head);
				return true;
			}
			return is_rotating(foot) || delayed;
		}
		return foot.is_driving || is_rotating(foot);
	}
	const here = Coord_Cell(foot.lx, foot.ly);
	if (foot.dest && here.x === foot.dest.x && here.y === foot.dest.y && !foot.is_driving) {
		foot.dest = null;
		foot.moving = false;
		foot.path = [];
		stop_driver(foot);
		return true;
	}
	if (is_rotating(foot)) {
		return true;
	}
	if (foot.dest || (foot.path[0] !== undefined && foot.path[0] !== FACING_NONE)) {
		const delayed = start_of_move(foot, can_enter, walkable, try_gate, graph, avoid, claim_head, false);
		if (foot.is_driving) {
			while_moving(foot, false, can_enter, try_gate, claim_head);
			return true;
		}
		return is_rotating(foot) || delayed;
	}
	return false;
}
