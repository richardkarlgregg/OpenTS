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

import {
	HouseClass,
	House_From_HousesType,
	House_From_Name,
	Houses,
	HOUSE_FIRST,
	HOUSE_NONE,
	PlayerPtr,
} from "./house";
import type { INIClass, Point2D } from "./ini";
import { Fetch_String, TXT_DIFFICULTY_LEVEL, TXT_EASY, TXT_HARD, TXT_MEDIUM } from "./language";
import { Movie_Filename, VQ_NONE } from "./movies";
import { Options } from "./options";
import { Create_Team, Queue_Reinforcements, type PendingTeam } from "./team";
import type { ShroudMap } from "./shroud";
import { TICKS_PER_MINUTE, TICKS_PER_SECOND } from "./stimer";
import { Sound_Effect } from "./voc";
import { Speak, VOX_ACCOMPLISHED, VOX_FAIL } from "./vox";

export const TEVENT_NONE = 0;
export const TEVENT_PLAYER_ENTERED = 1;
export const TEVENT_DESTROYED = 7;
export const TEVENT_ANY = 8;
export const TEVENT_BUILDINGS_DESTROYED = 10;
export const TEVENT_ALL_DESTROYED = 11;
export const TEVENT_TIME = 13;
export const TEVENT_BUILD = 19;
export const TEVENT_BUILD_UNIT = 20;
export const TEVENT_BUILD_INFANTRY = 21;
export const TEVENT_BUILD_AIRCRAFT = 22;
export const TEVENT_LOCAL_SET = 36;
export const TEVENT_LOCAL_CLEAR = 37;
export const TEVENT_DESTROYED_ANY = 48;
export const TEVENT_RANDOM_TIME = 51;
export const TEVENT_ENEMY_IN_SPOTLIGHT = 35;
export const TEVENT_ENEMY_IN_SPOTLIGHT_REPEATING = 54;

export const TACTION_NONE = 0;
export const TACTION_WIN = 1;
export const TACTION_LOSE = 2;
export const TACTION_CREATE_TEAM = 4;
export const TACTION_ALL_HUNT = 6;
export const TACTION_REINFORCEMENTS = 7;
export const TACTION_PLAY_MOVIE = 10;
export const TACTION_TEXT_TRIGGER = 11;
export const TACTION_DESTROY_TRIGGER = 12;
export const TACTION_REVEAL_SOME = 17;
export const TACTION_PLAY_SOUND = 19;
export const TACTION_PLAY_SPEECH = 21;
export const TACTION_FORCE_TRIGGER = 22;
export const TACTION_DESTROY_OBJECT = 32;
export const TACTION_PLAY_ANIM = 41;
export const TACTION_LOCK_INPUT = 46;
export const TACTION_UNLOCK_INPUT = 47;
export const TACTION_CENTER_VIEWPOINT = 48;
export const TACTION_CHANGE_SPOTLIGHT_BEHAVIOR = 52;
export const TACTION_RADAR_EVENT = 55;
export const TACTION_SET_LOCAL = 56;
export const TACTION_CLEAR_LOCAL = 57;
export const TACTION_METEOR_SHOWER = 58;
export const TACTION_DAMAGE = 63;
export const TACTION_LIGHT_SMALL = 64;
export const TACTION_LIGHT_MEDIUM = 65;
export const TACTION_LIGHT_LARGE = 66;
export const TACTION_REINFORCEMENTS_SPECIAL = 80;
export const TACTION_PARTICLE_ANIM = 88;
export const TACTION_PLAY_INGAME_MOVIE = 100;

export const VOLATILE = 0;
export const SEMIPERSISTENT = 1;
export const PERSISTENT = 2;

const ATTACH_NONE = 0;
const ATTACH_CELL = 0x01;
const ATTACH_OBJECT = 0x02;
const ATTACH_HOUSE = 0x08;
const ATTACH_GENERAL = 0x10;

const DIFF_EASY = 0;
const DIFF_NORMAL = 1;
const DIFF_HARD = 2;
const DIFF_COUNT = 3;
const MAX_MESSAGES = 6;
export const MESSAGE_LINE = 14;
const SCEN_LOCAL_COUNT = 50;
const PARAM_CODE_OTHER = 0;
const PARAM_CODE_TEAM = 1;
const PARAM_CODE_TRIGGER = 2;
const PARAM_CODE_TEAM_AND_TIME = 4;

export type TriggerSprite = {
	tag: TagClass | null;
	house: number;
	x: number;
	y: number;
	rtti: string;
	bridge: boolean;
};

export type GameMessage = {
	text: string;
	timer: number;
};

