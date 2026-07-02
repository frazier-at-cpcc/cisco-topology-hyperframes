import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBlock, blockHtml } from '../build.mjs';

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

test('neutralizes a node id crafted to break out of the inline <script> block', async () => {
  await assert.rejects(() => buildBlock(
    { nodes: [{ id: 'R1</script><script>alert(1)</script>', type: 'router' }], links: [], events: [] },
    { id: 'x' }
  ));
});

test('rejects a bad composition id', () => {
  assert.throws(() => blockHtml({ id: 'bad id!', svg: '', tweens: [], width: 1920, height: 1080, duration: 5 }));
});

test('emits exactly one gsap timeline', async () => {
  const html = await buildBlock(topo, { id: 'cisco-topology-demo' });
  assert.equal((html.match(/gsap\.timeline\(/g) || []).length, 1);
});

test('timeline is created paused', async () => {
  const html = await buildBlock(topo, { id: 'cisco-topology-demo' });
  assert.match(html, /gsap\.timeline\(\{\s*paused:\s*true\s*\}\)/);
});

test('mount is synchronous, not deferred', async () => {
  const html = await buildBlock(topo, { id: 'cisco-topology-demo' });
  assert.ok(!/setTimeout|DOMContentLoaded|async function|\.then\(/.test(html));
});

test('pins the gsap CDN version', async () => {
  const html = await buildBlock(topo, { id: 'cisco-topology-demo' });
  assert.match(html, /gsap@3\.14\.2/);
});

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
  // single flow at t=5 over an 8-node linear path (7 hops * 0.2 = 1.4) + fades
  // opEndTime = 5.0 + 0.2 + 1.4 + 0.2 = 6.8 => duration = ceil(6.8 + 0.5) = 8
  // (old formula ceil(5.0 + 1.5) = 7 would miss the actual end time)
  const topo = {
    nodes: [
      { id: 'n0', type: 'pc', x: 0, y: 0 },
      { id: 'n1', type: 'pc', x: 100, y: 0 },
      { id: 'n2', type: 'pc', x: 200, y: 0 },
      { id: 'n3', type: 'pc', x: 300, y: 0 },
      { id: 'n4', type: 'pc', x: 400, y: 0 },
      { id: 'n5', type: 'pc', x: 500, y: 0 },
      { id: 'n6', type: 'pc', x: 600, y: 0 },
      { id: 'n7', type: 'pc', x: 700, y: 0 }
    ],
    links: [
      { id: 'l1', from: 'n0', to: 'n1' },
      { id: 'l2', from: 'n1', to: 'n2' },
      { id: 'l3', from: 'n2', to: 'n3' },
      { id: 'l4', from: 'n3', to: 'n4' },
      { id: 'l5', from: 'n4', to: 'n5' },
      { id: 'l6', from: 'n5', to: 'n6' },
      { id: 'l7', from: 'n6', to: 'n7' }
    ],
    events: [ { at: 5.0, type: 'flow', path: ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'], kind: 'unicast' } ]
  };
  const html = await buildBlock(topo, { id: 'dur-demo' });
  const m = html.match(/data-duration="(\d+)"/);
  assert.ok(m, 'data-duration present');
  assert.equal(Number(m[1]), 8, `expected duration === 8, got ${m[1]}`);
});

test('runtime handles set-state via instantaneous stroke set + opacity fade', async () => {
  const topo = {
    nodes: [ { id: 'R1', type: 'router', x: 0, y: 0 }, { id: 'SW1', type: 'switch', x: 0, y: 200 } ],
    links: [ { id: 'l1', from: 'R1', to: 'SW1' } ],
    events: [ { at: 1, type: 'setState', target: 'l1', state: 'blocking' } ]
  };
  const html = await buildBlock(topo, { id: 'state-demo' });
  assert.match(html, /op\.kind\s*===\s*'set-state'/);                 // the switch handles set-state
  assert.match(html, /tl\.set\([^;]*stroke:\s*op\.color/);            // color is set, not tweened
  assert.match(html, /tl\.to\([^;]*opacity:\s*op\.opacity/);          // then faded in
});

test('runtime creates an X badge for a fail event', async () => {
  const topo = {
    nodes: [ { id: 'SW1', type: 'switch', x: 0, y: 100 }, { id: 'R1', type: 'router', x: 0, y: 300 } ],
    links: [ { id: 'l1', from: 'SW1', to: 'R1' } ],
    events: [ { at: 2, type: 'fail', target: 'l1' } ]
  };
  const html = await buildBlock(topo, { id: 'fail-demo' });
  // NOTE: the brief's literal assertions (/'badge'|"badge"/ and /createElementNS/) already
  // false-pass pre-implementation — 'badge' appears in the JSON-embedded TWEENS payload
  // (planTimeline already emits a badge op for 'fail'), and createElementNS already exists
  // in the flow branch. Tightened to target the actual runtime switch branch, per the
  // hollow-test lesson from Tasks 2 and 6.
  assert.match(html, /op\.kind\s*===\s*'badge'/);                       // the switch handles badge
  assert.match(html, /createElementNS\(SVGNS,\s*['"]line['"]\)/);       // crossed lines built via createElementNS
  assert.ok(!/\.innerHTML\s*=/.test(html), 'must not use innerHTML on SVG');
});
