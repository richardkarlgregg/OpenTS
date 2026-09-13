// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import { fetch_subtile, type IsoSubtile, type TheaterTiles } from "./isotile";
import type { TerrainCell } from "./terrain-mesh";

export type TerrainImage = { left: number; top: number; width: number; height: number; indices: Uint8Array; depth: Int16Array };

const images = new WeakMap<IsoSubtile, TerrainImage>();

const tile_images = new WeakMap<IsoSubtile, TerrainImage>();

/** Project a complete TMP stamp, including artwork belonging to adjacent records. */
export function tile_art(tiles: TheaterTiles, index: number, subtile: number): TerrainImage | null {
	const tile = fetch_subtile(tiles,index,subtile);
	if (!tile) return null;
	const cached = tile_images.get(tile);
	if (cached) return cached;
	const set = tile.location ? (tiles.sets[index]??[tile]).filter(t=>!t.absent&&t.location) : [tile];
	const records = set.map(t=> {
		const x = t.location?.x??0, y = t.location?.y??0, h = t.record_height??0;
		return {tile:t,image:terrain_image(t),x:24*(x-y),y:12*(x+y-h),order:x+y};
	}).sort((a,b)=>a.order-b.order);
	let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
	for (const r of records) {
		left = Math.min(left,r.x+r.image.left); right = Math.max(right,r.x+r.image.left+r.image.width);
		top = Math.min(top,r.y+r.image.top,r.y-24); bottom = Math.max(bottom,r.y+r.image.top+r.image.height,r.y+24);
	}
	const width = right-left, height = bottom-top;
	if (!Number.isFinite(width) || width>2044 || height>2044) throw new Error("TMP terrain stamp exceeds the atlas page size");
	const indices = new Uint8Array(width*height);
	for (const r of records) for (let y=0;y<r.image.height;y++) for (let x=0;x<r.image.width;x++) {
		const color = r.image.indices[y*r.image.width+x]!;
		if (color) indices[(r.y+r.image.top+y-top)*width+r.x+r.image.left+x-left] = color;
	}
	// Geometry covers complete cells. Extend color into unpainted regions instead of cutting
	// raster silhouettes out of the mesh. Keep the original transparent PNG unchanged.
	extend_color(indices,width);
	const depth = new Int16Array(indices.length).fill(-1);
	for (const r of records) tile_images.set(r.tile,{left:left-r.x,top:top-r.y,width,height,indices,depth});
	return tile_images.get(tile)!;
}

function extend_color(indices: Uint8Array, width: number): void {
	const queue = new Int32Array(indices.length); let head = 0, tail = 0;
	for (let i=0;i<indices.length;i++) if (indices[i]) queue[tail++] = i;
	if (!tail) indices.fill(1);
	while (head<tail) {
		const p = queue[head++]!, x = p%width;
		for (const q of [x>0?p-1:-1,x+1<width?p+1:-1,p-width,p+width]) {
			if (q<0 || q>=indices.length || indices[q]) continue;
			indices[q]=indices[p]!; queue[tail++]=q;
		}
	}
}

/** Fixed-camera color projection for cliffs whose artwork spans different TMP files. */
export function map_cliff_art(cells: TerrainCell[], tiles: TheaterTiles): (cell: TerrainCell, vertices: Float32Array) => TerrainImage {
	type Stamp = { image: TerrainImage; x: number; y: number; order: number };
	const bins = new Map<string, Stamp[]>();
	const ordered = cells.slice().sort((a,b)=>a.x+a.y-b.x-b.y||a.x-b.x);
	for (const [order,cell] of ordered.entries()) {
		const tile = fetch_subtile(tiles,cell.tile,cell.subtile);
		if (!tile) continue;
		const image = terrain_image(tile), x = 24*(cell.x-cell.y)-24+image.left, y = 12*(cell.x+cell.y-cell.height)+image.top;
		const stamp = {image,x,y,order};
		for (let by=Math.floor(y/128);by<=Math.floor((y+image.height-1)/128);by++) for (let bx=Math.floor(x/128);bx<=Math.floor((x+image.width-1)/128);bx++) {
			const key = `${bx},${by}`, bucket = bins.get(key)??[];
			bucket.push(stamp); bins.set(key,bucket);
		}
	}
	return (cell,vertices) => {
		let left = 0, top = -24, right = 48, bottom = 24;
		for (let i=0;i<vertices.length;i+=10) {
			const x = 24+24*(vertices[i]!-vertices[i+1]!), y = 12*(vertices[i]!+vertices[i+1]!-vertices[i+2]!);
			left=Math.min(left,Math.floor(x)); right=Math.max(right,Math.ceil(x)); top=Math.min(top,Math.floor(y)); bottom=Math.max(bottom,Math.ceil(y));
		}
		const width = right-left, height = bottom-top;
		if (width>2044 || height>2044) throw new Error("Cliff terrain exceeds the atlas page size");
		const x = 24*(cell.x-cell.y)-24+left, y = 12*(cell.x+cell.y-cell.height)+top;
		const candidates = new Set<Stamp>();
		for (let by=Math.floor(y/128);by<=Math.floor((y+height-1)/128);by++) for (let bx=Math.floor(x/128);bx<=Math.floor((x+width-1)/128);bx++) {
			for (const stamp of bins.get(`${bx},${by}`)??[]) candidates.add(stamp);
		}
		const indices = new Uint8Array(width*height);
		for (const stamp of [...candidates].sort((a,b)=>a.order-b.order)) {
			const dx=stamp.x-x, dy=stamp.y-y, image=stamp.image;
			for (let py=Math.max(0,dy);py<Math.min(height,dy+image.height);py++) for (let px=Math.max(0,dx);px<Math.min(width,dx+image.width);px++) {
				const color=image.indices[(py-dy)*image.width+px-dx]!;
				if (color) indices[py*width+px]=color;
			}
		}
		extend_color(indices,width);
		return {left,top,width,height,indices,depth:new Int16Array(indices.length).fill(-1)};
	};
}

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
