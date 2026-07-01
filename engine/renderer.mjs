import { iconDefs, ICON_TYPES } from './icons.mjs';

const ICON_SIZE = 96;

function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
export function linkLength(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

export function renderSvg(topo) {
  const { width, height } = topo.canvas;
  const byId = new Map(topo.nodes.map(n => [n.id, n]));
  const types = [...new Set(topo.nodes.map(n => ICON_TYPES.includes(n.type) ? n.type : 'pc'))];
  const defs = iconDefs(types);

  const links = (topo.links || []).map(l => {
    const a = byId.get(l.from), b = byId.get(l.to);
    const len = Math.round(linkLength(a, b));
    const mx = Math.round((a.x + b.x) / 2), my = Math.round((a.y + b.y) / 2);
    const line = `<line id="link-${l.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" `
      + `class="link link-${l.type || 'ethernet'}" stroke-dasharray="${len}" style="--dash:0" />`;
    const label = l.label ? `<text class="link-label" x="${mx}" y="${my - 8}">${esc(l.label)}</text>` : '';
    return line + label;
  }).join('\n');

  const nodes = topo.nodes.map(n => {
    const s = ICON_SIZE;
    const iconType = ICON_TYPES.includes(n.type) ? n.type : 'pc';
    if (!ICON_TYPES.includes(n.type)) {
      console.warn(`cisco-topology: unknown node type "${n.type}" for node ${n.id} — using pc icon`);
    }
    return `<g id="node-${n.id}" class="node" transform="translate(${n.x},${n.y})">`
      + `<use href="#icon-${iconType}" x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" />`
      + `<text class="node-label" x="0" y="${s / 2 + 28}">${esc(n.label || n.id)}</text>`
      + `</g>`;
  }).join('\n');

  return `<svg class="topo" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" `
    + `xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">`
    + `<defs>${defs}</defs>\n${links}\n${nodes}\n</svg>`;
}
