/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 ******************************************************************************/

import type { Point2D, Rect } from "./ini";
import { ISO_TILE_PIXEL_H, ISO_TILE_PIXEL_W } from "./isotile";
import { build_hicolor_pixel, unpack_hicolor, type DSurface } from "./surface";

export const SPOTLIGHT_RADIUS_STEP = 8;
export const SPOTLIGHT_MAX_RADIUS = 80;
export const SPOTLIGHT_SURFACE_COUNT = 64;
export const SPOTLIGHT_EXTRA_SURFACE_COUNT = 10;
const CELL_PIXEL_H = 48;
const EDGE_ZONE_W = ISO_TILE_PIXEL_W * 6;
const EDGE_ZONE_H = ISO_TILE_PIXEL_H * 6;

const INDEX_TABLE = new Int8Array([
	5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 61, 62, 63, 63, 63, 62, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51,
	50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22,
	21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73,
]);

const SpotLightSurfaces: Uint8Array[] = [];
let SpotLightRadiusUsed = -1;

export type Coord = { x: number; y: number; z: number };

function draw_span8(pixels: Uint8Array, width: number, x0: number, x1: number, y: number, color: number, clip: Rect): void {
	if (y < clip.y || y >= clip.y + clip.height) {
		return;
	}
	let left = Math.min(x0, x1);
	let right = Math.max(x0, x1);
	left = Math.max(left, clip.x);
	right = Math.min(right, clip.x + clip.width - 1);
	if (left > right) {
		return;
	}
	const packed = color & 255;
	const row = y * width;
	for (let x = left; x <= right; x++) {
		pixels[row + x] = packed;
	}
}

function Draw_Circle(pixels: Uint8Array, width: number, center: Point2D, radius: number, clip: Rect, color: number): void {
	let px = radius | 0;
	let py = 0;
	let d = 3 - 2 * radius;
	do {
		draw_span8(pixels, width, center.x - px, center.x + px, center.y + py, color, clip);
		draw_span8(pixels, width, center.x - py, center.x + py, center.y + px, color, clip);
		draw_span8(pixels, width, center.x - px, center.x + px, center.y - py, color, clip);
		draw_span8(pixels, width, center.x - py, center.x + py, center.y - px, color, clip);
		if (d < 0) {
			d += 4 * py + 6;
		} else {
			d += 4 * (py - px) + 10;
			px--;
		}
		py++;
	} while (px >= py);
}

function squash_circle(src: Uint8Array, dest: Uint8Array): void {
	for (let j = 0; j < 128; j++) {
		const dst = j * 256;
		const src_row = 2 * j * 256;
		dest.set(src.subarray(src_row, src_row + 255), dst);
	}
}

export function SpotLight_One_Time(spotlight_radius: number): void {
	if (SpotLightSurfaces.length > 0 && SpotLightRadiusUsed === spotlight_radius) {
		return;
	}
	SpotLightSurfaces.length = 0;
	SpotLightRadiusUsed = spotlight_radius;
	const clip: Rect = { x: 0, y: 0, width: 255, height: 255 };
	const center = { x: 128, y: 128 };
	const scale = CELL_PIXEL_H * spotlight_radius;
	for (let i = 0; i < SPOTLIGHT_EXTRA_SURFACE_COUNT; i++) {
		const big = new Uint8Array(256 * 256);
		Draw_Circle(big, 256, center, i - Math.trunc(scale / -358.4), clip, 128 - i * 6);
		const small = new Uint8Array(256 * 128);
		squash_circle(big, small);
		SpotLightSurfaces.push(small);
	}
}

function extra_surface(index: number): Uint8Array | null {
	const extra = index - SPOTLIGHT_SURFACE_COUNT;
	if (extra < 0 || extra >= SpotLightSurfaces.length) {
		return null;
	}
	return SpotLightSurfaces[extra]!;
}

export function Coord_In_View(pixel: Point2D, view: Rect): boolean {
	if (pixel.x < -EDGE_ZONE_W || pixel.x > view.width + EDGE_ZONE_W) {
		return false;
	}
	if (pixel.y < -EDGE_ZONE_H || pixel.y > view.height + EDGE_ZONE_H) {
		return false;
	}
	return true;
}

export function Draw_SpotLight(
	frame: DSurface,
	drawpoint: Point2D,
	radius: number,
	size: number,
	clip: Rect,
): void {
	if (SpotLightSurfaces.length === 0) {
		return;
	}
	const table = INDEX_TABLE[Math.max(0, Math.min(INDEX_TABLE.length - 1, radius | 0))] ?? 0;
	let index = table;
	if (index < SPOTLIGHT_SURFACE_COUNT) {
		index = Math.trunc((index * size) / SPOTLIGHT_SURFACE_COUNT);
	}
	const source = extra_surface(index);
	if (!source) {
		return;
	}
	const dest_x = drawpoint.x - 128;
	const dest_y = drawpoint.y - 64;
	const x0 = Math.max(clip.x, dest_x);
	const y0 = Math.max(clip.y, dest_y);
	const x1 = Math.min(clip.x + clip.width, dest_x + 255);
	const y1 = Math.min(clip.y + clip.height, dest_y + 127);
	if (x0 >= x1 || y0 >= y1) {
		return;
	}
	const src_x0 = x0 - dest_x;
	const src_y0 = y0 - dest_y;
	for (let y = y0; y < y1; y++) {
		const dest_row = y * frame.width + x0;
		const src_row = (src_y0 + (y - y0)) * 256 + src_x0;
		for (let x = 0; x < x1 - x0; x++) {
			const spixel = source[src_row + x] ?? 0;
			if (spixel === 0) {
				continue;
			}
			const i = dest_row + x;
			const [red, green, blue] = unpack_hicolor(frame.pixels[i]!);
			const rr = Math.min(255, red + ((red * spixel) >> 8));
			const gg = Math.min(255, green + ((green * spixel) >> 8));
			const bb = Math.min(255, blue + ((blue * spixel) >> 8));
			frame.pixels[i] = build_hicolor_pixel(rr, gg, bb);
		}
	}
}
