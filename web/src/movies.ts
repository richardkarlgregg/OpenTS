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

import { AUDIO_GROUP_MUSIC, AUDIO_GROUP_SFX, AUDIO_GROUP_SPEECH, Set_Group_Gain } from "./audio";
import { cc_available, cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import { INIClass } from "./ini";
import { mix_named, mix_retrieve } from "./mixfile";
import { Options } from "./options";
import { GAME_NORMAL, PlayMovies, SessionType } from "./session";
import { RAD_OFF_X, RAD_OFF_Y, RAD_Y } from "./radar";
import { TAC_W } from "./sidebar";
import type { DSurface } from "./surface";
import { THEME_NONE, Theme } from "./theme";
import { Ingame_Advance, Ingame_Blit, Ingame_Finished, Ingame_Open, Ingame_Start_Audio, Ingame_Stop, type IngameVQ, VQA_Open, VQA_Play } from "./vqa";

export const VQ_NONE = -1;

export const Movies: string[] = [];

export type IngameQueue = IngameVQ[];

export const IngameVQList: IngameQueue = [];

let ingame_ducked = false;

function Duck_Ingame_Movie(on: boolean): void {
	if (on === ingame_ducked) {
		return;
	}
	ingame_ducked = on;
	const factor = on ? 0.5 : 1;
	Set_Group_Gain(AUDIO_GROUP_SFX, Options.SoundVolume * factor);
	Set_Group_Gain(AUDIO_GROUP_SPEECH, Options.VoiceVolume * factor);
	Set_Group_Gain(AUDIO_GROUP_MUSIC, Options.ScoreVolume * factor);
}

function eqi(a: string, b: string): boolean {
	return a.toUpperCase() === b.toUpperCase();
}

export function VQ_From_Name(name: string | null | undefined): number {
	if (!name || eqi(name, "<none>")) {
		return VQ_NONE;
	}
	for (let movie = 0; movie < Movies.length; movie++) {
		if (eqi(name, Movies[movie]!)) {
			return movie;
		}
	}
	return VQ_NONE;
}

export function Do_Movies(ini: INIClass): boolean {
	if (!ini.is_present("Movies")) {
		return false;
	}
	const count = ini.entry_count("Movies");
	for (let i = 0; i < count; i++) {
		const buffer = ini.get_string("Movies", ini.get_entry("Movies", i), "<none>").slice(0, 31);
		if (buffer.length > 0 && VQ_From_Name(buffer) === VQ_NONE) {
			Movies.push(buffer);
		}
	}
	return true;
}

export function Movie_Filename(vq: number): string {
	if (vq < 0 || vq >= Movies.length) {
		return "";
	}
	return `${Movies[vq]}.VQA`;
}

export async function Register_Movies(directory: GameDirectory): Promise<void> {
	Movies.length = 0;
	for (const name of ["ART.INI", "ARTFS.INI"]) {
		const packed = await cc_retrieve(directory, name);
		if (!packed) {
			continue;
		}
		const ini = new INIClass();
		if (ini.load(packed)) {
			Do_Movies(ini);
		}
	}
}

async function movie_bytes(name: string): Promise<Uint8Array | null> {
	return mix_retrieve(name);
}

export type PlayMovieHost = {
	canvas: HTMLCanvasElement;
	cancelled?: () => boolean;
};

export async function Play_Movie(
	directory: GameDirectory,
	host: PlayMovieHost,
	name: string,
	theme = THEME_NONE,
	clrscrn_after = true,
	stretch = true,
	clrscrn_before = true,
): Promise<void> {
	if (SessionType !== GAME_NORMAL && !PlayMovies) {
		return;
	}
	if (!name || !cc_available(directory, name)) {
		return;
	}
	const bytes = await movie_bytes(name);
	if (!bytes) {
		return;
	}
	const movie = VQA_Open(bytes);
	if (!movie) {
		return;
	}
	if (movie.header.width < 320 && movie.header.height < 200) {
		return;
	}
	Theme.Stop(true);
	const dostretch = stretch && Options.StretchMovies;
	await VQA_Play(movie, {
		canvas: host.canvas,
		stretch: dostretch,
		clrscrn_after,
		clrscrn_before,
		skip: true,
		cancelled: host.cancelled,
	});
	if (theme !== THEME_NONE) {
		Theme.Queue_Song(theme);
	}
}

export async function Play_Movie_VQ(
	directory: GameDirectory,
	host: PlayMovieHost,
	vq: number,
	theme = THEME_NONE,
	clrscrn = true,
	stretch = true,
): Promise<void> {
	if (vq === VQ_NONE) {
		return;
	}
	const name = Movie_Filename(vq);
	if (!name) {
		return;
	}
	await Play_Movie(directory, host, name, theme, clrscrn, stretch, true);
}

export async function Play_Ingame_Movie_Name(directory: GameDirectory, name: string): Promise<void> {
	if (!name || !cc_available(directory, name)) {
		return;
	}
	if (SessionType !== GAME_NORMAL && !PlayMovies) {
		return;
	}
	const bytes = await movie_bytes(name);
	if (!bytes) {
		return;
	}
	const player = Ingame_Open(bytes);
	if (player) {
		if (IngameVQList.length === 0) {
			Duck_Ingame_Movie(true);
		}
		IngameVQList.push(player);
		await Ingame_Start_Audio(player);
	}
}

export async function Play_Ingame_Movie(directory: GameDirectory, vq: number): Promise<void> {
	if (vq === VQ_NONE) {
		return;
	}
	await Play_Ingame_Movie_Name(directory, Movie_Filename(vq));
}

export function Stop_Ingame_Movie(): void {
	for (const player of IngameVQList) {
		Ingame_Stop(player);
	}
	IngameVQList.length = 0;
	Duck_Ingame_Movie(false);
}

export function Advance_Ingame_Movies(): void {
	if (IngameVQList.length === 0) {
		return;
	}
	const player = IngameVQList[0]!;
	if (!Ingame_Advance(player) || Ingame_Finished(player)) {
		Ingame_Stop(player);
		IngameVQList.shift();
		if (IngameVQList.length === 0) {
			Duck_Ingame_Movie(false);
		}
	}
}

export function Blit_Ingame_Movies(dest: DSurface): void {
	const player = IngameVQList[0];
	if (!player) {
		return;
	}
	Ingame_Blit(dest, player, TAC_W + RAD_OFF_X, RAD_Y + RAD_OFF_Y);
}

export function Has_Ingame_Movies(): boolean {
	return IngameVQList.length > 0;
}

export async function Choose_Side(directory: GameDirectory, host: PlayMovieHost, side = 0): Promise<void> {
	const named = `INTR${side}.VQA`;
	if (cc_available(directory, named)) {
		await Play_Movie(directory, host, named);
		return;
	}
	await Play_Movie(directory, host, "INTRO.VQA");
}

export async function Play_Startup_Movies(directory: GameDirectory, host: PlayMovieHost): Promise<void> {
	await Play_Movie(directory, host, "WWLOGO.VQA");
	if (!mix_named("gmenu.mix") && !cc_available(directory, "GMENU.MIX")) {
		if (cc_available(directory, "FS_TITLE.VQA")) {
			await Play_Movie(directory, host, "FS_TITLE.VQA", THEME_NONE, true, false, true);
		} else {
			await Play_Movie(directory, host, "STARTUP.VQA", THEME_NONE, true, false, true);
		}
	}
}

export async function Play_Intro_Selection(directory: GameDirectory, host: PlayMovieHost): Promise<void> {
	await Choose_Side(directory, host);
	await Play_Movie(directory, host, "SIZZLE1.VQA");
}

export async function Play_Title_Movie(directory: GameDirectory, host: PlayMovieHost, firestorm: boolean): Promise<void> {
	const name = firestorm ? "FS_Title.VQA" : "TS_Title.VQA";
	if (cc_available(directory, name)) {
		await Play_Movie(directory, host, name, THEME_NONE, false, true, false);
	}
}
