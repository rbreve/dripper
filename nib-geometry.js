'use strict';

/* Pure geometry of the marker nib, shared by the cached dabs and the stroke
 * stepper. Nothing here touches the canvas. */

/* Pixel size of a cached dab for a nib shape. baseSize is the nib's long
 * axis in dab pixels; pad leaves room for a soft edge so it isn't clipped.
 * scaleW/scaleH convert the solid nib size into the padded canvas size when
 * the dab is blitted onto the painting. */
function dabGeometry(shape, baseSize, pad) {
  const width = Math.round(baseSize * shape.w) + pad * 2;
  const height = Math.round(baseSize * shape.h) + pad * 2;
  return {
    width,
    height,
    scaleW: width / (width - pad * 2),
    scaleH: height / (height - pad * 2),
  };
}

/* Length of the nib footprint measured along a travel direction. hw/hh are
 * the half extents on the nib's own axes, theta the travel direction relative
 * to the nib angle. Uses the ellipse support width for every shape — close
 * enough for a flat nib, and it never collapses to zero. */
function nibExtentAlong(hw, hh, theta) {
  return 2 * Math.hypot(Math.cos(theta) * hw, Math.sin(theta) * hh);
}
