// Centerline line art: threshold edges, thin them to a 1px skeleton, walk the
// skeleton into strokes, then smooth into curves.
// Boundary tracing (what earlier versions did) yields doubled, blobby, jagged
// lines; a medial-axis skeleton yields single pen-like strokes.

function sk2Clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function sk2BoxBlur(src, w, h, r) {
  if (!r || r < 1) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;
  const at = (x, y) => src[sk2Clamp(y, 0, h - 1) * w + sk2Clamp(x, 0, w - 1)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dx = -r; dx <= r; dx++) s += at(x + dx, y);
      tmp[y * w + x] = s / win;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -r; dy <= r; dy++) s += tmp[sk2Clamp(y + dy, 0, h - 1) * w + x];
      out[y * w + x] = s / win;
    }
  }
  return out;
}

function sk2Gauss(v, w, h, sigma) {
  if (sigma <= 0) return v;
  const r = Math.max(1, Math.round(sigma * 0.75));
  let s = v;
  for (let k = 0; k < 3; k++) s = sk2BoxBlur(s, w, h, r);
  return s;
}

// Zhang-Suen thinning: reduce the ink mask to single-pixel centerlines.
function thin(bin, w, h) {
  const img = Uint8Array.from(bin);
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : img[y * w + x];
  let changed = true;
  let guard = 0;

  while (changed && guard++ < 60) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      const del = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!img[y * w + x]) continue;
          const p2 = get(x, y - 1), p3 = get(x + 1, y - 1), p4 = get(x + 1, y);
          const p5 = get(x + 1, y + 1), p6 = get(x, y + 1), p7 = get(x - 1, y + 1);
          const p8 = get(x - 1, y), p9 = get(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let i = 0; i < 8; i++) if (seq[i] === 0 && seq[i + 1] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          del.push(y * w + x);
        }
      }
      if (del.length) { changed = true; for (const d of del) img[d] = 0; }
    }
  }
  return img;
}

// Walk skeleton pixels into polylines.
function traceSkeleton(sk, w, h, minPts) {
  const visited = new Uint8Array(w * h);
  const nbrs = (x, y) => {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        if (sk[ny * w + nx]) out.push([nx, ny]);
      }
    }
    return out;
  };

  const endpoints = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!sk[y * w + x]) continue;
      if (nbrs(x, y).length === 1) endpoints.push([x, y]);
    }
  }

  const lines = [];
  const walk = (sx, sy) => {
    const pts = [[sx, sy]];
    visited[sy * w + sx] = 1;
    let cx = sx, cy = sy;
    for (;;) {
      let next = null;
      for (const [nx, ny] of nbrs(cx, cy)) {
        if (!visited[ny * w + nx]) { next = [nx, ny]; break; }
      }
      if (!next) break;
      visited[next[1] * w + next[0]] = 1;
      pts.push(next);
      cx = next[0]; cy = next[1];
    }
    return pts;
  };

  // start at endpoints so strokes have natural ends
  for (const [x, y] of endpoints) {
    if (visited[y * w + x]) continue;
    const pts = walk(x, y);
    if (pts.length >= minPts) lines.push(pts);
  }
  // then any remaining loops
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!sk[y * w + x] || visited[y * w + x]) continue;
      const pts = walk(x, y);
      if (pts.length >= minPts) lines.push(pts);
    }
  }
  return lines;
}

function sk2Rdp(points, eps) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bestD = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD > eps) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function sk2Chaikin(points, iters) {
  let p = points;
  for (let k = 0; k < iters; k++) {
    if (p.length < 3) break;
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[i + 1];
      q.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      q.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

// Build centerline strokes from a darkness grid.
function buildCenterline(grid, o) {
  const opts = Object.assign({
    sigmas: [1.2, 3.0],
    k: 1.8,
    ink: 0.25,        // DoG response above this counts as ink
    minPts: 8,
    minSpan: 12,
    eps: 0.65,
    smoothIters: 2
  }, o || {});

  const { w, h } = grid;
  const v = grid.v;

  const mask = new Uint8Array(w * h);
  for (const sigma of opts.sigmas) {
    const s1 = sk2Gauss(v, w, h, sigma);
    const s2 = sk2Gauss(v, w, h, sigma * opts.k);
    const dog = new Float32Array(w * h);
    let sumAbs = 0;
    for (let i = 0; i < w * h; i++) { dog[i] = s1[i] - s2[i]; sumAbs += Math.abs(dog[i]); }
    const meanAbs = sumAbs / (w * h) || 1e-9;
    for (let i = 0; i < w * h; i++) {
      if (dog[i] / meanAbs > opts.ink) mask[i] = 1;
    }
  }

  const sk = thin(mask, w, h);
  const raw = traceSkeleton(sk, w, h, opts.minPts);

  const lines = [];
  let total = 0;
  for (const pts of raw) {
    const flipped = pts.map(p => [p[0], (h - 1) - p[1]]);
    const simp = sk2Rdp(flipped, opts.eps);
    if (simp.length < 2) continue;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const [px, py] of simp) {
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    if (Math.hypot(maxX - minX, maxY - minY) < opts.minSpan) continue;
    lines.push(opts.smoothIters ? sk2Chaikin(simp, opts.smoothIters) : simp);
    total += simp.length;
  }

  return { lines, count: lines.length, points: total, gridW: w, gridH: h };
}

if (typeof module !== 'undefined') {
  module.exports = { buildCenterline, thin, traceSkeleton, sk2Rdp, sk2Chaikin };
}
