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

import type { GameDirectory } from "./files";
import type { Point2D, Rect } from "./ini";
import {
	blit_iso_tile,
	fetch_subtile,
	ISO_TILE_PIXEL_H,
	ISO_TILE_PIXEL_W,
	LEVEL_PIXEL_H,
	load_theater_tiles,
	type TheaterTiles,
} from "./isotile";
import {
	init_cell_light,
	light_key,
	NORMAL_LIGHT,
	shade_palette,
	type CellLight,
	type ScenarioLighting,
} from "./light";
import type { MapArtwork, MapSprite } from "./objects";
import { canvas_mouse, present } from "./present";
import { blit_shape, blit_shape_shadow } from "./shp";
import { DSurface } from "./surface";

type IsoCell = { x: number; y: number; height: number; tile: number; subtile: number };

function In_Radar(x: number, y: number, play: Rect): boolean {
	const w = play.width;
	const h = play.height;
	return x + y > w && x - y < w && y - x < w && x + y <= w + 2 * h;
}

const VIEW_W = 640;
const VIEW_H = 400;

function cell_pixel(cell: IsoCell): Point2D {
	return {
		x: (cell.x - cell.y) * (ISO_TILE_PIXEL_W >> 1) - (ISO_TILE_PIXEL_W >> 1),
		y: (cell.x + cell.y) * (ISO_TILE_PIXEL_H >> 1) - cell.height * LEVEL_PIXEL_H,
	};
}

function playrect_to_cell(point: Point2D, play_width: number): Point2D {
	return {
		x: ((point.y + 1) >> 1) + point.x,
		y: ((point.y >> 1) - point.x) + play_width,
	};
}

function gather_cells(cells: IsoCell[], play: Rect, fill_height: number): IsoCell[] {
	const placed = new Map<string, IsoCell>();
	for (const cell of cells) {
		if (In_Radar(cell.x, cell.y, play)) {
			placed.set(`${cell.x},${cell.y}`, cell);
		}
	}
	const list: IsoCell[] = [];
	const msize = play.width + play.height - 1;
	for (let y = 0; y < 2 * msize + 2; y++) {
		for (let x = 0; x < msize + 2; x++) {
			if (!In_Radar(x, y, play)) {
				continue;
			}
			list.push(placed.get(`${x},${y}`) ?? { x, y, height: fill_height, tile: 0, subtile: 0 });
		}
	}
	list.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
	return list;
}

function starting_camera(cells: IsoCell[], play: Rect, local: Rect, home: Point2D | null): Point2D {
	let target = home;
	if (!target) {
		const center = playrect_to_cell(
			{ x: local.x + (local.width >> 1), y: local.y + (local.height >> 1) },
			play.width,
		);
		const match = cells.find((cell) => cell.x === center.x && cell.y === center.y);
		target = match ?? center;
	}
	const found = cells.find((cell) => cell.x === target!.x && cell.y === target!.y);
	const pixel = cell_pixel(found ?? { x: target.x, y: target.y, height: 0, tile: 0, subtile: 0 });
	return { x: pixel.x - (VIEW_W >> 1), y: pixel.y - (VIEW_H >> 1) };
}

const DAYLIGHT: ScenarioLighting = {
	ambient: 100,
	red: 100,
	green: 100,
	blue: 100,
	ground: NORMAL_LIGHT / 10,
	level: Math.floor(NORMAL_LIGHT / 60),
};

function sprite_brightness(sprite: MapSprite, light: CellLight): number {
	if (sprite.bright === "day") {
		return NORMAL_LIGHT + sprite.extra_light;
	}
	if (sprite.bright === "tile") {
		return light.tile + sprite.extra_light;
	}
	return light.brightness + sprite.extra_light;
}

function lit_palette(
	cache: Map<string, Uint16Array>,
	base: Uint16Array,
	tag: string,
	brightness: number,
	red: number,
	green: number,
	blue: number,
): Uint16Array {
	const key = `${tag}:${light_key(brightness, red, green, blue)}`;
	const cached = cache.get(key);
	if (cached) {
		return cached;
	}
	const palette = shade_palette(base, brightness, red, green, blue);
	cache.set(key, palette);
	return palette;
}

