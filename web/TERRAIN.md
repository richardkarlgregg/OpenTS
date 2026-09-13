# Browser terrain and Blender tiles

Press **V** or **Remaster** above the canvas to switch between the legacy
software renderer and the WebGL2 terrain renderer. Graphics controls remain
available during scripted input locks. Gameplay, map formats, shroud and
logical mouse coordinates are independent of this choice.

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
Generated artwork outlines can extend beyond the logical cell boundary.
Keep the cell origin; do not rescale each model to fit its bounding box.

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

`src/terrain-tiles.ts` builds reusable templates in local tile coordinates.
Map data supplies the tile identity and placed height. TMP ramp metadata
supplies the corner/crease heights. The two logical ramp triangles define
the ground planes. An eight-corner outline follows the painted base diamond;
clipping it at the ramp crease takes at most ten ground triangles. TMP extra
artwork adds at most eight triangles on a coarse depth grid. A flat tile
uses eight triangles, including its raster boundary. There is no geometry per
pixel. Edge-on ramp artwork uses a coarse reference surface alongside its
logical ground faces.

These are editable starting shapes. Raster tile edges and cliff silhouettes
will not match the old per-pixel reconstruction exactly. TMP depth is an
approximation, and 2D artwork cannot reveal hidden cliff backs, tunnel
interiors or bridge undersides. Model those surfaces in Blender. The original
PNG is provided independently so its silhouette remains available as reference.

Templates are cached by loaded subtile object. A replacement is parsed once
per unique identity at mission load, and all its occurrences share materials
and image pages. Render batches combine geometry by map chunk and material.
Persistent map caching and GPU instancing are not implemented yet.

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
shadow detail. Shadows from generated cliff relief are approximate.

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
