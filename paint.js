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
 *  - Three brush modes: "solid" stamps a flat opaque nib; "realistic" stamps
 *    a streaky felt texture whose opacity follows the stroke speed (see
 *    MarkerInkFlow / MarkerDab); "spray" stamps a soft round cone whose
 *    density follows dwell time, with grain and overspray mist thrown at
 *    screen scale (see SprayDab / sprayGrain).
 */

/* ---------------- DOM ---------------- */
const canvas = document.getElementById('paint');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('wrap');
const cursorEl = document.getElementById('cursor');

const colorInput = document.getElementById('color');
const sizeInput = document.getElementById('size');
const opacityInput = document.getElementById('opacity');
const mistInput = document.getElementById('mist');
const angleInput = document.getElementById('angle');
const dripInput = document.getElementById('drip');
const freqInput = document.getElementById('freq');
const wanderInput = document.getElementById('wander');
const widthInput = document.getElementById('width');
const varyInput = document.getElementById('vary');
const sizeVal = document.getElementById('sizeVal');
const opacityVal = document.getElementById('opacityVal');
const mistVal = document.getElementById('mistVal');
const angleVal = document.getElementById('angleVal');
const dripVal = document.getElementById('dripVal');
const freqVal = document.getElementById('freqVal');
const wanderVal = document.getElementById('wanderVal');
const widthVal = document.getElementById('widthVal');
const varyVal = document.getElementById('varyVal');
const dripToggle = document.getElementById('dripToggle');
const dynamicToggle = document.getElementById('dynamicToggle');
const dripBar = document.querySelector('.toolbar-drip');
const clearBtn = document.getElementById('clear');
const swatchBox = document.getElementById('swatches');
const shapeBox = document.getElementById('shapes');
const modeBox = document.getElementById('modes');
const anglePreview = document.getElementById('anglePreview');
const toolbarEl = document.getElementById('toolbar');
const PRESETS = ['#1c1c1c', '#ffffff', '#e0201b', '#ff6a00', '#ffd400', '#10a852', '#1567d2', '#7a2ee6', '#ff3fa4'];
const PAPER = '#f2efe8';
const background = new BackgroundPaper({
  paperColor: PAPER,
  onRedraw: resetSurface,
});
const backgroundPicker = new BackgroundPicker({
  paper: background,
  root: document.getElementById('bgPicker'),
  presets: BACKGROUND_PRESETS,
});

/* nib shapes: w/h are multiples of brush size (w = along the nib's long axis) */
const SHAPES = {
  circle: { w: 1, h: 1, round: true },
  chisel: { w: 1.5, h: 0.4, round: false },
  square: { w: 0.95, h: 0.95, round: false },
};

/* brush modes: how the nib puts ink on the paper */
const BRUSH_MODES = {
  solid: { label: 'Solid', title: 'Solid ink: flat, fully opaque strokes' },
  realistic: {
    label: 'Realistic',
    title: 'Realistic marker: streaky felt texture, lighter when fast, darker when slow',
  },
  spray: {
    label: 'Spray',
    title: 'Spray can: soft round cone, grainy edges, overspray mist',
  },
};

/* ---------------- state ---------------- */
let W = 0, H = 0, dpr = 1;
let brushSize = +sizeInput.value;        // diameter in px
let brushOpacity = +opacityInput.value / 100; // 0..1 paper coverage of a stroke
let sprayMistAmt = +mistInput.value / 100; // 0..1, overspray dust around the spray cone
let brushMode = 'solid';
let shapeName = 'chisel';
let shape = SHAPES[shapeName];
let nibAngle = (+angleInput.value * Math.PI) / 180;
let dripEnabled = true;
let dynamicEnabled = false; // fast strokes draw thinner when on
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

/* ---------------- marker dabs (cached stamps) ---------------- */
/* Each dab is rendered once per color/shape change, then blitted along the
 * stroke. One per brush mode; both expose canvas + scaleW/scaleH. */
