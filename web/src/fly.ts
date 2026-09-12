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

import { Current_Body, Set_Desired_Body, Tick_Facing } from "./drive";
import type { Point2D } from "./ini";
import { CELL_LEPTON, Cell_Center, Coord_Cell, type FootState } from "./walk";

const DIR_CIRCLE = 65534;
const DIR_BIAS = 16383;
const SPEED_STEP = 0.1;
const LAND_SPEED = 0.05;
const DROPSHIP_CLIMB = 16;

export type FlyControl = {
	cruise: number;
	dropship: boolean;
	slowdown: number;
};

function as_i16(value: number): number {
	return (value << 16) >> 16;
}

function radian_of(body: number): number {
	return (as_i16(body) - DIR_BIAS) * -((Math.PI * 2) / DIR_CIRCLE);
}

function body_from_radian(rad: number): number {
	return as_i16(Math.trunc((rad - Math.PI / 2) / -((Math.PI * 2) / DIR_CIRCLE)));
}

export function Direction_Body(from: Point2D, to: Point2D): number {
	if (from.x === to.x && from.y === to.y) {
		return 0;
	}
	return body_from_radian(Math.atan2(from.y - to.y, to.x - from.x));
}

export function Dir256_Toward(from: Point2D, to: Point2D): number {
	const raw = Direction_Body(from, to) & 0xffff;
	return ((((raw >>> 7) + 1) >>> 1) % 256);
}

function dest_coord(foot: FootState): Point2D | null {
	return foot.dest ? Cell_Center(foot.dest) : null;
}

function lepton_dist(from: Point2D, to: Point2D): number {
	return Math.hypot(to.x - from.x, to.y - from.y);
}

function is_moving(foot: FootState): boolean {
	return foot.dest !== null || foot.is_taking_off || foot.is_landing || foot.speed > 0;
}

function is_in_flight(foot: FootState): boolean {
	return !foot.is_landing && (!foot.is_taking_off || foot.height_agl >= foot.flight_level / 2);
}

function take_off(foot: FootState, cruise: number): void {
	foot.is_landing = false;
	foot.is_taking_off = true;
	foot.flight_level = cruise;
	foot.moving = true;
}

function land(foot: FootState): void {
	foot.is_taking_off = false;
	foot.is_landing = true;
	foot.commenced_landing = false;
	foot.flight_level = 0;
}

function apparent_speed(foot: FootState): number {
	return Math.trunc(foot.max_speed * foot.speed);
}

function physics(foot: FootState): void {
	const actual = apparent_speed(foot);
	if (actual <= 0) {
		return;
	}
	const rad = radian_of(Current_Body(foot));
	foot.lx += Math.cos(rad) * actual;
	foot.ly -= Math.sin(rad) * actual;
}

function process_take_off(foot: FootState): void {
	if (foot.height_agl >= foot.flight_level) {
		foot.is_taking_off = false;
		foot.is_landing = false;
		return;
	}
	if (foot.height_agl > foot.flight_level / 2) {
		const dest = dest_coord(foot);
		if (dest) {
			Set_Desired_Body(foot, Direction_Body({ x: foot.lx, y: foot.ly }, dest));
		}
		foot.target_speed = 1;
	}
}

function process_landing(foot: FootState): void {
	if (!foot.is_landing) {
		return;
	}
	foot.target_speed = 0;
	if (foot.height_agl > 0) {
		return;
	}
	foot.height_agl = 0;
	foot.is_landing = false;
	foot.is_taking_off = false;
	foot.speed = 0;
	foot.target_speed = 0;
	foot.moving = false;
	foot.dest = null;
	foot.path = [];
	foot.head = null;
}

function nearing_target(foot: FootState, cruise: number, dropship: boolean, slowdown: number): void {
	const dest = dest_coord(foot);
	if (!dest) {
		return;
	}
	const here = { x: foot.lx, y: foot.ly };
	const dist = lepton_dist(here, dest);
	Set_Desired_Body(foot, Direction_Body(here, dest));
	if (dropship) {
		if (dist >= slowdown) {
			foot.flight_level = cruise;
		} else {
			const frac = dist / slowdown;
			foot.flight_level = Math.trunc((cruise / 3) * (1 - frac) + cruise * frac);
		}
	} else {
		foot.flight_level = cruise;
	}
	if (dist < CELL_LEPTON / 2) {
		foot.target_speed = 0;
		if (foot.speed < LAND_SPEED) {
			land(foot);
		}
	} else if (dist < CELL_LEPTON * 2) {
		foot.target_speed = 0.5;
	} else if (dist < CELL_LEPTON * 3) {
		foot.target_speed = 0.75;
	}
}

