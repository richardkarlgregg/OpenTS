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
import { MouseClass, MOUSE_N, MOUSE_NO_N, MOUSE_NORMAL } from "./mouse";
import { Anim_Logic, type MapArtwork, type MapSprite } from "./objects";
import { Options } from "./options";
import { canvas_mouse, present, type CanvasLabel } from "./present";
import { blit_shape, blit_shape_shadow } from "./shp";
import { blit_voxel } from "./voxlib";
import {
	draw_hud,
	load_sidebar,
	SCREEN_H,
	SCREEN_W,
	TAC_H,
	TAC_W,
	TAC_X,
	TAC_Y,
	type SidebarArt,
} from "./sidebar";
import { TIMER_SECOND } from "./stimer";
import { DSurface } from "./surface";

type IsoCell = { x: number; y: number; height: number; tile: number; subtile: number };

function In_Radar(x: number, y: number, play: Rect): boolean {
	const w = play.width;
	const h = play.height;
	return x + y > w && x - y < w && y - x < w && x + y <= w + 2 * h;
}

const VIEW_W = TAC_W;
const VIEW_H = TAC_H;
const FACING_NONE = -1;
const SCROLL_STEPS_PER_SECOND = 60;
const MAX_SCROLL_STEPS_PER_POLL = 4;
const SCROLL_WRATIO = 0.16;
const SCROLL_HRATIO = 0.21;
const SCROLL_PIXELS = [0x00e0 * 2, 0x00c0 * 2, 0x00a0 * 2, 0x0080 * 2, 0x0060 * 2, 0x0040 * 2, 0x0020 * 2, 0x0010 * 2, 0x0008 * 2];
const SCROLL_DELTA = [
	{ x: 0, y: -1 },
	{ x: 1, y: -1 },
	{ x: 1, y: 0 },
	{ x: 1, y: 1 },
	{ x: 0, y: 1 },
	{ x: -1, y: 1 },
	{ x: -1, y: 0 },
	{ x: -1, y: -1 },
];
const SCROLL_NEWDIR = [
	7, 0, 1,
	6, FACING_NONE, 2,
	5, 4, 3,
];

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
	return pixel;
}