const DAB_GEOMETRY = { baseSize: 128, pad: 6 };
const solidDab = new SolidDab(DAB_GEOMETRY);
const markerDab = new MarkerDab(DAB_GEOMETRY);
const sprayDab = new SprayDab(DAB_GEOMETRY);
const inkFlow = new MarkerInkFlow();

const isRealistic = () => brushMode === 'realistic';
const isSpray = () => brushMode === 'spray';
const activeDab = () => (isSpray() ? sprayDab : isRealistic() ? markerDab : solidDab);
/* a spray cone is round whatever nib shape is selected */
const activeShape = () => (isSpray() ? SHAPES.circle : shape);
/* a can throws a cone much wider than a pen nib of the same "size" setting */
const SPRAY_SIZE_MULT = 2;
const nibSize = () => (isSpray() ? brushSize * SPRAY_SIZE_MULT : brushSize);

function buildDabs() {
  solidDab.build(shape, brush);
  markerDab.build(shape, brush);
  sprayDab.build(shape, brush);
}

/* how much the nib flattens under pressure */
const pressScale = (pr) => 0.65 + 0.7 * pr;

/* dynamic width (optional): a fast hand starves the line, a slow one keeps
 * it full — same idea as the realistic mode's ink flow, but shrinking the
 * nib itself rather than its opacity, and available in every brush mode.
 * The width doesn't track speed directly: it eases toward the speed's target
 * with its own time constant, so the taper stretches over a visible length
 * of stroke instead of snapping the moment the hand accelerates. */
const DYNAMIC_SLOW_SPEED = 40;   // px/s below which the stroke keeps its full width
const DYNAMIC_FAST_SPEED = 350;  // px/s at which the stroke reaches its thinnest
const DYNAMIC_MIN_SCALE = 0.1;   // thinnest a fast stroke gets, as a fraction of full width
const DYNAMIC_EASE = 5;          // 1/s; ~200ms time constant for the width to follow speed
let dynScale = 1;                // smoothed width factor, 1 = full width

const dynTarget = () =>
  1 -
  smoothstep((speed - DYNAMIC_SLOW_SPEED) / (DYNAMIC_FAST_SPEED - DYNAMIC_SLOW_SPEED)) *
    (1 - DYNAMIC_MIN_SCALE);
const easeDynScale = (dt) => {
  dynScale += (dynTarget() - dynScale) * Math.min(1, DYNAMIC_EASE * dt);
};
const speedScale = () => (dynamicEnabled ? dynScale : 1);
const nibScale = (pr) => pressScale(pr) * speedScale();

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
    alpha: brushOpacity,
    stall: 0,
    pooled: false,
    lean: (Math.random() - 0.5) * 0.5 * dripWander,
    phase: Math.random() * TAU,
    wobRate: 2 + Math.random() * 5,
  });
}

/* ---------------- painting ---------------- */
/* drips that fall straight off the nib while painting; they can let go
 * from anywhere along the nib's edge, so wide nibs drip across their width */
function nibDrip(x, y, p) {
  if (!dripEnabled || dripFreq <= 0 || drips.length >= MAX_DRIPS) return;
  if (Math.random() >= p) return;
  const hw = (nibSize() / 2) * activeShape().w;
  const t = (Math.random() - 0.5) * 2 * hw;
  pushDrip(
    x + Math.cos(nibAngle) * t,
    y + Math.sin(nibAngle) * t + (Math.random() - 0.5) * 3,
    25 + Math.random() * 55,
    (2.7 + dripAmt * 8) * volJitter(),
    brush.r, brush.g, brush.b
  );
}

/* paper coverage the current stroke should reach where its stamps overlap */
function inkCoverage() {
  // a can lays down saturated, opaque paint regardless of hand speed; the
  // "fast stroke" look comes from wider stamp spacing leaving gaps, not from
  // each dab going translucent (see the sprayGrain rim/mist for that texture)
  if (isSpray()) return brushOpacity;
  return isRealistic() ? inkFlow.coverage(speed, brushOpacity) : brushOpacity;
}

