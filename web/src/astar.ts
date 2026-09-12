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
import {
	graph_cell,
	hs_anchor,
	SUBZONE_COARSE,
	SUBZONE_COUNT,
	SUBZONE_FINE,
	tube_at,
	type PathGraph,
} from "./zone";

const FACING_COUNT = 8;
const FACING_N = 0;
const FACING_E = 2;
const FACING_NONE = -1;
const FACING_45 = 1;
const FACING_90 = 2;
const FACING_270 = 6;
const END = FACING_NONE;
const EMPTY = -2;
const TUNNEL = FACING_COUNT;

const ADJACENT_CELL: readonly [number, number][] = [
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
];

const FACING_COSTS = [0.001, 0.005, 0.002, 0.006, 0.003, 0.007, 0.004, 0.008];
const MOVE_OK_COST = 1;
const MAX_LOOPS = 8000;
const MAX_OPEN = 65536;
const PASSABLE_CRUSH = 1;
const PASS_SCORES = [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0];
const TRAVERSAL_PASSABLE = 1;
const NORMAL_PASS = [1, 2, 2, 2, 2, 2, 3];

function Adjacent_Cell(cell: Point2D, dir: number): Point2D {
	const step = ADJACENT_CELL[dir] ?? [0, 0];
	return { x: cell.x + step[0], y: cell.y + step[1] };
}

function Facing_Sub(first: number, second: number): number {
	return (first - second) & 7;
}

function cell_key(x: number, y: number): string {
	return `${x},${y}`;
}

function heuristic(from: Point2D, to: Point2D): number {
	const dx = from.x - to.x;
	const dy = from.y - to.y;
	return Math.sqrt(dx * dx + dy * dy);
}

function Follow_Path(cell: Point2D, count: number, moves: number[], graph: PathGraph | null): Point2D {
	let result = { ...cell };
	for (let i = 0; i < count; i++) {
		const dir = moves[i];
		if (dir === undefined) {
			continue;
		}
		if (dir === TUNNEL && graph) {
			const tube = tube_at(graph, result);
			if (tube) {
				result = { ...tube.exit };
			}
			continue;
		}
		if (dir < 0 || dir >= FACING_COUNT) {
			continue;
		}
		result = Adjacent_Cell(result, dir);
	}
	return result;
}

export type PathEnter = (from: Point2D, to: Point2D, dir: number) => boolean;

type RegularNode = {
	x: number;
	y: number;
	parent: RegularNode | null;
	dir: number;
	g: number;
	f: number;
	length: number;
	heap: number;
};

class OpenHeap {
	private items: RegularNode[] = [];

	get count(): number {
		return this.items.length;
	}

	insert(node: RegularNode): void {
		node.heap = this.items.length;
		this.items.push(node);
		this.sift_up(node.heap);
	}

	extract_min(): RegularNode | null {
		const first = this.items[0];
		if (!first) {
			return null;
		}
		const last = this.items.pop()!;
		if (this.items.length > 0) {
			this.items[0] = last;
			last.heap = 0;
			this.sift_down(0);
		}
		return first;
	}

	private sift_up(index: number): void {
		const items = this.items;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (items[parent]!.f <= items[index]!.f) {
				break;
			}
			this.swap(parent, index);
			index = parent;
		}
	}

	private sift_down(index: number): void {
		const items = this.items;
		for (;;) {
			const left = index * 2 + 1;
			const right = left + 1;
			let best = index;
			if (left < items.length && items[left]!.f < items[best]!.f) {
				best = left;
			}
			if (right < items.length && items[right]!.f < items[best]!.f) {
				best = right;
			}
			if (best === index) {
				break;
			}
			this.swap(index, best);
			index = best;
		}
	}

	private swap(a: number, b: number): void {
		const items = this.items;
		const left = items[a]!;
		const right = items[b]!;
		items[a] = right;
		items[b] = left;
		left.heap = b;
		right.heap = a;
	}
}

