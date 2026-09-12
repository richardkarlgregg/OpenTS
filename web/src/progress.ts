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
	Fetch_String,
	TXT_LOADING_GAME1A,
	TXT_LOADING_GAME1B,
	TXT_LOADING_GAME1C,
	TXT_LOADING_GAME1D,
	TXT_LOADING_GAME1E,
	TXT_LOADING_GAME1F,
	TXT_LOADING_GAME1G,
	TXT_LOADING_GAME1H,
} from "./language";
import type { Point2D } from "./ini";
import type { CanvasLabel } from "./present";

const PROGRESS_MESSAGES = [
	{ Progress: 0, Text: TXT_LOADING_GAME1A },
	{ Progress: 12, Text: TXT_LOADING_GAME1B },
	{ Progress: 20, Text: TXT_LOADING_GAME1C },
	{ Progress: 30, Text: TXT_LOADING_GAME1D },
	{ Progress: 50, Text: TXT_LOADING_GAME1E },
	{ Progress: 70, Text: TXT_LOADING_GAME1F },
	{ Progress: 80, Text: TXT_LOADING_GAME1G },
	{ Progress: 100, Text: TXT_LOADING_GAME1H },
];

export class ProgressScreenClass {
	MainProgress = 0;
	PlayerProgress = 0;
	IsActive = false;
	Pos: Point2D = { x: 0, y: 0 };
	Percentage = -1;
	lines: string[] = [];

	Initialize(progress: number): void {
		this.MainProgress = progress;
		this.PlayerProgress = 0;
		this.IsActive = true;
		this.Percentage = -1;
		this.lines = [];
	}

	End(): void {
		this.IsActive = false;
		this.MainProgress = 0;
	}

	Set_Graphic_Data(pos: Point2D): void {
		this.Pos = { ...pos };
	}

	Set_Progress_Percent(value: number): void {
		const next = (this.MainProgress / 100) * value;
		if (next === this.PlayerProgress) {
			return;
		}
		this.PlayerProgress = next;
		this.Display_Progress();
	}

	Display_Progress(): void {
		if (!this.IsActive) {
			return;
		}
		const progress = this.PlayerProgress;
		const percent = this.Percentage;
		if (progress <= percent) {
			return;
		}
		for (let j = 0; j < PROGRESS_MESSAGES.length; j++) {
			const entry = PROGRESS_MESSAGES[j]!;
			if (entry.Progress <= progress && entry.Progress > percent) {
				this.lines.push(Fetch_String(entry.Text));
				this.Percentage = entry.Progress;
				return;
			}
		}
	}

	Labels(): CanvasLabel[] {
		const width = Math.max(8, 640 - this.Pos.x - 8);
		return this.lines.map((text, j) => ({
			x: this.Pos.x,
			y: this.Pos.y + 10 * j,
			width,
			height: 10,
			text,
			align: "left" as const,
			color: "#70ff00",
		}));
	}
}

export const Progress = new ProgressScreenClass();
