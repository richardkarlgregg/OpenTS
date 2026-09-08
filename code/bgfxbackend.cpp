/*******************************************************************************
 *                                O P E N  T S
 *******************************************************************************
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright 2026 OpenTS contributors
 *
 * See LICENSE.md for applicable additional terms and warranty disclaimers.
 ******************************************************************************/

// The bgfx side of the presenter. This is the only translation unit that includes bgfx,
// which keeps the library's headers and build settings away from the rest of the engine.

#include "bgfxbackend.h"

#include "dbgprint.h"
#include "except.h"

#include <bx/allocator.h>
#include <bgfx/bgfx.h>
#include <bgfx/embedded_shader.h>

#include <vs_ocornut_imgui.bin.h>
#include <fs_ocornut_imgui.bin.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <malloc.h>


static const bgfx::EmbeddedShader _EmbeddedShaders[] = {
	BGFX_EMBEDDED_SHADER(vs_ocornut_imgui),
	BGFX_EMBEDDED_SHADER(fs_ocornut_imgui),
	BGFX_EMBEDDED_SHADER_END()
};


// The view that magnifies the frame when the pixel art filter needs an intermediate
// target, and the one that draws onto the window. Views render in ascending order, so
// the magnify pass must carry the lower id for the present pass to sample its output
// from this frame rather than the last one.
static const bgfx::ViewId VIEW_PRESCALE = 0;
static const bgfx::ViewId VIEW_PRESENT = 1;


static bool _Initialized = false;

static bgfx::TextureHandle _FrameTexture = BGFX_INVALID_HANDLE;
static bgfx::TextureHandle _OverlayTexture = BGFX_INVALID_HANDLE;
static bgfx::TextureHandle _LightLut = BGFX_INVALID_HANDLE;
static bgfx::TextureHandle _TileAtlas = BGFX_INVALID_HANDLE;
static bgfx::ProgramHandle _Program = BGFX_INVALID_HANDLE;
static bgfx::UniformHandle _TextureSampler = BGFX_INVALID_HANDLE;
static bgfx::FrameBufferHandle _PrescaleTarget = BGFX_INVALID_HANDLE;
static bgfx::VertexLayout _VertexLayout;

static int _FrameWidth = 0;
static int _FrameHeight = 0;
static int _PrescaleWidth = 0;
static int _PrescaleHeight = 0;
static int _DrawableWidth = 0;
static int _DrawableHeight = 0;
static int _TileAtlasWidth = 0;
static int _TileAtlasHeight = 0;
static unsigned int _TileAtlasSerial = 0;
static unsigned int _ResetFlags = BGFX_RESET_FLIP_AFTER_RENDER;

// True while the frame texture holds the game's own 565 layout. When the hardware cannot
// sample that format the frame is widened to 32 bits on the way in instead.
static bool _FrameIs565 = false;
static unsigned int * _ConvertBuffer = NULL;
static unsigned int _ConvertTable[65536];
static unsigned int _ConvertTableAlpha[65536];

static const int LIGHT_LUT_SIZE = 64;
static const unsigned short REMASTER_CHROMA = 0xF81F;


struct BackendVertex
{
	float X;
	float Y;
	float U;
	float V;
	unsigned int Color;
};


// bgfx reports lost devices and shader failures through this rather than a return code,
// so the engine would otherwise present to a black window with no explanation.
class BackendCallback : public bgfx::CallbackI
{
	public:
		virtual ~BackendCallback(void) override {}

		virtual void fatal(const char * filepath, uint16_t line, bgfx::Fatal::Enum code, const char * str) override
		{
			// A debug check is the library's own assertion, not a renderer failure. The ones it
			// runs while shutting down compare reference counts on interfaces that an overlay
			// or the Direct3D debug layer is free to hold, so ending the process over one would
			// report somebody else's reference as a crash.
			if (code == bgfx::Fatal::DebugCheck) {
				DebugString("Renderer check failed at %s(%u): %s\n",
							filepath != NULL ? filepath : "", (unsigned)line, str != NULL ? str : "");
				return;
			}

			Fatal("Renderer error %d at %s(%u): %s", (int)code,
						filepath != NULL ? filepath : "", (unsigned)line, str != NULL ? str : "");
		}

