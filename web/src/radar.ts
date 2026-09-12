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

import type { Point2D } from "./ini";
import { fetch_subtile, ISO_TILE_PIXEL_H, ISO_TILE_PIXEL_W, type TheaterTiles } from "./isotile";
import type { MapSprite } from "./objects";
import type { ShroudMap } from "./shroud";
import { build_hicolor_pixel, DSurface } from "./surface";

export const RAD_Y = 16;
export const RAD_OFF_X = 15;
export const RAD_OFF_Y = 12;
export const RAD_P_WIDTH = 140;
export const RAD_P_HEIGHT = 108;
export const MAX_RADAR_FRAMES = 40;
const SIDE_WIDTH = 168;
const TAB_HEIGHT = 16;
const TAC_W = 640 - SIDE_WIDTH;
const VIEW_COLOR = build_hicolor_pixel(255, 255, 0);

export type RadarMap = {
	width: number;
	height: number;
	min_x: number;
	min_y: number;
	scale_x: number;
	scale_y: number;
	blit_x: number;
	blit_y: number;
	blit_w: number;
	blit_h: number;
	exists: boolean;
};

function project_cell(x: number, y: number): Point2D {
	return { x: x - y, y: (x + y) >> 1 };
}

export function Compute_Radar_Image(cells: { x: number; y: number }[], exists: boolean): RadarMap | null {
	if (cells.length === 0) {
		return null;
	}
	let min_x = 10000;
	let min_y = 10000;
	let max_x = -10000;
	let max_y = -10000;
	for (const cell of cells) {
		const point = project_cell(cell.x, cell.y);
		if (point.x < min_x) min_x = point.x;
		if (point.y < min_y) min_y = point.y;
		if (point.x > max_x) max_x = point.x;
		if (point.y > max_y) max_y = point.y;
	}
	const width = Math.max(1, max_x - min_x + 1);
	const height = Math.max(1, max_y - min_y + 1);
	const fit = Math.min(RAD_P_WIDTH / width, RAD_P_HEIGHT / height, 2);
	const blit_w = Math.max(1, Math.round(width * fit));
	const blit_h = Math.max(1, Math.round(height * fit));
	const pane_x = TAC_W + RAD_OFF_X;
	const pane_y = RAD_Y + RAD_OFF_Y;
	return {
		width,
		height,
		min_x,
		min_y,
		scale_x: blit_w / width,
		scale_y: blit_h / height,
		blit_x: pane_x + Math.floor((RAD_P_WIDTH - blit_w) / 2),
		blit_y: pane_y + Math.floor((RAD_P_HEIGHT - blit_h) / 2),
		blit_w,
		blit_h,
		exists,
	};
}

function cell_to_local(radar: RadarMap, x: number, y: number): Point2D {
	const point = project_cell(x, y);
	return {
		x: Math.floor((point.x - radar.min_x) * radar.scale_x),
		y: Math.floor((point.y - radar.min_y) * radar.scale_y),
	};
}

function local_to_cell(radar: RadarMap, lx: number, ly: number): Point2D {
	const px = lx / radar.scale_x + radar.min_x;
	const py = (ly / radar.scale_y + radar.min_y) * 2;
	return {
		x: Math.round((px + py) / 2),
		y: Math.round((py - px) / 2),
	};
}

export function Radar_Pixel_To_Cell(radar: RadarMap, screen: Point2D): Point2D | null {
	const lx = screen.x - radar.blit_x;
	const ly = screen.y - radar.blit_y;
	if (lx < 0 || ly < 0 || lx >= radar.blit_w || ly >= radar.blit_h) {
		return null;
	}
	const px = lx / radar.scale_x + radar.min_x;
	const py = (ly / radar.scale_y + radar.min_y) * 2;
	return {
		x: Math.round((px + py) / 2),
		y: Math.round((py - px) / 2),
	};
}

export function over_radar(x: number, y: number, radar: RadarMap | null): boolean {
	if (!radar || !radar.exists) {
		return false;
	}
	return x >= radar.blit_x && x < radar.blit_x + radar.blit_w && y >= radar.blit_y && y < radar.blit_y + radar.blit_h;
}

function tile_color(tiles: TheaterTiles, cell: { tile: number; subtile: number; height: number }, high: boolean): number {
	const sub = fetch_subtile(tiles, cell.tile, cell.subtile);
	const rgb = high ? sub?.colors.high : sub?.colors.low;
	const color = rgb ?? [72, 108, 44];
	const t = Math.max(0, Math.min(12, cell.height)) / 12;
	return build_hicolor_pixel(
		Math.min(255, Math.round(color[0]! * (1 + 0.4 * t))),
		Math.min(255, Math.round(color[1]! * (1 + 0.4 * t))),
		Math.min(255, Math.round(color[2]! * (1 + 0.4 * t))),
	);
}

export function Render_Radar(
	dest: DSurface,
	radar: RadarMap,
	cells: { x: number; y: number; height: number; tile: number; subtile: number }[],
	tiles: TheaterTiles,
	shroud: ShroudMap | null,
	sprites: MapSprite[],
	camera: Point2D,
): void {
	const lookup = new Map<string, { x: number; y: number; height: number; tile: number; subtile: number }>();
	for (const cell of cells) {
		lookup.set(`${cell.x},${cell.y}`, cell);
	}
	const scratch = new DSurface(radar.blit_w, radar.blit_h);
	for (let ly = 0; ly < radar.blit_h; ly++) {
		for (let lx = 0; lx < radar.blit_w; lx++) {
			const at = local_to_cell(radar, lx, ly);
			const cell = lookup.get(`${at.x},${at.y}`);
			if (!cell) {
				continue;
			}
			if (shroud && !shroud.IsMapped(cell.x, cell.y)) {
				continue;
			}
			scratch.put_pixel(lx, ly, tile_color(tiles, cell, (lx & 1) === 1));
		}
	}
	for (const sprite of sprites) {
		if (!sprite.selectable) {
			continue;
		}
		if (shroud && !shroud.IsMapped(sprite.x, sprite.y)) {
			continue;
		}
		const local = cell_to_local(radar, sprite.x, sprite.y);
		scratch.put_pixel(local.x, local.y, sprite.blip);
		scratch.put_pixel(local.x + 1, local.y, sprite.blip);
	}
	dest.blit_from(radar.blit_x, radar.blit_y, scratch);

	const view_w = Math.max(4, Math.round((2 * (dest.width - SIDE_WIDTH)) / (ISO_TILE_PIXEL_W / Math.max(radar.scale_x, 0.01))));
	const view_h = Math.max(4, Math.round((2 * (dest.height - TAB_HEIGHT)) / (ISO_TILE_PIXEL_H / Math.max(radar.scale_y, 0.01))));
	const origin = {
		x: camera.x - ((dest.width - SIDE_WIDTH) >> 1),
		y: camera.y - ((dest.height - TAB_HEIGHT) >> 1),
	};
	const u = (origin.x + (ISO_TILE_PIXEL_W >> 1)) / (ISO_TILE_PIXEL_W >> 1);
	const v = origin.y / (ISO_TILE_PIXEL_H >> 1);
	const cell_x = Math.round((u + v) / 2);
	const cell_y = Math.round((v - u) / 2);
	const local = cell_to_local(radar, cell_x, cell_y);
	const vx = Math.min(radar.blit_w - view_w, Math.max(0, local.x));
	const vy = Math.min(radar.blit_h - view_h, Math.max(0, local.y));
	dest.draw_rect(radar.blit_x + vx, radar.blit_y + vy, Math.min(view_w, radar.blit_w), Math.min(view_h, radar.blit_h), VIEW_COLOR);
}
