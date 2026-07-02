# Cisco Topology Block v2–v4 (Flow · State · Failover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the remaining three animation families on top of the v1 substrate — packet flow (v2), state changes (v3), and failover (v4) — each as new timeline ops the runtime interprets, keeping the render deterministic and seek-safe.

**Architecture:** `planTimeline(topo)` already returns a flat list of `{at, kind, …}` ops (v1: `reveal-*`). This plan adds four op kinds — `flow`, `set-state`, `badge` — and composes `fail` from them at plan time. The builder's runtime script grows a `switch(op.kind)`. New visual elements (traveling packets, ✕ badges) are created with `createElementNS` and appended to the inner `<svg>` synchronously at load, then driven by the single paused GSAP timeline via transform `x/y` + `opacity` (both v1-proven). State recolor uses a hidden per-element overlay faded in by opacity (never color-through-CSS-var).

**Tech Stack:** unchanged — Node ≥20 ESM, `node --test`, GSAP 3.14.2 (core only, no plugins), `npx hyperframes`.

## Global Constraints

- Deterministic render: no `Math.random()`/`Date.now()`/`performance.now()`; single paused GSAP timeline built synchronously; all coordinates baked at build time.
- Animate ONLY allowlisted properties: `opacity`, `x`, `y`, `scale`, `rotation`, `color`/`backgroundColor`/`borderColor`, `borderRadius`, and **numeric** CSS variables. Element **fills/strokes are set instantaneously (`tl.set`), never tweened as colors.** Packet/badge motion is transform `x`/`y` on a `<g>`; visibility is `opacity`. Never animate `display`/`visibility`/`width`/`height`.
- Runtime-created elements (packets, badges): build them with `document.createElementNS('http://www.w3.org/2000/svg', …)`, append to the inner `<svg>` (viewBox space, so baked coords line up), **never** `innerHTML` on an SVG node. They MUST default `opacity:0` and only become visible inside their active window.
- `buildBlock`'s `data-duration` MUST cover the last op's END time (a `flow` at `at` runs `at + (points-1)·hopDur` plus fades; a reroute adds more), not the last event's `at`.
- Preserve all v1 behavior and tests (currently 36/36). Each task ends green + committed.
- GSAP pinned CDN `gsap@3.14.2`; sub-comp mount contract unchanged (`<style>`/`<script>` inside `<template>`, ids match `window.__timelines` key).

## Shared constants (define once, in `engine/animatorPlan.mjs`, exported for tests)

```js
export const HOP_DUR = 0.6;            // seconds per hop
export const PACKET_R = 14;            // packet radius (viewBox units)
export const FLOW_COLORS = { unicast: '#ffd23f', broadcast: '#ff7a3f', multicast: '#3fd08a' };
export const STATE_STYLES = {          // state -> { color, opacity } for the overlay/ring
  down:       { color: '#e0342b', opacity: 0.95 },
  blocking:   { color: '#e8a13a', opacity: 0.9 },
  forwarding: { color: '#2ec16b', opacity: 0.9 },
  learning:   { color: '#e8d13a', opacity: 0.85 },
  active:     { color: '#4db6ff', opacity: 0.9 },
  standby:    { color: '#6b7d8c', opacity: 0.8 },
  selected:   { color: '#ffffff', opacity: 0.9 },
  up:         { color: '#2ec16b', opacity: 0.0 }   // clears the overlay (fade back out)
};
export const DOWN = STATE_STYLES.down;
```

---

# v2 — Packet flow

### Task 1: Planner `flow` op

**Files:**
- Modify: `engine/animatorPlan.mjs`
- Test: `test/animatorPlan.test.mjs` (append)

**Interfaces:**
- Consumes: laid-out topology (nodes have integer `x`/`y`), `linkLength` already imported.
- Produces: for each `flow` event, one op **per path** — `{ at, kind: 'flow', points: number[][], hopDur: HOP_DUR, color, r: PACKET_R }`. A flow event carries `path: string[]` (single) OR `paths: string[][]` (flood → one op each). `color = FLOW_COLORS[event.kind] || FLOW_COLORS.unicast`. `points` = each path node id mapped to `[node.x, node.y]`. Reveal handling and output-sorted-by-`at` unchanged.

- [ ] **Step 1: Write the failing test**