		virtual void traceVargs(const char * filepath, uint16_t line, const char * format, va_list argList) override
		{
			char message[1024];
			vsnprintf(message, sizeof(message), format, argList);
			OutputDebugString(message);
		}

		virtual void profilerBegin(const char *, uint32_t, const char *, uint16_t) override {}
		virtual void profilerBeginLiteral(const char *, uint32_t, const char *, uint16_t) override {}
		virtual void profilerEnd(void) override {}
		virtual uint32_t cacheReadSize(uint64_t) override { return(0); }
		virtual bool cacheRead(uint64_t, void *, uint32_t) override { return(false); }
		virtual void cacheWrite(uint64_t, const void *, uint32_t) override {}
		virtual void screenShot(const char *, uint32_t, uint32_t, uint32_t, bgfx::TextureFormat::Enum, const void *, uint32_t, bool) override {}
		virtual void captureBegin(uint32_t, uint32_t, uint32_t, bgfx::TextureFormat::Enum, bool) override {}
		virtual void captureEnd(void) override {}
		virtual void captureFrame(const void *, uint32_t) override {}
};

static BackendCallback _Callback;


// bgfx contains cache-line-aligned render records but requests their backing arrays with
// the allocator's default alignment. The Win32 CRT only guarantees eight-byte alignment,
// which is insufficient when clang-cl copies those records with aligned SSE instructions.
class BackendAllocator : public bx::AllocatorI
{
	public:
		virtual ~BackendAllocator(void) override {}

		virtual void * realloc(void * ptr, size_t size, size_t alignment, const char *, uint32_t) override
		{
			if (size == 0) {
				_aligned_free(ptr);
				return(NULL);
			}

			const size_t cachelinealignment = BX_CACHE_LINE_SIZE;
			alignment = std::max(alignment, cachelinealignment);
			return(_aligned_realloc(ptr, size, alignment));
		}
};

static BackendAllocator _Allocator;


/// <summary>
/// Builds the table that widens a 565 pixel to the 32 bit color the fallback path uploads.
/// </summary>
static void Build_Convert_Table(void)
{
	for (int pixel = 0; pixel < 65536; pixel++) {
		unsigned int red = (unsigned int)(((pixel >> 11) & 0x1F) * 255 / 31);
		unsigned int green = (unsigned int)(((pixel >> 5) & 0x3F) * 255 / 63);
		unsigned int blue = (unsigned int)((pixel & 0x1F) * 255 / 31);

		_ConvertTable[pixel] = 0xFF000000 | (red << 16) | (green << 8) | blue;
		_ConvertTableAlpha[pixel] = (pixel == REMASTER_CHROMA) ? 0 : _ConvertTable[pixel];
	}
}


/// <summary>
/// Builds the sun-term table sampled by interpolated terrain normals.
/// </summary>
static void Build_Light_Lut(unsigned int * pixels, int size)
{
	static float const lx = -0.45f;
	static float const ly = 0.20f;
	static float const lz = 0.87f;

	for (int y = 0; y < size; y++) {
		for (int x = 0; x < size; x++) {
			float nx = ((float)x + 0.5f) / (float)size * 2.0f - 1.0f;
			float ny = ((float)y + 0.5f) / (float)size * 2.0f - 1.0f;
			float n2 = nx * nx + ny * ny;
			float nz = 0.0f;
			if (n2 < 1.0f) {
				nz = std::sqrt(1.0f - n2);
			} else {
				float inv = 1.0f / std::sqrt(n2);
				nx *= inv;
				ny *= inv;
			}

			float ndotl = nx * lx + ny * ly + nz * lz;
			if (ndotl < 0.0f) {
				ndotl = 0.0f;
			}

			unsigned int shade = (unsigned int)((0.42f + 0.58f * ndotl) * 255.0f + 0.5f);
			if (shade > 255) {
				shade = 255;
			}
			pixels[y * size + x] = 0xFF000000 | (shade << 16) | (shade << 8) | shade;
		}
	}
}


