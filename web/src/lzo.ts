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

export function lzo1x_decompress(src: Uint8Array, dst: Uint8Array): number {
	const src_end = src.length;
	const dst_end = dst.length;
	let ip = 0;
	let op = 0;

	const copy_lit = (count: number): boolean => {
		if (count < 0 || ip + count > src_end || op + count > dst_end) {
			return false;
		}
		dst.set(src.subarray(ip, ip + count), op);
		ip += count;
		op += count;
		return true;
	};

	const copy_match = (m_pos: number, count: number): boolean => {
		if (count < 1 || m_pos < 0 || m_pos >= op || op + count > dst_end) {
			return false;
		}
		for (let i = 0; i < count; i++) {
			dst[op++] = dst[m_pos++]!;
		}
		return true;
	};

	const read_zero_run = (base: number): number => {
		let t = base;
		while (ip < src_end && src[ip] === 0) {
			t += 255;
			ip++;
		}
		if (ip >= src_end) {
			return -1;
		}
		return t + src[ip++]!;
	};

	if (src_end === 0) {
		return 0;
	}

	let first = false;
	let t = 0;
	if (src[ip]! > 17) {
		t = src[ip++]! - 17;
		first = true;
	}

	for (;;) {
		if (first) {
			if (!copy_lit(t)) {
				return 0;
			}
			first = false;
			if (ip >= src_end) {
				return 0;
			}
			t = src[ip++]!;
			if (t < 16) {
				if (ip >= src_end) {
					return 0;
				}
				const m_pos = op - 1 - 0x800 - (t >> 2) - (src[ip++]! << 2);
				if (!copy_match(m_pos, 3)) {
					return 0;
				}
				t = src[ip - 2]! & 3;
				if (t === 0) {
					continue;
				}
				if (!copy_lit(t)) {
					return 0;
				}
				if (ip >= src_end) {
					return 0;
				}
				t = src[ip++]!;
			}
		} else {
			if (ip >= src_end) {
				return 0;
			}
			t = src[ip++]!;
			if (t < 16) {
				if (t === 0) {
					t = read_zero_run(15);
					if (t < 0) {
						return 0;
					}
				}
				if (!copy_lit(t + 3)) {
					return 0;
				}
				if (ip >= src_end) {
					return 0;
				}
				t = src[ip++]!;
				if (t < 16) {
					if (ip >= src_end) {
						return 0;
					}
					const m_pos = op - 1 - 0x800 - (t >> 2) - (src[ip++]! << 2);
					if (!copy_match(m_pos, 3)) {
						return 0;
					}
					t = src[ip - 2]! & 3;
					if (t === 0) {
						continue;
					}
					if (!copy_lit(t)) {
						return 0;
					}
					if (ip >= src_end) {
						return 0;
					}
					t = src[ip++]!;
				}
			}
		}

		for (;;) {
			if (t < 16) {
				if (ip >= src_end) {
					return 0;
				}
				const m_pos = op - 1 - (t >> 2) - (src[ip++]! << 2);
				if (!copy_match(m_pos, 2)) {
					return 0;
				}
			} else if (t >= 64) {
				if (ip >= src_end) {
					return 0;
				}
				const m_pos = op - 1 - ((t >> 2) & 7) - (src[ip++]! << 3);
				t = (t >> 5) - 1;
				if (!copy_match(m_pos, t + 2)) {
					return 0;
				}
			} else if (t >= 32) {
				t &= 31;
				if (t === 0) {
					t = read_zero_run(31);
					if (t < 0) {
						return 0;
					}
				}
				if (ip + 2 > src_end) {
					return 0;
				}
				const m_pos = op - 1 - (src[ip]! >> 2) - (src[ip + 1]! << 6);
				ip += 2;
				if (!copy_match(m_pos, t + 2)) {
					return 0;
				}
			} else {
				let m_pos = op - ((t & 8) << 11);
				t &= 7;
				if (t === 0) {
					t = read_zero_run(7);
					if (t < 0) {
						return 0;
					}
				}
				if (ip + 2 > src_end) {
					return 0;
				}
				m_pos -= (src[ip]! >> 2) + (src[ip + 1]! << 6);
				ip += 2;
				if (m_pos === op) {
					return op;
				}
				m_pos -= 0x4000;
				if (!copy_match(m_pos, t + 2)) {
					return 0;
				}
			}

			t = src[ip - 2]! & 3;
			if (t === 0) {
				break;
			}
			if (!copy_lit(t)) {
				return 0;
			}
			if (ip >= src_end) {
				return 0;
			}
			t = src[ip++]!;
		}
	}
}

export function lzo_straw_decompress(source: Uint8Array, max_out = 8 * 1024 * 1024): Uint8Array {
	const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
	const chunks: Uint8Array[] = [];
	let offset = 0;
	let total = 0;
	while (offset + 4 <= source.length) {
		const comp = view.getUint16(offset, true);
		const uncomp = view.getUint16(offset + 2, true);
		offset += 4;
		if (comp === 0 || uncomp === 0 || offset + comp > source.length) {
			break;
		}
		const block = source.subarray(offset, offset + comp);
		offset += comp;
		const dest = new Uint8Array(Math.max(uncomp, 8192) + 8192);
		const written = lzo1x_decompress(block, dest);
		if (written <= 0) {
			break;
		}
		const used = Math.min(uncomp, written);
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
