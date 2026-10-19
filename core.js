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
    // Conservative white matte: avoid crossing pale outlines into white artwork.
    const safeTolerance = color.every((v) => v >= 235)
      ? Math.min(tolerance, 12) : tolerance;
    const seen = new Uint8Array(width * height),
      queue = new Uint32Array(width * height);
    let head = 0,
      tail = 0;
    function visit(i) {
      if (!seen[i]) {
        seen[i] = 1;
        if (
          (data[i * 4 + 3] === 0 || data[i * 4 + 3] === 255) &&
          near(data, i * 4, color, safeTolerance)
        ) {
          // Do not let a thin antialiased break in a dark character outline
          // turn a large white face or paw into transparent background.
          // Narrow passages surrounded by colored ink are treated as
          // uncertain artwork, not automatically erased.
          const x = i % width, y = Math.floor(i / width);
          let nearMatte = 0, sampled = 0, darkInk = 0;
          if (x > 1 && x < width - 2 && y > 1 && y < height - 2) {
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const p = ((y + dy) * width + x + dx) * 4;
                sampled++;
                if (near(data, p, color, safeTolerance)) nearMatte++;
                // Only dark outline pixels should act as a barrier. Pale
                // antialiasing in ordinary background must not trap white.
                if (data[p + 3] > 128 &&
                    Math.max(data[p], data[p + 1], data[p + 2]) < 115)
                  darkInk++;
              }
          }
          if (!sampled || nearMatte >= 7 || darkInk === 0) {
            queue[tail++] = i;
            mask[i] = 0;
          }
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
    // Guard against a white face becoming connected to the outer matte
    // through a small outline break. Such a leak can erase thousands of
    // interior pixels; stop propagation when it enters a locally ink-bounded
    // region instead of relying solely on after-the-fact restoration.
    while (head < tail) {
      const i = queue[head++],
        x = i % width;
      if (x > 0) visit(i - 1);
      if (x + 1 < width) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i + width < mask.length) visit(i + width);
    }
    // Restore white artwork with nearby dark contours on all four sides.
    // This catches a face connected to the exterior through a tiny gap.
    if (color.every(v => v >= 235)) {
      const originalMask = mask.slice();
      // Never let distant lettering count as a face boundary.
      const radius = Math.max(8, Math.round(Math.min(width, height) * 0.14));
      const dark = (p) => data[p*4+3] > 128 &&
        Math.max(data[p*4], data[p*4+1], data[p*4+2]) < 125;
      // JPEG compression makes white faces and paws slightly grey. The
      // exterior flood must remain strict, but interior recovery needs a
      // separate, broader near-white test after contour checks.
      const artworkWhite = (p) => {
        const k = p * 4;
        return data[k+3] > 200 &&
          Math.min(data[k],data[k+1],data[k+2]) >= 215 &&
          Math.max(Math.abs(data[k]-color[0]),
                   Math.abs(data[k+1]-color[1]),
                   Math.abs(data[k+2]-color[2])) <= 40;
      };
      const candidates = new Uint8Array(mask.length);
      for (let y = 2; y < height-2; y += 2)
        for (let x = 2; x < width-2; x += 2) {
          const p = y*width+x;
          if (originalMask[p] !== 0 || !artworkWhite(p)) continue;
          let sides = 0;
          for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            for (let d = 1; d <= radius; d++) {
              const xx=x+dx*d, yy=y+dy*d;
              if (xx<0 || yy<0 || xx>=width || yy>=height) break;
              if (dark(yy*width+xx)) { sides++; break; }
            }
          }
          // Paws and panda cheeks often have an open edge in the source.
          // Four enclosing rays misses those white regions entirely.
          // Require opposing ink on one axis and a third contour instead.
          // Keep the search local so distant text cannot enclose background.
          if (sides >= 3) {
            let left = false, right = false, up = false, down = false;
            for (let d = 1; d <= radius; d++) {
              if (x-d >= 0 && dark(y*width+x-d)) left = true;
              if (x+d < width && dark(y*width+x+d)) right = true;
              if (y-d >= 0 && dark((y-d)*width+x)) up = true;
              if (y+d < height && dark((y+d)*width+x)) down = true;
            }
            if ((left && right && (up || down)) ||
                (up && down && (left || right))) candidates[p] = 1;
          } else {
            // The centre of a large white face can be farther than the
            // strict local radius from one side of its outline. Permit a
            // wider search only when both opposing sides are visible,
            // and a third side is also bounded. Avoid isolated text strokes.
            const wide = Math.round(Math.min(width,height)*0.25);
            const found = [false,false,false,false];
            for (let d=1; d<=wide; d++) {
              if (x-d>=0 && dark(y*width+x-d)) found[0]=true;
              if (x+d<width && dark(y*width+x+d)) found[1]=true;
              if (y-d>=0 && dark((y-d)*width+x)) found[2]=true;
              if (y+d<height && dark((y+d)*width+x)) found[3]=true;
            }
            if ((found[0] && found[1] && (found[2] || found[3])) ||
                (found[2] && found[3] && (found[0] || found[1])))
              candidates[p]=1;
          }
        }
      for (let y=2; y<height-2; y++)
        for (let x=2; x<width-2; x++) {
          const p=y*width+x, bx=x-(x%2), by=y-(y%2);
          if (originalMask[p] === 0 &&
              artworkWhite(p) &&
              (candidates[by*width+bx] ||
               candidates[by*width+Math.min(width-1,bx+2)] ||
               candidates[Math.min(height-1,by+2)*width+bx] ||
               (bx>=2 && candidates[by*width+bx-2]) ||
               (by>=2 && candidates[(by-2)*width+bx])))
            mask[p]=data[p*4+3];
        }
      // Open-bottom paws (e.g. stamp 03) have dark ink at their sides
      // but no lower enclosing contour. Restore a near-white pixel only
      // when two side contours are close and a retained body/face touches
      // its upper neighbourhood. This avoids restoring the open exterior.
      const pawRadius = Math.max(6, Math.round(Math.min(width,height)*0.11));
      const pawSeeds = new Uint8Array(mask.length);
      for (let y=3; y<height-3; y+=2)
        for (let x=3; x<width-3; x+=2) {
          const p=y*width+x;
          if (mask[p]!==0 || !artworkWhite(p)) continue;
          let left=false,right=false,upper=false;
          for(let d=1;d<=pawRadius;d++) {
            if(x-d>=0 && dark(y*width+x-d)) left=true;
            if(x+d<width && dark(y*width+x+d)) right=true;
            if(y-d>=0 && mask[(y-d)*width+x]>200) upper=true;
          }
          // The surviving face may be diagonally above a fully erased paw,
          // not in the exact same column. Search a bounded upper fan for
          // retained near-white artwork, while requiring side ink barriers.
          let attached=false;
          const maxRise=Math.min(pawRadius,24);
          const maxOffset=Math.min(pawRadius,12);
          for(let dy=1;dy<=maxRise && !attached;dy+=2) {
            const yy=y-dy;
            if(yy<0)break;
            for(let dx=-maxOffset;dx<=maxOffset;dx+=2) {
              const xx=x+dx;
              if(xx<0||xx>=width)continue;
              const q=yy*width+xx;
              if(mask[q]>200 && artworkWhite(q)) {attached=true;break;}
            }
          }
          if(left && right && upper && attached) pawSeeds[p]=1;
        }
      // Fill seed neighbours without crossing dark strokes or restoring
      // a whole white exterior region.
      for(let y=3;y<height-3;y++)
        for(let x=3;x<width-3;x++) {
          const p=y*width+x,bx=x-(x%2),by=y-(y%2);
          if(mask[p]===0 && artworkWhite(p) &&
             (pawSeeds[by*width+bx] ||
              pawSeeds[by*width+Math.min(width-1,bx+2)] ||
              pawSeeds[Math.min(height-1,by+2)*width+bx]))
            mask[p]=data[p*4+3];
        }
      // A 2-pixel sample can leave thin transparent seams in otherwise
      // restored faces. Fill only near-white holes fully surrounded by
      // already retained pixels, never expand into an open background.
      const restored = mask.slice();
      for (let y=2; y<height-2; y++)
        for (let x=2; x<width-2; x++) {
          const p=y*width+x;
          if (restored[p] !== 0 || !artworkWhite(p)) continue;
          let enclosed=0;
          for (const n of [p-1,p+1,p-width,p+width])
            if (restored[n]>200) enclosed++;
          if (enclosed===4) mask[p]=data[p*4+3];
        }
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
        // In the supplied 2x5 sheet the last gutter is around y=1180,
        // while equal-height y=1229 crosses the fifth-row captions.
        // Do not even consider late fourth/fifth cuts in this layout.
        const high=Math.min(height-2,Math.round(
          nominal + (rows === 5 && row === 4 ? -cell*0.07 : cell*0.43)));
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
          // The third/fourth row junction in real 2x5 JPEG sheets can
          // contain a few compressed pixels even between distinct drawings.
          // Allow a narrow low-ink corridor there, while still requiring
          // populated artwork above and below.
          const maxGutterInk = rows === 5 && row === 3 ? 0.02 : 0.008;
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
          // The last 2x5 boundary often sits above its equal-height
          // position. Penalize a late cut there: it can import the first
          // pixels of row five into row four (07/08 contamination).
          // For the final 2x5 junction, the fifth sticker can begin well
          // before the equal-height grid line. Favor the FIRST clean
          // corridor after row four rather than an empty stripe inside
          // the artwork of row five.
          const lateFinalRow = rows === 5 && row === rows - 1
            ? Math.max(0, y - (nominal - cell * 0.12)) / cell * 1.5
            : 0;
          const score = Math.abs(y - nominal) / cell * 0.13 +
            0.7 / (corridor + 3) + smooth[y] * 0.08 + lateFinalRow;
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
          nominal + (rows === 5 && i === 4 ? -cell * 0.07 : cell * 0.43)));
        while (lo > minY && density[lo - 1] <= 0.008) lo--;
        while (hi < maxY && density[hi + 1] <= 0.008) hi++;
        // On the fourth/fifth row boundary, keep the chosen clean cut.
        // Re-centering a long pale run can cross the top of row-five artwork
        // and then crop the corresponding 09/10 image.
        const centered = rows === 5 && i === rows - 1
          ? selected[i] : Math.round((lo + hi) / 2);
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
        const allowedInk = rows === 5 && i === 3 ? 0.02 : 0.008;
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
  function createTile(source, column, row, mode, tolerance, color) {
    const rect = tileRect(source, column, row);
    // A manually adjusted inset or row line can still cut through artwork.
    // Check the ORIGINAL source pixels along all four crop edges, before
    // resizing or flood masking can hide the evidence.
    if (source.image && (source.mode === "auto" || source.mode === "white")) {
      const probe = canvas(rect.width, rect.height);
      const probeCtx = probe.getContext("2d", { willReadFrequently: true });
      probeCtx.drawImage(source.image, rect.x, rect.y, rect.width, rect.height,
        0, 0, rect.width, rect.height);
      const edgeData = probeCtx.getImageData(0, 0, rect.width, rect.height).data;
      probe.width = probe.height = 1;
      // A few isolated colored JPEG edge pixels do not prove clipping.
      // Count a continuous stroke on each edge instead of accumulating
      // unrelated compression artifacts from all four sides.
      const isInk = (x, y) => {
        const k = (y * rect.width + x) * 4;
        if (edgeData[k+3] < 128) return false;
        const hi = Math.max(edgeData[k], edgeData[k+1], edgeData[k+2]);
        const lo = Math.min(edgeData[k], edgeData[k+1], edgeData[k+2]);
        return hi < 195 || (hi-lo > 35 && lo < 220);
      };
      const longestRun = (length, point) => {
        let run = 0, longest = 0;
        for (let n = 0; n < length; n++) {
          run = point(n) ? run + 1 : 0;
          if (run > longest) longest = run;
        }
        return longest;
      };
      const runs = [
        longestRun(rect.width, x => isInk(x, 0)),
        longestRun(rect.width, x => isInk(x, rect.height-1)),
        longestRun(rect.height, y => isInk(0, y)),
        longestRun(rect.height, y => isInk(rect.width-1, y))
      ];
      const threshold = Math.max(4, Math.round(Math.min(rect.width,rect.height)*0.02));
      if (Math.max(...runs) >= threshold)
        throw new Error(`コマ${row * source.columns + column + 1}の切り抜き枠が絵柄に重なっています。分割線と余白設定を調整してください（境界の連続した色付き画素 ${Math.max(...runs)}個）。`);
    }
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
    // Conservative signal only: do not certify tiles with suspiciously
    // large erased areas surrounded by colored artwork.
    const x0 = Math.floor(original.width * 0.3);
    const x1 = Math.ceil(original.width * 0.7);
    const y0 = Math.floor(original.height * 0.3);
    const y1 = Math.ceil(original.height * 0.7);
    let erased = 0, colorful = 0, samples = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * original.width + x, k = p * 4;
        if (original.data[k + 3] < 200) continue;
        samples++;
        if (mask[p] === 0) erased++;
        if (Math.max(original.data[k], original.data[k + 1], original.data[k + 2]) -
            Math.min(original.data[k], original.data[k + 1], original.data[k + 2]) > 40)
          colorful++;
      }
    }
    if (mode !== "none" && samples > 0 && colorful > 20 &&
        erased / samples > 0.45) {
      boundaryReview.needsReview = true;
      boundaryReview.edges.push("possible-white-artwork-loss");
    }
    // A single aggregate erased percentage misses localized white paws and
    // panda faces. Inspect small interior blocks individually; flag any
    // opaque, near-white region that has dark outline ink on several sides.
    if (mode !== "none") {
      const block = Math.max(10, Math.round(Math.min(original.width, original.height) * 0.09));
      let suspectBlocks = 0;
      for (let by = block; by + block < original.height; by += block)
        for (let bx = block; bx + block < original.width; bx += block) {
          let lost = 0, dark = 0, eligible = 0;
          for (let y = by; y < by + block; y++)
            for (let x = bx; x < bx + block; x++) {
              const p = y * original.width + x, k = p * 4;
              if (original.data[k + 3] < 220) continue;
              eligible++;
              if (Math.min(original.data[k], original.data[k+1], original.data[k+2]) > 205 &&
                  mask[p] === 0) lost++;
              if (Math.max(original.data[k], original.data[k+1], original.data[k+2]) < 130)
                dark++;
            }
          if (eligible && lost > block * block * 0.18 && dark > block * 0.8)
            suspectBlocks++;
        }
      if (suspectBlocks >= 2) {
        boundaryReview.needsReview = true;
        if (!boundaryReview.edges.includes("possible-white-artwork-loss"))
          boundaryReview.edges.push("possible-white-artwork-loss");
      }
    }
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
