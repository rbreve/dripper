'use strict';

/* Small numeric helpers shared by every module. */
const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const lerp = (a, b, t) => a + (b - a) * t;

/* 0..1 ease with flat ends, so thresholds don't feel like switches */
const smoothstep = (t) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/* alpha for one layer so that `layers` of it stacked reach `coverage` */
function alphaForStackedCoverage(coverage, layers) {
  return 1 - Math.pow(1 - coverage, 1 / Math.max(1, layers));
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
