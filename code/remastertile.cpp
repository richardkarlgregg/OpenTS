/*******************************************************************************
 *                                O P E N  T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

#include "always.h"

#include "remastertile.h"

#include "gamedirs.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincodec.h>


static char const * TILE_FOLDER = "Remaster\\Tiles\\";


static std::string Sanitize_Name(char const * name)
{
	std::string out;
	if (name == NULL || name[0] == '\0') {
		return("tile");
	}

	for (char const * p = name; *p != '\0'; p++) {
		unsigned char ch = (unsigned char)*p;
		if (std::isalnum(ch) || ch == '-' || ch == '_') {
			out.push_back((char)ch);
		} else {
			out.push_back('_');
		}
	}
	if (out.empty()) {
		out = "tile";
	}
	return(out);
}


static std::string Join_Path(std::string const & folder, std::string const & name)
{
	if (folder.empty()) {
		return(name);
	}
	if (folder.back() == '\\' || folder.back() == '/') {
		return(folder + name);
	}
	return(folder + "\\" + name);
}


static bool File_Exists(std::string const & path)
{
	DWORD attr = GetFileAttributesA(path.c_str());
	return(attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY) == 0);
}


static unsigned long long File_Write_Time(std::string const & path)
{
	WIN32_FILE_ATTRIBUTE_DATA info;
	if (!GetFileAttributesExA(path.c_str(), GetFileExInfoStandard, &info)) {
		return(0);
	}

	ULARGE_INTEGER value;
	value.LowPart = info.ftLastWriteTime.dwLowDateTime;
	value.HighPart = info.ftLastWriteTime.dwHighDateTime;
	return(value.QuadPart);
}


static bool Ensure_Directory(std::string const & path)
{
	if (path.empty()) {
		return(false);
	}

	std::string built;
	for (std::size_t i = 0; i < path.size(); i++) {
		char ch = path[i];
		built.push_back(ch);
		if (ch == '\\' || ch == '/' || i == path.size() - 1) {
			if (built.size() >= 2 && built[built.size() - 1] == ':') {
				continue;
			}
			if (built.size() == 2 && built[1] == ':') {
				continue;
			}
			DWORD attr = GetFileAttributesA(built.c_str());
			if (attr == INVALID_FILE_ATTRIBUTES) {
				if (!CreateDirectoryA(built.c_str(), NULL) && GetLastError() != ERROR_ALREADY_EXISTS) {
					return(false);
				}
			} else if ((attr & FILE_ATTRIBUTE_DIRECTORY) == 0) {
				return(false);
			}
		}
	}
	return(true);
}


static std::string Piece_Name(int subtile, int icon)
{
	char name[32];
	if (subtile < 0) {
		if (icon != 0) {
			std::snprintf(name, sizeof(name), "tileset_i%d", icon);
		} else {
			std::snprintf(name, sizeof(name), "tileset");
		}
	} else if (icon != 0) {
		std::snprintf(name, sizeof(name), "%02d_i%d", subtile, icon);
	} else {
		std::snprintf(name, sizeof(name), "%02d", subtile);
	}
	return(name);
}


static void Stem_For(std::string const & root, char const * ininame, int subtile, int icon, std::string & stem)
{
	std::string folder = Join_Path(root, TILE_FOLDER);
	folder = Join_Path(folder, Sanitize_Name(ininame));
	stem = Join_Path(folder, Piece_Name(subtile, icon));
}


static void Candidate_Stems(char const * ininame, int subtile, int icon, std::vector<std::string> & stems)
{
	stems.clear();
	std::string userstem;
	std::string datastem;
	std::string userroot = User_File_Write_Name("");
	Stem_For(userroot, ininame, subtile, icon, userstem);
	Stem_For(Data_Directory(), ininame, subtile, icon, datastem);
	stems.push_back(userstem);
	if (icon != 0) {
		std::string fallback;
		Stem_For(userroot, ininame, subtile, 0, fallback);
		stems.push_back(fallback);
	}
	if (datastem != userstem) {
		stems.push_back(datastem);
		if (icon != 0) {
			std::string fallback;
			Stem_For(Data_Directory(), ininame, subtile, 0, fallback);
			stems.push_back(fallback);
		}
	}
}


static unsigned int Crc32(unsigned char const * data, std::size_t length)
{
	unsigned int crc = 0xFFFFFFFFu;
	for (std::size_t i = 0; i < length; i++) {
		crc ^= data[i];
		for (int bit = 0; bit < 8; bit++) {
			unsigned int mask = (unsigned int)-(int)(crc & 1u);
			crc = (crc >> 1) ^ (0xEDB88320u & mask);
		}
	}
	return(~crc);
}


static unsigned int Adler32(unsigned char const * data, std::size_t length)
{
	unsigned int a = 1;
	unsigned int b = 0;
	for (std::size_t i = 0; i < length; i++) {
		a = (a + data[i]) % 65521u;
		b = (b + a) % 65521u;
	}
	return((b << 16) | a);
}


static bool Write_All(FILE * file, void const * data, std::size_t length)
{
	return(std::fwrite(data, 1, length, file) == length);
}


static void Put_Be32(std::vector<unsigned char> & out, unsigned int value)
{
	out.push_back((unsigned char)(value >> 24));
	out.push_back((unsigned char)(value >> 16));
	out.push_back((unsigned char)(value >> 8));
	out.push_back((unsigned char)value);
}


static bool Write_Png_Chunk(FILE * file, char const * type, unsigned char const * data, std::size_t length)
{
	unsigned char len[4];
	len[0] = (unsigned char)(length >> 24);
	len[1] = (unsigned char)(length >> 16);
	len[2] = (unsigned char)(length >> 8);
	len[3] = (unsigned char)length;
	if (!Write_All(file, len, 4) || !Write_All(file, type, 4)) {
		return(false);
	}
	if (length > 0 && !Write_All(file, data, length)) {
		return(false);
	}

	std::vector<unsigned char> crcbuf;
	crcbuf.insert(crcbuf.end(), type, type + 4);
	crcbuf.insert(crcbuf.end(), data, data + length);
	unsigned int crc = Crc32(crcbuf.data(), crcbuf.size());
	unsigned char crcbytes[4];
	crcbytes[0] = (unsigned char)(crc >> 24);
	crcbytes[1] = (unsigned char)(crc >> 16);
	crcbytes[2] = (unsigned char)(crc >> 8);
	crcbytes[3] = (unsigned char)crc;
	return(Write_All(file, crcbytes, 4));
}


static void Make_Writable(std::string const & path)
{
	DWORD attr = GetFileAttributesA(path.c_str());
	if (attr == INVALID_FILE_ATTRIBUTES) {
		return;
	}

	SetFileAttributesA(path.c_str(), attr & ~(DWORD)FILE_ATTRIBUTE_READONLY);
	DeleteFileA(path.c_str());
}


static FILE * Open_Truncated(std::string const & path, char const * mode)
{
	Make_Writable(path);
	return(std::fopen(path.c_str(), mode));
}


static bool Write_Png_Bgra(std::string const & path, unsigned int const * pixels, int width, int height)
{
	if (pixels == NULL || width <= 0 || height <= 0) {
		return(false);
	}

	FILE * file = Open_Truncated(path, "wb");
	if (file == NULL) {
		return(false);
	}

	unsigned char const sig[8] = { 137, 80, 78, 71, 13, 10, 26, 10 };
	bool ok = Write_All(file, sig, 8);
	std::vector<unsigned char> ihdr;
	Put_Be32(ihdr, (unsigned int)width);
	Put_Be32(ihdr, (unsigned int)height);
	ihdr.push_back(8);
	ihdr.push_back(6);
	ihdr.push_back(0);
	ihdr.push_back(0);
	ihdr.push_back(0);
	ok = ok && Write_Png_Chunk(file, "IHDR", ihdr.data(), ihdr.size());

	std::size_t row = (std::size_t)width * 4u + 1u;
	std::vector<unsigned char> raw((std::size_t)height * row);
	for (int y = 0; y < height; y++) {
		raw[(std::size_t)y * row] = 0;
		for (int x = 0; x < width; x++) {
			unsigned int pixel = pixels[y * width + x];
			unsigned char * dest = &raw[(std::size_t)y * row + 1u + (std::size_t)x * 4u];
			dest[0] = (unsigned char)((pixel >> 16) & 255);
			dest[1] = (unsigned char)((pixel >> 8) & 255);
			dest[2] = (unsigned char)(pixel & 255);
			dest[3] = (unsigned char)((pixel >> 24) & 255);
		}
	}

	std::vector<unsigned char> zlib;
	zlib.push_back(0x78);
	zlib.push_back(0x01);
	std::size_t offset = 0;
	while (offset < raw.size()) {
		std::size_t chunk = raw.size() - offset;
		if (chunk > 65535) {
			chunk = 65535;
		}
		bool last = (offset + chunk == raw.size());
		zlib.push_back(last ? 0x01 : 0x00);
		unsigned int len = (unsigned int)chunk;
		zlib.push_back((unsigned char)(len & 255));
		zlib.push_back((unsigned char)(len >> 8));
		zlib.push_back((unsigned char)((~len) & 255));
		zlib.push_back((unsigned char)((~len) >> 8));
		zlib.insert(zlib.end(), raw.begin() + (std::ptrdiff_t)offset, raw.begin() + (std::ptrdiff_t)(offset + chunk));
		offset += chunk;
	}
	unsigned int adler = Adler32(raw.data(), raw.size());
	Put_Be32(zlib, adler);
	ok = ok && Write_Png_Chunk(file, "IDAT", zlib.data(), zlib.size());
	ok = ok && Write_Png_Chunk(file, "IEND", NULL, 0);
	std::fclose(file);
	return(ok);
}


static int const TILE_IMAGE_MAX = 4096;


static unsigned int Next_Image_Serial(void)
{
	static unsigned int serial = 1;
	unsigned int value = serial;
	serial += 1;
	if (serial == 0) {
		serial = 1;
	}
	return(value);
}


static bool Load_With_Wic(std::string const & path, std::vector<unsigned int> & pixels, int & width_out, int & height_out, int max_dim)
{
	IWICImagingFactory * factory = NULL;
	IWICBitmapDecoder * decoder = NULL;
	IWICBitmapFrameDecode * frame = NULL;
	IWICFormatConverter * converter = NULL;
	HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, NULL, CLSCTX_INPROC_SERVER, IID_IWICImagingFactory, (void **)&factory);
	if (FAILED(hr)) {
		CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
		hr = CoCreateInstance(CLSID_WICImagingFactory, NULL, CLSCTX_INPROC_SERVER, IID_IWICImagingFactory, (void **)&factory);
	}
	if (FAILED(hr) || factory == NULL) {
		return(false);
	}

	std::wstring wide(path.begin(), path.end());
	hr = factory->CreateDecoderFromFilename(wide.c_str(), NULL, GENERIC_READ, WICDecodeMetadataCacheOnDemand, &decoder);
	if (SUCCEEDED(hr)) {
		hr = decoder->GetFrame(0, &frame);
	}
	if (SUCCEEDED(hr)) {
		hr = factory->CreateFormatConverter(&converter);
	}
	if (SUCCEEDED(hr)) {
		hr = converter->Initialize(frame, GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, NULL, 0.0, WICBitmapPaletteTypeCustom);
	}

	UINT width = 0;
	UINT height = 0;
	bool ok = false;
	if (SUCCEEDED(hr)) {
		hr = converter->GetSize(&width, &height);
	}
	if (SUCCEEDED(hr) && width > 0 && height > 0 && (int)width <= max_dim && (int)height <= max_dim) {
		pixels.assign((std::size_t)width * (std::size_t)height, 0);
		hr = converter->CopyPixels(NULL, width * 4, (UINT)(pixels.size() * 4u), (BYTE *)pixels.data());
		if (SUCCEEDED(hr)) {
			width_out = (int)width;
			height_out = (int)height;
			ok = true;
		} else {
			pixels.clear();
		}
	}

	if (converter != NULL) {
		converter->Release();
	}
	if (frame != NULL) {
		frame->Release();
	}
	if (decoder != NULL) {
		decoder->Release();
	}
	factory->Release();
	return(ok);
}


static bool Load_Tga(std::string const & path, std::vector<unsigned int> & pixels, int & width_out, int & height_out, int max_dim)
{
	FILE * file = std::fopen(path.c_str(), "rb");
	if (file == NULL) {
		return(false);
	}

	unsigned char header[18];
	if (std::fread(header, 1, 18, file) != 18) {
		std::fclose(file);
		return(false);
	}

	int width = header[12] | (header[13] << 8);
	int height = header[14] | (header[15] << 8);
	int bits = header[16];
	int image = header[2];
	if ((image != 2 && image != 3) || width <= 0 || height <= 0 || width > max_dim || height > max_dim || (bits != 24 && bits != 32 && bits != 8)) {
		std::fclose(file);
		return(false);
	}

	if (header[0] > 0) {
		std::fseek(file, header[0], SEEK_CUR);
	}

	pixels.assign((std::size_t)width * (std::size_t)height, 0);
	int bpp = bits / 8;
	std::vector<unsigned char> row((std::size_t)width * (std::size_t)bpp);
	bool flip = (header[17] & 0x20) == 0;
	for (int y = 0; y < height; y++) {
		if (std::fread(row.data(), 1, row.size(), file) != row.size()) {
			std::fclose(file);
			pixels.clear();
			return(false);
		}

		int desty = flip ? (height - 1 - y) : y;
		for (int x = 0; x < width; x++) {
			unsigned char * src = &row[(std::size_t)x * (std::size_t)bpp];
			unsigned int pixel;
			if (bpp == 1) {
				pixel = 0xFF000000u | (unsigned int)src[0] * 0x00010101u;
			} else if (bpp == 3) {
				pixel = 0xFF000000u | ((unsigned int)src[2] << 16) | ((unsigned int)src[1] << 8) | src[0];
			} else {
				pixel = ((unsigned int)src[3] << 24) | ((unsigned int)src[2] << 16) | ((unsigned int)src[1] << 8) | src[0];
			}
			pixels[desty * width + x] = pixel;
		}
	}
	std::fclose(file);
	width_out = width;
	height_out = height;
	return(true);
}


static bool Load_Image_File(std::string const & path, std::vector<unsigned int> & pixels, int & width, int & height, int max_dim)
{
	return(Load_With_Wic(path, pixels, width, height, max_dim) || Load_Tga(path, pixels, width, height, max_dim));
}


static bool Load_Diffuse(std::string const & stem, RemasterTileFile & out)
{
	static char const * suffixes[] = { ".png", "_diffuse.png", ".tga", ".bmp", "_diffuse.tga" };
	for (char const * suffix : suffixes) {
		std::string path = stem + suffix;
		if (!File_Exists(path)) {
			continue;
		}

		out.HasDiffuse = false;
		if (Load_Image_File(path, out.Diffuse, out.DiffuseW, out.DiffuseH, TILE_IMAGE_MAX)) {
			out.HasDiffuse = true;
			out.DiffusePath = path;
			out.DiffuseWriteTime = File_Write_Time(path);
			out.ImageSerial = Next_Image_Serial();
			return(true);
		}
	}
	return(false);
}


static bool Load_Map_Image(std::string const & stem, char const * const * suffixes, int suffix_count, std::vector<unsigned int> & pixels, int & width, int & height)
{
	for (int i = 0; i < suffix_count; i++) {
		std::string path = stem + suffixes[i];
		if (!File_Exists(path)) {
			continue;
		}

		if (Load_Image_File(path, pixels, width, height, TILE_IMAGE_MAX)) {
			return(true);
		}
	}
	return(false);
}


static void Load_Detail_Maps(std::string const & stem, RemasterTileFile & out)
{
	static char const * normal_suffixes[] = { "_normal.png", "_normal.tga", "_normal.bmp" };
	static char const * spec_suffixes[] = { "_specular.png", "_specular.tga", "_spec.png" };
	static char const * height_suffixes[] = { "_height.png", "_height.tga", "_disp.png" };
	out.HasNormal = Load_Map_Image(stem, normal_suffixes, 3, out.Normal, out.NormalW, out.NormalH);
	out.HasSpecular = Load_Map_Image(stem, spec_suffixes, 3, out.Specular, out.SpecularW, out.SpecularH);
	out.HasHeight = Load_Map_Image(stem, height_suffixes, 3, out.Height, out.HeightW, out.HeightH);
}


static void Add_Vertex(RemasterTileFile & mesh, float x, float y, float z, float nx, float ny, float nz, float u, float v)
{
	mesh.PX.push_back(x);
	mesh.PY.push_back(y);
	mesh.PZ.push_back(z);
	mesh.NX.push_back(nx);
	mesh.NY.push_back(ny);
	mesh.NZ.push_back(nz);
	mesh.U.push_back(u);
	mesh.V.push_back(v);
}


static void Finish_Normals(RemasterTileFile & mesh)
{
	if (mesh.Idx.size() < 3) {
		return;
	}

	bool missing = mesh.NX.empty();
	if (!missing) {
		float sum = 0.0f;
		for (float n : mesh.NX) {
			sum += std::fabs(n);
		}
		for (float n : mesh.NY) {
			sum += std::fabs(n);
		}
		for (float n : mesh.NZ) {
			sum += std::fabs(n);
		}
		missing = sum < 0.001f;
	}
	if (!missing) {
		return;
	}

	std::size_t count = mesh.PX.size();
	mesh.NX.assign(count, 0.0f);
	mesh.NY.assign(count, 0.0f);
	mesh.NZ.assign(count, 0.0f);
	for (std::size_t i = 0; i + 2 < mesh.Idx.size(); i += 3) {
		unsigned int ia = mesh.Idx[i];
		unsigned int ib = mesh.Idx[i + 1];
		unsigned int ic = mesh.Idx[i + 2];
		if (ia >= count || ib >= count || ic >= count) {
			continue;
		}

		float ux = mesh.PX[ib] - mesh.PX[ia];
		float uy = mesh.PY[ib] - mesh.PY[ia];
		float uz = mesh.PZ[ib] - mesh.PZ[ia];
		float vx = mesh.PX[ic] - mesh.PX[ia];
		float vy = mesh.PY[ic] - mesh.PY[ia];
		float vz = mesh.PZ[ic] - mesh.PZ[ia];
		float nx = uy * vz - uz * vy;
		float ny = uz * vx - ux * vz;
		float nz = ux * vy - uy * vx;
		mesh.NX[ia] += nx;
		mesh.NY[ia] += ny;
		mesh.NZ[ia] += nz;
		mesh.NX[ib] += nx;
		mesh.NY[ib] += ny;
		mesh.NZ[ib] += nz;
		mesh.NX[ic] += nx;
		mesh.NY[ic] += ny;
		mesh.NZ[ic] += nz;
	}
	for (std::size_t i = 0; i < count; i++) {
		float length = std::sqrt(mesh.NX[i] * mesh.NX[i] + mesh.NY[i] * mesh.NY[i] + mesh.NZ[i] * mesh.NZ[i]);
		if (length < 0.0001f) {
			mesh.NX[i] = 0.0f;
			mesh.NY[i] = 0.0f;
			mesh.NZ[i] = 1.0f;
		} else {
			mesh.NX[i] /= length;
			mesh.NY[i] /= length;
			mesh.NZ[i] /= length;
		}
	}
}


static int Obj_Index(int value, int count)
{
	if (value > 0) {
		return(value - 1);
	}
	if (value < 0) {
		return(count + value);
	}
	return(-1);
}


static bool Load_Obj(std::string const & path, RemasterTileFile & out)
{
	FILE * file = std::fopen(path.c_str(), "r");
	if (file == NULL) {
		return(false);
	}

	std::vector<float> pos;
	std::vector<float> nrm;
	std::vector<float> uv;
	char line[512];
	while (std::fgets(line, sizeof(line), file) != NULL) {
		if (line[0] == 'v' && line[1] == ' ') {
			float x = 0.0f;
			float y = 0.0f;
			float z = 0.0f;
			if (std::sscanf(line + 2, "%f %f %f", &x, &y, &z) >= 2) {
				pos.push_back(x);
				pos.push_back(y);
				pos.push_back(z);
			}
		} else if (line[0] == 'v' && line[1] == 'n') {
			float x = 0.0f;
			float y = 0.0f;
			float z = 1.0f;
			std::sscanf(line + 2, "%f %f %f", &x, &y, &z);
			nrm.push_back(x);
			nrm.push_back(y);
			nrm.push_back(z);
		} else if (line[0] == 'v' && line[1] == 't') {
			float u = 0.0f;
			float v = 0.0f;
			std::sscanf(line + 2, "%f %f", &u, &v);
			uv.push_back(u);
			uv.push_back(1.0f - v);
		} else if (line[0] == 'f' && line[1] == ' ') {
			int vi[8];
			int ti[8];
			int ni[8];
			int corners = 0;
			char * walk = line + 2;
			while (*walk != '\0' && corners < 8) {
				while (*walk == ' ') {
					walk++;
				}
				if (*walk == '\0' || *walk == '\n') {
					break;
				}

				int v = 0;
				int t = 0;
				int n = 0;
				if (std::sscanf(walk, "%d/%d/%d", &v, &t, &n) == 3 || std::sscanf(walk, "%d/%d", &v, &t) == 2 || std::sscanf(walk, "%d//%d", &v, &n) == 2 || std::sscanf(walk, "%d", &v) == 1) {
					vi[corners] = Obj_Index(v, (int)(pos.size() / 3));
					ti[corners] = Obj_Index(t, (int)(uv.size() / 2));
					ni[corners] = Obj_Index(n, (int)(nrm.size() / 3));
					corners++;
				}
				while (*walk != '\0' && *walk != ' ') {
					walk++;
				}
			}
			for (int i = 1; i + 1 < corners; i++) {
				int idx[3] = { 0, i, i + 1 };
				for (int k = 0; k < 3; k++) {
					int corner = idx[k];
					int pv = vi[corner];
					if (pv < 0) {
						continue;
					}

					float x = pos[(std::size_t)pv * 3];
					float y = pos[(std::size_t)pv * 3 + 1];
					float z = pos[(std::size_t)pv * 3 + 2];
					float nx = 0.0f;
					float ny = 0.0f;
					float nz = 1.0f;
					if (ni[corner] >= 0) {
						nx = nrm[(std::size_t)ni[corner] * 3];
						ny = nrm[(std::size_t)ni[corner] * 3 + 1];
						nz = nrm[(std::size_t)ni[corner] * 3 + 2];
					}
					float tu = 0.0f;
					float tv = 0.0f;
					if (ti[corner] >= 0) {
						tu = uv[(std::size_t)ti[corner] * 2];
						tv = uv[(std::size_t)ti[corner] * 2 + 1];
					}
					out.Idx.push_back((unsigned int)out.PX.size());
					Add_Vertex(out, x, y, z, nx, ny, nz, tu, tv);
				}
			}
		}
	}
	std::fclose(file);
	if (out.Idx.size() < 3) {
		return(false);
	}

	Finish_Normals(out);
	out.HasMesh = true;
	out.MeshPath = path;
	out.MeshWriteTime = File_Write_Time(path);
	std::string lower = path;
	for (char & ch : lower) {
		ch = (char)std::tolower((unsigned char)ch);
	}
	out.IsSet = lower.find("tileset") != std::string::npos;
	return(true);
}


bool Remaster_Read_Tile_Files(char const * ininame, int subtile, int icon, RemasterTileFile & out)
{
	out = RemasterTileFile();
	out.DiffuseW = 0;
	out.DiffuseH = 0;
	out.NormalW = 0;
	out.NormalH = 0;
	out.SpecularW = 0;
	out.SpecularH = 0;
	out.HeightW = 0;
	out.HeightH = 0;
	out.AtlasX = -1;
	out.AtlasY = -1;
	out.ImageSerial = 0;
	out.MeshWriteTime = 0;
	out.DiffuseWriteTime = 0;
	out.HasMesh = false;
	out.HasDiffuse = false;
	out.HasNormal = false;
	out.HasSpecular = false;
	out.HasHeight = false;
	out.IsSet = false;
	out.MeshPath.clear();
	out.DiffusePath.clear();

	std::vector<std::string> stems;
	Candidate_Stems(ininame, subtile, icon, stems);
	for (std::string const & stem : stems) {
		std::string obj = stem + ".obj";
		if (!out.HasMesh && File_Exists(obj)) {
			Load_Obj(obj, out);
		}
		if (!out.HasDiffuse) {
			Load_Diffuse(stem, out);
		}
		if (out.HasMesh || out.HasDiffuse) {
			Load_Detail_Maps(stem, out);
			if (subtile < 0) {
				out.IsSet = true;
			}
			return(true);
		}
	}
	return(false);
}


static bool Write_Obj_Mtl(char const * ininame, int subtile, RemasterTileFile const & mesh, std::string const & stem, std::string const & leaf, std::string & written)
{
	std::string obj = stem + ".obj";
	std::string mtl = stem + ".mtl";

	FILE * mtfile = Open_Truncated(mtl, "w");
	if (mtfile == NULL) {
		return(false);
	}
	std::fprintf(mtfile, "newmtl tile\nKd 1 1 1\nKs 0 0 0\nmap_Kd %s.png\n", leaf.c_str());
	std::fprintf(mtfile, "map_Bump %s_normal.png\nmap_Ks %s_specular.png\ndisp %s_height.png\n", leaf.c_str(), leaf.c_str(), leaf.c_str());
	std::fclose(mtfile);

	FILE * file = Open_Truncated(obj, "w");
	if (file == NULL) {
		return(false);
	}
	std::fprintf(file, "# OpenTS remaster tile %s %s\n", Sanitize_Name(ininame).c_str(), leaf.c_str());
	if (subtile < 0 || mesh.IsSet) {
		std::fprintf(file, "# X east in cells from the north-west sub-tile, Y south in cells, Z height levels from the tile file\n");
		std::fprintf(file, "# PNG slot index is x + MapWidth*y, same as IsoTileTypeClass::SubTile_Index; row 0 is north\n");
	} else {
		std::fprintf(file, "# X east 0-1, Y south 0-1, Z height levels above the cell Height\n");
	}
	std::fprintf(file, "mtllib %s.mtl\nusemtl tile\n", leaf.c_str());
	for (std::size_t i = 0; i < mesh.PX.size(); i++) {
		std::fprintf(file, "v %.6f %.6f %.6f\n", mesh.PX[i], mesh.PY[i], mesh.PZ[i]);
	}
	for (std::size_t i = 0; i < mesh.U.size(); i++) {
		std::fprintf(file, "vt %.6f %.6f\n", mesh.U[i], 1.0f - mesh.V[i]);
	}
	for (std::size_t i = 0; i < mesh.NX.size(); i++) {
		std::fprintf(file, "vn %.6f %.6f %.6f\n", mesh.NX[i], mesh.NY[i], mesh.NZ[i]);
	}
	for (std::size_t i = 0; i + 2 < mesh.Idx.size(); i += 3) {
		unsigned int a = mesh.Idx[i] + 1;
		unsigned int b = mesh.Idx[i + 1] + 1;
		unsigned int c = mesh.Idx[i + 2] + 1;
		std::fprintf(file, "f %u/%u/%u %u/%u/%u %u/%u/%u\n", a, a, a, b, b, b, c, c, c);
	}
	std::fclose(file);
	written = obj;
	return(true);
}


bool Remaster_Write_Tile_Files(char const * ininame, int subtile, int icon, RemasterTileFile const & mesh, unsigned int const * rgba, int width, int height, std::string & written)
{
	written.clear();
	std::string stem;
	Stem_For(User_File_Write_Name(""), ininame, subtile, icon, stem);
	std::size_t slash = stem.find_last_of("\\/");
	if (slash == std::string::npos || !Ensure_Directory(stem.substr(0, slash))) {
		return(false);
	}

	std::string leaf = Piece_Name(subtile, icon);
	if (rgba == NULL || width <= 0 || height <= 0) {
		return(false);
	}

	if (Write_Png_Bgra(stem + ".png", rgba, width, height) && Write_Obj_Mtl(ininame, subtile, mesh, stem, leaf, written)) {
		return(true);
	}

	std::string alt_stem = stem + "_new";
	std::string alt_leaf = leaf + "_new";
	if (!Write_Png_Bgra(alt_stem + ".png", rgba, width, height) || !Write_Obj_Mtl(ininame, subtile, mesh, alt_stem, alt_leaf, written)) {
		return(false);
	}
	return(true);
}
