# Browser terrain and Blender tiles

Press **V** or **Remaster** above the canvas to switch between the legacy
software renderer and the WebGL2 terrain renderer. Graphics controls remain
available during scripted input locks. Gameplay, map formats, shroud and
logical mouse coordinates are independent of this choice.

## Right-click export

Enable Remaster with **V**, then right-click a visible ground tile or cliff
face. The tile panel shows its TMP filename, subtile, map cell and exact
replacement path. Choose **Export this tile (PNG + GLB)**, then **Save selected
tile.zip** above the canvas. The ZIP contains only that tile's GLB, original
PNG, identity/path JSON and instructions.

Generated tiles export the selected cell's actual mesh and cliff walls,
including boundaries with other TMP files. Map position and elevation are
removed so the GLB is ready for local tile editing in Blender. Existing
replacements export their loaded GLB without losing your edits. The PNG is
always the original artwork. Keep the origin and scale when editing.

Save the edited GLB under `web/public/remaster/tiles/<theater>/<TMP filename>/<subtile>.glb`,
using the exact path displayed in the panel. Reload the mission: every
matching tile uses it in Remaster mode. Missing or invalid files keep the
generated terrain. Default clear-tile map IDs share the actual clear tile's
filename. A tile replacement applies to every occurrence, so model boundary
walls to fit its intended neighbors; the selected cell's neighbors may vary
on other maps.

Escape, Close, or a click on the map dismisses the tile panel. In Remaster
mode, right-clicking tactical terrain opens this panel even during scripted
input locks; use Escape to cancel build/repair/sell modes. Sidebar and legacy
right-click behavior are unchanged. The browser downloads the ZIP; place the
edited GLB in the project folder yourself. The running mission does not
hot-reload edited files.

## Export and replace individual tiles

1. Open a mission in the theater you want to edit.
2. Click **Export tile kit (PNG + GLB)**. When preparation finishes, click
   **Save tile kit.zip** and extract it into a working folder.
3. The ZIP contains every loaded subtile in that theater, once each. Each
   `tiles/<theater>/<TMP filename>/<subtile>` entry has an original `.png`,
   a low-poly `.glb` starting mesh and `.json` identity metadata.
4. Import a GLB into Blender. Remodel the tile and edit its UVs and material.
   Keep the imported origin, scale and placement. Other imported tiles can
   be used as references; export only the objects belonging to this tile.
