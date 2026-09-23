import { BoxGeometry, Group, Mesh, MeshStandardMaterial, CanvasTexture, Matrix4, Vector3 } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { unzipSync } from "fflate";
import { export_tile_glb,export_tile_pack,export_stamp_glb,export_stamp_pack,import_tile_glb,load_tile_assets } from "../src/terrain-assets";
import { tile_template,tile_prototype,tile_records,build_tile_map } from "../src/terrain-tiles";
import { TerrainRenderer } from "../src/terrain-renderer";
import { DSurface,build_hicolor_pixel } from "../src/surface";
import "../src/style.css";
const output=document.querySelector("#log")!;output.textContent="";
const log=(text:string)=>{output.textContent+=`${text}\n`;};
const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
window.addEventListener("unhandledrejection",e=>log(`FAIL: ${e.reason}`));
window.addEventListener("error",e=>log(`FAIL: ${e.message}`));
const tile={ramp:0,tile_type:0,colors:{low:[100,100,100] as [number,number,number],high:[100,100,100] as [number,number,number]},indices:new Uint8Array(576).fill(1),extra:null};
const palette=new Uint16Array(256);palette[0]=31;palette[1]=build_hicolor_pixel(180,120,60);
const tiles={sets:[[tile,tile]],names:["CLEAR01.TEM"],palette,bridge_set:-1,train_bridge_set:-1};
const binary=await export_tile_glb(tiles,0,0), asset=await import_tile_glb(binary), expected=tile_prototype(tiles,0,0);
const glbHeader=new DataView(binary), glbJson=JSON.parse(new TextDecoder().decode(new Uint8Array(binary,20,glbHeader.getUint32(12,true))));
const glbPrimitive=glbJson.meshes[0].primitives[0];
assert(glbJson.accessors[glbPrimitive.attributes.POSITION].count===4 && glbJson.accessors[glbPrimitive.indices].count===6,"Flat GLB must contain four shared corners and two triangles");
assert(asset.primitives[0]!.vertices.length===expected.length,"Round trip changed triangle count");
for(let i=0;i<expected.length;i++)assert(Math.abs(expected[i]!-asset.primitives[0]!.vertices[i]!)<1e-5,`Round trip changed vertex ${i}`);
const image=asset.primitives[0]!.image!,pixels=image.getContext("2d")!.getImageData(0,0,image.width,image.height).data;
assert(pixels[3]===255,"Generated ground should be opaque");assert(pixels[0]!>150,"Base-color image did not round trip");
const pack=await export_tile_pack(tiles,"TEMPERATE",()=>{},()=>false),files=unzipSync(new Uint8Array(await pack.arrayBuffer()));
assert(files['tiles/temperate/clear01.tem/0.png']&&files['tiles/temperate/clear01.tem/1.glb']&&files['tiles/temperate/clear01.tem/0.json'],"Tile kit missing image, model or metadata");
const original=await createImageBitmap(new Blob([files['tiles/temperate/clear01.tem/0.png']! as Uint8Array<ArrayBuffer>],{type:"image/png"}));
const originalCanvas=document.createElement("canvas");originalCanvas.width=original.width;originalCanvas.height=original.height;
const originalContext=originalCanvas.getContext("2d")!;originalContext.drawImage(original,0,0);original.close();
assert(originalContext.getImageData(0,0,1,1).data[3]===0,"Separate original PNG must retain transparency");
log("PASS: tile kit PNG + GLB + metadata; geometry, UVs, normals, color and alpha round trip.");
const normal=document.createElement("canvas");normal.width=normal.height=4;const nc=normal.getContext("2d")!;nc.fillStyle="rgb(128,128,255)";nc.fillRect(0,0,4,4);
const map=new CanvasTexture(normal);map.flipY=false;
const material=new MeshStandardMaterial({color:0x16cf95,metalness:0,roughness:1,normalMap:map});
const cube=new Mesh(new BoxGeometry(0.8,0.5,0.8),material);cube.position.set(0.5,0.25,-0.5);cube.rotation.y=0.2;
const replacement=await new GLTFExporter().parseAsync(cube,{binary:true}) as ArrayBuffer;
const parsed=await import_tile_glb(replacement);assert(parsed.primitives[0]!.normal_image,"Normal map lost on import");
assert(parsed.primitives[0]!.vertices.some((v,i)=>i%10===2&&v>0.5),"Node transform was ignored");
const cells=[{x:1,y:1,height:0,tile:0,subtile:0},{x:2,y:1,height:1,tile:0,subtile:1},{x:2,y:2,height:2,tile:0,subtile:0}];
const overrides=new Map([['clear01.tem/0',parsed]]),built=build_tile_map(cells,tiles,overrides);
assert(built.parts[1]!.vertices.length===tile_template(tile).length,"Unreplaced subtile did not retain fallback");
assert(built.parts[0]!.material===built.parts.at(-1)!.material,"Repeated replacement duplicates material identity");
const renderer=new TerrainRenderer(cells,tiles,new Map(),palette,undefined,overrides);
const black=new DSurface(640,400),white=new DSurface(640,400);white.fill(0xffff);
const canvas=document.querySelector<HTMLCanvasElement>("#frame")!;
canvas.getContext("2d")!.drawImage(renderer.render({x:-200,y:-100},640,400,black,white,()=>true),0,0);
const frame=canvas.getContext("2d")!.getImageData(0,0,640,400).data;
assert(frame.some((v,i)=>i%4===1&&v>100&&v>frame[i-1]!+30),"Replacement material was not rendered");
log("PASS: transformed replacement mesh, embedded normal map, repeated placement, mixed fallback and GPU rendering.");
let rejected=false;try{await import_tile_glb(new ArrayBuffer(24));}catch{rejected=true;}assert(rejected,"Corrupt GLB accepted");
let cancelled=false;try{await export_tile_pack(tiles,"TEMPERATE",()=>{},()=>true);}catch{cancelled=true;}assert(cancelled,"Export cancellation ignored");
const discovered=await load_tile_assets("TEMPERATE",cells,tiles,log);
log(`DISCOVERY: ${discovered.size} replacements loaded from the remaster folder.`);
const link=(title:string,name:string,blob:Blob)=>{const a=document.createElement("a");a.textContent=title;a.download=name;a.href=URL.createObjectURL(blob);a.style.marginRight="1rem";document.querySelector("#downloads")!.append(a);};
link("Download synthetic replacement","opents-test-replacement.glb",new Blob([replacement]));
link("Download synthetic tile kit","opents-test-tiles.zip",pack);
log("PASS: corrupt-file rejection and cancellation. Ready for folder-discovery check.");
for(let ramp=0;ramp<=20;ramp++) {
	const ramp_tiles={...tiles,sets:[[{...tile,ramp}]]};
	const imported=await import_tile_glb(await export_tile_glb(ramp_tiles,0,0));
	assert(imported.primitives.length>0,`Ramp ${ramp} exported no editable mesh`);
}
log("PASS: all 21 ramp types produce importable GLB starter meshes.");
const cliffTiles={...tiles,sets:[[{...tile,record_height:4,location:{x:0,y:0}},
	{...tile,record_height:0,location:{x:1,y:0},extra:{dx:0,dy:-48,width:24,height:60,indices:new Uint8Array(1440).fill(1)}}]]};
