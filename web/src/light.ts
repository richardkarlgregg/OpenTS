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

import type { INIClass } from "./ini";
import { build_hicolor_pixel, unpack_hicolor } from "./surface";

export const NORMAL_LIGHT = 1000;
const CELL_LEPTON = 256;
const INTENSITY_LEVELS = 63;
const LEVEL_COUNT = INTENSITY_LEVELS - 1;

export type ScenarioLighting = {
	ambient: number;
	red: number;
	green: number;
	blue: number;
	ground: number;
	level: number;
};

export type MapLightSource = {
	x: number;
	y: number;
	visibility: number;
	intensity: number;
	red: number;
	green: number;
	blue: number;
};

export type CellLight = {
	brightness: number;
	tile: number;
	red: number;
	green: number;
	blue: number;
};

export function read_scenario_lighting(ini: INIClass): ScenarioLighting {
	return {
		ambient: Math.floor(100 * ini.get_float("Lighting", "Ambient", 1)),
		red: Math.floor(100 * ini.get_float("Lighting", "Red", 1)),
		green: Math.floor(100 * ini.get_float("Lighting", "Green", 1)),
		blue: Math.floor(100 * ini.get_float("Lighting", "Blue", 1)),
		ground: Math.floor(NORMAL_LIGHT * ini.get_float("Lighting", "Ground", 0.1)),
		level: Math.floor(NORMAL_LIGHT * ini.get_float("Lighting", "Level", 1 / 60)),
	};
}

export function cell_lepton(x: number, y: number): { x: number; y: number } {
	return { x: x * CELL_LEPTON + (CELL_LEPTON >> 1), y: y * CELL_LEPTON + (CELL_LEPTON >> 1) };
}

export function building_light_coord(x: number, y: number, occupy: { x: number; y: number }[]): { x: number; y: number } {
	const origin = cell_lepton(x, y);
	let width = 1;
	let height = 1;
	for (const cell of occupy) {
		width = Math.max(width, cell.x + 1);
		height = Math.max(height, cell.y + 1);
	}
	return {
		x: origin.x + width * (CELL_LEPTON >> 1) - (CELL_LEPTON >> 1),
		y: origin.y + height * (CELL_LEPTON >> 1) - (CELL_LEPTON >> 1),
	};
}

function adjust_tile_rgb(light: number, red: number, green: number, blue: number): {
	intensity: number;
	light: number;
	red: number;
	green: number;
	blue: number;
} {
	red = Math.max(red, 0);
	green = Math.max(green, 0);
	blue = Math.max(blue, 0);
	let intensity = 65536;
	if (red !== NORMAL_LIGHT || green !== red || blue !== red) {
		if (green <= red && red >= blue) {
			intensity = Math.floor((red * 65536) / NORMAL_LIGHT);
			if (intensity < 66) {
				return { intensity: 65536, light: 0, red: NORMAL_LIGHT, green: NORMAL_LIGHT, blue: NORMAL_LIGHT };
			}
			green = Math.floor((green * 65536) / intensity);
			blue = Math.floor((blue * 65536) / intensity);
			red = NORMAL_LIGHT;
			light = (light * intensity) >> 16;
		} else if (green >= red && green >= blue) {
			intensity = Math.floor((green * 65536) / NORMAL_LIGHT);
			if (intensity < 66) {
				return { intensity: 65536, light: 0, red: NORMAL_LIGHT, green: NORMAL_LIGHT, blue: NORMAL_LIGHT };
			}
			red = Math.floor((red * 65536) / intensity);
			blue = Math.floor((blue * 65536) / intensity);
			green = NORMAL_LIGHT;
			light = (light * intensity) >> 16;
		} else {
			intensity = Math.floor((blue * 65536) / NORMAL_LIGHT);
			if (intensity < 66) {
				return { intensity: 65536, light: 0, red: NORMAL_LIGHT, green: NORMAL_LIGHT, blue: NORMAL_LIGHT };
			}
			red = Math.floor((red * 65536) / intensity);
			green = Math.floor((green * 65536) / intensity);
			blue = NORMAL_LIGHT;
			light = (light * intensity) >> 16;
		}
	}
	return {
		intensity,
		light: Math.min(light, 2000),
		red: Math.min(Math.max(red, 0), NORMAL_LIGHT),
		green: Math.min(Math.max(green, 0), NORMAL_LIGHT),
		blue: Math.min(Math.max(blue, 0), NORMAL_LIGHT),
	};
}

