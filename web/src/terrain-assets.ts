// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, OrthographicCamera, Matrix3, Mesh, MeshStandardMaterial, SRGBColorSpace, Vector3, type Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { zipSync, strToU8 } from "fflate";
import { fetch_subtile, type TheaterTiles } from "./isotile";
import { terrain_image, tile_art, stamp_image, type TerrainImage } from "./terrain-art";
import { TERRAIN_LEVEL, type TerrainCell, type TerrainMesh } from "./terrain-mesh";
import { tile_key, tile_set_key, tile_records, tile_instances, tile_identity, tile_prototype, type TileAsset, type TileAssets } from "./terrain-tiles";
import { unpack_hicolor } from "./surface";

function original_image(tiles: TheaterTiles, tile: number, subtile: number, mesh_texture=false): HTMLCanvasElement {
	const source = mesh_texture ? tile_art(tiles,tile,subtile)! : terrain_image(fetch_subtile(tiles,tile,subtile)!);
	return palette_image(tiles,source);
}

function palette_image(tiles:TheaterTiles,source:TerrainImage):HTMLCanvasElement {
	const canvas=document.createElement("canvas"); canvas.width=source.width; canvas.height=source.height;
	const ctx=canvas.getContext("2d")!, pixels=ctx.createImageData(source.width,source.height);
	for(let i=0;i<source.indices.length;i++) { const index=source.indices[i]!; pixels.data.set([...unpack_hicolor(tiles.palette[index]!),index?255:0],i*4); }
	ctx.putImageData(pixels,0,0); return canvas;
}
const png = (canvas:HTMLCanvasElement):Promise<Uint8Array> => new Promise((resolve,reject)=>canvas.toBlob(blob=>{
	if (!blob) reject(new Error("PNG encoding failed")); else blob.arrayBuffer().then(b=>resolve(new Uint8Array(b)),reject);
},"image/png"));

function make_tile_mesh(data:Float32Array,image:HTMLCanvasElement,name:string,stamp=false):Mesh<BufferGeometry,MeshStandardMaterial> {
	const positions:number[]=[],normals:number[]=[],uv:number[]=[];
	const indices:number[]=[], shared=new Map<string,number>();
	for(let i=0;i<data.length;i+=10) {
		const key=[...data.slice(i,i+5),...data.slice(i+7,i+10)].join(",");
		let vertex=shared.get(key);
		if(vertex===undefined) {
			vertex=positions.length/3; shared.set(key,vertex);
			positions.push(data[i]!,data[i+2]!*TERRAIN_LEVEL,(stamp?1:-1)*data[i+1]!); normals.push(data[i+7]!,data[i+9]!,(stamp?1:-1)*data[i+8]!); uv.push(data[i+3]!,data[i+4]!);
		}
		indices.push(vertex);
	}
	// TS screen axes have opposite handedness to glTF; full-piece exports reflect map Y.
	if(stamp)for(let i=0;i<indices.length;i+=3){const second=indices[i+1]!;indices[i+1]=indices[i+2]!;indices[i+2]=second;}
	const geometry=new BufferGeometry(); geometry.setAttribute("position",new Float32BufferAttribute(positions,3)); geometry.setAttribute("normal",new Float32BufferAttribute(normals,3)); geometry.setAttribute("uv",new Float32BufferAttribute(uv,2));
	geometry.setIndex(indices);
	const map=new CanvasTexture(image); map.flipY=false; map.colorSpace=SRGBColorSpace;
	const material=new MeshStandardMaterial({map,side:DoubleSide,alphaTest:0.5,roughness:1,metalness:0});
	const mesh=new Mesh(geometry,material); mesh.name=name; return mesh;
}

function dispose_tile_mesh(mesh:Mesh<BufferGeometry,MeshStandardMaterial>):void {
	mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();
}

