// Line-art engraving: straight parallel hatch lines whose density carries tone.
// Tone is rendered by ordered dithering across line indices, so darkness reads as
// spacing between deliberate, parallel strokes instead of free-form scribble.
// Pure functions - runs in the browser and in Node.

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function boxBlurRadius(src, w, h, r) {
  if (!r || r < 1) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;
  const at = (x, y) => src[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
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
      for (let dy = -r; dy <= r; dy++) s += tmp[clamp(y + dy, 0, h - 1) * w + x];
      out[y * w + x] = s / win;
    }
  }
  return out;
}

function sobel(v, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  const at = (x, y) => v[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
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

// Tone map: darkness 0 (paper) .. 1 (ink), smoothed, with a floor so bright
// areas stay empty instead of attracting stray hatching.
function toneMap(v, w, h, o) {
  const smooth = boxBlurRadius(v, w, h, o.preBlur);
  const { gx, gy } = sobel(smooth, w, h);
  const mag = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) mag[i] = Math.hypot(gx[i], gy[i]);
  const tone = new Float32Array(w * h);
  const floor = o.thr || 0;
  const span = Math.max(1e-6, 1 - floor);
  for (let i = 0; i < w * h; i++) {
    const t = clamp((smooth[i] - floor) / span, 0, 1);
    tone[i] = Math.min(Math.pow(t, o.toneGamma), o.toneCap);
  }
  return { w, h, smooth, tone, mag };
}

const GOLDEN = 0.6180339887498949;

// Bilinear sample: nearest-pixel sampling makes hatch edges staircase and jumpy.
function sampleArr(arr, w, h, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : arr[yy * w + xx];
  const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

// One layer of parallel hatch lines at `angle`.
// A line with index i is inked where local tone exceeds a per-line threshold,
// so the fraction of lines present at a pixel equals that pixel's tone.
function hatchLayer(f, o, angle, minTone, spacing, phase, strokes) {
  const { w, h, tone } = f;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const nx = -sa, ny = ca;
  const diag = Math.hypot(w, h);
  const stepPx = o.step;
  const span = 1 - minTone;

  let idx = 0;
  for (let off = -diag; off <= diag; off += spacing, idx++) {
    const T = (idx * GOLDEN + phase) % 1;
    const cx = w / 2 + off * nx, cy = h / 2 + off * ny;
    let run = null;
    let runTone = 0;

    const flush = () => {
      // drop confetti: keep only runs long enough to read as a deliberate stroke
      if (run && run.length >= 3 && run.length * stepPx >= 9) {
        strokes.push({
          xs: run.map(p => p[0]),
          ys: run.map(p => p[1]),
          width: o.widthBase * (0.8 + 0.5 * clamp(runTone, 0, 1))
        });
      }
      run = null;
    };

    for (let t = -diag; t <= diag; t += stepPx) {
      const x = cx + t * ca, y = cy + t * sa;
      let ink = false;
      let d = 0;
      if (x >= 0 && y >= 0 && x < w && y < h) {
        d = sampleArr(tone, w, h, x, y);
        const norm = span > 1e-6 ? (d - minTone) / span : (d >= minTone ? 1 : 0);
        ink = norm > T;
      }
      if (ink) {
        if (!run) { run = [[x, y]]; runTone = d; }
        else run.push([x, y]);
      } else if (run) {
        flush();
      }
    }
    flush();
  }
}

// Continuous contours traced along strong edges. Stamping a separate short mark at
// every sample produced scribble; walking the ridge produces the one clean line that
// makes a face readable.
function edgeStrokes(f, o, strokes) {
  const { w, h, mag, smooth } = f;
  const visited = new Uint8Array(w * h);
  const thr = o.edgeMag;
  const step = 1.3;

  const tangentAt = (ix, iy) => {
    const i = iy * w + ix;
    const gx1 = smooth[i + 1] - smooth[i - 1];
    const gy1 = smooth[i + w] - smooth[i - w];
    const gm = Math.hypot(gx1, gy1) || 1;
    return [-gy1 / gm, gx1 / gm];          // along the edge
  };

  const walk = (sx, sy, dirSign) => {
    const pts = [];
    let x = sx, y = sy, dx = 0, dy = 0, started = false;
    for (let k = 0; k < o.edgeSteps; k++) {
      const ix = Math.round(x), iy = Math.round(y);
      if (ix < 1 || iy < 1 || ix >= w - 1 || iy >= h - 1) break;
      const j = iy * w + ix;
      if (mag[j] < thr * 0.65) break;
      if (visited[j] && k > 0) break;
      visited[j] = 1;

      let [tx, ty] = tangentAt(ix, iy);
      if (!started) { if (dirSign < 0) { tx = -tx; ty = -ty; } }
      else if (tx * dx + ty * dy < 0) { tx = -tx; ty = -ty; }
      dx = tx; dy = ty; started = true;

      pts.push([x, y]);
      x += tx * step;
      y += ty * step;
    }
    return pts;
  };

  for (let gy = 2; gy < h - 2; gy += 2) {
    for (let gx = 2; gx < w - 2; gx += 2) {
      const i = gy * w + gx;
      if (visited[i] || mag[i] < thr) continue;
      const fwd = walk(gx, gy, 1);
      const back = walk(gx, gy, -1);
      const pts = back.reverse().slice(0, -1).concat([[gx, gy]], fwd);
      if (pts.length >= o.edgeMin) {
        strokes.push({
          xs: pts.map(p => p[0]),
          ys: pts.map(p => p[1]),
          width: o.widthBase * 1.1
        });
      }
    }
  }
}

function buildLineArt(grid, o) {
  const opts = Object.assign({
    preBlur: 4,             // smoother tone -> continuous lines instead of fragments
    toneGamma: 1.0,
    toneCap: 0.72,         // shadows stay hatched, never fill solid
    spacing: 2.2,          // hatch spacing in pixels at full tone
    step: 1.2,             // sampling step along a line
    widthBase: 0.8,
    thr: 0.14,             // brightness floor: below this the paper stays blank
    angles: [-Math.PI / 4, Math.PI / 4, 0],  // successive cross-hatch layers
    layerTones: [0.0, 0.55, 0.85],           // tone at which each layer starts
    layerSpacing: [1, 1.2, 1.6],             // per-layer spacing multipliers
    edgePass: true,
    edgeMag: 0.26,
    edgeSteps: 90,
    edgeMin: 6
  }, o || {});

  const f = toneMap(grid.v, grid.w, grid.h, opts);
  const strokes = [];

  for (let L = 0; L < opts.angles.length; L++) {
    const minTone = opts.layerTones[L] !== undefined ? opts.layerTones[L] : 0.5;
    hatchLayer(f, opts, opts.angles[L], minTone,
      opts.spacing * (opts.layerSpacing[L] || 1), L * 0.37, strokes);
  }

  if (opts.edgePass) edgeStrokes(f, opts, strokes);

  return { strokes, gridW: f.w, gridH: f.h, count: strokes.length };
}

if (typeof module !== 'undefined') module.exports = { buildLineArt, toneMap, boxBlurRadius, sobel };
