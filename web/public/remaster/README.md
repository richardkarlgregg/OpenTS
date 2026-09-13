# Remastered terrain assets

Save Blender replacements here as:

`tiles/<theater>/<TMP filename>/<subtile>.glb`

Example: `tiles/temperate/clear01.tem/0.glb`.

Use the exact relative path in the tile export ZIP. The theater and filename
are case-insensitive, but avoid duplicates differing only by case. The Vite
server lists GLBs automatically at mission load. Production builds generate
the list during `npm run build`; rebuild after adding or changing assets.

Export **glTF Binary (.glb)** from Blender, with selected tile objects,
embedded images, UVs, normals and materials. Keep the imported origin and
scale. Use static meshes, UV0 in 0–1, nonmetallic Principled BSDF with Base
Color and optional Normal Map (strength 1), and opaque or alpha-clipped
materials. Bake procedural shaders and texture transforms. Images can be up
to 4096×4096. Compression, animation, skins, metallic/roughness textures,
emission and transparent blending are not supported by the terrain renderer.
Unsupported assets are reported and fall back to generated tiles.

The adjacent PNGs and JSONs in an export ZIP are reference artwork and tile
metadata. Runtime loading only needs the GLB. The `tiles/` directory is
ignored by Git to keep extracted game artwork out of source control.

See [TERRAIN.md](../../TERRAIN.md) for coordinates and the complete workflow.
