'use strict';

/* Dropdown on the Image button: paper, shipped walls, or a local upload. */
class BackgroundPicker {
  constructor({ paper, root, presets }) {
    this.paper = paper;
    this.root = root;
    this.presets = presets;
    this.open = false;
    this.toggle = root.querySelector('[data-bg-toggle]');
    this.menu = root.querySelector('[data-bg-menu]');
    this.fileInput = root.querySelector('input[type="file"]');
    this.buildPresetButtons();
    this.toggle.addEventListener('click', (e) => this.onToggle(e));
    this.fileInput.addEventListener('change', () => this.onFileChosen());
    document.addEventListener('click', (e) => this.onDocumentClick(e));
    document.addEventListener('keydown', (e) => this.onKeydown(e));
    this.sync();
  }

  buildPresetButtons() {
    const upload = this.menu.querySelector('[data-bg-upload]');
    for (const preset of this.presets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bg-option';
      button.dataset.bg = preset.id;
      const thumb = document.createElement('img');
      thumb.src = preset.src;
      thumb.alt = '';
      const label = document.createElement('span');
      label.textContent = preset.label;
      button.append(thumb, label);
      button.addEventListener('click', () => this.choosePreset(preset));
      this.menu.insertBefore(button, upload);
    }
    this.menu.querySelector('[data-bg="none"]').addEventListener('click', () => {
      this.paper.remove();
      this.close();
      this.sync();
    });
  }

  async choosePreset(preset) {
    await this.paper.loadPreset(preset);
    this.close();
    this.sync();
  }

  async onFileChosen() {
    const file = this.fileInput.files[0];
    this.fileInput.value = '';
    await this.paper.loadFile(file);
    this.close();
    this.sync();
  }

  onToggle(e) {
    e.stopPropagation();
    this.open ? this.close() : this.show();
  }

  onDocumentClick(e) {
    if (!this.open || this.root.contains(e.target)) return;
    this.close();
  }

  onKeydown(e) {
    if (e.key === 'Escape' && this.open) this.close();
  }

  show() {
    this.open = true;
    this.menu.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
  }

  close() {
    this.open = false;
    this.menu.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
  }

  sync() {
    const id = this.paper.sourceId;
    this.toggle.classList.toggle('is-active', id !== 'none');
    for (const option of this.menu.querySelectorAll('[data-bg]')) {
      option.classList.toggle('is-active', option.dataset.bg === id);
    }
  }
}
