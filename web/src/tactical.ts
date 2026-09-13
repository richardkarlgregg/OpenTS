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
	land_from_tile_type,
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
import { MouseClass, MOUSE_CAN_ATTACK, MOUSE_CAN_MOVE, MOUSE_CAN_SELECT, MOUSE_ENTER_WAYPOINT_MODE, MOUSE_FOLLOW_WAYPOINT, MOUSE_LOOP_WAYPOINT_PATH, MOUSE_N, MOUSE_NO_MOVE, MOUSE_NO_N, MOUSE_NO_PLACE_WAYPOINT, MOUSE_NO_REPAIR, MOUSE_NO_SELL_BACK, MOUSE_NO_TOGGLE_POWER, MOUSE_NORMAL, MOUSE_PLACE_WAYPOINT, MOUSE_REPAIR, MOUSE_SELECT_WAYPOINT, MOUSE_SELL_BACK, MOUSE_SELL_UNIT, MOUSE_STAY_ATTACK, MOUSE_TOGGLE_POWER, MOUSE_WAYPOINT } from "./mouse";
import {
	ActionLineTimer,
	Action_Line_AI,
	Anim_Logic,
	Prune_Dead_Anims,
	Assign_Group_Move,
	Assign_Target,
	Abort_Drag_Select,
	Bandbox_Selection_Callback,
	Cameo_Left,
	Bullet_AI,
	Can_Player_Fire,
	Cameo_Right,
	Can_Demolish,
	Can_Move_To,
	Can_Place_Building,
	Can_Player_Move,
	Can_Repair,
	Can_Sell_Wall,
	Can_Toggle_Power,
	Bind_Path_Graph,
	Display_AI,
	Factory_AI,
	Follow_Waypoint,
	Foot_AI,
	Gate_AI,
	Health_Ratio,
	House_AI,
	Available_Money,
	In_Range_Of,
	LogicClass_AI,
	Mode_Action,
	Mouse_Left_Held,
	Mouse_Left_Press,
	Object_AI,
	Place_Completed_Foot,
	Place_Pending,
	Power_Mode_Control,
	Repair_Mode_Control,
	Select,
	Sell_Mode_Control,
	Team_AI,
	Deliver_Pending_Teams,
	Unselect,
	Unselect_All,
	What_Action,
	Waypoint_Click,
	Waypoint_Drag,
	Waypoint_Mode_Control,
	Waypoint_Release,
	type MapArtwork,
	type MapSprite,
} from "./objects";
import { Options } from "./options";
import { Draw_Building_Lights, Refresh_Building_Light_Arcs } from "./blight";
import { SpotLight_One_Time } from "./ovrlight";
import {
	Advance_Ingame_Movies,
	Blit_Ingame_Movies,
	Has_Ingame_Movies,
	Play_Ingame_Movie_Name,
	Play_Movie,
	Stop_Ingame_Movie,
} from "./movies";
import { canvas_mouse, present, present_gpu, type CanvasLabel } from "./present";
import { TerrainRenderer, terrain_defaults } from "./terrain-renderer";
import { TerrainControls } from "./terrain-controls";
import { Compute_Radar_Image, over_radar, Radar_Pixel_To_Cell, Render_Radar, type RadarMap } from "./radar";
import { blit_shape, blit_shape_shadow } from "./shp";
import { Draw_Shroud, ShroudMap } from "./shroud";
import { blit_voxel } from "./voxlib";
import {
	draw_hud,
	load_sidebar,
	over_tactical,
	Sidebar_Cameo_At,
	Sidebar_Click,
	Sidebar_Button_At,
	SCREEN_H,
	SCREEN_W,
	TAC_H,
	TAC_W,
	TAC_X,
	TAC_Y,
	type SidebarArt,
} from "./sidebar";
import { TIMER_SECOND } from "./stimer";
import { build_hicolor_pixel, DSurface } from "./surface";
import { Theme } from "./theme";
import { Menu_Click_Sound, Set_Game_Active, Set_Sound_View } from "./voc";
import { Speak_Tick } from "./vox";
import { Cell_Center } from "./walk";
import { graph_cell } from "./zone";
import {
	Can_Add_Waypoint_To_Path,
	Fetch_Waypoint_Data,
	Get_Next_Waypoint,
	PATH_NONE,
	Waypoint_At,
} from "./waypoint";
import type { FactoryObject } from "./factory";
import { MESSAGE_LINE } from "./trigger";

type IsoCell = { x: number; y: number; height: number; tile: number; subtile: number };

function In_Radar(x: number, y: number, play: Rect): boolean {
	const w = play.width;
	const h = play.height;
	return x + y > w && x - y < w && y - x < w && x + y <= w + 2 * h;
}

const VIEW_W = TAC_W;
const VIEW_H = TAC_H;
const CELL_LEPTON = 256;
const CELL_PIXEL_W = 24;
const CELL_PIXEL_H = 48;
const CELL_LEPTON_DIAG = Math.sqrt(CELL_LEPTON * CELL_LEPTON * 2);
const LEVEL_LEPTON_H = Math.trunc((Math.tan(Math.PI / 2 - Math.PI / 3) * CELL_LEPTON_DIAG) / 2);
const Z_PIXELS_PER_LEPTON = Math.sin(Math.PI / 3) * (ISO_TILE_PIXEL_W / CELL_LEPTON_DIAG);
const BRIDGE_CELL_HEIGHT = 4;
const BRIDGE_LEPTON_HEIGHT = Math.trunc(LEVEL_LEPTON_H * BRIDGE_CELL_HEIGHT + 0.5);
const WHITE = 15;

type Selectable = {
	object: MapSprite;
	position: Point2D;
};

let SelectableObjects: Selectable[] = [];
const PIXEL_TO_COORD_X = Math.trunc(CELL_LEPTON / CELL_PIXEL_W) + 0.6667;
const PIXEL_TO_COORD_Y = Math.trunc(CELL_LEPTON / CELL_PIXEL_H) + 0.3333302;
const RAMP_CONTROL: { x: number; y: number; base: number; max: number; extra: number }[] = [
	{ x: 1, y: 0, base: 0, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: 0, y: 1, base: 0, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: -1, y: 0, base: LEVEL_LEPTON_H, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: 0, y: -1, base: LEVEL_LEPTON_H, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: 1, y: 1, base: -LEVEL_LEPTON_H, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: -1, y: 1, base: 0, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: -1, y: -1, base: LEVEL_LEPTON_H, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: 1, y: -1, base: 0, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: 1, y: 1, base: 0, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: -1, y: 1, base: LEVEL_LEPTON_H, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: -1, y: -1, base: LEVEL_LEPTON_H + LEVEL_LEPTON_H, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: 1, y: -1, base: LEVEL_LEPTON_H, max: LEVEL_LEPTON_H, extra: 0 },
	{ x: 1, y: 1, base: 0, max: LEVEL_LEPTON_H + LEVEL_LEPTON_H, extra: 0 },
	{ x: -1, y: 1, base: LEVEL_LEPTON_H, max: LEVEL_LEPTON_H + LEVEL_LEPTON_H, extra: 0 },
	{ x: -1, y: -1, base: LEVEL_LEPTON_H + LEVEL_LEPTON_H, max: LEVEL_LEPTON_H + LEVEL_LEPTON_H, extra: 0 },
	{ x: 1, y: -1, base: LEVEL_LEPTON_H, max: LEVEL_LEPTON_H + LEVEL_LEPTON_H, extra: 0 },
	{ x: 0, y: 0, base: 0, max: LEVEL_LEPTON_H * 0.5, extra: LEVEL_LEPTON_H * 0.5 },
	{ x: 0, y: 0, base: LEVEL_LEPTON_H, max: LEVEL_LEPTON_H * 0.5, extra: LEVEL_LEPTON_H * -0.5 },
	{ x: 0, y: 0, base: 0, max: LEVEL_LEPTON_H * 0.5, extra: LEVEL_LEPTON_H * 0.5 },
	{ x: 0, y: 0, base: LEVEL_LEPTON_H, max: LEVEL_LEPTON_H * 0.5, extra: LEVEL_LEPTON_H * -0.5 },
];
type Coord = { x: number; y: number; z: number };
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

