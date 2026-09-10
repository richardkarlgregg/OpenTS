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

import { cc_retrieve } from "./ccfile";
import type { GameDirectory } from "./files";
import type { Point2D } from "./ini";
import { blit_shape, read_palette, read_shp, type ShapeSet } from "./shp";
import type { DSurface } from "./surface";

export const MOUSE_NORMAL = 0;
export const MOUSE_N = 1;
export const MOUSE_NO_N = 9;
export const MOUSE_CAN_SELECT = 17;
export const MOUSE_COUNT = 67;

const MOUSE_HOTSPOT_MIN = 0;
const MOUSE_HOTSPOT_CENTER = 12345;
const MOUSE_HOTSPOT_MAX = 54321;
const HSMIN = MOUSE_HOTSPOT_MIN;
const HSMAX = MOUSE_HOTSPOT_MAX;
const HSCNR = MOUSE_HOTSPOT_CENTER;

type MouseStruct = {
	StartFrame: number;
	FrameCount: number;
	FrameRate: number;
	SmallFrame: number;
	X: number;
	Y: number;
};

const MouseControl: MouseStruct[] = [
	{ StartFrame: 0, FrameCount: 1, FrameRate: 0, SmallFrame: 1, X: HSMIN, Y: HSMIN },
	{ StartFrame: 2, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSMIN },
	{ StartFrame: 3, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMAX, Y: HSMIN },
	{ StartFrame: 4, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMAX, Y: HSCNR },
	{ StartFrame: 5, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMAX, Y: HSMAX },
	{ StartFrame: 6, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSMAX },
	{ StartFrame: 7, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMIN, Y: HSMAX },
	{ StartFrame: 8, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMIN, Y: HSCNR },
	{ StartFrame: 9, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMIN, Y: HSMIN },
	{ StartFrame: 10, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSMIN },
	{ StartFrame: 11, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMAX, Y: HSMIN },
	{ StartFrame: 12, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMAX, Y: HSCNR },
	{ StartFrame: 13, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMAX, Y: HSMAX },
	{ StartFrame: 14, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSMAX },
	{ StartFrame: 15, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMIN, Y: HSMAX },
	{ StartFrame: 16, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMIN, Y: HSCNR },
	{ StartFrame: 17, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSMIN, Y: HSMIN },
	{ StartFrame: 18, FrameCount: 13, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 31, FrameCount: 10, FrameRate: 4, SmallFrame: 42, X: HSCNR, Y: HSCNR },
	{ StartFrame: 41, FrameCount: 1, FrameRate: 0, SmallFrame: 52, X: HSCNR, Y: HSCNR },
	{ StartFrame: 53, FrameCount: 5, FrameRate: 4, SmallFrame: 63, X: HSCNR, Y: HSCNR },
	{ StartFrame: 58, FrameCount: 5, FrameRate: 4, SmallFrame: 63, X: HSCNR, Y: HSCNR },
	{ StartFrame: 68, FrameCount: 5, FrameRate: 4, SmallFrame: 73, X: HSCNR, Y: HSCNR },
	{ StartFrame: 78, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 88, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 89, FrameCount: 10, FrameRate: 4, SmallFrame: 100, X: HSCNR, Y: HSCNR },
	{ StartFrame: 99, FrameCount: 1, FrameRate: 0, SmallFrame: 63, X: HSCNR, Y: HSCNR },
	{ StartFrame: 110, FrameCount: 9, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 119, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 120, FrameCount: 9, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 129, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 139, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 149, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 150, FrameCount: 20, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 170, FrameCount: 20, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 190, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 191, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 201, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 211, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 212, FrameCount: 7, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 219, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 229, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 239, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 249, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 259, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 269, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 356, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 279, FrameCount: 20, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 299, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 309, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 319, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 329, FrameCount: 16, FrameRate: 2, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 345, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 346, FrameCount: 10, FrameRate: 4, SmallFrame: 42, X: HSCNR, Y: HSCNR },
	{ StartFrame: 357, FrameCount: 20, FrameRate: 3, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 377, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 378, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 379, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 380, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 381, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 382, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 383, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 384, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 385, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 386, FrameCount: 1, FrameRate: 0, SmallFrame: -1, X: HSCNR, Y: HSCNR },
	{ StartFrame: 387, FrameCount: 10, FrameRate: 4, SmallFrame: -1, X: HSCNR, Y: HSCNR },
];

