/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 * EA's GPLv3 Section 7 additional terms and warranty disclaimers apply; see LICENSE.md.
 ******************************************************************************/

import type { DSurface } from "./surface";

const RAD_45 = (45 * Math.PI) / 180;
const RAD_60 = (60 * Math.PI) / 180;
const HEADER_SIZE = 32;
const LAYER_HEADER_SIZE = 28;
const LAYER_INFO_SIZE = 92;
const PALETTE_BLOCK = 2 + 256 * 3;

type Mat = Float64Array;

export type VoxelDot = {
	x: number;
	y: number;
	z: number;
	color: number;
};

export type VoxelLayer = {
	xs: number;
	ys: number;
	zs: number;
	minx: number;
	miny: number;
	minz: number;
	maxx: number;
	maxy: number;
	maxz: number;
	scale: number;
	normals: boolean;
	voxels: VoxelDot[];
	hva: Mat;
};

export type VoxelModel = {
	layers: VoxelLayer[];
};

function mat_identity(): Mat {
	return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
}

function mat_mul(a: Mat, b: Mat): Mat {
	const out = new Float64Array(12);
	out[0] = a[0]! * b[0]! + a[1]! * b[4]! + a[2]! * b[8]!;
	out[4] = a[4]! * b[0]! + a[5]! * b[4]! + a[6]! * b[8]!;
	out[8] = a[8]! * b[0]! + a[9]! * b[4]! + a[10]! * b[8]!;
	out[1] = a[0]! * b[1]! + a[1]! * b[5]! + a[2]! * b[9]!;
	out[5] = a[4]! * b[1]! + a[5]! * b[5]! + a[6]! * b[9]!;
	out[9] = a[8]! * b[1]! + a[9]! * b[5]! + a[10]! * b[9]!;
	out[2] = a[0]! * b[2]! + a[1]! * b[6]! + a[2]! * b[10]!;
	out[6] = a[4]! * b[2]! + a[5]! * b[6]! + a[6]! * b[10]!;
	out[10] = a[8]! * b[2]! + a[9]! * b[6]! + a[10]! * b[10]!;
	out[3] = a[0]! * b[3]! + a[1]! * b[7]! + a[2]! * b[11]! + a[3]!;
	out[7] = a[4]! * b[3]! + a[5]! * b[7]! + a[6]! * b[11]! + a[7]!;
	out[11] = a[8]! * b[3]! + a[9]! * b[7]! + a[10]! * b[11]! + a[11]!;
	return out;
}

function mat_rotate_x(m: Mat, theta: number): void {
	const s = Math.sin(theta);
	const c = Math.cos(theta);
	for (let row = 0; row < 3; row++) {
		const y = m[row * 4 + 1]!;
		const z = m[row * 4 + 2]!;
		m[row * 4 + 1] = c * y + s * z;
		m[row * 4 + 2] = -s * y + c * z;
	}
}

function mat_rotate_z(m: Mat, theta: number): void {
	const s = Math.sin(theta);
	const c = Math.cos(theta);
	for (let row = 0; row < 3; row++) {
		const x = m[row * 4]!;
		const y = m[row * 4 + 1]!;
		m[row * 4] = c * x + s * y;
		m[row * 4 + 1] = -s * x + c * y;
	}
}

function mat_transform(m: Mat, x: number, y: number, z: number): { x: number; y: number; z: number } {
	return {
		x: m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
		y: m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
		z: m[8]! * x + m[9]! * y + m[10]! * z + m[11]!,
	};
}

function isometric_view(): Mat {
	const m = mat_identity();
	mat_rotate_x(m, -RAD_60);
	mat_rotate_z(m, -RAD_45);
	return m;
}

function facing_matrix(dir256: number): Mat {
	const raw = ((dir256 & 255) << 8) & 0xffff;
	const dir32 = (((((raw >>> 0) >> 10) + 1) >> 1) % 32);
	const m = mat_identity();
	mat_rotate_z(m, (dir32 - 8) * -((Math.PI * 2) / 32));
	return m;
}

