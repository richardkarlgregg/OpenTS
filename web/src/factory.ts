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

import type { CameoKind } from "./sidebar";
import { TICKS_PER_MINUTE } from "./stimer";
import type { FootState } from "./walk";

export const STEP_COUNT = 54;

export type FactoryObject = {
	kind: CameoKind;
	id: number;
	name: string;
	cost: number;
	time: number;
};

export class FactoryClass {
	Object: FactoryObject | null = null;
	QueuedObjects: FactoryObject[] = [];
	Balance = 0;
	IsSuspended = false;
	Stage = 0;
	Rate = 0;
	Timer = 0;
	IsDifferent = false;
	IsExiting = false;
	ExitingFoot: FootState | null = null;
	max_queue = 5;

	Fetch_Stage(): number {
		return this.Stage;
	}

	Is_Building(): boolean {
		return this.Rate !== 0 && !this.IsSuspended;
	}

	Has_Completed(): boolean {
		return this.Object !== null && this.Stage === STEP_COUNT;
	}

	Completion(): number {
		return this.Stage;
	}

	Set(object: FactoryObject, resume = false): boolean {
		if (object.kind === "BuildingType") {
			this.Abandon();
		}
		if (object.kind !== "BuildingType" && (this.Is_Building() || this.QueuedObjects.length > 0 || this.IsSuspended) && !resume) {
			if (this.QueuedObjects.length < this.max_queue) {
				this.QueuedObjects.push(object);
				return true;
			}
			return false;
		}
		this.IsSuspended = true;
		this.Rate = 0;
		this.Timer = 0;
		this.Stage = 0;
		this.Object = object;
		this.Balance = object.cost;
		this.IsDifferent = true;
		this.IsExiting = false;
		this.ExitingFoot = null;
		return true;
	}

	Start(): boolean {
		if (!this.Object || !this.IsSuspended || this.Has_Completed()) {
			return false;
		}
		this.IsSuspended = false;
		this.Set_Rate(this.Build_Rate());
		return true;
	}

	Suspend(): boolean {
		if (this.IsSuspended) {
			return false;
		}
		this.IsSuspended = true;
		this.Set_Rate(0);
		return true;
	}

	Abandon(): number {
		if (!this.Object) {
			return 0;
		}
		const refund = this.Object.cost - this.Balance;
		this.Balance = 0;
		this.Set_Rate(0);
		this.Stage = 0;
		this.IsSuspended = true;
		this.Object = null;
		this.IsDifferent = true;
		this.ExitingFoot = null;
		return refund;
	}

	Completed(): boolean {
		if (!this.Has_Completed()) {
			return false;
		}
		this.Object = null;
		this.IsSuspended = true;
		this.Stage = 0;
		this.Set_Rate(0);
		this.IsDifferent = true;
		this.IsExiting = false;
		return true;
	}

	Has_Changed(): boolean {
		const changed = this.IsDifferent;
		this.IsDifferent = false;
		return changed;
	}

	Has_Production_Target(): boolean {
		return this.Object !== null || this.QueuedObjects.length > 0;
	}

	Is_Currently_Producing(name: string): boolean {
		return this.Object !== null && this.Object.name.toUpperCase() === name.toUpperCase();
	}

	Is_Queued(name: string): boolean {
		const key = name.toUpperCase();
		return this.QueuedObjects.some((item) => item.name.toUpperCase() === key);
	}

	Remove_From_Queue(name: string): boolean {
		const key = name.toUpperCase();
		const index = this.QueuedObjects.findIndex((item) => item.name.toUpperCase() === key);
		if (index < 0) {
			return false;
		}
		this.QueuedObjects.splice(index, 1);
		return true;
	}

	Total(name: string): number {
		const key = name.toUpperCase();
		let total = this.Object && this.Object.name.toUpperCase() === key ? 1 : 0;
		for (const item of this.QueuedObjects) {
			if (item.name.toUpperCase() === key) {
				total += 1;
			}
		}
		return total;
	}

	Take_Queue(): FactoryObject | null {
		return this.QueuedObjects.shift() ?? null;
	}

	Cost_Per_Tick(): number {
		if (!this.Object) {
			return 0;
		}
		const steps = STEP_COUNT - this.Stage;
		if (steps) {
			return (this.Balance / steps) | 0;
		}
		return this.Balance;
	}

	AI(available: number, spend: (cost: number) => void): void {
		if (this.IsSuspended || !this.Object) {
			return;
		}
		if (this.Timer > 0) {
			this.Timer -= 1;
		}
		if (this.Has_Completed() || !this.Graphic_Logic()) {
			return;
		}
		let cost = this.Cost_Per_Tick();
		if (cost > this.Balance) {
			cost = this.Balance;
		}
		if (cost > available) {
			this.Stage -= 1;
			return;
		}
		spend(cost);
		this.Balance -= cost;
		if (this.Stage === STEP_COUNT) {
			this.IsSuspended = true;
			this.Set_Rate(0);
			this.IsDifferent = true;
			if (this.Balance > 0) {
				spend(this.Balance);
				this.Balance = 0;
			}
		}
	}

	private Build_Rate(): number {
		if (!this.Object) {
			return 1;
		}
		let time = (this.Object.time / STEP_COUNT) | 0;
		if (time < 1) {
			time = 1;
		}
		if (time > 255) {
			time = 255;
		}
		return time;
	}

	private Set_Rate(rate: number): void {
		this.Timer = rate;
		this.Rate = rate;
	}

	private Graphic_Logic(): boolean {
		if (this.Timer !== 0 || this.Rate === 0) {
			return false;
		}
		this.Stage += 1;
		this.Timer = this.Rate;
		return true;
	}
}

export function Time_To_Build(cost: number, build_speed: number, power_output: number, power_drain: number): number {
	let val = (cost * build_speed * (TICKS_PER_MINUTE / 1000)) | 0;
	let power = power_drain > 0 ? power_output / power_drain : 1;
	if (power > 1) {
		power = 1;
	}
	if (power < 1 && power > 0.75) {
		power = 0.75;
	}
	if (power < 0.5) {
		power = 0.5;
	}
	return (val / power) | 0;
}
