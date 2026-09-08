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
faces where a cell drops to its east or south neighbor. Adjacent tops share edge vertices.
Sloped cells keep texture coordinates on a subdivided heightfield so the artwork follows
the ground instead of smearing across two triangles, and each patch is split so a ramp
that rises on one corner does not drop a triangle. The GPU rasterizes the mesh and
lights interpolated heightfield normals from a directional sun, neighboring cells that
darken closed ground, and a warm point light that sits on the ground under the cursor.
Terrain between a cell and the sun or the lamp darkens that cell's vertices. A low sun
from the west throws long cliff shadows to the east. Sun and horizon samples are taken
once per cell in the view. With textures on, each top samples that cell's
original isometric diamond after it is unprojected onto the 3D quad; T turns that artwork
off and back on. The atlas rebuilds from the current view if scrolling fills it, so mixed
textured and untextured cells do not linger. Cliff extras are a screen-space overlay on opaque drop faces, and a drop
face without packed extra samples a strip of the same diamond. Adjacent tops weld when
they are close in height. The switch is presentation only. After the keyboard file
loads, remastered graphics takes V and remastered textures takes T, taking those keys
back from whatever the file gave them. A Debug build's icon overlay is F3 only, so V is
not shared with it.
