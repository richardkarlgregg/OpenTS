// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import { fetch_subtile, type IsoSubtile, type TheaterTiles } from "./isotile";
import { terrain_image, terrain_uv, TerrainCoverage, type TerrainImage } from "./terrain-art";

export type TerrainCell = { x: number; y: number; height: number; tile: number; subtile: number };
export type TerrainVertex = [number, number, number];
export type TerrainMaterial = { key: string; tile: IsoSubtile | null; extra: boolean; source?: TerrainImage; image?: HTMLCanvasElement; normal_image?: HTMLCanvasElement };
export type TerrainPart = { kind: "ground" | "closure" | "relief"; material: number; vertices: Float32Array; cell: TerrainCell };
export type TerrainMesh = { materials: TerrainMaterial[]; parts: TerrainPart[]; triangles: number };

// World X/Y are cell axes; one elevation level is sqrt(1/6) cell widths.
export const TERRAIN_LEVEL = Math.sqrt(1 / 6);
const ground_coverage = new WeakMap<IsoSubtile, Uint8Array>();
const RAMPS = [
	[1, 0, 0, 1], [0, 1, 0, 1], [-1, 0, 1, 1], [0, -1, 1, 1],
	[1, 1, -1, 1], [-1, 1, 0, 1], [-1, -1, 1, 1], [1, -1, 0, 1],
	[1, 1, 0, 1], [-1, 1, 1, 1], [-1, -1, 2, 1], [1, -1, 1, 1],
	[1, 1, 0, 2], [-1, 1, 1, 2], [-1, -1, 2, 2], [1, -1, 1, 2],
	[0, 0, 0.5, 0.5], [0, 0, 0.5, 0.5], [0, 0, 0.5, 0.5], [0, 0, 0.5, 0.5],
];

export function terrain_height(ramp: number, u: number, v: number): number {
	const r = RAMPS[ramp - 1];
	return r ? Math.max(0, Math.min(r[3]!, r[0]! * u + r[1]! * v + r[2]!)) : 0;
}

export function terrain_project(x: number, y: number, z: number): [number, number] {
	return [24 * (x - y), 12 * (x + y - z)];
}

function triangle(out: number[], a: TerrainVertex, b: TerrainVertex, c: TerrainVertex,
	uv: [number, number][], cell: TerrainCell): void {
	const ab = [b[0] - a[0], b[1] - a[1], (b[2] - a[2]) * TERRAIN_LEVEL];
	const ac = [c[0] - a[0], c[1] - a[1], (c[2] - a[2]) * TERRAIN_LEVEL];
	const n = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
	const len = Math.hypot(...n);
	if (len < 1e-9) return;
	for (const [i, p] of [a, b, c].entries()) {
		out.push(...p, ...uv[i]!, cell.x, cell.y, n[0]! / len, n[1]! / len, n[2]! / len);
	}
}