export async function export_tile_glb(tiles:TheaterTiles,tile:number,subtile:number, selected?:{vertices:Float32Array;image:HTMLCanvasElement}):Promise<ArrayBuffer> {
	const mesh=make_tile_mesh(selected?.vertices??tile_prototype(tiles,tile,subtile),selected?.image??original_image(tiles,tile,subtile,true),tile_key(tiles,tile,subtile));
	mesh.userData={opentsTile:mesh.name,origin:"cell corner",heightLevel:TERRAIN_LEVEL};
	try { return await new GLTFExporter().parseAsync(mesh,{binary:true}) as ArrayBuffer; }
	finally {dispose_tile_mesh(mesh);}
}

export async function export_stamp_glb(tiles:TheaterTiles,index:number):Promise<ArrayBuffer> {
	index=tile_identity(tiles,index,0).tile;
	const records=tile_records(tiles,index), group=new Group(), meshes:Mesh<BufferGeometry,MeshStandardMaterial>[]=[];
	if(!records.length)throw new Error("TMP has no occupied cells");
	group.name=tile_set_key(tiles,index);
	group.userData={opentsTileSet:group.name,version:1,heightLevel:TERRAIN_LEVEL,origin:"TMP grid corner at base height",cells:records};
	let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
	try {
		for(const record of records) {
			const data=tile_prototype(tiles,index,record.subtile);
			const mesh=make_tile_mesh(data,original_image(tiles,index,record.subtile,true),`subtile_${record.subtile}`,true);
			mesh.position.set(record.x,record.height*TERRAIN_LEVEL,record.y);
			mesh.userData={opentsSubtile:record.subtile,cellX:record.x,cellY:record.y,recordHeight:record.height};
			group.add(mesh);meshes.push(mesh);
			for(let i=0;i<data.length;i+=10) {
				const x=data[i]!+record.x,y=data[i+1]!+record.y,z=data[i+2]!+record.height;
				const s=(x-y)/Math.SQRT2,t=(z-x-y)/(2*Math.SQRT2);
				left=Math.min(left,s);right=Math.max(right,s);bottom=Math.min(bottom,t);top=Math.max(top,t);
			}
		}
		// Camera basis projects X/Y cell axes to the original 2:1 diamond; it is not a mesh rotation.
		// Three r186's exporter writes xmag=right*2 and ymag=top*2.
		const camera=new OrthographicCamera(-(right-left)/4-.075,(right-left)/4+.075,(top-bottom)/4+.075,-(top-bottom)/4-.075,.1,1000);
		const s=(left+right)/2,t=(top+bottom)/2,target=new Vector3((s-2*t)/Math.SQRT2,0,(-s-2*t)/Math.SQRT2);
		camera.name="Tiberian Sun isometric reference";camera.position.copy(target).add(new Vector3(1,2*TERRAIN_LEVEL,1).multiplyScalar(100));camera.lookAt(target);
		group.add(camera);group.updateMatrixWorld(true);
		return await new GLTFExporter().parseAsync(group,{binary:true}) as ArrayBuffer;
	} finally {meshes.forEach(dispose_tile_mesh);}
}