export type TriggerWorld = {
	waypoints: Map<number, Point2D>;
	cell_tags: Map<string, TagClass>;
	messages: GameMessage[];
	center_on: Point2D | null;
	center_speed: number;
	input_locked: boolean;
	ended: "" | "win" | "lose";
	reveal_radius: number;
	is_global_changed: boolean;
	sprites: TriggerSprite[];
	pending_teams: PendingTeam[];
	pending_movie: string[];
	pending_ingame: string[];
};

export const TriggerTypes: TriggerTypeClass[] = [];
export const TagTypes: TagTypeClass[] = [];
export const Triggers: TriggerClass[] = [];
export const Tags: TagClass[] = [];
export const LogicTags: TagClass[] = [];

const LocalFlags: { name: string; value: boolean }[] = [];
const TutorialLines = new Map<number, string>();
let Difficulty = DIFF_NORMAL;

export class TEventClass {
	Event = TEVENT_NONE;
	Data = 0;
	Next: TEventClass | null = null;

	Is_Time_Based(): boolean {
		switch (this.Event) {
			case TEVENT_PLAYER_ENTERED:
			case TEVENT_DESTROYED:
			case TEVENT_DESTROYED_ANY:
			case TEVENT_BUILD:
			case TEVENT_BUILD_UNIT:
			case TEVENT_BUILD_INFANTRY:
			case TEVENT_BUILD_AIRCRAFT:
			case TEVENT_ENEMY_IN_SPOTLIGHT:
			case TEVENT_ENEMY_IN_SPOTLIGHT_REPEATING:
				return true;
			default:
				return false;
		}
	}

	Is_To_Flag_As_Tripped(): boolean {
		return this.Event !== TEVENT_PLAYER_ENTERED && this.Event !== TEVENT_ENEMY_IN_SPOTLIGHT_REPEATING;
	}

	operator(event: number, house: HouseClass | null, object: TriggerSprite | null, timer: number, tripped: { value: boolean }): boolean {
		switch (this.Event) {
			case TEVENT_LOCAL_SET:
				return fetch_local(this.Data);
			case TEVENT_LOCAL_CLEAR:
				return !fetch_local(this.Data);
			case TEVENT_TIME:
			case TEVENT_RANDOM_TIME:
				return timer === 0;
			default:
				break;
		}
		if (this.Event === TEVENT_NONE) {
			return false;
		}
		if (
			this.Event !== TEVENT_PLAYER_ENTERED &&
			this.Event !== TEVENT_BUILD &&
			this.Event !== TEVENT_BUILD_UNIT &&
			this.Event !== TEVENT_BUILD_INFANTRY &&
			this.Event !== TEVENT_BUILD_AIRCRAFT &&
			this.Is_Time_Based()
		) {
			if (event !== this.Event) {
				return false;
			}
		}
		if (this.Event === TEVENT_PLAYER_ENTERED) {
			if (event !== this.Event || !object) {
				return false;
			}
			if (this.Data !== HOUSE_NONE) {
				const owner = House_From_HousesType(this.Data);
				if (!owner || object.house !== owner.HeapID) {
					return false;
				}
			}
			tripped.value = true;
			return true;
		}
		if (house) {
			switch (this.Event) {
				case TEVENT_BUILD:
					if (house.JustBuiltStructure !== this.Data) {
						return false;
					}
					tripped.value = true;
					break;
				case TEVENT_BUILD_UNIT:
					if (house.JustBuiltUnit !== this.Data) {
						return false;
					}
					tripped.value = true;
					break;
				case TEVENT_BUILD_INFANTRY:
					if (house.JustBuiltInfantry !== this.Data) {
						return false;
					}
					tripped.value = true;
					break;
				case TEVENT_BUILD_AIRCRAFT:
					if (house.JustBuiltAircraft !== this.Data) {
						return false;
					}
					tripped.value = true;
					break;
				default:
					break;
			}
		}
		const target = House_From_HousesType(this.Data);
		if (target) {
			switch (this.Event) {
				case TEVENT_BUILDINGS_DESTROYED:
					if (target.CurBuildings > 0) {
						return false;
					}
					break;
				case TEVENT_ALL_DESTROYED:
					if (target.CurBuildings > 0 || target.CurUnits > 0 || target.CurInfantry > 0) {
						return false;
					}
					break;
				default:
					break;
			}
		}
		return true;
	}