const cliff=await import_tile_glb(await export_tile_glb(cliffTiles,0,0)), cliffExpected=tile_prototype(cliffTiles,0,0);
assert(cliffExpected.length===120,"Cliff starter should contain two ground and two wall triangles");
for(let i=0;i<cliffExpected.length;i++) assert(Math.abs(cliffExpected[i]!-cliff.primitives[0]!.vertices[i]!)<1e-5,`Cliff GLB changed vertex ${i}`);
log("PASS: four-corner indexed flat GLB and connected cliff wall geometry survive export/import; original PNG alpha is preserved.");

const one=await export_tile_pack(tiles,'TEMPERATE',()=>{},()=>false,[{tile:65535,subtile:1}]);
const oneFiles=unzipSync(new Uint8Array(await one.arrayBuffer()));
assert(Object.keys(oneFiles).length===4&&oneFiles['tiles/temperate/clear01.tem/1.glb'],'Selected tile ZIP included other tiles or lost its canonical identity');
const edited=await export_tile_pack(tiles,'TEMPERATE',()=>{},()=>false,[{tile:0,subtile:0}],new Map([['clear01.tem/0',parsed]]));
const editedFiles=unzipSync(new Uint8Array(await edited.arrayBuffer()));
assert(editedFiles['tiles/temperate/clear01.tem/0.glb']!.every((v,i)=>v===new Uint8Array(replacement)[i]),'Export discarded the installed replacement');
const isolatedCells=[{x:8,y:9,height:4,tile:0,subtile:0},{x:9,y:9,height:0,tile:0,subtile:1}];
const isolatedMesh=build_tile_map(isolatedCells,tiles);
const selectedPack=await export_tile_pack(tiles,'TEMPERATE',()=>{},()=>false,[isolatedCells[0]!],new Map(),isolatedMesh);
const selectedFiles=unzipSync(new Uint8Array(await selectedPack.arrayBuffer()));
const selectedGLB=selectedFiles['tiles/temperate/clear01.tem/0.glb']!;
const selectedAsset=await import_tile_glb(selectedGLB.slice().buffer as ArrayBuffer);
assert(selectedAsset.primitives[0]!.vertices.length===120,'Selected cliff lost map boundary walls');
const local=selectedAsset.primitives[0]!.vertices;
for(let i=0;i<local.length;i+=10)assert(local[i]!>=0&&local[i]!<=1&&local[i+1]!>=0&&local[i+1]!<=1&&local[i+2]!>=-4&&local[i+2]!<=0,'Selected tile still has map translation/elevation');
log('PASS: single-tile ZIP, clear-tile identity, preservation of edited GLB, and map cliff export in local coordinates.');

