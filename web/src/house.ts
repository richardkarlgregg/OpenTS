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
import { GAME_NORMAL, SessionType } from "./session";
import type { TagClass } from "./trigger";

export const HOUSE_NONE = -1;
export const HOUSE_FIRST = 0;

export const SOURCE_NONE = -1;
export const SOURCE_NORTH = 0;
export const SOURCE_EAST = 1;
export const SOURCE_SOUTH = 2;
export const SOURCE_WEST = 3;
export const SOURCE_AIR = 4;

const SourceName = ["North", "East", "South", "West", "Air"];

const SpawnNames = ["Spawn1", "Spawn2", "Spawn3", "Spawn4", "Spawn5", "Spawn6", "Spawn7", "Spawn8"];
const PlayerAtNames = [
	"<Player @ A>",
	"<Player @ B>",
	"<Player @ C>",
	"<Player @ D>",
	"<Player @ E>",
	"<Player @ F>",
	"<Player @ G>",
	"<Player @ H>",
];

export const HouseTypes: HouseTypeClass[] = [];
export const Houses: HouseClass[] = [];
export let PlayerPtr: HouseClass | null = null;

let ScenarioInit = 0;

export class HouseTypeClass {
	IniName: string;
	House: number;
	HeapID: number;
	Side = "";
	FirepowerBias = 1;
	GroundspeedBias = 1;
	AirspeedBias = 1;
	ArmorBias = 1;
	ROFBias = 1;
	CostBias = 1;
	BuildSpeedBias = 1;
	Scheme = "";
	Prefix = "A";
	Suffix = "";
	IsMultiplay = false;
	IsMultiplayPassive = false;
	IsWallOwner = true;
	IsSmartAI = false;

	constructor(ininame: string) {
		this.IniName = ininame;
		HouseTypes.push(this);
		this.House = HouseTypes.length - 1;
		this.HeapID = this.House;
	}

	Name(): string {
		return this.IniName;
	}

	Full_Name(): string {
		return this.IniName;
	}

	static From_Name(name: string): number {
		if (!name) {
			return HOUSE_NONE;
		}
		for (const type of HouseTypes) {
			if (eqi(type.Name(), name) || eqi(type.Full_Name(), name)) {
				return type.House;
			}
		}
		return HOUSE_NONE;
	}

	static Find_Or_Make(ininame: string): HouseTypeClass {
		const have = HouseTypeClass.From_Name(ininame);
		if (have !== HOUSE_NONE) {
			return HouseTypes[have]!;
		}
		return new HouseTypeClass(ininame);
	}

	Read_INI(ini: INIClass): boolean {
		if (!ini.is_present(this.Name())) {
			return false;
		}
		const suffix = ini.get_string(this.Name(), "Suffix", "");
		if (suffix.length > 0) {
			this.Suffix = suffix;
		}
		const color = ini.get_string(this.Name(), "Color", "");
		if (color.length > 0) {
			this.Scheme = color.toUpperCase();
		}
		const prefix = ini.get_string(this.Name(), "Prefix", this.Prefix);
		if (prefix.length > 0) {
			this.Prefix = prefix.charAt(0);
		}
		this.FirepowerBias = ini.get_float(this.Name(), "Firepower", this.FirepowerBias);
		this.GroundspeedBias = ini.get_float(this.Name(), "Groundspeed", this.GroundspeedBias);
		this.AirspeedBias = ini.get_float(this.Name(), "Airspeed", this.AirspeedBias);
		this.ArmorBias = ini.get_float(this.Name(), "Armor", this.ArmorBias);
		this.ROFBias = ini.get_float(this.Name(), "ROF", this.ROFBias);
		this.CostBias = ini.get_float(this.Name(), "Cost", this.CostBias);
		this.BuildSpeedBias = ini.get_float(this.Name(), "BuildTime", this.BuildSpeedBias);
		this.IsMultiplay = ini.get_bool(this.Name(), "Multiplay", this.IsMultiplay);
		this.IsMultiplayPassive = ini.get_bool(this.Name(), "MultiplayPassive", this.IsMultiplayPassive);
		this.IsWallOwner = ini.get_bool(this.Name(), "WallOwner", this.IsWallOwner);
		this.IsSmartAI = ini.get_bool(this.Name(), "SmartAI", this.IsSmartAI);
		this.Side = ini.get_string(this.Name(), "Side", this.Side);
		return true;
	}
}