function decode_column(
	data: Uint8Array,
	offset: number,
	zs: number,
	x: number,
	y: number,
	normals: boolean,
	minx: number,
	miny: number,
	minz: number,
	dx: number,
	dy: number,
	dz: number,
	out: VoxelDot[],
): void {
	let remaining = zs;
	let ip = offset;
	let k = 0;
	while (remaining > 0 && ip < data.length) {
		const skip = data[ip++]!;
		remaining -= skip;
		k += skip;
		if (remaining <= 0 || ip >= data.length) {
			break;
		}
		let run = data[ip++]!;
		remaining -= run;
		while (run > 0 && ip < data.length) {
			const color = data[ip++]!;
			if (normals && ip < data.length) {
				ip += 1;
			}
			out.push({
				x: minx + (x + 0.5) * dx,
				y: miny + (y + 0.5) * dy,
				z: minz + (k + 0.5) * dz,
				color,
			});
			k += 1;
			run -= 1;
		}
		if (ip < data.length) {
			ip += 1;
		}
	}
}

function read_layer_voxels(
	data: Uint8Array,
	start_table: number,
	span_data: number,
	xs: number,
	ys: number,
	zs: number,
	normals: boolean,
	minx: number,
	miny: number,
	minz: number,
	maxx: number,
	maxy: number,
	maxz: number,
): VoxelDot[] {
	const voxels: VoxelDot[] = [];
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const dx = xs > 0 ? (maxx - minx) / xs : 0;
	const dy = ys > 0 ? (maxy - miny) / ys : 0;
	const dz = zs > 0 ? (maxz - minz) / zs : 0;
	for (let y = 0; y < ys; y++) {
		for (let x = 0; x < xs; x++) {
			const index = (x + y * xs) * 4 + start_table;
			if (index + 4 > data.length) {
				continue;
			}
			const span = view.getInt32(index, true);
			if (span < 0) {
				continue;
			}
			decode_column(data, span_data + span, zs, x, y, normals, minx, miny, minz, dx, dy, dz, voxels);
		}
	}
	return voxels;
}

