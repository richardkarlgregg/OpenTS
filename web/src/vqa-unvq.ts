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

function u16(data: Uint8Array, at: number): number {
	return data[at]! | (data[at + 1]! << 8);
}

function put32(data: Uint8Array, at: number, value: number): void {
	data[at] = value & 0xff;
	data[at + 1] = (value >> 8) & 0xff;
	data[at + 2] = (value >> 16) & 0xff;
	data[at + 3] = (value >> 24) & 0xff;
}

function put16(data: Uint8Array, at: number, value: number): void {
	data[at] = value & 0xff;
	data[at + 1] = (value >> 8) & 0xff;
}

function pair16(pixel: number): number {
	return ((pixel & 0xffff) << 16) | (pixel & 0xffff);
}

function quad8(colour: number): number {
	const pair = ((colour & 0xff) << 8) | (colour & 0xff);
	return (pair << 16) | pair;
}

function block_index(pointers: Uint8Array, entries: number, block: number): number {
	return pointers[block]! | (pointers[entries + block]! << 8);
}

function copy_cb_4x4(codebook: Uint8Array, index: number, dest: Uint8Array, dst: number, pitch: number): void {
	let cb = index << 5;
	let row = dst;
	for (let r = 0; r < 4; r++) {
		dest.set(codebook.subarray(cb, cb + 8), row);
		cb += 8;
		row += pitch;
	}
}

function fill_4x4_16(dest: Uint8Array, dst: number, pitch: number, pixel: number): void {
	const v = pair16(pixel);
	let row = dst;
	for (let r = 0; r < 4; r++) {
		put32(dest, row, v);
		put32(dest, row + 4, v);
		row += pitch;
	}
}

export function UnVQ1_C1_4x4(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
): void {
	if (blocksperrow === 0) {
		return;
	}
	const pitch = bufwidth * 2;
	const entries = numrows * blocksperrow;
	let rowstart = 0;
	let block = 0;
	do {
		let dest = rowstart;
		for (let i = 0; i < blocksperrow; i++) {
			const index = block_index(pointers, entries, block);
			block++;
			if ((index & 0x8000) !== 0) {
				fill_4x4_16(buffer, dest, pitch, index & 0x7fff);
			} else {
				copy_cb_4x4(codebook, index, buffer, dest, pitch);
			}
			dest += 8;
		}
		rowstart += pitch * 4;
	} while (block < entries);
}