export function init_cell_light(x: number, y: number, height: number, lighting: ScenarioLighting, lights: MapLightSource[]): CellLight {
	let brightness = Math.floor((NORMAL_LIGHT * lighting.ambient) / 100);
	let red = Math.floor((NORMAL_LIGHT * lighting.red) / 100);
	let green = Math.floor((NORMAL_LIGHT * lighting.green) / 100);
	let blue = Math.floor((NORMAL_LIGHT * lighting.blue) / 100);
	const cell = cell_lepton(x, y);
	for (const light of lights) {
		const dx = cell.x - light.x;
		const dy = cell.y - light.y;
		const vis = light.visibility;
		if (dx * dx + dy * dy > vis * vis) {
			continue;
		}
		const dist = Math.sqrt(dx * dx + dy * dy) | 0;
		if (dist > vis) {
			continue;
		}
		const num = Math.floor((NORMAL_LIGHT * vis - NORMAL_LIGHT * dist) / vis);
		brightness += Math.floor((num * light.intensity) / NORMAL_LIGHT);
		red += Math.floor((num * light.red) / NORMAL_LIGHT);
		green += Math.floor((num * light.green) / NORMAL_LIGHT);
		blue += Math.floor((num * light.blue) / NORMAL_LIGHT);
	}
	brightness += height * lighting.level - lighting.ground;
	const adjusted = adjust_tile_rgb(brightness, red, green, blue);
	return {
		brightness: Math.min(Math.max(brightness, 0), 2000),
		tile: Math.min(Math.max(adjusted.light, 0), 2000),
		red: adjusted.red,
		green: adjusted.green,
		blue: adjusted.blue,
	};
}

function lighting_band(brightness: number): number {
	const shade = Math.min(254, (261 * Math.max(0, brightness)) >> 11);
	return Math.min(LEVEL_COUNT, Math.floor((127 * shade * LEVEL_COUNT) / 32258));
}

export function shade_palette(base: Uint16Array, brightness: number, red: number, green: number, blue: number): Uint16Array {
	const band = lighting_band(brightness);
	const red_step = Math.floor((NORMAL_LIGHT * red * 65536) / (NORMAL_LIGHT * NORMAL_LIGHT));
	const green_step = Math.floor((NORMAL_LIGHT * green * 65536) / (NORMAL_LIGHT * NORMAL_LIGHT));
	const blue_step = Math.floor((NORMAL_LIGHT * blue * 65536) / (NORMAL_LIGHT * NORMAL_LIGHT));
	const red_scale = Math.floor((band * 2 * red_step) / LEVEL_COUNT);
	const green_scale = Math.floor((band * 2 * green_step) / LEVEL_COUNT);
	const blue_scale = Math.floor((band * 2 * blue_step) / LEVEL_COUNT);
	const palette = new Uint16Array(256);
	for (let i = 1; i < 256; i++) {
		const [r, g, b] = unpack_hicolor(base[i]!);
		palette[i] = build_hicolor_pixel(
			Math.min(255, (r * red_scale) >>> 16),
			Math.min(255, (g * green_scale) >>> 16),
			Math.min(255, (b * blue_scale) >>> 16),
		);
	}
	return palette;
}

export function light_key(brightness: number, red: number, green: number, blue: number): string {
	return `${brightness},${red},${green},${blue}`;
}
