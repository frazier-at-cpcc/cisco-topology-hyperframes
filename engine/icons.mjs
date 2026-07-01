const BUILTIN = {
  router: `<symbol id="icon-router" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#1f6fb2" stroke="#0d3c61" stroke-width="3"/><path d="M30 50h40M50 30v40M38 38l24 24M62 38L38 62" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/></symbol>`,
  switch: `<symbol id="icon-switch" viewBox="0 0 100 100"><rect x="15" y="30" width="70" height="40" rx="6" fill="#2c8a3d" stroke="#14431d" stroke-width="3"/><path d="M25 50h50M62 42l14 8-14 8M38 58L24 50l14-8" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></symbol>`,
  l3switch: `<symbol id="icon-l3switch" viewBox="0 0 100 100"><rect x="15" y="28" width="70" height="44" rx="6" fill="#7a3fb0" stroke="#3a1e54" stroke-width="3"/><text x="50" y="57" font-size="22" fill="#fff" text-anchor="middle" font-family="sans-serif">L3</text></symbol>`,
  firewall: `<symbol id="icon-firewall" viewBox="0 0 100 100"><rect x="20" y="25" width="60" height="50" rx="4" fill="#c0392b" stroke="#5a1a12" stroke-width="3"/><path d="M20 42h60M20 58h60M38 25v17M62 42v16M50 58v17" stroke="#fff" stroke-width="3"/></symbol>`,
  server: `<symbol id="icon-server" viewBox="0 0 100 100"><rect x="30" y="18" width="40" height="64" rx="4" fill="#555" stroke="#222" stroke-width="3"/><circle cx="50" cy="30" r="3" fill="#55ff55"/><path d="M38 44h24M38 54h24M38 64h24" stroke="#aaa" stroke-width="3"/></symbol>`,
  pc: `<symbol id="icon-pc" viewBox="0 0 100 100"><rect x="20" y="25" width="60" height="38" rx="3" fill="#334" stroke="#111" stroke-width="3"/><rect x="26" y="31" width="48" height="26" fill="#8fd3ff"/><path d="M40 70h20l4 8H36z" fill="#556"/></symbol>`,
  cloud: `<symbol id="icon-cloud" viewBox="0 0 100 100"><path d="M30 65a15 15 0 0 1 2-30 20 20 0 0 1 38-3 14 14 0 0 1 2 33z" fill="#e8eef3" stroke="#8aa0b2" stroke-width="3"/></symbol>`,
  internet: `<symbol id="icon-internet" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="#dfe8ef" stroke="#5a7184" stroke-width="3"/><path d="M16 50h68M50 16v68M28 30q22 20 44 0M28 70q22-20 44 0" stroke="#5a7184" stroke-width="2.5" fill="none"/></symbol>`,
  ap: `<symbol id="icon-ap" viewBox="0 0 100 100"><circle cx="50" cy="62" r="10" fill="#1f6fb2"/><path d="M35 40a20 20 0 0 1 30 0M28 32a30 30 0 0 1 44 0" stroke="#1f6fb2" stroke-width="4" fill="none" stroke-linecap="round"/></symbol>`
};

export const ICON_TYPES = Object.keys(BUILTIN);
export function iconSymbol(type) { return BUILTIN[type] || BUILTIN.pc; }
export function iconDefs(types) { return types.map(t => iconSymbol(t)).join('\n'); }
