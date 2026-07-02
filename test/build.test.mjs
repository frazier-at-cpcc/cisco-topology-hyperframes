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