type HierNode = {
	index: number;
	parent: number;
	subzone: number;
	score: number;
	depth: number;
};

class ScoreHeap {
	private items: HierNode[] = [];

	get count(): number {
		return this.items.length;
	}

	clear(): void {
		this.items.length = 0;
	}

	insert(node: HierNode): void {
		this.items.push(node);
		this.sift_up(this.items.length - 1);
	}

	extract_min(): HierNode | null {
		const first = this.items[0];
		if (!first) {
			return null;
		}
		const last = this.items.pop()!;
		if (this.items.length > 0) {
			this.items[0] = last;
			this.sift_down(0);
		}
		return first;
	}

	private sift_up(index: number): void {
		const items = this.items;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (items[parent]!.score <= items[index]!.score) {
				break;
			}
			const tmp = items[parent]!;
			items[parent] = items[index]!;
			items[index] = tmp;
			index = parent;
		}
	}

	private sift_down(index: number): void {
		const items = this.items;
		for (;;) {
			const left = index * 2 + 1;
			const right = left + 1;
			let best = index;
			if (left < items.length && items[left]!.score < items[best]!.score) {
				best = left;
			}
			if (right < items.length && items[right]!.score < items[best]!.score) {
				best = right;
			}
			if (best === index) {
				break;
			}
			const tmp = items[index]!;
			items[index] = items[best]!;
			items[best] = tmp;
			index = best;
		}
	}
}

let unique_id = 1;
const HS_TRIES = 5;

export function Find_Path_Regular(
	from: Point2D,
	to: Point2D,
	can_enter: PathEnter,
	maxlen = 200,
	graph: PathGraph | null = null,
	avoid = 0,
): number[] {
	if (from.x === to.x && from.y === to.y) {
		return [];
	}
	const banned: number[][] = [[], [], []];
	let hs_on = !!graph;
	let moves: number[] = [];
	for (let attempt = 0; attempt < HS_TRIES; attempt++) {
		unique_id += 1;
		const stamp = unique_id;
		const paths: number[][] = [[], [], []];
		let corridor: number[] | null = null;
		if (hs_on && graph) {
			const start = hs_anchor(graph, from);
			const end = hs_anchor(graph, to);
			const from_cell = graph_cell(graph, start);
			const to_cell = graph_cell(graph, end);
			if (from_cell && to_cell && from_cell.zone !== 0) {
				corridor = Find_Path_Hierarchical(graph, start, end, stamp, banned, paths, avoid);
			}
			if (!corridor && from_cell && to_cell && from_cell.zone !== to_cell.zone) {
				hs_on = false;
			}
		}
		const found = search_cells(from, to, can_enter, maxlen, graph, corridor, stamp, paths[SUBZONE_FINE] ?? []);
		if (found.moves.length > 0) {
			moves = found.moves;
			break;
		}
		if (!hs_on || !graph || !corridor) {
			break;
		}
		if (!Ban_Blocked_Subzone_Edges(graph, found.last, paths, banned, can_enter)) {
			hs_on = false;
		}
	}
	if (moves.length === 0) {
		return [];
	}
	const packed = [...moves, END];
	Cut_Corners(from, packed, can_enter, graph);
	Optimize_Moves(from, packed, can_enter, graph);
	return packed.filter((dir) => dir >= 0 && dir <= TUNNEL);
}

type CellSearch = {
	moves: number[];
	last: Point2D;
};

