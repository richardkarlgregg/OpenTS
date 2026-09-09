/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import { cc_retrieve, pcx_filename } from "./ccfile";
import type { GameDirectory } from "./files";
import type { INIClass, Point2D, Rect } from "./ini";
import { key_from_description, key_from_event } from "./keys";
import { read_pcx } from "./pcx";
import { canvas_mouse, present } from "./present";
import { DSurface } from "./surface";

export type GraphicMenuItem = {
	id: number;
	enabled: boolean;
	kind: "image" | "shortcut" | "version";
	origin: Point2D;
	active: Rect;
	image: DSurface | null;
	highlight: DSurface | null;
	disabled: DSurface | null;
	keys: number[];
};

export type GraphicMenu = {
	background_name: string;
	theme_name: string;
	backdrop: DSurface;
	origin: Point2D;
	items: GraphicMenuItem[];
};

function point_in_rect(rect: Rect, x: number, y: number): boolean {
	return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function offset_point(point: Point2D, origin: Point2D): Point2D {
	return { x: point.x + origin.x, y: point.y + origin.y };
}

function offset_rect(rect: Rect, origin: Point2D): Rect {
	return { x: rect.x + origin.x, y: rect.y + origin.y, width: rect.width, height: rect.height };
}

async function load_pcx(directory: GameDirectory, name: string): Promise<DSurface | null> {
	if (name.length === 0) {
		return null;
	}
	const packed = await cc_retrieve(directory, pcx_filename(name));
	if (!packed) {
		return null;
	}
	return read_pcx(packed);
}

async function read_image_item(
	directory: GameDirectory,
	ini: INIClass,
	name: string,
	origin: Point2D,
): Promise<GraphicMenuItem | null> {
	const id = ini.get_int(name, "ID", -1);
	if (id === -1) {
		return null;
	}
	const item_origin = offset_point(ini.get_point(name, "Origin", { x: 0, y: 0 }), origin);
	const active = offset_rect(ini.get_rect(name, "ActiveRect", { x: 0, y: 0, width: 0, height: 0 }), origin);
	return {
		id,
		enabled: true,
		kind: "image",
		origin: item_origin,
		active,
		image: await load_pcx(directory, ini.get_string(name, "Image")),
		highlight: await load_pcx(directory, ini.get_string(name, "Highlighted")),
		disabled: await load_pcx(directory, ini.get_string(name, "Disabled")),
		keys: [],
	};
}

function read_shortcut_item(ini: INIClass, name: string): GraphicMenuItem | null {
	const id = ini.get_int(name, "ID", -1);
	if (id === -1) {
		return null;
	}
	const keys = ini
		.get_string(name, "Keys")
		.split(/[,;]/)
		.map((token) => key_from_description(token))
		.filter((key) => key !== 0);
	return {
		id,
		enabled: true,
		kind: "shortcut",
		origin: { x: 0, y: 0 },
		active: { x: 0, y: 0, width: 0, height: 0 },
		image: null,
		highlight: null,
		disabled: null,
		keys,
	};
}

export async function Do_Graphic_Menu(
	directory: GameDirectory,
	ini: INIClass,
	section: string,
): Promise<GraphicMenu | null> {
	const background = ini.get_string(section, "Background");
	if (!ini.is_present(section)) {
		return null;
	}

	const background_name = background.length > 0 ? `${background}.PCX` : "Title.PCX";
	const backdrop = (await load_pcx(directory, background.length > 0 ? background : "Title")) ?? new DSurface(640, 400);
	const width = Math.max(640, backdrop.width);
	const height = Math.max(400, backdrop.height);
	const origin: Point2D = {
		x: Math.floor((width - backdrop.width) / 2),
		y: Math.floor((height - backdrop.height) / 2),
	};
	const items: GraphicMenuItem[] = [];
	const item_max = ini.get_int(section, "ItemMax", 100);
	for (let i = 0; i <= item_max; i++) {
		const name = ini.get_string(section, String(i));
		if (name.length === 0) {
			continue;
		}
		const type = ini.get_string(name, "Type");
		let item: GraphicMenuItem | null = null;
		if (type.toLowerCase() === "image") {
			item = await read_image_item(directory, ini, name, origin);
		} else if (type.toLowerCase() === "shortcut") {
			item = read_shortcut_item(ini, name);
		} else if (type.toLowerCase() === "version") {
			item = {
				id: ini.get_int(name, "ID", -1),
				enabled: true,
				kind: "version",
				origin: { x: 0, y: 0 },
				active: { x: 0, y: 0, width: 0, height: 0 },
				image: null,
				highlight: null,
				disabled: null,
				keys: [],
			};
			if (item.id === -1) {
				item = null;
			}
		}
		if (item) {
			items.push(item);
		}
	}

	return {
		background_name,
		theme_name: ini.get_string(section, "Theme", "Intro"),
		backdrop,
		origin,
		items,
	};
}

export function set_item_enabled(menu: GraphicMenu, id: number, enabled: boolean): void {
	for (const item of menu.items) {
		if (item.id === id) {
			item.enabled = enabled;
		}
	}
}

function item_under_mouse(menu: GraphicMenu, x: number, y: number): GraphicMenuItem | null {
	for (const item of menu.items) {
		if (item.kind === "image" && item.enabled && point_in_rect(item.active, x, y)) {
			return item;
		}
	}
	return null;
}

function item_for_key(menu: GraphicMenu, key: number): GraphicMenuItem | null {
	for (const item of menu.items) {
		if (!item.enabled) {
			continue;
		}
		if (item.keys.includes(key)) {
			return item;
		}
	}
	return null;
}

function compose(menu: GraphicMenu, selected: GraphicMenuItem | null): DSurface {
	const width = Math.max(640, menu.backdrop.width + menu.origin.x);
	const height = Math.max(400, menu.backdrop.height + menu.origin.y);
	const frame = new DSurface(width, height);
	frame.blit_from(menu.origin.x, menu.origin.y, menu.backdrop);
	for (const item of menu.items) {
		if (item.kind !== "image") {
			continue;
		}
		let art = item.image;
		if (!item.enabled && item.disabled) {
			art = item.disabled;
		} else if (item.enabled && item === selected && item.highlight) {
			art = item.highlight;
		}
		if (art) {
			frame.blit_from(item.origin.x, item.origin.y, art);
		}
	}
	return frame;
}

export function present_graphic_menu(
	canvas: HTMLCanvasElement,
	menu: GraphicMenu,
	selected: GraphicMenuItem | null,
): void {
	present(canvas, compose(menu, selected));
	canvas.style.cursor = selected ? "pointer" : "default";
}

export function Presentation(
	canvas: HTMLCanvasElement,
	menu: GraphicMenu,
	cancelled: () => boolean,
): Promise<number> {
	return new Promise((resolve) => {
		let selected: GraphicMenuItem | null = null;
		let done = false;

		const finish = (id: number): void => {
			if (done) {
				return;
			}
			done = true;
			canvas.removeEventListener("mousemove", on_move);
			canvas.removeEventListener("click", on_click);
			window.removeEventListener("keydown", on_key);
			canvas.style.cursor = "default";
			resolve(id);
		};

		const on_move = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish(-1);
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			const next = item_under_mouse(menu, mouse.x, mouse.y);
			if (next !== selected) {
				selected = next;
				present_graphic_menu(canvas, menu, selected);
			}
		};

		const on_click = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish(-1);
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			const item = item_under_mouse(menu, mouse.x, mouse.y);
			if (item) {
				finish(item.id);
			}
		};

		const on_key = (event: KeyboardEvent): void => {
			if (cancelled() || done) {
				finish(-1);
				return;
			}
			if (event.key === "Enter" && selected) {
				event.preventDefault();
				finish(selected.id);
				return;
			}
			const keyed = item_for_key(menu, key_from_event(event));
			if (keyed) {
				event.preventDefault();
				finish(keyed.id);
			}
		};

		present_graphic_menu(canvas, menu, null);
		canvas.tabIndex = 0;
		canvas.focus();
		canvas.addEventListener("mousemove", on_move);
		canvas.addEventListener("click", on_click);
		window.addEventListener("keydown", on_key);
	});
}
