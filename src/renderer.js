import Plotly from 'plotly.js-dist-min';

const ANT_COLORS = ['#22d3ee', '#f87171', '#4ade80', '#fbbf24'];

const HEAT_COLORSCALE = [
  [0.00, '#020210'],   // near-black  — weakest field
  [0.20, '#0a2a90'],   // deep navy
  [0.45, '#1a70d0'],   // mid blue
  [0.65, '#f59e0b'],   // amber
  [0.82, '#f97316'],   // orange
  [1.00, '#fef08a'],   // pale yellow — strongest field
];

// ── Fixed trace indices ───────────────────────────────────────────────────────
// 0: heatmap  1: arrow shafts  2: arrowheads  3-6: antenna wires (one per slot)
const T_HEAT = 0;
const T_SHAFT = 1;
const T_HEAD = 2;
const T_WIRE0 = 3;

const BASE_LAYOUT = {
  paper_bgcolor: '#080810',
  plot_bgcolor: '#080810',
  font: { family: 'system-ui, sans-serif', color: '#dde0f0', size: 10 },
  margin: { l: 44, r: 8, t: 32, b: 36 },
  showlegend: false,
  dragmode: 'pan',
  xaxis: {
    color: '#dde0f0', gridcolor: '#18182a', zerolinecolor: '#28285a', tickfont: { size: 9 },
    autorange: false, range: [-3, 3]
  },
  yaxis: {
    color: '#dde0f0', gridcolor: '#18182a', zerolinecolor: '#28285a', tickfont: { size: 9 },
    autorange: false, range: [-3, 3]
  },
};

function emptyTrace(type, mode, extra = {}) {
  return { type, mode, x: [], y: [], hoverinfo: 'skip', ...extra };
}

export function initPlot(divId, xLabel, yLabel, title) {
  const data = [
    // heatmap — hidden until first compute
    {
      type: 'heatmap', z: [[0]], x: [0], y: [0],
      colorscale: HEAT_COLORSCALE, showscale: false,
      zsmooth: 'best', visible: false, hoverinfo: 'skip'
    },
    // arrow shafts
    emptyTrace('scatter', 'lines', { line: { color: 'rgba(255,255,255,0.65)', width: 1 } }),
    // arrowheads
    emptyTrace('scatter', 'markers', {
      marker: {
        symbol: 'triangle-up', angleref: 'up', color: 'rgba(255,255,255,0.75)',
        size: 7, angle: [], line: { width: 0 }
      },
    }),
    // 4 antenna wire slots
    ...Array(4).fill(null).map(() =>
      emptyTrace('scatter', 'lines', { line: { color: 'transparent', width: 2 } }),
    ),
  ];

  const layout = {
    ...BASE_LAYOUT,
    title: { text: title, font: { size: 11 }, pad: { t: 2 } },
    xaxis: { ...BASE_LAYOUT.xaxis, title: { text: xLabel, standoff: 4 } },
    yaxis: { ...BASE_LAYOUT.yaxis, title: { text: yLabel, standoff: 4 } },
  };

  Plotly.newPlot(divId, data, layout, {
    responsive: true,
    scrollZoom: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toImage', 'autoScale2d'],
  });
}

// Called once after compute — updates heatmap and resets view
export function setHeatmap(divId, hm) {
  const { amp, lim, n } = hm;
  const coords = Array.from({ length: n }, (_, i) => -lim + 2 * lim * i / (n - 1));

  // Percentile-normalised log10 amplitude
  const logFlat = new Float64Array(n * n);
  for (let k = 0; k < n * n; k++) logFlat[k] = Math.log10(amp[k] + 1e-40);
  const sorted = Float64Array.from(logFlat).sort();
  const vmin = sorted[Math.max(0, (0.02 * n * n) | 0)];
  const vmax = sorted[Math.min(n * n - 1, (0.98 * n * n) | 0)];

  // Plotly heatmap: z[rowIdx][colIdx] = z[ib][ia]
  const z = Array.from({ length: n }, (_, j) =>
    Array.from({ length: n }, (_, i) => logFlat[i * n + j]),
  );

  Plotly.restyle(divId, {
    z: [z], x: [coords], y: [coords],
    zmin: [vmin], zmax: [vmax], visible: [true]
  }, [T_HEAT]);
  Plotly.relayout(divId, {
    'xaxis.range': [-lim, lim],
    'xaxis.autorange': false,
    'yaxis.range': [-lim, lim],
    'yaxis.autorange': false,
  });
}