export function UnVQ2_C1_4x4(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
): void {
	const pitch = bufwidth * 2;
	const block_row = pitch * 4;
	const data_end = numrows * pitch * 4;
	let dst = 0;
	let row_base = 0;
	let row_end = blocksperrow * 8;
	let src = 0;
	const src_end = pointers.length;

	while (dst < data_end && src + 1 < src_end) {
		const command = u16(pointers, src);
		src += 2;
		const tag = command & 0xf000;
		const count = command & 0x0fff;

		switch (tag) {
			case 0x0000: {
				if (src + 1 >= src_end) {
					return;
				}
				const v = pair16(u16(pointers, src));
				src += 2;
				const n = 2 * count;
				for (let row = 0; row < 4; row++) {
					let p = dst + row * pitch;
					for (let i = 0; i < n; i++) {
						put32(buffer, p, v);
						p += 4;
					}
				}
				dst += 8 * count;
				break;
			}
			case 0x1000:
				dst += 8 * count;
				break;
			case 0x2000: {
				if (src + 1 >= src_end) {
					return;
				}
				let cb = u16(pointers, src) << 5;
				src += 2;
				const start = dst;
				for (let r = 0; r < 4; r++) {
					const lo = u16(codebook, cb) | (u16(codebook, cb + 2) << 16);
					cb += 4;
					let p = dst;
					for (let i = 0; i < count; i++) {
						put32(buffer, p, lo);
						p += 8;
					}
					const hi = u16(codebook, cb) | (u16(codebook, cb + 2) << 16);
					cb += 4;
					p = dst + 4;
					for (let i = 0; i < count; i++) {
						put32(buffer, p, hi);
						p += 8;
					}
					dst += pitch;
				}
				dst = start + count * 8;
				break;
			}
			case 0x3000: {
				if (src + 1 >= src_end) {
					return;
				}
				let cb = u16(pointers, src) << 5;
				src += 2;
				const start = dst;
				for (let r = 0; r < 4; r++) {
					let rowp = dst;
					for (let c = 0; c < 4; c++) {
						const px = u16(codebook, cb);
						if ((px & 0x8000) === 0) {
							let p = rowp;
							for (let i = 0; i < count; i++) {
								put16(buffer, p, px);
								p += 8;
							}
						}
						rowp += 2;
						cb += 2;
					}
					dst += pitch;
				}
				dst = start + 8 * count;
				break;
			}
			case 0x5000: {
				const step = 4 * (pitch >> 2);
				for (let i = 0; i < count && src + 1 < src_end; i++) {
					const v = pair16(u16(pointers, src));
					src += 2;
					let p = dst;
					for (let j = 0; j < 4; j++) {
						put32(buffer, p, v);
						put32(buffer, p + 4, v);
						p += step;
					}
					dst += 8;
				}
				break;
			}
			case 0x6000: {
				const step = 4 * (pitch >> 2);
				for (let i = 0; i < count && src + 1 < src_end; i++) {
					let cb = u16(pointers, src) << 5;
					src += 2;
					let p = dst;
					for (let r = 0; r < 4; r++) {
						put32(buffer, p, u16(codebook, cb) | (u16(codebook, cb + 2) << 16));
						cb += 4;
						put32(buffer, p + 4, u16(codebook, cb) | (u16(codebook, cb + 2) << 16));
						cb += 4;
						p += step;
					}
					dst += 8;
				}
				break;
			}
			case 0x7000: {
				for (let i = 0; i < count && src + 1 < src_end; i++) {
					let cb = u16(pointers, src) << 5;
					src += 2;
					let p = dst;
					for (let r = 0; r < 4; r++) {
						let q = p;
						for (let c = 0; c < 4; c++) {
							const px = u16(codebook, cb);
							if ((px & 0x8000) === 0) {
								put16(buffer, q, px);
							}
							q += 2;
							cb += 2;
						}
						p += 2 * (pitch >> 1);
					}
					dst += 8;
				}
				break;
			}
			default:
				break;
		}

		if (dst === row_end) {
			row_base += block_row;
			dst = row_base;
			row_end = row_base + 8 * blocksperrow;
		}
	}
}

export function UnVQ_4x2(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
): void {
	if (blocksperrow === 0) {
		return;
	}
	const entries = numrows * blocksperrow;
	let rowstart = 0;
	let block = 0;
	do {
		let dest = rowstart;
		for (let i = 0; i < blocksperrow; i++) {
			const index = block_index(pointers, entries, block);
			block++;
			if (index >> 8 === 0xff) {
				const v = quad8(index & 0xff);
				put32(buffer, dest, v);
				put32(buffer, dest + bufwidth, v);
			} else {
				const word = index * 8;
				buffer.set(codebook.subarray(word, word + 4), dest);
				buffer.set(codebook.subarray(word + 4, word + 8), dest + bufwidth);
			}
			dest += 4;
		}
		rowstart += bufwidth * 2;
	} while (block < entries);
}

export function UnVQ_4x4(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
): void {
	if (blocksperrow === 0) {
		return;
	}
	const entries = numrows * blocksperrow;
	let rowstart = 0;
	let block = 0;
	do {
		let dest = rowstart;
		for (let i = 0; i < blocksperrow; i++) {
			const index = block_index(pointers, entries, block);
			block++;
			if (index >> 8 === 0xff) {
				const v = quad8(index & 0xff);
				for (let row = 0; row < 4; row++) {
					put32(buffer, dest + row * bufwidth, v);
				}
			} else {
				const word = index * 16;
				for (let row = 0; row < 4; row++) {
					buffer.set(codebook.subarray(word + row * 4, word + row * 4 + 4), dest + row * bufwidth);
				}
			}
			dest += 4;
		}
		rowstart += bufwidth * 4;
	} while (block < entries);
}

