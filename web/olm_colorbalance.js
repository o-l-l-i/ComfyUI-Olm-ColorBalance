import { app } from "../../scripts/app.js";
import { ToneToggleWidget } from "./tonetoggle_widget.js";
import { ChannelSliderWidget } from "./channelslider_widget.js";

const DEFAULT_BALANCE_VALUES = {
  shadows: { r: 0, g: 0, b: 0 },
  midtones: { r: 0, g: 0, b: 0 },
  highlights: { r: 0, g: 0, b: 0 },
};

function removeInputs(node, filter) {
  if (
    !node ||
    node.type !== "OlmColorBalance" ||
    node.id === -1 ||
    !Array.isArray(node.inputs)
  )
    return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    const input = node.inputs[i];
    if (filter(input)) {
      node.removeInput(i);
    }
  }
}

function hideWidget(widget, extraYOffset = -4) {
  if (widget) {
    widget.hidden = true;
    widget.computeSize = () => [0, extraYOffset];
  }
}

function hideDefaultWidgets(node, filter) {
  for (let i = node.widgets.length - 1; i >= 0; i--) {
    const widget = node.widgets[i];
    if (filter(widget)) {
      widget.hidden = true;
    }
  }
}

function initBalanceProperties(node) {
  node.properties = node.properties || {};
  if (!node.properties.balance_values) {
    node.properties.balance_values = JSON.parse(
      JSON.stringify(DEFAULT_BALANCE_VALUES)
    );
  }
  if (!node.properties.selected_tone) {
    node.properties.selected_tone = "midtones";
  }
}

function createChannelSlider(
  node,
  channel,
  label,
  gradientColors,
  updateBalanceProperty
) {
  return new ChannelSliderWidget(
    node,
    `slider_${channel}`,
    0,
    (v) => {
      updateBalanceProperty(node.properties.selected_tone, channel, v);
      node.requestPreviewUpdate();
    },
    {
      label,
      gradientColors,
    }
  );
}

function updateHiddenWidget(node, tone, channel, value) {
  const widgetName = `${tone.toLowerCase()}_${channel.toLowerCase()}`;
  const widget = node.getWidget(widgetName);
  if (widget) {
    node.setWidgetValue(widgetName, value);
  }
}

function updateBalanceProperty(node, tone, channel, value) {
  node.properties.balance_values[tone][channel] = value;
  updateHiddenWidget(node, tone, channel, value);
}