export async function export_stamp_pack(tiles:TheaterTiles,theater:string,progress:(value:number)=>void,cancelled:()=>boolean,selection?:number[],assets?:TileAssets):Promise<Blob> {
	const list=[...new Set(selection?.map(index=>tile_identity(tiles,index,0).tile)??tiles.sets.map((_,i)=>i))].filter(i=>tile_records(tiles,i).length);
	const entries:Record<string,Uint8Array>={};
	for(const [i,index] of list.entries()) {
		if(cancelled())throw new Error("Tile export cancelled");
		const name=tile_set_key(tiles,index),key=`${name}/tile`,base=`tiles/${theater.toLowerCase()}/${key}`,image=stamp_image(tiles,index);
		const replacement=assets?.get(key)?.source;
		entries[`${base}.glb`]=new Uint8Array(replacement??await export_stamp_glb(tiles,index));
		entries[`${base}.png`]=await png(palette_image(tiles,image));
		entries[`${base}.json`]=strToU8(JSON.stringify({version:3,theater,name,replacementPath:`public/remaster/${base}.glb`,geometrySource:replacement?"replacement":"complete TMP footprint",
			origin:"TMP grid corner at base height",heightLevel:TERRAIN_LEVEL,cells:tile_records(tiles,index).map(({tile,...record})=>record),
			image:{left:image.left,top:image.top,width:image.width,height:image.height},axes:{gltf:"X = map X, Y = elevation, Z = map Y",blender:"X = map X, Y = negative map Y, Z = elevation"}},null,2));
		progress((i+1)/list.length);await new Promise(resolve=>setTimeout(resolve,0));
	}
	entries["README.txt"]=strToU8("Each tile.glb contains one COMPLETE TMP piece, with all occupied subtiles at their native grid positions and record heights. Import it into Blender; the children are named subtile_N and share one TMP origin. Do not reset their transforms or center each object separately. Blender converts glTF Y-up to Z-up: Blender X follows map X, Blender Y is negative map Y, and Blender Z is elevation. The included orthographic camera matches the Tiberian Sun viewing angle (use the camera view to compare with tile.png). Edit the whole piece; you may join mesh objects. Bake high-poly detail into UV0 Base Color (sRGB), tangent-space +Y normal maps (Non-Color), roughness and AO; optional metallic and emission maps are supported. Use Principled BSDF. ORM channels are R=AO, G=roughness, B=metallic; AO uses the glTF Material Output Occlusion input. Preserve texture seams when welding. Export all its mesh objects with their transforms as an embedded glTF Binary, preserving the assembly origin and scale. Save at the exact tiles/<theater>/<TMP filename>/tile.glb path under web/public/remaster/. Reload the mission. A complete matching footprint is replaced once; incomplete or height-modified footprints keep generated/legacy subtile fallbacks. Full-piece assets take priority over older numbered-subtile GLBs. The PNG is the assembled original artwork, including transparent pixels. JSON lists the native footprint and axis convention. Ground uses two triangles per cell; only height gaps INSIDE this TMP create starter cliff walls. Model hidden rock detail as needed.\n");
	if(cancelled())throw new Error("Tile export cancelled");
	return new Blob([zipSync(entries,{level:0}) as Uint8Array<ArrayBuffer>],{type:"application/zip"});
}

