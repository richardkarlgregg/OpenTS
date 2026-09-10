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

import { cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import { INIClass } from "./ini";
import { ISO_TILE_PIXEL_H, ISO_TILE_PIXEL_W, LEVEL_PIXEL_H } from "./isotile";
import { lcw_straw_decompress } from "./lcw";
import {
	building_light_coord,
	NORMAL_LIGHT,
	read_scenario_lighting,
	type MapLightSource,
	type ScenarioLighting,
} from "./light";
import { Options } from "./options";
import { read_palette, read_shp, type ShapeSet } from "./shp";
import type { SightLooker } from "./shroud";
import { TICKS_PER_MINUTE } from "./stimer";
import { build_hicolor_pixel } from "./surface";
import { theater_from_name, type TheaterSeed } from "./theater";
import { read_vxl, type VoxelModel } from "./voxlib";

const MAP_CELL_W = 512;
const MAP_CELL_H = 512;
const OVERLAY_NONE = 0xff;
const OVERLAYDATA_WALL_FRAME_MASK = 0x0f;
const OVERLAYDATA_BRIDGE_NS_FULL1 = 9;
const OVERLAYDATA_BRIDGE_NS_END2 = 17;
const CELL_LEPTON = 256;
const HUMAN_SHAPE = [7, 7, 6, 6, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 7, 7];
const STOPPING_COORD = [
	{ x: CELL_LEPTON / 2, y: CELL_LEPTON / 2 },
	{ x: CELL_LEPTON / 4, y: CELL_LEPTON / 4 },
	{ x: (3 * CELL_LEPTON) / 4, y: CELL_LEPTON / 4 },
	{ x: CELL_LEPTON / 4, y: (3 * CELL_LEPTON) / 4 },
	{ x: (3 * CELL_LEPTON) / 4, y: (3 * CELL_LEPTON) / 4 },
];

export type SpriteAnim = {
	start: number;
	stages: number;
	loop_start: number;
	loop_end: number;
	loops: number;
	rate: number;
	timer: number;
	stage: number;
	step: number;
	delay: number;
	pingpong: boolean;
	reverse: boolean;
	brand_new: boolean;
	dead: boolean;
};

export type SpriteSelect =
	| { kind: "box"; pre: boolean; lx: number; ly: number; lz: number }
	| { kind: "shape"; frame: number };

export type MapSprite = {
	x: number;
	y: number;
	ox: number;
	oy: number;
	frame: number;
	names: string[];
	file: string;
	palette: "theater" | "unit";
	scheme: string;
	layer: number;
	wall: string;
	bright: "tile" | "object" | "day";
	extra_light: number;
	voxel: string;
	dir: number;
	cast_shadow: boolean;
	anim: SpriteAnim | null;
	selectable: boolean;
	blip: number;
	select: SpriteSelect | null;
	occupy: { x: number; y: number }[];
	corner: boolean;
	rtti: "" | "building" | "infantry" | "unit" | "aircraft";
	health_ratio: number;
	veteran: boolean;
	bridge: boolean;
};

export type MapArtwork = {
	sprites: MapSprite[];
	shapes: Map<string, ShapeSet>;
	theater_palette: Uint16Array;
	unit_palette: Uint16Array;
	schemes: Map<string, Uint16Array>;
	lighting: ScenarioLighting;
	lights: MapLightSource[];
	credits: number;
	voxels: Map<string, VoxelModel>;
	lookers: SightLooker[];
	shroud: ShapeSet | null;
	select: ShapeSet | null;
	pips: ShapeSet | null;
	condition_yellow: number;
	condition_red: number;
	power_output: number;
	power_drain: number;
	has_radar: boolean;
	free_radar: boolean;
};

type OverlayType = {
	name: string;
	graphic: string;
	theater: boolean;
	new_theater: boolean;
	wall: boolean;
	tiberium: boolean;
	crate: boolean;
	bridge: boolean;
};

type AnimOffset = {
	stem: string;
	x: number;
	y: number;
};

type ShapeType = {
	name: string;
	graphic: string;
	voxel_stem: string;
	theater: boolean;
	new_theater: boolean;
	terrain_palette: boolean;
	invisible: boolean;
	wall: boolean;
	voxel: boolean;
	powers_up: string;
	active: AnimOffset[];
	powerup_loc: { x: number; y: number }[];
	occupy: { x: number; y: number }[];
	bib: string;
	extra_light: number;
	light_visibility: number;
	light_intensity: number;
	light_red: number;
	light_green: number;
	light_blue: number;
	facings: number;
	walk_frames: number;
	standing_frames: number;
	start_stand: number;
	start_walk: number;
	ready_frame: number;
	ready_count: number;
	ready_jump: number;
	turret: boolean;
	sight: number;
	power: number;
	drain: number;
	radar: boolean;
	zheight: number;
	core_defender: boolean;
};

type TiberiumType = {
	name: string;
	color: string;
	start: number;
	variety: number;
	ramp: number;
};

function is_bridge_name(name: string, graphic: string): boolean {
	const text = `${name} ${graphic}`.toUpperCase();
	return text.includes("BRIDGE") || text.includes("LOBRDG");
}

function hsv_to_rgb(hue: number, saturation: number, value: number): [number, number, number] {
	let h = ((hue | 0) % 256 + 256) % 256;
	let s = saturation | 0;
	let v = value | 0;
	if (s < 0) {
		s = 0;
	}
	if (v < 0) {
		v = 0;
	}
	if (s > 255) {
		s = 255;
	}
	if (v > 255) {
		v = 255;
	}
	h *= 6;
	const f = h % 255;
	const values = [0, v, v, 0, 0, 0, 0];
	let tmp = ((s * f) / 255) | 0;
	values[3] = ((v * (255 - tmp)) / 255) | 0;
	values[4] = values[5] = ((v * (255 - s)) / 255) | 0;
	tmp = 255 - (((s * (255 - f)) / 255) | 0);
	values[6] = ((v * tmp) / 255) | 0;
	let i = (h / 255) | 0;
	i += i > 4 ? -4 : 2;
	const red = values[i]! | 0;
	i += i > 4 ? -4 : 2;
	const blue = values[i]! | 0;
	i += i > 4 ? -4 : 2;
	const green = values[i]! | 0;
	return [red & 255, green & 255, blue & 255];
}

function scheme_palette(base: Uint16Array, hue: number, saturation: number, value: number): Uint16Array {
	const palette = base.slice();
	const cos_step = ((14 / 3) * Math.PI) / 180;
	const sin_step = ((8 / 3) * Math.PI) / 180;
	for (let i = 0; i < 16; i++) {
		let cosval = (20 * Math.PI) / 180 + i * cos_step;
		const sinval = (50 * Math.PI) / 180 + i * sin_step;
		if (i === 0) {
			cosval = ((360 / 32) * Math.PI) / 180;
		}
		const [r, g, b] = hsv_to_rgb(hue, Math.sin(sinval) * saturation, Math.cos(cosval) * value);
		palette[i + 16] = build_hicolor_pixel(r, g, b);
	}
	return palette;
}

function parse_hsv(ini: INIClass, section: string, entry: string): { h: number; s: number; v: number } | null {
	const parts = ini.get_string(section, entry).split(",");
	if (parts.length < 3) {
		return null;
	}
	const h = Number.parseInt(parts[0]!.trim(), 10);
	const s = Number.parseInt(parts[1]!.trim(), 10);
	const v = Number.parseInt(parts[2]!.trim(), 10);
	if (![h, s, v].every(Number.isFinite)) {
		return null;
	}
	return { h, s, v };
}

function overlay_label(type: OverlayType): string {
	return `${type.name} ${type.graphic}`;
}

function is_large_tiberium(type: OverlayType): boolean {
	return /LTIB|TIBL|LARGE.?TIB/i.test(overlay_label(type));
}

function is_tiberium2(type: OverlayType): boolean {
	return /TIBERIUM2|TIB2[_-]/i.test(overlay_label(type));
}

function is_tiberium3(type: OverlayType): boolean {
	return /TIBERIUM3|TIB3[_-]/i.test(overlay_label(type));
}

function tiberium_overlay_start(image: number, overlays: OverlayType[]): number {
	const match = (test: (type: OverlayType) => boolean): number => overlays.findIndex(test);
	if (image === 2) {
		const found = match(is_large_tiberium);
		return found >= 0 ? found : 27;
	}
	if (image === 3) {
		const found = match(is_tiberium2);
		return found >= 0 ? found : 127;
	}
	if (image === 4) {
		const found = match(is_tiberium3);
		return found >= 0 ? found : 147;
	}
	const found = match((type) => type.tiberium && !is_large_tiberium(type) && !is_tiberium2(type) && !is_tiberium3(type));
	return found >= 0 ? found : 102;
}

const FOUNDATIONS: { name: string; cells: { x: number; y: number }[] }[] = [
	{ name: "1x1", cells: [{ x: 0, y: 0 }] },
	{ name: "2x1", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
	{ name: "1x2", cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }] },
	{
		name: "2x2",
		cells: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
		],
	},
	{
		name: "2x3",
		cells: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 0, y: 2 },
			{ x: 1, y: 2 },
		],
	},
	{
		name: "3x2",
		cells: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
		],
	},
	{
		name: "3x3",
		cells: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 2, y: 1 },
			{ x: 0, y: 2 },
			{ x: 1, y: 2 },
			{ x: 2, y: 2 },
		],
	},
	{ name: "3x5", cells: occupy_rect(3, 5) },
	{ name: "4x2", cells: occupy_rect(4, 2) },
	{
		name: "3x3Refinery",
		cells: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
			{ x: 0, y: 2 },
			{ x: 1, y: 2 },
			{ x: 2, y: 2 },
		],
	},
	{ name: "1x3", cells: occupy_rect(1, 3) },
	{ name: "3x1", cells: occupy_rect(3, 1) },
	{ name: "4x3", cells: occupy_rect(4, 3) },
	{ name: "1x4", cells: occupy_rect(1, 4) },
	{ name: "1x5", cells: occupy_rect(1, 5) },
	{ name: "2x6", cells: occupy_rect(2, 6) },
	{ name: "2x5", cells: occupy_rect(2, 5) },
	{ name: "5x3", cells: occupy_rect(5, 3) },
	{ name: "4x4", cells: occupy_rect(4, 4) },
	{ name: "3x4", cells: occupy_rect(3, 4) },
	{ name: "6x4", cells: occupy_rect(6, 4) },
];

