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
  (`ISO<Suffix>.PAL` and `Draw_Tile`), with overlay, terrain, building,
  infantry, unit, and aircraft SHPs from `OverlayPack` / the scenario INI.
  Nested theater mixes
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
  buildings that convert to overlay are not drawn. Infantry use the ART
  `Sequence` Ready frames and `HumanShape` facing; SHP vehicles use
  `Shape_Facing_Index` stand frames. House `Color=` remaps techno objects.
  Voxel units load `.VXL`/`.HVA` (plus `TUR`/`BARL`/`W` pieces) and project
  through the isometric view matrix and body facing. The view is the 640x400
  in-game layout: tabs and credits, `RADAR.SHP` frame 0, `SIDE1`/`SIDE2`/`SIDE3`/`ADDON`
  chrome, and the repair/sell/power/waypoint buttons on one row, with a
  472x384 tactical map. `MOUSE.SHP` is blitted with `MouseClass` hotspots
  (`MOUSE_NORMAL` is frame 0, hotspot min/min) through `MOUSEPAL.PAL`, the
  source palette `MouseDrawer` is built from. The pointer animates from
  `MouseControl` `FrameRate` on the 60 Hz system timer. Campaign frames
  advance every `Options.GameSpeed` system ticks (default 3). Building
  `ActiveAnim` uses ART `Rate`/`Start`/`End`/`LoopCount` through
  `StageClass::Graphic_Logic`. Unexplored cells stay under `SHROUD.SHP` from
  `Tactical::Cell_Shadow` after player techno `Look()` / `MapClass::Sight_From`
  (`Sight=` in RULES); the SHP indices scale the 565 frame instead of an
  `AlphaBuffer`. The power bar is `PowerClass` pips from `POWERP.SHP`, scaled
  from player `Power=` / drain. Radar plots mapped terrain and house-color
  blips in the `RADAR.SHP` pane when a `Radar=yes` building is powered (or
  `FreeRadar=yes`); clicking it jumps `TacticalCoord`. Clicking a mapped
  techno selects it (`MOUSE_CAN_SELECT`) through `Get_Selectable_Object`
  (near the object's position, then `Cell_Occupier`: last non-building whose
  origin is that cell, else the building occupying it). Buildings blit from
  `Render_Coord` (origin-cell north-west corner) and draw `TechnoClass` 3D
  lepton brackets with `Draw_Depth_Shaded_Line` in `Convert_Pixel(WHITE)`
  (unit palette index 15). Terrain Z for those brackets is `Get_Height` at
  the centre lepton (cell height plus TMP `RampType`). Infantry and other
  units blit `SELECT.SHP` frames 2 and 3, or 6 and 7 when the scenario INI
  veteran token is set, then `PIPS.SHP` health pips. Selection is drawn
  before the shroud pass so the shroud darkens it the way `SHAPE_ALPHA`
  would. `Pixel_To_Lepton` uses `PixelToCoordMatrix`. Bridge overlay cells
  lift `Pixel_To_Cell` by `BRIDGE_CELL_HEIGHT`. Cloak, fog of war, limpet
  `SELECT.SHP` frames, and tile depth-buffer writes are not ported. Sidebar
  cameos come from `BuildingClass::Update_Buildables` /
  `HouseClass::Can_Build` into `StripClass::Add` / `Sort`, drawn with
  `CAMEO.PAL` and `DARKEN.SHP`. Map `ActsLike=` is a country index (GDI1A
  stores `0`), not the house name. Left-clicking a cameo starts
  `FactoryClass` production (`HouseClass::Begin_Production`); `GCLOCK2.SHP`
  overlays the cameo (`SHAPE_TRANSLUCENT50`, frame `stage + 1`). Completed
  buildings enter `Manual_Place`; left-click on a legal occupy list calls
  `Place_Object`. Right-click suspends, then abandons (refund `Cost -
  Balance`).   Completed infantry and vehicles leave through
  `BuildingClass::Exit_Object` (`Find_Exit_Cell`, GDI barracks prefers
  origin+(1,2) plus `ExitCoord=`). Infantry and vehicles auto-place on
  `FactoryClass::Has_Completed` (`StripClass::AI` `PLACE`/`CELL_NONE`);
  buildings still wait for a Ready click. Each queued infantry or vehicle
  also auto-exits when its turn completes. Non-building cameos queue up to
  RULES `[General] MaximumQueuedObjects` (default 5); buildings cannot.
  Queue counts print at `QUEUE_COUNT_X_OFFSET`. They walk with
  `WalkLocomotionClass` (`Basic_Path` / `Adjacent_Cell` facings,
  `Move_Coord` toward `HeadToCoord`, arrive within 17 leptons). Path
  search is `AStarClass::Find_Path_Regular` (cell A*, Euclidean heuristic,
  facing tie-break costs). `FootClass::Can_Reach` forbids a height change
  other than 0, or 1 when the lower cell has a TMP ramp.
  `CliffBackImpassability=2` marks cells 4+ below listed neighbours as
  `LAND_ROCK`. Overlay `Wall=yes` cells are impassable. Owned
  `Gate=yes` buildings return `MOVE_CLOSED_GATE` until
  `MapClass::Try_Open_Gate` / `BuildingClass::Open_Gate` finishes
  (`GateStages`, `DeployTime`, `GateCloseDelay`). Gate `Sort_Y` is 16
  leptons earlier so infantry and vehicles draw in front. Owned techno
  `Look()` / `Map.Sight_From` on cell change. Left-click a selected
  foot unit on mapped ground to `Assign_Destination`. Right-click on
  empty tactical (`Mouse_Right_Release`) is `Unselect_All`. With a foot unit
  selected, empty tactical cells use `MOUSE_CAN_MOVE` or `MOUSE_NO_MOVE`.
  `FootClass::Draw_Action_Line` draws the movement line (`RGB(0,170,0)`)
  for `ActionLineTimer` (25) frames after the order. Escape cancels placement first, then leaves the map. Strip
  scroll arrows (`R-UP.SHP` / `R-DN.SHP`) move `TopIndex`. Edge scroll is
  `ScrollClass::Scroll_Edge`
  (arrow cursors `MOUSE_N`…`MOUSE_NW`, barred when `Scroll_Dir` cannot
  move). The camera is `TacticalCoord` (view center); `TacPixel` subtracts
  half the tactical rect before blit, and `Tactical_Position_Limits` clamp
  that center. Arrow keys also pan. Escape returns to the menu. Skirmish lists
  `MISSIONS.PKT` and loose `.MPR` maps the same way. Aircraft factory exit, movies,
  and save/load are not playable yet.

## Commands

From `web/`:

```
npm install
npm run dev
```

Chromium is the current browser target. Use the page's folder button; do not
rely on `showDirectoryPicker` for a Steam install under Program Files.
