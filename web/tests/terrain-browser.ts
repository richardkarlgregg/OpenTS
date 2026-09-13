import { GameDirectory } from "../src/files";
import { Show_Tactical } from "../src/tactical";
import { TerrainRenderer } from "../src/terrain-renderer";
import { DSurface, build_hicolor_pixel } from "../src/surface";
import { parse_iso_tile_set } from "../src/isotile";
import "../src/style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#frame")!;
const output = document.querySelector("#log")!;
const log = (line: string) => { output.textContent += `${line}\n`; };
window.addEventListener("error", event => log(`ERROR: ${event.message}`));
window.addEventListener("unhandledrejection", event => log(`ERROR: ${event.reason}`));
const directory = new GameDirectory("synthetic-terrain");
const add = (name: string, data: BlobPart) => directory.add(name, new File([data], name));
const palette = new Uint8Array(768);
for (let i = 0; i < 256; i++) { palette[i * 3] = 16 + i % 32; palette[i * 3 + 1] = 20 + i % 38; palette[i * 3 + 2] = 10 + i % 22; }
add("ISOTEM.PAL", palette);
add("TEMPERAT.INI", "[TileSet0000]\nFileName=GROUND\nTilesInSet=21\n");
const art = [];
for (let ramp = 0; ramp <= 20; ramp++) {
	const bytes = new Uint8Array(648), view = new DataView(bytes.buffer);
	view.setInt32(0, 1, true); view.setInt32(4, 1, true); view.setInt32(8, 48, true); view.setInt32(12, 24, true); view.setInt32(16, 20, true);
	bytes[62] = ramp;
	for (let i = 72; i < bytes.length; i++) bytes[i] = 20 + (i % 4) * 4 + ramp;
	add(`GROUND${String(ramp + 1).padStart(2, "0")}.TEM`, bytes);
	art.push(parse_iso_tile_set(bytes));
}
const cells = [];
for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) {
	const raised = x > 18 && x < 28 && y > 15 && y < 29;
	cells.push({ x, y, height: raised ? 3 : 0, tile: raised && x === 19 ? 1 : (x === 16 ? y % 21 : 0), subtile: 0 });
}
// Exercise the actual GPU, alpha compositor, visibility updates, resize and resource lifetime.
const test_palette = new Uint16Array(256).fill(build_hicolor_pixel(120, 180, 60));
const renderer = new TerrainRenderer([{ x: 1, y: 1, height: 0, tile: 0, subtile: 0 }], { palette: test_palette, sets: art, bridge_set: -1, train_bridge_set: -1 }, new Map([["1,1", {brightness:1000,tile:1000,red:1000,green:1000,blue:1000}]]));
const black = new DSurface(640, 400), white = new DSurface(640, 400); white.fill(0xffff);
const check = document.createElement("canvas"); check.width = 640; check.height = 400;
const ctx = check.getContext("2d")!;
const pixel = () => Array.from(ctx.getImageData(100, 128, 1, 1).data);
const sample = (mapped: boolean, w = 640, h = 400) => { ctx.drawImage(renderer.render({ x: -100, y: -76 }, w, h, black, white, () => mapped), 0, 0, 640, 400); return pixel(); };
const shown = sample(true), hidden = sample(false);
if (shown[1]! < 80 || hidden[1] !== 0) throw new Error(`GPU visibility: ${shown} / ${hidden}`);
for (const [w, h] of [[960, 600], [3456, 2160], [640, 400]]) {
	const p = sample(true, w, h); if (p[1]! < 80) throw new Error(`GPU resize ${w}x${h}: ${p}`);
}
black.fill_rect(98, 126, 5, 5, build_hicolor_pixel(240, 20, 30)); white.fill_rect(98, 126, 5, 5, build_hicolor_pixel(240, 20, 30));
if (sample(true)[0]! < 220) throw new Error("GPU foreground compositing");
const exported = renderer.build_gltf("SYNTHETIC");
if (!exported.meshes.length || exported.nodes.length !== renderer.mesh.parts.length || !exported.images[0]!.uri.startsWith("data:image/png")) throw new Error("Terrain glTF scene or embedded texture missing");
for (const buffer of exported.buffers) if (atob(buffer.uri.split(",")[1]!).length !== buffer.byteLength) throw new Error("Terrain glTF buffer length");
renderer.dispose();
// Palette zero is a transparency marker even when the theater paints it blue.
test_palette[0] = build_hicolor_pixel(0, 0, 255);
const transparent_tile = { ...art[3]![0]!, indices: new Uint8Array(576) };
const transparent = new TerrainRenderer([{ x: 1, y: 1, height: 0, tile: 0, subtile: 0 }],
	{ palette: test_palette, sets: [[transparent_tile]], bridge_set: -1, train_bridge_set: -1 }, new Map());