const fullTiles={...tiles,names:['CLIFF17.TEM'],sets:[Array.from({length:4},(_,i)=>({...tile,location:{x:i%2,y:Math.floor(i/2)},record_height:i%2?0:4}))]};
const fullBinary=await export_stamp_glb(fullTiles,0),fullAsset=await import_tile_glb(fullBinary,true);
assert(fullAsset.primitives.reduce((count,p)=>count+p.vertices.length/30,0)===12,'Full CLIFF17 must contain four ground quads and two wall quads');
const fullHeader=new DataView(fullBinary), fullJson=JSON.parse(new TextDecoder().decode(new Uint8Array(fullBinary,20,fullHeader.getUint32(12,true))));
assert(fullJson.meshes.length===4&&fullJson.cameras?.[0]?.type==='orthographic','TMP export lost its four meshes or reference camera');
for(const [axis,lo,hi] of [[0,0,2],[1,0,2],[2,0,4]]) {
 const values=fullAsset.primitives.flatMap(p=>Array.from(p.vertices).filter((_,i)=>i%10===axis));
 assert(Math.abs(Math.min(...values)-lo!)<1e-5&&Math.abs(Math.max(...values)-hi!)<1e-5,`Full TMP bounds wrong on axis ${axis}`);
}
const fullCells=tile_records(fullTiles,0).map(c=>({...c,x:c.x+8,y:c.y+9,height:c.height+6}));
const fullMap=build_tile_map(fullCells,fullTiles,new Map([['cliff17.tem/tile',fullAsset]]));
assert(fullMap.triangles===12&&new Set(fullMap.parts.map(p=>`${p.cell.x},${p.cell.y}`)).size===4,'Full TMP replacement duplicated or lost footprint members');
const fullPack=await export_stamp_pack(fullTiles,'TEMPERATE',()=>{},()=>false,[0]);
const fullFiles=unzipSync(new Uint8Array(await fullPack.arrayBuffer()));
assert(Object.keys(fullFiles).length===4&&fullFiles['tiles/temperate/cliff17.tem/tile.glb'],'Full TMP package path or count is wrong');
const fullMeta=JSON.parse(new TextDecoder().decode(fullFiles['tiles/temperate/cliff17.tem/tile.json']));
assert(fullMeta.cells.length===4&&fullMeta.replacementPath==='public/remaster/tiles/temperate/cliff17.tem/tile.glb','Full TMP metadata lost footprint or replacement path');
const repeatedPack=await export_stamp_pack(fullTiles,'TEMPERATE',()=>{},()=>false,[0],new Map([['cliff17.tem/tile',fullAsset]]));
const repeatedFiles=unzipSync(new Uint8Array(await repeatedPack.arrayBuffer()));
assert(repeatedFiles['tiles/temperate/cliff17.tem/tile.glb']!.every((value,i)=>value===new Uint8Array(fullBinary)[i]),'Re-export changed installed whole-piece model');
await load_tile_assets('TEMPERATE',fullCells,fullTiles,log);
link('Download full synthetic TMP','opents-full-cliff17.zip',fullPack);
log('PASS: complete 2x2 TMP export/import, orthographic reference camera, local bounds, one replacement per footprint, and full-piece package paths.');
const cameraNode=fullJson.nodes.find((node:{camera?:number})=>node.camera===0), view=new Matrix4().fromArray(cameraNode.matrix).invert();
const axisX=new Vector3(1,0,0).transformDirection(view), axisY=new Vector3(0,0,1).transformDirection(view);
assert(axisX.x>0&&axisX.y<0&&axisY.x<0&&axisY.y<0&&Math.abs(axisX.x/axisX.y+2)<1e-5&&Math.abs(axisY.x/axisY.y-2)<1e-5,'Reference camera mirrored or rotated the TMP axes');
for(const [i,r] of tile_records(fullTiles,0).entries()) {
 const expected=tile_prototype(fullTiles,0,r.subtile),actual=fullAsset.primitives[i]!.vertices;
 for(let k=0;k<expected.length;k++) {
  const axis=k%10,offset=axis===0?r.x:axis===1?r.y:axis===2?r.height:0;
  assert(Math.abs(actual[k]!-expected[k]!-offset)<1e-5,`Full TMP reflected coordinates, UVs or normals: record ${i}, component ${k}`);
 }
}
log('PASS: complete-piece handedness, winding, normals, and both TS camera axes survive GLB round trip.');

