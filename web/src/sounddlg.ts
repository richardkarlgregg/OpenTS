/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import { Fetch_String, TXT_OK } from "./language";
import { Options } from "./options";
import { canvas_mouse, present, type CanvasLabel } from "./present";
import { build_hicolor_pixel, DSurface } from "./surface";
import { Menu_Click_Sound, Set_Score_Volume, Set_Sound_Volume, Set_Voice_Volume } from "./voc";

export const VOLUME_LEVELS = 10;

type SliderId = "music" | "sound" | "voice";

type Hit = {
	kind: "slider" | "ok";
	id: SliderId;
};

function level_from_volume(volume: number): number {
	return Math.max(0, Math.min(VOLUME_LEVELS, Math.round(volume * VOLUME_LEVELS)));
}

function apply_slider(id: SliderId, pos: number, feedback: boolean): void {
	const volume = pos / VOLUME_LEVELS;
	if (id === "music") {
		Set_Score_Volume(volume, feedback);
	} else if (id === "sound") {
		Set_Sound_Volume(volume, feedback);
	} else {
		Set_Voice_Volume(volume, feedback);
	}
}

export function Sound_Options_Dialog(
	canvas: HTMLCanvasElement,
	backdrop: DSurface,
	cancelled: () => boolean,
): Promise<void> {
	return new Promise((resolve) => {
		const origin_y = Math.floor((backdrop.height - 400) / 2) + 70;
		const plate = { x: 80, y: origin_y, w: 480, h: 220 };
		const track_x = 250;
		const track_w = 270;
		const track_h = 16;
		const rows: { id: SliderId; label: string; y: number; pos: number }[] = [
			{ id: "music", label: "Music Volume:", y: origin_y + 36, pos: level_from_volume(Options.ScoreVolume) },
			{ id: "sound", label: "Sound Volume:", y: origin_y + 72, pos: level_from_volume(Options.SoundVolume) },
			{ id: "voice", label: "Voice Volume:", y: origin_y + 108, pos: level_from_volume(Options.VoiceVolume) },
		];
		const ok = { x: 280, y: origin_y + 160, w: 80, h: 22 };
		let hover: Hit | null = null;
		let drag: SliderId | null = null;
		let done = false;

		const track_at = (row: { y: number }): { x: number; y: number; w: number; h: number } => ({
			x: track_x,
			y: row.y,
			w: track_w,
			h: track_h,
		});

		const pos_from_x = (x: number): number => {
			const inner = track_w - 8;
			const t = (x - (track_x + 4)) / inner;
			return Math.max(0, Math.min(VOLUME_LEVELS, Math.round(t * VOLUME_LEVELS)));
		};

		const hit_test = (x: number, y: number): Hit | null => {
			for (const row of rows) {
				const track = track_at(row);
				if (x >= track.x && x < track.x + track.w && y >= track.y && y < track.y + track.h) {
					return { kind: "slider", id: row.id };
				}
			}
			if (x >= ok.x && x < ok.x + ok.w && y >= ok.y && y < ok.y + ok.h) {
				return { kind: "ok", id: "sound" };
			}
			return null;
		};

		const set_row = (id: SliderId, pos: number, feedback: boolean, force = false): void => {
			const row = rows.find((entry) => entry.id === id);
			if (!row || (!force && row.pos === pos)) {
				return;
			}
			row.pos = pos;
			apply_slider(id, pos, feedback);
		};

		const paint = (): void => {
			const frame = backdrop.clone();
			frame.fill_rect(plate.x, plate.y, plate.w, plate.h, build_hicolor_pixel(12, 16, 12));
			const labels: CanvasLabel[] = [
				{ x: plate.x, y: plate.y + 8, width: plate.w, height: 20, text: "Sound Controls", selected: true },
			];
			for (const row of rows) {
				const track = track_at(row);
				const lit = hover?.kind === "slider" && hover.id === row.id;
				frame.fill_rect(track.x, track.y, track.w, track.h, build_hicolor_pixel(24, 28, 24));
				const fill = Math.floor((row.pos / VOLUME_LEVELS) * (track.w - 8));
				frame.fill_rect(track.x + 4, track.y + 4, Math.max(2, fill), track.h - 8, build_hicolor_pixel(200, 160, 32));
				const edge = lit ? build_hicolor_pixel(255, 220, 64) : build_hicolor_pixel(200, 160, 32);
				frame.fill_rect(track.x, track.y, track.w, 1, edge);
				frame.fill_rect(track.x, track.y + track.h - 1, track.w, 1, edge);
				frame.fill_rect(track.x, track.y, 1, track.h, edge);
				frame.fill_rect(track.x + track.w - 1, track.y, 1, track.h, edge);
				labels.push({
					x: plate.x + 12,
					y: row.y,
					width: track_x - plate.x - 20,
					height: track_h,
					text: row.label,
					align: "right",
					selected: lit,
				});
			}
			const ok_lit = hover?.kind === "ok";
			frame.fill_rect(ok.x, ok.y, ok.w, ok.h, build_hicolor_pixel(16, 20, 16));
			const ok_edge = ok_lit ? build_hicolor_pixel(255, 220, 64) : build_hicolor_pixel(200, 160, 32);
			frame.fill_rect(ok.x, ok.y, ok.w, 1, ok_edge);
			frame.fill_rect(ok.x, ok.y + ok.h - 1, ok.w, 1, ok_edge);
			frame.fill_rect(ok.x, ok.y, 1, ok.h, ok_edge);
			frame.fill_rect(ok.x + ok.w - 1, ok.y, 1, ok.h, ok_edge);
			labels.push({
				x: ok.x,
				y: ok.y,
				width: ok.w,
				height: ok.h,
				text: Fetch_String(TXT_OK),
				selected: ok_lit,
			});
			present(canvas, frame, labels);
			canvas.style.cursor = hover || drag ? "pointer" : "default";
		};

		const finish = (): void => {
			if (done) {
				return;
			}
			done = true;
			canvas.removeEventListener("mousemove", on_move);
			canvas.removeEventListener("mousedown", on_down);
			canvas.removeEventListener("click", on_click);
			window.removeEventListener("mouseup", on_up);
			window.removeEventListener("keydown", on_key);
			canvas.style.cursor = "default";
			resolve();
		};

		const on_move = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish();
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			if (drag) {
				set_row(drag, pos_from_x(mouse.x), true);
			}
			hover = hit_test(mouse.x, mouse.y);
			paint();
		};

		const on_down = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish();
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			const hit = hit_test(mouse.x, mouse.y);
			if (hit?.kind === "slider") {
				drag = hit.id;
				set_row(hit.id, pos_from_x(mouse.x), true, true);
				paint();
			}
		};

		const on_up = (): void => {
			drag = null;
		};

		const on_click = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish();
				return;
			}
			const mouse = canvas_mouse(canvas, event);
			const hit = hit_test(mouse.x, mouse.y);
			if (hit?.kind === "ok") {
				for (const row of rows) {
					apply_slider(row.id, row.pos, false);
				}
				Menu_Click_Sound();
				finish();
			}
		};

		const on_key = (event: KeyboardEvent): void => {
			if (cancelled() || done) {
				finish();
				return;
			}
			if (event.key === "Escape" || event.key === "Enter") {
				for (const row of rows) {
					apply_slider(row.id, row.pos, false);
				}
				if (event.key === "Enter") {
					Menu_Click_Sound();
				}
				finish();
			}
		};

		canvas.tabIndex = 0;
		canvas.focus();
		paint();
		canvas.addEventListener("mousemove", on_move);
		canvas.addEventListener("mousedown", on_down);
		canvas.addEventListener("click", on_click);
		window.addEventListener("mouseup", on_up);
		window.addEventListener("keydown", on_key);
	});
}
