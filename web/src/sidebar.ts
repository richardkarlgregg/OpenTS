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
import type { Point2D } from "./ini";
import { Fetch_String, TXT_HOLD, TXT_READY, TXT_TAB_BUTTON_CONTROLS } from "./language";
import { Desired_Levels, POWER_PIP_EMPTY, POWER_PIP_GREEN, POWER_PIP_HEIGHT, POWER_PIP_RED, POWER_PIP_YELLOW, POWER_X, POWER_Y, type PowerPips } from "./power";
import type { CanvasLabel } from "./present";
import { MAX_RADAR_FRAMES } from "./radar";
import { blit_shape, blit_shape_translucent50, read_palette, read_shp, type ShapeSet } from "./shp";
import { DSurface } from "./surface";

export const SCREEN_W = 640;
export const SCREEN_H = 400;
export const SIDE_WIDTH = 168;
export const TAB_HEIGHT = 16;
export const SIDE_Y = 148;
export const CREDITS_HEIGHT = 16;
export const TAC_X = 0;
export const TAC_Y = TAB_HEIGHT;
export const TAC_W = SCREEN_W - SIDE_WIDTH;
export const TAC_H = SCREEN_H - TAB_HEIGHT;

const BUTTON_ONE_X = 31;
const BUTTON_ONE_Y = -9;
const BUTTON_SPACING = 27;
const EVA_WIDTH = 80;
const RADAR_Y = 16;
const MAX_SLOTS = 60;
export const COLUMN_ONE_X = 24;
export const COLUMN_ONE_Y = 26;
export const COLUMN_TWO_X = 92;
export const OBJECT_HEIGHT = 51;
export const OBJECT_WIDTH = 64;
const CAMEO_TEXT_Y_OFFSET = 41;
const TEXT_X_OFFSET = 30;
const TEXT_Y_OFFSET = 2;
const QUEUE_COUNT_X_OFFSET = 60;
const UP_X_OFFSET = 5;
const UP_Y_OFFSET = 25;
const DOWN_X_OFFSET = 34;
const CAMEO_CATEGORY_INFANTRY = 1;
const CAMEO_CATEGORY_AIRCRAFT = 2;
const CAMEO_CATEGORY_UNIT = 3;
const CAMEO_CATEGORY_BUILDING = 4;
const CAMEO_GROUP_NORMAL = 0;
const CAMEO_GROUP_WALL = 1;
const CAMEO_GROUP_GATE = 2;
const CAMEO_GROUP_DEFENSE = 3;
const DARKEN_MASK = 0x7bef;
const MAX_BUILDABLES = 225;

export type SidebarArt = {
	palette: Uint16Array;
	tabs: ShapeSet | null;
	side1: ShapeSet | null;
	side2: ShapeSet | null;
	side3: ShapeSet | null;
	addon: ShapeSet | null;
	radar: ShapeSet | null;
	repair: ShapeSet | null;
	sell: ShapeSet | null;
	power: ShapeSet | null;
	waypoint: ShapeSet | null;
	pips: ShapeSet | null;
};

export type CameoKind = "BuildingType" | "InfantryType" | "UnitType" | "AircraftType";

export type CameoFactory = {
	Has_Completed(): boolean;
	Is_Building(): boolean;
	Completion(): number;
};

export type BuildType = {
	BuildableType: CameoKind;
	BuildableID: number;
	name: string;
	cameo: string;
	label: string;
	darken: boolean;
	category: number;
	sort: number;
	group: number;
	queue: number;
	Factory: CameoFactory | null;
};

export type StripClass = {
	X: number;
	TopIndex: number;
	Buildables: BuildType[];
};

export type SidebarStrips = {
	Column: [StripClass, StripClass];
	palette: Uint16Array;
	shapes: Map<string, ShapeSet>;
	darken: ShapeSet | null;
	up: ShapeSet | null;
	down: ShapeSet | null;
	clock: ShapeSet | null;
};

export function Which_Column(type: CameoKind): number {
	if (type === "BuildingType") {
		return 0;
	}
	return 1;
}

export function Make_Strips(): [StripClass, StripClass] {
	return [
		{ X: COLUMN_ONE_X, TopIndex: 0, Buildables: [] },
		{ X: COLUMN_TWO_X, TopIndex: 0, Buildables: [] },
	];
}

export function Strip_Add(strip: StripClass, entry: BuildType): boolean {
	if (strip.Buildables.length >= MAX_BUILDABLES) {
		return false;
	}
	if (strip.Buildables.some((item) => item.BuildableType === entry.BuildableType && item.BuildableID === entry.BuildableID)) {
		return false;
	}
	strip.Buildables.push(entry);
	return true;
}

