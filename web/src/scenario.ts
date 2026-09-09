/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import { cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import { INIClass, type Rect } from "./ini";
import { load_theater_previews, preview_cell_colors, type TilePreviewColors } from "./isotile";
import { lzo_straw_decompress } from "./lzo";
import { load_map_artwork } from "./objects";
import { read_pcx } from "./pcx";
import { canvas_mouse, present } from "./present";
import { build_hicolor_pixel, DSurface } from "./surface";
import { Show_Tactical } from "./tactical";

const LOAD400 = ["LOAD400C.PCX", "LOAD400D.PCX", "LOAD400A.PCX", "LOAD400B.PCX"];

export function Pick_Load_Background_Name(cd: number, scenario: string): string {
	let player = cd;
	if (player > 1) {
		player = scenario.toUpperCase().includes("GDI") ? 0 : 1;
	}
	if (player < 0 || player > 1) {
		player = 0;
	}
	const choice = (player << 1) + (Math.random() < 0.5 ? 1 : 0);
	return LOAD400[choice]!;
}

function read_preview(ini: INIClass): { surface: DSurface; bytes: number } | null {
	const packed = ini.get_uublock("PreviewPack");
	if (packed.length === 0) {
		return null;
	}
	const size = ini.get_rect("Preview", "Size", { x: 0, y: 0, width: 0, height: 0 });
	if (size.width <= 0 || size.height <= 0) {
		return null;
	}
	const need = size.width * size.height * 3;
	let rgb: Uint8Array;
	try {
		rgb = lzo_straw_decompress(packed, need + 32);
	} catch {
		return null;
	}
	if (rgb.length < need) {
		return null;
	}
	const surface = new DSurface(size.width, size.height);
	let i = 0;
	for (let y = 0; y < size.height; y++) {
		for (let x = 0; x < size.width; x++) {
			surface.put_pixel(x, y, build_hicolor_pixel(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!));
			i += 3;
		}
	}
	return { surface, bytes: rgb.length };
}

export type IsoCell = { x: number; y: number; height: number; tile: number; subtile: number };

function read_isomap_cells(ini: INIClass): { cells: IsoCell[]; bytes: number } | null {
	const packed = ini.get_uublock("IsoMapPack5");
	if (packed.length === 0) {
		return null;
	}
	let data: Uint8Array;
	try {
		data = lzo_straw_decompress(packed);
	} catch {
		return null;
	}
	if (data.length < 4) {
		return null;
	}
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const cells: IsoCell[] = [];
	let offset = 0;
	while (offset + 4 <= data.length) {
		const x = view.getInt16(offset, true);
		const y = view.getInt16(offset + 2, true);
		offset += 4;
		if (x === 0 && y === 0) {
			break;
		}
		if (offset + 7 > data.length) {
			break;
		}
		const tile = view.getInt32(offset, true);
		const subtile = view.getUint8(offset + 4);
		const height = view.getInt8(offset + 5);
		offset += 7;
		cells.push({ x, y, height, tile, subtile });
	}
	if (cells.length === 0) {
		return null;
	}
	return { cells, bytes: data.length };
}

export function In_Radar(x: number, y: number, play: Rect): boolean {
	const w = play.width;
	const h = play.height;
	return x + y > w && x - y < w && y - x < w && x + y <= w + 2 * h;
}

function draw_iso_preview(
	cells: IsoCell[],
	play: Rect,
	table: TilePreviewColors[][],
	fill_height: number,
	local_y: number,
): DSurface | null {
	if (play.width <= 0 || play.height <= 0) {
		return null;
	}
	const placed = new Map<string, IsoCell>();
	for (const cell of cells) {
		if (In_Radar(cell.x, cell.y, play)) {
			placed.set(`${cell.x},${cell.y}`, cell);
		}
	}
	const draw_list: IsoCell[] = [];
	const msize = play.width + play.height - 1;
	const north = play.width + 2 * Math.max(0, local_y);
	for (let y = 0; y < 2 * msize + 2; y++) {
		for (let x = 0; x < msize + 2; x++) {
			if (!In_Radar(x, y, play)) {
				continue;
			}
			if (local_y > 0 && x + y <= north) {
				continue;
			}
			draw_list.push(placed.get(`${x},${y}`) ?? { x, y, height: fill_height, tile: 0, subtile: 0 });
		}
	}
	if (draw_list.length === 0) {
		return null;
	}

	let min_px = 10000;
	let min_py = 10000;
	let max_px = -10000;
	let max_py = -10000;
	const projected: { x: number; y: number; cell: IsoCell }[] = [];
	for (const cell of draw_list) {
		const px = (cell.x - cell.y) >> 1;
		const py = (cell.x + cell.y) >> 1;
		projected.push({ x: px, y: py, cell });
		if (px < min_px) min_px = px;
		if (py < min_py) min_py = py;
		if (px > max_px) max_px = px;
		if (py > max_py) max_py = py;
	}

	const width = Math.max(1, 2 * (max_px - min_px));
	const height = Math.max(1, max_py - min_py);
	const surface = new DSurface(width, height);
	for (const point of projected) {
		const x = 2 * (point.x - min_px);
		const y = point.y - min_py;
		const colors = preview_cell_colors(table, point.cell.tile, point.cell.subtile, point.cell.height);
		surface.put_pixel(x, y, build_hicolor_pixel(colors.low[0], colors.low[1], colors.low[2]));
		surface.put_pixel(x + 1, y, build_hicolor_pixel(colors.high[0], colors.high[1], colors.high[2]));
	}
	return surface;
}

function blit_fit(dest: DSurface, source: DSurface, x: number, y: number, w: number, h: number): void {
	for (let row = 0; row < h; row++) {
		const sy = Math.min(source.height - 1, Math.floor((row * source.height) / h));
		for (let col = 0; col < w; col++) {
			const sx = Math.min(source.width - 1, Math.floor((col * source.width) / w));
			dest.pixels[(y + row) * dest.width + (x + col)] = source.pixels[sy * source.width + sx]!;
		}
	}
}

export async function load_scenario_ini(directory: GameDirectory, filename: string): Promise<INIClass | null> {
	const packed = await cc_retrieve(directory, filename);
	if (!packed) {
		return null;
	}
	const ini = new INIClass();
	return ini.load(packed) ? ini : null;
}

export async function Show_Scenario(
	canvas: HTMLCanvasElement,
	directory: GameDirectory,
	filename: string,
	log: (line: string) => void,
	cancelled: () => boolean,
	backdrop_name?: string,
): Promise<void> {
	const ini = await load_scenario_ini(directory, filename);
	if (!ini) {
		log(`Could not open scenario ${filename}.`);
		return;
	}

	const name = ini.get_string("Basic", "Name", filename);
	const theater = ini.get_string("Map", "Theater", "");
	const size = ini.get_rect("Map", "Size", { x: 0, y: 0, width: 0, height: 0 });
	const local = ini.get_rect("Map", "LocalSize", { x: 0, y: 0, width: 0, height: 0 });
	const level = ini.get_int("Map", "Level", 0);
	log(`Scenario ${filename}: "${name}" theater ${theater || "?"} size ${size.width}x${size.height}.`);

	const preview = read_preview(ini);
	const iso = read_isomap_cells(ini);
	log(
		preview
			? `PreviewPack ${preview.surface.width}x${preview.surface.height} (${preview.bytes} bytes).`
			: "No PreviewPack; building IsoMapPack5 radar.",
	);
	let iso_surface: DSurface | null = null;
	if (iso) {
		const table = await load_theater_previews(directory, theater);
		iso_surface = draw_iso_preview(iso.cells, size, table, level, local.y);
		log(
			`IsoMapPack5 ${iso.cells.length} cells, radar ${iso_surface ? `${iso_surface.width}x${iso_surface.height}` : "none"} (${iso.bytes} bytes).`,
		);
	}

	let frame = new DSurface(640, 400);
	if (backdrop_name) {
		const packed = await cc_retrieve(directory, backdrop_name);
		if (packed) {
			const pcx = read_pcx(packed);
			if (pcx) {
				if (pcx.width === 640 && pcx.height === 400) {
					frame = pcx;
				} else {
					blit_fit(frame, pcx, 0, 0, 640, 400);
				}
			}
		}
	}

	const picture = preview?.surface ?? iso_surface;
	if (picture) {
		const well = backdrop_name
			? { x: 16, y: 28, width: 420, height: 320 }
			: { x: 0, y: 0, width: 640, height: 400 };
		const max_w = backdrop_name ? well.width : 360;
		const max_h = backdrop_name ? well.height : 280;
		const scale = Math.min(max_w / picture.width, max_h / picture.height);
		const w = Math.max(1, Math.floor(picture.width * scale));
		const h = Math.max(1, Math.floor(picture.height * scale));
		const x = well.x + Math.floor((well.width - w) / 2);
		const y = well.y + Math.floor((well.height - h) / 2);
		blit_fit(frame, picture, x, y, w, h);
	}

	present(canvas, frame, [
		{ x: 8, y: 8, width: 624, height: 18, text: name, selected: true },
		{ x: 8, y: 374, width: 624, height: 18, text: iso ? "Click to enter the map; Escape returns to the menu" : "Click or Escape to return to the menu" },
	]);

	const next = await wait_dismiss(canvas, cancelled);
	if (next !== "map" || !iso) {
		return;
	}

	const artwork = await load_map_artwork(directory, ini, theater, log);
	await Show_Tactical(
		canvas,
		directory,
		theater,
		iso.cells,
		size,
		local,
		level,
		read_home_cell(ini),
		name,
		log,
		cancelled,
		artwork,
	);
}

function read_home_cell(ini: INIClass): { x: number; y: number } | null {
	for (const id of [98, 0]) {
		const value = ini.get_int("Waypoints", `${id}`, 0);
		if (value !== 0) {
			return { x: value % 1000, y: Math.floor(value / 1000) };
		}
	}
	return null;
}

function wait_dismiss(canvas: HTMLCanvasElement, cancelled: () => boolean): Promise<"map" | "menu"> {
	return new Promise((resolve) => {
		const finish = (next: "map" | "menu"): void => {
			canvas.removeEventListener("click", on_click);
			window.removeEventListener("keydown", on_key);
			resolve(next);
		};
		const on_click = (event: MouseEvent): void => {
			canvas_mouse(canvas, event);
			finish("map");
		};
		const on_key = (event: KeyboardEvent): void => {
			if (cancelled() || event.key === "Escape") {
				finish("menu");
			} else if (event.key === "Enter") {
				finish("map");
			}
		};
		canvas.addEventListener("click", on_click);
		window.addEventListener("keydown", on_key);
		if (cancelled()) {
			finish("menu");
		}
	});
}