	Attaches_To(): number {
		let attach = ATTACH_NONE;
		switch (this.Event) {
			case TEVENT_PLAYER_ENTERED:
				attach |= ATTACH_CELL;
				attach |= ATTACH_OBJECT;
				break;
			case TEVENT_DESTROYED:
			case TEVENT_DESTROYED_ANY:
				attach |= ATTACH_OBJECT;
				break;
			case TEVENT_ENEMY_IN_SPOTLIGHT:
			case TEVENT_ENEMY_IN_SPOTLIGHT_REPEATING:
				attach |= ATTACH_OBJECT;
				break;
			case TEVENT_BUILD:
			case TEVENT_BUILD_UNIT:
			case TEVENT_BUILD_INFANTRY:
			case TEVENT_BUILD_AIRCRAFT:
			case TEVENT_BUILDINGS_DESTROYED:
			case TEVENT_ALL_DESTROYED:
				attach |= ATTACH_HOUSE;
				break;
			case TEVENT_TIME:
			case TEVENT_RANDOM_TIME:
			case TEVENT_LOCAL_SET:
			case TEVENT_LOCAL_CLEAR:
			case TEVENT_ANY:
				attach |= ATTACH_GENERAL;
				break;
			default:
				break;
		}
		return attach;
	}
}

export class TActionClass {
	Action = TACTION_NONE;
	Data = 0;
	Team = "";
	TriggerName = "";
	Waypoint = -1;
	Next: TActionClass | null = null;

	operator(
		world: TriggerWorld,
		shroud: ShroudMap | null,
		_house: HouseClass | null,
		_object: TriggerSprite | null,
		trigger: TriggerClass | null = null,
	): boolean {
		switch (this.Action) {
			case TACTION_WIN:
				flag_end(world, house_matches_player(this.Data) ? "win" : "lose");
				return true;
			case TACTION_LOSE:
				flag_end(world, house_matches_player(this.Data) ? "lose" : "win");
				return true;
			case TACTION_TEXT_TRIGGER: {
				const text = TutorialLines.get(this.Data) ?? "";
				if (text) {
					Add_Message(world, text, Math.max(1, Math.trunc(0.6 * TICKS_PER_MINUTE)));
				}
				return true;
			}
			case TACTION_SET_LOCAL:
				set_local(this.Data, true);
				world.is_global_changed = true;
				return true;
			case TACTION_CLEAR_LOCAL:
				set_local(this.Data, false);
				world.is_global_changed = true;
				return true;
			case TACTION_REVEAL_SOME: {
				const cell = world.waypoints.get(this.Data);
				if (cell && shroud) {
					shroud.Sight_From(cell.x, cell.y, Math.max(1, world.reveal_radius));
				}
				return true;
			}
			case TACTION_CENTER_VIEWPOINT: {
				const cell = world.waypoints.get(this.Waypoint);
				if (cell) {
					world.center_on = { x: cell.x, y: cell.y };
					world.center_speed = this.Data;
				}
				return true;
			}
			case TACTION_LOCK_INPUT:
				world.input_locked = true;
				return true;
			case TACTION_UNLOCK_INPUT:
				world.input_locked = false;
				return true;
			case TACTION_FORCE_TRIGGER: {
				const type = TriggerTypeClass.From_Name(this.TriggerName);
				if (!type) {
					return true;
				}
				for (const trigger of Triggers.slice()) {
					if (trigger.Class === type) {
						trigger.Spring(world, shroud, null, "");
					}
				}
				return true;
			}
			case TACTION_DESTROY_TRIGGER: {
				const type = TriggerTypeClass.From_Name(this.TriggerName);
				if (!type) {
					return true;
				}
				for (const trigger of Triggers) {
					if (trigger.Class === type) {
						trigger.Mark_To_Delete();
					}
				}
				return true;
			}
			case TACTION_CREATE_TEAM:
				Create_Team(this.Team);
				return true;
			case TACTION_REINFORCEMENTS:
				Queue_Reinforcements(world.pending_teams, this.Team, -1, false);
				return true;
			case TACTION_REINFORCEMENTS_SPECIAL:
				Queue_Reinforcements(world.pending_teams, this.Team, this.Waypoint, true);
				return true;
			case TACTION_ALL_HUNT: {
				const target = House_From_HousesType(this.Data);
				if (target) {
					target.IsAllToHunt = true;
				}
				return true;
			}
			case TACTION_PLAY_MOVIE: {
				if (this.Data !== VQ_NONE) {
					const name = Movie_Filename(this.Data);
					if (name) {
						world.pending_movie.push(name);
					}
				}
				return true;
			}
			case TACTION_PLAY_INGAME_MOVIE: {
				if (this.Data !== VQ_NONE) {
					const name = Movie_Filename(this.Data);
					if (name) {
						world.pending_ingame.push(name);
					}
				}
				return true;
			}
			case TACTION_PLAY_SPEECH:
				Speak(this.Data);
				return true;
			case TACTION_PLAY_SOUND:
				Sound_Effect(this.Data);
				return true;
			case TACTION_PLAY_ANIM:
			case TACTION_LIGHT_SMALL:
			case TACTION_LIGHT_MEDIUM:
			case TACTION_LIGHT_LARGE:
			case TACTION_RADAR_EVENT:
			case TACTION_PARTICLE_ANIM:
			case TACTION_METEOR_SHOWER:
			case TACTION_DAMAGE:
			case TACTION_DESTROY_OBJECT:
				return true;
			case TACTION_CHANGE_SPOTLIGHT_BEHAVIOR: {
				if (!trigger) {
					return true;
				}
				for (const sprite of world.sprites) {
					const light = (
						sprite as {
							strength?: number;
							building_light?: { Set_Behavior_Type(artwork: unknown, type: number): void } | null;
						}
					).building_light;
					const strength = (sprite as { strength?: number }).strength ?? 0;
					if (sprite.rtti !== "building" || strength <= 0 || !sprite.tag || !light) {
						continue;
					}
					if (!sprite.tag.Is_Trigger_Attached(trigger)) {
						continue;
					}
					light.Set_Behavior_Type(world, this.Data);
				}
				return true;
			}
			default:
				return true;
		}
	}

