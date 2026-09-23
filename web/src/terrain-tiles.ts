// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import { fetch_subtile, type IsoSubtile, type TheaterTiles } from "./isotile";
import { tile_art, map_cliff_art, terrain_image, type TerrainImage } from "./terrain-art";
import { TERRAIN_LEVEL, terrain_height, type TerrainCell, type TerrainMesh, type TerrainVertex } from "./terrain-mesh";

export type TilePrimitive = import("./terrain-mesh").TerrainSurface & { vertices: Float32Array };
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

export function tile_set_key(tiles:TheaterTiles,tile:number):string {
	return tile_key(tiles,tile,0).split("/")[0]!;
}

export function tile_records(tiles:TheaterTiles,tile:number):TerrainCell[] {
	tile=tile_identity(tiles,tile,0).tile;
	return (tiles.sets[tile]??[]).flatMap((record,subtile)=>record.absent?[]:[{
		x:record.location?.x??subtile,y:record.location?.y??0,height:record.record_height??0,tile,subtile,
	}]);
}

export type TileInstance = { key:string; origin:{x:number;y:number;height:number}; members:TerrainCell[]; asset:TileAsset };

/** A complete TMP replacement is placed once, only when its full footprint matches the map. */
export function tile_instances(cells:TerrainCell[],tiles:TheaterTiles,assets:TileAssets):TileInstance[] {
	const lookup=new Map(cells.map(c=>[`${c.x},${c.y}`,c])), seen=new Set<string>(), result:TileInstance[]=[];
	const records=new Map<number,TerrainCell[]>();
	for(const cell of cells) {
		const id=tile_identity(tiles,cell.tile,cell.subtile),key=`${tile_set_key(tiles,id.tile)}/tile`,asset=assets.get(key);
		if(!asset)continue;
		let stamp=records.get(id.tile);
		if(!stamp){stamp=tile_records(tiles,id.tile);records.set(id.tile,stamp);}
		const record=stamp.find(r=>r.subtile===id.subtile); if(!record)continue;
		const origin={x:cell.x-record.x,y:cell.y-record.y,height:cell.height-record.height};
		const placement=`${key}@${origin.x},${origin.y},${origin.height}`;
		if(seen.has(placement))continue; seen.add(placement);
		const members:TerrainCell[]=[];
		for(const r of stamp) {
			const member=lookup.get(`${origin.x+r.x},${origin.y+r.y}`);
			if(!member)break;
			const identity=tile_identity(tiles,member.tile,member.subtile);
			if(identity.tile!==id.tile||identity.subtile!==r.subtile||member.height!==origin.height+r.height)break;
			members.push(member);
		}
		if(members.length===stamp.length)result.push({key,origin,members,asset});
	}
	return result;
}