Append to `test/animatorPlan.test.mjs`:
```js
import { planTimeline, HOP_DUR, PACKET_R, FLOW_COLORS } from '../engine/animatorPlan.mjs';

const flowTopo = {
  nodes: [ { id: 'A', type: 'pc', x: 100, y: 500 }, { id: 'SW1', type: 'switch', x: 100, y: 300 }, { id: 'R1', type: 'router', x: 100, y: 100 } ],
  links: [ { id: 'l1', from: 'A', to: 'SW1' }, { id: 'l2', from: 'SW1', to: 'R1' } ],
  events: [ { at: 2.0, type: 'flow', path: ['A', 'SW1', 'R1'], kind: 'unicast' } ]
};

test('flow event → one flow op with baked points from node coords', () => {
  const op = planTimeline(flowTopo).find(o => o.kind === 'flow');
  assert.equal(op.at, 2.0);
  assert.deepEqual(op.points, [[100, 500], [100, 300], [100, 100]]);
  assert.equal(op.hopDur, HOP_DUR);
  assert.equal(op.r, PACKET_R);
  assert.equal(op.color, FLOW_COLORS.unicast);
});

test('flow kind selects packet color', () => {
  const t = { ...flowTopo, events: [ { at: 1, type: 'flow', path: ['A', 'SW1'], kind: 'multicast' } ] };
  assert.equal(planTimeline(t).find(o => o.kind === 'flow').color, FLOW_COLORS.multicast);
});

test('flow with paths[] emits one op per path (flood)', () => {
  const t = { ...flowTopo, events: [ { at: 1, type: 'flow', paths: [['A', 'SW1'], ['SW1', 'R1']], kind: 'broadcast' } ] };
  const ops = planTimeline(t).filter(o => o.kind === 'flow');
  assert.equal(ops.length, 2);
  assert.ok(ops.every(o => o.color === FLOW_COLORS.broadcast));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/animatorPlan.test.mjs`
Expected: FAIL — `planTimeline` doesn't emit `flow` ops / exports missing.

- [ ] **Step 3: Implement**

