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

import { mix_file_crc } from "./crc";
import type { GameDirectory } from "./files";
import { blowfish_from_mix_key, encrypted_mix_key_length } from "./pk";

export type MixSubBlock = {
	crc: number;
	offset: number;
	size: number;
};

type MixSource = {
	read_slice(start: number, size: number): Promise<Uint8Array | null>;
};

export class MixFileClass {
	readonly filename: string;
	readonly is_digest: boolean;
	readonly is_encrypted: boolean;
	readonly count: number;
	readonly data_size: number;
	readonly data_start: number;
	readonly header: MixSubBlock[];
	private readonly source: MixSource;

	private constructor(
		source: MixSource,
		filename: string,
		is_digest: boolean,
		is_encrypted: boolean,
		count: number,
		data_size: number,
		data_start: number,
		header: MixSubBlock[],
	) {
		this.source = source;
		this.filename = filename;
		this.is_digest = is_digest;
		this.is_encrypted = is_encrypted;
		this.count = count;
		this.data_size = data_size;
		this.data_start = data_start;
		this.header = header;
	}

	static async open(directory: GameDirectory, filename: string): Promise<MixFileClass | null> {
		return MixFileClass.open_source(filename, {
			read_slice: (start, size) => directory.read_slice(filename, start, size),
		});
	}

	static async open_nested(parent: MixFileClass, filename: string): Promise<MixFileClass | null> {
		const block = parent.find(filename);
		if (!block) {
			return null;
		}
		const base = parent.data_start + block.offset;
		return MixFileClass.open_source(filename, {
			read_slice: (start, size) => parent.source.read_slice(base + start, size),
		});
	}

	private static async open_source(filename: string, source: MixSource): Promise<MixFileClass | null> {
		const probe = await source.read_slice(0, 16);
		if (!probe || probe.length < 6) {
			return null;
		}
		const view = new DataView(probe.buffer, probe.byteOffset, probe.byteLength);
		const first = view.getInt16(0, true);
		let is_digest = false;
		let is_encrypted = false;
		let header_start = 0;

		if (first === 0) {
			const flags = view.getInt16(2, true);
			is_digest = (flags & 0x01) !== 0;
			is_encrypted = (flags & 0x02) !== 0;
			header_start = 4;
		}

		if (is_encrypted) {
			return MixFileClass.open_encrypted(source, filename, is_digest, header_start);
		}

		return MixFileClass.parse_plain_header(source, filename, is_digest, false, header_start, probe);
	}

	private static async open_encrypted(
		source: MixSource,
		filename: string,
		is_digest: boolean,
		header_start: number,
	): Promise<MixFileClass | null> {
		const key_len = encrypted_mix_key_length();
		const key_cipher = await source.read_slice(header_start, key_len);
		if (!key_cipher || key_cipher.length < key_len) {
			return null;
		}
		const engine = blowfish_from_mix_key(key_cipher);
		if (!engine) {
			return null;
		}
		const body_start = header_start + key_len;
		const first = await source.read_slice(body_start, 8);
		if (!first || first.length < 8) {
			return null;
		}
		const first_plain = engine.decrypt(first);
		const count = new DataView(first_plain.buffer, first_plain.byteOffset, first_plain.byteLength).getInt16(0, true);
		if (count <= 0 || count > 100000) {
			return null;
		}
		const needed = 6 + count * 12;
		const cipher_len = Math.ceil(needed / 8) * 8;
		const body = await source.read_slice(body_start, cipher_len);
		if (!body || body.length < cipher_len) {
			return null;
		}
		const plain = engine.decrypt(body).subarray(0, needed);
		const parsed = parse_header_bytes(plain);
		if (!parsed) {
			return null;
		}
		return new MixFileClass(
			source,
			filename,
			is_digest,
			true,
			parsed.count,
			parsed.data_size,
			body_start + cipher_len,
			parsed.header,
		);
	}

	private static async parse_plain_header(
		source: MixSource,
		filename: string,
		is_digest: boolean,
		is_encrypted: boolean,
		header_start: number,
		probe: Uint8Array,
	): Promise<MixFileClass | null> {
		if (probe.length < header_start + 6) {
			return null;
		}
		const view = new DataView(probe.buffer, probe.byteOffset, probe.byteLength);
		const count = view.getInt16(header_start, true);
		const data_size = view.getInt32(header_start + 2, true);
		if (count <= 0 || count > 100000) {
			return null;
		}
		const index_start = header_start + 6;
		const index_bytes = count * 12;
		const index = await source.read_slice(index_start, index_bytes);
		if (!index || index.length < index_bytes) {
			return null;
		}
		const parsed = parse_header_bytes(concat_header(count, data_size, index));
		if (!parsed) {
			return null;
		}
		return new MixFileClass(
			source,
			filename,
			is_digest,
			is_encrypted,
			parsed.count,
			parsed.data_size,
			index_start + index_bytes,
			parsed.header,
		);
	}

