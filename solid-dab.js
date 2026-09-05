'use strict';

/* Flat, fully opaque marker dab. Rendered once per color/shape change, then
 * blitted along the stroke. Same interface as MarkerDab: canvas + scaleW/H. */
class SolidDab {
  constructor({ baseSize, pad }) {
    this.baseSize = baseSize;
    this.pad = pad;
    this.canvas = document.createElement('canvas');
    this.scaleW = 1;
    this.scaleH = 1;
  }

  build(shape, rgb) {
    const geo = dabGeometry(shape, this.baseSize, this.pad);
    this.canvas.width = geo.width;
    this.canvas.height = geo.height;
    this.scaleW = geo.scaleW;
    this.scaleH = geo.scaleH;
    const dctx = this.canvas.getContext('2d');
    dctx.clearRect(0, 0, geo.width, geo.height);
    const color = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    if (shape.round) this.paintRound(dctx, geo, color);
    else this.paintFlat(dctx, geo, color);
  }

  paintRound(dctx, geo, color) {
    const r = (geo.width - this.pad * 2) / 2;
    const cx = geo.width / 2, cy = geo.height / 2;
    const g = dctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, `rgba(${color}, 1)`);
    g.addColorStop(0.9, `rgba(${color}, 1)`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    dctx.fillStyle = g;
    dctx.beginPath();
    dctx.arc(cx, cy, r, 0, TAU);
    dctx.fill();
  }

  /* hard-edged nib: a slight blur keeps the corners from aliasing */
  paintFlat(dctx, geo, color) {
    const pad = this.pad;
    dctx.filter = 'blur(1.2px)';
    dctx.fillStyle = `rgb(${color})`;
    dctx.fillRect(pad, pad, geo.width - pad * 2, geo.height - pad * 2);
    dctx.filter = 'none';
  }
}