black.fill(0); white.fill(0xffff);
ctx.drawImage(transparent.render({ x: -100, y: -76 }, 1280, 800, black, white, () => true), 0, 0, 640, 400);
const pixels = ctx.getImageData(0, 0, 640, 400).data;
for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) throw new Error("Palette-zero slope texels must remain transparent");
transparent.dispose();
log("PASS: blue palette-zero markers are transparent on slopes.");
log("PASS: WebGL2 terrain, hidden cells, foreground compositing, and 640/960/3456×2160 resizing.");
const shadow_cells = [];
for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) shadow_cells.push({ x, y, height: x === 4 && y === 4 ? 6 : 0, tile: 0, subtile: 0 });
const shadow_test = new TerrainRenderer(shadow_cells, { palette: test_palette, sets: [], bridge_set: -1, train_bridge_set: -1 }, new Map());
shadow_test.settings.textures = false; shadow_test.settings.map_tint = false;
const snapshot = () => {
	ctx.drawImage(shadow_test.render({ x: -220, y: -70 }, 640, 400, black, white, () => true), 0, 0);
	return ctx.getImageData(0, 0, 640, 400).data;
};
shadow_test.settings.shadows = false; const no_shadow = snapshot();
shadow_test.settings.shadows = true; const with_shadow = snapshot();
const comparison = document.createElement("details");
comparison.innerHTML = "<summary>Shadow comparison: off / on</summary>";
for (const pixels of [no_shadow, with_shadow]) {
	const preview = document.createElement("canvas"); preview.width = 640; preview.height = 400;
	preview.style.cssText = "width:480px;height:300px;display:inline-block";
	const pc = preview.getContext("2d")!, data = pc.createImageData(640,400); data.data.set(pixels); pc.putImageData(data,0,0);
	comparison.append(preview);
}
output.after(comparison);
let shadow_pixels = 0;
for (let i = 0; i < no_shadow.length; i += 4) if (no_shadow[i]! - with_shadow[i]! > 15) shadow_pixels++;
if (shadow_pixels < 50) throw new Error(`Raised terrain failed to cast a shadow: ${shadow_pixels}`);
if (shadow_pixels > 5000) throw new Error(`Flat ground is shadowing itself: ${shadow_pixels}`);
shadow_test.settings.azimuth = 55; const moved_sun = snapshot();
let moved_pixels = 0;
for (let i = 0; i < no_shadow.length; i += 4) if (Math.abs(moved_sun[i]! - with_shadow[i]!) > 15) moved_pixels++;
if (moved_pixels < 50) throw new Error("Sun direction did not change terrain illumination");
shadow_test.settings.lighting = false; const unlit = snapshot();
shadow_test.settings.shadows = false; const unlit_without_shadow = snapshot();
if (unlit.some((value, i) => value !== unlit_without_shadow[i])) throw new Error("Lighting disabled still applies shadows");
shadow_test.settings.normals = true; const normals = snapshot();
if (!normals.some((value, i) => value !== unlit[i])) throw new Error("Normal debug view did not change the image");
shadow_test.settings.wireframe = true; const wireframe = snapshot();
if (!wireframe.some((value, i) => value !== normals[i])) throw new Error("Wireframe debug view did not change the image");
let progress = 0;
const blob = await shadow_test.export_blob("TEST", value => { progress = value; }, () => false);
const scene = JSON.parse(await blob.text());
if (progress !== 1 || scene.nodes.length !== shadow_test.mesh.parts.length) throw new Error("Asynchronous export lost map geometry");
shadow_test.dispose();
log(`PASS: terrain casts shadows (${shadow_pixels} pixels), sun controls, unlit/normals/wireframe views, and asynchronous glTF export.`);
await Show_Tactical(canvas, directory, "TEMPERATE", cells, { x: 0, y: 0, width: 25, height: 25 },
	{ x: 2, y: 2, width: 21, height: 21 }, 0, { x: 21, y: 21 }, "Synthetic terrain", log, () => false);
log("PASS: tactical view exited and resources disposed.");