/* The specks that make a sprayed edge read as spray, thrown at screen scale
 * every stamp — grain baked into the cached dab would blur away when the dab
 * is scaled down to the brush size. A real fat-cap cone (see reference: a
 * near-solid disc with a dense ring of separated dots right at its boundary
 * and a scatter of finer sparks trailing a short way past it) is the target,
 * not a soft airbrush halo. Droplets are individually near-full-strength
 * paint — their alpha is driven by the Opacity slider, not by the stroke's
 * coverage-stacking math, which is why this takes `strength` (brushOpacity)
 * rather than the stamp's layered alpha.
 *  - rim: a dense band of droplets straddling the disc's edge, always on —
 *    this is what makes the boundary read as sprayed instead of a circle;
 *  - mist (the Mist slider): a shorter-range scatter of finer sparks past
 *    the rim, thinning with distance; Mist raises count and reach;
 *  - sputter: the odd fat fleck the can spits, mostly near the rim. */
function sprayGrain(x, y, rad, strength) {
  ctx.save();
  ctx.fillStyle = `rgb(${brush.r}, ${brush.g}, ${brush.b})`;

  const rims = clamp(Math.round(rad * 2.2), 16, 60);
  for (let i = 0; i < rims; i++) {
    const ang = Math.random() * TAU;
    const dist = rad * (0.8 + Math.random() * 0.3);
    const s = 0.6 + Math.random() * Math.random() * 2.2;
    ctx.globalAlpha = strength * (0.45 + Math.random() * 0.5);
    ctx.beginPath();
    ctx.arc(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, s, 0, TAU);
    ctx.fill();
  }

  const m = sprayMistAmt;
  // both particle count and particle size ramp with Mist, so the slider's
  // top end reads as roughly 3x the old fixed scatter, not just a wider reach
  const mistBoost = 1 + 2 * m;
  const count = Math.round((8 + m * (14 + rad * 0.6)) * mistBoost);
  const reach = 0.35 + m * 1.3;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * TAU;
    const dist = rad * (1.05 + Math.pow(Math.random(), 2) * reach);
    const fade = clamp(1.3 - dist / (rad * (1.1 + reach)), 0.1, 1);
    const s = (0.5 + Math.random() * Math.random() * 1.6) * mistBoost;
    ctx.globalAlpha = strength * fade * (0.3 + Math.random() * 0.55);
    ctx.beginPath();
    ctx.arc(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, s, 0, TAU);
    ctx.fill();
  }

  if (Math.random() < 0.06 + 0.1 * m) {
    const ang = Math.random() * TAU;
    const dist = rad * (0.9 + Math.random() * (0.5 + m));
    const s = 0.8 + Math.random() * 1.5;
    ctx.globalAlpha = strength * (0.6 + Math.random() * 0.35);
    ctx.beginPath();
    ctx.arc(x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/* overlap: how many stamps land on any one point of the stroke; opacity is
 * spread across them so coverage follows the slider, not the stamp spacing */
function stamp(x, y, pr, inkScale, overlap = 1) {
  const sh = activeShape();
  const press = nibScale(pr);
  const hw = (nibSize() / 2) * sh.w * press;
  const hh = (nibSize() / 2) * sh.h * press;
  const inkOpacity = inkCoverage();
  const nib = activeDab();
  const layerAlpha = inkOpacity < 1 ? alphaForStackedCoverage(inkOpacity, overlap) : 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(nibAngle);
  ctx.globalAlpha = layerAlpha;
  ctx.drawImage(nib.canvas, -hw * nib.scaleW, -hh * nib.scaleH, hw * 2 * nib.scaleW, hh * 2 * nib.scaleH);
  ctx.restore();

  if (isSpray()) sprayGrain(x, y, hw, brushOpacity);

  // slow, heavy strokes leave more liquid behind; a starved nib leaves less
  const slow = clamp(1.7 - speed / 240, 0.35, 1.7);
  // spread the wetness across the nib footprint, not just its center point
  const n = clamp(Math.round((hw * 2) / CELL), 1, 8);
  const amt = (nibSize() * 0.07 * slow * (0.5 + pr) * inkScale * inkOpacity) / Math.sqrt(n);
  if (amt <= 0) return;
  if (isSpray()) {
    // the cone wets a whole disc, not a nib line
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const t = hw * 0.85 * Math.sqrt(Math.random());
      addInk(x + Math.cos(ang) * t, y + Math.sin(ang) * t, amt);
    }
    return;
  }
  const cos = Math.cos(nibAngle), sin = Math.sin(nibAngle);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2 * hw;
    addInk(x + cos * t, y + sin * t, amt);
  }
}

