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
    // A transparent corner is evidence of an already-transparent source, not a white background.
    const corners = [0, width - 1, (height - 1) * width, width * height - 1];
    if (
      mode === "none" ||
      (mode === "auto" && corners.some((i) => data[i * 4 + 3] === 0))
    )
      return mask;
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
        if (
          (data[i * 4 + 3] === 0 || data[i * 4 + 3] === 255) &&
          near(data, i * 4, color, tolerance)
        ) {
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
  // Preview-only proposal. Change alpha on one exposed opaque matte rim;
  // never recolor artwork, flood further inward or modify existing partial alpha.
  function proposeMatteCleanup(
    image,
    mask,
    mode,
    tolerance = 24,
    custom = "#ffffff",
  ) {
    const { width, height, data } = image,
      result = mask.slice();
    if (
      mode === "none" ||
      (mode === "auto" &&
        [0, width - 1, (height - 1) * width, width * height - 1].some(
          (i) => data[i * 4 + 3] === 0,
        ))
    )
      return { mask: result, changed: 0 };
    const color =
      mode === "white"
        ? [255, 255, 255]
        : mode === "custom"
          ? [1, 3, 5].map((i) => parseInt(custom.slice(i, i + 2), 16))
          : backgroundColor(data, width, height);
    let changed = 0;
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (data[i * 4 + 3] !== 255 || mask[i] !== 255) continue;
        const exposed = [i - 1, i + 1, i - width, i + width].filter(
          (n) => mask[n] === 0,
        ).length;
        if (exposed < 2) continue;
        const distance = Math.max(
          ...color.map((c, k) => Math.abs(data[i * 4 + k] - c)),
        );
        if (distance <= tolerance || distance >= tolerance + 32) continue;
        result[i] = Math.max(
          1,
          Math.round((255 * (distance - tolerance)) / 32),
        );
        changed++;
      }
    return { mask: result, changed };
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
  function tileRect(source, column, row) {
    const { xs, ys, image } = source;
    const left = Math.round(xs[column] * image.width);
    const rowLines = source.columnYs?.[column] || ys;
    const top = Math.round(rowLines[row] * image.height);
    const right = Math.round(xs[column + 1] * image.width);
    const bottom = Math.round(rowLines[row + 1] * image.height);
    const inset = source.insets || { left: 0, right: 0, top: 0, bottom: 0 };
    const x = Math.min(
      right - 1,
      left + Math.ceil(((right - left) * inset.left) / 100),
    );
    const y = Math.min(
      bottom - 1,
      top + Math.ceil(((bottom - top) * inset.top) / 100),
    );
    return {
      x,
      y,
      width: Math.max(
        1,
        right - Math.ceil(((right - left) * inset.right) / 100) - x,
      ),
      height: Math.max(
        1,
        bottom - Math.ceil(((bottom - top) * inset.bottom) / 100) - y,
      ),
    };
  }
  function isolateRect(image, rect) {
    // First copy integer pixels at 1:1. drawImage(source, sx, sy, sw, sh, ...) can
    // sample neighbouring pixels outside that source rectangle when interpolating.
    const isolated = canvas(rect.width, rect.height);
    isolated.getContext("2d").drawImage(image, -rect.x, -rect.y);
    return isolated;
  }
  // Locate nearly blank gutters close to the expected grid positions.
  // Only return strong suggestions; uncertain sheets keep their manual grid.
  function suggestGridLines(image, columns, rows) {
    const width = image.width, height = image.height;
    if (!columns || !rows || width < columns * 20 || height < rows * 20)
      return null;
    const sample = canvas(width, height);
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    sample.width = sample.height = 1;
    const cornerIndices = [0, width - 1, (height - 1) * width, width * height - 1];
    const corners = cornerIndices.map((i) => Array.from(pixels.slice(i * 4, i * 4 + 3)));
    const background = corners[0];
    // A nonuniform border cannot safely establish the background color.
    if (corners.some((c) => c.some((v, i) => Math.abs(v - background[i]) > 18)))
      return null;
    const isInk = (x, y) => {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 16) return false;
      return Math.max(
        Math.abs(pixels[i] - background[0]),
        Math.abs(pixels[i + 1] - background[1]),
        Math.abs(pixels[i + 2] - background[2]),
      ) > 30;
    };
    function line(axis, index, total, count) {
      const nominal = Math.round((index * total) / count);
      const cross = axis === "x" ? height : width;
      const step = Math.max(1, Math.floor(cross / 600));
      const start = Math.max(1, nominal - Math.max(2, Math.round((total / count) * 0.16)));
      const end = Math.min(total - 2, nominal + Math.max(2, Math.round((total / count) * 0.16)));
      const blank = [];
      for (let pos = start; pos <= end; pos++) {
        let ink = 0, samples = 0;
        for (let other = 0; other < cross; other += step) {
          const x = axis === "x" ? pos : other;
          const y = axis === "x" ? other : pos;
          if (isInk(x, y)) ink++;
          samples++;
        }
        blank.push(ink / samples <= 0.003);
      }
      // Choose the center of a blank corridor, not its edge. This preserves
      // nearby ears, paws and decorations and avoids spurious boundary alerts.
      let best = null;
      for (let i = 0; i < blank.length;) {
        if (!blank[i]) { i++; continue; }
        let j = i;
        while (j + 1 < blank.length && blank[j + 1]) j++;
        const center = Math.round((i + j) / 2) + start;
        const candidate = { center, length: j - i + 1 };
        if (!best || candidate.length > best.length ||
          (candidate.length === best.length &&
            Math.abs(center - nominal) < Math.abs(best.center - nominal)))
          best = candidate;
        i = j + 1;
      }
      const minCorridor = Math.max(3, Math.round(total / count * 0.015));
      return best && best.length >= minCorridor ? best.center / total : null;
    }
    const xs = [0], ys = [0];
    for (let i = 1; i < columns; i++) {
      const x = line("x", i, width, columns);
      if (x === null) return null;
      xs.push(x);
    }
    for (let i = 1; i < rows; i++) {
      const y = line("y", i, height, rows);
      if (y === null) return null;
      ys.push(y);
    }
    xs.push(1); ys.push(1);
    return { xs, ys };
  }
  // Find a safe horizontal gutter separately in each column. Sticker artwork
  // can be vertically staggered, so a single row boundary may cut another cat.
  function suggestColumnRowLines(image, xs, rows) {
    const width = image.width, height = image.height;
    const sample = canvas(width, height);
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    sample.width = sample.height = 1;
    const corners = [0, width - 1, width * (height - 1), width * height - 1];
    const bg = [data[0], data[1], data[2]];
    if (corners.some((p) => [0,1,2].some((k) => Math.abs(data[p*4+k]-bg[k]) > 18)))
      return null;
    const lines = [];
    for (let c = 0; c < xs.length - 1; c++) {
      const x0 = Math.round(xs[c] * width), x1 = Math.round(xs[c+1] * width);
      const perColumn = [0];
      for (let r = 1; r < rows; r++) {
        const nominal = Math.round(r * height / rows);
        // Search around the expected divider, not inside neighboring artwork.
        const start = Math.max(1, nominal - Math.round(height / rows * 0.26));
        const end = Math.min(height - 2, nominal + Math.round(height / rows * 0.26));
        // Count foreground pixels in each scanline. A true gutter must
        // separate two foreground groups, not just pass through a letter.
        const densities = [];
        const step = Math.max(1, Math.floor((x1 - x0) / 500));
        for (let y = start; y <= end; y++) {
          let ink = 0, count = 0;
          for (let x = x0; x < x1; x += step) {
            const i = (y * width + x) * 4;
            if (data[i + 3] > 16 && Math.max(
              Math.abs(data[i] - bg[0]),
              Math.abs(data[i + 1] - bg[1]),
              Math.abs(data[i + 2] - bg[2])
            ) > 65) ink++;
            count++;
          }
          densities.push(ink / Math.max(1, count));
        }
        const blank = densities.map((v) => v <= 0.003);
        const minLength = Math.max(5, Math.round(height / rows * 0.018));
        const maxDrift = Math.round(height / rows * 0.24);
        const look = Math.max(8, Math.round(height / rows * 0.09));
        let best = null;
        for (let i = 0; i < blank.length;) {
          if (!blank[i]) { i++; continue; }
          let j = i;
          while (j + 1 < blank.length && blank[j + 1]) j++;
          const center = start + Math.round((i + j) / 2);
          const length = j - i + 1;
          const distance = Math.abs(center - nominal);
          if (length >= minLength && distance <= maxDrift) {
            // Inspect the image on both sides of the proposed boundary.
            // An empty interior gap in a caption or drawing is unsafe.
            const upper = densities.slice(Math.max(0, i - look), i);
            const lower = densities.slice(j + 1, Math.min(densities.length, j + 1 + look));
            const upperInk = upper.reduce((a, b) => a + b, 0);
            const lowerInk = lower.reduce((a, b) => a + b, 0);
            const hasBothGroups = upperInk >= 0.02 && lowerInk >= 0.02;
            // Prefer a broad empty corridor between actual groups.
            if (hasBothGroups) {
              const score = length - distance * 0.08 +
                Math.min(upperInk, lowerInk) * 4;
              if (!best || score > best.score)
                best = { center, length, score };
            }
          }
          i = j + 1;
        }
        // Never guess a boundary if there is no defensible separation.
        if (!best) return null;
        perColumn.push(best.center / height);
      }
      perColumn.push(1);
      if (perColumn.some((v,i)=>i>0 && v<=perColumn[i-1])) return null;
      lines.push(perColumn);
    }
    return lines;
  }
  // A source-grid cut through visible artwork needs a human ownership check.
  // This is diagnostic only: never erase thin antennae, lettering or decorations.
  function tileBoundaryReview(mask, width, height) {
    const band = Math.max(2, Math.ceil(Math.min(width, height) * 0.015));
    const edges = [];
    const count = (side) => {
      let pixels = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (side === "left" && x >= band) continue;
          if (side === "right" && x < width - band) continue;
          if (side === "top" && y >= band) continue;
          if (side === "bottom" && y < height - band) continue;
          if (mask[y * width + x] > 0) pixels++;
        }
      return pixels;
    };
    for (const side of ["left", "right", "top", "bottom"])
      if (count(side) >= 2) edges.push(side);
    return { needsReview: edges.length > 0, edges };
  }
  function createTile(source, column, row, mode, tolerance, color) {
    const rect = tileRect(source, column, row);
    // Keep the source layer at up to 600px, rather than repeatedly enlarging a 250px image.
    const scale = Math.min(1, 600 / Math.max(rect.width, rect.height));
    const crop = canvas(
      Math.max(1, Math.round(rect.width * scale)),
      Math.max(1, Math.round(rect.height * scale)),
    );
    const ctx = crop.getContext("2d", { willReadFrequently: true });
    const isolated = isolateRect(source.image, rect);
    ctx.drawImage(isolated, 0, 0, crop.width, crop.height);
    isolated.width = isolated.height = 1;
    const original = ctx.getImageData(0, 0, crop.width, crop.height);
    const mask = floodMask(original, mode, tolerance, color);
    crop.width = crop.height = 1;
    const boundaryReview = tileBoundaryReview(mask, original.width, original.height);
    return {
      sourceRect: { ...rect },
      boundaryReview,
      original,
      mask,
      autoMask: mask.slice(),
      caption: "",
      crop: { left: 0, right: 0, top: 0, bottom: 0 },
      layout: { scale: 90, x: 50, y: 50 },
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
      redo: [],
    };
  }
  function stampCrop(stamp) {
    const { width, height } = stamp.original;
    const crop = stamp.crop || { left: 0, right: 0, top: 0, bottom: 0 };
    const x = Math.ceil((width * crop.left) / 100),
      y = Math.ceil((height * crop.top) / 100);
    return {
      x,
      y,
      width: Math.max(1, width - Math.ceil((width * crop.right) / 100) - x),
      height: Math.max(1, height - Math.ceil((height * crop.bottom) / 100) - y),
    };
  }
  function maskBounds(
    mask,
    width,
    height,
    rect = { x: 0, y: 0, width, height },
  ) {
    let left = width,
      right = -1,
      top = height,
      bottom = -1;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        if (mask[y * width + x]) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    return right < 0
      ? null
      : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }
  function baseImagePlacement(stamp) {
    if (stamp.activePlacement) return stamp.activePlacement;
    const margin = stamp.style?.safeMargin === 20 ? 20 : MARGIN;
    const crop = stampCrop(stamp);
    const bounds =
      maskBounds(
        stamp.mask,
        stamp.original.width,
        stamp.original.height,
        crop,
      ) || crop;
    const layout = stamp.layout || { scale: 90, x: 50, y: 50 };
    const ratio =
      (Math.min(
        (WIDTH - margin * 2) / bounds.width,
        (HEIGHT - margin * 2) / bounds.height,
      ) *
        Math.max(20, Math.min(100, layout.scale))) /
      100;
    const width = bounds.width * ratio,
      height = bounds.height * ratio;
    const x =
      margin +
      ((WIDTH - margin * 2 - width) * Math.max(0, Math.min(100, layout.x))) /
        100;
    const y =
      margin +
      ((HEIGHT - margin * 2 - height) * Math.max(0, Math.min(100, layout.y))) /
        100;
    return {
      crop,
      bounds,
      ratio,
      offsetX: x - bounds.x * ratio,
      offsetY: y - bounds.y * ratio,
    };
  }
  function imagePlacement(stamp) {
    if (stamp.activePlacement) return stamp.activePlacement;
    if (
      root.StampTypography &&
      stamp.caption?.trim() &&
      root.StampTypography.resolve(stamp.caption, stamp.style).autoPlace
    ) {
      const result = renderStamp(stamp);
      result.canvas.width = result.canvas.height = 1;
      return result.imagePlacement;
    }
    return baseImagePlacement(stamp);
  }
  function applyBrush(stamp, x, y, radius, mode) {
    const p = imagePlacement(stamp),
      crop = p.crop;
    const sx = (x - p.offsetX) / p.ratio,
      sy = (y - p.offsetY) / p.ratio,
      sr = radius / p.ratio;
    for (
      let py = Math.max(crop.y, Math.floor(sy - sr));
      py < Math.min(crop.y + crop.height, Math.ceil(sy + sr));
      py++
    ) {
      for (
        let px = Math.max(crop.x, Math.floor(sx - sr));
        px < Math.min(crop.x + crop.width, Math.ceil(sx + sr));
        px++
      ) {
        if ((px - sx) ** 2 + (py - sy) ** 2 <= sr ** 2) {
          const i = py * stamp.original.width + px;
          stamp.mask[i] =
            mode === "restore" ? stamp.original.data[i * 4 + 3] : 0;
        }
      }
    }
  }
  function renderBefore(stamp, target = canvas(WIDTH, HEIGHT)) {
    target.width = WIDTH;
    target.height = HEIGHT;
    const layer = canvas(stamp.original.width, stamp.original.height);
    layer.getContext("2d").putImageData(stamp.original, 0, 0);
    const ratio = Math.min(350 / layer.width, 300 / layer.height);
    target
      .getContext("2d")
      .drawImage(
        layer,
        (WIDTH - layer.width * ratio) / 2,
        (HEIGHT - layer.height * ratio) / 2,
        layer.width * ratio,
        layer.height * ratio,
      );
    layer.width = layer.height = 1;
    return target;
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
  function clearAutomaticLines(ctx, stamp) {
    if (stamp.cleanupEnabled === false || !root.StampResidue?.automaticLines)
      return [];
    const lines = root.StampResidue.automaticLines(
      ctx.getImageData(0, 0, WIDTH, HEIGHT),
    );
    for (const line of lines)
      ctx.clearRect(line.x, line.y, line.width, line.height);
    return lines;
  }
  function renderUncleaned(stamp, target = canvas(WIDTH, HEIGHT)) {
    return renderStamp({ ...stamp, cleanupEnabled: false }, target);
  }
  function renderStamp(stamp, target = canvas(WIDTH, HEIGHT)) {
    const margin = stamp.style?.safeMargin === 20 ? 20 : MARGIN;
    target.width = WIDTH;
    target.height = HEIGHT;
    const ctx = target.getContext("2d", { willReadFrequently: true });
    const { width, height } = stamp.original;
    const data = new ImageData(
      new Uint8ClampedArray(stamp.original.data),
      width,
      height,
    );
    for (let i = 0; i < stamp.mask.length; i++)
      data.data[i * 4 + 3] = stamp.mask[i];
    const layer = canvas(width, height);
    layer.getContext("2d").putImageData(data, 0, 0);
    const selectedCrop = stampCrop(stamp);
    const croppedLayer =
      selectedCrop.x ||
      selectedCrop.y ||
      selectedCrop.width !== width ||
      selectedCrop.height !== height
        ? isolateRect(layer, selectedCrop)
        : layer;
    if (root.StampTypography) {
      const T = root.StampTypography,
        base = baseImagePlacement(stamp);
      function drawArt(p) {
        const art = canvas(WIDTH, HEIGHT),
          context = art.getContext("2d"),
          crop = p.crop;
        context.save();
        context.beginPath();
        context.rect(margin, margin, WIDTH - margin * 2, HEIGHT - margin * 2);
        context.clip();
        context.drawImage(
          croppedLayer,
          0,
          0,
          croppedLayer.width,
          croppedLayer.height,
          p.offsetX + crop.x * p.ratio,
          p.offsetY + crop.y * p.ratio,
          crop.width * p.ratio,
          crop.height * p.ratio,
        );
        context.restore();
        return art;
      }
      const art = drawArt(base);
      let finalArt = art,
        plan = null,
        placement = base;
      if (stamp.caption.trim()) {
        if (stamp.activePlacement && stamp.renderTextPlan)
          plan = stamp.renderTextPlan;
        else {
          const result = T.compose(stamp.caption, stamp.style, art, (t) =>
            drawArt({
              ...base,
              ratio: base.ratio * t.scale,
              offsetX: base.offsetX * t.scale + t.x,
              offsetY: base.offsetY * t.scale + t.y,
            }),
          );
          finalArt = result.art;
          plan = result.plan;
          placement = {
            ...base,
            ratio: base.ratio * result.transform.scale,
            offsetX: base.offsetX * result.transform.scale + result.transform.x,
            offsetY: base.offsetY * result.transform.scale + result.transform.y,
          };
        }
      }
      ctx.drawImage(finalArt, 0, 0);
      const autoRemoved = clearAutomaticLines(ctx, stamp);
      if (plan) T.paintPlan(ctx, plan);
      stamp.renderTextPlan = plan;
      const bounds = alphaBounds(
        ctx.getImageData(0, 0, WIDTH, HEIGHT).data,
        WIDTH,
        HEIGHT,
      );
      if (croppedLayer !== layer) croppedLayer.width = croppedLayer.height = 1;
      layer.width = layer.height = art.width = art.height = 1;
      if (finalArt !== art) finalArt.width = finalArt.height = 1;
      return {
        canvas: target,
        bounds,
        empty: !bounds,
        textClipped: plan?.clipped || false,
        textOverlap: plan?.overlapPixels || 0,
        textAutoScaled: plan?.autoScaled || false,
        effectiveFontSize: plan?.style.size || stamp.style.size,
        imagePlacement: placement,
        textPlan: plan,
        autoRemoved,
      };
    }
    const p = baseImagePlacement(stamp),
      crop = p.crop;
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN, MARGIN, WIDTH - MARGIN * 2, HEIGHT - MARGIN * 2);
    ctx.clip();
    ctx.drawImage(
      croppedLayer,
      0,
      0,
      croppedLayer.width,
      croppedLayer.height,
      p.offsetX + crop.x * p.ratio,
      p.offsetY + crop.y * p.ratio,
      crop.width * p.ratio,
      crop.height * p.ratio,
    );
    ctx.restore();
    if (croppedLayer !== layer) croppedLayer.width = croppedLayer.height = 1;
    layer.width = layer.height = 1;
    const autoRemoved = clearAutomaticLines(ctx, stamp);
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
    return {
      canvas: target,
      textClipped,
      empty: !bounds,
      bounds,
      autoRemoved,
      imagePlacement: p,
    };
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
    rendered.canvas.width = rendered.canvas.height = 1;
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
    proposeMatteCleanup,
    alphaBounds,
    createTile,
    isolateRect,
    tileRect,
    suggestGridLines,
    suggestColumnRowLines,
    tileBoundaryReview,
    stampCrop,
    maskBounds,
    imagePlacement,
    applyBrush,
    renderBefore,
    renderStamp,
    renderUncleaned,
    specialImage,
    pngBlob,
    crc32,
    makeZip,
    wrapText,
  };
  root.StampCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
