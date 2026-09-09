/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import type { GameDirectory } from "./files";
import { mix_available, mix_retrieve } from "./mixfile";

export function cc_available(directory: GameDirectory, filename: string): boolean {
	return directory.get(filename) !== undefined || mix_available(filename);
}

export async function cc_retrieve(directory: GameDirectory, filename: string): Promise<Uint8Array | null> {
	return (await directory.read(filename)) ?? (await mix_retrieve(filename));
}

export function pcx_filename(name: string): string {
	const dot = name.indexOf(".");
	const stem = dot >= 0 ? name.slice(0, dot) : name;
	return `${stem}.PCX`;
}
