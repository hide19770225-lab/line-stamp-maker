/* Conservative connected-component review. Detection never changes image pixels. */
(function (root) {
  "use strict";
  function analyse(
    image,
    mask,
    rect = { x: 0, y: 0, width: image.width, height: image.height },
    detailed = false,
  ) {
    const { width, height, data } = image;
    if (mask.length !== width * height)
      throw new Error("画像と透明度の寸法が一致しません。");
    const visited = detailed
        ? new Uint32Array(mask.length)
        : new Uint8Array(mask.length),
      queue = new Uint32Array(mask.length),
      components = [];
    const xEnd = rect.x + rect.width,
      yEnd = rect.y + rect.height;
    let id = 0;
    for (let y = rect.y; y < yEnd; y++)
      for (let x = rect.x; x < xEnd; x++) {
        const index = y * width + x;
        if (!mask[index] || visited[index]) continue;
        id++;
        let head = 0,
          tail = 0,
          left = x,
          right = x,
          top = y,
          bottom = y,
          white = 0;
        queue[tail++] = index;
        visited[index] = detailed ? id : 1;
        while (head < tail) {
          const i = queue[head++],
            px = i % width,
            py = Math.floor(i / width);
          left = Math.min(left, px);
          right = Math.max(right, px);
          top = Math.min(top, py);
          bottom = Math.max(bottom, py);
          if (
            data[i * 4] >= 235 &&
            data[i * 4 + 1] >= 235 &&
            data[i * 4 + 2] >= 235
          )
            white++;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = px + dx,
                ny = py + dy;
              if (nx < rect.x || nx >= xEnd || ny < rect.y || ny >= yEnd)
                continue;
              const n = ny * width + nx;
              if (mask[n] && !visited[n]) {
                visited[n] = detailed ? id : 1;
                queue[tail++] = n;
              }
            }
        }
        components.push({
          id,
          area: tail,
          x: left,
          y: top,
          width: right - left + 1,
          height: bottom - top + 1,
          whiteFraction: white / tail,
          touchesEdge:
            left === rect.x ||
            right === xEnd - 1 ||
            top === rect.y ||
            bottom === yEnd - 1,
        });
      }
    const main = components.reduce(
      (best, c) => (!best || c.area > best.area ? c : best),
      null,
    );
    const candidates = main
      ? components.filter((c) => {
          if (c.id === main.id) return false;
          const outside =
            c.x + c.width <= main.x ||
            c.x >= main.x + main.width ||
            c.y + c.height <= main.y ||
            c.y >= main.y + main.height;
          const thin =
            (c.width >= 5 &&
              c.height <= Math.max(3, height * 0.015) &&
              c.width / c.height >= 4) ||
            (c.height >= 5 &&
              c.width <= Math.max(3, width * 0.015) &&
              c.height / c.width >= 4);
          const tiny = c.area <= Math.max(4, main.area * 0.015);
          return (
            outside &&
            (thin || tiny || (c.touchesEdge && c.area <= main.area * 0.1)) &&
            c.area <= Math.max(64, main.area * 0.25)
          );
        })
      : [];
    return {
      width,
      height,
      components,
      candidates,
      mainId: main?.id || 0,
      rect: { ...rect },
      labels: detailed ? visited : null,
      maskSnapshot: detailed ? mask.slice() : null,
    };
  }
  function removeSelected(mask, scan, ids) {
    if (
      !scan.labels ||
      !scan.maskSnapshot ||
      mask.length !== scan.maskSnapshot.length ||
      mask.some((alpha, i) => alpha !== scan.maskSnapshot[i])
    )
      throw new Error(
        "画像が変更されています。候補を再検出してから選択してください。",
      );
    const allowed = new Set(scan.candidates.map((c) => c.id)),
      selected = new Set(ids);
    if ([...selected].some((id) => !allowed.has(id)))
      throw new Error("選択した削除候補が正しくありません。");
    const result = mask.slice();
    let removed = 0;
    for (let i = 0; i < result.length; i++)
      if (selected.has(scan.labels[i]) && result[i]) {
        result[i] = 0;
        removed++;
      }
    return { mask: result, removed };
  }
  const api = { analyse, removeSelected };
  root.StampResidue = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
