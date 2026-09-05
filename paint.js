'use strict';

/*
 * Dripper — graffiti marker with wet-ink drip simulation.
 *
 * Model:
 *  - The visible canvas holds the ink.
 *  - A low-res "wet map" grid tracks how much liquid ink sits on each cell
 *    (plus its color). Painting deposits volume; slow strokes and holding
 *    the marker still deposit much more.
 *  - Cells whose volume passes a capacity threshold spawn drip particles.
 *  - Drips fall under gravity toward a volume-dependent terminal velocity,
 *    meander sideways, deposit ink as a trail (width ~ sqrt(volume)),
 *    absorb ink from wet cells they cross, randomly stall (stick-slip),
 *    and end in a bulged droplet when they run dry.
 */

/* ---------------- helpers ---------------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/* ---------------- DOM ---------------- */
const canvas = document.getElementById('paint');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('wrap');
const cursorEl = document.getElementById('cursor');

const colorInput = document.getElementById('color');
const sizeInput = document.getElementById('size');
const angleInput = document.getElementById('angle');
const dripInput = document.getElementById('drip');
const freqInput = document.getElementById('freq');
const wanderInput = document.getElementById('wander');
const widthInput = document.getElementById('width');
const varyInput = document.getElementById('vary');
const sizeVal = document.getElementById('sizeVal');
const angleVal = document.getElementById('angleVal');
const dripVal = document.getElementById('dripVal');
const freqVal = document.getElementById('freqVal');
const wanderVal = document.getElementById('wanderVal');
const widthVal = document.getElementById('widthVal');
const varyVal = document.getElementById('varyVal');
const clearBtn = document.getElementById('clear');
const swatchBox = document.getElementById('swatches');
const shapeBox = document.getElementById('shapes');
const anglePreview = document.getElementById('anglePreview');
const PRESETS = ['#1c1c1c', '#ffffff', '#e0201b', '#ff6a00', '#ffd400', '#10a852', '#1567d2', '#7a2ee6', '#ff3fa4'];
const PAPER = '#f2efe8';
const background = new BackgroundPaper({
  paperColor: PAPER,
  fileInput: document.getElementById('bgFile'),
  removeButton: document.getElementById('bgRemove'),
  uploadButton: document.getElementById('bgUpload'),
  onRedraw: resetSurface,
});

/* nib shapes: w/h are multiples of brush size (w = along the nib's long axis) */
const SHAPES = {
  circle: { w: 1, h: 1, round: true },
  chisel: { w: 1.5, h: 0.4, round: false },
  square: { w: 0.95, h: 0.95, round: false },
};

/* ---------------- state ---------------- */
let W = 0, H = 0, dpr = 1;
let brushSize = +sizeInput.value;        // diameter in px
let shapeName = 'chisel';
let shape = SHAPES[shapeName];
let nibAngle = (+angleInput.value * Math.PI) / 180;
let dripAmt = +dripInput.value / 100;    // 0..1, drip size/wetness
let dripFreq = +freqInput.value / 100;   // 0..1, drips per brush stroke
let dripWander = +wanderInput.value / 100; // 0..1, how far drips stray off vertical
let dripWidthScale = +widthInput.value / 100; // trail thickness multiplier
let dripVary = +varyInput.value / 100;   // 0..1, spread of drip size
let brush = hexToRgb(colorInput.value);

/* wet map */
const CELL = 8;
const MAX_CELL_VOL = 60;
let cols = 0, rows = 0;
let vol = new Float32Array(0);
let colR = new Uint8Array(0), colG = new Uint8Array(0), colB = new Uint8Array(0);

/* drips */
const MAX_DRIPS = 600;
const END_VOL = 0.55;
const drips = [];

/* stroke */
const MAX_STAMPS = 400;   // per pointer move, keeps one frame's work bounded
let drawing = false;
let lastX = 0, lastY = 0, lastT = 0;
let lastMoveT = 0;
let speed = 0;         // px/s, smoothed
let pressure = 0.5;
let leftover = 0;      // distance carried between stamps

/* ---------------- canvas / grid setup ---------------- */
function paintPaper() {
  background.paint(ctx, W, H);
}

function resetSurface() {
  drips.length = 0;
  if (vol.length) vol.fill(0);
  paintPaper();
}

function initGrid() {
  cols = Math.max(1, Math.ceil(W / CELL));
  rows = Math.max(1, Math.ceil(H / CELL));
  vol = new Float32Array(cols * rows);
  colR = new Uint8Array(cols * rows);
  colG = new Uint8Array(cols * rows);
  colB = new Uint8Array(cols * rows);
}