function climb_or_descend(foot: FootState, dropship: boolean): void {
	let height = foot.height_agl;
	if (height < foot.flight_level) {
		let climb = foot.flight_level - height;
		if (dropship) {
			if (climb > DROPSHIP_CLIMB) {
				climb = DROPSHIP_CLIMB;
			}
		} else {
			climb = Math.min(20, climb);
		}
		foot.height_agl = height + climb;
		return;
	}
	if (height <= foot.flight_level) {
		return;
	}
	let descent = height - foot.flight_level;
	if (dropship) {
		if (foot.is_landing) {
			const limit = Math.trunc(descent / 20) + 10;
			descent = Math.min(Math.min(limit, 48), descent);
		} else if (height > DROPSHIP_CLIMB) {
			descent = DROPSHIP_CLIMB;
		} else {
			descent = height;
		}
	} else {
		descent = Math.trunc(descent / 20);
		if (descent >= 50) {
			descent = 50;
		} else if (descent <= 20) {
			descent = 20;
		}
		if (descent > height - foot.flight_level) {
			descent = height - foot.flight_level;
		}
	}
	height -= descent;
	if (height < 0) {
		height = 0;
	}
	foot.height_agl = height;
}

function movement_ai(foot: FootState, dropship: boolean, slowdown: number): void {
	if (!is_moving(foot)) {
		return;
	}
	if (!foot.is_landing) {
		physics(foot);
	}
	climb_or_descend(foot, dropship);
	const dest = dest_coord(foot);
	const dist = dest ? lepton_dist({ x: foot.lx, y: foot.ly }, dest) : 0;
	if (is_in_flight(foot) && dest) {
		if (dist < CELL_LEPTON / 2) {
			foot.target_speed = 0;
			if (foot.speed < LAND_SPEED) {
				land(foot);
			}
		} else if (slowdown > 0) {
			let speed = dist / slowdown;
			if (speed > 1) {
				speed = 1;
			}
			foot.target_speed = speed;
			if (foot.target_speed < 0.1) {
				if (dist > CELL_LEPTON / 3) {
					foot.target_speed = 0.1;
				} else {
					foot.target_speed = 0;
					foot.speed *= 0.5;
				}
			}
			if (dist < foot.speed) {
				foot.speed = dist;
			}
			if (foot.target_speed === 0 && foot.speed === 0 && dist > 0) {
				foot.speed = LAND_SPEED;
			}
		} else {
			foot.target_speed = 1;
		}
	}
	if (!foot.is_landing && !foot.is_taking_off && dest) {
		const here = Coord_Cell(foot.lx, foot.ly);
		if (here.x === foot.dest!.x && here.y === foot.dest!.y && foot.target_speed === 0) {
			land(foot);
		}
	}
	if (foot.speed < foot.target_speed) {
		foot.speed = Math.min(foot.speed + SPEED_STEP, foot.target_speed);
	} else if (foot.speed > foot.target_speed) {
		foot.speed = Math.max(foot.speed - SPEED_STEP, foot.target_speed);
	}
}

export function Fly_AI(foot: FootState, control: FlyControl): boolean {
	if (!foot.is_landing && !foot.is_taking_off && foot.target_speed >= 1 && foot.flight_level === 0) {
		foot.flight_level = control.cruise;
	}
	if (foot.dest && !foot.is_taking_off && !foot.is_landing && foot.height_agl <= 0) {
		take_off(foot, control.cruise);
	}
	if (!foot.dest && foot.height_agl > 0 && !foot.is_landing && !foot.is_taking_off) {
		land(foot);
	}
	Tick_Facing(foot);
	movement_ai(foot, control.dropship, control.slowdown);
	if (foot.dest && !foot.is_landing && !foot.is_taking_off && foot.height_agl > 0) {
		nearing_target(foot, control.cruise, control.dropship, control.slowdown);
	}
	if (foot.is_landing) {
		process_landing(foot);
	}
	if (foot.is_taking_off) {
		process_take_off(foot);
	}
	foot.moving = is_moving(foot);
	return is_moving(foot) || foot.height_agl > 0;
}