function append_instance(mesh:TerrainMesh,instance:TileInstance,materials:number[]):void {
	const {origin,members,asset}=instance;
	for(const [material,primitive] of asset.primitives.entries()) {
		const groups=new Map<TerrainCell,number[]>(),v=primitive.vertices;
		for(let i=0;i<v.length;i+=30) {
			const x=origin.x+(v[i]!+v[i+10]!+v[i+20]!)/3,y=origin.y+(v[i+1]!+v[i+11]!+v[i+21]!)/3;
			let owner=members[0]!,distance=Infinity;
			for(const cell of members) {
				const d=Math.max(cell.x-x,0,x-cell.x-1)**2+Math.max(cell.y-y,0,y-cell.y-1)**2;
				if(d<distance-1e-8||(Math.abs(d-distance)<1e-8&&cell.height>owner.height)){owner=cell;distance=d;}
			}
			let out=groups.get(owner);if(!out){out=[];groups.set(owner,out);}
			for(let k=0;k<30;k+=10) out.push(v[i+k]!+origin.x,v[i+k+1]!+origin.y,v[i+k+2]!+origin.height,v[i+k+3]!,v[i+k+4]!,owner.x,owner.y,v[i+k+7]!,v[i+k+8]!,v[i+k+9]!);
		}
		for(const [cell,vertices] of groups){mesh.parts.push({kind:"ground",cell,material:materials[material]!,vertices:new Float32Array(vertices)});mesh.triangles+=vertices.length/30;}
	}
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

/** Subtract authored faces on a boundary plane, leaving only the exposed map seam. */
function boundary_remainder(vertices:Float32Array,instance:TileInstance,cell:TerrainCell,edge:number):Float32Array {
	const axis=edge%2===0?1:0,along=1-axis,plane=edge===1||edge===2?1:0;
	let polygons:TerrainVertex[][]=[];
	for(let i=0;i<vertices.length;i+=30)polygons.push([0,10,20].map(k=>[vertices[i+k]!,vertices[i+k+1]!,vertices[i+k+2]!]));
	for(const primitive of instance.asset.primitives) {
		const v=primitive.vertices;
		for(let i=0;i<v.length&&polygons.length;i+=30) {
			const points=[0,10,20].map(k=>[v[i+k]!+instance.origin.x-cell.x,v[i+k+1]!+instance.origin.y-cell.y,v[i+k+2]!+instance.origin.height-cell.height]);
			if(points.some(p=>Math.abs(p[axis]!-plane)>1e-4))continue;
			const [a,b,c]=points as [number[],number[],number[]];
			const area=(b[along]!-a[along]!)*(c[2]!-a[2]!)-(b[2]!-a[2]!)*(c[along]!-a[along]!);
			if(Math.abs(area)<1e-8)continue;
			const next:TerrainVertex[][]=[];
			for(const polygon of polygons) {
				let inside=polygon;
				for(let e=0;e<3&&inside.length>=3;e++) {
					const a=points[e]!,b=points[(e+1)%3]!,side=(p:TerrainVertex)=>Math.sign(area)*((b[along]!-a[along]!)*(p[2]-a[2]!)-(b[2]!-a[2]!)*(p[along]!-a[along]!));
					const retained:TerrainVertex[]=[],outside:TerrainVertex[]=[];
					for(let k=0;k<inside.length;k++) {
						const p=inside[k]!,q=inside[(k+1)%inside.length]!,dp=side(p),dq=side(q);
						(dp>=0?retained:outside).push(p);
						if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq),hit=p.map((n,j)=>n+t*(q[j]!-n)) as TerrainVertex;retained.push(hit);outside.push(hit);}
					}
					if(outside.length>=3)next.push(outside);inside=retained;
				}
			}
			polygons=next;
		}
	}
	const out:number[]=[];
	for(const polygon of polygons)for(let i=1;i+1<polygon.length;i++)triangle(out,[polygon[0]!,polygon[i]!,polygon[i+1]!],null);
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
	const covered=new Set<TerrainCell>();
	const instances=tile_instances(cells,tiles,assets),placements=new Map(instances.flatMap(i=>i.members.map(c=>[c,i] as const)));
	for(const instance of instances) {
		let materials=ids.get(instance.key);
		if(!materials){materials=instance.asset.primitives.map((p,i)=>{
			const id=mesh.materials.length;mesh.materials.push({key:`${instance.key}/${i}`,tile:null,extra:false,...p});return id;
		});ids.set(instance.key,materials);}
		append_instance(mesh,instance,materials);instance.members.forEach(c=>covered.add(c));
		// The exported piece cannot know whether a later map exposes one of its outer sides.
		const members=new Set(instance.members);
		for(const cell of instance.members)for(const [edge,[dx,dy]] of OFFSETS.entries()) {
			const neighbor=lookup.get(`${cell.x+dx},${cell.y+dy}`);
			if(!neighbor||members.has(neighbor))continue;
			const neighbors:Neighbors=OFFSETS.map((_,i)=>i===edge?{tile:fetch_subtile(tiles,neighbor.tile,neighbor.subtile),height:neighbor.height-cell.height}:undefined);
			let boundary=boundary_remainder(walls(fetch_subtile(tiles,cell.tile,cell.subtile),neighbors,null),instance,cell,edge);
			const adjacent=placements.get(neighbor),legacy=assets.get(tile_key(tiles,neighbor.tile,neighbor.subtile));
			if(adjacent)boundary=boundary_remainder(boundary,adjacent,cell,edge);
			else if(legacy)boundary=boundary_remainder(boundary,{key:"",origin:neighbor,members:[neighbor],asset:legacy},cell,edge);
			if(!boundary.length)continue;
			const source=cliff_art(cell,boundary),material=mesh.materials.length;
			mesh.materials.push({key:instance.key+`/boundary@${cell.x},${cell.y}/${edge}`,tile:fetch_subtile(tiles,cell.tile,cell.subtile),extra:false,source});
			for(let i=0;i<boundary.length;i+=10) {
				boundary[i+3]=(24+24*(boundary[i]!-boundary[i+1]!)-source.left)/source.width;
				boundary[i+4]=(12*(boundary[i]!+boundary[i+1]!-boundary[i+2]!)-source.top)/source.height;
				boundary[i]=boundary[i]!+cell.x;boundary[i+1]=boundary[i+1]!+cell.y;boundary[i+2]=boundary[i+2]!+cell.height;boundary[i+5]=cell.x;boundary[i+6]=cell.y;
			}
			mesh.parts.push({kind:"closure",cell,material,vertices:boundary});mesh.triangles+=boundary.length/30;
		}
	}
	for (const cell of cells) {
		if(covered.has(cell))continue;
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
