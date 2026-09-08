---
command_id: ToggleRemasteredGraphics
---

Switches the tactical terrain between the legacy 2D tile blit and remastered GPU lighting. The switch is local presentation state: it is not saved, not sent to other machines, and does not change simulation. [Remastered graphics](/systems/remastered-graphics/) describes what each mode draws. After [`KEYBOARD.INI`](/formats/keyboard-ini/) loads, the command takes V, taking that key back from whatever the file gave it. F3 does not run this command.
