'use strict';

class BackgroundPaper {
  constructor({ paperColor, onRedraw }) {
    this.paperColor = paperColor;
    this.onRedraw = onRedraw;
    this.image = null;
    this.objectUrl = null;
    this.sourceId = 'none';
  }

  async loadPreset(preset) {
    const img = await this.loadUrl(preset.src);
    if (!img) return false;
    this.clearObjectUrl();
    this.image = img;
    this.sourceId = preset.id;
    this.onRedraw();
    return true;
  }

  async loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return false;
    const url = URL.createObjectURL(file);
    const img = await this.loadUrl(url);
    if (!img) {
      URL.revokeObjectURL(url);
      return false;
    }
    this.clearObjectUrl();
    this.image = img;
    this.objectUrl = url;
    this.sourceId = 'upload';
    this.onRedraw();
    return true;
  }

  loadUrl(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  remove() {
    this.clearObjectUrl();
    this.image = null;
    this.sourceId = 'none';
    this.onRedraw();
  }

  clearObjectUrl() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  paint(ctx, width, height) {
    ctx.globalAlpha = 1;
    if (this.image) this.drawCover(ctx, width, height);
    else this.paintDefault(ctx, width, height);
  }

  paintDefault(ctx, width, height) {
    ctx.fillStyle = this.paperColor;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(110, 100, 80, 0.04)';
    const specks = (width * height) / 600;
    for (let i = 0; i < specks; i++) {
      ctx.fillRect(Math.random() * width, Math.random() * height, 1.3, 1.3);
    }
  }

  drawCover(ctx, width, height) {
    const img = this.image;
    const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  }
}
