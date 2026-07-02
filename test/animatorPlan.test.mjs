import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTimeline, HOP_DUR, PACKET_R, FLOW_COLORS } from '../engine/animatorPlan.mjs';

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

test('output is sorted by at', () => {
  const ats = planTimeline(topo).map(t => t.at);
  assert.deepEqual(ats, [...ats].sort((a, b) => a - b));
});

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
