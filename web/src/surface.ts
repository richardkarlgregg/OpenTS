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
	readonly depth: Uint16Array;

	constructor(width: number, height: number, pixels?: Uint16Array) {
		this.width = width;
		this.height = height;
		this.pixels = pixels ?? new Uint16Array(width * height);
		this.depth = new Uint16Array(width * height);
		this.depth.fill(0xffff);
	}

	fill(color: number): void {
		this.pixels.fill(color & 0xffff);
		this.depth.fill(0xffff);
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

	draw_line(x0: number, y0: number, x1: number, y1: number, color: number): void {
		const packed = color & 0xffff;
		let dx = Math.abs(x1 - x0);
		let dy = -Math.abs(y1 - y0);
		const sx = x0 < x1 ? 1 : -1;
		const sy = y0 < y1 ? 1 : -1;
		let err = dx + dy;
		let x = x0;
		let y = y0;
		for (;;) {
			this.put_pixel(x, y, packed);
			if (x === x1 && y === y1) {
				break;
			}
			const e2 = err * 2;
			if (e2 >= dy) {
				err += dy;
				x += sx;
			}
			if (e2 <= dx) {
				err += dx;
				y += sy;
			}
		}
	}

	draw_dashed_line(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		color: number,
		pattern: readonly boolean[],
		offset: number,
	): number {
		const packed = color & 0xffff;
		const period = Math.max(1, pattern.length);
		let dx = Math.abs(x1 - x0);
		let dy = -Math.abs(y1 - y0);
		const sx = x0 < x1 ? 1 : -1;
		const sy = y0 < y1 ? 1 : -1;
		let err = dx + dy;
		let x = x0;
		let y = y0;
		let step = offset % period;
		if (step < 0) {
			step += period;
		}
		for (;;) {
			if (pattern[step]) {
				this.put_pixel(x, y, packed);
			}
			step += 1;
			if (step >= period) {
				step = 0;
			}
			if (x === x1 && y === y1) {
				break;
			}
			const e2 = err * 2;
			if (e2 >= dy) {
				err += dy;
				x += sx;
			}
			if (e2 <= dx) {
				err += dx;
				y += sy;
			}
		}
		return step;
	}

	draw_rect(x: number, y: number, width: number, height: number, color: number): void {
		if (width <= 0 || height <= 0) {
			return;
		}
		const x1 = x + width - 1;
		const y1 = y + height - 1;
		this.draw_line(x, y, x1, y, color);
		this.draw_line(x1, y, x1, y1, color);
		this.draw_line(x1, y1, x, y1, color);
		this.draw_line(x, y1, x, y, color);
	}

	Draw_Depth_Shaded_Line(
		startpoint: { x: number; y: number },
		endpoint: { x: number; y: number },
		color: number,
		start_depth: number,
		end_depth: number,
		write_depth = false,
	): void {
		let start = { x: startpoint.x, y: startpoint.y };
		let end = { x: endpoint.x, y: endpoint.y };
		let zfirst = start_depth;
		let zlast = end_depth;
		if (start.x > end.x) {
			start = { x: endpoint.x, y: endpoint.y };
			end = { x: startpoint.x, y: startpoint.y };
			zfirst = end_depth;
			zlast = start_depth;
		}
		const packed = color & 0xffff;
		const dy = end.y - start.y;
		const dx = end.x - start.x;
		const dz = zlast - zfirst;
		const abs_dy = Math.abs(dy);
		const abs_dz = Math.abs(dz);
		const ystep = dy < 0 ? -1 : 1;
		const zstep = dz < 0 ? -1 : 1;
		const plot = (x: number, y: number, z: number): void => {
			if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
				return;
			}
			const i = y * this.width + x;
			if ((z & 0xffff) >= this.depth[i]!) {
				return;
			}
			this.pixels[i] = packed;
			if (write_depth) {
				this.depth[i] = z & 0xffff;
			}
		};
		if (abs_dz > dx && abs_dz > abs_dy) {
			let xerr = 2 * abs_dy - abs_dz;
			let yerr = 2 * dx - abs_dz;
			let x = start.x;
			let y = start.y;
			let z = zfirst;
			for (let i = 0; i < abs_dz; i++) {
				plot(x, y, z);
				if (xerr > 0) {
					y += ystep;
					xerr -= 2 * abs_dz;
				}
				if (yerr > 0) {
					x += 1;
					yerr -= 2 * abs_dz;
				}
				z += zstep;
				yerr += 2 * dx;
				xerr += 2 * abs_dy;
			}
			return;
		}
		if (dx > abs_dy) {
			let yerr = 2 * abs_dy - dx;
			let zerr = 2 * abs_dz - dx;
			let y = start.y;
			let z = zfirst;
			for (let i = 0; i <= dx; i++) {
				plot(start.x + i, y, z);
				if (yerr > 0) {
					y += ystep;
					yerr -= 2 * dx;
				}
				if (zerr > 0) {
					z += zstep;
					zerr -= 2 * dx;
				}
				yerr += 2 * abs_dy;
				zerr += 2 * abs_dz;
			}
			return;
		}
		let xerr = 2 * dx - abs_dy;
		let zerr = 2 * abs_dz - abs_dy;
		let x = start.x;
		let z = zfirst;
		for (let i = 0; i <= abs_dy; i++) {
			plot(x, start.y + i * ystep, z);
			if (xerr > 0) {
				x += 1;
				xerr -= 2 * abs_dy;
			}
			if (zerr > 0) {
				z += zstep;
				zerr -= 2 * abs_dy;
			}
			xerr += 2 * dx;
			zerr += 2 * abs_dz;
		}
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
