import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconSymbol, iconDefs, ICON_TYPES } from '../engine/icons.mjs';

test('exposes the core device types', () => {
  for (const t of ['router', 'switch', 'firewall', 'server', 'pc', 'cloud']) {
    assert.ok(ICON_TYPES.includes(t), `missing ${t}`);
  }
});

test('iconSymbol returns a symbol with the expected id', () => {
  assert.match(iconSymbol('router'), /<symbol id="icon-router"/);
});

test('unknown type falls back to pc', () => {
  assert.match(iconSymbol('quantum-gateway'), /<symbol id="icon-pc"/);
});

test('iconDefs concatenates one symbol per requested type', () => {
  const defs = iconDefs(['router', 'switch']);
  assert.match(defs, /icon-router/);
  assert.match(defs, /icon-switch/);
});