function occupy_rect(width: number, height: number): { x: number; y: number }[] {
	const cells: { x: number; y: number }[] = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			cells.push({ x, y });
		}
	}
	return cells;
}

function foundation_cells(label: string): { x: number; y: number }[] {
	const found = FOUNDATIONS.find((entry) => entry.name.toUpperCase() === label.toUpperCase());
	return found?.cells ?? [{ x: 0, y: 0 }];
}

function occupy_size(cells: { x: number; y: number }[]): { w: number; h: number } {
	let maxx = 0;
	let maxy = 0;
	for (const cell of cells) {
		if (cell.x > maxx) {
			maxx = cell.x;
		}
		if (cell.y > maxy) {
			maxy = cell.y;
		}
	}
	return { w: maxx + 1, h: maxy + 1 };
}

function building_select(type: ShapeType): SpriteSelect {
	const size = occupy_size(type.occupy);
	return {
		kind: "box",
		pre: true,
		lx: size.w * CELL_LEPTON,
		ly: size.h * CELL_LEPTON,
		lz: 40 * (type.zheight * 5),
	};
}

function unit_select(type: ShapeType, veteran: boolean): SpriteSelect {
	if (type.core_defender) {
		return { kind: "box", pre: false, lx: CELL_LEPTON, ly: CELL_LEPTON, lz: 700 };
	}
	return { kind: "shape", frame: (veteran ? 4 : 0) + 3 };
}

function occupies(origin: { x: number; y: number }, cells: { x: number; y: number }[], x: number, y: number): boolean {
	return cells.some((cell) => origin.x + cell.x === x && origin.y + cell.y === y);
}

function read_tiberiums(rules: INIClass, overlays: OverlayType[]): TiberiumType[] {
	const types: TiberiumType[] = [];
	const count = rules.entry_count("Tiberiums");
	for (let i = 0; i < count; i++) {
		const name = rules.get_string("Tiberiums", rules.get_entry("Tiberiums", i));
		if (!name) {
			continue;
		}
		const image = rules.get_int(name, "Image", 1);
		const large = image === 2;
		types.push({
			name,
			color: rules.get_string(name, "Color", "DarkGreen") || "DarkGreen",
			start: tiberium_overlay_start(image, overlays),
			variety: 12,
			ramp: large ? 0 : 8,
		});
	}
	return types;
}

function tiberium_color(id: number, types: TiberiumType[]): string {
	for (const type of types) {
		if (id >= type.start && id < type.start + type.variety + type.ramp) {
			return type.color.toUpperCase();
		}
	}
	return (types[0]?.color ?? "DarkGreen").toUpperCase();
}

