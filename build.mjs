import { readFileSync, writeFileSync } from 'node:fs';
import { validateTopology } from './engine/validate.mjs';
import { applyLayout } from './engine/layout.mjs';
import { renderSvg } from './engine/renderer.mjs';
import { planTimeline } from './engine/animatorPlan.mjs';

const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';

export function blockHtml({ id, svg, tweens, width, height, duration }) {
  const tweensJson = JSON.stringify(tweens);
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
      TWEENS.forEach(function (tw) {
        var el = root.querySelector(tw.selector);
        if (el) tl.fromTo(el, tw.from, Object.assign({}, tw.to), tw.at);
      });
      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
</body>
</html>`;
}

export async function buildBlock(topo, { id }) {
  const v = validateTopology(topo);
  if (!v.valid) throw new Error('Invalid topology:\n' + v.errors.join('\n'));
  const laid = await applyLayout(topo);
  const svg = renderSvg(laid);
  const tweens = planTimeline(laid);
  const lastAt = (laid.events || []).reduce((m, e) => Math.max(m, e.at), 0);
  const duration = Math.max(3, Math.ceil(lastAt + 1.5));
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
  writeFileSync(out, html);
  console.log(`Wrote ${out}`);
  console.log('Host wiring snippet:');
  console.log(`<div data-composition-id="${id}" data-composition-src="${out}" data-start="0" data-duration="?" data-track-index="1" data-width="1920" data-height="1080"></div>`);
}