/// <summary>
/// Submits one textured rectangle covering the given destination.
/// </summary>
static void Submit_Quad(bgfx::ViewId view, bgfx::TextureHandle texture, float x, float y, float width, float height, unsigned int samplerflags, bool flipv = false, uint64_t state = BGFX_STATE_WRITE_RGB | BGFX_STATE_WRITE_A)
{
	bgfx::TransientVertexBuffer buffer;

	if (bgfx::getAvailTransientVertexBuffer(6, _VertexLayout) < 6) {
		return;
	}

	bgfx::allocTransientVertexBuffer(&buffer, 6, _VertexLayout);

	BackendVertex * vertex = (BackendVertex *)buffer.data;
	const unsigned int white = 0xFFFFFFFF;

	const float vtop = flipv ? 1.0f : 0.0f;
	const float vbottom = flipv ? 0.0f : 1.0f;

	vertex[0] = { x, y, 0.0f, vtop, white };
	vertex[1] = { x + width, y, 1.0f, vtop, white };
	vertex[2] = { x + width, y + height, 1.0f, vbottom, white };
	vertex[3] = { x, y, 0.0f, vtop, white };
	vertex[4] = { x + width, y + height, 1.0f, vbottom, white };
	vertex[5] = { x, y + height, 0.0f, vbottom, white };

	bgfx::setVertexBuffer(0, &buffer);
	bgfx::setTexture(0, _TextureSampler, texture, samplerflags);
	bgfx::setState(state);
	bgfx::submit(view, _Program);
}


/// <summary>
/// Maps a frame-pixel clip rectangle into a destination measured in the same space as the
/// present or prescale view.
/// </summary>
static void Map_Frame_Rect(int framex, int framey, int framew, int frameh, float destx, float desty, float scalex, float scaley, int & outx, int & outy, int & outw, int & outh)
{
	float x0 = destx + (float)framex * scalex;
	float y0 = desty + (float)framey * scaley;
	float x1 = destx + (float)(framex + framew) * scalex;
	float y1 = desty + (float)(framey + frameh) * scaley;
	outx = (int)std::floor(x0);
	outy = (int)std::floor(y0);
	outw = (int)std::ceil(x1) - outx;
	outh = (int)std::ceil(y1) - outy;
	if (outw < 0) {
		outw = 0;
	}
	if (outh < 0) {
		outh = 0;
	}
}


static bool Upload_Tile_Atlas(unsigned int const * pixels, int width, int height, unsigned int serial)
{
	if (pixels == NULL || width <= 0 || height <= 0) {
		return(false);
	}

	uint32_t bytes = (uint32_t)width * (uint32_t)height * 4u;
	if (!bgfx::isValid(_TileAtlas) || _TileAtlasWidth != width || _TileAtlasHeight != height || _TileAtlasSerial != serial) {
		if (bgfx::isValid(_TileAtlas)) {
			bgfx::destroy(_TileAtlas);
			_TileAtlas = BGFX_INVALID_HANDLE;
		}
		_TileAtlas = bgfx::createTexture2D((uint16_t)width, (uint16_t)height, false, 1, bgfx::TextureFormat::BGRA8, BGFX_SAMPLER_U_CLAMP | BGFX_SAMPLER_V_CLAMP | BGFX_SAMPLER_POINT);
		_TileAtlasWidth = width;
		_TileAtlasHeight = height;
		_TileAtlasSerial = serial;
		if (!bgfx::isValid(_TileAtlas)) {
			return(false);
		}
	}

	bgfx::updateTexture2D(_TileAtlas, 0, 0, 0, 0, (uint16_t)width, (uint16_t)height, bgfx::copy(pixels, bytes), (uint16_t)(width * 4));
	return(true);
}


