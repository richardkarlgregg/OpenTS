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
import type { CellTerrain } from "./walk";

export const SUBZONE_FINE = 0;
export const SUBZONE_ROUGH = 1;
export const SUBZONE_COARSE = 2;
export const SUBZONE_COUNT = 3;

export const PASSABLE_LAND = 0;
export const PASSABLE_NO = 5;
export const PASSABLE_OUTSIDE = 6;

const CLIFF_BACK_OFFSETS: readonly [number, number][] = [
	[0, -1],
	[-1, 0],
	[2, 2],
	[1, 1],
	[-1, 1],
	[1, -1],
];

const CARDINAL: readonly [number, number][] = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0],
];

const DIAGONAL: readonly [number, number][] = [
	[1, -1],
	[1, 1],
	[-1, 1],
	[-1, -1],
];

const FACING_DELTA: readonly [number, number][] = [
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
];

const MAP_CELL_W = 512;

export type SubzoneConnection = {
	id: number;
	cross: boolean;
};

export type SubzoneTrack = {
	parent: number;
	passability: number;
	threat_region: number;
	connections: SubzoneConnection[];
};

export type PathCell = {
	height: number;
	passability: number;
	zone: number;
	subzone: [number, number, number];
	under_bridge: boolean;
	tube: number;
};

export type TubePath = {
	enter: Point2D;
	exit: Point2D;
	dir: number;
	dirs: number[];
};

export type ZoneLink = {
	from: Point2D;
	to: Point2D;
	passable: boolean;
	kind: "bridge" | "tunnel";
};

export type PathGraph = {
	cells: Map<string, PathCell>;
	tracking: SubzoneTrack[][];
	tubes: TubePath[];
	connections: ZoneLink[];
	threat: Map<number, number>;
};

export const REGION_WIDTH = 4;
const REGION_STRIDE = 256;

export function Threat_Region(x: number, y: number): number {
	return ((x / REGION_WIDTH) | 0) + 1 + ((((y / REGION_WIDTH) | 0) + 1) * REGION_STRIDE);
}

function cell_key(x: number, y: number): string {
	return `${x},${y}`;
}

function terrain_height(terrain: Map<string, CellTerrain>, x: number, y: number): number {
	return terrain.get(cell_key(x, y))?.height ?? 0;
}

export function is_cliff_back_cell(
	terrain: Map<string, CellTerrain>,
	x: number,
	y: number,
	cliff_back: number,
): boolean {
	if (cliff_back !== 2) {
		return false;
	}
	const limit = terrain_height(terrain, x, y) + 4;
	return CLIFF_BACK_OFFSETS.some(([dx, dy]) => limit <= terrain_height(terrain, x + dx, y + dy));
}

export function graph_cell(graph: PathGraph, cell: Point2D): PathCell | null {
	return graph.cells.get(cell_key(cell.x, cell.y)) ?? null;
}

export function tube_at(graph: PathGraph, cell: Point2D): TubePath | null {
	const marked = graph_cell(graph, cell);
	if (!marked || marked.tube < 0) {
		return null;
	}
	return graph.tubes[marked.tube] ?? null;
}

export function hs_anchor(graph: PathGraph, cell: Point2D): Point2D {
	const marked = graph_cell(graph, cell);
	if (!marked?.under_bridge) {
		return cell;
	}
	let best: Point2D | null = null;
	let best_d = 1e12;
	for (const link of graph.connections) {
		if (link.kind !== "bridge") {
			continue;
		}
		for (const end of [link.from, link.to]) {
			const d = (end.x - cell.x) * (end.x - cell.x) + (end.y - cell.y) * (end.y - cell.y);
			if (d < best_d) {
				best_d = d;
				best = end;
			}
		}
	}
	return best ?? cell;
}

export function Build_Path_Graph(
	terrain: Map<string, CellTerrain>,
	cells: Set<string>,
	walls: Set<string>,
	cliff_back: number,
	tubes: TubePath[] = [],
	bridges: Point2D[] = [],
	threat: Map<number, number> = new Map(),
): PathGraph {
	const graph: PathGraph = {
		cells: new Map(),
		tracking: [[], [], []],
		tubes: [],
		connections: [],
		threat,
	};
	for (const id of cells) {
		const [xs, ys] = id.split(",");
		const x = Number(xs);
		const y = Number(ys);
		const height = terrain_height(terrain, x, y);
		const blocked = walls.has(id) || is_cliff_back_cell(terrain, x, y, cliff_back);
		graph.cells.set(id, {
			height,
			passability: blocked ? PASSABLE_NO : PASSABLE_LAND,
			zone: 0,
			subzone: [0, 0, 0],
			under_bridge: false,
			tube: -1,
		});
	}
	flood_zones(graph);
	for (let level = SUBZONE_COARSE; level >= SUBZONE_FINE; level--) {
		flood_subzones(graph, level);
	}
	stamp_tubes(graph, tubes);
	stamp_bridges(graph, bridges);
	link_connections(graph);
	return graph;
}

