# Web port instructions

These instructions apply to `web/` and supplement the repository-root
`AGENTS.md`.

This tree is a TypeScript source port of the engine in `code/`. It runs in
the browser on a 2D canvas. It is experimental. Visual Studio Win32 remains
the supported product; do not describe a successful `npm` run as a playable
game.

## Rules

- Translate C++ class by class. Keep names, MIX/INI/SHP/VQA/save layouts, and
  integer gameplay math.
- Do not add WebAssembly, Emscripten, or a compile of `code/`.
- Do not commit game assets, MIX files, or paths into a retail install.
- Load retail data only from a user-picked folder. Chromium refuses
  `showDirectoryPicker` on `Program Files` (including the Steam install), so
  the page uses a `<input webkitdirectory>` file list instead.
- Draw the software 565 frame to canvas `ImageData`. Remastered GPU terrain
  and WebGL wait until single-player works.
- After MIX files are indexed the page runs the graphical menu from
  `NewMenu.INI` when `GMENU.MIX` is present, otherwise the old
  `IDD_MAIN_MENU` dialog from `language.rc`. New Campaign lists
  `BATTLE.INI` / `BATTLEFS.INI` and draws that scenario's `PreviewPack`.
  If the pack is missing it builds the same isometric radar `Create_Preview`
  would, from the `Size` `In_Radar` diamond, filling missing `IsoMapPack5`
  cells as clear. The unused north pad (`LocalSize.Y`) is omitted so that
  strip is not drawn. The campaign
  loading picture comes from `Pick_Load_Background_Name`: CD 0 is GDI
  (`LOAD400C`/`LOAD400D`), CD 1 is Nod (`LOAD400A`/`LOAD400B`).   Clicking the
  load screen opens a pannable isometric tile view from theater TMP files
  (`ISO<Suffix>.PAL` and `Draw_Tile`), with overlay, terrain, building, and
  infantry SHPs from `OverlayPack` / the scenario INI. Nested theater mixes
  (`TEMPERAT.MIX` / `TEM.MIX`) and side mixes (`SIDEC01.MIX` and the matching
  uncached/CD archives) are opened the same way `Init_Theater` and
  `Prep_For_Side` mount them. Theater-palette art (`TerrainPalette=yes`,
  trees, bridges) uses `ISO<Suffix>.PAL`; tiberium uses the unit palette with
  the `[Colors]` scheme named by that tiberium's `Color=` (Riparius is green).
  Walls use the unit palette and neighbour connection frames. Building
  `ActiveAnim` overlays, `BibShape`, and `PowersUpBuilding` add-ons (matched
  onto the parent foundation, not only the origin cell) are drawn at the ART
  pixel offsets. Shape shadows are the second half of each SHP, blitted with
  `SHAPE_DARKEN`. Map lighting comes from the scenario `[Lighting]` section
  (ambient, RGB tint, height `Level`/`Ground`) plus `LightIntensity` sources
  on buildings, including `InvisibleInGame` lamp posts. Those posts and wall
  buildings that convert to overlay are not drawn. Escape returns to the menu. Skirmish lists
  `MISSIONS.PKT` and loose `.MPR` maps the same way. Simulation, movies,
  and save/load are not playable yet.

## Commands

From `web/`:

```
npm install
npm run dev
```

Chromium is the current browser target. Use the page's folder button; do not
rely on `showDirectoryPicker` for a Steam install under Program Files.
