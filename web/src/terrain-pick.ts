// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import { terrain_project, type TerrainCell, type TerrainMesh } from "./terrain-mesh";

/** Pick the frontmost visible triangle using the same orthographic depth as the renderer. */
export function pick_terrain_cell(mesh: TerrainMesh, x: number, y: number, mapped: (x:number,y:number)=>boolean): TerrainCell | null {
	let selected: TerrainCell | null = null, depth = -Infinity;
	for(const part of mesh.parts) {
		if(!mapped(part.cell.x,part.cell.y)) continue;
		const v=part.vertices;
		for(let i=0;i<v.length;i+=30) {
			const p=[0,10,20].map(k=>terrain_project(v[i+k]!,v[i+k+1]!,v[i+k+2]!));
			const [a,b,c]=p as [[number,number],[number,number],[number,number]];
			const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
			if(Math.abs(det)<1e-8) continue;
			const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det;
			const w=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det;
			if(u<0 || w<0 || u+w>1) continue;
			const weights=[u,w,1-u-w], interpolate=(offset:number)=>weights.reduce((sum,t,k)=>sum+t*v[i+k*10+offset]!,0);
			const z=interpolate(0)+interpolate(1)+interpolate(2)/3;
			if(z<depth) continue;
			const image=mesh.materials[part.material]?.image;
			if(image) {
				const px=Math.max(0,Math.min(image.width-1,Math.floor(interpolate(3)*image.width)));
				const py=Math.max(0,Math.min(image.height-1,Math.floor(interpolate(4)*image.height)));
				if((image.getContext("2d")?.getImageData(px,py,1,1).data[3]??255)<128) continue;
			}
			depth=z; selected=part.cell;
		}
	}
	return selected;
}
