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
import {
	dialog_name_id,
	Fetch_Dialog,
	Fetch_String,
	TXT_EASY,
	TXT_HARD,
	TXT_NORMAL,
	type DialogControl,
} from "./language";
import { read_pcx } from "./pcx";
import { canvas_mouse, last_presented, present, type CanvasLabel } from "./present";
import { build_hicolor_pixel, DSurface, unpack_hicolor } from "./surface";

const TEXT_GREEN = "#70ff00";
const DIALOG_FONT = '10px "MS Sans Serif", Tahoma, sans-serif';
const FRAME = build_hicolor_pixel(78, 182, 220);
const LIST_FILL = build_hicolor_pixel(34, 80, 97);
const BUTTON_EDGE = [
	build_hicolor_pixel(39, 248, 116),
	build_hicolor_pixel(19, 123, 57),
	build_hicolor_pixel(30, 186, 87),
	build_hicolor_pixel(24, 153, 71),
];
const DIFFICULTY_NAMES = [TXT_EASY, TXT_NORMAL, TXT_HARD];
const LIST_ROW = 18;
const GRIP_WIDTH = 12;
const NUMBER_WIDTH = 50;
const SCALE_X = 300;
const SCALE_Y = 163;
const BASE_X = 200;
const BASE_Y = 100;
const TITLE_H = 400;
const DIALOG_Y = 147;

export type OwnerDialogItem = {
	id: number;
	label: string;
};

export type OwnerDialogResult = {
	item: number;
	slider: number;
};

type Box = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type Skins = {
	panel: DSurface | null;
	grip: DSurface | null;
	button_left: DSurface | null;
	button_mid: DSurface | null;
	button_right: DSurface | null;
	leftbar: DSurface | null;
	rightbar: DSurface | null;
	bar_ul: DSurface | null;
	bar_ur: DSurface | null;
	bar_ll: DSurface | null;
	bar_lr: DSurface | null;
};

function in_box(box: Box, x: number, y: number): boolean {
	return x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height;
}

function blit_fit(dest: DSurface, source: DSurface, x: number, y: number, w: number, h: number): void {
	for (let row = 0; row < h; row++) {
		const sy = Math.min(source.height - 1, Math.floor((row * source.height) / h));
		for (let col = 0; col < w; col++) {
			const sx = Math.min(source.width - 1, Math.floor((col * source.width) / w));
			const dx = x + col;
			const dy = y + row;
			if (dx < 0 || dy < 0 || dx >= dest.width || dy >= dest.height) {
				continue;
			}
			dest.pixels[dy * dest.width + dx] = source.pixels[sy * source.width + sx]!;
		}
	}
}

function dim_rect(surface: DSurface, box: Box, keep: number): void {
	const x0 = Math.max(0, box.x);
	const y0 = Math.max(0, box.y);
	const x1 = Math.min(surface.width, box.x + box.width);
	const y1 = Math.min(surface.height, box.y + box.height);
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const i = y * surface.width + x;
			const [r, g, b] = unpack_hicolor(surface.pixels[i]!);
			surface.pixels[i] = build_hicolor_pixel((r * keep) >> 8, (g * keep) >> 8, (b * keep) >> 8);
		}
	}
}

function draw_frame(surface: DSurface, box: Box): void {
	surface.draw_rect(box.x, box.y, box.width, box.height, FRAME);
}

function draw_button_edge(surface: DSurface, box: Box): void {
	const x1 = box.x + box.width - 1;
	const y1 = box.y + box.height - 1;
	surface.draw_line(box.x, box.y, x1, box.y, BUTTON_EDGE[0]!);
	surface.draw_line(box.x, y1, x1, y1, BUTTON_EDGE[1]!);
	surface.draw_line(box.x, box.y, box.x, y1, BUTTON_EDGE[2]!);
	surface.draw_line(x1, box.y, x1, y1, BUTTON_EDGE[3]!);
}

