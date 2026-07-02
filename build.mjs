import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateTopology } from './engine/validate.mjs';
import { applyLayout } from './engine/layout.mjs';
import { renderSvg } from './engine/renderer.mjs';
import { planTimeline } from './engine/animatorPlan.mjs';

const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';

export function blockHtml({ id, svg, tweens, width, height, duration }) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid composition id: ${JSON.stringify(id)} (must match ^[A-Za-z0-9_-]+$)`);
  const tweensJson = JSON.stringify(tweens).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head><meta charset="UTF-8" /></head>
<body>
<template>
  <style>
    #${id} { position: absolute; inset: 0; background: #0b1622; overflow: hidden; }
    #${id} .topo { position: absolute; inset: 0; width: 100%; height: 100%; }
    #${id} .link { stroke: #7fa8c9; stroke-width: 4; stroke-dashoffset: var(--dash, 0); }
    #${id} .link-trunk { stroke-width: 7; }
    #${id} .link-wireless { stroke-dasharray: 10 8; }
    #${id} .link-label, #${id} .node-label {
      fill: #cfe0ee; font-family: 'Segoe UI', sans-serif; font-size: 22px; text-anchor: middle;
    }
    #${id} .node-label { font-weight: 600; }
  </style>
  <div id="${id}" data-composition-id="${id}" data-width="${width}" data-height="${height}" data-duration="${duration}">
    ${svg}
  </div>
  <script src="${GSAP}"></script>
  <script>
    (function () {
      window.__timelines = window.__timelines || {};
      var TWEENS = ${tweensJson};
      var root = document.getElementById('${id}');
      var tl = gsap.timeline({ paused: true });
      var SVGNS = 'http://www.w3.org/2000/svg';
      var svg = root.querySelector('svg');
      TWEENS.forEach(function (op) {
        if (op.kind === 'reveal-node' || op.kind === 'reveal-link-draw' || op.kind === 'reveal-link-fade') {
          var el = root.querySelector(op.selector);
          if (el) tl.fromTo(el, op.from, Object.assign({}, op.to), op.at);
          else console.warn('cisco-topology: no element for ' + op.selector);
        } else if (op.kind === 'flow') {
          var g = document.createElementNS(SVGNS, 'g');
          var c = document.createElementNS(SVGNS, 'circle');
          c.setAttribute('r', op.r); c.setAttribute('cx', 0); c.setAttribute('cy', 0); c.setAttribute('fill', op.color);
          g.appendChild(c); g.setAttribute('opacity', '0'); svg.appendChild(g);
          var p0 = op.points[0];
          gsap.set(g, { x: p0[0], y: p0[1] }); // park on-canvas at the path start immediately, so pre-op.at seeks never see the raw (0,0) origin default
          tl.set(g, { x: p0[0], y: p0[1], opacity: 0 }, op.at);
          tl.to(g, { opacity: 1, duration: 0.2 }, op.at);
          var t = op.at + 0.2;
          for (var i = 1; i < op.points.length; i++) {
            tl.to(g, { x: op.points[i][0], y: op.points[i][1], duration: op.hopDur, ease: 'none' }, t);
            t += op.hopDur;
          }
          tl.to(g, { opacity: 0, duration: 0.2 }, t);
        }
        // set-state and badge kinds are added in Tasks 6 and 8
      });
      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
</body>
</html>`;
}

function opEndTime(op) {
  if (op.kind === 'flow') return op.at + 0.2 + Math.max(0, op.points.length - 1) * op.hopDur + 0.2;
  if (op.kind === 'set-state' || op.kind === 'badge') return op.at + (op.duration || 0.4);
  return op.at + ((op.to && op.to.duration) || 0.6); // reveal-*
}

export async function buildBlock(topo, { id }) {
  const v = validateTopology(topo);
  if (!v.valid) throw new Error('Invalid topology:\n' + v.errors.join('\n'));
  const laid = await applyLayout(topo);
  const svg = renderSvg(laid);
  const tweens = planTimeline(laid);
  const maxEnd = (tweens.length ? Math.max(...tweens.map(opEndTime)) : 0);
  const duration = Math.max(3, Math.ceil(maxEnd + 0.5));
  return blockHtml({ id, svg, tweens, width: laid.canvas.width, height: laid.canvas.height, duration });
}

// CLI: node build.mjs <topology.json> --id <comp-id> --out <path.html>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , file] = process.argv;
  const idFlag = process.argv.indexOf('--id');
  const outFlag = process.argv.indexOf('--out');
  const id = idFlag > 0 ? process.argv[idFlag + 1] : 'cisco-topology';
  const out = outFlag > 0 ? process.argv[outFlag + 1] : `compositions/${id}.html`;
  const topo = JSON.parse(readFileSync(file, 'utf8'));
  const html = await buildBlock(topo, { id });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`Wrote ${out}`);
  console.log('Host wiring snippet:');
  console.log(`<div data-composition-id="${id}" data-composition-src="${out}" data-start="0" data-duration="?" data-track-index="1" data-width="1920" data-height="1080"></div>`);
}
