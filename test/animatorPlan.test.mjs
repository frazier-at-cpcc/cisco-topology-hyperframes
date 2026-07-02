import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTimeline, HOP_DUR, PACKET_R, FLOW_COLORS, STATE_STYLES } from '../engine/animatorPlan.mjs';

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

test('STATE_STYLES.up has both color and opacity keys (opacity 0 clears)', () => {
  assert.equal(typeof STATE_STYLES.up.color, 'string');
  assert.equal(STATE_STYLES.up.opacity, 0);
});

test('setState -> up emits a set-state op with opacity 0', () => {
  const t = { nodes: [ { id: 'R1', type: 'router', x: 0, y: 0 } ], links: [],
    events: [ { at: 1, type: 'setState', target: 'R1', state: 'up' } ] };
  const op = planTimeline(t).find(o => o.kind === 'set-state');
  assert.equal(op.opacity, 0);
  assert.equal(typeof op.color, 'string');
});