	Attaches_To(): number {
		switch (this.Action) {
			case TACTION_DESTROY_OBJECT:
				return ATTACH_OBJECT;
			default:
				return ATTACH_NONE;
		}
	}
}

export class TriggerTypeClass {
	IniName: string;
	GivenName = "";
	House: HouseClass | null = null;
	LinkedTo: TriggerTypeClass | null = null;
	FirstEvent: TEventClass | null = null;
	FirstAction: TActionClass | null = null;
	IsEnabled = true;
	IsEnabledOnEasy = true;
	IsEnabledOnMedium = true;
	IsEnabledOnHard = true;

	constructor(name: string) {
		this.IniName = name;
		TriggerTypes.push(this);
	}

	static From_Name(name: string | null | undefined): TriggerTypeClass | null {
		if (!name || eqi(name, "<none>")) {
			return null;
		}
		for (const type of TriggerTypes) {
			if (eqi(type.IniName, name)) {
				return type;
			}
		}
		return null;
	}

	static Find_Or_Make(name: string): TriggerTypeClass {
		return TriggerTypeClass.From_Name(name) ?? new TriggerTypeClass(name);
	}

	Is_Enabled_At(difficulty: number): boolean {
		switch (difficulty) {
			case DIFF_EASY:
				return this.IsEnabledOnEasy;
			case DIFF_NORMAL:
				return this.IsEnabledOnMedium;
			case DIFF_HARD:
				return this.IsEnabledOnHard;
			default:
				return true;
		}
	}

	Is_Linked_To_Local(local: number): boolean {
		let event = this.FirstEvent;
		while (event) {
			if ((event.Event === TEVENT_LOCAL_SET || event.Event === TEVENT_LOCAL_CLEAR) && event.Data === local) {
				return true;
			}
			event = event.Next;
		}
		return false;
	}

	Attaches_To(): number {
		let attach = ATTACH_NONE;
		let event = this.FirstEvent;
		while (event) {
			attach |= event.Attaches_To();
			event = event.Next;
		}
		let action = this.FirstAction;
		while (action) {
			attach |= action.Attaches_To();
			action = action.Next;
		}
		if (this.LinkedTo) {
			attach |= this.LinkedTo.Attaches_To();
		}
		return attach;
	}

	Read_INI(ini: INIClass): boolean {
		const line = ini.get_string("Triggers", this.IniName, "");
		if (!line) {
			return false;
		}
		const tokens = split_csv(line);
		this.House = eqi(tokens[0] ?? "", "<none>") ? House_From_HousesType(HOUSE_FIRST) : House_From_Name(tokens[0] ?? "");
		if (!this.House) {
			return false;
		}
		this.LinkedTo = TriggerTypeClass.From_Name(tokens[1] ?? "");
		this.GivenName = tokens[2] ?? "";
		this.IsEnabled = atoi(tokens[3]) === 0;
		this.IsEnabledOnEasy = atoi(tokens[4]) !== 0;
		this.IsEnabledOnMedium = atoi(tokens[5]) !== 0;
		this.IsEnabledOnHard = atoi(tokens[6]) !== 0;
		const events = split_csv(ini.get_string("Events", this.IniName, ""));
		if (events.length > 0) {
			let count = atoi(events[0]);
			let i = 1;
			while (count > 0 && i + 2 < events.length) {
				const tevent = new TEventClass();
				tevent.Event = atoi(events[i]!);
				const code = atoi(events[i + 1]);
				const text = events[i + 2] ?? "0";
				tevent.Data = code === 0 ? atoi(text) : 0;
				tevent.Next = this.FirstEvent;
				this.FirstEvent = tevent;
				i += 3;
				count--;
			}
		}
		const actions = split_csv(ini.get_string("Actions", this.IniName, ""));
		if (actions.length > 0) {
			let count = atoi(actions[0]);
			let i = 1;
			let last: TActionClass | null = null;
			while (count > 0 && i < actions.length) {
				const taction = new TActionClass();
				taction.Action = atoi(actions[i]!);
				const code = atoi(actions[i + 1]);
				const text = actions[i + 2] ?? "0";
				const val = atoi(text);
				if (code === PARAM_CODE_TEAM || code === PARAM_CODE_TEAM_AND_TIME) {
					taction.Team = text;
				} else if (code === PARAM_CODE_TRIGGER) {
					taction.TriggerName = text;
				} else if (code === PARAM_CODE_OTHER) {
					taction.Data = val;
				}
				taction.Waypoint = Waypoint_From_Name(actions[i + 7] ?? "");
				if (code === PARAM_CODE_TEAM_AND_TIME) {
					taction.Data = atoi(actions[i + 7]);
				}
				if (!this.FirstAction) {
					this.FirstAction = taction;
					last = taction;
				} else if (last) {
					last.Next = taction;
					last = taction;
				}
				i += 8;
				count--;
			}
		}
		return true;
	}