function sprite_palette(
	artwork: MapArtwork,
	sprite: MapSprite,
	light: CellLight,
	cache: Map<string, Uint16Array>,
): Uint16Array {
	const brightness = sprite_brightness(sprite, light);
	const tinted = sprite.palette === "theater";
	const red = tinted ? light.red : NORMAL_LIGHT;
	const green = tinted ? light.green : NORMAL_LIGHT;
	const blue = tinted ? light.blue : NORMAL_LIGHT;
	if (sprite.scheme) {
		const named = artwork.schemes.get(sprite.scheme) ?? artwork.schemes.get(sprite.scheme.toUpperCase());
		const base =
			named ??
			[...artwork.schemes.entries()].find(([name]) => name.includes("GREEN"))?.[1] ??
			artwork.unit_palette;
		return lit_palette(cache, base, "scheme", brightness, red, green, blue);
	}
	const base = sprite.palette === "unit" ? artwork.unit_palette : artwork.theater_palette;
	return lit_palette(cache, base, sprite.palette, brightness, red, green, blue);
}

function gather_cell_lights(cells: IsoCell[], lighting: ScenarioLighting, artwork: MapArtwork | null): Map<string, CellLight> {
	const lights = artwork?.lights ?? [];
	const table = new Map<string, CellLight>();
	for (const cell of cells) {
		table.set(`${cell.x},${cell.y}`, init_cell_light(cell.x, cell.y, cell.height, lighting, lights));
	}
	return table;
}

function draw_view(
	tiles: TheaterTiles,
	cells: IsoCell[],
	camera: Point2D,
	artwork: MapArtwork | null,
	cell_lights: Map<string, CellLight>,
	palettes: Map<string, Uint16Array>,
): DSurface {
	const frame = new DSurface(VIEW_W, VIEW_H);
	const heights = new Map<string, number>();
	for (const cell of cells) {
		heights.set(`${cell.x},${cell.y}`, cell.height);
		const pixel = cell_pixel(cell);
		const dx = pixel.x - camera.x;
		const dy = pixel.y - camera.y;
		if (dx + ISO_TILE_PIXEL_W < -64 || dy + 160 < 0 || dx >= VIEW_W + 64 || dy >= VIEW_H + 64) {
			continue;
		}
		const tile = fetch_subtile(tiles, cell.tile, cell.subtile);
		if (tile) {
			const light = cell_lights.get(`${cell.x},${cell.y}`) ?? {
				brightness: NORMAL_LIGHT,
				tile: NORMAL_LIGHT,
				red: NORMAL_LIGHT,
				green: NORMAL_LIGHT,
				blue: NORMAL_LIGHT,
			};
			const palette = lit_palette(
				palettes,
				artwork?.theater_palette ?? tiles.palette,
				"tile",
				light.tile,
				light.red,
				light.green,
				light.blue,
			);
			blit_iso_tile(frame, dx, dy, tile, palette);
		}
	}
	if (!artwork) {
		return frame;
	}
	const draw_sprite = (sprite: (typeof artwork.sprites)[number], shadow: boolean): void => {
		const height = heights.get(`${sprite.x},${sprite.y}`) ?? 0;
		const pixel = cell_pixel({ x: sprite.x, y: sprite.y, height, tile: 0, subtile: 0 });
		const dx = pixel.x + (ISO_TILE_PIXEL_W >> 1) + sprite.ox - camera.x;
		const dy = pixel.y + (ISO_TILE_PIXEL_H >> 1) + sprite.oy - camera.y;
		if (dx < -128 || dy < -160 || dx >= VIEW_W + 128 || dy >= VIEW_H + 160) {
			return;
		}
		const shape = artwork.shapes.get(sprite.file);
		if (!shape) {
			return;
		}
		if (shadow) {
			blit_shape_shadow(frame, shape, sprite.frame, dx, dy, true);
			return;
		}
		const light = cell_lights.get(`${sprite.x},${sprite.y}`) ?? {
			brightness: NORMAL_LIGHT,
			tile: NORMAL_LIGHT,
			red: NORMAL_LIGHT,
			green: NORMAL_LIGHT,
			blue: NORMAL_LIGHT,
		};
		const palette = sprite_palette(artwork, sprite, light, palettes);
		blit_shape(frame, palette, shape, sprite.frame, dx, dy, true);
	};
	for (const sprite of artwork.sprites) {
		draw_sprite(sprite, true);
	}
	for (const sprite of artwork.sprites) {
		draw_sprite(sprite, false);
	}
	return frame;
}

