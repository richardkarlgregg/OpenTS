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

import { build_hicolor_pixel, DSurface } from "./surface";

export type ShapeFrame = {
	x: number;
	y: number;
	width: number;
	height: number;
	pixels: Uint8Array;
};

export type ShapeSet = {
	width: number;
	height: number;
	frames: ShapeFrame[];
};

const RECORD_SIZE = 24;
const HEADER_SIZE = 8;
const SFLAG_RLE = 0x02;

function rle_line(source: Uint8Array, offset: number, dest: Uint8Array): number {
	if (offset + 2 > source.length) {
		return offset;
	}
	const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
	const line_bytes = view.getUint16(offset, true);
	const end = Math.min(source.length, offset + line_bytes);
	let ip = offset + 2;
	let op = 0;
	while (ip < end && op < dest.length) {
		const value = source[ip++]!;
		if (value === 0) {
			if (ip >= end) {
				break;
			}
			const run = source[ip++]!;
			const used = Math.min(run, dest.length - op);
			dest.fill(0, op, op + used);
			op += used;
		} else {
			dest[op++] = value;
		}
	}
	return offset + Math.max(2, line_bytes);
}

export function read_shp(bytes: Uint8Array): ShapeSet | null {
	if (bytes.length < HEADER_SIZE) {
		return null;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = view.getInt16(2, true);
	const height = view.getInt16(4, true);
	const count = view.getInt16(6, true);
	if (width <= 0 || height <= 0 || count <= 0 || count > 4096) {
		return null;
	}
	if (HEADER_SIZE + count * RECORD_SIZE > bytes.length) {
		return null;
	}
	const frames: ShapeFrame[] = [];
	for (let i = 0; i < count; i++) {
		const rec = HEADER_SIZE + i * RECORD_SIZE;
		const x = view.getInt16(rec, true);
		const y = view.getInt16(rec + 2, true);
		const fw = view.getInt16(rec + 4, true);
		const fh = view.getInt16(rec + 6, true);
		const flags = view.getUint16(rec + 8, true);
		const data = view.getInt32(rec + 20, true);
		if (fw <= 0 || fh <= 0 || data <= 0 || data >= bytes.length) {
			frames.push({ x: 0, y: 0, width: 0, height: 0, pixels: new Uint8Array(0) });
			continue;
		}
		const pixels = new Uint8Array(fw * fh);
		if ((flags & SFLAG_RLE) !== 0) {
			let offset = data;
			for (let row = 0; row < fh; row++) {
				offset = rle_line(bytes, offset, pixels.subarray(row * fw, (row + 1) * fw));
			}
		} else {
			const need = fw * fh;
			if (data + need > bytes.length) {
				frames.push({ x: 0, y: 0, width: 0, height: 0, pixels: new Uint8Array(0) });
				continue;
			}
			pixels.set(bytes.subarray(data, data + need));
		}
		frames.push({ x, y, width: fw, height: fh, pixels });
	}
	return { width, height, frames };
}

export function read_palette(bytes: Uint8Array): Uint16Array {
	const palette = new Uint16Array(256);
	if (bytes.length < 768) {
		for (let i = 0; i < 256; i++) {
			palette[i] = build_hicolor_pixel(i, 255 - i, (i << 2) & 0xff);
		}
		return palette;
	}
	for (let i = 0; i < 256; i++) {
		palette[i] = build_hicolor_pixel(
			(bytes[i * 3]! << 2) & 0xff,
			(bytes[i * 3 + 1]! << 2) & 0xff,
			(bytes[i * 3 + 2]! << 2) & 0xff,
		);
	}
	return palette;
}

export function blit_shape(
	dest: DSurface,
	palette: Uint16Array,
	shape: ShapeSet,
	frame: number,
	x: number,
	y: number,
	center: boolean,
): void {
	if (shape.frames.length === 0) {
		return;
	}
	const index = ((frame % shape.frames.length) + shape.frames.length) % shape.frames.length;
	const rec = shape.frames[index]!;
	if (rec.width <= 0 || rec.height <= 0) {
		return;
	}
	let dx = x;
	let dy = y;
	if (center) {
		dx -= shape.width >> 1;
		dy -= shape.height >> 1;
	}
	dx += rec.x;
	dy += rec.y;
	for (let row = 0; row < rec.height; row++) {
		const sy = dy + row;
		if (sy < 0 || sy >= dest.height) {
			continue;
		}
		const src_row = row * rec.width;
		const dest_row = sy * dest.width;
		for (let col = 0; col < rec.width; col++) {
			const pixel = rec.pixels[src_row + col]!;
			if (pixel === 0) {
				continue;
			}
			const sx = dx + col;
			if (sx < 0 || sx >= dest.width) {
				continue;
			}
			dest.pixels[dest_row + sx] = palette[pixel]!;
		}
	}
}

export function blit_shape_translucent50(
	dest: DSurface,
	palette: Uint16Array,
	shape: ShapeSet,
	frame: number,
	x: number,
	y: number,
	clip: { x: number; y: number; w: number; h: number } | null = null,
): void {
	if (shape.frames.length === 0) {
		return;
	}
	const index = ((frame % shape.frames.length) + shape.frames.length) % shape.frames.length;
	const rec = shape.frames[index]!;
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
			if (pixel === 0) {
				continue;
			}
			const sx = dx + col;
			if (sx < 0 || sx >= dest.width) {
				continue;
			}
			if (clip && (sx < clip.x || sx >= clip.x + clip.w || sy < clip.y || sy >= clip.y + clip.h)) {
				continue;
			}
			const src = palette[pixel]!;
			const dst = dest.pixels[dest_row + sx]!;
			dest.pixels[dest_row + sx] = ((src & 0xf7de) >> 1) + ((dst & 0xf7de) >> 1);
		}
	}
}

const DARKEN_MASK = 0x7bef;

export function blit_shape_shadow(dest: DSurface, shape: ShapeSet, frame: number, x: number, y: number, center: boolean): void {
	if (shape.frames.length < 2) {
		return;
	}
	const half = shape.frames.length >> 1;
	if (frame >= half) {
		return;
	}
	blit_shape_mask(dest, shape, frame + half, x, y, center);
}

function blit_shape_mask(dest: DSurface, shape: ShapeSet, frame: number, x: number, y: number, center: boolean): void {
	if (shape.frames.length === 0) {
		return;
	}
	const index = ((frame % shape.frames.length) + shape.frames.length) % shape.frames.length;
	const rec = shape.frames[index]!;
	if (rec.width <= 0 || rec.height <= 0) {
		return;
	}
	let dx = x;
	let dy = y;
	if (center) {
		dx -= shape.width >> 1;
		dy -= shape.height >> 1;
	}
	dx += rec.x;
	dy += rec.y;
	for (let row = 0; row < rec.height; row++) {
		const sy = dy + row;
		if (sy < 0 || sy >= dest.height) {
			continue;
		}
		const src_row = row * rec.width;
		const dest_row = sy * dest.width;
		for (let col = 0; col < rec.width; col++) {
			if (rec.pixels[src_row + col]! === 0) {
				continue;
			}
			const sx = dx + col;
			if (sx < 0 || sx >= dest.width) {
				continue;
			}
			dest.pixels[dest_row + sx] = ((dest.pixels[dest_row + sx]! >> 1) & DARKEN_MASK) as number;
		}
	}
}
