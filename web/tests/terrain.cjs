const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { build_terrain_mesh, terrain_height, terrain_project } = require('../src/terrain-mesh.ts');
const { parse_iso_tile_set } = require('../src/isotile.ts');
const { terrain_image, terrain_uv, TerrainCoverage } = require('../src/terrain-art.ts');
const tile = ramp => ({ colors: { low: [80, 90, 60], high: [100, 120, 80] }, indices: new Uint8Array(576).fill(1), extra: null, ramp, tile_type: 0 });
const tiles = { palette: new Uint16Array(256), sets: Array.from({ length: 21 }, (_, i) => [tile(i)]), bridge_set: -1, train_bridge_set: -1 };
const cell = (x, y, height = 0, ramp = 0) => ({ x, y, height, tile: ramp, subtile: 0 });
assert.deepEqual(terrain_project(1, 0, 0), [24, 12]);
assert.deepEqual(terrain_project(0, 1, 0), [-24, 12]);
assert.deepEqual(terrain_project(0, 0, 1), [0, -12]);
assert.equal(terrain_height(1, 0, 0), 0);
assert.equal(terrain_height(1, 1, 0), 1);
assert.equal(terrain_height(5, .25, .25), 0);
assert.equal(terrain_height(5, 1, 1), 1);
assert.equal(terrain_height(13, 1, 1), 2);
for (let ramp = 0; ramp <= 20; ramp++) {
	const mesh = build_terrain_mesh([cell(2, 3, 0, ramp)], tiles);
	const top = mesh.parts[0].vertices;
	assert.equal(top.length / 30, 32);
	for (let i = 0; i < top.length; i += 30) {
		const x = (top[i] + top[i + 10] + top[i + 20]) / 3 - 2;
		const y = (top[i + 1] + top[i + 11] + top[i + 21]) / 3 - 3;
		const z = (top[i + 2] + top[i + 12] + top[i + 22]) / 3;
		assert.ok(Math.abs(z - terrain_height(ramp, x, y)) < 1e-5, `Ramp ${ramp} crosses a crease`);
	}
	for (const part of mesh.parts) for (let i = 0; i < part.vertices.length; i += 10) {
		const v = part.vertices;
		assert.ok(v.slice(i, i + 10).every(Number.isFinite));
		assert.ok(Math.abs(Math.hypot(v[i + 7], v[i + 8], v[i + 9]) - 1) < 1e-5);
	}
}
assert.equal(build_terrain_mesh([cell(0, 0), cell(1, 0)], tiles).parts.filter(p => p.kind === 'closure').length, 0, 'flat neighbors emit no interior walls');
const missing = build_terrain_mesh([{ ...cell(-2, -5), tile: 65535 }], { ...tiles, sets: [] });
assert.equal(missing.triangles, 32, 'missing art retains geometry');
const tall = build_terrain_mesh([cell(0, 0, 8), cell(1, 0)], tiles);
assert.ok(tall.triangles > 64, 'height boundaries produce cliffs');
const extra = { dx: -3, dy: -18, width: 2, height: 2, indices: Uint8Array.of(1, 0, 1, 1), depth: Uint8Array.of(8, 0, 24, 40) };
const relief = build_terrain_mesh([cell(0, 0)], { ...tiles, sets: [[{ ...tile(0), extra }]] });
const points = relief.parts.at(-1).vertices;
let extra_triangles = 0;
for (let i = 0; i < points.length; i += 10) {
	const [x, y] = terrain_project(...points.slice(i, i + 3));
	if (y < -10) {
		assert.ok(x >= -27.0001 && x <= -24.9999 && y >= -18.0001 && y <= -15.9999, 'depth reconstruction preserves screen position');
		extra_triangles++;
	}
}
assert.equal(extra_triangles / 3, 6, 'transparent extra texels are absent');
for (const size of [0, 19, 50, 71]) assert.equal(parse_iso_tile_set(new Uint8Array(size)).length, 0);
const packed = new Uint8Array(20 + 52 + 576 + 576);
const view = new DataView(packed.buffer);
view.setInt32(0, 1, true); view.setInt32(4, 1, true); view.setInt32(16, 20, true);
view.setInt32(20 + 12, 52 + 576, true); view.setUint32(20 + 36, 2, true);
packed[20 + 40] = 3; packed[20 + 42] = 1; packed.fill(7, 20 + 52 + 576);
const decoded = parse_iso_tile_set(packed)[0];
assert.equal(decoded.depth.length, 576); assert.equal(decoded.depth[0], 7); assert.equal(decoded.record_height, 3);
view.setInt32(20 + 12, 0x7fffffff, true);
assert.equal(parse_iso_tile_set(packed)[0].depth, undefined, 'out-of-bounds depth is ignored');
const large = [];
for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) large.push(cell(x, y, 0, (x + y) % 21));
const map = build_terrain_mesh(large, tiles);
assert.equal(new Set(map.parts.map(p => `${p.cell.x},${p.cell.y}`)).size, 6400);
console.log(`Terrain checks passed: 21 ramp shapes, projection, cliff walls, missing art, TMP depth bounds, transparent relief, and ${large.length} cells (${map.triangles} triangles).`);