	static Read_All(ini: INIClass): void {
		const len = ini.entry_count("Triggers");
		for (let i = 0; i < len; i++) {
			TriggerTypeClass.Find_Or_Make(ini.get_entry("Triggers", i));
		}
		for (let i = 0; i < len; i++) {
			const name = ini.get_entry("Triggers", i);
			const trigger = TriggerTypeClass.From_Name(name);
			if (trigger && !trigger.Read_INI(ini)) {
				const at = TriggerTypes.indexOf(trigger);
				if (at >= 0) {
					TriggerTypes.splice(at, 1);
				}
			}
		}
	}
}

export class TriggerClass {
	Class: TriggerTypeClass;
	LinkedTo: TriggerClass | null = null;
	IsTripped = 0;
	IsToDelete = false;
	IsEnabled = true;
	Timer = 0;

	constructor(type: TriggerTypeClass) {
		this.Class = type;
		Triggers.push(this);
		this.Reset_All_Timed_Events();
		if (!type.IsEnabled || !type.Is_Enabled_At(Difficulty)) {
			this.IsEnabled = false;
		}
	}

	Mark_To_Delete(): void {
		this.IsToDelete = true;
	}

	Is_Marked_To_Delete(): boolean {
		return this.IsToDelete;
	}

	Flag_Event_Tripped(index: number): void {
		this.IsTripped |= 1 << index;
	}

	Flag_Event_Untripped(index: number): void {
		this.IsTripped &= ~(1 << index);
	}

	Is_Event_Tripped(index: number): boolean {
		return (this.IsTripped & (1 << index)) !== 0;
	}

	Reset_All_Timed_Events(): void {
		let index = 0;
		let event = this.Class.FirstEvent;
		while (event) {
			if (event.Event === TEVENT_TIME) {
				this.Timer = event.Data * TICKS_PER_SECOND;
				this.Flag_Event_Untripped(index);
			}
			if (event.Event === TEVENT_RANDOM_TIME) {
				this.Timer = (Math.trunc(event.Data / 2) + Math.trunc(Math.random() * (event.Data + 1))) * TICKS_PER_SECOND;
				this.Flag_Event_Untripped(index);
			}
			index++;
			event = event.Next;
		}
	}

	Reset_Local_Linked_Timed_Events(local: number): void {
		let trigger: TriggerClass | null = this;
		while (trigger) {
			if (trigger.Class.Is_Linked_To_Local(local)) {
				trigger.Reset_All_Timed_Events();
			}
			trigger = trigger.LinkedTo;
		}
	}

	Should_Spring(event: number, object: TriggerSprite | null, forced: boolean, persistent: boolean): boolean {
		if (!this.IsEnabled || this.Is_Marked_To_Delete()) {
			return false;
		}
		if (!this.Class.House) {
			return false;
		}
		let all_sprung = true;
		const state = { value: persistent };
		if (!forced) {
			let tevent = this.Class.FirstEvent;
			let index = 0;
			while (tevent) {
				if (this.Is_Event_Tripped(index) || tevent.operator(event, this.Class.House, object, this.Timer, state)) {
					if (state.value && tevent.Is_Time_Based() && tevent.Is_To_Flag_As_Tripped()) {
						this.Flag_Event_Tripped(index);
					}
				} else {
					all_sprung = false;
				}
				index++;
				tevent = tevent.Next;
			}
		}
		if (all_sprung && state.value) {
			this.Reset_All_Timed_Events();
		}
		return all_sprung;
	}

