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

export function LCW_Uncomp(source: Uint8Array, dest: Uint8Array): number {
	let ip = 0;
	let op = 0;
	const src_end = source.length;
	const dst_end = dest.length;
	if (src_end === 0 || dst_end === 0) {
		return 0;
	}

	const relative = source[0] === 0;
	if (relative) {
		ip = 1;
	}

	const copy_from = (from: number, count: number): boolean => {
		if (from < 0 || count < 1) {
			return false;
		}
		const used = Math.min(count, dst_end - op);
		for (let i = 0; i < used; i++) {
			dest[op++] = dest[from++]!;
		}
		return used === count;
	};

	while (ip < src_end && op < dst_end) {
		const op_code = source[ip++]!;
		if ((op_code & 0x80) === 0) {
			if (ip >= src_end) {
				break;
			}
			const count = (op_code >> 4) + 3;
			const back = source[ip++]! + ((op_code & 0x0f) << 8);
			if (!copy_from(op - back, count) && op >= dst_end) {
				break;
			}
			continue;
		}

		if ((op_code & 0x40) === 0) {
			if (op_code === 0x80) {
				return op;
			}
			const count = op_code & 0x3f;
			if (ip + count > src_end) {
				break;
			}
			const used = Math.min(count, dst_end - op);
			dest.set(source.subarray(ip, ip + used), op);
			ip += count;
			op += used;
			continue;
		}

		if (op_code === 0xfe) {
			if (ip + 3 > src_end) {
				break;
			}
			const count = source[ip]! + (source[ip + 1]! << 8);
			const data = source[ip + 2]!;
			ip += 3;
			const used = Math.min(count, dst_end - op);
			dest.fill(data, op, op + used);
			op += used;
			continue;
		}

		if (op_code === 0xff) {
			if (ip + 4 > src_end) {
				break;
			}
			const count = source[ip]! + (source[ip + 1]! << 8);
			const offset = source[ip + 2]! + (source[ip + 3]! << 8);
			ip += 4;
			const from = relative ? op - offset : offset;
			if (!copy_from(from, count) && op >= dst_end) {
				break;
			}
			continue;
		}

		if (ip + 2 > src_end) {
			break;
		}
		const count = (op_code & 0x3f) + 3;
		const offset = source[ip]! + (source[ip + 1]! << 8);
		ip += 2;
		const from = relative ? op - offset : offset;
		if (!copy_from(from, count) && op >= dst_end) {
			break;
		}
	}
	return op;
}

export function lcw_straw_decompress(source: Uint8Array, max_out = 8 * 1024 * 1024): Uint8Array {
	const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
	const chunks: Uint8Array[] = [];
	let offset = 0;
	let total = 0;
	const block_size = 8192;
	while (offset + 4 <= source.length) {
		const comp = view.getUint16(offset, true);
		const uncomp = view.getUint16(offset + 2, true);
		offset += 4;
		if (comp === 0 || uncomp === 0 || offset + comp > source.length || uncomp > block_size) {
			break;
		}
		const block = source.subarray(offset, offset + comp);
		offset += comp;
		const dest = new Uint8Array(uncomp);
		const written = LCW_Uncomp(block, dest);
		const used = Math.min(uncomp, written);
		if (used <= 0) {
			break;
		}
		chunks.push(dest.subarray(0, used));
		total += used;
		if (total >= max_out) {
			break;
		}
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}