// Fast path — updates only arrow shafts and heads for animation / time scrub
export function setArrows(divId, hm, timePhase) {
  const { daR, daI, dbR, dbI, lim, n } = hm;
  const cos = Math.cos(timePhase), sin = Math.sin(timePhase);

  const step = Math.max(1, Math.floor(n / 14));
  const nArrow = Math.floor((n - (step >> 1) - 1) / step) + 1;
  const arrowL = 0.38 * 2 * lim / nArrow;

  const shaftX = [], shaftY = [];
  const headX = [], headY = [], angles = [];

  for (let i = step >> 1; i < n; i += step) {
    const x = -lim + 2 * lim * i / (n - 1);
    for (let j = step >> 1; j < n; j += step) {
      const y = -lim + 2 * lim * j / (n - 1);
      // Real field at time t: Re[B·e^{jωt}] = B_r·cos(t) − B_i·sin(t)
      const ux = daR[i * n + j] * cos - daI[i * n + j] * sin;
      const uy = dbR[i * n + j] * cos - dbI[i * n + j] * sin;
      const mag = Math.sqrt(ux * ux + uy * uy);
      if (mag < 1e-30) continue;
      const nx = ux / mag, ny = uy / mag;

      shaftX.push(x - nx * arrowL * 0.5, x + nx * arrowL * 0.5, null);
      shaftY.push(y - ny * arrowL * 0.5, y + ny * arrowL * 0.5, null);
      headX.push(x + nx * arrowL * 0.5);
      headY.push(y + ny * arrowL * 0.5);
      // Clockwise angle from north (+y): atan2(ux, uy)
      angles.push(Math.atan2(nx, ny) * 180 / Math.PI);
    }
  }

  // Single restyle call for both arrow traces
  Plotly.restyle(divId,
    { x: [shaftX, headX], y: [shaftY, headY] },
    [T_SHAFT, T_HEAD],
  );
  Plotly.restyle(divId, { 'marker.angle': [angles] }, [T_HEAD]);
}

// Update antenna wire projections onto the plane (ia / ib = axis indices 0-2)
export function setWires(divId, antennas, ia, ib) {
  const traceX = [], traceY = [], traceColor = [];
  for (let slot = 0; slot < 4; slot++) {
    const ant = antennas[slot];
    if (ant) {
      const v = ant.vertices instanceof Float64Array ? ant.vertices : new Float64Array(ant.vertices);
      const off = ant.offset;
      const x = [], y = [];
      for (let k = 0; k < v.length / 3; k++) {
        x.push(v[k * 3 + ia] + off[ia]);
        y.push(v[k * 3 + ib] + off[ib]);
      }
      traceX.push(x); traceY.push(y);
      traceColor.push(ANT_COLORS[slot % ANT_COLORS.length]);
    } else {
      traceX.push([]); traceY.push([]);
      traceColor.push('transparent');
    }
  }
  Plotly.restyle(divId,
    { x: traceX, y: traceY, 'line.color': traceColor },
    [T_WIRE0, T_WIRE0 + 1, T_WIRE0 + 2, T_WIRE0 + 3],
  );
}

export function setTitle(divId, text) {
  Plotly.relayout(divId, { 'title.text': text });
}

// ── Field line tracing ────────────────────────────────────────────────────────
function bilinearField(hm, px, py, cos_t, sin_t) {
  const { daR, daI, dbR, dbI, n, lim } = hm;
  const fi = (px + lim) / (2 * lim) * (n - 1);
  const fj = (py + lim) / (2 * lim) * (n - 1);
  if (fi < 0 || fi > n - 1 || fj < 0 || fj > n - 1) return null;
  const i0 = Math.min(n - 2, Math.floor(fi)), j0 = Math.min(n - 2, Math.floor(fj));
  const di = fi - i0, dj = fj - j0;
  const k00 = i0 * n + j0, k10 = (i0 + 1) * n + j0, k01 = i0 * n + j0 + 1, k11 = (i0 + 1) * n + j0 + 1;
  const w00 = (1 - di) * (1 - dj), w10 = di * (1 - dj), w01 = (1 - di) * dj, w11 = di * dj;
  const ux = w00 * (daR[k00] * cos_t - daI[k00] * sin_t) + w10 * (daR[k10] * cos_t - daI[k10] * sin_t)
    + w01 * (daR[k01] * cos_t - daI[k01] * sin_t) + w11 * (daR[k11] * cos_t - daI[k11] * sin_t);
  const uy = w00 * (dbR[k00] * cos_t - dbI[k00] * sin_t) + w10 * (dbR[k10] * cos_t - dbI[k10] * sin_t)
    + w01 * (dbR[k01] * cos_t - dbI[k01] * sin_t) + w11 * (dbR[k11] * cos_t - dbI[k11] * sin_t);
  return { ux, uy };
}