	Spring(world: TriggerWorld, shroud: ShroudMap | null, object: TriggerSprite | null, _cell: string): boolean {
		if (!this.IsEnabled || this.Is_Marked_To_Delete()) {
			return false;
		}
		if (!this.Class.House) {
			return false;
		}
		let done = false;
		let action = this.Class.FirstAction;
		while (action) {
			if (action.operator(world, shroud, this.Class.House, object, this)) {
				done = true;
			}
			action = action.Next;
		}
		return done;
	}
}

export class TagTypeClass {
	IniName: string;
	GivenName = "";
	Persistence = VOLATILE;
	FirstTrigger: TriggerTypeClass | null = null;

	constructor(name: string) {
		this.IniName = name;
		TagTypes.push(this);
	}

	static From_Name(name: string | null | undefined): TagTypeClass | null {
		if (!name || eqi(name, "<none>") || eqi(name, "none")) {
			return null;
		}
		for (const type of TagTypes) {
			if (eqi(type.IniName, name)) {
				return type;
			}
		}
		return null;
	}

	static Find_Or_Make(name: string): TagTypeClass {
		return TagTypeClass.From_Name(name) ?? new TagTypeClass(name);
	}

	Attaches_To(): number {
		let attach = ATTACH_NONE;
		let trigger = this.FirstTrigger;
		while (trigger) {
			attach |= trigger.Attaches_To();
			trigger = trigger.LinkedTo;
		}
		return attach;
	}

	Read_INI(ini: INIClass): boolean {
		const line = ini.get_string("Tags", this.IniName, "");
		if (!line) {
			return false;
		}
		const tokens = split_csv(line);
		this.Persistence = atoi(tokens[0]);
		this.GivenName = tokens[1] ?? "";
		this.FirstTrigger = TriggerTypeClass.From_Name(tokens[2] ?? "");
		return true;
	}

	static Read_All(ini: INIClass): void {
		const len = ini.entry_count("Tags");
		for (let i = 0; i < len; i++) {
			const name = ini.get_entry("Tags", i);
			if (!ini.get_string("Tags", name, "")) {
				continue;
			}
			TagTypeClass.Find_Or_Make(name).Read_INI(ini);
		}
	}
}

export class TagClass {
	Class: TagTypeClass;
	Trigger: TriggerClass | null = null;
	AttachCount = 0;
	CellID = "";
	IsToDie = false;
	IsCurrentlySprung = false;

	constructor(type: TagTypeClass) {
		this.Class = type;
		Tags.push(this);
		let tt = type.FirstTrigger;
		while (tt) {
			const trigger = new TriggerClass(tt);
			trigger.LinkedTo = this.Trigger;
			this.Trigger = trigger;
			tt = tt.LinkedTo;
		}
	}

	Is_Trigger_Attached(trigger: TriggerClass): boolean {
		let trigptr = this.Trigger;
		while (trigptr) {
			if (trigptr === trigger) {
				return true;
			}
			trigptr = trigptr.LinkedTo;
		}
		return false;
	}

	Spring(
		world: TriggerWorld,
		shroud: ShroudMap | null,
		event = TEVENT_ANY,
		object: TriggerSprite | null = null,
		cell = "",
		forced = false,
	): boolean {
		if (this.IsCurrentlySprung) {
			return false;
		}
		let res = false;
		let die = false;
		let det = false;
		this.IsCurrentlySprung = true;
		let trigger = this.Trigger;
		while (trigger) {
			if (trigger.Should_Spring(event, object, forced, this.Class.Persistence === PERSISTENT)) {
				switch (this.Class.Persistence) {
					case VOLATILE:
						trigger.Spring(world, shroud, object, cell);
						trigger.Mark_To_Delete();
						res = true;
						die = true;
						det = true;
						break;
					case SEMIPERSISTENT:
						if (this.AttachCount === 1) {
							trigger.Spring(world, shroud, object, cell);
							trigger.Mark_To_Delete();
							die = true;
							res = true;
						} else {
							det = true;
						}
						break;
					case PERSISTENT:
						trigger.Spring(world, shroud, object, cell);
						res = true;
						break;
					default:
						break;
				}
			}
			trigger = trigger.LinkedTo;
		}
		this.IsCurrentlySprung = false;
		if (det) {
			if (object && object.tag === this) {
				Attach_Tag(object, null);
			}
			if (cell) {
				world.cell_tags.delete(cell);
			}
		}
		if (die) {
			this.Destroy(world);
		}
		return res;
	}

	Destroy(world: TriggerWorld): void {
		this.IsToDie = true;
		for (const [key, tag] of world.cell_tags) {
			if (tag === this) {
				world.cell_tags.delete(key);
			}
		}
		for (const sprite of world.sprites) {
			if (sprite.tag === this) {
				sprite.tag = null;
			}
		}
		drop(LogicTags, this);
		for (const house of Houses) {
			drop(house.HouseTags, this);
		}
		drop(Tags, this);
		let trigger = this.Trigger;
		while (trigger) {
			drop(Triggers, trigger);
			trigger = trigger.LinkedTo;
		}
	}
}