async function load_pcx(directory: GameDirectory, name: string): Promise<DSurface | null> {
	const packed = await cc_retrieve(directory, pcx_filename(name));
	if (!packed) {
		return null;
	}
	return read_pcx(packed);
}

async function load_skins(directory: GameDirectory): Promise<Skins> {
	return {
		panel: await load_pcx(directory, "dbak6440.pcx"),
		grip: await load_pcx(directory, "trakgrip.pcx"),
		button_left: await load_pcx(directory, "bue_li24.pcx"),
		button_mid: await load_pcx(directory, "bue_mi24.pcx"),
		button_right: await load_pcx(directory, "bue_ri24.pcx"),
		leftbar: await load_pcx(directory, "leftbar.pcx"),
		rightbar: await load_pcx(directory, "rightbar.pcx"),
		bar_ul: await load_pcx(directory, "bar_ul.pcx"),
		bar_ur: await load_pcx(directory, "bar_ur.pcx"),
		bar_ll: await load_pcx(directory, "bar_ll.pcx"),
		bar_lr: await load_pcx(directory, "bar_lr.pcx"),
	};
}

function layout_du(x: number, y: number, width: number, height: number): Box {
	return {
		x: Math.floor((SCALE_X * x) / BASE_X),
		y: Math.floor((SCALE_Y * y) / BASE_Y),
		width: Math.max(1, Math.floor((SCALE_X * width) / BASE_X)),
		height: Math.max(1, Math.floor((SCALE_Y * height) / BASE_Y)),
	};
}

function place_control(origin_x: number, origin_y: number, control: DialogControl): DialogControl {
	const mapped = layout_du(control.x, control.y, control.width, control.height);
	return {
		...control,
		x: origin_x + mapped.x,
		y: origin_y + mapped.y,
		width: mapped.width,
		height: mapped.height,
	};
}

function blend_color(pixel: number, color: number, alpha: number): number {
	const inv = 255 - alpha;
	const r = ((((pixel & 0xf800) * inv) + ((color & 0xf800) * alpha)) >> 8) & 0xf800;
	const g = ((((pixel & 0x07e0) * inv) + ((color & 0x07e0) * alpha)) >> 8) & 0x07e0;
	const b = ((((pixel & 0x001f) * inv) + ((color & 0x001f) * alpha)) >> 8) & 0x001f;
	return r | g | b;
}

function blend_h(frame: DSurface, x0: number, x1: number, y: number, color: number, alpha: number): void {
	if (y < 0 || y >= frame.height) {
		return;
	}
	const start = Math.max(0, Math.min(x0, x1));
	const end = Math.min(frame.width - 1, Math.max(x0, x1));
	const row = y * frame.width;
	for (let x = start; x <= end; x++) {
		const i = row + x;
		frame.pixels[i] = blend_color(frame.pixels[i]!, color, alpha);
	}
}

function blend_v(frame: DSurface, x: number, y0: number, y1: number, color: number, alpha: number): void {
	if (x < 0 || x >= frame.width) {
		return;
	}
	const start = Math.max(0, Math.min(y0, y1));
	const end = Math.min(frame.height - 1, Math.max(y0, y1));
	for (let y = start; y <= end; y++) {
		const i = y * frame.width + x;
		frame.pixels[i] = blend_color(frame.pixels[i]!, color, alpha);
	}
}

function blit_bar(frame: DSurface, source: DSurface, x: number, y: number, w: number, h: number): void {
	const ox = source.width > w ? Math.floor((source.width - w) / 2) : 0;
	const oy = source.height > h ? Math.floor((source.height - h) / 2) : 0;
	frame.blit_from(x, y, source, ox, oy, Math.min(w, source.width - ox), Math.min(h, source.height - oy));
}

