/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import {
	ADDON_ANY,
	ADDON_BASE_GAME,
	ADDON_FIRESTORM,
	Addon_Installed,
	Disable_Addon,
	Enable_Addon,
	Set_Required_Addon,
} from "./addon";
import { cc_available, cc_retrieve } from "./ccfile";
import { mix_named } from "./mixfile";
import type { GameDirectory } from "./files";
import { last_presented } from "./present";
import { Sound_Options_Dialog } from "./sounddlg";
import { Do_Graphic_Menu, Presentation, set_item_enabled } from "./grphmenu";
import { INIClass } from "./ini";
import { load_title_screen, Main_Menu, SEL_CAMPAIGN_GAME, SEL_EXIT, SEL_INTRO, SEL_LOAD_GAME, SEL_MULTIPLAYER_GAME, SEL_NONE, SEL_OPTIONS, SEL_VERSION, SEL_VIEW_CREDITS, sel_name } from "./ownrmenu";
import { Play_Intro_Selection, Play_Title_Movie } from "./movies";
import { GAME_IPX, GAME_NORMAL, GAME_SKIRMISH, set_session_type } from "./session";

export const NSEL_EXIT = 0;
export const NSEL_START_NEW_GAME = 1;
export const NSEL_LOAD_MISSION = 2;
export const NSEL_LAN = 3;
export const NSEL_INTERNET = 4;
export const NSEL_SERIAL_MODEM = 5;
export const NSEL_SKIRMISH = 6;
export const NSEL_WDT = 7;
export const NSEL_OPTIONS = 8;
export const NSEL_9 = 9;
export const NSEL_INTRO = 10;
export const NSEL_VERSION = 11;
export const NSEL_VIEW_CREDITS = 12;
export const NSEL_OLD_MENU = 13;
export const GMENU_TIBSUN = 100;
export const GMENU_FIRESTORM = 101;
export const GMENU_BACK = 102;

export type MenuHost = {
	canvas: HTMLCanvasElement;
	log: (line: string) => void;
	cancelled: () => boolean;
};

async function Show_Sound_Options(host: MenuHost): Promise<void> {
	const backdrop = last_presented();
	if (!backdrop) {
		return;
	}
	await Sound_Options_Dialog(host.canvas, backdrop.clone(), host.cancelled);
}

function nsel_name(id: number): string {
	switch (id) {
		case NSEL_EXIT:
			return "NSEL_EXIT";
		case NSEL_START_NEW_GAME:
			return "NSEL_START_NEW_GAME";
		case NSEL_LOAD_MISSION:
			return "NSEL_LOAD_MISSION";
		case NSEL_LAN:
			return "NSEL_LAN";
		case NSEL_INTERNET:
			return "NSEL_INTERNET";
		case NSEL_SKIRMISH:
			return "NSEL_SKIRMISH";
		case NSEL_WDT:
			return "NSEL_WDT";
		case NSEL_OPTIONS:
			return "NSEL_OPTIONS";
		case NSEL_INTRO:
			return "NSEL_INTRO";
		case NSEL_VERSION:
			return "NSEL_VERSION";
		case NSEL_VIEW_CREDITS:
			return "NSEL_VIEW_CREDITS";
		case NSEL_OLD_MENU:
			return "NSEL_OLD_MENU";
		case GMENU_TIBSUN:
			return "GMENU_TIBSUN";
		case GMENU_FIRESTORM:
			return "GMENU_FIRESTORM";
		case GMENU_BACK:
			return "GMENU_BACK";
		default:
			return `NSEL_${id}`;
	}
}

function map_new_selection(id: number): number {
	switch (id) {
		case NSEL_START_NEW_GAME:
			return SEL_CAMPAIGN_GAME;
		case NSEL_LOAD_MISSION:
			return SEL_LOAD_GAME;
		case NSEL_OPTIONS:
			return SEL_OPTIONS;
		case NSEL_INTRO:
			return SEL_INTRO;
		case NSEL_VERSION:
			return SEL_VERSION;
		case NSEL_VIEW_CREDITS:
			return SEL_VIEW_CREDITS;
		case NSEL_EXIT:
			return SEL_EXIT;
		case NSEL_LAN:
		case NSEL_SKIRMISH:
			return SEL_MULTIPLAYER_GAME;
		default:
			return SEL_NONE;
	}
}

async function display_menu(
	directory: GameDirectory,
	ini: INIClass,
	host: MenuHost,
	section: string,
	disabled: number[],
): Promise<number> {
	const menu = await Do_Graphic_Menu(directory, ini, section);
	if (!menu) {
		return NSEL_OLD_MENU;
	}
	for (const id of disabled) {
		set_item_enabled(menu, id, false);
	}
	host.log(`Graphic menu [${section}] backdrop ${menu.background_name}, ${menu.items.length} item(s).`);
	return Presentation(host.canvas, menu, host.cancelled);
}

