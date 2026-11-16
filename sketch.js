// Sketch: trace the image's edges as continuous curves.
// Difference-of-Gaussians zero crossings give thin single-pixel edge curves
// (not brightness bands), which are then simplified so they can be drawn as
// quadratic Bezier strokes instead of straight-line segments.
// Needs contourLines() from contour.js in the browser (require in Node).

function skClamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function skBoxBlur(src, w, h, r) {
  if (!r || r < 1) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;
  const at = (x, y) => src[skClamp(y, 0, h - 1) * w + skClamp(x, 0, w - 1)];
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
      for (let dy = -r; dy <= r; dy++) s += tmp[skClamp(y + dy, 0, h - 1) * w + x];
      out[y * w + x] = s / win;
    }
  }
  return out;
}

// Approximate Gaussian with repeated box blurs.
function skGauss(v, w, h, sigma) {
  if (sigma <= 0) return v;
  const r = Math.max(1, Math.round(sigma));
  let s = v;
  for (let k = 0; k < 3; k++) s = skBoxBlur(s, w, h, r);
  return s;
}

function skSobel(v, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  const at = (x, y) => v[skClamp(y, 0, h - 1) * w + skClamp(x, 0, w - 1)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      gx[y * w + x] = (tr + 2 * r + br) - (tl + 2 * l + bl);
      gy[y * w + x] = (bl + 2 * b + br) - (tl + 2 * t + tr);
    }
  }
  return { gx, gy };
}

// Ramer-Douglas-Peucker: drop points that a curve does not need.
function rdp(points, eps) {
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
    if (best >= 0 && bestD > eps) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// Chaikin corner cutting: turns pixel-staircase polylines into smooth curves.
function chaikin(points, iters) {
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

// Build edge curves from a darkness grid.
// opts.sigma  blur scale (detail), opts.k  DoG ratio, opts.gate  min edge strength
function buildSketch(grid, o) {
  const opts = Object.assign({
    sigmas: [1.2, 3.0],        // fine detail + larger structure, so faces are not left blank
    k: 1.8,
    gate: 0.02,
    minLen: 14,                // short fragments are noise, not drawn features
    minSpan: 10,               // pixels; rejects specks even if they have many points
    eps: 0.6,
    smoothIters: 2
  }, o || {});

  const { w, h } = grid;
  const v = grid.v;
  const lines = [];
  let total = 0;
  let droppedLen = 0, droppedGate = 0, rawCount = 0;

  for (const sigma of opts.sigmas) {
    const s1 = skGauss(v, w, h, sigma);
    const s2 = skGauss(v, w, h, sigma * opts.k);

    const dog = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) dog[i] = s1[i] - s2[i];

    // Normalise: DoG amplitudes are tiny, so an absolute gate would reject every edge.
    let sumAbs = 0;
    for (let i = 0; i < w * h; i++) sumAbs += Math.abs(dog[i]);
    const meanAbs = sumAbs / (w * h) || 1e-9;
    for (let i = 0; i < w * h; i++) dog[i] /= meanAbs;

    const { gx, gy } = skSobel(dog, w, h);
    const mag = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) mag[i] = Math.hypot(gx[i], gy[i]);

    const g = { w, h, v: dog, dx: 1, dy: 1 };
    const raw = contourLines(g, 0, 3);
    rawCount += raw.length;

    for (const line of raw) {
      const n = line.xs.length;
      if (n < opts.minLen) { droppedLen++; continue; }

      let sum = 0;
      for (let k = 0; k < n; k++) {
        const ix = skClamp(Math.round(line.xs[k]), 0, w - 1);
        const iy = skClamp(Math.round(line.ys[k]), 0, h - 1);
        sum += mag[iy * w + ix];
      }
      if (sum / n < opts.gate) { droppedGate++; continue; }

      const pts = [];
      for (let k = 0; k < n; k++) pts.push([line.xs[k], (h - 1) - line.ys[k]]);

      const simp = rdp(pts, opts.eps);
      if (simp.length < 2) continue;
      // reject specks: a curve has to actually span some distance
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const [px, py] of simp) {
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      if (Math.hypot(maxX - minX, maxY - minY) < opts.minSpan) continue;
      // smooth away the pixel staircase so strokes read as drawn curves
      lines.push(opts.smoothIters ? chaikin(simp, opts.smoothIters) : simp);
      total += simp.length;
    }
  }

  return {
    lines, count: lines.length, points: total, gridW: w, gridH: h,
    debug: { rawCount, droppedLen, droppedGate }
  };
}

if (typeof module !== 'undefined') {
  const { contourLines } = require('./contour.js');
  module.exports = { buildSketch, rdp, chaikin, skGauss, skSobel, contourLines };
}
