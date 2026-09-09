/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

export const GAME_NORMAL = 0;
export const GAME_MODEM = 1;
export const GAME_NULL_MODEM = 2;
export const GAME_IPX = 3;
export const GAME_INTERNET = 4;
export const GAME_SKIRMISH = 5;
export const GAME_WDT = 6;

export let SessionType = GAME_NORMAL;

export function set_session_type(type: number): void {
	SessionType = type;
}