export function Find_Or_Make_Tag(type: TagTypeClass | null): TagClass | null {
	if (!type) {
		return null;
	}
	for (const tag of Tags) {
		if (tag.Class === type) {
			return tag;
		}
	}
	return new TagClass(type);
}

export function Attach_Tag(object: TriggerSprite, tag: TagClass | null): void {
	if (object.tag) {
		object.tag.AttachCount--;
		object.tag = null;
	}
	if (tag) {
		object.tag = tag;
		tag.AttachCount++;
	}
}

export function Init_Triggers(): void {
	TriggerTypes.length = 0;
	TagTypes.length = 0;
	Triggers.length = 0;
	Tags.length = 0;
	LogicTags.length = 0;
	LocalFlags.length = 0;
	TutorialLines.clear();
	Difficulty = Math.max(DIFF_EASY, Math.min(DIFF_HARD, Options.Difficulty));
	for (let i = 0; i < SCEN_LOCAL_COUNT; i++) {
		LocalFlags.push({ name: "", value: false });
	}
}

export function Read_Tutorial(base: INIClass | null, scenario: INIClass): void {
	read_tutorial_section(base);
	read_tutorial_section(scenario);
}

export function Read_Locals(ini: INIClass): void {
	const count = ini.entry_count("VariableNames");
	for (let i = 0; i < count; i++) {
		const entry = ini.get_entry("VariableNames", i);
		const index = atoi(entry);
		if (index < 0 || index >= LocalFlags.length) {
			continue;
		}
		const tokens = split_csv(ini.get_string("VariableNames", entry, ""));
		const slot = LocalFlags[index]!;
		slot.name = tokens[0] ?? "";
		slot.value = atoi(tokens[1]) !== 0;
	}
}

export function Read_Waypoints(ini: INIClass): Map<number, Point2D> {
	const waypoints = new Map<number, Point2D>();
	const count = ini.entry_count("Waypoints");
	for (let i = 0; i < count; i++) {
		const entry = ini.get_entry("Waypoints", i);
		const id = atoi(entry);
		const value = ini.get_int("Waypoints", entry, 0);
		waypoints.set(id, { x: value % 1000, y: Math.floor(value / 1000) });
	}
	return waypoints;
}

export function Read_CellTags(ini: INIClass, world: TriggerWorld): void {
	const count = ini.entry_count("CellTags");
	for (let i = 0; i < count; i++) {
		const entry = ini.get_entry("CellTags", i);
		const name = ini.get_string("CellTags", entry, "");
		if (!name) {
			continue;
		}
		const type = TagTypeClass.Find_Or_Make(name);
		const tag = Find_Or_Make_Tag(type);
		if (!tag || !tag.Trigger) {
			continue;
		}
		const val = atoi(entry);
		const cell = { x: val % 1000, y: Math.floor(val / 1000) };
		const key = `${cell.x},${cell.y}`;
		if (world.cell_tags.has(key)) {
			continue;
		}
		tag.CellID = key;
		tag.AttachCount++;
		world.cell_tags.set(key, tag);
	}
}

export function Distribute_Tags(): void {
	for (const type of TagTypes) {
		const attach = type.Attaches_To();
		if ((attach & ATTACH_GENERAL) !== 0) {
			const tag = Find_Or_Make_Tag(type);
			if (tag && !LogicTags.includes(tag)) {
				LogicTags.push(tag);
			}
		}
		if ((attach & ATTACH_HOUSE) !== 0) {
			const tag = Find_Or_Make_Tag(type);
			const owner = tag?.Class.FirstTrigger?.House;
			if (tag && owner && !owner.HouseTags.includes(tag)) {
				owner.HouseTags.push(tag);
			}
		}
	}
}

export function Attach_Named_Tag(object: TriggerSprite, name: string | undefined): void {
	if (!name) {
		return;
	}
	const tag = Find_Or_Make_Tag(TagTypeClass.From_Name(name));
	if (tag && tag.Trigger) {
		Attach_Tag(object, tag);
	}
}

export function Logic_AI(world: TriggerWorld, shroud: ShroudMap | null): void {
	for (const line of world.messages) {
		if (line.timer > 0) {
			line.timer--;
		}
	}
	world.messages = world.messages.filter((line) => line.timer > 0);
	for (const trigger of Triggers) {
		if (trigger.Timer > 0) {
			trigger.Timer--;
		}
	}
	for (let i = 0; i < LogicTags.length; i++) {
		const tag = LogicTags[i]!;
		if (world.is_global_changed) {
			if (tag.Spring(world, shroud, TEVENT_LOCAL_SET)) {
				continue;
			}
			if (tag.Spring(world, shroud, TEVENT_LOCAL_CLEAR)) {
				continue;
			}
		}
		if (tag.Spring(world, shroud, TEVENT_TIME)) {
			continue;
		}
		tag.Spring(world, shroud, TEVENT_RANDOM_TIME);
	}
	world.is_global_changed = false;
}

