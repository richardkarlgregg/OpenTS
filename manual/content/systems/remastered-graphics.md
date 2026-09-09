---
title: Remastered graphics
summary: Rebuilds visible terrain as height-aware isometric quads that the GPU rasterizes, lights, and optionally textures from the original tile artwork, including cliff drop faces, while the rest of the frame stays on the legacy software path.
category: rendering-presentation
keys: []
related:
  - type: command
    id: ToggleRemasteredGraphics
  - type: command
    id: ToggleRemasteredTextures
  - type: command
    id: ToggleRemasteredDensity
  - type: format
    id: keyboard-ini
  - type: command
    id: fixed:debug-icon-overlay
---

The tactical map has two terrain drawing modes. Legacy mode is the original software blit of each cell's isometric tile artwork. Remastered mode rebuilds each visible cell as a 3D quad, draws and lights those quads on the GPU, and still draws objects, overlays, shroud, fog, and the sidebar through the legacy software path.

[Toggle remastered graphics](/commands/toggleremasteredgraphics/) switches the mode from V during play. While remastered mode is on, [toggle remastered textures](/commands/toggleremasteredtextures/) switches the mesh between original tile artwork and untextured control-color lighting from T, and [toggle remastered density](/commands/toggleremastereddensity/) switches each cell between a 4-by-4 mesh and an 8-by-8 mesh from Y. Density starts at 4-by-4. All three choices live only in the running process. They are not written to a save, a replay, or a network packet, and they do not change movement, combat, or occupancy. Textures start on.

## How a cell becomes a 3D quad

Each map cell already carries the data the remastered path needs:

- Height is the cell's ground level in whole height steps.
- Ramp selects the slope shape that turns a point inside the cell into a lepton height.
- The tile set record for that cell's tile type and sub-tile supplies the control colors the radar already uses, plus the packed 48-by-24 isometric diamond used as the quad's texture.

The remastered drawer takes the four corners of the cell, reads a lepton height at each corner, and treats those points as world coordinates. Adjacent cells that differ by less than half a height step share the neighbor's edge height so the tops meet. Each cell is subdivided into a 4-by-4 grid that follows the cell's height function, or an 8-by-8 grid when remastered density is on, so a slope's texture coordinates stay tied to ground position instead of stretching across two large triangles. Each patch is split along the screen-space diagonal that keeps both triangles covering the ground, so a ramp that rises on only one corner does not leave a hole. Screen-space quads are expanded by less than a pixel so raster gaps do not show the cleared frame.

Lighting is vertex shading from heightfield rays, not a GPU ray tracer. Hardware ray tracing is not available on the supported 32-bit Win32 build: the GPU path multiplies each terrain triangle's texture by its vertex color, and DirectX ray tracing needs a 64-bit Direct3D 12 device. The view stores sun and horizon samples on a half-cell grid. Vertices interpolate that grid. A walk toward a low sun in the west darkens ground to the east of cliffs and ridges. A gentle slope does not shade itself as a dark tile. Neighboring samples that sit higher still darken closed ground. Open sky still brightens faces that point up. The original 2D tile and overlay shadow blits are skipped in this mode so they do not cover the mesh. Units, trees, and other objects still draw their own software shadows on top.

With textures on, each top samples that cell's original diamond artwork after the diamond is unprojected onto a square so the 3D quad does not double-warp the isometric art. A cliff-edge diamond that is only a thin lip takes plateau pixels from a neighboring cell, preferring the south and east so a rim that faces away from the camera still gets ground art. Those tiles are packed into an atlas as they come on screen. If the atlas fills while the map scrolls, it is rebuilt from the cells now in view, so the mesh does not stay half textured and half control-color. Vertex color carries that lighting, including a cursor lamp that sits on the ground under the pointer. The lamp is a point light: distance and slope facing change how bright a vertex is. Faces that point away from the lamp stay dark, so a cliff lights from the low ground, then the wall, then the top as the pointer climbs it. A ridge between a vertex and the lamp blocks it. A tile that cannot be unpacked uses the cell's control colors instead. With textures off, the same lighting is applied to those control colors on every face, with no artwork.

