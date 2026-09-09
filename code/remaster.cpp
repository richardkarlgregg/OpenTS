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
#include "data.h"
#include "globals.h"
#include "gscreen.h"
#include "house.h"
#include "inline.h"
#include "isotype.h"
#include "language/language.h"
#include "lightcon.h"
#include "rgb.h"
#include "remastertile.h"
#include "session.h"
#include "smudtype.h"
#include "smudge.hh"
#include "surface.h"
#include "tactical.h"

#include "ramp.hh"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>


static bool _RemasteredGraphics = false;
static bool _RemasteredTextures = true;
static bool _RemasteredDensity = false;
static std::vector<RemasterTerrainVertex> _TerrainVerts;
static std::vector<RemasterTerrainVertex> _BaseVerts;


struct LampSample
{
	float X;
	float Y;
	float Z;
	float NX;
	float NY;
	float NZ;
	unsigned int Base;
};

static std::vector<LampSample> _LampSamples;
static bool _MeshValid = false;
static int _MeshTacX = 0;
static int _MeshTacY = 0;
static int _MeshClipX = 0;
static int _MeshClipY = 0;
static int _MeshClipW = 0;
static int _MeshClipH = 0;
static int _MeshDens = -1;
static int _MeshTex = -1;
static unsigned int _MeshAtlas = 0;
static int _MeshShadeOX = 0;
static int _MeshShadeOY = 0;
static Rect _TerrainClip;
static bool _MouseLight = false;
static float _MouseX = 0.0f;
static float _MouseY = 0.0f;
static float _MouseZ = 0.0f;
static std::vector<unsigned int> _AtlasPixels;
static int _AtlasWidth = 0;
static int _AtlasHeight = 0;
static int _ExtraX = 0;
static int _ExtraY = 0;
static int _ExtraRowH = 0;
static unsigned int _AtlasSerial = 1;
static bool _AtlasOverflow = false;
static std::map<std::string, RemasterTileFile> _TileFiles;
static std::vector<unsigned char> _VertLayer;
static RemasterTileFile const * _LayerSource[REMASTER_LAYER_MAX];
static int _LayerUsed = 1;
static int _EmitLayer = 0;
static std::vector<RemasterTerrainVertex> _LayerOut[REMASTER_LAYER_MAX];


static int const DIAMOND_W = 48;
static int const DIAMOND_H = 24;
static int const TILE_SLOT = 48;
static int const ATLAS_COLS = 32;
static int const ATLAS_MAX_SLOTS = 1024;
static int const ATLAS_DIAMOND_ROWS = (ATLAS_MAX_SLOTS + ATLAS_COLS - 1) / ATLAS_COLS;
static int const ATLAS_EXTRA_H = 1536;
static int const SLOPE_DIVS_LOW = 4;
static int const SLOPE_DIVS_HIGH = 8;
static int const SLOPE_DIVS_MAX = SLOPE_DIVS_HIGH;
static int const SHADE_REACH = 16;
static int const SHADE_SUN_STEPS = 14;
static int const SHADE_SCALE = 2;
static int const WALL_DIVS = 4;
static float const LAMP_RADIUS = (float)CELL_LEPTON_W * 1.25f;
// Low western sun so a one-level cliff can shade ground on neighboring cells.
static float const SUN_X = -0.97f;
static float const SUN_Y = 0.10f;
static float const SUN_Z = 0.22f;


static int _ShadeOX = 0;
static int _ShadeOY = 0;
static int _ShadeW = 0;
static int _ShadeH = 0;
static int _ShadeScale = 1;
static bool _ShadeReady = false;
static int _ShadeKeyOX = 0;
static int _ShadeKeyOY = 0;
static int _ShadeKeyXC = 0;
static int _ShadeKeyYC = 0;
static int _ShadeKeyDens = -1;
static std::vector<float> _ShadeHeight;
static std::vector<unsigned char> _ShadeValid;
static std::vector<unsigned char> _ShadeSun;
static std::vector<unsigned char> _ShadeAo;


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
	int ExtraCropX;
	int ExtraCropY;
	int ExtraCropW;
	int ExtraCropH;
	int BlitDX;
	int BlitDY;
};


static std::vector<AtlasSlot> _Slots;


static void Seal_White_Texel(void);
static void White_UV(float & u, float & v);
static bool Extra_Screen_Rect(CellClass const & cell, Rect & out);
static int Bake_Tile_Slot(CellClass const & cell);


static void Reset_Terrain_Layers(void)
{
	_VertLayer.clear();
	_EmitLayer = 0;
	_LayerUsed = 1;
	_LayerSource[0] = NULL;
	for (int i = 0; i < REMASTER_LAYER_MAX; i++) {
		_LayerOut[i].clear();
		if (i > 0) {
			_LayerSource[i] = NULL;
		}
	}
}


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
	for (auto & entry : _TileFiles) {
		entry.second.AtlasX = -1;
		entry.second.AtlasY = -1;
	}
}


static void Ensure_Atlas(void)
{
	if (!_RemasteredTextures || !_AtlasPixels.empty()) {
		return;
	}

	_AtlasWidth = ATLAS_COLS * TILE_SLOT;
	_AtlasHeight = ATLAS_DIAMOND_ROWS * TILE_SLOT + ATLAS_EXTRA_H;
	_AtlasPixels.assign((size_t)_AtlasWidth * (size_t)_AtlasHeight, 0);
	_ExtraX = 0;
	_ExtraY = ATLAS_DIAMOND_ROWS * TILE_SLOT;
	_ExtraRowH = 0;
	Seal_White_Texel();
}


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


bool Remastered_Density(void)
{
	return(_RemasteredDensity);
}


static int Mesh_Divs(void)
{
	if (_RemasteredDensity) {
		return(SLOPE_DIVS_HIGH);
	}

	return(SLOPE_DIVS_LOW);
}


void Toggle_Remastered_Graphics(void)
{
	_RemasteredGraphics = !_RemasteredGraphics;
	if (!_RemasteredGraphics) {
		_TerrainVerts.clear();
		_BaseVerts.clear();
		_LampSamples.clear();
		Reset_Terrain_Layers();
		_MeshValid = false;
		_TerrainClip = Rect();
		_MouseLight = false;
		Clear_Atlas();
		_TileFiles.clear();
	}
	Map.Flag_To_Redraw(GS_REDRAW_ALL);
}


void Toggle_Remastered_Textures(void)
{
	_RemasteredTextures = !_RemasteredTextures;
	Clear_Atlas();
	_TileFiles.clear();
	_MeshValid = false;
	if (_RemasteredGraphics) {
		Map.Flag_To_Redraw(GS_REDRAW_ALL);
	}
}


