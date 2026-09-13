// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 OpenTS contributors

import type { TheaterTiles } from "./isotile";
import { terrain_image } from "./terrain-art";
import { shade_palette, type CellLight } from "./light";
import { DSurface, unpack_hicolor } from "./surface";
import { TERRAIN_LEVEL, type TerrainCell, type TerrainMesh } from "./terrain-mesh";
import { build_tile_map, type TileAssets } from "./terrain-tiles";

type AtlasSlot = { page: number; x: number; y: number; width: number; height: number };
type Batch = { vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number; page: number; minx: number; miny: number; maxx: number; maxy: number };
const ATLAS_SIZE = 2048;
const SHADOW_SIZE = 2048;
export type TerrainSettings = {
	textures: boolean; lighting: boolean; shadows: boolean; map_tint: boolean;
	wireframe: boolean; normals: boolean; azimuth: number; elevation: number; ambient: number;
};
export function terrain_defaults(): TerrainSettings {
	return { textures: true, lighting: true, shadows: true, map_tint: true,
		wireframe: false, normals: false, azimuth: 235, elevation: 50, ambient: 0.45 };
}
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec2 uv;
layout(location=2) in vec2 cell;
layout(location=3) in vec3 normal;
uniform vec2 origin;
uniform vec2 screen;
uniform vec2 tactical;
uniform mat4 lightmatrix;
out vec2 texcoord;
out vec3 norm;
out vec3 shadowcoord;
out vec3 barycentric;
out vec3 worldposition;
flat out ivec2 cellcoord;
void main() {
 vec2 pixel = vec2(24.0*(position.x-position.y),12.0*(position.x+position.y-position.z))-origin+tactical;
 gl_Position=vec4(pixel.x/screen.x*2.0-1.0,1.0-pixel.y/screen.y*2.0,-(position.x+position.y+position.z/3.0)/4096.0,1.0);
 texcoord=uv; norm=normal; cellcoord=ivec2(cell);
 shadowcoord=(lightmatrix*vec4(position.xy,position.z*${TERRAIN_LEVEL},1.0)).xyz*0.5+0.5;
 barycentric=vec3(gl_VertexID%3==0?1.0:0.0,gl_VertexID%3==1?1.0:0.0,gl_VertexID%3==2?1.0:0.0);
 worldposition=vec3(position.xy,position.z*${TERRAIN_LEVEL});
}`;
const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 texcoord;
in vec3 norm;
in vec3 shadowcoord;
in vec3 barycentric;
in vec3 worldposition;
flat in ivec2 cellcoord;
uniform sampler2D atlas;
uniform sampler2D cellstate;
uniform ivec2 cellorigin;
uniform highp sampler2D shadowmap;
uniform vec3 sundirection;
uniform float ambient;
uniform bool use_textures;
uniform bool use_lighting;
uniform bool use_shadows;
uniform bool use_map_tint;
uniform bool show_wireframe;
uniform bool show_normals;
uniform sampler2D normalmap;
uniform bool use_normalmap;
out vec4 color;
float sunlight() {
 if(!use_shadows || any(lessThan(shadowcoord,vec3(0.0))) || any(greaterThan(shadowcoord,vec3(1.0)))) return 1.0;
 float lit=0.0;
 vec2 step=1.0/vec2(textureSize(shadowmap,0));
 vec3 dx=dFdx(shadowcoord),dy=dFdy(shadowcoord);
 float determinant=dx.x*dy.y-dx.y*dy.x;
 vec2 slope=abs(determinant)>1e-12?vec2(dx.z*dy.y-dy.z*dx.y,dy.z*dx.x-dx.z*dy.x)/determinant:vec2(0.0);
 float bias=0.00005+min(0.005,dot(abs(slope),step)*0.75);
 for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
  vec2 offset=vec2(x,y)*step;
  float depth=texture(shadowmap,shadowcoord.xy+offset).r;
  lit+=shadowcoord.z+dot(slope,offset)-bias<=depth?1.0:0.0;
 }
 return lit/9.0;
}
void main() {
 vec4 state=texelFetch(cellstate,cellcoord-cellorigin,0);
 if(state.a<0.5) discard;
 vec4 texel=texture(atlas,texcoord);
 if(texel.a<0.5) discard;
 vec3 n=normalize(norm);
 if(use_normalmap) {
  vec3 dx=dFdx(worldposition),dy=dFdy(worldposition);
  vec2 tx=dFdx(texcoord),ty=dFdy(texcoord);
  float determinant=tx.x*ty.y-tx.y*ty.x;
  if(abs(determinant)>1e-10) {
   vec3 tangent=normalize((dx*ty.y-dy*tx.y)/determinant);
   tangent=normalize(tangent-n*dot(n,tangent));
   vec3 bitangent=normalize(cross(n,tangent))*sign(dot(cross(n,tangent),(dy*tx.x-dx*ty.x)/determinant));
   n=normalize(mat3(tangent,bitangent,n)*(texture(normalmap,texcoord).rgb*2.0-1.0));
  }
 }
 float incidence=max(0.0,dot(n,sundirection));
 float light=use_lighting?ambient+(1.0-ambient)*incidence*sunlight():1.0;
 vec3 base=use_textures?texel.rgb:vec3(0.68,0.70,0.72);
 vec3 result=show_normals?n*0.5+0.5:base*(use_map_tint?state.rgb:vec3(1.0))*light;
 if(show_wireframe) {
  vec3 edge=smoothstep(vec3(0.0),fwidth(barycentric)*1.2,barycentric);
  result=mix(vec3(0.05,0.8,0.9),result,min(edge.x,min(edge.y,edge.z)));
 }
 color=vec4(result,1.0);
}`;
const SHADOW_VERTEX = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec2 uv;
uniform mat4 lightmatrix;
out vec2 texcoord;
void main(){gl_Position=lightmatrix*vec4(position.xy,position.z*${TERRAIN_LEVEL},1.0);texcoord=uv;}`;
const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
in vec2 texcoord;
uniform sampler2D atlas;
void main(){if(texture(atlas,texcoord).a<0.5)discard;}`;
const QUAD_VERTEX = `#version 300 es
out vec2 uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=vec2(p.x,1.0-p.y);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const COMPOSITE = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D terrain;
uniform sampler2D blackframe;
uniform sampler2D whiteframe;
out vec4 color;
void main(){
 vec3 b=texture(blackframe,uv).rgb;
 vec3 w=texture(whiteframe,uv).rgb;
 vec3 transmission=clamp((w-b)/vec3(248.0/255.0,252.0/255.0,248.0/255.0),0.0,1.0);
 color=vec4(b+texture(terrain,vec2(uv.x,1.0-uv.y)).rgb*transmission,1.0);
}`;

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
	const result = gl.createProgram();
	if (!result) throw new Error("Cannot allocate terrain shader program.");
	for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
		const shader = gl.createShader(type);
		if (!shader) throw new Error("Cannot allocate terrain shader.");
		gl.shaderSource(shader, source); gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); gl.deleteProgram(result);
			throw new Error(`Terrain shader: ${message}`);
		}
		gl.attachShader(result, shader); gl.deleteShader(shader);
	}
	gl.linkProgram(result);
	if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(result); gl.deleteProgram(result);
		throw new Error(`Terrain program: ${message}`);
	}
	return result;
}