export function build_terrain_mesh(cells: TerrainCell[], tiles: TheaterTiles): TerrainMesh {
	const lookup = new Map(cells.map(c => [`${c.x},${c.y}`, c]));
	const coverage = new TerrainCoverage();
	for (const cell of cells) {
		const tile = fetch_subtile(tiles, cell.tile, cell.subtile);
		if (tile) coverage.add(terrain_image(tile), 24 * (cell.x - cell.y) - 24, 12 * (cell.x + cell.y - cell.height));
	}
	coverage.merge();
	const materials: TerrainMaterial[] = [];
	const material_ids = new Map<string, number>();
	const parts: TerrainPart[] = [];
	let triangles = 0;
	const material = (cell: TerrainCell, extra: boolean): number => {
		const key = `${tiles.names?.[cell.tile] ?? `tile-${cell.tile}`}/${cell.subtile}/${extra ? "extra" : "ground"}`;
		let id = material_ids.get(key);
		if (id === undefined) {
			id = materials.length;
			material_ids.set(key, id);
			materials.push({ key, tile: fetch_subtile(tiles, cell.tile, cell.subtile), extra });
		}
		return id;
	};
	for (const cell of cells) {
		const tile = fetch_subtile(tiles, cell.tile, cell.subtile);
		const ramp = tile?.ramp ?? 0;
		const ground: number[] = [];
		const point = (u: number, v: number): TerrainVertex => [cell.x + u, cell.y + v, cell.height + terrain_height(ramp, u, v)];
		const uv = (u: number, v: number): [number, number] => terrain_uv(tile, 24 + 24 * (u - v), 12 * (u + v - terrain_height(ramp, u, v)));
		for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
			const u = x / 4, v = y / 4, u1 = (x + 1) / 4, v1 = (y + 1) / 4;
			const a = point(u, v), b = point(u1, v), c = point(u1, v1), d = point(u, v1);
			// Clamped diagonal ramps must split along their crease.
			if ([5, 7, 9, 11].includes(ramp)) {
				triangle(ground, a, b, d, [uv(u, v), uv(u1, v), uv(u, v1)], cell);
				triangle(ground, b, c, d, [uv(u1, v), uv(u1, v1), uv(u, v1)], cell);
			} else {
				triangle(ground, a, b, c, [uv(u, v), uv(u1, v), uv(u1, v1)], cell);
				triangle(ground, a, c, d, [uv(u, v), uv(u1, v1), uv(u, v1)], cell);
			}
		}
		const walls: number[] = [];

		const wall_triangle = (a: TerrainVertex, b: TerrainVertex, c: TerrainVertex): void => {
			const projected = [a, b, c].map(p => terrain_project(...p));
			const [p, q, r] = projected as [[number, number], [number, number], [number, number]];
			const det = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
			if (Math.abs(det) < 1e-7) return;
			const minx = Math.floor(Math.min(p[0], q[0], r[0])), maxx = Math.ceil(Math.max(p[0], q[0], r[0]));
			const miny = Math.floor(Math.min(p[1], q[1], r[1])), maxy = Math.ceil(Math.max(p[1], q[1], r[1]));
			let visible = false;
			for (let y = miny; y < maxy && !visible; y++) for (let x = minx; x < maxx; x++) {
				const u = ((q[1] - r[1]) * (x + 0.5 - r[0]) + (r[0] - q[0]) * (y + 0.5 - r[1])) / det;
				const v = ((r[1] - p[1]) * (x + 0.5 - r[0]) + (p[0] - r[0]) * (y + 0.5 - r[1])) / det;
				if (u >= 0 && v >= 0 && u + v <= 1 && !coverage.contains(x + 0.5, y + 0.5)) { visible = true; break; }
			}
			if (!visible) return;
			// A fallback face gets a two-dimensional patch rather than a stretched image edge.
			const wall_uv = (v: TerrainVertex): [number, number] => terrain_uv(tile,
				12 + 24 * Math.abs(v[0] - a[0] + v[1] - a[1]), 6 + 12 * Math.abs(v[2] - a[2]) / Math.max(1, Math.abs(c[2] - a[2]), Math.abs(b[2] - a[2])));
			triangle(walls, a, b, c, [wall_uv(a), wall_uv(b), wall_uv(c)], cell);
		};
		const edges = [[0, 0, 1, 0, 0, -1], [1, 0, 1, 1, 1, 0], [1, 1, 0, 1, 0, 1], [0, 1, 0, 0, -1, 0]];
		for (const e of edges) {
			const neighbor = lookup.get(`${cell.x + e[4]!},${cell.y + e[5]!}`);
			const nr = neighbor ? fetch_subtile(tiles, neighbor.tile, neighbor.subtile)?.ramp ?? 0 : 0;
			for (let step = 0; step < 4; step++) {
				const ends = [step / 4, (step + 1) / 4].map(t => point(e[0]! + (e[2]! - e[0]!) * t, e[1]! + (e[3]! - e[1]!) * t));
				const a = ends[0]!, b = ends[1]!;
				const lower = (p: TerrainVertex): TerrainVertex => [p[0], p[1], neighbor ? neighbor.height + terrain_height(nr, p[0] - neighbor.x, p[1] - neighbor.y) : Math.min(0, cell.height)];
				let d = lower(a), c = lower(b);
				let aa = a, bb = b;
				const da = a[2] - d[2], db = b[2] - c[2];
				if (da <= 1e-6 && db <= 1e-6) continue;
				if (da * db < 0) {
					const t = da / (da - db);
					const cross: TerrainVertex = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
					if (da < 0) { aa = cross; d = cross; } else { bb = cross; c = cross; }
				}
				wall_triangle(aa, d, c);
				wall_triangle(aa, c, bb);
			}
		}
		const add = (data: number[], kind: TerrainPart["kind"]): void => {
			if (!data.length) return;
			parts.push({ kind, material: material(cell, false), vertices: new Float32Array(data), cell });
			triangles += data.length / 30;
		};
		add(ground, "ground");
		add(walls, "closure");
		if (tile) {
			const image = terrain_image(tile);
			let covered = ground_coverage.get(tile);
			if (!covered) {
				const projected_ground: [number, number][][] = [];
				for (let i = 0; i < ground.length; i += 30) projected_ground.push([0, 10, 20].map(k => {
					const p = terrain_project(ground[i+k]! - cell.x, ground[i+k+1]! - cell.y, ground[i+k+2]! - cell.height);
					return [p[0] + 24, p[1]];
				}));
				const ground_covers = (px: number, py: number): boolean => {
					for (const projected of projected_ground) {
						const [a,b,c] = projected as [[number,number],[number,number],[number,number]];
						const det = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
						if (Math.abs(det)<1e-7) continue;
						const u=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/det;
						const v=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/det;
						if(u>=-1e-7 && v>=-1e-7 && u+v<=1+1e-7) return true;
					}
					return false;
				};
				covered = new Uint8Array(image.width * image.height);
				for (let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
					const px=x+image.left, py=y+image.top;
					const corners = [ground_covers(px,py), ground_covers(px+1,py), ground_covers(px,py+1), ground_covers(px+1,py+1)];
					covered[y*image.width+x] = corners.every(Boolean) ? 1 : corners.some(Boolean) ? 2 : 0;
				}
				ground_coverage.set(tile, covered);
			}
			const relief: number[] = [];
			const planes = [];
			for (let i = 0; i < ground.length; i += 30) {
				const points = [0, 10, 20].map(k => [ground[i+k]! - cell.x, ground[i+k+1]! - cell.y, ground[i+k+2]! - cell.height] as TerrainVertex);
				const [a, b, c] = points.map(p => terrain_project(...p)) as [[number,number],[number,number],[number,number]];
				const det = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
				if (Math.abs(det) < 1e-7) continue;
				const weights = (x: number, y: number) => {
					const u = ((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det;
					const v = ((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det;
					return [u, v, 1-u-v];
				};
				planes.push({ points, weights });
			}
			// Merge opaque scanline runs with equal depth before lifting them into world space.
			for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width;) {
				const index = y * image.width + x;
				if (covered[index] === 1) { x++; continue; }
				if (!image.indices[index]) { x++; continue; }
				const depth = image.depth[index]!;
				let end = x + 1;
				while (end < image.width && image.indices[y * image.width + end] && image.depth[y * image.width + end] === depth && covered[y * image.width + end] === covered[index]) end++;
				let edge_plane: typeof planes[number] | undefined;
				if (covered[index] === 2) {
					let best = Infinity;
					for (const plane of planes) {
						const distance = plane.weights(image.left+(x+end)/2-24, image.top+y+0.5).reduce((sum, w) => sum + Math.max(0, -w), 0);
						if (distance < best) { best = distance; edge_plane = plane; }
					}
				}
				const q = depth < 0 ? 1 : 2 - depth / 12;
				const vertex = (px: number, py: number): TerrainVertex => {
					// Raster fringe extends the adjacent ground plane instead of creating tiny shadow-casting walls.
					if (edge_plane) {
						const weights = edge_plane.weights(image.left+px-24, image.top+py);
						return [cell.x, cell.y, cell.height].map((origin, axis) => origin + edge_plane!.points.reduce((sum, p, i) => sum + p[axis]! * weights[i]!, 0)) as TerrainVertex;
					}
					const sx = (image.left + px - 24) / 24;
					const sy = (image.top + py) / 12;
					const sum = 0.75 * q + 0.25 * sy;
					return [cell.x + (sum + sx) / 2, cell.y + (sum - sx) / 2, cell.height + sum - sy];
				};
				const a = vertex(x, y), b = vertex(end, y), c = vertex(end, y + 1), d = vertex(x, y + 1);
				const uv0: [number, number] = [x / image.width, y / image.height];
				const uv1: [number, number] = [end / image.width, y / image.height];
				const uv2: [number, number] = [end / image.width, (y + 1) / image.height];
				const uv3: [number, number] = [x / image.width, (y + 1) / image.height];
				triangle(relief, a, b, c, [uv0, uv1, uv2], cell);
				triangle(relief, a, c, d, [uv0, uv2, uv3], cell);
				x = end;
			}
			add(relief, "relief");
		}
	}
	return { materials, parts, triangles };
}
