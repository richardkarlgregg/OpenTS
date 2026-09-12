/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 ******************************************************************************/

export const AUD_FLAG_STEREO = 1;
export const AUD_FLAG_16BIT = 2;
export const AUD_CODEC_PCM = 0;
export const AUD_CODEC_WESTWOOD = 1;
export const AUD_CODEC_SOS = 99;
export const AUD_CHUNK_MAGIC = 0x0000deaf;
export const AUD_HEADER_SIZE = 12;
export const AUD_CHUNK_HEADER_SIZE = 8;

export type AudioPcmFormat = {
	rate: number;
	channels: number;
};

export type AudPcm = {
	samples: Int16Array;
	rate: number;
	channels: number;
};

type AudHeader = {
	rate: number;
	size: number;
	uncomp_size: number;
	flags: number;
	compression: number;
};

type SosState = { predicted: number; index: number; predicted2: number; index2: number };

const SOS_STEP = [
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
	118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
	1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
	6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
	32767,
];
const SOS_INDEX_ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const DECODE_2BIT = [-2, -1, 0, 1];
const DECODE_4BIT = [-9, -8, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8];

function le16(bytes: Uint8Array, at: number): number {
	return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function le32(bytes: Uint8Array, at: number): number {
	return ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24)) | 0;
}

function aud_channels(header: AudHeader): number {
	return (header.flags & AUD_FLAG_STEREO) !== 0 ? 2 : 1;
}

function aud_bits(header: AudHeader): number {
	return (header.flags & AUD_FLAG_16BIT) !== 0 ? 16 : 8;
}

function aud_playback_rate(header: AudHeader): number {
	if (header.rate < 24000 && header.rate > 20000) {
		return 22050;
	}
	return header.rate;
}

function read_header(data: Uint8Array): AudHeader | null {
	if (data.length < AUD_HEADER_SIZE) {
		return null;
	}
	const header: AudHeader = {
		rate: le16(data, 0),
		size: le32(data, 2),
		uncomp_size: le32(data, 6),
		flags: data[10] ?? 0,
		compression: data[11] ?? 0,
	};
	if (header.rate === 0 || header.size <= 0) {
		return null;
	}
	if ((header.flags & ~(AUD_FLAG_STEREO | AUD_FLAG_16BIT)) !== 0) {
		return null;
	}
	if (header.compression !== AUD_CODEC_PCM && header.compression !== AUD_CODEC_WESTWOOD && header.compression !== AUD_CODEC_SOS) {
		return null;
	}
	if (header.compression === AUD_CODEC_WESTWOOD && (header.flags & AUD_FLAG_16BIT) !== 0) {
		return null;
	}
	return header;
}

function clamp8(value: number): number {
	if (value < 0) {
		return 0;
	}
	if (value > 255) {
		return 255;
	}
	return value;
}

function clamp16(sample: number): number {
	if (sample > 32767) {
		return 32767;
	}
	if (sample < -32768) {
		return -32768;
	}
	return sample;
}

function convert_native(native: Uint8Array, bits: number, channels: number): Int16Array {
	const frame_bytes = channels * (bits / 8);
	const frames = Math.floor(native.length / frame_bytes);
	const samples = frames * channels;
	if (bits === 16) {
		const out = new Int16Array(samples);
		for (let i = 0; i < samples; i++) {
			const v = native[i * 2]! | (native[i * 2 + 1]! << 8);
			out[i] = v > 32767 ? v - 65536 : v;
		}
		return out;
	}
	const out = new Int16Array(samples);
	for (let i = 0; i < samples; i++) {
		out[i] = ((native[i] ?? 0) - 128) << 8;
	}
	return out;
}