function flood_zones(graph: PathGraph): void {
	let zone = 1;
	for (const [id, cell] of graph.cells) {
		if (cell.zone !== 0) {
			continue;
		}
		const [xs, ys] = id.split(",");
		const seed = { x: Number(xs), y: Number(ys) };
		const pass = cell.passability;
		const queue = [seed];
		cell.zone = zone;
		for (let i = 0; i < queue.length; i++) {
			const here = queue[i]!;
			const from = graph.cells.get(cell_key(here.x, here.y));
			if (!from) {
				continue;
			}
			for (const [dx, dy] of [...CARDINAL, ...DIAGONAL]) {
				const next = graph.cells.get(cell_key(here.x + dx, here.y + dy));
				if (!next || next.zone !== 0 || next.passability !== pass) {
					continue;
				}
				if (Math.abs(next.height - from.height) >= 2) {
					continue;
				}
				next.zone = zone;
				queue.push({ x: here.x + dx, y: here.y + dy });
			}
		}
		zone += 1;
	}
}

function flood_subzones(graph: PathGraph, level: number): void {
	const size = 1 << (level + 1);
	const tracking: SubzoneTrack[] = [
		{
			parent: 0,
			passability: PASSABLE_OUTSIDE,
			threat_region: 0,
			connections: [],
		},
	];
	let next_id = 1;
	const links = new Map<string, boolean>();
	for (const [id, cell] of graph.cells) {
		if (cell.subzone[level] !== 0) {
			continue;
		}
		const [xs, ys] = id.split(",");
		const seed = { x: Number(xs), y: Number(ys) };
		const parent = level < SUBZONE_COARSE ? (cell.subzone[level + 1] ?? 0) : 0;
		const origin = { x: seed.x & ~(size - 1), y: seed.y & ~(size - 1) };
		tracking.push({
			parent,
			passability: cell.passability,
			threat_region: Threat_Region(seed.x, seed.y),
			connections: [],
		});
		const stamp = next_id;
		next_id += 1;
		fill_block(graph, level, stamp, seed, origin, size, cell.zone);
	}
	for (const [id, cell] of graph.cells) {
		const [xs, ys] = id.split(",");
		const x = Number(xs);
		const y = Number(ys);
		const from_id = cell.subzone[level] ?? 0;
		if (from_id <= 0) {
			continue;
		}
		const size_mask = size - 1;
		const origin = { x: x & ~size_mask, y: y & ~size_mask };
		for (const [dx, dy] of CARDINAL) {
			const nx = x + dx;
			const ny = y + dy;
			const neighbor = graph.cells.get(cell_key(nx, ny));
			if (!neighbor) {
				continue;
			}
			const to_id = neighbor.subzone[level] ?? 0;
			if (to_id <= 0 || to_id === from_id) {
				continue;
			}
			if (Math.abs(neighbor.height - cell.height) >= 2) {
				continue;
			}
			const other = { x: nx & ~size_mask, y: ny & ~size_mask };
			const cross = other.x !== origin.x || other.y !== origin.y;
			const low = from_id < to_id ? from_id : to_id;
			const high = from_id < to_id ? to_id : from_id;
			const packed = `${low},${high}`;
			if (!links.has(packed)) {
				links.set(packed, cross);
			} else if (cross) {
				links.set(packed, true);
			}
		}
	}
	for (const [packed, cross] of links) {
		const [a, b] = packed.split(",").map(Number) as [number, number];
		tracking[a]?.connections.push({ id: b, cross });
		tracking[b]?.connections.push({ id: a, cross });
	}
	graph.tracking[level] = tracking;
}

function fill_block(
	graph: PathGraph,
	level: number,
	stamp: number,
	seed: Point2D,
	origin: Point2D,
	size: number,
	zone: number,
): void {
	const xmax = origin.x + size;
	const ymax = origin.y + size;
	const start = graph.cells.get(cell_key(seed.x, seed.y));
	if (!start) {
		return;
	}
	start.subzone[level] = stamp;
	const queue = [seed];
	for (let i = 0; i < queue.length; i++) {
		const here = queue[i]!;
		const from = graph.cells.get(cell_key(here.x, here.y));
		if (!from) {
			continue;
		}
		for (const [dx, dy] of CARDINAL) {
			const x = here.x + dx;
			const y = here.y + dy;
			if (x < origin.x || y < origin.y || x >= xmax || y >= ymax) {
				continue;
			}
			const next = graph.cells.get(cell_key(x, y));
			if (!next || next.subzone[level] !== 0 || next.zone !== zone) {
				continue;
			}
			if (Math.abs(next.height - from.height) >= 2) {
				continue;
			}
			next.subzone[level] = stamp;
			queue.push({ x, y });
		}
	}
}

function adjacent_cell(cell: Point2D, dir: number): Point2D {
	const step = FACING_DELTA[dir & 7] ?? [0, 0];
	return { x: cell.x + step[0], y: cell.y + step[1] };
}

function follow_dirs(start: Point2D, dirs: number[]): Point2D {
	let pos = { ...start };
	for (const dir of dirs) {
		if (dir < 0 || dir >= 8) {
			break;
		}
		pos = adjacent_cell(pos, dir);
	}
	return pos;
}

