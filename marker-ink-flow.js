'use strict';

/* Ink delivery model for the realistic marker.
 *
 * A felt nib lays down less ink the faster it is dragged, so quick strokes
 * go translucent and slow ones saturate. The nib also carries a small
 * reservoir that drains with distance and wicks back while the marker rests,
 * and the feed flickers a little from moment to moment — so the same stroke
 * comes out sometimes dense, sometimes thin.
 *
 * The overall ink density (how dark a slow stroke gets) is the user's Opacity
 * setting; everything here scales relative to it. */
const MARKER_FLOW_SETTINGS = {
  fastSpeed: 2400,             // px/s at which the stroke is at its lightest
  fastRatio: 0.65,             // coverage of a fast stroke relative to a slow one
  touchDownOverlap: 4,         // the first dot lands as softly as a moving nib
  reservoirDrainPerPx: 0.0005, // ~2000 px of fast travel empties the nib
  reservoirRefillPerSec: 0.5,
  reservoirFloor: 0.3,         // a starved nib still delivers this much
  reservoirWeight: 0.2,        // how strongly an emptying reservoir lightens ink
  flickerStep: 0.08,           // random walk of the feed rate per move event
  flickerRange: 0.18,
  flickerPull: 0.1,            // how fast the flicker relaxes back to neutral
  minCoverage: 0.05,
  maxCoverage: 0.985,          // never fully solid, so the fibre streaks survive
};

class MarkerInkFlow {
  constructor(settings = MARKER_FLOW_SETTINGS) {
    this.settings = settings;
    this.beginStroke();
  }

  /* a fresh touch-down: the nib is loaded and the feed is steady */
  beginStroke() {
    this.reservoir = 0.85 + Math.random() * 0.15;
    this.flicker = 0;
  }

  /* 0..1 of how hard the nib is being dragged */
  speedFraction(speed) {
    return smoothstep(speed / this.settings.fastSpeed);
  }

  /* the nib moved: fast travel drains the reservoir, slow travel refills it,
   * and the feed wanders a little */
  travel(distance, speed, dt) {
    const s = this.settings;
    const fast = this.speedFraction(speed);
    this.reservoir -= distance * s.reservoirDrainPerPx * fast;
    this.reservoir += dt * s.reservoirRefillPerSec * (1 - fast);
    this.reservoir = clamp(this.reservoir, s.reservoirFloor, 1);
    this.flicker += (Math.random() - 0.5) * s.flickerStep - this.flicker * s.flickerPull;
    this.flicker = clamp(this.flicker, -s.flickerRange, s.flickerRange);
  }

  /* the nib is resting on the paper: ink wicks back into the felt */
  rest(dt) {
    this.reservoir = Math.min(1, this.reservoir + dt * this.settings.reservoirRefillPerSec);
  }

  /* how much of the paper a fully overlapped stroke covers right now, 0..1.
   * density is the user's ink opacity: what a slow, fresh nib lays down. */
  coverage(speed, density) {
    const s = this.settings;
    const base = density * lerp(1, s.fastRatio, this.speedFraction(speed));
    const load = 1 - s.reservoirWeight * (1 - this.reservoir);
    return clamp(base * load * (1 + this.flicker), s.minCoverage, s.maxCoverage);
  }

  /* a lone stamp (touch-down, resting nib) would print the fibre mask at full
   * strength; pretend it's part of a short run so it blends like the stroke */
  loneStampOverlap() {
    return this.settings.touchDownOverlap;
  }
}