function draw_dialog_chrome(frame: DSurface, skins: Skins, box: Box): void {
	if (skins.leftbar) {
		blit_bar(frame, skins.leftbar, box.x, box.y, skins.leftbar.width, box.height);
	}
	if (skins.rightbar) {
		blit_bar(frame, skins.rightbar, box.x + box.width - skins.rightbar.width, box.y, skins.rightbar.width, box.height);
	}
	if (skins.bar_ul) {
		frame.blit_from(box.x, box.y, skins.bar_ul);
	}
	if (skins.bar_ur) {
		frame.blit_from(box.x + box.width - skins.bar_ur.width, box.y, skins.bar_ur);
	}
	if (skins.bar_ll) {
		frame.blit_from(box.x, box.y + box.height - skins.bar_ll.height, skins.bar_ll);
	}
	if (skins.bar_lr) {
		frame.blit_from(box.x + box.width - skins.bar_lr.width, box.y + box.height - skins.bar_lr.height, skins.bar_lr);
	}
	const left_w = skins.leftbar?.width ?? 0;
	const right_w = skins.rightbar?.width ?? 0;
	for (let layer = 0; layer < 16; layer++) {
		const alpha = 96 - 6 * layer;
		const top = box.y + layer;
		const bottom = box.y + box.height - layer - 1;
		const left = box.x + layer + left_w;
		const right = box.x + box.width - layer - right_w - 1;
		blend_h(frame, left, right, top, 0xffff, alpha);
		blend_h(frame, left, right, bottom, 0xffff, alpha);
		blend_v(frame, left, top + 1, bottom - 1, 0xffff, alpha);
		blend_v(frame, right, top + 1, bottom - 1, 0xffff, alpha);
	}
}

function draw_button(frame: DSurface, skins: Skins, box: Box, down: boolean): void {
	if (skins.button_left && skins.button_mid && skins.button_right) {
		const left_w = Math.min(skins.button_left.width, box.width);
		const right_w = Math.min(skins.button_right.width, Math.max(0, box.width - left_w));
		const mid_w = Math.max(0, box.width - left_w - right_w);
		blit_fit(frame, skins.button_left, box.x, box.y, left_w, box.height);
		if (mid_w > 0) {
			blit_fit(frame, skins.button_mid, box.x + left_w, box.y, mid_w, box.height);
		}
		blit_fit(frame, skins.button_right, box.x + left_w + mid_w, box.y, right_w, box.height);
	} else {
		dim_rect(frame, box, 75);
		draw_button_edge(frame, box);
	}
	if (down) {
		dim_rect(frame, box, 180);
	}
}

function slider_value_at(box: Box, x: number, max: number): number {
	const track = Math.max(1, box.width - NUMBER_WIDTH - 13);
	const local = Math.max(0, x - box.x - 1);
	const idx = Math.floor(((max + 1) * local) / track);
	return Math.max(0, Math.min(max, idx));
}

function grip_box(box: Box, value: number, max: number): Box {
	const track = Math.max(1, box.width - NUMBER_WIDTH - 13);
	const thumb = max > 0 ? Math.floor((value * track) / max) : 0;
	return { x: box.x + thumb + 1, y: box.y, width: GRIP_WIDTH, height: box.height };
}

function dialog_label(box: Box, text: string, align: CanvasLabel["align"]): CanvasLabel {
	return {
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height,
		text,
		align,
		color: TEXT_GREEN,
		font: DIALOG_FONT,
	};
}