function view_origin(camera: Point2D): Point2D {
	return { x: camera.x - (VIEW_W >> 1), y: camera.y - (VIEW_H >> 1) };
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
		const base = named ?? artwork.unit_palette;
		return lit_palette(cache, base, `scheme:${sprite.scheme}`, brightness, red, green, blue);
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
	const origin = view_origin(camera);
	const frame = new DSurface(VIEW_W, VIEW_H);
	const heights = new Map<string, number>();
	for (const cell of cells) {
		heights.set(`${cell.x},${cell.y}`, cell.height);
		const pixel = cell_pixel(cell);
		const dx = pixel.x - origin.x;
		const dy = pixel.y - origin.y;
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
		const dx = pixel.x + (ISO_TILE_PIXEL_W >> 1) + sprite.ox - origin.x;
		const dy = pixel.y + (ISO_TILE_PIXEL_H >> 1) + sprite.oy - origin.y;
		if (dx < -128 || dy < -160 || dx >= VIEW_W + 128 || dy >= VIEW_H + 160) {
			return;
		}
		if (sprite.voxel) {
			const model = artwork.voxels.get(sprite.voxel);
			if (!model) {
				return;
			}
			if (shadow) {
				blit_voxel(frame, artwork.unit_palette, model, sprite.dir, dx, dy, true);
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
			blit_voxel(frame, palette, model, sprite.dir, dx, dy, false);
			return;
		}
		const shape = artwork.shapes.get(sprite.file);
		if (!shape) {
			return;
		}
		if (shadow) {
			if (sprite.cast_shadow && !sprite.anim?.dead) {
				blit_shape_shadow(frame, shape, sprite.frame, dx, dy, true);
			}
			return;
		}
		if (sprite.anim?.dead) {
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

function composite_view(
	tiles: TheaterTiles,
	cells: IsoCell[],
	camera: Point2D,
	artwork: MapArtwork | null,
	cell_lights: Map<string, CellLight>,
	palettes: Map<string, Uint16Array>,
	hud: SidebarArt,
): { frame: DSurface; labels: CanvasLabel[] } {
	const tactical = draw_view(tiles, cells, camera, artwork, cell_lights, palettes);
	const frame = new DSurface(SCREEN_W, SCREEN_H);
	frame.blit_from(TAC_X, TAC_Y, tactical);
	const labels = draw_hud(frame, hud, artwork?.credits ?? 0);
	return { frame, labels };
}

function as_int16(value: number): number {
	return (value << 16) >> 16;
}

function from_radian(rad: number): number {
	return as_int16(Math.trunc((rad - Math.PI / 2) / -(Math.PI * 2 / 65534)));
}

function as_dir256(facing: number): number {
	const raw = facing & 0xffff;
	return (((((raw >>> 7) + 1) >>> 1) % 256) + 256) % 256;
}

function dir_facing(dir256: number): number {
	const facing = as_int16(dir256 << 8);
	const u = facing >>> 0;
	return (((((u >>> 12) + 1) >>> 1) % 8) + 8) % 8;
}

function direction_points(from: Point2D, to: Point2D): number {
	return from_radian(Math.atan2(from.y - to.y, to.x - from.x));
}

function tactical_position_limits(play: Rect, local: Rect): { minimum: Point2D; maximum: Point2D } {
	const minimum = {
		x: (TAC_W >> 1) - (ISO_TILE_PIXEL_W >> 1) * (play.width - 2 * local.x),
		y: (TAC_H >> 1) + (ISO_TILE_PIXEL_H >> 1) * (play.width + 2 * local.y - 5),
	};
	const maximum = {
		x: minimum.x + ISO_TILE_PIXEL_W * local.width - TAC_W,
		y: minimum.y + ((ISO_TILE_PIXEL_H * (2 * local.height + 9)) >> 1) - TAC_H,
	};
	if (maximum.x < minimum.x) {
		minimum.x = maximum.x = ((minimum.x + maximum.x) / 2) | 0;
	}
	if (maximum.y < minimum.y) {
		minimum.y = maximum.y = ((minimum.y + maximum.y) / 2) | 0;
	}
	return { minimum, maximum };
}

function clamp_to_tactical_rect(pixel: Point2D, play: Rect, local: Rect): Point2D {
	const { minimum, maximum } = tactical_position_limits(play, local);
	return {
		x: Math.min(maximum.x, Math.max(minimum.x, pixel.x)),
		y: Math.min(maximum.y, Math.max(minimum.y, pixel.y)),
	};
}

function scroll_dir(camera: Point2D, facing: number, play: Rect, local: Rect): number {
	const delta = SCROLL_DELTA[facing];
	if (!delta) {
		return FACING_NONE;
	}
	const next = { x: camera.x + delta.x, y: camera.y + delta.y };
	if (next.x === camera.x && next.y === camera.y) {
		return facing;
	}
	const clamped = clamp_to_tactical_rect(next, play, local);
	const diff = { x: camera.x - clamped.x, y: camera.y - clamped.y };
	return SCROLL_NEWDIR[(diff.y + 1) * 3 + diff.x + 1] ?? FACING_NONE;
}

function scroll_map(camera: Point2D, facing: number, distance: number, play: Rect, local: Rect): Point2D {
	const delta = SCROLL_DELTA[facing];
	if (!delta || distance === 0) {
		return camera;
	}
	return clamp_to_tactical_rect(
		{ x: camera.x + distance * delta.x, y: camera.y + distance * delta.y },
		play,
		local,
	);
}

type ScrollState = {
	inertia: number;
	remainder: number;
	last_poll: number;
	mouse_down: boolean;
	direction: number;
	inertia_ready: boolean;
	near_canvas: boolean;
};

function scroll_edge(
	mouse: MouseClass,
	camera: Point2D,
	play: Rect,
	local: Rect,
	state: ScrollState,
	now: number,
): Point2D {
	let fraction = 0;
	if (state.last_poll !== 0) {
		fraction = Math.min((now - state.last_poll) * (SCROLL_STEPS_PER_SECOND / 1000), MAX_SCROLL_STEPS_PER_POLL);
	}
	state.last_poll = now;
	if (state.mouse_down || !Options.AutoScroll) {
		if (mouse.CurrentMouseShape !== MOUSE_NORMAL) {
			mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
		}
		return camera;
	}
	const x = mouse.Point.x;
	const y = mouse.Point.y;
	const w = SCREEN_W - 1;
	const h = SCREEN_H - 1;
	const at_screen_edge = state.near_canvas && (y <= 0 || x === 0 || x >= w || y >= h);
	if (!state.inertia && !at_screen_edge) {
		if (mouse.CurrentMouseShape !== MOUSE_NORMAL) {
			mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
		}
		return camera;
	}
	let player_scrolled = false;
	let view = camera;
	if (state.inertia || at_screen_edge) {
		let direction = 0;
		if (at_screen_edge) {
			player_scrolled = true;
			let altx = x;
			if (altx < SCREEN_W * SCROLL_WRATIO) {
				altx = 0;
			} else if (altx > SCREEN_W * (1 - SCROLL_WRATIO)) {
				altx = SCREEN_W - 1;
			} else {
				altx = (SCREEN_W / 2) | 0;
			}
			let alty = y;
			if (alty < SCREEN_H * SCROLL_HRATIO) {
				alty = 0;
			} else if (alty > SCREEN_H * (1 - SCROLL_HRATIO)) {
				alty = SCREEN_H - 1;
			} else {
				alty = (SCREEN_H / 2) | 0;
			}
			direction = as_dir256(direction_points({ x: (SCREEN_W / 2) | 0, y: (SCREEN_H / 2) | 0 }, { x: altx, y: alty }));
			state.direction = direction;
		} else {
			direction = state.direction;
		}
		const control = dir_facing(direction);
		let rate = 8 - state.inertia;
		if (rate < Options.ScrollRate + 1) {
			rate = Options.ScrollRate + 1;
			state.inertia = 8 - rate;
		}
		const facing = dir_facing(direction);
		if (scroll_dir(view, facing, play, local) === FACING_NONE) {
			mouse.Override_Mouse_Shape(MOUSE_NO_N + control, false);
		} else {
			mouse.Override_Mouse_Shape(MOUSE_N + control, false);
			const index = Math.min(SCROLL_PIXELS.length - 1, Math.max(0, rate));
			const step = SCROLL_PIXELS[index]! * 1;
			const scaled = step * fraction + state.remainder;
			const pixels = scaled | 0;
			state.remainder = scaled - pixels;
			view = scroll_map(view, facing, pixels, play, local);
			if (state.inertia_ready && player_scrolled) {
				state.inertia_ready = false;
				state.inertia++;
			}
		}
	}
	if (!player_scrolled) {
		if (state.inertia_ready) {
			state.inertia--;
			if (state.inertia < 0) {
				state.inertia++;
			}
			state.inertia_ready = false;
		}
	}
	return view;
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
	const hud = await load_sidebar(directory, log);
	const mouse = new MouseClass();
	await mouse.One_Time(directory);
	mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
	log(
		`Tactical map ${draw_list.length} cells, theater ${theater || "?"}, ${name}. Edge-scroll or arrows to pan; Escape returns to the menu.`,
	);

	let camera = clamp_to_tactical_rect(starting_camera(draw_list, play, local, home), play, local);
	const scroll: ScrollState = {
		inertia: 0,
		remainder: 0,
		last_poll: 0,
		mouse_down: false,
		direction: 0,
		inertia_ready: true,
		near_canvas: true,
	};
	const previous_cursor = canvas.style.cursor;
	canvas.style.cursor = mouse.MouseShapes ? "none" : previous_cursor;
	let frame_timer = Options.GameSpeed;
	let sys_accum = 0;
	let last_tick = performance.now();
	let raf = 0;

	const paint = (): void => {
		const view = composite_view(tiles, draw_list, camera, artwork, cell_lights, palettes, hud);
		if (mouse.MouseShapes) {
			mouse.Draw_Mouse(view.frame, hud.palette);
		}
		present(canvas, view.frame, view.labels);
	};

	const game_frame = (): void => {
		scroll.inertia_ready = true;
		if (!artwork) {
			return;
		}
		for (const sprite of artwork.sprites) {
			Anim_Logic(sprite);
		}
	};

	const system_tick = (): void => {
		mouse.System_Tick();
		frame_timer--;
		if (frame_timer <= 0) {
			frame_timer = Options.GameSpeed;
			game_frame();
		}
	};

	await new Promise<void>((resolve) => {
		const finish = (): void => {
			cancelAnimationFrame(raf);
			canvas.style.cursor = previous_cursor;
			canvas.removeEventListener("mousedown", on_down);
			canvas.removeEventListener("contextmenu", on_menu);
			window.removeEventListener("mousemove", on_move);
			window.removeEventListener("mouseup", on_up);
			window.removeEventListener("keydown", on_key);
			resolve();
		};
		const on_move = (event: MouseEvent): void => {
			const point = canvas_mouse(canvas, event);
			const slop = 2;
			scroll.near_canvas =
				point.x >= -slop && point.x < SCREEN_W + slop && point.y >= -slop && point.y < SCREEN_H + slop;
			mouse.Point = {
				x: Math.min(SCREEN_W - 1, Math.max(0, point.x)),
				y: Math.min(SCREEN_H - 1, Math.max(0, point.y)),
			};
			canvas.style.cursor = mouse.MouseShapes && scroll.near_canvas ? "none" : previous_cursor;
		};
		const on_down = (event: MouseEvent): void => {
			event.preventDefault();
			on_move(event);
			if (event.button === 0) {
				scroll.mouse_down = true;
			}
		};
		const on_up = (): void => {
			scroll.mouse_down = false;
		};
		const on_menu = (event: Event): void => {
			event.preventDefault();
		};
		const on_key = (event: KeyboardEvent): void => {
			if (cancelled() || event.key === "Escape") {
				finish();
				return;
			}
			const step = ISO_TILE_PIXEL_W;
			if (event.key === "ArrowLeft") {
				camera = clamp_to_tactical_rect({ x: camera.x - step, y: camera.y }, play, local);
			} else if (event.key === "ArrowRight") {
				camera = clamp_to_tactical_rect({ x: camera.x + step, y: camera.y }, play, local);
			} else if (event.key === "ArrowUp") {
				camera = clamp_to_tactical_rect({ x: camera.x, y: camera.y - step }, play, local);
			} else if (event.key === "ArrowDown") {
				camera = clamp_to_tactical_rect({ x: camera.x, y: camera.y + step }, play, local);
			} else {
				return;
			}
			event.preventDefault();
		};
		const tick = (now: number): void => {
			if (cancelled()) {
				finish();
				return;
			}
			sys_accum += now - last_tick;
			last_tick = now;
			const tick_ms = 1000 / TIMER_SECOND;
			while (sys_accum >= tick_ms) {
				sys_accum -= tick_ms;
				system_tick();
			}
			camera = scroll_edge(mouse, camera, play, local, scroll, now);
			paint();
			raf = requestAnimationFrame(tick);
		};
		canvas.addEventListener("mousedown", on_down);
		canvas.addEventListener("contextmenu", on_menu);
		window.addEventListener("mousemove", on_move);
		window.addEventListener("mouseup", on_up);
		window.addEventListener("keydown", on_key);
		if (cancelled()) {
			finish();
			return;
		}
		raf = requestAnimationFrame(tick);
	});
}