export class MouseClass {
	MouseShapes: ShapeSet | null = null;
	Palette: Uint16Array | null = null;
	IsSmall = false;
	CurrentMouseShape = MOUSE_NORMAL;
	NormalMouseShape = MOUSE_NORMAL;
	Timer = 0;
	Frame = 0;
	Point: Point2D = { x: 0, y: 0 };
	private startup = false;

	async One_Time(directory: GameDirectory): Promise<void> {
		const packed = await cc_retrieve(directory, "MOUSE.SHP");
		this.MouseShapes = packed ? read_shp(packed) : null;
		const pal = await cc_retrieve(directory, "MOUSEPAL.PAL");
		this.Palette = pal ? read_palette(pal) : null;
	}

	Get_Mouse_Current_Frame(mouse: number, wsmall: boolean): number {
		const control = MouseControl[mouse];
		if (!control) {
			return 0;
		}
		if (wsmall && control.SmallFrame !== -1) {
			return control.SmallFrame + this.Frame;
		}
		return control.StartFrame + this.Frame;
	}

	Get_Mouse_Hotspot(mouse: number): Point2D {
		const hotspot = { x: 0, y: 0 };
		if (!this.MouseShapes) {
			return hotspot;
		}
		const control = MouseControl[mouse];
		if (!control) {
			return hotspot;
		}
		if (control.X === MOUSE_HOTSPOT_CENTER) {
			hotspot.x = this.MouseShapes.width >> 1;
		}
		if (control.X === MOUSE_HOTSPOT_MAX) {
			hotspot.x = this.MouseShapes.width;
		}
		if (control.Y === MOUSE_HOTSPOT_CENTER) {
			hotspot.y = this.MouseShapes.height >> 1;
		}
		if (control.Y === MOUSE_HOTSPOT_MAX) {
			hotspot.y = this.MouseShapes.height;
		}
		return hotspot;
	}

	Override_Mouse_Shape(mouse: number, wsmall: boolean): boolean {
		if (mouse < 0 || mouse >= MOUSE_COUNT) {
			return false;
		}
		const control = MouseControl[mouse]!;
		if (control.SmallFrame === -1) {
			wsmall = false;
		}
		if (!this.startup || (this.MouseShapes && (mouse !== this.CurrentMouseShape || wsmall !== this.IsSmall))) {
			this.startup = true;
			this.Timer = control.FrameRate;
			this.Frame = 0;
			this.CurrentMouseShape = mouse;
			this.IsSmall = wsmall;
			return true;
		}
		return false;
	}

	Set_Default_Mouse(mouse: number, size: boolean): void {
		this.NormalMouseShape = mouse;
		this.Override_Mouse_Shape(mouse, size);
	}

	AI(): void {
		const control = MouseControl[this.CurrentMouseShape];
		if (!control) {
			return;
		}
		if (control.FrameRate && this.Timer === 0) {
			this.Frame++;
			this.Frame %= control.FrameCount;
			this.Timer = control.FrameRate;
		}
	}

	System_Tick(): void {
		if (this.Timer > 0) {
			this.Timer--;
		}
		this.AI();
	}

	Draw_Mouse(dest: DSurface, fallback: Uint16Array): void {
		if (!this.MouseShapes) {
			return;
		}
		const hotspot = this.Get_Mouse_Hotspot(this.CurrentMouseShape);
		const frame = this.Get_Mouse_Current_Frame(this.CurrentMouseShape, this.IsSmall);
		blit_shape(dest, this.Palette ?? fallback, this.MouseShapes, frame, this.Point.x - hotspot.x, this.Point.y - hotspot.y, false);
	}
}
