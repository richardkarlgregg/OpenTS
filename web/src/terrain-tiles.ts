// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import { fetch_subtile, type IsoSubtile, type TheaterTiles } from "./isotile";
import { terrain_image, terrain_uv } from "./terrain-art";
import { TERRAIN_LEVEL, terrain_height, type TerrainCell, type TerrainMesh, type TerrainVertex } from "./terrain-mesh";

export type TilePrimitive = { vertices: Float32Array; image?: HTMLCanvasElement; normal_image?: HTMLCanvasElement };
export type TileAsset = { primitives: TilePrimitive[] };
export type TileAssets = Map<string, TileAsset>;

export function tile_key(tiles: TheaterTiles, tile: number, subtile: number): string {
	return `${(tiles.names?.[tile] ?? `tile-${tile}`).toLowerCase()}/${subtile}`;
}

const templates = new WeakMap<IsoSubtile, Float32Array>();
export function tile_template(tile: IsoSubtile | null): Float32Array {
	if (tile && templates.has(tile)) return templates.get(tile)!;
	const out: number[] = [], ramp = tile?.ramp ?? 0;
	const triangle = (a: TerrainVertex, b: TerrainVertex, c: TerrainVertex, uv: [number, number][]): void => {
		const ab = b.map((v,i) => (v-a[i]!) * (i === 2 ? TERRAIN_LEVEL : 1));
		const ac = c.map((v,i) => (v-a[i]!) * (i === 2 ? TERRAIN_LEVEL : 1));
		const n = [ab[1]!*ac[2]!-ab[2]!*ac[1]!, ab[2]!*ac[0]!-ab[0]!*ac[2]!, ab[0]!*ac[1]!-ab[1]!*ac[0]!];
		const length = Math.hypot(...n); if (length < 1e-8) return;
		for (const [i,p] of [a,b,c].entries()) out.push(...p,...uv[i]!,0,0,...n.map(v=>v/length));
	};
	const corners: TerrainVertex[] = [[0,0,terrain_height(ramp,0,0)],[1,0,terrain_height(ramp,1,0)],
		[1,1,terrain_height(ramp,1,1)],[0,1,terrain_height(ramp,0,1)]];
	const uv = corners.map(p => terrain_uv(tile,24+24*(p[0]-p[1]),12*(p[0]+p[1]-p[2])));
	const split = [5,7,9,11].includes(ramp) ? [[0,1,3],[1,2,3]] : [[0,1,2],[0,2,3]];
	if(!tile) for(const indices of split) triangle(corners[indices[0]!]!,corners[indices[1]!]!,corners[indices[2]!]!,indices.map(i=>uv[i]!));
	else {
		let projected_base=false;
		const screen=corners.map(p=>[24+24*(p[0]-p[1]),12*(p[0]+p[1]-p[2])] as [number,number]);
		const shared=split[0]!.filter(i=>split[1]!.includes(i)), a=screen[shared[0]!]!,b=screen[shared[1]!]!;
		const side=(p:number[]) => (b[0]-a[0])*(p[1]!-a[1])-(b[1]-a[1])*(p[0]!-a[0]);
		for(const indices of split) {
			// Clip the eight-corner raster outline along the ramp crease, then lift each polygon onto its ground plane.
			const sign=Math.sign(side(screen[indices.find(i=>!shared.includes(i))!]!));
			const outline=[[22,0],[26,0],[48,11],[48,12],[26,23],[22,23],[0,12],[0,11]];
			const polygon:number[][]=[];
			for(let i=0;i<outline.length;i++) {
				const p=outline[i]!,q=outline[(i+1)%outline.length]!,dp=side(p)*sign,dq=side(q)*sign;
				if(dp>=0)polygon.push(p);
				if((dp<0)!==(dq<0)) {const t=dp/(dp-dq);polygon.push([p[0]!+(q[0]!-p[0]!)*t,p[1]!+(q[1]!-p[1]!)*t]);}
			}
			const [p,q,r]=indices.map(i=>screen[i]!) as [[number,number],[number,number],[number,number]];
			const det=(q[1]-r[1])*(p[0]-r[0])+(r[0]-q[0])*(p[1]-r[1]);
			if(Math.abs(det)<1e-7) {triangle(corners[indices[0]!]!,corners[indices[1]!]!,corners[indices[2]!]!,indices.map(i=>uv[i]!));continue;}
			projected_base=true;
			const lift=(point:number[]):TerrainVertex=>{
				const u=((q[1]-r[1])*(point[0]!-r[0])+(r[0]-q[0])*(point[1]!-r[1]))/det;
				const v=((r[1]-p[1])*(point[0]!-r[0])+(p[0]-r[0])*(point[1]!-r[1]))/det;
				return [0,1,2].map(axis=>corners[indices[0]!]![axis]!*u+corners[indices[1]!]![axis]!*v+corners[indices[2]!]![axis]!*(1-u-v)) as TerrainVertex;
			};
			for(let i=1;i+1<polygon.length;i++) {
				const points=[polygon[0]!,polygon[i]!,polygon[i+1]!];
				triangle(lift(points[0]!),lift(points[1]!),lift(points[2]!),points.map(p=>terrain_uv(tile,p[0]!,p[1]!)));
			}
		}
		if(!projected_base) {
			const outline=[[22,0],[26,0],[48,11],[48,12],[26,23],[22,23],[0,12],[0,11]];
			const lift=(p:number[]):TerrainVertex=>{const sx=(p[0]!-24)/24,sy=p[1]!/12,sum=0.75+0.25*sy;return [(sum+sx)/2,(sum-sx)/2,sum-sy];};
			for(let i=1;i+1<outline.length;i++){const points=[outline[0]!,outline[i]!,outline[i+1]!];triangle(lift(points[0]!),lift(points[1]!),lift(points[2]!),points.map(p=>terrain_uv(tile,p[0]!,p[1]!)));}
		}
	}
	// A small depth grid retains the extra image's placement without modelling individual pixels.
	if (tile?.extra) {
		const extra = tile.extra, image = terrain_image(tile);
		const point = (u: number, v: number): TerrainVertex => {
			const px = Math.min(extra.width-1, Math.round(u*extra.width)), py = Math.min(extra.height-1,Math.round(v*extra.height));
			let depth = 12, distance = Infinity;
			for (let y=0;y<extra.height;y++) for (let x=0;x<extra.width;x++) {
				if (!extra.indices[y*extra.width+x]) continue;
				const d = (x-px)**2+(y-py)**2;
				if (d < distance) { distance=d; depth=extra.depth?.[y*extra.width+x] ?? 12; }
			}
			const sx=(extra.dx+u*extra.width-24)/24, sy=(extra.dy+v*extra.height)/12;
			const sum=0.75*(2-depth/12)+0.25*sy;
			return [(sum+sx)/2,(sum-sx)/2,sum-sy];
		};
		const tex = (u:number,v:number):[number,number] => [(extra.dx+u*extra.width-image.left)/image.width,(extra.dy+v*extra.height-image.top)/image.height];
		const grid = Array.from({length:9},(_,i)=>point((i%3)/2,Math.floor(i/3)/2));
		for(let y=0;y<2;y++) for(let x=0;x<2;x++) {
			const a=grid[y*3+x]!,b=grid[y*3+x+1]!,c=grid[(y+1)*3+x+1]!,d=grid[(y+1)*3+x]!;
			triangle(a,b,c,[tex(x/2,y/2),tex((x+1)/2,y/2),tex((x+1)/2,(y+1)/2)]);
			triangle(a,c,d,[tex(x/2,y/2),tex((x+1)/2,(y+1)/2),tex(x/2,(y+1)/2)]);
		}
	}
	const result = new Float32Array(out); if(tile) templates.set(tile,result); return result;
}