function traceOneLine(hm, x0, y0, cos_t, sin_t) {
  const { lim } = hm;
  const step = lim * 0.035;

  const norm = (f) => {
    if (!f) return null;
    const m = Math.hypot(f.ux, f.uy);
    return m < 1e-20 ? null : { dx: f.ux / m, dy: f.uy / m };
  };

  function rk4step(x, y, dir) {
    const k1 = norm(bilinearField(hm, x, y, cos_t, sin_t));
    if (!k1) return null;
    const k2 = norm(bilinearField(hm, x + .5 * step * dir * k1.dx, y + .5 * step * dir * k1.dy, cos_t, sin_t)) ?? k1;
    const k3 = norm(bilinearField(hm, x + .5 * step * dir * k2.dx, y + .5 * step * dir * k2.dy, cos_t, sin_t)) ?? k2;
    const k4 = norm(bilinearField(hm, x + step * dir * k3.dx, y + step * dir * k3.dy, cos_t, sin_t)) ?? k3;
    return [
      x + dir * step * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx) / 6,
      y + dir * step * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy) / 6,
    ];
  }

  function traceSide(dir) {
    const pts = [];
    let [x, y] = [x0, y0];
    for (let s = 0; s < 500; s++) {
      const next = rk4step(x, y, dir);
      if (!next) break;
      [x, y] = next;
      if (x < -lim || x > lim || y < -lim || y > lim) break;
      pts.push([x, y]);
    }
    return pts;
  }

  const fwd = traceSide(+1);
  const bwd = traceSide(-1).reverse();
  return [...bwd, [x0, y0], ...fwd];
}

export function setFieldLines(divId, hm, timePhase, nLines) {
  const { lim } = hm;
  const cos_t = Math.cos(timePhase), sin_t = Math.sin(timePhase);
  const r0 = lim * 0.25;

  const lineX = [], lineY = [];
  const arrowX = [], arrowY = [], arrowAngles = [];

  for (let k = 0; k < nLines; k++) {
    const ang = (k / nLines) * 2 * Math.PI;
    const pts = traceOneLine(hm, r0 * Math.cos(ang), r0 * Math.sin(ang), cos_t, sin_t);
    if (pts.length < 2) continue;

    pts.forEach(([px, py]) => { lineX.push(px); lineY.push(py); });
    lineX.push(null); lineY.push(null);

    // Direction arrows ~every pts.length/4 steps
    const ev = Math.max(4, Math.floor(pts.length / 4));
    for (let i = ev; i < pts.length - 1; i += ev) {
      const dx = pts[i + 1][0] - pts[i - 1][0];
      const dy = pts[i + 1][1] - pts[i - 1][1];
      arrowX.push(pts[i][0]);
      arrowY.push(pts[i][1]);
      arrowAngles.push(Math.atan2(dx, dy) * 180 / Math.PI);
    }
  }

  Plotly.restyle(divId, { visible: [false] }, [T_HEAT]);
  Plotly.restyle(divId, { x: [lineX, arrowX], y: [lineY, arrowY] }, [T_SHAFT, T_HEAD]);
  Plotly.restyle(divId, { 'marker.angle': [arrowAngles] }, [T_HEAD]);
}

// Hide heatmap and clear arrows
export function clearPlot(divId) {
  Plotly.restyle(divId, { visible: [false] }, [T_HEAT]);
  Plotly.restyle(divId, { x: [[], []], y: [[], []] }, [T_SHAFT, T_HEAD]);
  Plotly.restyle(divId, { 'marker.angle': [[]] }, [T_HEAD]);
}

