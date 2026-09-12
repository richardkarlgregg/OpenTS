/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 * EA's GPLv3 Section 7 additional terms and warranty disclaimers apply; see LICENSE.md.
 ******************************************************************************/

import { INIClass } from "./ini";
import { CELL_LEPTON } from "./walk";
import { VocClass } from "./voc";

export const ARMOR_NONE = 0;
export const ARMOR_WOOD = 1;
export const ARMOR_ALUMINUM = 2;
export const ARMOR_STEEL = 3;
export const ARMOR_CONCRETE = 4;
export const ARMOR_COUNT = 5;

const ArmorName = ["none", "wood", "light", "heavy", "concrete"];

export const FIRE_OK = 0;
export const FIRE_ILLEGAL = 1;
export const FIRE_CANT = 2;
export const FIRE_REARM = 3;
export const FIRE_RANGE = 4;
export const FIRE_AMMO = 5;
export const FIRE_FACING = 6;

export type BulletTypeClass = {
	IniName: string;
	IsInvisible: boolean;
	IsArcing: boolean;
	IsAntiAircraft: boolean;
	IsAntiGround: boolean;
	ROT: number;
	Image: string;
};

export type WarheadTypeClass = {
	IniName: string;
	SpreadFactor: number;
	Modifier: number[];
	AnimList: string[];
	InfantryDeath: number;
};

export type WeaponTypeClass = {
	IniName: string;
	Attack: number;
	ROF: number;
	Range: number;
	MinimumRange: number;
	Burst: number;
	Bullet: BulletTypeClass | null;
	WarheadPtr: WarheadTypeClass | null;
	MaxSpeed: number;
	Sound: number[];
};

export type CombatTables = {
	weapons: Map<string, WeaponTypeClass>;
	warheads: Map<string, WarheadTypeClass>;
	bullets: Map<string, BulletTypeClass>;
	min_damage: number;
	max_damage: number;
};

export function Armor_From_Name(name: string): number {
	const want = name.toLowerCase();
	for (let i = 0; i < ArmorName.length; i++) {
		if (ArmorName[i] === want) {
			return i;
		}
	}
	return ARMOR_NONE;
}

export function Read_Combat_Tables(ini: INIClass): CombatTables {
	const warheads = new Map<string, WarheadTypeClass>();
	const bullets = new Map<string, BulletTypeClass>();
	const weapons = new Map<string, WeaponTypeClass>();
	const warhead_count = ini.entry_count("Warheads");
	for (let i = 0; i < warhead_count; i++) {
		const name = ini.get_string("Warheads", ini.get_entry("Warheads", i), "");
		if (name) {
			warheads.set(name.toUpperCase(), Read_Warhead(ini, name));
		}
	}
	const weapon_count = ini.entry_count("Weapons");
	for (let i = 0; i < weapon_count; i++) {
		const name = ini.get_string("Weapons", ini.get_entry("Weapons", i), "");
		if (name) {
			weapons.set(name.toUpperCase(), Read_Weapon(ini, name, warheads, bullets));
		}
	}
	return {
		weapons,
		warheads,
		bullets,
		min_damage: ini.get_int("CombatDamage", "MinDamage", 1),
		max_damage: ini.get_int("CombatDamage", "MaxDamage", 1000),
	};
}

export function Find_Or_Make_Warhead(ini: INIClass, name: string, tables: CombatTables): WarheadTypeClass | null {
	if (!name || name.toLowerCase() === "none") {
		return null;
	}
	const key = name.toUpperCase();
	const have = tables.warheads.get(key);
	if (have) {
		return have;
	}
	const warhead = Read_Warhead(ini, name);
	tables.warheads.set(key, warhead);
	return warhead;
}

export function Combat_Anim(damage: number, warhead: WarheadTypeClass | null): string | null {
	const DAMAGE_PER_EXPLOSION_ANIM = 25;
	if (!damage || !warhead || warhead.AnimList.length === 0) {
		return null;
	}
	const count = warhead.AnimList.length;
	const val = Math.min(damage, DAMAGE_PER_EXPLOSION_ANIM * count - 1);
	return warhead.AnimList[Math.trunc(val / DAMAGE_PER_EXPLOSION_ANIM)] ?? null;
}

export function Find_Or_Make_Weapon(ini: INIClass, name: string, tables: CombatTables): WeaponTypeClass | null {
	if (!name || name.toLowerCase() === "none") {
		return null;
	}
	const key = name.toUpperCase();
	const have = tables.weapons.get(key);
	if (have) {
		return have;
	}
	const weapon = Read_Weapon(ini, name, tables.warheads, tables.bullets);
	tables.weapons.set(key, weapon);
	return weapon;
}

