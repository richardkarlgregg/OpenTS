/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2025 Electronic Arts Inc.
 * Copyright 2026 OpenTS contributors
 *
 * Contains material derived from Electronic Arts source code.
 * Modified by OpenTS contributors, 2026.
 ******************************************************************************/

import { Houses } from "./house";
import type { Point2D, Rect } from "./ini";
import type { MapArtwork, MapSprite } from "./objects";
import { Coord_In_View, Draw_SpotLight, SpotLight_One_Time, type Coord } from "./ovrlight";
import { Clip_Line_To_Rect, type DSurface } from "./surface";
import { CELL_LEPTON, Cell_Center, Coord_Cell } from "./walk";

export const LIGHT_BEHAVIOR_NONE = 0;
export const LIGHT_BEHAVIOR_SWEEP = 1;
export const LIGHT_BEHAVIOR_CIRCLE = 2;
export const LIGHT_BEHAVIOR_FOLLOW = 3;

export type SpotlightRules = {
	SpotlightMovementRadius: number;
	SpotlightLocationRadius: number;
	SpotlightSpeed: number;
	SpotlightAcceleration: number;
	SpotlightAngle: number;
	SpotlightRadius: number;
};

const DEG_TO_RAD_360 = (360 * Math.PI) / 180;
const LEVEL_LEPTON_H = Math.trunc((Math.tan(Math.PI / 2 - Math.PI / 3) * Math.sqrt(CELL_LEPTON * CELL_LEPTON * 2)) / 2);
const SWEEP_SCALE = 7.466666666666666;

export type LightDrawContext = {
	frame: DSurface;
	origin: Point2D;
	clip: Rect;
	coord_to_pixel: (coord: Coord) => Point2D;
	z_lepton_to_pixel: (z: number) => number;
	is_mapped: (x: number, y: number) => boolean;
};

function as_int16(value: number): number {
	return (value << 16) >> 16;
}

function Dir256_As_Radian(dir: number): number {
	const facing = as_int16((dir & 255) << 8);
	return (facing - 16383) * -((360 / 65534) * Math.PI) / 180;
}

function Move_Coord(start: Coord, dir: number, distance: number): Coord {
	const radians = Dir256_As_Radian(dir);
	return {
		x: (start.x + Math.cos(radians) * distance) | 0,
		y: (start.y - Math.sin(radians) * distance) | 0,
		z: start.z,
	};
}

function Rotate_Z(x: number, y: number, z: number, theta: number): Coord {
	const c = Math.cos(theta);
	const s = Math.sin(theta);
	return {
		x: (c * x + -s * y) | 0,
		y: (s * x + c * y) | 0,
		z: z | 0,
	};
}

function Distance_To(a: Coord, b: Coord): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz) | 0;
}

function Lerp_Coord(a: Coord, b: Coord, t: number): Coord {
	return {
		x: (a.x + (b.x - a.x) * t) | 0,
		y: (a.y + (b.y - a.y) * t) | 0,
		z: (a.z + (b.z - a.z) * t) | 0,
	};
}

function occupy_size(cells: { x: number; y: number }[]): { w: number; h: number } {
	let maxx = 0;
	let maxy = 0;
	for (const cell of cells) {
		if (cell.x > maxx) {
			maxx = cell.x;
		}
		if (cell.y > maxy) {
			maxy = cell.y;
		}
	}
	return { w: maxx + 1, h: maxy + 1 };
}

function level_z(artwork: MapArtwork, x: number, y: number): number {
	const height = artwork.terrain.get(`${x},${y}`)?.height ?? 0;
	return Math.trunc(LEVEL_LEPTON_H * height + 0.5);
}

function Owner_Position(artwork: MapArtwork, owner: MapSprite): Coord {
	const at = Cell_Center({ x: owner.x, y: owner.y });
	return { x: at.x, y: at.y, z: level_z(artwork, owner.x, owner.y) };
}

function Owner_Center(artwork: MapArtwork, owner: MapSprite): Coord {
	const position = Owner_Position(artwork, owner);
	const size = occupy_size(owner.occupy);
	const h = size.h * (CELL_LEPTON / 2) - CELL_LEPTON / 2;
	const w = size.w * (CELL_LEPTON / 2) - CELL_LEPTON / 2;
	return { x: position.x + w, y: position.y + h, z: position.z };
}