function search_cells(
	from: Point2D,
	to: Point2D,
	can_enter: PathEnter,
	maxlen: number,
	graph: PathGraph | null,
	corridor: number[] | null,
	stamp: number,
	fine_path: number[],
): CellSearch {
	const open = new OpenHeap();
	const best = new Map<string, number>();
	const start: RegularNode = {
		x: from.x,
		y: from.y,
		parent: null,
		dir: FACING_COUNT,
		g: 0,
		f: heuristic(from, to),
		length: 1,
		heap: 0,
	};
	best.set(cell_key(from.x, from.y), 0);
	open.insert(start);
	let found: RegularNode | null = null;
	let tries = 0;
	let last = { ...from };
	let hier_index = 0;
	while (open.count > 0 && tries < MAX_LOOPS && best.size < MAX_OPEN) {
		const working = open.extract_min();
		if (!working) {
			break;
		}
		const known = best.get(cell_key(working.x, working.y));
		if (known !== undefined && working.g > known + 0.0001) {
			continue;
		}
		if (working.x === to.x && working.y === to.y) {
			found = working;
			break;
		}
		const here = { x: working.x, y: working.y };
		for (let dir = 0; dir <= TUNNEL; dir++) {
			let next: Point2D;
			let step = MOVE_OK_COST + (FACING_COSTS[dir] ?? 0);
			if (dir === TUNNEL) {
				if (!graph) {
					continue;
				}
				const tube = tube_at(graph, here);
				if (!tube) {
					continue;
				}
				next = { ...tube.exit };
				step = Math.max(Math.abs(next.x - here.x), Math.abs(next.y - here.y));
			} else {
				next = Adjacent_Cell(here, dir);
			}
			if (corridor && graph && !(next.x === to.x && next.y === to.y)) {
				const marked = graph_cell(graph, next);
				const sid = marked?.subzone[SUBZONE_FINE] ?? 0;
				const on_deck = !!marked?.under_bridge && marked.bridge_traversable;
				if (!on_deck && (corridor[sid] ?? 0) !== stamp) {
					continue;
				}
			}
			if (!can_enter(here, next, dir)) {
				continue;
			}
			if (graph && hier_index + 1 < fine_path.length) {
				const sid = graph_cell(graph, next)?.subzone[SUBZONE_FINE] ?? 0;
				if (sid === fine_path[hier_index + 1]) {
					hier_index += 1;
					last = { ...next };
				}
			}
			const g = working.g + step;
			const id = cell_key(next.x, next.y);
			const prior = best.get(id);
			if (prior !== undefined && prior <= g + 0.009) {
				continue;
			}
			best.set(id, g);
			open.insert({
				x: next.x,
				y: next.y,
				parent: working,
				dir,
				g,
				f: g + heuristic(next, to),
				length: working.length + 1,
				heap: 0,
			});
		}
		tries += 1;
	}
	if (!found || found.length < 2) {
		return { moves: [], last };
	}
	const steps: number[] = [];
	let node: RegularNode | null = found;
	while (node && node.parent) {
		steps.push(node.dir);
		node = node.parent;
		if (steps.length > maxlen) {
			return { moves: [], last };
		}
	}
	steps.reverse();
	return { moves: steps, last };
}

function region_threat(graph: PathGraph, level: number, from_id: number, to_id: number): number {
	if (level === SUBZONE_FINE) {
		return 0;
	}
	const dest = graph.tracking[level]?.[to_id];
	if (!dest) {
		return 0;
	}
	if (level === 1) {
		return graph.threat.get(dest.threat_region) ?? 0;
	}
	const from = graph.tracking[level]?.[from_id];
	const a = graph.threat.get(from?.threat_region ?? 0) ?? 0;
	const b = graph.threat.get(dest.threat_region) ?? 0;
	return (a + b) >> 1;
}

function pack_edge(a: number, b: number): number {
	const lo = a < b ? a : b;
	const hi = a < b ? b : a;
	return (lo << 16) | hi;
}

function edge_banned(banned: number[][], level: number, from_id: number, to_id: number): boolean {
	const edge = pack_edge(from_id, to_id);
	return (banned[level] ?? []).includes(edge);
}

function ban_edge(banned: number[][], level: number, from_id: number, to_id: number): void {
	if (from_id === to_id) {
		return;
	}
	const edge = pack_edge(from_id, to_id);
	const list = banned[level];
	if (list && !list.includes(edge)) {
		list.push(edge);
	}
}

