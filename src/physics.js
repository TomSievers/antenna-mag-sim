const MU0_4PI = 1e-7;   // μ₀ / 4π
const N_SUB   = 6;      // segment subdivisions (matches Python default)

export function buildSources(vertices) {
  const nVerts = vertices.length / 3;
  const nSegs  = nVerts - 1;
  const nSrc   = nSegs * N_SUB;
  const pos    = new Float64Array(nSrc * 3);
  const dl     = new Float64Array(nSrc * 3);
  let idx = 0;
  for (let i = 0; i < nSegs; i++) {
    const x1 = vertices[i*3],   y1 = vertices[i*3+1], z1 = vertices[i*3+2];
    const x2 = vertices[i*3+3], y2 = vertices[i*3+4], z2 = vertices[i*3+5];
    const dxs = (x2-x1)/N_SUB, dys = (y2-y1)/N_SUB, dzs = (z2-z1)/N_SUB;
    for (let j = 0; j < N_SUB; j++, idx++) {
      const t = (j + 0.5) / N_SUB;
      pos[idx*3]   = x1 + t*(x2-x1);
      pos[idx*3+1] = y1 + t*(y2-y1);
      pos[idx*3+2] = z1 + t*(z2-z1);
      dl[idx*3]    = dxs; dl[idx*3+1] = dys; dl[idx*3+2] = dzs;
    }
  }
  return { pos, dl, n: nSrc };
}

// Merge all antenna sources into flat arrays.
// dlR/dlI are real/imag parts of the complex weighted dl.
export function mergeSources(antennas) {
  let total = 0;
  for (const a of antennas) total += a.src.n;
  const pos = new Float64Array(total * 3);
  const dlR = new Float64Array(total * 3);
  const dlI = new Float64Array(total * 3);
  let off = 0;
  for (const { src, offset, phase, amplitude } of antennas) {
    const cosP = amplitude * Math.cos(phase);
    const sinP = amplitude * Math.sin(phase);
    for (let i = 0; i < src.n; i++) {
      const k = (off + i) * 3;
      pos[k]   = src.pos[i*3]   + offset[0];
      pos[k+1] = src.pos[i*3+1] + offset[1];
      pos[k+2] = src.pos[i*3+2] + offset[2];
      dlR[k]   = src.dl[i*3]   * cosP;
      dlR[k+1] = src.dl[i*3+1] * cosP;
      dlR[k+2] = src.dl[i*3+2] * cosP;
      dlI[k]   = src.dl[i*3]   * sinP;
      dlI[k+1] = src.dl[i*3+1] * sinP;
      dlI[k+2] = src.dl[i*3+2] * sinP;
    }
    off += src.n;
  }
  return { pos, dlR, dlI, n: total };
}

// Compute heatmap for one orthogonal plane.
// ia/ib = axes shown in the plane (0=X 1=Y 2=Z), ic = fixed axis, c0 = fixed value.
// Returns { amp, daR, daI, dbR, dbI } each Float64Array[n*n].
export function computePlane(n, lim, ia, ib, ic, c0, pos, dlR, dlI, nSrc, onProgress) {
  const amp = new Float64Array(n * n);
  const daR = new Float64Array(n * n);
  const daI = new Float64Array(n * n);
  const dbR = new Float64Array(n * n);
  const dbI = new Float64Array(n * n);

  const pt = [0, 0, 0];
  pt[ic] = c0;

  for (let i = 0; i < n; i++) {
    pt[ia] = -lim + (2 * lim * i) / (n - 1);
    for (let j = 0; j < n; j++) {
      pt[ib] = -lim + (2 * lim * j) / (n - 1);
      const px = pt[0], py = pt[1], pz = pt[2];

      let brx=0, bry=0, brz=0, bix=0, biy=0, biz=0;
      for (let s = 0; s < nSrc; s++) {
        const rx = px - pos[s*3];
        const ry = py - pos[s*3+1];
        const rz = pz - pos[s*3+2];
        const rm2 = rx*rx + ry*ry + rz*rz;
        if (rm2 < 1e-20) continue;
        const rm3 = rm2 * Math.sqrt(rm2);

        const dlrx = dlR[s*3+1]*rz - dlR[s*3+2]*ry;
        const dlry = dlR[s*3+2]*rx - dlR[s*3]*rz;
        const dlrz = dlR[s*3]*ry   - dlR[s*3+1]*rx;
        const dlix = dlI[s*3+1]*rz - dlI[s*3+2]*ry;
        const dliy = dlI[s*3+2]*rx - dlI[s*3]*rz;
        const dliz = dlI[s*3]*ry   - dlI[s*3+1]*rx;

        brx += dlrx/rm3; bry += dlry/rm3; brz += dlrz/rm3;
        bix += dlix/rm3; biy += dliy/rm3; biz += dliz/rm3;
      }

      brx *= MU0_4PI; bry *= MU0_4PI; brz *= MU0_4PI;
      bix *= MU0_4PI; biy *= MU0_4PI; biz *= MU0_4PI;

      // Peak amplitude: sqrt(|B_real|² + |B_imag|²)
      amp[i*n+j] = Math.sqrt(brx*brx+bry*bry+brz*brz + bix*bix+biy*biy+biz*biz);

      // Store complex phasor components for the two in-plane axes
      const Br = [brx, bry, brz], Bi = [bix, biy, biz];
      daR[i*n+j] = Br[ia]; daI[i*n+j] = Bi[ia];
      dbR[i*n+j] = Br[ib]; dbI[i*n+j] = Bi[ib];
    }
    if (onProgress && (i % 4 === 0)) onProgress((i + 1) / n);
  }
  if (onProgress) onProgress(1);
  return { amp, daR, daI, dbR, dbI };
}

