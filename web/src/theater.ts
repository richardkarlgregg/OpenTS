/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

export type TheaterSeed = {
	name: string;
	root: string;
	iso_root: string;
	suffix: string;
	mm_suffix: string;
};

const SEEDS: TheaterSeed[] = [
	{ name: "TEMPERATE", root: "TEMPERAT", iso_root: "ISOTEMP", suffix: "TEM", mm_suffix: "MMT" },
	{ name: "SNOW", root: "SNOW", iso_root: "ISOSNOW", suffix: "SNO", mm_suffix: "MMS" },
];

export function theater_from_name(name: string): TheaterSeed {
	const upper = name.toUpperCase();
	return SEEDS.find((seed) => seed.name === upper) ?? {
		name: upper,
		root: upper,
		iso_root: upper,
		suffix: upper.slice(0, 3),
		mm_suffix: "",
	};
}