	find(filename: string): MixSubBlock | null {
		const crc = mix_file_crc(filename);
		let lo = 0;
		let hi = this.header.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const block = this.header[mid]!;
			if (block.crc === crc) {
				return block;
			}
			if (block.crc < crc) {
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		return null;
	}

	async read(filename: string): Promise<Uint8Array | null> {
		const block = this.find(filename);
		if (!block) {
			return null;
		}
		return this.source.read_slice(this.data_start + block.offset, block.size);
	}
}

function concat_header(count: number, data_size: number, index: Uint8Array): Uint8Array {
	const bytes = new Uint8Array(6 + index.length);
	const view = new DataView(bytes.buffer);
	view.setInt16(0, count, true);
	view.setInt32(2, data_size, true);
	bytes.set(index, 6);
	return bytes;
}

function parse_header_bytes(plain: Uint8Array): { count: number; data_size: number; header: MixSubBlock[] } | null {
	if (plain.length < 6) {
		return null;
	}
	const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
	const count = view.getInt16(0, true);
	const data_size = view.getInt32(2, true);
	if (count <= 0 || count * 12 + 6 > plain.length) {
		return null;
	}
	const header: MixSubBlock[] = [];
	for (let i = 0; i < count; i++) {
		const at = 6 + i * 12;
		header.push({
			crc: view.getInt32(at, true),
			offset: view.getInt32(at + 4, true),
			size: view.getInt32(at + 8, true),
		});
	}
	return { count, data_size, header };
}

const registered: MixFileClass[] = [];

function side_archives(): string[] {
	const names: string[] = [];
	for (const side of ["01", "02"]) {
		names.push(`SIDEC${side}.MIX`, `SIDENC${side}.MIX`, `SIDECD${side}.MIX`);
		for (let addon = 1; addon <= 5; addon++) {
			const pack = String(addon).padStart(2, "0");
			names.push(`E${pack}SC${side}.MIX`, `E${pack}SNC${side}.MIX`, `E${pack}SCD${side}.MIX`);
		}
	}
	return names;
}

const NESTED_MIX = [
	"CACHE.MIX",
	"CONQUER.MIX",
	"LOCAL.MIX",
	"GMENU.MIX",
	"ISOTEMP.MIX",
	"ISOSNOW.MIX",
	"TEMPERAT.MIX",
	"SNOW.MIX",
	"TEM.MIX",
	"SNO.MIX",
	...side_archives(),
];

export async function register_mix(directory: GameDirectory, filename: string): Promise<MixFileClass | null> {
	const mix = await MixFileClass.open(directory, filename);
	if (mix && mix.count > 0) {
		registered.push(mix);
	}
	return mix;
}

export async function register_nested_mixes(): Promise<MixFileClass[]> {
	const opened: MixFileClass[] = [];
	for (const name of NESTED_MIX) {
		if (registered.some((mix) => basename(mix.filename) === name.toLowerCase())) {
			continue;
		}
		for (const parent of registered.slice()) {
			const nested = await MixFileClass.open_nested(parent, name);
			if (nested && nested.count > 0) {
				registered.push(nested);
				opened.push(nested);
				break;
			}
		}
	}
	return opened;
}

export function clear_mix_list(): void {
	registered.length = 0;
}

export function mix_available(filename: string): boolean {
	for (const mix of registered) {
		if (mix.count > 0 && mix.find(filename)) {
			return true;
		}
	}
	return false;
}

export function mix_named(filename: string): boolean {
	const want = filename.toLowerCase();
	return registered.some((mix) => basename(mix.filename) === want);
}

export async function mix_retrieve(filename: string): Promise<Uint8Array | null> {
	for (const mix of registered) {
		if (mix.count === 0) {
			continue;
		}
		const bytes = await mix.read(filename);
		if (bytes) {
			return bytes;
		}
	}
	return null;
}

function basename(path: string): string {
	const parts = path.split("/");
	return (parts[parts.length - 1] ?? path).toLowerCase();
}
