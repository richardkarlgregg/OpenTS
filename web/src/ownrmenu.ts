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
import { dialog_name_id, Fetch_Dialog, map_dialog_rect } from "./language";
import { read_pcx } from "./pcx";
import { canvas_mouse, present, type CanvasLabel } from "./present";
import { build_hicolor_pixel, DSurface } from "./surface";
import { Theme } from "./theme";
import { Menu_Click_Sound } from "./voc";

export const SEL_TIMEOUT = -1;
export const SEL_NEW_SCENARIO = 0;
export const SEL_CAMPAIGN_GAME = 1;
export const SEL_LOAD_GAME = 2;
export const SEL_MULTIPLAYER_GAME = 3;
export const SEL_INTRO = 4;
export const SEL_OPTIONS = 5;
export const SEL_EXIT = 6;
export const SEL_FAME = 7;
export const SEL_INTERNET_RETURN = 8;
export const SEL_VIEW_CREDITS = 9;
export const SEL_VERSION = 10;
export const SEL_NONE = 11;

const BUTTON_TO_SEL: Record<string, number> = {
	IDC_NEWCAMPAIGN: SEL_CAMPAIGN_GAME,
	IDC_LOAD_MISSION: SEL_LOAD_GAME,
	IDC_MULTIPLAYER_GAME: SEL_MULTIPLAYER_GAME,
	IDC_INTRO: SEL_INTRO,
	IDC_OPTIONS: SEL_OPTIONS,
	IDC_EXIT_GAME: SEL_EXIT,
};

type MenuButton = {
	id: number;
	caption: string;
	x: number;
	y: number;
	width: number;
	height: number;
	enabled: boolean;
	sel: number;
};

function point_in_button(button: MenuButton, x: number, y: number): boolean {
	return x >= button.x && y >= button.y && x < button.x + button.width && y < button.y + button.height;
}

export async function load_title_screen(directory: GameDirectory, name: string): Promise<DSurface | null> {
	const packed = await cc_retrieve(directory, name);
	if (!packed) {
		return null;
	}
	return read_pcx(packed);
}

function compose(backdrop: DSurface, buttons: MenuButton[], selected: MenuButton | null): DSurface {
	const frame = backdrop.clone();
	const plate = build_hicolor_pixel(16, 20, 16);
	const edge = build_hicolor_pixel(200, 160, 32);
	const dim = build_hicolor_pixel(40, 40, 40);
	for (const button of buttons) {
		const fill = button.enabled ? plate : dim;
		frame.fill_rect(button.x, button.y, button.width, button.height, fill);
		const color = button === selected && button.enabled ? build_hicolor_pixel(255, 220, 64) : edge;
		frame.fill_rect(button.x, button.y, button.width, 1, color);
		frame.fill_rect(button.x, button.y + button.height - 1, button.width, 1, color);
		frame.fill_rect(button.x, button.y, 1, button.height, color);
		frame.fill_rect(button.x + button.width - 1, button.y, 1, button.height, color);
	}
	return frame;
}

function labels_from(buttons: MenuButton[], selected: MenuButton | null): CanvasLabel[] {
	return buttons.map((button) => ({
		x: button.x,
		y: button.y,
		width: button.width,
		height: button.height,
		text: button.caption,
		enabled: button.enabled,
		selected: button === selected,
	}));
}

export function Main_Menu(
	canvas: HTMLCanvasElement,
	backdrop: DSurface,
	cancelled: () => boolean,
): Promise<number> {
	const template = Fetch_Dialog(dialog_name_id("IDD_MAIN_MENU"));
	if (!template) {
		return Promise.resolve(SEL_EXIT);
	}

	const origin_y = Math.floor((backdrop.height - 400) / 2) + 147;
	const origin_x = 0;
	const buttons: MenuButton[] = [];
	for (const control of template.controls) {
		const mapped = map_dialog_rect(control.x, control.y, control.width, control.height);
		let sel = SEL_NONE;
		for (const [name, value] of Object.entries(BUTTON_TO_SEL)) {
			if (dialog_name_id(name) === control.id) {
				sel = value;
				break;
			}
		}
		buttons.push({
			id: control.id,
			caption: control.caption,
			x: origin_x + mapped.x,
			y: origin_y + mapped.y,
			width: mapped.width,
			height: mapped.height,
			enabled: sel !== SEL_LOAD_GAME,
			sel,
		});
	}

	return new Promise((resolve) => {
		let selected: MenuButton | null = null;
		let done = false;
		Theme.Play_Song(Theme.From_Name("Intro"));
		const tick = window.setInterval(() => Theme.AI(), 250);

		const paint = (): void => {
			present(canvas, compose(backdrop, buttons, selected), labels_from(buttons, selected));
			canvas.style.cursor = selected && selected.enabled ? "pointer" : "default";
		};

		const finish = (id: number): void => {
			if (done) {
				return;
			}
			done = true;
			window.clearInterval(tick);
			canvas.removeEventListener("mousemove", on_move);
			canvas.removeEventListener("click", on_click);
			window.removeEventListener("keydown", on_key);
			canvas.style.cursor = "default";
			resolve(id);
		};

		const hit = (event: MouseEvent): MenuButton | null => {
			const mouse = canvas_mouse(canvas, event);
			for (const button of buttons) {
				if (point_in_button(button, mouse.x, mouse.y)) {
					return button;
				}
			}
			return null;
		};

		const on_move = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish(SEL_EXIT);
				return;
			}
			const next = hit(event);
			if (next !== selected) {
				selected = next;
				paint();
			}
		};

		const on_click = (event: MouseEvent): void => {
			if (cancelled() || done) {
				finish(SEL_EXIT);
				return;
			}
			const button = hit(event);
			if (button && button.enabled && button.sel !== SEL_NONE) {
				Menu_Click_Sound();
				finish(button.sel);
			}
		};

		const on_key = (event: KeyboardEvent): void => {
			if (cancelled() || done) {
				finish(SEL_EXIT);
				return;
			}
			if (event.key === "Escape") {
				finish(SEL_EXIT);
			}
		};

		paint();
		canvas.tabIndex = 0;
		canvas.focus();
		canvas.addEventListener("mousemove", on_move);
		canvas.addEventListener("click", on_click);
		window.addEventListener("keydown", on_key);
	});
}

export function sel_name(id: number): string {
	switch (id) {
		case SEL_CAMPAIGN_GAME:
			return "SEL_CAMPAIGN_GAME";
		case SEL_LOAD_GAME:
			return "SEL_LOAD_GAME";
		case SEL_MULTIPLAYER_GAME:
			return "SEL_MULTIPLAYER_GAME";
		case SEL_INTRO:
			return "SEL_INTRO";
		case SEL_OPTIONS:
			return "SEL_OPTIONS";
		case SEL_EXIT:
			return "SEL_EXIT";
		case SEL_VIEW_CREDITS:
			return "SEL_VIEW_CREDITS";
		case SEL_VERSION:
			return "SEL_VERSION";
		default:
			return `SEL_${id}`;
	}
}