function make_sprite(
	x: number,
	y: number,
	names: string[],
	palette: "theater" | "unit",
	layer: number,
	extra: Partial<MapSprite> = {},
): MapSprite {
	return {
		x,
		y,
		ox: 0,
		oy: 0,
		frame: 0,
		names,
		file: "",
		palette,
		scheme: "",
		layer,
		wall: "",
		bright: "object",
		extra_light: 0,
		voxel: "",
		dir: 0,
		cast_shadow: true,
		anim: null,
		selectable: false,
		blip: 0,
		select: null,
		occupy: [{ x: 0, y: 0 }],
		corner: false,
		rtti: "",
		health_ratio: 1,
		veteran: false,
		bridge: false,
		...extra,
	};
}

type AnimTypeData = {
	delay: number;
	start: number;
	stages: number;
	loop_start: number;
	loop_end: number;
	loops: number;
	normalized: boolean;
	pingpong: boolean;
	reverse: boolean;
};

function read_anim_type(art: INIClass, name: string): AnimTypeData {
	let delay = 1;
	const rate = art.get_int(name, "Rate", -1);
	if (rate !== -1) {
		delay = rate > 0 ? (TICKS_PER_MINUTE / rate) | 0 : 0;
	}
	return {
		delay,
		start: art.get_int(name, "Start", 0),
		stages: art.get_int(name, "End", 0),
		loop_start: art.get_int(name, "LoopStart", 0),
		loop_end: art.get_int(name, "LoopEnd", 0),
		loops: art.get_int(name, "LoopCount", 0),
		normalized: art.get_bool(name, "Normalized", false),
		pingpong: art.get_bool(name, "PingPong", false),
		reverse: art.get_bool(name, "Reverse", false),
	};
}

function create_anim(type: AnimTypeData): SpriteAnim {
	let delay = type.delay;
	if (type.normalized) {
		delay = Options.Normalize_Delay(delay);
	}
	let loops = (1 * type.loops) & 0xff;
	loops = Math.max(loops, 1);
	return {
		start: type.start,
		stages: type.stages,
		loop_start: type.loop_start,
		loop_end: type.loop_end,
		loops,
		rate: delay,
		timer: delay,
		stage: 0,
		step: 1,
		delay: 0,
		pingpong: type.pingpong,
		reverse: type.reverse,
		brand_new: true,
		dead: false,
	};
}

function bind_anim_shape(anim: SpriteAnim, frames: number): void {
	if (anim.stages === 0) {
		anim.stages = frames;
	}
	if (anim.loop_end === 0) {
		anim.loop_end = anim.stages;
	}
	if (anim.reverse) {
		anim.stage = anim.loop_end;
		anim.step = -1;
	}
}

export function Anim_Logic(sprite: MapSprite): void {
	const anim = sprite.anim;
	if (!anim || anim.dead) {
		return;
	}
	if (anim.timer > 0) {
		anim.timer--;
	}
	if (anim.brand_new) {
		anim.brand_new = false;
		sprite.frame = anim.start + anim.stage;
		return;
	}
	if (anim.delay) {
		anim.delay--;
		return;
	}
	if (!(anim.timer === 0 && anim.rate !== 0)) {
		return;
	}
	anim.stage += anim.step;
	anim.timer = anim.rate;
	if (anim.pingpong) {
		if (
			(anim.loops <= 1 && (anim.stage >= anim.stages || anim.stage === 0)) ||
			(anim.loops > 1 && (anim.stage >= anim.loop_end - anim.start || anim.stage === anim.start))
		) {
			anim.step = -anim.step;
			sprite.frame = anim.start + anim.stage;
			return;
		}
	}
	if (
		(anim.loops <= 1 && anim.stage >= anim.stages) ||
		(anim.loops > 1 && anim.stage >= anim.loop_end - anim.start) ||
		(anim.reverse && anim.stage <= anim.start)
	) {
		if (anim.loops && anim.loops !== 255) {
			anim.loops--;
		}
		if (anim.loops) {
			anim.stage = anim.reverse ? anim.loop_end : anim.loop_start - anim.start;
		} else {
			anim.dead = true;
			return;
		}
	}
	sprite.frame = anim.start + anim.stage;
}

function theater_filename(name: string, letter: string): string {
	if (name.length < 2 || letter.length === 0) {
		return name;
	}
	const second = name[1]!.toUpperCase();
	if (second === "T" || second === "A") {
		return `${name[0]}${letter}${name.slice(2)}`;
	}
	return name;
}

function list_types(ini: INIClass, section: string): string[] {
	const names: string[] = [];
	const count = ini.entry_count(section);
	for (let i = 0; i < count; i++) {
		const name = ini.get_string(section, ini.get_entry(section, i));
		if (name.length > 0) {
			names.push(name);
		}
	}
	return names;
}

function read_overlay_type(rules: INIClass, art: INIClass, name: string): OverlayType {
	const graphic = rules.get_string(name, "Image", name) || name;
	return {
		name,
		graphic,
		theater: art.get_bool(graphic, "Theater", false),
		new_theater: art.get_bool(graphic, "NewTheater", false),
		wall: rules.get_bool(name, "Wall", false),
		tiberium: rules.get_bool(name, "Tiberium", false),
		crate: rules.get_bool(name, "Crate", false),
		bridge: is_bridge_name(name, graphic),
	};
}

