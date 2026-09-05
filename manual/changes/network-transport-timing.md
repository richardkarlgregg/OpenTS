---
title: Adapt private network retries
category: performance
release: 0.2.0
targets:
- type: system
  id: network-transport-timing
  effect: added
credit:
- ZivDero
---

Each private connection estimates its own round trip and backs off repeated
transmissions. The retry timeout backs off with them, so a link whose latency
rises above it stays measurable instead of retransmitting every packet.
Timed-out packets keep retrying, and receive queues keep freeing space so a
recovered link can drain its backlog. Lobby traffic keeps its fixed retry
cadence. Packet layouts, event IDs, and configuration are unchanged.
