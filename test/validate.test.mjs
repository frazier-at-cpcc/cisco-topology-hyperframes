import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTopology } from '../engine/validate.mjs';

const good = {
  nodes: [ { id: 'R1', type: 'router' }, { id: 'SW1', type: 'switch' } ],
  links: [ { id: 'l1', from: 'R1', to: 'SW1' } ],
  events: [ { at: 0, type: 'reveal', target: 'R1' } ]
};

test('accepts a well-formed topology', () => {
  const r = validateTopology(good);
  assert.equal(r.valid, true, r.errors.join('; '));
});

test('rejects a link referencing an unknown node', () => {
  const bad = { ...good, links: [ { id: 'l1', from: 'R1', to: 'NOPE' } ] };
  const r = validateTopology(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('NOPE')));
});

test('rejects an event with an unknown target', () => {
  const bad = { ...good, events: [ { at: 0, type: 'reveal', target: 'GHOST' } ] };
  const r = validateTopology(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('GHOST')));
});

test('rejects a node missing required type', () => {
  const bad = { nodes: [ { id: 'R1' } ], links: [] };
  const r = validateTopology(bad);
  assert.equal(r.valid, false);
});
