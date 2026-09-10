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
import { Fetch_String, TXT_TAB_BUTTON_CONTROLS } from "./language";
import { Desired_Levels, POWER_PIP_EMPTY, POWER_PIP_GREEN, POWER_PIP_HEIGHT, POWER_PIP_RED, POWER_PIP_YELLOW, POWER_X, POWER_Y, type PowerPips } from "./power";
import type { CanvasLabel } from "./present";
import { MAX_RADAR_FRAMES } from "./radar";
import { blit_shape, read_palette, read_shp, type ShapeSet } from "./shp";
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

	return [
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
