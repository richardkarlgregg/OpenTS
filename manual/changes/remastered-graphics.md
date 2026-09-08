---
title: Toggle remastered 3D terrain lighting from the keyboard
category: feature
release: 0.2.0
targets:
- type: command
  id: ToggleRemasteredGraphics
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
draw that rebuilds each visible cell as a height-aware isometric quad. The GPU rasterizes
those quads and lights interpolated heightfield normals from a directional sun. The switch
is presentation only. After the keyboard file loads, the command takes V, taking that key
back from whatever the file gave it. A Debug build's icon overlay is F3 only, so V is not
shared with it.