function read_shape_type(rules: INIClass, art: INIClass, name: string): ShapeType {
	const graphic = rules.get_string(name, "Image", name) || name;
	const art_image = art.get_string(graphic, "Image", graphic) || graphic;
	const to_overlay = art.get_string(graphic, "ToOverlay", "");
	const section = graphic;
	const active: AnimOffset[] = [];
	const anim_keys = [
		["ActiveAnim", "ActiveAnimX", "ActiveAnimY"],
		["ActiveAnimTwo", "ActiveAnimTwoX", "ActiveAnimTwoY"],
		["ActiveAnimThree", "ActiveAnimThreeX", "ActiveAnimThreeY"],
		["ActiveAnimFour", "ActiveAnimFourX", "ActiveAnimFourY"],
	];
	for (const keys of anim_keys) {
		const stem = art.get_string(section, keys[0]!, "");
		if (stem.length > 0) {
			active.push({ stem, x: art.get_int(section, keys[1]!, 0), y: art.get_int(section, keys[2]!, 0) });
		}
	}
	const upgrades = rules.get_int(name, "Upgrades", 0);
	const powerup_loc: { x: number; y: number }[] = [];
	for (let i = 1; i <= Math.max(upgrades, 3); i++) {
		powerup_loc.push({
			x: art.get_int(section, `PowerUp${i}LocXX`, 0),
			y: art.get_int(section, `PowerUp${i}LocYY`, 0),
		});
	}
	let foundation = art.get_string(graphic, "Foundation", "1x1") || "1x1";
	const named_foundation = art.get_string(name, "Foundation", "");
	if (named_foundation.length > 0) {
		foundation = named_foundation;
	}
	return {
		name,
		graphic: art_image,
		voxel_stem: graphic,
		theater: art.get_bool(graphic, "Theater", false),
		new_theater: art.get_bool(graphic, "NewTheater", false),
		terrain_palette: art.get_bool(graphic, "TerrainPalette", false) || art.get_bool(art_image, "TerrainPalette", false),
		invisible: rules.get_bool(name, "InvisibleInGame", false),
		wall: rules.get_bool(name, "Wall", false) || to_overlay.length > 0,
		voxel: art.get_bool(graphic, "Voxel", false),
		powers_up: rules.get_string(name, "PowersUpBuilding", ""),
		active,
		powerup_loc,
		occupy: foundation_cells(foundation),
		bib: art.get_string(graphic, "BibShape", ""),
		extra_light: art.get_int(graphic, "ExtraLight", 0),
		light_visibility: rules.get_int(name, "LightVisibility", 5000),
		light_intensity: Math.floor(rules.get_float(name, "LightIntensity", 0) * NORMAL_LIGHT + 0.1),
		light_red: Math.floor(rules.get_float(name, "LightRedTint", 1) * NORMAL_LIGHT + 0.1),
		light_green: Math.floor(rules.get_float(name, "LightGreenTint", 1) * NORMAL_LIGHT + 0.1),
		light_blue: Math.floor(rules.get_float(name, "LightBlueTint", 1) * NORMAL_LIGHT + 0.1),
		...read_facing(art, graphic, art_image),
		sight: rules.get_int(name, "Sight", 0),
		power: read_power(rules, name).output,
		drain: read_power(rules, name).drain,
		radar: rules.get_bool(name, "Radar", false),
		zheight: art.get_int(graphic, "Height", 1),
		core_defender: rules.get_bool(name, "IsCoreDefender", false),
	};
}

function read_power(rules: INIClass, name: string): { output: number; drain: number } {
	let output = rules.get_int(name, "Power", 0);
	let drain = 0;
	if (output < 0) {
		drain = -output;
		output = 0;
	}
	return { output, drain };
}

function read_facing(art: INIClass, graphic: string, art_image: string): Pick<
	ShapeType,
	| "facings"
	| "walk_frames"
	| "standing_frames"
	| "start_stand"
	| "start_walk"
	| "ready_frame"
	| "ready_count"
	| "ready_jump"
	| "turret"
> {
	const firing = art.get_int(graphic, "FiringFrames", 0);
	const turret = art.get_bool(graphic, "Turret", false);
	let facings = 8;
	if (!firing && !turret) {
		facings = 1;
	}
	facings = art.get_int(graphic, "Facings", facings);
	const walk_frames = art.get_int(graphic, "WalkFrames", 12);
	let standing_frames = firing > 0 ? 1 : 0;
	standing_frames = art.get_int(graphic, "StandingFrames", standing_frames);
	let start_walk = 0;
	let start_stand = standing_frames === 0 ? start_walk : facings * walk_frames;
	start_stand = art.get_int(graphic, "StartStandFrame", start_stand);
	start_walk = art.get_int(graphic, "StartWalkFrame", start_walk);
	const seq = art.get_string(graphic, "Sequence", "") || art.get_string(art_image, "Sequence", "");
	const ready = seq.length > 0 ? art.get_string(seq, "Ready", "") : "";
	const bits = ready.split(",");
	return {
		facings,
		walk_frames,
		standing_frames,
		start_stand,
		start_walk,
		ready_frame: Number.parseInt(bits[0]?.trim() ?? "", 10) || 0,
		ready_count: Number.parseInt(bits[1]?.trim() ?? "", 10) || 1,
		ready_jump: Number.parseInt(bits[2]?.trim() ?? "", 10) || 0,
		turret,
	};
}

function dir256_raw(dir: number): number {
	return ((dir & 255) << 8) & 0xffff;
}

function round_facing(raw: number, shift: number): number {
	return ((((raw >>> 0) >> shift) + 1) >> 1);
}

function shape_facing_index(dir: number, count: number): number {
	const raw = dir256_raw(dir);
	switch (count) {
		case 8:
			return (round_facing(raw, 12) + 1) % 8;
		case 16:
			return (round_facing(raw, 11) + 2) % 16;
		case 32:
			return (round_facing(raw, 10) + 4) % 32;
		case 64:
			return (round_facing(raw, 9) + 8) % 64;
		default:
			return 0;
	}
}

function unit_stand_frame(type: ShapeType, dir: number): number {
	const face = shape_facing_index(dir, type.facings);
	if (type.standing_frames === 0) {
		return type.start_walk + face * type.walk_frames;
	}
	return type.start_stand + face * type.standing_frames;
}

function infantry_ready_frame(type: ShapeType, dir: number): number {
	let shapenum = 0;
	if (type.ready_jump > 0) {
		shapenum += (HUMAN_SHAPE[round_facing(dir256_raw(dir), 10) % 32] ?? 0) * type.ready_jump;
	}
	return shapenum + type.ready_frame;
}

function sub_pixel(sub: number): { ox: number; oy: number } {
	const spot = STOPPING_COORD[sub] ?? STOPPING_COORD[0]!;
	const dx = spot.x - CELL_LEPTON / 2;
	const dy = spot.y - CELL_LEPTON / 2;
	return {
		ox: Math.trunc((dx * (ISO_TILE_PIXEL_W >> 1) - dy * (ISO_TILE_PIXEL_W >> 1)) / CELL_LEPTON),
		oy: Math.trunc((dx * (ISO_TILE_PIXEL_H >> 1) + dy * (ISO_TILE_PIXEL_H >> 1)) / CELL_LEPTON),
	};
}

function house_scheme(ini: INIClass, rules: INIClass, house: string): string {
	return (ini.get_string(house, "Color", "") || rules.get_string(house, "Color", "")).toUpperCase();
}

function color_hsv(ini: INIClass, rules: INIClass, name: string): { h: number; s: number; v: number } | null {
	const want = name.toUpperCase();
	if (!want) {
		return null;
	}
	for (const source of [ini, rules]) {
		const count = source.entry_count("Colors");
		for (let i = 0; i < count; i++) {
			const entry = source.get_entry("Colors", i);
			if (entry.toUpperCase() === want) {
				const hsv = parse_hsv(source, "Colors", entry);
				if (hsv) {
					return hsv;
				}
			}
		}
	}
	return null;
}

