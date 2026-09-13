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

const { tile_template, tile_key, build_tile_map } = require('../src/terrain-tiles.ts');
for(let ramp=0;ramp<=20;ramp++) {
	const vertices=tile_template(tile(ramp)); assert.ok(vertices.length/30<=10 && vertices.length>0);
	for(let i=0;i<vertices.length;i+=30) {
		const x=(vertices[i]+vertices[i+10]+vertices[i+20])/3, y=(vertices[i+1]+vertices[i+11]+vertices[i+21])/3;
		const z=(vertices[i+2]+vertices[i+12]+vertices[i+22])/3;
		if(ramp!==13 && x>=0&&x<=1&&y>=0&&y<=1)assert.ok(Math.abs(z-terrain_height(ramp,x,y))<1e-6,`Low-poly ramp ${ramp} crosses its crease`);
	}
}
assert.ok(tile_template({...tile(0),extra}).length/30<=18,'Extra artwork has a bounded low-poly mesh');
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