export function build_tile_map(cells: TerrainCell[], tiles: TheaterTiles, assets: TileAssets = new Map()): TerrainMesh {
	const mesh: TerrainMesh = { materials: [], parts: [], triangles: 0 };
	const ids = new Map<string, number[]>();
	for (const cell of cells) {
		const key = tile_key(tiles,cell.tile,cell.subtile), tile = fetch_subtile(tiles,cell.tile,cell.subtile);
		const parts = assets.get(key)?.primitives ?? [{vertices:tile_template(tile)}];
		let materials = ids.get(key);
		if (!materials) {
			materials = parts.map((p,i) => { const id=mesh.materials.length; mesh.materials.push({key:`${key}/${i}`,tile,extra:false,image:p.image,normal_image:p.normal_image}); return id; });
			ids.set(key,materials);
		}
		for (const [i,part] of parts.entries()) {
			const vertices = part.vertices.slice();
			for (let j=0;j<vertices.length;j+=10) { vertices[j]=vertices[j]!+cell.x; vertices[j+1]=vertices[j+1]!+cell.y; vertices[j+2]=vertices[j+2]!+cell.height; vertices[j+5]=cell.x; vertices[j+6]=cell.y; }
			mesh.parts.push({kind:"ground",material:materials[i]!,vertices,cell}); mesh.triangles+=vertices.length/30;
		}
	}
	return mesh;
}
