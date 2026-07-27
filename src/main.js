import { PRESET_NAMES, PRESETS, parseShapeFile } from './shapes.js';
import { initPlot, setHeatmap, setArrows, setFieldLines, setWires, clearPlot, setTitle,
         init3DPlot, set3DCones, set3DWires, set3DFieldLines, set3DTitle, clear3DPlot } from './renderer.js';

const N_GRID     = 45;
const ANT_COLORS = ['#22d3ee', '#f87171', '#4ade80', '#fbbf24'];

// ── Plane definitions ─────────────────────────────────────────────────────────
const PLANES = [
  { key: 'xy', divId: 'plot-xy', ia: 0, ib: 1, xL: 'X (m)', yL: 'Y (m)', title: 'XY  z = 0.00 m', fixed: 'z' },
  { key: 'xz', divId: 'plot-xz', ia: 0, ib: 2, xL: 'X (m)', yL: 'Z (m)', title: 'XZ  y = 0.00 m', fixed: 'y' },
  { key: 'yz', divId: 'plot-yz', ia: 1, ib: 2, xL: 'Y (m)', yL: 'Z (m)', title: 'YZ  x = 0.00 m', fixed: 'x' },
];

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  antennas: [{
    shapeName: 'Circular Loop',
    vertices:  Array.from(PRESETS['Circular Loop']()),
    offset:    [0, 0, 0],
    phase:     0,
    amplitude: 1.0,
    idx:       0,
  }],
  selected:  0,
  heatmaps:  null,
  slices:    { z: 0, y: 0, x: 0 },
  timePhase: 0,
  animPlay:  false,
  animJob:   null,
  animSpeed: 6,
  vizMode:   'heatmap',   // 'heatmap' | 'fieldlines'
  nLines:    6,
};

const cfg  = () => state.antennas[state.selected];
const setStatus = msg => { document.getElementById('status').textContent = msg; };

// ── Init Plotly plots ─────────────────────────────────────────────────────────
for (const p of PLANES) initPlot(p.divId, p.xL, p.yL, p.title);
init3DPlot('plot-3d');

// ── Tabs ──────────────────────────────────────────────────────────────────────
function refreshTabs() {
  const c = document.getElementById('ant-tabs');
  c.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const ant = state.antennas[i];
    const b   = document.createElement('button');
    b.className = 'tab-btn' + (i === state.selected ? ' active' : '');
    b.disabled  = !ant;
    b.style.color = ant ? ANT_COLORS[i] : '';
    b.textContent = ant ? `A${i + 1}\n${(ant.phase * 180 / Math.PI).toFixed(0)}°` : `A${i + 1}\n—`;
    if (ant) b.onclick = () => selectAnt(i);
    c.appendChild(b);
  }
  document.getElementById('btn-shape').textContent = `${cfg().shapeName} ▶`;
}

function pushSliders() {
  const a = cfg();
  sl('phase', a.phase * 180 / Math.PI);
  sl('x', a.offset[0]); sl('y', a.offset[1]); sl('z', a.offset[2]);
  sl('amp', a.amplitude);
}

function sl(id, val) {
  document.getElementById('sl-' + id).value = val;
  setVal(id, val);
}

function setVal(id, raw) {
  const el = document.getElementById('val-' + id);
  if (!el) return;
  const v = +raw;
  el.textContent = (id === 'phase' || id === 'time' || id === 'speed' || id === 'nlines')
    ? v.toFixed(0) : v.toFixed(2);
}

function updateTitles() {
  for (const p of PLANES)
    setTitle(p.divId, `${p.key.toUpperCase()}  ${p.fixed} = ${state.slices[p.fixed].toFixed(2)} m`);
}

// ── Visualization mode ────────────────────────────────────────────────────────
function redrawTime() {
  if (!state.heatmaps) return;
  for (const p of PLANES) {
    if (state.vizMode === 'heatmap') {
      setArrows(p.divId, state.heatmaps[p.key], state.timePhase);
    } else {
      setFieldLines(p.divId, state.heatmaps[p.key], state.timePhase, state.nLines);
    }
  }
  // 3D: both cones and streamlines are time-variant
  if (state.vizMode === 'heatmap') {
    set3DCones('plot-3d', state.heatmaps.vol3d, state.timePhase);
  } else {
    set3DFieldLines('plot-3d', state.heatmaps, state.timePhase, state.nLines);
  }
}

