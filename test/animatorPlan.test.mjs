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
