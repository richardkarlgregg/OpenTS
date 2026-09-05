---
title: Adapt multiplayer timing to every connection
category: performance
release: 0.2.0
targets:
- type: system
  id: network-synchronization
  effect: added
credit:
- ZivDero
---

Compressed games start at a two-frame send period with six frames of look-ahead,
then calibrate from every player's process time and worst local round trip.
Worsening applies immediately; recovery needs sustained headroom and no player
waiting 0.1 s or longer, and a decrease drains the old scheduling horizon before
it takes effect. The inherited per-frame slowdown for a lagging player is
removed; at adaptive send periods it ran on every frame.

The disabled WOL Connection slider shows the effective 1–10 rung and tier; the
message list announces target-tier changes. Game speed remains separate.
`LATENCYFUDGE` stays in the replay layout but is no longer emitted or used by
the adaptive policy.

`NETWORK_REPORT` extends network events and multiplayer recordings. Players and
recordings therefore require the same OpenTS snapshot; existing event IDs are
unchanged and no configuration migration is needed.
