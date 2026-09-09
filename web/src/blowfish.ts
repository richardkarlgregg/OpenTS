/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 * EA's GPLv3 Section 7 additional terms and supplemental warranty
 * disclaimers apply; see LICENSE.md.
 ******************************************************************************/

import { P_INIT, S_INIT } from "./blowfish-tables";

const ROUNDS = 16;

function f(s: Uint32Array[], x: number): number {
	const a = (x >>> 24) & 0xff;
	const b = (x >>> 16) & 0xff;
	const c = (x >>> 8) & 0xff;
	const d = x & 0xff;
	return (((((s[0]![a]! + s[1]![b]!) >>> 0) ^ s[2]![c]!) + s[3]![d]!) >>> 0);
}

export class BlowfishEngine {
	static readonly MAX_KEY_LENGTH = 56;
	private p_encrypt = new Uint32Array(ROUNDS + 2);
	private p_decrypt = new Uint32Array(ROUNDS + 2);
	private s = [
		new Uint32Array(256),
		new Uint32Array(256),
		new Uint32Array(256),
		new Uint32Array(256),
	];
	private keyed = false;

	submit_key(key: Uint8Array): void {
		this.p_encrypt.set(P_INIT);
		this.p_decrypt.set(P_INIT);
		for (let i = 0; i < 4; i++) {
			this.s[i]!.set(S_INIT[i]!);
		}
		if (key.length === 0) {
			this.keyed = false;
			return;
		}

		let j = 0;
		for (let index = 0; index < ROUNDS + 2; index++) {
			let data = 0;
			data = ((data << 8) | key[j++ % key.length]!) >>> 0;
			data = ((data << 8) | key[j++ % key.length]!) >>> 0;
			data = ((data << 8) | key[j++ % key.length]!) >>> 0;
			data = ((data << 8) | key[j++ % key.length]!) >>> 0;
			this.p_encrypt[index] = (this.p_encrypt[index]! ^ data) >>> 0;
		}

		let left = 0;
		let right = 0;
		for (let p_index = 0; p_index < ROUNDS + 2; p_index += 2) {
			[left, right] = this.sub_key_encrypt(left, right);
			this.p_encrypt[p_index] = left;
			this.p_encrypt[p_index + 1] = right;
			this.p_decrypt[ROUNDS + 1 - p_index] = left;
			this.p_decrypt[ROUNDS - p_index] = right;
		}

		for (let sbox_index = 0; sbox_index < 4; sbox_index++) {
			const box = this.s[sbox_index]!;
			for (let ss = 0; ss < 256; ss += 2) {
				[left, right] = this.sub_key_encrypt(left, right);
				box[ss] = left;
				box[ss + 1] = right;
			}
		}
		this.keyed = true;
	}

	decrypt(input: Uint8Array): Uint8Array {
		const output = new Uint8Array(input.length);
		if (!this.keyed) {
			output.set(input);
			return output;
		}
		const blocks = (input.length / 8) | 0;
		for (let i = 0; i < blocks; i++) {
			this.process_block(input, i * 8, output, i * 8, this.p_decrypt);
		}
		const done = blocks * 8;
		if (done < input.length) {
			output.set(input.subarray(done), done);
		}
		return output;
	}

	private sub_key_encrypt(left: number, right: number): [number, number] {
		let l = left >>> 0;
		let r = right >>> 0;
		for (let index = 0; index < ROUNDS; index += 2) {
			l = (l ^ this.p_encrypt[index]!) >>> 0;
			r = (r ^ f(this.s, l) ^ this.p_encrypt[index + 1]!) >>> 0;
			l = (l ^ f(this.s, r)) >>> 0;
		}
		return [(r ^ this.p_encrypt[ROUNDS + 1]!) >>> 0, (l ^ this.p_encrypt[ROUNDS]!) >>> 0];
	}

	private process_block(
		src: Uint8Array,
		si: number,
		dst: Uint8Array,
		di: number,
		ptable: Uint32Array,
	): void {
		let left =
			((src[si]! << 24) | (src[si + 1]! << 16) | (src[si + 2]! << 8) | src[si + 3]!) >>> 0;
		let right =
			((src[si + 4]! << 24) | (src[si + 5]! << 16) | (src[si + 6]! << 8) | src[si + 7]!) >>> 0;
		let p = 0;
		for (let index = 0; index < ROUNDS / 2; index++) {
			left = (left ^ ptable[p++]!) >>> 0;
			right = (right ^ f(this.s, left) ^ ptable[p++]!) >>> 0;
			left = (left ^ f(this.s, right)) >>> 0;
		}
		left = (left ^ ptable[p++]!) >>> 0;
		right = (right ^ ptable[p]!) >>> 0;
		dst[di] = (right >>> 24) & 0xff;
		dst[di + 1] = (right >>> 16) & 0xff;
		dst[di + 2] = (right >>> 8) & 0xff;
		dst[di + 3] = right & 0xff;
		dst[di + 4] = (left >>> 24) & 0xff;
		dst[di + 5] = (left >>> 16) & 0xff;
		dst[di + 6] = (left >>> 8) & 0xff;
		dst[di + 7] = left & 0xff;
	}
}