function make_atlas(mesh: TerrainMesh, palette: Uint16Array): { pages: HTMLCanvasElement[]; slots: AtlasSlot[]; normals: (HTMLCanvasElement|null)[] } {
	const pages: HTMLCanvasElement[] = [];
	const normals: (HTMLCanvasElement|null)[] = [];
	const slots: AtlasSlot[] = [];
	const shared = new WeakMap<Uint8Array, AtlasSlot>();
	let x = 2, y = 2, row = 0, page_index = 0;
	const new_page = (): void => {
		const canvas = document.createElement("canvas"); canvas.width = canvas.height = ATLAS_SIZE;
		pages.push(canvas); normals.push(null); page_index=pages.length-1; x = y = 2; row = 0;
	};
	new_page();
	for (const material of mesh.materials) {
		if(material.image) {
			slots.push({page:pages.length,x:0,y:0,width:material.image.width,height:material.image.height});
			pages.push(material.image); normals.push(material.normal_image??null); continue;
		}
		const extra = material.extra ? material.tile?.extra : null;
		const source = material.source ?? extra ?? (material.tile ? terrain_image(material.tile) : null);
		const cached = source && shared.get(source.indices);
		if (cached) { slots.push(cached); continue; }
		const width = source?.width ?? 48, height = source?.height ?? 24;
		if (x + width + 2 > ATLAS_SIZE) { x = 2; y += row + 4; row = 0; }
		if (y + height + 2 > ATLAS_SIZE) new_page();
		const ctx = pages[page_index]!.getContext("2d")!;
		const image = ctx.createImageData(width + 4, height + 4);
		for (let py = -2; py < height + 2; py++) for (let px = -2; px < width + 2; px++) {
			const sx = Math.max(0, Math.min(width - 1, px)), sy = Math.max(0, Math.min(height - 1, py));
			const index = source?.indices[sy * width + sx] ?? 0;
			const rgb = material.tile ? unpack_hicolor(palette[index] ?? 0) : [90, 105, 75];
			const dest = ((py + 2) * image.width + px + 2) * 4;
			image.data.set([...rgb, source && index === 0 ? 0 : 255], dest);
		}
		ctx.putImageData(image, x - 2, y - 2);
		const slot = { page: page_index, x, y, width, height };
		slots.push(slot); if (source) shared.set(source.indices,slot);
		x += width + 4; row = Math.max(row, height);
	}
	return { pages, slots, normals };
}

