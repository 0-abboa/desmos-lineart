// Pure image-processing helpers (no DOM), so they can be tested in Node.

// Box-blur a w*h Float32Array `passes` times (3x3 average, edge clamped).
function boxBlur(v, w, h, passes) {
  let src = v;
  for (let p = 0; p < passes; p++) {
    const dst = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = Math.min(w - 1, Math.max(0, i + di));
        const jj = Math.min(h - 1, Math.max(0, j + dj));
        s += src[jj * w + ii]; n++;
      }
      dst[j * w + i] = s / n;
    }
    src = dst;
  }
  return src;
}

// Marching-squares case -> segments. Corner bits: tl=1, tr=2, br=4, bl=8 (set = at/above level).
// Edge letters: T top, B bottom, L left, R right. Saddle cases (5, 10) use a fixed choice.
const MS_SEG = [
  [], ['TL'], ['TR'], ['LR'], ['BR'], ['TL', 'BR'], ['TB'], ['LB'],
  ['LB'], ['TB'], ['TR', 'LB'], ['BR'], ['LR'], ['TR'], ['TL'], []
];

// Iso-contour of grid g at level L.
// g = { w, h, v: Float32Array (row 0 = top), dx, dy }; world y goes up, so row j has y = (h-1-j)*dy.
// Returns polylines [{xs, ys}] with at least `minLen` points each.
function contourLines(g, L, minLen) {
  const { w, h, v, dx, dy } = g;
  const val = (i, j) => v[j * w + i];
  const pts = new Map();

  // Crossing point on grid edge: 'h' = (i,j)-(i+1,j), 'v' = (i,j)-(i,j+1)
  const P = (t, i, j) => {
    const k = t + i + ',' + j;
    if (pts.has(k)) return k;
    const i2 = t === 'h' ? i + 1 : i, j2 = t === 'h' ? j : j + 1;
    const ax = i * dx, ay = (h - 1 - j) * dy;
    const bx = i2 * dx, by = (h - 1 - j2) * dy;
    const va = val(i, j), vb = val(i2, j2);
    const s = va === vb ? 0.5 : (L - va) / (vb - va);
    pts.set(k, [ax + (bx - ax) * s, ay + (by - ay) * s]);
    return k;
  };

  const segs = [];
  const adj = new Map();
  const addAdj = (k, idx) => {
    let a = adj.get(k);
    if (!a) { a = []; adj.set(k, a); }
    a.push(idx);
  };

  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const c = (val(i, j) >= L ? 1 : 0) | (val(i + 1, j) >= L ? 2 : 0) |
              (val(i + 1, j + 1) >= L ? 4 : 0) | (val(i, j + 1) >= L ? 8 : 0);
    for (const pair of MS_SEG[c]) {
      const ks = [...pair].map(letter => {
        if (letter === 'T') return P('h', i, j);
        if (letter === 'B') return P('h', i, j + 1);
        if (letter === 'L') return P('v', i, j);
        return P('v', i + 1, j); // R
      });
      const idx = segs.length;
      segs.push(ks);
      addAdj(ks[0], idx);
      addAdj(ks[1], idx);
    }
  }

  // Stitch segments into polylines.
  const used = new Uint8Array(segs.length);
  const grow = (cur, arr) => {
    for (;;) {
      const list = adj.get(cur);
      let nx = -1;
      for (const k of list) if (!used[k]) { nx = k; break; }
      if (nx < 0) break;
      used[nx] = 1;
      const [p, q] = segs[nx];
      cur = p === cur ? q : p;
      arr.push(cur);
    }
  };

  const out = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const [a, b] = segs[s];
    const back = [b];
    grow(b, back);
    const front = [a];
    grow(a, front);
    const keys = front.reverse().concat(back);
    if (keys.length >= minLen) {
      out.push({
        xs: keys.map(k => pts.get(k)[0]),
        ys: keys.map(k => pts.get(k)[1])
      });
    }
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { boxBlur, contourLines };
