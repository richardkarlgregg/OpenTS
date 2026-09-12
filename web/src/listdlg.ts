/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import { canvas_mouse, present, type CanvasLabel } from "./present";
import { build_hicolor_pixel, DSurface } from "./surface";
import { Menu_Click_Sound } from "./voc";

export type ListItem = {
	id: number;
	label: string;
};

type Hit = {
	kind: "item" | "ok" | "cancel" | "diff";
	index: number;
};

export function pick_from_list(
	canvas: HTMLCanvasElement,
	backdrop: DSurface,
	title: string,
	items: ListItem[],
	cancelled: () => boolean,
	difficulty = 1,
	diff_labels: string[] = [],
): Promise<{ id: number; difficulty: number } | null> {
	return new Promise((resolve) => {
		let selected = 0;
		let scroll = 0;
		let diff = difficulty;
		let hover: Hit | null = null;
		let done = false;
		const origin_y = Math.floor((backdrop.height - 400) / 2) + 40;
		const list_x = 48;
		const list_y = origin_y + 36;
		const list_w = 544;
		const row_h = 18;
		const visible = 12;
		const ok = { x: 360, y: origin_y + 280, w: 80, h: 22 };
		const cancel = { x: 456, y: origin_y + 280, w: 80, h: 22 };
		const diffs = diff_labels.map((label, i) => ({
			x: 48 + i * 120,
			y: origin_y + 250,
			w: 110,
			h: 22,
			label,
		}));

		const clamp_scroll = (): void => {
			if (selected < scroll) {
				scroll = selected;
			}
			if (selected >= scroll + visible) {
				scroll = selected - visible + 1;
			}
			scroll = Math.max(0, Math.min(Math.max(0, items.length - visible), scroll));
		};

		const hit_test = (x: number, y: number): Hit | null => {
			const rows = Math.min(visible, items.length);
			for (let i = 0; i < rows; i++) {
				if (x >= list_x && x < list_x + list_w && y >= list_y + i * row_h && y < list_y + (i + 1) * row_h) {
					return { kind: "item", index: scroll + i };
				}
			}
			if (x >= ok.x && x < ok.x + ok.w && y >= ok.y && y < ok.y + ok.h) {
				return { kind: "ok", index: 0 };
			}
			if (x >= cancel.x && x < cancel.x + cancel.w && y >= cancel.y && y < cancel.y + cancel.h) {
				return { kind: "cancel", index: 0 };
			}
			for (let i = 0; i < diffs.length; i++) {
				const box = diffs[i]!;
				if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) {
					return { kind: "diff", index: i };
				}
			}
			return null;
		};

		const paint = (): void => {
			const frame = backdrop.clone();
			const plate = build_hicolor_pixel(12, 16, 12);
			frame.fill_rect(32, origin_y, 576, 320, plate);
			const labels: CanvasLabel[] = [
				{ x: 32, y: origin_y + 8, width: 576, height: 20, text: title, selected: true },
			];
			for (let i = 0; i < Math.min(visible, items.length); i++) {
				const item = items[scroll + i]!;
				const on = scroll + i === selected;
				if (on) {
					frame.fill_rect(list_x, list_y + i * row_h, list_w, row_h, build_hicolor_pixel(48, 56, 32));
				}
				labels.push({
					x: list_x,
					y: list_y + i * row_h,
					width: list_w,
					height: row_h,
					text: item.label,
					selected: on,
				});
			}
			draw_button(frame, ok.x, ok.y, ok.w, ok.h, hover?.kind === "ok");
			draw_button(frame, cancel.x, cancel.y, cancel.w, cancel.h, hover?.kind === "cancel");
			labels.push({ x: ok.x, y: ok.y, width: ok.w, height: ok.h, text: "OK", selected: hover?.kind === "ok" });
			labels.push({
				x: cancel.x,
				y: cancel.y,
				width: cancel.w,
				height: cancel.h,
				text: "Cancel",
				selected: hover?.kind === "cancel",
			});
			for (let i = 0; i < diffs.length; i++) {
				const box = diffs[i]!;
				draw_button(frame, box.x, box.y, box.w, box.h, i === diff);
				labels.push({
					x: box.x,
					y: box.y,
					width: box.w,
					height: box.h,
					text: box.label,
					selected: i === diff,
				});
			}
			present(canvas, frame, labels);
			canvas.style.cursor = hover ? "pointer" : "default";
		};

		const finish = (result: { id: number; difficulty: number } | null): void => {
			if (done) {
				return;
			}
			done = true;
			canvas.removeEventListener("mousemove", on_move);
			canvas.removeEventListener("click", on_click);
			window.removeEventListener("keydown", on_key);
			canvas.style.cursor = "default";
			resolve(result);
		};

		const on_move = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish(null);
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			hover = hit_test(mouse.x, mouse.y);
			paint();
		};

		const on_click = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish(null);
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			const hit = hit_test(mouse.x, mouse.y);
			if (!hit) {
				return;
			}
			if (hit.kind === "item") {
				selected = hit.index;
				clamp_scroll();
				paint();
				return;
			}
			if (hit.kind === "diff") {
				diff = hit.index;
				paint();
				return;
			}
			if (hit.kind === "ok") {
				const item = items[selected];
				Menu_Click_Sound();
				finish(item ? { id: item.id, difficulty: diff } : null);
				return;
			}
			Menu_Click_Sound();
			finish(null);
		};

		const on_key = (event: KeyboardEvent): void => {
			if (cancelled() || done) {
				finish(null);
				return;
			}
			if (event.key === "Escape") {
				finish(null);
			}
			if (event.key === "Enter") {
				const item = items[selected];
				Menu_Click_Sound();
				finish(item ? { id: item.id, difficulty: diff } : null);
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
		};

		canvas.tabIndex = 0;
		canvas.focus();
		paint();
		canvas.addEventListener("mousemove", on_move);
		canvas.addEventListener("click", on_click);
		window.addEventListener("keydown", on_key);
	});
}

function draw_button(frame: DSurface, x: number, y: number, w: number, h: number, lit: boolean): void {
	frame.fill_rect(x, y, w, h, build_hicolor_pixel(16, 20, 16));
	const edge = lit ? build_hicolor_pixel(255, 220, 64) : build_hicolor_pixel(200, 160, 32);
	frame.fill_rect(x, y, w, 1, edge);
	frame.fill_rect(x, y + h - 1, w, 1, edge);
	frame.fill_rect(x, y, 1, h, edge);
	frame.fill_rect(x + w - 1, y, 1, h, edge);
}