function redrawViz() {
  if (!state.heatmaps) return;
  for (const p of PLANES) {
    if (state.vizMode === 'heatmap') {
      setHeatmap(p.divId, state.heatmaps[p.key]);
      setArrows(p.divId, state.heatmaps[p.key], state.timePhase);
    } else {
      setFieldLines(p.divId, state.heatmaps[p.key], state.timePhase, state.nLines);
    }
  }
  if (state.vizMode === 'heatmap') {
    set3DCones('plot-3d', state.heatmaps.vol3d, state.timePhase);
  } else {
    set3DFieldLines('plot-3d', state.heatmaps, state.timePhase, state.nLines);
  }
}

function setMode(mode) {
  state.vizMode = mode;
  document.getElementById('btn-mode-heat').className =
    'btn grow' + (mode === 'heatmap' ? ' primary' : ' secondary');
  document.getElementById('btn-mode-lines').className =
    'btn grow' + (mode === 'fieldlines' ? ' primary' : ' secondary');
  document.getElementById('fieldlines-opts').style.display =
    mode === 'fieldlines' ? '' : 'none';
  set3DTitle('plot-3d', mode === 'heatmap' ? '3D  B field' : '3D  field lines');
  redrawViz();
}

// ── Wires ─────────────────────────────────────────────────────────────────────
function redrawWires() {
  for (const p of PLANES) setWires(p.divId, state.antennas, p.ia, p.ib);
  set3DWires('plot-3d', state.antennas);
}

// ── Worker / compute ──────────────────────────────────────────────────────────
let worker = null;

function compute() {
  stopAnim();
  state.heatmaps = null;
  for (const p of PLANES) clearPlot(p.divId);
  clear3DPlot('plot-3d');
  setStatus('Computing…');

  if (worker) worker.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = ({ data: msg }) => {
    if (msg.type === 'progress') {
      setStatus(msg.msg);
    } else if (msg.type === 'done') {
      for (const k of ['xy', 'xz', 'yz']) msg.result[k].n = N_GRID;
      state.heatmaps = msg.result;
      redrawViz();
      redrawWires();
      setStatus(`Done · ${N_GRID}×${N_GRID} · ${state.antennas.length} antenna(s)`);
      worker = null;
    }
  };

  worker.postMessage({
    antennas: state.antennas.map(a => ({
      vertices:  Array.from(a.vertices instanceof Float64Array ? a.vertices : new Float64Array(a.vertices)),
      offset:    a.offset,
      phase:     a.phase,
      amplitude: a.amplitude,
    })),
    n:      N_GRID,
    slices: state.slices,
  });
}

// ── Antenna management ────────────────────────────────────────────────────────
function selectAnt(idx) {
  state.selected = idx;
  refreshTabs();
  pushSliders();
}

function addAnt() {
  if (state.antennas.length >= 4) { setStatus('Max 4 antennas'); return; }
  const n    = state.antennas.length;
  const vArr = PRESETS['Circular Loop']();
  let maxX = 0;
  for (let i = 0; i < vArr.length / 3; i++) maxX = Math.max(maxX, Math.abs(vArr[i * 3]));
  state.antennas.push({
    shapeName: 'Circular Loop',
    vertices:  Array.from(vArr),
    offset:    [state.antennas[n - 1].offset[0] + Math.max(maxX * 2.5, 2.0), 0, 0],
    phase:     n * Math.PI / 2,
    amplitude: 1.0,
    idx:       n,
  });
  state.selected = n;
  state.heatmaps = null;
  for (const p of PLANES) clearPlot(p.divId);
  clear3DPlot('plot-3d');
  refreshTabs(); pushSliders(); redrawWires();
  setStatus(`Added A${n + 1}`);
}

function removeAnt() {
  if (state.antennas.length <= 1) { setStatus('Need at least 1 antenna'); return; }
  state.antennas.splice(state.selected, 1);
  state.antennas.forEach((a, i) => (a.idx = i));
  state.selected = Math.min(state.selected, state.antennas.length - 1);
  state.heatmaps = null;
  for (const p of PLANES) clearPlot(p.divId);
  clear3DPlot('plot-3d');
  refreshTabs(); pushSliders(); redrawWires();
  setStatus(`${state.antennas.length} antenna(s)`);
}

// ── Animation ─────────────────────────────────────────────────────────────────
function stopAnim() {
  state.animPlay = false;
  if (state.animJob) { cancelAnimationFrame(state.animJob); state.animJob = null; }
  document.getElementById('btn-play').textContent = '▶ Play';
}

function animStep() {
  if (!state.animPlay) return;
  state.timePhase = (state.timePhase + state.animSpeed * Math.PI / 180) % (2 * Math.PI);
  const deg = Math.round(state.timePhase * 180 / Math.PI);
  document.getElementById('sl-time').value = deg;
  setVal('time', deg);
  if (state.heatmaps) redrawTime();
  state.animJob = requestAnimationFrame(animStep);
}