export function Cameo_Category(type: CameoKind): number {
	if (type === "InfantryType") {
		return CAMEO_CATEGORY_INFANTRY;
	}
	if (type === "AircraftType") {
		return CAMEO_CATEGORY_AIRCRAFT;
	}
	if (type === "UnitType") {
		return CAMEO_CATEGORY_UNIT;
	}
	return CAMEO_CATEGORY_BUILDING;
}

export function Cameo_Group(type: CameoKind, wall: boolean, gate: boolean, defense: boolean): number {
	if (type !== "BuildingType") {
		return CAMEO_GROUP_NORMAL;
	}
	if (wall) {
		return CAMEO_GROUP_WALL;
	}
	if (gate) {
		return CAMEO_GROUP_GATE;
	}
	if (defense) {
		return CAMEO_GROUP_DEFENSE;
	}
	return CAMEO_GROUP_NORMAL;
}

export function Sort_Strip(strip: StripClass): void {
	strip.Buildables.sort((a, b) => {
		if (a.category !== b.category) {
			return a.category - b.category;
		}
		if (a.sort !== b.sort) {
			return a.sort - b.sort;
		}
		if (a.group !== b.group) {
			return a.group - b.group;
		}
		if (a.BuildableID !== b.BuildableID) {
			return a.BuildableID - b.BuildableID;
		}
		return a.BuildableType.localeCompare(b.BuildableType);
	});
}

export function Strip_Scroll(strip: StripClass, up: boolean, visible: number): boolean {
	if (up) {
		if (strip.TopIndex <= 0) {
			return false;
		}
		strip.TopIndex -= 1;
		return true;
	}
	if (strip.TopIndex + visible >= strip.Buildables.length) {
		return false;
	}
	strip.TopIndex += 1;
	return true;
}

async function fetch_shp(directory: GameDirectory, names: string[]): Promise<ShapeSet | null> {
	for (const name of names) {
		const packed = await cc_retrieve(directory, name);
		if (!packed) {
			continue;
		}
		const shape = read_shp(packed);
		if (shape) {
			return shape;
		}
	}
	return null;
}

export async function load_sidebar(directory: GameDirectory, log: (line: string) => void): Promise<SidebarArt> {
	const packed = await cc_retrieve(directory, "SIDEBAR.PAL");
	const palette = read_palette(packed ?? new Uint8Array(0));
	const tabs = await fetch_shp(directory, ["TABS.SHP"]);
	const side1 = await fetch_shp(directory, ["SIDE1.SHP", "SIDEGDI1.SHP"]);
	const side2 = await fetch_shp(directory, ["SIDE2.SHP", "SIDEGDI2.SHP"]);
	const side3 = await fetch_shp(directory, ["SIDE3.SHP", "SIDEGDI3.SHP"]);
	const addon = await fetch_shp(directory, ["ADDON.SHP"]);
	const radar = await fetch_shp(directory, ["RADAR.SHP"]);
	const repair = await fetch_shp(directory, ["REPAIR.SHP"]);
	const sell = await fetch_shp(directory, ["SELL.SHP"]);
	const power = await fetch_shp(directory, ["POWER.SHP"]);
	const waypoint = await fetch_shp(directory, ["WAYP.SHP"]);
	const pips = await fetch_shp(directory, ["POWERP.SHP"]);
	if (!tabs || !side1) {
		log("Sidebar SHPs missing; drawing an empty strip.");
	}
	return { palette, tabs, side1, side2, side3, addon, radar, repair, sell, power, waypoint, pips };
}

export function Max_Visible(hud: SidebarArt): number {
	if (!hud.side1 || !hud.side2 || !hud.side3) {
		return 4;
	}
	const height = TAC_H + TAC_Y - SIDE_Y;
	const fits = Math.floor((height - hud.side3.height - hud.side1.height) / Math.max(1, hud.side2.height));
	return Math.max(0, Math.min(fits, MAX_SLOTS));
}

function blit(dest: DSurface, palette: Uint16Array, shape: ShapeSet | null, frame: number, x: number, y: number): void {
	if (!shape) {
		return;
	}
	blit_shape(dest, palette, shape, frame, x, y, false);
}

