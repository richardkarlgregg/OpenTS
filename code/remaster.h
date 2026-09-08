/*******************************************************************************
 *                                O P E N  T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

#pragma once

#include "rect.h"

class CellClass;


struct RemasterTerrainVertex
{
	float X;
	float Y;
	float NX;
	float NY;
	float NZ;
	float U;
	float V;
	unsigned int Color;
};


bool Remastered_Graphics(void);
bool Remastered_Textures(void);
bool Remastered_Density(void);
void Toggle_Remastered_Graphics(void);
void Toggle_Remastered_Textures(void);
void Toggle_Remastered_Density(void);
void Remaster_Prepare_Frame(void);
void Remaster_Draw_Cell(CellClass & cell, Point2D const & pixel, Rect const & cliprect);
void Remaster_Export_Tile_At_Cursor(void);
void Remaster_Fetch_Terrain(RemasterTerrainVertex const *& verts, int & count, Rect & cliprect, unsigned int const *& atlas, int & atlaswidth, int & atlasheight, bool & textured, unsigned int & atlasserial);
