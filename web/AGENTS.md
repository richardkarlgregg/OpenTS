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
  `IDD_MAIN_MENU` dialog from `language.rc`. New Campaign runs
  `IDD_CAMPAIGN` over the title screen: the `BATTLE.INI` /
  `BATTLEFS.INI` list, the difficulty slider (`TXT_EASY` /
  `TXT_NORMAL` / `TXT_HARD`), and owner-draw OK/Cancel. PreviewPack is
  used when picking a skirmish or network map, not on this dialog.
  Campaign and skirmish loading uses
  `Pick_Load_Background_Name` (`LOAD400C`/`LOAD400D` for CD 0 / GDI,
  `LOAD400A`/`LOAD400B` for CD 1 / Nod) and `ProgressScreenClass` lines
  `TXT_LOADING_GAME1A`–`1H` at that text well. Load finishes into a
  pannable isometric tile
  view from theater TMP files
  (`ISO<Suffix>.PAL` and `Draw_Tile`), with overlay, terrain, building,
  infantry, unit, and aircraft SHPs from `OverlayPack` / the scenario INI.
  Nested theater mixes
  (`TEMPERAT.MIX` / `TEM.MIX`) and side mixes (`SIDEC01.MIX` and the matching
  uncached/CD archives) are opened the same way `Init_Theater` and
  `Prep_For_Side` mount them. Theater-palette art (`TerrainPalette=yes`,
  trees, bridges) uses `ISO<Suffix>.PAL`; tiberium uses the unit palette with
  the `[Colors]` scheme named by that tiberium's `Color=` (Riparius is green).
  Walls use the unit palette and neighbour connection frames. Building
  `ActiveAnim` overlays, `BibShape`, and `PowersUpBuilding` add-ons are drawn
  at the ART pixel offsets. Campaign structure rows carry `UpgradeLevel` and
  the upgrade type names (`BuildingClass::Read_INI`); those attach the upgrade
  `Image=` SHP to the parent (component-tower guns are `GACTWR_B`/`C`/`D`).
  A separate upgrade row still matches onto the parent foundation, not only
  the origin cell. Shape shadows are the second half of each SHP, blitted with
  `SHAPE_DARKEN`. Map lighting comes from the scenario `[Lighting]` section
  (ambient, RGB tint, height `Level`/`Ground`) plus `LightIntensity` sources
  on buildings, including `InvisibleInGame` lamp posts. Those posts and wall
  buildings that convert to overlay are not drawn. `HasSpotlight=yes`
  buildings (`BuildingClass::Unlimbo`) attach `BuildingLightClass`: RULES
  `[General]` `SpotlightMovementRadius` / `LocationRadius` / `Speed` /
  `Acceleration` / `Angle` / `Radius` drive the sweep, a temporary
  `SpotLightClass` radius-80 extra ramp brightens the ground, and
  `Draw_Depth_Glow_Line` draws the two beam edges (`75 - 6 * Sweep_Stage`,
  caster `Z+430`). Infantry use the ART
  `Sequence` Ready, Walk, FireUp, and Die frames with `HumanShape` facing;
  SHP vehicles use `Shape_Facing_Index` stand frames, walk frames while
  moving (`StartWalkFrame` + facing × `WalkFrames` + `TotalFramesWalked` %
  `WalkFrames`, advanced every `WalkRate` frames), and firing and death
  frames. House `Color=` remaps techno objects.
  Campaign `HouseClass::Read_All` builds live houses from RULES type order
  (Neutral/Special when the map lists them); `Is_Ally` is the house bitmask;
  techno rows with no live house are skipped. Buildings fire
  `BuildingClass::Get_Class_Weapon_Data`: the first attached upgrade
  `Primary=` with a loaded weapon (component-tower guns), then the parent
  type. `TechnoClass::AI` fires that through `Can_Fire` / `Fire_At`: `Inviso` warheads apply
  `Take_Damage` / `Modify_Damage` at once, other projectiles travel at
  `Speed=` then explode with the warhead `AnimList` SHP (`Combat_Anim`).
  A `Turret=yes` building (or an upgrade that brings one) aims
  `PrimaryFacing` with `ROT=` and holds `FIRE_FACING` until
  `Is_Complete_Turn` (`DIR_STEP_32`). The turret SHP stage is
  `TechnoClass::BodyShape[As_Dir32()]`, not `Shape_Facing_Index`.
  Guard auto-acquires in `ThreatRange`; a player `ACTION_ATTACK`
  (`MOUSE_CAN_ATTACK` / `MOUSE_STAY_ATTACK`) walks to a cell inside weapon
  `Range=` and stops. Infantry play ART `Sequence` `FireUp` (bullet at
  `FireUp=`) and `Die1`/`Die2` from warhead `InfDeath`; SHP vehicles use
  `FiringFrames` / `DeathFrames`. Homing, arcing gravity, particles, lasers,
  and prone crawl are not ported. Campaign infantry and vehicles use the map
  `Mission=` token (`InfantryClass::Read_INI` / `UnitClass::Read_INI`): `Guard`
  auto-acquires in `ThreatRange`, `Sleep` does not, `Hunt` is map-wide
  `Greatest_Threat` then `Approach_Target`. Computer idle after a team is
  `Guard` (`Enter_Idle_Mode`). `ALL_HUNT` pulls them off teams and hunts.
  `LOCK_INPUT` hides the mouse and ignores clicks, keys, and edge
  scroll until `UNLOCK_INPUT`; the sidebar still draws, and cameos appear
  once a factory is owned. Scripted teams still run. A campaign
  start posts `TXT_DIFFICULTY_LEVEL` then `TEXT_TRIGGER` lines at the
  top of the tactical view. Drop-pod covering fire (`2 * DropPodWeapon`)
  shells the LZ unless an ally other than the falling pod is there.
  `[Triggers]` / `[Tags]` / `[CellTags]` load after houses; live-owner
  and difficulty flags match C++.   `LogicClass` springs `LogicTags` (`TEVENT_TIME`,
  `LOCAL_SET`) before factories, then objects, then `HouseTags` (`TEVENT_BUILD`,
  `ALL_DESTROYED`). GDI1A events `PLAYER_ENTERED`, `DESTROYED`/`DESTROYED_ANY`,
  `BUILD`, `ALL_DESTROYED`, `BUILDINGS_DESTROYED`, `TIME`, and `LOCAL_SET` fire.
  Actions `TEXT_TRIGGER` (TUTORIAL.INI), `SET_LOCAL`, `FORCE_TRIGGER` /
  `DESTROY_TRIGGER`, `REVEAL_SOME`, `CENTER_VIEWPOINT`, `LOCK_INPUT` /
  `UNLOCK_INPUT`, `ALL_HUNT`, `PLAY_MOVIE` / `PLAY_INGAME_MOVIE`, and `WIN`/`LOSE` (message overlay, no score screen) run.
  `[TaskForces]` / `[ScriptTypes]` / `[TeamTypes]` load after houses and before
  triggers. `CREATE_TEAM` recruits matching live members of that house.
  `REINFORCEMENTS` / `REINFORCEMENTS_SPECIAL` spawn the task force: drop-pod
  infantry (`Droppod=yes`) use `DropPodLocomotionClass` — `POD.SHP` on the
  way down from `DropPodHeight`, `AtmosphereEntry` at the elevated start,
  covering fire of `2 * DropPodWeapon` Attack every 3 frames at a
  `CELL_LEPTON/3` scatter of the LZ unless that cell's techno is an ally,
  then the `DropPod=` landing anim and the infantry at touchdown, or a
  100-point `C4Warhead` blast and deletion if the cell has no free spot;
  transports such as DSHP carry passengers as cargo and `UNLOAD` them after
  the aircraft has landed (`FlyLocomotionClass` heading, `CurrentSpeed`
  ease, dropship climb 16, `SlowdownDistance` approach). A loaner then
  flies remaining `MOVE` or `TransportsReturnOnUnload` and is removed when
  it leaves `In_Radar`. Team scripts run
  `MOVE` / `ATT_WAYPT` / `GUARD` / `UNLOAD` / `LOOP` / `SET_LOCAL` /
  `CHANGE_HOUSE`. Placing a building with `FreeUnit=` (the GDI1A refinery)
  spawns that vehicle to the south and starts `MISSION_HARVEST`. Harvesters
  walk to overlay Tiberium, lift one unit per `HarvesterLoadRate` animation
  cycle, then enter the `Dock=` refinery pad (`Get_Cell()+(2,1)`, the bib
  cell `RADIO_MOVE_HERE` uses) and dump at `HarvesterDumpRate` into building
  `Storage=`. The credit tab is `Credits` plus stored Tiberium
  `Value=`. Harvest SHP, full radio tether, weeders, and EVA are not. Engineer
  capture, C4 sabotage, and the score screen are not. Movies follow the C++
  sequence: `WWLOGO.VQA` after MIX load, then `TS_Title.VQA` /
  `FS_Title.VQA` when picking Tiberian Sun or Firestorm from `GMENU`
  (`FS_TITLE`/`STARTUP` only when `GMENU.MIX` is absent). Intro plays
  `INTR#`/`INTRO.VQA` then `SIZZLE1.VQA`. A campaign start plays
  `Choose_Side`, then scenario `Intro`/`Brief`/`Action`, trigger
  `PLAY_MOVIE` / `PLAY_INGAME_MOVIE` (radar pane, with the VQA soundtrack), and `Win`/`Lose`.
  After MIX load the page reads `SOUND.INI` / `SOUND01.INI` into `VocClass`
  and `THEME.INI` / `THEME01.INI` into `ThemeClass`. Menu clicks play
  `AudioVisual` `GenericClick`. Weapons play `Report=` through
  `Sound_Effect_At` using the tactical view for volume and pan. Scores
  stream from `SCORES.MIX` (`Theme.Play_Song` / `Queue_Song` / `AI`) at
  `Options.ScoreVolume` (default 0.5); effects use `Options.SoundVolume`
  (default 0.7); EVA uses `Options.VoiceVolume` (default 1.0). Westwood
  `.AUD` (PCM, delta, SOS/IMA) is decoded in the page. EVA queues through
  `Speak` / `Speech[]` (`VOX_UNIT_READY`, `VOX_CONSTRUCTION`, `VOX_BUILDING`,
  `VOX_TRAINING`, `VOX_NO_FACTORY`, `VOX_CANCELED`, `VOX_DEPLOY`,
  `VOX_REINFORCEMENTS`, `VOX_ACCOMPLISHED` / `VOX_FAIL`, trigger
  `PLAY_SPEECH`). `CENTER_VIEWPOINT` pans with `Setup_Trigger_Scroll` (lerp
  at the action's scroll speed) rather than jumping. Explosion SHPs play ART `Report=` / `StartSound=` at
  spawn and `ExpireSound=` on death. The menu Options item opens the lite
  volume sliders (Music / Sound / Voice, 0–10).
  `HouseClass::AI` still only recalcs power; computer
  base-building is not. `Assign_Handicap` is not.
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
  `FreeRadar=yes`); each pane pixel is coloured from
  `Radar_Pixel_To_Cell` the way `Plot_Radar_Pixel` fills
  `BackgroundSurface`. Clicking it jumps `TacticalCoord`. Clicking a mapped
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
  Queue counts print at `QUEUE_COUNT_X_OFFSET`. Infantry walk with
  `WalkLocomotionClass` (`Basic_Path` / `Adjacent_Cell` facings,
  `Move_Coord` toward `HeadToCoord`, arrive within 17 leptons). Vehicles use
  `DriveLocomotionClass`: `Start_Of_Move` picks a `TrackControl` entry from the
  current facing and the next path facing, `While_Moving` steps the raw track
  offsets (smooth-turn `F_T`/`F_X`/`F_Y`/`F_D`) by `SpeedAccum` against
  `(PIXEL_LEPTON_W + PIXEL_LEPTON_H) / 2`, and `PrimaryFacing` comes from the
  track `Dir256` (ROT turn-in-place before a track that does not already face
  the first step). Infantry
  `Mark_Head_To` takes `Closest_Free_Spot` (spots 2, 3, and 4; the cell
  centre and NW are never free), so three infantry share a cell. Vehicles
  set `Flag.Occupy.Vehicle` and wait rather than stack. Path search
  ignores occupy (`MOVE_TEMP` cost); the step does not, and idle occupiers
  `Scatter` (`Nearby_Location` 1x1). A cell whose infantry bits are
  `0x1C` scatters everyone on it. Search is `AStarClass::Find_Path` (hierarchical subzones with
  `Region_Threat` * `ThreatAvoidanceCoefficient` on rough/coarse edges,
  up to five banned-edge retries after `Ban_Blocked_Subzone_Edges`, then
  cell A* with a Euclidean heuristic, facing tie-break costs, and
  `TUNNEL` jumps through `[Tubes]`). `Cut_Corners` / `Optimize_Moves`
  skip tunnel steps. `MapClass::Reset_Subzone` builds fine/rough/coarse
  blocks (2x2, 4x4, 8x8). `BRIDGE1`/`BRIDGE2`/`RAILBRDG1`/`RAILBRDG2`
  overlay cells call `Set_Under_Bridge` and mark a 3-cell-wide deck
  (`IsUnderBridge`, `IsBridgeTraversable`; the far strip cell is not
  traversable). Theater `BridgeSet`/`TrainBridgeSet` TMP spans record
  `ZoneConnections` like `MapClass::Compute_Zone_Connections`, union the
  bank zones, and stitch subzone links at the span ends. `hs_anchor`
  maps a deck cell to the nearer span end. Cell A* may step a
  traversable deck cell that is outside the hierarchical corridor.
  `CliffBackImpassability=2` marks cells 4+ below listed neighbours as
  `LAND_ROCK` and does not block a traversable deck cell.
  `FootClass::Can_Reach` allows height 0, height 1 when the lower cell
  has a TMP ramp, or height 4 onto a traversable deck.
  `WalkLocomotionClass` and `DriveLocomotionClass` set `IsOnBridge` on
  that height-4 step onto `IsUnderBridge` and clear it when the new cell
  is not under the deck. Draw uses `Get_Cell_Height` (`cell->Height`
  plus `BRIDGE_CELL_HEIGHT` while on the deck). TMP `TileType`
  maps to `LandType`; `Can_Enter_Cell` refuses a cell whose
  `Ground[land].Cost[SpeedType]` is 0 unless the step is on a bridge
  deck (`IsUnderBridge` and a height-4 climb or already on spanned
  cells). Infantry default `SPEED_FOOT`, aircraft `SPEED_WINGED`
  (always pass), vehicles `SPEED_WHEEL` or `SPEED_TRACK` if
  `Crusher=yes`, then `SpeedType=`. Hover/float/amphibious columns come
  from RULES `[Water]` and the other land sections. Overlay
  `NoUseTileLandType` (the default, and low `LOBRDG` pieces) keeps the
  overlay `Land=`; high `BRIDGE1`/`BRIDGE2` set that flag to no, so the
  water/rock tile remains and the deck is the walkable path. Overlay
  `Wall=yes` cells are impassable. Player move
  orders require `Can_Player_Move` (`House->Is_Player_Control()`). Owned
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
  `Assign_Destination` to the pad. Aircraft use `FlyLocomotionClass`:
  `Move_Coord` along `PrimaryFacing`, `CurrentSpeed` eases toward
  `TargetSpeed` by 0.1 per frame, dropships climb at most 16 leptons, and
  `IsDropship` eases `FlightLevel` inside `SlowdownDistance` before
  `Land()`. Below 300 leptons `Process_Landing` sets `CommencedLanding`,
  plays `AuxSound2`, and spawns `DROPLAND` (`IsDropship`) or `CARYLAND`
  (`Carryall`). `Take_Off` plays `AuxSound1`. Aircraft shadows sit on
  ground height (`Get_Height_GL`), not at `HeightAGL`. Ground occupy is
  ignored. The waypoint button calls
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
  that center. Arrow keys also pan. Escape returns to the menu.   Skirmish lists
  `MISSIONS.PKT` and loose `.MPR` maps the same way. Save/load is not.

## Commands

From `web/`:

```
npm install
npm run dev
```

Chromium is the current browser target. Use the page's folder button; do not
rely on `showDirectoryPicker` for a Steam install under Program Files.
