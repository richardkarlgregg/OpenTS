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

export const PATH_NONE = -1;
export const PATH_COUNT = 12;
export const PATH_FIRST = 0;

export type WaypointClass = {
	x: number;
	y: number;
};

export type WaypointPathClass = {
	CurrentWaypoint: number;
	Waypoints: WaypointClass[];
};

export function Make_Paths(): WaypointPathClass[] {
	const paths: WaypointPathClass[] = [];
	for (let i = 0; i < PATH_COUNT; i++) {
		paths.push({ CurrentWaypoint: -1, Waypoints: [] });
	}
	return paths;
}

export function Get_Waypoint(path: WaypointPathClass, index: number): WaypointClass | null {
	if (index >= 0 && index < path.Waypoints.length) {
		return path.Waypoints[index]!;
	}
	return null;
}

export function Add_Waypoint(path: WaypointPathClass, cell: Point2D): boolean {
	if (path.CurrentWaypoint === -1) {
		path.Waypoints.push({ x: cell.x, y: cell.y });
	}
	return true;
}

export function Select_Waypoint(path: WaypointPathClass, cell: Point2D): boolean {
	for (let i = 0; i < path.Waypoints.length; i++) {
		const waypoint = path.Waypoints[i]!;
		if (waypoint.x === cell.x && waypoint.y === cell.y) {
			path.CurrentWaypoint = i;
			return true;
		}
	}
	return false;
}

export function Get_Next_Waypoint(path: WaypointPathClass, waypoint: WaypointClass): WaypointClass | null {
	const index = path.Waypoints.indexOf(waypoint) + 1;
	let next = index;
	if (path.CurrentWaypoint !== -1 && next === path.Waypoints.length) {
		next = path.CurrentWaypoint;
	}
	return Get_Waypoint(path, next);
}

export function Waypoint_Count(path: WaypointPathClass): number {
	return path.Waypoints.length;
}

export function New_Waypoint_Path(paths: WaypointPathClass[]): number {
	for (let i = 0; i < PATH_COUNT; i++) {
		if (Waypoint_Count(paths[i]!) === 0) {
			return i;
		}
	}
	return PATH_NONE;
}

export function Waypoint_At(paths: WaypointPathClass[], cell: Point2D): WaypointClass | null {
	for (let path = PATH_FIRST; path < PATH_COUNT; path++) {
		for (const waypoint of paths[path]!.Waypoints) {
			if (waypoint.x === cell.x && waypoint.y === cell.y) {
				return waypoint;
			}
		}
	}
	return null;
}

export function Fetch_Waypoint_Data(
	paths: WaypointPathClass[],
	waypoint: WaypointClass | null,
): { path: number; id: number } | null {
	if (!waypoint) {
		return null;
	}
	for (let path = PATH_FIRST; path < PATH_COUNT; path++) {
		const index = paths[path]!.Waypoints.indexOf(waypoint);
		if (index >= 0) {
			return { path, id: index };
		}
	}
	return null;
}

export function Can_Place_Waypoint(paths: WaypointPathClass[], selected: number, cell: Point2D): boolean {
	for (let path = PATH_FIRST; path < PATH_COUNT; path++) {
		for (const waypoint of paths[path]!.Waypoints) {
			if (waypoint.x === cell.x && waypoint.y === cell.y && path !== selected) {
				return false;
			}
		}
	}
	return true;
}

export function Can_Add_Waypoint_To_Path(paths: WaypointPathClass[], selected: number, max_length: number): boolean {
	if (selected < 0 || selected >= PATH_COUNT) {
		return false;
	}
	const path = paths[selected]!;
	return Waypoint_Count(path) < max_length && path.CurrentWaypoint === -1;
}

export function Place_Waypoint(paths: WaypointPathClass[], selected: number, cell: Point2D): void {
	if (selected < 0 || selected >= PATH_COUNT) {
		return;
	}
	if (!Can_Place_Waypoint(paths, selected, cell)) {
		return;
	}
	Add_Waypoint(paths[selected]!, cell);
}