function Find_Path_Hierarchical(
	graph: PathGraph,
	from: Point2D,
	to: Point2D,
	stamp: number,
	banned: number[][],
	paths: number[][],
	avoid: number,
): number[] | null {
	const start_cell = graph_cell(graph, from);
	const end_cell = graph_cell(graph, to);
	if (!start_cell || !end_cell) {
		return null;
	}
	const on_path: number[][] = [];
	const dodge = avoid > 0.00001;
	for (let level = SUBZONE_COARSE; level >= SUBZONE_FINE; level--) {
		const tracking = graph.tracking[level] ?? [];
		const opened = new Array(tracking.length).fill(0);
		const costs = new Array(tracking.length).fill(0);
		const final_ids = on_path[level + 1];
		const stamps = new Array(tracking.length).fill(0);
		on_path[level] = stamps;
		const start_id = start_cell.subzone[level] ?? 0;
		const end_id = end_cell.subzone[level] ?? 0;
		if (start_id <= 0 || end_id <= 0 || start_id >= tracking.length || end_id >= tracking.length) {
			return null;
		}
		stamps[start_id] = stamp;
		stamps[end_id] = stamp;
		if (start_id === end_id) {
			paths[level] = [start_id];
			continue;
		}
		const pool: HierNode[] = [];
		const heap = new ScoreHeap();
		const start_node: HierNode = { index: 0, parent: -1, subzone: start_id, score: 0, depth: 0 };
		pool.push(start_node);
		heap.insert(start_node);
		opened[start_id] = stamp;
		costs[start_id] = 0;
		let best: HierNode | null = heap.extract_min();
		const coarse = level === SUBZONE_COARSE;
		const no_banned = (banned[level]?.length ?? 0) === 0;
		while (best) {
			if (best.subzone === end_id) {
				break;
			}
			const record = tracking[best.subzone];
			if (!record) {
				best = heap.extract_min();
				continue;
			}
			for (const conn of record.connections) {
				const to_id = conn.id;
				const dest = tracking[to_id];
				if (!dest) {
					continue;
				}
				const parent = dest.parent;
				if (NORMAL_PASS[dest.passability] !== TRAVERSAL_PASSABLE) {
					continue;
				}
				if (!coarse && final_ids && (final_ids[parent] ?? 0) !== stamp && dest.passability !== PASSABLE_CRUSH) {
					continue;
				}
				const threat = dodge ? region_threat(graph, level, best.subzone, to_id) * avoid : 0;
				const extra = conn.cross ? 0.001 : 0;
				const score = (PASS_SCORES[dest.passability] ?? 1) + best.score + threat + extra;
				if (opened[to_id] === stamp && costs[to_id] <= score) {
					continue;
				}
				if (!no_banned && edge_banned(banned, level, best.subzone, to_id)) {
					continue;
				}
				const node: HierNode = {
					index: pool.length,
					parent: best.index,
					subzone: to_id,
					score,
					depth: best.depth + 1,
				};
				pool.push(node);
				heap.insert(node);
				opened[to_id] = stamp;
				costs[to_id] = score;
			}
			best = heap.extract_min();
		}
		if (!best || best.subzone !== end_id) {
			return null;
		}
		const ordered: number[] = new Array(best.depth + 1);
		let walk: HierNode | null = best;
		while (walk) {
			stamps[walk.subzone] = stamp;
			ordered[walk.depth] = walk.subzone;
			walk = walk.parent === -1 ? null : (pool[walk.parent] ?? null);
		}
		paths[level] = ordered;
	}
	return on_path[SUBZONE_FINE] ?? null;
}

