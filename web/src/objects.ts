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
import {
	Acts_Like_Name,
	Assign_Campaign_Player,
	Do_HouseTypes,
	HouseClass,
	House_From_Name,
	Houses,
	HOUSE_NONE,
	Init_Houses,
	Init_HouseTypes,
	PlayerPtr,
	Read_HouseType_INI,
} from "./house";
import { INIClass, type Point2D, type Rect } from "./ini";
import {
	FIRE_AMMO,
	FIRE_CANT,
	FIRE_ILLEGAL,
	FIRE_OK,
	FIRE_RANGE,
	FIRE_REARM,
	Armor_From_Name,
	In_Range,
	Modify_Damage,
	Read_Combat_Tables,
	Find_Or_Make_Weapon,
	type BulletTypeClass,
	type WarheadTypeClass,
	type WeaponTypeClass,
} from "./weapon";
import { ISO_TILE_PIXEL_H, LEVEL_PIXEL_H } from "./isotile";
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
	Can_Add_Waypoint_To_Path,
	Fetch_Waypoint_Data,
	Get_Next_Waypoint,
	Make_Paths,
	New_Waypoint_Path,
	PATH_NONE,
	Place_Waypoint,
	Select_Waypoint,
	Waypoint_At,
	type WaypointClass,
	type WaypointPathClass,
} from "./waypoint";
import {
	Adjacent_Cell,
	Apply_Coord,
	Assign_Destination,
	Can_Reach,
	Cell_Center,
	Coord_Cell,
	Direction_Facing,
	FACING_NONE,
	Facing_Dir256,
	Fly_AI,
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
const INFANTRY_SPOT_MASK = 0x1c;
const SPOT_SEQUENCE: readonly (readonly number[])[] = [
	[1, 2, 3, 4],
	[0, 2, 3, 4],
	[0, 1, 4, 3],
	[0, 1, 4, 2],
	[0, 2, 3, 1],
];
const SPOT_ALTERNATE: readonly (readonly number[])[] = [
	[1, 2, 3, 4],
	[2, 3, 4, 1],
	[3, 4, 1, 2],
	[4, 1, 2, 3],
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
	strength: number;
	veteran: boolean;
	bridge: boolean;
	owned: boolean;
	house: number;
	type_name: string;
	foot: FootState | null;
	gate: GateState | null;
	repairing: boolean;
	is_on: boolean;
	is_selected: boolean;
	damage_names: string[];
	healthy_file: string;
	damage_file: string;
	tarcom: MapSprite | null;
	arm: number;
	ammo: number;
	attack_mission: boolean;
};

export type BulletClass = {
	lx: number;
	ly: number;
	tx: number;
	ty: number;
	target: MapSprite | null;
	speed: number;
	damage: number;
	warhead: WarheadTypeClass;
	payback: MapSprite | null;
};

export type MapArtwork = {
	sprites: MapSprite[];
	shapes: Map<string, ShapeSet>;
	theater_palette: Uint16Array;
	unit_palette: Uint16Array;
	normal_palette: Uint16Array;
	schemes: Map<string, Uint16Array>;
	lighting: ScenarioLighting;
	lights: MapLightSource[];
	credits: number;
	voxels: Map<string, VoxelModel>;
	lookers: SightLooker[];
	shroud: ShapeSet | null;
	select: ShapeSet | null;
	pips: ShapeSet | null;
	condition_green: number;
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
	is_repair_mode: boolean;
	is_sell_mode: boolean;
	is_power_mode: boolean;
	is_waypoint_mode: boolean;
	paths: WaypointPathClass[];
	selected_path: number;
	dragged_waypoint: WaypointClass | null;
	dragged_home: Point2D | null;
	frame: number;
	current_object: MapSprite[];
	is_rubber_band: boolean;
	is_tentative: boolean;
	band_x: number;
	band_y: number;
	new_x: number;
	new_y: number;
	rubber_band_start: Point2D;
	rubber_band_end: Point2D;
	weapons: Map<string, WeaponTypeClass>;
	warheads: Map<string, WarheadTypeClass>;
	projectiles: Map<string, BulletTypeClass>;
	bullets: BulletClass[];
	min_damage: number;
	max_damage: number;
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
	aircraft: Map<string, ShapeType>;
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
	repair_step: number;
	repair_percent: number;
	repair_rate: number;
	refund_percent: number;
	flight_level: number;
	max_waypoint_path_length: number;
	waypoint_animation_speed: number;
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
	damaged: string;
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
	idle_start: number;
	idle_count: number;
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
	strength: number;
	repairable: boolean;
	unsellable: boolean;
	powered: boolean;
	toggle_power: boolean;
	helipad: boolean;
	flight_level: number;
	undeploys_into: string;
	construction_yard: boolean;
	unit_repair: boolean;
	mobile_war: boolean;
	armory: boolean;
	weapons_factory: boolean;
	leader: boolean;
	insignificant: boolean;
	primary: string;
	armor: number;
	ammo: number;
	legal_target: boolean;
	immune: boolean;
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
		strength: 0,
		veteran: false,
		bridge: false,
		owned: false,
		house: HOUSE_NONE,
		type_name: "",
		foot: null,
		gate: null,
		repairing: false,
		is_on: true,
		is_selected: false,
		damage_names: [],
		healthy_file: "",
		damage_file: "",
		tarcom: null,
		arm: 0,
		ammo: -1,
		attack_mission: false,
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
		["ActiveAnim", "ActiveAnimDamaged", "ActiveAnimX", "ActiveAnimY"],
		["ActiveAnimTwo", "ActiveAnimTwoDamaged", "ActiveAnimTwoX", "ActiveAnimTwoY"],
		["ActiveAnimThree", "ActiveAnimThreeDamaged", "ActiveAnimThreeX", "ActiveAnimThreeY"],
		["ActiveAnimFour", "ActiveAnimFourDamaged", "ActiveAnimFourX", "ActiveAnimFourY"],
	];
	for (const keys of anim_keys) {
		const stem = art.get_string(section, keys[0]!, "");
		if (stem.length > 0) {
			const damaged = art.get_string(section, keys[1]!, "") || stem;
			active.push({
				stem,
				damaged,
				x: art.get_int(section, keys[2]!, 0),
				y: art.get_int(section, keys[3]!, 0),
			});
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
		...read_idle_anim(art, graphic, art_image),
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
		strength: Math.max(1, rules.get_int(name, "Strength", 1)),
		repairable: rules.get_bool(name, "Repairable", true),
		unsellable: rules.get_bool(name, "Unsellable", false),
		powered: rules.get_bool(name, "Powered", false),
		toggle_power: rules.get_bool(name, "TogglePower", true),
		helipad: rules.get_bool(name, "Helipad", false),
		flight_level: rules.get_int(name, "FlightLevel", -1),
		undeploys_into: rules.get_string(name, "UndeploysInto", ""),
		construction_yard: rules.get_bool(name, "ConstructionYard", false),
		unit_repair: rules.get_bool(name, "UnitRepair", false),
		mobile_war: rules.get_bool(name, "IsMobileWar", false),
		armory: rules.get_bool(name, "Armory", false),
		weapons_factory: rules.get_bool(name, "WeaponsFactory", false),
		leader: (() => {
			const primary = rules.get_string(name, "Primary", "");
			return primary !== "" && primary.toLowerCase() !== "none";
		})(),
		insignificant: rules.get_bool(name, "Insignificant", false),
		primary: rules.get_string(name, "Primary", ""),
		armor: Armor_From_Name(rules.get_string(name, "Armor", "none")),
		ammo: rules.get_int(name, "Ammo", -1),
		legal_target: rules.get_bool(name, "LegalTarget", true),
		immune: rules.get_bool(name, "Immune", false),
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

function read_idle_anim(art: INIClass, graphic: string, art_image: string): { idle_start: number; idle_count: number } {
	const raw = art.get_string(graphic, "AnimIdle", "") || art.get_string(art_image, "AnimIdle", "0,1,0");
	const bits = raw.split(",");
	return {
		idle_start: Number.parseInt(bits[0]?.trim() ?? "", 10) || 0,
		idle_count: Math.max(1, Number.parseInt(bits[1]?.trim() ?? "", 10) || 1),
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

function house_blip_scheme(ini: INIClass, rules: INIClass, scheme: string): number {
	const hsv = color_hsv(ini, rules, scheme);
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

function ini_hitpoints(ratio_256: number, max: number, keep_alive: boolean): number {
	const n = Math.min(Math.max(ratio_256, 0), 256);
	let strength = Math.trunc(max * (n / 256));
	if (strength > max - 3) {
		strength = max;
	}
	if (keep_alive && strength < 1) {
		strength = 1;
	}
	return strength;
}

export function Get_Health_Ratio(strength: number, max: number): number {
	return max > 0 ? strength / max : 1;
}

export function Health_Ratio(artwork: MapArtwork, sprite: MapSprite): number {
	const type = type_for_sprite(artwork, sprite);
	return Get_Health_Ratio(sprite.strength, type?.strength ?? 0);
}

function set_hitpoints(sprite: MapSprite, hitpoints: number, max: number): void {
	sprite.strength = Math.max(0, Math.min(max, hitpoints));
	sprite.health_ratio = Get_Health_Ratio(sprite.strength, max);
}

function spawn_health(ratio_256: number, max: number, keep_alive: boolean): { strength: number; health_ratio: number } {
	const strength = ini_hitpoints(ratio_256, max, keep_alive);
	return { strength, health_ratio: Get_Health_Ratio(strength, max) };
}

function Considered_Vehicle(type: ShapeType | null): boolean {
	if (!type || !type.undeploys_into) {
		return false;
	}
	return !type.construction_yard;
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
		const owner = House_From_Name(parsed.house);
		if (!owner) {
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
		const sprite = make_sprite(parsed.x, parsed.y, files, type.terrain_palette ? "theater" : "unit", 2, {
			frame: infantry_ready_frame(type, parsed.dir),
			scheme: type.terrain_palette ? "" : owner.Scheme,
			selectable: true,
			blip: house_blip_scheme(ini, rules, owner.Scheme),
			select: { kind: "shape", frame: parsed.veteran ? 6 : 2 },
			rtti: "infantry",
			...spawn_health(parsed.health, type.strength, true),
			veteran: parsed.veteran,
			type_name: type.name,
			house: owner.HeapID,
			owned: owner === PlayerPtr,
			ammo: type.ammo,
			foot: Make_Foot({ x: parsed.x, y: parsed.y }, type.speed),
		});
		owner.Tracking_Add(sprite.rtti, sprite.type_name, Considered_Vehicle(type), type.insignificant);
		const from = spot_coord({ x: parsed.x, y: parsed.y }, parsed.sub);
		const claimed = Closest_Free_Spot(sprites, sprite, { x: parsed.x, y: parsed.y }, from, sprites.length);
		if (claimed && sprite.foot) {
			sprite.foot.lx = claimed.x;
			sprite.foot.ly = claimed.y;
			const placed = Apply_Coord(sprite.foot);
			sprite.x = placed.x;
			sprite.y = placed.y;
			sprite.ox = placed.ox;
			sprite.oy = placed.oy;
		}
		sprites.push(sprite);
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
		const owner = House_From_Name(parsed.house);
		if (!owner) {
			continue;
		}
		const type = types.get(parsed.name.toUpperCase());
		if (!type || type.invisible || type.wall) {
			continue;
		}
		const scheme = type.terrain_palette ? "" : owner.Scheme;
		const rtti = section === "Aircraft" ? "aircraft" : "unit";
		const extra = {
			scheme,
			selectable: true as const,
			blip: house_blip_scheme(ini, rules, owner.Scheme),
			house: owner.HeapID,
			owned: owner === PlayerPtr,
			select: unit_select(type, parsed.veteran),
			rtti: rtti as "unit" | "aircraft",
			...spawn_health(parsed.health, type.strength, true),
			veteran: parsed.veteran,
			type_name: type.name,
			ammo: type.ammo,
			foot: Make_Foot({ x: parsed.x, y: parsed.y }, type.speed),
		};
		if (type.voxel) {
			const sprite = make_sprite(parsed.x, parsed.y, [], "unit", layer, {
				voxel: type.voxel_stem,
				dir: parsed.dir,
				...extra,
			});
			owner.Tracking_Add(sprite.rtti, sprite.type_name, Considered_Vehicle(type), type.insignificant);
			sprites.push(sprite);
			continue;
		}
		const files = object_files(type, seed);
		if (files.length === 0) {
			continue;
		}
		const sprite = make_sprite(parsed.x, parsed.y, files, type.terrain_palette ? "theater" : "unit", layer, {
			frame: unit_stand_frame(type, parsed.dir),
			...extra,
		});
		owner.Tracking_Add(sprite.rtti, sprite.type_name, Considered_Vehicle(type), type.insignificant);
		sprites.push(sprite);
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
	const placed: {
		name: string;
		x: number;
		y: number;
		type: ShapeType;
		scheme: string;
		blip: number;
		health: number;
		owned: boolean;
		house: number;
		owner: HouseClass;
	}[] = [];
	const count = ini.entry_count("Structures");
	for (let i = 0; i < count; i++) {
		const parsed = parse_placed(ini.get_string("Structures", ini.get_entry("Structures", i)), false);
		if (!parsed) {
			continue;
		}
		const owner = House_From_Name(parsed.house);
		if (!owner) {
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
			scheme: type.terrain_palette ? "" : owner.Scheme,
			blip: house_blip_scheme(ini, rules, owner.Scheme),
			health: parsed.health,
			owned: owner === PlayerPtr,
			house: owner.HeapID,
			owner,
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
					house: item.house,
				}),
			);
			continue;
		}
		sprites.push(
			...structure_sprites(item.x, item.y, item.type, seed, art, item.scheme, item.blip, item.owned, item.house, item.owner, item.health),
		);
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
	house = HOUSE_NONE,
	owner: HouseClass | null = null,
	health = 256,
): MapSprite[] {
	const sprites: MapSprite[] = [];
	const files = object_files(type, seed);
	if (files.length === 0) {
		return sprites;
	}
	const hits = spawn_health(health, type.strength, false);
	const building = make_sprite(x, y, files, type.terrain_palette ? "theater" : "unit", 3, {
		extra_light: type.extra_light,
		scheme,
		selectable: true,
		blip,
		select: building_select(type),
		occupy: type.occupy,
		corner: true,
		rtti: "building",
		...hits,
		owned,
		house,
		type_name: type.name,
		ammo: type.ammo,
		gate: type.gate ? Make_Gate(type) : null,
	});
	sprites.push(building);
	if (owner) {
		owner.Tracking_Add(building.rtti, building.type_name, Considered_Vehicle(type), type.insignificant);
	}
	if (type.bib.length > 0) {
		sprites.push(
			make_sprite(x, y, anim_files(type.bib, seed, art), type.terrain_palette ? "theater" : "unit", 4, {
				scheme,
				corner: true,
				owned,
				house,
			}),
		);
	}
	for (const anim of type.active) {
		const damaged = anim.damaged !== anim.stem ? anim_files(anim.damaged, seed, art) : [];
		sprites.push(
			make_sprite(x, y, anim_files(anim.stem, seed, art), type.terrain_palette ? "theater" : "unit", 4, {
				ox: anim.x,
				oy: anim.y,
				scheme,
				cast_shadow: false,
				anim: create_anim(read_anim_type(art, anim.stem)),
				corner: true,
				owned,
				house,
				damage_names: damaged,
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
		if (!parsed || !House_From_Name(parsed.house)) {
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
	_player: string,
	buildings: Map<string, ShapeType>,
	infantry: Map<string, ShapeType>,
	units: Map<string, ShapeType>,
	aircraft: Map<string, ShapeType>,
): SightLooker[] {
	const lookers: SightLooker[] = [];
	const add = (section: string, types: Map<string, ShapeType>, infantry_line: boolean): void => {
		const count = ini.entry_count(section);
		for (let i = 0; i < count; i++) {
			const parsed = parse_placed(ini.get_string(section, ini.get_entry(section, i)), infantry_line);
			if (!parsed) {
				continue;
			}
			const owner = House_From_Name(parsed.house);
			if (!owner || owner !== PlayerPtr) {
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

function owned_counts(ini: INIClass, _player: string): Map<string, number> {
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
			if (parsed) {
				const owner = House_From_Name(parsed.house);
				if (owner && owner === PlayerPtr) {
					bump(parsed.name);
				}
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
	_player: string,
	buildings: Map<string, ShapeType>,
): { output: number; drain: number; has_radar: boolean } {
	let output = 0;
	let drain = 0;
	let has_radar = false;
	const count = ini.entry_count("Structures");
	for (let i = 0; i < count; i++) {
		const parsed = parse_placed(ini.get_string("Structures", ini.get_entry("Structures", i)), false);
		if (!parsed) {
			continue;
		}
		const owner = House_From_Name(parsed.house);
		if (!owner || owner !== PlayerPtr) {
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
	const normal_palette = await load_palette(directory, "PALETTE.PAL", log);

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

	Init_HouseTypes();
	Do_HouseTypes(rules_ini);
	Read_HouseType_INI(rules_ini);
	Init_Houses();
	HouseClass.Read_All(ini, rules_ini.get_int("IQ", "MaxIQLevels", 5), 1);
	Assign_Campaign_Player(ini);
	const player_house = PlayerPtr;
	const player = player_house?.Class.Name() || ini.get_string("Basic", "Player", "GDI") || "GDI";

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
	const credits = player_house?.Credits ?? 0;
	const lookers = collect_lookers(ini, player, buildings, infantry, units, aircraft);
	const economy = collect_economy(ini, player, buildings);
	const free_radar = ini.get_bool("Basic", "FreeRadar", false);
	const counts = owned_counts(ini, player);
	const acts_like = player_house ? Acts_Like_Name(player_house) : Acts_Like_From(ini, player, rules_ini);
	const tech_level = player_house?.Control.TechLevel ?? ini.get_int(player, "TechLevel", 1);
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
	const condition_green = 1;
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
	log(
		`Houses ${Houses.map((house) => house.Class.Name()).join(", ") || "none"}; player ${player}.`,
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
		const damage_file = await fetch_damage_file(directory, cache, shapes, sprite);
		if (sprite.anim) {
			bind_anim_shape(sprite.anim, shape.frames.length);
			ready.push({ ...sprite, file: key, healthy_file: key, damage_file, frame: sprite.anim.start + sprite.anim.stage });
		} else {
			ready.push({ ...sprite, file: key, healthy_file: key, damage_file });
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
	const scheme = player_house?.Scheme || house_scheme(ini, rules_ini, player);
	const blip = house_blip_scheme(ini, rules_ini, scheme);
	const build_speed = rules_ini.get_float("General", "BuildSpeed", 1);
	const max_queue = rules_ini.get_int("General", "MaximumQueuedObjects", 5);
	const cliff_back = rules_ini.get_int("General", "CliffBackImpassability", 0);
	log(
		`Sidebar ${columns[0]!.Buildables.length} buildings, ${columns[1]!.Buildables.length} units; ActsLike ${acts_like}, TechLevel ${tech_level}.`,
	);
	const combat = Read_Combat_Tables(rules_ini);
	for (const table of [buildings, infantry, units, aircraft]) {
		for (const type of table.values()) {
			Find_Or_Make_Weapon(rules_ini, type.primary, combat);
		}
	}
	log(`Weapons ${combat.weapons.size}, warheads ${combat.warheads.size}, projectiles ${combat.bullets.size}.`);
	const artwork: MapArtwork = {
		sprites: ready,
		shapes,
		theater_palette,
		unit_palette,
		normal_palette,
		schemes,
		lighting,
		lights,
		credits,
		voxels: voxels_ready,
		lookers,
		shroud,
		select,
		pips,
		condition_green,
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
			aircraft,
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
			repair_step: Math.max(1, rules_ini.get_int("General", "RepairStep", 5)),
			repair_percent: rules_ini.get_float("General", "RepairPercent", 0.25),
			repair_rate: rules_ini.get_float("General", "RepairRate", 0.016),
			refund_percent: rules_ini.get_float("General", "RefundPercent", 0.5),
			flight_level: rules_ini.get_int("General", "FlightLevel", 500),
			max_waypoint_path_length: Math.max(1, rules_ini.get_int("General", "MaxWaypointPathLength", 15)),
			waypoint_animation_speed: Math.max(1, rules_ini.get_int("AudioVisual", "WaypointAnimationSpeed", 12)),
		},
		terrain: new Map(),
		path_graph: null,
		tubes: parse_tubes(ini),
		is_repair_mode: false,
		is_sell_mode: false,
		is_power_mode: false,
		is_waypoint_mode: false,
		paths: Make_Paths(),
		selected_path: PATH_NONE,
		dragged_waypoint: null,
		dragged_home: null,
		frame: 0,
		current_object: [],
		is_rubber_band: false,
		is_tentative: false,
		band_x: 0,
		band_y: 0,
		new_x: 0,
		new_y: 0,
		rubber_band_start: { x: 0, y: 0 },
		rubber_band_end: { x: 0, y: 0 },
		weapons: combat.weapons,
		warheads: combat.warheads,
		projectiles: combat.bullets,
		bullets: [],
		min_damage: combat.min_damage,
		max_damage: combat.max_damage,
	};
	for (const sprite of artwork.sprites) {
		if (sprite.rtti === "building") {
			Apply_Health_Status(artwork, sprite);
		}
	}
	return artwork;
}

export function Factory_AI(artwork: MapArtwork): FactoryObject[] {
	const ready: FactoryObject[] = [];
	for (const factory of artwork.production.factories.values()) {
		factory.AI(artwork.credits, (cost) => {
			Spend_Credits(artwork, cost);
		});
		if (factory.ExitingFoot && exit_radio_clear(artwork, factory)) {
			factory.ExitingFoot = null;
		}
		if (
			factory.Has_Completed() &&
			factory.Object &&
			factory.Object.kind !== "BuildingType" &&
			!factory.IsExiting &&
			!factory.ExitingFoot
		) {
			factory.IsExiting = true;
			ready.push(factory.Object);
		}
	}
	Refresh_Queue(artwork);
	return ready;
}

export function Display_AI(artwork: MapArtwork): void {
	artwork.frame += 1;
	Repair_AI(artwork);
}

function Primary_Weapon(artwork: MapArtwork, sprite: MapSprite): WeaponTypeClass | null {
	const type = type_for_sprite(artwork, sprite);
	if (!type?.primary) {
		return null;
	}
	return artwork.weapons.get(type.primary.toUpperCase()) ?? null;
}

function Center_Coord(artwork: MapArtwork, sprite: MapSprite): Point2D {
	if (sprite.foot) {
		return { x: sprite.foot.lx, y: sprite.foot.ly };
	}
	const type = type_for_sprite(artwork, sprite);
	if (type && type.occupy.length > 1) {
		return Cell_Center(occupy_center(sprite, type.occupy));
	}
	return Cell_Center({ x: sprite.x, y: sprite.y });
}

function Building_Span(artwork: MapArtwork, sprite: MapSprite): number {
	if (sprite.rtti !== "building") {
		return 0;
	}
	const type = type_for_sprite(artwork, sprite);
	if (!type) {
		return 0;
	}
	let width = 1;
	let height = 1;
	for (const cell of type.occupy) {
		width = Math.max(width, cell.x + 1);
		height = Math.max(height, cell.y + 1);
	}
	return width + height;
}

function Is_Ally_Sprite(a: MapSprite, b: MapSprite): boolean {
	if (a === b) {
		return true;
	}
	const left = Houses[a.house];
	const right = Houses[b.house];
	if (!left || !right) {
		return false;
	}
	return left.Is_Ally(right);
}

export function In_Range_Of(artwork: MapArtwork, sprite: MapSprite, target: MapSprite): boolean {
	const weapon = Primary_Weapon(artwork, sprite);
	if (!weapon) {
		return false;
	}
	return In_Range(Center_Coord(artwork, sprite), Center_Coord(artwork, target), weapon, Building_Span(artwork, target));
}

export function Can_Player_Fire(artwork: MapArtwork, sprite: MapSprite): boolean {
	if (!sprite.owned || sprite.strength <= 0) {
		return false;
	}
	const house = Houses[sprite.house];
	if (!house?.Is_Player_Control()) {
		return false;
	}
	return Primary_Weapon(artwork, sprite) !== null;
}

function Can_Fire(artwork: MapArtwork, sprite: MapSprite, target: MapSprite | null): number {
	if (!target) {
		return FIRE_ILLEGAL;
	}
	const weapon = Primary_Weapon(artwork, sprite);
	if (!weapon || !weapon.Bullet) {
		return FIRE_CANT;
	}
	if (sprite.rtti === "building" && !sprite.is_on) {
		const type = type_for_sprite(artwork, sprite);
		if (type && (type.powered || type.drain > 0)) {
			return FIRE_CANT;
		}
	}
	if (target.rtti === "aircraft" && !weapon.Bullet.IsAntiAircraft) {
		return FIRE_CANT;
	}
	if (target.rtti !== "aircraft" && !weapon.Bullet.IsAntiGround) {
		return FIRE_CANT;
	}
	if (sprite.arm !== 0) {
		return FIRE_REARM;
	}
	if (!In_Range_Of(artwork, sprite, target)) {
		return FIRE_RANGE;
	}
	if (!sprite.ammo) {
		return FIRE_AMMO;
	}
	return FIRE_OK;
}

export function What_Action(artwork: MapArtwork, sprite: MapSprite, target: MapSprite): "attack" | "select" | "none" {
	if (target === sprite) {
		return "none";
	}
	if (!sprite.owned || !Can_Player_Fire(artwork, sprite)) {
		return "select";
	}
	if (Is_Ally_Sprite(sprite, target)) {
		return "select";
	}
	const type = type_for_sprite(artwork, target);
	if (type && !type.legal_target) {
		return "none";
	}
	if (sprite.foot || In_Range_Of(artwork, sprite, target)) {
		return "attack";
	}
	return "none";
}

export function Assign_Target(sprite: MapSprite, target: MapSprite | null, chase = false): void {
	if (target === sprite) {
		target = null;
	}
	if (target && target.strength <= 0) {
		target = null;
	}
	sprite.tarcom = target;
	sprite.attack_mission = chase && target !== null;
}

function Target_Something_Nearby(artwork: MapArtwork, sprite: MapSprite): void {
	if (sprite.tarcom && !sprite.attack_mission && !In_Range_Of(artwork, sprite, sprite.tarcom)) {
		Assign_Target(sprite, null);
	}
	if (!sprite.tarcom) {
		Assign_Target(sprite, Greatest_Threat(artwork, sprite));
	}
}

function Greatest_Threat(artwork: MapArtwork, sprite: MapSprite): MapSprite | null {
	const weapon = Primary_Weapon(artwork, sprite);
	if (!weapon) {
		return null;
	}
	let best: MapSprite | null = null;
	let best_dist = Number.POSITIVE_INFINITY;
	const from = Center_Coord(artwork, sprite);
	for (const other of artwork.sprites) {
		if (other === sprite || other.strength <= 0) {
			continue;
		}
		if (other.rtti !== "building" && other.rtti !== "infantry" && other.rtti !== "unit" && other.rtti !== "aircraft") {
			continue;
		}
		const type = type_for_sprite(artwork, other);
		if (!type || !type.legal_target || type.immune) {
			continue;
		}
		if (Is_Ally_Sprite(sprite, other)) {
			continue;
		}
		if (!In_Range_Of(artwork, sprite, other)) {
			continue;
		}
		const dist = Math.hypot(from.x - Center_Coord(artwork, other).x, from.y - Center_Coord(artwork, other).y);
		if (dist < best_dist) {
			best = other;
			best_dist = dist;
		}
	}
	return best;
}

function Approach_Target(artwork: MapArtwork, sprite: MapSprite, play: Rect, cells: Set<string>): void {
	const target = sprite.tarcom;
	if (!target) {
		return;
	}
	if (In_Range_Of(artwork, sprite, target)) {
		if (Can_Fire(artwork, sprite, target) === FIRE_OK) {
			Fire_At(artwork, sprite, target);
		}
		return;
	}
	if (!sprite.attack_mission || !sprite.foot) {
		return;
	}
	let dest = { x: target.x, y: target.y };
	if (!can_enter_foot(artwork, sprite, dest, play, cells, false, true)) {
		const nearby = nearby_enter(artwork, sprite, dest, play, cells);
		if (!nearby) {
			return;
		}
		dest = nearby;
	}
	if (sprite.foot.dest && sprite.foot.dest.x === dest.x && sprite.foot.dest.y === dest.y) {
		return;
	}
	Assign_Destination(sprite.foot, dest);
}

function Fire_At(artwork: MapArtwork, sprite: MapSprite, target: MapSprite): void {
	const weapon = Primary_Weapon(artwork, sprite);
	if (!weapon || !weapon.WarheadPtr || !weapon.Bullet) {
		return;
	}
	const damage = weapon.Attack;
	sprite.arm = weapon.ROF;
	if (sprite.ammo > 0) {
		sprite.ammo -= 1;
	}
	const from = Center_Coord(artwork, sprite);
	const to = Center_Coord(artwork, target);
	if (weapon.Bullet.IsInvisible) {
		Take_Damage(artwork, target, damage, 0, weapon.WarheadPtr, sprite);
		return;
	}
	artwork.bullets.push({
		lx: from.x,
		ly: from.y,
		tx: to.x,
		ty: to.y,
		target,
		speed: Math.max(1, weapon.MaxSpeed || 100),
		damage,
		warhead: weapon.WarheadPtr,
		payback: sprite,
	});
}

function Take_Damage(
	artwork: MapArtwork,
	sprite: MapSprite,
	raw: number,
	distance: number,
	warhead: WarheadTypeClass,
	_source: MapSprite | null,
): void {
	const type = type_for_sprite(artwork, sprite);
	if (!type || sprite.strength <= 0) {
		return;
	}
	if (type.immune) {
		return;
	}
	const damage = Modify_Damage(raw, warhead, type.armor, distance, artwork.min_damage, artwork.max_damage);
	if (damage === 0) {
		return;
	}
	if (damage < 0) {
		set_hitpoints(sprite, sprite.strength - damage, type.strength);
		Apply_Health_Status(artwork, sprite);
		return;
	}
	const applied = Math.min(damage, sprite.strength);
	set_hitpoints(sprite, sprite.strength - applied, type.strength);
	Apply_Health_Status(artwork, sprite);
	if (sprite.strength > 0) {
		return;
	}
	for (const other of artwork.sprites) {
		if (other.tarcom === sprite) {
			Assign_Target(other, null);
		}
	}
	artwork.current_object = artwork.current_object.filter((entry) => entry !== sprite);
	sprite.is_selected = false;
	if (sprite.rtti === "building") {
		const extras = artwork.sprites.filter(
			(other) => other !== sprite && other.x === sprite.x && other.y === sprite.y && other.rtti === "" && other.house === sprite.house,
		);
		for (const extra of extras) {
			Remove_Sprite(artwork, extra);
		}
	}
	Remove_Sprite(artwork, sprite);
}

export function Object_AI(artwork: MapArtwork, sprite: MapSprite, play: Rect, cells: Set<string>): void {
	if (!sprite.rtti || sprite.strength <= 0) {
		return;
	}
	if (sprite.arm > 0) {
		sprite.arm -= 1;
	}
	if (sprite.tarcom && (sprite.tarcom.strength <= 0 || !artwork.sprites.includes(sprite.tarcom))) {
		Assign_Target(sprite, null);
	}
	Target_Something_Nearby(artwork, sprite);
	if (sprite.tarcom) {
		Approach_Target(artwork, sprite, play, cells);
	}
}

export function Bullet_AI(artwork: MapArtwork): void {
	const live: BulletClass[] = [];
	for (const bullet of artwork.bullets) {
		if (bullet.target && bullet.target.strength > 0 && artwork.sprites.includes(bullet.target)) {
			const at = Center_Coord(artwork, bullet.target);
			bullet.tx = at.x;
			bullet.ty = at.y;
		}
		const dx = bullet.tx - bullet.lx;
		const dy = bullet.ty - bullet.ly;
		const dist = Math.hypot(dx, dy);
		const step = Math.max(1, bullet.speed);
		if (dist <= step) {
			if (bullet.target && bullet.target.strength > 0 && artwork.sprites.includes(bullet.target)) {
				Take_Damage(artwork, bullet.target, bullet.damage, 0, bullet.warhead, bullet.payback);
			}
			continue;
		}
		bullet.lx += (dx / dist) * step;
		bullet.ly += (dy / dist) * step;
		live.push(bullet);
	}
	artwork.bullets = live;
}

export function House_AI(artwork: MapArtwork): void {
	for (const house of Houses) {
		if (house.RecalcPower && house === PlayerPtr) {
			Recalc_Power(artwork);
		}
		house.AI();
	}
}

function Spend_Credits(artwork: MapArtwork, cost: number): void {
	artwork.credits -= cost;
	if (PlayerPtr) {
		PlayerPtr.Credits -= cost;
	}
}

function Gain_Credits(artwork: MapArtwork, amount: number): void {
	artwork.credits += amount;
	if (PlayerPtr) {
		PlayerPtr.Credits += amount;
	}
}

export function Repair_Mode_Control(artwork: MapArtwork, control: number): void {
	toggle_mode(artwork, "is_repair_mode", control, () => {
		artwork.is_sell_mode = false;
		artwork.is_power_mode = false;
		artwork.is_waypoint_mode = false;
		artwork.dragged_waypoint = null;
		artwork.dragged_home = null;
	});
}

export function Sell_Mode_Control(artwork: MapArtwork, control: number): void {
	toggle_mode(artwork, "is_sell_mode", control, () => {
		artwork.is_repair_mode = false;
		artwork.is_power_mode = false;
		artwork.is_waypoint_mode = false;
		artwork.dragged_waypoint = null;
		artwork.dragged_home = null;
	});
}

export function Power_Mode_Control(artwork: MapArtwork, control: number): void {
	toggle_mode(artwork, "is_power_mode", control, () => {
		artwork.is_repair_mode = false;
		artwork.is_sell_mode = false;
		artwork.is_waypoint_mode = false;
		artwork.dragged_waypoint = null;
		artwork.dragged_home = null;
	});
}

export function Waypoint_Mode_Control(artwork: MapArtwork, control: number, edit_selected_path = false): void {
	if (artwork.production.pending) {
		return;
	}
	let mode = artwork.is_waypoint_mode;
	if (control === 0) {
		mode = false;
	} else if (control === 1) {
		mode = true;
	} else {
		mode = !mode;
	}
	if (mode === artwork.is_waypoint_mode) {
		return;
	}
	artwork.is_repair_mode = false;
	artwork.is_sell_mode = false;
	artwork.is_power_mode = false;
	const path = New_Waypoint_Path(artwork.paths);
	if (mode) {
		if (path === PATH_NONE && (!edit_selected_path || artwork.selected_path === PATH_NONE)) {
			artwork.is_waypoint_mode = false;
			artwork.dragged_waypoint = null;
			artwork.dragged_home = null;
			return;
		}
		artwork.is_waypoint_mode = true;
		if (!edit_selected_path) {
			artwork.selected_path = path;
		}
		Unselect_All(artwork);
	} else {
		artwork.is_waypoint_mode = false;
		if (artwork.dragged_waypoint && artwork.dragged_home) {
			artwork.dragged_waypoint.x = artwork.dragged_home.x;
			artwork.dragged_waypoint.y = artwork.dragged_home.y;
		}
		artwork.dragged_waypoint = null;
		artwork.dragged_home = null;
	}
}

function toggle_mode(
	artwork: MapArtwork,
	key: "is_repair_mode" | "is_sell_mode" | "is_power_mode",
	control: number,
	clear: () => void,
): void {
	if (artwork.production.pending) {
		return;
	}
	let mode = artwork[key];
	if (control === 0) {
		mode = false;
	} else if (control === 1) {
		mode = true;
	} else {
		mode = !mode;
	}
	if (mode === artwork[key]) {
		return;
	}
	clear();
	const buildings = artwork.sprites.some((sprite) => sprite.owned && sprite.rtti === "building");
	artwork[key] = mode && buildings;
	if (artwork[key]) {
		Unselect_All(artwork);
	}
}

export function Mode_Action(artwork: MapArtwork, sprite: MapSprite | null, cell: Point2D | null): boolean {
	if (artwork.is_repair_mode) {
		if (sprite && Can_Repair(artwork, sprite)) {
			Repair(artwork, sprite);
		}
		return true;
	}
	if (artwork.is_power_mode) {
		if (sprite && Can_Toggle_Power(artwork, sprite)) {
			if (sprite.is_on) {
				Turn_Off(artwork, sprite);
			} else {
				Turn_On(artwork, sprite);
			}
		}
		return true;
	}
	if (artwork.is_sell_mode) {
		if (sprite && Can_Demolish(artwork, sprite)) {
			Sell_Back(artwork, sprite);
		} else if (cell) {
			Sell_Wall(artwork, cell);
		}
		return true;
	}
	return false;
}

export function Unselect_All(artwork: MapArtwork): void {
	while (artwork.current_object.length) {
		Unselect(artwork, artwork.current_object[0]!);
	}
}

export function Unselect(artwork: MapArtwork, sprite: MapSprite): void {
	if (!sprite.is_selected) {
		return;
	}
	const index = artwork.current_object.indexOf(sprite);
	if (index >= 0) {
		artwork.current_object.splice(index, 1);
	}
	sprite.is_selected = false;
}

export function Select(artwork: MapArtwork, sprite: MapSprite): boolean {
	if (sprite.is_selected || !sprite.selectable || artwork.production.pending) {
		return false;
	}
	if (artwork.current_object.length > 0) {
		const old = artwork.current_object[0]!;
		if (old.owned !== sprite.owned || !old.owned) {
			Unselect_All(artwork);
		}
	}
	const type = type_for_sprite(artwork, sprite);
	if (type?.leader) {
		artwork.current_object.unshift(sprite);
	} else {
		artwork.current_object.push(sprite);
	}
	sprite.is_selected = true;
	return true;
}

export function Abort_Drag_Select(artwork: MapArtwork): void {
	End_Rubber_Band(artwork);
	artwork.is_rubber_band = false;
	artwork.is_tentative = false;
}

export function End_Rubber_Band(artwork: MapArtwork): void {
	artwork.rubber_band_start = { x: 0, y: 0 };
	artwork.rubber_band_end = { x: 0, y: 0 };
}

export function Start_Rubber_Band(artwork: MapArtwork, point: Point2D): void {
	if (artwork.rubber_band_start.x === 0 && artwork.rubber_band_start.y === 0) {
		artwork.rubber_band_start = { x: point.x, y: point.y };
		artwork.rubber_band_end = { x: point.x, y: point.y };
	}
}

export function Modify_Rubber_Band(artwork: MapArtwork, point: Point2D): void {
	if (artwork.rubber_band_start.x !== 0 || artwork.rubber_band_start.y !== 0) {
		artwork.rubber_band_end = { x: point.x, y: point.y };
	}
}

export function Mouse_Left_Press(artwork: MapArtwork, point: Point2D): void {
	if (!artwork.is_repair_mode && !artwork.is_power_mode && !artwork.is_sell_mode && !artwork.production.pending) {
		artwork.is_tentative = true;
		artwork.band_x = point.x;
		artwork.band_y = point.y;
		artwork.new_x = point.x;
		artwork.new_y = point.y;
	}
}

function Bound2(original: number, minval: number, maxval: number): number {
	let ret = original;
	if (ret < minval) {
		ret = minval;
	}
	if (ret >= maxval) {
		ret = maxval - 1;
	}
	return ret;
}

export function Mouse_Left_Held(artwork: MapArtwork, point: Point2D, view: Point2D): void {
	if (artwork.is_rubber_band && !artwork.is_waypoint_mode) {
		const npoint = {
			x: Bound2(point.x, 0, view.x),
			y: Bound2(point.y, 0, view.y),
		};
		if (npoint.x !== artwork.new_x || npoint.y !== artwork.new_y) {
			Modify_Rubber_Band(artwork, npoint);
		}
	} else if (artwork.is_tentative) {
		const dx = point.x - artwork.band_x;
		const dy = point.y - artwork.band_y;
		if (Math.sqrt(dx * dx + dy * dy) > 4) {
			artwork.is_rubber_band = true;
			artwork.is_tentative = false;
			if (!artwork.is_waypoint_mode) {
				Start_Rubber_Band(artwork, { x: artwork.band_x, y: artwork.band_y });
			}
		}
	}
}

export function Bandbox_Selection_Callback(artwork: MapArtwork, sprite: MapSprite): void {
	if (!sprite.owned || !sprite.selectable) {
		return;
	}
	let selectable = false;
	if (sprite.rtti === "building") {
		const type = type_for_sprite(artwork, sprite);
		if (type?.undeploys_into && !type.construction_yard && !type.mobile_war) {
			selectable = true;
		}
	} else {
		selectable = true;
	}
	if (selectable) {
		Select(artwork, sprite);
	}
}

export function Waypoint_At_Cell(artwork: MapArtwork, cell: Point2D): WaypointClass | null {
	return Waypoint_At(artwork.paths, cell);
}

export function Waypoint_Click(artwork: MapArtwork, cell: Point2D, play: Rect, cells: Set<string>, shift = false): boolean {
	if (!artwork.is_waypoint_mode) {
		return false;
	}
	if (artwork.dragged_waypoint) {
		return true;
	}
	const waypoint = Waypoint_At(artwork.paths, cell);
	const data = Fetch_Waypoint_Data(artwork.paths, waypoint);
	const selected = artwork.selected_path >= 0 ? artwork.paths[artwork.selected_path] : null;
	if (
		!shift &&
		waypoint &&
		data &&
		data.path === artwork.selected_path &&
		selected &&
		Can_Add_Waypoint_To_Path(artwork.paths, artwork.selected_path, artwork.production.max_waypoint_path_length) &&
		Get_Next_Waypoint(selected, waypoint)
	) {
		Select_Waypoint(selected, cell);
		return true;
	}
	if (waypoint && data) {
		artwork.selected_path = data.path;
		artwork.dragged_waypoint = waypoint;
		artwork.dragged_home = { x: waypoint.x, y: waypoint.y };
		return true;
	}
	if (
		artwork.selected_path !== PATH_NONE &&
		Can_Add_Waypoint_To_Path(artwork.paths, artwork.selected_path, artwork.production.max_waypoint_path_length) &&
		In_Radar_Cell(cell.x, cell.y, play) &&
		cells.has(`${cell.x},${cell.y}`)
	) {
		Place_Waypoint(artwork.paths, artwork.selected_path, cell);
		if (!Can_Add_Waypoint_To_Path(artwork.paths, artwork.selected_path, artwork.production.max_waypoint_path_length)) {
			Waypoint_Mode_Control(artwork, 0);
		}
	}
	return true;
}

export function Waypoint_Drag(artwork: MapArtwork, cell: Point2D, play: Rect, cells: Set<string>): void {
	if (!artwork.dragged_waypoint) {
		return;
	}
	if (!In_Radar_Cell(cell.x, cell.y, play) || !cells.has(`${cell.x},${cell.y}`)) {
		return;
	}
	const occupant = Waypoint_At(artwork.paths, cell);
	if (occupant && occupant !== artwork.dragged_waypoint) {
		return;
	}
	artwork.dragged_waypoint.x = cell.x;
	artwork.dragged_waypoint.y = cell.y;
}

export function Waypoint_Release(artwork: MapArtwork): void {
	artwork.dragged_waypoint = null;
	artwork.dragged_home = null;
}

export function Follow_Waypoint(
	artwork: MapArtwork,
	sprite: MapSprite,
	cell: Point2D,
	play: Rect,
	cells: Set<string>,
): boolean {
	const waypoint = Waypoint_At(artwork.paths, cell);
	const data = Fetch_Waypoint_Data(artwork.paths, waypoint);
	if (!waypoint || !data || !sprite.foot) {
		return false;
	}
	artwork.selected_path = data.path;
	return Execute_Waypoint_Path(artwork, sprite, waypoint, play, cells);
}

function Set_Waypoint_Path(foot: FootState, path: number, index: number, cell: Point2D): void {
	foot.current_path = path;
	foot.next_waypoint = index;
	foot.waypoint_target = { x: cell.x, y: cell.y };
}

function Clear_Waypoint_Path(foot: FootState): void {
	foot.current_path = PATH_NONE;
	foot.next_waypoint = 0;
	foot.waypoint_target = null;
}

function Execute_Waypoint_Path(
	artwork: MapArtwork,
	sprite: MapSprite,
	waypoint: WaypointClass | null,
	play: Rect,
	cells: Set<string>,
): boolean {
	if (!sprite.foot) {
		return false;
	}
	if (!waypoint) {
		Clear_Waypoint_Path(sprite.foot);
		return false;
	}
	const data = Fetch_Waypoint_Data(artwork.paths, waypoint);
	if (!data) {
		Clear_Waypoint_Path(sprite.foot);
		return false;
	}
	Set_Waypoint_Path(sprite.foot, data.path, data.id, waypoint);
	const moved = Assign_Move(artwork, sprite, { x: waypoint.x, y: waypoint.y }, play, cells, true);
	if (moved && sprite.foot.dest) {
		sprite.foot.waypoint_target = { ...sprite.foot.dest };
	}
	if (!moved) {
		Clear_Waypoint_Path(sprite.foot);
	}
	return moved;
}

function Resume_Waypoint(artwork: MapArtwork, sprite: MapSprite, play: Rect, cells: Set<string>): void {
	const foot = sprite.foot;
	if (!foot || foot.current_path === PATH_NONE || foot.dest) {
		return;
	}
	const target = foot.waypoint_target;
	if (!target) {
		return;
	}
	const here = Coord_Cell(foot.lx, foot.ly);
	if (here.x !== target.x || here.y !== target.y) {
		return;
	}
	const path = artwork.paths[foot.current_path];
	if (!path) {
		Clear_Waypoint_Path(foot);
		return;
	}
	const waypoint = path.Waypoints[foot.next_waypoint];
	if (!waypoint) {
		Clear_Waypoint_Path(foot);
		return;
	}
	Execute_Waypoint_Path(artwork, sprite, Get_Next_Waypoint(path, waypoint), play, cells);
}

export function Can_Repair(artwork: MapArtwork, sprite: MapSprite): boolean {
	if (!sprite.owned || sprite.rtti !== "building") {
		return false;
	}
	const type = type_for_sprite(artwork, sprite);
	if (!type?.repairable || Considered_Vehicle(type) || sprite.strength === 0) {
		return false;
	}
	return sprite.strength !== type.strength;
}

export function Can_Toggle_Power(artwork: MapArtwork, sprite: MapSprite): boolean {
	if (!sprite.owned || sprite.rtti !== "building" || !sprite.selectable) {
		return false;
	}
	const type = type_for_sprite(artwork, sprite);
	if (!type?.toggle_power || Considered_Vehicle(type)) {
		return false;
	}
	return type.drain > 0 || type.powered;
}

export function Can_Demolish(artwork: MapArtwork, sprite: MapSprite): boolean {
	if (!sprite.owned) {
		return false;
	}
	const type = type_for_sprite(artwork, sprite);
	if (!type || type.unsellable) {
		return false;
	}
	if (sprite.rtti === "building") {
		return !Considered_Vehicle(type);
	}
	if (sprite.rtti === "unit" || sprite.rtti === "aircraft") {
		return at_unit_repair(artwork, sprite);
	}
	return false;
}

export function Can_Sell_Wall(artwork: MapArtwork, cell: Point2D): boolean {
	return artwork.sprites.some((sprite) => sprite.wall && sprite.owned && sprite.x === cell.x && sprite.y === cell.y);
}

function Shape_Number(type: ShapeType, yellow: boolean): number {
	let shapenum = type.idle_start;
	if (yellow) {
		shapenum += 1;
	}
	return shapenum;
}

function Apply_Health_Status(artwork: MapArtwork, building: MapSprite): void {
	if (building.rtti !== "building") {
		return;
	}
	const type = type_for_sprite(artwork, building);
	if (!type) {
		return;
	}
	const ratio = Get_Health_Ratio(building.strength, type.strength);
	building.health_ratio = ratio;
	const yellow = ratio <= artwork.condition_yellow;
	if (building.gate) {
		building.frame = gate_frame(building.gate, yellow);
	} else if (!building.anim) {
		building.frame = Shape_Number(type, yellow);
	}
	for (const sprite of artwork.sprites) {
		if (sprite === building || !sprite.anim || sprite.x !== building.x || sprite.y !== building.y) {
			continue;
		}
		if (!sprite.healthy_file) {
			continue;
		}
		sprite.file = yellow && sprite.damage_file ? sprite.damage_file : sprite.healthy_file;
	}
}

function Repair(artwork: MapArtwork, sprite: MapSprite): void {
	sprite.repairing = !sprite.repairing;
	if (Health_Ratio(artwork, sprite) >= artwork.condition_green) {
		sprite.repairing = false;
	}
}

function at_unit_repair(artwork: MapArtwork, sprite: MapSprite): boolean {
	const at = Cell_Center({ x: sprite.x, y: sprite.y });
	const limit = (CELL_LEPTON / 2) * (CELL_LEPTON / 2);
	for (const building of artwork.sprites) {
		if (building.rtti !== "building" || !building.owned) {
			continue;
		}
		const type = type_for_sprite(artwork, building);
		if (!type?.unit_repair) {
			continue;
		}
		const dock = Cell_Center(occupy_center(building, type.occupy));
		const dx = at.x - dock.x;
		const dy = at.y - dock.y;
		if (dx * dx + dy * dy < limit) {
			return true;
		}
	}
	return false;
}

function Repair_AI(artwork: MapArtwork): void {
	const interval = Math.max(1, Math.trunc(artwork.production.repair_rate * TICKS_PER_MINUTE));
	if (artwork.frame % interval !== 0) {
		return;
	}
	for (const sprite of artwork.sprites) {
		if (!sprite.repairing || sprite.rtti !== "building") {
			continue;
		}
		const type = type_for_sprite(artwork, sprite);
		if (!type) {
			sprite.repairing = false;
			continue;
		}
		const step = artwork.production.repair_step;
		const chunks = Math.max(1, (type.strength / step) | 0);
		const cost = Math.max(1, Math.trunc((type.cost / chunks) * artwork.production.repair_percent));
		if (artwork.credits < cost) {
			sprite.repairing = false;
			continue;
		}
		Spend_Credits(artwork, cost);
		set_hitpoints(sprite, sprite.strength + step, type.strength);
		Apply_Health_Status(artwork, sprite);
		if (Health_Ratio(artwork, sprite) >= artwork.condition_green) {
			sprite.repairing = false;
		}
	}
}

function Turn_On(artwork: MapArtwork, sprite: MapSprite): void {
	if (sprite.is_on) {
		return;
	}
	sprite.is_on = true;
	Recalc_Power(artwork);
	void Recalc_Buildables_Now(artwork);
}

function Turn_Off(artwork: MapArtwork, sprite: MapSprite): void {
	const type = type_for_sprite(artwork, sprite);
	if (!sprite.is_on || !type || (type.drain <= 0 && !type.powered)) {
		return;
	}
	sprite.is_on = false;
	sprite.repairing = false;
	Recalc_Power(artwork);
	void Recalc_Buildables_Now(artwork);
}

function Sell_Back(artwork: MapArtwork, sprite: MapSprite): void {
	const type = type_for_sprite(artwork, sprite);
	if (!type) {
		return;
	}
	Gain_Credits(artwork, Math.trunc(type.cost * artwork.production.refund_percent));
	Remove_Sprite(artwork, sprite);
}

function Sell_Wall(artwork: MapArtwork, cell: Point2D): void {
	const wall = artwork.sprites.find((sprite) => sprite.wall && sprite.owned && sprite.x === cell.x && sprite.y === cell.y);
	if (!wall) {
		return;
	}
	const type = artwork.production.buildings.get(wall.type_name.toUpperCase());
	if (type) {
		Gain_Credits(artwork, Math.trunc(type.cost * artwork.production.refund_percent));
	}
	Remove_Sprite(artwork, wall);
}

function Remove_Sprite(artwork: MapArtwork, sprite: MapSprite): void {
	const index = artwork.sprites.indexOf(sprite);
	if (index < 0) {
		return;
	}
	artwork.sprites.splice(index, 1);
	const house = Houses[sprite.house];
	if (house && sprite.rtti) {
		const type = type_for_sprite(artwork, sprite);
		house.Tracking_Remove(sprite.rtti, sprite.type_name, Considered_Vehicle(type), type?.insignificant ?? false);
	}
	if (sprite.type_name) {
		const key = sprite.type_name.toUpperCase();
		const have = artwork.production.counts.get(key) ?? 0;
		if (have <= 1) {
			artwork.production.counts.delete(key);
		} else {
			artwork.production.counts.set(key, have - 1);
		}
	}
	Recalc_Power(artwork);
	void Recalc_Buildables_Now(artwork);
}

function Recalc_Power(artwork: MapArtwork): void {
	let output = 0;
	let drain = 0;
	let has_radar = false;
	for (const sprite of artwork.sprites) {
		if (sprite.rtti !== "building" || !sprite.owned || !sprite.is_on) {
			continue;
		}
		const type = type_for_sprite(artwork, sprite);
		if (!type || type.wall) {
			continue;
		}
		output += type.power;
		drain += type.drain;
		if (type.radar) {
			has_radar = true;
		}
	}
	artwork.power_output = output;
	artwork.power_drain = drain;
	artwork.has_radar = has_radar;
	if (PlayerPtr) {
		PlayerPtr.Power = output;
		PlayerPtr.Drain = drain;
		PlayerPtr.RecalcPower = false;
	}
}

function Recalc_Buildables_Now(artwork: MapArtwork): void {
	const tops = artwork.sidebar.Column.map((strip) => strip.TopIndex);
	const owned = powered_factory_names(artwork);
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
}

function powered_factory_names(artwork: MapArtwork): string[] {
	const names: string[] = [];
	for (const sprite of artwork.sprites) {
		if (sprite.rtti !== "building" || !sprite.owned || !sprite.is_on) {
			continue;
		}
		names.push(sprite.type_name.toUpperCase());
	}
	return names;
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
	if (factory?.IsExiting || factory?.ExitingFoot) {
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
		if (sprite.rtti === "aircraft") {
			const cruise = type && type.flight_level >= 0 ? type.flight_level : artwork.production.flight_level;
			const moved = Fly_AI(foot, cruise);
			if (!moved) {
				Resume_Waypoint(artwork, sprite, play, cells);
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
			if (type && !sprite.voxel) {
				sprite.frame = unit_stand_frame(type, sprite.dir);
			}
			if (placed.x !== before.x || placed.y !== before.y) {
				resorted = true;
				Look(artwork, sprite, shroud);
			}
			Resume_Waypoint(artwork, sprite, play, cells);
			continue;
		}
		const can_step: PathEnter = (from, to, dir) => foot_step(artwork, sprite, from, to, play, cells, false, dir, false);
		const can_path: PathEnter = (from, to, dir) => foot_step(artwork, sprite, from, to, play, cells, true, dir, true);
		const moved = Movement_AI(
			foot,
			can_step,
			(cell) => Try_Open_Gate(artwork, cell),
			can_path,
			artwork.path_graph,
			type?.threat_avoid ?? 0,
			(cell) => claim_head(artwork, sprite, cell),
		);
		if (!moved) {
			if (foot.dest && !foot.head) {
				const here = Coord_Cell(foot.lx, foot.ly);
				const dir = foot.path[0];
				if (dir !== undefined && dir !== FACING_NONE && dir !== TUNNEL) {
					scatter_idle(artwork, sprite, Adjacent_Cell(here, dir), play, cells);
				} else {
					scatter_idle(artwork, sprite, foot.dest, play, cells);
				}
			}
			if (type && sprite.rtti === "infantry" && !foot.moving) {
				sprite.frame = infantry_ready_frame(type, sprite.dir);
			}
			Resume_Waypoint(artwork, sprite, play, cells);
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
		if (sprite.rtti === "infantry" && !foot.moving && !foot.head) {
			const here = Coord_Cell(foot.lx, foot.ly);
			if ((occupy_bits(artwork.sprites, null, here).infantry & INFANTRY_SPOT_MASK) === INFANTRY_SPOT_MASK) {
				scatter_idle(artwork, null, here, play, cells);
			}
		}
		Resume_Waypoint(artwork, sprite, play, cells);
	}
	if (resorted) {
		Sort_Sprites(artwork);
	}
}

export function Assign_Move(
	artwork: MapArtwork,
	sprite: MapSprite,
	cell: Point2D,
	play: Rect,
	cells: Set<string>,
	follow = false,
): boolean {
	if (!sprite.foot) {
		return false;
	}
	if (!follow) {
		Clear_Waypoint_Path(sprite.foot);
	}
	if (sprite.rtti === "aircraft") {
		if (!In_Radar_Cell(cell.x, cell.y, play) || !cells.has(`${cell.x},${cell.y}`)) {
			return false;
		}
		Assign_Destination(sprite.foot, cell);
		Reset_Action_Line_Timer();
		return true;
	}
	let dest = cell;
	if (!can_enter_foot(artwork, sprite, dest, play, cells, false, true)) {
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

export function Assign_Group_Move(artwork: MapArtwork, cell: Point2D, play: Rect, cells: Set<string>): void {
	const selected = artwork.current_object.filter((sprite) => sprite.foot);
	const flyers = selected.filter((sprite) => sprite.rtti === "aircraft");
	const movers = selected.filter((sprite) => sprite.rtti !== "aircraft");
	for (const sprite of flyers) {
		Assign_Move(artwork, sprite, cell, play, cells);
	}
	if (movers.length === 0) {
		return;
	}
	if (movers.length === 1) {
		Assign_Move(artwork, movers[0]!, cell, play, cells);
		return;
	}
	let cx = 0;
	let cy = 0;
	for (const mover of movers) {
		cx += mover.foot!.lx;
		cy += mover.foot!.ly;
	}
	cx /= movers.length;
	cy /= movers.length;
	let anchor = movers[0]!;
	let nearest = Number.POSITIVE_INFINITY;
	for (const mover of movers) {
		const dist = Math.hypot(mover.foot!.lx - cx, mover.foot!.ly - cy);
		if (dist < nearest) {
			nearest = dist;
			anchor = mover;
		}
	}
	const ordered = movers
		.map((mover, index) => ({
			mover,
			key: index + 1000 * Math.hypot(mover.foot!.lx - anchor.foot!.lx, mover.foot!.ly - anchor.foot!.ly),
		}))
		.sort((a, b) => a.key - b.key)
		.map((entry) => entry.mover);
	const reserved = new Set<string>();
	const issued = ordered.map(() => false);
	const assigned: Point2D[] = ordered.map(() => ({ ...cell }));
	const key_of = (at: Point2D): string => `${at.x},${at.y}`;
	const anchor_cell = Coord_Cell(anchor.foot!.lx, anchor.foot!.ly);
	for (let index = 0; index < ordered.length; index++) {
		const mover = ordered[index]!;
		if (issued[index]) {
			continue;
		}
		let assigned_cell = cell;
		if (index === 0) {
			Assign_Move(artwork, mover, cell, play, cells);
			assigned_cell = mover.foot!.dest ?? cell;
			reserved.add(key_of(assigned_cell));
			issued[index] = true;
			assigned[index] = assigned_cell;
		} else {
			const here = Coord_Cell(mover.foot!.lx, mover.foot!.ly);
			const dx = here.x - anchor_cell.x;
			const dy = here.y - anchor_cell.y;
			const len = Math.hypot(dx, dy);
			const ux = len !== 0 ? dx / len : 0;
			const uy = len !== 0 ? dy / len : 0;
			let px = cell.x + 0.5;
			let py = cell.y + 0.5;
			let fallback = { ...cell };
			let chosen: Point2D | null = null;
			for (let tries = 0; tries < 6; tries++) {
				px += ux;
				py += uy;
				const trycell = { x: Math.trunc(px), y: Math.trunc(py) };
				if (!In_Radar_Cell(trycell.x, trycell.y, play) || !cells.has(key_of(trycell))) {
					chosen = fallback;
					break;
				}
				if (reserved.has(key_of(trycell))) {
					fallback = trycell;
				} else if (can_enter_foot(artwork, mover, trycell, play, cells, false, true)) {
					chosen = trycell;
					break;
				} else {
					fallback = trycell;
				}
			}
			assigned_cell = chosen ?? fallback;
			Clear_Waypoint_Path(mover.foot!);
			Assign_Destination(mover.foot!, assigned_cell);
			Reset_Action_Line_Timer();
			reserved.add(key_of(assigned_cell));
			issued[index] = true;
			assigned[index] = assigned_cell;
		}
		const pos = Coord_Cell(mover.foot!.lx, mover.foot!.ly);
		for (let scan = index + 1; scan < ordered.length; scan++) {
			if (issued[scan]) {
				continue;
			}
			const other = ordered[scan]!;
			const other_pos = Coord_Cell(other.foot!.lx, other.foot!.ly);
			if (other_pos.x === pos.x && other_pos.y === pos.y) {
				Clear_Waypoint_Path(other.foot!);
				Assign_Destination(other.foot!, assigned[index]!);
				Reset_Action_Line_Timer();
				issued[scan] = true;
				assigned[scan] = assigned[index]!;
			}
		}
	}
}

export function Can_Move_To(artwork: MapArtwork, sprite: MapSprite, cell: Point2D, play: Rect, cells: Set<string>): boolean {
	if (!sprite.foot) {
		return false;
	}
	if (sprite.rtti === "aircraft") {
		return In_Radar_Cell(cell.x, cell.y, play) && cells.has(`${cell.x},${cell.y}`);
	}
	if (can_enter_foot(artwork, sprite, cell, play, cells, false, true)) {
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
	if (!type || (entry.BuildableType !== "InfantryType" && entry.BuildableType !== "UnitType" && entry.BuildableType !== "AircraftType")) {
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
	if (entry.BuildableType === "AircraftType") {
		return Exit_Aircraft(directory, artwork, entry, type, factory_sprite, factory_type, play, cells, shroud);
	}
	const factory = artwork.production.factories.get(entry.BuildableType);
	const rtti = entry.BuildableType === "InfantryType" ? "infantry" : "unit";
	if (factory?.ExitingFoot && !factory_type.armory && !factory_type.weapons_factory) {
		return false;
	}
	const exitcell = Find_Exit_Cell(artwork, factory_sprite, factory_type, rtti, play, cells);
	if (!exitcell) {
		if (factory) {
			factory.IsExiting = false;
		}
		if (factory_type.gdi_barracks) {
			scatter_idle(artwork, null, { x: factory_sprite.x + 1, y: factory_sprite.y + 2 }, play, cells);
		}
		if (factory_type.nod_barracks) {
			scatter_idle(artwork, null, { x: factory_sprite.x + 2, y: factory_sprite.y + 2 }, play, cells);
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
	const sprite = make_sprite(spawn_cell.x, spawn_cell.y, files, type.terrain_palette ? "theater" : "unit", rtti === "infantry" ? 2 : 2, {
		scheme: artwork.production.scheme,
		selectable: true,
		blip: artwork.production.blip,
		select: rtti === "infantry" ? { kind: "shape", frame: 2 } : unit_select(type, false),
		rtti,
		owned: true,
		house: PlayerPtr?.HeapID ?? HOUSE_NONE,
		ammo: type.ammo,
		type_name: type.name,
		strength: type.strength,
		health_ratio: 1,
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
	if (PlayerPtr) {
		PlayerPtr.Tracking_Add(born.rtti, born.type_name, Considered_Vehicle(type), type.insignificant);
	}
	const key = type.name.toUpperCase();
	artwork.production.counts.set(key, (artwork.production.counts.get(key) ?? 0) + 1);
	if (type.sight > 0) {
		artwork.lookers.push({ x: born.x, y: born.y, sight: type.sight });
		shroud?.Sight_From(born.x, born.y, type.sight);
	}
	if (factory) {
		if (!factory_type.armory && !factory_type.weapons_factory) {
			factory.ExitingFoot = born.foot;
		}
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

async function Exit_Aircraft(
	directory: GameDirectory,
	artwork: MapArtwork,
	entry: BuildType,
	type: ShapeType,
	helipad: MapSprite,
	pad_type: ShapeType,
	play: Rect,
	cells: Set<string>,
	shroud: ShroudMap | null,
): Promise<boolean> {
	const dock = occupy_center(helipad, pad_type.occupy);
	const pad_busy = artwork.sprites.some(
		(sprite) => sprite.rtti === "aircraft" && occupies(sprite, sprite.occupy, dock.x, dock.y),
	);
	let spawn = Cell_Center(dock);
	let dest = dock;
	if (pad_busy) {
		const along = Math.trunc(Math.random() * Math.max(1, play.height));
		let edge = { x: play.x + 1 + along, y: play.y + along };
		if (!cells.has(`${edge.x},${edge.y}`)) {
			for (let n = 0; n < play.height; n++) {
				const next = { x: play.x + 1 + n, y: play.y + n };
				if (cells.has(`${next.x},${next.y}`)) {
					edge = next;
					break;
				}
			}
		}
		spawn = Cell_Center(edge);
		dest = dock;
	}
	const spawn_cell = Coord_Cell(spawn.x, spawn.y);
	const files = object_files(type, artwork.production.seed);
	const sprite = make_sprite(spawn_cell.x, spawn_cell.y, files, "unit", 5, {
		scheme: artwork.production.scheme,
		selectable: true,
		blip: artwork.production.blip,
		select: unit_select(type, false),
		rtti: "aircraft",
		owned: true,
		house: PlayerPtr?.HeapID ?? HOUSE_NONE,
		ammo: type.ammo,
		type_name: type.name,
		strength: type.strength,
		health_ratio: 1,
		dir: Facing_Dir256(Direction_Facing(spawn, Cell_Center(dest))),
		frame: unit_stand_frame(type, 0),
		foot: Make_Foot(spawn_cell, type.speed),
		voxel: type.voxel ? type.voxel_stem : "",
	});
	sprite.foot!.lx = spawn.x;
	sprite.foot!.ly = spawn.y;
	if (pad_busy) {
		sprite.foot!.height_agl = type.flight_level >= 0 ? type.flight_level : artwork.production.flight_level;
	}
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
	if (pad_busy || spawn_cell.x !== dest.x || spawn_cell.y !== dest.y) {
		Assign_Destination(born.foot!, dest);
	}
	artwork.sprites.push(born);
	Sort_Sprites(artwork);
	if (PlayerPtr) {
		PlayerPtr.Tracking_Add(born.rtti, born.type_name, Considered_Vehicle(type), type.insignificant);
	}
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

function occupy_center(sprite: MapSprite, occupy: { x: number; y: number }[]): Point2D {
	const size = occupy_size(occupy);
	return { x: sprite.x + ((size.w - 1) >> 1), y: sprite.y + ((size.h - 1) >> 1) };
}

function who_can_build_me_sprite(artwork: MapArtwork, kind: CameoKind): MapSprite | null {
	for (const sprite of artwork.sprites) {
		if (sprite.rtti !== "building" || !sprite.owned || !sprite.is_on) {
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
	rtti: "infantry" | "unit",
	play: Rect,
	cells: Set<string>,
): Point2D | null {
	const try_cell = (cell: Point2D): boolean => cell_clear_for(artwork, cell, rtti, play, cells);
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

function Spot_Index(lx: number, ly: number): number {
	const relx = lx & (CELL_LEPTON - 1);
	const rely = ly & (CELL_LEPTON - 1);
	if (Math.hypot(relx - CELL_LEPTON / 2, rely - CELL_LEPTON / 2) < 60) {
		return 0;
	}
	let index = 0;
	if (relx > CELL_LEPTON / 2) {
		index |= 1;
	}
	if (rely > CELL_LEPTON / 2) {
		index |= 2;
	}
	if (index === 0) {
		return 0;
	}
	return index + 1;
}

function spot_coord(cell: Point2D, index: number): Point2D {
	const spot = STOPPING_COORD[index] ?? STOPPING_COORD[0]!;
	return { x: cell.x * CELL_LEPTON + spot.x, y: cell.y * CELL_LEPTON + spot.y };
}

function occupy_coord(sprite: MapSprite): Point2D | null {
	const foot = sprite.foot;
	if (!foot) {
		return null;
	}
	if (foot.head) {
		return foot.head;
	}
	return { x: foot.lx, y: foot.ly };
}

function occupy_bits(
	sprites: MapSprite[],
	ignore: MapSprite | null,
	cell: Point2D,
): { infantry: number; vehicle: boolean } {
	let infantry = 0;
	let vehicle = false;
	for (const sprite of sprites) {
		if (sprite === ignore || !sprite.foot || sprite.rtti === "aircraft" || sprite.rtti === "building") {
			continue;
		}
		const at = occupy_coord(sprite);
		if (!at) {
			continue;
		}
		const here = Coord_Cell(at.x, at.y);
		if (here.x !== cell.x || here.y !== cell.y) {
			continue;
		}
		if (sprite.rtti === "unit") {
			vehicle = true;
		} else if (sprite.rtti === "infantry") {
			infantry |= 1 << Spot_Index(at.x, at.y);
		}
	}
	return { infantry, vehicle };
}

function Is_Spot_Free(occ: { infantry: number; vehicle: boolean }, index: number): boolean {
	if (index <= 1 || occ.vehicle) {
		return false;
	}
	return (occ.infantry & (1 << index)) === 0;
}

function Closest_Free_Spot(
	sprites: MapSprite[],
	ignore: MapSprite | null,
	cell: Point2D,
	from: Point2D,
	mix = 0,
): Point2D | null {
	const occ = occupy_bits(sprites, ignore, cell);
	if (occ.vehicle) {
		return null;
	}
	const spot_index = Spot_Index(from.x, from.y);
	if (Is_Spot_Free(occ, spot_index)) {
		return spot_coord(cell, spot_index);
	}
	const sequence = spot_index === 0 ? SPOT_ALTERNATE[mix & 3] : SPOT_SEQUENCE[spot_index];
	if (!sequence) {
		return null;
	}
	for (const pos of sequence) {
		if (Is_Spot_Free(occ, pos)) {
			return spot_coord(cell, pos);
		}
	}
	return null;
}

function occupy_enter_ok(sprites: MapSprite[], mover: MapSprite, cell: Point2D): boolean {
	const occ = occupy_bits(sprites, mover, cell);
	if (occ.vehicle) {
		return false;
	}
	if (mover.rtti === "unit") {
		return occ.infantry === 0;
	}
	if (mover.rtti === "infantry") {
		return (occ.infantry & INFANTRY_SPOT_MASK) !== INFANTRY_SPOT_MASK;
	}
	return true;
}

function cell_clear_for(
	artwork: MapArtwork,
	cell: Point2D,
	rtti: "infantry" | "unit",
	play: Rect,
	cells: Set<string>,
): boolean {
	if (!In_Radar_Cell(cell.x, cell.y, play) || !cells.has(`${cell.x},${cell.y}`)) {
		return false;
	}
	if (is_cliff_back(artwork, cell) || building_at(artwork, cell.x, cell.y)) {
		return false;
	}
	const occ = occupy_bits(artwork.sprites, null, cell);
	if (occ.vehicle) {
		return false;
	}
	if (rtti === "infantry") {
		return (occ.infantry & INFANTRY_SPOT_MASK) !== INFANTRY_SPOT_MASK;
	}
	return occ.infantry === 0;
}

function claim_head(artwork: MapArtwork, mover: MapSprite, cell: Point2D): Point2D | null {
	if (mover.rtti === "infantry") {
		return Closest_Free_Spot(artwork.sprites, mover, cell, Cell_Center(cell), artwork.frame);
	}
	const occ = occupy_bits(artwork.sprites, mover, cell);
	if (occ.vehicle) {
		return null;
	}
	return Cell_Center(cell);
}

function scatter_idle(
	artwork: MapArtwork,
	ignore: MapSprite | null,
	cell: Point2D,
	play: Rect,
	cells: Set<string>,
): void {
	for (const sprite of artwork.sprites) {
		if (sprite === ignore || !sprite.foot || sprite.rtti === "aircraft" || sprite.rtti === "building") {
			continue;
		}
		if (sprite.foot.moving || sprite.foot.head || sprite.foot.dest) {
			continue;
		}
		const here = Coord_Cell(sprite.foot.lx, sprite.foot.ly);
		if (here.x !== cell.x || here.y !== cell.y) {
			continue;
		}
		const nearby = nearby_enter(artwork, sprite, cell, play, cells);
		if (nearby) {
			Assign_Destination(sprite.foot, nearby);
		}
	}
}

function exit_radio_clear(artwork: MapArtwork, factory: FactoryClass): boolean {
	const foot = factory.ExitingFoot;
	if (!foot) {
		return true;
	}
	if (!artwork.sprites.some((sprite) => sprite.foot === foot)) {
		return true;
	}
	return !foot.dest && !foot.head && !foot.moving;
}

function can_enter_foot(
	artwork: MapArtwork,
	mover: MapSprite,
	cell: Point2D,
	play: Rect,
	cells: Set<string>,
	allow_gate: boolean,
	skip_occupy = false,
): boolean {
	if (!In_Radar_Cell(cell.x, cell.y, play) || !cells.has(`${cell.x},${cell.y}`)) {
		return false;
	}
	if (is_cliff_back(artwork, cell)) {
		return false;
	}
	if (!skip_occupy && !occupy_enter_ok(artwork.sprites, mover, cell)) {
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
	play: Rect,
	cells: Set<string>,
	allow_gate: boolean,
	dir = 0,
	skip_occupy = false,
): boolean {
	if (dir !== TUNNEL && !Can_Reach(from, to, artwork.terrain, artwork.path_graph)) {
		return false;
	}
	return can_enter_foot(artwork, mover, to, play, cells, allow_gate, skip_occupy);
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
				if (x === 0 && y === 0) {
					continue;
				}
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
	if (sprite.rtti === "aircraft") {
		return artwork.production.aircraft.get(name) ?? null;
	}
	return null;
}

export function Cameo_Right(artwork: MapArtwork, entry: BuildType): void {
	artwork.production.pending = null;
	const slot = entry.Factory as FactoryClass | null;
	if (slot) {
		if (!slot.Is_Building()) {
			Gain_Credits(artwork, slot.Abandon());
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
	for (const sprite of ready) {
		if (sprite.rtti === "building") {
			Apply_Health_Status(artwork, sprite);
			if (PlayerPtr && type) {
				PlayerPtr.Tracking_Add(sprite.rtti, sprite.type_name, Considered_Vehicle(type), type.insignificant);
			}
		}
	}
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
	const owned = powered_factory_names(artwork);
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
		PlayerPtr?.HeapID ?? HOUSE_NONE,
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
	const owned = powered_factory_names(artwork);
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
	sprite.frame = gate_frame(gate, Health_Ratio(artwork, sprite) <= artwork.condition_yellow);
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

function gate_frame(gate: GateState, yellow = false): number {
	if (gate.status === GATE_CLOSED && !gate.door_active) {
		return yellow ? gate.stages + 1 : 0;
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
	if (yellow) {
		shapenum += gate.stages + 1;
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

export function In_Radar_Cell(x: number, y: number, play: Rect): boolean {
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

async function fetch_damage_file(
	directory: GameDirectory,
	cache: Map<string, ShapeSet | null>,
	shapes: Map<string, ShapeSet>,
	sprite: MapSprite,
): Promise<string> {
	if (sprite.damage_names.length === 0) {
		return "";
	}
	const key = await fetch_shape(directory, cache, sprite.damage_names);
	if (!key) {
		return "";
	}
	const shape = cache.get(key);
	if (!shape) {
		return "";
	}
	shapes.set(key, shape);
	return key;
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
		const damage_file = await fetch_damage_file(directory, cache, artwork.shapes, sprite);
		if (sprite.anim) {
			bind_anim_shape(sprite.anim, shape.frames.length);
			ready.push({ ...sprite, file: key, healthy_file: key, damage_file, frame: sprite.anim.start + sprite.anim.stage });
		} else {
			ready.push({ ...sprite, file: key, healthy_file: key, damage_file });
		}
	}
	return ready;
}