function has_tube(graph: PathGraph, x: number, y: number): boolean {
	return (graph.cells.get(cell_key(x, y))?.tube ?? -1) >= 0;
}

function stamp_tubes(graph: PathGraph, tubes: TubePath[]): void {
	graph.tubes = tubes;
	for (let i = 0; i < tubes.length; i++) {
		const tube = tubes[i]!;
		const enter = graph.cells.get(cell_key(tube.enter.x, tube.enter.y));
		if (enter) {
			enter.tube = i;
		}
	}
	for (const tube of tubes) {
		const enter = tube.enter;
		const eastwest = has_tube(graph, enter.x + 1, enter.y) && has_tube(graph, enter.x - 1, enter.y);
		const northsouth = has_tube(graph, enter.x, enter.y + 1) && has_tube(graph, enter.x, enter.y - 1);
		if (!eastwest && !northsouth) {
			continue;
		}
		if (enter.y * MAP_CELL_W + enter.x >= tube.exit.y * MAP_CELL_W + tube.exit.x) {
			continue;
		}
		graph.connections.push({ from: tube.enter, to: tube.exit, passable: true, kind: "tunnel" });
	}
}

function stamp_bridges(graph: PathGraph, bridges: Point2D[]): void {
	const pending = new Set(bridges.map((cell) => cell_key(cell.x, cell.y)));
	for (const id of pending) {
		const cell = graph.cells.get(id);
		if (cell) {
			cell.under_bridge = true;
		}
	}
	const seen = new Set<string>();
	for (const seed of bridges) {
		const start = cell_key(seed.x, seed.y);
		if (seen.has(start) || !pending.has(start)) {
			continue;
		}
		const group: Point2D[] = [];
		const queue = [seed];
		seen.add(start);
		for (let i = 0; i < queue.length; i++) {
			const here = queue[i]!;
			group.push(here);
			for (const [dx, dy] of CARDINAL) {
				const next = { x: here.x + dx, y: here.y + dy };
				const id = cell_key(next.x, next.y);
				if (seen.has(id) || !pending.has(id)) {
					continue;
				}
				seen.add(id);
				queue.push(next);
			}
		}
		let minx = group[0]!.x;
		let maxx = group[0]!.x;
		let miny = group[0]!.y;
		let maxy = group[0]!.y;
		for (const cell of group) {
			minx = Math.min(minx, cell.x);
			maxx = Math.max(maxx, cell.x);
			miny = Math.min(miny, cell.y);
			maxy = Math.max(maxy, cell.y);
		}
		const eastwest = maxx - minx >= maxy - miny;
		let from_cell = group[0]!;
		let to_cell = group[0]!;
		for (const cell of group) {
			if (eastwest) {
				if (cell.x < from_cell.x) {
					from_cell = cell;
				}
				if (cell.x > to_cell.x) {
					to_cell = cell;
				}
			} else {
				if (cell.y < from_cell.y) {
					from_cell = cell;
				}
				if (cell.y > to_cell.y) {
					to_cell = cell;
				}
			}
		}
		graph.connections.push({ from: from_cell, to: to_cell, passable: true, kind: "bridge" });
	}
}

function link_connections(graph: PathGraph): void {
	for (const link of graph.connections) {
		const pairs: [Point2D, Point2D][] = [[link.from, link.to]];
		if (link.kind === "tunnel") {
			const tube = tube_at(graph, link.from);
			const enter_dir = tube?.dir ?? 0;
			const enter1 = adjacent_cell(link.from, enter_dir + 2);
			const enter2 = adjacent_cell(link.from, enter_dir + 6);
			const tube1 = tube_at(graph, enter1);
			const tube2 = tube_at(graph, enter2);
			if (tube1 && tube2) {
				pairs.push([enter1, follow_dirs(enter1, tube1.dirs)]);
				pairs.push([enter2, follow_dirs(enter2, tube2.dirs)]);
			}
		} else {
			const eastwest = link.from.x !== link.to.x;
			const side = eastwest ? 0 : 2;
			pairs.push([adjacent_cell(link.from, side), adjacent_cell(link.to, side)]);
			pairs.push([adjacent_cell(link.from, side + 4), adjacent_cell(link.to, side + 4)]);
		}
		for (let level = 0; level < SUBZONE_COUNT; level++) {
			for (const [a, b] of pairs) {
				link_subzones(graph, level, a, b);
			}
		}
	}
}

function link_subzones(graph: PathGraph, level: number, from: Point2D, to: Point2D): void {
	const a = graph_cell(graph, from)?.subzone[level] ?? 0;
	const b = graph_cell(graph, to)?.subzone[level] ?? 0;
	if (a <= 0 || b <= 0 || a === b) {
		return;
	}
	const tracking = graph.tracking[level];
	if (!tracking) {
		return;
	}
	const left = tracking[a];
	const right = tracking[b];
	if (!left || !right) {
		return;
	}
	if (!left.connections.some((conn) => conn.id === b)) {
		left.connections.push({ id: b, cross: false });
	}
	if (!right.connections.some((conn) => conn.id === a)) {
		right.connections.push({ id: a, cross: false });
	}
}