export function draw_hud(
	dest: DSurface,
	hud: SidebarArt,
	credits: number,
	output = 0,
	drain = 0,
	radar_on = false,
	strips: SidebarStrips | null = null,
): CanvasLabel[] {
	const side_x = TAC_W;
	if (hud.tabs) {
		const tab_w = Math.max(1, hud.tabs.width);
		for (let x = tab_w; x < TAC_W; x += tab_w) {
			blit(dest, hud.palette, hud.tabs, 1, x, 0);
		}
		blit(dest, hud.palette, hud.tabs, 0, 0, 0);
		blit(dest, hud.palette, hud.tabs, 2, side_x, 0);
	}
	const radar_frame = radar_on
		? Math.min(MAX_RADAR_FRAMES, Math.max(0, (hud.radar?.frames.length ?? 1) - 1))
		: 0;
	blit(dest, hud.palette, hud.radar, radar_frame, side_x, RADAR_Y);

	let y = SIDE_Y;
	blit(dest, hud.palette, hud.side1, 0, side_x, y);
	y += hud.side1?.height ?? 0;
	const visible = Max_Visible(hud);
	for (let i = 0; i < visible; i++) {
		blit(dest, hud.palette, hud.side2, 0, side_x, y);
		y += hud.side2?.height ?? 0;
	}
	blit(dest, hud.palette, hud.side3, 0, side_x, y);
	y += hud.side3?.height ?? 0;
	blit(dest, hud.palette, hud.addon, 0, side_x, y);

	const button_y = SIDE_Y + BUTTON_ONE_Y + 3;
	const buttons = [hud.repair, hud.sell, hud.power, hud.waypoint];
	for (let i = 0; i < buttons.length; i++) {
		blit(dest, hud.palette, buttons[i]!, 0, side_x + BUTTON_ONE_X + i * BUTTON_SPACING, button_y);
	}

	const pips = Desired_Levels(output, drain, visible);
	draw_power(dest, hud, pips);

	const labels: CanvasLabel[] = [
		{
			x: 0,
			y: 0,
			width: EVA_WIDTH * 2,
			height: CREDITS_HEIGHT,
			text: Fetch_String(TXT_TAB_BUTTON_CONTROLS),
			selected: true,
		},
		{
			x: side_x,
			y: 0,
			width: SIDE_WIDTH,
			height: CREDITS_HEIGHT,
			text: `${credits}`,
			selected: true,
		},
	];
	if (strips) {
		labels.push(...Draw_Strips(dest, hud, strips, visible));
	}
	return labels;
}

function Draw_Strips(dest: DSurface, hud: SidebarArt, strips: SidebarStrips, visible: number): CanvasLabel[] {
	const labels: CanvasLabel[] = [];
	const arrow_y = SIDE_Y + visible * OBJECT_HEIGHT + UP_Y_OFFSET;
	const building_busy = strips.Column[0]!.Buildables.some(
		(entry) => entry.BuildableType === "BuildingType" && entry.Factory !== null,
	);
	for (const strip of strips.Column) {
		for (let i = 0; i < visible; i++) {
			const index = i + strip.TopIndex;
			const x = TAC_W + strip.X;
			const y = SIDE_Y + COLUMN_ONE_Y + i * OBJECT_HEIGHT;
			const entry = strip.Buildables[index];
			if (!entry) {
				continue;
			}
			const shape = strips.shapes.get(entry.cameo) ?? strips.shapes.get("XXICON");
			if (shape) {
				blit_shape(dest, strips.palette, shape, 0, x, y, false);
			}
			const factory = entry.Factory;
			const darken =
				factory !== null
					? false
					: entry.darken || (building_busy && entry.BuildableType === "BuildingType");
			if (darken && strips.darken) {
				blit_darken(dest, strips.darken, x, y, OBJECT_WIDTH, OBJECT_HEIGHT);
			}
			labels.push({
				x,
				y: y + CAMEO_TEXT_Y_OFFSET,
				width: OBJECT_WIDTH - 2,
				height: 10,
				text: entry.label,
				selected: true,
			});
			if (entry.queue > 1 || (entry.queue > 0 && factory === null)) {
				labels.push({
					x: x + QUEUE_COUNT_X_OFFSET - 16,
					y: y + TEXT_Y_OFFSET,
					width: 16,
					height: 10,
					text: `${entry.queue}`,
					selected: true,
				});
			}
			if (factory) {
				if (factory.Has_Completed()) {
					labels.push({
						x: x + TEXT_X_OFFSET - 20,
						y: y + TEXT_Y_OFFSET,
						width: 40,
						height: 10,
						text: Fetch_String(TXT_READY),
						selected: true,
					});
				} else {
					if (strips.clock) {
						blit_shape_translucent50(dest, hud.palette, strips.clock, factory.Completion() + 1, x, y, {
							x,
							y,
							w: OBJECT_WIDTH,
							h: OBJECT_HEIGHT,
						});
					}
					if (!factory.Is_Building()) {
						labels.push({
							x: x + TEXT_X_OFFSET - 20,
							y: y + TEXT_Y_OFFSET,
							width: 40,
							height: 10,
							text: Fetch_String(TXT_HOLD),
							selected: true,
						});
					}
				}
			}
		}
		if (strip.Buildables.length > visible) {
			blit(dest, hud.palette, strips.up, 0, TAC_W + strip.X + UP_X_OFFSET, arrow_y);
			blit(dest, hud.palette, strips.down, 0, TAC_W + strip.X + DOWN_X_OFFSET, arrow_y);
		}
	}
	return labels;
}