// ── 3D plot ───────────────────────────────────────────────────────────────────
// Trace layout: 0=field cones  1=XY plane  2=XZ plane  3=YZ plane  4-7=wires
//               8=streamline shafts  9=streamline direction cones
const T3D_CONE     = 0;
const T3D_XY       = 1;
const T3D_XZ       = 2;
const T3D_YZ       = 3;
const T3D_WIRE0    = 4;
const T3D_FL_SHAFT = 8;
const T3D_FL_HEAD  = 9;

const PLANE_META_3D = [
  { key: 'xy', ia: 0, ib: 1, ic: 2, ti: T3D_XY },
  { key: 'xz', ia: 0, ib: 2, ic: 1, ti: T3D_XZ },
  { key: 'yz', ia: 1, ib: 2, ic: 0, ti: T3D_YZ },
];

export function init3DPlot(divId) {
  // Trace 0: 3D cone arrows — instantaneous B field, replaces isosurface
  const emptyCone = {
    type: 'cone',
    x: [], y: [], z: [], u: [], v: [], w: [],
    colorscale: HEAT_COLORSCALE,
    showscale: false, cauto: false, cmin: 0, cmax: 1,
    sizemode: 'scaled', sizeref: 1,
    anchor: 'center',
    lighting: { ambient: 0.5, diffuse: 0.8, specular: 0.1 },
    hoverinfo: 'skip',
    visible: false,
  };

  const emptySurface = () => ({
    type: 'surface',
    x: [[0]], y: [[0]], z: [[0]], surfacecolor: [[0]],
    colorscale: HEAT_COLORSCALE,
    showscale: false,
    opacity: 0.75,
    contours: {
      x: { highlight: false, show: false },
      y: { highlight: false, show: false },
      z: { highlight: false, show: false },
    },
    hoverinfo: 'skip',
    visible: false,
  });

  const data = [
    emptyCone,
    emptySurface(), emptySurface(), emptySurface(),
    // traces 4-7: antenna wires
    ...Array(4).fill(null).map(() => ({
      type: 'scatter3d', mode: 'lines',
      x: [], y: [], z: [],
      line: { color: 'transparent', width: 3 },
      hoverinfo: 'skip',
    })),
    // trace 8: field line shafts
    {
      type: 'scatter3d', mode: 'lines',
      x: [], y: [], z: [],
      line: { color: 'rgba(255,255,255,0.75)', width: 2 },
      hoverinfo: 'skip',
      visible: false,
    },
    // trace 9: field line direction cones
    {
      type: 'cone',
      x: [], y: [], z: [], u: [], v: [], w: [],
      colorscale: [[0, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0.7)']],
      showscale: false, cauto: false, cmin: 0, cmax: 1,
      sizemode: 'absolute', sizeref: 0.12,
      anchor: 'center',
      hoverinfo: 'skip',
      visible: false,
    },
  ];

  const ax = label => ({
    title: label, color: '#dde0f0',
    gridcolor: '#28285a', zerolinecolor: '#28285a',
    tickfont: { size: 9 }, titlefont: { size: 10 },
  });

  const layout = {
    paper_bgcolor: '#080810',
    margin: { l: 0, r: 0, t: 32, b: 0 },
    font: { family: 'system-ui, sans-serif', color: '#dde0f0', size: 10 },
    title: { text: '3D  B field', font: { size: 11 }, pad: { t: 2 } },
    scene: {
      bgcolor: '#080810',
      xaxis: ax('X (m)'),
      yaxis: ax('Y (m)'),
      zaxis: ax('Z (m)'),
      camera: { eye: { x: 1.5, y: 1.5, z: 0.8 } },
      aspectmode: 'cube',
    },
  };

  Plotly.newPlot(divId, data, layout, {
    responsive: true,
    scrollZoom: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['toImage'],
  });
}

// Build 2D surface grids for a heatmap plane, ready for a Plotly surface trace.
// Row axis = ib, column axis = ia, fixed axis = ic at value c0.
function buildPlaneSurface3D(hm, ia, ib, ic) {
  const { amp, n, lim, c0 } = hm;
  const coords = Array.from({ length: n }, (_, i) => -lim + 2 * lim * i / (n - 1));

  const logFlat = new Float64Array(n * n);
  for (let k = 0; k < n * n; k++) logFlat[k] = Math.log10(amp[k] + 1e-40);
  const sorted = Float64Array.from(logFlat).sort();
  const vmin = sorted[Math.max(0, (0.02 * n * n) | 0)];
  const vmax = sorted[Math.min(n * n - 1, (0.98 * n * n) | 0)];

  const xGrid = [], yGrid = [], zGrid = [], cGrid = [];
  for (let j = 0; j < n; j++) {
    const xRow = [], yRow = [], zRow = [], cRow = [];
    for (let i = 0; i < n; i++) {
      const pos = [0, 0, 0];
      pos[ia] = coords[i];
      pos[ib] = coords[j];
      pos[ic] = c0;
      xRow.push(pos[0]); yRow.push(pos[1]); zRow.push(pos[2]);
      cRow.push(Math.max(vmin, Math.min(vmax, logFlat[i * n + j])));
    }
    xGrid.push(xRow); yGrid.push(yRow); zGrid.push(zRow); cGrid.push(cRow);
  }
  return { x: xGrid, y: yGrid, z: zGrid, surfacecolor: cGrid, cmin: vmin, cmax: vmax };
}

export function set3DPlanes(divId, heatmaps) {
  for (const { key, ia, ib, ic, ti } of PLANE_META_3D) {
    const hm = heatmaps[key];
    if (!hm) continue;
    const { x, y, z, surfacecolor, cmin, cmax } = buildPlaneSurface3D(hm, ia, ib, ic);
    Plotly.restyle(divId,
      { x: [x], y: [y], z: [z], surfacecolor: [surfacecolor], cmin: [cmin], cmax: [cmax], visible: [true] },
      [ti],
    );
  }
}

// ── 3D field helpers ──────────────────────────────────────────────────────────

// Trilinear interpolation of the instantaneous B field from the 3D volume grid.
function trilinearField3D(vol3d, px, py, pz, cos_t, sin_t) {
  const { bxR, bxI, byR, byI, bzR, bzI, n, lim } = vol3d;
  const fi = (px + lim) / (2 * lim) * (n - 1);
  const fj = (py + lim) / (2 * lim) * (n - 1);
  const fk = (pz + lim) / (2 * lim) * (n - 1);
  if (fi < 0 || fi > n - 1 || fj < 0 || fj > n - 1 || fk < 0 || fk > n - 1) return null;
  const i0 = Math.min(n - 2, fi | 0), j0 = Math.min(n - 2, fj | 0), k0 = Math.min(n - 2, fk | 0);
  const di = fi - i0, dj = fj - j0, dk = fk - k0;
  const n2 = n * n;
  // 8 corner indices and weights
  const idx = [
    i0*n2+j0*n+k0,     (i0+1)*n2+j0*n+k0,     i0*n2+(j0+1)*n+k0,     (i0+1)*n2+(j0+1)*n+k0,
    i0*n2+j0*n+k0+1, (i0+1)*n2+j0*n+k0+1, i0*n2+(j0+1)*n+k0+1, (i0+1)*n2+(j0+1)*n+k0+1,
  ];
  const w = [
    (1-di)*(1-dj)*(1-dk), di*(1-dj)*(1-dk), (1-di)*dj*(1-dk), di*dj*(1-dk),
    (1-di)*(1-dj)*dk,     di*(1-dj)*dk,     (1-di)*dj*dk,     di*dj*dk,
  ];
  const lerp = arr => w[0]*arr[idx[0]] + w[1]*arr[idx[1]] + w[2]*arr[idx[2]] + w[3]*arr[idx[3]]
                    + w[4]*arr[idx[4]] + w[5]*arr[idx[5]] + w[6]*arr[idx[6]] + w[7]*arr[idx[7]];
  return {
    ux: lerp(bxR)*cos_t - lerp(bxI)*sin_t,
    uy: lerp(byR)*cos_t - lerp(byI)*sin_t,
    uz: lerp(bzR)*cos_t - lerp(bzI)*sin_t,
  };
}

// RK4 streamline tracer in 3D, returning [[x,y,z], ...] points.
function traceStreamline3D(vol3d, x0, y0, z0, cos_t, sin_t) {
  const { lim } = vol3d;
  const step = lim * 0.05;

  const norm3 = f => {
    if (!f) return null;
    const m = Math.sqrt(f.ux*f.ux + f.uy*f.uy + f.uz*f.uz);
    return m < 1e-20 ? null : { dx: f.ux/m, dy: f.uy/m, dz: f.uz/m };
  };

  const rk4 = (x, y, z, dir) => {
    const k1 = norm3(trilinearField3D(vol3d, x, y, z, cos_t, sin_t));
    if (!k1) return null;
    const k2 = norm3(trilinearField3D(vol3d, x+.5*step*dir*k1.dx, y+.5*step*dir*k1.dy, z+.5*step*dir*k1.dz, cos_t, sin_t)) ?? k1;
    const k3 = norm3(trilinearField3D(vol3d, x+.5*step*dir*k2.dx, y+.5*step*dir*k2.dy, z+.5*step*dir*k2.dz, cos_t, sin_t)) ?? k2;
    const k4 = norm3(trilinearField3D(vol3d, x+step*dir*k3.dx, y+step*dir*k3.dy, z+step*dir*k3.dz, cos_t, sin_t)) ?? k3;
    return [
      x + dir*step*(k1.dx+2*k2.dx+2*k3.dx+k4.dx)/6,
      y + dir*step*(k1.dy+2*k2.dy+2*k3.dy+k4.dy)/6,
      z + dir*step*(k1.dz+2*k2.dz+2*k3.dz+k4.dz)/6,
    ];
  };

  const side = dir => {
    const pts = [];
    let [x, y, z] = [x0, y0, z0];
    for (let s = 0; s < 300; s++) {
      const next = rk4(x, y, z, dir);
      if (!next) break;
      [x, y, z] = next;
      if (Math.abs(x) > lim || Math.abs(y) > lim || Math.abs(z) > lim) break;
      pts.push([x, y, z]);
    }
    return pts;
  };

  const fwd = side(+1);
  const bwd = side(-1).reverse();
  return [...bwd, [x0, y0, z0], ...fwd];
}

// Distribute n seed points uniformly on a sphere of radius r (Fibonacci spiral).
function fibonacciSeeds(n, r) {
  const phi = Math.PI * (Math.sqrt(5) - 1);
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (i / (n - 1)) * 2;
    const r2 = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = phi * i;
    return [r2 * Math.cos(theta) * r, y * r, r2 * Math.sin(theta) * r];
  });
}