void Toggle_Remastered_Density(void)
{
	_RemasteredDensity = !_RemasteredDensity;
	_MeshValid = false;
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


static bool Shade_Height_At(int sx, int sy, float & z)
{
	if (sx < 0 || sy < 0 || sx >= _ShadeW || sy >= _ShadeH) {
		return(false);
	}

	int i = sy * _ShadeW + sx;
	if (!_ShadeValid[i]) {
		return(false);
	}

	z = _ShadeHeight[i];
	return(true);
}


static bool Ground_At(float wx, float wy, float & z)
{
	int sx = (int)std::floor((wx / (float)CELL_LEPTON_W - (float)_ShadeOX) * (float)_ShadeScale);
	int sy = (int)std::floor((wy / (float)CELL_LEPTON_H - (float)_ShadeOY) * (float)_ShadeScale);
	if (_ShadeReady && Shade_Height_At(sx, sy, z)) {
		return(true);
	}

	int cx = (int)std::floor(wx / (float)CELL_LEPTON_W);
	int cy = (int)std::floor(wy / (float)CELL_LEPTON_H);
	Cell cell(cx, cy);
	if (!Map.In_Radar(cell)) {
		return(false);
	}

	z = (float)Map[cell].Get_Height(Point2D(CELL_LEPTON_W / 2, CELL_LEPTON_H / 2));
	return(true);
}


static float Occlusion_Along(float wx, float wy, float wz, float dx, float dy, float dz, int steps, float step_len)
{
	float length = std::sqrt(dx * dx + dy * dy + dz * dz);
	if (length < 1.0f) {
		return(1.0f);
	}

	dx /= length;
	dy /= length;
	dz /= length;
	float x = wx + dx * step_len;
	float y = wy + dy * step_len;
	float z = wz + dz * step_len + (float)LEVEL_LEPTON_H * 0.12f;
	float vis = 1.0f;
	for (int i = 0; i < steps; i++) {
		float ground;
		if (!Ground_At(x, y, ground)) {
			break;
		}

		float over = ground - z;
		if (over > 0.0f) {
			float fade = over / ((float)LEVEL_LEPTON_H * 0.40f);
			if (fade > 1.0f) {
				fade = 1.0f;
			}
			vis *= (1.0f - fade);
			if (vis < 0.05f) {
				return(0.0f);
			}
		}

		x += dx * step_len;
		y += dy * step_len;
		z += dz * step_len;
	}

	return(vis);
}


static float Sun_Shadow_Cell(int cx, int cy)
{
	float z;
	if (!Shade_Height_At(cx, cy, z)) {
		return(1.0f);
	}

	float xy = std::sqrt(SUN_X * SUN_X + SUN_Y * SUN_Y);
	if (xy < 0.01f) {
		return(1.0f);
	}

	float scale = (float)_ShadeScale;
	if (scale < 1.0f) {
		scale = 1.0f;
	}

	float sx = SUN_X / xy;
	float sy = SUN_Y / xy;
	float sz = SUN_Z / xy * (float)CELL_LEPTON_W;
	float x = (float)cx + 0.5f + sx * 0.55f * scale;
	float y = (float)cy + 0.5f + sy * 0.55f * scale;
	z += sz * 0.55f + (float)LEVEL_LEPTON_H * 0.20f;
	float vis = 1.0f;
	float slack = (float)LEVEL_LEPTON_H * 0.28f;
	int steps = SHADE_SUN_STEPS * _ShadeScale;
	for (int i = 0; i < steps; i++) {
		float ground;
		if (!Shade_Height_At((int)std::floor(x), (int)std::floor(y), ground)) {
			break;
		}

		float over = ground - z;
		if (over > slack) {
			float fade = (over - slack) / ((float)LEVEL_LEPTON_H * 0.55f);
			if (fade > 1.0f) {
				fade = 1.0f;
			}
			vis *= (1.0f - fade);
			if (vis < 0.06f) {
				return(0.0f);
			}
		}

		x += sx;
		y += sy;
		z += sz / scale;
	}

	return(vis);
}


static float Horizon_AO_Cell(int cx, int cy)
{
	static int const dir[4][2] = {
		{ 1, 0 },
		{ 0, 1 },
		{ -1, 0 },
		{ 0, -1 }
	};
	float z;
	if (!Shade_Height_At(cx, cy, z)) {
		return(1.0f);
	}

	float sum = 0.0f;
	for (int i = 0; i < 4; i++) {
		float ground;
		if (!Shade_Height_At(cx + dir[i][0], cy + dir[i][1], ground)) {
			sum += 1.0f;
			continue;
		}

		float over = ground - z;
		if (over <= 0.0f) {
			sum += 1.0f;
		} else {
			float fade = over / ((float)LEVEL_LEPTON_H * 0.85f);
			if (fade > 1.0f) {
				fade = 1.0f;
			}
			sum += 1.0f - fade;
		}
	}

	return(0.62f + 0.38f * (sum * 0.25f));
}


static unsigned char Pack_Shade(float value)
{
	if (value <= 0.0f) {
		return(0);
	}
	if (value >= 1.0f) {
		return(255);
	}

	return((unsigned char)(value * 255.0f + 0.5f));
}


static float Unpack_Shade(unsigned char value)
{
	return((float)value * (1.0f / 255.0f));
}


static float Sample_Shade_Byte(std::vector<unsigned char> const & grid, float fx, float fy)
{
	int x0 = (int)std::floor(fx);
	int y0 = (int)std::floor(fy);
	float tx = fx - (float)x0;
	float ty = fy - (float)y0;
	int x1 = x0 + 1;
	int y1 = y0 + 1;
	if (x0 < 0) {
		x0 = 0;
		x1 = 0;
		tx = 0.0f;
	} else if (x0 >= _ShadeW - 1) {
		x0 = _ShadeW - 1;
		x1 = x0;
		tx = 0.0f;
	}
	if (y0 < 0) {
		y0 = 0;
		y1 = 0;
		ty = 0.0f;
	} else if (y0 >= _ShadeH - 1) {
		y0 = _ShadeH - 1;
		y1 = y0;
		ty = 0.0f;
	}

	float s00 = Unpack_Shade(grid[y0 * _ShadeW + x0]);
	float s10 = Unpack_Shade(grid[y0 * _ShadeW + x1]);
	float s01 = Unpack_Shade(grid[y1 * _ShadeW + x0]);
	float s11 = Unpack_Shade(grid[y1 * _ShadeW + x1]);
	float s0 = s00 + (s10 - s00) * tx;
	float s1 = s01 + (s11 - s01) * tx;
	return(s0 + (s1 - s0) * ty);
}


static void Fetch_Shade(float wx, float wy, float wz, float & sun, float & ao)
{
	(void)wz;
	if (!_ShadeReady || _ShadeW < 1 || _ShadeH < 1) {
		sun = 1.0f;
		ao = 1.0f;
		return;
	}

	float fx = (wx / (float)CELL_LEPTON_W - (float)_ShadeOX) * (float)_ShadeScale - 0.5f;
	float fy = (wy / (float)CELL_LEPTON_H - (float)_ShadeOY) * (float)_ShadeScale - 0.5f;
	sun = Sample_Shade_Byte(_ShadeSun, fx, fy);
	ao = Sample_Shade_Byte(_ShadeAo, fx, fy);
}


static void Apply_Mouse_Light(int & r, int & g, int & b, RemasterCorner const & corner, bool textured)
{
	if (!_MouseLight) {
		return;
	}

	float dx = _MouseX - corner.X;
	float dy = _MouseY - corner.Y;
	float dz = _MouseZ - corner.Z;
	float dist2 = dx * dx + dy * dy + dz * dz;
	float t = dist2 / (LAMP_RADIUS * LAMP_RADIUS);
	if (t >= 1.0f) {
		return;
	}

	float atten = (1.0f - t) * (1.0f - t);
	float inv = 1.0f / std::sqrt(dist2 + 1.0f);
	float ndotl = corner.NX * dx * inv + corner.NY * dy * inv + corner.NZ * dz * inv;
	if (ndotl < 0.0f) {
		return;
	}

	float lamp = atten * ndotl;
	if (lamp > 0.08f) {
		lamp *= Occlusion_Along(corner.X, corner.Y, corner.Z, dx, dy, dz, 3, (float)CELL_LEPTON_W * 0.45f);
	}
	if (lamp < 0.01f) {
		return;
	}

	if (textured) {
		r = (int)(r * (1.0f + 0.95f * lamp) + 95.0f * lamp + 0.5f);
		g = (int)(g * (1.0f + 0.75f * lamp) + 58.0f * lamp + 0.5f);
		b = (int)(b * (1.0f + 0.32f * lamp) + 16.0f * lamp + 0.5f);
	} else {
		r = (int)(r * (1.0f + 1.45f * lamp) + 40.0f * lamp + 0.5f);
		g = (int)(g * (1.0f + 1.20f * lamp) + 22.0f * lamp + 0.5f);
		b = (int)(b * (1.0f + 0.50f * lamp) + 6.0f * lamp + 0.5f);
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


static void Unpack_Color(unsigned int color, int & r, int & g, int & b)
{
	r = (int)(color & 0xFFu);
	g = (int)((color >> 8) & 0xFFu);
	b = (int)((color >> 16) & 0xFFu);
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


static float File_Record_Z(IsoTileRecord const * rec, float su, float sv)
{
	static double const _level_height = LEVEL_LEPTON_H;
	static double const _level_slope = _level_height / CELL_LEPTON_W;
	static struct {
		double XChange;
		double YChange;
		double Base;
		double Max;
		double Extra;
	} const _ramp_control[RAMP_COUNT - 1] = {
		{  1.0,	 0.0,	 0.0,							_level_height,					0.0 },
		{  0.0,	 1.0,	 0.0,							_level_height,					0.0 },
		{ -1.0,	 0.0,	 _level_height,					_level_height,					0.0 },
		{  0.0,	-1.0,	 _level_height,					_level_height,					0.0 },
		{  1.0,	 1.0,	-_level_height,					_level_height,					0.0 },
		{ -1.0,	 1.0,	 0.0,							_level_height,					0.0 },
		{ -1.0,	-1.0,	 _level_height,					_level_height,					0.0 },
		{  1.0,	-1.0,	 0.0,							_level_height,					0.0 },
		{  1.0,	 1.0,	 0.0,							_level_height,					0.0 },
		{ -1.0,	 1.0,	 _level_height,					_level_height,					0.0 },
		{ -1.0,	-1.0,	 _level_height + _level_height, _level_height,					0.0 },
		{  1.0,	-1.0,	 _level_height,					_level_height,					0.0 },
		{  1.0,	 1.0,	 0.0,							_level_height + _level_height,	0.0 },
		{ -1.0,	 1.0,	 _level_height,					_level_height + _level_height,	0.0 },
		{ -1.0,	-1.0,	 _level_height + _level_height, _level_height + _level_height,	0.0 },
		{  1.0,	-1.0,	 _level_height,					_level_height + _level_height,	0.0 },
		{  0.0,	 0.0,	 0.0,							_level_height * 0.5,			_level_height * 0.5	 },
		{  0.0,	 0.0,	 _level_height,					_level_height * 0.5,			_level_height * -0.5 },
		{  0.0,	 0.0,	 0.0,							_level_height * 0.5,			_level_height * 0.5	 },
		{  0.0,	 0.0,	 _level_height,					_level_height * 0.5,			_level_height * -0.5 }
	};

	if (rec == NULL) {
		return(0.0f);
	}

	float z = (float)rec->Height;
	int ramp = rec->RampType;
	if (ramp <= 0 || ramp >= RAMP_COUNT) {
		return(z);
	}

	ramp -= 1;
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

	int localx = (int)(su * (float)(CELL_LEPTON_W - 1) + 0.5f);
	int localy = (int)(sv * (float)(CELL_LEPTON_H - 1) + 0.5f);
	double rampheight = ((localx & (CELL_LEPTON_W - 1)) * _ramp_control[ramp].XChange * _level_slope) +
						((localy & (CELL_LEPTON_H - 1)) * _ramp_control[ramp].YChange * _level_slope) +
						_ramp_control[ramp].Base +
						_ramp_control[ramp].Extra;
	if (rampheight < 0.0) {
		rampheight = 0.0;
	}
	if (rampheight > _ramp_control[ramp].Max) {
		rampheight = _ramp_control[ramp].Max;
	}
	return(z + (float)(rampheight / _level_height));
}


static IsoTileRecord const * File_Subtile(IsoTileSet const * set, int index)
{
	if (set == NULL || index < 0 || index >= set->Tile_Count()) {
		return(NULL);
	}
	return(set->Fetch_Record_Pointer_Unsafe(index));
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
	if (width <= 0 || height <= 0 || width > _AtlasWidth) {
		return(false);
	}
	if (_ExtraX + width > _AtlasWidth) {
		_ExtraX = 0;
		_ExtraY += _ExtraRowH;
		_ExtraRowH = 0;
	}
	if (_ExtraY + height > _AtlasHeight - 2) {
		_AtlasOverflow = true;
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


static void Spread_Rgba_Rect(unsigned int * dest, int destw, int destx, int desty, int width, int height)
{
	if (dest == NULL || destw < 1 || width < 1 || height < 1) {
		return;
	}

	for (int y = 0; y < height; y++) {
		unsigned int run = 0;
		for (int x = 0; x < width; x++) {
			unsigned int & pixel = dest[(size_t)(desty + y) * (size_t)destw + (size_t)(destx + x)];
			if (pixel != 0) {
				run = pixel;
			} else if (run != 0) {
				pixel = run;
			}
		}
		run = 0;
		for (int x = width - 1; x >= 0; x--) {
			unsigned int & pixel = dest[(size_t)(desty + y) * (size_t)destw + (size_t)(destx + x)];
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
			unsigned int & pixel = dest[(size_t)(desty + y) * (size_t)destw + (size_t)(destx + x)];
			if (pixel != 0) {
				run = pixel;
			} else if (run != 0) {
				pixel = run;
			}
		}
		run = 0;
		for (int y = height - 1; y >= 0; y--) {
			unsigned int & pixel = dest[(size_t)(desty + y) * (size_t)destw + (size_t)(destx + x)];
			if (pixel != 0) {
				run = pixel;
			} else if (run != 0) {
				pixel = run;
			}
		}
	}
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
	if (_AtlasPixels.empty()) {
		return;
	}

	Spread_Rgba_Rect(_AtlasPixels.data(), _AtlasWidth, destx, desty, width, height);
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


static bool Pack_Tileset_Diffuse(RemasterTileFile & file)
{
	if (!file.HasDiffuse || file.Diffuse.empty() || file.DiffuseW < 1 || file.DiffuseH < 1) {
		return(false);
	}
	if (file.AtlasX >= 0 && file.AtlasY >= 0) {
		return(true);
	}
	if (_AtlasPixels.empty() || _AtlasWidth < 1) {
		return(false);
	}

	int destx = 0;
	int desty = 0;
	if (!Pack_Extra_Rect(file.DiffuseW, file.DiffuseH, destx, desty)) {
		return(false);
	}

	for (int y = 0; y < file.DiffuseH; y++) {
		for (int x = 0; x < file.DiffuseW; x++) {
			unsigned int pixel = file.Diffuse[(size_t)y * (size_t)file.DiffuseW + (size_t)x];
			if ((pixel & 0x00FFFFFFu) != 0) {
				pixel |= 0xFF000000u;
			}
			_AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)] = pixel;
		}
	}
	file.AtlasX = destx;
	file.AtlasY = desty;
	return(true);
}


static RemasterTileFile * Cached_Tile_File(char const * ininame, int subtile, int icon, bool & cached)
{
	char key[80];
	std::snprintf(key, sizeof(key), "%s/%d/%d", ininame, subtile, icon);
	auto found = _TileFiles.find(key);
	if (found != _TileFiles.end()) {
		cached = true;
		return(&found->second);
	}

	cached = false;
	return(&_TileFiles[key]);
}


static RemasterTileFile const * Fetch_Tile_File(CellClass const & cell)
{
	IsometricTileTypeClass * ittype = NULL;
	int icon = 0;
	int subtile = 0;
	cell.Fetch_Icon(ittype, subtile, &icon, true);
	if (ittype == NULL) {
		return(NULL);
	}

	char const * ininame = (char const *)ittype->IniName;
	bool set_cached = false;
	RemasterTileFile * set = Cached_Tile_File(ininame, -1, icon, set_cached);
	if (!set_cached && !Remaster_Read_Tile_Files(ininame, -1, icon, *set)) {
		*set = RemasterTileFile();
	}
	if (set->HasMesh || set->HasDiffuse) {
		if (set->HasDiffuse) {
			Pack_Tileset_Diffuse(*set);
		}
		return(set);
	}

	bool piece_cached = false;
	RemasterTileFile * piece = Cached_Tile_File(ininame, subtile, icon, piece_cached);
	if (!piece_cached && !Remaster_Read_Tile_Files(ininame, subtile, icon, *piece)) {
		*piece = RemasterTileFile();
	}
	if (piece->HasMesh || piece->HasDiffuse) {
		return(piece);
	}
	return(NULL);
}


static void Blit_Rgba_To_Slot(unsigned int const * src, int sw, int sh, int destx, int desty)
{
	if (src == NULL || sw <= 0 || sh <= 0) {
		return;
	}

	for (int y = 0; y < TILE_SLOT; y++) {
		int sy = y * sh / TILE_SLOT;
		for (int x = 0; x < TILE_SLOT; x++) {
			int sx = x * sw / TILE_SLOT;
			unsigned int pixel = src[sy * sw + sx];
			if ((pixel & 0xFF000000u) == 0 && (pixel & 0x00FFFFFFu) != 0) {
				pixel |= 0xFF000000u;
			}
			_AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)] = pixel;
		}
	}
}


static bool Fill_Unprojected_Rgba(CellClass const & cell, unsigned int * dest)
{
	IsometricTileTypeClass * ittype = NULL;
	int icon = 0;
	int subtile = 0;
	cell.Fetch_Icon(ittype, subtile, &icon, true);
	if (ittype == NULL || cell.Drawer == NULL || dest == NULL) {
		return(false);
	}

	IsometricTileTypeClass const * art = Tile_Variation(ittype, icon);
	if (art == NULL || art->Get_Image_Data() == NULL) {
		return(false);
	}

	IsoTileSet const * set = (IsoTileSet const *)art->Get_Image_Data();
	if (set == NULL || set->Pixel_Width() != DIAMOND_W || set->Pixel_Height() != DIAMOND_H) {
		return(false);
	}
	if (subtile < 0 || subtile >= set->Tile_Count()) {
		return(false);
	}

	IsoTileRecord const * record = set->Fetch_Record_Pointer_Unsafe(subtile);
	if (record == NULL) {
		return(false);
	}

	unsigned char diamond[DIAMOND_W * DIAMOND_H];
	Unpack_Diamond((unsigned char const *)(record + 1), diamond);
	unsigned short const * table = (unsigned short const *)cell.Drawer->Get_Translate_Table();
	if (table == NULL) {
		return(false);
	}

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
			dest[y * TILE_SLOT + x] = pixel;
		}
	}
	Spread_Rgba_Rect(dest, TILE_SLOT, 0, 0, TILE_SLOT, TILE_SLOT);
	return(true);
}


static int Count_Opaque_Slot(int destx, int desty)
{
	int count = 0;
	for (int y = 0; y < TILE_SLOT; y++) {
		for (int x = 0; x < TILE_SLOT; x++) {
			if (_AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)] != 0) {
				count += 1;
			}
		}
	}

	return(count);
}


static void Copy_Slot_Into_Gaps(int destx, int desty, int src_slot)
{
	if (src_slot < 0 || src_slot >= (int)_Slots.size()) {
		return;
	}

	int sx0 = (src_slot % ATLAS_COLS) * TILE_SLOT;
	int sy0 = (src_slot / ATLAS_COLS) * TILE_SLOT;
	for (int y = 0; y < TILE_SLOT; y++) {
		for (int x = 0; x < TILE_SLOT; x++) {
			unsigned int & dest = _AtlasPixels[(size_t)(desty + y) * (size_t)_AtlasWidth + (size_t)(destx + x)];
			if (dest != 0) {
				continue;
			}

			unsigned int src = _AtlasPixels[(size_t)(sy0 + y) * (size_t)_AtlasWidth + (size_t)(sx0 + x)];
			if (src != 0) {
				dest = src;
			}
		}
	}
}


static bool Record_Has_Extra(IsoTileRecord const * record)
{
	return(record != NULL && record->IsHasExtraData != 0 && record->ExtraWidth > 0 && record->ExtraHeight > 0);
}