function Ban_Blocked_Subzone_Edges(
	graph: PathGraph,
	last: Point2D,
	paths: number[][],
	banned: number[][],
	can_enter: PathEnter,
): boolean {
	let hs_on = true;
	for (let level = 0; level < SUBZONE_COUNT; level++) {
		const result = reachable_subzones(graph, last, level, can_enter);
		if (result.cut_off) {
			if (!Ban_Neighborhood_Subzone_Edges(graph, last, level, paths, banned)) {
				hs_on = false;
			}
			continue;
		}
		const from_id = graph_cell(graph, last)?.subzone[level] ?? 0;
		for (const to_id of result.unreachable) {
			ban_edge(banned, level, from_id, to_id);
		}
	}
	return hs_on;
}

function Ban_Neighborhood_Subzone_Edges(
	graph: PathGraph,
	last: Point2D,
	level: number,
	paths: number[][],
	banned: number[][],
): boolean {
	const path = paths[level] ?? [];
	if (path.length <= 1) {
		return false;
	}
	const stuck = graph_cell(graph, last)?.subzone[level] ?? 0;
	let index = -1;
	for (let i = 0; i < path.length; i++) {
		if (path[i] === stuck) {
			index = i;
			break;
		}
	}
	if (index < 0) {
		return false;
	}
	let path_node: number;
	let path_neighbor: number;
	if (index === path.length - 1) {
		path_node = path[index]!;
		path_neighbor = path[index - 1]!;
	} else {
		path_node = path[index + 1]!;
		path_neighbor = path[index]!;
	}
	ban_edge(banned, level, path_node, path_neighbor);
	const tracking = graph.tracking[level] ?? [];
	const node_conn = tracking[path_node]?.connections ?? [];
	const neighbor_conn = tracking[path_neighbor]?.connections ?? [];
	for (const conn of node_conn) {
		if (conn.id === path_neighbor) {
			continue;
		}
		if (neighbor_conn.some((other) => other.id === conn.id)) {
			ban_edge(banned, level, path_neighbor, conn.id);
		}
	}
	return true;
}

function reachable_subzones(
	graph: PathGraph,
	cell: Point2D,
	level: number,
	can_enter: PathEnter,
): { cut_off: boolean; unreachable: number[] } {
	const size = 1 << (level + 1);
	const origin = { x: cell.x & ~(size - 1), y: cell.y & ~(size - 1) };
	const start_id = graph_cell(graph, cell)?.subzone[level] ?? 0;
	const visited = new Set<string>();
	const reached = new Set<number>();
	const queue = [cell];
	visited.add(cell_key(cell.x, cell.y));
	for (let i = 0; i < queue.length; i++) {
		const here = queue[i]!;
		for (let dir = 0; dir < FACING_COUNT; dir++) {
			const next = Adjacent_Cell(here, dir);
			if (next.x < origin.x || next.y < origin.y || next.x >= origin.x + size || next.y >= origin.y + size) {
				continue;
			}
			const marked = graph_cell(graph, next);
			if (!marked) {
				continue;
			}
			const sid = marked.subzone[level] ?? 0;
			if (sid === start_id) {
				if (!can_enter(here, next, dir)) {
					continue;
				}
				const id = cell_key(next.x, next.y);
				if (!visited.has(id)) {
					visited.add(id);
					queue.push(next);
				}
			} else if (sid > 0) {
				reached.add(sid);
			}
		}
	}
	let cut_off = false;
	for (const [id, marked] of graph.cells) {
		if ((marked.subzone[level] ?? 0) !== start_id) {
			continue;
		}
		const [xs, ys] = id.split(",");
		const x = Number(xs);
		const y = Number(ys);
		if (x < origin.x || y < origin.y || x >= origin.x + size || y >= origin.y + size) {
			continue;
		}
		if (!visited.has(id)) {
			cut_off = true;
			break;
		}
	}
	const unreachable: number[] = [];
	const record = graph.tracking[level]?.[start_id];
	if (record) {
		for (const conn of record.connections) {
			if (!reached.has(conn.id)) {
				unreachable.push(conn.id);
			}
		}
	}
	return { cut_off, unreachable };
}