const ramp_tile = { ...tile(3), extra: {dx:0,dy:-12,width:48,height:12,indices:new Uint8Array(576).fill(2)} };
const image = terrain_image(ramp_tile);
assert.equal(image.top, -12);
assert.equal(image.height, 36);
assert.equal(image.indices[0], 2, 'extra artwork occupies the upper image region');
assert.equal(image.indices[12*48], 0, 'outside-diamond pixels remain transparent');
assert.deepEqual(terrain_uv(ramp_tile,24,-12), [0.5,0]);
const rp = build_terrain_mesh([cell(0,0,0,3)], { ...tiles, sets: [[],[],[],[ramp_tile]] });
const verts = rp.parts.find(p=>p.kind==='ground').vertices;
for(let i=0;i<verts.length;i+=10) {
 const pixel=terrain_project(verts[i],verts[i+1],verts[i+2]);
 assert.ok(Math.abs(verts[i+3]*image.width+image.left-(pixel[0]+24))<1e-5, 'ramp U is projected from geometry');
 assert.ok(Math.abs(verts[i+4]*image.height+image.top-pixel[1])<1e-5, 'ramp V includes elevation and extra image offset');
}
const coverage = new TerrainCoverage(); coverage.add(image,0,0); coverage.merge();
assert.equal(coverage.contains(24.5,-11.5),true);
assert.equal(coverage.contains(0.5,0.5),false);
const painted = terrain_image(tile(0));
const edge_mesh = build_terrain_mesh([cell(0,0)],tiles);
for (const part of edge_mesh.parts) for (let i = 0; i < part.vertices.length; i += 10) {
	assert.ok(Math.abs(part.vertices[i + 2]) < 1e-6, 'flat tile fringe must remain on the ground plane');
	assert.ok(part.vertices[i + 9] > 0.999, 'flat tile fringe must have upward lighting normals');
}
const projected = edge_mesh.parts.flatMap(p=> {
 const triangles=[];
 for(let i=0;i<p.vertices.length;i+=30)triangles.push([0,10,20].map(k=>terrain_project(...p.vertices.slice(i+k,i+k+3))));
 return triangles;
});
const contains = (x,y) => projected.some(([a,b,c])=> {
 const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]); if(Math.abs(d)<1e-7)return false;
 const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d;
 const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d;
 return u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6;
});
for(let y=0;y<painted.height;y++)for(let x=0;x<painted.width;x++)if(painted.indices[y*painted.width+x]) {
 for(const ox of [0.01,0.99])for(const oy of [0.01,0.99])assert.ok(contains(x-24+ox,y+oy), `Painted boundary pixel ${x},${y} must be fully covered`);
}
console.log('Texture regressions passed: slope projection, extra-image offsets, transparent palette index zero, and full painted-pixel coverage.');

