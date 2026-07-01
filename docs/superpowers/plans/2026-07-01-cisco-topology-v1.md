# Cisco Topology Block (v1 — Build-up Reveal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the thin vertical slice — a hand-authored topology JSON renders official-icon SVG and animates a build-up reveal on the HyperFrames timeline, producing a real MP4.

**Architecture:** One JSON schema (`nodes`/`links`/`events`) is the contract. A pure Node engine (validate → offline ELK layout → SVG render → reveal-tween plan) bakes a self-contained HyperFrames sub-composition block. The render path is deterministic inline SVG + a single paused GSAP timeline; graph libraries never touch a frame.

**Tech Stack:** Node ≥20 (ESM), `ajv` (schema validation), `elkjs` (offline layout), GSAP 3.14.2 (CDN, browser runtime), `node:test` (unit tests), `npx hyperframes` (lint/validate/inspect/render).

## Global Constraints

- Node ES modules only (`"type": "module"`); engine files use `.mjs`.
- Render path is deterministic: no `Math.random()` / `Date.now()` / `performance.now()` driving visuals; ELK layout runs **offline at authoring time** and coordinates are **baked** into the JSON — the runtime never lays out.
- Animate ONLY allowlisted properties: `opacity, x, y, scale, rotation, color, backgroundColor, borderColor, borderRadius`, and CSS variables. Never `display` / `visibility` / `width` / `height` / `top` / `left`.
- Exactly one `gsap.timeline({ paused: true })` per block, built synchronously, registered at `window.__timelines["<id>"]` where `<id>` === the block root's `data-composition-id`.
- Sub-composition transport: root `<div data-composition-id>` wrapped in `<template>`; ALL `<style>`/`<script>`/markup live inside the `<template>`.
- Render duration comes from the host clip's `data-duration`, not GSAP timeline length.
- GSAP version pinned: `https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js`.
- ELK `elk.randomSeed` pinned from `topology.layout.seed` (default `1`); coordinates rounded to integers so re-runs reproduce.

---

### Task 1: Project scaffold + schema + validator

**Files:**
- Create: `cisco-topology-block/package.json`
- Create: `cisco-topology-block/engine/schema.json`
- Create: `cisco-topology-block/engine/validate.mjs`
- Test: `cisco-topology-block/test/validate.test.mjs`

**Interfaces:**
- Produces: `validateTopology(topo) -> { valid: boolean, errors: string[] }` (checks schema **and** referential integrity: link `from`/`to`, event `target`/`path`/`reroute` must reference existing ids).

- [ ] **Step 1: Initialize the project and install deps**

Run:
```bash
cd "/Users/frazier/Documents/Design/Hyperframes/cisco-topology-block"
npm init -y
npm pkg set type=module
npm pkg set scripts.test="node --test"
npm install ajv@8 elkjs@0.9
```
Expected: `package.json` with `"type": "module"`, a `test` script, and both deps in `dependencies`.

- [ ] **Step 2: Write the schema**

Create `engine/schema.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["nodes", "links"],
  "properties": {
    "canvas": {
      "type": "object",
      "properties": {
        "width": { "type": "number" },
        "height": { "type": "number" },
        "padding": { "type": "number" }
      }
    },
    "layout": {
      "type": "object",
      "properties": {
        "algorithm": { "type": "string", "enum": ["layered", "ring", "star", "grid", "manual"] },
        "direction": { "type": "string", "enum": ["DOWN", "UP", "LEFT", "RIGHT"] },
        "seed": { "type": "number" }
      }
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "type"],
        "properties": {
          "id": { "type": "string" },
          "type": { "type": "string" },
          "label": { "type": "string" },
          "x": { "type": "number" },
          "y": { "type": "number" },
          "tier": { "type": "number" },
          "group": { "type": "string" }
        }
      }
    },
    "links": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "from", "to"],
        "properties": {
          "id": { "type": "string" },
          "from": { "type": "string" },
          "to": { "type": "string" },
          "type": { "type": "string" },
          "label": { "type": "string" },
          "bidirectional": { "type": "boolean" }
        }
      }
    },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["at", "type"],
        "properties": {
          "at": { "type": "number" },
          "type": { "type": "string", "enum": ["reveal", "flow", "setState", "fail"] },
          "target": { "type": "string" },
          "mode": { "type": "string" },
          "path": { "type": "array", "items": { "type": "string" } },
          "label": { "type": "string" },
          "kind": { "type": "string" },
          "state": { "type": "string" },
          "reroute": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `test/validate.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTopology } from '../engine/validate.mjs';

const good = {
  nodes: [ { id: 'R1', type: 'router' }, { id: 'SW1', type: 'switch' } ],
  links: [ { id: 'l1', from: 'R1', to: 'SW1' } ],
  events: [ { at: 0, type: 'reveal', target: 'R1' } ]
};

