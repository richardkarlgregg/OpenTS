// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import { fetch_subtile, type IsoSubtile, type TheaterTiles } from "./isotile";
import { tile_art, map_cliff_art, terrain_image, type TerrainImage } from "./terrain-art";
import { TERRAIN_LEVEL, terrain_height, type TerrainCell, type TerrainMesh, type TerrainVertex } from "./terrain-mesh";

export type TilePrimitive = { vertices: Float32Array; image?: HTMLCanvasElement; normal_image?: HTMLCanvasElement };
export type TileAsset = { primitives: TilePrimitive[]; source?: ArrayBuffer };
export type TileAssets = Map<string, TileAsset>;
type Neighbor = { tile: IsoSubtile | null; height: number };
type Neighbors = (Neighbor | undefined)[];
const CORNERS = [[0,0],[1,0],[1,1],[0,1]] as const;
const OFFSETS = [[0,-1],[1,0],[0,1],[-1,0]] as const;

export function tile_key(tiles: TheaterTiles, tile: number, subtile: number): string {
	({tile,subtile}=tile_identity(tiles,tile,subtile));
	return `${(tiles.names?.[tile] ?? `tile-${tile}`).toLowerCase()}/${subtile}`;
}

export function tile_identity(tiles: TheaterTiles, tile: number, subtile: number): {tile:number;subtile:number} {
	if(tile<0 || tile===0xffff || tile>=tiles.sets.length) tile=0;
	subtile=subtile%(tiles.sets[tile]?.length||1);
	return {tile,subtile};
}

function triangle(out: number[], points: TerrainVertex[], image: TerrainImage | null): void {
	const [a,b,c] = points as [TerrainVertex,TerrainVertex,TerrainVertex];
	const ab = b.map((v,i) => (v-a[i]!) * (i === 2 ? TERRAIN_LEVEL : 1));
	const ac = c.map((v,i) => (v-a[i]!) * (i === 2 ? TERRAIN_LEVEL : 1));
	const n = [ab[1]!*ac[2]!-ab[2]!*ac[1]!, ab[2]!*ac[0]!-ab[0]!*ac[2]!, ab[0]!*ac[1]!-ab[1]!*ac[0]!];
	const length = Math.hypot(...n);
	if (length < 1e-8) return;
	for (const p of points) {
		const u = (24+24*(p[0]-p[1])-(image?.left??0))/(image?.width??48);
		const v = (12*(p[0]+p[1]-p[2])-(image?.top??0))/(image?.height??24);
		out.push(...p,Math.max(0,Math.min(1,u)),Math.max(0,Math.min(1,v)),0,0,...n.map(value=>value/length));
	}
}

function ground(tile: IsoSubtile | null, image: TerrainImage | null): Float32Array {
	const ramp = tile?.ramp??0, out: number[] = [];
	const corners: TerrainVertex[] = CORNERS.map(([x,y])=>[x,y,terrain_height(ramp,x,y)]);
	// CellClass::Get_Height is piecewise planar. Split only at its actual crease.
	const split = [5,7,9,11].includes(ramp) ? [[0,1,3],[1,2,3]] : [[0,1,2],[0,2,3]];
	for (const indices of split) triangle(out,indices.map(i=>corners[i]!),image);
	return new Float32Array(out);
}

function walls(tile: IsoSubtile | null, neighbors: Neighbors, image: TerrainImage | null): Float32Array {
	const out: number[] = [];
	for (const [edge,neighbor] of neighbors.entries()) {
		if (!neighbor) continue;
		const a = CORNERS[edge]!, b = CORNERS[(edge+1)%4]!, [dx,dy] = OFFSETS[edge]!;
		const upper = [a,b].map(([x,y])=>terrain_height(tile?.ramp??0,x,y));
		const lower = [a,b].map(([x,y])=>neighbor.height+terrain_height(neighbor.tile?.ramp??0,x-dx,y-dy));
		const difference = upper.map((h,i)=>h-lower[i]!);
		if (Math.max(...difference) <= 0) continue;
		// Crossing slopes each own only the part of the edge where that cell is higher.
		let start = 0, end = 1;
		if (difference[0]! < 0) start = difference[0]!/(difference[0]!-difference[1]!);
		if (difference[1]! < 0) end = difference[0]!/(difference[0]!-difference[1]!);
		const point = (t: number, heights: number[]): TerrainVertex => [a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),heights[0]!+t*(heights[1]!-heights[0]!)];
		const p = point(start,upper), q = point(end,upper), r = point(end,lower), s = point(start,lower);
		triangle(out,[p,s,r],image); triangle(out,[p,r,q],image);
	}
	return new Float32Array(out);
}

