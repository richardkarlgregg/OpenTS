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
import { FactoryClass, Time_To_Build, type FactoryObject } from "./factory";
import type { GameDirectory } from "./files";
import { INIClass, type Point2D, type Rect } from "./ini";
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
import type { SightLooker, ShroudMap } from "./shroud";
import {
	Cameo_Category,
	Cameo_Group,
	Make_Strips,
	Sort_Strip,
	Strip_Add,
	Which_Column,
	type BuildType,
	type CameoKind,
	type SidebarStrips,
} from "./sidebar";
import { TICKS_PER_MINUTE } from "./stimer";
import { build_hicolor_pixel } from "./surface";
import { theater_from_name, type TheaterSeed } from "./theater";
import { read_vxl, type VoxelModel } from "./voxlib";
import {
	Apply_Coord,
	Assign_Destination,
	Can_Reach,
	Cell_Center,
	Coord_Cell,
	Direction_Facing,
	Facing_Dir256,
	Make_Foot,
	Movement_AI,
	Scale_To_256,
	TUNNEL,
	type CellTerrain,
	type FootState,
	type PathEnter,
} from "./walk";
import { Build_Path_Graph, Threat_Region, type PathGraph, type TubePath } from "./zone";

const MAP_CELL_W = 512;
const MAP_CELL_H = 512;
const OVERLAY_NONE = 0xff;
const OVERLAYDATA_WALL_FRAME_MASK = 0x0f;
const OVERLAYDATA_BRIDGE_NS_FULL1 = 9;
const OVERLAYDATA_BRIDGE_NS_END2 = 17;
const CELL_LEPTON = 256;
const GATE_START_OPENING = 0;
const GATE_OPENING = 1;
const GATE_OPEN = 2;
const GATE_START_CLOSING = 3;
const GATE_CLOSING = 4;
const GATE_CLOSED = 5;
export let ActionLineTimer = 0;
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

export type GateState = {
	stages: number;
	deploy: number;
	close_delay: number;
	status: number;
	hold: number;
	door_count: number;
	door_active: boolean;
	door_up: boolean;
};

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
	owned: boolean;
	type_name: string;
	foot: FootState | null;
	gate: GateState | null;
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
	sidebar: SidebarStrips;
	production: ProductionState;
	terrain: Map<string, CellTerrain>;
	path_graph: PathGraph | null;
	tubes: TubePath[];
};

export type PendingPlace = {
	kind: CameoKind;
	name: string;
	occupy: { x: number; y: number }[];
	adjacent: number;
	sprites: MapSprite[];
};

export type ProductionState = {
	player: string;
	acts_like: string;
	tech_level: number;
	groups: Record<string, string[]>;
	buildings: Map<string, ShapeType>;
	infantry: Map<string, ShapeType>;
	units: Map<string, ShapeType>;
	tables: Record<CameoKind, ShapeType[]>;
	counts: Map<string, number>;
	seed: TheaterSeed;
	scheme: string;
	blip: number;
	build_speed: number;
	factories: Map<CameoKind, FactoryClass>;
	pending: PendingPlace | null;
	art: INIClass;
	max_queue: number;
	cliff_back: number;
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

export type ShapeType = {
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
	to_build: string;
	tech_level: number;
	owners: string[];
	prerequisite: string[];
	cameo: string;
	cameo_sort: number;
	build_limit: number;
	label: string;
	gate: boolean;
	sort_defense: boolean;
	cost: number;
	adjacent: number;
	speed: number;
	gdi_barracks: boolean;
	nod_barracks: boolean;
	exit_coord: Point2D;
	walk_frame: number;
	walk_count: number;
	walk_jump: number;
	gate_stages: number;
	deploy_time: number;
	gate_close_delay: number;
	threat_posed: number;
	threat_avoid: number;
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

function sprite_depth(sprite: MapSprite): number {
	let depth = (sprite.x + sprite.y) * CELL_LEPTON;
	if (sprite.gate) {
		depth -= 16;
	}
	return depth;
}

function sprite_rank(sprite: MapSprite): number {
	if (sprite.rtti === "infantry" || sprite.rtti === "unit" || sprite.rtti === "aircraft") {
		return 1;
	}
	return 0;
}

function compare_sprites(a: MapSprite, b: MapSprite): number {
	const depth = sprite_depth(a) - sprite_depth(b);
	if (depth !== 0) {
		return depth;
	}
	const rank = sprite_rank(a) - sprite_rank(b);
	if (rank !== 0) {
		return rank;
	}
	return a.layer - b.layer;
}

function Sort_Sprites(artwork: MapArtwork): void {
	artwork.sprites.sort(compare_sprites);
}

function Look(artwork: MapArtwork, sprite: MapSprite, shroud: ShroudMap | null): void {
	if (!shroud || !sprite.owned) {
		return;
	}
	const type = type_for_sprite(artwork, sprite);
	if (!type || type.sight <= 0) {
		return;
	}
	shroud.Sight_From(sprite.x, sprite.y, type.sight);
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
		owned: false,
		type_name: "",
		foot: null,
		gate: null,
		...extra,
	};
}

function Make_Gate(type: ShapeType): GateState {
	return {
		stages: Math.max(1, type.gate_stages),
		deploy: Math.max(1, Math.round(type.deploy_time * TICKS_PER_MINUTE) | 0),
		close_delay: Math.max(1, Math.round(type.gate_close_delay * TICKS_PER_MINUTE) | 0),
		status: GATE_CLOSED,
		hold: 0,
		door_count: 0,
		door_active: false,
		door_up: false,
	};
}

export function Reset_Action_Line_Timer(): void {
	ActionLineTimer = 25;
}

export function Action_Line_AI(): void {
	if (ActionLineTimer > 0) {
		ActionLineTimer -= 1;
	}
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
		to_build: rtti_from_name(rules.get_string(name, "Factory", "")),
		tech_level: rules.get_int(name, "TechLevel", 255),
		owners: csv(rules.get_string(name, "Owner", "")),
		prerequisite: csv(rules.get_string(name, "Prerequisite", "")),
		cameo: (art.get_string(art_image, "Cameo", "") || art.get_string(graphic, "Cameo", "") || "XXICON").toUpperCase(),
		cameo_sort: rules.get_int(name, "CameoSortOrder", 0),
		build_limit: rules.get_int(name, "BuildLimit", 0x7fffffff),
		label: rules.get_string(name, "Name", name) || name,
		gate: rules.get_bool(name, "Gate", false),
		sort_defense: rules.get_bool(name, "SortCameoAsBaseDefense", rules.get_bool(name, "IsBaseDefense", false)),
		cost: rules.get_int(name, "Cost", 0),
		adjacent: rules.get_int(name, "Adjacent", 3),
		speed: Scale_To_256(rules.get_int(name, "Speed", 0)),
		gdi_barracks: rules.get_bool(name, "GDIBarracks", false),
		nod_barracks: rules.get_bool(name, "NODBarracks", false),
		exit_coord: rules.get_point(name, "ExitCoord", { x: 0, y: 0 }),
		...read_walk_seq(art, graphic, art_image),
		gate_stages: art.get_int(graphic, "GateStages", 9),
		deploy_time: rules.get_float(name, "DeployTime", 0),
		gate_close_delay: rules.get_float(name, "GateCloseDelay", 0),
		threat_posed: rules.get_int(name, "ThreatPosed", 0),
		threat_avoid: rules.get_float(name, "ThreatAvoidanceCoefficient", 0),
	};
}

