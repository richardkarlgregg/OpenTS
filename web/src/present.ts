/*******************************************************************************
 *                                O P E N T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

import { DSurface, unpack_hicolor } from "./surface";

export type CanvasLabel = {
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
	enabled?: boolean;
	selected?: boolean;
	align?: "center" | "left" | "right";
	color?: string;
	font?: string;
};

let last_surface: DSurface | null = null;

export function last_presented(): DSurface | null {
	return last_surface;
}

export function present(canvas: HTMLCanvasElement, surface: DSurface, labels?: CanvasLabel[]): void {
	last_surface = surface;
	if (canvas.width !== surface.width || canvas.height !== surface.height) {
		canvas.width = surface.width;
		canvas.height = surface.height;
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Canvas 2D is not available.");
	}
	const image = ctx.createImageData(surface.width, surface.height);
	const dest = image.data;
	const src = surface.pixels;
	for (let i = 0, o = 0; i < src.length; i++, o += 4) {
		const [r, g, b] = unpack_hicolor(src[i]!);
		dest[o] = r;
		dest[o + 1] = g;
		dest[o + 2] = b;
		dest[o + 3] = 255;
	}
	ctx.putImageData(image, 0, 0);
	if (!labels || labels.length === 0) {
		return;
	}
	for (const label of labels) {
		if (label.enabled === false) {
			ctx.fillStyle = "#7a7a7a";
		} else if (label.color) {
			ctx.fillStyle = label.color;
		} else if (label.selected) {
			ctx.fillStyle = "#ffe082";
		} else {
			ctx.fillStyle = "#f0c040";
		}
		if (label.font) {
			ctx.font = label.font;
		} else if (label.align === "left" || label.align === "right") {
			ctx.font = '8px "Small Fonts", Tahoma, "MS Sans Serif", sans-serif';
		} else {
			ctx.font = '12px "MS Sans Serif", "Segoe UI", sans-serif';
		}
		if (label.align === "left") {
			ctx.textAlign = "left";
			ctx.textBaseline = label.font ? "middle" : "top";
			const y = label.font ? label.y + label.height / 2 : label.y;
			ctx.fillText(label.text, label.x + 2, y, label.width - 4);
		} else if (label.align === "right") {
			ctx.textAlign = "right";
			ctx.textBaseline = "middle";
			ctx.fillText(label.text, label.x + label.width, label.y + label.height / 2, label.width);
		} else {
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(label.text, label.x + label.width / 2, label.y + label.height / 2, label.width - 8);
		}
	}
}

export function canvas_mouse(canvas: HTMLCanvasElement, event: MouseEvent): { x: number; y: number } {
	const rect = canvas.getBoundingClientRect();
	return {
		x: Math.floor((event.clientX - rect.left) * (canvas.width / rect.width)),
		y: Math.floor((event.clientY - rect.top) * (canvas.height / rect.height)),
	};
}