// Show instantaneous 3D B-field as cone arrows on a subgrid.
// Cones are scaled and colored by log-amplitude; updates every animation frame.
export function set3DCones(divId, vol3d, timePhase) {
  const { amp, bxR, bxI, byR, byI, bzR, bzI, n, lim } = vol3d;
  const n3 = n * n * n;
  const cos_t = Math.cos(timePhase), sin_t = Math.sin(timePhase);
  const coords = Array.from({ length: n }, (_, i) => -lim + 2 * lim * i / (n - 1));

  // Percentile-based log scale for magnitude → colour + size
  const logAmp = new Float64Array(n3);
  for (let k = 0; k < n3; k++) logAmp[k] = Math.log10(amp[k] + 1e-40);
  const sorted = Float64Array.from(logAmp).sort();
  const vmin = sorted[(0.40 * n3) | 0];
  const vmax = sorted[(0.97 * n3) | 0];
  const vrange = Math.max(1e-10, vmax - vmin);

  // Display every `step`-th grid point (~10³ cones for n=20)
  const step = Math.max(1, (n / 10) | 0);
  // sizeref so the largest cone is ~85% of the display grid spacing
  const sizeref = (2 * lim / ((n - 1) / step)) * 0.85;

  const xArr=[], yArr=[], zArr=[], uArr=[], vArr=[], wArr=[];

  for (let ix = 0; ix < n; ix += step) {
    for (let iy = 0; iy < n; iy += step) {
      for (let iz = 0; iz < n; iz += step) {
        const k = ix*n*n + iy*n + iz;
        const bx = bxR[k]*cos_t - bxI[k]*sin_t;
        const by = byR[k]*cos_t - byI[k]*sin_t;
        const bz = bzR[k]*cos_t - bzI[k]*sin_t;
        const mag = Math.sqrt(bx*bx + by*by + bz*bz);
        if (mag < 1e-30) continue;
        const scale = Math.max(0, (logAmp[k] - vmin) / vrange);
        if (scale < 0.04) continue;  // skip near-zero field regions
        xArr.push(coords[ix]); yArr.push(coords[iy]); zArr.push(coords[iz]);
        uArr.push(bx/mag * scale);
        vArr.push(by/mag * scale);
        wArr.push(bz/mag * scale);
      }
    }
  }

  Plotly.restyle(divId,
    { visible: [false, false] },
    [T3D_FL_SHAFT, T3D_FL_HEAD],
  );
  Plotly.restyle(divId,
    { x: [xArr], y: [yArr], z: [zArr], u: [uArr], v: [vArr], w: [wArr],
      sizeref: [sizeref], visible: [true] },
    [T3D_CONE],
  );
  Plotly.relayout(divId, {
    'scene.xaxis.range': [-lim, lim],
    'scene.yaxis.range': [-lim, lim],
    'scene.zaxis.range': [-lim, lim],
  });
}