function Is_Powered_On(artwork: MapArtwork, sprite: MapSprite): boolean {
	if (!sprite.is_on || sprite.strength <= 0) {
		return false;
	}
	const type = artwork.production.buildings.get(sprite.type_name.toUpperCase());
	if (!type?.powered || type.drain <= 0 || !type.toggle_power) {
		return true;
	}
	const house = Houses[sprite.house];
	if (!house || house.Drain <= 0) {
		return true;
	}
	return house.Power / house.Drain >= 1;
}

function Sprite_Center(artwork: MapArtwork, sprite: MapSprite): Coord {
	if (sprite.foot) {
		return { x: sprite.foot.lx, y: sprite.foot.ly, z: level_z(artwork, sprite.x, sprite.y) };
	}
	return Owner_Center(artwork, sprite);
}

export class BuildingLightClass {
	Speed = 0;
	RotationPivot: Coord = { x: 0, y: 0, z: 0 };
	RotationTarget: Coord = { x: 0, y: 0, z: 0 };
	Acceleration = 0;
	IsOppositeDirection = false;
	Behavior = LIGHT_BEHAVIOR_NONE;
	Target: MapSprite | null = null;
	Owner: MapSprite | null;
	PositionCoord: Coord = { x: 0, y: 0, z: 0 };

	constructor(owner: MapSprite | null, artwork: MapArtwork, opposite: boolean) {
		this.Owner = owner;
		if (owner) {
			this.Init_Rotation_Arc(artwork, owner);
			this.Set_Behavior_Type(artwork, LIGHT_BEHAVIOR_SWEEP);
			this.IsOppositeDirection = opposite;
		}
	}

	Init_Rotation_Arc(artwork: MapArtwork, owner: MapSprite): void {
		const rule = artwork.spotlight;
		const start = Owner_Position(artwork, owner);
		const target = Move_Coord(start, owner.dir, rule.SpotlightLocationRadius);
		this.RotationTarget = target;
		this.RotationPivot = Move_Coord(start, owner.dir, -rule.SpotlightMovementRadius);
		this.PositionCoord = target;
	}

	Set_Behavior_Type(artwork: MapArtwork, type: number): void {
		this.Behavior = type;
		this.Speed = 0;
		if (this.Behavior !== LIGHT_BEHAVIOR_FOLLOW || !this.Owner) {
			return;
		}
		const cell = Coord_Cell(this.PositionCoord.x, this.PositionCoord.y);
		let mindist = 9999999;
		let closest: MapSprite | null = null;
		const house = Houses[this.Owner.house];
		for (let x = -1; x < 2; x++) {
			for (let y = -1; y < 2; y++) {
				const at = { x: cell.x + x, y: cell.y + y };
				for (const occupier of artwork.sprites) {
					if (occupier.rtti !== "infantry" && occupier.rtti !== "unit") {
						continue;
					}
					if (occupier.strength <= 0) {
						continue;
					}
					const here = occupier.foot ? Coord_Cell(occupier.foot.lx, occupier.foot.ly) : { x: occupier.x, y: occupier.y };
					if (here.x !== at.x || here.y !== at.y) {
						continue;
					}
					if (house?.Is_Ally_House(occupier.house)) {
						continue;
					}
					const dist = Distance_To(Sprite_Center(artwork, occupier), this.PositionCoord);
					if (dist < mindist) {
						closest = occupier;
						mindist = dist;
					}
				}
			}
		}
		this.Target = closest;
	}

	Sweep_Stage(artwork: MapArtwork): number {
		const owner = this.Owner;
		if (!owner) {
			return 0;
		}
		const dist = Distance_To(this.PositionCoord, Owner_Center(artwork, owner));
		const radius = artwork.spotlight.SpotlightLocationRadius;
		if (dist < radius) {
			return 0;
		}
		return Math.trunc((dist - radius) / Math.trunc((artwork.spotlight.SpotlightMovementRadius - radius) / 10));
	}

