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

import { HouseClass, House_From_Name } from "./house";
import type { INIClass, Point2D } from "./ini";
import { Waypoint_From_Name } from "./trigger";

export const TMISSION_NONE = -1;
export const TMISSION_ATTACK = 0;
export const TMISSION_ATT_WAYPT = 1;
export const TMISSION_BERZERK = 2;
export const TMISSION_MOVE = 3;
export const TMISSION_MOVECELL = 4;
export const TMISSION_GUARD = 5;
export const TMISSION_LOOP = 6;
export const TMISSION_WIN = 7;
export const TMISSION_UNLOAD = 8;
export const TMISSION_DEPLOY = 9;
export const TMISSION_HOUND_DOG = 10;
export const TMISSION_DO = 11;
export const TMISSION_SET_GLOBAL = 12;
export const TMISSION_IDLE_ANIM = 13;
export const TMISSION_LOAD = 14;
export const TMISSION_SPY = 15;
export const TMISSION_PATROL = 16;
export const TMISSION_SCRIPT = 17;
export const TMISSION_TEAMCHANGE = 18;
export const TMISSION_PANIC = 19;
export const TMISSION_CHANGE_HOUSE = 20;
export const TMISSION_SCATTER = 21;
export const TMISSION_GOTO_SHROUD = 22;
export const TMISSION_LOSE = 23;
export const TMISSION_PLAY_SPEECH = 24;
export const TMISSION_PLAY_SOUND = 25;
export const TMISSION_PLAY_MOVIE = 26;
export const TMISSION_PLAY_MUSIC = 27;
export const TMISSION_CENTER_VIEWPOINT = 34;
export const TMISSION_SET_LOCAL = 39;
export const TMISSION_CLEAR_LOCAL = 40;
export const TMISSION_UNPANIC = 41;
export const TMISSION_FORCE_FACING = 42;

const MAX_TEAM_CLASSCOUNT = 6;
const MAX_TEAM_MISSIONS = 50;

export type PendingTeam = {
	kind: "create" | "reinforce" | "special";
	team: string;
	waypoint: number;
};

export type TeamMissionClass = {
	Mission: number;
	Data: number;
};

export type EnlistedMemberClass = {
	Quantity: number;
	ClassName: string;
};

export const TaskForces: TaskForceClass[] = [];
export const ScriptTypes: ScriptTypeClass[] = [];
export const TeamTypes: TeamTypeClass[] = [];
export const Teams: TeamClass[] = [];

let ScenarioInit = 0;