// ── Slider wiring ─────────────────────────────────────────────────────────────
function wire(id, fn) {
  const el = document.getElementById('sl-' + id);
  el.addEventListener('input', () => { setVal(id, el.value); fn(+el.value); });
}

wire('phase', v => { cfg().phase = v * Math.PI / 180; state.heatmaps = null; refreshTabs(); });
wire('x',     v => { cfg().offset[0] = v; state.heatmaps = null; redrawWires(); });
wire('y',     v => { cfg().offset[1] = v; state.heatmaps = null; redrawWires(); });
wire('z',     v => { cfg().offset[2] = v; state.heatmaps = null; redrawWires(); });
wire('amp',   v => { cfg().amplitude = v; state.heatmaps = null; });

wire('sz', v => { state.slices.z = v; updateTitles(); });
wire('sy', v => { state.slices.y = v; updateTitles(); });
wire('sx', v => { state.slices.x = v; updateTitles(); });

wire('time',  v => { state.timePhase = v * Math.PI / 180; redrawTime(); });
wire('speed',  v => { state.animSpeed = v; });
wire('nlines', v => { state.nLines = Math.round(v); if (state.vizMode === 'fieldlines') redrawTime(); });

// ── Button wiring ─────────────────────────────────────────────────────────────
document.getElementById('btn-mode-heat').onclick  = () => setMode('heatmap');
document.getElementById('btn-mode-lines').onclick = () => setMode('fieldlines');
document.getElementById('btn-compute').onclick = compute;

document.getElementById('btn-clear').onclick = () => {
  stopAnim();
  state.heatmaps = null;
  for (const p of PLANES) clearPlot(p.divId);
  clear3DPlot('plot-3d');
  setStatus('Cleared');
};

document.getElementById('btn-add').onclick = addAnt;
document.getElementById('btn-rem').onclick = removeAnt;

document.getElementById('btn-play').onclick = () => {
  if (state.animPlay) {
    stopAnim();
  } else {
    if (!state.heatmaps) { setStatus('Compute field first'); return; }
    state.animPlay = true;
    document.getElementById('btn-play').textContent = '■ Stop';
    animStep();
  }
};

document.getElementById('btn-shape').onclick = () => {
  const names = PRESET_NAMES;
  const nxt   = names[(names.indexOf(cfg().shapeName) + 1) % names.length] ?? names[0];
  cfg().shapeName = nxt;
  cfg().vertices  = Array.from(PRESETS[nxt]());
  state.heatmaps  = null;
  for (const p of PLANES) clearPlot(p.divId);
  clear3DPlot('plot-3d');
  refreshTabs(); redrawWires();
  setStatus(`A${state.selected + 1}: ${nxt}`);
};

document.getElementById('file-input').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text  = await file.text();
    const verts = parseShapeFile(text);
    cfg().shapeName = file.name;
    cfg().vertices  = Array.from(verts);
    cfg().offset    = [0, 0, 0];
    state.heatmaps  = null;
    for (const p of PLANES) clearPlot(p.divId);
    clear3DPlot('plot-3d');
    refreshTabs(); pushSliders(); redrawWires();
    setStatus(`Loaded: ${file.name}`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
  e.target.value = '';
};

document.getElementById('btn-save').onclick = () => {
  const divs = [...PLANES.map(p => document.getElementById(p.divId)), document.getElementById('plot-3d')];
  const srcs = divs.map(d => d?.querySelector('canvas'));
  if (!srcs[0]) { setStatus('Nothing to save'); return; }
  const W = 1600, H = 1000;
  const hw = W / 2, hh = H / 2;
  const out = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, W, H);
  if (srcs[0]) ctx.drawImage(srcs[0], 0,  0,  hw, hh);   // XY  top-left
  if (srcs[3]) ctx.drawImage(srcs[3], hw, 0,  hw, hh);   // 3D  top-right
  if (srcs[1]) ctx.drawImage(srcs[1], 0,  hh, hw, hh);   // XZ  bottom-left
  if (srcs[2]) ctx.drawImage(srcs[2], hw, hh, hw, hh);   // YZ  bottom-right
  const a = Object.assign(document.createElement('a'), {
    download: `field_${state.antennas.length}ant.png`,
    href:     out.toDataURL(),
  });
  a.click();
  setStatus('Saved PNG');
};

// ── Init ──────────────────────────────────────────────────────────────────────
refreshTabs();
pushSliders();
redrawWires();