function unvq1_c4(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
	block_h: number,
): void {
	const pitch = bufwidth * 2;
	const block_row = pitch * block_h;
	const data_end = numrows * pitch * block_h;
	const shift = block_h === 4 ? 5 : 4;
	let dst = 0;
	let row_base = 0;
	let row_end = blocksperrow * 8;
	let src = 0;
	const src_end = pointers.length;

	while (dst < data_end && src + 1 < src_end) {
		const word = u16(pointers, src);
		src += 2;
		const command = word & 0xe000;
		const cb_index = word & 0x1fff;
		switch (command) {
			case 0x0000: {
				let cb = cb_index << shift;
				const start = dst;
				for (let r = 0; r < block_h; r++) {
					put32(buffer, dst, u16(codebook, cb) | (u16(codebook, cb + 2) << 16));
					cb += 4;
					put32(buffer, dst + 4, u16(codebook, cb) | (u16(codebook, cb + 2) << 16));
					cb += 4;
					dst += pitch;
				}
				dst = start + 8;
				break;
			}
			case 0x2000: {
				let cb = cb_index << shift;
				const start = dst;
				for (let r = 0; r < block_h; r++) {
					let p = dst;
					for (let c = 0; c < 4; c++) {
						const v = u16(codebook, cb);
						if (v !== 0x8000) {
							put16(buffer, p, v);
						}
						p += 2;
						cb += 2;
					}
					dst += pitch;
				}
				dst = start + 8;
				break;
			}
			case 0x4000:
				dst += 8;
				break;
			default:
				break;
		}
		if (dst === row_end) {
			row_base += block_row;
			dst = row_base;
			row_end = row_base + blocksperrow * 8;
		}
	}
}

export function UnVQ1_C4_4x4(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
): void {
	unvq1_c4(codebook, pointers, buffer, blocksperrow, numrows, bufwidth, 4);
}

export function UnVQ1_C4_4x2(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
): void {
	unvq1_c4(codebook, pointers, buffer, blocksperrow, numrows, bufwidth, 2);
}

