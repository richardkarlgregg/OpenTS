/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 * EA's GPLv3 Section 7 additional terms and supplemental warranty
 * disclaimers apply; see LICENSE.md.
 ******************************************************************************/

export const RED_RIGHT = 11;
export const RED_LEFT = 3;
export const GREEN_RIGHT = 5;
export const GREEN_LEFT = 2;
export const BLUE_RIGHT = 0;
export const BLUE_LEFT = 3;

export function build_hicolor_pixel(red: number, green: number, blue: number): number {
	return (
		((red >> RED_LEFT) << RED_RIGHT) |
		((green >> GREEN_LEFT) << GREEN_RIGHT) |
		((blue >> BLUE_LEFT) << BLUE_RIGHT)
	) & 0xffff;
}

export function unpack_hicolor(color: number): [number, number, number] {
	const packed = color & 0xffff;
	return [
		((packed >> RED_RIGHT) & 0x1f) << RED_LEFT,
		((packed >> GREEN_RIGHT) & 0x3f) << GREEN_LEFT,
		((packed >> BLUE_RIGHT) & 0x1f) << BLUE_LEFT,
	];
}

export class DSurface {
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint16Array;

	constructor(width: number, height: number, pixels?: Uint16Array) {
		this.width = width;
		this.height = height;
		this.pixels = pixels ?? new Uint16Array(width * height);
	}

	fill(color: number): void {
		this.pixels.fill(color & 0xffff);
	}

	fill_rect(x: number, y: number, width: number, height: number, color: number): void {
		const packed = color & 0xffff;
		const x0 = Math.max(0, x);
		const y0 = Math.max(0, y);
		const x1 = Math.min(this.width, x + width);
		const y1 = Math.min(this.height, y + height);
		for (let row = y0; row < y1; row++) {
			const start = row * this.width + x0;
			this.pixels.fill(packed, start, start + (x1 - x0));
		}
	}

	put_pixel(x: number, y: number, color: number): void {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
			return;
		}
		this.pixels[y * this.width + x] = color & 0xffff;
	}

	clone(): DSurface {
		return new DSurface(this.width, this.height, this.pixels.slice());
	}

	blit_from(dx: number, dy: number, source: DSurface, sx = 0, sy = 0, sw = source.width, sh = source.height): void {
		const x0 = Math.max(0, dx);
		const y0 = Math.max(0, dy);
		const x1 = Math.min(this.width, dx + sw);
		const y1 = Math.min(this.height, dy + sh);
		const src_x0 = sx + (x0 - dx);
		const src_y0 = sy + (y0 - dy);
		for (let y = y0; y < y1; y++) {
			const dest_row = y * this.width + x0;
			const src_row = (src_y0 + (y - y0)) * source.width + src_x0;
			this.pixels.set(source.pixels.subarray(src_row, src_row + (x1 - x0)), dest_row);
		}
	}
}