/// <summary>
/// Submits remastered terrain triangles in frame-pixel coordinates, scaled into dest.
/// </summary>
static void Submit_Terrain(bgfx::ViewId view, RemasterTerrainVertex const * terrain, int terraincount, float destx, float desty, float scalex, float scaley, int clipx, int clipy, int clipw, int cliph, unsigned int const * atlas, int atlaswidth, int atlasheight, bool textured, unsigned int atlasserial)
{
	if (terrain == NULL || terraincount < 3) {
		return;
	}

	bgfx::TextureHandle texture = _LightLut;
	unsigned int samplerflags = BGFX_SAMPLER_U_CLAMP | BGFX_SAMPLER_V_CLAMP;
	uint64_t state = BGFX_STATE_WRITE_RGB | BGFX_STATE_WRITE_A;
	if (textured) {
		if (!Upload_Tile_Atlas(atlas, atlaswidth, atlasheight, atlasserial)) {
			return;
		}
		texture = _TileAtlas;
		samplerflags |= BGFX_SAMPLER_POINT;
		state |= BGFX_STATE_BLEND_ALPHA;
	} else if (!bgfx::isValid(_LightLut)) {
		return;
	}

	uint16_t scissor = 0xFFFF;
	if (clipw > 0 && cliph > 0) {
		int sx = 0;
		int sy = 0;
		int sw = 0;
		int sh = 0;
		Map_Frame_Rect(clipx, clipy, clipw, cliph, destx, desty, scalex, scaley, sx, sy, sw, sh);
		if (sw > 0 && sh > 0) {
			scissor = bgfx::setScissor((uint16_t)std::max(sx, 0), (uint16_t)std::max(sy, 0), (uint16_t)sw, (uint16_t)sh);
		}
	}

	int offset = 0;
	while (offset + 3 <= terraincount) {
		uint32_t available = bgfx::getAvailTransientVertexBuffer((uint32_t)(terraincount - offset), _VertexLayout);
		available -= available % 3;
		if (available < 3) {
			break;
		}

		bgfx::TransientVertexBuffer buffer;
		bgfx::allocTransientVertexBuffer(&buffer, available, _VertexLayout);
		BackendVertex * vertex = (BackendVertex *)buffer.data;
		for (uint32_t i = 0; i < available; i++) {
			RemasterTerrainVertex const & source = terrain[offset + (int)i];
			vertex[i].X = destx + source.X * scalex;
			vertex[i].Y = desty + source.Y * scaley;
			vertex[i].U = source.U;
			vertex[i].V = source.V;
			vertex[i].Color = source.Color;
		}

		bgfx::setVertexBuffer(0, &buffer);
		bgfx::setTexture(0, _TextureSampler, texture, samplerflags);
		if (scissor != 0xFFFF) {
			bgfx::setScissor(scissor);
		}
		bgfx::setState(state);
		bgfx::submit(view, _Program);
		offset += (int)available;
	}
}


/// <summary>
/// Builds an orthographic projection over a target measured in pixels, with the origin in
/// its top left corner.
/// </summary>
static void Build_Ortho_Projection(float * result, int width, int height)
{
	const float depthnear = 0.0f;
	const float depthfar = 1000.0f;
	const bool homogeneous = bgfx::getCaps()->homogeneousDepth;

	memset(result, 0, sizeof(float) * 16);

	result[0] = 2.0f / (float)width;
	result[5] = -2.0f / (float)height;
	result[10] = homogeneous ? 2.0f / (depthfar - depthnear) : 1.0f / (depthfar - depthnear);
	result[12] = -1.0f;
	result[13] = 1.0f;
	result[14] = homogeneous ? -(depthfar + depthnear) / (depthfar - depthnear) : -depthnear / (depthfar - depthnear);
	result[15] = 1.0f;
}


/// <summary>
/// Sets a view to draw into a target of the given size using pixel coordinates.
/// </summary>
static void Set_View_Transform(bgfx::ViewId view, int width, int height)
{
	float projection[16];
	bgfx::setViewRect(view, 0, 0, (uint16_t)width, (uint16_t)height);
	Build_Ortho_Projection(projection, width, height);
	bgfx::setViewTransform(view, NULL, projection);
}


/// <summary>
/// Discards the intermediate target the pixel art filter magnifies through.
/// </summary>
static void Destroy_Prescale_Target(void)
{
	if (bgfx::isValid(_PrescaleTarget)) {
		bgfx::destroy(_PrescaleTarget);
		_PrescaleTarget = BGFX_INVALID_HANDLE;
	}
	_PrescaleWidth = 0;
	_PrescaleHeight = 0;
}