	AI(artwork: MapArtwork, spring: (owner: MapSprite) => void): void {
		const owner = this.Owner;
		if (!owner || owner.strength <= 0) {
			this.Delete_Me(artwork);
			return;
		}
		const rule = artwork.spotlight;
		let coord = this.PositionCoord;
		switch (this.Behavior) {
			case LIGHT_BEHAVIOR_FOLLOW:
				if (
					this.Target &&
					this.Target.strength > 0 &&
					Distance_To(Sprite_Center(artwork, this.Target), Owner_Center(artwork, owner)) < rule.SpotlightMovementRadius
				) {
					coord = Lerp_Coord(this.PositionCoord, Sprite_Center(artwork, this.Target), 0.25);
				} else {
					this.Set_Behavior_Type(artwork, LIGHT_BEHAVIOR_SWEEP);
				}
				break;
			case LIGHT_BEHAVIOR_CIRCLE: {
				const owner_coord = Owner_Position(artwork, owner);
				this.Speed += rule.SpotlightSpeed * 4;
				if (this.Speed > DEG_TO_RAD_360) {
					this.Speed -= DEG_TO_RAD_360;
				}
				const vec = Rotate_Z(
					this.RotationTarget.x - owner_coord.x,
					this.RotationTarget.y - owner_coord.y,
					this.RotationTarget.z - owner_coord.z,
					this.Speed,
				);
				coord = { x: owner_coord.x + vec.x, y: owner_coord.y + vec.y, z: owner_coord.z + vec.z };
				break;
			}
			case LIGHT_BEHAVIOR_SWEEP: {
				this.Speed += this.Acceleration;
				if (this.IsOppositeDirection) {
					if (this.Speed > rule.SpotlightAngle / 2) {
						this.Acceleration -= rule.SpotlightAcceleration;
						if (this.Acceleration < 0) {
							this.Acceleration = 0;
							this.IsOppositeDirection = false;
						}
					} else if (this.Acceleration < rule.SpotlightSpeed) {
						this.Acceleration += rule.SpotlightAcceleration;
					}
				} else {
					if (this.Speed < rule.SpotlightAngle / -2) {
						this.Acceleration += rule.SpotlightAcceleration;
						if (this.Acceleration > 0) {
							this.Acceleration = 0;
							this.IsOppositeDirection = true;
						}
					} else if (-rule.SpotlightSpeed < this.Acceleration) {
						this.Acceleration -= rule.SpotlightAcceleration;
					}
				}
				const vec = Rotate_Z(
					this.RotationTarget.x - this.RotationPivot.x,
					this.RotationTarget.y - this.RotationPivot.y,
					this.RotationTarget.z - this.RotationPivot.z,
					this.Speed,
				);
				coord = {
					x: this.RotationPivot.x + vec.x,
					y: this.RotationPivot.y + vec.y,
					z: this.RotationPivot.z + vec.z,
				};
				break;
			}
			default:
				break;
		}
		this.PositionCoord = coord;
		if (this.Behavior !== LIGHT_BEHAVIOR_SWEEP || owner.rtti !== "building" || !Is_Powered_On(artwork, owner) || !owner.tag) {
			return;
		}
		const cell = Coord_Cell(this.PositionCoord.x, this.PositionCoord.y);
		const detection = this.Detection_Radius_For(artwork) + 30;
		const house = Houses[owner.house];
		let found = false;
		for (let x = -1; x < 2 && !found; x++) {
			for (let y = -1; y < 2 && !found; y++) {
				const at = { x: cell.x + x, y: cell.y + y };
				for (const occupier of artwork.sprites) {
					if (occupier.rtti !== "infantry" && occupier.rtti !== "unit") {
						continue;
					}
					if (occupier.strength <= 0) {
						continue;
					}
					const here = occupier.foot ? Coord_Cell(occupier.foot.lx, occupier.foot.ly) : { x: occupier.x, y: occupier.y };
					if (here.x !== at.x || here.y !== at.y) {
						continue;
					}
					if (house?.Is_Ally_House(occupier.house)) {
						continue;
					}
					if (Distance_To(Sprite_Center(artwork, occupier), this.PositionCoord) < detection) {
						found = true;
						break;
					}
				}
			}
		}
		if (found) {
			spring(owner);
		}
	}

	private Detection_Radius_For(artwork: MapArtwork): number {
		return ((this.Sweep_Stage(artwork) * SWEEP_SCALE) | 0) + artwork.spotlight.SpotlightRadius;
	}

