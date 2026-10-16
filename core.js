/* Browser-only image processing and dependency-free, uncompressed ZIP writer. */
(function (root) {
  "use strict";
  const WIDTH = 370,
    HEIGHT = 320,
    MARGIN = 10;
  const FONTS = {
    sans: '-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif',
    serif: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif',
    rounded: '"Hiragino Maru Gothic ProN", "Yu Gothic", Meiryo, sans-serif',
  };
  function canvas(width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  }
  function near(data, p, color, tolerance) {
    return (
      data[p + 3] === 0 ||
      Math.max(
        Math.abs(data[p] - color[0]),
        Math.abs(data[p + 1] - color[1]),
        Math.abs(data[p + 2] - color[2]),
      ) <= tolerance
    );
  }
  function backgroundColor(data, width, height) {
    const points = [
      0,
      (width - 1) * 4,
      (height - 1) * width * 4,
      (width * height - 1) * 4,
    ];
    const colors = points
      .filter((p) => data[p + 3] > 0)
      .map((p) => Array.from(data.slice(p, p + 3)));
    if (!colors.length) return [255, 255, 255];
    let best = colors[0],
      score = -1;
    for (const color of colors) {
      const count = colors.filter((c) =>
        c.every((v, i) => Math.abs(v - color[i]) <= 24),
      ).length;
      if (count > score) {
        best = color;
        score = count;
      }
    }
    return best;
  }
  function floodMask(
    imageData,
    mode = "auto",
    tolerance = 24,
    custom = "#ffffff",
  ) {
    const { data, width, height } = imageData;
    const mask = new Uint8ClampedArray(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3];
    if (mode === "none") return mask;
    const color =
      mode === "white"
        ? [255, 255, 255]
        : mode === "custom"
          ? [1, 3, 5].map((i) => parseInt(custom.slice(i, i + 2), 16))
          : backgroundColor(data, width, height);
    const seen = new Uint8Array(width * height),
      queue = new Uint32Array(width * height);
    let head = 0,
      tail = 0;
    function visit(i) {
      if (!seen[i]) {
        seen[i] = 1;
        if (near(data, i * 4, color, tolerance)) {
          queue[tail++] = i;
          mask[i] = 0;
        }
      }
    }
    for (let x = 0; x < width; x++) {
      visit(x);
      visit((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      visit(y * width);
      visit(y * width + width - 1);
    }
    while (head < tail) {
      const i = queue[head++],
        x = i % width;
      if (x > 0) visit(i - 1);
      if (x + 1 < width) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i + width < mask.length) visit(i + width);
    }
    return mask;
  }
  function alphaBounds(data, width, height) {
    let left = width,
      right = -1,
      top = height,
      bottom = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 0) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    return right < 0
      ? null
      : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }
  function createTile(source, column, row, mode, tolerance, color) {
    const { xs, ys, image } = source;
    const sx = Math.round(xs[column] * image.width),
      sy = Math.round(ys[row] * image.height);
    const sw = Math.round(xs[column + 1] * image.width) - sx,
      sh = Math.round(ys[row + 1] * image.height) - sy;
    // Remove the background before resizing, so transparent padding cannot affect corner sampling.
    const scale = Math.min(1, 600 / Math.max(sw, sh));
    const crop = canvas(
      Math.max(1, Math.round(sw * scale)),
      Math.max(1, Math.round(sh * scale)),
    );
    const cropContext = crop.getContext("2d", { willReadFrequently: true });
    cropContext.drawImage(image, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
    const cropData = cropContext.getImageData(0, 0, crop.width, crop.height);
    const cropMask = floodMask(cropData, mode, tolerance, color);
    const art = canvas(WIDTH, HEIGHT),
      clean = canvas(crop.width, crop.height);
    const cleanContext = clean.getContext("2d");
    const cleaned = new ImageData(
      new Uint8ClampedArray(cropData.data),
      crop.width,
      crop.height,
    );
    for (let i = 0; i < cropMask.length; i++)
      cleaned.data[i * 4 + 3] = cropMask[i];
    cleanContext.putImageData(cleaned, 0, 0);
    const ratio = Math.min(350 / crop.width, 250 / crop.height);
    const w = Math.max(1, Math.round(crop.width * ratio)),
      h = Math.max(1, Math.round(crop.height * ratio));
    const x = Math.round((WIDTH - w) / 2),
      y = MARGIN + Math.round((250 - h) / 2);
    const ctx = art.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(crop, x, y, w, h);
    const original = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(clean, x, y, w, h);
    const initial = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const mask = new Uint8ClampedArray(WIDTH * HEIGHT);
    for (let i = 0; i < mask.length; i++) mask[i] = initial.data[i * 4 + 3];
    return {
      original,
      mask,
      autoMask: mask.slice(),
      caption: "",
      style: {
        font: "sans",
        size: 32,
        x: 50,
        y: 84,
        color: "#293c33",
        outline: true,
      },
      reviewed: false,
      undo: [],
    };
  }
  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      const chars =
        typeof Intl.Segmenter === "function"
          ? Array.from(
              new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(
                paragraph,
              ),
              (s) => s.segment,
            )
          : Array.from(paragraph);
      for (const char of chars) {
        if (line && ctx.measureText(line + char).width > maxWidth) {
          lines.push(line);
          line = char;
        } else line += char;
      }
      lines.push(line);
    }
    return lines;
  }
  function renderStamp(stamp, target = canvas(WIDTH, HEIGHT)) {
    target.width = WIDTH;
    target.height = HEIGHT;
    const ctx = target.getContext("2d", { willReadFrequently: true });
    const data = new ImageData(
      new Uint8ClampedArray(stamp.original.data),
      WIDTH,
      HEIGHT,
    );
    for (let i = 0; i < stamp.mask.length; i++)
      data.data[i * 4 + 3] = stamp.mask[i];
    ctx.putImageData(data, 0, 0);
    let textClipped = false;
    if (stamp.caption.trim()) {
      const s = stamp.style,
        stroke = s.outline ? Math.max(3, s.size / 6) : 0;
      ctx.font = `700 ${s.size}px ${FONTS[s.font] || FONTS.sans}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const x = (WIDTH * s.x) / 100,
        y = (HEIGHT * s.y) / 100;
      const maxWidth = Math.max(
        s.size,
        2 * Math.min(x - MARGIN - stroke, WIDTH - MARGIN - x - stroke),
      );
      const lines = wrapText(ctx, stamp.caption, maxWidth),
        lineHeight = s.size * 1.25;
      const firstY = y - ((lines.length - 1) * lineHeight) / 2;
      // Detect actual ink bounds, including strokes, before applying the mandatory transparent margin.
      for (let i = 0; i < lines.length; i++) {
        const m = ctx.measureText(lines[i]),
          cy = firstY + i * lineHeight;
        const left = x - (m.actualBoundingBoxLeft ?? m.width / 2) - stroke / 2;
        const right =
          x + (m.actualBoundingBoxRight ?? m.width / 2) + stroke / 2;
        const top = cy - (m.actualBoundingBoxAscent ?? s.size / 2) - stroke / 2;
        const bottom =
          cy + (m.actualBoundingBoxDescent ?? s.size / 2) + stroke / 2;
        if (
          left < MARGIN ||
          right > WIDTH - MARGIN ||
          top < MARGIN ||
          bottom > HEIGHT - MARGIN
        )
          textClipped = true;
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(MARGIN, MARGIN, WIDTH - 2 * MARGIN, HEIGHT - 2 * MARGIN);
      ctx.clip();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = stroke;
      ctx.fillStyle = s.color;
      lines.forEach((line, i) => {
        if (s.outline) ctx.strokeText(line, x, firstY + i * lineHeight);
        ctx.fillText(line, x, firstY + i * lineHeight);
      });
      ctx.restore();
    }
    const pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const bounds = alphaBounds(pixels.data, WIDTH, HEIGHT);
    return { canvas: target, textClipped, empty: !bounds, bounds };
  }
  function specialImage(stamp, width, height) {
    const rendered = renderStamp(stamp),
      output = canvas(width, height),
      ctx = output.getContext("2d");
    const bounds = rendered.bounds;
    if (bounds) {
      const ratio = Math.min(
        (width - 20) / bounds.width,
        (height - 20) / bounds.height,
      );
      const w = Math.max(1, Math.round(bounds.width * ratio)),
        h = Math.max(1, Math.round(bounds.height * ratio));
      ctx.drawImage(
        rendered.canvas,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        Math.floor((width - w) / 2),
        Math.floor((height - h) / 2),
        w,
        h,
      );
    }
    return output;
  }
  function pngBlob(c) {
    return new Promise((resolve, reject) =>
      c.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(
                new Error(
                  "PNGを作成できませんでした。画像サイズやメモリを確認してください。",
                ),
              ),
        "image/png",
      ),
    );
  }
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function makeZip(files) {
    const chunks = [],
      central = [];
    let offset = 0;
    const encoder = new TextEncoder();
    for (const file of files) {
      const name = encoder.encode(file.name),
        bytes = new Uint8Array(await file.blob.arrayBuffer()),
        crc = crc32(bytes);
      const local = new Uint8Array(30 + name.length),
        v = new DataView(local.buffer);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x0800, true);
      v.setUint16(12, 0x0021, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, bytes.length, true);
      v.setUint32(22, bytes.length, true);
      v.setUint16(26, name.length, true);
      local.set(name, 30);
      const entry = new Uint8Array(46 + name.length),
        e = new DataView(entry.buffer);
      e.setUint32(0, 0x02014b50, true);
      e.setUint16(4, 20, true);
      e.setUint16(6, 20, true);
      e.setUint16(8, 0x0800, true);
      e.setUint16(14, 0x0021, true);
      e.setUint32(16, crc, true);
      e.setUint32(20, bytes.length, true);
      e.setUint32(24, bytes.length, true);
      e.setUint16(28, name.length, true);
      e.setUint32(42, offset, true);
      entry.set(name, 46);
      chunks.push(local, bytes);
      central.push(entry);
      offset += local.length + bytes.length;
    }
    const centralSize = central.reduce((sum, e) => sum + e.length, 0),
      end = new Uint8Array(22),
      e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, centralSize, true);
    e.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: "application/zip" });
  }
  const api = {
    WIDTH,
    HEIGHT,
    MARGIN,
    FONTS,
    canvas,
    backgroundColor,
    floodMask,
    alphaBounds,
    createTile,
    renderStamp,
    specialImage,
    pngBlob,
    crc32,
    makeZip,
    wrapText,
  };
  root.StampCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