function cell_pixel(cell: { x: number; y: number; height: number }): Point2D {
	return {
		x: (cell.x - cell.y) * (ISO_TILE_PIXEL_W >> 1) - (ISO_TILE_PIXEL_W >> 1),
		y: (cell.x + cell.y) * (ISO_TILE_PIXEL_H >> 1) - cell.height * LEVEL_PIXEL_H,
	};
}

function fill_iso_diamond(
	dest: DSurface,
	origin: Point2D,
	heights: Map<string, number>,
	cell: Point2D,
	color: number,
): void {
	const height = heights.get(`${cell.x},${cell.y}`) ?? 0;
	const pixel = cell_pixel({ x: cell.x, y: cell.y, height });
	const dx = pixel.x - origin.x;
	const dy = pixel.y - origin.y;
	const hw = ISO_TILE_PIXEL_W >> 1;
	const hh = ISO_TILE_PIXEL_H >> 1;
	for (let row = 0; row < ISO_TILE_PIXEL_H; row++) {
		const sy = dy + row;
		if (sy < 0 || sy >= dest.height) {
			continue;
		}
		const dist = row < hh ? row : ISO_TILE_PIXEL_H - 1 - row;
		const half = Math.trunc((dist * ISO_TILE_PIXEL_W) / ISO_TILE_PIXEL_H);
		const x0 = dx + hw - half;
		const x1 = dx + hw + half;
		const dest_row = sy * dest.width;
		for (let sx = x0; sx < x1; sx++) {
			if (sx < 0 || sx >= dest.width) {
				continue;
			}
			const dst = dest.pixels[dest_row + sx]!;
			dest.pixels[dest_row + sx] = ((color & 0xf7de) >> 1) + ((dst & 0xf7de) >> 1);
		}
	}
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

const SCROLL_SPEEDS = [0.0015, 0.003, 0.0075, 0.03, 0.06];

function lerp_point(from: Point2D, to: Point2D, factor: number): Point2D {
	return {
		x: Math.trunc(from.x + (to.x - from.x) * factor),
		y: Math.trunc(from.y + (to.y - from.y) * factor),
	};
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
	shroud: ShroudMap | null,
	selected: MapSprite[],
	ghost: { cell: Point2D; legal: boolean } | null,
	mouse: MouseClass | null,
	terrain_background?: number,
): { frame: DSurface; labels: CanvasLabel[] } {
	const origin = view_origin(camera);
	const frame = new DSurface(VIEW_W, VIEW_H);
	if (terrain_background !== undefined) frame.fill(terrain_background);
	const heights = new Map<string, number>();
	const ramps = new Map<string, number>();
	for (const cell of cells) {
		heights.set(`${cell.x},${cell.y}`, cell.height);
		ramps.set(`${cell.x},${cell.y}`, fetch_subtile(tiles, cell.tile, cell.subtile)?.ramp ?? 0);
		if (terrain_background !== undefined) continue;
		if (shroud && !shroud.IsMapped(cell.x, cell.y)) {
			continue;
		}
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
	if (artwork) {
		SelectableObjects = [];
		const color = Convert_Pixel(artwork.unit_palette, WHITE);
		const waypoint_labels = Draw_Waypoints(frame, origin, artwork, heights, shroud, mouse);
		Add_Buildings_To_Selectable(artwork, origin, heights);
		const draw_sprite = (sprite: (typeof artwork.sprites)[number], shadow: boolean): void => {
			if (shroud && !shroud.IsMapped(sprite.x, sprite.y)) {
				return;
			}
			const draw = sprite_draw_point(sprite, origin, heights);
			const dx = draw.x;
			const fly = shadow ? Z_Lepton_To_Pixel(sprite.foot?.height_agl ?? 0) : 0;
			const dy = draw.y + fly;
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
		const register = (sprite: MapSprite): void => {
			if (sprite.rtti === "building") {
				return;
			}
			Add_To_Selectables(sprite, sprite_draw_point(sprite, origin, heights));
		};
		for (const sprite of artwork.sprites) {
			draw_sprite(sprite, true);
		}
		for (const sprite of selected) {
			draw_selection_pre(frame, origin, sprite, heights, ramps, color);
		}
		for (const sprite of artwork.sprites) {
			draw_sprite(sprite, false);
			if (sprite.rtti !== "building" && (!shroud || shroud.IsMapped(sprite.x, sprite.y))) {
				register(sprite);
			}
		}
		for (const sprite of selected) {
			draw_selection_post(frame, origin, sprite, artwork, heights, ramps, color);
		}
		if (ActionLineTimer > 0) {
			draw_move_lines(frame, origin, artwork, heights, ramps);
		}
		Draw_Building_Lights(artwork, {
			frame,
			origin,
			clip: { x: 0, y: 0, width: VIEW_W, height: VIEW_H },
			coord_to_pixel: (coord) => Coord_To_Pixel(coord, origin),
			z_lepton_to_pixel: Z_Lepton_To_Pixel,
			is_mapped: (x, y) => !shroud || shroud.IsMapped(x, y),
		});
		if (ghost && artwork.production.pending) {
			const tint = ghost.legal ? build_hicolor_pixel(0, 200, 0) : build_hicolor_pixel(200, 0, 0);
			for (const offset of artwork.production.pending.occupy) {
				fill_iso_diamond(frame, origin, heights, { x: ghost.cell.x + offset.x, y: ghost.cell.y + offset.y }, tint);
			}
			for (const sprite of artwork.production.pending.sprites) {
				draw_sprite({ ...sprite, x: ghost.cell.x, y: ghost.cell.y }, true);
			}
			for (const sprite of artwork.production.pending.sprites) {
				draw_sprite({ ...sprite, x: ghost.cell.x, y: ghost.cell.y }, false);
			}
		}
		if (shroud) {
			Draw_Shroud(frame, origin, cells, cell_pixel, shroud, artwork.shroud ?? null);
		}
		Draw_Rubber_Band(frame, artwork, color);
		return { frame, labels: waypoint_labels };
	}
	if (shroud) {
		Draw_Shroud(frame, origin, cells, cell_pixel, shroud, null);
	}
	return { frame, labels: [] };
}

function sprite_center(
	sprite: MapSprite,
	origin: Point2D,
	heights: Map<string, number>,
): Point2D {
	const height = (heights.get(`${sprite.x},${sprite.y}`) ?? 0) + (sprite.foot?.is_on_bridge ? BRIDGE_CELL_HEIGHT : 0);
	const pixel = cell_pixel({ x: sprite.x, y: sprite.y, height });
	const fly = Z_Lepton_To_Pixel(sprite.foot?.height_agl ?? 0);
	return {
		x: pixel.x + (ISO_TILE_PIXEL_W >> 1) + sprite.ox - origin.x,
		y: pixel.y + (ISO_TILE_PIXEL_H >> 1) + sprite.oy - fly - origin.y,
	};
}

function sprite_draw_point(
	sprite: MapSprite,
	origin: Point2D,
	heights: Map<string, number>,
): Point2D {
	const center = sprite_center(sprite, origin, heights);
	if (!sprite.corner) {
		return center;
	}
	return { x: center.x, y: center.y - (ISO_TILE_PIXEL_H >> 1) };
}

function Z_Lepton_To_Pixel(z: number): number {
	let fudge = 0;
	if (z >= CELL_LEPTON * 3 + CELL_LEPTON / 2 + 40) {
		fudge = 1;
	}
	return Math.trunc(z * Z_PIXELS_PER_LEPTON + fudge + 0.5);
}

function Coord_To_Pixel(coord: Coord, origin: Point2D): Point2D {
	const iso_x = Math.trunc((coord.x * ISO_TILE_PIXEL_W) / 2) + Math.trunc((coord.y * ISO_TILE_PIXEL_W) / -2);
	const iso_y = Math.trunc((coord.x * ISO_TILE_PIXEL_H) / 2) + Math.trunc((coord.y * ISO_TILE_PIXEL_H) / 2);
	return {
		x: Math.trunc(iso_x / CELL_LEPTON) - origin.x,
		y: Math.trunc(iso_y / CELL_LEPTON) - Z_Lepton_To_Pixel(coord.z) - origin.y,
	};
}

function Convert_Pixel(palette: Uint16Array, pixel: number): number {
	return palette[pixel & 255] ?? 0;
}

function Is_Point_Within(rect: Rect, point: Point2D): boolean {
	return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function Add_To_Selectables(object: MapSprite, point: Point2D): boolean {
	if (point.x >= -32 && point.x <= VIEW_W + 32 && point.y >= -32 && point.y <= VIEW_H + 32) {
		SelectableObjects.push({ object, position: point });
		return true;
	}
	return false;
}

function Add_Buildings_To_Selectable(
	artwork: MapArtwork,
	origin: Point2D,
	heights: Map<string, number>,
): void {
	for (const sprite of artwork.sprites) {
		if (sprite.rtti !== "building") {
			continue;
		}
		const point = sprite_draw_point(sprite, origin, heights);
		if (point.x >= 0 && point.x <= VIEW_W && point.y >= 0 && point.y <= VIEW_H) {
			Add_To_Selectables(sprite, point);
		}
	}
}

function Select_These(artwork: MapArtwork, rect: Rect): void {
	if (rect.width <= 0 || rect.height <= 0) {
		return;
	}
	for (const sel of SelectableObjects) {
		if (!Is_Point_Within(rect, sel.position)) {
			continue;
		}
		Bandbox_Selection_Callback(artwork, sel.object);
	}
}

function Select_Rubber_Band(artwork: MapArtwork): void {
	if (artwork.rubber_band_start.x === 0 && artwork.rubber_band_start.y === 0) {
		return;
	}
	let start = { x: artwork.rubber_band_start.x, y: artwork.rubber_band_start.y };
	let end = { x: artwork.rubber_band_end.x, y: artwork.rubber_band_end.y };
	if (start.x > end.x) {
		const swap = start.x;
		start.x = end.x;
		end.x = swap;
	}
	if (start.y > end.y) {
		const swap = start.y;
		start.y = end.y;
		end.y = swap;
	}
	Select_These(artwork, {
		x: start.x,
		y: start.y,
		width: end.x - start.x + 1,
		height: end.y - start.y + 1,
	});
	artwork.rubber_band_start = { x: 0, y: 0 };
}

function Draw_Rubber_Band(frame: DSurface, artwork: MapArtwork, color: number): void {
	if (artwork.rubber_band_start.x === 0 && artwork.rubber_band_start.y === 0) {
		return;
	}
	let start = { x: artwork.rubber_band_start.x, y: artwork.rubber_band_start.y };
	let end = { x: artwork.rubber_band_end.x, y: artwork.rubber_band_end.y };
	if (end.x < start.x) {
		const swap = start.x;
		start.x = end.x;
		end.x = swap;
	}
	if (end.y < start.y) {
		const swap = start.y;
		start.y = end.y;
		end.y = swap;
	}
	frame.draw_rect(start.x, start.y, end.x - start.x + 1, end.y - start.y + 1, color);
}

function Best_Selected(artwork: MapArtwork | null): MapSprite | null {
	return artwork && artwork.current_object.length > 0 ? artwork.current_object[0]! : null;
}

function tactical_mouse(point: Point2D): Point2D {
	return { x: point.x - TAC_X, y: point.y - TAC_Y };
}

function draw_move_lines(
	frame: DSurface,
	origin: Point2D,
	artwork: MapArtwork,
	heights: Map<string, number>,
	ramps: Map<string, number>,
): void {
	const color = build_hicolor_pixel(0, 170, 0);
	for (const sprite of artwork.sprites) {
		const foot = sprite.foot;
		if (!sprite.owned || !foot?.dest) {
			continue;
		}
		const dest = Cell_Center(foot.dest);
		const dest_under = artwork.path_graph ? (graph_cell(artwork.path_graph, foot.dest)?.under_bridge ?? false) : false;
		const start = Coord_To_Pixel(
			{
				x: foot.lx,
				y: foot.ly,
				z: Get_Height({ x: foot.lx, y: foot.ly }, heights, ramps) + (foot.is_on_bridge ? BRIDGE_LEPTON_HEIGHT : 0),
			},
			origin,
		);
		const end = Coord_To_Pixel(
			{
				x: dest.x,
				y: dest.y,
				z: Get_Height({ x: dest.x, y: dest.y }, heights, ramps) + (dest_under ? BRIDGE_LEPTON_HEIGHT : 0),
			},
			origin,
		);
		frame.draw_line(start.x, start.y, end.x, end.y, color);
		frame.fill_rect(start.x - 1, start.y - 1, 3, 3, color);
		frame.fill_rect(end.x - 1, end.y - 1, 3, 3, color);
	}
}

function Pixel_To_Lepton(pixel: Point2D): Point2D {
	return {
		x: Math.trunc(PIXEL_TO_COORD_Y * pixel.x + PIXEL_TO_COORD_X * pixel.y),
		y: Math.trunc(-PIXEL_TO_COORD_Y * pixel.x + PIXEL_TO_COORD_X * pixel.y),
	};
}

function Get_Height(point: Point2D, heights: Map<string, number>, ramps: Map<string, number>): number {
	const cellx = Math.trunc(point.x / CELL_LEPTON);
	const celly = Math.trunc(point.y / CELL_LEPTON);
	const level = heights.get(`${cellx},${celly}`) ?? 0;
	let height = Math.trunc(LEVEL_LEPTON_H * level + 0.5);
	const ramp = ramps.get(`${cellx},${celly}`) ?? 0;
	if (ramp <= 0 || ramp > RAMP_CONTROL.length) {
		return height;
	}
	const control = RAMP_CONTROL[ramp - 1]!;
	const slope = LEVEL_LEPTON_H / CELL_LEPTON;
	let rampheight =
		(point.x & (CELL_LEPTON - 1)) * control.x * slope +
		(point.y & (CELL_LEPTON - 1)) * control.y * slope +
		control.base +
		control.extra;
	if (rampheight < 0) {
		rampheight = 0;
	}
	if (rampheight > control.max) {
		rampheight = control.max;
	}
	return height + Math.trunc(rampheight);
}

function Pixel_To_Cell(point: Point2D, origin: Point2D, heights: Map<string, number>, bridges: Set<string>): Point2D {
	const span = 12 * (ISO_TILE_PIXEL_H >> 1);
	let scany = span + point.y;
	for (let count = 0; count < span; count++) {
		const lepton = Pixel_To_Lepton({ x: point.x + origin.x, y: scany + origin.y });
		const cell = { x: Math.trunc(lepton.x / CELL_LEPTON), y: Math.trunc(lepton.y / CELL_LEPTON) };
		const height = heights.get(`${cell.x},${cell.y}`) ?? 0;
		let celly = scany - height * (ISO_TILE_PIXEL_H >> 1);
		if (bridges.has(`${cell.x},${cell.y}`)) {
			celly -= BRIDGE_CELL_HEIGHT * (ISO_TILE_PIXEL_H >> 1);
		}
		if (celly <= point.y) {
			return cell;
		}
		scany -= 1;
	}
	const fallback = Pixel_To_Lepton({ x: point.x + origin.x, y: point.y + origin.y });
	return { x: Math.trunc(fallback.x / CELL_LEPTON), y: Math.trunc(fallback.y / CELL_LEPTON) };
}

function Draw_3D_Line(dest: DSurface, origin: Point2D, a: Coord, b: Coord, color: number): void {
	const start = Coord_To_Pixel(a, origin);
	const end = Coord_To_Pixel(b, origin);
	dest.Draw_Depth_Shaded_Line(start, end, color, 14 - Z_Lepton_To_Pixel(a.z), 14 - Z_Lepton_To_Pixel(b.z), false);
}

function lerp_quarter(a: Coord, b: Coord): Coord {
	return {
		x: Math.trunc((a.x + a.x + a.x + b.x) / 4),
		y: Math.trunc((a.y + a.y + a.y + b.y) / 4),
		z: Math.trunc((a.z + a.z + a.z + b.z) / 4),
	};
}

function Draw_Double_Selection_Bracket(dest: DSurface, origin: Point2D, a: Coord, b: Coord, color: number): void {
	Draw_3D_Line(dest, origin, a, lerp_quarter(a, b), color);
	Draw_3D_Line(dest, origin, b, lerp_quarter(b, a), color);
}

function Draw_Single_Selection_Bracket(dest: DSurface, origin: Point2D, a: Coord, b: Coord, color: number): void {
	Draw_3D_Line(dest, origin, a, lerp_quarter(a, b), color);
}

function select_center(sprite: MapSprite, heights: Map<string, number>, ramps: Map<string, number>): Coord {
	const box = sprite.select?.kind === "box" ? sprite.select : null;
	const x = sprite.x * CELL_LEPTON + (box ? Math.trunc(box.lx / 2) : CELL_LEPTON / 2);
	const y = sprite.y * CELL_LEPTON + (box ? Math.trunc(box.ly / 2) : CELL_LEPTON / 2);
	const z = Get_Height({ x, y }, heights, ramps) + (sprite.foot?.is_on_bridge ? BRIDGE_LEPTON_HEIGHT : 0);
	return { x, y, z };
}

function add_coord(center: Coord, x: number, y: number, z: number): Coord {
	return { x: center.x + x, y: center.y + y, z: center.z + z };
}

function draw_selection_pre(
	dest: DSurface,
	origin: Point2D,
	sprite: MapSprite,
	heights: Map<string, number>,
	ramps: Map<string, number>,
	color: number,
): void {
	const box = sprite.select;
	if (!box || box.kind !== "box" || !box.pre) {
		return;
	}
	const hx = Math.trunc(box.lx / 2);
	const hy = Math.trunc(box.ly / 2);
	const center = select_center(sprite, heights, ramps);
	Draw_Double_Selection_Bracket(dest, origin, add_coord(center, -hx, -hy, 0), add_coord(center, -hx, -hy, box.lz), color);
	Draw_Double_Selection_Bracket(dest, origin, add_coord(center, -hx, -hy, 0), add_coord(center, hx, -hy, 0), color);
	Draw_Double_Selection_Bracket(dest, origin, add_coord(center, -hx, -hy, 0), add_coord(center, -hx, hy, 0), color);
	Draw_Double_Selection_Bracket(dest, origin, add_coord(center, -hx, -hy, box.lz), add_coord(center, -hx, hy, box.lz), color);
	Draw_Double_Selection_Bracket(dest, origin, add_coord(center, -hx, -hy, box.lz), add_coord(center, hx, -hy, box.lz), color);
}

function draw_selection_box_post(
	dest: DSurface,
	origin: Point2D,
	sprite: MapSprite,
	heights: Map<string, number>,
	ramps: Map<string, number>,
	color: number,
): void {
	const box = sprite.select;
	if (!box || box.kind !== "box") {
		return;
	}
	const hx = Math.trunc(box.lx / 2);
	const hy = Math.trunc(box.ly / 2);
	const center = select_center(sprite, heights, ramps);
	Draw_Double_Selection_Bracket(dest, origin, add_coord(center, hx, hy, 0), add_coord(center, -hx, hy, 0), color);
	Draw_Double_Selection_Bracket(dest, origin, add_coord(center, hx, hy, 0), add_coord(center, hx, -hy, 0), color);
	Draw_Double_Selection_Bracket(dest, origin, add_coord(center, -hx, hy, 0), add_coord(center, -hx, hy, box.lz), color);
	Draw_Double_Selection_Bracket(dest, origin, add_coord(center, hx, -hy, 0), add_coord(center, hx, -hy, box.lz), color);
	Draw_Single_Selection_Bracket(dest, origin, add_coord(center, hx, hy, 0), add_coord(center, hx, hy, box.lz), color);
	Draw_Single_Selection_Bracket(dest, origin, add_coord(center, hx, -hy, box.lz), add_coord(center, hx, hy, box.lz), color);
	Draw_Single_Selection_Bracket(dest, origin, add_coord(center, -hx, hy, box.lz), add_coord(center, hx, hy, box.lz), color);
}

function Draw_Health_Bar(
	dest: DSurface,
	origin: Point2D,
	sprite: MapSprite,
	artwork: MapArtwork,
	heights: Map<string, number>,
	ramps: Map<string, number>,
): void {
	const box = sprite.select?.kind === "box" ? sprite.select : null;
	const xpoint =
		sprite.rtti === "building" || box
			? Coord_To_Pixel(select_center(sprite, heights, ramps), origin)
			: sprite_center(sprite, origin, heights);
	if (sprite.rtti === "building" || box) {
		if (!box || !artwork.pips) {
			return;
		}
		const halfx = Math.trunc(box.lx / 2);
		const halfy = Math.trunc(box.ly / 2);
		const p0 = Coord_To_Pixel({ x: -(box.lx - halfx), y: box.ly - halfy, z: box.lz }, { x: 0, y: 0 });
		const p1 = Coord_To_Pixel({ x: -(box.lx - halfx), y: -(box.ly - halfy), z: box.lz }, { x: 0, y: 0 });
		const barlen = Math.trunc((p0.y - p1.y) / 2);
		if (barlen <= 0) {
			return;
		}
		const ratio = Health_Ratio(artwork, sprite);
		let n = Math.trunc(ratio * barlen);
		if (n <= 1) {
			n = 1;
		}
		if (n >= barlen) {
			n = barlen;
		}
		let condcolor = 1;
		if (ratio <= artwork.condition_yellow) {
			condcolor = 2;
		}
		if (ratio <= artwork.condition_red) {
			condcolor = 4;
		}
		const ybase = 2 - 2 * barlen;
		let yoff = 0;
		let xoff = 0;
		for (let index = 0; index < n; index++) {
			blit_shape(
				dest,
				artwork.normal_palette,
				artwork.pips,
				condcolor,
				xpoint.x + p0.x + 4 * barlen + 3 - xoff,
				xpoint.y + p0.y + ybase + 2 - yoff,
				true,
			);
			xoff += 4;
			yoff -= 2;
		}
		yoff = -2 * n;
		xoff = 4 * n;
		for (let index = n; index < barlen; index++) {
			blit_shape(
				dest,
				artwork.normal_palette,
				artwork.pips,
				0,
				xpoint.x + p0.x + 4 * barlen + 3 - xoff,
				xpoint.y + p0.y + ybase + 2 - yoff,
				true,
			);
			xoff += 4;
			yoff -= 2;
		}
		return;
	}
	const sel = sprite.select;
	if (sel?.kind === "shape" && artwork.select) {
		blit_shape(dest, artwork.normal_palette, artwork.select, sel.frame, xpoint.x, xpoint.y, true);
	}
	if (!artwork.pips) {
		return;
	}
	const infantry = sprite.rtti === "infantry";
	const offset = infantry ? { x: -5, y: -24 } : { x: -15, y: -25 };
	const health_bar_count = infantry ? 8 : 17;
	const ratio = Health_Ratio(artwork, sprite);
	let n = Math.trunc(ratio * health_bar_count);
	if (n <= 1) {
		n = 1;
	}
	if (n >= health_bar_count) {
		n = health_bar_count;
	}
	let shapenum = 9;
	if (ratio <= artwork.condition_yellow) {
		shapenum = 10;
	}
	if (ratio <= artwork.condition_red) {
		shapenum = 11;
	}
	for (let index = 0; index < n; index++) {
		blit_shape(
			dest,
			artwork.normal_palette,
			artwork.pips,
			shapenum,
			xpoint.x + offset.x + 2 * index,
			xpoint.y + offset.y,
			true,
		);
	}
}

function draw_selection_post(
	dest: DSurface,
	origin: Point2D,
	sprite: MapSprite,
	artwork: MapArtwork,
	heights: Map<string, number>,
	ramps: Map<string, number>,
	color: number,
): void {
	const sel = sprite.select;
	if (!sel) {
		return;
	}
	if (sel.kind === "box") {
		draw_selection_box_post(dest, origin, sprite, heights, ramps, color);
	}
	Draw_Health_Bar(dest, origin, sprite, artwork, heights, ramps);
}

function occupies_cell(sprite: MapSprite, cell: Point2D): boolean {
	return sprite.occupy.some((offset) => sprite.x + offset.x === cell.x && sprite.y + offset.y === cell.y);
}

function bridge_cells(artwork: MapArtwork): Set<string> {
	const cells = new Set<string>();
	for (const sprite of artwork.sprites) {
		if (sprite.bridge) {
			cells.add(`${sprite.x},${sprite.y}`);
		}
	}
	return cells;
}

function Cell_Occupier(artwork: MapArtwork, cell: Point2D, shroud: ShroudMap | null): MapSprite | null {
	let occupier: MapSprite | null = null;
	for (const sprite of artwork.sprites) {
		if (!sprite.selectable) {
			continue;
		}
		if (shroud && !shroud.IsMapped(sprite.x, sprite.y)) {
			continue;
		}
		if (sprite.rtti === "building") {
			if (occupies_cell(sprite, cell) && !occupier) {
				occupier = sprite;
			}
			continue;
		}
		if (sprite.x === cell.x && sprite.y === cell.y) {
			occupier = sprite;
		}
	}
	return occupier;
}

function hover_sprite(
	artwork: MapArtwork,
	mouse: Point2D,
	camera: Point2D,
	heights: Map<string, number>,
	bridges: Set<string>,
	shroud: ShroudMap | null,
): MapSprite | null {
	if (!over_tactical(mouse.x, mouse.y)) {
		return null;
	}
	const origin = view_origin(camera);
	const mx = mouse.x - TAC_X;
	const my = mouse.y - TAC_Y;
	let best: MapSprite | null = null;
	let best_dist = 200;
	for (const sprite of artwork.sprites) {
		if (!sprite.selectable) {
			continue;
		}
		if (shroud && !shroud.IsMapped(sprite.x, sprite.y)) {
			continue;
		}
		const click = sprite_center(sprite, origin, heights);
		const dx = click.x - mx;
		const dy = click.y - my;
		const dist = dx * dx + dy * dy * 0.5;
		if (dist < best_dist) {
			best_dist = dist;
			best = sprite;
		}
	}
	if (best) {
		return best;
	}
	const cell = Pixel_To_Cell({ x: mx, y: my }, origin, heights, bridges);
	if (shroud && !shroud.IsMapped(cell.x, cell.y)) {
		return null;
	}
	return Cell_Occupier(artwork, cell, shroud);
}

function composite_view(
	tiles: TheaterTiles,
	cells: IsoCell[],
	camera: Point2D,
	artwork: MapArtwork | null,
	cell_lights: Map<string, CellLight>,
	palettes: Map<string, Uint16Array>,
	hud: SidebarArt,
	shroud: ShroudMap | null,
	selected: MapSprite[],
	radar: RadarMap | null,
	ghost: { cell: Point2D; legal: boolean } | null,
	mouse: MouseClass | null,
	terrain_background?: number,
): { frame: DSurface; labels: CanvasLabel[] } {
	const tactical = draw_view(tiles, cells, camera, artwork, cell_lights, palettes, shroud, selected, ghost, mouse, terrain_background);
	const frame = new DSurface(SCREEN_W, SCREEN_H);
	frame.blit_from(TAC_X, TAC_Y, tactical.frame);
	const radar_on = radar?.exists === true;
	const labels = draw_hud(
		frame,
		hud,
		artwork ? Available_Money(artwork) : 0,
		artwork?.power_output ?? 0,
		artwork?.power_drain ?? 0,
		radar_on,
		artwork?.sidebar ?? null,
		artwork?.is_repair_mode ?? false,
		artwork?.is_sell_mode ?? false,
		artwork?.is_power_mode ?? false,
		artwork?.is_waypoint_mode ?? false,
	);
	for (const label of tactical.labels) {
		labels.push({
			...label,
			x: label.x + TAC_X,
			y: label.y + TAC_Y,
		});
	}
	if (radar && radar_on) {
		Render_Radar(frame, radar, cells, tiles, shroud, artwork?.sprites ?? [], camera);
	}
	if (Has_Ingame_Movies()) {
		Blit_Ingame_Movies(frame);
	}
	if (artwork) {
		for (let i = 0; i < artwork.messages.length; i++) {
			labels.push({
				x: TAC_X,
				y: TAC_Y + i * MESSAGE_LINE,
				width: TAC_W - 8,
				height: MESSAGE_LINE,
				text: artwork.messages[i]!.text,
				align: "left",
			});
		}
	}
	return { frame, labels };
}

function mode_mouse(artwork: MapArtwork, hover: MapSprite | null, cell: Point2D | null): number {
	if (artwork.is_repair_mode) {
		return hover && Can_Repair(artwork, hover) ? MOUSE_REPAIR : MOUSE_NO_REPAIR;
	}
	if (artwork.is_power_mode) {
		return hover && Can_Toggle_Power(artwork, hover) ? MOUSE_TOGGLE_POWER : MOUSE_NO_TOGGLE_POWER;
	}
	if (hover && Can_Demolish(artwork, hover)) {
		return hover.rtti === "building" ? MOUSE_SELL_BACK : MOUSE_SELL_UNIT;
	}
	if (cell && Can_Sell_Wall(artwork, cell)) {
		return MOUSE_SELL_BACK;
	}
	return MOUSE_NO_SELL_BACK;
}

const WAYPOINT_LINE_STYLE = [true, true, true, true, true, false, false, false];

function Draw_Waypoints(
	frame: DSurface,
	origin: Point2D,
	artwork: MapArtwork,
	heights: Map<string, number>,
	shroud: ShroudMap | null,
	mouse: MouseClass | null,
): CanvasLabel[] {
	const labels: CanvasLabel[] = [];
	const palette = mouse?.Palette ?? artwork.unit_palette;
	const shapes = mouse?.MouseShapes ?? null;
	const color = Convert_Pixel(palette, 3);
	const count = Math.max(1, mouse?.Get_Mouse_Frame_Count(MOUSE_WAYPOINT) ?? 1);
	const speed = Math.max(1, artwork.production.waypoint_animation_speed);
	const flag = (mouse?.Get_Mouse_Start_Frame(MOUSE_WAYPOINT) ?? 0) + (Math.trunc(artwork.frame / speed) % count);
	let phase = (0x7fffffff - artwork.frame) % TIMER_SECOND;
	for (let path = 0; path < artwork.paths.length; path++) {
		const list = artwork.paths[path]!;
		if (list.Waypoints.length === 0) {
			continue;
		}
		const selected = path === artwork.selected_path;
		for (let index = 0; index < list.Waypoints.length; index++) {
			const waypoint = list.Waypoints[index]!;
			if (shroud && !shroud.IsMapped(waypoint.x, waypoint.y)) {
				continue;
			}
			const height = heights.get(`${waypoint.x},${waypoint.y}`) ?? 0;
			const pixel = cell_pixel({ x: waypoint.x, y: waypoint.y, height });
			const px = pixel.x + (ISO_TILE_PIXEL_W >> 1) - origin.x;
			const py = pixel.y + (ISO_TILE_PIXEL_H >> 1) - origin.y;
			if (shapes) {
				blit_shape(frame, palette, shapes, flag, px, py, true);
			}
			labels.push({
				x: px - 10,
				y: py - 28,
				width: 20,
				height: 12,
				text: `${index}`,
				selected,
			});
			const next = Get_Next_Waypoint(list, waypoint);
			if (!next) {
				continue;
			}
			const next_height = heights.get(`${next.x},${next.y}`) ?? 0;
			const next_pixel = cell_pixel({ x: next.x, y: next.y, height: next_height });
			const nx = next_pixel.x + (ISO_TILE_PIXEL_W >> 1) - origin.x;
			const ny = next_pixel.y + (ISO_TILE_PIXEL_H >> 1) - origin.y;
			if (selected) {
				phase = frame.draw_dashed_line(px, py, nx, ny, color, WAYPOINT_LINE_STYLE, phase);
			} else {
				frame.draw_line(px, py, nx, ny, color);
			}
		}
	}
	return labels;
}

function waypoint_mouse(artwork: MapArtwork, cell: Point2D, play: Rect, shift: boolean): number {
	if (artwork.dragged_waypoint) {
		return MOUSE_SELECT_WAYPOINT;
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
		return MOUSE_LOOP_WAYPOINT_PATH;
	}
	if (waypoint) {
		return MOUSE_SELECT_WAYPOINT;
	}
	if (
		artwork.selected_path !== PATH_NONE &&
		Can_Add_Waypoint_To_Path(artwork.paths, artwork.selected_path, artwork.production.max_waypoint_path_length) &&
		In_Radar(cell.x, cell.y, play)
	) {
		return MOUSE_PLACE_WAYPOINT;
	}
	return MOUSE_NO_PLACE_WAYPOINT;
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
	if (artwork) {
		artwork.terrain.clear();
		for (const cell of draw_list) {
			const sub = fetch_subtile(tiles, cell.tile, cell.subtile);
			artwork.terrain.set(`${cell.x},${cell.y}`, {
				height: cell.height,
				ramp: sub?.ramp ?? 0,
				land: land_from_tile_type(sub?.tile_type ?? 0),
				tile: cell.tile,
				subtile: cell.subtile,
			});
		}
		SpotLight_One_Time(artwork.spotlight.SpotlightRadius);
		Refresh_Building_Light_Arcs(artwork);
	}
	const lighting = artwork?.lighting ?? DAYLIGHT;
	const palettes = new Map<string, Uint16Array>();
	const cell_lights = gather_cell_lights(draw_list, lighting, artwork);
	const shroud = artwork ? new ShroudMap(play, artwork.lookers) : null;
	if (artwork) {
		artwork.shroud_map = shroud;
	}
	const hud = await load_sidebar(directory, log);
	const mouse = new MouseClass();
	await mouse.One_Time(directory);
	mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
	log(
		`Tactical map ${draw_list.length} cells, theater ${theater || "?"}, ${name}. V switches 2D/3D terrain; export and debug controls are above the map. Edge-scroll or arrows to pan; Escape returns to the menu.`,
	);
	if (shroud) {
		log(`Shroud: ${shroud.mapped_count} cells from ${artwork?.lookers.length ?? 0} lookers.`);
	}
	const radar_exists =
		!!artwork && (artwork.free_radar || artwork.has_radar) && artwork.power_output >= artwork.power_drain;
	const radar = Compute_Radar_Image(draw_list, radar_exists);
	const heights = new Map<string, number>();
	for (const cell of draw_list) {
		heights.set(`${cell.x},${cell.y}`, cell.height);
	}
	const cell_keys = new Set(heights.keys());
	if (artwork) {
		artwork.bridge_set = tiles.bridge_set;
		artwork.train_bridge_set = tiles.train_bridge_set;
		Bind_Path_Graph(artwork, cell_keys);
	}
	const bridges = artwork ? bridge_cells(artwork) : new Set<string>();
	const { load_tile_assets, export_tile_pack } = await import("./terrain-assets");
	const tile_assets = await load_tile_assets(theater, draw_list, tiles, log);
	let terrain: TerrainRenderer | null = null;
	let terrain_enabled = false;
	const terrain_settings = terrain_defaults();
	const prepare_terrain = (): void => {
		if (terrain) return;
		try {
			terrain = new TerrainRenderer(draw_list, tiles, cell_lights, artwork?.theater_palette ?? tiles.palette, terrain_settings, tile_assets);
			log(`3D terrain ready: ${terrain.mesh.triangles.toLocaleString()} triangles from ${draw_list.length.toLocaleString()} cells.`);
		} catch (error) {
			log(`3D terrain unavailable: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	prepare_terrain();
	const toggle_terrain = (): void => {
		prepare_terrain();
		if (terrain) { terrain_enabled = !terrain_enabled; log(terrain_enabled ? "3D terrain" : "Legacy terrain"); }
		terrain_controls.set_mode(terrain_enabled);
	};
	const terrain_controls = new TerrainControls(canvas, terrain_settings, theater, () => { prepare_terrain(); return terrain; }, toggle_terrain,
		(progress, cancelled) => export_tile_pack(tiles, theater, progress, cancelled));
	let shift_down = false;
	const exits: FactoryObject[] = [];
	let exiting = false;
	let delivering = false;
	if (radar) {
		log(`Radar ${radar_exists ? "on" : "off"} ${radar.blit_w}x${radar.blit_h}.`);
	}

	let camera = clamp_to_tactical_rect(starting_camera(draw_list, play, local, home), play, local);
	let move_from = camera;
	let move_to = camera;
	let move_speed = 0;
	let move_factor = 0;
	const scroll: ScrollState = {
		inertia: 0,
		remainder: 0,
		last_poll: 0,
		mouse_down: false,
		direction: 0,
		inertia_ready: true,
		near_canvas: false,
	};
	const previous_cursor = canvas.style.cursor;
	canvas.style.cursor = mouse.MouseShapes ? "none" : previous_cursor;
	let frame_timer = Options.GameSpeed;
	let sys_accum = 0;
	let last_tick = performance.now();
	let raf = 0;

	const paint = (): void => {
		let ghost: { cell: Point2D; legal: boolean } | null = null;
		if (artwork?.production.pending && over_tactical(mouse.Point.x, mouse.Point.y)) {
			const origin = view_origin(camera);
			const cell = Pixel_To_Cell(
				{ x: mouse.Point.x - TAC_X, y: mouse.Point.y - TAC_Y },
				origin,
				heights,
				bridges,
			);
			ghost = {
				cell,
				legal: Can_Place_Building(artwork, cell, play, shroud, cell_keys),
			};
		}
		const draw = (background?: number) => {
			const view = composite_view(tiles, draw_list, camera, artwork, cell_lights, palettes, hud, shroud,
				artwork?.current_object ?? [], radar, ghost, mouse, background);
			if (mouse.MouseShapes && scroll.near_canvas && !artwork?.input_locked) mouse.Draw_Mouse(view.frame, hud.palette);
			return view;
		};
		if (terrain_enabled && terrain) {
			try {
				// Two backgrounds retain software transparency and shadow multiplication over GPU terrain.
				const black = draw(0), white = draw(0xffff);
				const rect = canvas.getBoundingClientRect();
				const scale = Math.min(3840 / SCREEN_W, 2160 / SCREEN_H, Math.max(1, rect.width * window.devicePixelRatio / SCREEN_W));
				const image = terrain.render(view_origin(camera), SCREEN_W * scale, SCREEN_H * scale, black.frame, white.frame,
					(x, y) => !shroud || shroud.IsMapped(x, y));
				present_gpu(canvas, image, black.frame, black.labels);
				return;
			} catch (error) {
				log(error instanceof Error ? error.message : String(error));
				terrain_enabled = false; terrain.dispose(); terrain = null;
				terrain_controls.set_mode(false);
			}
		}
		const view = draw();
		present(canvas, view.frame, view.labels);
	};

	const sync_radar = (): void => {
		if (!radar || !artwork) {
			return;
		}
		radar.exists = (artwork.free_radar || artwork.has_radar) && artwork.power_output >= artwork.power_drain;
	};

	const game_frame = (): void => {
		scroll.inertia_ready = true;
		if (!artwork) {
			return;
		}
		const origin = view_origin(camera);
		Set_Sound_View({
			origin,
			width: VIEW_W,
			height: VIEW_H,
			coord_to_pixel: (lx, ly, z) => Coord_To_Pixel({ x: lx, y: ly, z }, origin),
		});
		if (artwork.pending_ingame.length > 0) {
			const name = artwork.pending_ingame.shift()!;
			void Play_Ingame_Movie_Name(directory, name);
		}
		if (artwork.ended) {
			const name = artwork.ended === "win" ? artwork.win_movie : artwork.lose_movie;
			if (name) {
				artwork.pending_movie.push(name);
				artwork.win_movie = "";
				artwork.lose_movie = "";
			}
		}
		Advance_Ingame_Movies();
		Theme.AI();
		LogicClass_AI(artwork);
		Team_AI(artwork, play, cell_keys, shroud);
		if (artwork.center_on) {
			move_from = camera;
			move_to = clamp_to_tactical_rect(starting_camera(draw_list, play, local, artwork.center_on), play, local);
			const speed = Math.max(0, Math.min(SCROLL_SPEEDS.length - 1, artwork.center_speed | 0));
			move_speed = SCROLL_SPEEDS[speed]!;
			move_factor = 0;
			artwork.center_on = null;
		}
		if (move_speed !== 0) {
			move_factor += move_speed;
			if (move_factor > 1) {
				move_factor = 1;
			}
			camera = clamp_to_tactical_rect(lerp_point(move_from, move_to, move_factor), play, local);
			if (move_factor >= 1) {
				move_speed = 0;
				move_factor = 0;
			}
		}
		const ready = Factory_AI(artwork);
		Gate_AI(artwork);
		Display_AI(artwork);
		const logic = artwork.sprites.slice();
		for (const sprite of logic) {
			if (artwork.sprites.includes(sprite)) {
				Object_AI(artwork, sprite, play, cell_keys);
			}
		}
		Bullet_AI(artwork);
		Foot_AI(artwork, play, cell_keys, shroud);
		Action_Line_AI();
		for (const sprite of artwork.sprites) {
			Anim_Logic(sprite);
		}
		Prune_Dead_Anims(artwork);
		House_AI(artwork);
		if (ready.length) {
			exits.push(...ready);
		}
		sync_radar();
		if (!delivering && artwork.pending_teams.length > 0) {
			delivering = true;
			void Deliver_Pending_Teams(directory, artwork, play, cell_keys, shroud).finally(() => {
				delivering = false;
			});
		}
		if (!exiting && exits.length > 0) {
			exiting = true;
			const batch = exits.splice(0, exits.length);
			void (async () => {
				for (const object of batch) {
					await Place_Completed_Foot(directory, artwork, object, play, cell_keys, shroud);
				}
			})().finally(() => {
				exiting = false;
			});
		}
	};

	const system_tick = (): void => {
		Speak_Tick();
		mouse.System_Tick();
		frame_timer--;
		if (frame_timer <= 0) {
			frame_timer = Options.GameSpeed;
			game_frame();
		}
	};

	Set_Game_Active(true);
	await new Promise<void>((resolve) => {
		let busy = false;
		const finish = (): void => {
			cancelAnimationFrame(raf);
			terrain_controls.dispose();
			terrain?.dispose();
			terrain = null;
			Set_Game_Active(false);
			Set_Sound_View(null);
			Stop_Ingame_Movie();
			canvas.style.cursor = previous_cursor;
			canvas.removeEventListener("mousedown", on_down);
			canvas.removeEventListener("contextmenu", on_menu);
			window.removeEventListener("mousemove", on_move);
			window.removeEventListener("mouseup", on_up);
			window.removeEventListener("keydown", on_key);
			window.removeEventListener("keyup", on_keyup);
			window.removeEventListener("blur", on_blur);
			resolve();
		};
		const on_move = (event: MouseEvent): void => {
			if (event.target instanceof Node && terrain_controls.element.contains(event.target)) {
				scroll.near_canvas = false;
				return;
			}
			const point = canvas_mouse(canvas, event);
			const slop = 2;
			scroll.near_canvas =
				point.x >= -slop && point.x < SCREEN_W + slop && point.y >= -slop && point.y < SCREEN_H + slop;
			mouse.Point = {
				x: Math.min(SCREEN_W - 1, Math.max(0, point.x)),
				y: Math.min(SCREEN_H - 1, Math.max(0, point.y)),
			};
			canvas.style.cursor = mouse.MouseShapes && (artwork?.input_locked || scroll.near_canvas) ? "none" : previous_cursor;
			shift_down = event.shiftKey;
			if (scroll.mouse_down && artwork && !artwork.input_locked && (event.buttons & 1) !== 0) {
				Mouse_Left_Held(artwork, tactical_mouse(mouse.Point), { x: VIEW_W, y: VIEW_H });
				if (artwork.is_rubber_band) {
					mouse.Override_Mouse_Shape(MOUSE_NORMAL, false);
				}
			}
		};
		const on_down = (event: MouseEvent): void => {
			event.preventDefault();
			on_move(event);
			if (artwork?.input_locked) {
				return;
			}
			if (event.button === 2) {
				if (scroll.mouse_down) {
					return;
				}
				if (artwork && mouse.Point.x >= TAC_W) {
					const entry = Sidebar_Cameo_At(mouse.Point, hud, artwork.sidebar);
					if (entry) {
						Cameo_Right(artwork, entry);
					}
					return;
				}
				if (artwork?.production.pending) {
					artwork.production.pending = null;
					return;
				}
				if (artwork?.is_repair_mode) {
					Repair_Mode_Control(artwork, 0);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					return;
				}
				if (artwork?.is_sell_mode) {
					Sell_Mode_Control(artwork, 0);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					return;
				}
				if (artwork?.is_power_mode) {
					Power_Mode_Control(artwork, 0);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					return;
				}
				if (artwork?.is_waypoint_mode) {
					Waypoint_Mode_Control(artwork, 0);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					return;
				}
				if (artwork) {
					Unselect_All(artwork);
				}
				return;
			}
			if (event.button !== 0 || busy) {
				return;
			}
			if (radar && over_radar(mouse.Point.x, mouse.Point.y, radar)) {
				const cell = Radar_Pixel_To_Cell(radar, mouse.Point);
				if (cell) {
					const found = draw_list.find((item) => item.x === cell.x && item.y === cell.y);
					camera = clamp_to_tactical_rect(
						cell_pixel(found ?? { x: cell.x, y: cell.y, height: 0 }),
						play,
						local,
					);
				}
				return;
			}
			if (artwork && mouse.Point.x >= TAC_W) {
				const button = Sidebar_Button_At(mouse.Point, hud);
				if (button === "repair") {
					Menu_Click_Sound();
					Repair_Mode_Control(artwork, -1);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					return;
				}
				if (button === "sell") {
					Menu_Click_Sound();
					Sell_Mode_Control(artwork, -1);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					return;
				}
				if (button === "power") {
					Menu_Click_Sound();
					Power_Mode_Control(artwork, -1);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					return;
				}
				if (button === "waypoint") {
					Menu_Click_Sound();
					Waypoint_Mode_Control(artwork, -1);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					return;
				}
				if (Sidebar_Click(mouse.Point, hud, artwork.sidebar)) {
					return;
				}
				const entry = Sidebar_Cameo_At(mouse.Point, hud, artwork.sidebar);
				if (entry) {
					busy = true;
					void Cameo_Left(directory, artwork, entry, play, cell_keys, shroud).then(() => {
						if (artwork.production.pending) {
							Unselect_All(artwork);
						}
					}).finally(() => {
						busy = false;
					});
				}
				return;
			}
			if (artwork?.production.pending && over_tactical(mouse.Point.x, mouse.Point.y)) {
				const origin = view_origin(camera);
				const cell = Pixel_To_Cell(
					{ x: mouse.Point.x - TAC_X, y: mouse.Point.y - TAC_Y },
					origin,
					heights,
					bridges,
				);
				busy = true;
				void Place_Pending(directory, artwork, cell, play, shroud, cell_keys).then((placed) => {
					if (placed) {
						Unselect_All(artwork);
						sync_radar();
					}
				}).finally(() => {
					busy = false;
				});
				return;
			}
			if (over_tactical(mouse.Point.x, mouse.Point.y)) {
				scroll.mouse_down = true;
				if (artwork) {
					Mouse_Left_Press(artwork, tactical_mouse(mouse.Point));
				}
			}
		};
		const on_up = (event: MouseEvent): void => {
			const was_down = scroll.mouse_down;
			scroll.mouse_down = false;
			if (!artwork) {
				return;
			}
			Waypoint_Release(artwork);
			if (event.button !== 0 || !was_down) {
				return;
			}
			if (artwork.is_rubber_band) {
				if (!shift_down) {
					Unselect_All(artwork);
				}
				Select_Rubber_Band(artwork);
				artwork.is_rubber_band = false;
				mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
				artwork.is_tentative = false;
				return;
			}
			artwork.is_tentative = false;
			const hover = hover_sprite(artwork, mouse.Point, camera, heights, bridges, shroud);
			const origin = view_origin(camera);
			const cell = over_tactical(mouse.Point.x, mouse.Point.y)
				? Pixel_To_Cell(
					{ x: mouse.Point.x - TAC_X, y: mouse.Point.y - TAC_Y },
					origin,
					heights,
					bridges,
				)
				: null;
			const chosen = Best_Selected(artwork);
			if (artwork.is_repair_mode || artwork.is_sell_mode || artwork.is_power_mode) {
				Mode_Action(artwork, hover, cell);
				Unselect_All(artwork);
			} else if (artwork.is_waypoint_mode) {
				if (cell) {
					Waypoint_Click(artwork, cell, play, cell_keys, event.shiftKey);
				}
				Unselect_All(artwork);
			} else if (hover) {
				const attacker = artwork.current_object[0];
				if (attacker && What_Action(artwork, attacker, hover) === "attack") {
					for (const sprite of artwork.current_object) {
						if (Can_Player_Fire(artwork, sprite)) {
							Assign_Target(sprite, hover, true);
						}
					}
				} else if (
					shift_down &&
					artwork.current_object.length > 0 &&
					artwork.current_object[0]!.owned &&
					hover.owned
				) {
					if (hover.is_selected) {
						Unselect(artwork, hover);
					} else {
						Select(artwork, hover);
					}
				} else {
					Unselect_All(artwork);
					Select(artwork, hover);
				}
			} else if (cell && chosen && Can_Player_Move(chosen) && Waypoint_At(artwork.paths, cell)) {
				for (const sprite of artwork.current_object) {
					if (Can_Player_Move(sprite)) {
						Follow_Waypoint(artwork, sprite, cell, play, cell_keys);
					}
				}
			} else if (chosen && Can_Player_Move(chosen) && cell) {
				Assign_Group_Move(artwork, cell, play, cell_keys);
			} else if (cell && Waypoint_At(artwork.paths, cell)) {
				const data = Fetch_Waypoint_Data(artwork.paths, Waypoint_At(artwork.paths, cell));
				if (data) {
					artwork.selected_path = data.path;
				}
				Waypoint_Mode_Control(artwork, 1, true);
				mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
				Unselect_All(artwork);
			} else {
				Unselect_All(artwork);
			}
		};
		const on_blur = (): void => {
			scroll.mouse_down = false;
			if (artwork) {
				Abort_Drag_Select(artwork);
				mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
			}
		};
		const on_menu = (event: Event): void => {
			event.preventDefault();
		};
		const on_keyup = (event: KeyboardEvent): void => {
			shift_down = event.shiftKey;
		};
		const on_key = (event: KeyboardEvent): void => {
			shift_down = event.shiftKey;
			if (cancelled()) {
				finish();
				return;
			}
			if (event.key === "Escape") {
				if (artwork?.production.pending) {
					artwork.production.pending = null;
					event.preventDefault();
					return;
				}
				if (artwork?.is_repair_mode) {
					Repair_Mode_Control(artwork, 0);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					event.preventDefault();
					return;
				}
				if (artwork?.is_sell_mode) {
					Sell_Mode_Control(artwork, 0);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					event.preventDefault();
					return;
				}
				if (artwork?.is_power_mode) {
					Power_Mode_Control(artwork, 0);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					event.preventDefault();
					return;
				}
				if (artwork?.is_waypoint_mode) {
					Waypoint_Mode_Control(artwork, 0);
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
					event.preventDefault();
					return;
				}
				finish();
				return;
			}
			const target = event.target;
			if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
			if (event.code === "KeyV" && !event.ctrlKey && !event.altKey && !event.metaKey) {
				event.preventDefault();
				if (event.repeat) return;
				toggle_terrain();
				return;
			}
			if (event.code === "KeyE" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
				event.preventDefault();
				if (!event.repeat) void terrain_controls.prepare_export();
				return;
			}
			if (artwork?.input_locked) {
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
			if (busy) {
				raf = requestAnimationFrame(tick);
				return;
			}
			if (artwork && artwork.pending_movie.length > 0) {
				const name = artwork.pending_movie.shift()!;
				busy = true;
				void Play_Movie(directory, { canvas, cancelled }, name).finally(() => {
					busy = false;
				});
				raf = requestAnimationFrame(tick);
				return;
			}
			sys_accum += now - last_tick;
			last_tick = now;
			const tick_ms = 1000 / TIMER_SECOND;
			while (sys_accum >= tick_ms) {
				sys_accum -= tick_ms;
				system_tick();
			}
			if (artwork?.input_locked) {
				if (mouse.CurrentMouseShape !== MOUSE_NORMAL) {
					mouse.Set_Default_Mouse(MOUSE_NORMAL, false);
				}
			} else if (move_speed === 0) {
				camera = scroll_edge(mouse, camera, play, local, scroll, now);
				if (artwork && scroll.mouse_down) {
					Mouse_Left_Held(artwork, tactical_mouse(mouse.Point), { x: VIEW_W, y: VIEW_H });
				}
			}
			if (artwork && !artwork.input_locked) {
				if (artwork.is_rubber_band) {
					mouse.Override_Mouse_Shape(MOUSE_NORMAL, false);
				} else if (artwork.is_repair_mode || artwork.is_sell_mode || artwork.is_power_mode) {
					if (artwork.production.pending || over_radar(mouse.Point.x, mouse.Point.y, radar) || mouse.Point.x >= TAC_W) {
						mouse.Override_Mouse_Shape(MOUSE_NORMAL, false);
					} else {
						const origin = view_origin(camera);
						const cell = Pixel_To_Cell(
							{ x: mouse.Point.x - TAC_X, y: mouse.Point.y - TAC_Y },
							origin,
							heights,
							bridges,
						);
						const hover = hover_sprite(artwork, mouse.Point, camera, heights, bridges, shroud);
						mouse.Override_Mouse_Shape(mode_mouse(artwork, hover, cell), false);
					}
				} else if (artwork.is_waypoint_mode) {
					if (artwork.production.pending || over_radar(mouse.Point.x, mouse.Point.y, radar) || mouse.Point.x >= TAC_W) {
						mouse.Override_Mouse_Shape(MOUSE_NORMAL, false);
					} else {
						const origin = view_origin(camera);
						const cell = Pixel_To_Cell(
							{ x: mouse.Point.x - TAC_X, y: mouse.Point.y - TAC_Y },
							origin,
							heights,
							bridges,
						);
						if (artwork.dragged_waypoint) {
							Waypoint_Drag(artwork, cell, play, cell_keys);
						}
						mouse.Override_Mouse_Shape(waypoint_mouse(artwork, cell, play, shift_down), false);
					}
				} else if (
					mouse.CurrentMouseShape === MOUSE_NORMAL ||
					mouse.CurrentMouseShape === MOUSE_CAN_SELECT ||
					mouse.CurrentMouseShape === MOUSE_CAN_MOVE ||
					mouse.CurrentMouseShape === MOUSE_NO_MOVE ||
					mouse.CurrentMouseShape === MOUSE_CAN_ATTACK ||
					mouse.CurrentMouseShape === MOUSE_STAY_ATTACK ||
					mouse.CurrentMouseShape === MOUSE_FOLLOW_WAYPOINT ||
					mouse.CurrentMouseShape === MOUSE_ENTER_WAYPOINT_MODE ||
					mouse.CurrentMouseShape === MOUSE_PLACE_WAYPOINT ||
					mouse.CurrentMouseShape === MOUSE_NO_PLACE_WAYPOINT ||
					mouse.CurrentMouseShape === MOUSE_SELECT_WAYPOINT ||
					mouse.CurrentMouseShape === MOUSE_LOOP_WAYPOINT_PATH
				) {
					if (artwork.production.pending || over_radar(mouse.Point.x, mouse.Point.y, radar)) {
						mouse.Override_Mouse_Shape(MOUSE_NORMAL, false);
					} else {
						const origin = view_origin(camera);
						const cell = over_tactical(mouse.Point.x, mouse.Point.y)
							? Pixel_To_Cell(
								{ x: mouse.Point.x - TAC_X, y: mouse.Point.y - TAC_Y },
								origin,
								heights,
								bridges,
							)
							: null;
						const hover = hover_sprite(artwork, mouse.Point, camera, heights, bridges, shroud);
						const waypoint = cell ? Waypoint_At(artwork.paths, cell) : null;
						const chosen = Best_Selected(artwork);
						if (hover) {
							const attacker = artwork.current_object[0];
							if (attacker && What_Action(artwork, attacker, hover) === "attack") {
								mouse.Override_Mouse_Shape(
									In_Range_Of(artwork, attacker, hover) ? MOUSE_STAY_ATTACK : MOUSE_CAN_ATTACK,
									false,
								);
							} else {
								mouse.Override_Mouse_Shape(MOUSE_CAN_SELECT, false);
							}
						} else if (waypoint && chosen && Can_Player_Move(chosen)) {
							mouse.Override_Mouse_Shape(MOUSE_FOLLOW_WAYPOINT, false);
						} else if (waypoint) {
							mouse.Override_Mouse_Shape(MOUSE_ENTER_WAYPOINT_MODE, false);
						} else if (chosen && Can_Player_Move(chosen) && cell) {
							mouse.Override_Mouse_Shape(
								Can_Move_To(artwork, chosen, cell, play, cell_keys) ? MOUSE_CAN_MOVE : MOUSE_NO_MOVE,
								false,
							);
						} else {
							mouse.Override_Mouse_Shape(MOUSE_NORMAL, false);
						}
					}
				}
			}
			paint();
			raf = requestAnimationFrame(tick);
		};
		canvas.addEventListener("mousedown", on_down);
		canvas.addEventListener("contextmenu", on_menu);
		window.addEventListener("mousemove", on_move);
		window.addEventListener("mouseup", on_up);
		window.addEventListener("keydown", on_key);
		window.addEventListener("keyup", on_keyup);
		window.addEventListener("blur", on_blur);
		if (cancelled()) {
			finish();
			return;
		}
		raf = requestAnimationFrame(tick);
	});
}