export class TerrainRenderer {
	readonly canvas = document.createElement("canvas");
	readonly mesh: TerrainMesh;
	readonly pages: HTMLCanvasElement[];
	readonly slots: AtlasSlot[];
	private readonly gl: WebGL2RenderingContext;
	private readonly terrain_program: WebGLProgram;
	private readonly composite_program: WebGLProgram;
	private readonly shadow_program: WebGLProgram;
	private readonly shadow_target: WebGLFramebuffer;
	private readonly shadow_texture: WebGLTexture;
	private readonly bounds_min = [Infinity, Infinity, Infinity];
	private readonly bounds_max = [-Infinity, -Infinity, -Infinity];
	private lightmatrix = new Float32Array(16);
	private sundirection = [0, 0, 1];
	private shadow_key = "";
	private readonly batches: Batch[] = [];
	private readonly textures: WebGLTexture[] = [];
	private readonly atlas_textures: WebGLTexture[] = [];
	private readonly normal_textures: (WebGLTexture|null)[] = [];
	private readonly flat_normal: WebGLTexture;
	private readonly state_texture: WebGLTexture;
	private readonly black_texture: WebGLTexture;
	private readonly white_texture: WebGLTexture;
	private readonly target_texture: WebGLTexture;
	private readonly target: WebGLFramebuffer;
	private readonly depth: WebGLRenderbuffer;
	private readonly state: Uint8Array;
	private readonly minx: number;
	private readonly miny: number;
	private readonly state_width: number;
	private readonly state_height: number;
	private readonly pixels = new Uint8Array(640 * 400 * 4);
	private lost = false;
	private readonly on_lost = (event: Event): void => { event.preventDefault(); this.lost = true; };

