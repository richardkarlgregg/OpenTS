// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Matrix3, Mesh, MeshStandardMaterial, SRGBColorSpace, Vector3, type Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { zipSync, strToU8 } from "fflate";
import { fetch_subtile, type TheaterTiles } from "./isotile";
import { terrain_image } from "./terrain-art";
import { TERRAIN_LEVEL, type TerrainCell } from "./terrain-mesh";
import { tile_key, tile_template, type TileAsset, type TileAssets } from "./terrain-tiles";
import { unpack_hicolor } from "./surface";

function original_image(tiles: TheaterTiles, tile: number, subtile: number): HTMLCanvasElement {
	const source = terrain_image(fetch_subtile(tiles,tile,subtile)!);
	const canvas=document.createElement("canvas"); canvas.width=source.width; canvas.height=source.height;
	const ctx=canvas.getContext("2d")!, pixels=ctx.createImageData(source.width,source.height);
	for(let i=0;i<source.indices.length;i++) { const index=source.indices[i]!; pixels.data.set([...unpack_hicolor(tiles.palette[index]!),index?255:0],i*4); }
	ctx.putImageData(pixels,0,0); return canvas;
}
const png = (canvas:HTMLCanvasElement):Promise<Uint8Array> => new Promise((resolve,reject)=>canvas.toBlob(blob=>{
	if (!blob) reject(new Error("PNG encoding failed")); else blob.arrayBuffer().then(b=>resolve(new Uint8Array(b)),reject);
},"image/png"));

export async function export_tile_glb(tiles:TheaterTiles,tile:number,subtile:number):Promise<ArrayBuffer> {
	const data=tile_template(fetch_subtile(tiles,tile,subtile)), positions:number[]=[],normals:number[]=[],uv:number[]=[];
	for(let i=0;i<data.length;i+=10) { positions.push(data[i]!,data[i+2]!*TERRAIN_LEVEL,-data[i+1]!); normals.push(data[i+7]!,data[i+9]!,-data[i+8]!); uv.push(data[i+3]!,data[i+4]!); }
	const geometry=new BufferGeometry(); geometry.setAttribute("position",new Float32BufferAttribute(positions,3)); geometry.setAttribute("normal",new Float32BufferAttribute(normals,3)); geometry.setAttribute("uv",new Float32BufferAttribute(uv,2));
	const map=new CanvasTexture(original_image(tiles,tile,subtile)); map.flipY=false; map.colorSpace=SRGBColorSpace;
	const material=new MeshStandardMaterial({map,side:DoubleSide,alphaTest:0.5,roughness:1,metalness:0});
	const mesh=new Mesh(geometry,material); mesh.name=tile_key(tiles,tile,subtile); mesh.userData={opentsTile:mesh.name,origin:"cell corner",heightLevel:TERRAIN_LEVEL};
	try { return await new GLTFExporter().parseAsync(mesh,{binary:true}) as ArrayBuffer; }
	finally {geometry.dispose();material.dispose();map.dispose();}
}

export async function export_tile_pack(tiles:TheaterTiles,theater:string,progress:(value:number)=>void,cancelled:()=>boolean):Promise<Blob> {
	const entries:Record<string,Uint8Array>={}, list:{tile:number;subtile:number}[]=[];
	for(let tile=0;tile<tiles.sets.length;tile++) for(let subtile=0;subtile<tiles.sets[tile]!.length;subtile++) list.push({tile,subtile});
	for(const [i,item] of list.entries()) {
		if(cancelled())throw new Error("Tile export cancelled");
		const key=tile_key(tiles,item.tile,item.subtile), base=`tiles/${theater.toLowerCase()}/${key}`;
		entries[`${base}.png`]=await png(original_image(tiles,item.tile,item.subtile));
		entries[`${base}.glb`]=new Uint8Array(await export_tile_glb(tiles,item.tile,item.subtile));
		const tile=fetch_subtile(tiles,item.tile,item.subtile)!;
		entries[`${base}.json`]=strToU8(JSON.stringify({version:1,theater,key,ramp:tile.ramp,recordHeight:tile.record_height??0,
			image:{left:terrain_image(tile).left,top:terrain_image(tile).top},triangles:tile_template(tile).length/30},null,2));
		progress((i+1)/list.length); if(i%8===0)await new Promise(resolve=>setTimeout(resolve,0));
	}
	entries["README.txt"]=strToU8("Import a tile GLB into Blender. Keep its origin, scale and placement; one cell side is one unit. glTF Y is up; Blender converts to Z-up. Edit the mesh, UVs, Base Color and Normal Map. Export selected tile objects as glTF Binary (.glb), with materials and images embedded, no compression or animations. Save at the same tiles/<theater>/<TMP filename>/<subtile>.glb path inside web/public/remaster/. Mission loading discovers files automatically. PNG files are the original indexed artwork expanded to RGBA. JSON files record tile identity and artwork offsets. Do not add the map's elevation to the asset: mission placement supplies it. These are low-poly starting meshes; cliffs and hidden surfaces need modelling.\n");
	if(cancelled())throw new Error("Tile export cancelled");
	return new Blob([zipSync(entries,{level:0}) as Uint8Array<ArrayBuffer>],{type:"application/zip"});
}

