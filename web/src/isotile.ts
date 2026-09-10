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

import { cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import { INIClass } from "./ini";
import { build_hicolor_pixel, DSurface } from "./surface";
import { theater_from_name } from "./theater";

export type TilePreviewColors = {
	low: [number, number, number];
	high: [number, number, number];
};

export type IsoExtraImage = {
	dx: number;
	dy: number;
	width: number;
	height: number;
	indices: Uint8Array;
};

export type IsoSubtile = {
	colors: TilePreviewColors;
	indices: Uint8Array;
	extra: IsoExtraImage | null;
	ramp: number;
};

export type TheaterTiles = {
	palette: Uint16Array;
	sets: IsoSubtile[][];
};

export const ISO_TILE_PIXEL_W = 48;
export const ISO_TILE_PIXEL_H = 24;
export const ISO_DRAW_HEIGHT = 23;
export const ISO_PACKED = 576;
export const LEVEL_PIXEL_H = 12;

const RECORD_SIZE = 52;
const RECORD_LOW = 43;
const RECORD_HIGH = 46;
const ISO_ROW_BASES = [
	0, 4, 12, 24, 40, 60, 84, 112, 144, 180, 220, 264, 312, 356, 396, 432, 464, 492, 516, 536, 552, 564, 572, 576,
];

const FALLBACK_COLORS: TilePreviewColors = { low: [72, 108, 44], high: [96, 128, 56] };

function iso_row_span(row: number): { start: number; length: number } {
	if (row < 0 || row >= ISO_DRAW_HEIGHT) {
		return { start: 0, length: 0 };
	}
	const length = ISO_ROW_BASES[row + 1]! - ISO_ROW_BASES[row]!;
	return { start: (ISO_TILE_PIXEL_W - length) >> 1, length };
}

function parse_iso_tile_set(bytes: Uint8Array): IsoSubtile[] {
	if (bytes.length < 20) {
		return [];
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const map_w = view.getInt32(0, true);
	const map_h = view.getInt32(4, true);
	const count = map_w * map_h;
	if (count <= 0 || count > 256 || 16 + count * 4 > bytes.length) {
		return [];
	}
	const tiles: IsoSubtile[] = [];
	for (let i = 0; i < count; i++) {
		const offset = view.getInt32(16 + i * 4, true);
		if (offset <= 0 || offset + RECORD_HIGH + 2 >= bytes.length) {
			tiles.push({ colors: { ...FALLBACK_COLORS }, indices: new Uint8Array(ISO_PACKED), extra: null, ramp: 0 });
			continue;
		}
		const colors: TilePreviewColors = {
			low: [bytes[offset + RECORD_LOW]!, bytes[offset + RECORD_LOW + 1]!, bytes[offset + RECORD_LOW + 2]!],
			high: [bytes[offset + RECORD_HIGH]!, bytes[offset + RECORD_HIGH + 1]!, bytes[offset + RECORD_HIGH + 2]!],
		};
		const image_at = offset + RECORD_SIZE;
		const indices = new Uint8Array(ISO_PACKED);
		if (image_at + ISO_PACKED <= bytes.length) {
			indices.set(bytes.subarray(image_at, image_at + ISO_PACKED));
		}
		let extra: IsoExtraImage | null = null;
		const flags = view.getUint32(offset + 36, true);
		const extra_offset = view.getInt32(offset + 8, true);
		const extra_x = view.getInt32(offset + 20, true);
		const extra_y = view.getInt32(offset + 24, true);
		const extra_w = view.getInt32(offset + 28, true);
		const extra_h = view.getInt32(offset + 32, true);
		const rec_x = view.getInt32(offset, true);
		const rec_y = view.getInt32(offset + 4, true);
		if ((flags & 1) !== 0 && extra_offset > 0 && extra_w > 0 && extra_h > 0 && extra_w < 512 && extra_h < 512) {
			const start = offset + extra_offset;
			const need = extra_w * extra_h;
			if (start >= 0 && start + need <= bytes.length) {
				extra = {
					dx: extra_x - rec_x,
					dy: extra_y - rec_y,
					width: extra_w,
					height: extra_h,
					indices: bytes.slice(start, start + need),
				};
			}
		}
		const ramp = bytes[offset + 42] ?? 0;
		tiles.push({ colors, indices, extra, ramp });
	}
	return tiles;
}

function empty_palette(): Uint16Array {
	const palette = new Uint16Array(256);
	for (let i = 0; i < 256; i++) {
		palette[i] = build_hicolor_pixel(i, 255 - i, (i << 2) & 0xff);
	}
	return palette;
}

async function load_iso_palette(directory: GameDirectory, suffix: string): Promise<Uint16Array> {
	const packed = await cc_retrieve(directory, `ISO${suffix}.PAL`);
	if (!packed || packed.length < 768) {
		return empty_palette();
	}
	const palette = new Uint16Array(256);
	for (let i = 0; i < 256; i++) {
		const r = (packed[i * 3]! << 2) & 0xff;
		const g = (packed[i * 3 + 1]! << 2) & 0xff;
		const b = (packed[i * 3 + 2]! << 2) & 0xff;
		palette[i] = build_hicolor_pixel(r, g, b);
	}
	return palette;
}

const cache = new Map<string, TheaterTiles>();

export async function load_theater_tiles(directory: GameDirectory, theater_name: string): Promise<TheaterTiles> {
	const seed = theater_from_name(theater_name);
	const cached = cache.get(seed.name);
	if (cached) {
		return cached;
	}

	const palette = await load_iso_palette(directory, seed.suffix);
	const sets: IsoSubtile[][] = [];
	const ini_bytes = await cc_retrieve(directory, `${seed.root}.INI`);
	if (!ini_bytes) {
		const empty = { palette, sets };
		cache.set(seed.name, empty);
		return empty;
	}
	const ini = new INIClass();
	if (!ini.load(ini_bytes)) {
		const empty = { palette, sets };
		cache.set(seed.name, empty);
		return empty;
	}

	for (let setid = 0; ; setid++) {
		const section = `TileSet${setid.toString().padStart(4, "0")}`;
		const tiles_in_set = ini.get_int(section, "TilesInSet", -1);
		if (tiles_in_set < 0) {
			break;
		}
		const file_name = ini.get_string(section, "FileName", "TILE");
		for (let i = 0; i < tiles_in_set; i++) {
			const stem = `${file_name}${(i + 1).toString().padStart(2, "0")}`;
			let packed = await cc_retrieve(directory, `${stem}.${seed.suffix}`);
			if (!packed && seed.mm_suffix.length > 0) {
				packed = await cc_retrieve(directory, `${stem}.${seed.mm_suffix}`);
			}
			sets.push(packed ? parse_iso_tile_set(packed) : []);
		}
	}

	const tiles = { palette, sets };
	cache.set(seed.name, tiles);
	return tiles;
}

export async function load_theater_previews(
	directory: GameDirectory,
	theater_name: string,
): Promise<TilePreviewColors[][]> {
	const tiles = await load_theater_tiles(directory, theater_name);
	return tiles.sets.map((set) => set.map((tile) => tile.colors));
}

export function preview_cell_colors(
	table: TilePreviewColors[][],
	tile: number,
	subtile: number,
	height: number,
): { low: [number, number, number]; high: [number, number, number] } {
	if (tile < 0 || tile === 0xffff || tile >= table.length) {
		tile = 0;
	}
	const set = table[tile];
	const record = set && set.length > 0 ? set[subtile % set.length]! : FALLBACK_COLORS;
	const t = Math.max(0, Math.min(12, height)) / 12;
	const scale = (rgb: [number, number, number]): [number, number, number] => [
		Math.min(255, Math.round(rgb[0]! * (1 + 0.4 * t))),
		Math.min(255, Math.round(rgb[1]! * (1 + 0.4 * t))),
		Math.min(255, Math.round(rgb[2]! * (1 + 0.4 * t))),
	];
	return { low: scale(record.low), high: scale(record.high) };
}

export function fetch_subtile(tiles: TheaterTiles, tile: number, subtile: number): IsoSubtile | null {
	if (tile < 0 || tile === 0xffff || tile >= tiles.sets.length) {
		tile = 0;
	}
	const set = tiles.sets[tile];
	if (!set || set.length === 0) {
		return null;
	}
	return set[subtile % set.length] ?? null;
}

export function blit_iso_tile(dest: DSurface, dx: number, dy: number, tile: IsoSubtile, palette: Uint16Array): void {
	for (let row = 0; row < ISO_DRAW_HEIGHT; row++) {
		const base = ISO_ROW_BASES[row]!;
		const span = iso_row_span(row);
		const y = dy + row;
		if (y < 0 || y >= dest.height) {
			continue;
		}
		for (let i = 0; i < span.length; i++) {
			const x = dx + span.start + i;
			if (x < 0 || x >= dest.width) {
				continue;
			}
			dest.pixels[y * dest.width + x] = palette[tile.indices[base + i]!]!;
		}
	}
	if (!tile.extra) {
		return;
	}
	const extra = tile.extra;
	for (let row = 0; row < extra.height; row++) {
		const y = dy + extra.dy + row;
		if (y < 0 || y >= dest.height) {
			continue;
		}
		for (let col = 0; col < extra.width; col++) {
			const index = extra.indices[row * extra.width + col]!;
			if (index === 0) {
				continue;
			}
			const x = dx + extra.dx + col;
			if (x < 0 || x >= dest.width) {
				continue;
			}
			dest.pixels[y * dest.width + x] = palette[index]!;
		}
	}
}
