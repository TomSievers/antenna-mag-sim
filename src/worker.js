import { buildSources, mergeSources, computePlane } from './physics.js';

self.onmessage = function (e) {
  const { antennas, n, slices } = e.data;

  // Build per-antenna Biot-Savart sources
  const antSrcs = antennas.map(a => ({
    src:       buildSources(new Float64Array(a.vertices)),
    offset:    a.offset,
    phase:     a.phase,
    amplitude: a.amplitude,
  }));

  const merged = mergeSources(antSrcs);

  // Determine field extent from antenna geometry
  let maxAbs = 0;
  for (const a of antennas) {
    const v = new Float64Array(a.vertices);
    for (let i = 0; i < v.length / 3; i++)
      for (let k = 0; k < 3; k++)
        maxAbs = Math.max(maxAbs, Math.abs(v[i*3+k] + a.offset[k]));
  }
  const lim = Math.min(Math.max(maxAbs * 2.2, 2.0), 8.0);

  const planes = [
    { key: 'xy', ia: 0, ib: 1, ic: 2, c0: slices.z },
    { key: 'xz', ia: 0, ib: 2, ic: 1, c0: slices.y },
    { key: 'yz', ia: 1, ib: 2, ic: 0, c0: slices.x },
  ];

  const result = {};
  const transfers = [];

  for (const { key, ia, ib, ic, c0 } of planes) {
    self.postMessage({ type: 'progress', msg: `Computing ${key.toUpperCase()} plane…` });

    const plane = computePlane(
      n, lim, ia, ib, ic, c0,
      merged.pos, merged.dlR, merged.dlI, merged.n,
      frac => self.postMessage({
        type: 'progress',
        msg: `${key.toUpperCase()}: ${Math.round(frac * 100)}%`,
      }),
    );

    result[key] = { ...plane, lim };
    transfers.push(
      plane.amp.buffer, plane.daR.buffer, plane.daI.buffer,
      plane.dbR.buffer, plane.dbI.buffer,
    );
  }

  self.postMessage({ type: 'done', result }, transfers);
};
