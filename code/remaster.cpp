/*******************************************************************************
 *                                O P E N  T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

#include "always.h"

#include "remaster.h"

#include "_map.h"
#include "_rect.h"
#include "_surface.h"
#include "_tactica.h"
#include "_xmouse.h"
#include "cell.h"
#include "coord.h"
#include "convert.h"
#include "globals.h"
#include "gscreen.h"
#include "inline.h"
#include "isotype.h"
#include "lightcon.h"
#include "rgb.h"
#include "smudtype.h"
#include "smudge.hh"
#include "surface.h"
#include "tactical.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>


static bool _RemasteredGraphics = false;
static bool _RemasteredTextures = true;
static std::vector<RemasterTerrainVertex> _TerrainVerts;
static Rect _TerrainClip;
static bool _MouseLight = false;
static float _MouseSX = 0.0f;
static float _MouseSY = 0.0f;
static std::vector<unsigned int> _AtlasPixels;
static int _AtlasWidth = 0;
static int _AtlasHeight = 0;
static int _ExtraX = 0;
static int _ExtraY = 0;
static int _ExtraRowH = 0;
static unsigned int _AtlasSerial = 1;


static int const DIAMOND_W = 48;
static int const DIAMOND_H = 24;
static int const TILE_SLOT = 48;
static int const ATLAS_COLS = 32;
static int const ATLAS_MAX_SLOTS = 512;
static int const ATLAS_DIAMOND_ROWS = (ATLAS_MAX_SLOTS + ATLAS_COLS - 1) / ATLAS_COLS;
static int const ATLAS_EXTRA_H = 768;
static int const SLOPE_DIVS = 4;


struct AtlasSlot
{
	int Heap;
	int Subtile;
	int Icon;
	LightConvertClass * Drawer;
	int Index;
	int ExtraX;
	int ExtraY;
	int ExtraW;
	int ExtraH;
	int BlitDX;
	int BlitDY;
};


static std::vector<AtlasSlot> _Slots;


static void Clear_Atlas(void)
{
	_Slots.clear();
	_AtlasPixels.clear();
	_AtlasWidth = 0;
	_AtlasHeight = 0;
	_ExtraX = 0;
	_ExtraY = 0;
	_ExtraRowH = 0;
	_AtlasSerial += 1;
}


static void Seal_White_Texel(void);


// Magenta in the 565 frame is discarded so the GPU terrain shows through.
static unsigned short const REMASTER_CHROMA = 0xF81F;


bool Remastered_Graphics(void)
{
	return(_RemasteredGraphics);
}


bool Remastered_Textures(void)
{
	return(_RemasteredTextures);
}


void Toggle_Remastered_Graphics(void)
{
	_RemasteredGraphics = !_RemasteredGraphics;
	if (!_RemasteredGraphics) {
		_TerrainVerts.clear();
		_TerrainClip = Rect();
		_MouseLight = false;
		Clear_Atlas();
	}
	Map.Flag_To_Redraw(GS_REDRAW_ALL);
}


void Toggle_Remastered_Textures(void)
{
	_RemasteredTextures = !_RemasteredTextures;
	Clear_Atlas();
	if (_RemasteredGraphics) {
		Map.Flag_To_Redraw(GS_REDRAW_ALL);
	}
}


struct RemasterCorner
{
	float X;
	float Y;
	float Z;
	float SX;
	float SY;
	float NX;
	float NY;
	float NZ;
};


static void Normalize_Normal(float & nx, float & ny, float & nz, bool flip_down)
{
	float length = std::sqrt(nx * nx + ny * ny + nz * nz);
	if (length <= 0.0001f) {
		nx = 0.0f;
		ny = 0.0f;
		nz = 1.0f;
		return;
	}

	nx /= length;
	ny /= length;
	nz /= length;
	if (flip_down && nz < 0.0f) {
		nx = -nx;
		ny = -ny;
		nz = -nz;
	}
}


static void Face_Normal(RemasterCorner const & a, RemasterCorner const & b, RemasterCorner const & c, float & nx, float & ny, float & nz, bool flip_down)
{
	float ux = b.X - a.X;
	float uy = b.Y - a.Y;
	float uz = b.Z - a.Z;
	float vx = c.X - a.X;
	float vy = c.Y - a.Y;
	float vz = c.Z - a.Z;
	nx = uy * vz - uz * vy;
	ny = uz * vx - ux * vz;
	nz = ux * vy - uy * vx;
	Normalize_Normal(nx, ny, nz, flip_down);
}


static LEPTON Own_Height(CellClass const & owner, int localx, int localy)
{
	int x = localx;
	int y = localy;
	if (x < 0) {
		x = 0;
	} else if (x > CELL_LEPTON_W - 1) {
		x = CELL_LEPTON_W - 1;
	}
	if (y < 0) {
		y = 0;
	} else if (y > CELL_LEPTON_H - 1) {
		y = CELL_LEPTON_H - 1;
	}
	return(owner.Get_Height(Point2D(x, y)));
}


static void Project_World(float wx, float wy, float wz, RemasterCorner & vertex)
{
	vertex.X = wx;
	vertex.Y = wy;
	vertex.Z = wz;

	float iso_x = wx * (float)ISO_TILE_PIXEL_W * 0.5f + wy * (float)ISO_TILE_PIXEL_W * -0.5f;
	float iso_y = wx * (float)ISO_TILE_PIXEL_H * 0.5f + wy * (float)ISO_TILE_PIXEL_H * 0.5f;
	static float const z_pixels_per_lepton = (float)(std::sin(RAD_60) * (ISO_TILE_PIXEL_W / CELL_LEPTON_DIAG));
	vertex.SX = iso_x / (float)CELL_LEPTON - (float)TacticalMap->TacPixelX;
	vertex.SY = iso_y / (float)CELL_LEPTON - wz * z_pixels_per_lepton - (float)TacticalMap->TacPixelY + (float)TacticalRect.Y;
}


static void Corner_Normal(CellClass const & owner, int localx, int localy, float & nx, float & ny, float & nz)
{
	int x1 = localx;
	int y1 = localy;
	int x2 = localx + 32;
	int y2 = localy + 32;
	if (x2 > CELL_LEPTON_W - 1) {
		x2 = CELL_LEPTON_W - 1;
		x1 = x2 - 32;
		if (x1 < 0) {
			x1 = 0;
		}
	}
	if (y2 > CELL_LEPTON_H - 1) {
		y2 = CELL_LEPTON_H - 1;
		y1 = y2 - 32;
		if (y1 < 0) {
			y1 = 0;
		}
	}

	float z00 = (float)Own_Height(owner, x1, y1);
	float z10 = (float)Own_Height(owner, x2, y1);
	float z01 = (float)Own_Height(owner, x1, y2);
	float dx = (float)(x2 - x1);
	float dy = (float)(y2 - y1);
	nx = -dy * (z10 - z00);
	ny = dx * (z01 - z00);
	nz = dx * dy;
	Normalize_Normal(nx, ny, nz, true);
}


static void Apply_Mouse_Light(int & r, int & g, int & b, float sx, float sy, bool textured)
{
	if (!_MouseLight) {
		return;
	}

	float dx = _MouseSX - sx;
	float dy = _MouseSY - sy;
	float radius = textured ? 72.0f : 56.0f;
	float t = (dx * dx + dy * dy) / (radius * radius);
	if (t >= 1.0f) {
		return;
	}

	float lamp = (1.0f - t) * (1.0f - t);
	if (textured) {
		r = (int)(r * (1.0f + 0.85f * lamp) + 110.0f * lamp + 0.5f);
		g = (int)(g * (1.0f + 0.70f * lamp) + 72.0f * lamp + 0.5f);
		b = (int)(b * (1.0f + 0.35f * lamp) + 24.0f * lamp + 0.5f);
	} else {
		r = (int)(r * (1.0f + 1.35f * lamp) + 48.0f * lamp + 0.5f);
		g = (int)(g * (1.0f + 1.15f * lamp) + 28.0f * lamp + 0.5f);
		b = (int)(b * (1.0f + 0.55f * lamp) + 8.0f * lamp + 0.5f);
	}
}


static unsigned int Pack_Color(int r, int g, int b)
{
	if (r < 0) {
		r = 0;
	} else if (r > 255) {
		r = 255;
	}
	if (g < 0) {
		g = 0;
	} else if (g > 255) {
		g = 255;
	}
	if (b < 0) {
		b = 0;
	} else if (b > 255) {
		b = 255;
	}
	return(0xFF000000u | ((unsigned int)b << 16) | ((unsigned int)g << 8) | (unsigned int)r);
}


static unsigned int Pixel_565_To_BGRA(unsigned short pixel)
{
	unsigned int red = (unsigned int)(((pixel >> 11) & 0x1F) * 255 / 31);
	unsigned int green = (unsigned int)(((pixel >> 5) & 0x3F) * 255 / 63);
	unsigned int blue = (unsigned int)((pixel & 0x1F) * 255 / 31);
	return(0xFF000000u | (red << 16) | (green << 8) | blue);
}


static IsometricTileTypeClass const * Tile_Variation(IsometricTileTypeClass const * tileptr, int icon)
{
	if (tileptr == NULL || icon == 0) {
		return(tileptr);
	}

	int variation = icon;
	while (variation != 0) {
		int num = tileptr->NumTileTypesInSet;
		if (variation > num - 1) {
			variation %= num;
		}
		if (variation == 0) {
			break;
		}
		IsometricTileTypeClass const * next = tileptr;
		do {
			next = next->NextTileTypeInSet;
		} while (--variation != 0);
		if (next == tileptr) {
			break;
		}
		tileptr = next;
		variation = 0;
	}
	return(tileptr);
}


static void Unpack_Diamond(unsigned char const * image, unsigned char * dest)
{
	memset(dest, 0, DIAMOND_W * DIAMOND_H);
	for (int y = 0; y < DIAMOND_H - 1; y++) {
		int start;
		int count;
		if (y <= 11) {
			start = 22 - 2 * y;
			count = 4 + 4 * y;
		} else {
			start = 2 * (y - 11);
			count = 48 - 4 * (y - 11);
		}
		for (int x = 0; x < count; x++) {
			dest[y * DIAMOND_W + start + x] = *image++;
		}
	}
}


static unsigned char Sample_Diamond(unsigned char const * diamond, float px, float py)
{
	int x = (int)(px + 0.5f);
	int y = (int)(py + 0.5f);
	if (x < 0) {
		x = 0;
	} else if (x > DIAMOND_W - 1) {
		x = DIAMOND_W - 1;
	}
	if (y < 0) {
		y = 0;
	} else if (y > DIAMOND_H - 2) {
		y = DIAMOND_H - 2;
	}
	return(diamond[y * DIAMOND_W + x]);
}


static void Unproject_To_Diamond(float u, float v, float & px, float & py)
{
	px = 24.0f + (u - v) * 21.0f;
	py = 1.0f + (u + v) * 10.5f;
}


static bool Pack_Extra_Rect(int width, int height, int & destx, int & desty)
{
	if (width <= 0 || height <= 0) {
		return(false);
	}
	if (_ExtraX + width > _AtlasWidth) {
		_ExtraX = 0;
		_ExtraY += _ExtraRowH;
		_ExtraRowH = 0;
	}
	if (_ExtraY + height > _AtlasHeight - 2) {
		return(false);
	}
	destx = _ExtraX;
	desty = _ExtraY;
	_ExtraX += width;
	if (height > _ExtraRowH) {
		_ExtraRowH = height;
	}
	return(true);
}


static void Dilate_Opaque(int destx, int desty, int width, int height)
{
	std::vector<unsigned int> snapshot((size_t)width * (size_t)height);
	for (int pass = 0; pass < 2; pass++) {
		for (int y = 0; y < height; y++) {
			std::memcpy(&snapshot[(size_t)y * (size_t)width], &_AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)destx], (size_t)width * sizeof(unsigned int));
		}
		for (int y = 0; y < height; y++) {
			for (int x = 0; x < width; x++) {
				unsigned int & pixel = _AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)];
				if (pixel != 0) {
					continue;
				}

				unsigned int fill = 0;
				if (x > 0) {
					fill = snapshot[(size_t)y * (size_t)width + (size_t)(x - 1)];
				}
				if (fill == 0 && x + 1 < width) {
					fill = snapshot[(size_t)y * (size_t)width + (size_t)(x + 1)];
				}
				if (fill == 0 && y > 0) {
					fill = snapshot[(size_t)(y - 1) * (size_t)width + (size_t)x];
				}
				if (fill == 0 && y + 1 < height) {
					fill = snapshot[(size_t)(y + 1) * (size_t)width + (size_t)x];
				}
				if (fill != 0) {
					pixel = fill;
				}
			}
		}
	}
}


static void Spread_Opaque(int destx, int desty, int width, int height)
{
	for (int y = 0; y < height; y++) {
		unsigned int run = 0;
		for (int x = 0; x < width; x++) {
			unsigned int & pixel = _AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)];
			if (pixel != 0) {
				run = pixel;
			} else if (run != 0) {
				pixel = run;
			}
		}
		run = 0;
		for (int x = width - 1; x >= 0; x--) {
			unsigned int & pixel = _AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)];
			if (pixel != 0) {
				run = pixel;
			} else if (run != 0) {
				pixel = run;
			}
		}
	}
	for (int x = 0; x < width; x++) {
		unsigned int run = 0;
		for (int y = 0; y < height; y++) {
			unsigned int & pixel = _AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)];
			if (pixel != 0) {
				run = pixel;
			} else if (run != 0) {
				pixel = run;
			}
		}
		run = 0;
		for (int y = height - 1; y >= 0; y--) {
			unsigned int & pixel = _AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)];
			if (pixel != 0) {
				run = pixel;
			} else if (run != 0) {
				pixel = run;
			}
		}
	}
}


static int Find_Slot(int heap, int subtile, int icon, LightConvertClass * drawer)
{
	for (int i = 0; i < (int)_Slots.size(); i++) {
		if (_Slots[i].Heap == heap && _Slots[i].Subtile == subtile && _Slots[i].Icon == icon && _Slots[i].Drawer == drawer) {
			return(_Slots[i].Index);
		}
	}
	return(-1);
}


static int Bake_Tile_Slot(CellClass const & cell)
{
	if (cell.Drawer == NULL || cell.Drawer->Get_Translate_Table() == NULL || cell.Drawer->Bytes_Per_Pixel() != 2) {
		return(-1);
	}

	IsometricTileTypeClass * ittype = NULL;
	int icon = 0;
	int subtile = 0;
	cell.Fetch_Icon(ittype, subtile, &icon, true);
	if (ittype == NULL) {
		return(-1);
	}

	int heap = ittype->HeapID;
	int existing = Find_Slot(heap, subtile, icon, cell.Drawer);
	if (existing >= 0) {
		return(existing);
	}
	if ((int)_Slots.size() >= ATLAS_MAX_SLOTS || _AtlasWidth <= 0 || _AtlasHeight <= 0) {
		return(-1);
	}

	IsometricTileTypeClass const * art = Tile_Variation(ittype, icon);
	if (art == NULL || art->Get_Image_Data() == NULL) {
		return(-1);
	}

	IsoTileSet const * set = (IsoTileSet const *)art->Get_Image_Data();
	if (set == NULL || set->Pixel_Width() != DIAMOND_W || set->Pixel_Height() != DIAMOND_H) {
		return(-1);
	}
	if (subtile < 0 || subtile >= set->Tile_Count()) {
		return(-1);
	}

	IsoTileRecord const * record = set->Fetch_Record_Pointer_Unsafe(subtile);
	if (record == NULL) {
		return(-1);
	}

	unsigned char diamond[DIAMOND_W * DIAMOND_H];
	Unpack_Diamond((unsigned char const *)(record + 1), diamond);

	int index = (int)_Slots.size();
	int col = index % ATLAS_COLS;
	int row = index / ATLAS_COLS;
	unsigned short const * table = (unsigned short const *)cell.Drawer->Get_Translate_Table();
	int destx = col * TILE_SLOT;
	int desty = row * TILE_SLOT;
	for (int y = 0; y < TILE_SLOT; y++) {
		float v = ((float)y + 0.5f) / (float)TILE_SLOT;
		for (int x = 0; x < TILE_SLOT; x++) {
			float u = ((float)x + 0.5f) / (float)TILE_SLOT;
			float px;
			float py;
			Unproject_To_Diamond(u, v, px, py);
			unsigned char src = Sample_Diamond(diamond, px, py);
			unsigned int pixel = 0;
			if (src != 0) {
				pixel = Pixel_565_To_BGRA(table[src]);
			}
			_AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)] = pixel;
		}
	}
	if (record->IsHasExtraData && record->ExtraWidth > 0 && record->ExtraHeight > 0 && !cell.Is_Tile_Ramp()) {
		Dilate_Opaque(destx, desty, TILE_SLOT, TILE_SLOT);
	} else {
		Spread_Opaque(destx, desty, TILE_SLOT, TILE_SLOT);
	}

	AtlasSlot slot;
	slot.Heap = heap;
	slot.Subtile = subtile;
	slot.Icon = icon;
	slot.Drawer = cell.Drawer;
	slot.Index = index;
	slot.ExtraX = 0;
	slot.ExtraY = 0;
	slot.ExtraW = 0;
	slot.ExtraH = 0;
	slot.BlitDX = 0;
	slot.BlitDY = 0;

	if (record->IsHasExtraData && record->ExtraWidth > 0 && record->ExtraHeight > 0 && record->ExtraOffset > 0) {
		int ex = 0;
		int ey = 0;
		if (Pack_Extra_Rect(record->ExtraWidth, record->ExtraHeight, ex, ey)) {
			unsigned char const * extra = (unsigned char const *)record + record->ExtraOffset;
			for (int y = 0; y < record->ExtraHeight; y++) {
				for (int x = 0; x < record->ExtraWidth; x++) {
					unsigned char src = extra[y * record->ExtraWidth + x];
					unsigned int pixel = 0;
					if (src != 0) {
						pixel = Pixel_565_To_BGRA(table[src]);
					}
					_AtlasPixels[(size_t)(ey + y) * (size_t)_AtlasWidth + (size_t)(ex + x)] = pixel;
				}
			}
			slot.ExtraX = ex;
			slot.ExtraY = ey;
			slot.ExtraW = record->ExtraWidth;
			slot.ExtraH = record->ExtraHeight;
			slot.BlitDX = record->ExtraX - record->X;
			slot.BlitDY = record->ExtraY - record->Y;
		}
	}

	_Slots.push_back(slot);
	Seal_White_Texel();
	return(index);
}


static void Slot_UV_Point(int slot, float su, float sv, float & u, float & v)
{
	if (su < 0.0f) {
		su = 0.0f;
	} else if (su > 1.0f) {
		su = 1.0f;
	}
	if (sv < 0.0f) {
		sv = 0.0f;
	} else if (sv > 1.0f) {
		sv = 1.0f;
	}

	int col = slot % ATLAS_COLS;
	int row = slot / ATLAS_COLS;
	float x0 = (float)(col * TILE_SLOT);
	float y0 = (float)(row * TILE_SLOT);
	float px = 1.5f + su * ((float)TILE_SLOT - 3.0f);
	float py = 1.5f + sv * ((float)TILE_SLOT - 3.0f);
	u = (x0 + px) / (float)_AtlasWidth;
	v = (y0 + py) / (float)_AtlasHeight;
}


static void Slot_Strip_UV(int slot, bool east, int corner, float & u, float & v)
{
	int col = slot % ATLAS_COLS;
	int row = slot / ATLAS_COLS;
	float x0 = (float)(col * TILE_SLOT);
	float y0 = (float)(row * TILE_SLOT);
	float inset = 0.5f;
	float band = 10.0f;
	float px;
	float py;
	if (east) {
		float outer = x0 + (float)TILE_SLOT - inset;
		float inner = outer - band;
		float top = y0 + inset;
		float bottom = y0 + (float)TILE_SLOT - inset;
		if (corner == 0) {
			px = outer;
			py = top;
		} else if (corner == 1) {
			px = outer;
			py = bottom;
		} else if (corner == 2) {
			px = inner;
			py = bottom;
		} else {
			px = inner;
			py = top;
		}
	} else {
		float outer = y0 + (float)TILE_SLOT - inset;
		float inner = outer - band;
		float left = x0 + inset;
		float right = x0 + (float)TILE_SLOT - inset;
		if (corner == 0) {
			px = left;
			py = outer;
		} else if (corner == 1) {
			px = right;
			py = outer;
		} else if (corner == 2) {
			px = right;
			py = inner;
		} else {
			px = left;
			py = inner;
		}
	}
	u = px / (float)_AtlasWidth;
	v = py / (float)_AtlasHeight;
}


static void Extra_UV(AtlasSlot const & slot, int corner, float & u, float & v)
{
	float x0 = (float)slot.ExtraX;
	float y0 = (float)slot.ExtraY;
	float px = 0.5f;
	float py = 0.5f;
	if (corner == 1) {
		px = (float)slot.ExtraW - 0.5f;
		py = 0.5f;
	} else if (corner == 2) {
		px = (float)slot.ExtraW - 0.5f;
		py = (float)slot.ExtraH - 0.5f;
	} else if (corner == 3) {
		px = 0.5f;
		py = (float)slot.ExtraH - 0.5f;
	}
	u = (x0 + px) / (float)_AtlasWidth;
	v = (y0 + py) / (float)_AtlasHeight;
}


static void White_UV(float & u, float & v)
{
	u = ((float)_AtlasWidth - 1.5f) / (float)_AtlasWidth;
	v = ((float)_AtlasHeight - 1.5f) / (float)_AtlasHeight;
}


static void Seal_White_Texel(void)
{
	if (_AtlasPixels.empty() || _AtlasWidth < 2 || _AtlasHeight < 2) {
		return;
	}

	_AtlasPixels.back() = 0xFFFFFFFFu;
	_AtlasPixels[(size_t)(_AtlasHeight - 1) * (size_t)_AtlasWidth + (size_t)(_AtlasWidth - 2)] = 0xFFFFFFFFu;
	_AtlasPixels[(size_t)(_AtlasHeight - 2) * (size_t)_AtlasWidth + (size_t)(_AtlasWidth - 1)] = 0xFFFFFFFFu;
	_AtlasPixels[(size_t)(_AtlasHeight - 2) * (size_t)_AtlasWidth + (size_t)(_AtlasWidth - 2)] = 0xFFFFFFFFu;
}


static void Inflate_Corners(RemasterCorner * corners, int count, float pixels)
{
	if (corners == NULL || count < 3 || pixels <= 0.0f) {
		return;
	}

	float cx = 0.0f;
	float cy = 0.0f;
	for (int i = 0; i < count; i++) {
		cx += corners[i].SX;
		cy += corners[i].SY;
	}
	cx /= (float)count;
	cy /= (float)count;
	for (int i = 0; i < count; i++) {
		float dx = corners[i].SX - cx;
		float dy = corners[i].SY - cy;
		float len = std::sqrt(dx * dx + dy * dy);
		if (len > 0.001f) {
			corners[i].SX += dx / len * pixels;
			corners[i].SY += dy / len * pixels;
		}
	}
}


static float Weld_Edge(float self, Cell const & other, int localx, int localy)
{
	if (!Map.In_Radar(other)) {
		return(self);
	}

	float neighbor = (float)Own_Height(Map[other], localx, localy);
	if (std::fabs(self - neighbor) < (float)LEVEL_LEPTON_H * 0.5f) {
		return(neighbor);
	}

	return(self);
}


static void Fill_Chroma_Rect(unsigned short * bits, int stride, Rect const & cliprect, int x0, int y0, int x1, int y1)
{
	if (bits == NULL) {
		return;
	}

	int minx = std::max(std::min(x0, x1), cliprect.X);
	int miny = std::max(std::min(y0, y1), cliprect.Y);
	int maxx = std::min(std::max(x0, x1), cliprect.X + cliprect.Width - 1);
	int maxy = std::min(std::max(y0, y1), cliprect.Y + cliprect.Height - 1);
	if (minx > maxx || miny > maxy) {
		return;
	}

	int const pitch = stride / 2;
	for (int y = miny; y <= maxy; y++) {
		unsigned short * row = bits + y * pitch;
		for (int x = minx; x <= maxx; x++) {
			row[x] = REMASTER_CHROMA;
		}
	}
}


static void Cell_Fill_Color(CellClass const & cell, int & r, int & g, int & b, float & brightness)
{
	RGBClass low;
	RGBClass high;
	cell.Cell_Color(low, high);
	float mix = cell.Height / 14.0f;
	if (mix < 0.0f) {
		mix = 0.0f;
	} else if (mix > 1.0f) {
		mix = 1.0f;
	}

	r = (int)(low.Get_Red() + (high.Get_Red() - low.Get_Red()) * mix + 0.5f);
	g = (int)(low.Get_Green() + (high.Get_Green() - low.Get_Green()) * mix + 0.5f);
	b = (int)(low.Get_Blue() + (high.Get_Blue() - low.Get_Blue()) * mix + 0.5f);
	brightness = cell.TileBrightness / 1000.0f;
	if (brightness < 0.15f) {
		brightness = 0.15f;
	}
}


static RemasterTerrainVertex Make_Terrain_Vertex(RemasterCorner const & corner, unsigned int color, float u, float v)
{
	RemasterTerrainVertex vertex;
	vertex.X = corner.SX;
	vertex.Y = corner.SY;
	vertex.NX = corner.NX;
	vertex.NY = corner.NY;
	vertex.NZ = corner.NZ;
	vertex.U = u;
	vertex.V = v;
	vertex.Color = color;
	return(vertex);
}


static void Fill_Chroma_Triangle(unsigned short * bits, int stride, Rect const & cliprect, RemasterCorner const & a, RemasterCorner const & b, RemasterCorner const & c)
{
	int minx = (int)std::floor(std::min(a.SX, std::min(b.SX, c.SX))) - 2;
	int maxx = (int)std::ceil(std::max(a.SX, std::max(b.SX, c.SX))) + 2;
	int miny = (int)std::floor(std::min(a.SY, std::min(b.SY, c.SY))) - 2;
	int maxy = (int)std::ceil(std::max(a.SY, std::max(b.SY, c.SY))) + 2;

	minx = std::max(minx, cliprect.X);
	miny = std::max(miny, cliprect.Y);
	maxx = std::min(maxx, cliprect.X + cliprect.Width - 1);
	maxy = std::min(maxy, cliprect.Y + cliprect.Height - 1);
	if (minx > maxx || miny > maxy) {
		return;
	}

	float area = (b.SX - a.SX) * (c.SY - a.SY) - (c.SX - a.SX) * (b.SY - a.SY);
	if (area > -0.01f && area < 0.01f) {
		return;
	}

	int const pitch = stride / 2;
	for (int y = miny; y <= maxy; ++y) {
		unsigned short * row = bits + y * pitch;
		float fy = (float)y + 0.5f;
		for (int x = minx; x <= maxx; ++x) {
			float fx = (float)x + 0.5f;
			float w0 = (b.SX - fx) * (c.SY - fy) - (c.SX - fx) * (b.SY - fy);
			float w1 = (c.SX - fx) * (a.SY - fy) - (a.SX - fx) * (c.SY - fy);
			float w2 = (a.SX - fx) * (b.SY - fy) - (b.SX - fx) * (a.SY - fy);
			if (area > 0.0f) {
				if (w0 < 0.0f || w1 < 0.0f || w2 < 0.0f) {
					continue;
				}
			} else if (w0 > 0.0f || w1 > 0.0f || w2 > 0.0f) {
				continue;
			}

			row[x] = REMASTER_CHROMA;
		}
	}
}


static unsigned int Lit_Color(int r, int g, int b, float brightness, RemasterCorner const & corner, bool apply_sun, bool lighting_only)
{
	float shade = brightness;
	if (apply_sun) {
		float ndotl = corner.NX * -0.45f + corner.NY * 0.20f + corner.NZ * 0.87f;
		if (ndotl < 0.0f) {
			ndotl = 0.0f;
		}
		if (lighting_only) {
			shade = (0.50f + 0.28f * ndotl) * brightness;
		} else {
			shade = (0.42f + 0.58f * ndotl) * brightness;
		}
	}

	int lr;
	int lg;
	int lb;
	if (lighting_only) {
		int lit = (int)(shade * 255.0f + 0.5f);
		lr = lit;
		lg = lit;
		lb = lit;
	} else {
		lr = (int)(r * shade + 0.5f);
		lg = (int)(g * shade + 0.5f);
		lb = (int)(b * shade + 0.5f);
	}
	Apply_Mouse_Light(lr, lg, lb, corner.SX, corner.SY, _RemasteredTextures);
	return(Pack_Color(lr, lg, lb));
}


static void Emit_Triangle(RemasterCorner const & a, RemasterCorner const & b, RemasterCorner const & c, int r, int g, int bl, float brightness, unsigned short * chroma, int stride, Rect const & cliprect, float ua, float va, float ub, float vb, float uc, float vc, bool apply_sun, bool lighting_only)
{
	if (chroma != NULL) {
		Fill_Chroma_Triangle(chroma, stride, cliprect, a, b, c);
	}

	_TerrainVerts.push_back(Make_Terrain_Vertex(a, Lit_Color(r, g, bl, brightness, a, apply_sun, lighting_only), ua, va));
	_TerrainVerts.push_back(Make_Terrain_Vertex(b, Lit_Color(r, g, bl, brightness, b, apply_sun, lighting_only), ub, vb));
	_TerrainVerts.push_back(Make_Terrain_Vertex(c, Lit_Color(r, g, bl, brightness, c, apply_sun, lighting_only), uc, vc));
}


static void Normal_UV(RemasterCorner const & corner, float & u, float & v)
{
	u = corner.NX * 0.5f + 0.5f;
	v = corner.NY * 0.5f + 0.5f;
	if (u < 0.0f) {
		u = 0.0f;
	} else if (u > 1.0f) {
		u = 1.0f;
	}
	if (v < 0.0f) {
		v = 0.0f;
	} else if (v > 1.0f) {
		v = 1.0f;
	}
}


static bool Extra_Screen_Rect(CellClass const & cell, Rect & out)
{
	IsometricTileTypeClass * ittype = NULL;
	int icon = 0;
	int subtile = 0;
	cell.Fetch_Icon(ittype, subtile, &icon, true);
	if (ittype == NULL) {
		return(false);
	}

	IsometricTileTypeClass const * art = Tile_Variation(ittype, icon);
	if (art == NULL || art->Get_Image_Data() == NULL) {
		return(false);
	}

	IsoTileSet const * set = (IsoTileSet const *)art->Get_Image_Data();
	if (set == NULL || subtile < 0 || subtile >= set->Tile_Count()) {
		return(false);
	}

	IsoTileRecord const * record = set->Fetch_Record_Pointer_Unsafe(subtile);
	if (record == NULL || record->IsHasExtraData == 0 || record->ExtraWidth <= 0 || record->ExtraHeight <= 0) {
		return(false);
	}

	Point2D pixel;
	if (!TacticalMap->Coord_To_Pixel(Coord_Whole(Coord(cell.Fetch_CellID())), pixel)) {
		return(false);
	}

	out.X = pixel.X + ISO_TILE_PIXEL_W / -2 + (record->ExtraX - record->X);
	out.Y = pixel.Y - LEVEL_PIXEL_H_1 * cell.Height + TacticalRect.Y + (record->ExtraY - record->Y);
	out.Width = record->ExtraWidth;
	out.Height = record->ExtraHeight;
	return(out.Width > 0 && out.Height > 0);
}


static void Emit_Drop_Face(RemasterCorner const & high_a, RemasterCorner const & high_b, Cell const & neighbor, int nlocal_ax, int nlocal_ay, int nlocal_bx, int nlocal_by, int r, int g, int b, float brightness, unsigned short * chroma, int stride, Rect const & cliprect, int slot, bool east)
{
	if (!Map.In_Radar(neighbor)) {
		return;
	}

	CellClass const & ncell = Map[neighbor];
	float za = (float)Own_Height(ncell, nlocal_ax, nlocal_ay);
	float zb = (float)Own_Height(ncell, nlocal_bx, nlocal_by);
	float drop = std::min(high_a.Z - za, high_b.Z - zb);
	if (drop < (float)LEVEL_LEPTON_H * 0.5f) {
		return;
	}

	RemasterCorner low_a = high_a;
	RemasterCorner low_b = high_b;
	Project_World(high_a.X, high_a.Y, za, low_a);
	Project_World(high_b.X, high_b.Y, zb, low_b);

	float nx = 0.0f;
	float ny = 0.0f;
	float nz = 0.0f;
	Face_Normal(high_a, high_b, low_b, nx, ny, nz, false);
	RemasterCorner wall[4];
	wall[0] = high_a;
	wall[1] = high_b;
	wall[2] = low_b;
	wall[3] = low_a;
	wall[0].NX = wall[1].NX = wall[2].NX = wall[3].NX = nx;
	wall[0].NY = wall[1].NY = wall[2].NY = wall[3].NY = ny;
	wall[0].NZ = wall[1].NZ = wall[2].NZ = wall[3].NZ = nz;
	Inflate_Corners(wall, 4, 0.75f);

	int wr = (int)(r * 0.72f + 0.5f);
	int wg = (int)(g * 0.68f + 0.5f);
	int wb = (int)(b * 0.62f + 0.5f);
	float ua;
	float va;
	float ub;
	float vb;
	float uc;
	float vc;
	float ud;
	float vd;
	bool apply_sun = false;
	if (_RemasteredTextures && _AtlasWidth > 0 && _AtlasHeight > 0) {
		apply_sun = true;
		White_UV(ua, va);
		ub = ua;
		vb = va;
		uc = ua;
		vc = va;
		ud = ua;
		vd = va;
	} else {
		Normal_UV(wall[0], ua, va);
		Normal_UV(wall[1], ub, vb);
		Normal_UV(wall[2], uc, vc);
		Normal_UV(wall[3], ud, vd);
	}
	Emit_Triangle(wall[0], wall[1], wall[2], wr, wg, wb, brightness, chroma, stride, cliprect, ua, va, ub, vb, uc, vc, apply_sun, false);
	Emit_Triangle(wall[0], wall[2], wall[3], wr, wg, wb, brightness, chroma, stride, cliprect, ua, va, uc, vc, ud, vd, apply_sun, false);

	if (!apply_sun || slot < 0 || chroma != NULL) {
		return;
	}

	bool lighting_only = true;
	if (slot < (int)_Slots.size() && _Slots[slot].ExtraW > 0) {
		Extra_UV(_Slots[slot], 0, ua, va);
		Extra_UV(_Slots[slot], 1, ub, vb);
		Extra_UV(_Slots[slot], 2, uc, vc);
		Extra_UV(_Slots[slot], 3, ud, vd);
	} else {
		Slot_Strip_UV(slot, east, 0, ua, va);
		Slot_Strip_UV(slot, east, 1, ub, vb);
		Slot_Strip_UV(slot, east, 2, uc, vc);
		Slot_Strip_UV(slot, east, 3, ud, vd);
	}
	Emit_Triangle(wall[0], wall[1], wall[2], wr, wg, wb, brightness, NULL, 0, cliprect, ua, va, ub, vb, uc, vc, apply_sun, lighting_only);
	Emit_Triangle(wall[0], wall[2], wall[3], wr, wg, wb, brightness, NULL, 0, cliprect, ua, va, uc, vc, ud, vd, apply_sun, lighting_only);
}


static void Emit_Extra_Overlay(CellClass const & cell, int slot, RemasterCorner const & light, int r, int g, int b, float brightness, unsigned short * chroma, int stride, Rect const & cliprect)
{
	if (chroma != NULL) {
		Rect extra;
		if (Extra_Screen_Rect(cell, extra)) {
			Fill_Chroma_Rect(chroma, stride, cliprect, extra.X, extra.Y, extra.X + extra.Width - 1, extra.Y + extra.Height - 1);
		}
		return;
	}

	if (slot < 0 || slot >= (int)_Slots.size() || _Slots[slot].ExtraW <= 0 || _AtlasWidth <= 0) {
		return;
	}

	AtlasSlot const & packed = _Slots[slot];
	Point2D pixel;
	if (!TacticalMap->Coord_To_Pixel(Coord_Whole(Coord(cell.Fetch_CellID())), pixel)) {
		return;
	}

	RemasterCorner quad[4];
	quad[0] = light;
	quad[1] = light;
	quad[2] = light;
	quad[3] = light;
	quad[0].SX = (float)(pixel.X + ISO_TILE_PIXEL_W / -2 + packed.BlitDX);
	quad[0].SY = (float)(pixel.Y - LEVEL_PIXEL_H_1 * cell.Height + TacticalRect.Y + packed.BlitDY);
	quad[1].SX = quad[0].SX + (float)packed.ExtraW;
	quad[1].SY = quad[0].SY;
	quad[2].SX = quad[1].SX;
	quad[2].SY = quad[0].SY + (float)packed.ExtraH;
	quad[3].SX = quad[0].SX;
	quad[3].SY = quad[2].SY;

	float u0;
	float v0;
	float u1;
	float v1;
	float u2;
	float v2;
	float u3;
	float v3;
	Extra_UV(packed, 0, u0, v0);
	Extra_UV(packed, 1, u1, v1);
	Extra_UV(packed, 2, u2, v2);
	Extra_UV(packed, 3, u3, v3);
	Emit_Triangle(quad[0], quad[1], quad[2], r, g, b, brightness, NULL, 0, cliprect, u0, v0, u1, v1, u2, v2, true, true);
	Emit_Triangle(quad[0], quad[2], quad[3], r, g, b, brightness, NULL, 0, cliprect, u0, v0, u2, v2, u3, v3, true, true);
}


static float Height_At(CellClass const & cell, Cell const & id, float su, float sv)
{
	int localx = (int)(su * (float)(CELL_LEPTON_W - 1) + 0.5f);
	int localy = (int)(sv * (float)(CELL_LEPTON_H - 1) + 0.5f);
	float z = (float)Own_Height(cell, localx, localy);
	if (su >= 0.999f) {
		z = Weld_Edge(z, Cell(id.X + 1, id.Y), 0, localy);
	}
	if (sv >= 0.999f) {
		z = Weld_Edge(z, Cell(id.X, id.Y + 1), localx, 0);
	}
	return(z);
}


static void Face_UV(int slot, bool textured, RemasterCorner const & corner, float su, float sv, float & u, float & v)
{
	if (textured) {
		if (slot >= 0) {
			Slot_UV_Point(slot, su, sv, u, v);
		} else {
			White_UV(u, v);
		}
	} else {
		Normal_UV(corner, u, v);
	}
}


static float Screen_Cross(RemasterCorner const & a, RemasterCorner const & b, RemasterCorner const & c)
{
	return((b.SX - a.SX) * (c.SY - a.SY) - (c.SX - a.SX) * (b.SY - a.SY));
}


static void Emit_Patch(RemasterCorner const & c00, RemasterCorner const & c10, RemasterCorner const & c11, RemasterCorner const & c01, RemasterCorner const & center, float u00, float v00, float u10, float v10, float u11, float v11, float u01, float v01, float uc, float vc, int r, int g, int b, float brightness, unsigned short * chroma, int stride, Rect const & cliprect, bool apply_sun, bool lighting_only)
{
	float split_a = std::min(std::fabs(Screen_Cross(c00, c10, c11)), std::fabs(Screen_Cross(c00, c11, c01)));
	float split_b = std::min(std::fabs(Screen_Cross(c00, c10, c01)), std::fabs(Screen_Cross(c10, c11, c01)));
	float fan = std::min(std::min(std::fabs(Screen_Cross(c00, c10, center)), std::fabs(Screen_Cross(c10, c11, center))), std::min(std::fabs(Screen_Cross(c11, c01, center)), std::fabs(Screen_Cross(c01, c00, center))));

	if (fan > split_a && fan > split_b) {
		Emit_Triangle(c00, c10, center, r, g, b, brightness, chroma, stride, cliprect, u00, v00, u10, v10, uc, vc, apply_sun, lighting_only);
		Emit_Triangle(c10, c11, center, r, g, b, brightness, chroma, stride, cliprect, u10, v10, u11, v11, uc, vc, apply_sun, lighting_only);
		Emit_Triangle(c11, c01, center, r, g, b, brightness, chroma, stride, cliprect, u11, v11, u01, v01, uc, vc, apply_sun, lighting_only);
		Emit_Triangle(c01, c00, center, r, g, b, brightness, chroma, stride, cliprect, u01, v01, u00, v00, uc, vc, apply_sun, lighting_only);
		return;
	}

	if (split_b > split_a) {
		Emit_Triangle(c00, c10, c01, r, g, b, brightness, chroma, stride, cliprect, u00, v00, u10, v10, u01, v01, apply_sun, lighting_only);
		Emit_Triangle(c10, c11, c01, r, g, b, brightness, chroma, stride, cliprect, u10, v10, u11, v11, u01, v01, apply_sun, lighting_only);
	} else {
		Emit_Triangle(c00, c10, c11, r, g, b, brightness, chroma, stride, cliprect, u00, v00, u10, v10, u11, v11, apply_sun, lighting_only);
		Emit_Triangle(c00, c11, c01, r, g, b, brightness, chroma, stride, cliprect, u00, v00, u11, v11, u01, v01, apply_sun, lighting_only);
	}
}


static void Emit_Cell_Geometry(CellClass const & cell, unsigned short * chroma, int stride, Rect const & cliprect)
{
	int r = 0;
	int g = 0;
	int b = 0;
	float brightness = 1.0f;
	Cell_Fill_Color(cell, r, g, b, brightness);

	Cell const id = cell.Fetch_CellID();
	float x0 = (float)(id.X * CELL_LEPTON_W);
	float y0 = (float)(id.Y * CELL_LEPTON_H);

	int slot = -1;
	bool textured = _RemasteredTextures && _AtlasWidth > 0 && _AtlasHeight > 0;
	if (textured && chroma == NULL) {
		slot = Bake_Tile_Slot(cell);
	}

	bool apply_sun = textured;
	bool lighting_only = textured && slot >= 0;
	int const divs = SLOPE_DIVS;
	RemasterCorner grid[SLOPE_DIVS + 1][SLOPE_DIVS + 1];
	for (int j = 0; j <= divs; j++) {
		float sv = (float)j / (float)divs;
		float wy = y0 + sv * (float)CELL_LEPTON_H;
		int localy = (int)(sv * (float)(CELL_LEPTON_H - 1) + 0.5f);
		for (int i = 0; i <= divs; i++) {
			float su = (float)i / (float)divs;
			float wx = x0 + su * (float)CELL_LEPTON_W;
			int localx = (int)(su * (float)(CELL_LEPTON_W - 1) + 0.5f);
			float z = Height_At(cell, id, su, sv);
			Project_World(wx, wy, z, grid[j][i]);
			Corner_Normal(cell, localx, localy, grid[j][i].NX, grid[j][i].NY, grid[j][i].NZ);
		}
	}

	for (int j = 0; j < divs; j++) {
		float sv0 = (float)j / (float)divs;
		float sv1 = (float)(j + 1) / (float)divs;
		for (int i = 0; i < divs; i++) {
			float su0 = (float)i / (float)divs;
			float su1 = (float)(i + 1) / (float)divs;
			RemasterCorner quad[4];
			quad[0] = grid[j][i];
			quad[1] = grid[j][i + 1];
			quad[2] = grid[j + 1][i + 1];
			quad[3] = grid[j + 1][i];
			RemasterCorner raw[4];
			raw[0] = quad[0];
			raw[1] = quad[1];
			raw[2] = quad[2];
			raw[3] = quad[3];
			Inflate_Corners(quad, 4, 0.85f);
			float suc = 0.5f * (su0 + su1);
			float svc = 0.5f * (sv0 + sv1);
			float wxc = x0 + suc * (float)CELL_LEPTON_W;
			float wyc = y0 + svc * (float)CELL_LEPTON_H;
			int localx = (int)(suc * (float)(CELL_LEPTON_W - 1) + 0.5f);
			int localy = (int)(svc * (float)(CELL_LEPTON_H - 1) + 0.5f);
			RemasterCorner center;
			Project_World(wxc, wyc, Height_At(cell, id, suc, svc), center);
			Corner_Normal(cell, localx, localy, center.NX, center.NY, center.NZ);
			float min_raw = std::min(std::fabs(Screen_Cross(raw[0], raw[1], raw[2])), std::fabs(Screen_Cross(raw[0], raw[2], raw[3])));
			float min_inf = std::min(std::fabs(Screen_Cross(quad[0], quad[1], quad[2])), std::fabs(Screen_Cross(quad[0], quad[2], quad[3])));
			if (min_inf < min_raw * 0.5f) {
				quad[0] = raw[0];
				quad[1] = raw[1];
				quad[2] = raw[2];
				quad[3] = raw[3];
			}
			float u00;
			float v00;
			float u10;
			float v10;
			float u11;
			float v11;
			float u01;
			float v01;
			float uc;
			float vc;
			Face_UV(slot, textured, quad[0], su0, sv0, u00, v00);
			Face_UV(slot, textured, quad[1], su1, sv0, u10, v10);
			Face_UV(slot, textured, quad[2], su1, sv1, u11, v11);
			Face_UV(slot, textured, quad[3], su0, sv1, u01, v01);
			Face_UV(slot, textured, center, suc, svc, uc, vc);
			Emit_Patch(quad[0], quad[1], quad[2], quad[3], center, u00, v00, u10, v10, u11, v11, u01, v01, uc, vc, r, g, b, brightness, chroma, stride, cliprect, apply_sun, lighting_only);
		}
	}

	RemasterCorner const & nw = grid[0][0];
	RemasterCorner const & ne = grid[0][divs];
	RemasterCorner const & se = grid[divs][divs];
	RemasterCorner const & sw = grid[divs][0];
	Emit_Drop_Face(ne, se, Cell(id.X + 1, id.Y), 0, 0, 0, CELL_LEPTON_H - 1, r, g, b, brightness, chroma, stride, cliprect, slot, true);
	Emit_Drop_Face(sw, se, Cell(id.X, id.Y + 1), 0, 0, CELL_LEPTON_W - 1, 0, r, g, b, brightness, chroma, stride, cliprect, slot, false);

	if (textured) {
		Emit_Extra_Overlay(cell, slot, nw, r, g, b, brightness, chroma, stride, cliprect);
	}
}


static void Update_Mouse_Light(void)
{
	_MouseLight = false;
	if (MouseCursor == NULL || TacticalMap == NULL) {
		return;
	}

	Point2D mouse = Get_Mouse_Point();
	if (!TacticalRect.Is_Point_Within(mouse)) {
		return;
	}

	_MouseSX = (float)mouse.X;
	_MouseSY = (float)mouse.Y;
	_MouseLight = true;
}


void Remaster_Prepare_Frame(void)
{
	_TerrainVerts.clear();
	_TerrainClip = Rect();
	_MouseLight = false;
	if (!_RemasteredGraphics || TacticalMap == NULL) {
		return;
	}

	Update_Mouse_Light();
	_TerrainClip = TacticalRect;
	if (_RemasteredTextures && _AtlasPixels.empty()) {
		_AtlasWidth = ATLAS_COLS * TILE_SLOT;
		_AtlasHeight = ATLAS_DIAMOND_ROWS * TILE_SLOT + ATLAS_EXTRA_H;
		_AtlasPixels.assign((size_t)_AtlasWidth * (size_t)_AtlasHeight, 0);
		_ExtraX = 0;
		_ExtraY = ATLAS_DIAMOND_ROWS * TILE_SLOT;
		_ExtraRowH = 0;
		Seal_White_Texel();
	}

	Rect const & area = TacticalRect;
	Coord lepton = Coord(TacticalMap->Pixel_To_Lepton(Point2D(TacticalMap->TacPixelX, TacticalMap->TacPixelY) + area.Top_Left() - TacticalRect.Top_Left()), 0);
	Cell origin = lepton.As_Cell();
	Cell base(origin.X - 2, origin.Y);

	int ycount = area.Height / (ISO_TILE_PIXEL_H / 2) + 17;
	int xcount = area.Width / ISO_TILE_PIXEL_W + 4;

	int ix;
	int iy;
	for (iy = 0; iy < ycount; iy++) {
		Cell step(iy / 2, (iy + 1) / 2);
		Cell cell = base + step;

		for (ix = xcount; ix > 0; ix--) {
			if (Map.In_Radar(cell)) {
				CellClass const & cellref = Map[cell];
				Rect render = cellref.Cell_Render_Rect();
				Rect inter = Intersect(area, render);
				if (render.Is_Valid() && inter.Is_Valid()) {
					Emit_Cell_Geometry(cellref, NULL, 0, Rect());
				}
			}
			cell += Cell(1, -1);
		}
	}
}


void Remaster_Fetch_Terrain(RemasterTerrainVertex const *& verts, int & count, Rect & cliprect, unsigned int const *& atlas, int & atlaswidth, int & atlasheight, bool & textured, unsigned int & atlasserial)
{
	Remaster_Prepare_Frame();
	if (_TerrainVerts.empty()) {
		verts = NULL;
		count = 0;
		cliprect = Rect();
		atlas = NULL;
		atlaswidth = 0;
		atlasheight = 0;
		textured = false;
		atlasserial = 0;
		return;
	}

	verts = _TerrainVerts.data();
	count = (int)_TerrainVerts.size();
	cliprect = _TerrainClip;
	if (_RemasteredTextures && !_AtlasPixels.empty()) {
		Seal_White_Texel();
		atlas = _AtlasPixels.data();
		atlaswidth = _AtlasWidth;
		atlasheight = _AtlasHeight;
		textured = true;
		atlasserial = _AtlasSerial;
	} else {
		atlas = NULL;
		atlaswidth = 0;
		atlasheight = 0;
		textured = false;
		atlasserial = 0;
	}
}


void Remaster_Draw_Cell(CellClass & cell, Point2D const & pixel, Rect const & cliprect)
{
	if (cell.Drawer == NULL) {
		cell.Init_Drawer(NULL);
	}

	IsometricTileTypeClass * ittype = NULL;
	int icon = 0;
	int subtile = 0;
	cell.Fetch_Icon(ittype, subtile, &icon, true);

	Point2D drawpoint = pixel;
	drawpoint.Y -= LEVEL_PIXEL_H_1 * cell.Height;

	if (ittype != NULL && ittype->Get_Image_Data() != NULL) {
		ittype->Draw_Tile(cell.Drawer, subtile, *LogicalSurface, drawpoint.X, drawpoint.Y + TacticalRect.Y, cliprect, cell.Height, cell.TileBrightness, true, icon, false, true, false, 0);
	}

	if (LogicalSurface != NULL && LogicalSurface->Bytes_Per_Pixel() == 2) {
		void * bits = LogicalSurface->Lock();
		if (bits != NULL) {
			std::size_t const start = _TerrainVerts.size();
			Emit_Cell_Geometry(cell, (unsigned short *)bits, LogicalSurface->Stride(), cliprect);
			_TerrainVerts.resize(start);
			LogicalSurface->Unlock();
		}
	}

	Cell const id = cell.Fetch_CellID();
	if (cell.Smudge != SMUDGE_NONE) {
		SmudgeTypes[cell.Smudge]->Draw_It(drawpoint + Point2D(ISO_TILE_PIXEL_W / 2, TacticalRect.Y) - cliprect.TopLeft, cliprect, cell.SmudgeData, LEVEL_LEPTON_H * cell.Height, id);
	}
}