/* stamps stacked on one point of the stroke: the nib's length along the
 * travel direction divided by the stamp spacing */
function stampOverlap(dx, dy, pr, spacing) {
  const sh = activeShape();
  const half = (nibSize() / 2) * nibScale(pr);
  const theta = Math.atan2(dy, dx) - nibAngle;
  return Math.max(1, nibExtentAlong(half * sh.w, half * sh.h, theta) / spacing);
}

function strokeTo(x, y, t, pr) {
  const dx = x - lastX;
  const dy = y - lastY;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  const dtms = Math.max(1, t - lastT);
  speed = speed * 0.65 + (dist / dtms) * 1000 * 0.35;
  easeDynScale(dtms / 1000);
  pressure = pr;
  if (isRealistic()) inkFlow.travel(dist, speed, dtms / 1000);

  // Step by the nib's narrow dimension so thin edges still draw a solid line.
  // Flat nibs need a tighter step or their corners scallop the stroke edge.
  // Spray dabs are soft discs, so they blend fine at a wider spacing.
  const sh = activeShape();
  const step = isSpray() ? 0.28 : sh.round ? 0.3 : 0.2;
  // spacing must follow the size actually stamped: dynamic width shrinks fast
  // strokes, and keeping full-size spacing would break them into beads
  let spacing = Math.max(1.5, nibSize() * Math.min(sh.w, sh.h) * step * nibScale(pr));
  // A long jump (fast stroke, or a synthetic drag) must not cost unbounded
  // work: thin the stamps out rather than stamping thousands of times.
  if (dist / spacing > MAX_STAMPS) spacing = dist / MAX_STAMPS;
  const overlap = stampOverlap(dx, dy, pr, spacing);
  // expected drips per px of stroke, scaled by brush size
  const nibP = spacing * dripFreq * 0.045 * (nibSize() / 22);
  const d0 = spacing - leftover;
  if (dist >= d0) {
    for (let d = d0; d <= dist; d += spacing) {
      const f = d / dist;
      const sx = lastX + dx * f;
      const sy = lastY + dy * f;
      stamp(sx, sy, pr, 1, overlap);
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
  dynScale = 1; // every stroke touches down at full width
  leftover = 0;
  pressure = e.pressure > 0 ? e.pressure : 0.5;
  const p = canvasPos(e);
  lastX = p.x;
  lastY = p.y;
  lastT = e.timeStamp;
  lastMoveT = performance.now();
  if (isRealistic()) {
    inkFlow.beginStroke();
    markerDab.reseed();
  }
  stamp(p.x, p.y, pressure, 1, inkFlow.loneStampOverlap());
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
  const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  const events = coalesced.length ? coalesced : [e];
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
  easeDynScale(dt);
  if (isRealistic()) inkFlow.rest(dt);
  stamp(lastX, lastY, pressure, 0, inkFlow.loneStampOverlap());
  addInk(lastX, lastY, nibSize() * 0.04 * (0.5 + pressure) * dt * 60);
  nibDrip(lastX, lastY, dripFreq * 6 * dt * (nibSize() / 22));
}

/* ---------------- drips ---------------- */
function spawnDrips(dt) {
  const evap = Math.exp(-dt * 0.07); // wet ink slowly dries
  const noDrip = !dripEnabled || (dripAmt <= 0 && dripFreq <= 0);
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

function dripColor(d) {
  return `rgba(${d.r | 0}, ${d.g | 0}, ${d.b | 0}, ${d.alpha})`;
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
  ctx.fillStyle = dripColor(d);
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
      if (!d.pooled) {
        d.pooled = true;
        const w = dripWidth(d);
        ctx.fillStyle = dripColor(d);
        ctx.beginPath();
        ctx.arc(d.x, d.y, w * 0.55, 0, TAU);
        ctx.fill();
      }
      d.vol -= dt * 0.4;
      if (d.vol <= END_VOL) {
        drawBulb(d);
        drips.splice(i, 1);
      } else if (d.stall <= 0) {
        // a pinned drip usually breaks away to one side, not straight down
        d.lean += (Math.random() - 0.5) * 1.4 * dripWander;
        d.vx = 0;
        d.pooled = false;
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

    const dist = Math.hypot(d.x - px, d.y - py);
    if (dist >= 0.45) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = dripColor(d);
      ctx.lineWidth = dripWidth(d);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
      ctx.restore();
    }

    // the trail costs volume: wider trails drain faster
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
  const sh = activeShape();
  cursorEl.style.width = `${nibSize() * sh.w}px`;
  cursorEl.style.height = `${nibSize() * sh.h}px`;
  cursorEl.style.borderRadius = sh.round ? '50%' : '1px';
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
  buildDabs();
  for (const el of swatchBox.children) {
    el.classList.toggle('active', el.dataset.color === hex);
  }
  updateAnglePreview();
}

function setShape(name) {
  shapeName = name;
  shape = SHAPES[name];
  buildDabs();
  for (const el of shapeBox.children) {
    el.classList.toggle('active', el.dataset.shape === name);
  }
  updateAnglePreview();
}

function setMode(name) {
  brushMode = name;
  // drives the CSS that shows Mist and dims shape/angle in spray mode
  toolbarEl.dataset.brushMode = name;
  for (const el of modeBox.children) {
    el.classList.toggle('active', el.dataset.mode === name);
  }
}

for (const [name, mode] of Object.entries(BRUSH_MODES)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mode';
  b.dataset.mode = name;
  b.title = mode.title;
  b.textContent = mode.label;
  b.addEventListener('click', () => setMode(name));
  modeBox.appendChild(b);
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

opacityInput.addEventListener('input', () => {
  brushOpacity = +opacityInput.value / 100;
  opacityVal.textContent = opacityInput.value;
});

mistInput.addEventListener('input', () => {
  sprayMistAmt = +mistInput.value / 100;
  mistVal.textContent = mistInput.value;
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

function setDripsEnabled(on) {
  dripEnabled = on;
  dripToggle.classList.toggle('is-on', on);
  dripToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  dripToggle.title = on ? 'Turn drips off' : 'Turn drips on';
  dripToggle.textContent = on ? 'On' : 'Off';
  dripBar.classList.toggle('is-off', !on);
  for (const input of [dripInput, freqInput, wanderInput, widthInput, varyInput]) {
    input.disabled = !on;
  }
  if (!on) drips.length = 0;
}

dripToggle.addEventListener('click', () => setDripsEnabled(!dripEnabled));

function setDynamicEnabled(on) {
  dynamicEnabled = on;
  dynamicToggle.classList.toggle('is-on', on);
  dynamicToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  dynamicToggle.title = on ? 'Turn dynamic width off' : 'Turn dynamic width on';
  dynamicToggle.textContent = on ? 'On' : 'Off';
}

dynamicToggle.addEventListener('click', () => setDynamicEnabled(!dynamicEnabled));

clearBtn.addEventListener('click', resetSurface);

window.addEventListener('resize', () => resizeCanvas(true));

/* ---------------- go ---------------- */
setDripsEnabled(dripEnabled);
setDynamicEnabled(dynamicEnabled);
setMode(brushMode);
setShape(shapeName);
setColor(colorInput.value);
if (window.lucide) lucide.createIcons({ attrs: { width: 13, height: 13, 'stroke-width': 2 } });
resizeCanvas(false);
requestAnimationFrame(frame);
