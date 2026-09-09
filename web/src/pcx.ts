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

import { build_hicolor_pixel, DSurface } from "./surface";

const PCX_HEADER_SIZE = 128;

export function read_pcx(bytes: Uint8Array): DSurface | null {
	if (bytes.length < PCX_HEADER_SIZE) {
		return null;
	}
	const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const id = header.getUint8(0);
	const version = header.getUint8(1);
	const encoding = header.getUint8(2);
	const pixelsize = header.getUint8(3);
	if (id !== 10 || version !== 5 || pixelsize !== 8) {
		return null;
	}

	const x = header.getUint16(4, true);
	const y = header.getUint16(6, true);
	const x1 = header.getUint16(8, true);
	const y1 = header.getUint16(10, true);
	const width = x1 - x + 1;
	const height = y1 - y + 1;
	const color_planes = header.getUint8(65);
	const byte_per_line = header.getUint16(66, true);
	if (width <= 0 || height <= 0 || (encoding !== 0 && encoding !== 1)) {
		return null;
	}

	const in_line = color_planes * byte_per_line;
	let cursor = PCX_HEADER_SIZE;

	const read_char = (): number => {
		if (cursor >= bytes.length) {
			return 0;
		}
		return bytes[cursor++]!;
	};

	const decode_line = (dest: Uint8Array): void => {
		let i = 0;
		while (i < in_line) {
			let rle = read_char();
			if ((rle & 192) === 192) {
				rle &= 63;
				const color = read_char();
				while (rle-- > 0 && i < in_line) {
					dest[i++] = color;
				}
			} else if (i < in_line) {
				dest[i++] = rle;
			}
		}
	};

	if (color_planes === 3) {
		const surface = new DSurface(width, height);
		const line = new Uint8Array(in_line);
		for (let row = 0; row < height; row++) {
			decode_line(line);
			const rptr = 0;
			const gptr = byte_per_line;
			const bptr = byte_per_line * 2;
			for (let col = 0; col < width; col++) {
				surface.pixels[row * width + col] = build_hicolor_pixel(
					line[rptr + col]!,
					line[gptr + col]!,
					line[bptr + col]!,
				);
			}
		}
		return surface;
	}

	if (color_planes !== 1) {
		return null;
	}

	const indexed = new Uint8Array(width * height);
	if (byte_per_line !== width) {
		for (let row = 0; row < height; row++) {
			let i = 0;
			while (i < byte_per_line) {
				let rle = read_char();
				if ((rle & 192) === 192) {
					rle &= 63;
					const color = read_char();
					for (let k = 0; k < rle; k++) {
						if (i + k < width) {
							indexed[row * width + i + k] = color;
						}
					}
					i += rle;
				} else {
					if (i < width) {
						indexed[row * width + i] = rle;
					}
					i++;
				}
			}
		}
	} else {
		let i = 0;
		const total = width * height;
		while (i < total) {
			let rle = read_char();
			if ((rle & 192) === 192) {
				rle &= 63;
				const color = read_char();
				indexed.fill(color, i, Math.min(total, i + rle));
				i += rle;
			} else {
				indexed[i++] = rle;
			}
		}
	}

	const palette = read_pcx_palette(bytes);
	const surface = new DSurface(width, height);
	for (let i = 0; i < indexed.length; i++) {
		const color = indexed[i]! * 3;
		surface.pixels[i] = build_hicolor_pixel(palette[color]!, palette[color + 1]!, palette[color + 2]!);
	}
	return surface;
}

function read_pcx_palette(bytes: Uint8Array): Uint8Array {
	const palette = new Uint8Array(256 * 3);
	const start = bytes.length - 768;
	if (start < PCX_HEADER_SIZE) {
		return palette;
	}
	let max = 0;
	for (let i = 0; i < 768; i++) {
		const value = bytes[start + i]!;
		palette[i] = value;
		if (value > max) {
			max = value;
		}
	}
	if (max <= 63) {
		for (let i = 0; i < 768; i++) {
			palette[i] = (palette[i]! << 2) & 0xff;
		}
	}
	return palette;
}