export function read_vxl(bytes: Uint8Array, hva: Uint8Array | null): VoxelModel | null {
	if (bytes.length < HEADER_SIZE) {
		return null;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const layer_count = view.getInt32(20, true);
	const info_count = view.getInt32(24, true);
	const data_size = view.getInt32(28, true);
	const palette_count = view.getUint32(16, true);
	if (layer_count <= 0 || layer_count > 32 || info_count <= 0 || info_count > 64 || data_size <= 0) {
		return null;
	}
	let offset = HEADER_SIZE + palette_count * PALETTE_BLOCK;
	if (offset + layer_count * LAYER_HEADER_SIZE + data_size + info_count * LAYER_INFO_SIZE > bytes.length) {
		return null;
	}
	const info_index: number[] = [];
	for (let i = 0; i < layer_count; i++) {
		info_index.push(view.getInt32(offset + 16, true));
		offset += LAYER_HEADER_SIZE;
	}
	const body = offset;
	offset += data_size;
	const infos: {
		start: number;
		data: number;
		xs: number;
		ys: number;
		zs: number;
		scale: number;
		normals: boolean;
		minx: number;
		miny: number;
		minz: number;
		maxx: number;
		maxy: number;
		maxz: number;
	}[] = [];
	for (let i = 0; i < info_count; i++) {
		const rec = offset + i * LAYER_INFO_SIZE;
		infos.push({
			start: view.getInt32(rec, true),
			data: view.getInt32(rec + 8, true),
			scale: view.getFloat32(rec + 12, true),
			minx: view.getFloat32(rec + 64, true),
			miny: view.getFloat32(rec + 68, true),
			minz: view.getFloat32(rec + 72, true),
			maxx: view.getFloat32(rec + 76, true),
			maxy: view.getFloat32(rec + 80, true),
			maxz: view.getFloat32(rec + 84, true),
			xs: bytes[rec + 88]!,
			ys: bytes[rec + 89]!,
			zs: bytes[rec + 90]!,
			normals: bytes[rec + 91]! !== 0,
		});
	}
	const hva_mats = read_hva(hva, layer_count);
	const layers: VoxelLayer[] = [];
	for (let layer = 0; layer < layer_count; layer++) {
		const info = infos[info_index[layer] ?? layer];
		if (!info || info.xs <= 0 || info.ys <= 0 || info.zs <= 0) {
			continue;
		}
		const scale = info.scale || 1;
		let hva_mat = hva_mats[layer] ?? mat_identity();
		hva_mat = hva_mat.slice() as Mat;
		hva_mat[3]! *= scale;
		hva_mat[7]! *= scale;
		hva_mat[11]! *= scale;
		layers.push({
			xs: info.xs,
			ys: info.ys,
			zs: info.zs,
			minx: info.minx,
			miny: info.miny,
			minz: info.minz,
			maxx: info.maxx,
			maxy: info.maxy,
			maxz: info.maxz,
			scale,
			normals: info.normals,
			voxels: read_layer_voxels(
				bytes.subarray(body, body + data_size),
				info.start,
				info.data,
				info.xs,
				info.ys,
				info.zs,
				info.normals,
				info.minx,
				info.miny,
				info.minz,
				info.maxx,
				info.maxy,
				info.maxz,
			),
			hva: hva_mat,
		});
	}
	return layers.length > 0 ? { layers } : null;
}

function read_hva(bytes: Uint8Array | null, layer_count: number): Mat[] {
	const mats: Mat[] = [];
	if (!bytes || bytes.length < 24) {
		for (let i = 0; i < layer_count; i++) {
			mats.push(mat_identity());
		}
		return mats;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const frames = view.getInt32(16, true);
	const layers = view.getInt32(20, true);
	const names = 24 + layers * 16;
	if (frames <= 0 || layers <= 0 || names + 12 * 4 * layers > bytes.length) {
		for (let i = 0; i < layer_count; i++) {
			mats.push(mat_identity());
		}
		return mats;
	}
	const count = Math.min(layer_count, layers);
	for (let layer = 0; layer < count; layer++) {
		const rec = names + layer * 48;
		const m = new Float64Array(12);
		for (let i = 0; i < 12; i++) {
			m[i] = view.getFloat32(rec + i * 4, true);
		}
		mats.push(m);
	}
	while (mats.length < layer_count) {
		mats.push(mat_identity());
	}
	return mats;
}

const DARKEN_MASK = 0x7bef;

export function blit_voxel(
	dest: DSurface,
	palette: Uint16Array,
	model: VoxelModel,
	dir256: number,
	cx: number,
	cy: number,
	shadow: boolean,
): void {
	const facing = facing_matrix(dir256);
	const view = isometric_view();
	const view_facing = mat_mul(view, facing);
	const dots: { x: number; y: number; z: number; color: number }[] = [];
	let minx = Infinity;
	let miny = Infinity;
	let maxx = -Infinity;
	let maxy = -Infinity;
	for (const layer of model.layers) {
		const transform = mat_mul(view_facing, layer.hva);
		for (const voxel of layer.voxels) {
			const point = mat_transform(transform, voxel.x, voxel.y, voxel.z);
			point.y = -point.y;
			dots.push({ x: point.x, y: point.y, z: point.z, color: voxel.color });
			if (point.x < minx) {
				minx = point.x;
			}
			if (point.y < miny) {
				miny = point.y;
			}
			if (point.x > maxx) {
				maxx = point.x;
			}
			if (point.y > maxy) {
				maxy = point.y;
			}
		}
	}
	if (dots.length === 0) {
		return;
	}
	const ox = (minx + maxx) * 0.5;
	const oy = (miny + maxy) * 0.5;
	dots.sort((a, b) => a.z - b.z);
	for (const dot of dots) {
		const sx = (cx + (dot.x - ox) + 0.5) | 0;
		const sy = (cy + (dot.y - oy) + (shadow ? 3 : 0) + 0.5) | 0;
		if (sx < 0 || sy < 0 || sx >= dest.width || sy >= dest.height) {
			continue;
		}
		const index = sy * dest.width + sx;
		if (shadow) {
			dest.pixels[index] = (dest.pixels[index]! >> 1) & DARKEN_MASK;
			continue;
		}
		if (dot.color === 0) {
			continue;
		}
		dest.pixels[index] = palette[dot.color]!;
	}
}
