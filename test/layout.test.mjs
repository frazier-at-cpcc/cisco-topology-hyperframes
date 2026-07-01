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

test('is deterministic when layout.seed is explicitly 0', async () => {
  const seeded = { ...topo, layout: { seed: 0 } };
  const a = await applyLayout(seeded);
  const b = await applyLayout(seeded);
  assert.deepEqual(a.nodes.map(n => [n.id, n.x, n.y]), b.nodes.map(n => [n.id, n.x, n.y]));
});

test('manual algorithm with a partially-pinned node still yields integer coords for every node', async () => {
  const manual = {
    ...topo,
    layout: { algorithm: 'manual' },
    nodes: [
      { id: 'R1', type: 'router', x: 500, y: 300 },
      { id: 'SW1', type: 'switch' },
      { id: 'A', type: 'pc' }
    ]
  };
  const out = await applyLayout(manual);
  for (const n of out.nodes) {
    assert.equal(typeof n.x, 'number');
    assert.equal(typeof n.y, 'number');
    assert.equal(n.x, Math.round(n.x));
    assert.equal(n.y, Math.round(n.y));
  }
  const r1 = out.nodes.find(n => n.id === 'R1');
  assert.equal(r1.x, 500);
  assert.equal(r1.y, 300);
});

test('determinism holds for an ambiguous fan-out topology', async () => {
  const fan = {
    nodes: [
      { id: 'SW1', type: 'switch' },
      { id: 'A', type: 'pc' }, { id: 'B', type: 'pc' }, { id: 'C', type: 'pc' },
      { id: 'D', type: 'pc' }, { id: 'E', type: 'pc' }, { id: 'F', type: 'pc' }
    ],
    links: [
      { id: 'a', from: 'SW1', to: 'A' }, { id: 'b', from: 'SW1', to: 'B' },
      { id: 'c', from: 'SW1', to: 'C' }, { id: 'd', from: 'SW1', to: 'D' },
      { id: 'e', from: 'SW1', to: 'E' }, { id: 'f', from: 'SW1', to: 'F' }
    ]
  };
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const out = await applyLayout(fan);
    runs.push(out.nodes.map(n => [n.id, n.x, n.y]));
  }
  for (let i = 1; i < runs.length; i++) {
    assert.deepEqual(runs[i], runs[0], `run ${i} differs from run 0 — layout is non-deterministic`);
  }
});