function house_blip(ini: INIClass, rules: INIClass, house: string): number {
	const hsv = color_hsv(ini, rules, house_scheme(ini, rules, house));
	if (!hsv) {
		return build_hicolor_pixel(255, 255, 255);
	}
	const rgb = hsv_to_rgb(hsv.h, hsv.s, hsv.v);
	return build_hicolor_pixel(rgb[0], rgb[1], rgb[2]);
}

function overlay_draw_offset(type: OverlayType, frame: number): { ox: number; oy: number } {
	let oy = 0;
	if (type.tiberium || type.wall || type.crate) {
		oy -= LEVEL_PIXEL_H;
	}
	if (type.bridge) {
		oy -= (ISO_TILE_PIXEL_H >> 1) + 1;
		if (frame >= OVERLAYDATA_BRIDGE_NS_FULL1 && frame <= OVERLAYDATA_BRIDGE_NS_END2) {
			oy -= ISO_TILE_PIXEL_H >> 1;
		}
	}
	return { ox: 0, oy };
}

function theater_stems(name: string, seed: TheaterSeed): string[] {
	const swapped = theater_filename(name, seed.image_letter);
	if (swapped.toUpperCase() === name.toUpperCase()) {
		return [name];
	}
	return [swapped, name];
}

function overlay_files(type: OverlayType, seed: TheaterSeed): string[] {
	if (type.theater) {
		return theater_stems(type.graphic, seed).map((name) => `${name}.${seed.suffix}`);
	}
	const names = type.new_theater ? theater_stems(type.graphic, seed) : [type.graphic];
	return names.flatMap((name) => [`${name}.SHP`, `${name}.${seed.suffix}`]);
}

function object_files(type: ShapeType, seed: TheaterSeed): string[] {
	if (type.voxel) {
		return [];
	}
	if (type.theater) {
		return theater_stems(type.graphic, seed).map((name) => `${name}.${seed.suffix}`);
	}
	const names = type.new_theater ? theater_stems(type.graphic, seed) : [type.graphic];
	return names.flatMap((name) => [`${name}.SHP`, `${name}.${seed.suffix}`]);
}

function anim_files(stem: string, seed: TheaterSeed, art?: INIClass): string[] {
	const graphic = art?.get_string(stem, "Image", stem) || stem;
	if (art?.get_bool(stem, "Theater", false) || art?.get_bool(graphic, "Theater", false)) {
		return theater_stems(graphic, seed).map((name) => `${name}.${seed.suffix}`);
	}
	const names = theater_stems(graphic, seed);
	if (names.every((name) => name.toUpperCase() !== graphic.toUpperCase())) {
		names.push(graphic);
	}
	return names.flatMap((name) => [`${name}.SHP`, `${name}.${seed.suffix}`]);
}

async function load_ini(directory: GameDirectory, filename: string): Promise<INIClass | null> {
	const packed = await cc_retrieve(directory, filename);
	if (!packed) {
		return null;
	}
	const ini = new INIClass();
	return ini.load(packed) ? ini : null;
}

async function load_palette(
	directory: GameDirectory,
	filename: string,
	log: (line: string) => void,
): Promise<Uint16Array> {
	const packed = await cc_retrieve(directory, filename);
	if (!packed || packed.length < 768) {
		log(`${filename} missing; using a fallback palette.`);
	}
	return read_palette(packed ?? new Uint8Array(0));
}

async function fetch_shape(
	directory: GameDirectory,
	cache: Map<string, ShapeSet | null>,
	names: string[],
): Promise<string | null> {
	for (const name of names) {
		const key = name.toUpperCase();
		const cached = cache.get(key);
		if (cached) {
			return key;
		}
		if (cache.has(key)) {
			continue;
		}
		const packed = await cc_retrieve(directory, name);
		const shape = packed ? read_shp(packed) : null;
		cache.set(key, shape);
		if (shape) {
			return key;
		}
	}
	return null;
}

async function fetch_voxel_piece(directory: GameDirectory, stem: string): Promise<VoxelModel | null> {
	const vxl = await cc_retrieve(directory, `${stem}.VXL`);
	if (!vxl) {
		return null;
	}
	const hva = await cc_retrieve(directory, `${stem}.HVA`);
	return read_vxl(vxl, hva);
}

async function fetch_voxel_model(directory: GameDirectory, graphic: string): Promise<VoxelModel | null> {
	const body = await fetch_voxel_piece(directory, graphic);
	if (!body) {
		return null;
	}
	for (const extra of [`${graphic}TUR`, `${graphic}BARL`, `${graphic}W`]) {
		const piece = await fetch_voxel_piece(directory, extra);
		if (piece) {
			body.layers.push(...piece.layers);
		}
	}
	return body;
}

function parse_overlay_pack(
	ini: INIClass,
	types: OverlayType[],
	seed: TheaterSeed,
	tiberiums: TiberiumType[],
): MapSprite[] {
	const packed = ini.get_uublock("OverlayPack");
	if (packed.length === 0) {
		return [];
	}
	const data = lcw_straw_decompress(packed, MAP_CELL_W * MAP_CELL_H);
	const extra = ini.get_uublock("OverlayDataPack");
	const stages = extra.length > 0 ? lcw_straw_decompress(extra, MAP_CELL_W * MAP_CELL_H) : new Uint8Array(0);
	const sprites: MapSprite[] = [];
	const limit = Math.min(data.length, MAP_CELL_W * MAP_CELL_H);
	for (let i = 0; i < limit; i++) {
		const id = data[i]!;
		if (id === OVERLAY_NONE) {
			continue;
		}
		const type = types[id];
		if (!type) {
			continue;
		}
		const y = Math.floor(i / MAP_CELL_W);
		const x = i - y * MAP_CELL_W;
		const frame = stages[i] ?? 0;
		const offset = overlay_draw_offset(type, frame);
		sprites.push(
			make_sprite(x, y, overlay_files(type, seed), type.tiberium || type.wall ? "unit" : "theater", 0, {
				ox: offset.ox,
				oy: offset.oy,
				frame,
				wall: type.wall ? type.name : "",
				scheme: type.tiberium ? tiberium_color(id, tiberiums) : "",
				bright: type.tiberium ? "day" : type.wall ? "object" : "tile",
				bridge: type.bridge,
			}),
		);
	}
	connect_walls(sprites);
	return sprites;
}

