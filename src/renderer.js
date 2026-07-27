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