async function select_game_type(directory: GameDirectory, ini: INIClass, host: MenuHost): Promise<number> {
	Disable_Addon(ADDON_ANY);
	const result = await display_menu(directory, ini, host, "MainMenu", []);
	switch (result) {
		case GMENU_TIBSUN:
			Disable_Addon(ADDON_ANY);
			Set_Required_Addon(ADDON_BASE_GAME);
			break;
		case GMENU_FIRESTORM:
			Disable_Addon(ADDON_ANY);
			Enable_Addon(ADDON_FIRESTORM);
			Set_Required_Addon(ADDON_FIRESTORM);
			break;
		default:
			break;
	}
	return result;
}

async function display_tiberian_sun_menu(directory: GameDirectory, ini: INIClass, host: MenuHost): Promise<number> {
	Disable_Addon(ADDON_ANY);
	Set_Required_Addon(ADDON_BASE_GAME);
	const disabled = [NSEL_LOAD_MISSION, NSEL_INTERNET];
	if (!Addon_Installed(ADDON_ANY)) {
		disabled.push(GMENU_BACK);
	}
	return display_menu(directory, ini, host, "TiberianSunMenu", disabled);
}

async function display_firestorm_menu(directory: GameDirectory, ini: INIClass, host: MenuHost): Promise<number> {
	Disable_Addon(ADDON_ANY);
	Enable_Addon(ADDON_FIRESTORM);
	Set_Required_Addon(ADDON_FIRESTORM);
	return display_menu(directory, ini, host, "FirestormMenu", [NSEL_LOAD_MISSION, NSEL_INTERNET, NSEL_WDT]);
}

async function game_select_loop(directory: GameDirectory, ini: INIClass, host: MenuHost): Promise<number> {
	let game_mode = -1;
	while (!host.cancelled()) {
		if (game_mode < 0) {
			let item: number;
			if (Addon_Installed(ADDON_FIRESTORM)) {
				item = await select_game_type(directory, ini, host);
			} else {
				item = GMENU_TIBSUN;
			}
			if (host.cancelled()) {
				return NSEL_EXIT;
			}
			switch (item) {
				case GMENU_TIBSUN:
					game_mode = 0;
					await Play_Title_Movie(directory, host, false);
					continue;
				case GMENU_FIRESTORM:
					game_mode = 1;
					await Play_Title_Movie(directory, host, true);
					continue;
				case NSEL_EXIT:
				case NSEL_VERSION:
				case NSEL_VIEW_CREDITS:
					return item;
				default:
					if (item === GMENU_BACK) {
						continue;
					}
					return item;
			}
		}

		if (game_mode === 0) {
			const item = await display_tiberian_sun_menu(directory, ini, host);
			if (item === GMENU_BACK) {
				game_mode = -1;
				continue;
			}
			return item;
		}

		const item = await display_firestorm_menu(directory, ini, host);
		if (item === GMENU_BACK) {
			game_mode = -1;
			continue;
		}
		return item;
	}
	return NSEL_EXIT;
}

export async function Process_Game_Select(directory: GameDirectory, host: MenuHost): Promise<number> {
	if (!mix_named("gmenu.mix") && !cc_available(directory, "GMENU.MIX") && !cc_available(directory, "NewMenu.INI")) {
		return NSEL_OLD_MENU;
	}
	const packed = await cc_retrieve(directory, "NewMenu.INI");
	if (!packed) {
		host.log("GMENU is present but NewMenu.INI was not found. Falling back to the old menu.");
		return NSEL_OLD_MENU;
	}
	const ini = new INIClass();
	if (!ini.load(packed)) {
		host.log("NewMenu.INI did not parse. Falling back to the old menu.");
		return NSEL_OLD_MENU;
	}
	return game_select_loop(directory, ini, host);
}

export async function New_Main_Menu(directory: GameDirectory, host: MenuHost): Promise<number> {
	const selection = await Process_Game_Select(directory, host);
	if (selection === NSEL_OLD_MENU) {
		host.log("Old main menu (IDD_MAIN_MENU).");
		const backdrop =
			(await load_title_screen(directory, "Title.PCX")) ??
			(await load_title_screen(directory, "TITLE.PCX"));
		if (!backdrop) {
			host.log("Title.PCX missing; cannot show the old menu.");
			return SEL_EXIT;
		}
		const picked = await Main_Menu(host.canvas, backdrop, host.cancelled);
		if (picked === SEL_OPTIONS) {
			await Show_Sound_Options(host);
			return SEL_NONE;
		}
		return picked;
	}

	host.log(`Menu choice ${nsel_name(selection)}.`);
	if (selection === NSEL_SKIRMISH) {
		set_session_type(GAME_SKIRMISH);
	} else if (selection === NSEL_LAN) {
		set_session_type(GAME_IPX);
	} else if (selection === NSEL_START_NEW_GAME) {
		set_session_type(GAME_NORMAL);
	}
	const mapped = map_new_selection(selection);
	if (mapped === SEL_LOAD_GAME) {
		host.log("Save/load is not ported yet.");
	} else if (mapped === SEL_OPTIONS) {
		await Show_Sound_Options(host);
		return SEL_NONE;
	} else if (mapped === SEL_INTRO) {
		await Play_Intro_Selection(directory, host);
		return SEL_NONE;
	}
	if (mapped !== SEL_NONE) {
		host.log(`Maps to ${sel_name(mapped)}.`);
	}
	return mapped;
}
