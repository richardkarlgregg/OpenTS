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
  - type: format
    id: keyboard-ini
  - type: command
    id: fixed:debug-icon-overlay
---

The tactical map has two terrain drawing modes. Legacy mode is the original software blit of each cell's isometric tile artwork. Remastered mode rebuilds each visible cell as a 3D quad, draws and lights those quads on the GPU, and still draws objects, overlays, shroud, fog, and the sidebar through the legacy software path.

[Toggle remastered graphics](/commands/toggleremasteredgraphics/) switches the mode from V during play. While remastered mode is on, [toggle remastered textures](/commands/toggleremasteredtextures/) switches the mesh between original tile artwork and untextured control-color lighting from T. Both choices live only in the running process. They are not written to a save, a replay, or a network packet, and they do not change movement, combat, or occupancy. Textures start on.

## How a cell becomes a 3D quad

Each map cell already carries the data the remastered path needs:

- Height is the cell's ground level in whole height steps.
- Ramp selects the slope shape that turns a point inside the cell into a lepton height.
- The tile set record for that cell's tile type and sub-tile supplies the control colors the radar already uses, plus the packed 48-by-24 isometric diamond used as the quad's texture.

The remastered drawer takes the four corners of the cell, reads a lepton height at each corner, and treats those points as world coordinates. Adjacent cells that differ by less than half a height step share the neighbor's edge height so the tops meet. Each cell is subdivided into a 4-by-4 grid that follows the cell's height function, so a slope's texture coordinates stay tied to ground position instead of stretching across two large triangles. Each patch is split along the screen-space diagonal that keeps both triangles covering the ground, so a ramp that rises on only one corner does not leave a hole. Screen-space quads are expanded by less than a pixel so raster gaps do not show the cleared frame. The GPU lights interpolated heightfield normals from a high sun in the west.

With textures on, each top samples that cell's original diamond artwork after the diamond is unprojected onto a square so the 3D quad does not double-warp the isometric art. Vertex color carries lighting, including a cursor lamp measured in screen pixels under the pointer, so the shader multiplies the tile by the sun and the cursor light. A tile that cannot be unpacked uses the cell's control colors instead. With textures off, the same lighting is applied to those control colors on every face, with no artwork.

If this cell sits at least half a height step above its east or south neighbor, the remastered drawer emits a vertical face between those edges. That face is an opaque lit wall. With textures on, the wall also samples the cell's cliff extra when one is packed, or a strip of the unprojected diamond if it is not. Cliff extra artwork is still a screen-space overlay on those walls, sampled from the tile extra with alpha, so transparent extra pixels show the wall instead of a hole.

The software path still writes the tile's depth data so objects continue to sort against the ground. Where the remastered quads, walls, and extra overlays sit, it writes a magenta key so the GPU terrain shows through. Smudges, objects, shroud, fog, and the sidebar stay in the software frame and composite over the lit mesh.

## Mouse light

While remastered mode is on, a warm point light sits on the ground under the cursor and moves with it. It is presentation only. It does not change shroud, combat, or pathfinding.

## Debug builds

A Debug build used to toggle the debug icon overlay with V as well as F3. V is reserved for remastered graphics when the command claims it, so that overlay is F3 only.
