/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import { ADDON_BASE_GAME, ADDON_COUNT, Addon_Enabled } from "./addon";
import { cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import { INIClass } from "./ini";
import { pick_from_list } from "./listdlg";
import type { MenuHost } from "./newmenu";
import { load_title_screen } from "./ownrmenu";

export type MultiMission = {
	filename: string;
	description: string;
};

async function load_pkt(directory: GameDirectory, name: string, into: MultiMission[]): Promise<void> {
	const packed = await cc_retrieve(directory, name);
	if (!packed) {
		return;
	}
	const ini = new INIClass();
	if (!ini.load(packed)) {
		return;
	}
	const count = ini.entry_count("MultiMaps");
	for (let i = 0; i < count; i++) {
		const section = ini.get_string("MultiMaps", ini.get_entry("MultiMaps", i));
		if (section.length === 0) {
			continue;
		}
		into.push({
			filename: `${section}.MAP`,
			description: ini.get_string(section, "Description", section),
		});
	}
}

export async function Read_Scenario_Descriptions(directory: GameDirectory): Promise<MultiMission[]> {
	const missions: MultiMission[] = [];
	await load_pkt(directory, "MISSIONS.PKT", missions);
	for (let addon = ADDON_COUNT - 1; addon > ADDON_BASE_GAME; addon--) {
		if (Addon_Enabled(addon)) {
			const name = `MULTI${String(addon).padStart(2, "0")}.PKT`;
			await load_pkt(directory, name, missions);
		}
	}
	for (const path of directory.list(".pkt")) {
		const base = path.split("/").pop() ?? path;
		if (base.toLowerCase() === "missions.pkt") {
			continue;
		}
		await load_pkt(directory, base, missions);
	}
	for (const path of directory.list(".mpr")) {
		const packed = await cc_retrieve(directory, path);
		if (!packed) {
			continue;
		}
		const ini = new INIClass();
		if (!ini.load(packed)) {
			continue;
		}
		missions.push({
			filename: path.split("/").pop() ?? path,
			description: ini.get_string("Basic", "Name", "No Name"),
		});
	}
	return missions;
}

export async function Choose_Skirmish_Map(directory: GameDirectory, host: MenuHost): Promise<MultiMission | null> {
	const missions = await Read_Scenario_Descriptions(directory);
	if (missions.length === 0) {
		host.log("No skirmish maps found (MISSIONS.PKT / .MPR).");
		return null;
	}
	const backdrop =
		(await load_title_screen(directory, "Title.PCX")) ??
		(await load_title_screen(directory, "TITLE.PCX"));
	if (!backdrop) {
		host.log("Title.PCX missing; cannot show the skirmish list.");
		return null;
	}
	const picked = await pick_from_list(
		host.canvas,
		backdrop,
		"Select Map:",
		missions.map((mission, id) => ({ id, label: mission.description })),
		host.cancelled,
	);
	if (!picked) {
		return null;
	}
	return missions[picked.id] ?? null;
}