const { tile_template, tile_prototype, tile_key, build_tile_map } = require('../src/terrain-tiles.ts');
for(let ramp=0;ramp<=20;ramp++) {
	const vertices=tile_template(tile(ramp)); assert.equal(vertices.length/30,2);
	for(let i=0;i<vertices.length;i+=30) {
		const x=(vertices[i]+vertices[i+10]+vertices[i+20])/3, y=(vertices[i+1]+vertices[i+11]+vertices[i+21])/3;
		const z=(vertices[i+2]+vertices[i+12]+vertices[i+22])/3;
		assert.ok(Math.abs(z-terrain_height(ramp,x,y))<1e-6,`Low-poly ramp ${ramp} crosses its crease`);
	}
}
assert.equal(tile_template({...tile(0),extra}).length/30,2,'Extra-image pixels must never create geometry');
const low=build_tile_map(large,tiles);assert.ok(low.triangles<=large.length*10);
const named={...tiles,names:['CLEAR01.TEM']};
assert.equal(tile_key(named,0,0),'clear01.tem/0');
const prototype=tile_template(tile(0)), overrides=new Map([['clear01.tem/0',{primitives:[{vertices:prototype}]}]]);
const placed=build_tile_map([cell(2,3,7),cell(8,9,2)],named,overrides);
assert.equal(placed.materials.length,1,'Repeated instances share one material');
for(let i=0;i<prototype.length;i+=10)for(const [p,c] of [[placed.parts[0],cell(2,3,7)],[placed.parts[1],cell(8,9,2)]]) {
	assert.equal(p.vertices[i],Math.fround(prototype[i]+c.x));assert.equal(p.vertices[i+1],Math.fround(prototype[i+1]+c.y));assert.equal(p.vertices[i+2],Math.fround(prototype[i+2]+c.height));
}
console.log(`Tile workflow checks passed: 21 low-poly ramps, stable identities, shared materials, placement, ${low.triangles} triangles for ${large.length} cells.`);


assert.deepEqual(decoded.location,{x:0,y:0},'TMP grid location is retained');
const flatGrid=build_tile_map(Array.from({length:100},(_,i)=>cell(i%10,Math.floor(i/10))),tiles);
assert.equal(flatGrid.triangles,200,'Flat grid has exactly two triangles per cell');
assert.equal(flatGrid.parts.filter(p=>p.kind==='closure').length,0,'No hidden interior walls on flat terrain');
for(let ramp=0;ramp<=20;ramp++)for(let i=0,v=tile_template(tile(ramp));i<v.length;i+=10){
 assert.ok(v[i]>=0&&v[i]<=1&&v[i+1]>=0&&v[i+1]<=1,'Ground vertices stay inside the cell');
 assert.ok(v[i+9]>0,'Ground normal points up');
}
for(const axis of [0,1])for(let a=0;a<=20;a++)for(let b=0;b<=20;b++)for(const elevation of [-2,0,2]) {
 const c0=cell(0,0,0,a),c1=cell(axis===0?1:0,axis===1?1:0,elevation,b);
 const pair=build_tile_map([c0,c1],tiles), sides=pair.parts.filter(p=>p.kind==='closure');
 const heights=t=>axis===0?[terrain_height(a,1,t),elevation+terrain_height(b,0,t)]:[terrain_height(a,t,1),elevation+terrain_height(b,t,0)];
 let area=0;
 for(const side of sides)for(let i=0,v=side.vertices;i<v.length;i+=30) {
  const points=[0,10,20].map(k=>[v[i+k],v[i+k+1],v[i+k+2]]);
  for(const [k,p] of points.entries()) {
   assert.equal(p[axis],1,'Cliff faces remain on the shared grid boundary');
   const t=p[1-axis], h=heights(t);
   assert.ok(Math.min(...h)-1e-6<=p[2]&&p[2]<=Math.max(...h)+1e-6,'Wall endpoints join the two ground edges');
   assert.ok(Math.abs(v[i+k*10+9])<1e-6&&Math.abs(v[i+k*10+7+axis])>.999,'Cliff normal is horizontal and aligned to a cell axis');
  }
  const [p,q,r]=points;area+=Math.abs((q[1-axis]-p[1-axis])*(r[2]-p[2])-(r[1-axis]-p[1-axis])*(q[2]-p[2]))/2;
 }
 const h0=heights(0),h1=heights(1),d0=h0[0]-h0[1],d1=h1[0]-h1[1];
 const expected=d0*d1<0?(d0*d0+d1*d1)/(2*Math.abs(d1-d0)):(Math.abs(d0)+Math.abs(d1))/2;
 assert.ok(Math.abs(area-expected)<1e-5,`Cliff must cover each height gap once: axis ${axis}, ramps ${a}/${b}, offset ${elevation}`);
}
const high={...tile(0),location:{x:0,y:0},record_height:4};
const lowTile={...tile(0),location:{x:1,y:0},record_height:0,extra:{dx:0,dy:-48,width:24,height:60,indices:new Uint8Array(1440).fill(2)}};
const stamp={...tiles,sets:[[high,lowTile]],names:['CLIFF01.TEM']};
const proto=tile_prototype(stamp,0,0);
assert.equal(proto.length/30,4,'High cliff prototype includes its two wall triangles');
assert.equal(tile_prototype(stamp,0,1).length/30,2,'Lower neighbor does not duplicate the wall');
const assembled=build_tile_map([cell(0,0,4),{...cell(1,0),subtile:1}],stamp);
const highParts=assembled.parts.filter(p=>p.cell.x===0);
const assembledVertices=highParts.flatMap(p=>Array.from(p.vertices));
for(let i=0;i<proto.length;i++) if(i%10<3||i%10>=7) assert.ok(Math.abs(assembledVertices[i]-(proto[i]+(i%10===2?4:0)))<1e-6,'TMP export and map assembly geometry agree');
const separateFiles={...tiles,sets:[[{...high}],[{...lowTile,location:{x:0,y:0}}]],names:['CLIFFTOP.TEM','CLIFFFACE.TEM']};
const corner=build_tile_map([cell(0,0,4),cell(1,0,0,1)],separateFiles);
const cliffImage=corner.materials[corner.parts.find(p=>p.kind==='closure').material].source;
assert.equal(cliffImage.indices[(42-cliffImage.top)*cliffImage.width+36-cliffImage.left],2,'Cliff face uses extra artwork from a different neighboring TMP file');
console.log('Clean topology checks passed: 2,646 ramp/height boundary pairs, exact shared-edge coverage, cardinal cliff normals, no flat-grid walls, TMP cliff export parity.');