	Draw_It(artwork: MapArtwork, ctx: LightDrawContext): void {
		const owner = this.Owner;
		if (!this.Behavior || !owner || owner.rtti !== "building") {
			return;
		}
		if (owner.strength <= 0 || !Is_Powered_On(artwork, owner)) {
			return;
		}
		const light_cell = Coord_Cell(this.PositionCoord.x, this.PositionCoord.y);
		if (!ctx.is_mapped(owner.x, owner.y) || !ctx.is_mapped(light_cell.x, light_cell.y)) {
			return;
		}
		SpotLight_One_Time(artwork.spotlight.SpotlightRadius);
		const planar_dist = Distance_To(this.PositionCoord, Owner_Center(artwork, owner));
		const stage = this.Sweep_Stage(artwork);
		let radius = 80;
		if (planar_dist > artwork.spotlight.SpotlightLocationRadius && this.Behavior === LIGHT_BEHAVIOR_FOLLOW) {
			radius = stage + 80;
			radius &= (radius <= 0 ? 1 : 0) - 1;
			if (radius >= 89) {
				radius = 89;
			}
		}
		const blob = ctx.coord_to_pixel(this.PositionCoord);
		if (Coord_In_View(blob, ctx.clip)) {
			Draw_SpotLight(ctx.frame, blob, radius, 16, ctx.clip);
		}
		const here = this.PositionCoord;
		const there = Owner_Center(artwork, owner);
		const distance = Distance_To(here, there);
		const detection = this.Detection_Radius_For(artwork);
		if (distance < detection) {
			return;
		}
		const angle = Math.asin(detection / distance);
		const vx = here.x - there.x;
		const vy = here.y - there.y;
		const vz = here.z - there.z;
		const left = Rotate_Z(vx, vy, vz, angle);
		const right = Rotate_Z(vx, vy, vz, -angle);
		const arc1: Coord = { x: there.x + left.x, y: there.y + left.y, z: there.z + left.z };
		const arc2: Coord = { x: there.x + right.x, y: there.y + right.y, z: there.z + right.z };
		const arc1_px = ctx.coord_to_pixel(arc1);
		const arc2_px = ctx.coord_to_pixel(arc2);
		const caster_px = ctx.coord_to_pixel({ x: there.x, y: there.y, z: there.z + 430 });
		const caster_px2 = { x: caster_px.x, y: caster_px.y };
		const zstart = -ctx.z_lepton_to_pixel(there.z + 400);
		const zend = -ctx.z_lepton_to_pixel(this.PositionCoord.z + 250);
		const glow = 75 - 6 * stage;
		const a1 = { x: caster_px.x, y: caster_px.y };
		const b1 = { x: arc1_px.x, y: arc1_px.y };
		if (Clip_Line_To_Rect(a1, b1, ctx.clip)) {
			ctx.frame.Draw_Depth_Glow_Line(a1, b1, glow, zstart, zend);
		}
		const a2 = { x: caster_px2.x, y: caster_px2.y };
		const b2 = { x: arc2_px.x, y: arc2_px.y };
		if (Clip_Line_To_Rect(a2, b2, ctx.clip)) {
			ctx.frame.Draw_Depth_Glow_Line(a2, b2, glow, zstart, zend);
		}
	}

	Delete_Me(artwork: MapArtwork): void {
		const at = artwork.building_lights.indexOf(this);
		if (at >= 0) {
			artwork.building_lights.splice(at, 1);
		}
		if (this.Owner && this.Owner.building_light === this) {
			this.Owner.building_light = null;
		}
		this.Owner = null;
	}
}

export function Attach_Building_Light(artwork: MapArtwork, sprite: MapSprite): void {
	if (sprite.building_light) {
		return;
	}
	const opposite = artwork.building_lights.length % 2 !== 0;
	const light = new BuildingLightClass(sprite, artwork, opposite);
	sprite.building_light = light;
	artwork.building_lights.push(light);
}

export function Detach_Building_Light(artwork: MapArtwork, sprite: MapSprite): void {
	sprite.building_light?.Delete_Me(artwork);
}

export function BuildingLight_AI(artwork: MapArtwork, spring: (owner: MapSprite) => void): void {
	for (const light of artwork.building_lights.slice()) {
		light.AI(artwork, spring);
	}
}

export function Draw_Building_Lights(artwork: MapArtwork, ctx: LightDrawContext): void {
	for (const light of artwork.building_lights) {
		light.Draw_It(artwork, ctx);
	}
}

export function Refresh_Building_Light_Arcs(artwork: MapArtwork): void {
	for (const light of artwork.building_lights) {
		if (light.Owner) {
			light.Init_Rotation_Arc(artwork, light.Owner);
		}
	}
}
