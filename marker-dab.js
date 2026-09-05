'use strict';

/* Textured dab for the realistic marker mode.
 *
 * A felt nib holds the most ink along its centre line and thins toward the
 * edges, and its fibres carry ink unevenly across the nib's width, so a pass
 * leaves streaks running along the stroke. The dab is a soft-edged body
 * masked with fibre bands along the nib's long axis; the mask is reseeded on
 * every stroke so no two strokes streak the same way. */
const MARKER_DAB_TEXTURE = {
  edgeDensity: 0.72,     // ink density at the nib edge, relative to the centre
  streakMin: 0.68,       // lightest fibre band density
  streakMax: 1,          // darkest fibre band density
  streakWidth: 5,        // band width in dab pixels
  streakSmoothing: 0.5,  // 0 = each band independent, 1 = flat
  gapChance: 0.06,       // chance a band is a dry split in the felt
  gapDensity: 0.45,
  cornerFade: 0.12,      // fraction of the long axis that thins at each end
};

class MarkerDab {
  constructor({ baseSize, pad, texture = MARKER_DAB_TEXTURE }) {
    this.baseSize = baseSize;
    this.pad = pad;
    this.texture = texture;
    this.canvas = document.createElement('canvas');
    this.mask = document.createElement('canvas');
    this.scaleW = 1;
    this.scaleH = 1;
    this.shape = null;
    this.rgb = null;
  }

  build(shape, rgb) {
    this.shape = shape;
    this.rgb = rgb;
    const geo = dabGeometry(shape, this.baseSize, this.pad);
    this.canvas.width = geo.width;
    this.canvas.height = geo.height;
    this.scaleW = geo.scaleW;
    this.scaleH = geo.scaleH;
    const dctx = this.canvas.getContext('2d');
    dctx.clearRect(0, 0, geo.width, geo.height);
    const color = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    if (shape.round) this.paintRoundBody(dctx, geo, color);
    else this.paintFlatBody(dctx, geo, color);
    this.paintStreakMask(geo);
    dctx.globalCompositeOperation = 'destination-in';
    dctx.drawImage(this.mask, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
  }

  /* new fibre pattern, same shape and color */
  reseed() {
    if (this.shape) this.build(this.shape, this.rgb);
  }

  paintRoundBody(dctx, geo, color) {
    const edge = this.texture.edgeDensity;
    const r = (geo.width - this.pad * 2) / 2;
    const cx = geo.width / 2, cy = geo.height / 2;
    const g = dctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${color}, 1)`);
    g.addColorStop(0.5, `rgba(${color}, 1)`);
    g.addColorStop(0.9, `rgba(${color}, ${edge})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    dctx.fillStyle = g;
    dctx.beginPath();
    dctx.arc(cx, cy, r, 0, TAU);
    dctx.fill();
  }

  /* dense down the middle of the band, thinner toward both long edges */
  paintFlatBody(dctx, geo, color) {
    const edge = this.texture.edgeDensity;
    const pad = this.pad;
    const g = dctx.createLinearGradient(0, pad, 0, geo.height - pad);
    g.addColorStop(0, `rgba(${color}, ${edge * 0.7})`);
    g.addColorStop(0.15, `rgba(${color}, ${edge})`);
    g.addColorStop(0.5, `rgba(${color}, 1)`);
    g.addColorStop(0.85, `rgba(${color}, ${edge})`);
    g.addColorStop(1, `rgba(${color}, ${edge * 0.7})`);
    dctx.filter = 'blur(1.4px)';
    dctx.fillStyle = g;
    dctx.fillRect(pad, pad, geo.width - pad * 2, geo.height - pad * 2);
    dctx.filter = 'none';
  }

  /* fibre bands across the long axis: a smoothed random walk of density,
   * the odd dry split, and thinning toward the nib's corners */
  paintStreakMask(geo) {
    const t = this.texture;
    this.mask.width = geo.width;
    this.mask.height = geo.height;
    const mctx = this.mask.getContext('2d');
    const fadeLen = geo.width * t.cornerFade;
    let value = Math.random();
    for (let x = 0; x < geo.width; x += t.streakWidth) {
      value = value * t.streakSmoothing + Math.random() * (1 - t.streakSmoothing);
      let density = lerp(t.streakMin, t.streakMax, value);
      if (Math.random() < t.gapChance) density = t.gapDensity;
      const corner = clamp(Math.min(x, geo.width - x) / fadeLen, 0, 1);
      density *= 0.5 + 0.5 * corner;
      mctx.fillStyle = `rgba(0, 0, 0, ${density})`;
      mctx.fillRect(x, 0, t.streakWidth, geo.height);
    }
  }
}