function createPreviewUpdateFunction(node) {
  let debounceTimer = null;
  return () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const payload = {
        tones: node.properties.balance_values,
        strength: node.properties.strength,
        preserve_luminosity: node.properties.preserve_luminosity,
      };
      fetch(
        `/olm/api/colorbalance/update?key=${encodeURIComponent(
          node.previewCacheKey
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
        .then((res) => res.json())
        .then((data) => {
          if (data.status === "success" && data.updatedimage) {
            const img = new Image();
            img.onload = () => {
              node._previewImage = img;
              node.setDirtyCanvas(true, true);
            };
            img.src = data.updatedimage;
          }
        })
        .catch((err) => console.warn("Preview update failed", err));
    }, 100);
  };
}

app.registerExtension({
  name: "olm.color.colorbalance",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "OlmColorBalance") return;

    nodeType.prototype.getWidget = function (name) {
      return this.widgets.find((w) => w.name === name);
    };

    nodeType.prototype.getWidgetValue = function (name, fallback = null) {
      return this.widgets.find((w) => w.name === name)?.value || fallback;
    };

    nodeType.prototype.setWidgetValue = function (widgetName, val) {
      const widget = this.getWidget(widgetName);
      if (widget && val !== null && val !== undefined) {
        widget.value = val;
      }
    };

    nodeType.prototype.getWidgetValSafe = function (name) {
      const widget = this.getWidget(name);
      return widget ? widget.value : null;
    };

    this.resizable = true;

    this.properties = this.properties || {};

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    const originalOnDrawForeground = nodeType.prototype.onDrawForeground;
    const originalOnConfigure = nodeType.prototype.onConfigure;
    const originalOnMouseDown = nodeType.prototype.onMouseDown;
    const originalOnMouseMove = nodeType.prototype.onMouseMove;
    const originalOnMouseUp = nodeType.prototype.onMouseUp;
    const originalOnMouseLeave = nodeType.prototype.onMouseLeave;
    const onExecutedOriginal = nodeType.prototype.onExecuted;

    nodeType.prototype.onNodeCreated = function () {
      originalOnNodeCreated?.call(this);

      const node = this;

      initBalanceProperties(node);

      hideWidget(node.getWidget("version"), -60);

      hideDefaultWidgets(
        node,
        (w) => w.type === "number" || w.type === "slider"
      );

      const backendLumWidget = node.getWidget("preserve_luminosity");
      hideWidget(backendLumWidget, 0);

      const strengthBackendWidget = node.getWidget("strength");
      hideWidget(strengthBackendWidget, 20);

      node.custom_widgets = [];

      node.requestPreviewUpdate = createPreviewUpdateFunction(node);

      const updateHidden = (tone, ch, val) =>
        updateHiddenWidget(node, tone, ch, val);
      const updateBalance = (tone, ch, val) =>
        updateBalanceProperty(node, tone, ch, val);

      node.sliderR = createChannelSlider(
        node,
        "r",
        "Cyan - Red",
        ["#00ffff", "#ff0000"],
        updateBalance
      );
      node.sliderG = createChannelSlider(
        node,
        "g",
        "Magenta - Green",
        ["#ff00ff", "#00ff00"],
        updateBalance
      );
      node.sliderB = createChannelSlider(
        node,
        "b",
        "Yellow - Blue",
        ["#ffff00", "#0000ff"],
        updateBalance
      );
      node.custom_widgets.push(node.sliderR, node.sliderG, node.sliderB);

      node.properties.strength = node.properties.strength ?? 1.0;
      node.strengthWidget = node.addWidget(
        "slider",
        "Strength",
        node.properties.strength,
        (val) => {
          node.properties.strength = val;
          node.setWidgetValue("strength", val);
          node.requestPreviewUpdate();
        },
        { min: 0, max: 4.0, step: 0.01 }
      );
      node.custom_widgets.push(node.strengthWidget);

      node.properties.preserve_luminosity ??= true;
      node.preserveLuminosityWidget = node.addWidget(
        "toggle",
        "Preserve Luminosity",
        node.properties.preserve_luminosity,
        (val) => {
          node.properties.preserve_luminosity = val;
          if (backendLumWidget) node.setWidgetValue(backendLumWidget.name, val);
          node.requestPreviewUpdate();
        }
      );
      node.custom_widgets.push(node.preserveLuminosityWidget);

      node.toneToggle = new ToneToggleWidget(
        node,
        ["shadows", "midtones", "highlights"],
        node.properties.selected_tone,
        (tone) => {
          node.properties.selected_tone = tone;
          node.updateSlidersUI();
        }
      );
      node.custom_widgets.push(node.toneToggle);

      node.resetBalanceValues = () => {
        node.properties.balance_values = JSON.parse(
          JSON.stringify(DEFAULT_BALANCE_VALUES)
        );
        for (const tone of ["shadows", "midtones", "highlights"]) {
          for (const ch of ["r", "g", "b"]) {
            updateHidden(tone, ch, node.properties.balance_values[tone][ch]);
          }
        }

        node.properties.strength = 1.0;
        node.setWidgetValue("strength", 1.0);
        if (node.strengthWidget) {
          node.setWidgetValue(node.strengthWidget.name, 1.0);
        }

        node.properties.preserve_luminosity = true;
        if (node.preserveLuminosityWidget) {
          node.setWidgetValue(node.preserveLuminosityWidget.name, true);
        }

        node.updateSlidersUI?.();
        node.requestPreviewUpdate();
      };

      node.addWidget("button", "Reset", "reset", () => {
        if (confirm("Reset all color balance values?")) {
          node.resetBalanceValues();
          node.properties.preserve_luminosity = true;
          if (backendLumWidget)
            node.setWidgetValue(backendLumWidget.name, true);
          node.properties.strength = 1.0;
          if (strengthBackendWidget)
            node.setWidgetValue(strengthBackendWidget.name, 1.0);
        }
      });

      node.updateSlidersUI = () => {
        const selected = node.properties.selected_tone;
        const values = node.properties.balance_values[selected];
        node.sliderR.setValue(values.r, true);
        node.sliderG.setValue(values.g, true);
        node.sliderB.setValue(values.b, true);
        node.setDirtyCanvas(true, true);
      };

      node.updateSlidersUI();
    };

    nodeType.prototype.computeSize = function (out) {
      let size = LiteGraph.LGraphNode.prototype.computeSize.call(this, out);
      const minWidth = 300;
      const minHeight = 550;
      size[0] = Math.max(minWidth, size[0]);
      size[1] = Math.max(minHeight, size[1]);
      return size;
    };

    nodeType.prototype.drawPreviewImage = function (
      ctx,
      startY,
      sliderSpacing
    ) {
      const availableHeight = this.size[1] - 310;
      const previewSize = Math.min(this.size[0] * 0.95, availableHeight);
      const previewCenterX = this.size[0] / 2.0;
      const y = startY + 3 * sliderSpacing + 135;

      if (this._previewImage && this._previewImage.complete) {
        const img = this._previewImage;
        const aspect = img.width / img.height;

        let drawWidth, drawHeight;

        if (aspect >= 1) {
          drawWidth = previewSize;
          drawHeight = previewSize / aspect;
        } else {
          drawHeight = previewSize;
          drawWidth = previewSize * aspect;
        }

        const drawX = previewCenterX - drawWidth / 2;
        const drawY = y + (previewSize - drawHeight) / 2;

        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

        ctx.strokeStyle = "#888";
        ctx.lineWidth = 1;
        ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = "#AAA";
        ctx.font = "12px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillText(
          "Run the graph once to generate preview.",
          previewCenterX,
          y + previewSize / 2 - 10
        );
        ctx.fillText(
          "Note: requires output connection to function.",
          previewCenterX,
          y + previewSize / 2 + 10
        );
        ctx.restore();
      }
      ctx.restore();
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
      originalOnDrawForeground?.call(this, ctx);
      if (this.flags.collapsed) return;

      ctx.save();
      const widgetHeight = this.widgets
        .filter((w) => !w.hidden && typeof w.computeSize === "function")
        .reduce((acc, w) => acc + w.computeSize([this.size[0]])[1], 0);

      const startY = widgetHeight + 40;
      const sliderSpacing = 40;

      [this.sliderR, this.sliderG, this.sliderB].forEach((slider, i) => {
        slider.width = this.size[0] * 0.85;
        slider.x = this.size[0] / 2.0 - slider.width / 2.0;
        slider.y = startY + i * sliderSpacing;
        ctx.save();
        ctx.translate(slider.x, slider.y);
        slider.draw(ctx);
        ctx.restore();
      });

      this.toneToggle.draw(ctx);

      this.drawPreviewImage(ctx, startY, sliderSpacing);
    };

    nodeType.prototype.onMouseDown = function (event, localPos, graphCanvas) {
      if (originalOnMouseDown?.call(this, event, localPos, graphCanvas))
        return true;
      if (this.custom_widgets) {
        for (const w of this.custom_widgets) {
          if (
            typeof w.onMouseMove === "function" &&
            w.onMouseDown(event, localPos)
          ) {
            return true;
          }
        }
      }
      return false;
    };

    nodeType.prototype.onMouseMove = function (event, localPos, graphCanvas) {
      if (originalOnMouseMove?.call(this, event, localPos, graphCanvas))
        return true;
      if (this.custom_widgets) {
        for (const w of this.custom_widgets) {
          if (
            typeof w.onMouseMove === "function" &&
            w.onMouseMove(event, localPos)
          ) {
            return true;
          }
        }
      }
      return false;
    };

    nodeType.prototype.onMouseUp = function (event, localPos, graphCanvas) {
      if (originalOnMouseUp?.call(this, event, localPos, graphCanvas))
        return true;
      if (this.custom_widgets) {
        for (const w of this.custom_widgets) {
          if (
            typeof w.onMouseMove === "function" &&
            w.onMouseUp(event, localPos)
          ) {
            return true;
          }
        }
      }
      return false;
    };

    nodeType.prototype.onMouseLeave = function (event, localPos, graphCanvas) {
      if (originalOnMouseLeave?.call(this, event, localPos, graphCanvas))
        return true;

      if (this.custom_widgets) {
        for (const w of this.custom_widgets) {
          if (
            typeof w.onMouseMove === "function" &&
            w.onMouseUp &&
            w.onMouseUp(event, localPos)
          ) {
            return true;
          }
        }
      }
      return false;
    };

    nodeType.prototype.forceUpdate = function () {
      const version_widget = this.getWidget("version");
      if (version_widget) {
        this.setWidgetValue(version_widget.name, Date.now());
      }
    };

    nodeType.prototype.onConfigure = function (info) {
      originalOnConfigure?.call(this, info);

      if (this.properties.balance_values) {
        queueMicrotask(() => {
          if (this.updateSlidersUI) {
            this.updateSlidersUI();
          }
        });
      }

      this.setWidgetValue(
        this.preserveLuminosityWidget.name,
        this.properties.preserve_luminosity
      );

      if (this.toneToggle && this.properties.selected_tone) {
        this.selectedTone = this.properties.selected_tone;
        this.toneToggle.setTone(this.selectedTone);
      }

      this.setWidgetValue(this.strengthWidget.name, this.properties.strength);

      removeInputs(
        this,
        (input) =>
          input.type === "FLOAT" ||
          input.type === "STRING" ||
          input.type === "BOOLEAN"
      );

      this.forceUpdate();
      this.setDirtyCanvas(true, true);
    };

    nodeType.prototype.onAdded = function () {
      removeInputs(
        this,
        (input) =>
          input.type === "FLOAT" ||
          input.type === "STRING" ||
          input.type === "BOOLEAN"
      );
    };

    nodeType.prototype.onExecuted = function (message) {
      onExecutedOriginal?.apply(this, arguments);

      let key = message?.cache_key;
      if (Array.isArray(key)) key = key.join("");

      if (typeof key === "string") {
        this.previewCacheKey = key;
        this.requestPreviewUpdate();
      } else {
        console.warn(
          `[OlmColorBalance] Node ${this.id}: Invalid cache key in onExecuted:`,
          key
        );
      }
    };
  },
});