export async function export_tile_pack(tiles:TheaterTiles,theater:string,progress:(value:number)=>void,cancelled:()=>boolean,
	selection?: {tile:number;subtile:number;x?:number;y?:number;height?:number}[], assets?: TileAssets, context?:TerrainMesh):Promise<Blob> {
	const entries:Record<string,Uint8Array>={}, list:{tile:number;subtile:number;x?:number;y?:number;height?:number}[]=[];
	if(selection) list.push(...selection.map(item=>({...item,...tile_identity(tiles,item.tile,item.subtile)})));
	else for(let tile=0;tile<tiles.sets.length;tile++) for(let subtile=0;subtile<tiles.sets[tile]!.length;subtile++) list.push({tile,subtile});
	for(const [i,item] of list.entries()) {
		if(cancelled())throw new Error("Tile export cancelled");
		const key=tile_key(tiles,item.tile,item.subtile), base=`tiles/${theater.toLowerCase()}/${key}`;
		const asset=assets?.get(key);
		const parts=!asset?.source&&context?context.parts.filter(p=>p.cell.x===item.x&&p.cell.y===item.y):[];
		let selected:{vertices:Float32Array;image:HTMLCanvasElement}|undefined;
		const source=parts.length?context!.materials[parts[0]!.material]!.source:undefined;
		if(parts.length&&source&&item.height!==undefined) {
			const vertices=new Float32Array(parts.reduce((sum,p)=>sum+p.vertices.length,0)); let offset=0;
			for(const part of parts) { vertices.set(part.vertices,offset); offset+=part.vertices.length; }
			for(let j=0;j<vertices.length;j+=10) {vertices[j]=vertices[j]!-item.x!;vertices[j+1]=vertices[j+1]!-item.y!;vertices[j+2]=vertices[j+2]!-item.height;vertices[j+5]=vertices[j+6]=0;}
			selected={vertices,image:palette_image(tiles,source)};
		}
		if(!fetch_subtile(tiles,item.tile,item.subtile)) throw new Error("Original tile artwork is unavailable");
		entries[`${base}.png`]=await png(original_image(tiles,item.tile,item.subtile));
		entries[`${base}.glb`]=new Uint8Array(asset?.source??await export_tile_glb(tiles,item.tile,item.subtile,selected));
		const tile=fetch_subtile(tiles,item.tile,item.subtile)!;
		const texture=source??tile_art(tiles,item.tile,item.subtile)!;
		entries[`${base}.json`]=strToU8(JSON.stringify({version:2,theater,key,replacementPath:`public/remaster/${base}.glb`,geometrySource:asset?.source?"replacement":selected?"selected map tile":"generated",ramp:tile.ramp,recordHeight:tile.record_height??0,location:tile.location,
			image:{left:terrain_image(tile).left,top:terrain_image(tile).top},meshTexture:asset?.source?undefined:{left:texture.left,top:texture.top,width:texture.width,height:texture.height},
			wallOwnership:asset?.source?"replacement geometry":selected?"higher cell; selected map neighbors":"higher cell; TMP internal neighbors",
			triangles:asset?.source?asset.primitives.reduce((sum,p)=>sum+p.vertices.length/30,0):(selected?.vertices??tile_prototype(tiles,item.tile,item.subtile)).length/30},null,2));
		progress((i+1)/list.length); if(i%8===0)await new Promise(resolve=>setTimeout(resolve,0));
	}
	entries["README.txt"]=strToU8("Import a tile GLB into Blender. Keep its origin, scale and placement; one cell side is one unit. glTF Y is up; Blender converts to Z-up. Edit the mesh, UVs, Base Color and Normal Map. Export selected tile objects as glTF Binary (.glb), with materials and images embedded, no compression or animations. Save at the same tiles/<theater>/<TMP filename>/<subtile>.glb path inside web/public/remaster/. Mission loading discovers files automatically. PNG files are the original indexed artwork expanded to RGBA. JSON files record tile identity and artwork offsets. Do not add the map's elevation to the asset: mission placement supplies it. Generated ground uses two triangles. Theater-kit walls use neighbors in the TMP stamp; right-click exports use the selected map cell's neighbors. Edited replacements are exported as loaded. A replacement applies to every matching tile; check boundary compatibility on other maps. GLB textures combine neighboring TMP records and extend color into unpainted regions; the separate PNG preserves the original image. Re-export kits to obtain updated starter geometry.\n");
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
		for(let i=0;i<pixels.data.length;i+=4) {
			for(let c=0;c<3;c++) {
				const value=pixels.data[i+c]!/255,linear=(value<=.04045?value/12.92:((value+.055)/1.055)**2.4)*color[c]!;
				pixels.data[i+c]=255*(linear<=.0031308?linear*12.92:1.055*linear**(1/2.4)-.055);
			}
			pixels.data[i+3]=Math.round(pixels.data[i+3]!*color[3]);
		}
		for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=cutoff>0?(pixels.data[i]!>=cutoff*255?255:0):255;
		ctx.putImageData(pixels,0,0);
	}
	return canvas;
}

