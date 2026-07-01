import { linkLength } from './renderer.mjs';

export function planTimeline(topo) {
  const nodeById = new Map(topo.nodes.map(n => [n.id, n]));
  const linkById = new Map((topo.links || []).map(l => [l.id, l]));
  const tweens = [];

  for (const ev of topo.events || []) {
    if (ev.type !== 'reveal') continue;
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
  }
  return tweens.sort((a, b) => a.at - b.at);
}