function decode_westwood(source: Uint8Array, uncomp_size: number): Uint8Array | null {
	const dest = new Uint8Array(uncomp_size);
	let previous = 0x80;
	let incount = 0;
	let written = 0;
	while (written < uncomp_size) {
		if (incount >= source.length) {
			return null;
		}
		const code = source[incount++]!;
		let counter = (code & 0x3f) + 1;
		switch ((code >> 6) & 0x03) {
			case 2:
				if ((counter - 1) & 0x20) {
					counter = (counter - 1) & 0x1f;
					if (counter & 0x10) {
						counter |= 0xffffffe0;
					}
					previous = dest[written++] = clamp8(previous + counter);
				} else {
					if (incount + counter > source.length || counter > uncomp_size - written) {
						return null;
					}
					dest.set(source.subarray(incount, incount + counter), written);
					incount += counter;
					written += counter;
					previous = dest[written - 1]!;
				}
				break;
			case 1:
				if (incount + counter > source.length || counter * 2 > uncomp_size - written) {
					return null;
				}
				while (counter) {
					const delta = source[incount++]!;
					previous = dest[written++] = clamp8(previous + (DECODE_4BIT[delta & 0x0f] ?? 0));
					previous = dest[written++] = clamp8(previous + (DECODE_4BIT[(delta >> 4) & 0x0f] ?? 0));
					counter--;
				}
				break;
			case 0:
				if (incount + counter > source.length || counter * 4 > uncomp_size - written) {
					return null;
				}
				while (counter) {
					const delta = source[incount++]!;
					previous = dest[written++] = clamp8(previous + (DECODE_2BIT[delta & 0x03] ?? 0));
					previous = dest[written++] = clamp8(previous + (DECODE_2BIT[(delta >> 2) & 0x03] ?? 0));
					previous = dest[written++] = clamp8(previous + (DECODE_2BIT[(delta >> 4) & 0x03] ?? 0));
					previous = dest[written++] = clamp8(previous + (DECODE_2BIT[(delta >> 6) & 0x03] ?? 0));
					counter--;
				}
				break;
			default:
				if (counter > uncomp_size - written) {
					return null;
				}
				dest.fill(previous, written, written + counter);
				written += counter;
				break;
		}
	}
	return dest;
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

function decode_sos(payload: Uint8Array, bits: number, channels: number, uncomp_size: number, state: SosState): Int16Array {
	if (bits !== 16) {
		return convert_native(payload.subarray(0, uncomp_size), bits, channels);
	}
	const samples = Math.floor(uncomp_size / 2);
	const dest = new Int16Array(samples);
	if (channels === 2) {
		const per = Math.floor(samples / 2);
		const left = ima_channel(payload, 0, dest, 0, per, 2, state.predicted, state.index);
		const right = ima_channel(payload, Math.floor(uncomp_size / 4), dest, 1, per, 2, state.predicted2, state.index2);
		state.predicted = left.predicted;
		state.index = left.index;
		state.predicted2 = right.predicted;
		state.index2 = right.index;
	} else {
		const next = ima_channel(payload, 0, dest, 0, samples, 1, state.predicted, state.index);
		state.predicted = next.predicted;
		state.index = next.index;
	}
	return dest;
}

export function Aud_Decode(data: Uint8Array): AudPcm | null {
	const header = read_header(data);
	if (!header) {
		return null;
	}
	const channels = aud_channels(header);
	const bits = aud_bits(header);
	const rate = aud_playback_rate(header);
	const chunks: Int16Array[] = [];
	let total = 0;
	let cursor = AUD_HEADER_SIZE;
	let remaining = Math.min(header.size, Math.max(0, data.length - AUD_HEADER_SIZE));
	const sos: SosState = { predicted: 0, index: 0, predicted2: 0, index2: 0 };

	if (header.compression === AUD_CODEC_PCM) {
		const pcm = convert_native(data.subarray(cursor, cursor + remaining), bits, channels);
		return { samples: pcm, rate, channels };
	}

	while (remaining >= AUD_CHUNK_HEADER_SIZE) {
		const comp_size = le16(data, cursor);
		const uncomp_size = le16(data, cursor + 2);
		const magic = (le32(data, cursor + 4) >>> 0);
		cursor += AUD_CHUNK_HEADER_SIZE;
		remaining -= AUD_CHUNK_HEADER_SIZE;
		if (magic !== AUD_CHUNK_MAGIC || comp_size > remaining || uncomp_size === 0) {
			break;
		}
		const payload = data.subarray(cursor, cursor + comp_size);
		cursor += comp_size;
		remaining -= comp_size;
		let pcm: Int16Array;
		if (comp_size === uncomp_size) {
			pcm = convert_native(payload, bits, channels);
		} else if (header.compression === AUD_CODEC_WESTWOOD) {
			const native = decode_westwood(payload, uncomp_size);
			if (!native) {
				break;
			}
			pcm = convert_native(native, bits, channels);
		} else {
			pcm = decode_sos(payload, bits, channels, uncomp_size, sos);
		}
		if (pcm.length === 0) {
			break;
		}
		chunks.push(pcm);
		total += pcm.length;
	}
	if (total === 0) {
		return null;
	}
	const samples = new Int16Array(total);
	let o = 0;
	for (const chunk of chunks) {
		samples.set(chunk, o);
		o += chunk.length;
	}
	return { samples, rate, channels };
}
