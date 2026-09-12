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

import { AUDIO_GROUP_MOVIE, Audio_Context, Ensure_Audio, Play_Pcm, Stop_Group, Stop_Handle, type AudioPlayHandle } from "./audio";
import { LCW_Uncomp } from "./lcw";
import { present } from "./present";
import { build_hicolor_pixel, DSurface } from "./surface";
import { Select_UnVQ } from "./vqa-unvq";

const VQAHD_SIZE = 42;
const VQAHD_VER3 = 3;
const VQAHDF_AUDIO = 1;

const SOS_STEP = [
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
	118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
	1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
	6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
	32767,
];
const SOS_INDEX_ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

export type VQAHeader = {
	version: number;
	flags: number;
	frames: number;
	width: number;
	height: number;
	block_w: number;
	block_h: number;
	fps: number;
	groupsize: number;
	cb_entries: number;
	max_frame: number;
	sample_rate: number;
	channels: number;
	bits: number;
	color_mode: number;
	max_cb: number;
};

export type VQAMovie = {
	header: VQAHeader;
	bytes: Uint8Array;
	frame_start: number;
	cb_table: { frame: number; packed: number }[];
};

type Chunk = { id: string; size: number; start: number; next: number };

function pad_size(size: number): number {
	return (size + 1) & ~1;
}