type HouseStatic = {
	IQ: number;
	TechLevel: number;
	Allies: number;
	InitialCredits: number;
	Edge: number;
};

export class HouseClass {
	HeapID: number;
	Class: HouseTypeClass;
	Control: HouseStatic;
	IQ: number;
	ActLike: number;
	IsHuman = false;
	IsPlayerControl = false;
	IsDefeated = false;
	IsObserver = false;
	Credits: number;
	CurUnits = 0;
	CurBuildings = 0;
	CurInfantry = 0;
	CurAircraft = 0;
	Power = 0;
	Drain = 0;
	Allies: number;
	Scheme: string;
	RecalcPower = true;
	RecalcRadar = true;
	SpawnWaypoint = -1;
	BQuantity = new Map<string, number>();
	AQuantity = new Map<string, number>();
	IQuantity = new Map<string, number>();
	UQuantity = new Map<string, number>();
	HouseTags: TagClass[] = [];
	JustBuiltStructure = -1;
	JustBuiltInfantry = -1;
	JustBuiltUnit = -1;
	JustBuiltAircraft = -1;
	IsAllToHunt = false;

	constructor(type: HouseTypeClass) {
		this.Class = type;
		this.Control = {
			IQ: 0,
			TechLevel: 1,
			Allies: 0,
			InitialCredits: 0,
			Edge: SOURCE_NORTH,
		};
		this.IQ = this.Control.IQ;
		this.Credits = 0;
		this.Allies = 0;
		this.Scheme = type.Scheme;
		this.HeapID = Houses.length;
		this.Control.Allies |= 1 << this.HeapID;
		this.ActLike = type.IsMultiplayPassive ? HOUSE_NONE : type.House;
		Houses.push(this);
	}

	Is_Ally_House(house: number): boolean {
		if (house === this.HeapID) {
			return true;
		}
		if (house !== HOUSE_NONE) {
			return (this.Allies & (1 << house)) !== 0;
		}
		return false;
	}

	Is_Ally(house: HouseClass | null): boolean {
		if (!house) {
			return false;
		}
		if (house === this) {
			return true;
		}
		return this.Is_Ally_House(house.HeapID);
	}

	Is_Allowed_To_Ally(house: HouseClass | null): boolean {
		if (house && this.Is_Ally(house)) {
			return false;
		}
		if (ScenarioInit) {
			return true;
		}
		if (this.IsDefeated) {
			return false;
		}
		if (house && house.IsObserver) {
			return false;
		}
		return true;
	}

	Make_Ally(house: HouseClass | null): void {
		if (!house || !this.Is_Allowed_To_Ally(house)) {
			return;
		}
		this.Allies |= 1 << house.HeapID;
		if (ScenarioInit) {
			this.Control.Allies |= 1 << house.HeapID;
		}
	}

	Is_Player_Control(): boolean {
		if (SessionType === GAME_NORMAL) {
			return this.IsHuman || this.IsPlayerControl;
		}
		return this === PlayerPtr;
	}

	Is_Human_Player(): boolean {
		if (SessionType === GAME_NORMAL) {
			return this.Is_Player_Control();
		}
		return this.IsHuman;
	}

	Tracking_Add(rtti: string, type_name: string, considered_vehicle: boolean, insignificant: boolean): void {
		if (insignificant) {
			return;
		}
		const key = type_name.toUpperCase();
		switch (rtti) {
			case "building":
				if (considered_vehicle) {
					this.CurUnits++;
				} else {
					this.CurBuildings++;
				}
				bump(this.BQuantity, key);
				break;
			case "aircraft":
				this.CurAircraft++;
				bump(this.AQuantity, key);
				break;
			case "infantry":
				this.CurInfantry++;
				bump(this.IQuantity, key);
				break;
			case "unit":
				this.CurUnits++;
				bump(this.UQuantity, key);
				break;
			default:
				break;
		}
	}