export async function Run_Owner_Dialog(
	canvas: HTMLCanvasElement,
	directory: GameDirectory,
	template_name: string,
	items: OwnerDialogItem[],
	slider: number,
	cancelled: () => boolean,
	backdrop?: DSurface | null,
): Promise<OwnerDialogResult | null> {
	const template = Fetch_Dialog(dialog_name_id(template_name));
	if (!template || items.length === 0) {
		return null;
	}
	const skins = await load_skins(directory);
	const screen = backdrop?.clone() ?? last_presented()?.clone();
	if (!screen) {
		return null;
	}

	const size = layout_du(0, 0, template.width, template.height);
	const art_y = Math.floor((screen.height - TITLE_H) / 2);
	const origin_x = Math.floor((screen.width - size.width + 1) / 2);
	const origin_y = art_y + DIALOG_Y;
	const placed = template.controls.map((control) => place_control(origin_x, origin_y, control));
	const list_box = placed.find((control) => control.kind === "list");
	const slider_box = placed.find((control) => control.kind === "slider");
	const ok_box = placed.find((control) => control.id === dialog_name_id("IDOK") || control.id === 1);
	const cancel_box = placed.find((control) => control.id === dialog_name_id("IDCANCEL") || control.id === 2);
	const label_box = placed.find((control) => control.id === dialog_name_id("IDC_DIFFICULTY_LABEL"));
	const max_slider = DIFFICULTY_NAMES.length - 1;
	const visible = list_box ? Math.max(1, Math.floor(list_box.height / LIST_ROW)) : items.length;

	return new Promise((resolve) => {
		let selected = 0;
		let scroll = 0;
		let diff = Math.max(0, Math.min(max_slider, slider));
		let pressed: "ok" | "cancel" | null = null;
		let dragging = false;
		let done = false;

		const clamp_scroll = (): void => {
			if (selected < scroll) {
				scroll = selected;
			}
			if (selected >= scroll + visible) {
				scroll = selected - visible + 1;
			}
			scroll = Math.max(0, Math.min(Math.max(0, items.length - visible), scroll));
		};

		const paint = (): void => {
			const frame = screen.clone();
			if (skins.panel) {
				let src_x = origin_x;
				let src_y = origin_y;
				if (screen.width > skins.panel.width) {
					src_x += Math.floor((screen.width - skins.panel.width) / -2);
				}
				if (screen.height > skins.panel.height) {
					src_y += Math.floor((screen.height - skins.panel.height) / -2);
				}
				frame.blit_from(origin_x, origin_y, skins.panel, src_x, src_y, size.width, size.height);
			} else {
				frame.fill_rect(origin_x, origin_y, size.width, size.height, build_hicolor_pixel(22, 55, 68));
				draw_frame(frame, { x: origin_x, y: origin_y, width: size.width, height: size.height });
			}
			draw_dialog_chrome(frame, skins, { x: origin_x, y: origin_y, width: size.width, height: size.height });

			const labels: CanvasLabel[] = [];
			if (list_box) {
				dim_rect(frame, list_box, 75);
				draw_frame(frame, list_box);
				for (let i = 0; i < Math.min(visible, items.length - scroll); i++) {
					const item = items[scroll + i]!;
					const row = {
						x: list_box.x + 2,
						y: list_box.y + i * LIST_ROW,
						width: list_box.width - 4,
						height: LIST_ROW,
					};
					if (scroll + i === selected) {
						frame.fill_rect(row.x, row.y, row.width, row.height, LIST_FILL);
					}
					labels.push(dialog_label(row, item.label, "left"));
				}
			}
			if (slider_box) {
				dim_rect(frame, slider_box, 75);
				draw_frame(frame, { x: slider_box.x, y: slider_box.y, width: slider_box.width - NUMBER_WIDTH, height: slider_box.height });
				const grip = grip_box(slider_box, diff, max_slider);
				if (skins.grip) {
					blit_fit(frame, skins.grip, grip.x, grip.y, grip.width, grip.height);
				} else {
					frame.fill_rect(grip.x, grip.y, grip.width, grip.height, FRAME);
				}
				labels.push(
					dialog_label(
						{
							x: slider_box.x + slider_box.width - NUMBER_WIDTH,
							y: slider_box.y,
							width: NUMBER_WIDTH,
							height: slider_box.height,
						},
						`${diff}`,
						"center",
					),
				);
			}
			for (const control of placed) {
				if (control.kind === "static") {
					const text =
						label_box && control.id === label_box.id
							? Fetch_String(DIFFICULTY_NAMES[diff] ?? TXT_NORMAL)
							: control.caption;
					labels.push(dialog_label(control, text, control.align));
				}
				if (control.kind === "button") {
					const down =
						(pressed === "ok" && ok_box && control.id === ok_box.id) ||
						(pressed === "cancel" && cancel_box && control.id === cancel_box.id);
					draw_button(frame, skins, control, !!down);
					labels.push(dialog_label(control, control.caption, "center"));
				}
			}
			present(canvas, frame, labels);
		};

		const finish = (result: OwnerDialogResult | null): void => {
			if (done) {
				return;
			}
			done = true;
			canvas.removeEventListener("mousemove", on_move);
			canvas.removeEventListener("mousedown", on_down);
			canvas.removeEventListener("mouseup", on_up);
			window.removeEventListener("keydown", on_key);
			canvas.style.cursor = "default";
			resolve(result);
		};

		const hit_list = (x: number, y: number): number | null => {
			if (!list_box || !in_box(list_box, x, y)) {
				return null;
			}
			const row = Math.floor((y - list_box.y) / LIST_ROW);
			const index = scroll + row;
			if (row < 0 || row >= visible || index < 0 || index >= items.length) {
				return null;
			}
			return index;
		};

		const on_move = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish(null);
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			if (dragging && slider_box) {
				diff = slider_value_at(slider_box, mouse.x, max_slider);
				paint();
			}
			const over =
				(ok_box && in_box(ok_box, mouse.x, mouse.y)) ||
				(cancel_box && in_box(cancel_box, mouse.x, mouse.y)) ||
				(list_box && in_box(list_box, mouse.x, mouse.y)) ||
				(slider_box && in_box(slider_box, mouse.x, mouse.y));
			canvas.style.cursor = over ? "pointer" : "default";
		};

		const on_down = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish(null);
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			const row = hit_list(mouse.x, mouse.y);
			if (row !== null) {
				selected = row;
				clamp_scroll();
				paint();
				return;
			}
			if (slider_box && in_box(slider_box, mouse.x, mouse.y)) {
				dragging = true;
				diff = slider_value_at(slider_box, mouse.x, max_slider);
				paint();
				return;
			}
			if (ok_box && in_box(ok_box, mouse.x, mouse.y)) {
				pressed = "ok";
				paint();
				return;
			}
			if (cancel_box && in_box(cancel_box, mouse.x, mouse.y)) {
				pressed = "cancel";
				paint();
			}
		};

		const on_up = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish(null);
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			dragging = false;
			if (pressed === "ok" && ok_box && in_box(ok_box, mouse.x, mouse.y)) {
				const item = items[selected];
				finish(item ? { item: item.id, slider: diff } : null);
				return;
			}
			if (pressed === "cancel" && cancel_box && in_box(cancel_box, mouse.x, mouse.y)) {
				finish(null);
				return;
			}
			if (pressed) {
				pressed = null;
				paint();
			}
		};

		const on_key = (event: KeyboardEvent): void => {
			if (cancelled() || done) {
				finish(null);
				return;
			}
			if (event.key === "Escape") {
				finish(null);
				return;
			}
			if (event.key === "Enter") {
				const item = items[selected];
				finish(item ? { item: item.id, slider: diff } : null);
				return;
			}
			if (event.key === "ArrowDown") {
				selected = Math.min(items.length - 1, selected + 1);
				clamp_scroll();
				paint();
			}
			if (event.key === "ArrowUp") {
				selected = Math.max(0, selected - 1);
				clamp_scroll();
				paint();
			}
			if (event.key === "ArrowRight" && slider_box) {
				diff = Math.min(max_slider, diff + 1);
				paint();
			}
			if (event.key === "ArrowLeft" && slider_box) {
				diff = Math.max(0, diff - 1);
				paint();
			}
		};

		canvas.tabIndex = 0;
		canvas.focus();
		paint();
		canvas.addEventListener("mousemove", on_move);
		canvas.addEventListener("mousedown", on_down);
		canvas.addEventListener("mouseup", on_up);
		window.addEventListener("keydown", on_key);
	});
}
