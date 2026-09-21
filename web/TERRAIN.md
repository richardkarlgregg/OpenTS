# Browser terrain and Blender tiles

Press **V** or **Remaster** above the canvas to switch between the legacy
software renderer and the WebGL2 terrain renderer. Graphics controls remain
available during scripted input locks. Gameplay, map formats, shroud and
logical mouse coordinates are independent of this choice.

## Export complete TMP pieces

Enable Remaster with **V**, then right-click any visible cell of the piece.
Choose **Export complete tile (PNG + GLB)**, then **Save selected tile.zip**.
The panel shows the TMP filename, occupied cell count and exact replacement
path. **Export tile kit (PNG + GLB)** exports every loaded TMP piece once.

Each `tiles/<theater>/<TMP filename>/tile` entry contains:

- `tile.glb`: all occupied subtiles assembled at their native grid positions
  and record heights, plus an orthographic reference camera.
- `tile.png`: the assembled original artwork, with transparency.
- `tile.json`: footprint, coordinate convention and replacement path.

For example, `cliff17.tem` is a 2×2 stamp with heights `[4, 0, 4, 0]` in
row-major order: two upper ground cells, two lower cells and two cliff quads.
Its starter has 12 triangles. The GLB contains the complete piece, regardless
of which of its four cells was clicked. It has no walls inferred from unrelated
neighboring map tiles. An existing complete-piece replacement exports its
loaded GLB unchanged; the PNG remains the original artwork.

Import the GLB into Blender. Its children are named `subtile_N` beneath one
TMP parent. Keep their relative transforms, origin and scale; do not center
each object separately. You may join the meshes. The included **Tiberian Sun
isometric reference** camera uses the game's 2:1 projection. Use Blender's
camera view to compare orientation against `tile.png`. Export all mesh objects
of the piece as **glTF Binary (.glb)** with embedded materials/images, without
animation or compression. The camera is optional when exporting back.

For this example, save the edited file at:
`web/public/remaster/tiles/temperate/cliff17.tem/tile.glb`.
Reload the mission to load it in Remaster mode. The browser downloads the ZIP;
place the edited GLB in the project folder yourself. There is no live reload
inside a running mission.

The loader matches theater, TMP filename, each occupied slot's map position,
and its relative height. A complete matching footprint is replaced **once**.
Partially overwritten stamps, missing cells or altered relative heights keep
their generated terrain or older subtile replacements. Default clear-tile map
IDs resolve to the actual clear filename. Filename matching is case-insensitive;
avoid paths differing only in case. No handwritten manifest is needed.

Older `<subtile>.glb` files still load as per-cell fallbacks with their original
coordinate convention. A matching `tile.glb` takes precedence over them.
Re-export complete pieces to migrate; renaming an old `2.glb` to `tile.glb`
does not turn it into a complete assembly. Existing user assets are not modified.
Extracting a whole kit into `public/remaster/` installs all its starter models.

Escape, Close, or a click on the map dismisses the tile panel. In Remaster
mode this panel remains available during scripted input locks; use Escape to
cancel build/repair/sell modes. Sidebar and legacy right-click behavior remain
unchanged. The page log reports loaded assets and matched complete footprints.
Restart Vite after updating its manifest plugin if it has not restarted itself.

Production builds generate `remaster/manifest.json` and copy assets into
`dist/remaster/`. Rebuild after changing those assets and deploy the build
together. Mission loading refreshes the manifest and requests current revisions.

## Coordinates and material settings

One horizontal cell side is one unit. The assembly origin is the TMP grid's
`(0, 0)` corner at base height zero. Record heights are included in the model;
the mission supplies only the placement's base elevation. In Blender, the
new complete-piece convention is X = map X, Y = **negative map Y**, Z = height.
In glTF it is X = map X, Y = height, Z = map Y. This reflection, with reversed
triangle winding, preserves the original game's screen orientation. One
height level is `sqrt(1/6)` units. Blender converts glTF Y-up to Z-up and back.

