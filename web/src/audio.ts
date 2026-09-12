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

export const AUDIO_GROUP_SFX = 0;
export const AUDIO_GROUP_SPEECH = 1;
export const AUDIO_GROUP_MUSIC = 2;
export const AUDIO_GROUP_MOVIE = 3;
export const AUDIO_GROUP_SYSTEM = 4;
export const AUDIO_GROUP_COUNT = 5;

export type AudioPlayHandle = {
	group: number;
	finished: boolean;
	base_volume: number;
	source: AudioBufferSourceNode;
	gain: GainNode;
	onended?: () => void;
};

let context: AudioContext | null = null;
const group_gain = [1, 1, 1, 1, 1];
const live: AudioPlayHandle[] = [];

export async function Ensure_Audio(): Promise<AudioContext | null> {
	if (typeof AudioContext === "undefined") {
		return null;
	}
	if (!context) {
		context = new AudioContext();
	}
	if (context.state === "suspended") {
		await context.resume();
	}
	return context;
}

export function Audio_Context(): AudioContext | null {
	return context;
}

export function Set_Group_Gain(group: number, gain: number): void {
	const value = Math.min(1, Math.max(0, gain));
	group_gain[group] = value;
	for (const handle of live) {
		if (handle.group === group && !handle.finished) {
			handle.gain.gain.value = handle.base_volume * value;
		}
	}
}

export function Group_Gain(group: number): number {
	return group_gain[group] ?? 1;
}

function pcm_buffer(ctx: AudioContext, samples: Int16Array, rate: number, channels: number): AudioBuffer {
	const count = Math.max(1, channels);
	const frames = Math.max(1, Math.floor(samples.length / count));
	const buffer = ctx.createBuffer(count, frames, rate);
	for (let ch = 0; ch < count; ch++) {
		const data = buffer.getChannelData(ch);
		if (count === 1) {
			for (let i = 0; i < frames; i++) {
				data[i] = (samples[i] ?? 0) / 32768;
			}
		} else {
			for (let i = 0; i < frames; i++) {
				data[i] = (samples[i * count + ch] ?? 0) / 32768;
			}
		}
	}
	return buffer;
}

function drop_finished(): void {
	for (let i = live.length - 1; i >= 0; i--) {
		if (live[i]?.finished) {
			live.splice(i, 1);
		}
	}
}

export function Play_Pcm(
	samples: Int16Array,
	rate: number,
	channels: number,
	group: number,
	volume = 1,
	pan = 0,
	loop = false,
	onended?: () => void,
): AudioPlayHandle | null {
	if (!context || samples.length === 0 || volume <= 0 || Group_Gain(group) <= 0) {
		return null;
	}
	drop_finished();
	const source = context.createBufferSource();
	source.buffer = pcm_buffer(context, samples, rate, channels);
	source.loop = loop;
	const base_volume = Math.min(1, Math.max(0, volume));
	const gain = context.createGain();
	gain.gain.value = base_volume * Group_Gain(group);
	const panner = context.createStereoPanner();
	panner.pan.value = Math.min(1, Math.max(-1, pan));
	source.connect(gain);
	gain.connect(panner);
	panner.connect(context.destination);
	const handle: AudioPlayHandle = { group, finished: false, base_volume, source, gain, onended };
	source.onended = (): void => {
		handle.finished = true;
		handle.onended?.();
	};
	source.start();
	live.push(handle);
	return handle;
}

export function Stop_Handle(handle: AudioPlayHandle | null): void {
	if (!handle || handle.finished) {
		return;
	}
	handle.onended = undefined;
	handle.finished = true;
	try {
		handle.source.stop();
	} catch {
		return;
	}
}

export function Stop_Group(group: number): void {
	for (const handle of live) {
		if (handle.group === group) {
			Stop_Handle(handle);
		}
	}
	drop_finished();
}

export function Handle_Finished(handle: AudioPlayHandle | null): boolean {
	return !handle || handle.finished;
}