export function Spring_House_Tags(world: TriggerWorld, shroud: ShroudMap | null, house: HouseClass): void {
	for (let i = 0; i < house.HouseTags.length; i++) {
		if (house.HouseTags[i]!.Spring(world, shroud) && i > 0) {
			i--;
		}
	}
}

export function Spring_Cell_Enter(
	world: TriggerWorld,
	shroud: ShroudMap | null,
	object: TriggerSprite,
	cell: Point2D,
	under_bridge: boolean,
): void {
	if (under_bridge && !object.bridge) {
		return;
	}
	const tag = world.cell_tags.get(`${cell.x},${cell.y}`);
	tag?.Spring(world, shroud, TEVENT_PLAYER_ENTERED, object, `${cell.x},${cell.y}`);
}

export function Spring_Destroyed(world: TriggerWorld, shroud: ShroudMap | null, object: TriggerSprite, source: TriggerSprite | null): void {
	if (source) {
		object.tag?.Spring(world, shroud, TEVENT_DESTROYED, object);
	}
	object.tag?.Spring(world, shroud, TEVENT_DESTROYED_ANY, object);
}

export function Waypoint_From_Name(name: string): number {
	const text = name.trim();
	if (!text || !is_alpha(text[0]!)) {
		return -1;
	}
	const letters = 26;
	let wp = text.charCodeAt(0) & ~32;
	wp -= 65;
	if (text.length > 1 && is_alpha(text[1]!)) {
		wp = (text.charCodeAt(1) & ~32) + wp * letters - (65 - letters);
	}
	return wp;
}

export function Set_Local(index: number, value: boolean): void {
	set_local(index, value);
}

function set_local(index: number, value: boolean): void {
	const slot = LocalFlags[index];
	if (!slot || slot.value === value) {
		return;
	}
	slot.value = value;
	for (const tag of Tags) {
		tag.Trigger?.Reset_Local_Linked_Timed_Events(index);
	}
}

function fetch_local(index: number): boolean {
	return LocalFlags[index]?.value ?? false;
}

function flag_end(world: TriggerWorld, ended: "win" | "lose"): void {
	world.ended = ended;
	Speak(ended === "win" ? VOX_ACCOMPLISHED : VOX_FAIL);
	Add_Message(world, ended === "win" ? "Mission accomplished" : "Mission failed", TICKS_PER_MINUTE);
}

export function Add_Message(world: TriggerWorld, text: string, timer: number): void {
	if (!text) {
		return;
	}
	world.messages.push({ text, timer });
	if (world.messages.length > MAX_MESSAGES) {
		world.messages.shift();
	}
}

export function Difficulty_Start_Text(): string {
	const computer = DIFF_COUNT - 1 - Math.max(DIFF_EASY, Math.min(DIFF_HARD, Options.Difficulty));
	const names = [TXT_HARD, TXT_MEDIUM, TXT_EASY];
	const named = Fetch_String(names[computer] ?? TXT_MEDIUM);
	return Fetch_String(TXT_DIFFICULTY_LEVEL).replace("%s", named);
}

function house_matches_player(selector: number): boolean {
	if (!PlayerPtr) {
		return false;
	}
	return PlayerPtr.Class.House === selector;
}

function read_tutorial_section(ini: INIClass | null): void {
	if (!ini) {
		return;
	}
	const count = ini.entry_count("Tutorial");
	for (let i = 0; i < count; i++) {
		const entry = ini.get_entry("Tutorial", i);
		if (!/^\d+$/.test(entry.trim())) {
			continue;
		}
		TutorialLines.set(atoi(entry), ini.get_string("Tutorial", entry, ""));
	}
}

function split_csv(line: string): string[] {
	return line.split(",").map((part) => part.trim());
}

function atoi(text: string | undefined): number {
	const value = Number.parseInt(text ?? "", 10);
	return Number.isFinite(value) ? value : 0;
}

function drop<T>(list: T[], item: T): void {
	const index = list.indexOf(item);
	if (index >= 0) {
		list.splice(index, 1);
	}
}

function eqi(a: string, b: string): boolean {
	return a.toUpperCase() === b.toUpperCase();
}

function is_alpha(ch: string): boolean {
	const code = ch.charCodeAt(0) & ~32;
	return code >= 65 && code <= 90;
}