function unvq2_c4(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
	block_h: number,
): void {
	const pitch = bufwidth * 2;
	const block_row = pitch * block_h;
	const data_end = numrows * pitch * block_h;
	const shift = block_h === 4 ? 5 : 4;
	let dst = 0;
	let row_base = 0;
	let row_end = blocksperrow * 8;
	let src = 0;
	const src_end = pointers.length;

	const write_block = (index_byte: number, dest: number): void => {
		let cb = index_byte << shift;
		let p = dest;
		for (let r = 0; r < block_h; r++) {
			put32(buffer, p, u16(codebook, cb) | (u16(codebook, cb + 2) << 16));
			cb += 4;
			put32(buffer, p + 4, u16(codebook, cb) | (u16(codebook, cb + 2) << 16));
			cb += 4;
			p += pitch;
		}
	};

	while (dst < data_end && src + 1 < src_end) {
		const word = u16(pointers, src);
		src += 2;
		const command = word & 0xe000;
		const cb_index = word & 0x1fff;

		switch (command) {
			case 0x4000: {
				write_block(pointers[src - 2]!, dst);
				const repeat = ((cb_index >> 7) & 0x3e) + 2;
				dst += 8;
				for (let i = 0; i < repeat; i++) {
					if (src >= src_end) {
						return;
					}
					write_block(pointers[src]!, dst);
					src += 1;
					dst += 8;
				}
				break;
			}
			case 0x0000:
				dst += 8 * (cb_index & 0xff);
				break;
			case 0x6000: {
				const start = dst;
				let cb = cb_index << shift;
				for (let r = 0; r < block_h; r++) {
					put32(buffer, dst, u16(codebook, cb) | (u16(codebook, cb + 2) << 16));
					cb += 4;
					put32(buffer, dst + 4, u16(codebook, cb) | (u16(codebook, cb + 2) << 16));
					cb += 4;
					dst += pitch;
				}
				dst = start + 8;
				break;
			}
			case 0x8000: {
				const start = dst;
				let cb = cb_index << shift;
				for (let r = 0; r < block_h; r++) {
					let p = dst;
					for (let c = 0; c < 4; c++) {
						const v = u16(codebook, cb);
						if (v !== 0x8000) {
							put16(buffer, p, v);
						}
						p += 2;
						cb += 2;
					}
					dst += pitch;
				}
				dst = start + 8;
				break;
			}
			case 0x2000:
			case 0xa000:
			case 0xc000: {
				let height: number;
				let index = cb_index;
				if (command === 0xc000 || command === 0xa000) {
					if (src >= src_end) {
						return;
					}
					height = pointers[src]!;
					src += 1;
				} else {
					height = ((cb_index >> 7) & 0x3e) + 2;
					index = cb_index & 0xff;
				}
				const start = dst;
				let cb = index << shift;
				const masked = command === 0xc000;
				for (let r = 0; r < block_h; r++) {
					if (masked) {
						let p = dst;
						for (let c = 0; c < 4; c++) {
							const v = u16(codebook, cb);
							if (v !== 0x8000) {
								let q = p;
								for (let i = 0; i < height; i++) {
									put16(buffer, q, v);
									q += 8;
								}
							}
							p += 2;
							cb += 2;
						}
					} else {
						const lo = u16(codebook, cb) | (u16(codebook, cb + 2) << 16);
						cb += 4;
						let p = dst;
						for (let i = 0; i < height; i++) {
							put32(buffer, p, lo);
							p += 8;
						}
						const hi = u16(codebook, cb) | (u16(codebook, cb + 2) << 16);
						cb += 4;
						p = dst + 4;
						for (let i = 0; i < height; i++) {
							put32(buffer, p, hi);
							p += 8;
						}
					}
					dst += pitch;
				}
				dst = start + 8 * height;
				break;
			}
			default:
				break;
		}

		if (dst === row_end) {
			row_base += block_row;
			dst = row_base;
			row_end = row_base + blocksperrow * 8;
		}
	}
}

export function UnVQ2_C4_4x4(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
): void {
	unvq2_c4(codebook, pointers, buffer, blocksperrow, numrows, bufwidth, 4);
}

export function UnVQ2_C4_4x2(
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
): void {
	unvq2_c4(codebook, pointers, buffer, blocksperrow, numrows, bufwidth, 2);
}

export type UnVQFn = (
	codebook: Uint8Array,
	pointers: Uint8Array,
	buffer: Uint8Array,
	blocksperrow: number,
	numrows: number,
	bufwidth: number,
) => void;

export function Select_UnVQ(color_mode: number, block_w: number, block_h: number, rsd: boolean): UnVQFn | null {
	const four_by_four = block_w === 4 && block_h === 4;
	const four_by_two = block_w === 4 && block_h === 2;
	if (color_mode === 1 && four_by_four) {
		return rsd ? UnVQ2_C1_4x4 : UnVQ1_C1_4x4;
	}
	if (color_mode === 4 && four_by_four) {
		return rsd ? UnVQ2_C4_4x4 : UnVQ1_C4_4x4;
	}
	if (color_mode === 4 && four_by_two) {
		return rsd ? UnVQ2_C4_4x2 : UnVQ1_C4_4x2;
	}
	if (color_mode === 0 && four_by_four) {
		return UnVQ_4x4;
	}
	if (color_mode === 0 && four_by_two) {
		return UnVQ_4x2;
	}
	return null;
}