function connect_walls(sprites: MapSprite[]): void {
	const walls = new Map<string, MapSprite>();
	for (const sprite of sprites) {
		if (sprite.wall) {
			walls.set(`${sprite.x},${sprite.y}`, sprite);
		}
	}
	const dirs = [
		{ x: 0, y: -1 },
		{ x: 1, y: 0 },
		{ x: 0, y: 1 },
		{ x: -1, y: 0 },
	];
	for (const sprite of walls.values()) {
		let icon = 0;
		for (let i = 0; i < dirs.length; i++) {
			const dir = dirs[i]!;
			const next = walls.get(`${sprite.x + dir.x},${sprite.y + dir.y}`);
			if (next && next.wall === sprite.wall) {
				icon |= 1 << i;
			}
		}
		sprite.frame = (sprite.frame & ~OVERLAYDATA_WALL_FRAME_MASK) | icon;
	}
}

type PlacedObject = {
	house: string;
	name: string;
	x: number;
	y: number;
	dir: number;
	sub: number;
	health: number;
	veteran: boolean;
};

function token_int(parts: string[], index: number, fallback: number): number {
	const value = Number.parseInt(parts[index]?.trim() ?? "", 10);
	return Number.isFinite(value) ? value : fallback;
}

function ini_health_ratio(strength: number): number {
	const n = Math.min(Math.max(strength, 0), 256);
	if (n > 253) {
		return 1;
	}
	return n / 256;
}

function parse_placed(line: string, infantry: boolean): PlacedObject | null {
	const parts = line.split(",");
	if (parts.length < 5) {
		return null;
	}
	const house = parts[0]!.trim();
	const name = parts[1]!.trim();
	const x = Number.parseInt(parts[3]!.trim(), 10);
	const y = Number.parseInt(parts[4]!.trim(), 10);
	if (!name || !Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}
	const health = token_int(parts, 2, 256);
	if (infantry) {
		return {
			house,
			name,
			x,
			y,
			sub: token_int(parts, 5, 0),
			dir: token_int(parts, 7, 0),
			health,
			veteran: token_int(parts, 9, 0) !== 0,
		};
	}
	return { house, name, x, y, dir: token_int(parts, 5, 0), sub: 0, health, veteran: token_int(parts, 8, 0) !== 0 };
}

function parse_infantry(
	ini: INIClass,
	rules: INIClass,
	types: Map<string, ShapeType>,
	seed: TheaterSeed,
): MapSprite[] {
	const sprites: MapSprite[] = [];
	const count = ini.entry_count("Infantry");
	for (let i = 0; i < count; i++) {
		const parsed = parse_placed(ini.get_string("Infantry", ini.get_entry("Infantry", i)), true);
		if (!parsed) {
			continue;
		}
		const type = types.get(parsed.name.toUpperCase());
		if (!type || type.voxel || type.invisible || type.wall) {
			continue;
		}
		const files = object_files(type, seed);
		if (files.length === 0) {
			continue;
		}
		const offset = sub_pixel(parsed.sub);
		sprites.push(
			make_sprite(parsed.x, parsed.y, files, type.terrain_palette ? "theater" : "unit", 2, {
				ox: offset.ox,
				oy: offset.oy,
				frame: infantry_ready_frame(type, parsed.dir),
				scheme: type.terrain_palette ? "" : house_scheme(ini, rules, parsed.house),
				selectable: true,
				blip: house_blip(ini, rules, parsed.house),
				select: { kind: "shape", frame: parsed.veteran ? 6 : 2 },
				rtti: "infantry",
				health_ratio: ini_health_ratio(parsed.health),
				veteran: parsed.veteran,
			}),
		);
	}
	return sprites;
}

function parse_units(
	ini: INIClass,
	rules: INIClass,
	section: string,
	types: Map<string, ShapeType>,
	seed: TheaterSeed,
	layer: number,
): MapSprite[] {
	const sprites: MapSprite[] = [];
	const count = ini.entry_count(section);
	for (let i = 0; i < count; i++) {
		const parsed = parse_placed(ini.get_string(section, ini.get_entry(section, i)), false);
		if (!parsed) {
			continue;
		}
		const type = types.get(parsed.name.toUpperCase());
		if (!type || type.invisible || type.wall) {
			continue;
		}
		const scheme = type.terrain_palette ? "" : house_scheme(ini, rules, parsed.house);
		const rtti = section === "Aircraft" ? "aircraft" : "unit";
		const extra = {
			scheme,
			selectable: true as const,
			blip: house_blip(ini, rules, parsed.house),
			select: unit_select(type, parsed.veteran),
			rtti: rtti as "unit" | "aircraft",
			health_ratio: ini_health_ratio(parsed.health),
			veteran: parsed.veteran,
		};
		if (type.voxel) {
			sprites.push(
				make_sprite(parsed.x, parsed.y, [], "unit", layer, {
					voxel: type.voxel_stem,
					dir: parsed.dir,
					...extra,
				}),
			);
			continue;
		}
		const files = object_files(type, seed);
		if (files.length === 0) {
			continue;
		}
		sprites.push(
			make_sprite(parsed.x, parsed.y, files, type.terrain_palette ? "theater" : "unit", layer, {
				frame: unit_stand_frame(type, parsed.dir),
				...extra,
			}),
		);
	}
	return sprites;
}