function csv(value: string): string[] {
	return value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

function rtti_from_name(raw: string): string {
	const name = raw.replace(/\s/g, "").toLowerCase();
	if (name === "buildingtype" || name === "building") {
		return "BuildingType";
	}
	if (name === "infantrytype" || name === "infantry") {
		return "InfantryType";
	}
	if (name === "unittype" || name === "unit" || name === "vehicletype") {
		return "UnitType";
	}
	if (name === "aircrafttype" || name === "aircraft") {
		return "AircraftType";
	}
	return "";
}

function Acts_Like_From(ini: INIClass, player: string, rules: INIClass): string {
	const houses = list_types(rules, "Houses");
	const fallback = player.toUpperCase();
	const raw = ini.get_string(player, "ActsLike", "").trim();
	if (!raw || raw.toLowerCase() === "<none>") {
		return fallback;
	}
	const named = houses.find((name) => name.toUpperCase() === raw.toUpperCase());
	if (named) {
		return named.toUpperCase();
	}
	if (/^-?\d+$/.test(raw)) {
		const index = Number.parseInt(raw, 10);
		if (index >= 0 && index < houses.length) {
			return houses[index]!.toUpperCase();
		}
	}
	return fallback;
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

function read_walk_seq(art: INIClass, graphic: string, art_image: string): { walk_frame: number; walk_count: number; walk_jump: number } {
	const seq = art.get_string(graphic, "Sequence", "") || art.get_string(art_image, "Sequence", "");
	const walk = seq.length > 0 ? art.get_string(seq, "Walk", "") : "";
	const bits = walk.split(",");
	return {
		walk_frame: Number.parseInt(bits[0]?.trim() ?? "", 10) || 0,
		walk_count: Number.parseInt(bits[1]?.trim() ?? "", 10) || 1,
		walk_jump: Number.parseInt(bits[2]?.trim() ?? "", 10) || 0,
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

function infantry_walk_frame(type: ShapeType, dir: number, stage: number): number {
	const count = Math.max(1, type.walk_count);
	let shapenum = stage % count;
	if (type.walk_jump > 0) {
		shapenum += (HUMAN_SHAPE[round_facing(dir256_raw(dir), 10) % 32] ?? 0) * type.walk_jump;
	}
	return shapenum + type.walk_frame;
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
				type_name: type.name,
				foot: Make_Foot({ x: parsed.x, y: parsed.y }, type.speed),
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
			type_name: type.name,
			foot: rtti === "aircraft" ? null : Make_Foot({ x: parsed.x, y: parsed.y }, type.speed),
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
	player: string,
): MapSprite[] {
	const house = player.toUpperCase();
	const placed: { name: string; x: number; y: number; type: ShapeType; scheme: string; blip: number; health: number; owned: boolean }[] = [];
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
			owned: parsed.house.toUpperCase() === house,
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
					owned: item.owned,
				}),
			);
			continue;
		}
		sprites.push(...structure_sprites(item.x, item.y, item.type, seed, art, item.scheme, item.blip, item.owned, item.health));
	}
	return sprites;
}