In `engine/animatorPlan.mjs`: add the exported constants (`HOP_DUR`, `PACKET_R`, `FLOW_COLORS` from the Shared constants block above). In `planTimeline`, inside the event loop, ADD a branch (keep the existing `reveal` branch and the final sort):
```js
    if (ev.type === 'flow') {
      const paths = ev.paths || (ev.path ? [ev.path] : []);
      const color = FLOW_COLORS[ev.kind] || FLOW_COLORS.unicast;
      for (const path of paths) {
        const points = path.map(id => { const n = nodeById.get(id); return [n.x, n.y]; });
        if (points.length >= 2) ops.push({ at: ev.at, kind: 'flow', points, hopDur: HOP_DUR, color, r: PACKET_R });
      }
      continue;
    }
```
(Ensure the loop variable is `ev`, the accumulator is `ops`/`tweens` as currently named, and `nodeById` exists — reuse the existing map; if the current code names the accumulator `tweens`, keep that name and push into it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/animatorPlan.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run full suite + commit**

Run: `node --test` (expect all previous + new passing).
```bash
git add engine/animatorPlan.mjs test/animatorPlan.test.mjs
git commit -m "feat(engine): planner emits flow ops (baked packet paths, per-path flood)"
```

---

### Task 2: Runtime packet interpreter + duration-to-op-end

**Files:**
- Modify: `build.mjs` (the `blockHtml` runtime `<script>` and `buildBlock` duration calc)
- Test: `test/build.test.mjs` (append)

**Interfaces:**
- The runtime iterates ops with a `switch(op.kind)`. Reveal kinds keep `tl.fromTo`. `flow`: create `<g><circle r opacity=0 fill=color/></g>`, append to the inner `<svg>`, `tl.set` it to `points[0]` with `opacity:0`, fade in, chain one `tl.to({x,y})` per subsequent point (`ease:'none'`, `duration:hopDur`), fade out at the end.
- `buildBlock` duration = `max(3, ceil(maxOpEnd + 0.5))` where `opEndTime` covers every kind.

- [ ] **Step 1: Write the failing test**

Append to `test/build.test.mjs`:
```js
test('runtime creates an SVG packet for a flow op', async () => {
  const topo = {
    nodes: [ { id: 'A', type: 'pc', x: 100, y: 400 }, { id: 'B', type: 'pc', x: 500, y: 400 } ],
    links: [ { id: 'l1', from: 'A', to: 'B' } ],
    events: [ { at: 1.0, type: 'flow', path: ['A', 'B'], kind: 'unicast' } ]
  };
  const html = await buildBlock(topo, { id: 'flow-demo' });
  assert.match(html, /createElementNS/);             // packet is created, not innerHTML'd
  assert.match(html, /appendChild/);
  assert.match(html, /'flow'|"flow"/);               // the switch handles flow
});

test('duration extends past a late flow op end, not just the event at', async () => {
  // single flow at t=5 over a 3-hop path (2 hops * 0.6 = 1.2) + fades => ends ~6.6; duration must be >= 7
  const topo = {
    nodes: [ { id: 'A', type: 'pc', x: 0, y: 0 }, { id: 'B', type: 'pc', x: 100, y: 0 }, { id: 'C', type: 'pc', x: 200, y: 0 } ],
    links: [ { id: 'l1', from: 'A', to: 'B' }, { id: 'l2', from: 'B', to: 'C' } ],
    events: [ { at: 5.0, type: 'flow', path: ['A', 'B', 'C'], kind: 'unicast' } ]
  };
  const html = await buildBlock(topo, { id: 'dur-demo' });
  const m = html.match(/data-duration="(\d+)"/);
  assert.ok(m, 'data-duration present');
  assert.ok(Number(m[1]) >= 7, `expected duration >= 7, got ${m[1]}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build.test.mjs`
Expected: FAIL — no packet creation; duration keys off event `at`.

- [ ] **Step 3: Implement**

In `build.mjs`:

(a) Replace the runtime tween loop inside `blockHtml`'s `<script>` with a kind switch. The embedded script becomes (keep the IIFE, `window.__timelines`, single paused `tl`, and the existing `<`-escaped `OPS` JSON — rename the embedded var to `OPS`):
```js
      var SVGNS = 'http://www.w3.org/2000/svg';
      var svg = root.querySelector('svg');
      OPS.forEach(function (op) {
        if (op.kind === 'reveal-node' || op.kind === 'reveal-link-draw' || op.kind === 'reveal-link-fade') {
          var el = root.querySelector(op.selector);
          if (el) tl.fromTo(el, op.from, Object.assign({}, op.to), op.at);
          else console.warn('cisco-topology: no element for ' + op.selector);
        } else if (op.kind === 'flow') {
          var g = document.createElementNS(SVGNS, 'g');
          var c = document.createElementNS(SVGNS, 'circle');
          c.setAttribute('r', op.r); c.setAttribute('cx', 0); c.setAttribute('cy', 0); c.setAttribute('fill', op.color);
          g.appendChild(c); g.setAttribute('opacity', '0'); svg.appendChild(g);
          var p0 = op.points[0];
          tl.set(g, { x: p0[0], y: p0[1], opacity: 0 }, op.at);
          tl.to(g, { opacity: 1, duration: 0.2 }, op.at);
          var t = op.at + 0.2;
          for (var i = 1; i < op.points.length; i++) {
            tl.to(g, { x: op.points[i][0], y: op.points[i][1], duration: op.hopDur, ease: 'none' }, t);
            t += op.hopDur;
          }
          tl.to(g, { opacity: 0, duration: 0.2 }, t);
        }
        // set-state and badge kinds are added in Tasks 6 and 8
      });
```
(Keep whatever variable name currently holds the ops JSON if it isn't `OPS`; the point is the switch + flow branch. Preserve the `<` escaping already applied to the JSON.)

(b) Add an `opEndTime` helper and use it in `buildBlock`:
```js
function opEndTime(op) {
  if (op.kind === 'flow') return op.at + 0.2 + Math.max(0, op.points.length - 1) * op.hopDur + 0.2;
  if (op.kind === 'set-state' || op.kind === 'badge') return op.at + (op.duration || 0.4);
  return op.at + ((op.to && op.to.duration) || 0.6); // reveal-*
}
```
Then in `buildBlock`, replace the duration line with:
```js
  const maxEnd = (ops.length ? Math.max(...ops.map(opEndTime)) : 0);
  const duration = Math.max(3, Math.ceil(maxEnd + 0.5));
```
(where `ops` is the planner result variable in `buildBlock`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build.test.mjs` then `node --test`.
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add build.mjs test/build.test.mjs
git commit -m "feat(build): runtime packet interpreter (createElementNS + transform x/y) and duration-to-op-end"
```

---

### Task 3: v2 render gate (prove runtime-creation on a seeked timeline)

**Files:**
- Create: `examples/ping-flow.json`
- (Regenerate) `compositions/cisco-topology-demo.html` is NOT touched; generate a fresh flow block.

**Interfaces:** none new — this is an end-to-end render gate. It proves the shared foundation for v3/v4 (an element created at load animates correctly across seeks).

- [ ] **Step 1: Author the flow example**

Create `examples/ping-flow.json` (reveal the topology, then a packet A→SW1→R1→SW1→B):
```json
{
  "canvas": { "width": 1920, "height": 1080, "padding": 140 },
  "layout": { "algorithm": "layered", "direction": "DOWN", "seed": 1 },
  "nodes": [
    { "id": "R1", "type": "router", "label": "R1" },
    { "id": "SW1", "type": "switch", "label": "SW1" },
    { "id": "A", "type": "pc", "label": "PC-A" },
    { "id": "B", "type": "pc", "label": "PC-B" }
  ],
  "links": [
    { "id": "l1", "from": "R1", "to": "SW1" },
    { "id": "l2", "from": "SW1", "to": "A" },
    { "id": "l3", "from": "SW1", "to": "B" }
  ],
  "events": [
    { "at": 0.2, "type": "reveal", "target": "R1" },
    { "at": 0.6, "type": "reveal", "target": "SW1" },
    { "at": 0.9, "type": "reveal", "target": "l1", "mode": "draw" },
    { "at": 1.2, "type": "reveal", "target": "A" },
    { "at": 1.4, "type": "reveal", "target": "l2", "mode": "draw" },
    { "at": 1.7, "type": "reveal", "target": "B" },
    { "at": 1.9, "type": "reveal", "target": "l3", "mode": "draw" },
    { "at": 2.6, "type": "flow", "path": ["A", "SW1", "B"], "kind": "unicast", "label": "ICMP echo" }
  ]
}
```

- [ ] **Step 2: Generate the block + wire a host**

Run:
```bash
node build.mjs examples/ping-flow.json --id ping-flow --out compositions/ping-flow.html
```
Create `index-flow.html` as a standalone host embedding `compositions/ping-flow.html` (copy the structure of the existing `index.html`, but `data-composition-src="compositions/ping-flow.html"`, `data-composition-id="ping-flow"`, and a `data-duration` matching the block's — read it from the generated file's root `data-duration`).

- [ ] **Step 3: Static gates**

Run against the flow host (use `--entry index-flow.html` if the CLI supports selecting the entry; otherwise temporarily point the default entry at it):
```bash
npx hyperframes lint
npx hyperframes validate
npx hyperframes inspect
```
Expected: 0 errors (contrast warnings on labels are known/non-blocking).

- [ ] **Step 4: Snapshot the packet mid-flight (the actual proof)**

The packet leaves A (~2.8s) and reaches B (~4.0s). Snapshot several times spanning that window:
```bash
npx hyperframes snapshot --at 2.7,3.2,3.7,4.2
```
Expected: a colored packet dot appears near PC-A at 2.7, between SW1 and the PCs at 3.2–3.7, and near PC-B / gone by 4.2. Eyeball that the dot MOVES between frames and is absent before 2.6 and after it arrives. If the dot is static, absent, or present at t=0 → the created-element/opacity-window wiring is wrong; fix before proceeding.

- [ ] **Step 5: Render + frame-determinism + commit**

```bash
npx hyperframes render --output ping-flow.mp4
# frame-level determinism (per the v1-established method): same frame time, two captures, compare
npx hyperframes snapshot --at 3.2 --output det1.png ; npx hyperframes snapshot --at 3.2 --output det2.png
# compare det1.png and det2.png bytes (identical => deterministic)
```
(Use whatever snapshot output flag the installed CLI supports — confirm with `npx hyperframes snapshot --help`. MP4 byte-compare is NOT authoritative; frame compare is.)
```bash
git add examples/ping-flow.json compositions/ping-flow.html index-flow.html
git commit -m "feat: v2 flow render gate — packet traverses A→SW1→B, verified by snapshot + deterministic frames"
```

---

# v3 — State changes

### Task 4: Renderer state overlays (hidden, opacity 0)

**Files:**
- Modify: `engine/renderer.mjs`
- Test: `test/renderer.test.mjs` (append)

**Interfaces:** `renderSvg` additionally emits, per link, `<line id="link-<id>-state" … class="link-state" opacity="0" />` (same endpoints as the base link, no dash), and per node (inside the node `<g>`, BEFORE the `<use>`), `<circle id="node-<id>-state" class="node-state" cx="0" cy="0" r="62" fill="none" stroke-width="6" opacity="0" />`. These are the fade-in targets for `set-state`/`fail`. Base rendering, ids, and determinism unchanged.

- [ ] **Step 1: Write the failing test**

Append to `test/renderer.test.mjs`:
```js
test('renders a hidden state overlay per link and per node', () => {
  const topo = {
    canvas: { width: 1920, height: 1080, padding: 120 },
    nodes: [ { id: 'R1', type: 'router', x: 300, y: 200 }, { id: 'A', type: 'pc', x: 300, y: 500 } ],
    links: [ { id: 'l1', from: 'R1', to: 'A', type: 'ethernet' } ]
  };
  const svg = renderSvg(topo);
  assert.match(svg, /<line id="link-l1-state"[^>]*class="link-state"[^>]*opacity="0"/);
  assert.match(svg, /<circle id="node-R1-state"[^>]*class="node-state"[^>]*opacity="0"/);
  assert.match(svg, /<circle id="node-A-state"[^>]*opacity="0"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/renderer.test.mjs` → FAIL (overlays absent).

- [ ] **Step 3: Implement**

In `engine/renderer.mjs`:
- In the links map, after building the base `<line id="link-<id>">…`, also emit the overlay line with the same `x1/y1/x2/y2`:
  `+ \`<line id="link-\${l.id}-state" x1="\${a.x}" y1="\${a.y}" x2="\${b.x}" y2="\${b.y}" class="link-state" opacity="0" />\``
- In the nodes map, inside the `<g id="node-<id>" transform="translate(x,y)">`, add the ring as the FIRST child (before `<use>`):
  `<circle id="node-\${n.id}-state" class="node-state" cx="0" cy="0" r="62" fill="none" stroke-width="6" opacity="0" />`
Keep existing `<use>`/`<text>`/escaping intact.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/renderer.test.mjs` then `node --test`.
Expected: PASS. (Existing renderer tests still pass — overlays are additive.)

- [ ] **Step 5: Commit**

```bash
git add engine/renderer.mjs test/renderer.test.mjs
git commit -m "feat(engine): render hidden per-link/per-node state overlays for set-state"
```

---

### Task 5: Planner `set-state` op

**Files:**
- Modify: `engine/animatorPlan.mjs`
- Test: `test/animatorPlan.test.mjs` (append)

**Interfaces:** a `setState` event → `{ at, kind: 'set-state', selector, color, opacity, duration: 0.4 }`. `selector` = `#link-<id>-state` if target is a link id, `#node-<id>-state` if a node id. `color`/`opacity` from `STATE_STYLES[event.state]` (unknown state → skip the op and `return`-continue; do not crash). Export `STATE_STYLES`.

- [ ] **Step 1: Write the failing test**

Append to `test/animatorPlan.test.mjs`:
```js
import { STATE_STYLES } from '../engine/animatorPlan.mjs';

test('setState on a link → set-state op targeting the link overlay', () => {
  const t = {
    nodes: [ { id: 'R1', type: 'router', x: 0, y: 0 }, { id: 'SW1', type: 'switch', x: 0, y: 100 } ],
    links: [ { id: 'l1', from: 'R1', to: 'SW1' } ],
    events: [ { at: 3, type: 'setState', target: 'l1', state: 'blocking' } ]
  };
  const op = planTimeline(t).find(o => o.kind === 'set-state');
  assert.equal(op.selector, '#link-l1-state');
  assert.equal(op.color, STATE_STYLES.blocking.color);
  assert.equal(op.opacity, STATE_STYLES.blocking.opacity);
});

test('setState on a node → node ring overlay selector', () => {
  const t = {
    nodes: [ { id: 'R1', type: 'router', x: 0, y: 0 } ], links: [],
    events: [ { at: 1, type: 'setState', target: 'R1', state: 'active' } ]
  };
  assert.equal(planTimeline(t).find(o => o.kind === 'set-state').selector, '#node-R1-state');
});

test('unknown state is skipped, not crashed', () => {
  const t = { nodes: [ { id: 'R1', type: 'router', x: 0, y: 0 } ], links: [],
    events: [ { at: 1, type: 'setState', target: 'R1', state: 'bogus' } ] };
  assert.equal(planTimeline(t).filter(o => o.kind === 'set-state').length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/animatorPlan.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

Add `STATE_STYLES` (from Shared constants) to `engine/animatorPlan.mjs` exports. Add a helper and a branch in `planTimeline`:
```js
function stateSelector(target, nodeById, linkById) {
  if (linkById.has(target)) return `#link-${target}-state`;
  if (nodeById.has(target)) return `#node-${target}-state`;
  return null;
}
```
```js
    if (ev.type === 'setState') {
      const style = STATE_STYLES[ev.state];
      const selector = stateSelector(ev.target, nodeById, linkById);
      if (style && selector) ops.push({ at: ev.at, kind: 'set-state', selector, color: style.color, opacity: style.opacity, duration: 0.4 });
      continue;
    }
```
(Reuse the existing `nodeById`/`linkById` maps; keep accumulator name consistent.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/animatorPlan.test.mjs` then `node --test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/animatorPlan.mjs test/animatorPlan.test.mjs
git commit -m "feat(engine): planner emits set-state ops targeting hidden overlays"
```

---

### Task 6: Runtime `set-state` + v3 render gate

**Files:**
- Modify: `build.mjs` (add the `set-state` branch to the runtime switch)
- Create: `examples/stp-states.json`
- Test: `test/build.test.mjs` (append)

**Interfaces:** runtime `set-state` = instantaneous color set + opacity fade on the overlay: `tl.set(el, { stroke: op.color }, op.at); tl.to(el, { opacity: op.opacity, duration: op.duration }, op.at);`. The color is **set**, never tweened.

- [ ] **Step 1: Write the failing test**

Append to `test/build.test.mjs`:
```js
test('runtime handles set-state via instantaneous stroke set + opacity fade', async () => {
  const topo = {
    nodes: [ { id: 'R1', type: 'router', x: 0, y: 0 }, { id: 'SW1', type: 'switch', x: 0, y: 200 } ],
    links: [ { id: 'l1', from: 'R1', to: 'SW1' } ],
    events: [ { at: 1, type: 'setState', target: 'l1', state: 'blocking' } ]
  };
  const html = await buildBlock(topo, { id: 'state-demo' });
  assert.match(html, /'set-state'|"set-state"/);
  assert.match(html, /tl\.set\(/);            // color is set, not tweened
  assert.match(html, /opacity/);              // then faded in
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

In `build.mjs`'s runtime switch (inside `OPS.forEach`), add before the closing comment:
```js
        } else if (op.kind === 'set-state') {
          var el = root.querySelector(op.selector);
          if (el) { tl.set(el, { stroke: op.color }, op.at); tl.to(el, { opacity: op.opacity, duration: op.duration }, op.at); }
          else console.warn('cisco-topology: no element for ' + op.selector);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build.test.mjs` then `node --test`. Expected: PASS.

- [ ] **Step 5: v3 render gate — PROVE the recolor renders (advisor's required check)**

Create `examples/stp-states.json` (reveal a triangle R1–SW1–SW2 with a redundant link, then set one link `blocking` and another `forwarding`, and a node `active`):
```json
{
  "canvas": { "width": 1920, "height": 1080, "padding": 160 },
  "layout": { "algorithm": "layered", "direction": "DOWN", "seed": 1 },
  "nodes": [
    { "id": "R1", "type": "router", "label": "Root" },
    { "id": "SW1", "type": "switch", "label": "SW1" },
    { "id": "SW2", "type": "switch", "label": "SW2" }
  ],
  "links": [
    { "id": "l1", "from": "R1", "to": "SW1" },
    { "id": "l2", "from": "R1", "to": "SW2" },
    { "id": "l3", "from": "SW1", "to": "SW2" }
  ],
  "events": [
    { "at": 0.2, "type": "reveal", "target": "R1" },
    { "at": 0.6, "type": "reveal", "target": "SW1" },
    { "at": 0.9, "type": "reveal", "target": "SW2" },
    { "at": 1.2, "type": "reveal", "target": "l1", "mode": "draw" },
    { "at": 1.5, "type": "reveal", "target": "l2", "mode": "draw" },
    { "at": 1.8, "type": "reveal", "target": "l3", "mode": "draw" },
    { "at": 2.6, "type": "setState", "target": "R1", "state": "active" },
    { "at": 3.0, "type": "setState", "target": "l1", "state": "forwarding" },
    { "at": 3.4, "type": "setState", "target": "l2", "state": "forwarding" },
    { "at": 3.8, "type": "setState", "target": "l3", "state": "blocking" }
  ]
}
```
```bash
node build.mjs examples/stp-states.json --id stp-states --out compositions/stp-states.html
# wire a standalone host index-stp.html (like index.html), run gates, then snapshot AFTER the state changes:
npx hyperframes snapshot --at 2.0,3.2,4.2
```
Expected at 4.2s: l1/l2 tinted green (forwarding), l3 tinted amber (blocking), R1 ringed blue (active). **If the state colors do NOT appear, the overlay/set-state wiring is wrong — STOP and report** (this is the primitive the advisor flagged as unproven). Then render + commit:
```bash
npx hyperframes render --output stp-states.mp4
git add build.mjs test/build.test.mjs examples/stp-states.json compositions/stp-states.html index-stp.html
git commit -m "feat: v3 set-state — overlay recolor proven by snapshot (STP forwarding/blocking + active node)"
```

---

# v4 — Failover

### Task 7: Planner `fail` decomposition + `badge` op

**Files:**
- Modify: `engine/animatorPlan.mjs`
- Test: `test/animatorPlan.test.mjs` (append)

**Interfaces:** a `fail` event decomposes at plan time into: (1) a `set-state` op to `down` on the target's overlay; (2) a `badge` op `{ at, kind: 'badge', point: [x,y], color: DOWN.color, size: 18, duration: 0.3 }` at the target's center — link → midpoint of its endpoints, node → node coords; (3) if `event.reroute` (a node-id path), a `flow` op along it starting at `at + 0.4`, `color: FLOW_COLORS.unicast`. Uses `linkLength`/coords already available.

- [ ] **Step 1: Write the failing test**

Append to `test/animatorPlan.test.mjs`:
```js
test('fail on a link → set-state(down) + badge at link midpoint (+ reroute flow)', () => {
  const t = {
    nodes: [ { id: 'A', type: 'pc', x: 0, y: 0 }, { id: 'SW1', type: 'switch', x: 0, y: 200 },
             { id: 'R1', type: 'router', x: 0, y: 400 }, { id: 'R2', type: 'router', x: 200, y: 400 }, { id: 'B', type: 'pc', x: 200, y: 0 } ],
    links: [ { id: 'l1', from: 'SW1', to: 'R1' } ],
    events: [ { at: 5, type: 'fail', target: 'l1', reroute: ['A', 'SW1', 'R2', 'B'] } ]
  };
  const ops = planTimeline(t);
  const ss = ops.find(o => o.kind === 'set-state');
  assert.equal(ss.selector, '#link-l1-state');
  assert.equal(ss.color, STATE_STYLES.down.color);
  const badge = ops.find(o => o.kind === 'badge');
  assert.deepEqual(badge.point, [0, 300]);   // midpoint of SW1(0,200) and R1(0,400)
  const flow = ops.find(o => o.kind === 'flow');
  assert.ok(flow.at >= 5.4);
  assert.equal(flow.points.length, 4);
});

test('fail with no reroute emits set-state + badge only', () => {
  const t = {
    nodes: [ { id: 'X', type: 'server', x: 10, y: 20 } ], links: [],
    events: [ { at: 2, type: 'fail', target: 'X' } ]
  };
  const ops = planTimeline(t);
  assert.equal(ops.filter(o => o.kind === 'flow').length, 0);
  assert.equal(ops.find(o => o.kind === 'badge').point[0], 10);
  assert.equal(ops.find(o => o.kind === 'set-state').selector, '#node-X-state');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/animatorPlan.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

In `planTimeline`, add a `fail` branch (reuse `nodeById`/`linkById`, `stateSelector`, `STATE_STYLES.down`/`DOWN`, `FLOW_COLORS`):
```js
    if (ev.type === 'fail') {
      const selector = stateSelector(ev.target, nodeById, linkById);
      let point = null;
      if (linkById.has(ev.target)) {
        const l = linkById.get(ev.target); const a = nodeById.get(l.from), b = nodeById.get(l.to);
        point = [Math.round((a.x + b.x) / 2), Math.round((a.y + b.y) / 2)];
      } else if (nodeById.has(ev.target)) {
        const n = nodeById.get(ev.target); point = [n.x, n.y];
      }
      if (selector) ops.push({ at: ev.at, kind: 'set-state', selector, color: STATE_STYLES.down.color, opacity: STATE_STYLES.down.opacity, duration: 0.3 });
      if (point) ops.push({ at: ev.at, kind: 'badge', point, color: STATE_STYLES.down.color, size: 18, duration: 0.3 });
      if (ev.reroute && ev.reroute.length >= 2) {
        const points = ev.reroute.map(id => { const n = nodeById.get(id); return [n.x, n.y]; });
        ops.push({ at: ev.at + 0.4, kind: 'flow', points, hopDur: HOP_DUR, color: FLOW_COLORS.unicast, r: PACKET_R });
      }
      continue;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/animatorPlan.test.mjs` then `node --test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/animatorPlan.mjs test/animatorPlan.test.mjs
git commit -m "feat(engine): fail decomposes into set-state(down)+badge(+reroute flow)"
```

---

### Task 8: Runtime `badge` + v4 render gate (final v2–v4 slice)

**Files:**
- Modify: `build.mjs` (add `badge` branch to the runtime switch)
- Create: `examples/link-failover.json`
- Test: `test/build.test.mjs` (append)

**Interfaces:** runtime `badge` = create a `<g opacity=0>` containing two crossed `<line>`s (an ✕), positioned via transform `x/y` at `op.point`, faded in at `op.at`. `createElementNS` per line (no `innerHTML`).

- [ ] **Step 1: Write the failing test**

Append to `test/build.test.mjs`:
```js
test('runtime creates an X badge for a fail event', async () => {
  const topo = {
    nodes: [ { id: 'SW1', type: 'switch', x: 0, y: 100 }, { id: 'R1', type: 'router', x: 0, y: 300 } ],
    links: [ { id: 'l1', from: 'SW1', to: 'R1' } ],
    events: [ { at: 2, type: 'fail', target: 'l1' } ]
  };
  const html = await buildBlock(topo, { id: 'fail-demo' });
  assert.match(html, /'badge'|"badge"/);
  assert.match(html, /createElementNS/);
  // two crossed lines for the X (created, not innerHTML'd)
  assert.ok(!/\.innerHTML\s*=/.test(html), 'must not use innerHTML on SVG');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

Add the `badge` branch to the runtime switch in `build.mjs`:
```js
        } else if (op.kind === 'badge') {
          var bg = document.createElementNS(SVGNS, 'g');
          var s = op.size || 16;
          [[-s, -s, s, s], [-s, s, s, -s]].forEach(function (co) {
            var ln = document.createElementNS(SVGNS, 'line');
            ln.setAttribute('x1', co[0]); ln.setAttribute('y1', co[1]); ln.setAttribute('x2', co[2]); ln.setAttribute('y2', co[3]);
            ln.setAttribute('stroke', op.color); ln.setAttribute('stroke-width', 6); ln.setAttribute('stroke-linecap', 'round');
            bg.appendChild(ln);
          });
          bg.setAttribute('opacity', '0'); svg.appendChild(bg);
          tl.set(bg, { x: op.point[0], y: op.point[1] }, op.at);
          tl.to(bg, { opacity: 1, duration: op.duration }, op.at);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/build.test.mjs` then `node --test`. Expected: PASS.

- [ ] **Step 5: v4 render gate + commit**

Create `examples/link-failover.json` (reveal a redundant path A–SW1–R1/R2–B, ping over the primary, then fail the primary link and reroute):
```json
{
  "canvas": { "width": 1920, "height": 1080, "padding": 150 },
  "layout": { "algorithm": "layered", "direction": "DOWN", "seed": 1 },
  "nodes": [
    { "id": "A", "type": "pc", "label": "PC-A" },
    { "id": "SW1", "type": "switch", "label": "SW1" },
    { "id": "R1", "type": "router", "label": "R1 (primary)" },
    { "id": "R2", "type": "router", "label": "R2 (backup)" },
    { "id": "B", "type": "pc", "label": "PC-B" }
  ],
  "links": [
    { "id": "a1", "from": "A", "to": "SW1" },
    { "id": "p1", "from": "SW1", "to": "R1" },
    { "id": "p2", "from": "R1", "to": "B" },
    { "id": "b1", "from": "SW1", "to": "R2" },
    { "id": "b2", "from": "R2", "to": "B" }
  ],
  "events": [
    { "at": 0.2, "type": "reveal", "target": "A" },
    { "at": 0.5, "type": "reveal", "target": "SW1" },
    { "at": 0.8, "type": "reveal", "target": "R1" },
    { "at": 1.1, "type": "reveal", "target": "R2" },
    { "at": 1.4, "type": "reveal", "target": "B" },
    { "at": 1.7, "type": "reveal", "target": "a1", "mode": "draw" },
    { "at": 1.9, "type": "reveal", "target": "p1", "mode": "draw" },
    { "at": 2.1, "type": "reveal", "target": "p2", "mode": "draw" },
    { "at": 2.3, "type": "reveal", "target": "b1", "mode": "draw" },
    { "at": 2.5, "type": "reveal", "target": "b2", "mode": "draw" },
    { "at": 3.0, "type": "flow", "path": ["A", "SW1", "R1", "B"], "kind": "unicast", "label": "primary path" },
    { "at": 5.2, "type": "fail", "target": "p1", "reroute": ["A", "SW1", "R2", "B"] }
  ]
}
```
```bash
node build.mjs examples/link-failover.json --id link-failover --out compositions/link-failover.html
# wire index-failover.html, run lint/validate/inspect, then:
npx hyperframes snapshot --at 3.6,5.4,6.0,6.8
```
Expected: primary packet mid-flight ~3.6; at 5.4 link `p1` tinted red with an ✕ over its midpoint; ~6.0–6.8 the reroute packet travels A→SW1→R2→B. If the ✕ or reroute packet is missing, STOP and report. Then:
```bash
npx hyperframes render --output link-failover.mp4
git add build.mjs test/build.test.mjs examples/link-failover.json compositions/link-failover.html index-failover.html
git commit -m "feat: v4 failover — link fails (red + X) and traffic reroutes; verified by snapshot"
```

---

## Self-Review

**1. Spec coverage:** flow (spec §4.3 `flow`) → Tasks 1–3; state changes (`setState`) → Tasks 4–6; failover (`fail`, decomposed) → Tasks 7–8. Broadcast flood = per-path ops (Task 1). All four spec animation families now implemented (reveal shipped in v1). ✔

**2. Placeholder scan:** every code step contains full code; render-gate steps name exact commands + expected visual outcomes. No TBD/"handle later". ✔

**3. Type consistency:** ops share `{at, kind}`; `flow` uses `{points, hopDur, color, r}`, `set-state` `{selector, color, opacity, duration}`, `badge` `{point, color, size, duration}`; `opEndTime` (Task 2) covers all kinds including those added in Tasks 5/7; `stateSelector` + `STATE_STYLES` shared by Tasks 5 and 7; runtime switch branches added in Tasks 2/6/8 all reference `svg`/`SVGNS`/`root` defined in Task 2. ✔

**4. Determinism/allowlist:** motion is transform `x/y` + `opacity`; colors are `tl.set` (instantaneous), never tweened; created elements default `opacity:0`; duration covers op ends; render gates after v2 and v3 empirically prove the two unproven primitives (runtime-created element on a seeked timeline; overlay recolor). ✔