test('accepts a well-formed topology', () => {
  const r = validateTopology(good);
  assert.equal(r.valid, true, r.errors.join('; '));
});

test('rejects a link referencing an unknown node', () => {
  const bad = { ...good, links: [ { id: 'l1', from: 'R1', to: 'NOPE' } ] };
  const r = validateTopology(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('NOPE')));
});

test('rejects an event with an unknown target', () => {
  const bad = { ...good, events: [ { at: 0, type: 'reveal', target: 'GHOST' } ] };
  const r = validateTopology(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('GHOST')));
});

test('rejects a node missing required type', () => {
  const bad = { nodes: [ { id: 'R1' } ], links: [] };
  const r = validateTopology(bad);
  assert.equal(r.valid, false);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test test/validate.test.mjs`
Expected: FAIL — cannot find module `../engine/validate.mjs`.

- [ ] **Step 5: Implement the validator**

Create `engine/validate.mjs`:
```js
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

export function validateTopology(topo) {
  const errors = [];
  if (!validateSchema(topo)) {
    for (const e of validateSchema.errors) errors.push(`${e.instancePath || '/'} ${e.message}`);
    return { valid: false, errors };
  }
  const nodeIds = new Set(topo.nodes.map(n => n.id));
  const linkIds = new Set((topo.links || []).map(l => l.id));
  for (const l of topo.links || []) {
    if (!nodeIds.has(l.from)) errors.push(`link ${l.id}: unknown from '${l.from}'`);
    if (!nodeIds.has(l.to)) errors.push(`link ${l.id}: unknown to '${l.to}'`);
  }
  for (const ev of topo.events || []) {
    if (ev.target && !nodeIds.has(ev.target) && !linkIds.has(ev.target)) {
      errors.push(`event @${ev.at}: unknown target '${ev.target}'`);
    }
    for (const id of ev.path || []) {
      if (!nodeIds.has(id)) errors.push(`event @${ev.at}: unknown path node '${id}'`);
    }
    for (const id of ev.reroute || []) {
      if (!nodeIds.has(id)) errors.push(`event @${ev.at}: unknown reroute node '${id}'`);
    }
  }
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/validate.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json engine/schema.json engine/validate.mjs test/validate.test.mjs
git commit -m "feat(engine): topology schema + validator with referential-integrity checks"
```

---

### Task 2: Offline layout (ELK, baked coordinates)

**Files:**
- Create: `cisco-topology-block/engine/layout.mjs`
- Test: `cisco-topology-block/test/layout.test.mjs`

**Interfaces:**
- Consumes: a validated topology object.
- Produces: `applyLayout(topo) -> Promise<topo>` — returns a copy where the `canvas` is filled with defaults and **every node has integer `x`/`y`**. Nodes with pre-set `x`/`y` are preserved unchanged. Deterministic given `layout.seed`.

- [ ] **Step 1: Write the failing test**

Create `test/layout.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLayout } from '../engine/layout.mjs';

const topo = {
  nodes: [ { id: 'R1', type: 'router' }, { id: 'SW1', type: 'switch' }, { id: 'A', type: 'pc' } ],
  links: [ { id: 'l1', from: 'R1', to: 'SW1' }, { id: 'l2', from: 'SW1', to: 'A' } ]
};

test('assigns integer coordinates to every node', async () => {
  const out = await applyLayout(topo);
  for (const n of out.nodes) {
    assert.equal(typeof n.x, 'number');
    assert.equal(typeof n.y, 'number');
    assert.equal(n.x, Math.round(n.x));
    assert.equal(n.y, Math.round(n.y));
  }
});

test('preserves manually-placed nodes', async () => {
  const pinned = { ...topo, nodes: [ { id: 'R1', type: 'router', x: 500, y: 300 }, ...topo.nodes.slice(1) ] };
  const out = await applyLayout(pinned);
  const r1 = out.nodes.find(n => n.id === 'R1');
  assert.equal(r1.x, 500);
  assert.equal(r1.y, 300);
});

test('is deterministic across runs', async () => {
  const a = await applyLayout(topo);
  const b = await applyLayout(topo);
  assert.deepEqual(a.nodes.map(n => [n.id, n.x, n.y]), b.nodes.map(n => [n.id, n.x, n.y]));
});

test('fills canvas defaults', async () => {
  const out = await applyLayout(topo);
  assert.equal(out.canvas.width, 1920);
  assert.equal(out.canvas.height, 1080);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/layout.test.mjs`
Expected: FAIL — cannot find module `../engine/layout.mjs`.

- [ ] **Step 3: Implement the layout module**

Create `engine/layout.mjs`:
```js
import ELK from 'elkjs/lib/elk.bundled.js';

const CANVAS_DEFAULTS = { width: 1920, height: 1080, padding: 120 };
const NODE_W = 120, NODE_H = 120;

export async function applyLayout(topo) {
  const canvas = { ...CANVAS_DEFAULTS, ...(topo.canvas || {}) };
  const algorithm = topo.layout?.algorithm || 'layered';
  const nodes = topo.nodes.map(n => ({ ...n }));
  const needsLayout = nodes.some(n => n.x == null || n.y == null);

  if (needsLayout && algorithm !== 'manual') {
    const elk = new ELK();
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': topo.layout?.direction || 'DOWN',
        'elk.randomSeed': String(topo.layout?.seed ?? 1),
        'elk.layered.spacing.nodeNodeBetweenLayers': '140',
        'elk.spacing.nodeNode': '90'
      },
      children: nodes.map(n => ({
        id: n.id,
        width: NODE_W,
        height: NODE_H,
        ...(n.x != null && n.y != null ? { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 } : {})
      })),
      edges: (topo.links || []).map(l => ({ id: l.id, sources: [l.from], targets: [l.to] }))
    };
    const res = await elk.layout(graph);
    const pos = new Map(res.children.map(c => [c.id, c]));
    for (const n of nodes) {
      if (n.x == null || n.y == null) {
        const p = pos.get(n.id);
        n.x = Math.round(p.x + NODE_W / 2) + canvas.padding;
        n.y = Math.round(p.y + NODE_H / 2) + canvas.padding;
      }
    }
  }
  return { ...topo, canvas, nodes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/layout.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/layout.mjs test/layout.test.mjs
git commit -m "feat(engine): offline ELK layout with baked integer coordinates"
```

---

### Task 3: Icon symbols + defs assembler

**Files:**
- Create: `cisco-topology-block/engine/icons.mjs`
- Test: `cisco-topology-block/test/icons.test.mjs`

**Interfaces:**
- Produces:
  - `iconSymbol(type) -> string` (an SVG `<symbol id="icon-<type>">…</symbol>`; falls back to the `pc` symbol for unknown types).
  - `iconDefs(types) -> string` (concatenated symbols for the given type list).
  - `ICON_TYPES: string[]` (built-in type keys).

**Note on official Cisco icons:** v1 ships clean built-in geometric symbols so the pipeline runs end-to-end. Swapping in the official Cisco topology icon set is a follow-up refinement (Task 7, Step 7): vendor the licensed SVGs into `assets/cisco-icons.svg` keyed by the same `icon-<type>` ids and have `iconSymbol` read them. The interface and tests are unchanged by that swap.

- [ ] **Step 1: Write the failing test**

Create `test/icons.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconSymbol, iconDefs, ICON_TYPES } from '../engine/icons.mjs';

test('exposes the core device types', () => {
  for (const t of ['router', 'switch', 'firewall', 'server', 'pc', 'cloud']) {
    assert.ok(ICON_TYPES.includes(t), `missing ${t}`);
  }
});

test('iconSymbol returns a symbol with the expected id', () => {
  assert.match(iconSymbol('router'), /<symbol id="icon-router"/);
});

test('unknown type falls back to pc', () => {
  assert.match(iconSymbol('quantum-gateway'), /<symbol id="icon-pc"/);
});

test('iconDefs concatenates one symbol per requested type', () => {
  const defs = iconDefs(['router', 'switch']);
  assert.match(defs, /icon-router/);
  assert.match(defs, /icon-switch/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/icons.test.mjs`
Expected: FAIL — cannot find module `../engine/icons.mjs`.

- [ ] **Step 3: Implement the icons module**

Create `engine/icons.mjs`:
```js
const BUILTIN = {
  router: `<symbol id="icon-router" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#1f6fb2" stroke="#0d3c61" stroke-width="3"/><path d="M30 50h40M50 30v40M38 38l24 24M62 38L38 62" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/></symbol>`,
  switch: `<symbol id="icon-switch" viewBox="0 0 100 100"><rect x="15" y="30" width="70" height="40" rx="6" fill="#2c8a3d" stroke="#14431d" stroke-width="3"/><path d="M25 50h50M62 42l14 8-14 8M38 58L24 50l14-8" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></symbol>`,
  l3switch: `<symbol id="icon-l3switch" viewBox="0 0 100 100"><rect x="15" y="28" width="70" height="44" rx="6" fill="#7a3fb0" stroke="#3a1e54" stroke-width="3"/><text x="50" y="57" font-size="22" fill="#fff" text-anchor="middle" font-family="sans-serif">L3</text></symbol>`,
  firewall: `<symbol id="icon-firewall" viewBox="0 0 100 100"><rect x="20" y="25" width="60" height="50" rx="4" fill="#c0392b" stroke="#5a1a12" stroke-width="3"/><path d="M20 42h60M20 58h60M38 25v17M62 42v16M50 58v17" stroke="#fff" stroke-width="3"/></symbol>`,
  server: `<symbol id="icon-server" viewBox="0 0 100 100"><rect x="30" y="18" width="40" height="64" rx="4" fill="#555" stroke="#222" stroke-width="3"/><circle cx="50" cy="30" r="3" fill="#55ff55"/><path d="M38 44h24M38 54h24M38 64h24" stroke="#aaa" stroke-width="3"/></symbol>`,
  pc: `<symbol id="icon-pc" viewBox="0 0 100 100"><rect x="20" y="25" width="60" height="38" rx="3" fill="#334" stroke="#111" stroke-width="3"/><rect x="26" y="31" width="48" height="26" fill="#8fd3ff"/><path d="M40 70h20l4 8H36z" fill="#556"/></symbol>`,
  cloud: `<symbol id="icon-cloud" viewBox="0 0 100 100"><path d="M30 65a15 15 0 0 1 2-30 20 20 0 0 1 38-3 14 14 0 0 1 2 33z" fill="#e8eef3" stroke="#8aa0b2" stroke-width="3"/></symbol>`,
  internet: `<symbol id="icon-internet" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="#dfe8ef" stroke="#5a7184" stroke-width="3"/><path d="M16 50h68M50 16v68M28 30q22 20 44 0M28 70q22-20 44 0" stroke="#5a7184" stroke-width="2.5" fill="none"/></symbol>`,
  ap: `<symbol id="icon-ap" viewBox="0 0 100 100"><circle cx="50" cy="62" r="10" fill="#1f6fb2"/><path d="M35 40a20 20 0 0 1 30 0M28 32a30 30 0 0 1 44 0" stroke="#1f6fb2" stroke-width="4" fill="none" stroke-linecap="round"/></symbol>`
};

export const ICON_TYPES = Object.keys(BUILTIN);
export function iconSymbol(type) { return BUILTIN[type] || BUILTIN.pc; }
export function iconDefs(types) { return types.map(t => iconSymbol(t)).join('\n'); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/icons.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/icons.mjs test/icons.test.mjs
git commit -m "feat(engine): built-in Cisco-style icon symbols + defs assembler"
```

---

### Task 4: SVG renderer

**Files:**
- Create: `cisco-topology-block/engine/renderer.mjs`
- Test: `cisco-topology-block/test/renderer.test.mjs`

**Interfaces:**
- Consumes: a laid-out topology (every node has `x`/`y`), `iconDefs` from Task 3.
- Produces:
  - `linkLength(a, b) -> number` (Euclidean distance between two `{x,y}` points).
  - `renderSvg(topo) -> string` — a complete `<svg>`: `<defs>` of used icons, one `<line id="link-<id>">` per link (with `stroke-dasharray` = its length and inline `--dash:0`), and one `<g id="node-<id>">` per node (a `<use href="#icon-<type>">` + label `<text>`).

- [ ] **Step 1: Write the failing test**

Create `test/renderer.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSvg, linkLength } from '../engine/renderer.mjs';

const topo = {
  canvas: { width: 1920, height: 1080, padding: 120 },
  nodes: [ { id: 'R1', type: 'router', x: 300, y: 200, label: 'Edge R1' },
           { id: 'A', type: 'pc', x: 300, y: 500 } ],
  links: [ { id: 'l1', from: 'R1', to: 'A', type: 'ethernet', label: 'Gi0/1' } ]
};

test('linkLength is Euclidean distance', () => {
  assert.equal(linkLength({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('emits an svg with defs, a link, and node groups', () => {
  const svg = renderSvg(topo);
  assert.match(svg, /<svg[^>]*viewBox="0 0 1920 1080"/);
  assert.match(svg, /<line id="link-l1"/);
  assert.match(svg, /<g id="node-R1"/);
  assert.match(svg, /<g id="node-A"/);
  assert.match(svg, /href="#icon-router"/);
});

test('link carries a stroke-dasharray equal to its length', () => {
  const svg = renderSvg(topo);           // R1(300,200) -> A(300,500) = 300
  assert.match(svg, /id="link-l1"[^>]*stroke-dasharray="300"/);
});

test('escapes label text', () => {
  const svg = renderSvg({ ...topo, nodes: [ { id: 'X', type: 'pc', x: 10, y: 10, label: 'A & B <ok>' } ], links: [] });
  assert.match(svg, /A &amp; B &lt;ok&gt;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/renderer.test.mjs`
Expected: FAIL — cannot find module `../engine/renderer.mjs`.

- [ ] **Step 3: Implement the renderer**

Create `engine/renderer.mjs`:
```js
import { iconDefs } from './icons.mjs';

const ICON_SIZE = 96;

function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
export function linkLength(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

export function renderSvg(topo) {
  const { width, height } = topo.canvas;
  const byId = new Map(topo.nodes.map(n => [n.id, n]));
  const types = [...new Set(topo.nodes.map(n => n.type))];
  const defs = iconDefs(types);

  const links = (topo.links || []).map(l => {
    const a = byId.get(l.from), b = byId.get(l.to);
    const len = Math.round(linkLength(a, b));
    const mx = Math.round((a.x + b.x) / 2), my = Math.round((a.y + b.y) / 2);
    const line = `<line id="link-${l.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" `
      + `class="link link-${l.type || 'ethernet'}" stroke-dasharray="${len}" style="--dash:0" />`;
    const label = l.label ? `<text class="link-label" x="${mx}" y="${my - 8}">${esc(l.label)}</text>` : '';
    return line + label;
  }).join('\n');

  const nodes = topo.nodes.map(n => {
    const s = ICON_SIZE;
    return `<g id="node-${n.id}" class="node" transform="translate(${n.x},${n.y})">`
      + `<use href="#icon-${n.type}" x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" />`
      + `<text class="node-label" x="0" y="${s / 2 + 28}">${esc(n.label || n.id)}</text>`
      + `</g>`;
  }).join('\n');

  return `<svg class="topo" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" `
    + `xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`
    + `<defs>${defs}</defs>\n${links}\n${nodes}\n</svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/renderer.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/renderer.mjs test/renderer.test.mjs
git commit -m "feat(engine): deterministic SVG renderer (icons, links, labels)"
```

---

### Task 5: Reveal-event tween planner

**Files:**
- Create: `cisco-topology-block/engine/animatorPlan.mjs`
- Test: `cisco-topology-block/test/animatorPlan.test.mjs`

**Interfaces:**
- Consumes: a laid-out topology.
- Produces: `planTimeline(topo) -> Tween[]` where each `Tween` is
  `{ at: number, selector: string, kind: string, from: object, to: object }`.
  v1 handles only `reveal` events:
  - node target → `{ from:{opacity:0,scale:0.6}, to:{opacity:1,scale:1,duration:0.5,ease:'back.out(1.6)'} }`
  - link target `mode:"draw"` → `{ from:{'--dash':len}, to:{'--dash':0,duration:0.6,ease:'power2.out'} }`
  - link target otherwise → `{ from:{opacity:0}, to:{opacity:1,duration:0.4,ease:'power1.out'} }`
  Output is sorted ascending by `at`. Non-`reveal` events are ignored in v1.

- [ ] **Step 1: Write the failing test**

Create `test/animatorPlan.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTimeline } from '../engine/animatorPlan.mjs';

const topo = {
  nodes: [ { id: 'R1', type: 'router', x: 300, y: 200 }, { id: 'A', type: 'pc', x: 300, y: 500 } ],
  links: [ { id: 'l1', from: 'R1', to: 'A' } ],
  events: [
    { at: 0.0, type: 'reveal', target: 'R1' },
    { at: 1.0, type: 'reveal', target: 'l1', mode: 'draw' },
    { at: 2.0, type: 'flow', path: ['A', 'R1'] }
  ]
};

test('plans a node reveal as opacity+scale', () => {
  const tw = planTimeline(topo).find(t => t.selector === '#node-R1');
  assert.equal(tw.kind, 'reveal-node');
  assert.equal(tw.from.opacity, 0);
  assert.equal(tw.to.scale, 1);
});

test('plans a draw-mode link reveal with dash length from geometry', () => {
  const tw = planTimeline(topo).find(t => t.selector === '#link-l1'); // len 300
  assert.equal(tw.kind, 'reveal-link-draw');
  assert.equal(tw.from['--dash'], 300);
  assert.equal(tw.to['--dash'], 0);
});

test('ignores non-reveal events in v1', () => {
  const plan = planTimeline(topo);
  assert.equal(plan.filter(t => t.kind.startsWith('flow')).length, 0);
});

test('output is sorted by at', () => {
  const ats = planTimeline(topo).map(t => t.at);
  assert.deepEqual(ats, [...ats].sort((a, b) => a - b));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/animatorPlan.test.mjs`
Expected: FAIL — cannot find module `../engine/animatorPlan.mjs`.

- [ ] **Step 3: Implement the planner**

Create `engine/animatorPlan.mjs`:
```js
import { linkLength } from './renderer.mjs';

export function planTimeline(topo) {
  const nodeById = new Map(topo.nodes.map(n => [n.id, n]));
  const linkById = new Map((topo.links || []).map(l => [l.id, l]));
  const tweens = [];

  for (const ev of topo.events || []) {
    if (ev.type !== 'reveal') continue;
    if (nodeById.has(ev.target)) {
      tweens.push({
        at: ev.at, selector: `#node-${ev.target}`, kind: 'reveal-node',
        from: { opacity: 0, scale: 0.6 },
        to: { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }
      });
    } else if (linkById.has(ev.target)) {
      if (ev.mode === 'draw') {
        const l = linkById.get(ev.target);
        const len = Math.round(linkLength(nodeById.get(l.from), nodeById.get(l.to)));
        tweens.push({
          at: ev.at, selector: `#link-${ev.target}`, kind: 'reveal-link-draw',
          from: { '--dash': len }, to: { '--dash': 0, duration: 0.6, ease: 'power2.out' }
        });
      } else {
        tweens.push({
          at: ev.at, selector: `#link-${ev.target}`, kind: 'reveal-link-fade',
          from: { opacity: 0 }, to: { opacity: 1, duration: 0.4, ease: 'power1.out' }
        });
      }
    }
  }
  return tweens.sort((a, b) => a.at - b.at);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/animatorPlan.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/animatorPlan.mjs test/animatorPlan.test.mjs
git commit -m "feat(engine): reveal-event tween planner"
```

---

### Task 6: Block builder (bake sub-composition HTML)

**Files:**
- Create: `cisco-topology-block/build.mjs`
- Create: `cisco-topology-block/examples/access-reveal.json`
- Test: `cisco-topology-block/test/build.test.mjs`

**Interfaces:**
- Consumes: `validateTopology`, `applyLayout`, `renderSvg`, `planTimeline`.
- Produces:
  - `buildBlock(topo, { id }) -> Promise<string>` — the full sub-composition HTML string.
  - `blockHtml({ id, svg, tweens, width, height, duration }) -> string` — pure assembler.
  - CLI form: `node build.mjs <topology.json> --id <comp-id> --out <path.html>` writes the file and prints the host-wiring snippet.
- **Contract the HTML must satisfy** (these are the sub-comp mount pitfalls the tests guard):
  - The root `<div data-composition-id="<id>">` is wrapped in `<template>`.
  - The `<style>` and `<script>` blocks live INSIDE the `<template>`.
  - `window.__timelines["<id>"]` is assigned, and `<id>` matches the root's `data-composition-id`.

- [ ] **Step 1: Write the example topology**

Create `examples/access-reveal.json`:
```json
{
  "canvas": { "width": 1920, "height": 1080, "padding": 140 },
  "layout": { "algorithm": "layered", "direction": "DOWN", "seed": 1 },
  "nodes": [
    { "id": "R1", "type": "router", "label": "Edge R1" },
    { "id": "SW1", "type": "switch", "label": "Access SW1" },
    { "id": "A", "type": "pc", "label": "PC-A" },
    { "id": "B", "type": "pc", "label": "PC-B" }
  ],
  "links": [
    { "id": "l1", "from": "R1", "to": "SW1", "type": "ethernet", "label": "Gi0/1" },
    { "id": "l2", "from": "SW1", "to": "A", "type": "ethernet" },
    { "id": "l3", "from": "SW1", "to": "B", "type": "ethernet" }
  ],
  "events": [
    { "at": 0.2, "type": "reveal", "target": "R1" },
    { "at": 0.9, "type": "reveal", "target": "SW1" },
    { "at": 1.4, "type": "reveal", "target": "l1", "mode": "draw" },
    { "at": 2.0, "type": "reveal", "target": "A" },
    { "at": 2.3, "type": "reveal", "target": "l2", "mode": "draw" },
    { "at": 2.8, "type": "reveal", "target": "B" },
    { "at": 3.1, "type": "reveal", "target": "l3", "mode": "draw" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `test/build.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBlock } from '../build.mjs';

const topo = JSON.parse(readFileSync(new URL('../examples/access-reveal.json', import.meta.url), 'utf8'));

test('produces a template-wrapped sub-composition with matching ids', async () => {
  const html = await buildBlock(topo, { id: 'cisco-topology-demo' });
  // template wraps the root
  const tplStart = html.indexOf('<template>');
  const rootIdx = html.indexOf('data-composition-id="cisco-topology-demo"');
  const tplEnd = html.indexOf('</template>');
  assert.ok(tplStart >= 0 && rootIdx > tplStart && rootIdx < tplEnd, 'root must be inside <template>');
});

test('style and script live inside the template', async () => {
  const html = await buildBlock(topo, { id: 'cisco-topology-demo' });
  const tplStart = html.indexOf('<template>');
  const tplEnd = html.indexOf('</template>');
  assert.ok(html.indexOf('<style>') > tplStart && html.indexOf('<style>') < tplEnd);
  assert.ok(html.lastIndexOf('window.__timelines') > tplStart && html.lastIndexOf('window.__timelines') < tplEnd);
});

test('registers the timeline under the matching id', async () => {
  const html = await buildBlock(topo, { id: 'cisco-topology-demo' });
  assert.match(html, /window\.__timelines\["cisco-topology-demo"\]\s*=/);
});

test('rejects an invalid topology', async () => {
  await assert.rejects(() => buildBlock({ nodes: [{ id: 'X' }], links: [] }, { id: 'bad' }));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/build.test.mjs`
Expected: FAIL — cannot find module `../build.mjs`.

- [ ] **Step 4: Implement the builder**

Create `build.mjs`:
```js
import { readFileSync, writeFileSync } from 'node:fs';
import { validateTopology } from './engine/validate.mjs';
import { applyLayout } from './engine/layout.mjs';
import { renderSvg } from './engine/renderer.mjs';
import { planTimeline } from './engine/animatorPlan.mjs';

const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';

export function blockHtml({ id, svg, tweens, width, height, duration }) {
  const tweensJson = JSON.stringify(tweens);
  return `<!doctype html>
<html>
<head><meta charset="UTF-8" /></head>
<body>
<template>
  <style>
    #${id} { position: absolute; inset: 0; background: #0b1622; overflow: hidden; }
    #${id} .topo { position: absolute; inset: 0; width: 100%; height: 100%; }
    #${id} .link { stroke: #7fa8c9; stroke-width: 4; stroke-dashoffset: var(--dash, 0); }
    #${id} .link-trunk { stroke-width: 7; }
    #${id} .link-wireless { stroke-dasharray: 10 8; }
    #${id} .link-label, #${id} .node-label {
      fill: #cfe0ee; font-family: 'Segoe UI', sans-serif; font-size: 22px; text-anchor: middle;
    }
    #${id} .node-label { font-weight: 600; }
  </style>
  <div id="${id}" data-composition-id="${id}" data-width="${width}" data-height="${height}" data-duration="${duration}">
    ${svg}
  </div>
  <script src="${GSAP}"></script>
  <script>
    (function () {
      window.__timelines = window.__timelines || {};
      var TWEENS = ${tweensJson};
      var root = document.getElementById('${id}');
      var tl = gsap.timeline({ paused: true });
      TWEENS.forEach(function (tw) {
        var el = root.querySelector(tw.selector);
        if (el) tl.fromTo(el, tw.from, Object.assign({}, tw.to), tw.at);
      });
      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
</body>
</html>`;
}

export async function buildBlock(topo, { id }) {
  const v = validateTopology(topo);
  if (!v.valid) throw new Error('Invalid topology:\n' + v.errors.join('\n'));
  const laid = await applyLayout(topo);
  const svg = renderSvg(laid);
  const tweens = planTimeline(laid);
  const lastAt = (laid.events || []).reduce((m, e) => Math.max(m, e.at), 0);
  const duration = Math.max(3, Math.ceil(lastAt + 1.5));
  return blockHtml({ id, svg, tweens, width: laid.canvas.width, height: laid.canvas.height, duration });
}

// CLI: node build.mjs <topology.json> --id <comp-id> --out <path.html>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , file] = process.argv;
  const idFlag = process.argv.indexOf('--id');
  const outFlag = process.argv.indexOf('--out');
  const id = idFlag > 0 ? process.argv[idFlag + 1] : 'cisco-topology';
  const out = outFlag > 0 ? process.argv[outFlag + 1] : `compositions/${id}.html`;
  const topo = JSON.parse(readFileSync(file, 'utf8'));
  const html = await buildBlock(topo, { id });
  writeFileSync(out, html);
  console.log(`Wrote ${out}`);
  console.log('Host wiring snippet:');
  console.log(`<div data-composition-id="${id}" data-composition-src="${out}" data-start="0" data-duration="?" data-track-index="1" data-width="1920" data-height="1080"></div>`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/build.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full unit suite**

Run: `node --test`
Expected: PASS (all files).

- [ ] **Step 7: Commit**

```bash
git add build.mjs examples/access-reveal.json test/build.test.mjs
git commit -m "feat: block builder bakes validated topology into a HyperFrames sub-composition"
```

---

### Task 7: HyperFrames host + real render + gates

**Files:**
- Create: `cisco-topology-block/hyperframes.json`
- Create: `cisco-topology-block/index.html` (host deck)
- Generate: `cisco-topology-block/compositions/cisco-topology-demo.html`
- Create: `cisco-topology-block/assets/cisco-icons.svg` (official-icon slot; optional refinement step)

**Interfaces:**
- Consumes: `build.mjs` CLI and the `examples/access-reveal.json` topology.
- Produces: a rendered MP4 proving the end-to-end pipeline, passing all HyperFrames gates.

- [ ] **Step 1: Confirm the HyperFrames CLI is available**

Run: `npx hyperframes doctor`
Expected: environment OK (Node + headless browser present). If it reports a missing browser, run `npx hyperframes browser` and re-check.

- [ ] **Step 2: Generate the block from the example**

Run:
```bash
mkdir -p compositions
node build.mjs examples/access-reveal.json --id cisco-topology-demo --out compositions/cisco-topology-demo.html
```
Expected: `Wrote compositions/cisco-topology-demo.html` and a printed host-wiring snippet.

- [ ] **Step 3: Create the host deck**

Create `index.html` (standalone host — root directly in `<body>`, no template):
```html
<!doctype html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin: 0">
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="6"
       style="position: relative; width: 1920px; height: 1080px; overflow: hidden; background: #0b1622">
    <div
      data-composition-id="cisco-topology-demo"
      data-composition-src="compositions/cisco-topology-demo.html"
      data-start="0"
      data-duration="6"
      data-track-index="1"
      data-width="1920"
      data-height="1080"
    ></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body>
</html>
```

Create `hyperframes.json`:
```json
{
  "registry": "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  "paths": { "blocks": "compositions", "components": "compositions/components", "assets": "assets" }
}
```

- [ ] **Step 4: Run the static gates**

Run:
```bash
npx hyperframes lint
npx hyperframes validate
npx hyperframes inspect
```
Expected: `lint` 0 errors; `validate` 0 console errors; `inspect` 0 layout issues (or intentional-overflow only).

- [ ] **Step 5: Visual smoke test (catches the sub-comp mount pitfalls)**

Run: `npx hyperframes snapshot --at 0.3,1.5,2.4,3.3`
Expected: four PNGs where the topology progressively appears — R1 at 0.3; the R1–SW1 link drawn by 1.5; PC-A + its link by 2.4; PC-B + its link by 3.3. If frames are blank or static, check that `<style>`/`<script>` are inside `<template>` and the host/inner/`__timelines` ids all equal `cisco-topology-demo`.

- [ ] **Step 6: Render the MP4**

Run: `npx hyperframes render --out cisco-topology-demo.mp4`
Expected: an MP4 written; playback shows the build-up reveal.

- [ ] **Step 7: Determinism check + commit**

Run:
```bash
npx hyperframes render --out render-a.mp4
npx hyperframes render --out render-b.mp4
node -e "const {readFileSync}=require('fs');const a=readFileSync('render-a.mp4');const b=readFileSync('render-b.mp4');console.log(a.equals(b)?'DETERMINISTIC':'NON-DETERMINISTIC: differs')"
```
Expected: `DETERMINISTIC` (identical bytes). If not, the most likely cause is layout not baked or a non-seekable animation — re-check that no `Math.random`/clock drives visuals.

```bash
git add hyperframes.json index.html compositions/cisco-topology-demo.html
git commit -m "feat: HyperFrames host deck renders build-up reveal to MP4 (v1 slice complete)"
```

- [ ] **Step 8 (optional refinement): Swap in official Cisco icons**

Vendor the official Cisco topology icon SVGs into `assets/cisco-icons.svg`, each as `<symbol id="icon-<type>">`, then update `engine/icons.mjs` so `iconSymbol(type)` reads from that file (keeping `ICON_TYPES`/`iconDefs` signatures). Re-run `node --test` (icon tests still pass — they assert ids, not artwork), regenerate the block, and re-render. Licensing note: fine for course decks; do not redistribute the raw Cisco SVGs if this block is ever published publicly.

---

## Self-Review

**1. Spec coverage:**
- Schema (nodes/links/events) → Task 1. ✔
- Deterministic SVG+GSAP render path → Tasks 4, 6, 7. ✔
- Offline auto-layout with baked coords → Task 2. ✔
- Reveal animation (v1 slice) → Task 5. ✔
- Official Cisco icons → Task 3 (built-in) + Task 7 Step 8 (official swap). ✔
- Block packaging + host wiring → Tasks 6, 7. ✔
- Real MP4 + determinism check → Task 7. ✔
- Flow / setState / failover → deferred to v2–v4 (out of this plan by design). ✔ (sequencing per spec §9)
- `/cisco-topology` NL skill → deferred to v5; `build.mjs` is its core. ✔
- PT-IPC bridge → parked per spec §2/§11. ✔

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every code step contains full code. The only `?` is the intentional `data-duration="?"` in the CLI's printed *snippet* (a human fills the deck's own duration), not in emitted code.

**3. Type consistency:** `validateTopology` → `{valid,errors}` (Tasks 1, 6); `applyLayout` returns baked nodes consumed by `renderSvg`/`planTimeline` (Tasks 2,4,5,6); `linkLength` defined in `renderer.mjs`, reused in `animatorPlan.mjs` (Tasks 4,5); `iconDefs`/`iconSymbol`/`ICON_TYPES` consistent (Tasks 3,4); `buildBlock`/`blockHtml` ids match `window.__timelines` key (Task 6). Consistent.
