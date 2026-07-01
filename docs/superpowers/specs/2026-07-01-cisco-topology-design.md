# Cisco Topology Block for HyperFrames — Design Spec

**Date:** 2026-07-01
**Status:** Draft for review
**Author:** Frazier Smith (with Claude)

## 1. Goal

Add the ability to **programmatically display and animate Cisco network topology
diagrams** inside HyperFrames presentations. An instructor describes a topology in
words (or JSON); the system renders it with official Cisco device icons and animates
it on the HyperFrames timeline — devices revealing on cue, packets flowing hop-by-hop,
protocol/interface states changing, and links failing over to backup paths.

The deliverable is a **reusable HyperFrames block** (`cisco-topology`) plus a
**Claude authoring skill** (`/cisco-topology`) so every future diagram takes minutes,
not hours, and drops cleanly into any deck built with the `slideshow` skill.

## 2. Scope

**In scope (this project):**
- A topology **JSON schema** (nodes + links + timed events) — the central contract.
- A **renderer**: JSON → SVG DOM with official Cisco icons.
- An **animator**: `events[]` → a single seekable GSAP timeline.
- **Offline auto-layout**: ELK/dagre run at authoring time, coordinates baked into JSON.
- An **authoring skill**: free-text description → validated JSON → wired HyperFrames block.
- Packaging as a HyperFrames registry-style block + the skill.

**Out of scope (parked, designed-for-later):**
- **RacketTazer / PT-IPC bridge** — extracting real topologies from `.pkt`/`.pka` files
  via the existing Cisco IPC integration in `CiscoPT/`. The schema is deliberately shaped
  so a future extractor can emit the *same* JSON with zero renderer changes. Not built now
  (hand-authored source was chosen).
- Live data sources (CDP/LLDP, NetBox, config parsing), GNS3/draw.io import.
- Curved/spline packet paths (needs GSAP MotionPathPlugin; v1 uses straight-line lerp).

## 3. Architecture decision (settled)

**Runtime = deterministic inline SVG + GSAP. No Cytoscape.js / vis-network / D3-force in
the render path.**

HyperFrames renders video by seeking a single **paused** master timeline to time `t` and
capturing a frame. Graph libraries animate on their own `requestAnimationFrame` wall-clock
and settle force-directed layouts over real time — seek them to `t = 4.0s` twice and you can
get two *different* frames, which breaks frame-accuracy. A GSAP timeline has no independent
clock (`.seek(t)` / `.progress(p)` are pure functions of `t`), which is exactly why it is
HyperFrames' default runtime.

Therefore:
- **Layout is resolved before render** (offline, baked coordinates).
- **All motion is expressed as seekable GSAP tweens** over an allowlisted set of properties.

## 4. The schema is the product

Everything else is a producer or consumer of one JSON document. Two static sections
(`nodes`, `links`) plus one timed section (`events`) that is the heart of the whole design.

```jsonc
{
  "canvas": { "width": 1920, "height": 1080, "padding": 120 },
  "layout": { "algorithm": "layered", "direction": "DOWN", "seed": 1 },

  "nodes": [
    { "id": "R1",  "type": "router",   "label": "Edge R1", "x": 300, "y": 200 },
    { "id": "SW1", "type": "switch",   "label": "Access",   "tier": 2 },
    { "id": "A",   "type": "pc",       "label": "PC-A" }
  ],

  "links": [
    { "id": "l1", "from": "R1", "to": "SW1", "type": "ethernet", "label": "Gi0/1" },
    { "id": "l2", "from": "SW1", "to": "A",  "type": "ethernet" }
  ],

  "events": [
    { "at": 0.0, "type": "reveal",   "target": "R1" },
    { "at": 0.4, "type": "reveal",   "target": "SW1" },
    { "at": 0.8, "type": "reveal",   "target": "l1", "mode": "draw" },
    { "at": 2.0, "type": "flow",     "path": ["A","SW1","R1"], "label": "ICMP", "kind": "unicast" },
    { "at": 5.0, "type": "setState", "target": "l1", "state": "blocking" },
    { "at": 7.0, "type": "fail",     "target": "l1", "reroute": ["A","SW1","R2","B"] }
  ]
}
```

### 4.1 `nodes[]`