/// <summary>
/// Makes sure the pixel art filter has an intermediate target of the requested size.
/// </summary>
/// <returns>bool; Is a target of that size ready to render into?</returns>
static bool Ensure_Prescale_Target(int width, int height)
{
	if (bgfx::isValid(_PrescaleTarget) && _PrescaleWidth == width && _PrescaleHeight == height) {
		return(true);
	}

	Destroy_Prescale_Target();

	const bgfx::Caps * caps = bgfx::getCaps();
	if (width <= 0 || height <= 0 || width > caps->limits.maxTextureSize || height > caps->limits.maxTextureSize) {
		return(false);
	}

	_PrescaleTarget = bgfx::createFrameBuffer((uint16_t)width, (uint16_t)height, bgfx::TextureFormat::BGRA8, BGFX_SAMPLER_U_CLAMP | BGFX_SAMPLER_V_CLAMP);
	if (!bgfx::isValid(_PrescaleTarget)) {
		return(false);
	}

	_PrescaleWidth = width;
	_PrescaleHeight = height;
	return(true);
}


/// <summary>
/// Starts the renderer on an existing window.
/// </summary>
/// <param name="window">The window the frame is presented into.</param>
/// <param name="drawablewidth">The drawable area's width in physical pixels.</param>
/// <param name="drawableheight">The drawable area's height in physical pixels.</param>
/// <param name="renderer">Which graphics API to ask for, or auto to let bgfx decide.</param>
/// <param name="vsync">Should presents wait for the display's refresh?</param>
/// <returns>bool; Did the renderer start?</returns>
bool Backend_Init(NativeWindow const & window, int drawablewidth, int drawableheight, BackendRenderer renderer, bool vsync)
{
	if (_Initialized) {
		return(true);
	}

	// Presents happen at whatever depth the engine has reached, including from inside a
	// dialog's paint handler, so the renderer has to run on this thread. Calling
	// renderFrame before init is what selects that.
	bgfx::renderFrame();

	_DrawableWidth = drawablewidth;
	_DrawableHeight = drawableheight;
	_ResetFlags = BGFX_RESET_FLIP_AFTER_RENDER | (vsync ? BGFX_RESET_VSYNC : BGFX_RESET_NONE);

	bgfx::Init init;
	init.platformData.ndt = window.Display;
	init.platformData.nwh = window.Handle;
	init.platformData.type = window.Type == NATIVE_WINDOW_WAYLAND
		? bgfx::NativeWindowHandleType::Wayland
		: bgfx::NativeWindowHandleType::Default;
	init.resolution.width = (uint32_t)drawablewidth;
	init.resolution.height = (uint32_t)drawableheight;
	init.resolution.reset = _ResetFlags;
	init.callback = &_Callback;
	init.allocator = &_Allocator;

	switch (renderer) {
		case BACKEND_RENDERER_D3D11:
			init.type = bgfx::RendererType::Direct3D11;
			break;

		case BACKEND_RENDERER_D3D12:
			init.type = bgfx::RendererType::Direct3D12;
			break;

		case BACKEND_RENDERER_VULKAN:
			init.type = bgfx::RendererType::Vulkan;
			break;

		case BACKEND_RENDERER_OPENGL:
			init.type = bgfx::RendererType::OpenGL;
			break;

		default:
			init.type = bgfx::RendererType::Count;
			break;
	}

	if (!bgfx::init(init)) {
		return(false);
	}

	_VertexLayout.begin()
		.add(bgfx::Attrib::Position, 2, bgfx::AttribType::Float)
		.add(bgfx::Attrib::TexCoord0, 2, bgfx::AttribType::Float)
		.add(bgfx::Attrib::Color0, 4, bgfx::AttribType::Uint8, true)
		.end();

	bgfx::RendererType::Enum type = bgfx::getRendererType();
	bgfx::ShaderHandle vertexshader = bgfx::createEmbeddedShader(_EmbeddedShaders, type, "vs_ocornut_imgui");
	bgfx::ShaderHandle fragmentshader = bgfx::createEmbeddedShader(_EmbeddedShaders, type, "fs_ocornut_imgui");

	if (!bgfx::isValid(vertexshader) || !bgfx::isValid(fragmentshader)) {
		bgfx::shutdown();
		return(false);
	}

	_Program = bgfx::createProgram(vertexshader, fragmentshader, true);
	_TextureSampler = bgfx::createUniform("s_tex", bgfx::UniformType::Sampler);

	if (!bgfx::isValid(_Program) || !bgfx::isValid(_TextureSampler)) {
		bgfx::shutdown();
		return(false);
	}

	unsigned int lut[LIGHT_LUT_SIZE * LIGHT_LUT_SIZE];
	Build_Light_Lut(lut, LIGHT_LUT_SIZE);
	_LightLut = bgfx::createTexture2D((uint16_t)LIGHT_LUT_SIZE, (uint16_t)LIGHT_LUT_SIZE, false, 1, bgfx::TextureFormat::BGRA8, BGFX_SAMPLER_U_CLAMP | BGFX_SAMPLER_V_CLAMP, bgfx::copy(lut, (uint32_t)sizeof(lut)));
	if (!bgfx::isValid(_LightLut)) {
		bgfx::shutdown();
		return(false);
	}

	_Initialized = true;
	return(true);
}


