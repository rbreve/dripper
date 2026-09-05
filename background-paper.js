'use strict';

class BackgroundPaper {
  constructor({ paperColor, fileInput, removeButton, uploadButton, onRedraw }) {
    this.paperColor = paperColor;
    this.fileInput = fileInput;
    this.removeButton = removeButton;
    this.uploadButton = uploadButton;
    this.onRedraw = onRedraw;
    this.image = null;
    this.objectUrl = null;
    this.fileInput.addEventListener('change', () => this.onFileChosen());
    this.removeButton.addEventListener('click', () => this.remove());
  }

  async onFileChosen() {
    const file = this.fileInput.files[0];
    this.fileInput.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const loaded = await this.loadFile(file);
    if (loaded) this.onRedraw();
  }

  loadFile(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        this.setImage(img, url);
        resolve(true);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      img.src = url;
    });
  }

  setImage(img, url) {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.image = img;
    this.objectUrl = url;
    this.syncControls();
  }

  remove() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.image = null;
    this.syncControls();
    this.onRedraw();
  }

  syncControls() {
    const hasImage = !!this.image;
    this.removeButton.hidden = !hasImage;
    this.uploadButton.classList.toggle('is-active', hasImage);
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
