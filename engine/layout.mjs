import ELK from 'elkjs/lib/elk.bundled.js';

const CANVAS_DEFAULTS = { width: 1920, height: 1080, padding: 120 };
const NODE_W = 120, NODE_H = 120;

export async function applyLayout(topo) {
  const canvas = { ...CANVAS_DEFAULTS, ...(topo.canvas || {}) };
  const algorithm = topo.layout?.algorithm || 'layered';
  const nodes = topo.nodes.map(n => ({ ...n }));
  const needsLayout = nodes.some(n => n.x == null || n.y == null);

  if (needsLayout && algorithm !== 'manual') {
    const elk = new ELK();
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': topo.layout?.direction || 'DOWN',
        'elk.randomSeed': String(topo.layout?.seed ?? 1),
        'elk.layered.spacing.nodeNodeBetweenLayers': '140',
        'elk.spacing.nodeNode': '90'
      },
      children: nodes.map(n => ({
        id: n.id,
        width: NODE_W,
        height: NODE_H,
        ...(n.x != null && n.y != null ? { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 } : {})
      })),
      edges: (topo.links || []).map(l => ({ id: l.id, sources: [l.from], targets: [l.to] }))
    };
    const res = await elk.layout(graph);
    const pos = new Map(res.children.map(c => [c.id, c]));
    for (const n of nodes) {
      if (n.x == null || n.y == null) {
        const p = pos.get(n.id);
        n.x = Math.round(p.x + NODE_W / 2) + canvas.padding;
        n.y = Math.round(p.y + NODE_H / 2) + canvas.padding;
      }
    }
  }
  return { ...topo, canvas, nodes };
}