// Compute the full complex B-field phasor on a 3D grid.
// Returns { amp, bxR, bxI, byR, byI, bzR, bzI } each Float64Array[n³],
// indexed as arr[ix*n²+iy*n+iz].  Instantaneous field at time t:
//   B(t) = bR*cos(t) − bI*sin(t)
export function computeVolume(n, lim, pos, dlR, dlI, nSrc, onProgress) {
  const n3 = n * n * n;
  const amp = new Float64Array(n3);
  const bxR = new Float64Array(n3), bxI = new Float64Array(n3);
  const byR = new Float64Array(n3), byI = new Float64Array(n3);
  const bzR = new Float64Array(n3), bzI = new Float64Array(n3);

  for (let ix = 0; ix < n; ix++) {
    const px = -lim + 2 * lim * ix / (n - 1);
    for (let iy = 0; iy < n; iy++) {
      const py = -lim + 2 * lim * iy / (n - 1);
      for (let iz = 0; iz < n; iz++) {
        const pz = -lim + 2 * lim * iz / (n - 1);
        let brx=0, bry=0, brz=0, bix=0, biy=0, biz=0;
        for (let s = 0; s < nSrc; s++) {
          const rx = px - pos[s*3];
          const ry = py - pos[s*3+1];
          const rz = pz - pos[s*3+2];
          const rm2 = rx*rx + ry*ry + rz*rz;
          if (rm2 < 1e-20) continue;
          const rm3 = rm2 * Math.sqrt(rm2);
          brx += (dlR[s*3+1]*rz - dlR[s*3+2]*ry) / rm3;
          bry += (dlR[s*3+2]*rx - dlR[s*3]   *rz) / rm3;
          brz += (dlR[s*3]   *ry - dlR[s*3+1]*rx) / rm3;
          bix += (dlI[s*3+1]*rz - dlI[s*3+2]*ry) / rm3;
          biy += (dlI[s*3+2]*rx - dlI[s*3]   *rz) / rm3;
          biz += (dlI[s*3]   *ry - dlI[s*3+1]*rx) / rm3;
        }
        const k = ix*n*n + iy*n + iz;
        bxR[k] = brx * MU0_4PI;  byR[k] = bry * MU0_4PI;  bzR[k] = brz * MU0_4PI;
        bxI[k] = bix * MU0_4PI;  byI[k] = biy * MU0_4PI;  bzI[k] = biz * MU0_4PI;
        amp[k] = Math.sqrt(brx*brx + bry*bry + brz*brz + bix*bix + biy*biy + biz*biz) * MU0_4PI;
      }
    }
    if (onProgress && ix % 4 === 0) onProgress((ix + 1) / n);
  }
  if (onProgress) onProgress(1);
  return { amp, bxR, bxI, byR, byI, bzR, bzI };
}