	Tracking_Remove(rtti: string, type_name: string, considered_vehicle: boolean, insignificant: boolean): void {
		if (insignificant) {
			return;
		}
		const key = type_name.toUpperCase();
		switch (rtti) {
			case "building":
				if (considered_vehicle) {
					this.CurUnits--;
				} else {
					this.CurBuildings--;
				}
				drop(this.BQuantity, key);
				break;
			case "aircraft":
				this.CurAircraft--;
				drop(this.AQuantity, key);
				break;
			case "infantry":
				this.CurInfantry--;
				drop(this.IQuantity, key);
				break;
			case "unit":
				this.CurUnits--;
				drop(this.UQuantity, key);
				break;
			default:
				break;
		}
	}

	Read_INI(ini: INIClass, max_iq: number, scenario: number): void {
		const hname = this.Class.Name();
		this.Control.TechLevel = ini.get_int(hname, "TechLevel", scenario);
		this.Control.InitialCredits = ini.get_int(hname, "Credits", 0) * 100;
		this.Credits = this.Control.InitialCredits;
		const actslike = ini.get_string(hname, "ActsLike");
		if (actslike.length > 0) {
			this.ActLike = Acts_Like_From(hname, actslike, this.ActLike);
		}
		let iq = ini.get_int(hname, "IQ", 0);
		if (iq > max_iq) {
			iq = 1;
		}
		this.IQ = this.Control.IQ = iq;
		this.Control.Edge = Get_SourceType(ini, hname, "Edge", SOURCE_NORTH);
		this.IsPlayerControl = ini.get_bool(hname, "PlayerControl", false);
		const owners = Get_Owners(ini, hname, "Allies", this.Allies);
		this.Make_Ally(Houses[this.HeapID] ?? null);
		const color = ini.get_string(hname, "Color", "");
		if (color.length > 0) {
			this.Scheme = color.toUpperCase();
		}
		for (const hptr of Houses) {
			if ((owners & (1 << hptr.Class.House)) !== 0) {
				this.Make_Ally(hptr);
			}
		}
	}

	AI(): void {
		if (this.RecalcPower) {
			this.RecalcPower = false;
		}
		this.Power = Math.max(this.Power, 0);
		this.Drain = Math.max(this.Drain, 0);
	}

	static Read_All(ini: INIClass, max_iq: number, scenario: number): void {
		const count = ini.entry_count("Houses");
		for (let index = HOUSE_FIRST; index < count; index++) {
			Get_HousesType(ini, "Houses", ini.get_entry("Houses", index), HOUSE_NONE);
			if (index < HouseTypes.length) {
				new HouseClass(HouseTypes[index]!);
			}
		}
		ScenarioInit++;
		for (const house of Houses) {
			house.Read_INI(ini, max_iq, scenario);
		}
		ScenarioInit--;
	}
}

export function Init_HouseTypes(): void {
	HouseTypes.length = 0;
}

export function Init_Houses(): void {
	Houses.length = 0;
	PlayerPtr = null;
}

export function Do_HouseTypes(ini: INIClass): void {
	const count = ini.entry_count("Houses");
	for (let i = 0; i < count; i++) {
		const name = ini.get_string("Houses", ini.get_entry("Houses", i), "");
		if (name.length > 0) {
			HouseTypeClass.Find_Or_Make(name);
		}
	}
}

export function Read_HouseType_INI(ini: INIClass): void {
	for (const type of HouseTypes) {
		type.Read_INI(ini);
	}
}

export function Assign_Campaign_Player(ini: INIClass): HouseClass | null {
	let house = Get_HousesType(ini, "Basic", "Player", HOUSE_NONE);
	if (house === HOUSE_NONE) {
		house = HOUSE_FIRST;
	}
	PlayerPtr = House_From_HousesType(house);
	if (PlayerPtr) {
		PlayerPtr.IsHuman = true;
		PlayerPtr.IsPlayerControl = true;
	}
	return PlayerPtr;
}