function eqi(a: string, b: string): boolean {
	return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

function none_name(name: string): boolean {
	const text = name.trim();
	return !text || eqi(text, "<none>") || eqi(text, "none");
}

export class TaskForceClass {
	IniName: string;
	GivenName: string;
	Group = -1;
	ClassCount = 0;
	Members: EnlistedMemberClass[] = [];

	constructor(name: string) {
		this.IniName = name;
		this.GivenName = name;
		TaskForces.push(this);
	}

	static From_Name(name: string | null | undefined): TaskForceClass | null {
		if (!name || none_name(name)) {
			return null;
		}
		return TaskForces.find((force) => eqi(force.IniName, name) || eqi(force.GivenName, name)) ?? null;
	}

	static Find_Or_Make(name: string): TaskForceClass {
		return TaskForceClass.From_Name(name) ?? new TaskForceClass(name);
	}

	Required_Object_Count(): number {
		let desired = 0;
		for (let i = 0; i < this.ClassCount; i++) {
			desired += this.Members[i]?.Quantity ?? 0;
		}
		return desired;
	}

	Has_Only_Infantry(is_infantry: (name: string) => boolean): boolean {
		for (let i = 0; i < this.ClassCount; i++) {
			const name = this.Members[i]?.ClassName ?? "";
			if (!name || !is_infantry(name)) {
				return false;
			}
		}
		return this.ClassCount > 0;
	}

	Read_INI(ini: INIClass): boolean {
		this.GivenName = ini.get_string(this.IniName, "Name", this.GivenName) || this.GivenName;
		this.ClassCount = 0;
		this.Members = [];
		for (let index = 0; index < MAX_TEAM_CLASSCOUNT; index++) {
			const line = ini.get_string(this.IniName, `${index}`, "");
			if (!line) {
				continue;
			}
			const comma = line.indexOf(",");
			const quantity = Number.parseInt(comma >= 0 ? line.slice(0, comma) : line, 10) || 0;
			const class_name = (comma >= 0 ? line.slice(comma + 1) : "").trim().toUpperCase();
			if (!class_name || quantity <= 0) {
				continue;
			}
			this.Members[this.ClassCount] = { Quantity: quantity, ClassName: class_name };
			this.ClassCount++;
		}
		this.Group = ini.get_int(this.IniName, "Group", this.Group);
		return true;
	}

	static Read_All(ini: INIClass): void {
		const len = ini.entry_count("TaskForces");
		for (let index = 0; index < len; index++) {
			const name = ini.get_string("TaskForces", ini.get_entry("TaskForces", index), "");
			if (!name) {
				continue;
			}
			const force = TaskForceClass.Find_Or_Make(name);
			force.Read_INI(ini);
		}
	}
}

export class ScriptTypeClass {
	IniName: string;
	GivenName: string;
	MissionCount = 0;
	MissionList: TeamMissionClass[] = [];

	constructor(name: string) {
		this.IniName = name;
		this.GivenName = name;
		ScriptTypes.push(this);
	}

	static From_Name(name: string | null | undefined): ScriptTypeClass | null {
		if (!name || none_name(name)) {
			return null;
		}
		return ScriptTypes.find((script) => eqi(script.IniName, name) || eqi(script.GivenName, name)) ?? null;
	}

	static Find_Or_Make(name: string): ScriptTypeClass {
		return ScriptTypeClass.From_Name(name) ?? new ScriptTypeClass(name);
	}

	Read_INI(ini: INIClass): boolean {
		this.GivenName = ini.get_string(this.IniName, "Name", this.GivenName) || this.GivenName;
		this.MissionCount = 0;
		this.MissionList = [];
		for (let index = 0; index < MAX_TEAM_MISSIONS; index++) {
			const line = ini.get_string(this.IniName, `${index}`, "");
			if (!line) {
				continue;
			}
			const comma = line.indexOf(",");
			const mission = Number.parseInt(comma >= 0 ? line.slice(0, comma) : line, 10);
			const data = Number.parseInt(comma >= 0 ? line.slice(comma + 1) : "0", 10) || 0;
			if (!Number.isFinite(mission)) {
				continue;
			}
			this.MissionList[this.MissionCount] = { Mission: mission, Data: data };
			this.MissionCount++;
		}
		return true;
	}

	static Read_All(ini: INIClass): void {
		const len = ini.entry_count("ScriptTypes");
		for (let index = 0; index < len; index++) {
			const name = ini.get_string("ScriptTypes", ini.get_entry("ScriptTypes", index), "");
			if (!name) {
				continue;
			}
			const script = ScriptTypeClass.Find_Or_Make(name);
			script.Read_INI(ini);
		}
	}
}

export class ScriptClass {
	Class: ScriptTypeClass;
	CurrentLineNumber = -1;

	constructor(type: ScriptTypeClass) {
		this.Class = type;
	}

	Get_Current_Mission(): TeamMissionClass {
		if (this.CurrentLineNumber < 0) {
			return { Mission: TMISSION_NONE, Data: 0 };
		}
		return this.Class.MissionList[this.CurrentLineNumber] ?? { Mission: TMISSION_NONE, Data: 0 };
	}

	Get_Next_Mission(): TeamMissionClass {
		if (this.CurrentLineNumber + 1 >= this.Class.MissionCount) {
			return { Mission: TMISSION_NONE, Data: 0 };
		}
		return this.Class.MissionList[this.CurrentLineNumber + 1] ?? { Mission: TMISSION_NONE, Data: 0 };
	}

	Stop_Script(): boolean {
		this.CurrentLineNumber = -1;
		return true;
	}

	Set_Line(linenum: number): boolean {
		this.CurrentLineNumber = linenum;
		return true;
	}

	Next_Mission(): boolean {
		this.CurrentLineNumber++;
		return this.Has_Missions_Remaining();
	}

	Has_Missions_Remaining(): boolean {
		return this.CurrentLineNumber >= 0 && this.CurrentLineNumber < this.Class.MissionCount;
	}
}

export class TeamTypeClass {
	IniName: string;
	GivenName: string;
	House: HouseClass | null = null;
	VeteranLevel = 1;
	IsDroppod = false;
	IsRecruiter = false;
	IsAutocreate = false;
	IsReinforcable = false;
	OnTransOnly = false;
	RecruitPriority = 7;
	MaxAllowed = 0;
	Group = -1;
	Origin = -1;
	Number = 0;
	Script: ScriptTypeClass | null = null;
	TaskForce: TaskForceClass | null = null;
	TransportsReturnOnUnload = false;
	AreTeamMembersRecruitable = true;

	constructor(name: string) {
		this.IniName = name;
		this.GivenName = name;
		TeamTypes.push(this);
	}

	static From_Name(name: string | null | undefined): TeamTypeClass | null {
		if (!name || none_name(name)) {
			return null;
		}
		return TeamTypes.find((type) => eqi(type.IniName, name) || eqi(type.GivenName, name)) ?? null;
	}

	static Find_Or_Make(name: string): TeamTypeClass {
		return TeamTypeClass.From_Name(name) ?? new TeamTypeClass(name);
	}

	Get_Origin(waypoints: Map<number, Point2D>): Point2D | null {
		if (this.Origin < 0) {
			return null;
		}
		return waypoints.get(this.Origin) ?? null;
	}

	Has_Unload(): boolean {
		const script = this.Script;
		if (!script) {
			return false;
		}
		return script.MissionList.some((mission) => mission.Mission === TMISSION_UNLOAD);
	}

	Create_One_Of(house: HouseClass | null = null): TeamClass | null {
		const owner = house ?? this.House;
		if (!owner) {
			return null;
		}
		if (ScenarioInit || this.MaxAllowed < 0 || this.Number < this.MaxAllowed) {
			return new TeamClass(this, owner);
		}
		return null;
	}

	Read_INI(ini: INIClass): boolean {
		this.GivenName = ini.get_string(this.IniName, "Name", this.GivenName) || this.GivenName;
		this.House = House_From_Name(ini.get_string(this.IniName, "House", ""));
		this.VeteranLevel = ini.get_int(this.IniName, "VeteranLevel", this.VeteranLevel);
		this.IsDroppod = ini.get_bool(this.IniName, "Droppod", this.IsDroppod);
		this.IsRecruiter = ini.get_bool(this.IniName, "Recruiter", this.IsRecruiter);
		this.IsAutocreate = ini.get_bool(this.IniName, "Autocreate", this.IsAutocreate);
		this.IsReinforcable = ini.get_bool(this.IniName, "Reinforce", this.IsReinforcable);
		this.OnTransOnly = ini.get_bool(this.IniName, "OnTransOnly", this.OnTransOnly);
		this.RecruitPriority = ini.get_int(this.IniName, "Priority", this.RecruitPriority);
		this.MaxAllowed = ini.get_int(this.IniName, "Max", this.MaxAllowed);
		this.Group = ini.get_int(this.IniName, "Group", this.Group);
		this.TransportsReturnOnUnload = ini.get_bool(this.IniName, "TransportsReturnOnUnload", this.TransportsReturnOnUnload);
		this.AreTeamMembersRecruitable = ini.get_bool(this.IniName, "AreTeamMembersRecruitable", this.AreTeamMembersRecruitable);
		const waypoint = ini.get_string(this.IniName, "Waypoint", "");
		if (waypoint) {
			this.Origin = Waypoint_From_Name(waypoint);
		}
		this.Script = ScriptTypeClass.Find_Or_Make(ini.get_string(this.IniName, "Script", ""));
		this.TaskForce = TaskForceClass.Find_Or_Make(ini.get_string(this.IniName, "TaskForce", ""));
		return true;
	}

	static Read_All(ini: INIClass): void {
		const len = ini.entry_count("TeamTypes");
		for (let index = 0; index < len; index++) {
			const name = ini.get_string("TeamTypes", ini.get_entry("TeamTypes", index), "");
			if (!name) {
				continue;
			}
			const type = TeamTypeClass.Find_Or_Make(name);
			type.Read_INI(ini);
		}
	}
}

export type TeamMember = {
	rtti: string;
	type_name: string;
	house: number;
	foot: { dest: Point2D | null; moving: boolean; head: Point2D | null } | null;
	team: TeamClass | null;
	cargo: TeamMember[];
	loaner: boolean;
	hunt_mission: boolean;
	x: number;
	y: number;
	strength: number;
};

export class TeamClass {
	Class: TeamTypeClass;
	House: HouseClass;
	IsForcedActive = false;
	IsHasBeen = false;
	IsFullStrength = false;
	IsUnderStrength = true;
	IsMoving = false;
	IsNextMission = true;
	Total = 0;
	Member: TeamMember[] = [];
	Quantity: number[] = [];
	Script: ScriptClass;
	Target: Point2D | null = null;
	MissionTarget: Point2D | null = null;
	AttackTarget: TeamMember | null = null;
	TimeOut = 0;
	Unloaded = false;

	constructor(type: TeamTypeClass, house: HouseClass) {
		this.Class = type;
		this.House = house;
		this.Script = new ScriptClass(type.Script ?? new ScriptTypeClass("NONE"));
		this.Quantity = Array.from({ length: MAX_TEAM_CLASSCOUNT }, () => 0);
		Teams.push(this);
		type.Number++;
	}

	Force_Active(): void {
		this.IsForcedActive = true;
	}

	Flag_Into_Action(): void {
		this.IsMoving = true;
		this.IsHasBeen = true;
		this.IsUnderStrength = false;
		this.Script.Stop_Script();
		this.IsNextMission = true;
	}

	Add(obj: TeamMember): boolean {
		if (obj.team === this) {
			return false;
		}
		const typeindex = this.Can_Add(obj);
		if (typeindex < 0) {
			return false;
		}
		if (obj.team) {
			obj.team.Remove(obj);
		}
		this.Quantity[typeindex] = (this.Quantity[typeindex] ?? 0) + 1;
		this.Member.push(obj);
		obj.team = this;
		this.Total++;
		return true;
	}

	Can_Add(obj: TeamMember): number {
		const force = this.Class.TaskForce;
		if (!force || obj.house !== this.House.HeapID || obj.strength <= 0) {
			return -1;
		}
		const name = obj.type_name.toUpperCase();
		for (let index = 0; index < force.ClassCount; index++) {
			const slot = force.Members[index];
			if (!slot || slot.ClassName !== name) {
				continue;
			}
			if ((this.Quantity[index] ?? 0) < slot.Quantity) {
				return index;
			}
		}
		return -1;
	}

	Remove(obj: TeamMember): void {
		const index = this.Member.indexOf(obj);
		if (index < 0) {
			return;
		}
		this.Member.splice(index, 1);
		obj.team = null;
		this.Total = Math.max(0, this.Total - 1);
		const name = obj.type_name.toUpperCase();
		const force = this.Class.TaskForce;
		if (force) {
			for (let slot = 0; slot < force.ClassCount; slot++) {
				if (force.Members[slot]?.ClassName === name && (this.Quantity[slot] ?? 0) > 0) {
					this.Quantity[slot]!--;
					break;
				}
			}
		}
	}

	Has_Air_Transport(is_aircraft: (name: string) => boolean, passengers: (name: string) => number): boolean {
		const force = this.Class.TaskForce;
		if (!force) {
			return false;
		}
		for (let i = 0; i < force.ClassCount; i++) {
			const name = force.Members[i]?.ClassName ?? "";
			if (name && is_aircraft(name) && passengers(name) > 0) {
				return true;
			}
		}
		return false;
	}

	Recalc_Strength(): boolean {
		const desired = this.Class.TaskForce?.Required_Object_Count() ?? 0;
		if (this.Total > 0) {
			this.IsFullStrength = this.Total === desired;
			if (this.IsFullStrength) {
				this.IsHasBeen = true;
			}
			this.IsUnderStrength = this.Class.IsReinforcable ? this.Total < desired : !this.IsHasBeen;
			return true;
		}
		this.IsUnderStrength = true;
		this.IsFullStrength = false;
		if (this.IsHasBeen) {
			this.Disband();
			return false;
		}
		return true;
	}

	Disband(): void {
		for (const member of this.Member.slice()) {
			member.team = null;
			member.hunt_mission = false;
		}
		this.Member = [];
		this.Total = 0;
		const index = Teams.indexOf(this);
		if (index >= 0) {
			Teams.splice(index, 1);
		}
		if (this.Class.Number > 0) {
			this.Class.Number--;
		}
	}
}

export function Init_Teams(): void {
	TaskForces.length = 0;
	ScriptTypes.length = 0;
	TeamTypes.length = 0;
	Teams.length = 0;
	ScenarioInit = 0;
}

export function Create_Team(name: string): TeamClass | null {
	const type = TeamTypeClass.From_Name(name);
	if (!type) {
		return null;
	}
	ScenarioInit++;
	const team = type.Create_One_Of();
	ScenarioInit--;
	return team;
}

export function Queue_Reinforcements(pending: PendingTeam[], name: string, waypoint: number, special: boolean): void {
	if (!TeamTypeClass.From_Name(name)) {
		return;
	}
	pending.push({ kind: special ? "special" : "reinforce", team: name, waypoint });
}

export function Ensure_Default_Script(type: TeamTypeClass): void {
	const script = type.Script;
	if (!script || script.MissionCount > 0) {
		return;
	}
	script.MissionList.push({ Mission: TMISSION_ATT_WAYPT, Data: 0 });
	script.MissionCount = 1;
}