function parse_structures(
	ini: INIClass,
	rules: INIClass,
	types: Map<string, ShapeType>,
	seed: TheaterSeed,
	art: INIClass,
): MapSprite[] {
	const placed: { name: string; x: number; y: number; type: ShapeType; scheme: string; blip: number; health: number }[] = [];
	const count = ini.entry_count("Structures");
	for (let i = 0; i < count; i++) {
		const parsed = parse_placed(ini.get_string("Structures", ini.get_entry("Structures", i)), false);
		if (!parsed) {
			continue;
		}
		const type = types.get(parsed.name.toUpperCase());
		if (!type || type.voxel || type.invisible || type.wall) {
			continue;
		}
		placed.push({
			name: parsed.name.toUpperCase(),
			x: parsed.x,
			y: parsed.y,
			type,
			scheme: type.terrain_palette ? "" : house_scheme(ini, rules, parsed.house),
			blip: house_blip(ini, rules, parsed.house),
			health: parsed.health,
		});
	}
	const sprites: MapSprite[] = [];
	const addon_at = new Map<string, number>();
	for (const item of placed) {
		if (item.type.powers_up) {
			const want = item.type.powers_up.toUpperCase();
			const parent = placed.find(
				(other) => !other.type.powers_up && other.name === want && occupies(other, other.type.occupy, item.x, item.y),
			);
			if (!parent) {
				continue;
			}
			const files = [...object_files(item.type, seed), ...anim_files(item.type.graphic, seed, art)];
			if (files.length === 0) {
				continue;
			}
			const key = `${parent.x},${parent.y}`;
			const slot = addon_at.get(key) ?? 0;
			addon_at.set(key, slot + 1);
			const loc = parent.type.powerup_loc[slot] ?? { x: 0, y: 0 };
			sprites.push(
				make_sprite(parent.x, parent.y, files, item.type.terrain_palette ? "theater" : "unit", 4, {
					ox: loc.x,
					oy: loc.y,
					scheme: item.scheme,
					corner: true,
				}),
			);
			continue;
		}
		const files = object_files(item.type, seed);
		if (files.length === 0) {
			continue;
		}
		sprites.push(
			make_sprite(item.x, item.y, files, item.type.terrain_palette ? "theater" : "unit", 3, {
				extra_light: item.type.extra_light,
				scheme: item.scheme,
				selectable: true,
				blip: item.blip,
				select: building_select(item.type),
				occupy: item.type.occupy,
				corner: true,
				rtti: "building",
				health_ratio: ini_health_ratio(item.health),
			}),
		);
		if (item.type.bib.length > 0) {
			sprites.push(
				make_sprite(item.x, item.y, anim_files(item.type.bib, seed, art), item.type.terrain_palette ? "theater" : "unit", 4, {
					scheme: item.scheme,
					corner: true,
				}),
			);
		}
		for (const anim of item.type.active) {
			sprites.push(
				make_sprite(item.x, item.y, anim_files(anim.stem, seed, art), item.type.terrain_palette ? "theater" : "unit", 4, {
					ox: anim.x,
					oy: anim.y,
					scheme: item.scheme,
					cast_shadow: false,
					anim: create_anim(read_anim_type(art, anim.stem)),
					corner: true,
				}),
			);
		}
	}
	return sprites;
}

function collect_lights(ini: INIClass, types: Map<string, ShapeType>): MapLightSource[] {
	const lights: MapLightSource[] = [];
	const count = ini.entry_count("Structures");
	for (let i = 0; i < count; i++) {
		const parsed = parse_placed(ini.get_string("Structures", ini.get_entry("Structures", i)), false);
		if (!parsed) {
			continue;
		}
		const type = types.get(parsed.name.toUpperCase());
		if (!type || type.voxel || type.wall || type.powers_up || type.light_intensity === 0) {
			continue;
		}
		const at = building_light_coord(parsed.x, parsed.y, type.occupy);
		lights.push({
			x: at.x,
			y: at.y,
			visibility: type.light_visibility,
			intensity: type.light_intensity,
			red: type.light_red,
			green: type.light_green,
			blue: type.light_blue,
		});
	}
	return lights;
}

function collect_lookers(
	ini: INIClass,
	player: string,
	buildings: Map<string, ShapeType>,
	infantry: Map<string, ShapeType>,
	units: Map<string, ShapeType>,
	aircraft: Map<string, ShapeType>,
): SightLooker[] {
	const house = player.toUpperCase();
	const lookers: SightLooker[] = [];
	const add = (section: string, types: Map<string, ShapeType>, infantry_line: boolean): void => {
		const count = ini.entry_count(section);
		for (let i = 0; i < count; i++) {
			const parsed = parse_placed(ini.get_string(section, ini.get_entry(section, i)), infantry_line);
			if (!parsed || parsed.house.toUpperCase() !== house) {
				continue;
			}
			const type = types.get(parsed.name.toUpperCase());
			if (!type || type.sight <= 0 || type.wall) {
				continue;
			}
			lookers.push({ x: parsed.x, y: parsed.y, sight: type.sight });
		}
	};
	add("Structures", buildings, false);
	add("Infantry", infantry, true);
	add("Units", units, false);
	add("Aircraft", aircraft, false);
	return lookers;
}

function collect_economy(
	ini: INIClass,
	player: string,
	buildings: Map<string, ShapeType>,
): { output: number; drain: number; has_radar: boolean } {
	const house = player.toUpperCase();
	let output = 0;
	let drain = 0;
	let has_radar = false;
	const count = ini.entry_count("Structures");
	for (let i = 0; i < count; i++) {
		const parsed = parse_placed(ini.get_string("Structures", ini.get_entry("Structures", i)), false);
		if (!parsed || parsed.house.toUpperCase() !== house) {
			continue;
		}
		const type = buildings.get(parsed.name.toUpperCase());
		if (!type || type.wall) {
			continue;
		}
		output += type.power;
		drain += type.drain;
		if (type.radar) {
			has_radar = true;
		}
	}
	return { output, drain, has_radar };
}

function parse_terrain_section(ini: INIClass, types: Map<string, ShapeType>, seed: TheaterSeed): MapSprite[] {
	const sprites: MapSprite[] = [];
	const count = ini.entry_count("Terrain");
	for (let i = 0; i < count; i++) {
		const entry = ini.get_entry("Terrain", i);
		const value = Number.parseInt(entry, 10);
		const raw = ini.get_string("Terrain", entry);
		const name = raw.split(",")[0]!.trim();
		if (!Number.isFinite(value) || name.length === 0) {
			continue;
		}
		const type = types.get(name.toUpperCase());
		if (!type) {
			continue;
		}
		const files = object_files(type, seed);
		if (files.length === 0) {
			continue;
		}
		sprites.push(make_sprite(value % 1000, Math.floor(value / 1000), files, "theater", 1));
	}
	return sprites;
}