function Cut_Corners(source: Point2D, moves: number[], can_enter: PathEnter, graph: PathGraph | null): void {
	let max_len = moves.length - 1;
	let leg1_dir = FACING_NONE;
	let found_corner = false;
	let leg1_start = 0;
	let leg1_len = 0;
	let leg2_start = 0;
	let leg2_len = 0;
	let leg2_dir = FACING_NONE;
	let start_cell = { ...source };
	let cursor_cell = { ...source };
	while (leg1_start + leg1_len < max_len && leg2_start + leg2_len < max_len) {
		if (!found_corner) {
			const move_dir = moves[leg1_start + leg1_len] ?? END;
			const turn = Facing_Sub(move_dir, leg1_dir);
			if (move_dir === leg1_dir) {
				leg1_len += 1;
			} else if (
				(turn === FACING_90 || turn === FACING_270) &&
				leg1_dir !== FACING_NONE &&
				leg1_dir !== TUNNEL &&
				move_dir !== TUNNEL
			) {
				found_corner = true;
				leg2_dir = move_dir;
				leg2_len = 1;
				leg2_start = leg1_start + leg1_len;
			} else {
				leg1_start += leg1_len;
				leg1_len = 1;
				leg1_dir = move_dir & 1 ? move_dir : FACING_NONE;
				start_cell = { ...cursor_cell };
			}
			if (move_dir === TUNNEL && graph) {
				const tube = tube_at(graph, cursor_cell);
				if (tube) {
					cursor_cell = { ...tube.exit };
				}
			} else if (move_dir >= 0 && move_dir < FACING_COUNT) {
				cursor_cell = Adjacent_Cell(cursor_cell, move_dir);
			}
		} else if (moves[leg2_len + leg2_start] === leg2_dir) {
			leg2_len += 1;
		} else {
			const used = Try_Diagonal_Shortcut(moves, leg1_start, leg1_len, leg2_len, start_cell, can_enter, graph);
			start_cell = Follow_Path(start_cell, used, moves.slice(leg1_start), graph);
			leg1_start += used;
			leg1_len = 1;
			found_corner = false;
			const next = moves[leg1_start];
			if (next !== undefined && next >= 0 && next < FACING_COUNT) {
				cursor_cell = Adjacent_Cell(start_cell, next);
				leg1_dir = next;
			}
		}
	}
	if (found_corner) {
		Try_Diagonal_Shortcut(moves, leg1_start, leg1_len, leg2_len, start_cell, can_enter, graph);
	}
}

function Try_Diagonal_Shortcut(
	moves: number[],
	leg1_start: number,
	initial_first: number,
	initial_second: number,
	cell: Point2D,
	can_enter: PathEnter,
	graph: PathGraph | null,
): number {
	let first_len = initial_first;
	let second_len = initial_second;
	const first_dir = moves[leg1_start] ?? FACING_N;
	const second_dir = moves[leg1_start + first_len] ?? FACING_N;
	let diagonal = (first_dir + second_dir) >> 1;
	if (diagonal + FACING_45 !== second_dir && diagonal + FACING_45 !== first_dir) {
		diagonal = FACING_N;
	}
	if (first_dir === TUNNEL || second_dir === TUNNEL) {
		return first_len + second_len;
	}
	let diagonal_start = { ...cell };
	const max_diag = second_len;
	second_len = first_len < max_diag ? first_len : max_diag;
	if (second_len < first_len) {
		diagonal_start = Follow_Path(diagonal_start, first_len - second_len, moves.slice(leg1_start), graph);
	}
	while (second_len > 0) {
		let remaining = second_len * 2;
		let blocked = false;
		let prev = { ...diagonal_start };
		let scan = Adjacent_Cell(diagonal_start, diagonal);
		while (!blocked && remaining > 0) {
			if (!can_enter(prev, scan, diagonal)) {
				blocked = true;
			}
			remaining -= 1;
			prev = scan;
			scan = Adjacent_Cell(scan, diagonal);
		}
		if (!blocked) {
			const offset = leg1_start + first_len - second_len;
			for (let i = 0; i < 2 * second_len; i++) {
				moves[offset + i] = diagonal;
			}
			return first_len - second_len;
		}
		diagonal_start = Adjacent_Cell(diagonal_start, first_dir);
		second_len -= 1;
	}
	return first_len;
}