If this cell sits at least half a height step above a neighbor on any side, the remastered drawer emits a vertical face between those edges. A wall that drops on only one end is still emitted as a wedge. That face samples cliff extra in the extra's isometric blit when this cell or an adjacent cell of the same tile set has extra. A north or west drop that sits outside that blit uses the extra crop stretched down the wall. With textures on, extra is also drawn in that blit rectangle on top of the wall. Transparent extra pixels in that blit leave the wall texture showing through.

The software path still writes the tile's depth data so objects continue to sort against the ground. Where the remastered quads and walls sit, it writes a magenta key over that cell's render rectangle so the GPU terrain shows through. Smudges, objects, shroud, fog, and the sidebar stay in the software frame and composite over the lit mesh.

## Replacement meshes

While remastered graphics is on, a right-click on terrain that is not cancelling placement, repair, sell, power, a superweapon, or waypoint mode writes the isometric tile file under the cursor into the user directory as `Remaster\Tiles\<tile name>\tileset.obj`, with a matching `.png` and `.mtl`. A later right-click on the same set overwrites those files. If a viewer still has them open, the write lands next to them as `tileset_new.obj` (and matching `.png` / `.mtl`) so export is not blocked. The PNG packs every sub-tile diamond from that theater file in the same order the engine stores them (`x + MapWidth * y`, row 0 is north), fills each diamond slot so transparent corners do not read as black in a 3D viewer, and packs extra artwork below the grid. Extra blit holes are filled so a wall triangle that samples extra does not hit transparent pixels. The mesh is the heightfield tops of the cells of that set under the cursor, plus a two-sided vertical wall wherever a cell drops at least half a height step to a neighbor, including a wedge when only one end of the edge drops. Extra artwork is mapped onto those walls with the same isometric blit as remastered graphics. A wall vertex that misses that blit uses the extra crop stretched down the wall. A sub-tile without extra uses extra from an adjacent sub-tile in that file, not a distant extra in the same file. Coordinates are X east and Y south in cells from the north-west sub-tile, Z in height levels from that origin cell. The same click still deselects. The cells that belong to that tile set under the cursor draw a red isometric outline that follows the pointer. After export, remastered graphics draws that `tileset.obj` and `tileset.png` in place of the generated mesh for every cell of that set. The PNG is packed into the terrain atlas, so it must fit in 1536 pixels of width. A larger replacement falls back to the generated mesh until a dedicated high-res path is ready. Edit the PNG or OBJ, then toggle remastered textures to reload them. A per-sub-tile `00.obj` (and optional diffuse image) in the same folder still replaces the generated mesh for that sub-tile when the folder has no `tileset.obj`.

`tileset_normal.png`, `tileset_specular.png`, and `tileset_height.png` next to the OBJ are sampled at each mesh vertex. The normal map replaces the vertex normal so sun and the cursor lamp follow painted detail. Specular adds a small sun highlight. Height darkens low values as a cavity term. Those maps do not run a pixel shader; detail follows the mesh density (4-by-4 or 8-by-8). A `_diffuse.png`, `.tga`, or `.bmp` next to a per-sub-tile OBJ is used as the albedo when present. A data-directory copy of `Remaster\Tiles\` is read when the user directory has no file.

## Mouse light

While remastered mode is on, a warm point light sits on the ground under the cursor and moves with it. Slopes that face the lamp take more of it. Faces that point away stay dark. A ridge or cliff between a vertex and the lamp blocks it. The sunlit mesh is reused while the view stays still; only vertices near the pointer are recolored. It is presentation only. It does not change shroud, combat, or pathfinding.

## Debug builds

A Debug build used to toggle the debug icon overlay with V as well as F3. V is reserved for remastered graphics when the command claims it, so that overlay is F3 only.