function resizeCanvas(preserve) {
  let snapshot = null, oldW = W, oldH = H;
  if (preserve && canvas.width > 0) {
    snapshot = document.createElement('canvas');
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    snapshot.getContext('2d').drawImage(canvas, 0, 0);
  }
  dpr = window.devicePixelRatio || 1;
  W = wrap.clientWidth;
  H = wrap.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  paintPaper();
  if (snapshot) ctx.drawImage(snapshot, 0, 0, oldW, oldH);
  initGrid();
}

/* ---------------- marker dab (cached stamp) ---------------- */
/* The dab is rendered once per color/shape change, then blitted along the
 * stroke. PAD leaves room for the soft edge so it isn't clipped. */
const dab = document.createElement('canvas');
const DAB = 128;
const PAD = 6;

let dabSW = 1, dabSH = 1;   // full dab size / solid-nib size

function buildDab() {
  const dw = Math.round(DAB * shape.w) + PAD * 2;
  const dh = Math.round(DAB * shape.h) + PAD * 2;
  dab.width = dw;
  dab.height = dh;
  dabSW = dw / (dw - PAD * 2);
  dabSH = dh / (dh - PAD * 2);
  const dctx = dab.getContext('2d');
  dctx.clearRect(0, 0, dw, dh);
  const c = `${brush.r}, ${brush.g}, ${brush.b}`;

  if (shape.round) {
    const r = (dw - PAD * 2) / 2;
    const cx = dw / 2, cy = dh / 2;
    const g = dctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, `rgba(${c}, 1)`);
    g.addColorStop(0.9, `rgba(${c}, 1)`);
    g.addColorStop(1, `rgba(${c}, 0)`);
    dctx.fillStyle = g;
    dctx.beginPath();
    dctx.arc(cx, cy, r, 0, TAU);
    dctx.fill();
  } else {
    // hard-edged nib: a slight blur keeps the corners from aliasing
    dctx.filter = 'blur(1.2px)';
    dctx.fillStyle = `rgb(${c})`;
    dctx.fillRect(PAD, PAD, dw - PAD * 2, dh - PAD * 2);
    dctx.filter = 'none';
  }
}

/* ---------------- wet map ops ---------------- */
function cellAt(x, y) {
  const cx = (x / CELL) | 0;
  const cy = (y / CELL) | 0;
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return -1;
  return cy * cols + cx;
}

function addInk(x, y, amt) {
  const i = cellAt(x, y);
  if (i < 0 || amt <= 0) return;
  const v = vol[i];
  const t = amt / (v + amt);
  colR[i] = colR[i] + (brush.r - colR[i]) * t;
  colG[i] = colG[i] + (brush.g - colG[i]) * t;
  colB[i] = colB[i] + (brush.b - colB[i]) * t;
  vol[i] = Math.min(v + amt, MAX_CELL_VOL);
}

/* ---------------- drip factory ---------------- */
/* Size spread. At 0 every drip is the same weight; at 1 the same stroke throws
 * anything from a hairline thread to a fat runner. Skewed low on purpose —
 * real ink gives you a lot of small ones and the occasional heavy one — and
 * the curve averages near 1 so turning Vary up doesn't also mean "wetter". */
function volJitter() {
  if (dripVary <= 0) return 1;
  const u = Math.random();
  return 1 - dripVary + dripVary * (0.22 + u * u * 2.4);
}

/* Every drip gets its own path personality: a starting lean (it never runs
 * dead vertical), a wobble phase, and a wobble rate. Wander scales all of it. */
function pushDrip(x, y, vy, volume, r, g, b) {
  drips.push({
    x, y,
    vx: 0,
    vy,
    vol: volume,
    r, g, b,
    stall: 0,
    lean: (Math.random() - 0.5) * 0.5 * dripWander,
    phase: Math.random() * TAU,
    wobRate: 2 + Math.random() * 5,
  });
}

/* ---------------- painting ---------------- */
/* drips that fall straight off the nib while painting; they can let go
 * from anywhere along the nib's edge, so wide nibs drip across their width */
function nibDrip(x, y, p) {
  if (dripFreq <= 0 || drips.length >= MAX_DRIPS) return;
  if (Math.random() >= p) return;
  const hw = (brushSize / 2) * shape.w;
  const t = (Math.random() - 0.5) * 2 * hw;
  pushDrip(
    x + Math.cos(nibAngle) * t,
    y + Math.sin(nibAngle) * t + (Math.random() - 0.5) * 3,
    25 + Math.random() * 55,
    (2.7 + dripAmt * 8) * volJitter(),
    brush.r, brush.g, brush.b
  );
}

