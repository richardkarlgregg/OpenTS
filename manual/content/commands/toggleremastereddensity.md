---
command_id: ToggleRemasteredDensity
---

Switches remastered terrain between a 4-by-4 cell mesh and an 8-by-8 cell mesh. The denser mesh interpolates the same cell lighting across more vertices, so ramps, the cursor lamp, and shadow edges can change inside a tile. The switch does nothing visible until remastered graphics is on. Density starts at 4-by-4. It is local presentation state: it is not saved, not sent to other machines, and does not change simulation. [Remastered graphics](/systems/remastered-graphics/) describes both meshes. After [`KEYBOARD.INI`](/formats/keyboard-ini/) loads, the command takes Y, taking that key back from whatever the file gave it.
