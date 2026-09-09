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
	std::vector<unsigned int> Normal;
	std::vector<unsigned int> Specular;
	std::vector<unsigned int> Height;
	std::string MeshPath;
	std::string DiffusePath;
	int DiffuseW;
	int DiffuseH;
	int NormalW;
	int NormalH;
	int SpecularW;
	int SpecularH;
	int HeightW;
	int HeightH;
	int AtlasX = -1;
	int AtlasY = -1;
	unsigned int ImageSerial = 0;
	unsigned long long MeshWriteTime;
	unsigned long long DiffuseWriteTime;
	bool HasMesh = false;
	bool HasDiffuse = false;
	bool HasNormal = false;
	bool HasSpecular = false;
	bool HasHeight = false;
	bool IsSet = false;
};


bool Remaster_Read_Tile_Files(char const * ininame, int subtile, int icon, RemasterTileFile & out);
bool Remaster_Write_Tile_Files(char const * ininame, int subtile, int icon, RemasterTileFile const & mesh, unsigned int const * rgba, int width, int height, std::string & written);