static void Fill_Cliff_Top_Gaps(CellClass const & cell, int destx, int desty)
{
	Cell const id = cell.Fetch_CellID();
	int const dx[4] = { 0, 1, -1, 0 };
	int const dy[4] = { 1, 0, 0, -1 };
	int best_slot = -1;
	int best_opaque = -1;
	for (int pass = 0; pass < 2; pass++) {
		for (int i = 0; i < 4; i++) {
			Cell nid(id.X + dx[i], id.Y + dy[i]);
			if (!Map.In_Radar(nid)) {
				continue;
			}

			CellClass const & ncell = Map[nid];
			if (ncell.Height < cell.Height) {
				continue;
			}

			IsometricTileTypeClass * ittype = NULL;
			int icon = 0;
			int subtile = 0;
			ncell.Fetch_Icon(ittype, subtile, &icon, true);
			if (ittype == NULL) {
				continue;
			}

			IsometricTileTypeClass const * art = Tile_Variation(ittype, icon);
			if (art == NULL || art->Get_Image_Data() == NULL) {
				continue;
			}

			IsoTileSet const * set = (IsoTileSet const *)art->Get_Image_Data();
			bool has_extra = Record_Has_Extra(File_Subtile(set, subtile));
			if (pass == 0 && has_extra) {
				continue;
			}

			int ns = Bake_Tile_Slot(ncell);
			if (ns < 0) {
				continue;
			}

			int opaque = Count_Opaque_Slot((ns % ATLAS_COLS) * TILE_SLOT, (ns / ATLAS_COLS) * TILE_SLOT);
			if (opaque > best_opaque) {
				best_opaque = opaque;
				best_slot = ns;
			}
		}
		if (best_slot >= 0 && pass == 0) {
			break;
		}
	}
	if (best_slot >= 0) {
		Copy_Slot_Into_Gaps(destx, desty, best_slot);
	}
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
		if ((int)_Slots.size() >= ATLAS_MAX_SLOTS) {
			_AtlasOverflow = true;
		}
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
	RemasterTileFile const * replace = Fetch_Tile_File(cell);
	if (replace != NULL && replace->HasDiffuse && !replace->IsSet) {
		Blit_Rgba_To_Slot(replace->Diffuse.data(), replace->DiffuseW, replace->DiffuseH, destx, desty);
	}
	if (record->IsHasExtraData && record->ExtraWidth > 0 && record->ExtraHeight > 0 && !cell.Is_Tile_Ramp()) {
		if (Count_Opaque_Slot(destx, desty) < TILE_SLOT * TILE_SLOT * 3 / 4) {
			Fill_Cliff_Top_Gaps(cell, destx, desty);
		}
	}
	Spread_Opaque(destx, desty, TILE_SLOT, TILE_SLOT);

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
	slot.ExtraCropX = 0;
	slot.ExtraCropY = 0;
	slot.ExtraCropW = 0;
	slot.ExtraCropH = 0;
	slot.BlitDX = 0;
	slot.BlitDY = 0;

	if (record->IsHasExtraData && record->ExtraWidth > 0 && record->ExtraHeight > 0 && record->ExtraOffset > 0) {
		int ex = 0;
		int ey = 0;
		if (Pack_Extra_Rect(record->ExtraWidth, record->ExtraHeight, ex, ey)) {
			unsigned char const * extra = (unsigned char const *)record + record->ExtraOffset;
			int x0 = record->ExtraWidth;
			int y0 = record->ExtraHeight;
			int x1 = -1;
			int y1 = -1;
			for (int y = 0; y < record->ExtraHeight; y++) {
				for (int x = 0; x < record->ExtraWidth; x++) {
					unsigned char src = extra[y * record->ExtraWidth + x];
					unsigned int pixel = 0;
					if (src != 0) {
						pixel = Pixel_565_To_BGRA(table[src]);
						if (x < x0) {
							x0 = x;
						}
						if (y < y0) {
							y0 = y;
						}
						if (x > x1) {
							x1 = x;
						}
						if (y > y1) {
							y1 = y;
						}
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
			if (x1 >= 0) {
				slot.ExtraCropX = x0;
				slot.ExtraCropY = y0;
				slot.ExtraCropW = x1 - x0 + 1;
				slot.ExtraCropH = y1 - y0 + 1;
			}
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


static void Extra_Atlas_UV(int slot, int corner, float & u, float & v)
{
	if (slot < 0 || slot >= (int)_Slots.size() || _Slots[slot].ExtraW < 1 || _Slots[slot].ExtraH < 1) {
		White_UV(u, v);
		return;
	}

	AtlasSlot const & packed = _Slots[slot];
	float x = (float)packed.ExtraX + 0.5f;
	float y = (float)packed.ExtraY + 0.5f;
	if (corner == 1 || corner == 2) {
		x += (float)(packed.ExtraW - 1);
	}
	if (corner >= 2) {
		y += (float)(packed.ExtraH - 1);
	}
	u = x / (float)_AtlasWidth;
	v = y / (float)_AtlasHeight;
}


static void Extra_Wall_UV(int slot, float edge_t, float drop_t, float & u, float & v)
{
	if (slot < 0 || slot >= (int)_Slots.size() || _Slots[slot].ExtraCropW < 1 || _Slots[slot].ExtraCropH < 1) {
		White_UV(u, v);
		return;
	}

	AtlasSlot const & packed = _Slots[slot];
	u = ((float)(packed.ExtraX + packed.ExtraCropX) + 0.5f + edge_t * ((float)packed.ExtraCropW - 1.0f)) / (float)_AtlasWidth;
	v = ((float)(packed.ExtraY + packed.ExtraCropY) + 0.5f + drop_t * ((float)packed.ExtraCropH - 1.0f)) / (float)_AtlasHeight;
}


static float Clamp_01(float value)
{
	if (value < 0.0f) {
		return(0.0f);
	}
	if (value > 1.0f) {
		return(1.0f);
	}

	return(value);
}


static bool Extra_Corner_In_Crop(int slot, Rect const & extra, RemasterCorner const & corner)
{
	if (slot < 0 || slot >= (int)_Slots.size() || _Slots[slot].ExtraCropW < 1 || _Slots[slot].ExtraCropH < 1 || extra.Width < 1 || extra.Height < 1) {
		return(false);
	}

	AtlasSlot const & packed = _Slots[slot];
	float tu = (corner.SX - ((float)extra.X + (float)packed.ExtraCropX)) / (float)packed.ExtraCropW;
	float tv = (corner.SY - ((float)extra.Y + (float)packed.ExtraCropY)) / (float)packed.ExtraCropH;
	return(tu >= 0.0f && tu <= 1.0f && tv >= 0.0f && tv <= 1.0f);
}


static void Extra_Projected_UV(int slot, Rect const & extra, RemasterCorner const & corner, float & u, float & v)
{
	if (slot < 0 || slot >= (int)_Slots.size() || _Slots[slot].ExtraW < 1 || _Slots[slot].ExtraH < 1 || extra.Width < 1 || extra.Height < 1) {
		White_UV(u, v);
		return;
	}

	AtlasSlot const & packed = _Slots[slot];
	if (packed.ExtraCropW < 1 || packed.ExtraCropH < 1) {
		White_UV(u, v);
		return;
	}

	float cx = (float)extra.X + (float)packed.ExtraCropX;
	float cy = (float)extra.Y + (float)packed.ExtraCropY;
	float tu = Clamp_01((corner.SX - cx) / (float)packed.ExtraCropW);
	float tv = Clamp_01((corner.SY - cy) / (float)packed.ExtraCropH);
	u = ((float)(packed.ExtraX + packed.ExtraCropX) + 0.5f + tu * ((float)packed.ExtraCropW - 1.0f)) / (float)_AtlasWidth;
	v = ((float)(packed.ExtraY + packed.ExtraCropY) + 0.5f + tv * ((float)packed.ExtraCropH - 1.0f)) / (float)_AtlasHeight;
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


static void Fill_Cell_Chroma(CellClass const & cell, unsigned short * bits, int stride, Rect const & cliprect)
{
	Rect render = cell.Cell_Render_Rect();
	if (!render.Is_Valid()) {
		return;
	}

	Fill_Chroma_Rect(bits, stride, cliprect, render.X, render.Y, render.X + render.Width - 1, render.Y + render.Height - 1);
	Rect extra;
	if (Extra_Screen_Rect(cell, extra)) {
		Fill_Chroma_Rect(bits, stride, cliprect, extra.X, extra.Y, extra.X + extra.Width - 1, extra.Y + extra.Height - 1);
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
	float tile = cell.TileBrightness / 1000.0f;
	if (tile < 0.0f) {
		tile = 0.0f;
	} else if (tile > 1.5f) {
		tile = 1.5f;
	}
	brightness = 0.70f + 0.30f * tile;
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
	float sun = 1.0f;
	float ao = 1.0f;
	Fetch_Shade(corner.X, corner.Y, corner.Z, sun, ao);
	float sky = 0.28f + 0.72f * corner.NZ;
	if (sky < 0.20f) {
		sky = 0.20f;
	}
	float ndotl = corner.NX * SUN_X + corner.NY * SUN_Y + corner.NZ * SUN_Z;
	if (ndotl < 0.0f) {
		ndotl = 0.0f;
	}

	float wrap = 0.38f + 0.62f * ndotl;
	float vis = sun * (0.72f + 0.28f * ao);
	float shade;
	if (lighting_only) {
		shade = (0.20f * sky + 0.80f * wrap * vis) * brightness;
	} else if (apply_sun) {
		shade = (0.16f * sky + 0.84f * wrap * vis) * brightness;
	} else {
		shade = (0.22f * sky + 0.78f * vis) * brightness;
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
	return(Pack_Color(lr, lg, lb));
}


static void Emit_Triangle(RemasterCorner const & a, RemasterCorner const & b, RemasterCorner const & c, int r, int g, int bl, float brightness, unsigned short * chroma, int stride, Rect const & cliprect, float ua, float va, float ub, float vb, float uc, float vc, bool apply_sun, bool lighting_only)
{
	if (chroma != NULL) {
		Fill_Chroma_Triangle(chroma, stride, cliprect, a, b, c);
		return;
	}

	unsigned int color = Lit_Color(r, g, bl, brightness, a, apply_sun, lighting_only);
	_BaseVerts.push_back(Make_Terrain_Vertex(a, color, ua, va));
	_VertLayer.push_back((unsigned char)_EmitLayer);
	LampSample sample;
	sample.X = a.X;
	sample.Y = a.Y;
	sample.Z = a.Z;
	sample.NX = a.NX;
	sample.NY = a.NY;
	sample.NZ = a.NZ;
	sample.Base = color;
	_LampSamples.push_back(sample);

	color = Lit_Color(r, g, bl, brightness, b, apply_sun, lighting_only);
	_BaseVerts.push_back(Make_Terrain_Vertex(b, color, ub, vb));
	_VertLayer.push_back((unsigned char)_EmitLayer);
	sample.X = b.X;
	sample.Y = b.Y;
	sample.Z = b.Z;
	sample.NX = b.NX;
	sample.NY = b.NY;
	sample.NZ = b.NZ;
	sample.Base = color;
	_LampSamples.push_back(sample);

	color = Lit_Color(r, g, bl, brightness, c, apply_sun, lighting_only);
	_BaseVerts.push_back(Make_Terrain_Vertex(c, color, uc, vc));
	_VertLayer.push_back((unsigned char)_EmitLayer);
	sample.X = c.X;
	sample.Y = c.Y;
	sample.Z = c.Z;
	sample.NX = c.NX;
	sample.NY = c.NY;
	sample.NZ = c.NZ;
	sample.Base = color;
	_LampSamples.push_back(sample);
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


static RemasterCorner Mix_Corner(RemasterCorner const & a, RemasterCorner const & b, float t)
{
	RemasterCorner out = a;
	out.X = a.X + (b.X - a.X) * t;
	out.Y = a.Y + (b.Y - a.Y) * t;
	out.Z = a.Z + (b.Z - a.Z) * t;
	out.SX = a.SX + (b.SX - a.SX) * t;
	out.SY = a.SY + (b.SY - a.SY) * t;
	return(out);
}


static int Extra_Slot_Around(CellClass const & cell, int slot, CellClass const * & owner)
{
	owner = &cell;
	if (slot >= 0 && slot < (int)_Slots.size() && _Slots[slot].ExtraCropW > 0) {
		return(slot);
	}

	Cell const id = cell.Fetch_CellID();
	int const dx[4] = { 1, -1, 0, 0 };
	int const dy[4] = { 0, 0, 1, -1 };
	for (int i = 0; i < 4; i++) {
		Cell nid(id.X + dx[i], id.Y + dy[i]);
		if (!Map.In_Radar(nid)) {
			continue;
		}

		CellClass const & ncell = Map[nid];
		if (ncell.ITType != cell.ITType) {
			continue;
		}

		int ns = Bake_Tile_Slot(ncell);
		if (ns >= 0 && ns < (int)_Slots.size() && _Slots[ns].ExtraCropW > 0) {
			owner = &ncell;
			return(ns);
		}
	}

	return(slot);
}


static void Emit_Drop_Face(RemasterCorner const & high_a, RemasterCorner const & high_b, Cell const & neighbor, int nlocal_ax, int nlocal_ay, int nlocal_bx, int nlocal_by, int r, int g, int b, float brightness, unsigned short * chroma, int stride, Rect const & cliprect, int extra_slot, CellClass const * extra_cell)
{
	if (!Map.In_Radar(neighbor)) {
		return;
	}

	CellClass const & ncell = Map[neighbor];
	float za = (float)Own_Height(ncell, nlocal_ax, nlocal_ay);
	float zb = (float)Own_Height(ncell, nlocal_bx, nlocal_by);
	if (za > high_a.Z) {
		za = high_a.Z;
	}
	if (zb > high_b.Z) {
		zb = high_b.Z;
	}
	float drop = std::max(high_a.Z - za, high_b.Z - zb);
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

	int band;
	for (band = 0; band < WALL_DIVS; band++) {
		float t0 = (float)band / (float)WALL_DIVS;
		float t1 = (float)(band + 1) / (float)WALL_DIVS;
		RemasterCorner top_a = Mix_Corner(wall[0], wall[3], t0);
		RemasterCorner top_b = Mix_Corner(wall[1], wall[2], t0);
		RemasterCorner bot_b = Mix_Corner(wall[1], wall[2], t1);
		RemasterCorner bot_a = Mix_Corner(wall[0], wall[3], t1);
		float va0 = va + (vd - va) * t0;
		float vb0 = vb + (vc - vb) * t0;
		float vc1 = vb + (vc - vb) * t1;
		float vd1 = va + (vd - va) * t1;
		Emit_Triangle(top_a, top_b, bot_b, wr, wg, wb, brightness, chroma, stride, cliprect, ua, va0, ub, vb0, uc, vc1, apply_sun, false);
		Emit_Triangle(top_a, bot_b, bot_a, wr, wg, wb, brightness, chroma, stride, cliprect, ua, va0, uc, vc1, ud, vd1, apply_sun, false);
		if (chroma == NULL) {
			top_a.NX = -top_a.NX;
			top_a.NY = -top_a.NY;
			top_a.NZ = -top_a.NZ;
			top_b.NX = -top_b.NX;
			top_b.NY = -top_b.NY;
			top_b.NZ = -top_b.NZ;
			bot_b.NX = -bot_b.NX;
			bot_b.NY = -bot_b.NY;
			bot_b.NZ = -bot_b.NZ;
			bot_a.NX = -bot_a.NX;
			bot_a.NY = -bot_a.NY;
			bot_a.NZ = -bot_a.NZ;
			Emit_Triangle(top_a, bot_b, top_b, wr, wg, wb, brightness, NULL, 0, cliprect, ua, va0, uc, vc1, ub, vb0, apply_sun, false);
			Emit_Triangle(top_a, bot_a, bot_b, wr, wg, wb, brightness, NULL, 0, cliprect, ua, va0, ud, vd1, uc, vc1, apply_sun, false);
		}
	}

	if (chroma != NULL || !apply_sun || extra_slot < 0 || extra_slot >= (int)_Slots.size() || _Slots[extra_slot].ExtraW < 1) {
		return;
	}

	Rect extra_rect;
	bool projected = extra_cell != NULL && Extra_Screen_Rect(*extra_cell, extra_rect)
		&& Extra_Corner_In_Crop(extra_slot, extra_rect, wall[0])
		&& Extra_Corner_In_Crop(extra_slot, extra_rect, wall[1])
		&& Extra_Corner_In_Crop(extra_slot, extra_rect, wall[2])
		&& Extra_Corner_In_Crop(extra_slot, extra_rect, wall[3]);
	if (projected) {
		Extra_Projected_UV(extra_slot, extra_rect, wall[0], ua, va);
		Extra_Projected_UV(extra_slot, extra_rect, wall[1], ub, vb);
		Extra_Projected_UV(extra_slot, extra_rect, wall[2], uc, vc);
		Extra_Projected_UV(extra_slot, extra_rect, wall[3], ud, vd);
	} else {
		Extra_Wall_UV(extra_slot, 0.0f, 0.0f, ua, va);
		Extra_Wall_UV(extra_slot, 1.0f, 0.0f, ub, vb);
		Extra_Wall_UV(extra_slot, 1.0f, 1.0f, uc, vc);
		Extra_Wall_UV(extra_slot, 0.0f, 1.0f, ud, vd);
	}
	for (band = 0; band < WALL_DIVS; band++) {
		float t0 = (float)band / (float)WALL_DIVS;
		float t1 = (float)(band + 1) / (float)WALL_DIVS;
		RemasterCorner top_a = Mix_Corner(wall[0], wall[3], t0);
		RemasterCorner top_b = Mix_Corner(wall[1], wall[2], t0);
		RemasterCorner bot_b = Mix_Corner(wall[1], wall[2], t1);
		RemasterCorner bot_a = Mix_Corner(wall[0], wall[3], t1);
		float va0 = va + (vd - va) * t0;
		float vb0 = vb + (vc - vb) * t0;
		float vc1 = vb + (vc - vb) * t1;
		float vd1 = va + (vd - va) * t1;
		Emit_Triangle(top_a, top_b, bot_b, wr, wg, wb, brightness, NULL, 0, cliprect, ua, va0, ub, vb0, uc, vc1, apply_sun, true);
		Emit_Triangle(top_a, bot_b, bot_a, wr, wg, wb, brightness, NULL, 0, cliprect, ua, va0, uc, vc1, ud, vd1, apply_sun, true);
		top_a.NX = -top_a.NX;
		top_a.NY = -top_a.NY;
		top_a.NZ = -top_a.NZ;
		top_b.NX = -top_b.NX;
		top_b.NY = -top_b.NY;
		top_b.NZ = -top_b.NZ;
		bot_b.NX = -bot_b.NX;
		bot_b.NY = -bot_b.NY;
		bot_b.NZ = -bot_b.NZ;
		bot_a.NX = -bot_a.NX;
		bot_a.NY = -bot_a.NY;
		bot_a.NZ = -bot_a.NZ;
		Emit_Triangle(top_a, bot_b, top_b, wr, wg, wb, brightness, NULL, 0, cliprect, ua, va0, uc, vc1, ub, vb0, apply_sun, true);
		Emit_Triangle(top_a, bot_a, bot_b, wr, wg, wb, brightness, NULL, 0, cliprect, ua, va0, ud, vd1, uc, vc1, apply_sun, true);
	}
}





// Extra artwork is an isometric blit, so it is drawn in that rectangle rather than stretched across the 3D wall.
static void Emit_Extra_Overlay(CellClass const & cell, int slot, RemasterCorner const & shade, int r, int g, int b, float brightness, unsigned short * chroma, int stride, Rect const & cliprect)
{
	if (chroma != NULL || slot < 0 || slot >= (int)_Slots.size() || _Slots[slot].ExtraW < 1 || _Slots[slot].ExtraH < 1) {
		return;
	}

	Rect extra;
	if (!Extra_Screen_Rect(cell, extra) || extra.Width < 1 || extra.Height < 1) {
		return;
	}

	RemasterCorner c0 = shade;
	RemasterCorner c1 = shade;
	RemasterCorner c2 = shade;
	RemasterCorner c3 = shade;
	c0.SX = (float)extra.X;
	c0.SY = (float)extra.Y;
	c1.SX = (float)(extra.X + extra.Width);
	c1.SY = (float)extra.Y;
	c2.SX = (float)(extra.X + extra.Width);
	c2.SY = (float)(extra.Y + extra.Height);
	c3.SX = (float)extra.X;
	c3.SY = (float)(extra.Y + extra.Height);
	c0.NX = c1.NX = c2.NX = c3.NX = 0.0f;
	c0.NY = c1.NY = c2.NY = c3.NY = 0.0f;
	c0.NZ = c1.NZ = c2.NZ = c3.NZ = 1.0f;
	float u0;
	float v0;
	float u1;
	float v1;
	float u2;
	float v2;
	float u3;
	float v3;
	Extra_Atlas_UV(slot, 0, u0, v0);
	Extra_Atlas_UV(slot, 1, u1, v1);
	Extra_Atlas_UV(slot, 2, u2, v2);
	Extra_Atlas_UV(slot, 3, u3, v3);
	Emit_Triangle(c0, c1, c2, r, g, b, brightness, NULL, 0, cliprect, u0, v0, u1, v1, u2, v2, true, true);
	Emit_Triangle(c0, c2, c3, r, g, b, brightness, NULL, 0, cliprect, u0, v0, u2, v2, u3, v3, true, true);
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


static bool Tileset_Footprint(CellClass const & cell, Cell & origin, int & width, int & height)
{
	IsometricTileTypeClass * ittype = NULL;
	int icon = 0;
	int subtile = 0;
	cell.Fetch_Icon(ittype, subtile, &icon, true);
	if (ittype == NULL) {
		return(false);
	}

	ittype->Get_Image_Data();
	width = ittype->Width;
	height = ittype->Height;
	IsometricTileTypeClass const * art = Tile_Variation(ittype, icon);
	IsoTileSet const * set = NULL;
	if (art != NULL) {
		set = (IsoTileSet const *)art->Get_Image_Data();
	}
	if (set != NULL) {
		width = set->Map_Width();
		height = set->Map_Height();
	}
	if (width < 1) {
		width = 1;
	}
	if (height < 1) {
		height = 1;
	}

	int sx = subtile % width;
	int sy = subtile / width;
	Cell id = cell.Fetch_CellID();
	origin = Cell(id.X - sx, id.Y - sy);
	return(true);
}


static bool Cursor_Map_Cell(Cell & cellid)
{
	if (MouseCursor == NULL || TacticalMap == NULL) {
		return(false);
	}

	Point2D mouse = Get_Mouse_Point();
	if (!TacticalRect.Is_Point_Within(mouse)) {
		return(false);
	}

	cellid = TacticalMap->Pixel_To_Cell(mouse);
	return(Map.In_Radar(cellid));
}


static bool Cursor_World_Point(float & wx, float & wy, float & wz, Cell & cellid)
{
	if (!Cursor_Map_Cell(cellid)) {
		return(false);
	}

	Point2D mouse = Get_Mouse_Point();
	wx = (float)(cellid.X * CELL_LEPTON_W + CELL_LEPTON_W / 2);
	wy = (float)(cellid.Y * CELL_LEPTON_H + CELL_LEPTON_H / 2);
	wz = (float)Map[cellid].Get_Height(Point2D(CELL_LEPTON_W / 2, CELL_LEPTON_H / 2));
	for (int i = 0; i < 4; i++) {
		int lift = Tactical::Z_Lepton_To_Pixel((LEPTON)(wz + 0.5f));
		Point2D absolute(TacticalMap->TacPixelX + mouse.X - TacticalRect.X, mouse.Y + TacticalMap->TacPixelY - TacticalRect.Y + lift);
		Point2D lepton = TacticalMap->Pixel_To_Lepton(absolute);
		Cell picked(lepton.X / CELL_LEPTON, lepton.Y / CELL_LEPTON);
		if (!Map.In_Radar(picked)) {
			break;
		}

		cellid = picked;
		Point2D local(lepton.X & (CELL_LEPTON_W - 1), lepton.Y & (CELL_LEPTON_H - 1));
		wx = (float)lepton.X;
		wy = (float)lepton.Y;
		wz = (float)Map[picked].Get_Height(local);
	}
	wz += (float)LEVEL_LEPTON_H * 0.55f;
	return(true);
}


static bool Is_Tileset_Emit_Cell(CellClass const & cell)
{
	Cell origin;
	int width = 1;
	int height = 1;
	if (!Tileset_Footprint(cell, origin, width, height)) {
		return(true);
	}

	IsometricTileTypeClass * ittype = NULL;
	int icon = 0;
	int subtile = 0;
	cell.Fetch_Icon(ittype, subtile, &icon, true);
	IsometricTileTypeClass const * art = Tile_Variation(ittype, icon);
	IsoTileSet const * set = NULL;
	if (art != NULL) {
		set = (IsoTileSet const *)art->Get_Image_Data();
	}

	Cell id = cell.Fetch_CellID();
	for (int gy = 0; gy < height; gy++) {
		for (int gx = 0; gx < width; gx++) {
			int index = gx + width * gy;
			if (set != NULL && File_Subtile(set, index) == NULL) {
				continue;
			}

			Cell otherid(origin.X + gx, origin.Y + gy);
			if (!Map.In_Radar(otherid)) {
				continue;
			}

			CellClass const & other = Map[otherid];
			if (other.ITType != cell.ITType || other.SubTile != index) {
				continue;
			}

			Rect render = other.Cell_Render_Rect();
			if (!render.Is_Valid() || !Intersect(TacticalRect, render).Is_Valid()) {
				continue;
			}
			return(otherid.X == id.X && otherid.Y == id.Y);
		}
	}
	return(subtile == 0);
}


static int Layer_For_File(RemasterTileFile const * file)
{
	if (file == NULL) {
		return(0);
	}

	int i;
	for (i = 1; i < _LayerUsed; i++) {
		if (_LayerSource[i] == file) {
			return(i);
		}
	}
	if (_LayerUsed >= REMASTER_LAYER_MAX) {
		return(0);
	}

	_LayerSource[_LayerUsed] = file;
	int layer = _LayerUsed;
	_LayerUsed += 1;
	return(layer);
}


static unsigned int Sample_Map(std::vector<unsigned int> const & pixels, int width, int height, float u, float v)
{
	if (pixels.empty() || width < 1 || height < 1) {
		return(0);
	}

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

	float fx = u * (float)(width - 1);
	float fy = v * (float)(height - 1);
	int x0 = (int)fx;
	int y0 = (int)fy;
	int x1 = x0 + 1;
	int y1 = y0 + 1;
	if (x1 > width - 1) {
		x1 = width - 1;
	}
	if (y1 > height - 1) {
		y1 = height - 1;
	}

	float tx = fx - (float)x0;
	float ty = fy - (float)y0;
	unsigned int a = pixels[(size_t)y0 * (size_t)width + (size_t)x0];
	unsigned int b = pixels[(size_t)y0 * (size_t)width + (size_t)x1];
	unsigned int c = pixels[(size_t)y1 * (size_t)width + (size_t)x0];
	unsigned int d = pixels[(size_t)y1 * (size_t)width + (size_t)x1];
	float channels[4];
	int ch;
	for (ch = 0; ch < 4; ch++) {
		int shift = ch * 8;
		float p00 = (float)((a >> shift) & 255);
		float p10 = (float)((b >> shift) & 255);
		float p01 = (float)((c >> shift) & 255);
		float p11 = (float)((d >> shift) & 255);
		channels[ch] = p00 * (1.0f - tx) * (1.0f - ty) + p10 * tx * (1.0f - ty) + p01 * (1.0f - tx) * ty + p11 * tx * ty;
	}

	unsigned int pixel = ((unsigned int)(channels[3] + 0.5f) << 24) | ((unsigned int)(channels[2] + 0.5f) << 16) | ((unsigned int)(channels[1] + 0.5f) << 8) | (unsigned int)(channels[0] + 0.5f);
	return(pixel);
}


static void Apply_Tile_Detail(RemasterTileFile const & file, float u, float v, RemasterCorner & corner, int & r, int & g, int & b, float & brightness)
{
	if (file.HasHeight && file.HeightW > 0 && file.HeightH > 0) {
		unsigned int pixel = Sample_Map(file.Height, file.HeightW, file.HeightH, u, v);
		float height = (float)(((pixel >> 16) & 255) + ((pixel >> 8) & 255) + (pixel & 255)) / (255.0f * 3.0f);
		brightness *= 0.60f + 0.40f * height;
	}

	if (file.HasNormal && file.NormalW > 0 && file.NormalH > 0) {
		unsigned int pixel = Sample_Map(file.Normal, file.NormalW, file.NormalH, u, v);
		float mx = (float)((pixel >> 16) & 255) / 127.5f - 1.0f;
		float my = (float)((pixel >> 8) & 255) / 127.5f - 1.0f;
		float mz = (float)(pixel & 255) / 127.5f - 1.0f;
		if (mz < 0.15f) {
			float remain = 1.0f - mx * mx - my * my;
			mz = remain > 0.0f ? std::sqrt(remain) : 0.15f;
		}
		float nx = corner.NX;
		float ny = corner.NY;
		float nz = corner.NZ;
		float tx = 1.0f;
		float ty = 0.0f;
		float tz = 0.0f;
		float dt = tx * nx + ty * ny + tz * nz;
		tx -= nx * dt;
		ty -= ny * dt;
		tz -= nz * dt;
		Normalize_Normal(tx, ty, tz, false);
		float bx = ny * tz - nz * ty;
		float by = nz * tx - nx * tz;
		float bz = nx * ty - ny * tx;
		Normalize_Normal(bx, by, bz, false);
		corner.NX = tx * mx + bx * my + nx * mz;
		corner.NY = ty * mx + by * my + ny * mz;
		corner.NZ = tz * mx + bz * my + nz * mz;
		Normalize_Normal(corner.NX, corner.NY, corner.NZ, false);
	}

	if (file.HasSpecular && file.SpecularW > 0 && file.SpecularH > 0) {
		unsigned int pixel = Sample_Map(file.Specular, file.SpecularW, file.SpecularH, u, v);
		float spec = (float)(((pixel >> 16) & 255) + ((pixel >> 8) & 255) + (pixel & 255)) / (255.0f * 3.0f);
		float ndotl = corner.NX * SUN_X + corner.NY * SUN_Y + corner.NZ * SUN_Z;
		if (ndotl < 0.0f) {
			ndotl = 0.0f;
		}
		float shine = spec * ndotl * ndotl * ndotl * 72.0f;
		r = std::min(r + (int)(shine + 0.5f), 255);
		g = std::min(g + (int)(shine * 0.92f + 0.5f), 255);
		b = std::min(b + (int)(shine * 0.78f + 0.5f), 255);
	}
}


static void Emit_Replacement(CellClass const & cell, RemasterTileFile const & mesh, int slot, int r, int g, int b, float brightness, unsigned short * chroma, int stride, Rect const & cliprect, bool apply_sun, bool lighting_only)
{
	Cell const id = cell.Fetch_CellID();
	float x0 = (float)(id.X * CELL_LEPTON_W);
	float y0 = (float)(id.Y * CELL_LEPTON_H);
	float z0 = (float)(cell.Height * LEVEL_LEPTON_H);
	if (mesh.IsSet) {
		IsometricTileTypeClass * ittype = NULL;
		int icon = 0;
		int subtile = 0;
		cell.Fetch_Icon(ittype, subtile, &icon, true);
		int width = 1;
		int height = 1;
		Cell origin;
		if (Tileset_Footprint(cell, origin, width, height)) {
			x0 = (float)(origin.X * CELL_LEPTON_W);
			y0 = (float)(origin.Y * CELL_LEPTON_H);
		}
		IsometricTileTypeClass const * art = Tile_Variation(ittype, icon);
		IsoTileSet const * set = NULL;
		if (art != NULL) {
			set = (IsoTileSet const *)art->Get_Image_Data();
		}
		IsoTileRecord const * rec = File_Subtile(set, subtile);
		float zref = File_Record_Z(rec, 0.5f, 0.5f);
		z0 = (float)(cell.Height * LEVEL_LEPTON_H) - zref * (float)LEVEL_LEPTON_H;
	}

	bool packed = mesh.IsSet && mesh.HasDiffuse && mesh.AtlasX >= 0 && mesh.DiffuseW > 0 && mesh.DiffuseH > 0;
	_EmitLayer = 0;

	std::size_t count = mesh.PX.size();
	for (std::size_t i = 0; i + 2 < mesh.Idx.size(); i += 3) {
		unsigned int ia = mesh.Idx[i];
		unsigned int ib = mesh.Idx[i + 1];
		unsigned int ic = mesh.Idx[i + 2];
		if (ia >= count || ib >= count || ic >= count) {
			continue;
		}

		RemasterCorner corners[3];
		float us[3];
		float vs[3];
		int cr[3];
		int cg[3];
		int cb[3];
		float bright[3];
		unsigned int ids[3] = { ia, ib, ic };
		for (int k = 0; k < 3; k++) {
			unsigned int vi = ids[k];
			float wx = x0 + mesh.PX[vi] * (float)CELL_LEPTON_W;
			float wy = y0 + mesh.PY[vi] * (float)CELL_LEPTON_H;
			float wz = z0 + mesh.PZ[vi] * (float)LEVEL_LEPTON_H;
			Project_World(wx, wy, wz, corners[k]);
			corners[k].NX = mesh.NX[vi];
			corners[k].NY = mesh.NY[vi];
			corners[k].NZ = mesh.NZ[vi];
			if (packed) {
				us[k] = ((float)mesh.AtlasX + 0.5f + mesh.U[vi] * ((float)mesh.DiffuseW - 1.0f)) / (float)_AtlasWidth;
				vs[k] = ((float)mesh.AtlasY + 0.5f + mesh.V[vi] * ((float)mesh.DiffuseH - 1.0f)) / (float)_AtlasHeight;
			} else {
				Face_UV(slot, apply_sun, corners[k], mesh.U[vi], mesh.V[vi], us[k], vs[k]);
			}
			cr[k] = r;
			cg[k] = g;
			cb[k] = b;
			bright[k] = brightness;
			if (chroma == NULL) {
				Apply_Tile_Detail(mesh, mesh.U[vi], mesh.V[vi], corners[k], cr[k], cg[k], cb[k], bright[k]);
			}
		}
		if (chroma != NULL) {
			Emit_Triangle(corners[0], corners[1], corners[2], cr[0], cg[0], cb[0], bright[0], chroma, stride, cliprect, us[0], vs[0], us[1], vs[1], us[2], vs[2], apply_sun, lighting_only);
			continue;
		}

		int k;
		for (k = 0; k < 3; k++) {
			unsigned int color = Lit_Color(cr[k], cg[k], cb[k], bright[k], corners[k], apply_sun, lighting_only);
			_BaseVerts.push_back(Make_Terrain_Vertex(corners[k], color, us[k], vs[k]));
			_VertLayer.push_back((unsigned char)_EmitLayer);
			LampSample sample;
			sample.X = corners[k].X;
			sample.Y = corners[k].Y;
			sample.Z = corners[k].Z;
			sample.NX = corners[k].NX;
			sample.NY = corners[k].NY;
			sample.NZ = corners[k].NZ;
			sample.Base = color;
			_LampSamples.push_back(sample);
		}
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
	RemasterTileFile const * replace = Fetch_Tile_File(cell);
	bool tileset_mesh = replace != NULL && replace->IsSet && replace->HasMesh && replace->AtlasX >= 0;
	if (textured && chroma == NULL && !tileset_mesh) {
		slot = Bake_Tile_Slot(cell);
	}

	bool apply_sun = textured;
	bool lighting_only = textured && slot >= 0;
	if (replace != NULL && replace->HasMesh && (!replace->IsSet || replace->AtlasX >= 0)) {
		if (replace->IsSet && !Is_Tileset_Emit_Cell(cell)) {
			return;
		}
		if (tileset_mesh) {
			lighting_only = textured;
		}
		Emit_Replacement(cell, *replace, slot, r, g, b, brightness, chroma, stride, cliprect, apply_sun, lighting_only);
		return;
	}

	int const divs = Mesh_Divs();
	RemasterCorner grid[SLOPE_DIVS_MAX + 1][SLOPE_DIVS_MAX + 1];
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
	int extra_slot = slot;
	CellClass const * extra_cell = &cell;
	if (chroma == NULL && textured) {
		extra_slot = Extra_Slot_Around(cell, slot, extra_cell);
	}
	Emit_Drop_Face(ne, se, Cell(id.X + 1, id.Y), 0, 0, 0, CELL_LEPTON_H - 1, r, g, b, brightness, chroma, stride, cliprect, extra_slot, extra_cell);
	Emit_Drop_Face(sw, se, Cell(id.X, id.Y + 1), 0, 0, CELL_LEPTON_W - 1, 0, r, g, b, brightness, chroma, stride, cliprect, extra_slot, extra_cell);
	Emit_Drop_Face(nw, sw, Cell(id.X - 1, id.Y), CELL_LEPTON_W - 1, 0, CELL_LEPTON_W - 1, CELL_LEPTON_H - 1, r, g, b, brightness, chroma, stride, cliprect, extra_slot, extra_cell);
	Emit_Drop_Face(nw, ne, Cell(id.X, id.Y - 1), 0, CELL_LEPTON_H - 1, CELL_LEPTON_W - 1, CELL_LEPTON_H - 1, r, g, b, brightness, chroma, stride, cliprect, extra_slot, extra_cell);
	RemasterCorner shade = grid[divs / 2][divs / 2];
	Emit_Extra_Overlay(cell, slot, shade, r, g, b, brightness, chroma, stride, cliprect);
}


static void Update_Mouse_Light(void)
{
	_MouseLight = false;
	Cell cellid;
	if (!Cursor_World_Point(_MouseX, _MouseY, _MouseZ, cellid)) {
		return;
	}
	_MouseLight = true;
}


static bool Mesh_Cache_Hit(void)
{
	return(_MeshValid
		&& _MeshTacX == TacticalMap->TacPixelX
		&& _MeshTacY == TacticalMap->TacPixelY
		&& _MeshClipX == TacticalRect.X
		&& _MeshClipY == TacticalRect.Y
		&& _MeshClipW == TacticalRect.Width
		&& _MeshClipH == TacticalRect.Height
		&& _MeshDens == (int)_RemasteredDensity
		&& _MeshTex == (int)_RemasteredTextures
		&& _MeshAtlas == _AtlasSerial
		&& _MeshShadeOX == _ShadeKeyOX
		&& _MeshShadeOY == _ShadeKeyOY);
}


static void Store_Mesh_Cache_Key(void)
{
	_MeshValid = true;
	_MeshTacX = TacticalMap->TacPixelX;
	_MeshTacY = TacticalMap->TacPixelY;
	_MeshClipX = TacticalRect.X;
	_MeshClipY = TacticalRect.Y;
	_MeshClipW = TacticalRect.Width;
	_MeshClipH = TacticalRect.Height;
	_MeshDens = (int)_RemasteredDensity;
	_MeshTex = (int)_RemasteredTextures;
	_MeshAtlas = _AtlasSerial;
	_MeshShadeOX = _ShadeKeyOX;
	_MeshShadeOY = _ShadeKeyOY;
}


static bool Mesh_Can_Translate(void)
{
	return(_MeshValid
		&& !_BaseVerts.empty()
		&& _MeshClipX == TacticalRect.X
		&& _MeshClipY == TacticalRect.Y
		&& _MeshClipW == TacticalRect.Width
		&& _MeshClipH == TacticalRect.Height
		&& _MeshDens == (int)_RemasteredDensity
		&& _MeshTex == (int)_RemasteredTextures
		&& _MeshAtlas == _AtlasSerial
		&& _MeshShadeOX == _ShadeKeyOX
		&& _MeshShadeOY == _ShadeKeyOY
		&& (_MeshTacX != TacticalMap->TacPixelX || _MeshTacY != TacticalMap->TacPixelY));
}


static void Shift_Screen_Verts(std::vector<RemasterTerrainVertex> & verts, float dx, float dy)
{
	for (RemasterTerrainVertex & vertex : verts) {
		vertex.X += dx;
		vertex.Y += dy;
	}
}


static void Apply_Cached_Mouse_Light(void)
{
	if (!_MouseLight) {
		return;
	}

	_TerrainVerts = _BaseVerts;
	int count = (int)_TerrainVerts.size();
	if (count != (int)_LampSamples.size()) {
		return;
	}

	int i;
	for (i = 0; i < count; i++) {
		LampSample const & sample = _LampSamples[i];
		int r;
		int g;
		int b;
		Unpack_Color(sample.Base, r, g, b);
		RemasterCorner corner;
		corner.X = sample.X;
		corner.Y = sample.Y;
		corner.Z = sample.Z;
		corner.SX = 0.0f;
		corner.SY = 0.0f;
		corner.NX = sample.NX;
		corner.NY = sample.NY;
		corner.NZ = sample.NZ;
		Apply_Mouse_Light(r, g, b, corner, _RemasteredTextures);
		_TerrainVerts[i].Color = Pack_Color(r, g, b);
	}
}


static void View_Cell_Span(int & originx, int & originy, int & xcount, int & ycount)
{
	Rect const & area = TacticalRect;
	Coord lepton = Coord(TacticalMap->Pixel_To_Lepton(Point2D(TacticalMap->TacPixelX, TacticalMap->TacPixelY) + area.Top_Left() - TacticalRect.Top_Left()), 0);
	Cell origin = lepton.As_Cell();
	originx = origin.X;
	originy = origin.Y;
	ycount = area.Height / (ISO_TILE_PIXEL_H / 2) + 17;
	xcount = area.Width / ISO_TILE_PIXEL_W + 4;
}


// Vertices interpolate this half-cell grid; per-vertex sun walks stall the remastered path.
static void Build_Shade_Map(void)
{
	if (TacticalMap == NULL) {
		_ShadeReady = false;
		_ShadeW = 0;
		_ShadeH = 0;
		return;
	}

	int originx;
	int originy;
	int xcount;
	int ycount;
	View_Cell_Span(originx, originy, xcount, ycount);
	if (_ShadeReady && _ShadeKeyOX == originx && _ShadeKeyOY == originy && _ShadeKeyXC == xcount && _ShadeKeyYC == ycount && _ShadeKeyDens == (int)_RemasteredDensity) {
		return;
	}

	_ShadeReady = false;
	_ShadeW = 0;
	_ShadeH = 0;
	_ShadeScale = SHADE_SCALE;
	int minx = originx - 2 - SHADE_REACH;
	int miny = originy - xcount - SHADE_REACH;
	int maxx = originx - 2 + ycount / 2 + xcount + SHADE_REACH;
	int maxy = originy + ycount / 2 + 2 + SHADE_REACH;
	if (minx < 0) {
		minx = 0;
	}
	if (miny < 0) {
		miny = 0;
	}
	if (maxx > MAP_CELL_W - 1) {
		maxx = MAP_CELL_W - 1;
	}
	if (maxy > MAP_CELL_H - 1) {
		maxy = MAP_CELL_H - 1;
	}
	if (minx > maxx || miny > maxy) {
		return;
	}

	_ShadeOX = minx;
	_ShadeOY = miny;
	_ShadeScale = SHADE_SCALE;
	_ShadeW = (maxx - minx + 1) * _ShadeScale;
	_ShadeH = (maxy - miny + 1) * _ShadeScale;
	std::size_t count = (std::size_t)_ShadeW * (std::size_t)_ShadeH;
	_ShadeHeight.assign(count, 0.0f);
	_ShadeValid.assign(count, 0);
	_ShadeSun.assign(count, 255);
	_ShadeAo.assign(count, 255);

	int y;
	int x;
	for (y = 0; y < _ShadeH; y++) {
		for (x = 0; x < _ShadeW; x++) {
			float cellx = (float)minx + ((float)x + 0.5f) / (float)_ShadeScale;
			float celly = (float)miny + ((float)y + 0.5f) / (float)_ShadeScale;
			int cx = (int)std::floor(cellx);
			int cy = (int)std::floor(celly);
			Cell cell(cx, cy);
			if (!Map.In_Radar(cell)) {
				continue;
			}

			int lx = (int)((cellx - (float)cx) * (float)(CELL_LEPTON_W - 1) + 0.5f);
			int ly = (int)((celly - (float)cy) * (float)(CELL_LEPTON_H - 1) + 0.5f);
			int i = y * _ShadeW + x;
			_ShadeHeight[i] = (float)Map[cell].Get_Height(Point2D(lx, ly));
			_ShadeValid[i] = 1;
		}
	}

	_ShadeReady = true;
	_ShadeKeyOX = originx;
	_ShadeKeyOY = originy;
	_ShadeKeyXC = xcount;
	_ShadeKeyYC = ycount;
	_ShadeKeyDens = (int)_RemasteredDensity;
	for (y = 0; y < _ShadeH; y++) {
		for (x = 0; x < _ShadeW; x++) {
			int i = y * _ShadeW + x;
			if (!_ShadeValid[i]) {
				continue;
			}

			_ShadeSun[i] = Pack_Shade(Sun_Shadow_Cell(x, y));
			_ShadeAo[i] = Pack_Shade(Horizon_AO_Cell(x, y));
		}
	}
}


static void Emit_Visible_Terrain(void)
{
	int originx;
	int originy;
	int xcount;
	int ycount;
	View_Cell_Span(originx, originy, xcount, ycount);
	Cell base(originx - 2, originy);
	Rect const & area = TacticalRect;

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


static void Outline_Push(std::vector<RemasterTerrainVertex> & dest, float sx, float sy, float u, float v, unsigned int color)
{
	RemasterTerrainVertex vertex;
	vertex.X = sx;
	vertex.Y = sy;
	vertex.NX = 0.0f;
	vertex.NY = 0.0f;
	vertex.NZ = 1.0f;
	vertex.U = u;
	vertex.V = v;
	vertex.Color = color;
	dest.push_back(vertex);
}


static void Outline_Edge(std::vector<RemasterTerrainVertex> & dest, float x0, float y0, float x1, float y1, float u, float v, unsigned int color)
{
	float dx = x1 - x0;
	float dy = y1 - y0;
	float len = std::sqrt(dx * dx + dy * dy);
	if (len < 0.001f) {
		return;
	}

	float px = -dy / len;
	float py = dx / len;
	float ax = x0 + px;
	float ay = y0 + py;
	float bx = x0 - px;
	float by = y0 - py;
	float cx = x1 - px;
	float cy = y1 - py;
	float dx2 = x1 + px;
	float dy2 = y1 + py;
	Outline_Push(dest, ax, ay, u, v, color);
	Outline_Push(dest, bx, by, u, v, color);
	Outline_Push(dest, cx, cy, u, v, color);
	Outline_Push(dest, ax, ay, u, v, color);
	Outline_Push(dest, cx, cy, u, v, color);
	Outline_Push(dest, dx2, dy2, u, v, color);
}


static void Append_Cursor_Outline(std::vector<RemasterTerrainVertex> & dest)
{
	Cell cellid;
	if (!Cursor_Map_Cell(cellid) || TacticalMap == NULL) {
		return;
	}

	Cell origin;
	int width = 1;
	int height = 1;
	if (!Tileset_Footprint(Map[cellid], origin, width, height)) {
		return;
	}

	IsometricTileType type = Map[cellid].ITType;
	unsigned int color = Pack_Color(255, 0, 0);
	float u = 0.0f;
	float v = 0.0f;
	if (_AtlasWidth > 2 && _AtlasHeight > 2) {
		White_UV(u, v);
	}

	for (int gy = 0; gy < height; gy++) {
		for (int gx = 0; gx < width; gx++) {
			Cell other(origin.X + gx, origin.Y + gy);
			if (!Map.In_Radar(other)) {
				continue;
			}

			CellClass const & cell = Map[other];
			if (cell.ITType != type || cell.SubTile != gx + width * gy) {
				continue;
			}

			Point2D pixel;
			if (!TacticalMap->Coord_To_Pixel(Coord_Whole(Coord(other)), pixel)) {
				continue;
			}

			float x0 = (float)(pixel.X + ISO_TILE_PIXEL_W / -2);
			float y0 = (float)(pixel.Y - LEVEL_PIXEL_H_1 * cell.Height + TacticalRect.Y);
			float nx = x0 + (float)(ISO_TILE_PIXEL_W / 2);
			float ny = y0;
			float ex = x0 + (float)ISO_TILE_PIXEL_W;
			float ey = y0 + (float)(ISO_TILE_PIXEL_H / 2);
			float sx = x0 + (float)(ISO_TILE_PIXEL_W / 2);
			float sy = y0 + (float)ISO_TILE_PIXEL_H;
			float wx = x0;
			float wy = y0 + (float)(ISO_TILE_PIXEL_H / 2);
			Outline_Edge(dest, nx, ny, ex, ey, u, v, color);
			Outline_Edge(dest, ex, ey, sx, sy, u, v, color);
			Outline_Edge(dest, sx, sy, wx, wy, u, v, color);
			Outline_Edge(dest, wx, wy, nx, ny, u, v, color);
		}
	}
}


void Remaster_Prepare_Frame(void)
{
	_TerrainClip = Rect();
	_MouseLight = false;
	_AtlasOverflow = false;
	if (!_RemasteredGraphics || TacticalMap == NULL) {
		_ShadeReady = false;
		_MeshValid = false;
		_BaseVerts.clear();
		_LampSamples.clear();
		_TerrainVerts.clear();
		Reset_Terrain_Layers();
		return;
	}

	Update_Mouse_Light();
	_TerrainClip = TacticalRect;
	Ensure_Atlas();
	Build_Shade_Map();
	if (!Mesh_Cache_Hit()) {
		if (Mesh_Can_Translate()) {
			float dx = (float)(_MeshTacX - TacticalMap->TacPixelX);
			float dy = (float)(_MeshTacY - TacticalMap->TacPixelY);
			Shift_Screen_Verts(_BaseVerts, dx, dy);
			Shift_Screen_Verts(_TerrainVerts, dx, dy);
			Store_Mesh_Cache_Key();
		} else {
			_BaseVerts.clear();
			_LampSamples.clear();
			_TerrainVerts.clear();
			Reset_Terrain_Layers();
			Emit_Visible_Terrain();
			if (_AtlasOverflow) {
				Clear_Atlas();
				Ensure_Atlas();
				_BaseVerts.clear();
				_LampSamples.clear();
				_TerrainVerts.clear();
				Reset_Terrain_Layers();
				_AtlasOverflow = false;
				Emit_Visible_Terrain();
			}
			Store_Mesh_Cache_Key();
		}
	}

	Apply_Cached_Mouse_Light();
	if (_MouseLight) {
		Append_Cursor_Outline(_TerrainVerts);
	}
}


void Remaster_Fetch_Terrain(RemasterTerrainLayer * layers, int & layercount, Rect & cliprect, bool & textured)
{
	Remaster_Prepare_Frame();
	layercount = 0;
	cliprect = Rect();
	textured = false;
	if (layers == NULL) {
		return;
	}

	std::vector<RemasterTerrainVertex> const * drawn = &_BaseVerts;
	if (_MouseLight && !_TerrainVerts.empty()) {
		drawn = &_TerrainVerts;
	}
	if (drawn->empty()) {
		return;
	}

	cliprect = _TerrainClip;
	textured = _RemasteredTextures && !_AtlasPixels.empty();
	if (textured) {
		Seal_White_Texel();
	}

	int i;
	for (i = 0; i < REMASTER_LAYER_MAX; i++) {
		_LayerOut[i].clear();
	}
	for (i = 0; i < (int)drawn->size(); i++) {
		int layer = 0;
		if (i < (int)_VertLayer.size()) {
			layer = _VertLayer[i];
			if (layer < 0 || layer >= _LayerUsed) {
				layer = 0;
			}
		}
		_LayerOut[layer].push_back((*drawn)[i]);
	}

	for (i = 0; i < _LayerUsed && layercount < REMASTER_LAYER_MAX; i++) {
		if (_LayerOut[i].empty()) {
			continue;
		}

		RemasterTerrainLayer & dest = layers[layercount];
		dest.Verts = _LayerOut[i].data();
		dest.Count = (int)_LayerOut[i].size();
		dest.Linear = false;
		if (i == 0) {
			if (textured) {
				dest.Pixels = _AtlasPixels.data();
				dest.Width = _AtlasWidth;
				dest.Height = _AtlasHeight;
				dest.Serial = _AtlasSerial;
			} else {
				dest.Pixels = NULL;
				dest.Width = 0;
				dest.Height = 0;
				dest.Serial = 0;
			}
		} else {
			RemasterTileFile const * file = _LayerSource[i];
			if (file != NULL && file->HasDiffuse) {
				dest.Pixels = file->Diffuse.data();
				dest.Width = file->DiffuseW;
				dest.Height = file->DiffuseH;
				dest.Serial = file->ImageSerial;
				dest.Linear = file->DiffuseW > TILE_SLOT || file->DiffuseH > TILE_SLOT;
				textured = true;
			} else {
				dest.Pixels = NULL;
				dest.Width = 0;
				dest.Height = 0;
				dest.Serial = 0;
			}
		}
		layercount += 1;
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
			Fill_Cell_Chroma(cell, (unsigned short *)bits, LogicalSurface->Stride(), cliprect);
			LogicalSurface->Unlock();
		}
	}

	Cell const id = cell.Fetch_CellID();
	if (cell.Smudge != SMUDGE_NONE) {
		SmudgeTypes[cell.Smudge]->Draw_It(drawpoint + Point2D(ISO_TILE_PIXEL_W / 2, TacticalRect.Y) - cliprect.TopLeft, cliprect, cell.SmudgeData, LEVEL_LEPTON_H * cell.Height, id);
	}
}


static void Push_Local_Vertex(RemasterTileFile & mesh, float x, float y, float z, float nx, float ny, float nz, float u, float v)
{
	mesh.Idx.push_back((unsigned int)mesh.PX.size());
	mesh.PX.push_back(x);
	mesh.PY.push_back(y);
	mesh.PZ.push_back(z);
	mesh.NX.push_back(nx);
	mesh.NY.push_back(ny);
	mesh.NZ.push_back(nz);
	mesh.U.push_back(u);
	mesh.V.push_back(v);
}


struct RemasterExtraBlit
{
	int Index;
	int DestX;
	int DestY;
	int Width;
	int Height;
	int CropX;
	int CropY;
	int CropW;
	int CropH;
	int BlitDX;
	int BlitDY;
};


struct ExportExtraMap
{
	RemasterExtraBlit const * extra;
	int OwnerX;
	int OwnerY;
	int OwnerHeight;
	float AtlasW;
	float AtlasH;
};


static void Fill_Unprojected_Record(IsoTileRecord const * record, unsigned short const * table, unsigned int * dest, int destw, int destx, int desty)
{
	if (record == NULL || table == NULL || dest == NULL) {
		return;
	}

	unsigned char diamond[DIAMOND_W * DIAMOND_H];
	Unpack_Diamond((unsigned char const *)(record + 1), diamond);
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
			dest[(desty + y) * destw + destx + x] = pixel;
		}
	}
	Spread_Rgba_Rect(dest, destw, destx, desty, TILE_SLOT, TILE_SLOT);
}


static void Export_Iso_Pixel(float wx, float wy, float wz, float & sx, float & sy)
{
	float iso_x = wx * (float)ISO_TILE_PIXEL_W * 0.5f + wy * (float)ISO_TILE_PIXEL_W * -0.5f;
	float iso_y = wx * (float)ISO_TILE_PIXEL_H * 0.5f + wy * (float)ISO_TILE_PIXEL_H * 0.5f;
	static float const z_pixels_per_lepton = (float)(std::sin(RAD_60) * (ISO_TILE_PIXEL_W / CELL_LEPTON_DIAG));
	sx = iso_x / (float)CELL_LEPTON;
	sy = iso_y / (float)CELL_LEPTON - wz * z_pixels_per_lepton;
}


static void Export_Wall_Vertex_UV(ExportExtraMap const & map, Cell const & id, int gx, int gy, float x, float y, float z, float z_base, float edge_t, float drop_t, float & u, float & v)
{
	if (map.extra == NULL || map.extra->CropW < 1 || map.extra->CropH < 1) {
		u = ((float)gx + 0.5f) * (float)TILE_SLOT / map.AtlasW;
		v = ((float)gy + 0.5f) * (float)TILE_SLOT / map.AtlasH;
		return;
	}

	float wx = ((float)id.X + (x - (float)gx)) * (float)CELL_LEPTON_W;
	float wy = ((float)id.Y + (y - (float)gy)) * (float)CELL_LEPTON_H;
	float wz = z * (float)LEVEL_LEPTON_H + z_base;
	float sx;
	float sy;
	Export_Iso_Pixel(wx, wy, wz, sx, sy);
	float ox;
	float oy;
	Export_Iso_Pixel((float)(map.OwnerX * CELL_LEPTON_W), (float)(map.OwnerY * CELL_LEPTON_H), 0.0f, ox, oy);
	float ex = ox - (float)(ISO_TILE_PIXEL_W / 2) + (float)map.extra->BlitDX + (float)map.extra->CropX;
	float ey = oy - (float)(LEVEL_PIXEL_H_1 * map.OwnerHeight) + (float)map.extra->BlitDY + (float)map.extra->CropY;
	float tu = (sx - ex) / (float)map.extra->CropW;
	float tv = (sy - ey) / (float)map.extra->CropH;
	if (tu < 0.0f || tu > 1.0f || tv < 0.0f || tv > 1.0f) {
		tu = edge_t;
		tv = drop_t;
	}
	u = ((float)(map.extra->DestX + map.extra->CropX) + 0.5f + tu * ((float)map.extra->CropW - 1.0f)) / map.AtlasW;
	v = ((float)(map.extra->DestY + map.extra->CropY) + 0.5f + tv * ((float)map.extra->CropH - 1.0f)) / map.AtlasH;
}


// A drop wall is often not planar; the back face keeps a textured triangle in viewers that cull.
static void Push_Export_Tri(RemasterTileFile & mesh, float x0, float y0, float z0, float x1, float y1, float z1, float x2, float y2, float z2, float nx, float ny, float nz, float u0, float v0, float u1, float v1, float u2, float v2)
{
	Push_Local_Vertex(mesh, x0, y0, z0, nx, ny, nz, u0, v0);
	Push_Local_Vertex(mesh, x1, y1, z1, nx, ny, nz, u1, v1);
	Push_Local_Vertex(mesh, x2, y2, z2, nx, ny, nz, u2, v2);
	Push_Local_Vertex(mesh, x0, y0, z0, -nx, -ny, -nz, u0, v0);
	Push_Local_Vertex(mesh, x2, y2, z2, -nx, -ny, -nz, u2, v2);
	Push_Local_Vertex(mesh, x1, y1, z1, -nx, -ny, -nz, u1, v1);
}


static void Push_Export_Wall(RemasterTileFile & mesh, ExportExtraMap const & map, Cell const & id, int gx, int gy, float z_base, float x0, float y0, float zh0, float x1, float y1, float zh1, float zl0, float zl1, float nx, float ny, float nz)
{
	if (zl0 > zh0) {
		zl0 = zh0;
	}
	if (zl1 > zh1) {
		zl1 = zh1;
	}
	if (std::max(zh0 - zl0, zh1 - zl1) < 0.5f) {
		return;
	}

	for (int band = 0; band < WALL_DIVS; band++) {
		float t0 = (float)band / (float)WALL_DIVS;
		float t1 = (float)(band + 1) / (float)WALL_DIVS;
		float za0 = zh0 + (zl0 - zh0) * t0;
		float zb0 = zh1 + (zl1 - zh1) * t0;
		float za1 = zh0 + (zl0 - zh0) * t1;
		float zb1 = zh1 + (zl1 - zh1) * t1;
		if (std::max(za0 - za1, zb0 - zb1) < 0.001f) {
			continue;
		}

		float ua0;
		float va0;
		float ub0;
		float vb0;
		float ua1;
		float va1;
		float ub1;
		float vb1;
		Export_Wall_Vertex_UV(map, id, gx, gy, x0, y0, za0, z_base, 0.0f, t0, ua0, va0);
		Export_Wall_Vertex_UV(map, id, gx, gy, x1, y1, zb0, z_base, 1.0f, t0, ub0, vb0);
		Export_Wall_Vertex_UV(map, id, gx, gy, x0, y0, za1, z_base, 0.0f, t1, ua1, va1);
		Export_Wall_Vertex_UV(map, id, gx, gy, x1, y1, zb1, z_base, 1.0f, t1, ub1, vb1);
		if (zb0 - zb1 >= 0.001f) {
			Push_Export_Tri(mesh, x0, y0, za0, x1, y1, zb0, x1, y1, zb1, nx, ny, nz, ua0, va0, ub0, vb0, ub1, vb1);
		}
		if (za0 - za1 >= 0.001f) {
			Push_Export_Tri(mesh, x0, y0, za0, x1, y1, zb1, x0, y0, za1, nx, ny, nz, ua0, va0, ub1, vb1, ua1, va1);
		}
	}
}


static bool Export_In_Set(std::vector<char> const & included, int mw, int mh, int gx, int gy)
{
	if (gx < 0 || gy < 0 || gx >= mw || gy >= mh) {
		return(false);
	}

	return(included[(std::size_t)(gx + mw * gy)] != 0);
}


static float Export_Neighbor_Z(Cell const & nid, int localx, int localy, float z_base)
{
	if (!Map.In_Radar(nid)) {
		return(1.0e9f);
	}

	return(((float)Own_Height(Map[nid], localx, localy) - z_base) / (float)LEVEL_LEPTON_H);
}


static float Export_Edge_Z(Cell const & nid, int localx, int localy, float z_base, float fallback)
{
	float z = Export_Neighbor_Z(nid, localx, localy, z_base);
	if (z > 1.0e8f) {
		return(fallback);
	}

	return(z);
}


static RemasterExtraBlit const * Find_Packed_Extra(std::vector<RemasterExtraBlit> const & extras, int index)
{
	for (RemasterExtraBlit const & blit : extras) {
		if (blit.Index == index && blit.CropW > 0 && blit.CropH > 0) {
			return(&blit);
		}
	}

	return(NULL);
}


static RemasterExtraBlit const * Extra_For_Subtile(std::vector<RemasterExtraBlit> const & extras, int mw, int mh, int gx, int gy)
{
	RemasterExtraBlit const * extra = Find_Packed_Extra(extras, gx + mw * gy);
	if (extra != NULL) {
		return(extra);
	}

	int const dx[4] = { 1, -1, 0, 0 };
	int const dy[4] = { 0, 0, 1, -1 };
	for (int i = 0; i < 4; i++) {
		int nx = gx + dx[i];
		int ny = gy + dy[i];
		if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) {
			continue;
		}

		extra = Find_Packed_Extra(extras, nx + mw * ny);
		if (extra != NULL) {
			return(extra);
		}
	}

	return(NULL);
}


// Extra artwork textures walls that drop to a neighbor. Outer walls use that neighbor's height, not a shared floor under the whole set.
static void Collect_Remaster_Subtile(CellClass const & cell, int gx, int gy, int mw, int mh, std::vector<char> const & included, float z_base, float z_floor, float atlas_w, float atlas_h, RemasterExtraBlit const * extra, RemasterTileFile & mesh)
{
	Cell const id = cell.Fetch_CellID();
	int const divs = Mesh_Divs();
	RemasterCorner grid[SLOPE_DIVS_MAX + 1][SLOPE_DIVS_MAX + 1];
	for (int j = 0; j <= divs; j++) {
		float sv = (float)j / (float)divs;
		int localy = (int)(sv * (float)(CELL_LEPTON_H - 1) + 0.5f);
		for (int i = 0; i <= divs; i++) {
			float su = (float)i / (float)divs;
			int localx = (int)(su * (float)(CELL_LEPTON_W - 1) + 0.5f);
			float z = (float)Own_Height(cell, localx, localy);
			grid[j][i].X = (float)gx + su;
			grid[j][i].Y = (float)gy + sv;
			grid[j][i].Z = (z - z_base) / (float)LEVEL_LEPTON_H;
			Corner_Normal(cell, localx, localy, grid[j][i].NX, grid[j][i].NY, grid[j][i].NZ);
		}
	}

	for (int j = 0; j < divs; j++) {
		for (int i = 0; i < divs; i++) {
			RemasterCorner const & c00 = grid[j][i];
			RemasterCorner const & c10 = grid[j][i + 1];
			RemasterCorner const & c11 = grid[j + 1][i + 1];
			RemasterCorner const & c01 = grid[j + 1][i];
			float su0 = (float)i / (float)divs;
			float sv0 = (float)j / (float)divs;
			float su1 = (float)(i + 1) / (float)divs;
			float sv1 = (float)(j + 1) / (float)divs;
			float u00 = ((float)(gx * TILE_SLOT) + 1.5f + su0 * ((float)TILE_SLOT - 3.0f)) / atlas_w;
			float v00 = ((float)(gy * TILE_SLOT) + 1.5f + sv0 * ((float)TILE_SLOT - 3.0f)) / atlas_h;
			float u10 = ((float)(gx * TILE_SLOT) + 1.5f + su1 * ((float)TILE_SLOT - 3.0f)) / atlas_w;
			float v10 = v00;
			float u11 = u10;
			float v11 = ((float)(gy * TILE_SLOT) + 1.5f + sv1 * ((float)TILE_SLOT - 3.0f)) / atlas_h;
			float u01 = u00;
			float v01 = v11;
			Push_Local_Vertex(mesh, c00.X, c00.Y, c00.Z, c00.NX, c00.NY, c00.NZ, u00, v00);
			Push_Local_Vertex(mesh, c10.X, c10.Y, c10.Z, c10.NX, c10.NY, c10.NZ, u10, v10);
			Push_Local_Vertex(mesh, c11.X, c11.Y, c11.Z, c11.NX, c11.NY, c11.NZ, u11, v11);
			Push_Local_Vertex(mesh, c00.X, c00.Y, c00.Z, c00.NX, c00.NY, c00.NZ, u00, v00);
			Push_Local_Vertex(mesh, c11.X, c11.Y, c11.Z, c11.NX, c11.NY, c11.NZ, u11, v11);
			Push_Local_Vertex(mesh, c01.X, c01.Y, c01.Z, c01.NX, c01.NY, c01.NZ, u01, v01);
		}
	}

	Cell const east_id(id.X + 1, id.Y);
	Cell const west_id(id.X - 1, id.Y);
	Cell const south_id(id.X, id.Y + 1);
	Cell const north_id(id.X, id.Y - 1);
	float zhe_n = grid[0][divs].Z;
	float zhe_s = grid[divs][divs].Z;
	float zhw_n = grid[0][0].Z;
	float zhw_s = grid[divs][0].Z;
	ExportExtraMap extra_map;
	extra_map.extra = extra;
	extra_map.OwnerX = id.X;
	extra_map.OwnerY = id.Y;
	extra_map.OwnerHeight = cell.Height;
	extra_map.AtlasW = atlas_w;
	extra_map.AtlasH = atlas_h;
	if (extra != NULL && mw > 0) {
		int egx = extra->Index % mw;
		int egy = extra->Index / mw;
		Cell owner_id(id.X - gx + egx, id.Y - gy + egy);
		extra_map.OwnerX = owner_id.X;
		extra_map.OwnerY = owner_id.Y;
		if (Map.In_Radar(owner_id)) {
			extra_map.OwnerHeight = Map[owner_id].Height;
		}
	}
	Push_Export_Wall(mesh, extra_map, id, gx, gy, z_base, grid[divs][divs].X, grid[divs][divs].Y, zhe_s, grid[0][divs].X, grid[0][divs].Y, zhe_n, Export_Edge_Z(east_id, 0, CELL_LEPTON_H - 1, z_base, zhe_s), Export_Edge_Z(east_id, 0, 0, z_base, zhe_n), 1.0f, 0.0f, 0.0f);
	Push_Export_Wall(mesh, extra_map, id, gx, gy, z_base, grid[0][0].X, grid[0][0].Y, zhw_n, grid[divs][0].X, grid[divs][0].Y, zhw_s, Export_Edge_Z(west_id, CELL_LEPTON_W - 1, 0, z_base, zhw_n), Export_Edge_Z(west_id, CELL_LEPTON_W - 1, CELL_LEPTON_H - 1, z_base, zhw_s), -1.0f, 0.0f, 0.0f);
	Push_Export_Wall(mesh, extra_map, id, gx, gy, z_base, grid[divs][0].X, grid[divs][0].Y, zhw_s, grid[divs][divs].X, grid[divs][divs].Y, zhe_s, Export_Edge_Z(south_id, 0, 0, z_base, zhw_s), Export_Edge_Z(south_id, CELL_LEPTON_W - 1, 0, z_base, zhe_s), 0.0f, 1.0f, 0.0f);
	Push_Export_Wall(mesh, extra_map, id, gx, gy, z_base, grid[0][divs].X, grid[0][divs].Y, zhe_n, grid[0][0].X, grid[0][0].Y, zhw_n, Export_Edge_Z(north_id, CELL_LEPTON_W - 1, CELL_LEPTON_H - 1, z_base, zhe_n), Export_Edge_Z(north_id, 0, CELL_LEPTON_H - 1, z_base, zhw_n), 0.0f, -1.0f, 0.0f);
	(void)included;
	(void)z_floor;
}


static bool Collect_File_Tileset(CellClass const & cursor, IsometricTileTypeClass const * ittype, int icon, LightConvertClass * drawer, RemasterTileFile & mesh, std::vector<unsigned int> & rgba, int & width, int & height)
{
	mesh = RemasterTileFile();
	mesh.DiffuseW = 0;
	mesh.DiffuseH = 0;
	mesh.HasMesh = false;
	mesh.IsSet = true;
	rgba.clear();
	width = 0;
	height = 0;
	if (ittype == NULL || drawer == NULL || drawer->Get_Translate_Table() == NULL) {
		return(false);
	}

	IsometricTileTypeClass const * art = Tile_Variation(ittype, icon);
	if (art == NULL || art->Get_Image_Data() == NULL) {
		return(false);
	}

	IsoTileSet const * set = (IsoTileSet const *)art->Get_Image_Data();
	if (set == NULL || set->Map_Width() < 1 || set->Map_Height() < 1) {
		return(false);
	}
	if (set->Pixel_Width() != DIAMOND_W || set->Pixel_Height() != DIAMOND_H) {
		return(false);
	}

	int const mw = set->Map_Width();
	int const mh = set->Map_Height();
	int atlas_w = mw * TILE_SLOT;
	int extra_y = mh * TILE_SLOT;
	int extra_x = 0;
	int extra_row_h = 0;
	int atlas_h = extra_y;
	std::vector<RemasterExtraBlit> extras;
	for (int gy = 0; gy < mh; gy++) {
		for (int gx = 0; gx < mw; gx++) {
			IsoTileRecord const * record = File_Subtile(set, gx + mw * gy);
			if (record == NULL || record->IsHasExtraData == 0 || record->ExtraWidth <= 0 || record->ExtraHeight <= 0 || record->ExtraOffset <= 0) {
				continue;
			}

			if (extra_x + record->ExtraWidth > atlas_w) {
				extra_x = 0;
				extra_y += extra_row_h;
				extra_row_h = 0;
			}
			RemasterExtraBlit blit;
			blit.Index = gx + mw * gy;
			blit.DestX = extra_x;
			blit.DestY = extra_y;
			blit.Width = record->ExtraWidth;
			blit.Height = record->ExtraHeight;
			blit.CropX = 0;
			blit.CropY = 0;
			blit.CropW = record->ExtraWidth;
			blit.CropH = record->ExtraHeight;
			blit.BlitDX = record->ExtraX - record->X;
			blit.BlitDY = record->ExtraY - record->Y;
			extras.push_back(blit);
			extra_x += record->ExtraWidth;
			if (record->ExtraHeight > extra_row_h) {
				extra_row_h = record->ExtraHeight;
			}
			if (extra_y + record->ExtraHeight > atlas_h) {
				atlas_h = extra_y + record->ExtraHeight;
			}
		}
	}
	if (atlas_w <= 0 || atlas_h <= 0) {
		return(false);
	}

	rgba.assign((std::size_t)atlas_w * (std::size_t)atlas_h, 0);
	unsigned short const * table = (unsigned short const *)drawer->Get_Translate_Table();
	for (int gy = 0; gy < mh; gy++) {
		for (int gx = 0; gx < mw; gx++) {
			IsoTileRecord const * record = File_Subtile(set, gx + mw * gy);
			if (record == NULL) {
				continue;
			}
			Fill_Unprojected_Record(record, table, rgba.data(), atlas_w, gx * TILE_SLOT, gy * TILE_SLOT);
		}
	}
	for (RemasterExtraBlit & blit : extras) {
		IsoTileRecord const * record = File_Subtile(set, blit.Index);
		if (record == NULL) {
			continue;
		}
		unsigned char const * extra = (unsigned char const *)record + record->ExtraOffset;
		int x0 = blit.Width;
		int y0 = blit.Height;
		int x1 = -1;
		int y1 = -1;
		for (int y = 0; y < blit.Height; y++) {
			for (int x = 0; x < blit.Width; x++) {
				unsigned char src = extra[y * blit.Width + x];
				unsigned int pixel = 0;
				if (src != 0) {
					pixel = Pixel_565_To_BGRA(table[src]);
					if (x < x0) {
						x0 = x;
					}
					if (y < y0) {
						y0 = y;
					}
					if (x > x1) {
						x1 = x;
					}
					if (y > y1) {
						y1 = y;
					}
				}
				rgba[(std::size_t)(blit.DestY + y) * (std::size_t)atlas_w + (std::size_t)(blit.DestX + x)] = pixel;
			}
		}
		if (x1 >= 0) {
			blit.CropX = x0;
			blit.CropY = y0;
			blit.CropW = x1 - x0 + 1;
			blit.CropH = y1 - y0 + 1;
			Spread_Rgba_Rect(rgba.data(), atlas_w, blit.DestX, blit.DestY, blit.Width, blit.Height);
		} else {
			blit.CropW = 0;
			blit.CropH = 0;
		}
	}

	float const atlas_wf = (float)atlas_w;
	float const atlas_hf = (float)atlas_h;
	Cell origin;
	int foot_w = mw;
	int foot_h = mh;
	if (!Tileset_Footprint(cursor, origin, foot_w, foot_h)) {
		origin = cursor.Fetch_CellID();
		foot_w = mw;
		foot_h = mh;
	}

	float z_base = (float)(cursor.Height * LEVEL_LEPTON_H);
	if (Map.In_Radar(origin)) {
		z_base = (float)(Map[origin].Height * LEVEL_LEPTON_H);
	}

	std::vector<char> included((std::size_t)mw * (std::size_t)mh, 0);
	float z_floor = 1.0e9f;
	for (int gy = 0; gy < mh && gy < foot_h; gy++) {
		for (int gx = 0; gx < mw && gx < foot_w; gx++) {
			int index = gx + mw * gy;
			if (File_Subtile(set, index) == NULL) {
				continue;
			}

			Cell otherid(origin.X + gx, origin.Y + gy);
			if (!Map.In_Radar(otherid)) {
				continue;
			}

			CellClass const & other = Map[otherid];
			if (other.ITType != cursor.ITType || other.SubTile != index) {
				continue;
			}

			included[(std::size_t)index] = 1;
			float zmin = Export_Neighbor_Z(otherid, 0, 0, z_base);
			zmin = std::min(zmin, Export_Neighbor_Z(otherid, CELL_LEPTON_W - 1, 0, z_base));
			zmin = std::min(zmin, Export_Neighbor_Z(otherid, 0, CELL_LEPTON_H - 1, z_base));
			zmin = std::min(zmin, Export_Neighbor_Z(otherid, CELL_LEPTON_W - 1, CELL_LEPTON_H - 1, z_base));
			if (zmin < z_floor) {
				z_floor = zmin;
			}
		}
	}

	float z_top = z_floor;
	for (int gy = 0; gy < mh && gy < foot_h; gy++) {
		for (int gx = 0; gx < mw && gx < foot_w; gx++) {
			if (!Export_In_Set(included, mw, mh, gx, gy)) {
				continue;
			}

			Cell otherid(origin.X + gx, origin.Y + gy);
			float zn = Export_Neighbor_Z(Cell(otherid.X, otherid.Y - 1), CELL_LEPTON_W / 2, CELL_LEPTON_H - 1, z_base);
			float zs = Export_Neighbor_Z(Cell(otherid.X, otherid.Y + 1), CELL_LEPTON_W / 2, 0, z_base);
			float zw = Export_Neighbor_Z(Cell(otherid.X - 1, otherid.Y), CELL_LEPTON_W - 1, CELL_LEPTON_H / 2, z_base);
			float ze = Export_Neighbor_Z(Cell(otherid.X + 1, otherid.Y), 0, CELL_LEPTON_H / 2, z_base);
			if (!Export_In_Set(included, mw, mh, gx, gy - 1) && zn < z_floor) {
				z_floor = zn;
			}
			if (!Export_In_Set(included, mw, mh, gx, gy + 1) && zs < z_floor) {
				z_floor = zs;
			}
			if (!Export_In_Set(included, mw, mh, gx - 1, gy) && zw < z_floor) {
				z_floor = zw;
			}
			if (!Export_In_Set(included, mw, mh, gx + 1, gy) && ze < z_floor) {
				z_floor = ze;
			}
		}
	}

	if (z_top < 1.0e8f && z_top - z_floor < 0.5f) {
		for (RemasterExtraBlit const & blit : extras) {
			if (blit.Height < 1 || !Export_In_Set(included, mw, mh, blit.Index % mw, blit.Index / mw)) {
				continue;
			}

			float extra_floor = z_top - (float)blit.Height / (float)LEVEL_PIXEL_H;
			if (extra_floor < z_floor) {
				z_floor = extra_floor;
			}
		}
	}

	if (z_floor > 1.0e8f) {
		z_floor = 0.0f;
	}

	for (int gy = 0; gy < mh && gy < foot_h; gy++) {
		for (int gx = 0; gx < mw && gx < foot_w; gx++) {
			if (!Export_In_Set(included, mw, mh, gx, gy)) {
				continue;
			}

			RemasterExtraBlit const * extra = Extra_For_Subtile(extras, mw, mh, gx, gy);
			Collect_Remaster_Subtile(Map[Cell(origin.X + gx, origin.Y + gy)], gx, gy, mw, mh, included, z_base, z_floor, atlas_wf, atlas_hf, extra, mesh);
		}
	}

	if (mesh.Idx.size() < 3) {
		return(false);
	}

	mesh.HasMesh = true;
	width = atlas_w;
	height = atlas_h;
	return(true);
}


static void Collect_Generated_Mesh(CellClass const & cell, RemasterTileFile & mesh)
{
	mesh = RemasterTileFile();
	mesh.DiffuseW = 0;
	mesh.DiffuseH = 0;
	mesh.HasMesh = true;
	Cell const id = cell.Fetch_CellID();
	float z_base = (float)(cell.Height * LEVEL_LEPTON_H);
	std::vector<char> included(1, 1);
	float z_floor = Export_Neighbor_Z(id, 0, 0, z_base);
	z_floor = std::min(z_floor, Export_Neighbor_Z(id, CELL_LEPTON_W - 1, 0, z_base));
	z_floor = std::min(z_floor, Export_Neighbor_Z(id, 0, CELL_LEPTON_H - 1, z_base));
	z_floor = std::min(z_floor, Export_Neighbor_Z(id, CELL_LEPTON_W - 1, CELL_LEPTON_H - 1, z_base));
	z_floor = std::min(z_floor, Export_Neighbor_Z(Cell(id.X + 1, id.Y), 0, CELL_LEPTON_H / 2, z_base));
	z_floor = std::min(z_floor, Export_Neighbor_Z(Cell(id.X - 1, id.Y), CELL_LEPTON_W - 1, CELL_LEPTON_H / 2, z_base));
	z_floor = std::min(z_floor, Export_Neighbor_Z(Cell(id.X, id.Y + 1), CELL_LEPTON_W / 2, 0, z_base));
	z_floor = std::min(z_floor, Export_Neighbor_Z(Cell(id.X, id.Y - 1), CELL_LEPTON_W / 2, CELL_LEPTON_H - 1, z_base));
	if (z_floor > 1.0e8f) {
		z_floor = 0.0f;
	}

	Collect_Remaster_Subtile(cell, 0, 0, 1, 1, included, z_base, z_floor, (float)TILE_SLOT, (float)TILE_SLOT, NULL, mesh);
}


void Remaster_Export_Tile_At_Cursor(void)
{
	if (!_RemasteredGraphics || TacticalMap == NULL || MouseCursor == NULL) {
		return;
	}

	Point2D mouse = Get_Mouse_Point();
	if (!TacticalRect.Is_Point_Within(mouse)) {
		return;
	}

	Cell cellid;
	if (!Cursor_Map_Cell(cellid)) {
		return;
	}

	CellClass & cell = Map[cellid];
	if (cell.Drawer == NULL) {
		cell.Init_Drawer(NULL);
	}

	IsometricTileTypeClass * ittype = NULL;
	int icon = 0;
	int subtile = 0;
	cell.Fetch_Icon(ittype, subtile, &icon, true);
	if (ittype == NULL) {
		return;
	}

	RemasterTileFile mesh;
	std::vector<unsigned int> pixels;
	int width = 0;
	int height = 0;
	if (!Collect_File_Tileset(cell, ittype, icon, cell.Drawer, mesh, pixels, width, height)) {
		Collect_Generated_Mesh(cell, mesh);
		mesh.IsSet = true;
		pixels.assign(TILE_SLOT * TILE_SLOT, 0);
		if (!Fill_Unprojected_Rgba(cell, pixels.data())) {
			return;
		}
		width = TILE_SLOT;
		height = TILE_SLOT;
	}

	std::string written;
	if (!Remaster_Write_Tile_Files(ittype->IniName, -1, icon, mesh, pixels.data(), width, height, written)) {
		if (PlayerPtr != NULL) {
			Session.Messages.Add_Message(NULL, 0, Fetch_String(TXT_REMASTER_TILE_EXPORT_FAIL), PlayerPtr->Scheme, TextPrintType(TPF_6PT_GRAD | TPF_USE_GRAD_PAL | TPF_FULLSHADOW), TICKS_PER_SECOND * 4);
		}
		return;
	}

	_TileFiles.clear();
	_MeshValid = false;
	if (PlayerPtr != NULL) {
		char buffer[512];
		std::snprintf(buffer, sizeof(buffer), Fetch_String(TXT_REMASTER_TILE_EXPORTED), written.c_str());
		Session.Messages.Add_Message(NULL, 0, buffer, PlayerPtr->Scheme, TextPrintType(TPF_6PT_GRAD | TPF_USE_GRAD_PAL | TPF_FULLSHADOW), TICKS_PER_SECOND * 6);
	}
	Map.Flag_To_Redraw();
}