| Field | Req | Notes |
|---|---|---|
| `id` | ✓ | Unique; referenced by links and events. |
| `type` | ✓ | Maps to a Cisco icon symbol (see §6). e.g. `router`, `switch`, `l3switch`, `firewall`, `ap`, `wlc`, `server`, `pc`, `cloud`, `internet`, `loadbalancer`. |
| `label` |  | Display name under the icon. Defaults to `id`. |
| `x`, `y` |  | Absolute coords. **If present, overrides auto-layout** for this node. |
| `tier` |  | Optional layer hint for layered layout (0 = top). |
| `group` |  | Optional cluster hint (rack, site, VLAN). |

### 4.2 `links[]`

| Field | Req | Notes |
|---|---|---|
| `id` | ✓ | Unique; referenced by events. |
| `from`, `to` | ✓ | Node ids. |
| `type` |  | `ethernet` (solid), `serial`, `fiber`, `wireless` (dashed), `trunk` (thick). Drives stroke style. |
| `label` |  | Interface/label text near the link (e.g. `Gi0/1`). |
| `bidirectional` |  | Cosmetic; default true. |

### 4.3 `events[]` — the one interpreter

All four requested animation families collapse into a **single event interpreter**. Each
event has `at` (seconds on the block's local timeline) and a `type`:

| `type` | Meaning | Animator handler (allowlisted props) |
|---|---|---|
| `reveal` | Node or link appears | Node: `opacity` 0→1 + `scale` pop (`back.out`). Link `mode:"draw"`: CSS var `--dash` (stroke-dashoffset) length→0; else `opacity`. |
| `flow` | Packet traverses a path | Spawn a dot/frame element; **lerp `x`/`y` hop-by-hop** between node coords along `path[]`. `kind`: `unicast` \| `broadcast` (flood = multiple dots) \| `multicast`. |
| `setState` | Node/link changes state | Recolor via `color` / `borderColor` / `backgroundColor` or a CSS var. States: `up`, `down`, `blocking`, `forwarding`, `learning`, `active`, `standby`, `selected`. |
| `fail` | Link/device fails, optional reroute | Recolor link red + fade in an ✕ badge (`opacity`); if `reroute`, emit a follow-on `flow` along the backup path. |

Design rule: **no per-animation "engine"** — one handler per event type, all writing to the
same GSAP master timeline. New animation ideas become new event types, not new subsystems.

## 5. Components around the schema

### 5.1 Renderer (JSON → SVG DOM)
- Emits one `<svg>` sized to `canvas`.
- `<defs>` holds inline Cisco icon `<symbol>`s; each node is a `<use>` + `<text>` label.
- Links are `<line>`/`<path>` elements with `stroke-dasharray` set to their own length so the
  `reveal mode:"draw"` handler can animate `stroke-dashoffset` via a CSS variable.
- Pure and deterministic: same JSON → same DOM. No layout, no animation here.

### 5.2 Animator (`events[]` → GSAP timeline)
- Builds **one** `gsap.timeline({ paused: true })` synchronously at load.
- Registers at `window.__timelines["cisco-topology"]` (key === block `data-composition-id`).
- Iterates `events[]`, dispatching each to its handler at absolute time `at`.
- Uses `gsap.fromTo()` for entrances (sub-comp seek-back safety), never `gsap.from()`.
- Only touches allowlisted properties: `opacity, x, y, scale, rotation, color,
  backgroundColor, borderColor, borderRadius`, and CSS variables. **Never** `display` /
  `visibility` / `width` / `height` / `top` / `left`.

### 5.3 Layout (offline, baked)
- The **authoring skill** runs ELK (`elkjs`, algorithm `layered`) or dagre in Node at author
  time, computes node coordinates, and **writes `x`/`y` back into every node** of the JSON.
- ELK `randomSeed` is pinned (schema `layout.seed`) so re-runs reproduce; dagre is
  deterministic on fixed input order. Manual `x`/`y` in the source always wins.
- The **runtime renderer never runs layout** — it reads baked coordinates only. This is what
  keeps auto-layout compatible with frame-accurate rendering.
- Helpers beyond ELK: `ring`, `star`, `grid`, `tier/row` for quick canonical shapes.

### 5.4 Authoring skill (`/cisco-topology`)
- Input: free text, e.g. `R1--R2, hosts A,B on SW1 under R1, ping A→B then fail R1--R2`.
- Pipeline: **free text → draft JSON (LLM) → validate against the schema → bake layout →
  emit block file → wire into the target composition.**
- The schema is the guardrail; the terse DSL is just a friendly front door. Validation failure
  loops back to regeneration, never ships invalid JSON.
- Writes/updates the vault Sophia/curriculum pipeline only if relevant (out of band).

## 6. Icon set (official Cisco)

Curate a subset of the **official Cisco topology icon set** as inline SVG `<symbol>`s:
`router, l3switch, switch, multilayer-switch, firewall (ASA), ap, wlc, server, pc, laptop,
phone, cloud, internet, loadbalancer, nas`.

- Delivered as one `icons.svg` `<defs>` block reused by every diagram (defined once inside the
  block `<template>`).
- **Licensing:** Cisco's topology icons are licensed for use in diagrams/presentations, so they
  are fine for course decks. If the skill/block is ever published publicly, do **not** ship the
  raw Cisco SVGs as a redistributable asset pack — swap to the flat/line set for the public build.

## 7. HyperFrames integration contract

- The block is a **sub-composition**: root `<div data-composition-id="cisco-topology">`
  wrapped in `<template>`; **all** `<style>`/`<script>`/markup live *inside* the template
  (head is discarded by the runtime).
- Host wires it as a clip: `data-composition-src`, matching `data-composition-id`,
  `data-start`, `data-duration`, `data-track-index`, `data-width`, `data-height`.
- Duration comes from the host clip's `data-duration`, not GSAP timeline length.
- Determinism rules honored: single paused timeline built synchronously; no `Math.random` /
  clocks (layout is offline; any tie-break jitter is seeded); finite repeats only; no animating
  `display`/`visibility`.
- Per-diagram files: the skill generates one sub-comp HTML per topology (JSON baked inline)
  that reuses the shared renderer+animator engine script. The "block" is the engine + template;
  instances are generated files.
- **Unique instance ids:** each generated diagram gets a unique `data-composition-id`
  (e.g. `cisco-topology-ospf`, `cisco-topology-stp`) and a matching `window.__timelines[<id>]`
  key, so multiple topology diagrams can coexist in one deck without colliding. The skill
  derives the suffix from the diagram's slug and guarantees uniqueness within the host.

## 8. Packaging & file layout

```
cisco-topology-block/
├── compositions/
│   └── cisco-topology.html         # the block: <template> + engine + icon <defs> + (baked JSON)
├── engine/
│   ├── renderer.js                 # JSON → SVG DOM
│   ├── animator.js                 # events[] → GSAP timeline
│   └── schema.json                 # JSON Schema for validation
├── layout/
│   └── layout.mjs                  # offline ELK/dagre → baked x/y (Node, authoring-time)
├── assets/
│   └── cisco-icons.svg             # curated official Cisco <symbol> set
├── skill/
│   └── cisco-topology/SKILL.md     # /cisco-topology authoring skill
└── examples/
    └── ospf-convergence.json       # sample topologies
```

## 9. Sequencing — thin vertical slice first

Ship a working end-to-end pipeline before breadth, to de-risk the timeline-registration
mechanism before three more animators sit on top of it.

- **v1 — Reveal.** Schema + renderer + `reveal` handler + offline layout, rendered to a real
  MP4 via `hyperframes render`. Proves the whole path (schema → SVG → GSAP → frame → video).
- **v2 — Flow.** Add the `flow` handler (hop-by-hop lerp; unicast, then broadcast flood).
- **v3 — setState.** Add `setState` (recolor states: STP blocking/forwarding, up/down, HSRP
  active/standby, VLAN recolor).
- **v4 — Fail/failover.** Add `fail` + reroute (chains a follow-on `flow`).
- **v5 — Skill polish.** Terse-DSL parsing, validation loop, auto-wiring into a deck.

Each version is one more event handler on the same substrate — no rework of v1.

## 10. Validation & testing

- **Schema:** every emitted JSON validates against `schema.json` before render.
- **HyperFrames gates:** `npx hyperframes lint` (0 errors), `validate` (0 console errors),
  `inspect` (overflow intentional), plus a **visual smoke test** — `snapshot --at <midpoints>`
  and eyeball, since the sub-comp mount pitfalls (style/script outside `<template>`,
  id/timeline-key mismatch) are only caught at render.
- **Determinism check:** render the same block twice; frames must be byte-stable.
- **Per event type:** a fixture topology exercising reveal/flow/setState/fail with a golden
  frame at a known `t`.

## 11. Open questions / future

- **PT-IPC bridge (parked):** a `layout.mjs`-adjacent extractor that drives `CiscoPT/`'s IPC
  layer to dump real `.pkt`/`.pka` device+link data into this schema. Slots in as a second
  source with no renderer change.
- **Curved paths:** add GSAP MotionPathPlugin if straight-line lerp looks too rigid for dense
  topologies.
- **Auto-timing:** optionally derive `at` values from a narration track so reveals sync to VO.
```
