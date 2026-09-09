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

import { BlowfishEngine } from "./blowfish";

const PUBLIC_KEY_B64 = "AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V";
const FAST_EXPONENT = 65537n;
const BLOWFISH_KEY_SIZE = BlowfishEngine.MAX_KEY_LENGTH;

function decode_base64(text: string): Uint8Array {
	const bin = atob(text);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		out[i] = bin.charCodeAt(i);
	}
	return out;
}

function der_integer(bytes: Uint8Array): bigint {
	if (bytes[0] !== 0x02) {
		throw new Error("Public key is not a DER integer.");
	}
	let i = 1;
	let length = bytes[i++]!;
	if ((length & 0x80) !== 0) {
		const count = length & 0x7f;
		length = 0;
		for (let n = 0; n < count; n++) {
			length = (length << 8) | bytes[i++]!;
		}
	}
	const value = bytes.subarray(i, i + length);
	let n = 0n;
	for (const byte of value) {
		n = (n << 8n) + BigInt(byte);
	}
	return n;
}

function bit_count(n: bigint): number {
	return n === 0n ? 0 : n.toString(2).length;
}

function le_bytes_to_bigint(bytes: Uint8Array): bigint {
	let n = 0n;
	for (let i = bytes.length - 1; i >= 0; i--) {
		n = (n << 8n) + BigInt(bytes[i]!);
	}
	return n;
}

function bigint_to_le_bytes(n: bigint, length: number): Uint8Array {
	const out = new Uint8Array(length);
	let v = n;
	for (let i = 0; i < length; i++) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}
	return out;
}

function mod_pow(base: bigint, exp: bigint, mod: bigint): bigint {
	let result = 1n;
	let b = ((base % mod) + mod) % mod;
	let e = exp;
	while (e > 0n) {
		if (e & 1n) {
			result = (result * b) % mod;
		}
		b = (b * b) % mod;
		e >>= 1n;
	}
	return result;
}

const modulus = der_integer(decode_base64(PUBLIC_KEY_B64));
const bit_precision = bit_count(modulus) - 1;
const plain_block_size = ((bit_precision - 1) / 8) | 0;
const crypt_block_size = plain_block_size + 1;
const encrypted_key_length = ((((BLOWFISH_KEY_SIZE - 1) / plain_block_size) | 0) + 1) * crypt_block_size;

function decrypt_pk(source: Uint8Array): Uint8Array {
	const dest = new Uint8Array(plain_block_size * ((source.length / crypt_block_size) | 0));
	let si = 0;
	let di = 0;
	while (si + crypt_block_size <= source.length) {
		const block = source.subarray(si, si + crypt_block_size);
		const plain = bigint_to_le_bytes(
			mod_pow(le_bytes_to_bigint(block), FAST_EXPONENT, modulus),
			plain_block_size,
		);
		dest.set(plain, di);
		si += crypt_block_size;
		di += plain_block_size;
	}
	return dest;
}

export function encrypted_mix_key_length(): number {
	return encrypted_key_length;
}

export function blowfish_from_mix_key(key_cipher: Uint8Array): BlowfishEngine | null {
	if (key_cipher.length < encrypted_key_length) {
		return null;
	}
	const plain = decrypt_pk(key_cipher.subarray(0, encrypted_key_length));
	if (plain.length < BLOWFISH_KEY_SIZE) {
		return null;
	}
	const engine = new BlowfishEngine();
	engine.submit_key(plain.subarray(0, BLOWFISH_KEY_SIZE));
	return engine;
}
