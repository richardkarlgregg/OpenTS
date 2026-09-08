---
command_id: ToggleRemasteredTextures
---

Switches remastered terrain between original isometric tile artwork on the 3D quads and untextured control-color lighting. The switch does nothing visible until remastered graphics is on. It is local presentation state: it is not saved, not sent to other machines, and does not change simulation. Textures start on. [Remastered graphics](/systems/remastered-graphics/) describes both draws. After [`KEYBOARD.INI`](/formats/keyboard-ini/) loads, the command takes T, taking that key back from whatever the file gave it.