const {pick_terrain_cell}=require('../src/terrain-pick.ts');
const clickCells=[cell(3,4,4),cell(4,4,0)];
const clickMesh=build_tile_map(clickCells,tiles);
const wallPixel=terrain_project(4,4.5,2);
assert.equal(pick_terrain_cell(clickMesh,...wallPixel,()=>true),clickCells[0],'Cliff face selects its higher owner');
assert.equal(pick_terrain_cell(clickMesh,...wallPixel,(x)=>x!==3),null,'Hidden cliff cannot be selected');
assert.equal(pick_terrain_cell(clickMesh,-999,-999,()=>true),null,'Empty screen area selects nothing');
for(let ramp=0;ramp<=20;ramp++) {
 const c=cell(2,3,5,ramp), m=build_tile_map([c],tiles), v=m.parts[0].vertices;
 if([13].includes(ramp))continue;
 // Some triangular corner faces are also edge-on; select a visible face if present.
 for(let i=0;i<v.length;i+=30){
  const a=terrain_project(...v.slice(i,i+3)),b=terrain_project(...v.slice(i+10,i+13)),d=terrain_project(...v.slice(i+20,i+23));
  if(Math.abs((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]))<1e-6)continue;
  assert.equal(pick_terrain_cell(m,(a[0]+b[0]+d[0])/3,(a[1]+b[1]+d[1])/3,()=>true),c,`Pick ramp ${ramp}`);
 }
}
assert.equal(tile_key(named,65535,0),'clear01.tem/0');
assert.equal(tile_key(named,-1,0),'clear01.tem/0');
assert.equal(tile_key(named,0,21),'clear01.tem/0');
console.log('Tile selection checks passed: projected ground and cliff picking, shroud, empty space, and canonical clear-tile identity.');
