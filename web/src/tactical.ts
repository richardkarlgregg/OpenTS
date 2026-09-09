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
import { canvas_mouse, present } from "./present";
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

function draw_view(tiles: TheaterTiles, cells: IsoCell[], camera: Point2D): DSurface {
	const frame = new DSurface(VIEW_W, VIEW_H);
	for (const cell of cells) {
		const pixel = cell_pixel(cell);
		const dx = pixel.x - camera.x;
		const dy = pixel.y - camera.y;
		if (dx + ISO_TILE_PIXEL_W < -64 || dy + 160 < 0 || dx >= VIEW_W + 64 || dy >= VIEW_H + 64) {
			continue;
		}
		const tile = fetch_subtile(tiles, cell.tile, cell.subtile);
		if (tile) {
			blit_iso_tile(frame, dx, dy, tile);
		}
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
): Promise<void> {
	const tiles = await load_theater_tiles(directory, theater);
	const draw_list = gather_cells(cells, play, fill_height);
	if (draw_list.length === 0) {
		log("No In_Radar cells to draw.");
		return;
	}
	log(`Tactical map ${draw_list.length} cells, theater ${theater || "?"}. Drag or arrows to pan; Escape returns to the menu.`);

	let camera = starting_camera(draw_list, play, local, home);
	let dragging = false;
	let last = { x: 0, y: 0 };
	const previous_cursor = canvas.style.cursor;
	canvas.style.cursor = "grab";

	const paint = (): void => {
		present(canvas, draw_view(tiles, draw_list, camera), [
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
