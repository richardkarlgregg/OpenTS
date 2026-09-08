---
title: Remastered graphics
summary: Rebuilds visible terrain as height-aware isometric quads that the GPU rasterizes and lights, while the rest of the frame stays on the legacy software path.
category: rendering-presentation
keys: []
related:
  - type: command
    id: ToggleRemasteredGraphics
  - type: format
    id: keyboard-ini
  - type: command
    id: fixed:debug-icon-overlay
---

The tactical map has two terrain drawing modes. Legacy mode is the original software blit of each cell's isometric tile artwork. Remastered mode rebuilds each visible cell as a 3D quad, draws and lights those quads on the GPU, and still draws objects, overlays, shroud, fog, and the sidebar through the legacy software path.

[Toggle remastered graphics](/commands/toggleremasteredgraphics/) switches the mode from V during play. The choice lives only in the running process. It is not written to a save, a replay, or a network packet, and it does not change movement, combat, or occupancy.

## How a cell becomes a 3D quad

Each map cell already carries the data the remastered path needs:

- Height is the cell's ground level in whole height steps.
- Ramp selects the slope shape that turns a point inside the cell into a lepton height.
- The tile set record for that cell's tile type and sub-tile supplies the control colors the radar already uses, plus pixel offsets and extra-image bounds for later artwork sampling.

The remastered drawer takes the four corners of the cell, reads a lepton height at each corner, and treats those points as world coordinates. It projects them with the existing isometric camera, so the quad sits where the legacy tile would have been. A heightfield normal at each corner is interpolated across the quad. The GPU lights that normal from a high sun in the west. The control colors, mixed by cell height and scaled by the cell's cached tile brightness, are the unlit surface color.

The software path still writes the tile's depth data so objects continue to sort against the ground. Where the remastered quad sits, it writes a magenta key so the GPU terrain shows through. Smudges, objects, overlays, shroud, fog, and the sidebar stay in the software frame and composite over the lit quads.

Cliff extra images and per-pixel tile artwork are not sampled yet. A remastered cell is a lit surface in the tile set's control colors, not a textured copy of the original blit.

## Debug builds

A Debug build used to toggle the debug icon overlay with V as well as F3. V is reserved for remastered graphics when the command claims it, so that overlay is F3 only.
