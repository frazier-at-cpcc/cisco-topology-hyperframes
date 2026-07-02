import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

export function validateTopology(topo) {
  const errors = [];
  if (!validateSchema(topo)) {
    for (const e of validateSchema.errors) errors.push(`${e.instancePath || '/'} ${e.message}`);
    return { valid: false, errors };
  }
  const nodeIds = new Set(topo.nodes.map(n => n.id));
  const linkIds = new Set((topo.links || []).map(l => l.id));
  for (const l of topo.links || []) {
    if (!nodeIds.has(l.from)) errors.push(`link ${l.id}: unknown from '${l.from}'`);
    if (!nodeIds.has(l.to)) errors.push(`link ${l.id}: unknown to '${l.to}'`);
  }
  for (const ev of topo.events || []) {
    if (ev.target && !nodeIds.has(ev.target) && !linkIds.has(ev.target)) {
      errors.push(`event @${ev.at}: unknown target '${ev.target}'`);
    }
    for (const id of ev.path || []) {
      if (!nodeIds.has(id)) errors.push(`event @${ev.at}: unknown path node '${id}'`);
    }
    for (const p of ev.paths || []) {
      for (const id of p) {
        if (!nodeIds.has(id)) errors.push(`event @${ev.at}: unknown paths node '${id}'`);
      }
    }
    for (const id of ev.reroute || []) {
      if (!nodeIds.has(id)) errors.push(`event @${ev.at}: unknown reroute node '${id}'`);
    }
  }
  return { valid: errors.length === 0, errors };
}