/// <summary>
/// Shuts the renderer down and releases everything it created.
/// </summary>
void Backend_Shutdown(void)
{
	if (!_Initialized) {
		return;
	}

	Destroy_Prescale_Target();

	if (bgfx::isValid(_OverlayTexture)) {
		bgfx::destroy(_OverlayTexture);
		_OverlayTexture = BGFX_INVALID_HANDLE;
	}
	if (bgfx::isValid(_LightLut)) {
		bgfx::destroy(_LightLut);
		_LightLut = BGFX_INVALID_HANDLE;
	}
	if (bgfx::isValid(_TileAtlas)) {
		bgfx::destroy(_TileAtlas);
		_TileAtlas = BGFX_INVALID_HANDLE;
	}
	if (bgfx::isValid(_FrameTexture)) {
		bgfx::destroy(_FrameTexture);
		_FrameTexture = BGFX_INVALID_HANDLE;
	}
	if (bgfx::isValid(_TextureSampler)) {
		bgfx::destroy(_TextureSampler);
		_TextureSampler = BGFX_INVALID_HANDLE;
	}
	if (bgfx::isValid(_Program)) {
		bgfx::destroy(_Program);
		_Program = BGFX_INVALID_HANDLE;
	}

	delete [] _ConvertBuffer;
	_ConvertBuffer = NULL;

	bgfx::shutdown();

	_FrameWidth = 0;
	_FrameHeight = 0;
	_TileAtlasWidth = 0;
	_TileAtlasHeight = 0;
	_TileAtlasSerial = 0;
	_Initialized = false;
}


/// <summary>
/// Points the renderer at a frame of the given size, replacing any earlier one.
/// </summary>
/// <returns>bool; Is a texture of that size ready to receive frames?</returns>
bool Backend_Set_Frame_Size(int width, int height)
{
	if (!_Initialized || width <= 0 || height <= 0) {
		return(false);
	}

	if (bgfx::isValid(_FrameTexture) && _FrameWidth == width && _FrameHeight == height) {
		return(true);
	}

	if (bgfx::isValid(_FrameTexture)) {
		bgfx::destroy(_FrameTexture);
		_FrameTexture = BGFX_INVALID_HANDLE;
	}
	if (bgfx::isValid(_OverlayTexture)) {
		bgfx::destroy(_OverlayTexture);
		_OverlayTexture = BGFX_INVALID_HANDLE;
	}

	// bgfx names packed formats from their low bits up, so its B5G6R5 is the layout the
	// game already draws in. Emulated support would convert every upload on the way
	// through, which is what the fallback below does more cheaply.
	const bgfx::Caps * caps = bgfx::getCaps();
	_FrameIs565 = (caps->formats[bgfx::TextureFormat::B5G6R5] & BGFX_CAPS_FORMAT_TEXTURE_2D) != 0;

	_FrameTexture = bgfx::createTexture2D((uint16_t)width, (uint16_t)height, false, 1, _FrameIs565 ? bgfx::TextureFormat::B5G6R5 : bgfx::TextureFormat::BGRA8);
	if (!bgfx::isValid(_FrameTexture)) {
		return(false);
	}

	delete [] _ConvertBuffer;
	_ConvertBuffer = NULL;

	if (_ConvertTable[0xFFFF] == 0) {
		Build_Convert_Table();
	}
	_ConvertBuffer = new unsigned int[width * height];

	_OverlayTexture = bgfx::createTexture2D((uint16_t)width, (uint16_t)height, false, 1, bgfx::TextureFormat::BGRA8);
	if (!bgfx::isValid(_OverlayTexture)) {
		return(false);
	}

	_FrameWidth = width;
	_FrameHeight = height;
	return(true);
}