export function House_From_HousesType(house: number): HouseClass | null {
	for (const housep of Houses) {
		if (housep.Class.House === house) {
			return housep;
		}
	}
	return null;
}

export function House_From_Name(name: string): HouseClass | null {
	const spawn = Spawn_House_Waypoint(name);
	if (spawn !== -1) {
		return House_At(spawn);
	}
	return House_From_HousesType(HouseTypeClass.From_Name(name));
}

export function House_At(spawn_waypoint: number): HouseClass | null {
	if (spawn_waypoint < 0) {
		return null;
	}
	for (const housep of Houses) {
		if (housep.SpawnWaypoint === spawn_waypoint && !housep.IsObserver && !housep.Class.IsMultiplayPassive) {
			return housep;
		}
	}
	return null;
}

export function Spawn_House_Waypoint(name: string): number {
	for (let i = 0; i < SpawnNames.length; i++) {
		if (eqi(name, SpawnNames[i]!) || eqi(name, PlayerAtNames[i]!)) {
			return i;
		}
	}
	return -1;
}

export function Source_From_Name(name: string): number {
	for (let i = 0; i < SourceName.length; i++) {
		if (eqi(SourceName[i]!, name)) {
			return i;
		}
	}
	return SOURCE_NONE;
}

function Get_SourceType(ini: INIClass, section: string, entry: string, defvalue: number): number {
	const buffer = ini.get_string(section, entry, "");
	if (buffer.length > 0) {
		return Source_From_Name(buffer);
	}
	return defvalue;
}

function Owner_From_Name(text: string): number {
	const h = HouseTypeClass.From_Name(text);
	if (h !== HOUSE_NONE) {
		return 1 << h;
	}
	return 0;
}

function Get_Owners(ini: INIClass, section: string, entry: string, defvalue: number): number {
	const value = ini.get_string(section, entry, "");
	if (value.length === 0) {
		return defvalue;
	}
	let ownable = 0;
	for (const name of value.split(",")) {
		ownable |= Owner_From_Name(name.trim());
	}
	return ownable;
}

export function Get_HousesType(ini: INIClass, section: string, entry: string, defvalue: number): number {
	const buffer = ini.get_string(section, entry, "");
	if (buffer.length === 0) {
		return defvalue;
	}
	if (Spawn_House_Waypoint(buffer) !== -1) {
		return defvalue;
	}
	const house = HouseTypeClass.From_Name(buffer);
	if (house === HOUSE_NONE) {
		return HouseTypeClass.Find_Or_Make(buffer).House;
	}
	return house;
}

function Acts_Like_From(_section: string, value: string, defvalue: number): number {
	if (eqi(value, "<none>")) {
		return HOUSE_NONE;
	}
	let house = HouseTypeClass.From_Name(value);
	if (house === HOUSE_NONE && (is_digit(value.charAt(0)) || value.charAt(0) === "-")) {
		house = Number.parseInt(value, 10);
	}
	if (house < HOUSE_FIRST || house >= HouseTypes.length) {
		return defvalue;
	}
	return house;
}

export function Acts_Like_Name(house: HouseClass): string {
	if (house.ActLike < HOUSE_FIRST || house.ActLike >= HouseTypes.length) {
		return house.Class.Name().toUpperCase();
	}
	return HouseTypes[house.ActLike]!.Name().toUpperCase();
}

function bump(table: Map<string, number>, key: string): void {
	table.set(key, (table.get(key) ?? 0) + 1);
}

function drop(table: Map<string, number>, key: string): void {
	const have = table.get(key) ?? 0;
	if (have <= 1) {
		table.delete(key);
	} else {
		table.set(key, have - 1);
	}
}

function eqi(a: string, b: string): boolean {
	return a.toUpperCase() === b.toUpperCase();
}

function is_digit(ch: string): boolean {
	return ch >= "0" && ch <= "9";
}