	constructor(private readonly cells: TerrainCell[], tiles: TheaterTiles, lights: Map<string, CellLight>, palette = tiles.palette,
		readonly settings = terrain_defaults(), assets:TileAssets = new Map()) {
		const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true });
		if (!gl) throw new Error("WebGL2 is unavailable; legacy graphics remain active.");
		this.gl = gl;
		try {
		if (!cells.length) throw new Error("Cannot build an empty terrain map.");
		this.canvas.addEventListener("webglcontextlost", this.on_lost);
		this.terrain_program = program(gl, VERTEX, FRAGMENT);
		this.composite_program = program(gl, QUAD_VERTEX, COMPOSITE);
		this.shadow_program = program(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);
		this.mesh = build_tile_map(cells, tiles, assets);
		const atlas = make_atlas(this.mesh, palette);
		this.pages = atlas.pages; this.slots = atlas.slots;
		this.flat_normal=this.texture(); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,128,255,255]));
		for(const image of atlas.normals) {
			if(!image){this.normal_textures.push(null);continue;}
			this.normal_textures.push(this.texture());gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
		}
		this.minx = cells.reduce((v, c) => Math.min(v, c.x), Infinity);
		this.miny = cells.reduce((v, c) => Math.min(v, c.y), Infinity);
		this.state_width = cells.reduce((v, c) => Math.max(v, c.x), -Infinity) - this.minx + 1;
		this.state_height = cells.reduce((v, c) => Math.max(v, c.y), -Infinity) - this.miny + 1;
		if (Math.max(this.state_width, this.state_height, ATLAS_SIZE) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error("Terrain exceeds the GPU texture limits.");
		this.state = new Uint8Array(this.state_width * this.state_height * 4);
		for (const c of cells) {
			const light = lights.get(`${c.x},${c.y}`);
			const white = new Uint16Array(256).fill(0xffff);
			const rgb = unpack_hicolor(light ? shade_palette(white, light.tile, light.red, light.green, light.blue)[1]! : 0xffff);
			this.state.set([Math.round(rgb[0] * 255 / 248), Math.round(rgb[1] * 255 / 252), Math.round(rgb[2] * 255 / 248), 255], this.state_index(c));
		}
		this.state_texture = this.texture();
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.state_width, this.state_height, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.state);
		this.black_texture = this.texture(); this.white_texture = this.texture();
		for (const texture of [this.black_texture, this.white_texture]) {
			gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 640, 400, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		}
		for (const page of this.pages) {
			if(Math.max(page.width,page.height)>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error("Replacement texture exceeds GPU limits");
			this.atlas_textures.push(this.texture());
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, page);
		}
		this.target_texture = this.texture();
		this.target = gl.createFramebuffer()!; this.depth = gl.createRenderbuffer()!;
		this.shadow_texture = this.texture();
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
		this.shadow_target = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow_target);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadow_texture, 0);
		gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Cannot allocate terrain shadows.");
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		const grouped = new Map<string, { arrays: Float32Array[]; page: number }>();
		for (const part of this.mesh.parts) {
			const slot = this.slots[part.material]!;
			const key = `${Math.floor(part.cell.x / 16)},${Math.floor(part.cell.y / 16)},${slot.page}`;
			let group = grouped.get(key);
			if (!group) { group = { arrays: [], page: slot.page }; grouped.set(key, group); }
			const data = part.vertices.slice();
			for (let i = 0; i < data.length; i += 10) {
				data[i + 3] = (slot.x + data[i + 3]! * slot.width) / this.pages[slot.page]!.width;
				data[i + 4] = (slot.y + data[i + 4]! * slot.height) / this.pages[slot.page]!.height;
			}
			group.arrays.push(data);
		}
		for (const group of grouped.values()) {
			const data = new Float32Array(group.arrays.reduce((n, a) => n + a.length, 0));
			let offset = 0;
			for (const array of group.arrays) { data.set(array, offset); offset += array.length; }
			const vao = gl.createVertexArray()!, buffer = gl.createBuffer()!;
			gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
			for (const [location, size, start] of [[0, 3, 0], [1, 2, 3], [2, 2, 5], [3, 3, 7]]) {
				gl.enableVertexAttribArray(location!); gl.vertexAttribPointer(location!, size!, gl.FLOAT, false, 40, start! * 4);
			}
			let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
			for (let i = 0; i < data.length; i += 10) {
				for (let axis = 0; axis < 3; axis++) {
					const value = data[i + axis]! * (axis === 2 ? TERRAIN_LEVEL : 1);
					this.bounds_min[axis] = Math.min(this.bounds_min[axis]!, value);
					this.bounds_max[axis] = Math.max(this.bounds_max[axis]!, value);
				}
				const x = 24 * (data[i]! - data[i + 1]!), y = 12 * (data[i]! + data[i + 1]! - data[i + 2]!);
				minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
			}
			this.batches.push({ vao, buffer, count: data.length / 10, page: group.page, minx, miny, maxx, maxy });
		}
		gl.bindVertexArray(null);
		} catch (error) {
			this.canvas.removeEventListener("webglcontextlost", this.on_lost);
			gl.getExtension("WEBGL_lose_context")?.loseContext();
			throw error;
		}
	}

	private state_index(c: TerrainCell): number { return ((c.y - this.miny) * this.state_width + c.x - this.minx) * 4; }
	private texture(): WebGLTexture {
		const gl = this.gl, texture = gl.createTexture();
		if (!texture) throw new Error("Cannot allocate terrain texture.");
		this.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return texture;
	}
	private bind(texture: WebGLTexture, unit: number, prog: WebGLProgram, name: string): void {
		const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(gl.getUniformLocation(prog, name), unit);
	}
	private update_shadows(): void {
		const settings = this.settings;
		const key = `${settings.azimuth}/${settings.elevation}/${settings.shadows && settings.lighting}`;
		if (this.shadow_key === key) return;
		const azimuth = settings.azimuth * Math.PI / 180, elevation = settings.elevation * Math.PI / 180;
		const sun = [Math.cos(azimuth) * Math.cos(elevation), Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation)];
		this.sundirection = sun;
		const right = [-Math.sin(azimuth), Math.cos(azimuth), 0];
		const up = [-Math.cos(azimuth) * Math.sin(elevation), -Math.sin(azimuth) * Math.sin(elevation), Math.cos(elevation)];
		const axes = [right, up, sun.map(v => -v)];
		const matrix = new Float32Array(16); matrix[15] = 1;
		for (let row = 0; row < 3; row++) {
			const axis = axes[row]!;
			let min = 0, max = 0;
			for (let i = 0; i < 3; i++) {
				const a = axis[i]! * this.bounds_min[i]!, b = axis[i]! * this.bounds_max[i]!;
				min += Math.min(a, b); max += Math.max(a, b);
			}
			min -= 2; max += 2;
			for (let col = 0; col < 3; col++) matrix[col * 4 + row] = 2 * axis[col]! / (max - min);
			matrix[12 + row] = -(max + min) / (max - min);
		}
		this.lightmatrix = matrix;
		if (settings.shadows && settings.lighting) {
			const gl = this.gl, prog = this.shadow_program;
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow_target); gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
			gl.disable(gl.SCISSOR_TEST); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
			gl.clear(gl.DEPTH_BUFFER_BIT); gl.useProgram(prog);
			gl.uniformMatrix4fv(gl.getUniformLocation(prog, "lightmatrix"), false, matrix);
			for (const batch of this.batches) {
				this.bind(this.atlas_textures[batch.page]!, 0, prog, "atlas");
				gl.bindVertexArray(batch.vao); gl.drawArrays(gl.TRIANGLES, 0, batch.count);
			}
			gl.bindVertexArray(null);
		}
		this.shadow_key = key;
	}

	render(origin: { x: number; y: number }, width: number, height: number, black: DSurface, white: DSurface,
		mapped: (x: number, y: number) => boolean): HTMLCanvasElement {
		if (this.lost || this.gl.isContextLost()) throw new Error("The GPU context was lost; switched to legacy graphics.");
		const gl = this.gl;
		width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width; this.canvas.height = height;
			gl.bindTexture(gl.TEXTURE_2D, this.target_texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
			gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.target);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target_texture, 0);
			gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
			if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Cannot allocate the terrain framebuffer.");
		}
		let changed = false;
		for (const cell of this.cells) {
			const i = this.state_index(cell) + 3, value = mapped(cell.x, cell.y) ? 255 : 0;
			if (this.state[i] !== value) { this.state[i] = value; changed = true; }
		}
		if (changed) {
			gl.bindTexture(gl.TEXTURE_2D, this.state_texture);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.state_width, this.state_height, gl.RGBA, gl.UNSIGNED_BYTE, this.state);
		}
		this.update_shadows();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.target); gl.viewport(0, 0, width, height);
		gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
		gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, Math.ceil(width * 472 / 640), Math.ceil(height * 384 / 400));
		const prog = this.terrain_program; gl.useProgram(prog);
		gl.uniform2f(gl.getUniformLocation(prog, "origin"), origin.x, origin.y);
		gl.uniform2f(gl.getUniformLocation(prog, "screen"), 640, 400);
		gl.uniform2f(gl.getUniformLocation(prog, "tactical"), 0, 16);
		gl.uniform2i(gl.getUniformLocation(prog, "cellorigin"), this.minx, this.miny);
		gl.uniformMatrix4fv(gl.getUniformLocation(prog, "lightmatrix"), false, this.lightmatrix);
		gl.uniform3f(gl.getUniformLocation(prog, "sundirection"), this.sundirection[0]!, this.sundirection[1]!, this.sundirection[2]!);
		gl.uniform1f(gl.getUniformLocation(prog, "ambient"), this.settings.ambient);
		for (const [name, value] of Object.entries({ use_textures: this.settings.textures, use_lighting: this.settings.lighting,
			use_shadows: this.settings.shadows, use_map_tint: this.settings.map_tint, show_wireframe: this.settings.wireframe, show_normals: this.settings.normals })) {
			gl.uniform1i(gl.getUniformLocation(prog, name), value ? 1 : 0);
		}
		this.bind(this.shadow_texture, 3, prog, "shadowmap");
		this.bind(this.state_texture, 1, prog, "cellstate");
		for (const batch of this.batches) {
			if (batch.maxx < origin.x || batch.minx > origin.x + 472 || batch.maxy < origin.y || batch.miny > origin.y + 384) continue;
			this.bind(this.normal_textures[batch.page]??this.flat_normal,4,prog,"normalmap");
			gl.uniform1i(gl.getUniformLocation(prog,"use_normalmap"),this.normal_textures[batch.page]?1:0);
			this.bind(this.atlas_textures[batch.page]!, 0, prog, "atlas"); gl.bindVertexArray(batch.vao); gl.drawArrays(gl.TRIANGLES, 0, batch.count);
		}
		gl.bindVertexArray(null); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(this.composite_program);
		for (const [surface, texture] of [[black, this.black_texture], [white, this.white_texture]] as const) {
			for (let i = 0; i < surface.pixels.length; i++) {
				const pixel = surface.pixels[i]!, j = i * 4;
				this.pixels[j] = ((pixel >> 11) & 31) << 3;
				this.pixels[j + 1] = ((pixel >> 5) & 63) << 2;
				this.pixels[j + 2] = (pixel & 31) << 3; this.pixels[j + 3] = 255;
			}
			gl.bindTexture(gl.TEXTURE_2D, texture); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 640, 400, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
		}
		this.bind(this.target_texture, 0, this.composite_program, "terrain");
		this.bind(this.black_texture, 1, this.composite_program, "blackframe");
		this.bind(this.white_texture, 2, this.composite_program, "whiteframe");
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		return this.canvas;
	}

	private *gltf_steps(theater: string) {
		const buffers: { byteLength: number; uri: string }[] = [];
		const views: { buffer: number; byteLength: number }[] = [];
		const accessors: object[] = [];
		const meshes: object[] = [];
		const nodes: object[] = [];
		const base64 = (bytes: Uint8Array): string => {
			let value = ""; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
			return btoa(value);
		};
		const attribute = (values: Float32Array, components: number): number => {
			const min = Array(components).fill(Infinity), max = Array(components).fill(-Infinity);
			values.forEach((v, i) => { min[i % components] = Math.min(min[i % components], v); max[i % components] = Math.max(max[i % components], v); });
			const buffer = buffers.length; buffers.push({ byteLength: values.byteLength, uri: `data:application/octet-stream;base64,${base64(new Uint8Array(values.buffer))}` });
			views.push({ buffer, byteLength: values.byteLength });
			accessors.push({ bufferView: buffer, componentType: 5126, count: values.length / components, type: `VEC${components}`, min, max });
			return accessors.length - 1;
		};
		for (const part of this.mesh.parts) {
			const count = part.vertices.length / 10, position = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2);
			const slot = this.slots[part.material]!;
			for (let i = 0; i < count; i++) {
				const v = part.vertices, j = i * 10;
				position.set([v[j]! - part.cell.x, (v[j + 2]! - part.cell.height) * TERRAIN_LEVEL, -(v[j + 1]! - part.cell.y)], i * 3);
				normal.set([v[j + 7]!, v[j + 9]!, -v[j + 8]!], i * 3);
				uv.set([(slot.x + v[j + 3]! * slot.width) / this.pages[slot.page]!.width, (slot.y + v[j + 4]! * slot.height) / this.pages[slot.page]!.height], i * 2);
			}
			const name = `${this.mesh.materials[part.material]!.key}/${part.kind}@${part.cell.x},${part.cell.y}`;
			meshes.push({ name, primitives: [{ attributes: { POSITION: attribute(position, 3), NORMAL: attribute(normal, 3), TEXCOORD_0: attribute(uv, 2) }, material: slot.page }] });
			nodes.push({ name, mesh: meshes.length - 1, translation: [part.cell.x, part.cell.height * TERRAIN_LEVEL, -part.cell.y], extras: { theater, tile: part.cell.tile, subtile: part.cell.subtile, material: this.mesh.materials[part.material]!.key } });
			if (nodes.length % 64 === 0) yield nodes.length / this.mesh.parts.length;
		}
		const gltf = { asset: { version: "2.0", generator: "OpenTS browser terrain" }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes,
			buffers, bufferViews: views, accessors, images: this.pages.map(p => ({ uri: p.toDataURL("image/png") })),
			textures: this.pages.map((_, source) => ({ source, sampler: 0 })), samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
			materials: this.pages.map((_, index) => ({ name: `${theater}-atlas-${index}`, doubleSided: true, alphaMode: "MASK", pbrMetallicRoughness: { baseColorTexture: { index }, metallicFactor: 0, roughnessFactor: 1 } })) };
		return gltf;
	}

	build_gltf(theater: string) {
		const steps = this.gltf_steps(theater);
		let step = steps.next();
		while (!step.done) step = steps.next();
		return step.value;
	}

	async export_blob(theater: string, progress: (fraction: number) => void, cancelled: () => boolean): Promise<Blob> {
		const steps = this.gltf_steps(theater);
		let step = steps.next();
		while (!step.done) {
			if (cancelled()) throw new Error("Terrain export cancelled.");
			progress(step.value);
			await new Promise<void>(resolve => setTimeout(resolve, 0));
			step = steps.next();
		}
		if (cancelled()) throw new Error("Terrain export cancelled.");
		progress(1);
		return new Blob([JSON.stringify(step.value)], { type: "model/gltf+json" });
	}

	export_gltf(theater: string): void {
		const url = URL.createObjectURL(new Blob([JSON.stringify(this.build_gltf(theater))], { type: "model/gltf+json" }));
		const link = document.createElement("a"); link.href = url; link.download = `${theater.toLowerCase()}-terrain.gltf`;
		document.body.append(link); link.click(); link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 30000);
	}

	dispose(): void {
		const gl = this.gl;
		this.canvas.removeEventListener("webglcontextlost", this.on_lost);
		for (const batch of this.batches) { gl.deleteBuffer(batch.buffer); gl.deleteVertexArray(batch.vao); }
		for (const texture of this.textures) gl.deleteTexture(texture);
		gl.deleteFramebuffer(this.target); gl.deleteRenderbuffer(this.depth);
		gl.deleteFramebuffer(this.shadow_target); gl.deleteProgram(this.shadow_program);
		gl.deleteProgram(this.terrain_program); gl.deleteProgram(this.composite_program);
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	}
}