// Baked-material import and GPU channel controls.
const solidMap=(color:string)=>{const c=document.createElement('canvas');c.width=c.height=4;const ctx=c.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,4,4);const t=new CanvasTexture(c);t.flipY=false;return t;};
const orm=solidMap('rgb(64,128,192)'),bakedNormal=solidMap('rgb(200,128,220)'),emission=solidMap('rgb(180,80,30)');
const bakedMaterial=new MeshStandardMaterial({color:0x888888,roughness:.6,metalness:.8,roughnessMap:orm,metalnessMap:orm,aoMap:orm,aoMapIntensity:.6,normalMap:bakedNormal,emissive:0x804020,emissiveMap:emission});
bakedMaterial.normalScale.set(.7,.7);
const bakedMesh=new Mesh(new BoxGeometry(.8,.5,.8),bakedMaterial);bakedMesh.position.set(.5,.25,-.5);
const bakedBinary=await new GLTFExporter().parseAsync(bakedMesh,{binary:true}) as ArrayBuffer;
const baked=await import_tile_glb(bakedBinary),surface=baked.primitives[0]!;
const channels=surface.orm_image!.getContext('2d')!.getImageData(0,0,1,1).data;
assert(Math.abs(channels[0]!-140)<2&&Math.abs(channels[1]!-77)<2&&Math.abs(channels[2]!-154)<2,`Packed ORM channels/factors wrong: ${channels}`);
assert(Math.abs(surface.normal_scale![0]-.7)<1e-5&&surface.emissive_image&&surface.emissive_factor![0]>0,'Normal scale or emissive map/factor lost');
const bakedCells=[{x:0,y:0,height:0,tile:0,subtile:0}],bakedAssets=new Map([['clear01.tem/0',baked]]);
const bakedRenderer=new TerrainRenderer(bakedCells,tiles,new Map(),palette,undefined,bakedAssets);
bakedRenderer.settings.shadows=false;bakedRenderer.settings.map_tint=false;bakedRenderer.settings.azimuth=45;bakedRenderer.settings.elevation=60;
const bc=document.createElement('canvas');bc.width=640;bc.height=400;const bctx=bc.getContext('2d')!;
const capture=(cursor?:{x:number;y:number},visible=true)=>{bctx.drawImage(bakedRenderer.render({x:-200,y:-100},640,400,black,white,()=>visible,cursor),0,0);return bctx.getImageData(0,0,640,400).data;};
const delta=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>a.reduce((n,v,i)=>n+(i%4!==3&&Math.abs(v-b[i]!)>1?1:0),0);
const baseFrame=capture();
for(const key of ['textures','normal_maps','roughness','metallic','occlusion','emissive'] as const){bakedRenderer.settings[key]=false;const changed=delta(baseFrame,capture());assert(changed>5,`${key} control has no GPU effect (${changed})`);bakedRenderer.settings[key]=true;}
bakedRenderer.settings.normal_strength=0;assert(delta(baseFrame,capture())>5,'Normal strength has no GPU effect');bakedRenderer.settings.normal_strength=1;
bakedRenderer.settings.cursor_light=true;
const litFrame=capture({x:200,y:124});assert(delta(baseFrame,litFrame)>10,'Cursor light has no GPU effect');
assert(delta(litFrame,capture({x:208,y:132}))>5,'Cursor light does not move');
assert(delta(baseFrame,capture({x:500,y:124}))===0,'Cursor light remains active over sidebar');
assert(delta(baseFrame,capture())===0,'Cursor light remains active after leaving terrain');
assert(capture({x:200,y:124},false).every((v,i)=>i%4===3||v===0),'Cursor light reveals shrouded terrain');
bakedRenderer.settings.lighting=false;const unlitBaked=capture();assert(delta(unlitBaked,capture({x:200,y:124}))>5,'Cursor light requires directional lighting');
const bakedScene=bakedRenderer.build_gltf('TEST'),pbrExport=bakedScene.materials.find(m=>m.normalTexture);
assert(pbrExport?.occlusionTexture&&pbrExport.pbrMetallicRoughness.metallicRoughnessTexture&&pbrExport.emissiveTexture,'Whole-map export lost baked maps');
bakedRenderer.dispose();
const generatedSettings={...renderer.settings,replacements:false};
const generatedRenderer=new TerrainRenderer(bakedCells,tiles,new Map(),palette,generatedSettings,bakedAssets);
assert(generatedRenderer.mesh.triangles===2&&!generatedRenderer.mesh.materials.some(m=>m.pbr),'Disabled replacements still use asset meshes or materials');generatedRenderer.dispose();
renderer.dispose();
log('PASS: ORM channels and factors, normal strength, emissive maps, all six GPU material toggles, cursor movement/sidebar/shroud, map export and generated-asset fallback.');

link("Download baked material test","opents-baked-test.glb",new Blob([bakedBinary]));

const multiScene=new Group(),intended=new Group(),unrelated=new Group();intended.name='cliff15.tem';unrelated.name='proad09.tem';
intended.add(new Mesh(new BoxGeometry(1,1,1),new MeshStandardMaterial({metalness:0})));unrelated.add(new Mesh(new BoxGeometry(1,1,1),new MeshStandardMaterial({metalness:0})));unrelated.position.x=8;multiScene.add(intended,unrelated);
const multiBinary=await new GLTFExporter().parseAsync(multiScene,{binary:true}) as ArrayBuffer;
const focused=await import_tile_glb(multiBinary,true,'cliff15.tem'),allGroups=await import_tile_glb(multiBinary,true);
assert(focused.primitives.reduce((n,p)=>n+p.vertices.length/30,0)===12&&allGroups.primitives.reduce((n,p)=>n+p.vertices.length/30,0)===24,'Complete tile loader included an unrelated Blender group');
assert(focused.source===multiBinary,'Focused import mutated user asset bytes');
log('PASS: filename-matched TMP group excludes unrelated Blender objects without modifying the asset.');