/// <summary>
/// Tells the renderer the drawable area changed size.
/// </summary>
void Backend_On_Resize(int drawablewidth, int drawableheight)
{
	if (!_Initialized || drawablewidth <= 0 || drawableheight <= 0) {
		return;
	}

	if (_DrawableWidth == drawablewidth && _DrawableHeight == drawableheight) {
		return;
	}

	_DrawableWidth = drawablewidth;
	_DrawableHeight = drawableheight;
	bgfx::reset((uint32_t)drawablewidth, (uint32_t)drawableheight, _ResetFlags);
}


/// <summary>
/// Uploads the frame and puts it on the screen.
/// </summary>
/// <param name="pixels">The frame's top left pixel, in 16 bit 565.</param>
/// <param name="pitch">The bytes between one row of that frame and the next.</param>
/// <param name="destx">Where the left edge of the frame lands in the window.</param>
/// <param name="desty">Where the top edge of the frame lands in the window.</param>
/// <param name="destwidth">How wide the frame is drawn.</param>
/// <param name="destheight">How tall the frame is drawn.</param>
/// <param name="mode">How the frame is filtered when it is drawn larger than it is.</param>
void Backend_Present(void const * pixels, int pitch, int destx, int desty, int destwidth, int destheight, BackendScaleMode mode, RemasterTerrainVertex const * terrain, int terraincount, Rect const & terrainclip, unsigned int const * atlas, int atlaswidth, int atlasheight, bool textured, unsigned int atlasserial)
{
	if (!_Initialized || pixels == NULL || !bgfx::isValid(_FrameTexture)) {
		return;
	}

	// A minimized window has no client area to present into.
	if (_DrawableWidth <= 0 || _DrawableHeight <= 0) {
		return;
	}

	bool const remaster = terraincount >= 3 && terrain != NULL && bgfx::isValid(_OverlayTexture) && _ConvertBuffer != NULL;
	if (remaster) {
		for (int y = 0; y < _FrameHeight; y++) {
			unsigned short const * source = (unsigned short const *)((char const *)pixels + y * pitch);
			unsigned int * dest = _ConvertBuffer + y * _FrameWidth;
			for (int x = 0; x < _FrameWidth; x++) {
				dest[x] = _ConvertTableAlpha[source[x]];
			}
		}
		bgfx::updateTexture2D(_OverlayTexture, 0, 0, 0, 0, (uint16_t)_FrameWidth, (uint16_t)_FrameHeight, bgfx::copy(_ConvertBuffer, (uint32_t)(_FrameWidth * _FrameHeight * 4)), (uint16_t)(_FrameWidth * 4));
	} else if (_FrameIs565) {
		bgfx::updateTexture2D(_FrameTexture, 0, 0, 0, 0, (uint16_t)_FrameWidth, (uint16_t)_FrameHeight, bgfx::copy(pixels, (uint32_t)(_FrameHeight * pitch)), (uint16_t)pitch);
	} else if (_ConvertBuffer != NULL) {
		for (int y = 0; y < _FrameHeight; y++) {
			unsigned short const * source = (unsigned short const *)((char const *)pixels + y * pitch);
			unsigned int * dest = _ConvertBuffer + y * _FrameWidth;
			for (int x = 0; x < _FrameWidth; x++) {
				dest[x] = _ConvertTable[source[x]];
			}
		}
		bgfx::updateTexture2D(_FrameTexture, 0, 0, 0, 0, (uint16_t)_FrameWidth, (uint16_t)_FrameHeight, bgfx::copy(_ConvertBuffer, (uint32_t)(_FrameWidth * _FrameHeight * 4)), (uint16_t)(_FrameWidth * 4));
	}

	bgfx::TextureHandle source = remaster ? _OverlayTexture : _FrameTexture;
	unsigned int samplerflags = BGFX_SAMPLER_U_CLAMP | BGFX_SAMPLER_V_CLAMP;
	bool from_prescale = false;

	if (mode == BACKEND_SCALE_NEAREST) {
		samplerflags |= BGFX_SAMPLER_POINT;
	}

	// The pixel art filter keeps whole pixels whole. An exact multiple needs nothing but
	// point sampling; anything else is magnified to the next whole multiple with point
	// sampling and then shrunk to the window smoothly, which keeps edges sharp without
	// the uneven pixel sizes that point sampling alone would give.
	if (mode == BACKEND_SCALE_PIXELART && destwidth > _FrameWidth && destheight > _FrameHeight) {
		if ((destwidth % _FrameWidth) == 0 && (destheight % _FrameHeight) == 0) {
			samplerflags |= BGFX_SAMPLER_POINT;
		} else {
			int scale = (destwidth + _FrameWidth - 1) / _FrameWidth;
			int scaley = (destheight + _FrameHeight - 1) / _FrameHeight;
			if (scaley > scale) {
				scale = scaley;
			}

			if (Ensure_Prescale_Target(_FrameWidth * scale, _FrameHeight * scale)) {
				bgfx::setViewFrameBuffer(VIEW_PRESCALE, _PrescaleTarget);
				bgfx::setViewClear(VIEW_PRESCALE, BGFX_CLEAR_COLOR, 0x000000FF);
				Set_View_Transform(VIEW_PRESCALE, _PrescaleWidth, _PrescaleHeight);
				if (remaster) {
					float scalex = (float)_PrescaleWidth / (float)_FrameWidth;
					float scaleypx = (float)_PrescaleHeight / (float)_FrameHeight;
					Submit_Terrain(VIEW_PRESCALE, terrain, terraincount, 0.0f, 0.0f, scalex, scaleypx, terrainclip.X, terrainclip.Y, terrainclip.Width, terrainclip.Height, atlas, atlaswidth, atlasheight, textured, atlasserial);
					Submit_Quad(VIEW_PRESCALE, _OverlayTexture, 0.0f, 0.0f, (float)_PrescaleWidth, (float)_PrescaleHeight, BGFX_SAMPLER_U_CLAMP | BGFX_SAMPLER_V_CLAMP | BGFX_SAMPLER_POINT, false, BGFX_STATE_WRITE_RGB | BGFX_STATE_WRITE_A | BGFX_STATE_BLEND_ALPHA);
				} else {
					Submit_Quad(VIEW_PRESCALE, _FrameTexture, 0.0f, 0.0f, (float)_PrescaleWidth, (float)_PrescaleHeight, BGFX_SAMPLER_U_CLAMP | BGFX_SAMPLER_V_CLAMP | BGFX_SAMPLER_POINT);
				}
				source = bgfx::getTexture(_PrescaleTarget);
				from_prescale = true;
			}
		}
	}

	// Clearing the whole window is what paints the bars beside a frame that does not
	// share the window's shape.
	bgfx::setViewFrameBuffer(VIEW_PRESENT, BGFX_INVALID_HANDLE);
	bgfx::setViewClear(VIEW_PRESENT, BGFX_CLEAR_COLOR, 0x000000FF);
	Set_View_Transform(VIEW_PRESENT, _DrawableWidth, _DrawableHeight);

	bool flipv = from_prescale && bgfx::getCaps()->originBottomLeft;
	if (remaster && !from_prescale) {
		float scalex = (float)destwidth / (float)_FrameWidth;
		float scaley = (float)destheight / (float)_FrameHeight;
		Submit_Terrain(VIEW_PRESENT, terrain, terraincount, (float)destx, (float)desty, scalex, scaley, terrainclip.X, terrainclip.Y, terrainclip.Width, terrainclip.Height, atlas, atlaswidth, atlasheight, textured, atlasserial);
		Submit_Quad(VIEW_PRESENT, source, (float)destx, (float)desty, (float)destwidth, (float)destheight, samplerflags, false, BGFX_STATE_WRITE_RGB | BGFX_STATE_WRITE_A | BGFX_STATE_BLEND_ALPHA);
	} else {
		Submit_Quad(VIEW_PRESENT, source, (float)destx, (float)desty, (float)destwidth, (float)destheight, samplerflags, flipv);
	}

	bgfx::frame();
}


/// <summary>
/// Names the graphics API the renderer settled on.
/// </summary>
char const * Backend_Renderer_Name(void)
{
	if (!_Initialized) {
		return("none");
	}
	return(bgfx::getRendererName(bgfx::getRendererType()));
}
