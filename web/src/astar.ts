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

const FACING_COUNT = 8;
const FACING_NONE = 8;

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

function Adjacent_Cell(cell: Point2D, dir: number): Point2D {
	const step = ADJACENT_CELL[dir] ?? [0, 0];
	return { x: cell.x + step[0], y: cell.y + step[1] };
}

const MAX_LOOPS = 8000;
const MAX_OPEN = 65536;

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

function cell_key(x: number, y: number): string {
	return `${x},${y}`;
}

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

export function Find_Path_Regular(from: Point2D, to: Point2D, can_enter: PathEnter, maxlen = 200): number[] {
	if (from.x === to.x && from.y === to.y) {
		return [];
	}
	const open = new OpenHeap();
	const best = new Map<string, number>();
	const start: RegularNode = {
		x: from.x,
		y: from.y,
		parent: null,
		dir: FACING_NONE,
		g: 0,
		f: heuristic(from, to),
		length: 1,
		heap: 0,
	};
	best.set(cell_key(from.x, from.y), 0);
	open.insert(start);
	let found: RegularNode | null = null;
	let tries = 0;
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
		for (let dir = 0; dir < FACING_COUNT; dir++) {
			const next = Adjacent_Cell(here, dir);
			if (!can_enter(here, next, dir)) {
				continue;
			}
			const g = working.g + MOVE_OK_COST + (FACING_COSTS[dir] ?? 0);
			const id = cell_key(next.x, next.y);
			const prior = best.get(id);
			if (prior !== undefined && prior <= g + 0.009) {
				continue;
			}
			best.set(id, g);
			const node: RegularNode = {
				x: next.x,
				y: next.y,
				parent: working,
				dir,
				g,
				f: g + heuristic(next, to),
				length: working.length + 1,
				heap: 0,
			};
			open.insert(node);
		}
		tries += 1;
	}
	if (!found || found.length < 2) {
		return [];
	}
	const steps: number[] = [];
	let node: RegularNode | null = found;
	while (node && node.parent) {
		steps.push(node.dir);
		node = node.parent;
		if (steps.length > maxlen) {
			return [];
		}
	}
	steps.reverse();
	return steps;
}

function heuristic(from: Point2D, to: Point2D): number {
	const dx = from.x - to.x;
	const dy = from.y - to.y;
	return Math.sqrt(dx * dx + dy * dy);
}