/** glTF data maps are linear: AO red, roughness green, metallic blue. */
function material_orm(material:MeshStandardMaterial):HTMLCanvasElement {
	const maps=[material.aoMap,material.roughnessMap,material.metalnessMap].map(t=>t?texture_canvas(t,[1,1,1,1],true):null);
	const canvas=document.createElement("canvas");canvas.width=Math.max(1,...maps.map(c=>c?.width??1));canvas.height=Math.max(1,...maps.map(c=>c?.height??1));
	const ctx=canvas.getContext("2d")!,pixels=ctx.createImageData(canvas.width,canvas.height);
	const channels=maps.map(c=>{if(!c)return null;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(c,0,0,canvas.width,canvas.height);return ctx.getImageData(0,0,canvas.width,canvas.height).data;});
	for(let i=0;i<pixels.data.length;i+=4) {
		pixels.data[i]=255*(1+material.aoMapIntensity*((channels[0]?.[i]??255)/255-1));
		pixels.data[i+1]=(channels[1]?.[i+1]??255)*material.roughness;
		pixels.data[i+2]=(channels[2]?.[i+2]??255)*material.metalness;
		pixels.data[i+3]=255;
	}
	ctx.putImageData(pixels,0,0);return canvas;
}

export async function import_tile_glb(bytes:ArrayBuffer,stamp=false,expected_name?:string):Promise<TileAsset> {
	const view=new DataView(bytes);
	if(bytes.byteLength<20||bytes.byteLength>100*1048576||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength)throw new Error("Expected a glTF 2.0 binary tile under 100 MB");
	const length=view.getUint32(12,true);
	if(view.getUint32(16,true)!==0x4e4f534a||20+length>bytes.byteLength)throw new Error("Invalid GLB JSON chunk");
	const json=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));
	if((json.buffers??[]).some((b:{uri?:string})=>b.uri)|| (json.images??[]).some((i:{uri?:string})=>i.uri))throw new Error("Embed buffers and images in the GLB");
	if(json.animations?.length||json.skins?.length||json.extensionsRequired?.some((name:string)=>name!=="KHR_materials_emissive_strength"))throw new Error("Export static tiles without compression or required extensions");
	const gltf=await new GLTFLoader().parseAsync(bytes,""); gltf.scene.updateMatrixWorld(true);
	const named:typeof gltf.scene[]=[];
	if(expected_name)gltf.scene.traverse(object=>{if(String(object.userData.name??object.name).toLowerCase()===expected_name.toLowerCase())named.push(object as typeof gltf.scene);});
	const root=named[0]??gltf.scene;
	const result:TileAsset={primitives:[],source:bytes}; let vertices=0;
	const geometries=new Set<BufferGeometry>(), materials=new Set<MeshStandardMaterial>(), textures=new Set<Texture>();
	try {
		gltf.scene.traverse(object=>{
			if(!(object instanceof Mesh))return;
			geometries.add(object.geometry);
			const mats=Array.isArray(object.material)?object.material:[object.material];
			for(const material of mats){materials.add(material);for(const value of Object.values(material))if(value&&typeof value==="object"&&"isTexture" in value)textures.add(value as Texture);}
		});
		if(named.length>1)throw new Error("GLB contains multiple copies of "+expected_name+"; export only the intended piece");
		root.traverse(object=>{
			if(!(object instanceof Mesh))return;
			if(object.type==="SkinnedMesh"||Object.keys(object.geometry.morphAttributes).length)throw new Error("Skinned and morphing tiles are unsupported");
			geometries.add(object.geometry);
			const mats=Array.isArray(object.material)?object.material:[object.material];
			for(const material of mats) {
				if(!(material instanceof MeshStandardMaterial))throw new Error("Use Blender Principled BSDF materials");
				materials.add(material); for(const texture of [material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.aoMap,material.emissiveMap])if(texture)textures.add(texture);
				if(material.transparent || material.vertexColors)throw new Error("Use opaque or alpha-clipped materials without vertex colors");
			}
			const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone(); geometries.add(geometry);
			if(!geometry.getAttribute("normal"))geometry.computeVertexNormals();
			const position=geometry.getAttribute("position"), normal=geometry.getAttribute("normal"), uv=geometry.getAttribute("uv");
			vertices+=position.count; if(vertices>750000||position.count%3)throw new Error("Tile exceeds 250,000 triangles or has non-triangle geometry");
			const groups=geometry.groups.length?geometry.groups:[{start:0,count:position.count,materialIndex:0}];
			for(const group of groups) {
				const material=mats[group.materialIndex??0] as MeshStandardMaterial;
				if([material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.aoMap,material.emissiveMap].some(Boolean)&&!uv)throw new Error("Textured tile needs UV0");
				const color=material.color;
				const image=texture_canvas(material.map,[color.r,color.g,color.b,material.opacity],false,material.alphaTest);
				const normal_image=material.normalMap?texture_canvas(material.normalMap,[1,1,1,1],true):undefined;
				const orm_image=material_orm(material);
					const emissive_image=material.emissiveMap?texture_canvas(material.emissiveMap,[1,1,1,1],true):undefined;
					const emissive_factor:[number,number,number]=[material.emissive.r*material.emissiveIntensity,material.emissive.g*material.emissiveIntensity,material.emissive.b*material.emissiveIntensity];
					const normal_scale:[number,number]=[material.normalScale.x,material.normalScale.y];
					if(![...normal_scale,...emissive_factor].every(Number.isFinite))throw new Error("Material factors must be finite");
				const data:number[]=[], matrix=new Matrix3().getNormalMatrix(object.matrixWorld), p=new Vector3(),n=new Vector3();
				for(let i=group.start;i<group.start+group.count;i++) {
					const corner=(i-group.start)%3,j=stamp?i+(corner===1?1:corner===2?-1:0):i;
					p.fromBufferAttribute(position,j).applyMatrix4(object.matrixWorld); n.fromBufferAttribute(normal,j).applyMatrix3(matrix).normalize();
					const u=uv?.getX(j)??0,v=uv?.getY(j)??0;
					if(![p.x,p.y,p.z,n.x,n.y,n.z,u,v].every(Number.isFinite)||Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.z))>64||u< -0.00001||u>1.00001||v< -0.00001||v>1.00001)throw new Error("Tile coordinates must be finite, within 64 cells, with UVs in 0–1");
					data.push(p.x,(stamp?1:-1)*p.z,p.y/TERRAIN_LEVEL,u,v,0,0,n.x,(stamp?1:-1)*n.z,n.y);
				}
				result.primitives.push({vertices:new Float32Array(data),image,normal_image,orm_image,emissive_image,emissive_factor,normal_scale,pbr:true});
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
		const keys=new Set(cells.flatMap(c=>[`${tile_set_key(tiles,c.tile)}/tile`,tile_key(tiles,c.tile,c.subtile)]));
		for(const key of keys) {
			const file=available.get(`tiles/${theater.toLowerCase()}/${key}.glb`); if(!file)continue;
			if(!/^tiles\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/(?:[0-9]+|tile)\.glb$/i.test(file.path))continue;
			try {
				const source=await fetch(`${import.meta.env.BASE_URL}remaster/${file.path}?v=${encodeURIComponent(file.revision)}`,{cache:"no-cache"});
				if(!source.ok)throw new Error(`HTTP ${source.status}`);
				assets.set(key,await import_tile_glb(await source.arrayBuffer(),key.endsWith("/tile"),key.endsWith("/tile")?key.slice(0,-5):undefined));
			} catch(error) {log(`Remaster tile ${key}: ${String(error)}. Using generated tile.`);}
		}
	} catch(error) {log(`Remaster assets unavailable: ${String(error)}. Using generated tiles.`);}
	log(`Remaster replacements: ${assets.size} unique tiles loaded.`);
	if([...assets.keys()].some(key=>key.endsWith("/tile")))log(`Complete TMP replacements: ${tile_instances(cells,tiles,assets).length} matching map footprints. Incomplete or altered footprints use subtile fallbacks.`);
	return assets;
}