function texture_canvas(texture:Texture|null, color:[number,number,number,number], normal=false, cutoff=0):HTMLCanvasElement {
	if(texture && (texture.channel!==0 || texture.offset.lengthSq()!==0 || texture.repeat.x!==1 || texture.repeat.y!==1 || texture.rotation!==0)) throw new Error("Use UV0 with baked UV transforms for tile textures");
	const image=texture?.image as (CanvasImageSource & {width:number;height:number}) | undefined;
	const canvas=document.createElement("canvas"); canvas.width=image?.width??1; canvas.height=image?.height??1;
	if(canvas.width>4096||canvas.height>4096)throw new Error("Tile textures must be at most 4096×4096");
	const ctx=canvas.getContext("2d")!;
	if(image)ctx.drawImage(image,0,0);else {ctx.fillStyle=normal?"rgb(128,128,255)":"white";ctx.fillRect(0,0,canvas.width,canvas.height);}
	if(!normal) {
		const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
		for(let i=0;i<pixels.data.length;i+=4)for(let c=0;c<4;c++)pixels.data[i+c]=Math.round(pixels.data[i+c]!*color[c]!);
		for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=cutoff>0?(pixels.data[i]!>=cutoff*255?255:0):255;
		ctx.putImageData(pixels,0,0);
	}
	return canvas;
}

