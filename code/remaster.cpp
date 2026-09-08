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
#include "cell.h"
#include "coord.h"
#include "globals.h"
#include "gscreen.h"
#include "isotype.h"
#include "rgb.h"
#include "smudtype.h"
#include "smudge.hh"
#include "surface.h"
#include "tactical.h"

#include <algorithm>
#include <cmath>
#include <vector>


static bool _RemasteredGraphics = false;
static std::vector<RemasterTerrainVertex> _TerrainVerts;
static Rect _TerrainClip;


// Magenta in the 565 frame is discarded so the GPU terrain shows through.
static unsigned short const REMASTER_CHROMA = 0xF81F;


bool Remastered_Graphics(void)
{
	return(_RemasteredGraphics);
}


void Toggle_Remastered_Graphics(void)
{
	_RemasteredGraphics = !_RemasteredGraphics;
	if (!_RemasteredGraphics) {
		_TerrainVerts.clear();
		_TerrainClip = Rect();
	}
	Map.Flag_To_Redraw(GS_REDRAW_ALL);
}


struct RemasterCorner
{
	float X;
	float Y;
	float Z;
	int SX;
	int SY;
	float NX;
	float NY;
	float NZ;
};


static void Normalize_Normal(float & nx, float & ny, float & nz)
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
	if (nz < 0.0f) {
		nx = -nx;
		ny = -ny;
		nz = -nz;
	}
}


static void Project_Corner(Cell const & cell, Point2D const & local, RemasterCorner & vertex)
{
	CellClass const & owner = Map[cell];
	LEPTON height = owner.Get_Height(local);
	vertex.X = (float)(cell.X * CELL_LEPTON_W + local.X);
	vertex.Y = (float)(cell.Y * CELL_LEPTON_H + local.Y);
	vertex.Z = (float)height;

	Coord world((int)vertex.X, (int)vertex.Y, height);
	Point2D screen = TacticalMap->Coord_To_Pixel_Absolute(world);
	screen -= Point2D(TacticalMap->TacPixelX, TacticalMap->TacPixelY);
	vertex.SX = screen.X;
	vertex.SY = screen.Y + TacticalRect.Y;
}


static void Corner_Normal(Cell const & cell, Point2D const & local, float & nx, float & ny, float & nz)
{
	int x1 = local.X;
	int y1 = local.Y;
	int x2 = local.X + 32;
	int y2 = local.Y + 32;
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

	CellClass const & owner = Map[cell];
	float z00 = (float)owner.Get_Height(Point2D(x1, y1));
	float z10 = (float)owner.Get_Height(Point2D(x2, y1));
	float z01 = (float)owner.Get_Height(Point2D(x1, y2));

	float dx = (float)(x2 - x1);
	float dy = (float)(y2 - y1);
	float dzx = z10 - z00;
	float dzy = z01 - z00;

	nx = -dy * dzx;
	ny = dx * dzy;
	nz = dx * dy;
	Normalize_Normal(nx, ny, nz);
}


