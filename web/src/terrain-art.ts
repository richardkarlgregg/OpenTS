// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import type { IsoSubtile } from "./isotile";

export type TerrainImage = { left: number; top: number; width: number; height: number; indices: Uint8Array; depth: Int16Array };

const images = new WeakMap<IsoSubtile, TerrainImage>();

export function terrain_image(tile: IsoSubtile): TerrainImage {
	const cached = images.get(tile);
	if (cached) return cached;
	const extra = tile.extra;
	const left = Math.min(0, extra?.dx ?? 0), top = Math.min(0, extra?.dy ?? 0);
	const width = Math.max(48, extra ? extra.dx + extra.width : 48) - left;
	const height = Math.max(24, extra ? extra.dy + extra.height : 24) - top;
	if (width > 2044 || height > 2044) throw new Error("Terrain image exceeds the atlas page size.");
	const indices = new Uint8Array(width * height);
	const depth = new Int16Array(width * height).fill(-1);
	let offset = 0;
	for (let y = 0; y < 23; y++) {
		const count = y < 12 ? 4 + y * 4 : 44 - (y - 12) * 4;
		const start = (48 - count) / 2;
		indices.set(tile.indices.subarray(offset, offset + count), (y - top) * width + start - left);
		for (let x = 0; x < count; x++) depth[(y - top) * width + start - left + x] = tile.depth?.[offset + x] ?? 23 - y;
		offset += count;
	}
	if (extra) for (let y = 0; y < extra.height; y++) for (let x = 0; x < extra.width; x++) {
		const index = extra.indices[y * extra.width + x]!;
		if (index !== 0) {
			const target = (y + extra.dy - top) * width + x + extra.dx - left;
			indices[target] = index;
			depth[target] = extra.depth?.[y * extra.width + x] ?? -1;
		}
	}
	const result = { left, top, width, height, indices, depth };
	images.set(tile, result);
	return result;
}

export function terrain_uv(tile: IsoSubtile | null, x: number, y: number): [number, number] {
	const image = tile ? terrain_image(tile) : { left: 0, top: 0, width: 48, height: 24 };
	return [(x - image.left) / image.width, (y - image.top) / image.height];
}

export class TerrainCoverage {
	private readonly rows = new Map<number, [number, number][]>();

	add(image: TerrainImage, x: number, y: number): void {
		for (let row = 0; row < image.height; row++) {
			const key = y + image.top + row;
			let spans = this.rows.get(key);
			if (!spans) { spans = []; this.rows.set(key, spans); }
			for (let col = 0; col < image.width;) {
				if (!image.indices[row * image.width + col]) { col++; continue; }
				const start = col++;
				while (col < image.width && image.indices[row * image.width + col]) col++;
				spans.push([x + image.left + start, x + image.left + col]);
			}
		}
	}

	merge(): void {
		for (const [y, spans] of this.rows) {
			spans.sort((a, b) => a[0] - b[0]);
			const merged: [number, number][] = [];
			for (const span of spans) {
				const last = merged[merged.length - 1];
				if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
				else merged.push([...span]);
			}
			this.rows.set(y, merged);
		}
	}

	contains(x: number, y: number): boolean {
		const spans = this.rows.get(Math.floor(y));
		if (!spans) return false;
		let low = 0, high = spans.length - 1;
		while (low <= high) {
			const mid = (low + high) >> 1, span = spans[mid]!;
			if (x < span[0]) high = mid - 1;
			else if (x >= span[1]) low = mid + 1;
			else return true;
		}
		return false;
	}
}