function stamp(x, y, pr, inkScale) {
  const press = 0.65 + 0.7 * pr;
  const hw = (brushSize / 2) * shape.w * press;
  const hh = (brushSize / 2) * shape.h * press;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(nibAngle);
  ctx.drawImage(dab, -hw * dabSW, -hh * dabSH, hw * 2 * dabSW, hh * 2 * dabSH);
  ctx.restore();

  // slow, heavy strokes leave more liquid behind
  const slow = clamp(1.7 - speed / 240, 0.35, 1.7);
  // spread the wetness across the nib footprint, not just its center point
  const n = clamp(Math.round((hw * 2) / CELL), 1, 8);
  const amt = (brushSize * 0.07 * slow * (0.5 + pr) * inkScale) / Math.sqrt(n);
  if (amt <= 0) return;
  const cos = Math.cos(nibAngle), sin = Math.sin(nibAngle);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * hw;
    addInk(x + cos * t, y + sin * t, amt);
  }
}

function strokeTo(x, y, t, pr) {
  const dx = x - lastX;
  const dy = y - lastY;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  const dtms = Math.max(1, t - lastT);
  speed = speed * 0.65 + (dist / dtms) * 1000 * 0.35;
  pressure = pr;

  // Step by the nib's narrow dimension so thin edges still draw a solid line.
  // Flat nibs need a tighter step or their corners scallop the stroke edge.
  const step = shape.round ? 0.3 : 0.2;
  let spacing = Math.max(1.5, brushSize * Math.min(shape.w, shape.h) * step);
  // A long jump (fast stroke, or a synthetic drag) must not cost unbounded
  // work: thin the stamps out rather than stamping thousands of times.
  if (dist / spacing > MAX_STAMPS) spacing = dist / MAX_STAMPS;
  // expected drips per px of stroke, scaled by brush size
  const nibP = spacing * dripFreq * 0.045 * (brushSize / 22);
  const d0 = spacing - leftover;
  if (dist >= d0) {
    for (let d = d0; d <= dist; d += spacing) {
      const f = d / dist;
      const sx = lastX + dx * f;
      const sy = lastY + dy * f;
      stamp(sx, sy, pr, 1);
      nibDrip(sx, sy, nibP);
    }
    leftover = (dist - d0) % spacing;
  } else {
    leftover += dist;
  }
  lastX = x;
  lastY = y;
  lastT = t;
  lastMoveT = performance.now();
}

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  drawing = true;
  speed = 0;
  leftover = 0;
  pressure = e.pressure > 0 ? e.pressure : 0.5;
  const p = canvasPos(e);
  lastX = p.x;
  lastY = p.y;
  lastT = e.timeStamp;
  lastMoveT = performance.now();
  stamp(p.x, p.y, pressure, 1);
  // capture is a nicety — never let it abort the stroke
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (err) {
    /* ignore */
  }
});

canvas.addEventListener('pointermove', (e) => {
  updateCursor(e);
  if (!drawing) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) {
    const p = canvasPos(ev);
    strokeTo(p.x, p.y, ev.timeStamp, ev.pressure > 0 ? ev.pressure : 0.5);
  }
});