function Read_Warhead(ini: INIClass, name: string): WarheadTypeClass {
	const modifier = [1, 1, 1, 1, 1];
	const verses = ini.get_string(name, "Verses", "100%,100%,100%,100%,100%");
	const parts = verses.split(",");
	for (let i = 0; i < ARMOR_COUNT; i++) {
		const token = parts[i]?.trim() ?? "";
		if (!token) {
			continue;
		}
		const value = Number.parseFloat(token);
		if (Number.isFinite(value)) {
			modifier[i] = token.includes("%") ? value / 100 : value;
		}
	}
	return {
		IniName: name,
		SpreadFactor: ini.get_int(name, "Spread", 1),
		Modifier: modifier,
		AnimList: ini
			.get_string(name, "AnimList", "")
			.split(",")
			.map((part) => part.trim())
			.filter((part) => part.length > 0),
		InfantryDeath: ini.get_int(name, "InfDeath", 0),
	};
}

function Read_Bullet(ini: INIClass, name: string): BulletTypeClass {
	return {
		IniName: name,
		IsInvisible: ini.get_bool(name, "Inviso", false),
		IsArcing: ini.get_bool(name, "Arcing", false),
		IsAntiAircraft: ini.get_bool(name, "AA", false),
		IsAntiGround: ini.get_bool(name, "AG", true),
		ROT: ini.get_int(name, "ROT", 0),
		Image: ini.get_string(name, "Image", name),
	};
}

function Read_Weapon(
	ini: INIClass,
	name: string,
	warheads: Map<string, WarheadTypeClass>,
	bullets: Map<string, BulletTypeClass>,
): WeaponTypeClass {
	const warhead_name = ini.get_string(name, "Warhead", "");
	const bullet_name = ini.get_string(name, "Projectile", "");
	let warhead = warheads.get(warhead_name.toUpperCase()) ?? null;
	if (!warhead && warhead_name && warhead_name.toLowerCase() !== "none") {
		warhead = Read_Warhead(ini, warhead_name);
		warheads.set(warhead_name.toUpperCase(), warhead);
	}
	let bullet = bullets.get(bullet_name.toUpperCase()) ?? null;
	if (!bullet && bullet_name && bullet_name.toLowerCase() !== "none") {
		bullet = Read_Bullet(ini, bullet_name);
		bullets.set(bullet_name.toUpperCase(), bullet);
	}
	let burst = ini.get_int(name, "Burst", 1);
	if (burst < 1) {
		burst = 1;
	}
	const report = ini
		.get_string(name, "Report", "")
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map((part) => VocClass.From_Name(part))
		.filter((voc) => voc >= 0);
	return {
		IniName: name,
		Attack: ini.get_int(name, "Damage", 0),
		ROF: ini.get_int(name, "ROF", 0),
		Range: ini.get_lepton(name, "Range", 0),
		MinimumRange: ini.get_lepton(name, "MinimumRange", 0),
		Burst: burst,
		Bullet: bullet,
		WarheadPtr: warhead,
		MaxSpeed: ini.get_int(name, "Speed", 0),
		Sound: report,
	};
}

export function Modify_Damage(
	damage: number,
	warhead: WarheadTypeClass | null,
	armor: number,
	distance: number,
	min_damage: number,
	max_damage: number,
): number {
	if (!damage || !warhead) {
		return 0;
	}
	if (damage < 0) {
		return distance < 8 ? damage : 0;
	}
	const index = armor >= 0 && armor < ARMOR_COUNT ? armor : ARMOR_NONE;
	let modified = Math.trunc(damage * (warhead.Modifier[index] ?? 1));
	if (!modified) {
		modified = 1;
	}
	const PIXEL_LEPTON_W = Math.trunc(CELL_LEPTON / 24);
	let range = distance;
	if (!warhead.SpreadFactor) {
		range = Math.trunc(range / Math.trunc(PIXEL_LEPTON_W / 4));
	} else {
		range = Math.trunc(range / (warhead.SpreadFactor * Math.trunc(PIXEL_LEPTON_W / 3)));
	}
	if (range < 0) {
		range = 0;
	}
	if (range > 16) {
		range = 16;
	}
	if (range) {
		modified = Math.trunc(modified / range);
	}
	if (range < 4) {
		modified = Math.max(modified, min_damage);
	}
	return Math.min(modified, max_damage);
}

export function In_Range(
	from: { x: number; y: number },
	to: { x: number; y: number },
	weapon: WeaponTypeClass,
	building_span = 0,
): boolean {
	const dx = from.x - to.x;
	const dy = from.y - to.y;
	const dist = Math.hypot(dx, dy);
	if (weapon.MinimumRange && dist < weapon.MinimumRange) {
		return false;
	}
	let range = weapon.Range - CELL_LEPTON / 3;
	if (building_span > 0) {
		range += building_span * (CELL_LEPTON / 4);
	}
	return dist <= range;
}
