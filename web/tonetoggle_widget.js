export class ToneToggleWidget {
  constructor(node, tones, current, onChange, options = {}) {
    this.node = node;
    this.tones = tones;
    this.current = current;
    this.onChange = onChange;
    this.width = options.width || 240;
    this.height = options.height || 25;
    this.x = 0;
    this.y = 0;
    this.marginTop = options.marginTop || 170;
    this._mouseDown = false;
  }

  draw(ctx) {
    const btnWidth = this.width / this.tones.length;
    this.x = (this.node.size[0] - this.width) / 2;
    this.y = this.marginTop;
    this.tones.forEach((tone, i) => {
      const x = this.x + i * btnWidth;
      const y = this.y;
      const isSelected = tone === this.current;
      ctx.fillStyle = isSelected ? "#888" : "#444";
      ctx.fillRect(x, y, btnWidth - 2, this.height - 2);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "12px Arial";
      ctx.fillText(tone, x + btnWidth / 2 - 1, y + this.height / 2);
    });
  }

  getLocalMouse(localPos) {
    return {
      x: localPos[0] - this.x,
      y: localPos[1] - this.y,
    };
  }

  onMouseDown(e, localPos) {
    const [mx, my] = localPos;
    this.x = (this.node.size[0] - this.width) / 2;
    this.y = this.marginTop;
    if (
      mx < this.x ||
      mx > this.x + this.width ||
      my < this.y ||
      my > this.y + this.height
    ) {
      return false;
    }
    const btnWidth = this.width / this.tones.length;
    const index = Math.floor((mx - this.x) / btnWidth);
    const selected = this.tones[index];
    if (selected && selected !== this.current) {
      this.current = selected;
      this.onChange.call(this.node, selected);
      this.node.setDirtyCanvas(true, true);
    }
    this._mouseDown = true;
    return true;
  }

  onMouseMove(event, localPos) {
    if (!this._mouseDown) return false;
    if (event.buttons !== 1) {
      this.onMouseUp();
      return false;
    }
    return true;
  }

  onMouseUp() {
    if (!this._mouseDown) return false;
    this._mouseDown = false;
    return true;
  }

  setTone(newValue) {
    this.current = newValue;
    this.node.setDirtyCanvas(true, true);
  }
}