const templates = new WeakMap<IsoSubtile, Float32Array>();
export function tile_template(tile: IsoSubtile | null): Float32Array {
	if (tile && templates.has(tile)) return templates.get(tile)!;
	const result = ground(tile,tile?terrain_image(tile):null);
	if (tile) templates.set(tile,result);
	return result;
}

/** Starter geometry in one cell's local coordinates, using the TMP's own neighboring records. */
export function tile_prototype(tiles: TheaterTiles, index: number, subtile: number): Float32Array {
	const tile = fetch_subtile(tiles,index,subtile), image = tile_art(tiles,index,subtile);
	const neighbors: Neighbors = OFFSETS.map(([dx,dy])=> {
		if (!tile?.location) return undefined;
		const other = tiles.sets[index]?.find(t=>!t.absent && t.location?.x===tile.location!.x+dx && t.location?.y===tile.location!.y+dy);
		return other ? {tile:other,height:(other.record_height??0)-(tile.record_height??0)} : undefined;
	});
	const top = ground(tile,image), sides = walls(tile,neighbors,image), result = new Float32Array(top.length+sides.length);
	result.set(top); result.set(sides,top.length); return result;
}

export function build_tile_map(cells: TerrainCell[], tiles: TheaterTiles, assets: TileAssets = new Map()): TerrainMesh {
	const mesh: TerrainMesh = { materials: [], parts: [], triangles: 0 };
	const ids = new Map<string, number[]>(), lookup = new Map(cells.map(c=>[`${c.x},${c.y}`,c]));
	const cliff_art = map_cliff_art(cells,tiles);
	for (const cell of cells) {
		const key = tile_key(tiles,cell.tile,cell.subtile), tile = fetch_subtile(tiles,cell.tile,cell.subtile);
		const asset = assets.get(key);
		const neighbors: Neighbors = OFFSETS.map(([dx,dy])=> {
			const other = lookup.get(`${cell.x+dx},${cell.y+dy}`);
			return other ? {tile:fetch_subtile(tiles,other.tile,other.subtile),height:other.height-cell.height} : undefined;
		});
		const boundary = asset ? new Float32Array(0) : walls(tile,neighbors,null);
		const image = boundary.length ? cliff_art(cell,boundary) : tile_art(tiles,cell.tile,cell.subtile);
		const material_key = boundary.length ? `${key}@${cell.x},${cell.y}` : key;
		let materials = ids.get(material_key);
		if (!materials) {
			materials = (asset?.primitives??[{}]).map((p,i) => {
				const id = mesh.materials.length;
				mesh.materials.push({key:`${material_key}/${i}`,tile,extra:false,source:asset?undefined:image??undefined,...p}); return id;
			});
			ids.set(material_key,materials);
		}
		const parts = asset?.primitives ?? [{vertices:ground(tile,image)},{vertices:walls(tile,neighbors,image)}];
		for (const [i,part] of parts.entries()) {
			if (!part.vertices.length) continue;
			const vertices = part.vertices.slice();
			for (let j=0;j<vertices.length;j+=10) { vertices[j]=vertices[j]!+cell.x; vertices[j+1]=vertices[j+1]!+cell.y; vertices[j+2]=vertices[j+2]!+cell.height; vertices[j+5]=cell.x; vertices[j+6]=cell.y; }
			mesh.parts.push({kind:!asset&&i===1?"closure":"ground",material:materials[asset?i:0]!,vertices,cell}); mesh.triangles+=vertices.length/30;
		}
	}
	return mesh;
}