function Optimize_Moves(source: Point2D, moves: number[], can_enter: PathEnter, graph: PathGraph | null): void {
	const max_len = moves.length - 1;
	let cursor = { ...source };
	let scan_index = 0;
	let prev_turn = 0;
	let last_turn = 0;
	let max_axis_extent = 0;
	let path_offset = { x: 0, y: 0 };
	let last_turn_cell: Point2D | null = null;
	let max_dev_x = 0;
	let max_dev_y = 0;
	let candidate = { x: 0, y: 0 };
	while (scan_index < max_len && scan_index < 20) {
		const move = moves[scan_index] ?? END;
		if (move === TUNNEL) {
			if (graph) {
				const tube = tube_at(graph, cursor);
				if (tube) {
					cursor = { ...tube.exit };
				}
			}
			candidate = { x: 0, y: 0 };
			scan_index += 1;
			prev_turn = scan_index;
			max_axis_extent = 0;
			max_dev_x = 0;
			max_dev_y = 0;
			path_offset = { x: 0, y: 0 };
			last_turn = scan_index;
			last_turn_cell = { x: 0, y: 0 };
			continue;
		}
		if (move === EMPTY) {
			scan_index += 1;
			continue;
		}
		if (move < 0 || move >= FACING_COUNT) {
			break;
		}
		const new_offset = Adjacent_Cell(path_offset, move);
		const new_candidate = Adjacent_Cell(candidate, move);
		if (Math.abs(new_candidate.x) >= max_dev_x && Math.abs(new_candidate.y) >= max_dev_y) {
			candidate = new_candidate;
			max_dev_x = Math.abs(new_candidate.x);
			max_dev_y = Math.abs(new_candidate.y);
			const max_axis = Math.max(Math.abs(new_offset.x), Math.abs(new_offset.y));
			cursor = Adjacent_Cell(cursor, move);
			if (max_axis_extent < max_axis) {
				max_axis_extent = max_axis;
			} else {
				const spliced = Splice_Path(moves, scan_index, prev_turn, cursor);
				Plot_Straight_Line(
					moves,
					spliced.index,
					scan_index - spliced.index + 1,
					spliced.cell,
					{ x: cursor.x - spliced.cell.x, y: cursor.y - spliced.cell.y },
					can_enter,
					false,
				);
			}
			path_offset = new_offset;
			scan_index += 1;
		} else if (!last_turn_cell || (last_turn_cell.x === 0 && last_turn_cell.y === 0)) {
			max_dev_x = 0;
			max_dev_y = 0;
			last_turn_cell = { ...cursor };
			last_turn = scan_index;
			candidate = { x: 0, y: 0 };
		} else {
			prev_turn = last_turn;
			path_offset = { x: last_turn_cell.x - cursor.x, y: last_turn_cell.y - cursor.y };
			max_dev_x = 0;
			max_dev_y = 0;
			candidate = { x: 0, y: 0 };
			max_axis_extent = Math.max(Math.abs(path_offset.x), Math.abs(path_offset.y));
			last_turn_cell = { ...cursor };
			last_turn = scan_index;
		}
	}
	if (last_turn_cell && !(last_turn_cell.x === 0 && last_turn_cell.y === 0)) {
		const diff = { x: cursor.x - last_turn_cell.x, y: cursor.y - last_turn_cell.y };
		const max_axis = Math.max(Math.abs(diff.x), Math.abs(diff.y));
		if (scan_index - last_turn - 1 > max_axis) {
			scan_index -= 1;
			const spliced = Splice_Path(moves, scan_index, last_turn, cursor);
			Plot_Straight_Line(
				moves,
				spliced.index,
				scan_index - spliced.index + 1,
				spliced.cell,
				{ x: cursor.x - spliced.cell.x, y: cursor.y - spliced.cell.y },
				can_enter,
				true,
			);
		}
	}
	let write = 0;
	let read = 0;
	while (read < max_len && moves[read] !== END) {
		const dir = moves[read]!;
		if (dir !== EMPTY) {
			moves[write] = dir;
			write += 1;
		}
		read += 1;
	}
	let fill = write;
	while (fill < moves.length) {
		moves[fill] = END;
		fill += 1;
	}
}