function structure_sprites(
	x: number,
	y: number,
	type: ShapeType,
	seed: TheaterSeed,
	art: INIClass,
	scheme: string,
	blip: number,
	owned: boolean,
	health = 256,
): MapSprite[] {
	const sprites: MapSprite[] = [];
	const files = object_files(type, seed);
	if (files.length === 0) {
		return sprites;
	}
	sprites.push(
		make_sprite(x, y, files, type.terrain_palette ? "theater" : "unit", 3, {
			extra_light: type.extra_light,
			scheme,
			selectable: true,
			blip,
			select: building_select(type),
			occupy: type.occupy,
			corner: true,
			rtti: "building",
			health_ratio: ini_health_ratio(health),
			owned,
			type_name: type.name,
			gate: type.gate ? Make_Gate(type) : null,
		}),
	);
	if (type.bib.length > 0) {
		sprites.push(
			make_sprite(x, y, anim_files(type.bib, seed, art), type.terrain_palette ? "theater" : "unit", 4, {
				scheme,
				corner: true,
				owned,
			}),
		);
	}
	for (const anim of type.active) {
		sprites.push(
			make_sprite(x, y, anim_files(anim.stem, seed, art), type.terrain_palette ? "theater" : "unit", 4, {
				ox: anim.x,
				oy: anim.y,
				scheme,
				cast_shadow: false,
				anim: create_anim(read_anim_type(art, anim.stem)),
				corner: true,
				owned,
			}),
		);
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

function owned_counts(ini: INIClass, player: string): Map<string, number> {
	const house = player.toUpperCase();
	const counts = new Map<string, number>();
	const bump = (name: string): void => {
		const key = name.toUpperCase();
		counts.set(key, (counts.get(key) ?? 0) + 1);
	};
	const sections: [string, boolean][] = [
		["Structures", false],
		["Infantry", true],
		["Units", false],
		["Aircraft", false],
	];
	for (const [section, infantry] of sections) {
		const count = ini.entry_count(section);
		for (let i = 0; i < count; i++) {
			const parsed = parse_placed(ini.get_string(section, ini.get_entry(section, i)), infantry);
			if (parsed && parsed.house.toUpperCase() === house) {
				bump(parsed.name);
			}
		}
	}
	return counts;
}

function has_any(counts: Map<string, number>, names: string[]): boolean {
	return names.some((name) => (counts.get(name.toUpperCase()) ?? 0) > 0);
}

function owners_overlap(a: string[], b: string[]): boolean {
	const have = new Set(a.map((name) => name.toUpperCase()));
	return b.some((name) => have.has(name.toUpperCase()));
}

function Who_Can_Build_Me(
	type: ShapeType,
	kind: CameoKind,
	owned: string[],
	buildings: Map<string, ShapeType>,
): boolean {
	return owned.some((name) => {
		const factory = buildings.get(name);
		if (!factory || factory.to_build !== kind) {
			return false;
		}
		return owners_overlap(factory.owners, type.owners);
	});
}

function Can_Build(
	type: ShapeType,
	kind: CameoKind,
	counts: Map<string, number>,
	acts_like: string,
	tech_level: number,
	groups: Record<string, string[]>,
	has_conyard: boolean,
): number {
	if (type.tech_level === -1 || type.tech_level > tech_level) {
		return 0;
	}
	for (const need of type.prerequisite) {
		const group = groups[need.toUpperCase()];
		if (group) {
			if (!has_any(counts, group)) {
				return 0;
			}
			continue;
		}
		if ((counts.get(need.toUpperCase()) ?? 0) === 0) {
			return 0;
		}
	}
	if (kind === "BuildingType") {
		if (type.owners.length === 0 || !type.owners.some((owner) => owner.toUpperCase() === acts_like)) {
			return 0;
		}
		if (!has_conyard) {
			return 0;
		}
	}
	const have = counts.get(type.name.toUpperCase()) ?? 0;
	if (type.build_limit <= 0) {
		return have < Math.abs(type.build_limit) ? 1 : 0;
	}
	return have < type.build_limit ? 1 : -1;
}

function Update_Buildables(
	owned: string[],
	buildings: Map<string, ShapeType>,
	tables: Record<CameoKind, ShapeType[]>,
	counts: Map<string, number>,
	acts_like: string,
	tech_level: number,
	groups: Record<string, string[]>,
): SidebarStrips["Column"] {
	const columns = Make_Strips();
	const has_conyard = owned.some((name) => buildings.get(name)?.to_build === "BuildingType");
	for (const name of owned) {
		const factory = buildings.get(name);
		const kind = factory?.to_build as CameoKind | undefined;
		if (!kind) {
			continue;
		}
		const table = tables[kind];
		if (!table) {
			continue;
		}
		for (let id = 0; id < table.length; id++) {
			const type = table[id]!;
			const allowed = Can_Build(type, kind, counts, acts_like, tech_level, groups, has_conyard);
			if (allowed === 0) {
				continue;
			}
			const column = columns[Which_Column(kind)]!;
			Strip_Add(column, {
				BuildableType: kind,
				BuildableID: id,
				name: type.name,
				cameo: type.cameo || "XXICON",
				label: type.label,
				darken: allowed < 0 || !Who_Can_Build_Me(type, kind, owned, buildings),
				category: Cameo_Category(kind),
				sort: type.cameo_sort,
				group: Cameo_Group(kind, type.wall, type.gate, type.sort_defense),
				Factory: null,
				queue: 0,
			});
		}
	}
	if (Options.SidebarSorting) {
		Sort_Strip(columns[0]!);
		Sort_Strip(columns[1]!);
	}
	return columns;
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

function parse_tubes(ini: INIClass): TubePath[] {
	const tubes: TubePath[] = [];
	const count = ini.entry_count("Tubes");
	for (let i = 0; i < count; i++) {
		const entry = ini.get_entry("Tubes", i);
		const parts = ini.get_string("Tubes", entry).split(",");
		const nums = parts.map((part) => {
			const trimmed = part.trim();
			if (trimmed.length === 0) {
				return Number.NaN;
			}
			return Number(trimmed);
		});
		const enter = { x: nums[0] || 0, y: nums[1] || 0 };
		const dir = nums[2] || 0;
		const exit = { x: nums[3] || 0, y: nums[4] || 0 };
		const dirs: number[] = [];
		for (let d = 5; d < nums.length; d++) {
			const facing = Number.isFinite(nums[d]) ? nums[d]! : -1;
			dirs.push(facing);
			if (facing < 0) {
				break;
			}
		}
		if (dirs.length === 0 || (dirs[dirs.length - 1] ?? -1) >= 0) {
			dirs.push(-1);
		}
		tubes.push({ enter, exit, dir, dirs });
	}
	return tubes;
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
	const player = ini.get_string("Basic", "Player", "GDI") || "GDI";
	const structure_sprites = parse_structures(ini, rules_ini, buildings, seed, art_ini, player);
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
	const credits = ini.get_int(player, "Credits", 0) * 100;
	const lookers = collect_lookers(ini, player, buildings, infantry, units, aircraft);
	const economy = collect_economy(ini, player, buildings);
	const free_radar = ini.get_bool("Basic", "FreeRadar", false);
	const counts = owned_counts(ini, player);
	const acts_like = Acts_Like_From(ini, player, rules_ini);
	const tech_level = ini.get_int(player, "TechLevel", 1);
	const groups = {
		POWER: csv(rules_ini.get_string("General", "PrerequisitePower", "")),
		FACTORY: csv(rules_ini.get_string("General", "PrerequisiteFactory", "")),
		BARRACKS: csv(rules_ini.get_string("General", "PrerequisiteBarracks", "")),
		RADAR: csv(rules_ini.get_string("General", "PrerequisiteRadar", "")),
		TECH: csv(rules_ini.get_string("General", "PrerequisiteTech", "")),
		GDIFACTORY: csv(rules_ini.get_string("General", "PrerequisiteGDIFactory", "")),
		NODFACTORY: csv(rules_ini.get_string("General", "PrerequisiteNodFactory", "")),
	};
	const tables: Record<CameoKind, ShapeType[]> = {
		BuildingType: [...buildings.values()],
		InfantryType: [...infantry.values()],
		UnitType: [...units.values()],
		AircraftType: [...aircraft.values()],
	};
	const owned_buildings = [...counts.keys()].filter((name) => buildings.has(name));
	const columns = Update_Buildables(owned_buildings, buildings, tables, counts, acts_like, tech_level, groups);
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

	ready.sort(compare_sprites);
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
	const cameo_palette = await load_palette(directory, "CAMEO.PAL", log);
	const cameo_shapes = new Map<string, ShapeSet>();
	const cameo_names = new Set<string>(["XXICON"]);
	for (const strip of columns) {
		for (const entry of strip.Buildables) {
			cameo_names.add(entry.cameo);
		}
	}
	for (const name of cameo_names) {
		const packed = await cc_retrieve(directory, `${name}.SHP`);
		const shape = packed ? read_shp(packed) : null;
		if (shape) {
			cameo_shapes.set(name, shape);
		}
	}
	const darken_packed = await cc_retrieve(directory, "DARKEN.SHP");
	const up_packed = await cc_retrieve(directory, "R-UP.SHP");
	const down_packed = await cc_retrieve(directory, "R-DN.SHP");
	const clock_packed = await cc_retrieve(directory, "GCLOCK2.SHP");
	const scheme = house_scheme(ini, rules_ini, player);
	const blip = house_blip(ini, rules_ini, player);
	const build_speed = rules_ini.get_float("General", "BuildSpeed", 1);
	const max_queue = rules_ini.get_int("General", "MaximumQueuedObjects", 5);
	const cliff_back = rules_ini.get_int("General", "CliffBackImpassability", 0);
	log(
		`Sidebar ${columns[0]!.Buildables.length} buildings, ${columns[1]!.Buildables.length} units; ActsLike ${acts_like}, TechLevel ${tech_level}.`,
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
		sidebar: {
			Column: columns,
			palette: cameo_palette,
			shapes: cameo_shapes,
			darken: darken_packed ? read_shp(darken_packed) : null,
			up: up_packed ? read_shp(up_packed) : null,
			down: down_packed ? read_shp(down_packed) : null,
			clock: clock_packed ? read_shp(clock_packed) : null,
		},
		production: {
			player,
			acts_like,
			tech_level,
			groups,
			buildings,
			infantry,
			units,
			tables,
			counts,
			seed,
			scheme,
			blip,
			build_speed,
			factories: new Map(),
			pending: null,
			art: art_ini,
			max_queue,
			cliff_back,
		},
		terrain: new Map(),
		path_graph: null,
		tubes: parse_tubes(ini),
	};
}

export function Factory_AI(artwork: MapArtwork): FactoryObject[] {
	const ready: FactoryObject[] = [];
	for (const factory of artwork.production.factories.values()) {
		factory.AI(artwork.credits, (cost) => {
			artwork.credits -= cost;
		});
		if (factory.Has_Completed() && factory.Object && factory.Object.kind !== "BuildingType" && !factory.IsExiting) {
			factory.IsExiting = true;
			ready.push(factory.Object);
		}
	}
	Refresh_Queue(artwork);
	return ready;
}

export function Bind_Path_Graph(artwork: MapArtwork, cells: Set<string>): void {
	const walls = new Set<string>();
	const bridges: Point2D[] = [];
	const threat = new Map<number, number>();
	for (const sprite of artwork.sprites) {
		if (sprite.wall) {
			walls.add(`${sprite.x},${sprite.y}`);
		}
		if (sprite.bridge) {
			bridges.push({ x: sprite.x, y: sprite.y });
		}
		if (sprite.owned || (sprite.rtti !== "building" && sprite.rtti !== "infantry" && sprite.rtti !== "unit")) {
			continue;
		}
		const type = type_for_sprite(artwork, sprite);
		if (!type || type.threat_posed <= 0) {
			continue;
		}
		const region = Threat_Region(sprite.x, sprite.y);
		threat.set(region, (threat.get(region) ?? 0) + type.threat_posed);
	}
	artwork.path_graph = Build_Path_Graph(
		artwork.terrain,
		cells,
		walls,
		artwork.production.cliff_back,
		artwork.tubes,
		bridges,
		threat,
	);
}

export function Gate_AI(artwork: MapArtwork): void {
	for (const sprite of artwork.sprites) {
		if (sprite.gate) {
			Tick_Gate(artwork, sprite);
		}
	}
}

export async function Place_Completed_Foot(
	directory: GameDirectory,
	artwork: MapArtwork,
	object: FactoryObject,
	play: Rect,
	cells: Set<string>,
	shroud: ShroudMap | null,
): Promise<void> {
	const entry = find_buildable(artwork, object);
	if (!entry) {
		const stalled = artwork.production.factories.get(object.kind);
		if (stalled) {
			stalled.IsExiting = false;
		}
		return;
	}
	await Exit_Object(directory, artwork, entry, play, cells, shroud);
}

export async function Cameo_Left(
	directory: GameDirectory,
	artwork: MapArtwork,
	entry: BuildType,
	play: Rect,
	cells: Set<string>,
	shroud: ShroudMap | null,
): Promise<void> {
	const factory = entry.Factory as FactoryClass | null;
	if (factory?.IsExiting) {
		return;
	}
	if (factory && !factory.Is_Building()) {
		if (factory.Has_Completed()) {
			if (entry.BuildableType === "BuildingType") {
				await Manual_Place(directory, artwork, entry);
			} else {
				await Exit_Object(directory, artwork, entry, play, cells, shroud);
			}
			return;
		}
		Begin_Production(artwork, entry);
		return;
	}
	const existing = artwork.production.factories.get(entry.BuildableType);
	if (existing && (existing.Is_Building() || existing.Has_Production_Target()) && entry.BuildableType === "BuildingType") {
		return;
	}
	Begin_Production(artwork, entry);
}

export function Foot_AI(artwork: MapArtwork, play: Rect, cells: Set<string>, shroud: ShroudMap | null): void {
	let resorted = false;
	for (const sprite of artwork.sprites) {
		const foot = sprite.foot;
		if (!foot) {
			continue;
		}
		const type = type_for_sprite(artwork, sprite);
		const before = Coord_Cell(foot.lx, foot.ly);
		const dest = foot.dest;
		const can_step: PathEnter = (from, to, dir) => foot_step(artwork, sprite, from, to, dest, play, cells, false, dir);
		const can_path: PathEnter = (from, to, dir) => foot_step(artwork, sprite, from, to, dest, play, cells, true, dir);
		const moved = Movement_AI(
			foot,
			can_step,
			(cell) => Try_Open_Gate(artwork, cell),
			can_path,
			artwork.path_graph,
			type?.threat_avoid ?? 0,
		);
		if (!moved) {
			if (type && sprite.rtti === "infantry" && !foot.moving) {
				sprite.frame = infantry_ready_frame(type, sprite.dir);
			}
			continue;
		}
		const placed = Apply_Coord(foot);
		sprite.x = placed.x;
		sprite.y = placed.y;
		sprite.ox = placed.ox;
		sprite.oy = placed.oy;
		if (foot.head) {
			const facing = Direction_Facing({ x: foot.lx, y: foot.ly }, foot.head);
			sprite.dir = Facing_Dir256(facing);
		}
		if (type) {
			if (sprite.rtti === "infantry") {
				sprite.frame = foot.moving
					? infantry_walk_frame(type, sprite.dir, foot.stage)
					: infantry_ready_frame(type, sprite.dir);
			} else if (!sprite.voxel) {
				sprite.frame = unit_stand_frame(type, sprite.dir);
			}
		}
		if (placed.x !== before.x || placed.y !== before.y) {
			resorted = true;
			Look(artwork, sprite, shroud);
		}
	}
	if (resorted) {
		Sort_Sprites(artwork);
	}
}

export function Assign_Move(artwork: MapArtwork, sprite: MapSprite, cell: Point2D, play: Rect, cells: Set<string>): boolean {
	if (!sprite.foot) {
		return false;
	}
	let dest = cell;
	if (!can_enter_foot(artwork, sprite, dest, play, cells, false)) {
		const nearby = nearby_enter(artwork, sprite, dest, play, cells);
		if (!nearby) {
			return false;
		}
		dest = nearby;
	}
	Assign_Destination(sprite.foot, dest);
	Reset_Action_Line_Timer();
	return true;
}

export function Can_Move_To(artwork: MapArtwork, sprite: MapSprite, cell: Point2D, play: Rect, cells: Set<string>): boolean {
	if (can_enter_foot(artwork, sprite, cell, play, cells, false)) {
		return true;
	}
	return nearby_enter(artwork, sprite, cell, play, cells) !== null;
}

async function Exit_Object(
	directory: GameDirectory,
	artwork: MapArtwork,
	entry: BuildType,
	play: Rect,
	cells: Set<string>,
	shroud: ShroudMap | null,
): Promise<boolean> {
	const type = type_from_entry(artwork, entry);
	if (!type || (entry.BuildableType !== "InfantryType" && entry.BuildableType !== "UnitType")) {
		const stalled = artwork.production.factories.get(entry.BuildableType);
		if (stalled) {
			stalled.IsExiting = false;
		}
		return false;
	}
	const factory_sprite = who_can_build_me_sprite(artwork, entry.BuildableType);
	if (!factory_sprite) {
		const stalled = artwork.production.factories.get(entry.BuildableType);
		if (stalled) {
			stalled.IsExiting = false;
		}
		return false;
	}
	const factory_type = artwork.production.buildings.get(factory_sprite.type_name.toUpperCase());
	if (!factory_type) {
		const stalled = artwork.production.factories.get(entry.BuildableType);
		if (stalled) {
			stalled.IsExiting = false;
		}
		return false;
	}
	const exitcell = Find_Exit_Cell(artwork, factory_sprite, factory_type, play, cells);
	if (!exitcell) {
		const stalled = artwork.production.factories.get(entry.BuildableType);
		if (stalled) {
			stalled.IsExiting = false;
		}
		return false;
	}
	const size = occupy_size(factory_type.occupy);
	let to = { ...exitcell };
	if (to.x >= factory_sprite.x + size.w) {
		to.x -= 1;
	} else if (to.x < factory_sprite.x) {
		to.x += 1;
	}
	if (to.y >= factory_sprite.y + size.h) {
		to.y -= 1;
	} else if (to.y < factory_sprite.y) {
		to.y += 1;
	}
	let spawn = Cell_Center(to);
	if (factory_type.gdi_barracks && exitcell.x === factory_sprite.x + 1 && exitcell.y === factory_sprite.y + 2) {
		spawn = { x: spawn.x + factory_type.exit_coord.x, y: spawn.y + factory_type.exit_coord.y };
	}
	if (factory_type.nod_barracks && exitcell.x === factory_sprite.x + 2 && exitcell.y === factory_sprite.y + 2) {
		spawn = { x: spawn.x + factory_type.exit_coord.x, y: spawn.y + factory_type.exit_coord.y };
	}
	const spawn_cell = Coord_Cell(spawn.x, spawn.y);
	const files = object_files(type, artwork.production.seed);
	const rtti = entry.BuildableType === "InfantryType" ? "infantry" : "unit";
	const sprite = make_sprite(spawn_cell.x, spawn_cell.y, files, type.terrain_palette ? "theater" : "unit", rtti === "infantry" ? 2 : 2, {
		scheme: artwork.production.scheme,
		selectable: true,
		blip: artwork.production.blip,
		select: rtti === "infantry" ? { kind: "shape", frame: 2 } : unit_select(type, false),
		rtti,
		owned: true,
		type_name: type.name,
		dir: Facing_Dir256(Direction_Facing(spawn, Cell_Center(exitcell))),
		frame: rtti === "infantry" ? infantry_ready_frame(type, 0) : unit_stand_frame(type, 0),
		foot: Make_Foot(spawn_cell, type.speed),
	});
	sprite.foot!.lx = spawn.x;
	sprite.foot!.ly = spawn.y;
	const placed = Apply_Coord(sprite.foot!);
	sprite.x = placed.x;
	sprite.y = placed.y;
	sprite.ox = placed.ox;
	sprite.oy = placed.oy;
	const ready = await bind_sprite_shapes(directory, artwork, [sprite]);
	if (ready.length === 0) {
		const stalled = artwork.production.factories.get(entry.BuildableType);
		if (stalled) {
			stalled.IsExiting = false;
		}
		return false;
	}
	const born = ready[0]!;
	Assign_Destination(born.foot!, exitcell);
	artwork.sprites.push(born);
	Sort_Sprites(artwork);
	const key = type.name.toUpperCase();
	artwork.production.counts.set(key, (artwork.production.counts.get(key) ?? 0) + 1);
	if (type.sight > 0) {
		artwork.lookers.push({ x: born.x, y: born.y, sight: type.sight });
		shroud?.Sight_From(born.x, born.y, type.sight);
	}
	const factory = artwork.production.factories.get(entry.BuildableType);
	if (factory) {
		factory.Completed();
		Unlink_Factory(artwork, factory);
		if (factory.QueuedObjects.length === 0) {
			artwork.production.factories.delete(entry.BuildableType);
		} else {
			Resume_Queue(artwork, factory, entry.BuildableType);
		}
	}
	Refresh_Queue(artwork);
	await Recalc_Buildables(directory, artwork);
	return true;
}

function who_can_build_me_sprite(artwork: MapArtwork, kind: CameoKind): MapSprite | null {
	for (const sprite of artwork.sprites) {
		if (sprite.rtti !== "building" || !sprite.owned) {
			continue;
		}
		const type = artwork.production.buildings.get(sprite.type_name.toUpperCase());
		if (type?.to_build === kind) {
			return sprite;
		}
	}
	return null;
}

function Find_Exit_Cell(
	artwork: MapArtwork,
	factory: MapSprite,
	type: ShapeType,
	play: Rect,
	cells: Set<string>,
): Point2D | null {
	const try_cell = (cell: Point2D): boolean =>
		In_Radar_Cell(cell.x, cell.y, play) && cells.has(`${cell.x},${cell.y}`) && !building_at(artwork, cell.x, cell.y);
	if (type.gdi_barracks) {
		const cell = { x: factory.x + 1, y: factory.y + 2 };
		if (try_cell(cell)) {
			return cell;
		}
	}
	if (type.nod_barracks) {
		const cell = { x: factory.x + 2, y: factory.y + 2 };
		if (try_cell(cell)) {
			return cell;
		}
	}
	const size = occupy_size(type.occupy);
	for (let x1 = -1; x1 <= size.w; x1++) {
		const north = { x: factory.x + x1, y: factory.y - 1 };
		if (try_cell(north)) {
			return north;
		}
		const south = { x: factory.x + x1, y: factory.y + size.h };
		if (try_cell(south)) {
			return south;
		}
	}
	for (let y1 = -1; y1 <= size.h; y1++) {
		const west = { x: factory.x - 1, y: factory.y + y1 };
		if (try_cell(west)) {
			return west;
		}
		const east = { x: factory.x + size.w, y: factory.y + y1 };
		if (try_cell(east)) {
			return east;
		}
	}
	return null;
}

function building_at(artwork: MapArtwork, x: number, y: number): boolean {
	return artwork.sprites.some((sprite) => {
		if (sprite.wall && sprite.x === x && sprite.y === y) {
			return true;
		}
		if (sprite.rtti !== "building" || !occupies(sprite, sprite.occupy, x, y)) {
			return false;
		}
		if (sprite.gate && Is_Gate_Open(sprite)) {
			return false;
		}
		return true;
	});
}

function can_enter_foot(
	artwork: MapArtwork,
	mover: MapSprite,
	cell: Point2D,
	play: Rect,
	cells: Set<string>,
	allow_gate: boolean,
): boolean {
	if (!In_Radar_Cell(cell.x, cell.y, play) || !cells.has(`${cell.x},${cell.y}`)) {
		return false;
	}
	if (is_cliff_back(artwork, cell)) {
		return false;
	}
	return !artwork.sprites.some((sprite) => {
		if (sprite === mover) {
			return false;
		}
		if (sprite.wall && sprite.x === cell.x && sprite.y === cell.y) {
			return true;
		}
		if (sprite.rtti !== "building" || !occupies(sprite, sprite.occupy, cell.x, cell.y)) {
			return false;
		}
		if (sprite.gate) {
			if (Is_Gate_Open(sprite)) {
				return false;
			}
			if (allow_gate && sprite.owned) {
				return false;
			}
		}
		return true;
	});
}

const CLIFF_BACK_OFFSETS: readonly [number, number][] = [
	[0, -1],
	[-1, 0],
	[2, 2],
	[1, 1],
	[-1, 1],
	[1, -1],
];

function cell_height(artwork: MapArtwork, x: number, y: number): number {
	return artwork.terrain.get(`${x},${y}`)?.height ?? 0;
}

function is_cliff_back(artwork: MapArtwork, cell: Point2D): boolean {
	if (artwork.production.cliff_back !== 2) {
		return false;
	}
	const limit = cell_height(artwork, cell.x, cell.y) + 4;
	return CLIFF_BACK_OFFSETS.some(([dx, dy]) => limit <= cell_height(artwork, cell.x + dx, cell.y + dy));
}

function foot_step(
	artwork: MapArtwork,
	mover: MapSprite,
	from: Point2D,
	to: Point2D,
	dest: Point2D | null,
	play: Rect,
	cells: Set<string>,
	allow_gate: boolean,
	dir = 0,
): boolean {
	if (dir !== TUNNEL && !Can_Reach(from, to, artwork.terrain, artwork.path_graph)) {
		return false;
	}
	if (dest && to.x === dest.x && to.y === dest.y) {
		if (!In_Radar_Cell(to.x, to.y, play) || !cells.has(`${to.x},${to.y}`)) {
			return false;
		}
		return !is_cliff_back(artwork, to);
	}
	return can_enter_foot(artwork, mover, to, play, cells, allow_gate);
}

function nearby_enter(
	artwork: MapArtwork,
	mover: MapSprite,
	cell: Point2D,
	play: Rect,
	cells: Set<string>,
): Point2D | null {
	for (let rad = 1; rad <= 3; rad++) {
		for (let y = -rad; y <= rad; y++) {
			for (let x = -rad; x <= rad; x++) {
				const next = { x: cell.x + x, y: cell.y + y };
				if (can_enter_foot(artwork, mover, next, play, cells, false)) {
					return next;
				}
			}
		}
	}
	return null;
}

function type_for_sprite(artwork: MapArtwork, sprite: MapSprite): ShapeType | null {
	const name = sprite.type_name.toUpperCase();
	if (sprite.rtti === "building") {
		return artwork.production.buildings.get(name) ?? null;
	}
	if (sprite.rtti === "infantry") {
		return artwork.production.infantry.get(name) ?? null;
	}
	if (sprite.rtti === "unit") {
		return artwork.production.units.get(name) ?? null;
	}
	return null;
}

export function Cameo_Right(artwork: MapArtwork, entry: BuildType): void {
	artwork.production.pending = null;
	const slot = entry.Factory as FactoryClass | null;
	if (slot) {
		if (!slot.Is_Building()) {
			artwork.credits += slot.Abandon();
			if (slot.QueuedObjects.length === 0) {
				artwork.production.factories.delete(entry.BuildableType);
				Unlink_Factory(artwork, slot);
			} else {
				Unlink_Factory(artwork, slot);
				Resume_Queue(artwork, slot, entry.BuildableType);
			}
			Refresh_Queue(artwork);
			return;
		}
		slot.Suspend();
		return;
	}
	const factory = artwork.production.factories.get(entry.BuildableType);
	if (factory && factory.Is_Queued(entry.name)) {
		factory.Remove_From_Queue(entry.name);
		Refresh_Queue(artwork);
	}
}

export function Can_Place_Building(
	artwork: MapArtwork,
	cell: Point2D,
	play: Rect,
	shroud: ShroudMap | null,
	cells: Set<string>,
): boolean {
	const pending = artwork.production.pending;
	if (!pending) {
		return false;
	}
	for (const offset of pending.occupy) {
		const x = cell.x + offset.x;
		const y = cell.y + offset.y;
		if (!In_Radar_Cell(x, y, play) || !cells.has(`${x},${y}`)) {
			return false;
		}
		if (shroud && !shroud.IsMapped(x, y)) {
			return false;
		}
		if (cell_blocked(artwork, x, y)) {
			return false;
		}
	}
	return Passes_Proximity(artwork, cell, pending.occupy, pending.adjacent);
}

export async function Place_Pending(
	directory: GameDirectory,
	artwork: MapArtwork,
	cell: Point2D,
	play: Rect,
	shroud: ShroudMap | null,
	cells: Set<string>,
): Promise<boolean> {
	const pending = artwork.production.pending;
	if (!pending || !Can_Place_Building(artwork, cell, play, shroud, cells)) {
		return false;
	}
	const factory = artwork.production.factories.get(pending.kind);
	if (!factory || !factory.Has_Completed() || factory.Object?.name !== pending.name) {
		return false;
	}
	const placed = pending.sprites.map((sprite) => ({ ...sprite, x: cell.x, y: cell.y }));
	const ready = await bind_sprite_shapes(directory, artwork, placed);
	if (ready.length === 0) {
		return false;
	}
	artwork.sprites.push(...ready);
	Sort_Sprites(artwork);
	const type = artwork.production.buildings.get(pending.name);
	if (type) {
		artwork.power_output += type.power;
		artwork.power_drain += type.drain;
		if (type.radar) {
			artwork.has_radar = true;
		}
		if (type.sight > 0) {
			artwork.lookers.push({ x: cell.x, y: cell.y, sight: type.sight });
			shroud?.Sight_From(cell.x, cell.y, type.sight);
		}
		if (type.light_intensity !== 0) {
			const at = building_light_coord(cell.x, cell.y, type.occupy);
			artwork.lights.push({
				x: at.x,
				y: at.y,
				visibility: type.light_visibility,
				intensity: type.light_intensity,
				red: type.light_red,
				green: type.light_green,
				blue: type.light_blue,
			});
		}
	}
	const key = pending.name.toUpperCase();
	artwork.production.counts.set(key, (artwork.production.counts.get(key) ?? 0) + 1);
	factory.Completed();
	artwork.production.factories.delete(pending.kind);
	Unlink_Factory(artwork, factory);
	artwork.production.pending = null;
	await Recalc_Buildables(directory, artwork);
	return true;
}

function Begin_Production(artwork: MapArtwork, entry: BuildType): boolean {
	const type = type_from_entry(artwork, entry);
	if (!type) {
		return false;
	}
	const owned = [...artwork.production.counts.keys()].filter((name) => artwork.production.buildings.has(name));
	if (!Who_Can_Build_Me(type, entry.BuildableType, owned, artwork.production.buildings)) {
		return false;
	}
	let factory = artwork.production.factories.get(entry.BuildableType);
	if (!factory) {
		factory = new FactoryClass();
		factory.max_queue = artwork.production.max_queue;
		artwork.production.factories.set(entry.BuildableType, factory);
	}
	if (factory.Is_Building() && entry.BuildableType === "BuildingType") {
		return false;
	}
	const same =
		factory.IsSuspended &&
		factory.Object !== null &&
		factory.Object.kind === entry.BuildableType &&
		factory.Object.id === entry.BuildableID;
	const current = factory.Object;
	if (!same) {
		if (Is_Build_Limited(artwork, type, factory) && (factory.Is_Building() || factory.Has_Production_Target() || factory.IsSuspended)) {
			return false;
		}
		if (!factory.Set({
			kind: entry.BuildableType,
			id: entry.BuildableID,
			name: type.name,
			cost: type.cost,
			time: Time_To_Build(type.cost, artwork.production.build_speed, artwork.power_output, artwork.power_drain),
		})) {
			return false;
		}
	}
	if (factory.Object === current && factory.QueuedObjects.length > 0 && !same) {
		Refresh_Queue(artwork);
		return true;
	}
	factory.Start();
	Factory_Link(artwork, factory, entry.BuildableType, entry.BuildableID);
	Refresh_Queue(artwork);
	return true;
}

async function Manual_Place(directory: GameDirectory, artwork: MapArtwork, entry: BuildType): Promise<void> {
	if (entry.BuildableType !== "BuildingType" || artwork.production.pending) {
		return;
	}
	const type = artwork.production.buildings.get(entry.name.toUpperCase());
	if (!type) {
		return;
	}
	const sprites = structure_sprites(
		0,
		0,
		type,
		artwork.production.seed,
		artwork.production.art,
		artwork.production.scheme,
		artwork.production.blip,
		true,
	);
	const ready = await bind_sprite_shapes(directory, artwork, sprites);
	if (ready.length === 0) {
		return;
	}
	artwork.production.pending = {
		kind: entry.BuildableType,
		name: type.name,
		occupy: type.occupy,
		adjacent: type.adjacent,
		sprites: ready,
	};
}

async function Recalc_Buildables(directory: GameDirectory, artwork: MapArtwork): Promise<void> {
	const tops = artwork.sidebar.Column.map((strip) => strip.TopIndex);
	const owned = [...artwork.production.counts.keys()].filter((name) => artwork.production.buildings.has(name));
	const columns = Update_Buildables(
		owned,
		artwork.production.buildings,
		artwork.production.tables,
		artwork.production.counts,
		artwork.production.acts_like,
		artwork.production.tech_level,
		artwork.production.groups,
	);
	for (let i = 0; i < columns.length; i++) {
		const strip = columns[i]!;
		strip.TopIndex = Math.max(0, Math.min(tops[i] ?? 0, strip.Buildables.length - 1));
	}
	artwork.sidebar.Column = columns;
	for (const [kind, factory] of artwork.production.factories) {
		if (factory.Object) {
			Factory_Link(artwork, factory, kind, factory.Object.id);
		}
	}
	Refresh_Queue(artwork);
	const names = new Set<string>(["XXICON"]);
	for (const strip of columns) {
		for (const entry of strip.Buildables) {
			names.add(entry.cameo);
		}
	}
	for (const name of names) {
		if (artwork.sidebar.shapes.has(name)) {
			continue;
		}
		const packed = await cc_retrieve(directory, `${name}.SHP`);
		const shape = packed ? read_shp(packed) : null;
		if (shape) {
			artwork.sidebar.shapes.set(name, shape);
		}
	}
}

function Factory_Link(artwork: MapArtwork, factory: FactoryClass, kind: CameoKind, id: number): void {
	for (const strip of artwork.sidebar.Column) {
		for (const entry of strip.Buildables) {
			if (entry.BuildableType === kind && entry.BuildableID === id) {
				entry.Factory = factory;
			}
		}
	}
}

function Unlink_Factory(artwork: MapArtwork, factory: FactoryClass): void {
	for (const strip of artwork.sidebar.Column) {
		for (const entry of strip.Buildables) {
			if (entry.Factory === factory) {
				entry.Factory = null;
			}
		}
	}
}

function Refresh_Queue(artwork: MapArtwork): void {
	for (const strip of artwork.sidebar.Column) {
		for (const entry of strip.Buildables) {
			const factory = artwork.production.factories.get(entry.BuildableType);
			entry.queue = factory ? factory.Total(entry.name) : 0;
		}
	}
}

function Resume_Queue(artwork: MapArtwork, factory: FactoryClass, kind: CameoKind): void {
	if (factory.Object || factory.Is_Building()) {
		return;
	}
	const next = factory.Take_Queue();
	if (!next) {
		return;
	}
	factory.Set(next, true);
	factory.Start();
	Factory_Link(artwork, factory, kind, next.id);
}

function Is_Build_Limited(artwork: MapArtwork, type: ShapeType, factory: FactoryClass): boolean {
	if (type.build_limit >= 0x7fffffff) {
		return false;
	}
	const have = (artwork.production.counts.get(type.name.toUpperCase()) ?? 0) + factory.Total(type.name);
	if (type.build_limit <= 0) {
		return have >= Math.abs(type.build_limit);
	}
	return have >= type.build_limit;
}

function find_buildable(artwork: MapArtwork, object: FactoryObject): BuildType | null {
	for (const strip of artwork.sidebar.Column) {
		for (const entry of strip.Buildables) {
			if (entry.BuildableType === object.kind && entry.BuildableID === object.id) {
				return entry;
			}
		}
	}
	return {
		BuildableType: object.kind,
		BuildableID: object.id,
		name: object.name,
		cameo: "XXICON",
		label: object.name,
		darken: false,
		category: 0,
		sort: 0,
		group: 0,
		Factory: artwork.production.factories.get(object.kind) ?? null,
		queue: 0,
	};
}

function Is_Gate_Open(sprite: MapSprite): boolean {
	const gate = sprite.gate;
	if (!gate) {
		return true;
	}
	return gate.status === GATE_OPEN && !gate.door_active && gate.door_up;
}

function Try_Open_Gate(artwork: MapArtwork, cell: Point2D): boolean {
	const sprite = gate_at(artwork, cell);
	if (!sprite || !sprite.owned) {
		return false;
	}
	if (Is_Gate_Open(sprite)) {
		return false;
	}
	Open_Gate(sprite);
	return true;
}

function gate_at(artwork: MapArtwork, cell: Point2D): MapSprite | null {
	for (const sprite of artwork.sprites) {
		if (sprite.gate && occupies(sprite, sprite.occupy, cell.x, cell.y)) {
			return sprite;
		}
	}
	return null;
}

function Open_Gate(sprite: MapSprite): void {
	const gate = sprite.gate;
	if (!gate) {
		return;
	}
	if (gate.status === GATE_OPENING || gate.status === GATE_OPEN) {
		return;
	}
	if (gate.status === GATE_CLOSING && gate.door_active) {
		gate.door_up = true;
		gate.door_count = Math.max(0, gate.deploy - gate.door_count);
		gate.status = GATE_OPENING;
		return;
	}
	gate.status = GATE_START_OPENING;
}

function Tick_Gate(artwork: MapArtwork, sprite: MapSprite): void {
	const gate = sprite.gate;
	if (!gate) {
		return;
	}
	if (gate.door_active) {
		gate.door_count += 1;
		if (gate.door_count >= gate.deploy) {
			gate.door_active = false;
			gate.door_count = gate.deploy;
		}
	}
	switch (gate.status) {
		case GATE_START_OPENING:
			if (!gate.door_active && gate.door_up) {
				gate.hold = gate.close_delay;
				gate.status = GATE_OPEN;
				break;
			}
			if (!gate.door_active) {
				gate.door_active = true;
				gate.door_count = 0;
				gate.door_up = true;
			}
			gate.status = GATE_OPENING;
			gate.hold = gate.close_delay;
			break;
		case GATE_START_CLOSING:
			gate.door_active = true;
			gate.door_count = 0;
			gate.door_up = false;
			gate.status = GATE_CLOSING;
			break;
		case GATE_OPEN:
			if (gate_blocked(artwork, sprite)) {
				gate.hold = gate.close_delay;
			} else if (gate.hold > 0) {
				gate.hold -= 1;
			} else {
				gate.status = GATE_START_CLOSING;
			}
			break;
		case GATE_OPENING:
			if (!gate.door_active && gate.door_up) {
				gate.status = GATE_OPEN;
				gate.hold = gate.close_delay;
			}
			break;
		case GATE_CLOSING:
			if (!gate.door_active && !gate.door_up) {
				gate.status = GATE_CLOSED;
			}
			break;
		default:
			break;
	}
	sprite.frame = gate_frame(gate);
}

function gate_percent(gate: GateState): number {
	if (gate.deploy <= 0) {
		return gate.door_up ? 1 : 0;
	}
	if (!gate.door_active) {
		return gate.door_up ? 1 : 0;
	}
	return Math.min(1, gate.door_count / gate.deploy);
}

function gate_frame(gate: GateState): number {
	if (gate.status === GATE_CLOSED && !gate.door_active) {
		return 0;
	}
	let shapenum = (gate_percent(gate) * gate.stages) | 0;
	if (!gate.door_up) {
		shapenum = gate.stages - shapenum;
	}
	if (!gate.door_active && gate.door_up) {
		shapenum = gate.stages - 1;
	}
	if (!gate.door_active && !gate.door_up) {
		shapenum = 0;
	}
	if (shapenum >= gate.stages) {
		shapenum = gate.stages - 1;
	}
	if (shapenum < 0) {
		shapenum = 0;
	}
	return shapenum;
}

function gate_blocked(artwork: MapArtwork, gate: MapSprite): boolean {
	return artwork.sprites.some((sprite) => {
		if (!sprite.foot || sprite === gate) {
			return false;
		}
		return occupies(gate, gate.occupy, sprite.x, sprite.y);
	});
}

function type_from_entry(artwork: MapArtwork, entry: BuildType): ShapeType | null {
	const table = artwork.production.tables[entry.BuildableType];
	return table?.[entry.BuildableID] ?? null;
}

function In_Radar_Cell(x: number, y: number, play: Rect): boolean {
	const w = play.width;
	const h = play.height;
	return x + y > w && x - y < w && y - x < w && x + y <= w + 2 * h;
}

function cell_blocked(artwork: MapArtwork, x: number, y: number): boolean {
	return artwork.sprites.some((sprite) => {
		if (!sprite.rtti) {
			return false;
		}
		return occupies(sprite, sprite.occupy, x, y);
	});
}

function Passes_Proximity(
	artwork: MapArtwork,
	origin: Point2D,
	occupy: { x: number; y: number }[],
	adjacent: number,
): boolean {
	const size = occupy_size(occupy);
	const adj = adjacent + 1;
	const xmin = origin.x - adj;
	const ymin = origin.y - adj;
	const xmax = xmin + 2 * adj + size.w;
	const ymax = ymin + 2 * adj + size.h;
	for (let x = xmin; x < xmax; x++) {
		for (let y = ymin; y < ymax; y++) {
			if (x >= origin.x && x < origin.x + size.w && y >= origin.y && y < origin.y + size.h) {
				continue;
			}
			for (const sprite of artwork.sprites) {
				if (!sprite.owned || sprite.rtti !== "building") {
					continue;
				}
				if (occupies(sprite, sprite.occupy, x, y)) {
					return true;
				}
			}
		}
	}
	return false;
}

async function bind_sprite_shapes(
	directory: GameDirectory,
	artwork: MapArtwork,
	sprites: MapSprite[],
): Promise<MapSprite[]> {
	const cache = new Map<string, ShapeSet | null>();
	for (const [key, shape] of artwork.shapes) {
		cache.set(key, shape);
	}
	const ready: MapSprite[] = [];
	for (const sprite of sprites) {
		const key = await fetch_shape(directory, cache, sprite.names);
		if (!key) {
			continue;
		}
		const shape = cache.get(key);
		if (!shape) {
			continue;
		}
		artwork.shapes.set(key, shape);
		if (sprite.anim) {
			bind_anim_shape(sprite.anim, shape.frames.length);
			ready.push({ ...sprite, file: key, frame: sprite.anim.start + sprite.anim.stage });
		} else {
			ready.push({ ...sprite, file: key });
		}
	}
	return ready;
}