export async function import_tile_glb(bytes:ArrayBuffer):Promise<TileAsset> {
	const view=new DataView(bytes);
	if(bytes.byteLength<20||bytes.byteLength>100*1048576||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength)throw new Error("Expected a glTF 2.0 binary tile under 100 MB");
	const length=view.getUint32(12,true);
	if(view.getUint32(16,true)!==0x4e4f534a||20+length>bytes.byteLength)throw new Error("Invalid GLB JSON chunk");
	const json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));
	if((json.buffers??[]).some((b:{uri?:string})=>b.uri)|| (json.images??[]).some((i:{uri?:string})=>i.uri))throw new Error("Embed buffers and images in the GLB");
	if(json.animations?.length||json.skins?.length||json.extensionsRequired?.length)throw new Error("Export static tiles without compression or required extensions");
	const gltf=await new GLTFLoader().parseAsync(bytes,""); gltf.scene.updateMatrixWorld(true);
	const result:TileAsset={primitives:[]}; let vertices=0;
	const geometries=new Set<BufferGeometry>(), materials=new Set<MeshStandardMaterial>(), textures=new Set<Texture>();
	try {
		gltf.scene.traverse(object=>{
			if(!(object instanceof Mesh))return;
			if(object.type==="SkinnedMesh"||Object.keys(object.geometry.morphAttributes).length)throw new Error("Skinned and morphing tiles are unsupported");
			geometries.add(object.geometry);
			const mats=Array.isArray(object.material)?object.material:[object.material];
			for(const material of mats) {
				if(!(material instanceof MeshStandardMaterial))throw new Error("Use Blender Principled BSDF materials");
				materials.add(material); if(material.map)textures.add(material.map); if(material.normalMap)textures.add(material.normalMap);
				if(material.transparent || material.vertexColors || material.metalness!==0 || material.emissive.getHex()!==0 || material.roughnessMap || material.metalnessMap || material.aoMap)throw new Error("Use opaque or alpha-clipped, nonmetallic Base Color / Normal materials");
			}
			const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone(); geometries.add(geometry);
			if(!geometry.getAttribute("normal"))geometry.computeVertexNormals();
			const position=geometry.getAttribute("position"), normal=geometry.getAttribute("normal"), uv=geometry.getAttribute("uv");
			vertices+=position.count; if(vertices>750000||position.count%3)throw new Error("Tile exceeds 250,000 triangles or has non-triangle geometry");
			const groups=geometry.groups.length?geometry.groups:[{start:0,count:position.count,materialIndex:0}];
			for(const group of groups) {
				const material=mats[group.materialIndex??0] as MeshStandardMaterial;
				if((material.map||material.normalMap)&&!uv)throw new Error("Textured tile needs UV0");
				const color=material.color.clone().convertLinearToSRGB();
				const image=texture_canvas(material.map,[color.r,color.g,color.b,material.opacity],false,material.alphaTest);
				const normal_image=material.normalMap?texture_canvas(material.normalMap,[1,1,1,1],true):undefined;
				if(material.normalMap&&(Math.abs(material.normalScale.x)!==1||Math.abs(material.normalScale.y)!==1))throw new Error("Bake normal strength into the normal texture (strength 1)");
				const data:number[]=[], matrix=new Matrix3().getNormalMatrix(object.matrixWorld), p=new Vector3(),n=new Vector3();
				for(let i=group.start;i<group.start+group.count;i++) {
					p.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld); n.fromBufferAttribute(normal,i).applyMatrix3(matrix).normalize();
					const u=uv?.getX(i)??0,v=uv?.getY(i)??0;
					if(![p.x,p.y,p.z,n.x,n.y,n.z,u,v].every(Number.isFinite)||Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z))>64||u< -0.00001||u>1.00001||v< -0.00001||v>1.00001)throw new Error("Tile coordinates must be finite, within 64 cells, with UVs in 0–1");
					data.push(p.x,-p.z,p.y/TERRAIN_LEVEL,u,v,0,0,n.x,-n.z,n.y);
				}
				result.primitives.push({vertices:new Float32Array(data),image,normal_image});
			}
		});
		if(!result.primitives.length)throw new Error("GLB contains no static triangle meshes");
		return result;
	} finally {geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{(t.image as ImageBitmap)?.close?.();t.dispose();});}
}

export async function load_tile_assets(theater:string,cells:TerrainCell[],tiles:TheaterTiles,log:(text:string)=>void):Promise<TileAssets> {
	const assets:TileAssets=new Map();
	try {
		const response=await fetch(`${import.meta.env.BASE_URL}remaster/manifest.json`,{cache:"no-store"});
		if(!response.ok)return assets;
		const manifest: {version:number;files:{path:string;revision:string}[]}=await response.json();
		if(manifest.version!==1||!Array.isArray(manifest.files))throw new Error("Invalid remaster manifest");
		const available=new Map(manifest.files.map(f=>[f.path.toLowerCase(),f]));
		for(const key of new Set(cells.map(c=>tile_key(tiles,c.tile,c.subtile)))) {
			const file=available.get(`tiles/${theater.toLowerCase()}/${key}.glb`); if(!file)continue;
			if(!/^tiles\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/[0-9]+\.glb$/i.test(file.path))continue;
			try {
				const source=await fetch(`${import.meta.env.BASE_URL}remaster/${file.path}?v=${encodeURIComponent(file.revision)}`,{cache:"no-cache"});
				if(!source.ok)throw new Error(`HTTP ${source.status}`);
				assets.set(key,await import_tile_glb(await source.arrayBuffer()));
			} catch(error) {log(`Remaster tile ${key}: ${String(error)}. Using generated tile.`);}
		}
	} catch(error) {log(`Remaster assets unavailable: ${String(error)}. Using generated tiles.`);}
	log(`Remaster replacements: ${assets.size} unique tiles loaded.`); return assets;
}