function Splice_Path(
	moves: number[],
	start_index: number,
	end_index: number,
	cell: Point2D,
): { index: number; cell: Point2D } {
	let max_radius = 0;
	let displacement = { x: 0, y: 0 };
	let cur = start_index;
	let base = { ...cell };
	let found = false;
	while (cur >= end_index) {
		if (moves[cur] === EMPTY) {
			cur -= 1;
			continue;
		}
		const dir = moves[cur] ?? FACING_N;
		const back = Facing_Sub(dir, 4);
		displacement = Adjacent_Cell(displacement, back);
		base = Adjacent_Cell(base, back);
		const radius = Math.max(Math.abs(displacement.x), Math.abs(displacement.y));
		if (radius > max_radius) {
			if (found) {
				return {
					index: cur + 1,
					cell: Adjacent_Cell(base, Facing_Sub(back, 4)),
				};
			}
			max_radius = radius;
		} else {
			found = true;
		}
		cur -= 1;
	}
	return { index: end_index, cell: base };
}

function Plot_Straight_Line(
	moves: number[],
	offset: number,
	move_count: number,
	from: Point2D,
	to: Point2D,
	can_enter: PathEnter,
	_fearless: boolean,
): boolean {
	let first_dir = to.x < 0 ? (to.y < 0 ? 7 : 5) : to.y < 0 ? 1 : 3;
	const sub_xy = to.x - to.y;
	const sum_xy = to.x + to.y;
	let second_dir = sub_xy > 0 ? (sum_xy > 0 ? FACING_E : FACING_N) : sum_xy > 0 ? 4 : 6;
	const x_dist = Math.abs(to.x);
	const y_dist = Math.abs(to.y);
	let first_dist = Math.min(x_dist, y_dist);
	let second_dist = Math.max(x_dist, y_dist) - first_dist;
	let tries = 0;
	while (tries < 2) {
		let blocked = false;
		if (first_dist !== 0) {
			let current = { ...from };
			let prev = { ...from };
			let count1 = first_dist;
			let count2 = second_dist;
			while (count1 > 0 && !blocked) {
				current = Adjacent_Cell(current, first_dir);
				blocked = !can_enter(prev, current, first_dir);
				prev = current;
				count1 -= 1;
			}
			while (count2 > 0 && !blocked) {
				current = Adjacent_Cell(current, second_dir);
				blocked = !can_enter(prev, current, second_dir);
				prev = current;
				count2 -= 1;
			}
		}
		if (first_dist === 0 || blocked) {
			const swap_dir = second_dir;
			second_dir = first_dir;
			first_dir = swap_dir;
			const swap_dist = second_dist;
			second_dist = first_dist;
			first_dist = swap_dist;
		} else {
			for (let i = 0; i < first_dist; i++) {
				moves[offset + i] = first_dir;
			}
			for (let i = 0; i < second_dist; i++) {
				moves[offset + first_dist + i] = second_dir;
			}
			for (let i = 0; i < move_count - first_dist - second_dist; i++) {
				moves[offset + first_dist + second_dist + i] = EMPTY;
			}
			return true;
		}
		tries += 1;
	}
	return false;
}