function endStroke() {
  drawing = false;
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* holding the marker in place floods the spot */
function stationaryDeposit(dt) {
  speed *= 0.85;
  stamp(lastX, lastY, pressure, 0);
  addInk(lastX, lastY, brushSize * 0.04 * (0.5 + pressure) * dt * 60);
  nibDrip(lastX, lastY, dripFreq * 6 * dt * (brushSize / 22));
}

/* ---------------- drips ---------------- */
function spawnDrips(dt) {
  const evap = Math.exp(-dt * 0.07); // wet ink slowly dries
  const noDrip = dripAmt <= 0 && dripFreq <= 0;
  const cap = 10 - 8.5 * dripAmt;
  const pk = (0.3 + 2.2 * (dripAmt + dripFreq) * 0.5) * dt;

  for (let i = 0; i < vol.length; i++) {
    let v = vol[i];
    if (v === 0) continue;
    v *= evap;
    if (v < 0.02) v = 0;
    vol[i] = v;
    if (noDrip || v <= cap || drips.length >= MAX_DRIPS) continue;
    if (Math.random() < (v - cap) * pk) {
      const take = Math.min(v * 0.8, (5 + dripAmt * 7) * volJitter());
      vol[i] = v - take;
      const cx = i % cols;
      const cy = (i / cols) | 0;
      pushDrip(
        (cx + 0.5) * CELL + (Math.random() - 0.5) * CELL * 1.5,
        (cy + 0.5) * CELL + (Math.random() - 0.5) * CELL,
        15 + Math.random() * 40,
        take,
        colR[i], colG[i], colB[i]
      );
    }
  }
}

/* Two widths on purpose. dripCore is what the drip physically is — it drives
 * how fast the trail drains volume and how much ink the head picks up, so the
 * simulation stays stable whatever the slider says. dripWidth is what gets
 * drawn, and that is the one the Width slider scales. */
function dripCore(d) {
  return 1.1 + Math.sqrt(Math.max(d.vol, 0)) * 1.05;
}

function dripWidth(d) {
  return dripCore(d) * dripWidthScale;
}

/* How far off vertical the drip is running right now, as a slope (dx per dy).
 * Wander is a property of the *path*, not of sideways speed: a fast fat drip
 * carves the same shape as a slow one, it just gets there sooner.
 *
 * Three parts, all scaled by the Wander slider:
 *  - lean: a slow random walk pulled back toward vertical, so the line curves
 *    over its whole length instead of jittering around a straight axis;
 *  - snag: the head catches on the paper tooth and jumps to one side;
 *  - wobble: a small ripple riding on top of the drift.
 * Heavy drips carry momentum, so they run straighter than thin ones. */
function dripLean(d, dt) {
  const w = dripWander;
  if (w <= 0) {
    d.lean = 0;
    return 0;
  }
  const heavy = 1 / (1 + d.vol * 0.11);
  d.lean += (Math.random() - 0.5) * 6 * w * heavy * dt;
  d.lean -= d.lean * 1.5 * dt;
  if (Math.random() < 2.2 * w * dt) d.lean += (Math.random() - 0.5) * 1.1 * w * heavy;
  d.lean = clamp(d.lean, -1.3 * w, 1.3 * w);
  d.phase += d.wobRate * dt;
  return d.lean + Math.sin(d.phase) * 0.25 * w * heavy;
}

function drawBulb(d) {
  const w = dripWidth(d) + 0.6;
  ctx.fillStyle = `rgb(${d.r | 0}, ${d.g | 0}, ${d.b | 0})`;
  ctx.beginPath();
  ctx.ellipse(d.x, d.y, w * 0.62, w * 0.82, 0, 0, TAU);
  ctx.fill();
}

function updateDrips(dt) {
  for (let i = drips.length - 1; i >= 0; i--) {
    const d = drips[i];

    if (d.stall > 0) {
      // stick-slip: the drip pins in place and pools while ink wicks away
      d.stall -= dt;
      const w = dripWidth(d);
      ctx.fillStyle = `rgb(${d.r | 0}, ${d.g | 0}, ${d.b | 0})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, w * 0.55, 0, TAU);
      ctx.fill();
      d.vol -= dt * 0.4;
      if (d.vol <= END_VOL) {
        drawBulb(d);
        drips.splice(i, 1);
      } else if (d.stall <= 0) {
        // a pinned drip usually breaks away to one side, not straight down
        d.lean += (Math.random() - 0.5) * 1.4 * dripWander;
        d.vx = 0;
      }
      continue;
    }

    // gravity toward a volume-dependent terminal velocity: fat drips run fast
    d.vy += 900 * dt;
    const vmax = 26 + d.vol * 13;
    if (d.vy > vmax) d.vy = vmax;
    // sideways meander: steer toward the current lean, easing in so the path
    // bends instead of kinking
    const target = d.vy * dripLean(d, dt);
    d.vx += (target - d.vx) * Math.min(1, 9 * dt);

    const px = d.x, py = d.y;
    d.x += d.vx * dt;
    d.y += d.vy * dt;

    // a drip crossing wet paint picks that ink up and grows
    const ci = cellAt(d.x, d.y);
    if (ci >= 0 && vol[ci] > 0.15) {
      const w0 = dripCore(d);
      const take = Math.min(vol[ci], (8 + w0 * 3) * dt);
      vol[ci] -= take;
      const nv = Math.min(d.vol + take * 0.5, 26);
      const t = (nv - d.vol) / nv;
      d.r += (colR[ci] - d.r) * t * 0.6;
      d.g += (colG[ci] - d.g) * t * 0.6;
      d.b += (colB[ci] - d.b) * t * 0.6;
      d.vol = nv;
    }

    const w = dripWidth(d);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgb(${d.r | 0}, ${d.g | 0}, ${d.b | 0})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();

    // the trail costs volume: wider trails drain faster
    const dist = Math.hypot(d.x - px, d.y - py);
    d.vol -= dist * (0.018 + 0.011 * dripCore(d));

    // small drips tend to pin and stall
    const stallRate = Math.max(0, 1.6 - d.vol * 0.22);
    if (Math.random() < stallRate * dt) {
      d.stall = 0.15 + Math.random() * 0.9;
      d.vy = 0;
    }

    if (d.vol <= END_VOL || d.y > H + 20) {
      drawBulb(d);
      drips.splice(i, 1);
    }
  }
}

/* ---------------- main loop ---------------- */
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (drawing && now - lastMoveT > 60) stationaryDeposit(dt);
  spawnDrips(dt);
  updateDrips(dt);
  requestAnimationFrame(frame);
}

/* ---------------- cursor ring ---------------- */
function updateCursor(e) {
  const rect = wrap.getBoundingClientRect();
  cursorEl.style.display = 'block';
  cursorEl.style.left = `${e.clientX - rect.left}px`;
  cursorEl.style.top = `${e.clientY - rect.top}px`;
  cursorEl.style.width = `${brushSize * shape.w}px`;
  cursorEl.style.height = `${brushSize * shape.h}px`;
  cursorEl.style.borderRadius = shape.round ? '50%' : '1px';
  cursorEl.style.transform = `translate(-50%, -50%) rotate(${angleInput.value}deg)`;
}
canvas.addEventListener('pointerleave', () => {
  cursorEl.style.display = 'none';
});

/* ---------------- UI wiring ---------------- */
function updateAnglePreview() {
  const mark = anglePreview.firstElementChild;
  const max = 16;
  const scale = max / Math.max(shape.w, shape.h);
  mark.style.width = `${shape.w * scale}px`;
  mark.style.height = `${shape.h * scale}px`;
  mark.style.borderRadius = shape.round ? '50%' : '1px';
  mark.style.background = colorInput.value;
  anglePreview.style.transform = `rotate(${angleInput.value}deg)`;
}

function setColor(hex) {
  brush = hexToRgb(hex);
  buildDab();
  for (const el of swatchBox.children) {
    el.classList.toggle('active', el.dataset.color === hex);
  }
  updateAnglePreview();
}

function setShape(name) {
  shapeName = name;
  shape = SHAPES[name];
  buildDab();
  for (const el of shapeBox.children) {
    el.classList.toggle('active', el.dataset.shape === name);
  }
  updateAnglePreview();
}

for (const name of Object.keys(SHAPES)) {
  const b = document.createElement('button');
  b.className = 'shape';
  b.dataset.shape = name;
  b.title = name;
  b.appendChild(document.createElement('i'));
  b.addEventListener('click', () => setShape(name));
  shapeBox.appendChild(b);
}

for (const hex of PRESETS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.dataset.color = hex;
  b.style.background = hex;
  b.title = hex;
  b.addEventListener('click', () => {
    colorInput.value = hex;
    setColor(hex);
  });
  swatchBox.appendChild(b);
}

colorInput.addEventListener('input', () => setColor(colorInput.value));

sizeInput.addEventListener('input', () => {
  brushSize = +sizeInput.value;
  sizeVal.textContent = sizeInput.value;
});

angleInput.addEventListener('input', () => {
  nibAngle = (+angleInput.value * Math.PI) / 180;
  angleVal.textContent = angleInput.value;
  updateAnglePreview();
});

dripInput.addEventListener('input', () => {
  dripAmt = +dripInput.value / 100;
  dripVal.textContent = dripInput.value;
});

freqInput.addEventListener('input', () => {
  dripFreq = +freqInput.value / 100;
  freqVal.textContent = freqInput.value;
});

wanderInput.addEventListener('input', () => {
  dripWander = +wanderInput.value / 100;
  wanderVal.textContent = wanderInput.value;
});

widthInput.addEventListener('input', () => {
  dripWidthScale = +widthInput.value / 100;
  widthVal.textContent = widthInput.value;
});

varyInput.addEventListener('input', () => {
  dripVary = +varyInput.value / 100;
  varyVal.textContent = varyInput.value;
});

clearBtn.addEventListener('click', resetSurface);

window.addEventListener('resize', () => resizeCanvas(true));

/* ---------------- go ---------------- */
setShape(shapeName);
setColor(colorInput.value);
if (window.lucide) lucide.createIcons({ attrs: { width: 13, height: 13, 'stroke-width': 2 } });
resizeCanvas(false);
requestAnimationFrame(frame);
