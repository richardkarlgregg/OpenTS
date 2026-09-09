---
title: Toggle remastered 3D terrain lighting from the keyboard
category: feature
release: 0.2.0
targets:
- type: command
  id: ToggleRemasteredGraphics
  effect: added
- type: command
  id: ToggleRemasteredGraphics
  effect: changed
- type: command
  id: ToggleRemasteredTextures
  effect: added
- type: command
  id: ToggleRemasteredDensity
  effect: added
- type: system
  id: remastered-graphics
  effect: added
- type: command
  id: fixed:debug-icon-overlay
  effect: changed
- type: format
  id: keyboard-ini
  effect: changed
credit: [OpenTS contributors]
---

A command switches the tactical terrain between the original 2D tile blit and a remastered
draw that rebuilds each visible cell as a height-aware isometric quad, including vertical
faces where a cell drops to a neighbor. Adjacent tops share edge vertices.
Sloped cells keep texture coordinates on a subdivided heightfield so the artwork follows
the ground instead of smearing across two triangles, and each patch is split so a ramp
that rises on one corner does not drop a triangle. Y switches that split between 4-by-4 and
8-by-8. The GPU rasterizes the mesh and
lights interpolated heightfield normals from a directional sun, neighboring cells that
darken closed ground, and a warm point light that sits on the ground under the cursor.
Terrain between a cell and the sun or the lamp darkens that cell's vertices. A low sun
from the west throws cliff shadows to the east across neighboring tiles. Sun and horizon
samples sit on a half-cell grid. Original 2D tile and overlay shadow blits are skipped so
they do not cover the mesh. With textures on, each top samples that cell's
original isometric diamond after it is unprojected onto the 3D quad. A cliff-edge lip
takes plateau pixels from a neighboring cell, preferring the south and east. T turns that artwork
off and back on. The atlas rebuilds from the current view if scrolling fills it, so mixed
textured and untextured cells do not linger. Cliff extras texture 3D drop faces and are
also drawn in their original isometric blit on top of those faces. A drop outside that blit
uses the extra crop stretched down the wall. Adjacent tops weld when
they are close in height. The switch is presentation only. After the keyboard file
loads, remastered graphics takes V, remastered textures takes T, and remastered density takes Y,
taking those keys back from whatever the file gave them. A Debug build's icon overlay is F3 only, so V is
not shared with it. While remastered graphics is on, a right-click on terrain that is not cancelling
another mode writes that tile set from the theater files under `Remaster\Tiles\` in the user
directory as `tileset.obj`. A later right-click overwrites that export; if the files are open in
another program, the write uses `tileset_new.obj` beside them. The mesh is heightfield tops plus
two-sided walls that drop to neighboring map height. Extra artwork is mapped onto those
walls with the same isometric blit as remastered graphics; a sub-tile
without extra uses an adjacent extra in that file. The
cells of that set under the cursor draw a red outline. The exported
`tileset.obj` and `tileset.png` replace the generated mesh for that set
when the PNG fits in the terrain atlas. `tileset_normal.png`,
`tileset_specular.png`, and `tileset_height.png` shade the mesh at
vertices. A per-sub-tile OBJ in that folder replaces the generated mesh
for that sub-tile when no tileset file is present.