function id_at(bytes: Uint8Array, at: number): string {
	return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

function be32(bytes: Uint8Array, at: number): number {
	return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

function le16(bytes: Uint8Array, at: number): number {
	return bytes[at]! | (bytes[at + 1]! << 8);
}

function le32(bytes: Uint8Array, at: number): number {
	return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

function read_chunk(bytes: Uint8Array, at: number): Chunk | null {
	if (at + 8 > bytes.length) {
		return null;
	}
	const size = be32(bytes, at + 4);
	const start = at + 8;
	if (start > bytes.length) {
		return null;
	}
	return { id: id_at(bytes, at), size, start, next: start + pad_size(size) };
}

function lcw_unpack(source: Uint8Array, dest_size: number, version: number): Uint8Array {
	const dest = new Uint8Array(Math.max(1, dest_size));
	let packed = source;
	if (version < VQAHD_VER3) {
		packed = new Uint8Array(source.length + 2);
		packed.set(source);
		packed[source.length + 1] = 0x80;
	}
	LCW_Uncomp(packed, dest);
	return dest;
}

function parse_cinf(bytes: Uint8Array, start: number, size: number): { frame: number; packed: number }[] {
	const end = start + size;
	let at = start;
	const rows: { frame: number; packed: number }[] = [];
	while (at + 8 <= end) {
		const chunk = read_chunk(bytes, at);
		if (!chunk || chunk.start > end) {
			break;
		}
		if (chunk.id === "CIND") {
			const stop = Math.min(chunk.start + chunk.size, end);
			for (let i = chunk.start; i + 6 <= stop; i += 6) {
				rows.push({ frame: le16(bytes, i), packed: le32(bytes, i + 2) });
			}
		}
		at = chunk.next;
	}
	return rows;
}

function next_cb_packed(table: { frame: number; packed: number }[], framenum: number): number {
	for (const row of table) {
		if (row.frame > framenum) {
			return row.packed;
		}
	}
	return 0;
}

function join_partials(parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const part of parts) {
		total += part.length;
	}
	const packed = new Uint8Array(total);
	let o = 0;
	for (const part of parts) {
		packed.set(part, o);
		o += part.length;
	}
	return packed;
}

function read_header(bytes: Uint8Array, at: number): VQAHeader | null {
	if (at + VQAHD_SIZE > bytes.length) {
		return null;
	}
	return {
		version: le16(bytes, at),
		flags: le16(bytes, at + 2),
		frames: le16(bytes, at + 4),
		width: le16(bytes, at + 6),
		height: le16(bytes, at + 8),
		block_w: bytes[at + 10]!,
		block_h: bytes[at + 11]!,
		fps: bytes[at + 12]!,
		groupsize: bytes[at + 13]!,
		cb_entries: le16(bytes, at + 16),
		max_frame: le16(bytes, at + 22),
		sample_rate: le16(bytes, at + 24),
		channels: bytes[at + 26]!,
		bits: bytes[at + 27]!,
		color_mode: bytes[at + 32]!,
		max_cb: le32(bytes, at + 34),
	};
}

export function VQA_Open(bytes: Uint8Array): VQAMovie | null {
	const form = read_chunk(bytes, 0);
	if (!form || form.id !== "FORM" || form.size === 0) {
		return null;
	}
	if (id_at(bytes, 8) !== "WVQA") {
		return null;
	}
	let at = 12;
	let header: VQAHeader | null = null;
	let cb_table: { frame: number; packed: number }[] = [];
	while (at + 8 <= bytes.length) {
		const chunk = read_chunk(bytes, at);
		if (!chunk) {
			return null;
		}
		if (chunk.id === "VQHD") {
			if (chunk.size !== VQAHD_SIZE) {
				return null;
			}
			header = read_header(bytes, chunk.start);
			if (!header) {
				return null;
			}
		} else if (chunk.id === "CINF") {
			cb_table = parse_cinf(bytes, chunk.start, chunk.size);
		} else if (chunk.id === "FINF") {
			if (!header) {
				return null;
			}
			return { header, bytes, frame_start: chunk.next, cb_table };
		}
		at = chunk.next;
	}
	return null;
}

function cb_buffer_size(header: VQAHeader): number {
	let size = header.cb_entries * header.block_w * header.block_h + 1;
	size = (size + 3) & ~3;
	if (header.color_mode === 1 || header.color_mode === 4) {
		size *= 2;
	}
	if (header.max_cb > 0) {
		return Math.max(size, header.max_cb);
	}
	return Math.max(size, 0x10000);
}

function ptr_buffer_size(header: VQAHeader): number {
	const blocks = Math.max(1, Math.floor(header.width / Math.max(1, header.block_w)) * Math.floor(header.height / Math.max(1, header.block_h)));
	const max_frame = header.version >= VQAHD_VER3 ? header.max_frame * 256 : header.max_frame;
	return Math.max(blocks * 4 + 16, max_frame + 16, 0x8000);
}

function hicolor_translate(codebook: Uint8Array): void {
	const pixels = new Uint16Array(codebook.buffer, codebook.byteOffset, codebook.byteLength >> 1);
	for (let i = 0; i < pixels.length; i++) {
		const p = pixels[i]!;
		pixels[i] = ((p & 0x7c00) << 1) | ((p & 0x03e0) << 1) | (p & 0x001f);
	}
}

function load_codebook(raw: Uint8Array, compressed: boolean, dest_size: number, version: number, color_mode: number): Uint8Array {
	const codebook = compressed ? lcw_unpack(raw, dest_size, version) : Uint8Array.from(raw);
	if (color_mode === 1 || color_mode === 4) {
		hicolor_translate(codebook);
	}
	return codebook;
}

type CbAssembler = {
	codebook: Uint8Array;
	have: boolean;
	partials: Uint8Array[];
	packed: number;
	need: number;
	pending: Uint8Array | null;
};

function take_codebook_updates(
	asm: CbAssembler,
	frame: FramePayload,
	header: VQAHeader,
	table: { frame: number; packed: number }[],
	framenum: number,
	cb_size: number,
): void {
	if (frame.codebook) {
		const loaded = load_codebook(frame.codebook, frame.codebook_comp, cb_size, header.version, header.color_mode);
		asm.partials.length = 0;
		asm.packed = 0;
		asm.need = 0;
		if (!asm.have) {
			asm.codebook = loaded;
			asm.have = true;
		} else {
			asm.pending = loaded;
		}
	}
	if (frame.partials.length > 0) {
		for (const part of frame.partials) {
			if (asm.partials.length === 0) {
				asm.need = header.groupsize > 0 ? 0 : next_cb_packed(table, framenum);
			}
			asm.partials.push(part);
			asm.packed += part.length;
			const by_group = header.groupsize > 0 && asm.partials.length >= header.groupsize;
			const by_size = header.groupsize === 0 && asm.need > 0 && asm.packed === asm.need;
			if (by_group || by_size) {
				asm.pending = load_codebook(join_partials(asm.partials), frame.partial_comp, cb_size, header.version, header.color_mode);
				asm.partials.length = 0;
				asm.packed = 0;
				asm.need = 0;
			}
		}
	}
}

function commit_pending(asm: CbAssembler): void {
	if (asm.pending) {
		asm.codebook = asm.pending;
		asm.pending = null;
		asm.have = true;
	}
}

type SosState = { predicted: number; index: number; predicted2: number; index2: number };

function clamp16(sample: number): number {
	if (sample > 32767) {
		return 32767;
	}
	if (sample < -32768) {
		return -32768;
	}
	return sample;
}

function ima_channel(
	src: Uint8Array,
	src_off: number,
	dest: Int16Array,
	dest_off: number,
	samples: number,
	dest_stride: number,
	predicted: number,
	index: number,
): { predicted: number; index: number } {
	let sample = predicted;
	let step_index = index;
	for (let i = 0; i < samples; i++) {
		const byte = src[src_off + (i >> 1)] ?? 0;
		const code = (i & 1) === 0 ? byte & 0x0f : (byte >> 4) & 0x0f;
		const step = SOS_STEP[step_index] ?? 7;
		let diff = step >> 3;
		if ((code & 4) !== 0) {
			diff += step;
		}
		if ((code & 2) !== 0) {
			diff += step >> 1;
		}
		if ((code & 1) !== 0) {
			diff += step >> 2;
		}
		if ((code & 8) !== 0) {
			diff = -diff;
		}
		sample = clamp16(sample + diff);
		step_index += SOS_INDEX_ADJUST[code] ?? -1;
		if (step_index < 0) {
			step_index = 0;
		}
		if (step_index > 88) {
			step_index = 88;
		}
		dest[dest_off + i * dest_stride] = sample;
	}
	return { predicted: sample, index: step_index };
}

function decode_snd2(payload: Uint8Array, bits: number, channels: number, state: SosState): Int16Array {
	if (bits !== 16) {
		return new Int16Array(0);
	}
	const uncomp = payload.length * (bits / 4);
	const dest = new Int16Array(uncomp >> 1);
	if (channels === 2) {
		const per = uncomp >> 2;
		const left = ima_channel(payload, 0, dest, 0, per, 2, state.predicted, state.index);
		const right = ima_channel(payload, uncomp >> 3, dest, 1, per, 2, state.predicted2, state.index2);
		state.predicted = left.predicted;
		state.index = left.index;
		state.predicted2 = right.predicted;
		state.index2 = right.index;
	} else {
		const next = ima_channel(payload, 0, dest, 0, uncomp >> 1, 1, state.predicted, state.index);
		state.predicted = next.predicted;
		state.index = next.index;
	}
	return dest;
}

function decode_snd0(payload: Uint8Array, bits: number): Int16Array {
	if (bits === 16) {
		const samples = payload.length >> 1;
		const dest = new Int16Array(samples);
		for (let i = 0; i < samples; i++) {
			const v = payload[i * 2]! | (payload[i * 2 + 1]! << 8);
			dest[i] = v > 32767 ? v - 65536 : v;
		}
		return dest;
	}
	const dest = new Int16Array(payload.length);
	for (let i = 0; i < payload.length; i++) {
		dest[i] = (payload[i]! - 128) << 8;
	}
	return dest;
}

function palette_565(palette: Uint8Array): Uint16Array {
	const colors = new Uint16Array(256);
	const shift = palette.length >= 768 && palette[0]! <= 63 && palette[1]! <= 63 && palette[2]! <= 63 ? 2 : 0;
	const count = Math.min(256, Math.floor(palette.length / 3));
	for (let i = 0; i < count; i++) {
		const r = (palette[i * 3]! << shift) & 0xff;
		const g = (palette[i * 3 + 1]! << shift) & 0xff;
		const b = (palette[i * 3 + 2]! << shift) & 0xff;
		colors[i] = build_hicolor_pixel(r, g, b);
	}
	return colors;
}

function blit_indices(dest: DSurface, source: Uint8Array, width: number, height: number, colors: Uint16Array, dx: number, dy: number): void {
	for (let y = 0; y < height; y++) {
		const row = (dy + y) * dest.width + dx;
		const src = y * width;
		for (let x = 0; x < width; x++) {
			dest.pixels[row + x] = colors[source[src + x]!] ?? 0;
		}
	}
}

function blit_565(dest: DSurface, source: Uint8Array, width: number, height: number, dx: number, dy: number): void {
	const pixels = new Uint16Array(source.buffer, source.byteOffset, width * height);
	for (let y = 0; y < height; y++) {
		const row = (dy + y) * dest.width + dx;
		const src = y * width;
		dest.pixels.set(pixels.subarray(src, src + width), row);
	}
}

function blit_scaled_565(dest: DSurface, source: Uint8Array, width: number, height: number, dx: number, dy: number, dw: number, dh: number): void {
	const pixels = new Uint16Array(source.buffer, source.byteOffset, width * height);
	for (let y = 0; y < dh; y++) {
		const sy = Math.min(height - 1, Math.floor((y * height) / dh));
		const row = (dy + y) * dest.width + dx;
		const src = sy * width;
		for (let x = 0; x < dw; x++) {
			const sx = Math.min(width - 1, Math.floor((x * width) / dw));
			dest.pixels[row + x] = pixels[src + sx]!;
		}
	}
}

function blit_scaled_indices(
	dest: DSurface,
	source: Uint8Array,
	width: number,
	height: number,
	colors: Uint16Array,
	dx: number,
	dy: number,
	dw: number,
	dh: number,
): void {
	for (let y = 0; y < dh; y++) {
		const sy = Math.min(height - 1, Math.floor((y * height) / dh));
		const row = (dy + y) * dest.width + dx;
		const src = sy * width;
		for (let x = 0; x < dw; x++) {
			const sx = Math.min(width - 1, Math.floor((x * width) / dw));
			dest.pixels[row + x] = colors[source[src + sx]!] ?? 0;
		}
	}
}

type FramePayload = {
	codebook: Uint8Array | null;
	codebook_comp: boolean;
	partials: Uint8Array[];
	partial_comp: boolean;
	palette: Uint8Array | null;
	palette_comp: boolean;
	pointers: Uint8Array | null;
	pointers_comp: boolean;
	rsd: boolean;
};

function parse_frame(bytes: Uint8Array, start: number, size: number): FramePayload | null {
	const end = start + size;
	let at = start;
	let codebook: Uint8Array | null = null;
	let codebook_comp = false;
	const partials: Uint8Array[] = [];
	let partial_comp = false;
	let palette: Uint8Array | null = null;
	let palette_comp = false;
	let pointers: Uint8Array | null = null;
	let pointers_comp = false;
	let rsd = false;
	while (at + 8 <= end) {
		const chunk = read_chunk(bytes, at);
		if (!chunk || chunk.start > end) {
			break;
		}
		const payload = bytes.subarray(chunk.start, Math.min(chunk.start + chunk.size, end));
		switch (chunk.id) {
			case "CBF0":
				codebook = payload;
				codebook_comp = false;
				break;
			case "CBFZ":
				codebook = payload;
				codebook_comp = true;
				break;
			case "CBP0":
				partials.push(payload);
				partial_comp = false;
				break;
			case "CBPZ":
				partials.push(payload);
				partial_comp = true;
				break;
			case "CPL0":
				palette = payload;
				palette_comp = false;
				break;
			case "CPLZ":
				palette = payload;
				palette_comp = true;
				break;
			case "VPT0":
			case "VPTD":
			case "VPTK":
				pointers = payload;
				pointers_comp = false;
				rsd = false;
				break;
			case "VPTZ":
			case "VPDZ":
			case "VPKZ":
				pointers = payload;
				pointers_comp = true;
				rsd = false;
				break;
			case "VPTR":
				pointers = payload;
				pointers_comp = false;
				rsd = true;
				break;
			case "VPRZ":
				pointers = payload;
				pointers_comp = true;
				rsd = true;
				break;
			default:
				break;
		}
		at = chunk.next;
	}
	if (!pointers && !codebook && partials.length === 0 && !palette) {
		return null;
	}
	return { codebook, codebook_comp, partials, partial_comp, palette, palette_comp, pointers, pointers_comp, rsd };
}

export type VQAPlayOptions = {
	canvas: HTMLCanvasElement;
	stretch?: boolean;
	clrscrn_before?: boolean;
	clrscrn_after?: boolean;
	skip?: boolean;
	cancelled?: () => boolean;
	dest?: DSurface;
	dx?: number;
	dy?: number;
};

type AudioPlay = { context: AudioContext; started: number; rate: number };

function gather_pcm(movie: VQAMovie): { samples: Int16Array; rate: number; channels: number } {
	const header = movie.header;
	const has_audio = (header.flags & VQAHDF_AUDIO) !== 0;
	const chunks: Int16Array[] = [];
	let total = 0;
	const state: SosState = { predicted: 0, index: 0, predicted2: 0, index2: 0 };
	let at = movie.frame_start;
	while (at + 8 <= movie.bytes.length) {
		const chunk = read_chunk(movie.bytes, at);
		if (!chunk) {
			break;
		}
		if (has_audio && (chunk.id === "SND0" || chunk.id === "SND2")) {
			const payload = movie.bytes.subarray(chunk.start, chunk.start + chunk.size);
			const pcm = chunk.id === "SND2"
				? decode_snd2(payload, header.bits || 16, header.channels || 1, state)
				: decode_snd0(payload, header.bits || 16);
			if (pcm.length > 0) {
				chunks.push(pcm);
				total += pcm.length;
			}
		}
		at = chunk.next;
	}
	const samples = new Int16Array(total);
	let o = 0;
	for (const chunk of chunks) {
		samples.set(chunk, o);
		o += chunk.length;
	}
	return { samples, rate: header.sample_rate || 22050, channels: header.channels || 1 };
}

async function start_audio(pcm: Int16Array, rate: number, channels: number): Promise<AudioPlay | null> {
	if (pcm.length === 0) {
		return null;
	}
	await Ensure_Audio();
	const context = Audio_Context();
	if (!context) {
		return null;
	}
	Play_Pcm(pcm, rate, channels, AUDIO_GROUP_MOVIE, 1, 0, false);
	return { context, started: context.currentTime, rate };
}

function wait_ms(ms: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

export async function VQA_Play(movie: VQAMovie, options: VQAPlayOptions): Promise<void> {
	const header = movie.header;
	if (header.width < 1 || header.height < 1 || header.block_w < 1 || header.block_h < 1) {
		return;
	}
	const blocksperrow = Math.floor(header.width / header.block_w);
	const numrows = Math.floor(header.height / header.block_h);
	const cb_size = cb_buffer_size(header);
	const ptr_size = ptr_buffer_size(header);
	const paletted = header.color_mode === 0;
	const frame_bytes = paletted ? header.width * header.height : header.width * header.height * 2;
	const image = new Uint8Array(frame_bytes);
	const asm: CbAssembler = {
		codebook: new Uint8Array(cb_size),
		have: false,
		partials: [],
		packed: 0,
		need: 0,
		pending: null,
	};
	let pal_565: Uint16Array = new Uint16Array(256);
	const fps = Math.max(1, header.fps);
	const dest = options.dest ?? new DSurface(640, 400);
	const canvas_w = dest.width;
	const canvas_h = dest.height;
	let dw = header.width;
	let dh = header.height;
	if (options.stretch) {
		const scale = Math.min(canvas_w / header.width, canvas_h / header.height);
		dw = Math.max(1, Math.floor(header.width * scale));
		dh = Math.max(1, Math.floor(header.height * scale));
	}
	const dx = options.dx ?? Math.floor((canvas_w - dw) / 2);
	const dy = options.dy ?? Math.floor((canvas_h - dh) / 2);

	if (options.clrscrn_before !== false) {
		dest.fill(0);
		if (!options.dest) {
			present(options.canvas, dest);
		}
	}

	const pcm = gather_pcm(movie);
	const audio = await start_audio(pcm.samples, pcm.rate, pcm.channels);
	let skipped = false;
	let armed = false;
	const on_skip = (): void => {
		if (armed && options.skip !== false) {
			skipped = true;
		}
	};
	window.addEventListener("keydown", on_skip);
	options.canvas.addEventListener("pointerdown", on_skip);

	try {
		let at = movie.frame_start;
		let drawn = 0;
		const wall0 = performance.now();
		while (at + 8 <= movie.bytes.length && drawn < header.frames) {
			if (skipped || options.cancelled?.()) {
				break;
			}
			const chunk = read_chunk(movie.bytes, at);
			if (!chunk) {
				break;
			}
			at = chunk.next;
			if (chunk.id !== "VQFR" && chunk.id !== "VQFK" && chunk.id !== "VQFL") {
				continue;
			}
			const frame = parse_frame(movie.bytes, chunk.start, chunk.size);
			if (!frame) {
				continue;
			}
			take_codebook_updates(asm, frame, header, movie.cb_table, drawn, cb_size);
			if (frame.palette) {
				const raw = frame.palette_comp ? lcw_unpack(frame.palette, 768, header.version) : frame.palette;
				pal_565 = palette_565(raw);
			}
			if (!frame.pointers) {
				commit_pending(asm);
				continue;
			}
			const pointers = frame.pointers_comp ? lcw_unpack(frame.pointers, ptr_size, header.version) : frame.pointers;
			const unvq = Select_UnVQ(header.color_mode, header.block_w, header.block_h, frame.rsd);
			if (unvq) {
				unvq(asm.codebook, pointers, image, blocksperrow, numrows, header.width);
			}
			commit_pending(asm);
			let due: number;
			if (audio) {
				due = audio.started + drawn / fps;
				const now = audio.context.currentTime;
				if (due > now) {
					await wait_ms((due - now) * 1000);
				}
			} else {
				due = wall0 + (drawn * 1000) / fps;
				const now = performance.now();
				if (due > now) {
					await wait_ms(due - now);
				}
			}
			if (skipped || options.cancelled?.()) {
				break;
			}
			if (options.clrscrn_before !== false || drawn === 0) {
				if (options.clrscrn_before !== false) {
					dest.fill(0);
				}
			}
			if (paletted) {
				if (options.stretch && (dw !== header.width || dh !== header.height)) {
					blit_scaled_indices(dest, image, header.width, header.height, pal_565, dx, dy, dw, dh);
				} else {
					blit_indices(dest, image, header.width, header.height, pal_565, dx, dy);
				}
			} else if (options.stretch && (dw !== header.width || dh !== header.height)) {
				blit_scaled_565(dest, image, header.width, header.height, dx, dy, dw, dh);
			} else {
				blit_565(dest, image, header.width, header.height, dx, dy);
			}
			if (!options.dest) {
				present(options.canvas, dest);
			}
			armed = true;
			drawn++;
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
	} finally {
		window.removeEventListener("keydown", on_skip);
		options.canvas.removeEventListener("pointerdown", on_skip);
		Stop_Group(AUDIO_GROUP_MOVIE);
		if (options.clrscrn_after !== false && !options.dest) {
			dest.fill(0);
			present(options.canvas, dest);
		}
	}
}

export type IngameVQ = {
	movie: VQAMovie;
	header: VQAHeader;
	image: Uint8Array;
	cb: CbAssembler;
	pal_565: Uint16Array;
	at: number;
	drawn: number;
	started: number;
	audio: AudioPlayHandle | null;
};

export function Ingame_Open(bytes: Uint8Array): IngameVQ | null {
	const movie = VQA_Open(bytes);
	if (!movie) {
		return null;
	}
	const header = movie.header;
	const cb_size = cb_buffer_size(header);
	return {
		movie,
		header,
		image: new Uint8Array(header.color_mode === 0 ? header.width * header.height : header.width * header.height * 2),
		cb: {
			codebook: new Uint8Array(cb_size),
			have: false,
			partials: [],
			packed: 0,
			need: 0,
			pending: null,
		},
		pal_565: new Uint16Array(256),
		at: movie.frame_start,
		drawn: 0,
		started: performance.now(),
		audio: null,
	};
}

export async function Ingame_Start_Audio(player: IngameVQ): Promise<void> {
	if (player.audio || Ingame_Finished(player)) {
		return;
	}
	const pcm = gather_pcm(player.movie);
	if (pcm.samples.length === 0) {
		return;
	}
	await Ensure_Audio();
	if (Ingame_Finished(player)) {
		return;
	}
	player.audio = Play_Pcm(pcm.samples, pcm.rate, pcm.channels, AUDIO_GROUP_MOVIE, 1, 0, false);
}

export function Ingame_Stop(player: IngameVQ): void {
	Stop_Handle(player.audio);
	player.audio = null;
}

export function Ingame_Advance(player: IngameVQ): boolean {
	const header = player.header;
	if (player.drawn >= header.frames) {
		return false;
	}
	const fps = Math.max(1, header.fps);
	const due = player.started + (player.drawn * 1000) / fps;
	if (performance.now() < due) {
		return true;
	}
	const cb_size = cb_buffer_size(header);
	const ptr_size = ptr_buffer_size(header);
	while (player.at + 8 <= player.movie.bytes.length && player.drawn < header.frames) {
		const chunk = read_chunk(player.movie.bytes, player.at);
		if (!chunk) {
			return false;
		}
		player.at = chunk.next;
		if (chunk.id !== "VQFR" && chunk.id !== "VQFK" && chunk.id !== "VQFL") {
			continue;
		}
		const frame = parse_frame(player.movie.bytes, chunk.start, chunk.size);
		if (!frame) {
			continue;
		}
		take_codebook_updates(player.cb, frame, header, player.movie.cb_table, player.drawn, cb_size);
		if (frame.palette) {
			const raw = frame.palette_comp ? lcw_unpack(frame.palette, 768, header.version) : frame.palette;
			player.pal_565 = palette_565(raw);
		}
		if (!frame.pointers) {
			commit_pending(player.cb);
			continue;
		}
		const pointers = frame.pointers_comp ? lcw_unpack(frame.pointers, ptr_size, header.version) : frame.pointers;
		const unvq = Select_UnVQ(header.color_mode, header.block_w, header.block_h, frame.rsd);
		if (unvq) {
			unvq(
				player.cb.codebook,
				pointers,
				player.image,
				Math.floor(header.width / header.block_w),
				Math.floor(header.height / header.block_h),
				header.width,
			);
		}
		commit_pending(player.cb);
		player.drawn++;
		return true;
	}
	return player.drawn < header.frames;
}

export function Ingame_Blit(dest: DSurface, player: IngameVQ, dx: number, dy: number): void {
	const header = player.header;
	if (header.color_mode === 0) {
		blit_indices(dest, player.image, header.width, header.height, player.pal_565, dx, dy);
	} else {
		blit_565(dest, player.image, header.width, header.height, dx, dy);
	}
}

export function Ingame_Finished(player: IngameVQ): boolean {
	return player.drawn >= player.header.frames;
}
