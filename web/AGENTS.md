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
  Campaign `HouseClass::Read_All` builds live houses from RULES type order
  (Neutral/Special when the map lists them); `Is_Ally` is the house bitmask;
  techno rows with no live house are skipped. `TechnoClass::AI` fires
  `Primary=` through `Can_Fire` / `Fire_At`: `Inviso` warheads apply
  `Take_Damage` / `Modify_Damage` at once, other projectiles travel at
  `Speed=` then explode. Guard auto-acquires in `ThreatRange`; a player
  `ACTION_ATTACK` (`MOUSE_CAN_ATTACK` / `MOUSE_STAY_ATTACK`) chases out of
  range. Homing, arcing gravity, particles, lasers, and explosion SHPs are
  not ported. `HouseClass::AI` still only recalcs power; computer base-building
  and triggers are not. `Assign_Handicap` is not. `LogicClass` still runs
  factories before objects.
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
  the centre lepton (cell height plus TMP `RampType`).   Infantry and other
  units blit `SELECT.SHP` frames 2 and 3, or 6 and 7 when the scenario INI
  veteran token is set, then `PIPS.SHP` health pips from
  `TechnoClass::Draw_Health_Bar` through `NormalDrawer` (`PALETTE.PAL`).
  `HealthRatio` is `Strength / MaxStrength`.
  Scenario INI health is 0–256 (`MaxStrength * token / 256`, snapped to full
  if within 3 of max). Buildings at or below `ConditionYellow` use
  `Shape_Number` damage frames and `ActiveAnimDamaged`. Pip colour is green
  (frame 9 / 1), yellow (10 / 2), or red (11 / 4) from those thresholds.
  Selection is drawn
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
  origin+(1,2) plus `ExitCoord=`). `Can_Enter_Cell` must return `MOVE_OK`
  (no vehicle occupy; infantry not `0x1C`). Barracks that are not
  `Armory=` or `WeaponsFactory=` wait on radio (`In_Radio_Contact`) until
  the previous foot has arrived; a blocked door scatters idle occupiers.
  Infantry and vehicles auto-place on
  `FactoryClass::Has_Completed` (`StripClass::AI` `PLACE`/`CELL_NONE`);
  buildings still wait for a Ready click. Each queued infantry or vehicle
  also auto-exits when its turn completes. Non-building cameos queue up to
  RULES `[General] MaximumQueuedObjects` (default 5); buildings cannot.
  Queue counts print at `QUEUE_COUNT_X_OFFSET`. They walk with
	`WalkLocomotionClass` (`Basic_Path` / `Adjacent_Cell` facings,
  `Move_Coord` toward `HeadToCoord`, arrive within 17 leptons). Infantry
  `Mark_Head_To` takes `Closest_Free_Spot` (spots 2, 3, and 4; the cell
  centre and NW are never free), so three infantry share a cell. Vehicles
  set `Flag.Occupy.Vehicle` and wait rather than stack. Path search
  ignores occupy (`MOVE_TEMP` cost); the step does not, and idle occupiers
  `Scatter` (`Nearby_Location` 1x1). A cell whose infantry bits are
  `0x1C` scatters everyone on it. Search is `AStarClass::Find_Path` (hierarchical subzones with
  `Region_Threat` * `ThreatAvoidanceCoefficient` on rough/coarse edges,
  up to five banned-edge retries after `Ban_Blocked_Subzone_Edges`, then
  cell A* with a Euclidean heuristic, facing tie-break costs, and
  `TUNNEL` jumps through `[Tubes]`). Overlay `bridge=true` cells mark
  `IsUnderBridge` and stitch subzone links at span ends plus the
  perpendicular side cells. `hs_anchor` maps a deck cell to the nearer
  span end before hierarchical search. `Cut_Corners` /
  `Optimize_Moves` skip tunnel steps. `MapClass::Reset_Subzone` builds
  fine/rough/coarse blocks (2x2, 4x4, 8x8). `FootClass::Can_Reach`
  forbids a height change other than 0, or 1 when the lower cell has a
  TMP ramp, or 4 when either cell is under a bridge deck.
  `CliffBackImpassability=2` marks cells 4+ below listed neighbours as
  `LAND_ROCK`. Overlay `Wall=yes` cells are impassable. Owned
  `Gate=yes` buildings return `MOVE_CLOSED_GATE` until
  `MapClass::Try_Open_Gate` / `BuildingClass::Open_Gate` finishes
  (`GateStages`, `DeployTime`, `GateCloseDelay`). Gate `Sort_Y` is 16
  leptons earlier so infantry and vehicles draw in front. Owned techno
  `Look()` / `Map.Sight_From` on cell change. Left-release on a
  selectable techno `Select()`s it into `CurrentObject` (leaders go to the
  head). Shift (`KeySelect1`/`KeySelect2`) toggles while a player unit is
  already selected. Left-release a selected foot unit on mapped ground to
  `Assign_Destination` for every selected foot. `DisplayClass` group move
  sorts by distance to the group centroid, sends the first unit to the
  click cell, and walks later units along the formation vector from the
  click, skipping cells already reserved for this order. Units already on
  the same cell copy that destination. Right-click on
  empty tactical (`Mouse_Right_Release`) is `Unselect_All`. With a foot unit
  selected, empty tactical cells use `MOUSE_CAN_MOVE` or `MOUSE_NO_MOVE`.
  `DisplayClass::Mouse_Left_Press` flags `IsTentative`; once the pointer
  moves more than 4 pixels (`Point2D::Length`) `IsRubberBand` starts
  `Tactical::Start_Rubber_Band` (skipped in waypoint mode, which still
  consumes the drag). `Mouse_Left_Held` clamps the loose corner to the
  tactical rect. Left-release without Shift `Unselect_All`s, then
  `Select_Rubber_Band` / `Select_These` / `Bandbox_Selection_Callback`:
  owned selectable infantry, units, and aircraft, plus buildings with
  `UndeploysInto` that are not `ConstructionYard` or `IsMobileWar`. The box
  is `NormalDrawer->Convert_Pixel(15)`. `FootClass::Draw_Action_Line` draws the movement line (`RGB(0,170,0)`)
  for `ActionLineTimer` (25) frames after the order. Sidebar repair, sell, and
  power buttons call `Repair_Mode_Control` / `Sell_Mode_Control` /
  `Power_Mode_Control` (`0` off, `1` on, `-1` toggle; refused without an owned
  building; each mode clears the others and the selection). Hover uses
  `MOUSE_REPAIR` / `MOUSE_SELL_BACK` / `MOUSE_SELL_UNIT` /
  `MOUSE_TOGGLE_POWER`, or the barred frames. Left-click toggles
  `BuildingClass::Repair(-1)`, `Sell_Back` (instant `Cost * RefundPercent`, no
  deconstruction SHP), or `Turn_On`/`Turn_Off`. Hit points are integer
  `Strength` against the type max. `Can_Repair` is an owned building with
  `Repairable=yes`, not `Considered_Vehicle` (`UndeploysInto` set and not
  `ConstructionYard`), and `Strength` neither 0 nor max. `Can_Toggle_Power`
  needs `TogglePower`, (`Drain>0` or `Powered`), selectable, and not a
  vehicle. `Can_Demolish` sells buildings the same way; units and aircraft
  only within `CELL_LEPTON/2` of an owned `UnitRepair=yes` occupy-center
  (radio tether is not ported). `Repair_AI` spends repair cost every
  `RepairRate * TICKS_PER_MINUTE` frames. Overlay-pack walls have no cell
  Owner, so they are not sold. Completed aircraft leave through
  `BuildingClass::Exit_Object`: a free helipad docks at occupy-center; a busy
  pad spawns on the local-rect edge at `FlightLevel` and
  `Assign_Destination` to the pad. Aircraft `Fly_AI` climbs or descends 16
  leptons per frame and ignores ground occupy. The waypoint button calls
  `Waypoint_Mode_Control` (`0` off, `1` on, `-1` toggle; starts
  `HouseClass::New_Waypoint_Path`, refused when all 12 paths are in use).
  Those modes `Unselect_All`, so `ScrollClass::What_Action` only applies
  them when nothing is selected. Hover uses `MOUSE_PLACE_WAYPOINT` /
  `MOUSE_NO_PLACE_WAYPOINT` / `MOUSE_SELECT_WAYPOINT` /
  `MOUSE_LOOP_WAYPOINT_PATH`. Left-click places a marker
  (`MaxWaypointPathLength`, default 15), picks one up to drag, or loops an
  earlier point of the selected path; Shift (`KeySelect1`/`KeySelect2`)
  skips the loop and selects or drags instead. `Tactical::Draw_Waypoints`
  runs before `Draw_Objects`, blits
  `Get_Mouse_Start_Frame(MOUSE_WAYPOINT) + (WaypointAnimCounter %
  Get_Mouse_Frame_Count)` (`WaypointAnimationSpeed`, default 12), index
  labels, and path lines in `MouseDrawer->Convert_Pixel(3)`. The selected
  path is a 5-on/3-off dash whose phase starts at
  `(0x7FFFFFFF - Frame) % TICKS_PER_SECOND`. A selected foot unit on an
  empty marker cell uses `MOUSE_FOLLOW_WAYPOINT` and
  `FootClass::Set_Waypoint_Path`; a hover object still selects. Arrival
  walks `Get_Next_Waypoint`. A marker with nothing selected enters waypoint
  mode on that path. Right-click or Escape cancels
  placement first, then repair, sell, power, or waypoint. Strip
  scroll arrows (`R-UP.SHP` / `R-DN.SHP`) move `TopIndex`. Edge scroll is
  `ScrollClass::Scroll_Edge`
  (arrow cursors `MOUSE_N`…`MOUSE_NW`, barred when `Scroll_Dir` cannot
  move). The camera is `TacticalCoord` (view center); `TacPixel` subtracts
  half the tactical rect before blit, and `Tactical_Position_Limits` clamp
  that center. Arrow keys also pan. Escape returns to the menu. Skirmish lists
  `MISSIONS.PKT` and loose `.MPR` maps the same way. Movies and save/load are
  not playable yet.

## Commands

From `web/`:

```
npm install
npm run dev
```

Chromium is the current browser target. Use the page's folder button; do not
rely on `showDirectoryPicker` for a Steam install under Program Files.
