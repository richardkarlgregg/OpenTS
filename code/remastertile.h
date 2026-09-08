/*******************************************************************************
 *                                O P E N  T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

#pragma once

#include <string>
#include <vector>


struct RemasterTileFile
{
	std::vector<float> PX;
	std::vector<float> PY;
	std::vector<float> PZ;
	std::vector<float> NX;
	std::vector<float> NY;
	std::vector<float> NZ;
	std::vector<float> U;
	std::vector<float> V;
	std::vector<unsigned int> Idx;
	std::vector<unsigned int> Diffuse;
	std::string MeshPath;
	std::string DiffusePath;
	int DiffuseW;
	int DiffuseH;
	unsigned long long MeshWriteTime;
	unsigned long long DiffuseWriteTime;
	bool HasMesh = false;
	bool HasDiffuse = false;
	bool IsSet = false;
};


bool Remaster_Read_Tile_Files(char const * ininame, int subtile, int icon, RemasterTileFile & out);
bool Remaster_Write_Tile_Files(char const * ininame, int subtile, int icon, RemasterTileFile const & mesh, unsigned int const * rgba, int width, int height, std::string & written);
