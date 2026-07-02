import { linkLength } from './renderer.mjs';

export const HOP_DUR = 0.2;
export const PACKET_R = 8;
export const FLOW_COLORS = {
  unicast: '#0066ff',
  multicast: '#ff9900',
  broadcast: '#ff3333'
};
export const STATE_STYLES = {
  down: { color: '#cc0000', opacity: 0.95 },
  blocking: { color: '#ffaa00', opacity: 0.9 },
  forwarding: { color: '#00cc00', opacity: 0.9 },
  learning: { color: '#ffff00', opacity: 0.85 },
  active: { color: '#0066ff', opacity: 0.9 },
  standby: { color: '#999999', opacity: 0.8 },
  selected: { color: '#ffffff', opacity: 0.9 },
  up: { color: '#2ec16b', opacity: 0 }
};

function stateSelector(target, nodeById, linkById) {
  if (nodeById.has(target)) return `#node-${target}-state`;
  if (linkById.has(target)) return `#link-${target}-state`;
  return null;
}

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
        const points = path.map(id => nodeById.get(id)).filter(Boolean).map(n => [n.x, n.y]);
        if (points.length >= 2) tweens.push({ at: ev.at, kind: 'flow', points, hopDur: HOP_DUR, color, r: PACKET_R });
      }
    } else if (ev.type === 'setState') {
      const style = STATE_STYLES[ev.state];
      const selector = stateSelector(ev.target, nodeById, linkById);
      if (style && selector) tweens.push({ at: ev.at, kind: 'set-state', selector, color: style.color, opacity: style.opacity, duration: 0.4 });
    } else if (ev.type === 'fail') {
      const selector = stateSelector(ev.target, nodeById, linkById);
      let point = null;
      if (linkById.has(ev.target)) {
        const l = linkById.get(ev.target); const a = nodeById.get(l.from), b = nodeById.get(l.to);
        point = [Math.round((a.x + b.x) / 2), Math.round((a.y + b.y) / 2)];
      } else if (nodeById.has(ev.target)) {
        const n = nodeById.get(ev.target); point = [n.x, n.y];
      }
      if (selector) tweens.push({ at: ev.at, kind: 'set-state', selector, color: STATE_STYLES.down.color, opacity: STATE_STYLES.down.opacity, duration: 0.3 });
      if (point) tweens.push({ at: ev.at, kind: 'badge', point, color: STATE_STYLES.down.color, size: 18, duration: 0.3 });
      if (ev.reroute && ev.reroute.length >= 2) {
        const points = ev.reroute.map(id => nodeById.get(id)).filter(Boolean).map(n => [n.x, n.y]);
        if (points.length >= 2) tweens.push({ at: ev.at + 0.4, kind: 'flow', points, hopDur: HOP_DUR, color: FLOW_COLORS.unicast, r: PACKET_R });
      }
    }
  }
  return tweens.sort((a, b) => a.at - b.at);
}