export async function load_map_artwork(
	directory: GameDirectory,
	ini: INIClass,
	theater_name: string,
	log: (line: string) => void,
): Promise<MapArtwork> {
	const seed = theater_from_name(theater_name);
	const rules = await load_ini(directory, "RULES.INI");
	const art = await load_ini(directory, "ART.INI");
	if (!rules) {
		log("RULES.INI not found.");
	}
	if (!art) {
		log("ART.INI not found.");
	}
	const rules_ini = rules ?? new INIClass();
	const art_ini = art ?? new INIClass();
	const theater_palette = await load_palette(directory, `ISO${seed.suffix}.PAL`, log);
	const unit_palette = await load_palette(directory, `UNIT${seed.suffix}.PAL`, log);

	const overlays = list_types(rules_ini, "OverlayTypes").map((name) => read_overlay_type(rules_ini, art_ini, name));
	const tiberiums = read_tiberiums(rules_ini, overlays);
	const schemes = new Map<string, Uint16Array>();
	const color_count = rules_ini.entry_count("Colors");
	for (let i = 0; i < color_count; i++) {
		const entry = rules_ini.get_entry("Colors", i);
		const hsv = parse_hsv(rules_ini, "Colors", entry);
		if (hsv) {
			schemes.set(entry.toUpperCase(), scheme_palette(unit_palette, hsv.h, hsv.s, hsv.v));
		}
	}
	const buildings = new Map(
		list_types(rules_ini, "BuildingTypes").map((name) => [name.toUpperCase(), read_shape_type(rules_ini, art_ini, name)]),
	);
	const terrains = new Map(
		list_types(rules_ini, "TerrainTypes").map((name) => [name.toUpperCase(), read_shape_type(rules_ini, art_ini, name)]),
	);
	const infantry = new Map(
		list_types(rules_ini, "InfantryTypes").map((name) => [name.toUpperCase(), read_shape_type(rules_ini, art_ini, name)]),
	);
	const units = new Map(
		list_types(rules_ini, "VehicleTypes").map((name) => [name.toUpperCase(), read_shape_type(rules_ini, art_ini, name)]),
	);
	const aircraft = new Map(
		list_types(rules_ini, "AircraftTypes").map((name) => [name.toUpperCase(), read_shape_type(rules_ini, art_ini, name)]),
	);

	const overlay_packed = ini.get_uublock("OverlayPack");
	const overlay_sprites = parse_overlay_pack(ini, overlays, seed, tiberiums);
	const terrain_sprites = parse_terrain_section(ini, terrains, seed);
	const structure_sprites = parse_structures(ini, rules_ini, buildings, seed, art_ini);
	const infantry_sprites = parse_infantry(ini, rules_ini, infantry, seed);
	const unit_sprites = parse_units(ini, rules_ini, "Units", units, seed, 2);
	const aircraft_sprites = parse_units(ini, rules_ini, "Aircraft", aircraft, seed, 5);
	const sprites: MapSprite[] = [
		...overlay_sprites,
		...terrain_sprites,
		...structure_sprites,
		...infantry_sprites,
		...unit_sprites,
		...aircraft_sprites,
	];
	const lighting = read_scenario_lighting(ini);
	const lights = collect_lights(ini, buildings);
	const player = ini.get_string("Basic", "Player", "GDI") || "GDI";
	const credits = ini.get_int(player, "Credits", 0) * 100;
	const lookers = collect_lookers(ini, player, buildings, infantry, units, aircraft);
	const economy = collect_economy(ini, player, buildings);
	const free_radar = ini.get_bool("Basic", "FreeRadar", false);
	const shroud_packed = await cc_retrieve(directory, "SHROUD.SHP");
	const shroud = shroud_packed ? read_shp(shroud_packed) : null;
	const select_packed = await cc_retrieve(directory, "SELECT.SHP");
	const select = select_packed ? read_shp(select_packed) : null;
	const pips_packed = await cc_retrieve(directory, "PIPS.SHP");
	const pips = pips_packed ? read_shp(pips_packed) : null;
	const condition_yellow = rules_ini.get_float("AudioVisual", "ConditionYellow", 0.5);
	const condition_red = rules_ini.get_float("AudioVisual", "ConditionRed", 0.5);
	log(
		`RULES types: ${overlays.length} overlays, ${buildings.size} buildings, ${terrains.size} terrain, ${infantry.size} infantry, ${units.size} units, ${aircraft.size} aircraft.`,
	);
	log(
		`Tiberium: ${tiberiums.map((type) => `${type.name} ${type.color} @${type.start}`).join(", ") || "none"}; ${schemes.size} color schemes.`,
	);
	log(
		`Lighting Ambient=${(lighting.ambient / 100).toFixed(2)} Ground=${lighting.ground} Level=${lighting.level}; ${lights.length} light sources.`,
	);
	log(
		`Scenario lists ${ini.entry_count("Structures")} structures, ${ini.entry_count("Terrain")} terrain, ${ini.entry_count("Infantry")} infantry, ${ini.entry_count("Units")} units, ${ini.entry_count("Aircraft")} aircraft; OverlayPack ${overlay_packed.length} bytes.`,
	);

	const cache = new Map<string, ShapeSet | null>();
	const shapes = new Map<string, ShapeSet>();
	const voxel_cache = new Map<string, VoxelModel | null>();
	const voxels_ready = new Map<string, VoxelModel>();
	const ready: MapSprite[] = [];
	const missing: string[] = [];
	for (const sprite of sprites) {
		if (sprite.voxel) {
			const key = sprite.voxel.toUpperCase();
			if (!voxel_cache.has(key)) {
				voxel_cache.set(key, await fetch_voxel_model(directory, sprite.voxel));
			}
			const model = voxel_cache.get(key);
			if (!model) {
				if (missing.length < 8) {
					missing.push(`${sprite.voxel}.VXL`);
				}
				continue;
			}
			voxels_ready.set(key, model);
			ready.push({ ...sprite, voxel: key });
			continue;
		}
		const key = await fetch_shape(directory, cache, sprite.names);
		if (!key) {
			if (missing.length < 8) {
				missing.push(sprite.names[0] ?? "?");
			}
			continue;
		}
		const shape = cache.get(key);
		if (!shape) {
			continue;
		}
		shapes.set(key, shape);
		if (sprite.anim) {
			bind_anim_shape(sprite.anim, shape.frames.length);
			ready.push({ ...sprite, file: key, frame: sprite.anim.start + sprite.anim.stage });
		} else {
			ready.push({ ...sprite, file: key });
		}
	}

	ready.sort((a, b) => a.x + a.y - (b.x + b.y) || a.layer - b.layer);
	log(
		`Map objects: ${overlay_sprites.length} overlays, ${terrain_sprites.length} terrain, ${structure_sprites.length} structures, ${infantry_sprites.length} infantry, ${unit_sprites.length} units, ${aircraft_sprites.length} aircraft; ${ready.length} sprites, ${shapes.size} SHP files, ${voxels_ready.size} VXL models.`,
	);
	if (missing.length > 0) {
		log(`Missing SHP/VXL: ${missing.join(", ")}`);
	}
	if (!shroud) {
		log("SHROUD.SHP not found.");
	}
	if (!select) {
		log("SELECT.SHP not found.");
	}
	if (!pips) {
		log("PIPS.SHP not found.");
	}
	log(
		`Power ${economy.output}/${economy.drain}; radar ${economy.has_radar || free_radar ? "available" : "off"}.`,
	);
	return {
		sprites: ready,
		shapes,
		theater_palette,
		unit_palette,
		schemes,
		lighting,
		lights,
		credits,
		voxels: voxels_ready,
		lookers,
		shroud,
		select,
		pips,
		condition_yellow,
		condition_red,
		power_output: economy.output,
		power_drain: economy.drain,
		has_radar: economy.has_radar,
		free_radar,
	};
}
