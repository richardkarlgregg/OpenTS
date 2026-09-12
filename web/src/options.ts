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

export const MAX_SPEED_SETTING = 7;

export class OptionsClass {
	GameSpeed = 3;
	ScrollRate = 3;
	AutoScroll = true;
	SidebarSorting = true;
	Difficulty = 1;
	StretchMovies = false;
	SoundVolume = 0.7;
	ScoreVolume = 0.5;
	VoiceVolume = 1;

	Normalize_Delay(delay: number): number {
		const adjust = [
			[2, 2, 1, 1, 1, 1, 1, 1],
			[3, 3, 3, 2, 2, 2, 1, 1],
			[5, 4, 4, 3, 3, 2, 2, 1],
			[7, 6, 5, 4, 4, 4, 3, 2],
		];
		if (delay) {
			if (delay < 5) {
				delay = adjust[delay - 1]![this.GameSpeed]!;
			} else {
				delay = (delay * (MAX_SPEED_SETTING + 1)) / (this.GameSpeed + 1);
			}
		}
		return delay | 0;
	}
}

export const Options = new OptionsClass();
