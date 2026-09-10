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

import type { Point2D, Rect } from "./ini";
import { ISO_TILE_PIXEL_W } from "./isotile";
import type { ShapeSet } from "./shp";
import { build_hicolor_pixel, DSurface, unpack_hicolor } from "./surface";

export type SightLooker = {
	x: number;
	y: number;
	sight: number;
};

const MAP_CELL_W = 512;
const MAP_CELL_H = 512;
const ABUFFER_SKIP = 0xfe;
const ABUFFER_COLOR = 0x7f;
const SHROUD_BLACK_FRAME = 15;
const ADJACENT: readonly [number, number][] = [
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
];

const RADIUS: readonly [number, number][] = [
	[0, 0],
	[1, -1], [0, -1], [-1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
	[-1, -2], [0, -2], [1, -2], [-2, -1], [2, -1], [-2, 0], [2, 0], [-2, 1], [2, 1], [-1, 2], [0, 2], [1, 2],
	[-1, -3], [0, -3], [1, -3], [-2, -2], [2, -2], [-3, -1], [3, -1], [-3, 0], [3, 0], [-3, 1], [3, 1], [-2, 2], [2, 2], [-1, 3], [0, 3], [1, 3],
	[-1, -4], [0, -4], [1, -4], [-3, -3], [-2, -3], [2, -3], [3, -3], [-3, -2], [3, -2], [-4, -1], [4, -1], [-4, 0], [4, 0], [-4, 1], [4, 1], [-3, 2], [3, 2], [-3, 3], [-2, 3], [2, 3], [3, 3], [-1, 4], [0, 4], [1, 4],
	[-1, -5], [0, -5], [1, -5], [-3, -4], [-2, -4], [2, -4], [3, -4], [-4, -3], [4, -3], [-4, -2], [4, -2], [-5, -1], [5, -1], [-5, 0], [5, 0], [-5, 1], [5, 1], [-4, 2], [4, 2], [-4, 3], [4, 3], [-3, 4], [-2, 4], [2, 4], [3, 4], [-1, 5], [0, 5], [1, 5],
	[-1, -6], [0, -6], [1, -6], [-3, -5], [-2, -5], [2, -5], [3, -5], [-4, -4], [4, -4], [-5, -3], [5, -3], [-5, -2], [5, -2], [-6, -1], [6, -1], [-6, 0], [6, 0], [-6, 1], [6, 1], [-5, 2], [5, 2], [-5, 3], [5, 3], [-4, 4], [4, 4], [-3, 5], [-2, 5], [2, 5], [3, 5], [-1, 6], [0, 6], [1, 6],
	[-1, -7], [0, -7], [1, -7], [-3, -6], [-2, -6], [2, -6], [3, -6], [-5, -5], [-4, -5], [4, -5], [5, -5], [-5, -4], [5, -4], [-6, -3], [6, -3], [-6, -2], [6, -2], [-7, -1], [7, -1], [-7, 0], [7, 0], [-7, 1], [7, 1], [-6, 2], [6, 2], [-6, 3], [6, 3], [-5, 4], [5, 4], [-5, 5], [-4, 5], [4, 5], [5, 5], [-3, 6], [-2, 6], [2, 6], [3, 6], [-1, 7], [0, 7], [1, 7],
	[-1, -8], [0, -8], [1, -8], [-3, -7], [-2, -7], [2, -7], [3, -7], [-5, -6], [-4, -6], [4, -6], [5, -6], [-6, -5], [6, -5], [-6, -4], [6, -4], [-7, -3], [7, -3], [-7, -2], [7, -2], [-8, -1], [8, -1], [-8, 0], [8, 0], [-8, 1], [8, 1], [-7, 2], [7, 2], [-7, 3], [7, 3], [-6, 4], [6, 4], [-6, 5], [6, 5], [-5, 6], [-4, 6], [4, 6], [5, 6], [-3, 7], [-2, 7], [2, 7], [3, 7], [-1, 8], [0, 8], [1, 8],
	[-1, -9], [0, -9], [1, -9], [-3, -8], [-2, -8], [2, -8], [3, -8], [-5, -7], [-4, -7], [4, -7], [5, -7], [-6, -6], [6, -6], [-7, -5], [7, -5], [-7, -4], [7, -4], [-8, -3], [8, -3], [-8, -2], [8, -2], [-9, -1], [9, -1], [-9, 0], [9, 0], [-9, 1], [9, 1], [-8, 2], [8, 2], [-8, 3], [8, 3], [-7, 4], [7, 4], [-7, 5], [7, 5], [-6, 6], [6, 6], [-5, 7], [-4, 7], [4, 7], [5, 7], [-3, 8], [-2, 8], [2, 8], [3, 8], [-1, 9], [0, 9], [1, 9],
	[-1, -10], [0, -10], [1, -10], [-3, -9], [-2, -9], [2, -9], [3, -9], [-5, -8], [-4, -8], [4, -8], [5, -8], [-7, -7], [-6, -7], [6, -7], [7, -7], [-7, -6], [7, -6], [-8, -5], [8, -5], [-8, -4], [8, -4], [-9, -3], [9, -3], [-9, -2], [9, -2], [-10, -1], [10, -1], [-10, 0], [10, 0], [-10, 1], [10, 1], [-9, 2], [9, 2], [-9, 3], [9, 3], [-8, 4], [8, 4], [-8, 5], [8, 5], [-7, 6], [7, 6], [-7, 7], [-6, 7], [6, 7], [7, 7], [-5, 8], [-4, 8], [4, 8], [5, 8], [-3, 9], [-2, 9], [2, 9], [3, 9], [-1, 10], [0, 10], [1, 10],
];

const RADIUS_COUNT = [1, 9, 21, 37, 61, 89, 121, 161, 205, 253, 309];

const SHADOW = new Int8Array([
	-1, 33, 2, 2, 34, 37, 2, 2,
	4, 26, 6, 6, 4, 26, 6, 6,
	35, 45, 17, 17, 38, 41, 17, 17,
	4, 26, 6, 6, 4, 26, 6, 6,
	8, 21, 10, 10, 27, 31, 10, 10,
	12, 23, 14, 14, 12, 23, 14, 14,
	8, 21, 10, 10, 27, 31, 10, 10,
	12, 23, 14, 14, 12, 23, 14, 14,

	32, 36, 25, 25, 44, 40, 25, 25,
	19, 30, 20, 20, 19, 30, 20, 20,
	39, 43, 29, 29, 42, 46, 29, 29,
	19, 30, 20, 20, 19, 30, 20, 20,
	8, 21, 10, 10, 27, 31, 10, 10,
	12, 23, 14, 14, 12, 23, 14, 14,
	8, 21, 10, 10, 27, 31, 10, 10,
	12, 23, 14, 14, 12, 23, 14, 14,

	1, 1, 3, 3, 16, 16, 3, 3,
	5, 5, 7, 7, 5, 5, 7, 7,
	24, 24, 18, 18, 28, 28, 18, 18,
	5, 5, 7, 7, 5, 5, 7, 7,
	9, 9, 11, 11, 22, 22, 11, 11,
	13, 13, -2, -2, 13, 13, -2, -2,
	9, 9, 11, 11, 22, 22, 11, 11,
	13, 13, -2, -2, 13, 13, -2, -2,

	1, 1, 3, 3, 16, 16, 3, 3,
	5, 5, 7, 7, 5, 5, 7, 7,
	24, 24, 18, 18, 28, 28, 18, 18,
	5, 5, 7, 7, 5, 5, 7, 7,
	9, 9, 11, 11, 22, 22, 11, 11,
	13, 13, -2, -2, 13, 13, -2, -2,
	9, 9, 11, 11, 22, 22, 11, 11,
	13, 13, -2, -2, 13, 13, -2, -2,
]);

function in_map(x: number, y: number): boolean {
	return x >= 0 && y >= 0 && x < MAP_CELL_W && y < MAP_CELL_H;
}

function cell_index(x: number, y: number): number {
	return y * MAP_CELL_W + x;
}

function cell_distance(ax: number, ay: number, bx: number, by: number): number {
	const dx = ax - bx;
	const dy = ay - by;
	return Math.trunc(Math.sqrt(dx * dx + dy * dy));
}

function scale_hicolor(color: number, alpha: number): number {
	if (alpha === ABUFFER_COLOR) {
		return color;
	}
	if (alpha <= 0) {
		return 0;
	}
	const [red, green, blue] = unpack_hicolor(color);
	return build_hicolor_pixel(
		Math.min(255, ((red * alpha) / ABUFFER_COLOR) | 0),
		Math.min(255, ((green * alpha) / ABUFFER_COLOR) | 0),
		Math.min(255, ((blue * alpha) / ABUFFER_COLOR) | 0),
	);
}

export class ShroudMap {
	readonly mapped: Uint8Array;
	readonly visible: Uint8Array;
	readonly play: Rect;
	mapped_count = 0;

	constructor(play: Rect, lookers: SightLooker[]) {
		this.mapped = new Uint8Array(MAP_CELL_W * MAP_CELL_H);
		this.visible = new Uint8Array(MAP_CELL_W * MAP_CELL_H);
		this.play = play;
		for (const looker of lookers) {
			this.Sight_From(looker.x, looker.y, looker.sight);
		}
	}

	In_Radar(x: number, y: number): boolean {
		const w = this.play.width;
		const h = this.play.height;
		return x + y > w && x - y < w && y - x < w && x + y <= w + 2 * h;
	}

	IsMapped(x: number, y: number): boolean {
		if (!in_map(x, y)) {
			return false;
		}
		return this.mapped[cell_index(x, y)] !== 0;
	}

	Cell_Shadow(x: number, y: number): number {
		const mapped = this.IsMapped(x, y);
		const visible = in_map(x, y) && this.visible[cell_index(x, y)] !== 0;
		let value = -1;
		if (!visible && !mapped) {
			value = -2;
		}
		if (!mapped) {
			return value;
		}
		let index = 0;
		if (!this.IsMapped(x - 1, y - 1)) {
			index |= 0x40;
		}
		if (!this.IsMapped(x, y - 1)) {
			index |= 0x80;
		}
		if (!this.IsMapped(x + 1, y - 1)) {
			index |= 0x01;
		}
		if (!this.IsMapped(x - 1, y)) {
			index |= 0x20;
		}
		if (!this.IsMapped(x + 1, y)) {
			index |= 0x02;
		}
		if (!this.IsMapped(x - 1, y + 1)) {
			index |= 0x10;
		}
		if (!this.IsMapped(x, y + 1)) {
			index |= 0x08;
		}
		if (!this.IsMapped(x + 1, y + 1)) {
			index |= 0x04;
		}
		return SHADOW[index] ?? -1;
	}

	Map_Cell(x: number, y: number): void {
		if (!in_map(x, y) || !this.In_Radar(x, y)) {
			return;
		}
		const slot = cell_index(x, y);
		if (this.mapped[slot] === 0) {
			this.mapped[slot] = 1;
			this.mapped_count++;
		}
		if (this.Cell_Shadow(x, y) === -1) {
			this.visible[slot] = 1;
		}
		for (const dir of ADJACENT) {
			const nx = x + dir[0];
			const ny = y + dir[1];
			if (!in_map(nx, ny) || (nx === x && ny === y)) {
				continue;
			}
			const nslot = cell_index(nx, ny);
			if (this.visible[nslot] !== 0) {
				continue;
			}
			const shadow = this.Cell_Shadow(nx, ny);
			if (shadow === -1) {
				if (this.mapped[nslot] === 0) {
					this.Map_Cell(nx, ny);
				} else {
					this.visible[nslot] = 1;
				}
			} else if (shadow !== -2 && this.mapped[nslot] === 0) {
				this.Map_Cell(nx, ny);
			}
		}
	}

	Sight_From(x: number, y: number, sightrange: number): void {
		if (!this.In_Radar(x, y) || sightrange <= 0) {
			return;
		}
		const range = Math.min(sightrange | 0, 10);
		const count = RADIUS_COUNT[range] ?? 1;
		for (let i = 0; i < count; i++) {
			const offset = RADIUS[i];
			if (!offset) {
				continue;
			}
			const nx = x + offset[0];
			const ny = y + offset[1];
			if (!this.In_Radar(nx, ny)) {
				continue;
			}
			if (Math.abs(nx - x) > range) {
				continue;
			}
			if (cell_distance(nx, ny, x, y) > range) {
				continue;
			}
			if (!this.IsMapped(nx, ny) || this.visible[cell_index(nx, ny)] === 0) {
				this.Map_Cell(nx, ny);
			}
		}
	}
}

function blit_shroud_frame(dest: DSurface, shape: ShapeSet, frame: number, x: number, y: number): void {
	if (frame < 0 || frame >= shape.frames.length) {
		return;
	}
	const rec = shape.frames[frame]!;
	if (rec.width <= 0 || rec.height <= 0) {
		return;
	}
	const dx = x + rec.x;
	const dy = y + rec.y;
	for (let row = 0; row < rec.height; row++) {
		const sy = dy + row;
		if (sy < 0 || sy >= dest.height) {
			continue;
		}
		const src_row = row * rec.width;
		const dest_row = sy * dest.width;
		for (let col = 0; col < rec.width; col++) {
			const pixel = rec.pixels[src_row + col]!;
			if (pixel === ABUFFER_SKIP) {
				continue;
			}
			const sx = dx + col;
			if (sx < 0 || sx >= dest.width) {
				continue;
			}
			const slot = dest_row + sx;
			dest.pixels[slot] = scale_hicolor(dest.pixels[slot]!, pixel);
		}
	}
}

export function Draw_Shroud(
	dest: DSurface,
	origin: Point2D,
	cells: { x: number; y: number; height: number }[],
	cell_pixel: (cell: { x: number; y: number; height: number }) => Point2D,
	shroud: ShroudMap,
	shapes: ShapeSet | null,
): void {
	if (!shapes) {
		return;
	}
	for (const cell of cells) {
		const pixel = cell_pixel(cell);
		const dx = pixel.x - origin.x;
		const dy = pixel.y - origin.y;
		if (dx + ISO_TILE_PIXEL_W < -64 || dy + 160 < 0 || dx >= dest.width + 64 || dy >= dest.height + 64) {
			continue;
		}
		let frame = shroud.Cell_Shadow(cell.x, cell.y);
		if (frame === -1) {
			continue;
		}
		if (frame === -2) {
			frame = SHROUD_BLACK_FRAME;
		}
		blit_shroud_frame(dest, shapes, frame, dx, dy);
	}
}
