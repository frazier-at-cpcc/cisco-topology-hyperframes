import { linkLength } from './renderer.mjs';

export const HOP_DUR = 0.2;
export const PACKET_R = 8;
export const FLOW_COLORS = {
  unicast: '#0066ff',
  multicast: '#ff9900',
  broadcast: '#ff3333'
};

export function planTimeline(topo) {
  const nodeById = new Map(topo.nodes.map(n => [n.id, n]));
  const linkById = new Map((topo.links || []).map(l => [l.id, l]));
  const tweens = [];

  for (const ev of topo.events || []) {
    if (ev.type === 'reveal') {
      if (nodeById.has(ev.target)) {
        tweens.push({
          at: ev.at, selector: `#node-${ev.target}`, kind: 'reveal-node',
          from: { opacity: 0, scale: 0.6 },
          to: { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }
        });
      } else if (linkById.has(ev.target)) {
        if (ev.mode === 'draw') {
          const l = linkById.get(ev.target);
          const len = Math.round(linkLength(nodeById.get(l.from), nodeById.get(l.to)));
          tweens.push({
            at: ev.at, selector: `#link-${ev.target}`, kind: 'reveal-link-draw',
            from: { '--dash': len }, to: { '--dash': 0, duration: 0.6, ease: 'power2.out' }
          });
        } else {
          tweens.push({
            at: ev.at, selector: `#link-${ev.target}`, kind: 'reveal-link-fade',
            from: { opacity: 0 }, to: { opacity: 1, duration: 0.4, ease: 'power1.out' }
          });
        }
      }
    } else if (ev.type === 'flow') {
      const paths = ev.paths || (ev.path ? [ev.path] : []);
      const color = FLOW_COLORS[ev.kind] || FLOW_COLORS.unicast;
      for (const path of paths) {
        const points = path.map(id => { const n = nodeById.get(id); return [n.x, n.y]; });
        if (points.length >= 2) tweens.push({ at: ev.at, kind: 'flow', points, hopDur: HOP_DUR, color, r: PACKET_R });
      }
    }
  }
  return tweens.sort((a, b) => a.at - b.at);
}