static unsigned int Pack_Color(int r, int g, int b, float brightness)
{
	r = (int)(r * brightness + 0.5f);
	g = (int)(g * brightness + 0.5f);
	b = (int)(b * brightness + 0.5f);
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


static RemasterTerrainVertex Make_Terrain_Vertex(RemasterCorner const & corner, unsigned int color)
{
	RemasterTerrainVertex vertex;
	vertex.X = (float)corner.SX;
	vertex.Y = (float)corner.SY;
	vertex.NX = corner.NX;
	vertex.NY = corner.NY;
	vertex.NZ = corner.NZ;
	vertex.Color = color;
	return(vertex);
}


static void Append_Cell_Terrain(CellClass const & cell)
{
	int r = 0;
	int g = 0;
	int b = 0;
	float brightness = 1.0f;
	Cell_Fill_Color(cell, r, g, b, brightness);
	unsigned int color = Pack_Color(r, g, b, brightness);

	Cell const id = cell.Fetch_CellID();
	RemasterCorner corners[4];
	Project_Corner(id, Point2D(0, 0), corners[0]);
	Project_Corner(id, Point2D(CELL_LEPTON_W - 1, 0), corners[1]);
	Project_Corner(id, Point2D(CELL_LEPTON_W - 1, CELL_LEPTON_H - 1), corners[2]);
	Project_Corner(id, Point2D(0, CELL_LEPTON_H - 1), corners[3]);
	Corner_Normal(id, Point2D(0, 0), corners[0].NX, corners[0].NY, corners[0].NZ);
	Corner_Normal(id, Point2D(CELL_LEPTON_W - 1, 0), corners[1].NX, corners[1].NY, corners[1].NZ);
	Corner_Normal(id, Point2D(CELL_LEPTON_W - 1, CELL_LEPTON_H - 1), corners[2].NX, corners[2].NY, corners[2].NZ);
	Corner_Normal(id, Point2D(0, CELL_LEPTON_H - 1), corners[3].NX, corners[3].NY, corners[3].NZ);

	_TerrainVerts.push_back(Make_Terrain_Vertex(corners[0], color));
	_TerrainVerts.push_back(Make_Terrain_Vertex(corners[1], color));
	_TerrainVerts.push_back(Make_Terrain_Vertex(corners[2], color));
	_TerrainVerts.push_back(Make_Terrain_Vertex(corners[0], color));
	_TerrainVerts.push_back(Make_Terrain_Vertex(corners[2], color));
	_TerrainVerts.push_back(Make_Terrain_Vertex(corners[3], color));
}


static void Fill_Chroma_Triangle(unsigned short * bits, int stride, Rect const & cliprect, RemasterCorner const & a, RemasterCorner const & b, RemasterCorner const & c)
{
	int minx = std::min(a.SX, std::min(b.SX, c.SX));
	int maxx = std::max(a.SX, std::max(b.SX, c.SX));
	int miny = std::min(a.SY, std::min(b.SY, c.SY));
	int maxy = std::max(a.SY, std::max(b.SY, c.SY));

	minx = std::max(minx, cliprect.X);
	miny = std::max(miny, cliprect.Y);
	maxx = std::min(maxx, cliprect.X + cliprect.Width - 1);
	maxy = std::min(maxy, cliprect.Y + cliprect.Height - 1);
	if (minx > maxx || miny > maxy) {
		return;
	}

	int area = (b.SX - a.SX) * (c.SY - a.SY) - (c.SX - a.SX) * (b.SY - a.SY);
	if (area == 0) {
		return;
	}

	int const pitch = stride / 2;
	for (int y = miny; y <= maxy; ++y) {
		unsigned short * row = bits + y * pitch;
		for (int x = minx; x <= maxx; ++x) {
			int w0 = (b.SX - x) * (c.SY - y) - (c.SX - x) * (b.SY - y);
			int w1 = (c.SX - x) * (a.SY - y) - (a.SX - x) * (c.SY - y);
			int w2 = (a.SX - x) * (b.SY - y) - (b.SX - x) * (a.SY - y);
			if (area > 0) {
				if (w0 < 0 || w1 < 0 || w2 < 0) {
					continue;
				}
			} else if (w0 > 0 || w1 > 0 || w2 > 0) {
				continue;
			}

			row[x] = REMASTER_CHROMA;
		}
	}
}


void Remaster_Prepare_Frame(void)
{
	_TerrainVerts.clear();
	_TerrainClip = Rect();
	if (!_RemasteredGraphics || TacticalMap == NULL) {
		return;
	}

	_TerrainClip = TacticalRect;
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
					Append_Cell_Terrain(cellref);
				}
			}
			cell += Cell(1, -1);
		}
	}
}


void Remaster_Fetch_Terrain(RemasterTerrainVertex const *& verts, int & count, Rect & cliprect)
{
	if (_TerrainVerts.empty()) {
		verts = NULL;
		count = 0;
		cliprect = Rect();
		return;
	}

	verts = _TerrainVerts.data();
	count = (int)_TerrainVerts.size();
	cliprect = _TerrainClip;
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

	Cell const id = cell.Fetch_CellID();
	RemasterCorner corners[4];
	Project_Corner(id, Point2D(0, 0), corners[0]);
	Project_Corner(id, Point2D(CELL_LEPTON_W - 1, 0), corners[1]);
	Project_Corner(id, Point2D(CELL_LEPTON_W - 1, CELL_LEPTON_H - 1), corners[2]);
	Project_Corner(id, Point2D(0, CELL_LEPTON_H - 1), corners[3]);

	if (LogicalSurface != NULL && LogicalSurface->Bytes_Per_Pixel() == 2) {
		void * bits = LogicalSurface->Lock();
		if (bits != NULL) {
			int stride = LogicalSurface->Stride();
			Fill_Chroma_Triangle((unsigned short *)bits, stride, cliprect, corners[0], corners[1], corners[2]);
			Fill_Chroma_Triangle((unsigned short *)bits, stride, cliprect, corners[0], corners[2], corners[3]);
			LogicalSurface->Unlock();
		}
	}

	if (cell.Smudge != SMUDGE_NONE) {
		SmudgeTypes[cell.Smudge]->Draw_It(drawpoint + Point2D(ISO_TILE_PIXEL_W / 2, TacticalRect.Y) - cliprect.TopLeft, cliprect, cell.SmudgeData, LEVEL_LEPTON_H * cell.Height, id);
	}
}
