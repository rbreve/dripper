'use strict';

/* Round dab for the spray-can mode.
 *
 * A real can (fat cap on a hardware can) throws an almost fully solid,
 * saturated disc — not a soft airbrush gradient. Only the outermost sliver
 * feathers, and that boundary is roughened by discrete speckle, not blur
 * (see sprayGrain in paint.js, which draws the actual rough edge and the
 * scattered "sparks" of overspray at screen scale — baking that into this
 * cached, rescaled canvas would blur it to mush). This dab ignores the nib
 * shape; a can's cone is round no matter what. Same blit interface as the
 * other dabs: canvas + scaleW/H. */
class SprayDab {
  constructor({ baseSize, pad }) {
    this.baseSize = baseSize;
    this.pad = pad;
    this.canvas = document.createElement('canvas');
    this.scaleW = 1;
    this.scaleH = 1;
  }

  build(shape, rgb) {
    const round = { w: 1, h: 1, round: true };
    const geo = dabGeometry(round, this.baseSize, this.pad);
    this.canvas.width = geo.width;
    this.canvas.height = geo.height;
    this.scaleW = geo.scaleW;
    this.scaleH = geo.scaleH;
    const dctx = this.canvas.getContext('2d');
    dctx.clearRect(0, 0, geo.width, geo.height);
    const color = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    const r = (geo.width - this.pad * 2) / 2;
    const cx = geo.width / 2, cy = geo.height / 2;
    const g = dctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${color}, 1)`);
    g.addColorStop(0.84, `rgba(${color}, 1)`);
    g.addColorStop(0.93, `rgba(${color}, 0.88)`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    dctx.fillStyle = g;
    dctx.beginPath();
    dctx.arc(cx, cy, r, 0, TAU);
    dctx.fill();
  }
}