Older numbered-subtile GLBs used glTF Z = negative map Y; the loader retains
that convention only for those filenames. Complete pieces use `tile.glb` and
the new convention. Parent/node transforms are applied by the importer. Keep
the assembly origin and scale even when reshaping or joining mesh objects.

Use **Principled BSDF** and baked image textures, embedded in a GLB:

| Bake / map | Blender connection | Color space |
| --- | --- | --- |
| Base color / diffuse (color only) | Base Color | sRGB |
| Tangent-space normal (+Y / OpenGL) | Image → Normal Map → Normal | Non-Color |
| Roughness | Roughness | Non-Color |
| Metallic (normally 0 for rock/soil) | Metallic | Non-Color |
| Ambient occlusion | glTF Material Output group, Occlusion input | Non-Color |
| Emissive color | Emission Color | sRGB |

For sculpted terrain, bake high-poly detail onto the low-poly mesh's UV0.
Use a tangent normal bake and bake base color without direct/indirect lighting.
Bake AO separately so it affects ambient lighting rather than permanently
painting shadows into the diffuse texture. Preserve the low-poly silhouette
and tile boundaries. Height/displacement textures do not displace geometry;
put silhouette changes in the mesh and bake fine detail into normals.

Separate roughness/metallic images are supported when the Blender exporter
packs them. A packed ORM image uses R = AO, G = roughness, B = metallic.
Connect G and B through Separate Color to their Principled inputs. AO needs
the exporter-recognized glTF Material Output group. See the
[official Blender glTF material guide](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst).
Normal strength, roughness/metallic factors, AO strength and emissive color/
strength are read from the exported material. Diffuse/emission use sRGB;
normal and ORM data stay linear. Material channels also survive whole-map
export; individual replacement exports preserve the installed GLB bytes.

Images can be up to 4096×4096. Use UV0 in the 0–1 range and bake texture
transforms/procedural nodes into images. Opaque and alpha-clipped materials
are supported, including multiple mesh objects/materials in one piece.
The renderer uses direct sun/cursor specular lighting, with ambient diffuse;
it has no environment reflections. Transparent blending, animated/skinned
meshes, morph targets, vertex colors, compressed assets and required material
extensions other than emissive strength are unsupported. Rejected assets log
an explanation and fall back without preventing the mission from opening.
GLBs must embed their buffers/images and stay below 250,000 triangles / 100 MB.

## Material and replacement debugging

Open **Terrain debug** while Remaster is enabled:

- **Replacement tiles / assets** switches between loaded replacement GLBs and
  generated terrain immediately, retaining mission state and camera position.
  This covers both complete TMP pieces and numbered subtile assets. It does
  not change sprites or files on disk; new/edited GLBs still need a mission reload.
- **Base color / diffuse**, **Normal maps**, **Roughness**, **Metallic**,
  **Ambient occlusion** and **Emission** can be inspected independently.
  **Normal strength** multiplies the strength saved in the material.
- **Light follows cursor** places a point light along the camera ray above the
  visible surface under the pointer. Height, range and intensity are adjustable.
  It works with directional lighting off, stays inactive over the sidebar or
  hidden terrain, and follows cliffs and edited meshes. It does not cast shadows;
  the sun's existing terrain shadows remain available.
- **Surface normals**, **Wireframe**, sun controls and **Reset lighting and
  debug** remain available. Reset restores replacement assets and material maps.

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
heights. Complete-piece GLBs include all occupied records with walls against
known neighbors inside that TMP. Unknown external neighbors have no invented
height. Runtime generated terrain still joins actual map neighbors. A complete
replacement owns its assembly geometry, including its cliff faces.

TMP extra imagery contributes color, not extra geometry. `Draw_Tile` in
`code/isotype.cpp` uses Z data for painter/depth ordering; it is not a ground
height field. The starter GLB texture combines the TMP's records in their
original projected positions. Runtime cliff textures also include nearby map
artwork where a corner spans several TMP files. This is fixed-camera color
projection onto the connected walls. Empty texels are color-extended to keep
generated terrain solid. The assembled original PNG keeps its transparency.
JSON version 3 records the complete footprint and GLB/Blender axis convention.

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
