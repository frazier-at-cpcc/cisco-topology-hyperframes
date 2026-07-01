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
