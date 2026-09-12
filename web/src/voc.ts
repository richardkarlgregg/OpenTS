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

import { ADDON_FIRESTORM, Addon_Installed } from "./addon";
import { Aud_Decode, type AudPcm } from "./aud";
import { AUDIO_GROUP_MOVIE, AUDIO_GROUP_SFX, AUDIO_GROUP_SYSTEM, Ensure_Audio, Play_Pcm, Set_Group_Gain, type AudioPlayHandle } from "./audio";
import { cc_available, cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import { INIClass } from "./ini";
import { Options } from "./options";
import { Theme } from "./theme";
import {
	Is_Speaking,
	Set_Speech_Directory,
	Set_Speech_Volume,
	Speak,
	Stop_Speaking,
	VOX_GDI_TAUNT_01,
	VOX_NOD_TAUNT_10,
} from "./vox";

export const VOC_NONE = -1;
export const VOC_FIRST = 0;
export const AUDIO_MAX_SOUNDS = 32;
export const SOUND_CONTROL_LOOP = 0x0001;
export const SOUND_CONTROL_RANDOM = 0x0002;
export const SOUND_CONTROL_SEQUENTIAL = 0x0100;
export const SOUND_TYPE_GLOBAL = 0x0010;
export const SOUND_TYPE_SCREEN = 0x0020;
export const SOUND_TYPE_LOCAL = 0x0040;
export const SOUND_TYPE_SHROUD = 0x0800;
export const SOUND_TYPE_HIDDEN = 0x2000;
export const SOUND_PAN_CENTER = 0;

export type AudioEventTypeClass = {
	Name: string;
	Sounds: string[];
	SoundCount: number;
	Volume: number;
	MinVolume: number;
	Range: number;
	Type: number;
	Control: number;
	Limit: number;
	Loop: number;
	LiveCount: number;
	SequentialIndex: number;
};

export class VocClass {
	Name = "";
	Type: AudioEventTypeClass;

	constructor(filename: string) {
		this.Name = filename;
		this.Type = default_type(filename);
		Vocs.push(this);
	}

	Fill_In(ini: INIClass): boolean {
		return Read_Type(ini, this.Name, Defaults, this.Type);
	}

	Can_Play(): boolean {
		return this.Type.SoundCount > 0;
	}

	static From_Name(name: string | null | undefined): number {
		if (!name) {
			return VOC_NONE;
		}
		const want = name.toLowerCase();
		if (want === "<none>" || want === "none") {
			return VOC_NONE;
		}
		for (let voc = VOC_FIRST; voc < Vocs.length; voc++) {
			if (Vocs[voc]!.Name.toLowerCase() === want) {
				return voc;
			}
		}
		return VOC_NONE;
	}

	Voc_Type(): number {
		for (let index = 0; index < Vocs.length; index++) {
			if (Vocs[index] === this) {
				return index;
			}
		}
		return VOC_NONE;
	}
}

export const Vocs: VocClass[] = [];
export const Defaults: AudioEventTypeClass = default_type("Defaults");
export const Rule = {
	GenericClick: VOC_NONE,
	GenericBeep: VOC_NONE,
};

let audio_directory: GameDirectory | null = null;
let GameActive = false;
const sample_cache = new Map<string, AudPcm | null>();

const CONTROL_NAMES: Record<string, number> = {
	NORMAL: 0,
	LOOP: SOUND_CONTROL_LOOP,
	RANDOM: SOUND_CONTROL_RANDOM,
	ALL: 0x0004,
	PREDELAY: 0x0008,
	INTERRUPT: 0x0010,
	ATTACK: 0x0020,
	DECAY: 0x0040,
	AMBIENT: 0x0080,
	SEQUENTIAL: SOUND_CONTROL_SEQUENTIAL,
	QUEUE: 0x0200,
};

const TYPE_NAMES: Record<string, number> = {
	NORMAL: 0,
	VIOLENT: 0x0001,
	MOVEMENT: 0x0002,
	QUIET: 0x0004,
	LOUD: 0x0008,
	GLOBAL: SOUND_TYPE_GLOBAL,
	SCREEN: SOUND_TYPE_SCREEN,
	LOCAL: SOUND_TYPE_LOCAL,
	PLAYER: 0x0080,
	NOISE_SHY: 0x0100,
	NOISESHY: 0x0100,
	GUN_SHY: 0x0200,
	GUNSHY: 0x0200,
	UNSHROUD: 0x0400,
	SHROUD: SOUND_TYPE_SHROUD,
	UNSHROUDED: SOUND_TYPE_SHROUD,
	SHROUDED: SOUND_TYPE_HIDDEN,
	AMBIENT: 0x1000,
};

function default_type(name: string): AudioEventTypeClass {
	return {
		Name: name,
		Sounds: [name],
		SoundCount: 1,
		Volume: 1,
		MinVolume: 0,
		Range: 28,
		Type: SOUND_TYPE_SCREEN,
		Control: 0,
		Limit: 3,
		Loop: 0,
		LiveCount: 0,
		SequentialIndex: 0,
	};
}

function tokenize(text: string): string[] {
	return text.split(/[ ,\t]+/).map((part) => part.trim()).filter((part) => part.length > 0);
}

function parse_volume(text: string, fallback: number): number {
	const token = tokenize(text)[0];
	if (!token) {
		return fallback;
	}
	let value = Number.parseFloat(token);
	if (!Number.isFinite(value)) {
		return fallback;
	}
	if (value > 1) {
		value /= 100;
	}
	return Math.min(1, Math.max(0, value));
}

function parse_flags(text: string, names: Record<string, number>, fallback: number): number {
	const tokens = tokenize(text);
	if (tokens.length === 0) {
		return fallback;
	}
	let flags = 0;
	for (const token of tokens) {
		flags |= names[token.toUpperCase()] ?? 0;
	}
	return flags;
}

function parse_control(text: string, fallback: number): number {
	return parse_flags(text, CONTROL_NAMES, fallback);
}

function parse_type(text: string, fallback: number): number {
	return parse_flags(text, TYPE_NAMES, fallback);
}

function Read_Sounds(ini: INIClass, section: string, type: AudioEventTypeClass): void {
	const sounds = ini.get_string(section, "Sounds", "");
	const tokens = tokenize(sounds);
	if (tokens.length === 0) {
		return;
	}
	type.Sounds = tokens.slice(0, AUDIO_MAX_SOUNDS);
	type.SoundCount = type.Sounds.length;
}

function Read_Type(ini: INIClass, section: string, defaults: AudioEventTypeClass, type: AudioEventTypeClass): boolean {
	type.Name = section;
	type.Sounds = [section];
	type.SoundCount = 1;
	type.Volume = defaults.Volume;
	type.MinVolume = defaults.MinVolume;
	type.Range = defaults.Range;
	type.Type = defaults.Type;
	type.Control = defaults.Control;
	type.Limit = defaults.Limit;
	type.Loop = defaults.Loop;
	type.LiveCount = 0;
	type.SequentialIndex = 0;
	if (!ini.is_present(section)) {
		return false;
	}
	Read_Sounds(ini, section, type);
	const volume = ini.get_string(section, "Volume", "");
	if (volume) {
		type.Volume = parse_volume(volume, type.Volume);
	}
	const minvolume = ini.get_string(section, "MinVolume", "");
	if (minvolume) {
		type.MinVolume = parse_volume(minvolume, type.MinVolume);
	}
	type.Range = Math.max(0, Math.min(1000, ini.get_int(section, "Range", type.Range)));
	const control = ini.get_string(section, "Control", "");
	if (control) {
		type.Control = parse_control(control, type.Control);
	}
	const typeflags = ini.get_string(section, "Type", "");
	if (typeflags) {
		type.Type = parse_type(typeflags, type.Type);
	}
	const loop = ini.get_int(section, "Loop", -1);
	if (loop >= 0) {
		type.Loop = loop;
	} else {
		const limit = ini.get_int(section, "LoopLimit", -1);
		if (limit >= 0) {
			type.Loop = limit;
		}
	}
	const cap = ini.get_int(section, "Limit", type.Limit);
	type.Limit = Math.max(0, Math.min(128, cap));
	return true;
}

function Read_Defaults(ini: INIClass): void {
	Object.assign(Defaults, default_type("Defaults"));
	if (ini.is_present("Defaults")) {
		Read_Type(ini, "Defaults", Defaults, Defaults);
	}
}

export function Init_Vocs(ini: INIClass): void {
	Read_Defaults(ini);
	if (!ini.is_present("SoundList")) {
		return;
	}
	const count = ini.entry_count("SoundList");
	for (let i = 0; i < count; i++) {
		const name = ini.get_string("SoundList", ini.get_entry("SoundList", i), "");
		if (!name) {
			continue;
		}
		let voc = VocClass.From_Name(name);
		let sound: VocClass;
		if (voc === VOC_NONE) {
			sound = new VocClass(name);
		} else {
			sound = Vocs[voc]!;
		}
		sound.Fill_In(ini);
	}
}

export function Free_Vocs(): void {
	Vocs.length = 0;
	sample_cache.clear();
	Rule.GenericClick = VOC_NONE;
	Rule.GenericBeep = VOC_NONE;
}

export function VocClass_From_Name(name: string | null | undefined): VocClass | null {
	const voc = VocClass.From_Name(name);
	if (voc === VOC_NONE) {
		return null;
	}
	return Vocs[voc] ?? null;
}

function pick_sound(type: AudioEventTypeClass): string | null {
	if (type.SoundCount <= 0) {
		return null;
	}
	if ((type.Control & SOUND_CONTROL_RANDOM) !== 0) {
		return type.Sounds[Math.floor(Math.random() * type.SoundCount)] ?? type.Sounds[0] ?? null;
	}
	if ((type.Control & SOUND_CONTROL_SEQUENTIAL) !== 0) {
		const name = type.Sounds[type.SequentialIndex % type.SoundCount] ?? type.Sounds[0] ?? null;
		type.SequentialIndex++;
		return name;
	}
	return type.Sounds[0] ?? null;
}

async function load_sample(name: string): Promise<AudPcm | null> {
	const key = name.toUpperCase();
	if (sample_cache.has(key)) {
		return sample_cache.get(key) ?? null;
	}
	if (!audio_directory) {
		sample_cache.set(key, null);
		return null;
	}
	const packed = await cc_retrieve(audio_directory, `${name}.AUD`);
	const decoded = packed ? Aud_Decode(packed) : null;
	sample_cache.set(key, decoded);
	return decoded;
}

async function play_event(type: AudioEventTypeClass, group: number, volume: number, pan: number): Promise<AudioPlayHandle | null> {
	if (type.Limit > 0 && type.LiveCount >= type.Limit) {
		return null;
	}
	const sample_name = pick_sound(type);
	if (!sample_name) {
		return null;
	}
	await Ensure_Audio();
	const pcm = await load_sample(sample_name);
	if (!pcm) {
		return null;
	}
	const loop = (type.Control & SOUND_CONTROL_LOOP) !== 0 && type.Loop === 0;
	type.LiveCount++;
	const handle = Play_Pcm(pcm.samples, pcm.rate, pcm.channels, group, type.Volume * volume, pan / 100, loop, () => {
		type.LiveCount = Math.max(0, type.LiveCount - 1);
	});
	if (!handle) {
		type.LiveCount = Math.max(0, type.LiveCount - 1);
	}
	return handle;
}

export function Sound_Effect(voc: number, volume = 1, pan = SOUND_PAN_CENTER): void {
	if (voc === VOC_NONE || voc >= Vocs.length || Options.SoundVolume <= 0 || volume <= 0) {
		return;
	}
	const sound = Vocs[voc]!;
	if (!sound.Can_Play()) {
		return;
	}
	void play_event(sound.Type, AUDIO_GROUP_SFX, Math.min(1, volume), pan);
}

const PIXELS_PER_CELL = 48;
const SILENT_LEVEL = 0.05;

export type SoundView = {
	origin: { x: number; y: number };
	width: number;
	height: number;
	coord_to_pixel: (lx: number, ly: number, z: number) => { x: number; y: number };
};

let sound_view: SoundView | null = null;

export function Set_Sound_View(view: SoundView | null): void {
	sound_view = view;
}

export function Calculate_Volume_And_Pan(
	lx: number,
	ly: number,
	z: number,
	type: AudioEventTypeClass,
): { volume: number; pan: number } {
	let pan = SOUND_PAN_CENTER;
	if (!sound_view) {
		return { volume: 1, pan };
	}
	const pixel = sound_view.coord_to_pixel(lx, ly, z);
	const width = sound_view.width;
	const height = sound_view.height;
	if (width <= 0 || height <= 0) {
		return { volume: 1, pan };
	}
	let dx: number;
	let dy: number;
	if ((type.Type & SOUND_TYPE_LOCAL) !== 0) {
		dx = Math.abs(pixel.x - width / 2);
		dy = Math.abs(pixel.y - height / 2);
	} else {
		dx = Math.max(-pixel.x, pixel.x - width, 0);
		dy = Math.max(-pixel.y, pixel.y - height, 0);
	}
	dy *= 2;
	const range = Math.max(type.Range, 1) * PIXELS_PER_CELL;
	let volume = 1 - Math.max(dx, dy) / range;
	if ((type.Type & SOUND_TYPE_GLOBAL) !== 0) {
		volume = Math.max(volume, type.MinVolume);
	}
	if (volume < SILENT_LEVEL) {
		return { volume: 0, pan };
	}
	const half = width / 2;
	pan = Math.max(-100, Math.min(100, Math.trunc(((pixel.x - half) * 100) / half)));
	return { volume: Math.min(volume, 1), pan };
}

export function Sound_Effect_At(voc: number, lx: number, ly: number, z = 0): void {
	if (voc === VOC_NONE || voc >= Vocs.length) {
		return;
	}
	const sound = Vocs[voc]!;
	const placed = Calculate_Volume_And_Pan(lx, ly, z, sound.Type);
	if (placed.volume <= 0) {
		return;
	}
	Sound_Effect(voc, placed.volume, placed.pan);
}

export function Set_Sound_Volume(volume: number, feedback = false): void {
	Options.SoundVolume = Math.min(1, Math.max(0, volume));
	Set_Group_Gain(AUDIO_GROUP_SFX, Options.SoundVolume);
	Set_Group_Gain(AUDIO_GROUP_MOVIE, Options.SoundVolume);
	if (feedback) {
		Sound_Effect(Rule.GenericBeep);
	}
}

export function Set_Score_Volume(volume: number, feedback = false): void {
	Options.ScoreVolume = Math.min(1, Math.max(0, volume));
	Theme.Set_Volume(Options.ScoreVolume * 255);
	if (feedback && !Theme.Still_Playing()) {
		Sound_Effect(Rule.GenericBeep, Options.ScoreVolume);
	}
}

export function Set_Game_Active(active: boolean): void {
	GameActive = active;
}

export function Set_Voice_Volume(volume: number, feedback = false): void {
	Options.VoiceVolume = Math.min(1, Math.max(0, volume));
	Set_Speech_Volume(Options.VoiceVolume * 255);
	if (feedback) {
		if (GameActive) {
			if (!Is_Speaking()) {
				const span = VOX_NOD_TAUNT_10 - VOX_GDI_TAUNT_01 + 1;
				Speak(VOX_GDI_TAUNT_01 + Math.floor(Math.random() * span), true);
			}
		} else {
			Voice_Sound_Effect(Rule.GenericBeep, Options.VoiceVolume);
		}
	}
}

export function Voice_Sound_Effect(voc: number, volume = 1): void {
	if (voc === VOC_NONE || voc >= Vocs.length || volume <= 0) {
		return;
	}
	const sound = Vocs[voc]!;
	if (!sound.Can_Play()) {
		return;
	}
	void play_event(sound.Type, AUDIO_GROUP_SYSTEM, Math.min(1, volume), SOUND_PAN_CENTER);
}

export function Menu_Click_Sound(): void {
	Sound_Effect(Rule.GenericClick);
}

function Read_AudioVisual(ini: INIClass): void {
	Rule.GenericClick = VocClass.From_Name(ini.get_string("AudioVisual", "GenericClick", ""));
	Rule.GenericBeep = VocClass.From_Name(ini.get_string("AudioVisual", "GenericBeep", ""));
}

async function load_ini_and_expansion(directory: GameDirectory, basename: string, expansion: string): Promise<INIClass | null> {
	const first = await cc_retrieve(directory, basename);
	const second = expansion ? await cc_retrieve(directory, expansion) : null;
	if (!first && !second) {
		return null;
	}
	const ini = new INIClass();
	if (first) {
		ini.load(first);
	}
	if (second) {
		ini.load(second, true);
	}
	return ini;
}

export async function Init_Game_Audio(directory: GameDirectory): Promise<{ vocs: number; themes: number; eva: boolean }> {
	audio_directory = directory;
	Free_Vocs();
	Theme.Free_Themes();
	Stop_Speaking();
	Set_Speech_Directory(directory);
	await Ensure_Audio();
	Set_Group_Gain(AUDIO_GROUP_SFX, Options.SoundVolume);
	Set_Group_Gain(AUDIO_GROUP_MOVIE, Options.SoundVolume);
	Set_Group_Gain(AUDIO_GROUP_SYSTEM, 1);
	Theme.Set_Volume(Options.ScoreVolume * 255);
	Set_Speech_Volume(Options.VoiceVolume * 255);
	const sound = await load_ini_and_expansion(directory, "SOUND.INI", "SOUND01.INI");
	if (sound) {
		Init_Vocs(sound);
	}
	const theme_ini = await load_ini_and_expansion(directory, "THEME.INI", "THEME01.INI");
	if (theme_ini) {
		Theme.Init_Themes(theme_ini);
	}
	const rules = await load_ini_and_expansion(
		directory,
		"RULES.INI",
		Addon_Installed(ADDON_FIRESTORM) ? "FIRESTRM.INI" : "",
	);
	if (rules) {
		Read_AudioVisual(rules);
	}
	Theme.Scan(directory);
	return {
		vocs: Vocs.length,
		themes: Theme.Max_Themes(),
		eva: cc_available(directory, "00-I026.AUD"),
	};
}
