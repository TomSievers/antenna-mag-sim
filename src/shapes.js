const TWO_PI = 2 * Math.PI;

export function circularLoop(radius = 1.0, n = 100) {
  const pts = new Float64Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TWO_PI;
    pts[i * 3]     = radius * Math.cos(t);
    pts[i * 3 + 1] = radius * Math.sin(t);
  }
  return pts;
}

export function squareLoop(side = 1.8) {
  const s = side / 2;
  return new Float64Array([-s,-s,0, s,-s,0, s,s,0, -s,s,0, -s,-s,0]);
}

export function helix(radius = 0.6, nTurns = 4, pitch = 0.45, nPerTurn = 36) {
  const n = nTurns * nPerTurn;
  const totalH = nTurns * pitch;
  const pts = new Float64Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TWO_PI * nTurns;
    pts[i * 3]     = radius * Math.cos(t);
    pts[i * 3 + 1] = radius * Math.sin(t);
    pts[i * 3 + 2] = (i / n) * totalH - totalH / 2;
  }
  return pts;
}

export function figure8(r = 0.75, n = 80) {
  const pts = new Float64Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TWO_PI;
    pts[i * 3]         =  r * Math.cos(t);
    pts[i * 3 + 2]     =  r + r * Math.sin(t);
    pts[(n + i) * 3]   =  r * Math.cos(-t);
    pts[(n + i) * 3 + 2] = -r + r * Math.sin(-t);
  }
  return pts;
}

export function helmholtz(radius = 1.0, sep = 1.0, n = 80) {
  const lo = new Float64Array((n + 1) * 3);
  const hi = new Float64Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TWO_PI;
    lo[i*3] = hi[i*3] = radius * Math.cos(t);
    lo[i*3+1] = hi[i*3+1] = radius * Math.sin(t);
    lo[i*3+2] = -sep / 2;
    hi[i*3+2] =  sep / 2;
  }
  const conn = new Float64Array([radius,0,-sep/2, radius,0,sep/2]);
  const out = new Float64Array(lo.length + conn.length + hi.length);
  out.set(lo, 0);
  out.set(conn, lo.length);
  out.set(hi, lo.length + conn.length);
  return out;
}

export function dipole(length = 2.0, n = 40) {
  const pts = new Float64Array((n + 1) * 3);
  for (let i = 0; i <= n; i++)
    pts[i * 3 + 2] = -length / 2 + (i / n) * length;
  return pts;
}

export function rhombic(side = 1.2) {
  const s = side;
  return new Float64Array([0,s,0, s,0,0, 0,-s,0, -s,0,0, 0,s,0]);
}

export const PRESET_NAMES = [
  'Circular Loop', 'Square Loop', 'Helix', 'Figure-8',
  'Helmholtz', 'Dipole', 'Rhombic',
];

export const PRESETS = {
  'Circular Loop': circularLoop,
  'Square Loop':   squareLoop,
  'Helix':         helix,
  'Figure-8':      figure8,
  'Helmholtz':     helmholtz,
  'Dipole':        dipole,
  'Rhombic':       rhombic,
};

export function parseShapeFile(text) {
  const pts = [];
  for (const line of text.split('\n')) {
    const clean = line.split('#')[0].trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 3) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      const z = parseFloat(parts[2]);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) pts.push(x, y, z);
    }
  }
  if (pts.length < 6) throw new Error('Need at least 2 vertices');
  return new Float64Array(pts);
}
