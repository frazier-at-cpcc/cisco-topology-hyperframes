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

test('unknown/unshipped type normalizes to pc', () => {
  const svg = renderSvg({ ...topo, nodes: [ { id: 'LB1', type: 'loadbalancer', x: 10, y: 10, label: 'LB' } ], links: [] });
  assert.match(svg, /<g id="node-LB1"[^]*?href="#icon-pc"/);
  assert.match(svg, /<defs>[^]*?icon-pc[^]*?<\/defs>/);
  assert.doesNotMatch(svg, /href="#icon-loadbalancer"/);
});

test('a valid type is unchanged', () => {
  const svg = renderSvg(topo);
  assert.match(svg, /<g id="node-R1"[^]*?href="#icon-router"/);
});