5. Export **glTF Binary (.glb)** with selected objects, materials and embedded
   images, without animation or compression. Save to the same relative path
   under **web/public/remaster/**. For example:
   `web/public/remaster/tiles/temperate/clear01.tem/0.glb`.
6. Open the mission again. The dev server discovers GLBs automatically;
   no hand-written manifest is required. The page log reports how many unique
   replacements loaded and identifies rejected files. Missing or unsupported
   replacements use generated tiles. Restart Vite once after updating the
   project configuration to enable discovery.

Matching uses theater, TMP filename and subtile number, not a map-specific
tile number or cell coordinate. Every occurrence of the matching tile uses
its replacement. Filename matching is case-insensitive; do not create two
paths differing only in case. PNG and JSON files are reference material;
runtime loading only needs the GLB. Extracting an entire kit directly into
`public/remaster/` installs every starter mesh in that kit as a replacement.

Production builds generate `remaster/manifest.json` and copy the assets into
`dist/remaster/`. Run `npm run build` after changing those assets, and deploy
the build together. The generated manifest records file size and modification
time. Mission loading refreshes it and requests current asset revisions.

## Coordinates and material settings

One horizontal cell side is one unit. The origin is the cell corner, and the
opposite corner is `(1, 1)` in the two map axes. Cell elevation is supplied by
the map; do not bake a mission's elevation into a replacement.
Generated ground vertices stay within the cell boundary. Cliff walls descend
from that boundary. Keep the cell origin; do not rescale each model to fit
its bounding box.

In GLB coordinates, X follows the first cell axis, Y is up and negative Z
follows the second cell axis. One height level is `sqrt(1/6)` units. Blender's
importer converts glTF Y-up to Blender Z-up automatically. Exporting through
Blender converts back. Parent/node transforms are applied by the importer;
keeping the original tile origin is still essential for placement.

Use a nonmetallic **Principled BSDF** with Base Color and an optional
**Normal Map** at strength 1. Images are embedded and can be up to 4096×4096.
UV0 must be in the 0–1 range. Bake procedural shaders and texture transforms
into images/UVs. Opaque and alpha-clipped materials are supported. Multiple
static mesh objects and materials within one tile are supported.

The runtime does not implement metallic/roughness textures, AO textures,
emission, transparent blending, animated/skinned meshes, morph targets or
compressed/extension-dependent GLBs. Rejected assets produce an explanation
and fall back without preventing the mission from opening. GLBs must embed
all buffers and images. A tile is limited to 250,000 triangles and 100 MB;
these are validation limits, not recommended modelling budgets. Keep meshes
small because many cells can repeat one tile.

## Generated meshes and density

`src/terrain-tiles.ts` uses four ground corners and two triangles per cell.
Ramps split along the crease defined by `CellClass::Get_Height` in
`code/cell.cpp`. Ramps 17–20 use its half-level ground plane. A steep ramp
may be edge-on to the fixed camera; no extra camera-facing mesh is invented.
GLBs share matching position/UV/normal vertices, so a flat tile has four
vertices and six triangle indices. A wireframe still shows the diagonal
needed to triangulate a quad.

Neighboring map cells provide both endpoint heights of every shared edge.
Equal heights produce no wall. A height discontinuity produces a vertical
quad, or a triangle where the gap tapers to zero. Crossing slopes split the
wall at their intersection. The higher cell owns each section exactly once.
Wall planes align with the X or Y cell axis, connecting the upper and lower
ground edges. There are no pixel-outline strips, depth grids, internal walls
on flat ground, or horizontal slices through cliff faces. Map boundaries
remain open; no arbitrary skirt extends below the map.

`code/isotype.h` defines the TMP slot order as `x + MapWidth*y`.
`IsometricTileClass::Mark` in `code/isotile.cpp` stamps each record's height
and ramp into its cell. The browser retains those record locations and
heights. Tile-kit GLBs include walls against known neighbors within that TMP
stamp. Unknown neighbors outside the stamp have no invented height. A
replacement owns its complete tile geometry, including cliff walls; mission
loading does not add generated walls to that replacement. Match the adjoining
terrain when modelling replacement boundaries. Existing GLBs keep their old
geometry; export a new kit to obtain these revised starter meshes.

TMP extra imagery contributes color, not extra geometry. `Draw_Tile` in
`code/isotype.cpp` uses Z data for painter/depth ordering; it is not a ground
height field. The starter GLB texture combines the TMP's records in their
original projected positions. Runtime cliff textures also include nearby map
artwork where a corner spans several TMP files. This is fixed-camera color
projection onto the connected walls. Empty texels are color-extended to keep
generated terrain solid. The separate original PNG keeps its transparency.
JSON version 2 records both original-image and mesh-texture offsets.

These meshes provide the game's logical ground and grid-aligned cliffs.
Rock protrusions, hidden backs, tunnel interiors and bridge undersides need
modelling in Blender: the 2D art does not define their complete geometry.
Artwork overhanging a logical edge will not have an identical silhouette.

TMP stamp textures are cached and share atlas slots. Cliff color patches are
built once for the mission from a spatial index of nearby tile images. A
replacement is parsed once per unique identity at mission load; repeated
instances share materials and image pages. Render batches combine geometry
by map chunk and material. Persistent map caching and GPU instancing are not
implemented yet.

The previous dense projection builder remains in `src/terrain-mesh.ts` for
its geometry helpers and regression comparisons; it is not the runtime
terrain path or the source of tile-kit meshes.

## Lighting and debug

Open **Terrain debug**. Textures, directional lighting, terrain shadows,
scenario lighting/tint, wireframe and surface normals can be toggled.
Disabling textures gives a grey surface while preserving alpha masks. Normal
maps from replacements affect lighting; the surface-normal view shows the
resulting normals as RGB. Sun direction, elevation and ambient light are
adjustable. Disabling directional lighting also removes its cast shadows.
Settings last for the tactical session and do not modify exported assets.

Terrain shadows use a 2048×2048 depth map fitted to the complete map, with
alpha masking, nine depth comparisons and receiver-plane depth correction.
Sun changes rebuild it; camera movement reuses it. Large maps have lower
shadow detail. Shadows follow the generated ground and connected cliff walls.

Objects, overlays, selections, shroud and the sidebar retain their software
rendering. Buildings and units keep their sprite shadows. The software
foreground is drawn over black and white backgrounds to recover color and
transmission, then composited over the terrain. This does not add sprite
versus terrain depth testing or convert units to 3D.

The camera keeps the original 48×24 projection and 12-pixel elevation step.
GPU resolution follows canvas size and device pixel ratio, capped at
3456×2160 while retaining the original 8:5 aspect ratio. Higher resolution
output does not add detail to original low-resolution textures.

## Whole-map export

**Export whole map** prepares the currently assembled map as embedded-texture
`.gltf`, including unexplored cells and replacements. **Save .gltf** downloads
it. Ctrl+Shift+E also starts this export if the browser passes the shortcut.
This export is for inspecting the assembled map; it does not install a tile
replacement. Tile kits are the supported authoring workflow. The whole-map
export currently includes base-color textures and geometric normals, but not
replacement normal-map textures or runtime light settings.

Preparation reports progress and yields between items. Leaving the tactical
view cancels pending work, removes controls and releases download URLs/GPU
resources. Large exports can still take time and memory. GPU failures return
the view to legacy graphics with a message in the page log.

## Checks

Run `npm run test:terrain` for projection, dense comparison, low-poly ramp,
identity, placement and fallback checks. Run `npm run build` for TypeScript
and production bundling. With Vite running:

- `/tests/terrain-browser.html` exercises WebGL rendering, shadows, debug
  modes, exports and the tactical controls using generated data.
- `/tests/tile-assets-browser.html` checks PNG/GLB/ZIP round trips, transforms,
  embedded textures and normals, mixed replacement/fallback rendering,
  malformed files and cancellation. Its synthetic replacement can be saved
  as `public/remaster/tiles/temperate/clear01.tem/0.glb`; reloading the page
  should report one discovered replacement. Remove that test file afterward.

Tests require no proprietary assets. The `public/remaster/tiles/` directory
is ignored by Git to keep extracted artwork out of source control. Native
Win32 rendering and its remaster formats are unchanged.