export async function Show_Tactical(
	canvas: HTMLCanvasElement,
	directory: GameDirectory,
	theater: string,
	cells: IsoCell[],
	play: Rect,
	local: Rect,
	fill_height: number,
	home: Point2D | null,
	name: string,
	log: (line: string) => void,
	cancelled: () => boolean,
	artwork: MapArtwork | null = null,
): Promise<void> {
	const tiles = await load_theater_tiles(directory, theater);
	const draw_list = gather_cells(cells, play, fill_height);
	if (draw_list.length === 0) {
		log("No In_Radar cells to draw.");
		return;
	}
	const lighting = artwork?.lighting ?? DAYLIGHT;
	const palettes = new Map<string, Uint16Array>();
	const cell_lights = gather_cell_lights(draw_list, lighting, artwork);
	log(`Tactical map ${draw_list.length} cells, theater ${theater || "?"}. Drag or arrows to pan; Escape returns to the menu.`);

	let camera = starting_camera(draw_list, play, local, home);
	let dragging = false;
	let last = { x: 0, y: 0 };
	const previous_cursor = canvas.style.cursor;
	canvas.style.cursor = "grab";

	const paint = (): void => {
		present(canvas, draw_view(tiles, draw_list, camera, artwork, cell_lights, palettes), [
			{ x: 8, y: 8, width: 624, height: 18, text: name, selected: true },
			{ x: 8, y: 374, width: 624, height: 18, text: "Drag or arrows to pan; Escape returns to the menu" },
		]);
	};
	paint();

	await new Promise<void>((resolve) => {
		const finish = (): void => {
			canvas.style.cursor = previous_cursor;
			canvas.removeEventListener("mousedown", on_down);
			window.removeEventListener("mousemove", on_move);
			window.removeEventListener("mouseup", on_up);
			window.removeEventListener("keydown", on_key);
			resolve();
		};
		const on_down = (event: MouseEvent): void => {
			event.preventDefault();
			dragging = true;
			canvas.style.cursor = "grabbing";
			last = canvas_mouse(canvas, event);
		};
		const on_move = (event: MouseEvent): void => {
			if (!dragging) {
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			camera = { x: camera.x - (mouse.x - last.x), y: camera.y - (mouse.y - last.y) };
			last = mouse;
			paint();
		};
		const on_up = (): void => {
			dragging = false;
			canvas.style.cursor = "grab";
		};
		const on_key = (event: KeyboardEvent): void => {
			if (cancelled() || event.key === "Escape") {
				finish();
				return;
			}
			const step = ISO_TILE_PIXEL_W;
			if (event.key === "ArrowLeft") {
				camera = { x: camera.x - step, y: camera.y };
			} else if (event.key === "ArrowRight") {
				camera = { x: camera.x + step, y: camera.y };
			} else if (event.key === "ArrowUp") {
				camera = { x: camera.x, y: camera.y - step };
			} else if (event.key === "ArrowDown") {
				camera = { x: camera.x, y: camera.y + step };
			} else {
				return;
			}
			event.preventDefault();
			paint();
		};
		canvas.addEventListener("mousedown", on_down);
		window.addEventListener("mousemove", on_move);
		window.addEventListener("mouseup", on_up);
		window.addEventListener("keydown", on_key);
		if (cancelled()) {
			finish();
		}
	});
}
