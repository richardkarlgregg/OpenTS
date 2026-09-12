/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import { ADDON_ANY, ADDON_BASE_GAME, Addon_Enabled } from "./addon";
import { cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import { INIClass } from "./ini";
import { Fetch_String, TXT_EASY, TXT_HARD, TXT_NORMAL } from "./language";
import type { MenuHost } from "./newmenu";
import { Options } from "./options";
import { Run_Owner_Dialog } from "./ownrdlg";
import { load_title_screen } from "./ownrmenu";
import { last_presented } from "./present";

export const CAMPAIGN_NONE = -1;

export type CampaignClass = {
	name: string;
	cd: number;
	scenario: string;
	description: string;
	required_addon: number;
};

const campaigns: CampaignClass[] = [];

function campaign_available(campaign: CampaignClass): boolean {
	if (Addon_Enabled(ADDON_ANY)) {
		if (campaign.required_addon === ADDON_BASE_GAME) {
			return false;
		}
		return Addon_Enabled(campaign.required_addon);
	}
	return campaign.required_addon === ADDON_BASE_GAME;
}

function from_name(name: string): number {
	const upper = name.toUpperCase();
	return campaigns.findIndex((campaign) => campaign.name.toUpperCase() === upper);
}

function read_battle_ini(ini: INIClass): void {
	const count = ini.entry_count("Battles");
	for (let i = 0; i < count; i++) {
		const name = ini.get_string("Battles", ini.get_entry("Battles", i));
		if (name.length === 0) {
			continue;
		}
		let index = from_name(name);
		if (index < 0) {
			campaigns.push({
				name,
				cd: -1,
				scenario: "",
				description: name,
				required_addon: ADDON_BASE_GAME,
			});
			index = campaigns.length - 1;
		}
		const campaign = campaigns[index]!;
		campaign.cd = ini.get_int(name, "CD", campaign.cd);
		campaign.scenario = ini.get_string(name, "Scenario", campaign.scenario).toUpperCase();
		campaign.description = ini.get_string(name, "Description", campaign.description);
		campaign.required_addon = ini.get_int(name, "RequiredAddon", campaign.required_addon);
	}
}

export async function Init_Campaigns(directory: GameDirectory): Promise<void> {
	campaigns.length = 0;
	const names = ["BATTLE.INI", "BATTLEFS.INI"];
	for (const path of directory.list(".ini")) {
		const base = path.split("/").pop() ?? path;
		if (/^battle.*\.ini$/i.test(base) && !names.some((name) => name.toLowerCase() === base.toLowerCase())) {
			names.push(base);
		}
	}
	for (const name of names) {
		const packed = await cc_retrieve(directory, name);
		if (!packed) {
			continue;
		}
		const ini = new INIClass();
		if (ini.load(packed)) {
			read_battle_ini(ini);
		}
	}
}

export function Get_Campaign(index: number): CampaignClass | null {
	return campaigns[index] ?? null;
}

export async function Choose_Campaign(directory: GameDirectory, host: MenuHost): Promise<CampaignClass | null> {
	if (campaigns.length === 0) {
		await Init_Campaigns(directory);
	}
	const available = campaigns
		.map((campaign, id) => ({ campaign, id }))
		.filter((entry) => campaign_available(entry.campaign));
	if (available.length === 0) {
		host.log("No campaigns are available for the enabled addon.");
		return null;
	}

	const backdrop =
		last_presented()?.clone() ??
		(await load_title_screen(directory, "Title.PCX")) ??
		(await load_title_screen(directory, "TITLE.PCX"));
	if (!backdrop) {
		host.log("No title screen is available for the campaign dialog.");
		return null;
	}

	const picked = await Run_Owner_Dialog(
		host.canvas,
		directory,
		"IDD_CAMPAIGN",
		available.map((entry) => ({ id: entry.id, label: entry.campaign.description })),
		Options.Difficulty,
		host.cancelled,
		backdrop,
	);
	if (!picked) {
		return null;
	}
	Options.Difficulty = picked.slider;
	const campaign = Get_Campaign(picked.item);
	if (campaign) {
		const difficulty = Fetch_String([TXT_EASY, TXT_NORMAL, TXT_HARD][picked.slider] ?? TXT_NORMAL);
		host.log(`Campaign ${campaign.description}; difficulty ${difficulty}; opens ${campaign.scenario}.`);
	}
	return campaign;
}
