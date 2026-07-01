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