export function set3DWires(divId, antennas) {
  const traceX = [], traceY = [], traceZ = [], traceColor = [];
  for (let slot = 0; slot < 4; slot++) {
    const ant = antennas[slot];
    if (ant) {
      const v = ant.vertices instanceof Float64Array ? ant.vertices : new Float64Array(ant.vertices);
      const off = ant.offset;
      const x = [], y = [], z = [];
      for (let k = 0; k < v.length / 3; k++) {
        x.push(v[k * 3]     + off[0]);
        y.push(v[k * 3 + 1] + off[1]);
        z.push(v[k * 3 + 2] + off[2]);
      }
      traceX.push(x); traceY.push(y); traceZ.push(z);
      traceColor.push(ANT_COLORS[slot % ANT_COLORS.length]);
    } else {
      traceX.push([]); traceY.push([]); traceZ.push([]);
      traceColor.push('transparent');
    }
  }
  Plotly.restyle(divId,
    { x: traceX, y: traceY, z: traceZ, 'line.color': traceColor },
    [T3D_WIRE0, T3D_WIRE0 + 1, T3D_WIRE0 + 2, T3D_WIRE0 + 3],
  );
}

// Trace true 3D streamlines through the full 3D vector field using RK4 + trilinear
// interpolation. Seeds are distributed on a Fibonacci sphere at 0.25*lim radius.
// nLines * 3 seeds are used to match the total line count of the three 2D planes.
export function set3DFieldLines(divId, heatmaps, timePhase, nLines) {
  const vol3d = heatmaps.vol3d;
  if (!vol3d || !vol3d.bxR) return;
  const { lim } = vol3d;
  const cos_t = Math.cos(timePhase), sin_t = Math.sin(timePhase);

  const seeds = fibonacciSeeds(nLines * 3, lim * 0.25);
  const lineX = [], lineY = [], lineZ = [];
  const coneX = [], coneY = [], coneZ = [];
  const coneU = [], coneV = [], coneW = [];

  for (const [x0, y0, z0] of seeds) {
    const pts = traceStreamline3D(vol3d, x0, y0, z0, cos_t, sin_t);
    if (pts.length < 2) continue;

    for (const [x, y, z] of pts) {
      lineX.push(x); lineY.push(y); lineZ.push(z);
    }
    lineX.push(null); lineY.push(null); lineZ.push(null);

    // Direction cones spaced along the line
    const ev = Math.max(5, (pts.length / 4) | 0);
    for (let i = ev; i < pts.length - 1; i += ev) {
      const dx = pts[i+1][0] - pts[i-1][0];
      const dy = pts[i+1][1] - pts[i-1][1];
      const dz = pts[i+1][2] - pts[i-1][2];
      const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (len < 1e-10) continue;
      coneX.push(pts[i][0]); coneY.push(pts[i][1]); coneZ.push(pts[i][2]);
      coneU.push(dx/len); coneV.push(dy/len); coneW.push(dz/len);
    }
  }

  Plotly.restyle(divId,
    { visible: [false, false, false, false] },
    [T3D_CONE, T3D_XY, T3D_XZ, T3D_YZ],
  );
  Plotly.restyle(divId,
    { x: [lineX], y: [lineY], z: [lineZ], visible: [true] },
    [T3D_FL_SHAFT],
  );
  Plotly.restyle(divId,
    { x: [coneX], y: [coneY], z: [coneZ], u: [coneU], v: [coneV], w: [coneW],
      visible: [coneX.length > 0] },
    [T3D_FL_HEAD],
  );
}

export function set3DTitle(divId, text) {
  Plotly.relayout(divId, { 'title.text': text });
}

export function clear3DPlot(divId) {
  Plotly.restyle(divId,
    { visible: [false, false, false, false, false, false] },
    [T3D_CONE, T3D_XY, T3D_XZ, T3D_YZ, T3D_FL_SHAFT, T3D_FL_HEAD],
  );
}
