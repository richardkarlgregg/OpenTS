/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import { Addon_Installed, ADDON_FIRESTORM, Detect_Addons } from "./addon";
import { Choose_Campaign } from "./campaign";
import { directory_from_file_list, type GameDirectory } from "./files";
import { Fetch_String, language_stats, TXT_COPYRIGHT, TXT_OK } from "./language";
import { clear_mix_list, register_mix, register_nested_mixes } from "./mixfile";
import { New_Main_Menu } from "./newmenu";
import { SEL_CAMPAIGN_GAME, SEL_EXIT, SEL_MULTIPLAYER_GAME } from "./ownrmenu";
import { present } from "./present";
import { Pick_Load_Background_Name, Show_Scenario } from "./scenario";
import { GAME_SKIRMISH, SessionType } from "./session";
import { Choose_Skirmish_Map } from "./skirmish";
import { build_hicolor_pixel, DSurface } from "./surface";

const log_el = document.querySelector("#log") as HTMLPreElement;
const canvas = document.querySelector("#frame") as HTMLCanvasElement;
const pick = document.querySelector("#pick") as HTMLButtonElement;
const folder = document.querySelector("#folder") as HTMLInputElement;

folder.multiple = true;
folder.setAttribute("webkitdirectory", "");

let session = 0;

function log(line: string): void {
	log_el.textContent += `${line}\n`;
}

function test_pattern(): DSurface {
	const surface = new DSurface(640, 400);
	for (let y = 0; y < surface.height; y++) {
		for (let x = 0; x < surface.width; x++) {
			surface.pixels[y * surface.width + x] = build_hicolor_pixel(x >> 1, y, 64);
		}
	}
	surface.fill_rect(16, 16, 200, 24, build_hicolor_pixel(255, 200, 32));
	return surface;
}

present(canvas, test_pattern());
const stats = language_stats();
log("565 software frame on canvas. Pick a Tiberian Sun folder to load MIX files.");
log(`Fetch_String(${TXT_OK})="${Fetch_String(TXT_OK)}"; ${stats.strings} strings, ${stats.dialogs} dialogs from language.rc.`);
log(`Copyright string: ${Fetch_String(TXT_COPYRIGHT)}`);

pick.addEventListener("click", () => {
	folder.click();
});

folder.addEventListener("change", () => {
	if (folder.files && folder.files.length > 0) {
		void load_install(directory_from_file_list(folder.files));
		folder.value = "";
	}
});

async function load_install(directory: GameDirectory): Promise<void> {
	const token = ++session;
	const cancelled = (): boolean => token !== session;
	const host = { canvas, log, cancelled };
	log_el.textContent = "";
	try {
		log(`Folder: ${directory.name}`);
		clear_mix_list();

		const mixes = directory.list(".mix");
		if (mixes.length === 0) {
			log("No .mix files in that folder.");
			present(canvas, test_pattern());
			return;
		}

		log(`${mixes.length} MIX file(s):`);
		for (const name of mixes) {
			const mix = await register_mix(directory, name);
			if (!mix || mix.count === 0) {
				log(`  ${name}: failed to open`);
				continue;
			}
			const kind = mix.is_encrypted ? "encrypted header" : "plain header";
			log(`  ${name}: ${mix.count} files, data ${mix.data_size} bytes (${kind})`);
		}

		const nested = await register_nested_mixes();
		if (nested.length > 0) {
			log(`${nested.length} nested MIX file(s):`);
			for (const mix of nested) {
				log(`  ${mix.filename}: ${mix.count} files, data ${mix.data_size} bytes`);
			}
		}

		Detect_Addons(directory);
		log(Addon_Installed(ADDON_FIRESTORM) ? "Firestorm rules found." : "Base game only.");

		while (!cancelled()) {
			const selection = await New_Main_Menu(directory, host);
			if (cancelled() || selection === SEL_EXIT) {
				if (selection === SEL_EXIT) {
					log("Exit selected.");
				}
				break;
			}

			if (selection === SEL_CAMPAIGN_GAME) {
				const campaign = await Choose_Campaign(directory, host);
				if (campaign && campaign.scenario.length > 0) {
					const backdrop = Pick_Load_Background_Name(campaign.cd, campaign.scenario);
					log(`Loading screen ${backdrop} (campaign CD ${campaign.cd}).`);
					await Show_Scenario(canvas, directory, campaign.scenario, log, cancelled, backdrop);
				}
				continue;
			}

			if (selection === SEL_MULTIPLAYER_GAME && SessionType === GAME_SKIRMISH) {
				const mission = await Choose_Skirmish_Map(directory, host);
				if (mission) {
					log(`Skirmish map ${mission.filename}.`);
					await Show_Scenario(canvas, directory, mission.filename, log, cancelled);
				}
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log(message);
		present(canvas, test_pattern());
	}
}
