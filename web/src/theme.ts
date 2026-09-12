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

import { Aud_Decode } from "./aud";
import {
	AUDIO_GROUP_MUSIC,
	Ensure_Audio,
	Handle_Finished,
	Play_Pcm,
	Set_Group_Gain,
	Stop_Group,
	Stop_Handle,
	type AudioPlayHandle,
} from "./audio";
import { cc_available, cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import { INIClass } from "./ini";
import { mix_named } from "./mixfile";

export const THEME_QUIET = -3;
export const THEME_PICK_ANOTHER = -2;
export const THEME_NONE = -1;
export const THEME_FIRST = 0;

type ThemeControl = {
	Name: string;
	Fullname: string;
	Scenario: number;
	Duration: number;
	Normal: boolean;
	Repeat: boolean;
	Available: boolean;
	Owner: number;
};

export class ThemeClass {
	private current: AudioPlayHandle | null = null;
	private score = THEME_NONE;
	private pending = THEME_NONE;
	private volume = 255;
	private is_repeat = false;
	private is_shuffle = false;
	private generation = 0;
	private starting = false;
	private scores_present = false;
	private directory: GameDirectory | null = null;
	readonly Themes: ThemeControl[] = [];

	From_Name(name: string | null | undefined): number {
		if (!name) {
			return THEME_NONE;
		}
		const want = name.toLowerCase();
		for (let theme = THEME_FIRST; theme < this.Themes.length; theme++) {
			if (this.Themes[theme]!.Name.toLowerCase() === want) {
				return theme;
			}
		}
		for (let theme = THEME_FIRST; theme < this.Themes.length; theme++) {
			if (this.Themes[theme]!.Fullname.includes(name)) {
				return theme;
			}
		}
		return THEME_NONE;
	}

	Max_Themes(): number {
		return this.Themes.length;
	}

	What_Is_Playing(): number {
		return this.score;
	}

	Set_Volume(volume: number): void {
		this.volume = Math.min(255, Math.max(0, volume | 0));
		Set_Group_Gain(AUDIO_GROUP_MUSIC, this.volume / 255);
	}

	Set_Shuffle(on: boolean): void {
		this.is_shuffle = on;
	}

	Set_Repeat(on: boolean): void {
		this.is_repeat = on;
	}

	Theme_File_Name(theme: number): string {
		if (theme < 0 || theme >= this.Themes.length) {
			return "";
		}
		return `${this.Themes[theme]!.Name}.AUD`;
	}

	Init_Themes(ini: INIClass): void {
		const count = ini.entry_count("Themes");
		for (let i = 0; i < count; i++) {
			const name = ini.get_string("Themes", ini.get_entry("Themes", i), "");
			if (!name) {
				continue;
			}
			let theme = this.From_Name(name);
			let ctrl: ThemeControl;
			if (theme === THEME_NONE) {
				ctrl = {
					Name: name,
					Fullname: "",
					Scenario: 0,
					Duration: 0,
					Normal: true,
					Repeat: false,
					Available: false,
					Owner: -1,
				};
				this.Themes.push(ctrl);
			} else {
				ctrl = this.Themes[theme]!;
			}
			if (ini.is_present(ctrl.Name)) {
				ctrl.Fullname = ini.get_string(ctrl.Name, "Name", ctrl.Fullname);
				ctrl.Scenario = ini.get_int(ctrl.Name, "Scenario", ctrl.Scenario);
				ctrl.Duration = ini.get_float(ctrl.Name, "Length", ctrl.Duration);
				ctrl.Normal = ini.get_bool(ctrl.Name, "Normal", ctrl.Normal);
				ctrl.Repeat = ini.get_bool(ctrl.Name, "Repeat", ctrl.Repeat);
			}
		}
	}

	Free_Themes(): void {
		this.Stop(false);
		this.Themes.length = 0;
		this.scores_present = false;
		this.directory = null;
	}

	Scan(directory: GameDirectory): void {
		this.directory = directory;
		this.scores_present = mix_named("SCORES.MIX") || mix_named("SCORES01.MIX") || mix_named("SCORE.MIX");
		for (const ctrl of this.Themes) {
			ctrl.Available = cc_available(directory, `${ctrl.Name}.AUD`);
			if (ctrl.Available) {
				this.scores_present = true;
			}
		}
	}

	Is_Allowed(index: number): boolean {
		if (index === THEME_QUIET || index === THEME_PICK_ANOTHER) {
			return true;
		}
		if (index < 0 || index >= this.Themes.length) {
			return false;
		}
		const ctrl = this.Themes[index]!;
		return ctrl.Available && ctrl.Normal;
	}

	Next_Song(theme: number): number {
		if (theme < 0 || theme >= this.Themes.length || !this.Themes[theme]!.Available || (!this.Themes[theme]!.Repeat && !this.is_repeat)) {
			if (this.is_shuffle && this.Themes.length > 0) {
				let next = THEME_FIRST;
				for (let i = 0; i < 1000; i++) {
					next = Math.floor(Math.random() * this.Themes.length);
					if (next !== theme && this.Is_Allowed(next)) {
						return next;
					}
				}
				return THEME_FIRST;
			}
			let guard = this.Themes.length + 1;
			do {
				theme += 1;
				if (theme >= this.Themes.length) {
					theme = THEME_FIRST;
				}
				guard--;
				if (guard === 0) {
					return THEME_FIRST;
				}
			} while (!this.Is_Allowed(theme));
		}
		return theme;
	}

	Still_Playing(): boolean {
		return this.scores_present && this.volume > 0 && (this.starting || !Handle_Finished(this.current));
	}

	Queue_Song(theme: number): void {
		if (!this.scores_present || this.volume === 0) {
			return;
		}
		if (this.pending === THEME_NONE || this.pending === THEME_PICK_ANOTHER || theme === THEME_NONE || theme === THEME_QUIET) {
			this.pending = theme;
			if (this.Still_Playing()) {
				Stop_Handle(this.current);
				this.current = null;
			} else {
				this.AI();
			}
		}
	}

	Play_Song(theme: number): void {
		if (!this.scores_present) {
			return;
		}
		this.Stop(false);
		if (theme === THEME_NONE || theme === THEME_QUIET) {
			return;
		}
		if (theme > THEME_NONE && this.volume > 0) {
			void this.start_song(theme);
			if (this.is_repeat || this.Themes[theme]?.Repeat) {
				this.pending = theme;
			}
		} else {
			this.pending = theme;
		}
	}

	private async start_song(theme: number): Promise<void> {
		const token = ++this.generation;
		const name = this.Theme_File_Name(theme);
		if (!name || !this.directory) {
			return;
		}
		this.starting = true;
		await Ensure_Audio();
		const packed = await cc_retrieve(this.directory, name);
		if (token !== this.generation) {
			this.starting = false;
			return;
		}
		const pcm = packed ? Aud_Decode(packed) : null;
		if (!pcm) {
			this.starting = false;
			this.score = THEME_NONE;
			this.pending = THEME_NONE;
			return;
		}
		this.current = Play_Pcm(pcm.samples, pcm.rate, pcm.channels, AUDIO_GROUP_MUSIC, 1, 0, false, () => {
			this.AI();
		});
		this.starting = false;
		if (!this.current) {
			this.score = THEME_NONE;
			this.pending = THEME_NONE;
			return;
		}
		this.score = theme;
	}

	Stop(fade = false): void {
		this.generation++;
		this.starting = false;
		if (this.current) {
			Stop_Handle(this.current);
			this.current = null;
		}
		if (!fade) {
			Stop_Group(AUDIO_GROUP_MUSIC);
		}
		this.score = THEME_NONE;
		this.pending = THEME_NONE;
	}

	AI(): void {
		if (!this.scores_present || this.volume <= 0 || this.Still_Playing()) {
			return;
		}
		if (this.pending === THEME_NONE || this.pending === THEME_QUIET) {
			return;
		}
		if (this.pending === THEME_PICK_ANOTHER) {
			this.pending = this.Next_Song(this.score);
		}
		this.Play_Song(this.pending);
		this.pending = THEME_PICK_ANOTHER;
	}
}

export const Theme = new ThemeClass();