function blit_darken(dest: DSurface, shape: ShapeSet, x: number, y: number, clip_w = 0, clip_h = 0): void {
	const rec = shape.frames[0];
	if (!rec) {
		return;
	}
	const right = clip_w > 0 ? x + clip_w : dest.width;
	const bottom = clip_h > 0 ? y + clip_h : dest.height;
	for (let row = 0; row < rec.height; row++) {
		const sy = y + rec.y + row;
		if (sy < 0 || sy >= dest.height || sy < y || sy >= bottom) {
			continue;
		}
		const src_row = row * rec.width;
		const dest_row = sy * dest.width;
		for (let col = 0; col < rec.width; col++) {
			if (rec.pixels[src_row + col] === 0) {
				continue;
			}
			const sx = x + rec.x + col;
			if (sx < 0 || sx >= dest.width || sx < x || sx >= right) {
				continue;
			}
			dest.pixels[dest_row + sx]! &= DARKEN_MASK;
		}
	}
}

export function Sidebar_Click(point: Point2D, hud: SidebarArt, strips: SidebarStrips): boolean {
	const visible = Max_Visible(hud);
	const arrow_y = SIDE_Y + visible * OBJECT_HEIGHT + UP_Y_OFFSET;
	for (const strip of strips.Column) {
		const up = {
			x: TAC_W + strip.X + UP_X_OFFSET,
			y: arrow_y,
			w: strips.up?.width ?? 16,
			h: strips.up?.height ?? 16,
		};
		const down = {
			x: TAC_W + strip.X + DOWN_X_OFFSET,
			y: arrow_y,
			w: strips.down?.width ?? 16,
			h: strips.down?.height ?? 16,
		};
		if (in_box(point, up)) {
			return Strip_Scroll(strip, true, visible);
		}
		if (in_box(point, down)) {
			return Strip_Scroll(strip, false, visible);
		}
	}
	return false;
}

export function Sidebar_Cameo_At(point: Point2D, hud: SidebarArt, strips: SidebarStrips): BuildType | null {
	const visible = Max_Visible(hud);
	const arrow_y = SIDE_Y + visible * OBJECT_HEIGHT + UP_Y_OFFSET;
	for (const strip of strips.Column) {
		const up = {
			x: TAC_W + strip.X + UP_X_OFFSET,
			y: arrow_y,
			w: strips.up?.width ?? 16,
			h: strips.up?.height ?? 16,
		};
		const down = {
			x: TAC_W + strip.X + DOWN_X_OFFSET,
			y: arrow_y,
			w: strips.down?.width ?? 16,
			h: strips.down?.height ?? 16,
		};
		if (in_box(point, up) || in_box(point, down)) {
			return null;
		}
		for (let i = 0; i < visible; i++) {
			const box = {
				x: TAC_W + strip.X,
				y: SIDE_Y + COLUMN_ONE_Y + i * OBJECT_HEIGHT,
				w: OBJECT_WIDTH,
				h: OBJECT_HEIGHT,
			};
			if (in_box(point, box)) {
				return strip.Buildables[i + strip.TopIndex] ?? null;
			}
		}
	}
	return null;
}

function in_box(point: Point2D, box: { x: number; y: number; w: number; h: number }): boolean {
	return point.x >= box.x && point.x < box.x + box.w && point.y >= box.y && point.y < box.y + box.h;
}

function draw_power(dest: DSurface, hud: SidebarArt, pips: PowerPips): void {
	if (!hud.pips) {
		return;
	}
	const x = TAC_W + POWER_X;
	let y = SIDE_Y + POWER_Y;
	const bands: [number, number][] = [
		[pips.empty, POWER_PIP_EMPTY],
		[pips.green, POWER_PIP_GREEN],
		[pips.yellow, POWER_PIP_YELLOW],
		[pips.red, POWER_PIP_RED],
	];
	for (const [count, frame] of bands) {
		for (let i = 0; i < count; i++) {
			blit(dest, hud.palette, hud.pips, frame, x, y);
			y += POWER_PIP_HEIGHT;
		}
	}
}

export function over_tactical(x: number, y: number): boolean {
	return x >= TAC_X && x < TAC_X + TAC_W && y >= TAC_Y && y < TAC_Y + TAC_H;
}
