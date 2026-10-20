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
  function closeContour(ink, width, height, radius) {
    const w = width + radius * 4, h = height + radius * 4;
    let field = new Uint8Array(w * h);
    for (let y = 0; y < height; y++)
      field.set(ink.subarray(y * width, (y + 1) * width),
        (y + radius * 2) * w + radius * 2);
    for (const dilate of [true, false]) {
      for (const horizontal of [true, false]) {
        const next = new Uint8Array(field.length);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let value = dilate ? 0 : 1;
          for (let d = -radius; d <= radius; d++) {
            const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d;
            const v = xx >= 0 && xx < w && yy >= 0 && yy < h ? field[yy * w + xx] : 0;
            value = dilate ? Math.max(value, v) : Math.min(value, v);
          }
          next[y * w + x] = value;
        }
        field = next;
      }
    }
    const result = new Uint8Array(ink.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
      result[y * width + x] = ink[y * width + x] ||
        field[(y + radius * 2) * w + x + radius * 2];
    return result;
  }
  // A drawing can end on a flat baseline without a painted bottom outline.
  // Seal that baseline only when a substantial connected contour has separate
  // vertical terminations at the same level. Never join unrelated components.
  function sealFlatBaseline(ink, width, height, radius) {
    const sealed = ink.slice(), seen = new Uint8Array(ink.length), queue = new Uint32Array(ink.length);
    let caps = 0;
    for (let seed = 0; seed < ink.length; seed++) {
      if (!ink[seed] || seen[seed]) continue;
      let head = 0, tail = 1, left = width, right = 0, top = height, bottom = 0;
      queue[0] = seed; seen[seed] = 1;
      while (head < tail) {
        const p = queue[head++], x = p % width, y = Math.floor(p / width);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, q = yy * width + xx;
          if (xx < 0 || xx >= width || yy < 0 || yy >= height || !ink[q] || seen[q]) continue;
          seen[q] = 1; queue[tail++] = q;
        }
      }
      if (right - left < width * 0.2 || bottom - top < height * 0.25) continue;
      const band = Math.max(radius * 2 + 1, Math.round((bottom - top) * 0.025)), terminations = new Uint8Array(width);
      for (let j = 0; j < tail; j++) {
        const p = queue[j], y = Math.floor(p / width);
        if (y >= bottom - band) terminations[p % width]++;
      }
      // Require vertical support, not a lone JPEG speck at the bottom.
      const ends = [];
      for (let x = left; x <= right; x++)
        if (terminations[x] >= Math.max(2, Math.ceil(band / 2))) ends.push(x);
      if (ends.length < 2) continue;
      const x0 = ends[0], x1 = ends[ends.length - 1];
      if (x1 - x0 < (right - left) * 0.25) continue;
      let gap = 0;
      for (let x = x0; x <= x1; x++) if (!terminations[x]) gap++;
      // A mostly painted baseline needs no cap. A small exterior gap next
      // to a coloured body and a nearby motion line must stay transparent.
      if (gap < (x1 - x0 + 1) * 0.35) continue;
      caps++;
      for (let x = x0; x <= x1; x++) sealed[bottom * width + x] = 1;
      // Link terminations that stop a couple of antialiased pixels earlier.
      for (const x of ends) for (let y = bottom - band; y <= bottom; y++)
        sealed[y * width + x] = 1;
    }
    sealed.baselineCaps = caps;
    return sealed;
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
    // Close small breaks in the foreground contour BEFORE exterior flooding.
    // This is a topological barrier, never a new painted foreground layer.
    // No component-size filtering: detached text, hearts and motion lines count
    // exactly like the main subject. No directional white-pixel restoration.
    const opaque = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++)
      opaque[i] = data[i * 4 + 3] > 0 &&
        (data[i * 4 + 3] !== 255 || !near(data, i * 4, color, tolerance)) ? 1 : 0;
    const radius = Math.max(1, Math.min(3, Math.round(Math.min(width, height) / 250)));
    const barrier = sealFlatBaseline(closeContour(opaque, width, height, radius), width, height, radius);
    const outside = new Uint8Array(mask.length),
      queue = new Uint32Array(mask.length);
    let head = 0, tail = 0;
    const visit = (i) => {
      if (!outside[i] && !barrier[i]) {
        outside[i] = 1;
        queue[tail++] = i;
      }
    };
    for (let x = 0; x < width; x++) {
      visit(x); visit((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      visit(y * width); visit(y * width + width - 1);
    }
    while (head < tail) {
      const i = queue[head++], x = i % width;
      if (x) visit(i - 1);
      if (x + 1 < width) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i + width < mask.length) visit(i + width);
    }
    for (let i = 0; i < mask.length; i++) {
      if (outside[i]) mask[i] = 0;
      // A virtual bridge seals a contour for traversal only. Do not output a
      // white bridge along its exterior; keep the enclosed white region intact.
      else if (!opaque[i] && barrier[i]) {
        const x = i % width;
        if ((x && outside[i - 1]) || (x + 1 < width && outside[i + 1]) ||
            (i >= width && outside[i - width]) ||
            (i + width < mask.length && outside[i + width])) mask[i] = 0;
      }
    }
    Object.defineProperty(mask, "baselineCaps", { value: barrier.baselineCaps });
    // Estimate coverage only on the ORIGINAL exposed rim. Never iterate inward.
    // Keep the original RGB immutable; rendering uses a sparse unmatting layer.
    const matte = [], solid = mask.slice();
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x, k = i * 4;
      if (mask[i] !== 255 || data[k + 3] !== 255) continue;
      if (![i - 1, i + 1, i - width, i + width].some(n => outside[n])) continue;
      const v = color.map((c, j) => c - data[k + j]);
      const distance = Math.max(...v.map(Math.abs));
      const chroma = Math.max(data[k], data[k + 1], data[k + 2]) -
        Math.min(data[k], data[k + 1], data[k + 2]);
      // White artwork, dark ink and coloured ornament edges are ambiguous:
      // preserve them. A neutral transition needs a nearby opaque dark core.
      if (distance <= tolerance || distance > 160 || chroma > 24) continue;
      let best = null;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        const q = yy * width + xx, p = q * 4;
        if (solid[q] !== 255 || data[p + 3] !== 255) continue;
        const f = color.map((c, j) => c - data[p + j]);
        if (Math.max(...f.map(Math.abs)) < 180) continue;
        const norm = f.reduce((sum, c) => sum + c * c, 0);
        const alpha = v.reduce((sum, c, j) => sum + c * f[j], 0) / norm;
        const residual = Math.max(...v.map((c, j) => Math.abs(c - alpha * f[j])));
        if (alpha <= 0 || alpha >= 0.95 || residual > 12) continue;
        const score = dx * dx + dy * dy + residual;
        if (!best || score < best.score) best = { alpha, score };
      }
      if (!best) continue;
      const alpha = Math.max(1, Math.round(best.alpha * 255));
      mask[i] = alpha;
      matte.push([i, ...color.map((c, j) => Math.max(0, Math.min(255,
        Math.round(c + (data[k + j] - c) * 255 / alpha))))]);
    }
    Object.defineProperty(mask, "matte", { value: matte });
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
    // Vertical dividers may need different positions on each row when text
    // and antennae are staggered. Fall back to the shared grid for old files.
    const columnLines = source.rowXs?.[row] || xs;
    const left = Math.round(columnLines[column] * image.width);
    const rowLines = source.columnYs?.[column] || ys;
    const top = Math.round(rowLines[row] * image.height);
    const right = Math.round(columnLines[column + 1] * image.width);
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
    if (rows < 2 || width < 80 || height < rows * 40) return null;
    const surface = canvas(width, height);
    const context = surface.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    surface.width = surface.height = 1;
    const cornerPixels = [0, width - 1, width * (height - 1), width * height - 1];
    const bg = [pixels[0], pixels[1], pixels[2]];
    if (cornerPixels.some(p => [0,1,2].some(k => Math.abs(pixels[p*4+k]-bg[k]) > 24))) return null;
    const cell = height / rows;
    const result = [];
    for (let col = 0; col < xs.length - 1; col++) {
      const x0 = Math.round(xs[col] * width), x1 = Math.round(xs[col+1] * width);
      const density = new Float32Array(height);
      const step = Math.max(1, Math.floor((x1-x0)/350));
      for (let y=0;y<height;y++) {
        let ink=0,total=0;
        for(let x=x0;x<x1;x+=step) {
          const p=(y*width+x)*4;
          if(pixels[p+3]>20 && Math.max(Math.abs(pixels[p]-bg[0]),
              Math.abs(pixels[p+1]-bg[1]),Math.abs(pixels[p+2]-bg[2]))>32) ink++;
          total++;
        }
        density[y]=ink/Math.max(1,total);
      }
      // Search for low-ink corridors even when compression leaves no perfectly
      // empty scanline. Optimize boundaries jointly to avoid drifting rows.
      const radius = Math.max(3,Math.round(cell*0.024));
      const smooth = new Float32Array(height);
      let sum=0;
      for(let y=0;y<height;y++){
        if(y+radius<height)sum+=density[y+radius];
        if(y-radius-1>=0)sum-=density[y-radius-1];
        smooth[y]=sum/(Math.min(height-1,y+radius)-Math.max(0,y-radius)+1);
      }
      const candidates=[];
      for(let row=1;row<rows;row++){
        const nominal=row*cell, options=[];
        const low=Math.max(1,Math.round(nominal-cell*0.43));
        const high=Math.min(height-2,Math.round(
          nominal + cell*0.43));
        for(let y=low;y<=high;y+=2){
          const left=Math.max(0,y-Math.round(cell*0.12));
          const right=Math.min(height-1,y+Math.round(cell*0.12));
          const surrounding=Math.max(smooth[left],smooth[right]);
          // Confirm this is a gap BETWEEN two stickers. White bands inside
          // lettering, or empty margins before the next drawing, are not
          // sufficient evidence for a row separator.
          const band = Math.max(4, Math.round(cell * 0.10));
          const reach = Math.max(band + 2, Math.round(cell * 0.32));
          const inkAbove = Math.max(...smooth.subarray(
            Math.max(0, y - reach), Math.max(1, y - band)));
          const inkBelow = Math.max(...smooth.subarray(
            Math.min(height - 1, y + band), Math.min(height, y + reach)));
          if (inkAbove < 0.035 || inkBelow < 0.035) continue;
          // A good gutter is pale and lies between two populated rows.
          // The cut must lie in a sustained empty corridor, not merely a
          // pale stripe inside a caption or at the top of the next sticker.
          // Real 2x5 artwork sometimes leaves only 2-10 clean scanlines.
          // Reject any cut through visible ink, but do not require a broad
          // 3.5%-of-cell gutter (which rejects every row on such sheets).
          const maxGutterInk = 0.008;
          const inkHere = density[y];
          if (inkHere > maxGutterInk) continue;
          let clearUp = 0, clearDown = 0;
          while (clearUp < cell * 0.10 && y - clearUp >= 0 &&
                 density[y - clearUp] <= maxGutterInk) clearUp++;
          while (clearDown < cell * 0.10 && y + clearDown < height &&
                 density[y + clearDown] <= maxGutterInk) clearDown++;
          const corridor = clearUp + clearDown - 1;
          if (corridor < 2) continue;
          // A long clear run near the expected boundary is preferred.
          // The two-sided ink check above excludes blank image margins.
          const score = Math.abs(y - nominal) / cell * 0.13 +
            0.7 / (corridor + 3) + smooth[y] * 0.08;
          options.push({y,score});
        }
        options.sort((a,b)=>a.score-b.score);
        // An uncertain boundary must be reviewed, never guessed from an
        // equal-height split that can include a neighbour's artwork.
        if (!options.length) return null;
        candidates.push(options.slice(0,35));
      }
      let states=[{cuts:[0],score:0}];
      for(let row=0;row<candidates.length;row++){
        const next=[];
        for(const state of states)for(const option of candidates[row]){
          const gap=option.y-state.cuts[state.cuts.length-1];
          if(gap<cell*0.56||gap>cell*1.44)continue;
          next.push({cuts:[...state.cuts,option.y],
            score:state.score+option.score+Math.abs(gap-cell)/cell*0.035});
        }
        next.sort((a,b)=>a.score-b.score);
        states=next.slice(0,45);
        if(!states.length)return null;
      }
      states=states.filter(st=>height-st.cuts[rows-1]>=cell*0.56);
      if(!states.length)return null;
      states.sort((a,b)=>a.score-b.score);
      // Select the middle of the contiguous blank corridor instead of a
      // nominal-biased edge. This maximizes clearance from both stickers,
      // especially around the 07/08 -> 09/10 transition.
      const selected = states[0].cuts.slice();
      for (let i = 1; i < selected.length; i++) {
        let lo = selected[i], hi = selected[i];
        // Bound the corridor to the expected row junction. Otherwise a very
        // large empty margin could shift a cut into an adjacent sticker.
        const nominal = i * cell;
        const minY = Math.max(1, Math.ceil(nominal - cell * 0.43));
        const maxY = Math.min(height - 2, Math.floor(
          nominal + cell * 0.43));
        while (lo > minY && density[lo - 1] <= 0.008) lo--;
        while (hi < maxY && density[hi + 1] <= 0.008) hi++;
        const centered = Math.round((lo + hi) / 2);
        // Preserve the joint optimizer's minimum row height after centering.
        const previous = selected[i - 1];
        const next = i + 1 < selected.length ? states[0].cuts[i + 1] : height;
        selected[i] = centered - previous >= cell * 0.56 &&
          next - centered >= cell * 0.56 ? centered : states[0].cuts[i];
      }
      // Independently verify every selected split against the original
      // column pixels. A split through even one visible scanline is not
      // reliable, regardless of the optimization score.
      for (let i = 1; i < selected.length; i++) {
        const cut = selected[i];
        const before = density[Math.max(0, cut - 1)];
        const at = density[cut];
        const after = density[Math.min(height - 1, cut + 1)];
        const allowedInk = 0.008;
        if (Math.max(before, at, after) > allowedInk) return null;
      }
      result.push([...selected.map(y=>y/height),1]);
    }
    return result;
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
  function pixelCropCrossings(image, rect, mode = "auto", tolerance = 24, custom = "#ffffff") {
    if (mode === "none") return [];
    const { data, width, height } = image;
    const color = mode === "white" ? [255, 255, 255] : mode === "custom"
      ? [1, 3, 5].map(i => parseInt(custom.slice(i, i + 2), 16))
      : backgroundColor(data, width, height);
    const ink = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const k = (y * width + x) * 4;
      return data[k + 3] > 128 && !near(data, k, color, Math.max(40, tolerance));
    };
    const edges = [
      ["top", rect.width, n => [rect.x + n, rect.y, 0, 1]],
      ["bottom", rect.width, n => [rect.x + n, rect.y + rect.height - 1, 0, -1]],
      ["left", rect.height, n => [rect.x, rect.y + n, 1, 0]],
      ["right", rect.height, n => [rect.x + rect.width - 1, rect.y + n, -1, 0]],
    ];
    const result = [], threshold = Math.max(4, Math.round(Math.min(rect.width, rect.height) * 0.02));
    for (const [side, length, point] of edges) {
      let run = 0, longest = 0;
      for (let n = 0; n < length; n++) {
        const [x, y, dx, dy] = point(n);
        // Require two pixels on both sides, including the actual crop edge.
        const crosses = ink(x, y) && ink(x + dx, y + dy) &&
          ink(x - dx, y - dy) && ink(x - 2 * dx, y - 2 * dy);
        run = crosses ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      if (longest >= threshold) result.push(side);
    }
    return result;
  }
  // One background sample per original sheet, rather than repeated
  // canvas allocations during boundary inspection.
  const cropBackgroundCache = new WeakMap();
  function cropCrossings(image, rect, mode, tolerance, color) {
    if (mode === "none") return [];
    const x = Math.max(0, rect.x - 2), y = Math.max(0, rect.y - 2);
    const w = Math.min(image.width, rect.x + rect.width + 2) - x;
    const h = Math.min(image.height, rect.y + rect.height + 2) - y;
    const probe = isolateRect(image, { x, y, width: w, height: h });
    const pixels = probe.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);
    probe.width = probe.height = 1;
    // The four corners of a tiny probe may all belong to the artwork.
    // In auto mode, infer the background from the ORIGINAL sheet corners,
    // not the cropped probe. Otherwise dark lettering can be mistaken for
    // background and white gutters can be flagged as cut artwork.
    let crossingMode = mode, crossingColor = color;
    if (mode === "auto") {
      let bgColor = cropBackgroundCache.get(image);
      if (!bgColor) {
        const corners = canvas(4, 1);
        const cornerContext = corners.getContext("2d", { willReadFrequently: true });
        const positions = [
          [0, 0], [image.width - 1, 0],
          [0, image.height - 1], [image.width - 1, image.height - 1],
        ];
        for (let i = 0; i < positions.length; i++) {
          const [cx, cy] = positions[i];
          cornerContext.drawImage(image, cx, cy, 1, 1, i, 0, 1, 1);
        }
        const samples = cornerContext.getImageData(0, 0, 4, 1);
        const bg = backgroundColor(samples.data, 4, 1);
        corners.width = corners.height = 1;
        bgColor = "#" + bg.map(channel => channel.toString(16).padStart(2, "0")).join("");
        cropBackgroundCache.set(image, bgColor);
      }
      crossingMode = "custom";
      crossingColor = bgColor;
    }
    return pixelCropCrossings(pixels, { ...rect, x: rect.x - x, y: rect.y - y }, crossingMode, tolerance, crossingColor);
  }
  function createTile(source, column, row, mode, tolerance, color) {
    const rect = tileRect(source, column, row);
    // Boundary color alone is not evidence of a cut. Compare the crop to
    // neighbouring ORIGINAL pixels; a stroke must continue across the edge.
    const sourceCuts = cropCrossings(source.image, rect, mode, tolerance, color);
    if (sourceCuts.length)
      throw new Error(`コマ${row * (source.columns || source.xs.length - 1) + column + 1}の分割線をまたぐ絵柄があります（${sourceCuts.join("・")}）。分割線と余白設定を調整してください。`);
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
    // A neighbouring row can leak into the bottom of a tile even when the
    // source-grid cut looks plausible. Find a genuinely empty horizontal
    // corridor separating a compact bottom fragment from the main artwork.
    // Never silently delete artwork: preserve pixels and require review.
    const rowInk = new Uint32Array(original.height);
    for (let y = 0; y < original.height; y++)
      for (let x = 0; x < original.width; x++)
        if (mask[y * original.width + x] > 32) rowInk[y]++;
    const start = Math.floor(original.height * 0.68);
    const end = Math.floor(original.height * 0.94);
    const minGap = Math.max(3, Math.round(original.height * 0.025));
    let bottomFragment = false;
    for (let y = start; y < end;) {
      if (rowInk[y] > 0) { y++; continue; }
      let next = y;
      while (next < end && rowInk[next] === 0) next++;
      if (next - y >= minGap) {
        let below = 0, above = 0;
        for (let k = next; k < original.height; k++) below += rowInk[k];
        for (let k = 0; k < y; k++) above += rowInk[k];
        if (below >= Math.max(12, original.width * 0.12) &&
            above >= below * 2 && next < original.height * 0.91) {
          bottomFragment = true;
          break;
        }
      }
      y = next;
    }
    if (bottomFragment) {
      boundaryReview.needsReview = true;
      boundaryReview.edges.push("detached-bottom-fragment");
    }
    // Inferred flat baselines are a geometric hypothesis, not semantic
    // evidence that a white region is a paw. Keep a visible review marker.
    if (mask.baselineCaps) {
      boundaryReview.needsReview = true;
      boundaryReview.edges.push("inferred-open-outline");
    }
    return {
      sourceRect: { ...rect },
      boundaryReview,
      original,
      mask,
      autoMask: mask.slice(),
      matte: mask.matte || [],
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
    // Manual erase/restore wins over inferred edge coverage. Recreated tiles
    // regenerate this sparse layer, including after project JSON reload.
    for (const [i, r, g, b] of stamp.matte || []) {
      if (stamp.mask[i] === stamp.autoMask[i]) data.data.set([r, g, b], i * 4);
    }
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
    cropCrossings,
    pixelCropCrossings,
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
